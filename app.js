/* ============================================================
   INTERMITTENT — app.js v3.2.16
   Core : state, auth, sync, navigation, settings, init
   ============================================================ */

const APP_VERSION = '3.5.12';
const APP_DATE    = '2026-0s4-03';

// ── STATE GLOBAL ──
let state = {
  contrats: [],
  frais: [],
  config: { tauxPas:0, situation:0, conjoint:0, sjr:0, areReel:0, finDroits:'', annexe:0, tauxCsg:6.2, rfr:0, historiqueAre:[] }
};

let session = { token: null, expiresAt: null };

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

async function appsScriptPost(body, signal) {
  const url = getAppsScriptUrl();
  if (!url) throw new Error('Apps Script non configuré');
  if (session.token && !body.token) body.token = session.token;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body),
    redirect: 'follow',
    signal: signal
  });
   
  const data = await r.json();
  if (!data.ok && data.code === 401) { handleSessionExpired(); return data; }
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
  session.token = token; session.expiresAt = expiresAt;
  localStorage.setItem('auth-token', token);
  localStorage.setItem('auth-expires', expiresAt);
}

function clearSession() {
  session.token = null; session.expiresAt = null;
  localStorage.removeItem('auth-token');
  localStorage.removeItem('auth-expires');
}

function isSessionValid() {
  if (!session.token || !session.expiresAt) return false;
  return new Date(session.expiresAt) > new Date();
}

async function saveUrlFromLogin() {
  const url = document.getElementById('login-apps-script-url').value.trim();
  if (!url.includes('script.google.com')) { showLoginError('URL invalide'); return; }
  localStorage.setItem('apps-script-url', url);
  const el = document.getElementById('apps-script-url');
  if (el) el.value = url;
  document.getElementById('login-url-saved').style.display = 'block';
  document.getElementById('login-error').classList.remove('show');
}

async function handleLogin() {
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');
  if (!password) { showLoginError('Entre ton mot de passe'); return; }
  if (!getAppsScriptUrl()) { showLoginError('Configure d\'abord l\'URL Apps Script ci-dessous'); return; }
  btn.innerHTML = '<div class="loader" style="width:16px;height:16px;border-color:rgba(255,255,255,.3);border-top-color:#fff;"></div>';
  document.getElementById('login-error').classList.remove('show');
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
  clearSession(); showLogin();
  toast('🔑 Session expirée — reconnecte-toi');
}

async function handleLogout() {
  if (session.token) { try { await appsScriptPost({ action: 'logout' }); } catch(e) {} }
  clearSession(); showLogin();
  toast('👋 Déconnecté');
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-shell').style.display    = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display    = 'block';
  showPage('bilan');
  const sVel = document.getElementById('sidebar-version');
  if (sVel) sVel.textContent = 'v' + APP_VERSION;
  const lVel = document.getElementById('login-version');
  if (lVel) lVel.textContent = 'v' + APP_VERSION;
}

// ============================================================
// SYNC
// ============================================================
function setSyncStatus(s, l) {
  const dot   = document.getElementById('sync-dot');
  const label = document.getElementById('sync-label');
  if (dot)   dot.className     = 'sync-dot ' + s;
  if (label) label.textContent = l;
  const ds = document.getElementById('desktop-sync-dot');
  const dl = document.getElementById('desktop-sync-label');
  if (ds) { ds.className = 'sync-dot ' + s; }
  if (dl) { dl.textContent = l; }
}

function saveLocal() { localStorage.setItem('intermittent-v2', JSON.stringify(state)); }

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
       const sst = document.getElementById('sidebar-sync-time');
      if (sst) sst.textContent = ts;
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
      if (d.contrats)       state.contrats = d.contrats;
      else if (d.bulletins) state.contrats = migrateBulletins(d.bulletins);
      if (d.frais)  state.frais  = d.frais;
      if (d.config) state.config = { ...state.config, ...d.config };
      saveLocal();
      migrateData();
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

async function listBackups() {
  const el = document.getElementById('backups-list');
  el.style.display = 'block';
  el.innerHTML = '<div class="loading-block"><div class="loader"></div></div>';
  try {
    const res = await appsScriptGet({ action: 'listBackups', token: session.token });
    if (!res.ok) { el.innerHTML = '<div class="alert alert-err">❌ ' + res.error + '</div>'; return; }
    if (!res.backups.length) { el.innerHTML = '<div style="font-size:13px;color:var(--muted);">Aucune sauvegarde trouvée</div>'; return; }
    el.innerHTML = res.backups.map(b => {
      const date = new Date(b.date).toLocaleString('fr-FR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const size = (b.size / 1024).toFixed(0) + ' Ko';
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border2);">
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;">${date}</div>
          <div style="font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace;">${size} · ${b.name}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="loadBackup('${b.id}','${date}')">📥 Charger</button>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div class="alert alert-err">❌ ' + e.message + '</div>';
  }
}

async function loadBackup(fileId, dateLabel) {
  if (!confirm(`Restaurer la sauvegarde du ${dateLabel} ?\nCela remplacera toutes les données actuelles.`)) return;
  toast('⏳ Chargement de la sauvegarde…');
  try {
    const res = await appsScriptPost({ action: 'loadBackup', fileId });
    if (res.ok && res.data) {
      if (res.data.contrats) state.contrats = res.data.contrats;
      if (res.data.frais)    state.frais    = res.data.frais;
      if (res.data.config)   state.config   = { ...state.config, ...res.data.config };
      migrateData(); saveLocal(); renderAll(); loadConfig();
      toast('✅ Sauvegarde restaurée');
      document.getElementById('backups-list').style.display = 'none';
    } else {
      toast('❌ ' + (res.error || 'Erreur'));
    }
  } catch(e) {
    toast('❌ ' + e.message);
  }
}

function migrateBulletins(bulletins) {
  return bulletins.map(b => ({
    id: b.id, employeur: (b.employeur||'').toUpperCase().trim(), poste:'',
    dateDebut: b.date, dateFin: b.date,
    cachets: b.cachets||0, heures: b.hTot||0,
    brutV: b.brutV||0, netImp: b.netImp||0, netV: b.netV||0, pasV: b.pasV||0,
    paye: b.nonPaye === 0, ref: b.ref||'', comment:'', docs:[],
    hasContrat:false, hasBulletin:true, hasAEM:false, hasCS:false
  }));
}

// ============================================================
// NAVIGATION
// ============================================================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn, .sidebar-item').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  const navBtn   = document.getElementById('nav-' + id);
  const sideItem = document.getElementById('side-' + id);
  if (navBtn)   navBtn.classList.add('active');
  if (sideItem) sideItem.classList.add('active');
  if (id === 'bilan')    { populateYearSelect(); renderBilan(); }
  if (id === 'contrats') renderContrats();
  if (id === 'frais')    renderFrais();
  if (id === 'ft')       renderFTPage();
}

function openSheet(id) {
  closeSheet(true);
  populateContratSelects();
  if (id === 'sheet-add-contrat') {
    const form = document.getElementById('contrat-form');
    const btns = form?.previousElementSibling;
    if (form) form.style.display = 'none';
    if (btns) btns.style.display = 'flex';
  }
  activeSheet = id;
   
  if (isDesktop && id === 'sheet-add-contrat') {
    document.getElementById('desktop-detail-panel').classList.add('show');
    const sheet = document.getElementById('sheet-add-contrat');
    const tmp = document.createElement('div');
    tmp.innerHTML = sheet.innerHTML;
    // Retire poignée et le header titre+✕ qui font doublon
    tmp.querySelector('.sheet-handle')?.remove();
    tmp.querySelector('div[style*="justify-content:space-between"]')?.remove();
    document.getElementById('desktop-detail-body').innerHTML = tmp.innerHTML;
    return;
  }
  document.getElementById('sheet-overlay').classList.add('show');
  document.getElementById(id).classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeSheet(silent) {
  if (activeSheet) { document.getElementById(activeSheet).classList.remove('show'); activeSheet = null; }
  document.getElementById('sheet-overlay').classList.remove('show');
  document.body.style.overflow = '';
}

function populateContratSelects() {
  const opts = state.contrats
    .sort((a,b) => (b.dateDebut||'').localeCompare(a.dateDebut||''))
    .map(c => `<option value="${c.id}">${c.employeur} (${fmtDate(c.dateDebut)})</option>`)
    .join('');
  const s1 = document.getElementById('scan-contrat-select');
  if (s1) s1.innerHTML = '<option value="">— Aucun / nouveau contrat —</option>' + opts;
  const s2 = document.getElementById('f-contrat-link');
  if (s2) s2.innerHTML = '<option value="">— Aucun —</option>' + opts;
}


// ============================================================
// CONFIG & SETTINGS
// ============================================================
function loadConfig() {
  const s = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
  s('cfg-prenom',          state.config.prenom||'');
  s('cfg-annexe',          state.config.annexe||8);
  s('cfg-statut-familial', state.config.statutFamilial||'celibataire');
  s('cfg-conjoint-prenom', state.config.conjointPrenom||'');
  s('cfg-conjoint-revenus',        state.config.conjoint||'');
  s('cfg-enfants',         state.config.enfants||0);
  s('cfg-taux-pas',        state.config.tauxPas||14.6);
  s('cfg-are-jour',        state.config.areJour||'');
  s('cfg-sr',              state.config.sr||'');
  s('cfg-nht',             state.config.nht||'');
  s('cfg-sjr',             state.config.sjr||'');
  s('cfg-are-debut',       state.config.areDebut||'');
  s('cfg-fin-droits',      state.config.finDroits||'');
  s('cfg-are-reel',        state.config.areReel||'');
  s('cfg-franchise-cp',    state.config.franchiseCp||'');
  s('cfg-franchise-sal',   state.config.franchiseSal||'');
  s('cfg-taux-csg', state.config.tauxCsg || 6.2);
  s('cfg-rfr',      state.config.rfr || '');
  updateFamilialUI();
  updateSituationFiscale();
  const url = localStorage.getItem('apps-script-url');
  if (url) { const el = document.getElementById('apps-script-url'); if (el) el.value = url; }

  // Historique ARE
  setTimeout(() => {
    const histEl = document.getElementById('are-historique');
    if (!histEl) return;
    const hist = state.config.historiqueAre || [];

    // Construit la liste complète : historique + droits actuels
    const current = state.config.areJour ? [{
      date:         state.config.areDebut,
      areJour:      state.config.areJour,
      sr:           state.config.sr,
      nht:          state.config.nht,
      sjr:          state.config.sjr,
      finDroits:    state.config.finDroits,
      franchiseCp:  state.config.franchiseCp,
      franchiseSal: state.config.franchiseSal,
      isCurrent:    true
    }] : [];

    const all = [...current, ...hist].sort((a, b) => (b.date||'').localeCompare(a.date||''));

    if (!all.length) {
      histEl.innerHTML = '<div style="font-size:12px;color:var(--muted);">Aucun historique — importe ta première notification FT</div>';
      return;
    }

    // Détecte les renouvellements anticipés
    const sorted = [...all].sort((a, b) => (a.date||'').localeCompare(b.date||''));
    const withFlags = sorted.map((h, i) => {
      let anticipé = null;
      if (i > 0) {
        const prev = sorted[i-1];
        if (prev.finDroits && h.date && h.date < prev.finDroits) {
          const jAvant = Math.ceil((new Date(prev.finDroits) - new Date(h.date)) / 86400000);
          anticipé = `Renouvellement anticipé — ${jAvant}j avant la date anniversaire du ${fmtDate(prev.finDroits)}`;
        }
      }
      return { ...h, anticipé };
    });

    histEl.innerHTML = '<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:8px;">Historique des droits</div>'
      + [...withFlags].reverse().map((h, i) => {
        const isInHist = !h.isCurrent;
        const realIdx  = hist.findIndex(x => x.date === h.date && x.areJour === h.areJour);
        return `
          <div style="padding:10px 0;border-bottom:1px solid var(--border2);">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:4px;">
              <div>
                <div style="font-size:13px;font-weight:700;display:flex;align-items:center;gap:6px;">
                  ${h.isCurrent ? '<span class="tag tag-green" style="font-size:10px;">EN COURS</span>' : ''}
                  ${fmtDate(h.date)} → ${fmtDate(h.finDroits)}
                </div>
                ${h.anticipé ? `<div class="alert alert-warn" style="font-size:11px;padding:5px 8px;margin-top:4px;">↩ ${h.anticipé}</div>` : ''}
              </div>
              ${isInHist && realIdx >= 0 ? `<button onclick="removeHistoriqueAre(${realIdx})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;padding:2px 6px;flex-shrink:0;" title="Supprimer">✕</button>` : ''}
            </div>
            <div style="font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;">
              ${fmt(h.areJour)}/j · ${h.nht||'—'}h · SR ${fmt(h.sr)}
              ${h.franchiseCp ? ` · CP ${h.franchiseCp}j` : ''}
              ${h.franchiseSal ? ` · Sal. ${h.franchiseSal}j` : ''}
            </div>
          </div>`;
      }).join('');
  }, 100);
} // fermeture loadConfig

function removeHistoriqueAre(index) {
  if (!confirm('Supprimer cette entrée de l\'historique ?')) return;
  state.config.historiqueAre.splice(index, 1);
  saveState();
  loadConfig();
  toast('🗑️ Entrée supprimée');
}

function clearDroitsARE() {
  if (!confirm('Supprimer les droits ARE actuels ?\nIls seront archivés dans l\'historique.')) return;
  // Archive avant de supprimer
  if (state.config.areJour) {
    if (!state.config.historiqueAre) state.config.historiqueAre = [];
    state.config.historiqueAre.push({
      date:         state.config.areDebut,
      areJour:      state.config.areJour,
      sr:           state.config.sr,
      nht:          state.config.nht,
      sjr:          state.config.sjr,
      finDroits:    state.config.finDroits,
      franchiseCp:  state.config.franchiseCp,
      franchiseSal: state.config.franchiseSal
    });
  }
  // Remet à zéro
  state.config.areJour     = 0;
  state.config.sr          = 0;
  state.config.nht         = 0;
  state.config.sjr         = 0;
  state.config.areDebut    = '';
  state.config.finDroits   = '';
  state.config.areReel     = 0;
  state.config.franchiseCp  = 0;
  state.config.franchiseSal = 0;
  saveState();
  loadConfig();
  renderBilan();
  toast('🗑️ Droits ARE supprimés — archivés dans l\'historique');
}

function forceMigrateAreToHistorique() {
  if (!state.config.historiqueAre) state.config.historiqueAre = [];
  if (!state.config.areJour) { toast('ℹ️ Aucun droit ARE actuel à archiver'); return; }
  
  // Vérifie si déjà dans l'historique
  const alreadyIn = state.config.historiqueAre.some(h => 
    h.date === state.config.areDebut
  );
  if (alreadyIn) { toast('ℹ️ Ces droits sont déjà dans l\'historique'); return; }

  state.config.historiqueAre.push({
    date:         state.config.areDebut,
    areJour:      state.config.areJour,
    sr:           state.config.sr,
    nht:          state.config.nht,
    sjr:          state.config.sjr,
    finDroits:    state.config.finDroits,
    franchiseCp:  state.config.franchiseCp,
    franchiseSal: state.config.franchiseSal
  });
  saveState();
  loadConfig();
  toast('✅ Droits actuels ajoutés à l\'historique');
}

function saveConfig() {
  const g = (id, def) => { const el = document.getElementById(id); return el ? el.value : def; };
  const gf = (id, def) => parseFloat(g(id, def)) || def || 0;
  const gi = (id, def) => parseInt(g(id, def)) || def || 0;

  state.config.prenom         = g('cfg-prenom', 'Simon');
  state.config.annexe         = gi('cfg-annexe', 8);
  state.config.statutFamilial = g('cfg-statut-familial', 'celibataire');
  state.config.conjointPrenom = g('cfg-conjoint-prenom', '');
  state.config.conjoint       = gf('cfg-conjoint-revenus', 0);
  state.config.enfants        = gi('cfg-enfants', 0);
  state.config.tauxPas        = gf('cfg-taux-pas', 14.6);
  state.config.areJour        = gf('cfg-are-jour', 0);
  state.config.sr             = gf('cfg-sr', 0);
  state.config.nht            = gf('cfg-nht', 0);
  state.config.sjr            = gf('cfg-sjr', 0);
  state.config.areDebut       = g('cfg-are-debut', '');
  state.config.finDroits      = g('cfg-fin-droits', '');
  state.config.areReel        = gf('cfg-are-reel', 0);
  state.config.franchiseCp    = gi('cfg-franchise-cp', 0);
  state.config.franchiseSal   = gi('cfg-franchise-sal', 0);
  state.config.tauxCsg = parseFloat(g('cfg-taux-csg', 6.2)) || 6.2;
  state.config.rfr     = gf('cfg-rfr', 0);

  // Calcule les parts fiscales depuis la situation réelle
  updateSituationFiscale();
  saveState();
}

function updateFamilialUI() {
  const statut = document.getElementById('cfg-statut-familial')?.value;
  const bloc   = document.getElementById('cfg-conjoint-bloc');
  if (bloc) bloc.style.display = statut === 'couple' ? 'block' : 'none';
}

function updateSituationFiscale() {
  // Calcule les parts fiscales automatiquement
  const statut  = state.config.statutFamilial || 'celibataire';
  const enfants = state.config.enfants || 0;
  let parts = statut === 'couple' ? 2 : 1;
  if (enfants === 1) parts += 0.5;
  else if (enfants === 2) parts += 1;
  else if (enfants >= 3) parts += enfants - 1; // 2 parts à partir du 3e
  state.config.situation = parts;
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
    else        el.innerHTML = `<div class="alert alert-err">❌ ${res.error||'Erreur'}</div>`;
  } catch(e) {
    btn.textContent = 'Tester';
    document.getElementById('as-test-result').innerHTML = `<div class="alert alert-err">❌ ${e.message}</div>`;
  }
}

async function importNotificationFT(event) {
  const file = event.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('are-import-status');
  if (statusEl) { statusEl.style.display = 'block'; statusEl.className = 'alert alert-info'; statusEl.textContent = '⏳ Analyse en cours…'; }

  try {
    const base64 = await fileToBase64(file);
    const res = await appsScriptPost({ action: 'scanDoc', docType: 'notification_ft', base64Data: base64, mediaType: 'application/pdf' });
    if (res.ok && res.data) {
      if (statusEl) statusEl.style.display = 'none';
      handleNotificationFT(res.data);
    } else {
      if (statusEl) { statusEl.className = 'alert alert-err'; statusEl.textContent = '❌ ' + (res.error||'Erreur'); }
    }
  } catch(e) {
    if (statusEl) { statusEl.className = 'alert alert-err'; statusEl.textContent = '❌ ' + e.message; }
  }
  event.target.value = '';
}

// ============================================================
// DONNÉES
// ============================================================
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
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
      migrateData(); saveState(); renderAll(); loadConfig();
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
    if (c.employeur && c.employeur !== c.employeur.toUpperCase()) {
      c.employeur = c.employeur.toUpperCase().trim(); changed = true;
    }
    if (c.hasContrat  === undefined) { c.hasContrat  = false; changed = true; }
    if (c.hasBulletin === undefined) { c.hasBulletin = false; changed = true; }
    if (c.hasAEM      === undefined) { c.hasAEM      = false; changed = true; }
    if (c.hasCS       === undefined) { c.hasCS       = false; changed = true; }
    if (c.paye        === undefined) { c.paye        = false; changed = true; }
    if (c.dateDebut && !/^\d{4}-\d{2}-\d{2}$/.test(c.dateDebut)) {
      c.dateDebut = parseDate(c.dateDebut) || c.dateDebut; changed = true;
    }
    if (c.dateFin && !/^\d{4}-\d{2}-\d{2}$/.test(c.dateFin)) {
      c.dateFin = parseDate(c.dateFin) || c.dateFin; changed = true;
    }
    if (!c.sources) {
      c.sources = {
        contrat:  c.hasContrat  ? { brutV: c.brutV, cachets: c.cachets, heures: c.heures, poste: c.poste } : null,
        bulletin: c.hasBulletin ? { brutV: c.brutV, netImp: c.netImp, netV: c.netV, pasV: c.pasV, heures: c.heures, cachets: c.cachets } : null,
        aem:      c.hasAEM      ? { brutV: c.brutV, cachets: c.cachets, heures: c.heures } : null,
        conges:   c.hasCS       ? { brutV: c.brutV, cachets: c.cachets } : null
      };
      changed = true;
    }
     // Auto-paiement si > 1 an
    if (c.paye !== true && c.dateDebut && !c.paiementAuto) {
      const debut = new Date(c.dateDebut + 'T12:00:00');
      const unAn  = new Date(); unAn.setFullYear(unAn.getFullYear() - 1);
      if (debut < unAn) {
        c.paye = true;
        c.datePaiement = new Date(debut.getTime() + 30 * 86400000).toISOString().slice(0,10);
        c.paiementAuto = true;
        changed = true;
      }
    }
  });
  if (!state.config.historiqueAre) { state.config.historiqueAre = []; changed = true; }
  if (changed) saveLocal();
}

function renderAll() {
  populateYearSelect();
  renderBilan();
  renderContrats();
  renderFrais();
}

function handleNotificationFT(d) {
  if (!state.config.historiqueAre) state.config.historiqueAre = [];

  const dateOuverture = parseDate(d.date_ouverture);
  const actuelle      = state.config.areDebut;
  const isNewer       = !actuelle || (dateOuverture && dateOuverture > actuelle);

  // Vérifie doublon
  const alreadyStored = state.config.historiqueAre.some(h => h.date === d.date_ouverture);

  // Crée un encart de confirmation visuel
  const existingPanel = document.getElementById('ft-notif-confirm-panel');
  if (existingPanel) existingPanel.remove();

  const panel = document.createElement('div');
  panel.id = 'ft-notif-confirm-panel';
  panel.style.cssText = 'margin-top:16px;';
  panel.innerHTML = `
    <div class="card" style="background:var(--surface);border:2px solid var(--accent);box-shadow:0 8px 32px rgba(0,0,0,0.15);">
      <div class="card-head">
        <div class="card-head-title" style="color:var(--accent);">🏛️ Notification ARE détectée</div>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('ft-notif-confirm-panel').remove()">✕</button>
      </div>
      ${isNewer ? '<div class="alert alert-ok" style="font-size:12px;margin-bottom:12px;">✅ Cette notification est plus récente que vos droits actuels</div>' : '<div class="alert alert-warn" style="font-size:12px;margin-bottom:12px;">⚠️ Cette notification semble moins récente que vos droits actuels</div>'}
      ${alreadyStored ? '<div class="alert alert-warn" style="font-size:12px;margin-bottom:12px;">⚠️ Cette notification semble déjà archivée</div>' : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:13px;">
        <div style="background:var(--bg);padding:10px;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:4px;">ALLOCATION/JOUR</div>
          <div style="font-weight:800;font-size:18px;color:var(--accent);">${fmt(d.are_jour)}</div>
        </div>
        <div style="background:var(--bg);padding:10px;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:4px;">SALAIRE DE RÉFÉRENCE</div>
          <div style="font-weight:800;font-size:18px;">${fmt(d.sr)}</div>
        </div>
        <div style="background:var(--bg);padding:10px;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:4px;">HEURES</div>
          <div style="font-weight:700;">${d.nht} h</div>
        </div>
        <div style="background:var(--bg);padding:10px;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:4px;">SJR</div>
          <div style="font-weight:700;">${fmt(d.sjr)}/j</div>
        </div>
        <div style="background:var(--bg);padding:10px;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:4px;">OUVERTURE</div>
          <div style="font-weight:700;">${fmtDate(d.date_ouverture)}</div>
        </div>
        <div style="background:var(--bg);padding:10px;border-radius:8px;">
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--muted);margin-bottom:4px;">DATE ANNIVERSAIRE</div>
          <div style="font-weight:700;">${fmtDate(d.date_anniversaire)}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        ${isNewer
          ? `<button class="btn btn-primary" style="flex:2;" onclick="confirmNotifFT(${JSON.stringify(d).replace(/"/g,'&quot;')}, true)">✓ Mettre à jour mes droits</button>`
          : `<button class="btn btn-primary" style="flex:2;" onclick="confirmNotifFT(${JSON.stringify(d).replace(/"/g,'&quot;')}, false)">📥 Ajouter à l'historique</button>`
        }
        <button class="btn btn-ghost" style="flex:1;" onclick="document.getElementById('ft-notif-confirm-panel').remove()">Non merci</button>
      </div>
    </div>`;

  // Insère dans le div ARE des réglages si visible, sinon en bas de page
  const areCard = document.getElementById('are-droits-card');
  if (areCard) {
    const existing = areCard.querySelector('#ft-notif-confirm-panel');
    if (existing) existing.remove();
    areCard.appendChild(panel);
    areCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    document.body.appendChild(panel);
  }
}

function confirmNotifFT(d, updateCurrent) {
  if (!state.config.historiqueAre) state.config.historiqueAre = [];

  if (updateCurrent) {
    // Archive les droits actuels s'ils existent
    if (state.config.areJour) {
      state.config.historiqueAre.push({
        date:         state.config.areDebut,
        areJour:      state.config.areJour,
        sr:           state.config.sr,
        nht:          state.config.nht,
        sjr:          state.config.sjr,
        finDroits:    state.config.finDroits,
        franchiseCp:  state.config.franchiseCp,
        franchiseSal: state.config.franchiseSal
      });
    }
    // Met à jour les droits courants
    if (d.are_jour)          state.config.areJour     = d.are_jour;
    if (d.sr)                state.config.sr           = d.sr;
    if (d.nht)               state.config.nht          = d.nht;
    if (d.sjr)               state.config.sjr          = d.sjr;
    if (d.date_ouverture)    state.config.areDebut     = d.date_ouverture;
    if (d.date_anniversaire) state.config.finDroits    = d.date_anniversaire;
    if (d.franchise_cp)      state.config.franchiseCp  = d.franchise_cp;
    if (d.franchise_sal)     state.config.franchiseSal = d.franchise_sal;
    if (d.annexe)            state.config.annexe       = d.annexe;
    toast('✅ Droits ARE mis à jour');
  } else {
    // Ajoute seulement à l'historique
    const alreadyStored = state.config.historiqueAre.some(h => h.date === d.date_ouverture);
    if (!alreadyStored) {
      state.config.historiqueAre.push({
        date:         d.date_ouverture,
        areJour:      d.are_jour,
        sr:           d.sr,
        nht:          d.nht,
        sjr:          d.sjr,
        finDroits:    d.date_anniversaire,
        franchiseCp:  d.franchise_cp,
        franchiseSal: d.franchise_sal
      });
      toast('📥 Notification ajoutée à l\'historique');
    } else {
      toast('ℹ️ Notification déjà dans l\'historique');
    }
  }

  saveState();
  loadConfig();
  renderBilan();
  if (fileQueue.length > 0) nextInQueue();
  document.getElementById('ft-notif-confirm-panel')?.remove();
}
function toggleCardLock(btn) {
  const card = btn.closest('.card');
  const locked = card.classList.toggle('card-locked');
  btn.textContent = locked ? '🔒' : '🔓';
  btn.style.background = locked ? '' : 'var(--accent-light)';
  btn.style.borderColor = locked ? '' : 'var(--accent)';
  btn.style.color       = locked ? '' : 'var(--accent)';
}

function initCardLocks() {
  document.querySelectorAll('.card[data-lockable]').forEach(card => {
    card.classList.add('card-locked');
    const head = card.querySelector('.card-head');
    if (head) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost btn-sm card-lock-btn';
      btn.textContent = '🔒';
      btn.style.cssText = 'opacity:1;pointer-events:auto;font-size:14px;';
      btn.onclick = (e) => { e.stopPropagation(); toggleCardLock(btn); };
      head.appendChild(btn);
    }
  });
}

   async function importCourrierCSG(event) {
  const file = event.target.files[0];
  if (!file) return;
  toast('⏳ Analyse du courrier CSG…');
  try {
    const base64 = await fileToBase64(file);
    const res = await appsScriptPost({
      action: 'scanDoc',
      docType: 'courrier_csg',
      base64Data: base64,
      mediaType: 'application/pdf'
    });
    if (res.ok && res.data?.taux_csg !== undefined) {
      state.config.tauxCsg = res.data.taux_csg;
      document.getElementById('cfg-taux-csg').value = res.data.taux_csg;
      saveState();
      toast('✅ Taux CSG mis à jour : ' + res.data.taux_csg + '%');
    } else {
      toast('ℹ️ Courrier CSG archivé — mets à jour le taux manuellement');
    }
  } catch(e) {
    toast('❌ ' + e.message);
  }
  event.target.value = '';
}

// ============================================================
// RESPONSIVE
// ============================================================
function checkLayout() {
  isDesktop = window.innerWidth >= 768;
  document.body.classList.toggle('is-desktop', isDesktop);
}

// ── DRAG & DROP GLOBAL ──
let globalDropFiles = [];

function initGlobalDrop() {
  let dragCounter = 0;

  document.addEventListener('dragenter', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter++;
    document.getElementById('global-drop-overlay').style.display = 'block';
  });

  document.addEventListener('dragleave', e => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      document.getElementById('global-drop-overlay').style.display = 'none';
    }
  });

  document.addEventListener('dragover', e => {
    e.preventDefault();
  });

  document.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    document.getElementById('global-drop-overlay').style.display = 'none';

    const files = Array.from(e.dataTransfer.files)
      .filter(f => /\.(pdf|jpg|jpeg|png|heic|heif|webp|tiff|bmp)$/i.test(f.name))
      .slice(0, 4);

    if (!files.length) { toast('❌ Format non supporté'); return; }
    globalDropFiles = files;
    showGlobalDropModal(files);
  });
}

function showGlobalDropModal(files) {
  const list = document.getElementById('global-drop-list');
  list.innerHTML = files.map((f, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border:1.5px solid var(--border);border-radius:8px;margin-bottom:8px;">
      <span style="font-size:20px;">${f.name.endsWith('.pdf') ? '📄' : '🖼️'}</span>
      <span style="flex:1;font-size:13px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
      <span style="font-size:11px;color:var(--muted);flex-shrink:0;">${(f.size/1024).toFixed(0)} Ko</span>
      <button onclick="removeGlobalDropFile(${i})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;flex-shrink:0;">✕</button>
    </div>
  `).join('');
  if (files.length > 4) {
    list.innerHTML += `<div style="font-size:12px;color:var(--orange);margin-top:4px;">⚠️ Maximum 4 fichiers — seuls les 4 premiers sont listés</div>`;
  }
  document.getElementById('global-drop-modal').style.display = 'flex';
}

function removeGlobalDropFile(i) {
  globalDropFiles.splice(i, 1);
  if (!globalDropFiles.length) { cancelGlobalDrop(); return; }
  showGlobalDropModal(globalDropFiles);
}

function confirmGlobalDrop() {
  document.getElementById('global-drop-modal').style.display = 'none';
  if (!globalDropFiles.length) return;
  showPage('scan');
  // Réinitialise le type à auto
  currentDocType = 'auto';
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  const autoPill = document.querySelector('.pill[data-type="auto"]');
  if (autoPill) autoPill.classList.add('active');
  // Lance la file d'attente
  setTimeout(() => {
    if (globalDropFiles.length === 1) {
      processFile(globalDropFiles[0]);
    } else {
      processFileQueue(globalDropFiles);
    }
    globalDropFiles = [];
  }, 300);
}

function cancelGlobalDrop() {
  document.getElementById('global-drop-modal').style.display = 'none';
  globalDropFiles = [];
}

// ============================================================
// INIT
// ============================================================
function init() {
  checkLayout();
  window.addEventListener('resize', checkLayout);

  try {
    const d = localStorage.getItem('intermittent-v2');
    if (d) {
      const p = JSON.parse(d);
      if (p.contrats)       state.contrats = p.contrats;
      else if (p.bulletins) state.contrats = migrateBulletins(p.bulletins);
      state.frais  = p.frais || [];
      if (p.config) state.config = { ...state.config, ...p.config };
    }
  } catch(e) {}

  loadSession();
  loadConfig();
   initCardLocks();

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

  const today = new Date().toISOString().slice(0,10);
  ['c-debut','c-fin','f-date'].forEach(id => { const el = document.getElementById(id); if (el) el.value = today; });

  const hYear = document.getElementById('header-year');
  if (hYear) hYear.textContent = new Date().getFullYear();

  const vEl = document.getElementById('app-version-display');
  const dEl = document.getElementById('app-date-display');
  if (vEl) vEl.textContent = APP_VERSION;
  if (dEl) dEl.textContent = APP_DATE;

  const savedUrl   = localStorage.getItem('apps-script-url');
  const loginUrlEl = document.getElementById('login-apps-script-url');
  if (savedUrl && loginUrlEl) loginUrlEl.value = savedUrl;

  const btnSaveUrl = document.getElementById('btn-save-url');
  if (btnSaveUrl) btnSaveUrl.addEventListener('click', saveUrlFromLogin);
  const pwEl = document.getElementById('login-password');
  if (pwEl) pwEl.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  document.querySelectorAll('.bottom-sheet').forEach(sheet => {
    let sY = 0;
    sheet.addEventListener('touchstart', e => { sY = e.touches[0].clientY; }, { passive: true });
    sheet.addEventListener('touchmove',  e => { if (e.touches[0].clientY - sY > 80) closeSheet(); }, { passive: true });
  });
   
   initGlobalDrop();
}

document.addEventListener('DOMContentLoaded', init);
