/* ============================================================
   INTERMITTENT — app.js v3.2.0
   Core : state, auth, sync, navigation, settings, init
   ============================================================ */

const APP_VERSION = '3.2.9';
const APP_DATE    = '2026-04-02';

// ── STATE GLOBAL ──
let state = {
  contrats: [],
  frais: [],
  config: { tauxPas:14.6, situation:2, mathilde:0, sjr:0, areReel:0, finDroits:'' }
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
}

// ============================================================
// SYNC
// ============================================================
function setSyncStatus(s, l) {
  document.getElementById('sync-dot').className     = 'sync-dot ' + s;
  document.getElementById('sync-label').textContent = l;
  const ds = document.getElementById('desktop-sync-dot');
  const dl = document.getElementById('desktop-sync-label');
  if (ds) { ds.className = 'sync-dot ' + s; dl.textContent = l; }
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
  const set = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined && v !== null) el.value = v; };
  set('cfg-taux-pas',   state.config.tauxPas);
  set('cfg-situation',  state.config.situation);
  set('cfg-mathilde',   state.config.mathilde||'');
  set('cfg-sjr',        state.config.sjr||'');
  set('cfg-are-reel',   state.config.areReel||'');
  set('cfg-fin-droits', state.config.finDroits||'');
  const url = localStorage.getItem('apps-script-url');
  if (url) { const el = document.getElementById('apps-script-url'); if (el) el.value = url; }
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
    else        el.innerHTML = `<div class="alert alert-err">❌ ${res.error||'Erreur'}</div>`;
  } catch(e) {
    btn.textContent = 'Tester';
    document.getElementById('as-test-result').innerHTML = `<div class="alert alert-err">❌ ${e.message}</div>`;
  }
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
  });
  if (changed) saveLocal();
}

function renderAll() {
  populateYearSelect();
  renderBilan();
  renderContrats();
  renderFrais();
}

// ============================================================
// RESPONSIVE
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

  setTimeout(() => {
    const sVel = document.getElementById('sidebar-version');
    if (sVel) sVel.textContent = 'v' + APP_VERSION;
    const lVel = document.getElementById('login-version');
    if (lVel) lVel.textContent = 'v' + APP_VERSION;
  }, 300);

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
}

document.addEventListener('DOMContentLoaded', init);
