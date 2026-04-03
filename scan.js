/* ============================================================
   INTERMITTENT — scan.js
   Scan de documents, reconnaissance IA, rattachement
   ============================================================ */

let fileQueue      = [];
let fileQueueIndex = 0;
let currentAbortController = null;

// ── UPLOAD ──
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('active');
  const files = Array.from(e.dataTransfer.files).slice(0, 4);
  if (!files.length) return;
  if (e.dataTransfer.files.length > 4) toast('⚠️ Maximum 4 fichiers — seuls les 4 premiers sont traités');
  if (files.length === 1) processFile(files[0]);
  else processFileQueue(files);
}

function handleFile(e) {
  const files = Array.from(e.target.files).slice(0, 4);
  if (!files.length) return;
  if (e.target.files.length > 4) toast('⚠️ Maximum 4 fichiers — seuls les 4 premiers sont traités');
  if (files.length === 1) { processFile(files[0]); return; }
  processFileQueue(files);
}

async function processFileQueue(files) {
  fileQueue      = Array.from(files);
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
    fileQueue      = [];
    fileQueueIndex = 0;
    toast('✅ Tous les documents traités');
  }
}

function fileToBase64(f) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

function cancelAnalysis() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  document.getElementById('scan-loading').style.display = 'none';
  document.querySelectorAll('.pill').forEach(p => { p.style.pointerEvents = ''; p.style.opacity = ''; });
  const lc = document.getElementById('scan-contrat-link-card');
  if (lc) lc.style.opacity = '';
  document.getElementById('file-input').value = '';
  if (fileQueue.length > 0) { fileQueue = []; fileQueueIndex = 0; toast('❌ Analyse annulée'); }
  else toast('❌ Analyse annulée');
}

async function processFile(file) {
  if (!getAppsScriptUrl()) { showPage('settings'); toast('⚙️ Configure Apps Script'); return; }
  if (!isSessionValid())   { showLogin(); return; }

  // Grise l'interface pendant le traitement
  document.querySelectorAll('.pill').forEach(p => { p.style.pointerEvents = 'none'; p.style.opacity = '0.5'; });
  const linkCard = document.getElementById('scan-contrat-link-card');
  if (linkCard) linkCard.style.opacity = '0.5';

  document.getElementById('scan-loading').style.display    = 'block';
  document.getElementById('scan-result-card').style.display = 'none';

 try {
    const base64 = await fileToBase64(file);
    currentAbortController = new AbortController();
    const res = await appsScriptPost({ action: 'scanDoc', docType: currentDocType, base64Data: base64, mediaType: file.type }, currentAbortController.signal);
    document.getElementById('scan-loading').style.display = 'none';
    if (res.ok) {
      pendingScanData = res.data;
      showScanResult(res.data);
    } else {
      document.getElementById('scan-result-card').style.display  = 'block';
      document.getElementById('scan-result-card').innerHTML = '<div class="alert alert-err">❌ ' + (res.error||'Erreur scan') + '</div>';
    }
  } catch(e) {
    document.getElementById('scan-loading').style.display = 'none';
    if (e.name === 'AbortError') return; // Annulation volontaire, pas d'erreur
    document.getElementById('scan-result-card').style.display = 'block';
    document.getElementById('scan-result-card').innerHTML = '<div class="alert alert-err">❌ ' + e.message + '</div>';
  }

  // Réactive l'interface
  document.querySelectorAll('.pill').forEach(p => { p.style.pointerEvents = ''; p.style.opacity = ''; });
  const lc = document.getElementById('scan-contrat-link-card');
  if (lc) lc.style.opacity = '';
  document.getElementById('file-input').value = '';
}

// ── AFFICHAGE RÉSULTAT ──
function showScanResult(d) {
  const card = document.getElementById('scan-result-card');
  card.style.display = 'block';

  const typeLabels = {contrat:'📝 Contrat', bulletin:'📄 Bulletin', aem:'📋 AEM', conges:'🌴 Congés Spectacle', frais:'🧾 Frais'};

  // Sélecteur de type
  const typeSelector = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:10px 14px;background:var(--bg2);border-radius:var(--r-sm);">'
    + '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;">Type détecté</span>'
    + '<select onchange="overrideDocType(this.value)" style="flex:1;padding:6px 10px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);font-size:13px;font-weight:600;">'
    + Object.entries(typeLabels).map(([v,l]) => '<option value="' + v + '"' + (v === d.type ? ' selected' : '') + '>' + l + '</option>').join('')
    + '</select>'
    + '</div>';

  // Correspondance contrat existant
  let matchInfo = '';
  // Vérifie d'abord si c'est un doublon
  const docTypeForDup = d.type || currentDocType;
  const duplicate = findDuplicateContrat(d, docTypeForDup);
  if (duplicate) {
    const typeLabelsShort = {contrat:'Contrat', bulletin:'Bulletin', aem:'AEM', conges:'Congés Spectacle'};
    matchInfo = '<div class="alert alert-warn" style="margin-bottom:12px;">'
      + '⚠️ <strong>Document possiblement déjà chargé</strong><br>'
      + '<small>Un ' + (typeLabelsShort[docTypeForDup]||docTypeForDup) + ' existe déjà pour <strong>' + duplicate.employeur + '</strong> (' + fmtDate(duplicate.dateDebut) + ')</small>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;">'
      + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:11px;">'
      + '<div style="font-weight:700;margin-bottom:6px;color:var(--muted);">EXISTANT</div>'
      + '<div>💰 ' + fmt(duplicate.brutV) + ' brut</div>'
      + '<div>📅 ' + fmtDate(duplicate.dateDebut) + '</div>'
      + '<div>🎭 ' + (duplicate.cachets||0) + ' cachet(s)</div>'
      + '<button class="btn btn-ghost btn-sm" style="width:100%;margin-top:8px;" onclick="keepExisting(\'' + duplicate.id + '\')">✓ Garder existant</button>'
      + '</div>'
      + '<div style="background:var(--accent-light);border:1px solid var(--accent);border-radius:8px;padding:10px;font-size:11px;">'
      + '<div style="font-weight:700;margin-bottom:6px;color:var(--accent);">NOUVEAU</div>'
      + '<div>💰 ' + fmt(d.salaire_brut||d.cachet_brut_total||0) + ' brut</div>'
      + '<div>📅 ' + fmtDate(parseDate(d.date_travail)||parseDate(d.date_debut)||'') + '</div>'
      + '<div>🎭 ' + (d.cachets||d.nb_cachets||0) + ' cachet(s)</div>'
      + '<button class="btn btn-primary btn-sm" style="width:100%;margin-top:8px;" onclick="keepNew()">↑ Remplacer</button>'
      + '</div>'
      + '</div>'
      + '</div>';
    // Cache le bouton Enregistrer jusqu'au choix
    setTimeout(() => { const btn = document.getElementById('btn-confirm-scan'); if (btn) btn.style.display = 'none'; }, 50);
  } else if (['bulletin','aem','conges','contrat'].includes(d.type)) {
    const dateStr = parseDate(d.date_travail) || parseDate(d.date_debut) || parseDate(d.date_fin) || (() => {
      const mi = MONTHS.indexOf(d.mois);
      const an = parseInt(d.annee);
      return (mi >= 0 && !isNaN(an)) ? `${an}-${String(mi+1).padStart(2,'0')}-01` : new Date().toISOString().slice(0,10);
    })();
    const match = findMatchingContrat(d.employeur, dateStr);
    if (match) {
      matchInfo = '<div class="alert alert-ok" style="margin-bottom:12px;">'
        + '🔗 Correspondance trouvée : <strong>' + match.employeur + '</strong> (' + fmtDate(match.dateDebut) + ')<br>'
        + '<small>Confirmes-tu le rattachement à ce contrat ?</small>'
        + '<div style="display:flex;gap:8px;margin-top:8px;">'
        + '<button class="btn btn-primary btn-sm" onclick="confirmRattachement(\'' + match.id + '\')">✓ Oui, rattacher</button>'
        + '<button class="btn btn-ghost btn-sm" onclick="refuserRattachement()">Non, créer nouveau</button>'
        + '</div></div>';
      const btn = document.getElementById('btn-confirm-scan');
      if (btn) btn.style.display = 'none';
      const sel = document.getElementById('scan-contrat-select');
      if (sel) sel.value = match.id;
    }
  }

  // Tableau des données extraites
  const numF = ['salaire_brut','net_imposable','net_percu','pas_preleve','montant_ttc','montant_ht','cachet_brut'];
  const intF = ['cachets','nb_cachets','nb_jours_cachets','nb_heures','h_totales','h_cachets','annee'];
  const rows = '<div style="padding:8px 0;border-bottom:1px solid var(--border2);display:flex;justify-content:space-between;">'
    + '<span style="font-family:\'DM Mono\',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;">Type initialement détecté</span>'
    + '<span style="font-size:13px;font-weight:700;">' + (typeLabels[d.type] || d.type || '—') + '</span>'
    + '</div>'
    + Object.entries(d)
      .filter(([k,v]) => k !== 'type' && k !== 'nb_cachets' && v !== null && v !== '' && v !== 0)
      .map(([k,v]) => {
        const isNum = intF.includes(k) || numF.some(n => k.includes(n.split('_')[0])) || k.includes('brut') || k.includes('net') || k.includes('montant');
        const isMois = k === 'mois';
        const isDate = k.includes('date') || k === 'annee';
        const inputType = isMois ? 'select' : (k.includes('date') ? 'date' : (intF.includes(k) || isNum ? 'number' : 'text'));
        const displayVal = intF.includes(k) ? v : (isNum ? v : v);
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border2);">'
          + '<span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;flex:1;">' + k.replace(/_/g,' ') + '</span>'
          + '<div style="display:flex;align-items:center;gap:6px;">'
          + '<span id="scan-val-' + k + '" style="font-size:13px;font-weight:600;">' + (isNum && !intF.includes(k) ? fmt(v) : v) + '</span>'
          + (k === 'mois'
            ? '<select id="scan-input-' + k + '" style="display:none;padding:4px 8px;border:1.5px solid var(--accent);border-radius:6px;font-size:13px;font-weight:600;background:var(--surface);" onchange="updateScanField(\'' + k + '\',this.value)">'
              + MONTHS.map(m => '<option value="' + m + '"' + (m === v ? ' selected' : '') + '>' + m + '</option>').join('')
              + '</select>'
            : '<input id="scan-input-' + k + '" type="' + inputType + '" value="' + (k.includes('date') ? parseDate(v)||v : v) + '" step="0.01" style="display:none;padding:4px 8px;border:1.5px solid var(--accent);border-radius:6px;font-size:13px;font-weight:600;width:120px;background:var(--surface);" onchange="updateScanField(\'' + k + '\',this.value)">')
          + '<button onclick="toggleScanField(\'' + k + '\')" style="background:none;border:none;cursor:pointer;padding:2px;color:var(--muted);font-size:12px;flex-shrink:0;" title="Modifier">✏️</button>'
          + '</div>'
          + '</div>';
      }).join('');

  card.innerHTML = '<div class="card">'
    + '<div class="card-head"><div class="card-head-title">Extraction IA</div><span class="tag tag-green">✓ OK</span></div>'
    + typeSelector
    + matchInfo
    + rows
    + '<button class="btn btn-primary" id="btn-confirm-scan" onclick="confirmScanInline()" style="margin-top:16px;">✓ Enregistrer comme ' + (typeLabels[d.type]||d.type) + '</button>'
    + '<button class="btn btn-ghost" style="margin-top:8px;width:100%;" onclick="cancelScan()">Annuler</button>'
    + '</div>';
}

// ── ACTIONS ──
function overrideDocType(type) {
  if (pendingScanData) {
    pendingScanData.type = type;
    const typeLabels = {contrat:'📝 Contrat', bulletin:'📄 Bulletin', aem:'📋 AEM', conges:'🌴 Congés Spectacle', frais:'🧾 Frais'};
    const btn = document.getElementById('btn-confirm-scan');
    if (btn) btn.textContent = '✓ Enregistrer comme ' + (typeLabels[type]||type);
  }
}

function cancelScan() {
  pendingScanData = null;
  document.getElementById('scan-result-card').style.display = 'none';
  document.querySelectorAll('.pill').forEach(p => { p.style.pointerEvents = ''; p.style.opacity = ''; });
  const lc = document.getElementById('scan-contrat-link-card');
  if (lc) lc.style.opacity = '';
  if (fileQueue.length > 0) {
    fileQueue      = [];
    fileQueueIndex = 0;
    toast('❌ File d\'attente annulée');
  }
}

function confirmRattachement(id) {
  const sel = document.getElementById('scan-contrat-select');
  if (sel) sel.value = id;
  const btn = document.getElementById('btn-confirm-scan');
  if (btn) btn.style.display = 'block';
  document.querySelector('.alert-ok')?.remove();
}

function refuserRattachement() {
  const sel = document.getElementById('scan-contrat-select');
  if (sel) sel.value = '';
  const btn = document.getElementById('btn-confirm-scan');
  if (btn) btn.style.display = 'block';
  const banner = document.querySelector('.alert-ok');
  if (banner) {
    banner.className = 'alert alert-warn';
    banner.innerHTML = '📄 Ce document créera un <strong>nouveau contrat</strong>.'
      + '<div style="display:flex;gap:8px;margin-top:8px;">'
      + '<button class="btn btn-ghost btn-sm" onclick="revenirRattachement()">↩ Finalement, rattacher</button>'
      + '</div>';
  }
}

function revenirRattachement() {
  if (pendingScanData) showScanResult(pendingScanData);
}

// ── CORRESPONDANCE ──
function findMatchingContrat(employeur, dateStr) {
  if (!employeur) return null;
  const empNorm = employeur.toUpperCase().replace(/\s+/g, '').trim();
  if (!empNorm || empNorm.length < 3) return null;

  const parsedDate = parseDate(dateStr);
  if (!parsedDate) return null;
  const [y, m] = parsedDate.split('-').map(Number);
  if (!y || !m || isNaN(y) || isNaN(m)) return null;

  const candidates = state.contrats.filter(c => {
    if (!c.dateDebut) return false;
    const cd = new Date(c.dateDebut + 'T12:00:00');
    return cd.getFullYear() === y && cd.getMonth() === m - 1;
  });

  if (!candidates.length) return null;

  return candidates.map(c => {
    const cNorm = c.employeur.toUpperCase().replace(/\s+/g, '').trim();
    let score = 0;
    if (cNorm === empNorm) score += 10;
    else if (cNorm.includes(empNorm.slice(0,6)) || empNorm.includes(cNorm.slice(0,6))) score += 5;
    return { c, score };
  })
  .filter(x => x.score > 0)
  .sort((a,b) => b.score - a.score)[0]?.c || null;
}

// ── ENREGISTREMENT ──
function toggleScanField(key) {
  const span  = document.getElementById('scan-val-' + key);
  const input = document.getElementById('scan-input-' + key);
  if (!span || !input) return;
  const editing = input.style.display !== 'none';
  if (editing) {
    span.style.display  = '';
    input.style.display = 'none';
  } else {
    span.style.display  = 'none';
    input.style.display = '';
    input.focus();
    input.select();
  }
}

function updateScanField(key, value) {
  if (!pendingScanData) return;
  const parsed = isNaN(value) ? value : (value.includes('.') ? parseFloat(value) : parseInt(value));
  pendingScanData[key] = parsed;
  // Met à jour l'affichage
  const span = document.getElementById('scan-val-' + key);
  const numF = ['salaire_brut','net_imposable','net_percu','pas_preleve','montant_ttc','montant_ht','cachet_brut'];
  const intF = ['cachets','nb_cachets','nb_jours_cachets','nb_heures','h_totales','h_cachets','annee'];
  if (span) {
    const isNum = numF.some(n => key.includes(n.split('_')[0])) || key.includes('brut') || key.includes('net') || key.includes('montant');
    span.textContent = (isNum && !intF.includes(key)) ? fmt(parsed) : parsed;
  }
  // Referme le champ
  toggleScanField(key);
}

function findDuplicateContrat(d, docType) {
  // Cherche un contrat qui a déjà ce type de document avec le même employeur/période
  const dateStr = parseDate(d.date_travail) || parseDate(d.date_debut) || parseDate(d.date_fin) || (() => {
    const mi = MONTHS.indexOf(d.mois);
    const an = parseInt(d.annee);
    return (mi >= 0 && !isNaN(an)) ? `${an}-${String(mi+1).padStart(2,'0')}-01` : null;
  })();
  if (!dateStr) return null;

  const empNorm = (d.employeur||'').toUpperCase().replace(/\s+/g,'');
  const [y, m]  = dateStr.split('-').map(Number);

  return state.contrats.find(c => {
    if (!c.dateDebut) return false;
    const cd = new Date(c.dateDebut + 'T12:00:00');
    if (cd.getFullYear() !== y || cd.getMonth() !== m-1) return false;
    const cNorm = c.employeur.toUpperCase().replace(/\s+/g,'');
    const sameEmp = cNorm === empNorm || cNorm.includes(empNorm.slice(0,6)) || empNorm.includes(cNorm.slice(0,6));
    if (!sameEmp) return false;
    // Vérifie si ce type de document est déjà présent
    if (docType === 'bulletin' && c.hasBulletin) return true;
    if (docType === 'aem'      && c.hasAEM)      return true;
    if (docType === 'conges'   && c.hasCS)        return true;
    if (docType === 'contrat'  && c.hasContrat)   return true;
    return false;
  });
}

function keepExisting(contratId) {
  // On garde l'existant, on annule le scan
  pendingScanData = null;
  document.getElementById('scan-result-card').style.display = 'none';
  toast('✅ Document existant conservé');
  if (fileQueue.length > 0) nextInQueue();
}

function keepNew() {
  // On remplace — affiche le bouton Enregistrer
  const banner = document.querySelector('.alert-warn');
  if (banner) banner.remove();
  const btn = document.getElementById('btn-confirm-scan');
  if (btn) btn.style.display = 'block';
}

function confirmScanInline() {
  if (!pendingScanData) return;
  const d       = pendingScanData;
  const docType = d.type || currentDocType;
  const linkedId = document.getElementById('scan-contrat-select')?.value || '';

  if (docType === 'contrat') {
    const dateDebut = parseDate(d.date_debut) || parseDate(d.date_travail) || new Date().toISOString().slice(0,10);
    const dateFin   = parseDate(d.date_fin) || dateDebut;
    const match     = linkedId ? state.contrats.find(x => x.id === linkedId) : findMatchingContrat(d.employeur, dateDebut);
    if (match) {
      if (!match.sources) match.sources = {};
      match.sources.contrat = { brutV: d.cachet_brut_total||0, salaireBase: d.salaire_base||0, droits: d.droits_complementaires||0, cachets: d.cachets||0, heures: d.h_prevues||0, poste: d.poste||d.nature_contrat||'', dateDebut, dateFin };
      if (!match.dateDebut) match.dateDebut = dateDebut;
      if (!match.dateFin)   match.dateFin   = dateFin;
      recalcContrat(match);
      toast('✅ Contrat rattaché à : ' + match.employeur);
    } else {
      const c = { id: Date.now().toString(), employeur: (d.employeur||'').toUpperCase().trim(), poste: d.poste||d.nature_contrat||'', dateDebut, dateFin, paye:false, ref:'', comment:'', docs:[], sources: { contrat: { brutV: d.cachet_brut_total||0, salaireBase: d.salaire_base||0, droits: d.droits_complementaires||0, cachets: d.cachets||0, heures: d.h_prevues||0, poste: d.poste||d.nature_contrat||'' }, bulletin:null, aem:null, conges:null } };
      recalcContrat(c);
      state.contrats.push(c);
      toast('✅ Contrat enregistré');
    }

  } else if (docType === 'bulletin') {
    const mi = MONTHS.indexOf(d.mois); const an = parseInt(d.annee) || new Date().getFullYear();
    const fallback = (mi >= 0 && !isNaN(an)) ? `${an}-${String(mi+1).padStart(2,'0')}-01` : new Date().toISOString().slice(0,10);
    const dateStr = parseDate(d.date_travail) || parseDate(d.date_debut) || fallback;
    const match   = linkedId ? state.contrats.find(x => x.id === linkedId) : findMatchingContrat(d.employeur, dateStr);
    if (match) {
      if (!match.sources) match.sources = {};
      match.sources.bulletin = { brutV: d.salaire_brut||0, netImp: d.net_imposable||0, netV: d.net_percu||0, pasV: d.pas_preleve||0, tauxPas: d.taux_pas||0, heures: d.h_totales||0, cachets: d.cachets||0, poste: d.emploi_aem||d.poste||'' };
      recalcContrat(match);
      toast('✅ Bulletin rattaché à : ' + match.employeur);
    } else {
      const c = { id: Date.now().toString(), employeur: (d.employeur||'').toUpperCase().trim(), poste:'', dateDebut: dateStr, dateFin: dateStr, paye:false, ref:'', comment:'', docs:[], sources: { contrat:null, bulletin: { brutV: d.salaire_brut||0, netImp: d.net_imposable||0, netV: d.net_percu||0, pasV: d.pas_preleve||0, tauxPas: d.taux_pas||0, heures: d.h_totales||0, cachets: d.cachets||0 }, aem:null, conges:null } };
      recalcContrat(c);
      state.contrats.push(c);
      toast('✅ Bulletin → nouveau contrat');
    }

  } else if (docType === 'aem') {
    const mi = MONTHS.indexOf(d.mois); const an = parseInt(d.annee) || new Date().getFullYear();
    const fallback = (mi >= 0 && !isNaN(an)) ? `${an}-${String(mi+1).padStart(2,'0')}-01` : new Date().toISOString().slice(0,10);
    const dateStr = parseDate(d.date_debut) || parseDate(d.date_travail) || fallback;
    const match   = linkedId ? state.contrats.find(x => x.id === linkedId) : findMatchingContrat(d.employeur, dateStr);
    if (match) {
      if (!match.sources) match.sources = {};
      match.sources.aem = { brutV: d.salaire_brut||0, cachets: d.nb_cachets||0, heures: d.nb_heures||0, poste: d.emploi_aem||d.poste||'' };
      recalcContrat(match);
      toast('✅ AEM rattachée à : ' + match.employeur);
    } else {
      const c = { id: Date.now().toString(), employeur: (d.employeur||'').toUpperCase().trim(), poste:'AEM', dateDebut: dateStr, dateFin: dateStr, paye:false, ref:'AEM', comment:'', docs:[], sources: { contrat:null, bulletin:null, aem: { brutV: d.salaire_brut||0, cachets: d.nb_cachets || d.cachets||0, heures: d.nb_heures||0 }, conges:null } };
      recalcContrat(c);
      state.contrats.push(c);
      toast('✅ AEM → nouveau contrat');
    }

  } else if (docType === 'conges') {
    const dateStr = parseDate(d.date_debut) || parseDate(d.date_fin) || new Date().toISOString().slice(0,10);
    const match   = linkedId ? state.contrats.find(x => x.id === linkedId) : findMatchingContrat(d.employeur, dateStr);
    if (match) {
      if (!match.sources) match.sources = {};
      match.sources.conges = { brutV: d.salaire_brut||0, cachets: d.nb_jours_cachets||0 };
      recalcContrat(match);
      toast('✅ Congés Spectacle rattachés à : ' + match.employeur);
    } else {
      const c = { id: Date.now().toString(), employeur: (d.employeur||'').toUpperCase().trim(), poste: d.emploi||'', dateDebut: parseDate(d.date_debut)||dateStr, dateFin: parseDate(d.date_fin)||dateStr, paye:false, ref:'', comment:'', docs:[], sources: { contrat:null, bulletin:null, aem:null, conges: { brutV: d.salaire_brut||0, cachets: d.nb_jours_cachets||0 } } };
      recalcContrat(c);
      state.contrats.push(c);
      toast('✅ Congés Spectacle → nouveau contrat');
    }

  } else if (docType === 'frais') {
    state.frais.push({
      id: Date.now().toString(),
      cat: d.categorie||'autre',
      desc: d.description||d.nature||'',
      date: parseDate(d.date)||new Date().toISOString().slice(0,10),
      montant: d.montant_ttc||0, km:0, repas:0, ref:'',
      contratId: linkedId||''
    });
    toast('✅ Frais enregistré');
  }

  saveState();
  pendingScanData = null;
  document.getElementById('scan-result-card').style.display = 'none';
  renderBilan();
  if (fileQueue.length > 0) nextInQueue();
}

// ── NAVIGATION VERS SCANNER ──
function goScanFor(contratId, docType) {
  closeDetail();
  showPage('scan');
  currentDocType = docType;
  document.getElementById('scan-contrat-link-card').style.display = 'block';
  populateContratSelects();
  const sel = document.getElementById('scan-contrat-select');
  if (sel) sel.value = contratId;
  toast('📄 Scanne le document manquant — ' + docType);
}

// ── UPLOAD INLINE DEPUIS FICHE CONTRAT ──
function openInlineUpload(contratId, docType) {
  const typeLabels = {contrat:'Contrat', bulletin:'Bulletin de salaire', aem:'AEM', conges:'Congés Spectacle'};
  const contrat = state.contrats.find(x => x.id === contratId);
  if (!contrat) return;

  // Retire un éventuel uploader inline déjà ouvert
  document.getElementById('inline-upload-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'inline-upload-panel';
  panel.className = 'card';
  panel.style.cssText = 'background:var(--accent-light);border:1.5px solid var(--accent);margin-top:12px;';
  panel.innerHTML = `
    <div class="card-head">
      <div class="card-head-title" style="color:var(--accent);">📎 Ajouter — ${typeLabels[docType]}</div>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('inline-upload-panel').remove()">✕</button>
    </div>
    <div style="font-size:12px;color:var(--ink2);margin-bottom:12px;">
      Pour : <strong>${contrat.employeur}</strong> · ${fmtDate(contrat.dateDebut)}
    </div>
    <label style="display:block;border:2px dashed var(--accent);border-radius:8px;padding:20px;text-align:center;cursor:pointer;background:var(--surface);position:relative;">
      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,.tiff,.bmp" style="position:absolute;inset:0;opacity:0;cursor:pointer;" onchange="handleInlineFile(event,'${contratId}','${docType}')">
      <div style="font-size:24px;margin-bottom:6px;">📂</div>
      <div style="font-size:13px;font-weight:600;color:var(--accent);">Glisse ou clique pour uploader</div>
      <div style="font-size:11px;color:var(--muted);margin-top:4px;">PDF, JPG, PNG, HEIC…</div>
    </label>
    <div id="inline-upload-result" style="margin-top:12px;"></div>
  `;

  // Insère juste après la card "Documents rattachés"
  const docsCard = document.getElementById('docs-card-' + contratId);
  if (docsCard) {
    docsCard.insertAdjacentElement('afterend', panel);
  } else {
    const dp   = document.getElementById('desktop-detail-body');
    const body = document.getElementById('detail-body');
    const target = (dp && dp.children.length > 0) ? dp : body;
    if (target) target.appendChild(panel);
  }
}

async function handleInlineFile(event, contratId, docType) {
  const file = event.target.files[0];
  if (!file) return;
  const resultEl = document.getElementById('inline-upload-result');
  if (!resultEl) return;

  resultEl.innerHTML = '<div class="loading-block"><div class="loader"></div><div style="font-size:12px;color:var(--muted);margin-top:8px;">Analyse en cours…</div></div>';

  try {
    const base64 = await fileToBase64(file);
    const res    = await appsScriptPost({ action: 'scanDoc', docType, base64Data: base64, mediaType: file.type });

    if (!res.ok) {
      resultEl.innerHTML = '<div class="alert alert-err">❌ ' + (res.error||'Erreur') + '</div>';
      return;
    }

    const d       = res.data;
    const contrat = state.contrats.find(x => x.id === contratId);

    // Vérification cohérence
    const issues = checkInlineCoherence(d, contrat, docType);

    if (issues.length > 0) {
      resultEl.innerHTML = '<div class="alert alert-err" style="flex-direction:column;">'
        + '<strong>⚠️ Incohérences détectées</strong>'
        + '<ul style="margin-top:8px;padding-left:16px;font-size:12px;">'
        + issues.map(i => '<li>' + i + '</li>').join('')
        + '</ul>'
        + '<div style="font-size:11px;margin-top:8px;color:var(--red);">Ce document ne semble pas correspondre à ce contrat. Utilise la page Scanner pour l\'importer manuellement.</div>'
        + '</div>';
      return;
    }

   // Alerte si type détecté ≠ type cliqué
    const typeLabels = {contrat:'📝 Contrat', bulletin:'📄 Bulletin', aem:'📋 AEM', conges:'🌴 Congés Spectacle'};
    if (d.type && d.type !== docType) {
      resultEl.innerHTML = '<div class="alert alert-warn" style="flex-direction:column;gap:10px;">'
        + '<strong>⚠️ Type de document différent</strong>'
        + '<div style="font-size:12px;">Vous avez cliqué sur <strong>' + (typeLabels[docType]||docType) + '</strong> mais l\'IA a détecté un <strong>' + (typeLabels[d.type]||d.type) + '</strong>.</div>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">'
        + '<button class="btn btn-primary btn-sm" onclick="confirmInlineUpload(' + JSON.stringify(d).replace(/"/g,'&quot;') + ',\'' + contratId + '\',\'' + d.type + '\')">✓ Charger comme ' + (typeLabels[d.type]||d.type) + '</button>'
        + '<button class="btn btn-ghost btn-sm" onclick="confirmInlineUpload(' + JSON.stringify(d).replace(/"/g,'&quot;') + ',\'' + contratId + '\',\'' + docType + '\')">⚠️ Forcer comme ' + (typeLabels[docType]||docType) + '</button>'
        + '</div>'
        + '</div>';
      return;
    }

    resultEl.innerHTML = '<div class="alert alert-ok" style="flex-direction:column;gap:8px;">'
      + '<strong>✅ Document reconnu : ' + (typeLabels[d.type]||docType) + '</strong>'
      + '<div style="font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:4px;">'
      + (d.employeur ? '<span>🏢 ' + d.employeur + '</span>' : '')
      + (d.salaire_brut ? '<span>💰 ' + fmt(d.salaire_brut) + ' brut</span>' : '')
      + (d.date_travail||d.date_debut ? '<span>📅 ' + fmtDate(parseDate(d.date_travail||d.date_debut)) + '</span>' : '')
      + (d.cachets||d.nb_cachets ? '<span>🎭 ' + (d.cachets||d.nb_cachets) + ' cachet(s)</span>' : '')
      + '</div>'
      + '<button class="btn btn-primary btn-sm" style="margin-top:4px;" onclick="confirmInlineUpload(' + JSON.stringify(d).replace(/"/g,'&quot;') + ',\'' + contratId + '\',\'' + docType + '\')">✓ Valider et rattacher</button>'
      + '</div>';

  } catch(e) {
    resultEl.innerHTML = '<div class="alert alert-err">❌ ' + e.message + '</div>';
  }
}

function checkInlineCoherence(d, contrat, docType) {
  const issues = [];
  const empNorm  = (d.employeur||'').toUpperCase().replace(/\s+/g,'');
  const cNorm    = contrat.employeur.toUpperCase().replace(/\s+/g,'');
  const sameEmp  = cNorm === empNorm || cNorm.includes(empNorm.slice(0,5)) || empNorm.includes(cNorm.slice(0,5));
  if (d.employeur && !sameEmp) {
    issues.push('Employeur différent : document indique "' + d.employeur + '", contrat indique "' + contrat.employeur + '"');
  }
  // Vérification date
  const docDate = parseDate(d.date_travail) || parseDate(d.date_debut) || parseDate(d.date_fin);
  if (docDate && contrat.dateDebut) {
    const dd = new Date(docDate + 'T12:00:00');
    const cd = new Date(contrat.dateDebut + 'T12:00:00');
    if (dd.getFullYear() !== cd.getFullYear() || dd.getMonth() !== cd.getMonth()) {
      issues.push('Période différente : document indique ' + fmtDate(docDate) + ', contrat indique ' + fmtDate(contrat.dateDebut));
    }
  }
  // Vérification montant (tolérance 10%)
 // Pour les contrats, ne pas vérifier le montant car le contrat peut afficher
  // uniquement la base sans les droits complémentaires (DADR, etc.)
  // L'AEM prévaut toujours sur le contrat pour les montants
  if (docType !== 'contrat') {
    const docBrut = d.salaire_brut || d.cachet_brut_total || 0;
    if (docBrut > 0 && contrat.brutV > 0) {
      const diff = Math.abs(docBrut - contrat.brutV) / Math.max(docBrut, contrat.brutV);
      if (diff > 0.35) { // tolérance 35% pour couvrir les écarts base/total
        issues.push('Salaire brut très différent : document indique ' + fmt(docBrut) + ', contrat indique ' + fmt(contrat.brutV));
      }
    }
  }
  return issues;
}

function confirmInlineUpload(d, contratId, docType) {
  const contrat = state.contrats.find(x => x.id === contratId);
  if (!contrat) return;
  if (!contrat.sources) contrat.sources = {};

  if (docType === 'bulletin') {
    contrat.sources.bulletin = { brutV: d.salaire_brut||0, netImp: d.net_imposable||0, netV: d.net_percu||0, pasV: d.pas_preleve||0, tauxPas: d.taux_pas||0, heures: d.h_totales||0, cachets: d.cachets||0, poste: d.emploi_aem||d.poste||'' };
  } else if (docType === 'aem') {
    contrat.sources.aem = { brutV: d.salaire_brut||0, cachets: d.nb_cachets || d.cachets||0, heures: d.nb_heures||0, poste: d.emploi_aem||d.poste||'' };
  } else if (docType === 'conges') {
    contrat.sources.conges = { brutV: d.salaire_brut||0, cachets: d.nb_jours_cachets||0 };
  } else if (docType === 'contrat') {
    contrat.sources.contrat = { brutV: d.cachet_brut_total||0, cachets: d.cachets||0, heures: d.h_prevues||0, poste: d.poste||'' };
  }

  recalcContrat(contrat);
  saveState();
  document.getElementById('inline-upload-panel')?.remove();
  renderDetailBody(contrat);
  toast('✅ Document rattaché à ' + contrat.employeur);
}
