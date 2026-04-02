/* ============================================================
   INTERMITTENT — app.js v3.0
   ============================================================ */

const APP_VERSION = '3.1.20';
const APP_DATE    = '2026-04-01';

const MONTHS     = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const CAT_ICONS  = {transport:'🚗',navigo:'🚇',km:'🛣️',logiciel:'💻',formation:'📚',materiel:'🎭',repas:'🍽️',agent:'🤝',conges:'🌴',autre:'📦'};
const CAT_LABELS = {transport:'Transport',navigo:'Navigo',km:'Kilométrique',logiciel:'Logiciels',formation:'Formation',materiel:'Matériel',repas:'Repas',agent:'Agent',conges:'Congés Spectacle',autre:'Autre'};

// ── STATE ──
let state = {
  contrats: [],
  frais: [],
  config: { tauxPas:14.6, situation:2, mathilde:0, sjr:0, areReel:0, finDroits:'' }
};

let session = {
  token: null,
  expiresAt: null
};

let currentDocType     = 'bulletin';
let pendingScanData    = null;
let activeSheet        = null;
let selectedMonthFrais = 'all';
let currentContratId   = null;
let syncDebounce       = null;
let isDesktop          = false;

// ============================================================
// APPS SCRIPT
// ============================================================
function getAppsScriptUrl() { return localStorage.getItem('apps-script-url') || ''; }

async function appsScriptGet(params) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script non configuré');
  const q = new URLSearchParams(params).toString();
  const r = await fetch(`${url}?${q}`, { redirect: 'follow' });
  return await r.json();
}

async function appsScriptLogin(password) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script non configuré');
  const params = new URLSearchParams({ action: 'login', password });
  const r = await fetch(`${url}?${params}`, { redirect: 'follow' });
  return await r.json();
}

async function appsScriptPost(body) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script non configuré');
  if (session.token && !body.token) body.token = session.token;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body),
    redirect: 'follow'
  });
  const data = await r.json();
  // Si token invalide → logout
  if (!data.ok && data.code === 401) {
    handleSessionExpired();
    return data;
  }
  return data;
}

// ============================================================
// AUTH
// ============================================================
function loadSession() {
  session.token     = localStorage.getItem('auth-token') || null;
  session.expiresAt = localStorage.getItem('auth-expires') || null;
}

function saveSession(token, expiresAt) {
  session.token     = token;
  session.expiresAt = expiresAt;
  localStorage.setItem('auth-token', token);
  localStorage.setItem('auth-expires', expiresAt);
}

function clearSession() {
  session.token = null;
  session.expiresAt = null;
  localStorage.removeItem('auth-token');
  localStorage.removeItem('auth-expires');
}

function isSessionValid() {
  if (!session.token || !session.expiresAt) return false;
  return new Date(session.expiresAt) > new Date();
}

async function saveUrlFromLogin() {
  const url = document.getElementById('login-apps-script-url').value.trim();
  if (!url.includes('script.google.com')) { 
    showLoginError('URL invalide — doit contenir script.google.com');
    return;
  }
  localStorage.setItem('apps-script-url', url);
  // Pré-remplit aussi le champ dans Réglages
  const el = document.getElementById('apps-script-url');
  if (el) el.value = url;
  // Affiche la confirmation
  document.getElementById('login-url-saved').style.display = 'block';
  document.getElementById('login-error').classList.remove('show');
  // Pré-remplit le champ URL dans le login si déjà en localStorage
  document.getElementById('login-apps-script-url').value = url;
}

async function handleLogin() {
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');
  const error    = document.getElementById('login-error');

  if (!password) { showLoginError('Entre ton mot de passe'); return; }
  if (!getAppsScriptUrl()) { showLoginError('Apps Script URL non configurée — modifie directement le code'); return; }

  btn.innerHTML = '<div class="loader" style="width:16px;height:16px;border-color:rgba(255,255,255,.3);border-top-color:#fff;"></div>';
  error.classList.remove('show');

  try {
    const res = await appsScriptLogin(password);
    btn.textContent = 'Se connecter';
    if (res.ok) {
      saveSession(res.token, res.expiresAt);
      showApp();
      await loadFromServer();
    } else {
      showLoginError(res.error || 'Erreur de connexion');
    }
  } catch(e) {
    btn.textContent = 'Se connecter';
    showLoginError('Erreur réseau : ' + e.message);
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.add('show');
}

function handleSessionExpired() {
  clearSession();
  showLogin();
  toast('🔑 Session expirée — reconnecte-toi');
}

async function handleLogout() {
  if (session.token) {
    try { await appsScriptPost({ action: 'logout' }); } catch(e) {}
  }
  clearSession();
  showLogin();
  toast('👋 Déconnecté');
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';
  showPage('bilan');
}

// ============================================================
// SYNC
// ============================================================
function setSyncStatus(s, l) {
  document.getElementById('sync-dot').className = 'sync-dot ' + s;
  document.getElementById('sync-label').textContent = l;
  // Desktop sidebar
  const ds = document.getElementById('desktop-sync-dot');
  const dl = document.getElementById('desktop-sync-label');
  if (ds) { ds.className = 'sync-dot ' + s; dl.textContent = l; }
}

function saveLocal() {
  localStorage.setItem('intermittent-v2', JSON.stringify(state));
}

function saveState() {
  saveLocal();
  if (getAppsScriptUrl() && isSessionValid()) {
    clearTimeout(syncDebounce);
    syncDebounce = setTimeout(() => syncToServer(false), 3000);
  }
}

async function syncToServer(showToast = false) {
  if (!getAppsScriptUrl() || !isSessionValid()) return;
  setSyncStatus('syncing', 'Sync…');
  try {
    const res = await appsScriptPost({ action: 'saveData', data: state });
    if (res.ok) {
      const ts = new Date().toLocaleString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      setSyncStatus('ok', 'Sync ✓');
      document.getElementById('last-sync-label').textContent = ts;
      if (showToast) toast('☁️ Sauvegardé sur Drive !');
    } else {
      setSyncStatus('error', 'Erreur');
      if (showToast) toast('❌ ' + (res.error || 'Erreur sync'));
    }
  } catch(e) {
    setSyncStatus('error', 'Erreur');
    if (showToast) toast('❌ ' + e.message);
  }
}

async function loadFromServer() {
  if (!getAppsScriptUrl() || !isSessionValid()) return;
  setSyncStatus('syncing', 'Chargement…');
  try {
    const res = await appsScriptGet({ action: 'getData', token: session.token });
    if (res.ok && res.data) {
      const d = res.data;
      if (d.contrats) state.contrats = d.contrats;
      else if (d.bulletins) state.contrats = migrateBulletins(d.bulletins);
      if (d.frais)   state.frais   = d.frais;
      if (d.config)  state.config  = { ...state.config, ...d.config };
      saveLocal();
      renderAll();
      setSyncStatus('ok', 'Sync ✓');
    } else if (res.ok) {
      setSyncStatus('ok', 'Sync ✓');
    }
  } catch(e) {
    setSyncStatus('error', 'Erreur');
    toast('❌ Chargement : ' + e.message);
  }
}

function migrateBulletins(bulletins) {
  return bulletins.map(b => ({
    id: b.id, employeur: b.employeur || '', poste: '',
    dateDebut: b.date, dateFin: b.date,
    cachets: b.cachets || 0, heures: b.hTot || 0,
    brutV: b.brutV || 0, netImp: b.netImp || 0,
    netV: b.netV || 0, pasV: b.pasV || 0,
    paye: b.nonPaye === 0, ref: b.ref || '',
    comment: '', docs: []
  }));
}

// ============================================================
// NAVIGATION
// ============================================================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn, .sidebar-item').forEach(b => b.classList.remove('active'));

  document.getElementById('page-' + id).classList.add('active');
  // Highlight nav (mobile + desktop)
  const navBtn = document.getElementById('nav-' + id);
  if (navBtn) navBtn.classList.add('active');
  const sideItem = document.getElementById('side-' + id);
  if (sideItem) sideItem.classList.add('active');

  if (id === 'bilan')    renderBilan();
  if (id === 'contrats') renderContrats();
  if (id === 'frais')    renderFrais();
  if (id === 'ft')       renderFTPage();
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

function openSheet(id) {
  closeSheet(true);
  populateContratSelects();
  // Reset du formulaire contrat : remet le choix scan/manuel
  if (id === 'sheet-add-contrat') {
    const form = document.getElementById('contrat-form');
    const btns = form?.previousElementSibling;
    if (form) form.style.display = 'none';
    if (btns) btns.style.display = 'flex';
  }
  activeSheet = id;
  if (isDesktop && id === 'sheet-add-contrat') {
    // Sur desktop : affiche dans le panneau latéral droit
    document.getElementById('desktop-detail-panel').classList.add('show');
    document.getElementById('desktop-detail-body').innerHTML = document.getElementById('sheet-add-contrat').innerHTML;
    return;
  }
  document.getElementById('sheet-overlay').classList.add('show');
  document.getElementById(id).classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeSheet(silent) {
  if (activeSheet) {
    document.getElementById(activeSheet).classList.remove('show');
    activeSheet = null;
  }
  document.getElementById('sheet-overlay').classList.remove('show');
  document.body.style.overflow = '';
}

function populateContratSelects() {
  const opts = state.contrats
    .sort((a, b) => b.dateDebut.localeCompare(a.dateDebut))
    .map(c => `<option value="${c.id}">${c.employeur} (${fmtDate(c.dateDebut)})</option>`)
    .join('');
  const s1 = document.getElementById('scan-contrat-select');
  if (s1) s1.innerHTML = '<option value="">— Aucun / nouveau contrat —</option>' + opts;
  const s2 = document.getElementById('f-contrat-link');
  if (s2) s2.innerHTML = '<option value="">— Aucun —</option>' + opts;
}

// ============================================================
// DETAIL VIEW
// ============================================================
function goScanFor(contratId, docType) {
  // Ferme le détail, va sur Scanner, pré-sélectionne le type et le contrat
  closeDetail();
  showPage('scan');
  // Active le bon pill
  document.querySelectorAll('.pill').forEach(p => {
    const t = p.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    if (t === docType) { p.classList.add('active'); currentDocType = docType; }
    else p.classList.remove('active');
  });
  // Affiche le sélecteur de contrat et pré-sélectionne
  document.getElementById('scan-contrat-link-card').style.display = 'block';
  populateContratSelects();
  const sel = document.getElementById('scan-contrat-select');
  if (sel) sel.value = contratId;
  toast('📄 Scanne le document manquant');
}

function openDetail(id) {
  currentContratId = id;
  const c = state.contrats.find(x => x.id === id);
  if (!c) return;
  document.getElementById('detail-title').textContent = c.employeur || 'Contrat';
  renderDetailBody(c);

  if (isDesktop) {
    // Sur desktop : affiche le panel de droite
    document.getElementById('desktop-detail-panel').classList.add('show');
   } else {
       const dv = document.getElementById('detail-view');
       dv.classList.add('show');
       dv.style.transform = 'translateX(0)';
       document.body.style.overflow = 'hidden';
   }
}

function closeDetail() {
  document.getElementById('detail-view').classList.remove('show');
  const panel = document.getElementById('desktop-detail-panel');
  if (panel) panel.classList.remove('show');
  document.body.style.overflow = '';
  currentContratId = null;
  renderContrats();
}

function renderDetailBody(c) {
  const fraisLies = state.frais.filter(f => f.contratId === c.id);
  const totalFrais = fraisLies.reduce((s, f) => s + f.montant, 0);
  const nbJours = c.dateDebut && c.dateFin
    ? Math.ceil((new Date(c.dateFin) - new Date(c.dateDebut)) / 86400000) + 1 : 0;

  const html = `
    <div style="margin-bottom:16px;">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Statut paiement</div>
      <div class="paiement-toggle">
        <div class="paiement-btn ${c.paye===true?'active-paye':''}" onclick="togglePaiement('${c.id}',true)">✅ Payé</div>
        <div class="paiement-btn ${c.paye===false?'active-attente':''}" onclick="togglePaiement('${c.id}',false)">⏳ En attente</div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div class="card-head-title">Documents rattachés</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
         <span class="tag ${c.hasContrat?'tag-green':'tag-gray'}" style="${!c.hasContrat?'cursor:pointer':''}" onclick="${!c.hasContrat?`goScanFor('${c.id}','contrat')`:''}">📝 Contrat ${c.hasContrat?'✓':'+ Scanner'}</span>
         <span class="tag ${c.hasBulletin?'tag-green':'tag-gray'}" style="${!c.hasBulletin?'cursor:pointer':''}" onclick="${!c.hasBulletin?`goScanFor('${c.id}','bulletin')`:''}">📄 Bulletin ${c.hasBulletin?'✓':'+ Scanner'}</span>
         <span class="tag ${c.hasAEM?'tag-green':'tag-gray'}" style="${!c.hasAEM?'cursor:pointer':''}" onclick="${!c.hasAEM?`goScanFor('${c.id}','aem')`:''}">📋 AEM ${c.hasAEM?'✓':'+ Scanner'}</span>
         <span class="tag ${c.hasCS?'tag-green':'tag-gray'}" style="${!c.hasCS?'cursor:pointer':''}" onclick="${!c.hasCS?`goScanFor('${c.id}','conges')`:''}">🌴 CS ${c.hasCS?'✓':'+ Scanner'}</span>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><div class="card-head-title">Informations</div></div>
      <div class="ft-row"><span class="ft-label">Employeur</span><span class="ft-value">${c.employeur||'—'}</span></div>
      <div class="ft-row"><span class="ft-label">Poste</span><span class="ft-value">${c.poste||'—'}</span></div>
      <div class="ft-row"><span class="ft-label">Début</span><span class="ft-value">${fmtDate(c.dateDebut)}</span></div>
      <div class="ft-row"><span class="ft-label">Fin</span><span class="ft-value">${fmtDate(c.dateFin)}</span></div>
      <div class="ft-row"><span class="ft-label">Durée</span><span class="ft-value">${nbJours} jour${nbJours>1?'s':''}</span></div>
    </div>
    <div class="card">
      <div class="card-head"><div class="card-head-title">Rémunération</div></div>
      <div class="ft-row"><span class="ft-label">Cachets</span><span class="ft-value">${c.cachets||0}</span></div>
      <div class="ft-row"><span class="ft-label">Heures</span><span class="ft-value">${c.heures||0} h</span></div>
      <div class="ft-row"><span class="ft-label">Salaire brut</span><span class="ft-value" style="color:var(--gold)">${fmt(c.brutV)}</span></div>
      <div class="ft-row"><span class="ft-label">Net imposable</span><span class="ft-value">${fmt(c.netImp)}</span></div>
      <div class="ft-row"><span class="ft-label">Net perçu</span><span class="ft-value" style="color:var(--green)">${fmt(c.netV)}</span></div>
      <div class="ft-row"><span class="ft-label">PAS prélevé</span><span class="ft-value" style="color:var(--red)">${fmt(c.pasV)}</span></div>
    </div>
    <div class="card" style="background:var(--blue-light);border-color:rgba(26,74,122,.2);">
      <div class="card-head"><div class="card-head-title" style="color:var(--blue);">France Travail</div></div>
      <div class="ft-row"><span class="ft-label">Déclarer en</span><span class="ft-value" style="color:var(--blue);">${getMoisDeclaration(c.dateDebut)}</span></div>
      <div class="ft-row"><span class="ft-label">Heures</span><span class="ft-value">${c.heures||0} h</span></div>
      <div class="ft-row"><span class="ft-label">Brut à déclarer</span><span class="ft-value">${fmt(c.brutV)}</span></div>
      <div class="ft-row"><span class="ft-label">Jours travaillés</span><span class="ft-value">${nbJours}</span></div>
    </div>
    <div class="card">
      <div class="card-head">
        <div class="card-head-title">Frais affiliés</div>
        <button class="btn btn-ghost btn-sm" onclick="closeDetail();setTimeout(()=>{openSheet('sheet-add-frais');document.getElementById('f-contrat-link').value='${c.id}'},150)">＋</button>
      </div>
      ${!fraisLies.length
        ? '<div class="empty" style="padding:16px;"><div class="empty-text">Aucun frais affilié</div></div>'
        : fraisLies.map(f => `<div class="ft-row"><span class="ft-label">${CAT_ICONS[f.cat]||'📦'} ${f.desc||CAT_LABELS[f.cat]}</span><span class="ft-value">${fmt(f.montant)}</span></div>`).join('')
      }
      ${fraisLies.length > 0 ? `<div class="ft-row" style="border-top:2px solid var(--border);margin-top:4px;padding-top:12px;"><span class="ft-label" style="color:var(--ink);font-weight:700;">Total</span><span class="ft-value" style="color:var(--blue);">${fmt(totalFrais)}</span></div>` : ''}
    </div>
    ${c.ref ? `<div class="card"><div class="card-head"><div class="card-head-title">Documents</div></div><div style="font-family:'DM Mono',monospace;font-size:12px;line-height:1.8;">${c.ref}</div></div>` : ''}
    ${c.comment ? `<div class="card"><div class="card-head"><div class="card-head-title">Commentaire</div></div><div style="font-size:13px;line-height:1.6;">${c.comment}</div></div>` : ''}
    <button class="btn btn-ghost" onclick="editContrat('${c.id}')" style="width:100%;margin-bottom:8px;">✏️ Modifier</button>
    <button class="btn btn-ghost" onclick="openMergeContrat('${c.id}')" style="width:100%;margin-bottom:10px;">🔀 Fusionner avec un autre contrat</button>  `;

  document.getElementById('detail-body').innerHTML = html;
  const dp = document.getElementById('desktop-detail-body');
  if (dp) dp.innerHTML = html;
}

function getMoisDeclaration(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const m = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${MONTHS[m.getMonth()]} ${m.getFullYear()} (avant le 15)`;
}

function togglePaiement(id, paye) {
  const c = state.contrats.find(x => x.id === id);
  if (!c) return;
  c.paye = paye;
  saveState();
  renderDetailBody(c);
  toast(paye ? '✅ Marqué comme payé' : '⏳ Marqué en attente');
}

function deleteCurrentContrat() {
  if (!currentContratId) return;
  const c = state.contrats.find(x => x.id === currentContratId);
  if (!confirm(`Supprimer le contrat "${c?.employeur || 'ce contrat'}" ?`)) return;
  state.contrats = state.contrats.filter(x => x.id !== currentContratId);
  saveState();
  closeDetail();
  toast('🗑️ Contrat supprimé');
}

function openMergeContrat(id) {
  const c = state.contrats.find(x => x.id === id);
  if (!c) return;
  const others = state.contrats.filter(x => x.id !== id);
  if (!others.length) { toast('Aucun autre contrat à fusionner'); return; }

  const opts = others.map(o =>
    `<option value="${o.id}">${o.employeur} — ${fmtDate(o.dateDebut)}${o.dateDebut !== o.dateFin ? ' → '+fmtDate(o.dateFin) : ''} (${fmt(o.brutV)})</option>`
  ).join('');

  // Affiche un mini panel de fusion dans le détail
  const mergeHtml = `
    <div class="card" style="background:var(--blue-light);border-color:rgba(26,74,122,.2);margin-top:12px;" id="merge-panel">
      <div class="card-head"><div class="card-head-title" style="color:var(--blue);">Fusionner avec…</div><button class="btn btn-ghost btn-sm" onclick="document.getElementById('merge-panel').remove()">✕</button></div>
      <div class="field">
        <label>Choisir le contrat à absorber</label>
        <select id="merge-target-select">${opts}</select>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Le contrat sélectionné sera <strong>fusionné dans "${c.employeur}"</strong> et supprimé. Les valeurs manquantes seront complétées.</div>
      <button class="btn btn-primary" onclick="doMergeContrat('${id}')">🔀 Fusionner</button>
    </div>`;

  const body = document.getElementById('detail-body');
  if (body) body.insertAdjacentHTML('beforeend', mergeHtml);
  const dp = document.getElementById('desktop-detail-body');
  if (dp) dp.insertAdjacentHTML('beforeend', mergeHtml.replace('id="merge-panel"','id="merge-panel-desktop"').replace("document.getElementById('merge-panel').remove()","document.getElementById('merge-panel-desktop').remove()").replace("doMergeContrat('${id}')","doMergeContrat('${id}')"));
}

function doMergeContrat(keepId) {
  const sel = document.getElementById('merge-target-select') || document.getElementById('merge-target-select');
  if (!sel) return;
  const absorbId = sel.value;
  const keep   = state.contrats.find(x => x.id === keepId);
  const absorb = state.contrats.find(x => x.id === absorbId);
  if (!keep || !absorb) return;
  if (!confirm(`Fusionner "${absorb.employeur} (${fmtDate(absorb.dateDebut)})" dans "${keep.employeur} (${fmtDate(keep.dateDebut)})" ?`)) return;

  // Fusionne : prend les valeurs manquantes de l'absorbé
  if (!keep.brutV  && absorb.brutV)  keep.brutV  = absorb.brutV;
  if (!keep.netImp && absorb.netImp) keep.netImp = absorb.netImp;
  if (!keep.netV   && absorb.netV)   keep.netV   = absorb.netV;
  if (!keep.pasV   && absorb.pasV)   keep.pasV   = absorb.pasV;
  if (!keep.heures && absorb.heures) keep.heures = absorb.heures;
  if (!keep.cachets && absorb.cachets) keep.cachets = absorb.cachets;
  if (!keep.poste  && absorb.poste)  keep.poste  = absorb.poste;
  if (!keep.ref    && absorb.ref)    keep.ref    = absorb.ref;
  keep.hasBulletin = keep.hasBulletin || absorb.hasBulletin;
  keep.hasAEM      = keep.hasAEM      || absorb.hasAEM;
  keep.hasCS       = keep.hasCS       || absorb.hasCS;
  // Réaffecte les frais de l'absorbé
  state.frais.forEach(f => { if (f.contratId === absorbId) f.contratId = keepId; });
  // Supprime l'absorbé
  state.contrats = state.contrats.filter(x => x.id !== absorbId);

  saveState();
  toast('✅ Contrats fusionnés');
  renderDetailBody(keep);
  renderContrats();
  renderBilan();
}

function editContrat(id) {
  const c = state.contrats.find(x => x.id === id);
  if (!c) return;
  document.getElementById('c-emp').value    = c.employeur || '';
  document.getElementById('c-poste').value  = c.poste || '';
  document.getElementById('c-debut').value  = c.dateDebut || '';
  document.getElementById('c-fin').value    = c.dateFin || '';
  document.getElementById('c-cachets').value = c.cachets || '';
  document.getElementById('c-heures').value = c.heures || '';
  document.getElementById('c-brut').value   = c.brutV || '';
  document.getElementById('c-net-imp').value = c.netImp || '';
  document.getElementById('c-net').value    = c.netV || '';
  document.getElementById('c-pas').value    = c.pasV || '';
  document.getElementById('c-ref').value    = c.ref || '';
  document.getElementById('c-comment').value = c.comment || '';
  document.getElementById('sheet-add-contrat').dataset.editId = id;
  document.getElementById('sheet-contrat-title').textContent = 'Modifier le contrat';
  document.getElementById('btn-save-contrat').textContent = '✓ Mettre à jour';
  closeDetail();
  openSheet('sheet-add-contrat');
}

// ============================================================
// CONTRATS
// ============================================================
function addContrat() {
  const emp   = document.getElementById('c-emp').value.trim();
  const debut = document.getElementById('c-debut').value;
  if (!emp || !debut) { toast('❌ Employeur et date début requis'); return; }

  const sheet  = document.getElementById('sheet-add-contrat');
  const editId = sheet.dataset.editId;

  const data = {
    employeur: emp,
    poste:    document.getElementById('c-poste').value.trim(),
    dateDebut: debut,
    dateFin:  document.getElementById('c-fin').value || debut,
    cachets:  parseInt(document.getElementById('c-cachets').value) || 0,
    heures:   parseFloat(document.getElementById('c-heures').value) || 0,
    brutV:    parseFloat(document.getElementById('c-brut').value) || 0,
    netImp:   parseFloat(document.getElementById('c-net-imp').value) || 0,
    netV:     parseFloat(document.getElementById('c-net').value) || 0,
    pasV:     parseFloat(document.getElementById('c-pas').value) || 0,
    ref:      document.getElementById('c-ref').value.trim(),
    comment:  document.getElementById('c-comment').value.trim(),
    docs: []
  };

  if (editId) {
    const idx = state.contrats.findIndex(x => x.id === editId);
    if (idx >= 0) state.contrats[idx] = { ...state.contrats[idx], ...data };
    delete sheet.dataset.editId;
    document.getElementById('sheet-contrat-title').textContent = 'Nouveau contrat';
    document.getElementById('btn-save-contrat').textContent = '✓ Enregistrer';
    toast('✅ Contrat mis à jour');
  } else {
    data.id = Date.now().toString();
    data.paye = null;
    state.contrats.push(data);
    toast('✅ Contrat enregistré');
  }

  saveState();
  closeSheet();
  renderContrats();
  renderBilan();
  ['c-emp','c-poste','c-debut','c-fin','c-cachets','c-heures','c-brut','c-net-imp','c-net','c-pas','c-ref','c-comment']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function renderContrats() {
  const el = document.getElementById('contrats-list');
  if (!state.contrats.length) {
    el.innerHTML = '<div class="empty" style="padding:48px 20px;"><div class="empty-icon">📁</div><div class="empty-text">Aucun contrat enregistré<br>Scanne ou ajoute manuellement</div></div>';
    return;
  }

  const grouped = {};
  state.contrats.forEach(c => {
    const d = new Date(c.dateDebut);
    const y = d.getFullYear();
    const m = d.getMonth();
    if (!grouped[y]) grouped[y] = {};
    if (!grouped[y][m]) grouped[y][m] = [];
    grouped[y][m].push(c);
  });

  let html = '';
  Object.keys(grouped).sort((a, b) => b - a).forEach(y => {
    html += `<div class="year-group"><div class="year-header">${y}</div>`;
    Object.keys(grouped[y]).sort((a, b) => b - a).forEach(m => {
      const contrats = grouped[y][m].sort((a, b) => b.dateDebut.localeCompare(a.dateDebut));
      const totalBrut = contrats.reduce((s, c) => s + (c.brutV || 0), 0);
      const totalH    = contrats.reduce((s, c) => s + (c.heures || 0), 0);
      html += `<div class="month-group">
        <div class="month-header">
          <div class="month-header-name">${MONTHS[m]}</div>
          <div class="month-header-total">${totalH}h · ${fmt(totalBrut)}</div>
        </div>
        <div class="month-contracts">`;
      contrats.forEach(c => {
        const sc = c.paye === true ? 'paye' : c.paye === false ? 'en-attente' : 'inconnu';
        const st = c.paye === true
          ? '<span class="tag tag-green">✓ Payé</span>'
          : c.paye === false
            ? '<span class="tag tag-red">⏳ En attente</span>'
            : '<span class="tag tag-gray">— Paiement ?</span>';
        html += `<div class="contrat-card ${sc}" onclick="openDetail('${c.id}')">
          <div class="contrat-header">
            <div><div class="contrat-employeur">${c.employeur||'Employeur inconnu'}</div>${c.poste?`<div class="contrat-poste">${c.poste}</div>`:''}</div>
            ${st}
          </div>
          <div class="contrat-dates">${fmtDate(c.dateDebut)}${c.dateFin&&c.dateFin!==c.dateDebut?' → '+fmtDate(c.dateFin):''}</div>
          <div class="contrat-stats">
            <div class="contrat-stat"><strong>${c.cachets||0}</strong> cachet${(c.cachets||0)>1?'s':''}</div>
            <div class="contrat-stat"><strong>${c.heures||0}h</strong></div>
            <div class="contrat-stat"><strong style="color:var(--gold)">${fmt(c.brutV)}</strong> brut</div>
            <div class="contrat-stat"><strong style="color:var(--green)">${fmt(c.netV)}</strong> net</div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <span style="font-size:9px;" class="tag ${c.hasContrat?'tag-green':'tag-gray'}">📝</span>
            <span style="font-size:9px;" class="tag ${c.hasBulletin?'tag-green':'tag-gray'}">📄</span>
            <span style="font-size:9px;" class="tag ${c.hasAEM?'tag-green':'tag-gray'}">📋</span>
            <span style="font-size:9px;" class="tag ${c.hasCS?'tag-green':'tag-gray'}">🌴</span>
          </div>
        </div>`;
      });
      html += `</div></div>`;
    });
    html += `</div>`;
  });

  el.innerHTML = html;
}

// ============================================================
// FRANCE TRAVAIL
// ============================================================
function renderFTPage() {
  const sel = document.getElementById('ft-mois-select');
  const now = new Date();
  const opts = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    opts.push(`<option value="${val}">${MONTHS[d.getMonth()]} ${d.getFullYear()}</option>`);
  }
  sel.innerHTML = opts.join('');
  renderFT();
}

function renderFT() {
  const val = document.getElementById('ft-mois-select').value;
  if (!val) return;
  const [y, m] = val.split('-').map(Number);

  const contrats  = state.contrats.filter(c => { const d = new Date(c.dateDebut); return d.getFullYear()===y && d.getMonth()===m-1; });
  const totalH    = contrats.reduce((s, c) => s + (c.heures||0), 0);
  const totalBrut = contrats.reduce((s, c) => s + (c.brutV||0), 0);
  const totalC    = contrats.reduce((s, c) => s + (c.cachets||0), 0);
  const totalJ    = contrats.reduce((s, c) => {
    if (!c.dateDebut || !c.dateFin) return s;
    return s + Math.ceil((new Date(c.dateFin) - new Date(c.dateDebut)) / 86400000) + 1;
  }, 0);

  const moisDecl = new Date(y, m, 1);
  const el = document.getElementById('ft-content');

  if (!contrats.length) {
    el.innerHTML = `<div class="card"><div class="empty" style="padding:24px;"><div class="empty-icon">📋</div><div class="empty-text">Aucun contrat en ${MONTHS[m-1]} ${y}</div></div></div>`;
    return;
  }

  el.innerHTML = `
    <div class="card" style="background:var(--blue-light);border-color:rgba(26,74,122,.2);">
      <div class="card-head"><div class="card-head-title" style="color:var(--blue);">À déclarer en ${MONTHS[moisDecl.getMonth()]} ${moisDecl.getFullYear()}</div></div>
      <div class="ft-row"><span class="ft-label">Heures travaillées</span><span class="ft-value">${totalH} h</span></div>
      <div class="ft-row"><span class="ft-label">Salaire brut</span><span class="ft-value" style="color:var(--gold);">${fmt(totalBrut)}</span></div>
      <div class="ft-row"><span class="ft-label">Cachets</span><span class="ft-value">${totalC}</span></div>
      <div class="ft-row"><span class="ft-label">Jours travaillés</span><span class="ft-value">${totalJ}</span></div>
      <div class="ft-row"><span class="ft-label">Employeurs</span><span class="ft-value">${[...new Set(contrats.map(c=>c.employeur))].length}</span></div>
    </div>
    <div class="card">
      <div class="card-head"><div class="card-head-title">Détail par contrat</div></div>
      ${contrats.map(c => {
        const nj = c.dateDebut&&c.dateFin ? Math.ceil((new Date(c.dateFin)-new Date(c.dateDebut))/86400000)+1 : 0;
        return `<div style="padding:12px 0;border-bottom:1px solid var(--border2);">
          <div style="font-size:14px;font-weight:700;margin-bottom:6px;">${c.employeur}</div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;">
            <div class="contrat-stat"><strong>${c.heures||0}h</strong></div>
            <div class="contrat-stat"><strong>${fmt(c.brutV)}</strong> brut</div>
            <div class="contrat-stat"><strong>${c.cachets||0}</strong> cachet${(c.cachets||0)>1?'s':''}</div>
            <div class="contrat-stat"><strong>${nj}j</strong></div>
          </div>
          <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);margin-top:4px;">${fmtDate(c.dateDebut)}${c.dateFin&&c.dateFin!==c.dateDebut?' → '+fmtDate(c.dateFin):''}</div>
        </div>`;
      }).join('')}
    </div>
    <button class="btn btn-ghost" style="width:100%;margin-bottom:10px;" onclick="copyFTRecap(${y},${m})">📋 Copier le récapitulatif</button>
  `;
}

function copyFTRecap(y, m) {
  const contrats = state.contrats.filter(c => { const d=new Date(c.dateDebut); return d.getFullYear()===y&&d.getMonth()===m-1; });
  let text = `DÉCLARATION FRANCE TRAVAIL — ${MONTHS[m-1]} ${y}\n${'─'.repeat(40)}\n`;
  text += `Heures : ${contrats.reduce((s,c)=>s+(c.heures||0),0)} h\n`;
  text += `Brut : ${fmt(contrats.reduce((s,c)=>s+(c.brutV||0),0))}\n`;
  text += `Cachets : ${contrats.reduce((s,c)=>s+(c.cachets||0),0)}\n\nDÉTAIL :\n`;
  contrats.forEach(c => { text += `\n• ${c.employeur}\n  ${c.heures||0}h — ${fmt(c.brutV)} brut — ${c.cachets||0} cachet(s)\n`; });
  navigator.clipboard.writeText(text).then(() => toast('📋 Copié !')).catch(() => toast('❌ Impossible de copier'));
}

// ============================================================
// SCAN
// ============================================================
function setDocType(el, type) {
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  currentDocType = type;
  document.getElementById('scan-contrat-link-card').style.display = (type==='bulletin'||type==='aem') ? 'block' : 'none';
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('active');
  if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
}

function handleFile(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  if (files.length === 1) { processFile(files[0]); return; }
  processFileQueue(files);
}

let fileQueue = [];
let fileQueueIndex = 0;

async function processFileQueue(files) {
  fileQueue = Array.from(files);
  fileQueueIndex = 0;
  toast(`📂 ${fileQueue.length} documents à traiter — confirme chaque extraction`);
  await processFile(fileQueue[fileQueueIndex]);
}

function nextInQueue() {
  fileQueueIndex++;
  if (fileQueueIndex < fileQueue.length) {
    toast(`📄 Document ${fileQueueIndex+1}/${fileQueue.length} : ${fileQueue[fileQueueIndex].name}`);
    setTimeout(() => processFile(fileQueue[fileQueueIndex]), 300);
  } else {
    fileQueue = [];
    fileQueueIndex = 0;
    toast(`✅ Tous les documents traités`);
  }
}

function fileToBase64(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

async function processFile(file) {
  if (!getAppsScriptUrl()) { showPage('settings'); toast('⚙️ Configure Apps Script'); return; }
  if (!isSessionValid()) { showLogin(); return; }

  document.querySelectorAll('.pill').forEach(p => { p.style.pointerEvents='none'; p.style.opacity='0.5'; });
  const linkCard = document.getElementById('scan-contrat-link-card');
  if (linkCard) linkCard.style.opacity = '0.5';

  document.getElementById('scan-loading').style.display = 'block';
  document.getElementById('scan-result-card').style.display = 'none';

  const base64 = await fileToBase64(file);
  try {
    const res = await appsScriptPost({ action: 'scanDoc', docType: currentDocType, base64Data: base64, mediaType: file.type });
    document.getElementById('scan-loading').style.display = 'none';
    if (res.ok) { pendingScanData = res.data; showScanResult(res.data); }
    else {
      document.getElementById('scan-result-card').style.display = 'block';
      document.getElementById('scan-result-card').innerHTML = '<div class="alert alert-err">❌ ' + (res.error||'Erreur scan') + '</div>';
    }
  } catch(e) {
    document.getElementById('scan-loading').style.display = 'none';
    document.getElementById('scan-result-card').style.display = 'block';
    document.getElementById('scan-result-card').innerHTML = '<div class="alert alert-err">❌ ' + e.message + '</div>';
  }
  document.querySelectorAll('.pill').forEach(p => { p.style.pointerEvents=''; p.style.opacity=''; });
  const lc = document.getElementById('scan-contrat-link-card');
  if (lc) lc.style.opacity = '';
  document.getElementById('file-input').value = '';
}
   
function switchDocType(type) {
  currentDocType = type;
  document.querySelectorAll('.pill').forEach(p => {
    const t = p.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
    p.classList.toggle('active', t === type);
  });
  if (pendingScanData) showScanResult(pendingScanData);
}
   
function cancelScan() {
  pendingScanData = null;
  document.getElementById('scan-result-card').style.display = 'none';
  document.querySelectorAll('.pill').forEach(p => { p.style.pointerEvents=''; p.style.opacity=''; });
  const lc = document.getElementById('scan-contrat-link-card');
  if (lc) lc.style.opacity = '';
}   

function showScanResult(d) {
  const card = document.getElementById('scan-result-card');
  card.style.display = 'block';

  // Détecte si le type reconnu diffère du type sélectionné
  let typeWarning = '';
  const typeLabels = {contrat:'Contrat', bulletin:'Bulletin', aem:'AEM', conges:'Congés Spectacle', frais:'Frais'};
  if (d.type && d.type !== currentDocType) {
    const detectedType = typeLabels[d.type] || d.type;
    const selectedType = typeLabels[currentDocType];
    typeWarning = '<div class="alert alert-warn" style="margin-bottom:12px;">'
      + '⚠️ L\'IA a reconnu ce document comme <strong>' + detectedType + '</strong> '
      + 'alors que tu as sélectionné <strong>' + selectedType + '</strong>.<br>'
      + '<div style="display:flex;gap:8px;margin-top:8px;">'
      + '<button class="btn btn-ghost btn-sm" onclick="switchDocType(\'' + d.type + '\')">Utiliser ' + detectedType + '</button>'
      + '<button class="btn btn-ghost btn-sm" onclick="this.closest(\'.alert-warn\').remove()">Garder ' + selectedType + '</button>'
      + '</div></div>';
  }

  // Détecte une correspondance potentielle avant d'afficher
  let matchInfo = '';
  if (d.type === 'bulletin' || d.type === 'aem' || d.type === 'conges' || d.type === 'contrat') {
    const mi = MONTHS.indexOf(d.mois);
    const an = d.annee || new Date().getFullYear();
    const dateStr = d.date_travail || d.date_debut || (mi >= 0 ? `${an}-${String(mi+1).padStart(2,'0')}-01` : new Date().toISOString().slice(0,10));
    const match = findMatchingContrat(d.employeur, dateStr);
    if (match) {
      matchInfo = '<div class="alert alert-ok" style="margin-bottom:12px;">'
        + '🔗 Correspondance trouvée : <strong>' + match.employeur + '</strong> (' + fmtDate(match.dateDebut) + ')<br>'
        + '<small>Confirmes-tu le rattachement à ce contrat ?</small>'
        + '<div style="display:flex;gap:8px;margin-top:8px;">'
        + '<button class="btn btn-primary btn-sm" onclick="confirmRattachement(\'' + match.id + '\')">✓ Oui, rattacher</button>'
        + '<button class="btn btn-ghost btn-sm" onclick="refuserRattachement()">Non, créer nouveau</button>'
        + '</div></div>';
      // Masque le bouton Enregistrer jusqu'à confirmation
      document.getElementById('btn-confirm-scan').style.display = 'none';
      const sel = document.getElementById('scan-contrat-select');
      if (sel) sel.value = match.id;
    }
  }
  const typeLabelsDisplay = {contrat:'📝 Contrat', bulletin:'📄 Bulletin de salaire', aem:'📋 AEM', conges:'🌴 Congés Spectacle', frais:'🧾 Frais'};
  const numF = ['salaire_brut','net_imposable','net_percu','pas_preleve','montant_ttc','montant_ht','cachet_brut'];
  const rows = '<div style="padding:8px 0;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;">'
    + '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;">Type détecté</span>'
    + '<span style="font-size:13px;font-weight:700;">' + (typeLabelsDisplay[d.type] || d.type || '—') + '</span>'
    + '</div>'
    + Object.entries(d)
    .filter(([k,v]) => k!=='type' && v!==null && v!=='' && v!==0)
    .map(([k,v]) => `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border2);">
        <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;">${k.replace(/_/g,' ')}</span>
        <span style="font-size:13px;font-weight:600;">${numF.some(n=>k.includes(n.split('_')[0]))||k.includes('brut')||k.includes('net')||k.includes('montant')?fmt(v):v}</span>
      </div>`).join('');
  card.innerHTML = `
    <div class="card">
      <div class="card-head"><div class="card-head-title">Extraction IA</div><span class="tag tag-green">✓ OK</span></div>
      ${matchInfo}
      ${rows}
      <button class="btn btn-primary" id="btn-confirm-scan" onclick="confirmScanInline()" style="margin-top:16px;">✓ Enregistrer</button>
      <button class="btn btn-ghost" style="margin-top:8px;width:100%;" onclick="cancelScan()">Annuler</button>
    </div>`;
}

// Trouve un contrat existant correspondant (même employeur + même période)
function findMatchingContrat(employeur, dateStr) {
  if (!employeur || !dateStr) return null;
  const empNorm = employeur.toUpperCase().replace(/\s+/g, '').trim();
  const [y, m] = dateStr.split('-').map(Number);
  return state.contrats.find(c => {
    if (!c.dateDebut) return false;
    const cd = new Date(c.dateDebut);
    const sameMonth = cd.getFullYear() === y && cd.getMonth() === m - 1;
    const cNorm = c.employeur.toUpperCase().replace(/\s+/g, '').trim();
    // Comparaison insensible à la casse et aux espaces, sur 6 caractères minimum
    const empMatch = cNorm.includes(empNorm.slice(0,6)) ||
                     empNorm.includes(cNorm.slice(0,6));
    return sameMonth && empMatch;
  });
}

function confirmRattachement(id) {
  const sel = document.getElementById('scan-contrat-select');
  if (sel) sel.value = id;
  document.getElementById('btn-confirm-scan').style.display = 'block';
  // Retire la bannière de confirmation
  document.querySelector('.alert-ok')?.remove();
}

function refuserRattachement() {
  const sel = document.getElementById('scan-contrat-select');
  if (sel) sel.value = '';
  document.getElementById('btn-confirm-scan').style.display = 'block';
  document.querySelector('.alert-ok')?.remove();
}

function confirmScanInline() {
  if (!pendingScanData) return;
  const d = pendingScanData;
  const linkedId = document.getElementById('scan-contrat-select')?.value || '';

  if (d.type === 'contrat' || currentDocType === 'contrat') {
    const match = linkedId
      ? state.contrats.find(x => x.id === linkedId)
      : findMatchingContrat(d.employeur, d.date_debut);
    if (match) {
      // Complète le contrat existant avec les infos du contrat signé
      if (!match.poste && (d.poste||d.nature_contrat)) match.poste = d.poste||d.nature_contrat;
      if (!match.dateDebut && d.date_debut) match.dateDebut = d.date_debut;
      if (!match.dateFin && d.date_fin) match.dateFin = d.date_fin;
      if (!match.heures && d.h_prevues) match.heures = d.h_prevues;
      if (!match.brutV && d.cachet_brut_total) match.brutV = d.cachet_brut_total;
      match.hasContrat = true;
      toast('✅ Contrat rattaché à : ' + match.employeur);
    } else {
      state.contrats.push({
        id: Date.now().toString(),
        employeur: (d.employeur||'').toUpperCase().trim(), poste: d.poste||d.nature_contrat||'',
        dateDebut: d.date_debut||new Date().toISOString().slice(0,10),
        dateFin: d.date_fin||d.date_debut||new Date().toISOString().slice(0,10),
        cachets: d.cachets||0, heures: d.h_prevues||0,
        brutV: d.cachet_brut_total||0, netImp:0, netV:0, pasV:0,
        paye: null, ref:'', comment:'', docs:[],
        hasContrat: true, hasBulletin: false, hasAEM: false, hasCS: false
      });
      toast('✅ Contrat enregistré');
    }

  } else if (d.type === 'bulletin' || currentDocType === 'bulletin') {
    const mi = MONTHS.indexOf(d.mois);
    const an = d.annee || new Date().getFullYear();
    // Utilise la date exacte de travail si disponible, sinon le 1er du mois
    const dateStr = d.date_travail || (mi >= 0 ? `${an}-${String(mi+1).padStart(2,'0')}-01` : new Date().toISOString().slice(0,10));
    const match = linkedId ? state.contrats.find(x => x.id === linkedId) : findMatchingContrat(d.employeur, dateStr);

    if (match) {
      if (!match.brutV) match.brutV = d.salaire_brut||0;
      if (!match.netImp) match.netImp = d.net_imposable||0;
      if (!match.netV) match.netV = d.net_percu||0;
      if (!match.pasV) match.pasV = d.pas_preleve||0;
      if (!match.heures) match.heures = d.h_totales||0;
      if (!match.cachets) match.cachets = d.cachets||0;
      match.hasBulletin = true;
      toast('✅ Bulletin rattaché à : ' + match.employeur);
    } else {
      state.contrats.push({
        id: Date.now().toString(), employeur: (d.employeur||'').toUpperCase().trim(), poste:'',
        dateDebut: dateStr, dateFin: dateStr,
        cachets: d.cachets||0, heures: d.h_totales||0,
        brutV: d.salaire_brut||0, netImp: d.net_imposable||0,
        netV: d.net_percu||0, pasV: d.pas_preleve||0,
        paye: null, ref:'', comment:'', docs:[],
        hasBulletin: true, hasAEM: false, hasCS: false
      });
      toast('✅ Bulletin → nouveau contrat');
    }

  } else if (d.type === 'aem' || currentDocType === 'aem') {
    const mi = MONTHS.indexOf(d.mois);
    const an = d.annee || new Date().getFullYear();
    const dateStr = d.date_debut || (mi >= 0 ? `${an}-${String(mi+1).padStart(2,'0')}-01` : new Date().toISOString().slice(0,10));
    const match = linkedId ? state.contrats.find(x => x.id === linkedId) : findMatchingContrat(d.employeur, dateStr);

    if (match) {
      if (!match.heures) match.heures = d.nb_heures||0;
      if (!match.cachets) match.cachets = d.nb_cachets||0;
      if (!match.brutV) match.brutV = d.salaire_brut||0;
      match.hasAEM = true;
      toast('✅ AEM rattachée à : ' + match.employeur);
    } else {
      state.contrats.push({
        id: Date.now().toString(), employeur: (d.employeur||'').toUpperCase().trim(), poste:'AEM',
        dateDebut: dateStr, dateFin: dateStr,
        cachets: d.nb_cachets||0, heures: d.nb_heures||0,
        brutV: d.salaire_brut||0, netImp:0, netV:0, pasV:0,
        paye: null, ref:'AEM', comment:'', docs:[],
        hasBulletin: false, hasAEM: true, hasCS: false
      });
      toast('✅ AEM → nouveau contrat');
    }

} else if (d.type === 'conges' || currentDocType === 'conges') {
    // Cherche un contrat correspondant (même employeur + mêmes dates)
    const csDate = d.date_debut || new Date().toISOString().slice(0,10);
    const match = linkedId
      ? state.contrats.find(x => x.id === linkedId)
      : findMatchingContrat(d.employeur, csDate);

    if (match) {
      match.hasCS = true;
      if (!match.brutV && d.salaire_brut) match.brutV = d.salaire_brut;
      toast('✅ Congés Spectacle rattachés à : ' + match.employeur);
    } else {
      // Crée un nouveau contrat
      state.contrats.push({
        id: Date.now().toString(),
        employeur: (d.employeur||'').toUpperCase().trim(),
        poste: d.emploi||'',
        dateDebut: d.date_debut||csDate,
        dateFin: d.date_fin||csDate,
        cachets: d.nb_jours_cachets||0,
        heures: 0,
        brutV: d.salaire_brut||0,
        netImp: 0, netV: 0, pasV: 0,
        paye: null, ref:'', comment:'',
        docs: [],
        hasBulletin: false, hasAEM: false, hasCS: true
      });
      toast('✅ Congés Spectacle → nouveau contrat');
    }

  } else if (d.type === 'frais' || currentDocType === 'frais') {
    state.frais.push({
      id: Date.now().toString(), cat: d.categorie||'autre',
      desc: d.description||d.nature||'',
      date: d.date||new Date().toISOString().slice(0,10),
      montant: d.montant_ttc||0, km:0, repas:0, ref:'', contratId: linkedId||''
    });
    toast('✅ Frais enregistré');
  }

  saveState();
  pendingScanData = null;
  document.getElementById('scan-result-card').style.display = 'none';
  renderBilan();
  // Passe au document suivant si queue active
  if (fileQueue.length > 0) nextInQueue();
}

// ============================================================
// FRAIS
// ============================================================
function addFrais() {
  const date = document.getElementById('f-date').value;
  const montant = parseFloat(document.getElementById('f-montant').value) || 0;
  if (!date || !montant) { toast('❌ Date et montant requis'); return; }
  state.frais.push({
    id: Date.now().toString(),
    cat: document.getElementById('f-cat').value,
    desc: document.getElementById('f-desc').value.trim(),
    date, montant,
    km: parseFloat(document.getElementById('f-km').value) || 0,
    repas: parseFloat(document.getElementById('f-repas').value) || 0,
    ref: document.getElementById('f-ref').value.trim(),
    contratId: document.getElementById('f-contrat-link').value || ''
  });
  saveState();
  closeSheet();
  toast('✅ Frais enregistré');
  renderFrais();
  renderBilan();
  ['f-desc','f-montant','f-km','f-repas','f-ref'].forEach(id => document.getElementById(id).value = '');
}

function deleteFrais(id) {
  if (!confirm('Supprimer ?')) return;
  state.frais = state.frais.filter(f => f.id !== id);
  saveState(); renderFrais(); renderBilan();
  toast('🗑️ Supprimé');
}

// ============================================================
// FORMAT
// ============================================================
function fmt(n) {
  if (!n && n !== 0) return '—';
  if (n === 0) return '0 €';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(n);
}

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ============================================================
// RENDER BILAN
// ============================================================
function renderBilan() {
  const selectedYear = parseInt(document.getElementById('bilan-year-select')?.value) || new Date().getFullYear();
  const cs = state.contrats.filter(c => c.dateDebut && new Date(c.dateDebut).getFullYear() === selectedYear);
  const tBrut   = cs.reduce((s,c) => s+(c.brutV||0), 0);
  const tNet    = cs.reduce((s,c) => s+(c.netV||0), 0);
  const tNetImp = cs.reduce((s,c) => s+(c.netImp||0), 0);
  const tPas    = cs.reduce((s,c) => s+(c.pasV||0), 0);
  const tH      = cs.reduce((s,c) => s+(c.heures||0), 0);
  const tC      = cs.reduce((s,c) => s+(c.cachets||0), 0);
  const tF      = state.frais.reduce((s,f) => s+(f.montant||0), 0);

  const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };

  set('b-brut', fmt(tBrut));
  set('b-net', fmt(tNet));
  set('b-cachets', tC + ' cachets');
  set('b-heures', tH + ' h');
  set('b-pas', fmt(tPas));
  set('b-frais', fmt(tF));

  const ie = calcImpots(tNetImp, tF, state.config.situation);
  set('b-taux-pas', state.config.tauxPas + '% PAS');
  set('b-impots-estim', fmt(ie));
  set('b-impots-payes', fmt(tPas));
  set('b-impots-reste', fmt(Math.max(0, ie - tPas)));

  const sjr = state.config.sjr || 0;
  const areJ = sjr > 0 ? Math.min(sjr*0.6+12.47, sjr*0.75) : 0;
  set('q-are-jour', sjr > 0 ? fmt(areJ) : '— €');
  set('q-are-mois', sjr > 0 ? fmt(areJ*30) : '— €');
  set('q-heures-prog', tH + ' / 507 h');

  const pct = Math.min(100, (tH/507)*100);
  const fill = document.getElementById('q-heures-fill');
  if (fill) fill.style.width = pct + '%';

  const tag = document.getElementById('are-status-tag');
  if (tag) { tag.textContent = tH>=507 ? '✓ 507h atteintes' : Math.round(pct)+'%'; tag.className = tH>=507 ? 'tag tag-green' : 'tag tag-gold'; }

  set('foyer-simon', fmt(tNet));
  set('foyer-mathilde', state.config.mathilde ? fmt(state.config.mathilde) : '—');
  set('foyer-reste', fmt(tNet + (state.config.mathilde||0) + (state.config.areReel||0)*12));
}

function calcImpots(n, f, p) {
  if (!n) return 0;
  const a = Math.min(n*0.1, 14171);
  const r = n - Math.max(a, f);
  const rp = r / p;
  let i = 0;
  if (rp <= 11294) i = 0;
  else if (rp <= 28797) i = (rp-11294)*0.11;
  else if (rp <= 82341) i = 17503*0.11+(rp-28797)*0.30;
  else if (rp <= 177106) i = 17503*0.11+53544*0.30+(rp-82341)*0.41;
  else i = 17503*0.11+53544*0.30+94765*0.41+(rp-177106)*0.45;
  return i * p;
}

// ============================================================
// RENDER FRAIS
// ============================================================
function renderFrais() {
  const tF = state.frais.reduce((s,f) => s+(f.montant||0), 0);
  const tNI = state.contrats.reduce((s,c) => s+(c.netImp||0), 0);
  const forfait = Math.min(tNI*0.1, 14171);

  const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  set('f-total', fmt(tF));

  if (tNI > 0) {
    const diff = tF - forfait;
    const el = document.getElementById('f-compare');
    if (el) { el.textContent = diff>0 ? '+'+fmt(diff) : fmt(diff); el.className = diff>0 ? 'val green' : 'val red'; }
    set('f-compare-sub', diff>0 ? `Frais réels avantageux (forfait=${fmt(forfait)})` : `Forfait 10% plus avantageux (${fmt(forfait)})`);
  }

  const bycat = {};
  state.frais.forEach(f => { if(!bycat[f.cat]) bycat[f.cat]=0; bycat[f.cat]+=(f.montant||0); });
  const catEl = document.getElementById('frais-by-cat');
  if (catEl) {
    catEl.innerHTML = !Object.keys(bycat).length
      ? '<div class="empty"><div class="empty-icon">🧾</div><div class="empty-text">Aucun frais</div></div>'
      : Object.entries(bycat).sort((a,b)=>b[1]-a[1]).map(([cat,total]) =>
          `<div class="frais-cat-row"><div class="frais-cat-icon">${CAT_ICONS[cat]||'📦'}</div><div class="frais-cat-name">${CAT_LABELS[cat]||cat}</div><div class="frais-cat-amt">${fmt(total)}</div></div>`
        ).join('');
  }

  const moisDispo = [...new Set(state.frais.map(f=>f.date?.slice(0,7)).filter(Boolean))].sort();
  const tabsEl = document.getElementById('frais-month-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = `<div class="month-tab ${selectedMonthFrais==='all'?'active':''}" onclick="filterFrais('all')">Tout</div>` +
      moisDispo.map(m => { const[y,mo]=m.split('-'); return `<div class="month-tab ${selectedMonthFrais===m?'active':''}" onclick="filterFrais('${m}')">${MONTHS[parseInt(mo)-1]?.slice(0,3)||''} ${y}</div>`; }).join('');
  }

  const ff = selectedMonthFrais==='all' ? state.frais : state.frais.filter(f=>f.date?.startsWith(selectedMonthFrais));
  const listEl = document.getElementById('frais-list');
  if (listEl) {
    listEl.innerHTML = !ff.length
      ? '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Aucun frais</div></div>'
      : ff.sort((a,b)=>b.date.localeCompare(a.date)).map(f =>
          `<div class="list-item">
            <div class="list-icon" style="background:var(--blue-light);">${CAT_ICONS[f.cat]||'📦'}</div>
            <div class="list-main">
              <div class="list-title">${f.desc||CAT_LABELS[f.cat]||f.cat}</div>
              <div class="list-sub">${fmtDate(f.date)}${f.ref?' · '+f.ref:''}</div>
            </div>
            <div class="list-right">
              <div class="list-amount">${fmt(f.montant)}</div>
              <button onclick="deleteFrais('${f.id}')" style="margin-top:6px;font-size:11px;color:var(--muted);background:none;border:none;cursor:pointer;">🗑️</button>
            </div>
          </div>`
        ).join('');
  }
}

function filterFrais(m) { selectedMonthFrais = m; renderFrais(); }

// ============================================================
// CONFIG & SETTINGS
// ============================================================
function loadConfig() {
  const set = (id, v) => { const el=document.getElementById(id); if(el&&v!==undefined&&v!==null) el.value=v; };
  set('cfg-taux-pas', state.config.tauxPas);
  set('cfg-situation', state.config.situation);
  set('cfg-mathilde', state.config.mathilde||'');
  set('cfg-sjr', state.config.sjr||'');
  set('cfg-are-reel', state.config.areReel||'');
  set('cfg-fin-droits', state.config.finDroits||'');
  const url = localStorage.getItem('apps-script-url');
  if (url) { const el=document.getElementById('apps-script-url'); if(el) el.value=url; }
}

function saveConfig() {
  state.config.tauxPas   = parseFloat(document.getElementById('cfg-taux-pas').value) || 14.6;
  state.config.situation = parseFloat(document.getElementById('cfg-situation').value) || 2;
  state.config.mathilde  = parseFloat(document.getElementById('cfg-mathilde').value) || 0;
  state.config.sjr       = parseFloat(document.getElementById('cfg-sjr').value) || 0;
  state.config.areReel   = parseFloat(document.getElementById('cfg-are-reel').value) || 0;
  state.config.finDroits = document.getElementById('cfg-fin-droits').value || '';
  saveState();
}

function saveAppsScriptUrl() {
  const url = document.getElementById('apps-script-url').value.trim();
  if (!url.includes('script.google.com')) { toast('❌ URL invalide'); return; }
  localStorage.setItem('apps-script-url', url);
  toast('✅ URL sauvegardée');
}

async function testAppsScript() {
  const btn = document.getElementById('test-as-btn');
  btn.innerHTML = '<div class="loader" style="width:14px;height:14px;"></div>';
  try {
    const res = await appsScriptGet({ action: 'ping' });
    btn.textContent = 'Tester';
    const el = document.getElementById('as-test-result');
    if (res.ok) el.innerHTML = `<div class="alert alert-ok">✅ Connexion OK ! v${res.version}</div>`;
    else el.innerHTML = `<div class="alert alert-err">❌ ${res.error||'Erreur'}</div>`;
  } catch(e) {
    btn.textContent = 'Tester';
    document.getElementById('as-test-result').innerHTML = `<div class="alert alert-err">❌ ${e.message}</div>`;
  }
}

// ============================================================
// DONNÉES
// ============================================================
function exportData() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'intermittent-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  toast('📤 Export téléchargé');
}

function importData(e) {
  const f = e.target.files[0]; if (!f) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      state.contrats = d.contrats || [];
      state.frais    = d.frais || [];
      if (d.config) state.config = { ...state.config, ...d.config };
      saveState(); renderAll(); loadConfig();
      toast('✅ Import réussi');
    } catch(err) { toast('❌ Fichier invalide'); }
  };
  reader.readAsText(f);
}

function clearAll() {
  if (!confirm('Effacer toutes les données ? Irréversible.')) return;
  state.contrats = []; state.frais = [];
  saveState(); renderAll();
  toast('🗑️ Données effacées');
}

function migrateData() {
  let changed = false;
  state.contrats.forEach(c => {
    // Normalise l'employeur en majuscules
    if (c.employeur && c.employeur !== c.employeur.toUpperCase()) {
      c.employeur = c.employeur.toUpperCase().trim();
      changed = true;
    }
    // Ajoute les champs manquants pour les anciens contrats
    if (c.hasContrat === undefined) { c.hasContrat = false; changed = true; }
    if (c.hasBulletin === undefined) { c.hasBulletin = false; changed = true; }
    if (c.hasAEM === undefined) { c.hasAEM = false; changed = true; }
    if (c.hasCS === undefined) { c.hasCS = false; changed = true; }
    if (c.paye === undefined) { c.paye = false; changed = true; }
  });
  if (changed) saveState();
}

function renderAll() {
  populateYearSelect();
  renderBilan(); renderContrats(); renderFrais();
}

function populateYearSelect() {
  const sel = document.getElementById('bilan-year-select');
  if (!sel) return;
  const years = [...new Set(state.contrats.map(c => c.dateDebut ? new Date(c.dateDebut).getFullYear() : null).filter(Boolean))];
  const currentYear = new Date().getFullYear();
  if (!years.includes(currentYear)) years.push(currentYear);
  years.sort((a,b) => b - a);
  const current = sel.value || currentYear;
  sel.innerHTML = years.map(y => `<option value="${y}" ${y==current?'selected':''}>${y}</option>`).join('');
}

// ============================================================
// RESPONSIVE DETECTION
// ============================================================
function checkLayout() {
  isDesktop = window.innerWidth >= 768;
  document.body.classList.toggle('is-desktop', isDesktop);
}

// ============================================================
// INIT
// ============================================================
function init() {
  checkLayout();
  window.addEventListener('resize', checkLayout);

  // Charge le state local
  try {
    const d = localStorage.getItem('intermittent-v2');
    if (d) {
      const p = JSON.parse(d);
      if (p.contrats) state.contrats = p.contrats;
      else if (p.bulletins) state.contrats = migrateBulletins(p.bulletins);
      state.frais  = p.frais || [];
      if (p.config) state.config = { ...state.config, ...p.config };
    }
  } catch(e) {}

  loadSession();
  loadConfig();

  // Login si pas de session valide
  if (!getAppsScriptUrl() || !isSessionValid()) {
    showLogin();
    renderAll();
  } else {
    showApp();
    migrateData();
    renderAll();
    renderFTPage();
    loadFromServer();
  }

  // Dates par défaut
  const today = new Date().toISOString().slice(0,10);
  ['c-debut','c-fin','f-date'].forEach(id => { const el=document.getElementById(id); if(el) el.value=today; });

  document.getElementById('header-year').textContent = new Date().getFullYear();

  const vEl = document.getElementById('app-version-display');
  const dEl = document.getElementById('app-date-display');
  if (vEl) vEl.textContent = APP_VERSION;
  if (dEl) dEl.textContent = APP_DATE

   setTimeout(() => {
    const sVel = document.getElementById('sidebar-version');
    if (sVel) sVel.textContent = 'v' + APP_VERSION;
    const lVel = document.getElementById('login-version');
    if (lVel) lVel.textContent = 'v' + APP_VERSION;  
  }, 500);

  // Pré-remplit l'URL Apps Script dans le login si déjà configurée
  const savedUrl = localStorage.getItem('apps-script-url');
  const loginUrlEl = document.getElementById('login-apps-script-url');
  if (savedUrl && loginUrlEl) loginUrlEl.value = savedUrl;

  // Enter sur le champ mot de passe
  const btnSaveUrl = document.getElementById('btn-save-url');
  if (btnSaveUrl) btnSaveUrl.addEventListener('click', saveUrlFromLogin);
  const pwEl = document.getElementById('login-password');
  if (pwEl) pwEl.addEventListener('keydown', e => { if (e.key==='Enter') handleLogin(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  // Swipe pour fermer les sheets (mobile)
  document.querySelectorAll('.bottom-sheet').forEach(sheet => {
    let sY = 0;
    sheet.addEventListener('touchstart', e => { sY = e.touches[0].clientY; }, { passive: true });
    sheet.addEventListener('touchmove',  e => { if (e.touches[0].clientY - sY > 80) closeSheet(); }, { passive: true });
  });
}

document.addEventListener('DOMContentLoaded', init);
