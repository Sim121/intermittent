/* ============================================================
   INTERMITTENT — scan.js
   Scan de documents, reconnaissance IA, rattachement
   ============================================================ */

let fileQueue      = [];
let fileQueueIndex = 0;
let currentAbortController = null;
let pendingExtraDocs = [];

// ── UPLOAD ──
function setDocType(el, type) {
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  currentDocType = type;
  // Rattachement visible si type spécifique
  document.getElementById('scan-contrat-link-card').style.display =
    (type !== 'auto') ? 'block' : 'none';
  // Si type forcé : limite à 1 fichier
  const input = document.getElementById('file-input');
  if (input) input.multiple = (type === 'auto');
  // Info utilisateur
  if (type !== 'auto') {
    toast('⚠️ Type forcé — un seul fichier à la fois');
  }
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropzone').classList.remove('active');
  const files = Array.from(e.dataTransfer.files).slice(0, 20);
  if (!files.length) return;
  if (e.dataTransfer.files.length > 20) toast('⚠️ Maximum 20 fichiers — seuls les 20 premiers sont traités');
  if (files.length === 1) processFile(files[0]);
  else processFileQueue(files);
}

function handleFile(e) {
  const files = Array.from(e.target.files).slice(0, 20);
  if (!files.length) return;
  if (e.target.files.length > 20) toast('⚠️ Maximum 20 fichiers — seuls les 20 premiers sont traités');
  if (files.length === 1) { processFile(files[0]); return; }
  processFileQueue(files);
}

async function processFileQueue(files) {
  fileQueue      = Array.from(files);
  fileQueueIndex = 0;
  updateScanQueueUI();
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
   updateScanQueueUI();
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
      if (res.extraDocs && res.extraDocs.length > 0) {
        toast(`📄 ${1 + res.extraDocs.length} documents détectés dans ce fichier`);
        pendingExtraDocs = res.extraDocs;
      } else {
        pendingExtraDocs = [];
      }
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

  const typeLabels = {
    contrat:'📝 Contrat', bulletin:'📄 Bulletin', aem:'📋 AEM',
    conges:'🌴 Congés Spectacle', frais:'🧾 Frais',
    notification_ft:'🏛️ Notif. ARE', courrier_csg:'📮 Courrier CSG',
    courrier_ft:'📑 Courrier FT', droits_auteur:'🎵 Droits d\'auteur',
    releve_conges:'🌴 Relevé Congés', document_ft:'📋 Doc FT autre'
  };
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
      + '</div>'
      + '<button class="btn btn-ghost btn-sm" style="width:100%;margin-top:8px;" onclick="forceNewContrat()">➕ Forcer la création d\'un nouveau contrat</button>'
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
          + '<button onclick="toggleScanField(\'' + k + '\')" style="background:none;border:none;cursor:pointer;padding:2px;font-size:12px;flex-shrink:0;" title="Modifier">'
          + (d._manualEdits?.includes(k) ? '✏️🔵' : '✏️')
          + '</button>'
          + '</div>'
          + '</div>';
      }).join('');

  card.innerHTML = '<div class="card">'
    + '<div class="card-head"><div class="card-head-title">Extraction IA</div><span class="tag tag-green">✓ OK</span></div>'
    + typeSelector
    + matchInfo
    + rows
    + '<button class="btn btn-primary" id="btn-confirm-scan" onclick="confirmScanInline()" style="margin-top:16px;">✓ Enregistrer comme ' + (typeLabels[d.type]||d.type) + '</button>'
    + (d.type === 'contrat' ? '<button class="btn btn-ghost" style="margin-top:8px;width:100%;" onclick="showMultiDatesPanel()">📅 Ce contrat couvre plusieurs dates</button>' : '')
    + '<div id="multi-dates-panel" style="display:none;margin-top:12px;"></div>'
    + '<button class="btn btn-ghost" style="margin-top:8px;width:100%;" onclick="cancelScan()">Annuler</button>'
    + '</div>';
}

function forceNewContrat() {
  const sel = document.getElementById('scan-contrat-select');
  if (sel) sel.value = '';
  const banner = document.querySelector('.alert-warn');
  if (banner) banner.style.display = 'none';
  toast('➕ Nouveau contrat sera créé à la validation');
}

// ── ACTIONS ──
function overrideDocType(type) {
  if (pendingScanData) {
    pendingScanData.type = type;
    const typeLabels = {
    contrat:'📝 Contrat', bulletin:'📄 Bulletin', aem:'📋 AEM',
    conges:'🌴 Congés Spectacle', frais:'🧾 Frais',
    notification_ft:'🏛️ Notif. ARE', courrier_csg:'📮 Courrier CSG',
    courrier_ft:'📑 Courrier FT', droits_auteur:'🎵 Droits d\'auteur',
    releve_conges:'🌴 Relevé Congés', document_ft:'📋 Doc FT autre'
  };
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

function showMultiDatesPanel() {
  const panel = document.getElementById('multi-dates-panel');
  if (!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="card" style="background:var(--accent-light);border:1.5px solid var(--accent);">
      <div class="card-head"><div class="card-head-title" style="color:var(--accent);">📅 Dates multiples</div></div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">
        Ajoute chaque date de représentation. Un contrat séparé sera créé pour chaque date, avec les mêmes informations employeur/poste/montant.
      </div>
      <div id="multi-dates-list"></div>
      <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:8px;" onclick="addMultiDate()">＋ Ajouter une date</button>
      <button class="btn btn-primary" style="width:100%;margin-top:8px;" onclick="confirmMultiDates()">✓ Créer les contrats</button>
    </div>`;
  // Ajoute une première date par défaut
  addMultiDate();
}

function addMultiDate() {
  const list = document.getElementById('multi-dates-list');
  if (!list) return;
  const i = list.children.length;
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';
  div.innerHTML = `
    <input type="date" class="multi-date-input" style="flex:1;padding:8px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;background:var(--surface);">
    <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:16px;">✕</button>`;
  list.appendChild(div);
}

function confirmMultiDates() {
  const d = pendingScanData;
  if (!d) return;

  const inputs = document.querySelectorAll('.multi-date-input');
  const dates  = Array.from(inputs)
    .map(inp => inp.value)
    .filter(v => v && /^\d{4}-\d{2}-\d{2}$/.test(v))
    .sort();

  if (!dates.length) { toast('❌ Ajoute au moins une date'); return; }

  // Crée un contrat par date
  let created = 0;
  dates.forEach(date => {
    const existing = state.contrats.find(c =>
      c.employeur === (d.employeur||'').toUpperCase().trim() &&
      c.dateDebut === date
    );
    if (existing) {
      // Rattache le contrat scanné à l'existant
      if (!existing.sources) existing.sources = {};
      existing.sources.contrat = {
        brutV:       d.cachet_brut_total || d.salaire_brut || 0,
        salaireBase: d.salaire_base      || 0,
        droits:      d.droits_complementaires || 0,
        cachets:     d.cachets           || 0,
        heures:      d.h_prevues || d.h_totales || 0,
        poste:       d.poste || d.nature_contrat || '',
        dateDebut:   date,
        dateFin:     date
      };
      recalcContrat(existing);
    } else {
      // Crée un nouveau contrat
      const c = {
        id:        Date.now().toString() + Math.random().toString(36).slice(2,6),
        employeur: (d.employeur||'').toUpperCase().trim(),
        poste:     d.poste || d.nature_contrat || '',
        dateDebut: date,
        dateFin:   date,
        paye: false, ref: '', comment: '', docs: [],
        sources: {
          contrat: {
            brutV:       d.cachet_brut_total || d.salaire_brut || 0,
            salaireBase: d.salaire_base      || 0,
            droits:      d.droits_complementaires || 0,
            cachets:     d.cachets           || 0,
            heures:      d.h_prevues || d.h_totales || 0,
            poste:       d.poste || d.nature_contrat || '',
            dateDebut:   date,
            dateFin:     date
          },
          bulletin: null, aem: null, conges: null
        }
      };
      recalcContrat(c);
      state.contrats.push(c);
      created++;
    }
  });

  saveState();
  pendingScanData = null;
  document.getElementById('scan-result-card').style.display = 'none';
  renderContrats();
  renderBilan();
  toast(`✅ ${created} contrat${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''} — rattache maintenant les bulletins et AEM`);
  if (fileQueue.length > 0) nextInQueue();
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
  const empNorm  = employeur.toUpperCase().replace(/\s+/g, '').trim();
  if (!empNorm || empNorm.length < 3) return null;
  const parsedDate = parseDate(dateStr);
  if (!parsedDate) return null;

  // 1. Cherche d'abord un match EXACT sur employeur + date exacte
  const exactMatch = state.contrats.find(c => {
    if (!c.dateDebut) return false;
    const cNorm = c.employeur.toUpperCase().replace(/\s+/g, '').trim();
    const sameEmp = cNorm === empNorm ||
      cNorm.includes(empNorm.slice(0,6)) ||
      empNorm.includes(cNorm.slice(0,6));
    return sameEmp && c.dateDebut === parsedDate;
  });
  if (exactMatch) return exactMatch;

  // 2. Cherche un match sur employeur + même mois UNIQUEMENT si le contrat
  //    n'a pas encore de bulletin/AEM rattaché (évite d'écraser un contrat complet)
  const [y, m] = parsedDate.split('-').map(Number);
  if (!y || !m || isNaN(y) || isNaN(m)) return null;

  const candidates = state.contrats.filter(c => {
    if (!c.dateDebut) return false;
    const cd   = new Date(c.dateDebut + 'T12:00:00');
    const cNorm = c.employeur.toUpperCase().replace(/\s+/g, '').trim();
    const sameEmp = cNorm === empNorm ||
      cNorm.includes(empNorm.slice(0,6)) ||
      empNorm.includes(cNorm.slice(0,6));
    const sameMois = cd.getFullYear() === y && cd.getMonth() === m - 1;
    // N'accepte que les contrats sans bulletin ET sans AEM déjà rattachés
    const isEmpty = !c.sources?.bulletin && !c.sources?.aem;
    return sameEmp && sameMois && isEmpty;
  });

  if (!candidates.length) return null;

  return candidates.sort((a, b) =>
    (a.dateDebut||'').localeCompare(b.dateDebut||'')
  )[0];
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
  // Trace les champs modifiés manuellement
  if (!pendingScanData._manualEdits) pendingScanData._manualEdits = [];
  if (!pendingScanData._manualEdits.includes(key)) pendingScanData._manualEdits.push(key);
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
  const dateStr = parseDate(d.date_travail) || parseDate(d.date_debut) || parseDate(d.date_fin) || (() => {
    const mi = MONTHS.indexOf(d.mois);
    const an = parseInt(d.annee);
    return (mi >= 0 && !isNaN(an)) ? `${an}-${String(mi+1).padStart(2,'0')}-01` : null;
  })();
  if (!dateStr) return null;

  const empNorm = (d.employeur||'').toUpperCase().replace(/\s+/g,'');
  const [y, m, day] = dateStr.split('-').map(Number);
  const hasExactDay = day && day > 1; // Si jour précis (pas juste un 1er du mois par défaut)

  return state.contrats.find(c => {
    if (!c.dateDebut) return false;
    const cd    = new Date(c.dateDebut + 'T12:00:00');
    const cNorm = c.employeur.toUpperCase().replace(/\s+/g,'');

    const sameEmp = cNorm === empNorm ||
      cNorm.includes(empNorm.slice(0,6)) ||
      empNorm.includes(cNorm.slice(0,6));
    if (!sameEmp) return false;

    // Si on a une date exacte → compare date exacte
    if (hasExactDay) {
      const sameDateExact = c.dateDebut === dateStr;
      if (!sameDateExact) return false;
    } else {
      // Sinon compare par mois
      if (cd.getFullYear() !== y || cd.getMonth() !== m - 1) return false;
    }

    // Vérifie si ce type de document est déjà présent
    if (docType === 'bulletin' && c.sources?.bulletin) return true;
    if (docType === 'aem'      && c.sources?.aem)      return true;
    if (docType === 'conges'   && c.sources?.conges)   return true;
    if (docType === 'contrat'  && c.sources?.contrat)  return true;
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

  // Détecte notification FT en priorité
  if (d.type === 'notification_ft' || docType === 'notification_ft') {
    handleNotificationFT(d);
    pendingScanData = null;
    document.getElementById('scan-result-card').style.display = 'none';
    if (fileQueue.length > 0) nextInQueue();
    return;
  }

  // Documents France Travail et autres — pas des contrats
  if (['courrier_csg', 'courrier_ft', 'document_ft'].includes(d.type || docType)) {
    if (d.type === 'courrier_csg' && d.taux_csg !== undefined) {
      state.config.tauxCsg = d.taux_csg;
      toast('✅ Taux CSG mis à jour : ' + d.taux_csg + '%');
      saveState();
    } else {
      toast('📋 Document FT archivé — ' + (d.sous_type || d.type));
    }
    pendingScanData = null;
    document.getElementById('scan-result-card').style.display = 'none';
    if (fileQueue.length > 0) nextInQueue();
    return;
  }

  // Droits d'auteur
  if (['droits_auteur', 'releve_conges'].includes(d.type || docType)) {
    toast('📋 Document archivé : ' + (d.organisme || d.type) + (d.montant_ttc ? ' — ' + fmt(d.montant_ttc) : ''));
    // TODO : future section droits d'auteur
    pendingScanData = null;
    document.getElementById('scan-result-card').style.display = 'none';
    if (fileQueue.length > 0) nextInQueue();
    return;
  }
   
  if (docType === 'contrat') {
    const dateDebut = parseDate(d.date_debut) || parseDate(d.date_travail) || new Date().toISOString().slice(0,10);
    const dateFin   = parseDate(d.date_fin) || dateDebut;
    const match     = linkedId ? state.contrats.find(x => x.id === linkedId) : findMatchingContrat(d.employeur, dateDebut);
    if (match) {
      if (!match.sources) match.sources = {};match.sources.contrat = { 
        brutV:       d.cachet_brut_total || d.salaire_brut || 0,
        salaireBase: d.salaire_base      || 0,
        droits:      d.droits_complementaires || 0,
        cachets:     d.cachets           || 0,
        heures:      d.h_prevues || d.h_totales || d.nb_heures || 0,
        poste:       d.poste || d.nature_contrat || '',
        dateDebut,
        dateFin
      };
      if (!match.dateDebut) match.dateDebut = dateDebut;
      if (!match.dateFin)   match.dateFin   = dateFin;
      recalcContrat(match);
      toast('✅ Contrat rattaché à : ' + match.employeur);
    } else {const c = { 
  id: Date.now().toString(), 
  employeur: (d.employeur||'').toUpperCase().trim(), 
  poste: d.poste||d.nature_contrat||'', 
  dateDebut, dateFin, 
  paye:false, ref:'', comment:'', docs:[],
  sources: { 
    contrat: { 
      brutV:       d.cachet_brut_total || d.salaire_brut || 0,
      salaireBase: d.salaire_base      || 0,
      droits:      d.droits_complementaires || 0,
      cachets:     d.cachets           || 0,
      heures:      d.h_prevues || d.h_totales || d.nb_heures || 0,
      poste:       d.poste || d.nature_contrat || '',
      dateDebut,
      dateFin
    }, 
    bulletin: null, aem: null, conges: null 
  } 
};
      recalcContrat(c);
      state.contrats.push(c);
      toast('✅ Contrat enregistré');
    }

  } else if (docType === 'bulletin') {
    const mi = MONTHS.indexOf(d.mois); const an = parseInt(d.annee) || new Date().getFullYear();
    const fallback = (mi >= 0 && !isNaN(an)) ? `${an}-${String(mi+1).padStart(2,'0')}-01` : new Date().toISOString().slice(0,10);
    const dateStr  = parseDate(d.date_debut) || fallback;
    const match   = linkedId ? state.contrats.find(x => x.id === linkedId) : findMatchingContrat(d.employeur, dateStr);
    if (match) {
      if (!match.sources) match.sources = {};match.sources.bulletin = { 
  brutV:   d.salaire_brut    || 0,
  netImp:  d.net_imposable   || 0,
  netV:    d.net_percu       || 0,
  pasV:    d.pas_preleve     || 0,
  tauxPas: d.taux_pas        || 0,
  heures:  d.h_totales       || d.nb_heures || 0,
  cachets: d.cachets         || d.nb_cachets || 0,
  poste:   d.emploi_aem || d.poste || '',
  datePaie: parseDate(d.date_paiement) || ''
};
      recalcContrat(match);
      toast('✅ Bulletin rattaché à : ' + match.employeur);
    } else {const c = { 
  id: Date.now().toString(), 
  employeur: (d.employeur||'').toUpperCase().trim(), 
  poste: d.emploi_aem || d.poste || '',
  dateDebut: parseDate(d.date_debut) || dateStr, 
  dateFin:   parseDate(d.date_fin)   || dateStr, 
  paye:false, ref:'', comment:'', docs:[],
  sources: { 
    contrat: null, 
    bulletin: { 
      brutV:   d.salaire_brut  || 0,
      netImp:  d.net_imposable || 0,
      netV:    d.net_percu     || 0,
      pasV:    d.pas_preleve   || 0,
      tauxPas: d.taux_pas      || 0,
      heures:  d.h_totales     || d.nb_heures || 0,
      cachets: d.cachets       || d.nb_cachets || 0,
      poste:   d.emploi_aem || d.poste || '',
      datePaie: parseDate(d.date_paiement) || ''
    }, 
    aem: null, conges: null 
  } 
};
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
// Ajoute mention si données modifiées manuellement
  if (pendingScanData?._manualEdits?.length > 0) {
    const contratModifie = state.contrats[state.contrats.length - 1];
    // Cherche le contrat qui vient d'être créé/modifié
    const cible = linkedId ? state.contrats.find(x => x.id === linkedId) : state.contrats[state.contrats.length - 1];
    if (cible) {
      cible.hasManualEdits = true;
      cible.manualEditFields = pendingScanData._manualEdits;
      if (!cible.comment) cible.comment = '';
      const mention = '⚠️ Données modifiées manuellement à l\'import : ' + pendingScanData._manualEdits.join(', ');
      if (!cible.comment.includes('modifiées manuellement')) {
        cible.comment = cible.comment ? cible.comment + '\n' + mention : mention;
      }
    }
  }
   
// Auto-marquer payé si contrat > 1 an
  state.contrats.forEach(c => {
    if (c.paye !== true && c.dateDebut) {
      const debut = new Date(c.dateDebut + 'T12:00:00');
      const unAn  = new Date();
      unAn.setFullYear(unAn.getFullYear() - 1);
      if (debut < unAn) {
        c.paye = true;
        // Date de paiement estimée : J+30 après début ou date de paie BS
        const datePaie = c.sources?.bulletin?.datePaie
          ? c.sources.bulletin.datePaie
          : new Date(debut.getTime() + 30 * 86400000).toISOString().slice(0,10);
        c.datePaiement = datePaie;
        c.paiementAuto = true;
        toast(`📅 ${c.employeur} marqué payé automatiquement (> 1 an)`);
      }
    }
  });
   
  saveState();
  pendingScanData = null;

  // Traite les documents supplémentaires détectés dans le même fichier
  if (pendingExtraDocs.length > 0) {
    const next = pendingExtraDocs.shift();
    setTimeout(() => {
      pendingScanData = next;
      toast(`📄 Document supplémentaire détecté : ${next.type}`);
      showScanResult(next);
    }, 500);
    return;
  }

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
    contrat.sources.bulletin = { brutV: d.salaire_brut||0, netImp: d.net_imposable||0, netV: d.net_percu||0, pasV: d.pas_preleve||0, tauxPas: d.taux_pas||0, heures: d.h_totales||0, cachets: d.cachets||0, poste: d.emploi_aem||d.poste||'', datePaie: parseDate(d.date_paiement)||'' };
  } else if (docType === 'aem') {
    contrat.sources.aem = { brutV: d.salaire_brut||0, cachets: d.nb_cachets || d.cachets||0, heures: d.nb_heures||0, poste: d.emploi_aem||d.poste||'' };
  } else if (docType === 'conges') {
    contrat.sources.conges = { brutV: d.salaire_brut||0, cachets: d.nb_jours_cachets||0 };
  } else if (docType === 'contrat') {
    contrat.sources.contrat = { brutV: d.cachet_brut_total||0, cachets: d.cachets||0, heures: d.h_prevues||0, poste: d.poste||'' };
  }

  recalcContrat(contrat);
// Auto-marquer payé si > 1 an
  if (contrat.paye !== true && contrat.dateDebut) {
    const debut = new Date(contrat.dateDebut + 'T12:00:00');
    const unAn  = new Date(); unAn.setFullYear(unAn.getFullYear() - 1);
    if (debut < unAn) {
      contrat.paye = true;
      contrat.datePaiement = new Date(debut.getTime() + 30 * 86400000).toISOString().slice(0,10);
      contrat.paiementAuto = true;
      toast(`📅 ${contrat.employeur} marqué payé automatiquement (> 1 an)`);
    }
  }
  saveState();
  document.getElementById('inline-upload-panel')?.remove();
  renderDetailBody(contrat);
  toast('✅ Document rattaché à ' + contrat.employeur);
}

// ── MULTI-PAGES ──
let multipageFiles = [];

function showMultipagePanel() {
  multipageFiles = [];
  document.getElementById('multipage-panel').style.display = 'block';
  updateMultipageList();
}

function clearMultipage() {
  multipageFiles = [];
  document.getElementById('multipage-panel').style.display = 'none';
  document.getElementById('multipage-list').innerHTML = '';
}

function addMultipageFiles(e) {
  const newFiles = Array.from(e.target.files);
  multipageFiles = [...multipageFiles, ...newFiles].slice(0, 20);
  if (multipageFiles.length === 20) toast('⚠️ Maximum 20 pages atteint');
  updateMultipageList();
  e.target.value = '';
}

function updateMultipageList() {
  const el = document.getElementById('multipage-list');
  if (!multipageFiles.length) {
    el.innerHTML = '<div style="color:var(--muted);">Aucune page ajoutée</div>';
    return;
  }
  el.innerHTML = multipageFiles.map((f, i) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border2);">
      <span style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:var(--muted);">P${i+1}</span>
      <span style="flex:1;font-size:13px;">${f.name}</span>
      <button onclick="removeMultipagePage(${i})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:14px;">✕</button>
    </div>`
  ).join('') + `<div style="font-size:12px;color:var(--muted);margin-top:8px;">${multipageFiles.length} page(s) — seront envoyées comme un seul document</div>`;
}

function removeMultipagePage(i) {
  multipageFiles.splice(i, 1);
  updateMultipageList();
}

async function processMultipage() {
  if (!multipageFiles.length) { toast('⚠️ Ajoute au moins une page'); return; }
  if (!getAppsScriptUrl()) { showPage('settings'); return; }
  if (multipageFiles.length > 20) { toast('⚠️ Maximum 20 pages — retire les pages en trop'); return; }

  const btn = document.querySelector('#multipage-panel .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi…'; btn.style.opacity = '0.6'; }

  document.getElementById('scan-loading').style.display = 'block';
  document.getElementById('scan-result-card').style.display = 'none';

  try {
    // Convertit toutes les pages en base64
    const pages = await Promise.all(multipageFiles.map(async (f, i) => {
      const compressed = await compressImage(f, 800, 0.5);
      return { page: i + 1, base64: compressed.base64, mediaType: compressed.mediaType };
    }));

    const res = await appsScriptPost({
      action: 'scanDoc',
      docType: currentDocType,
      base64Data: pages[0].base64,
      mediaType: pages[0].mediaType,
      extraPages: pages.slice(1)
    });

    document.getElementById('scan-loading').style.display = 'none';
    if (res.ok) {
      pendingScanData = res.data;
      showScanResult(res.data);
      clearMultipage();
    } else {
      document.getElementById('scan-result-card').style.display = 'block';
      document.getElementById('scan-result-card').innerHTML = '<div class="alert alert-err">❌ ' + (res.error||'Erreur') + '</div>';
    }
  } catch(e) {
    document.getElementById('scan-loading').style.display = 'none';
    document.getElementById('scan-result-card').style.display = 'block';
    document.getElementById('scan-result-card').innerHTML = '<div class="alert alert-err">❌ ' + e.message + '</div>';
  } finally {
    const btn = document.querySelector('#multipage-panel .btn-primary');
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Analyser'; btn.style.opacity = ''; }
  }
}

function compressImage(file, maxWidth, quality) {
  return new Promise((resolve) => {
    // Les PDFs ne se compressent pas — on les passe tels quels
    if (file.type === 'application/pdf') {
      fileToBase64(file).then(base64 => resolve({ base64, mediaType: file.type }));
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale  = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = () => {
      fileToBase64(file).then(base64 => resolve({ base64, mediaType: file.type }));
    };
    img.src = url;
  });
}

// ── SCANNER CAMÉRA ──
let cameraStream    = null;
let cameraFacing    = 'environment'; // caméra arrière par défaut
let cameraPages     = []; // { base64, mediaType }

async function openCamera() {
  cameraPages = [];
  updateCameraThumbs();
  document.getElementById('camera-modal').style.display = 'flex';
  await startCamera();
}

async function startCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: cameraFacing, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    document.getElementById('camera-video').srcObject = cameraStream;
  } catch(e) {
    toast('❌ Caméra inaccessible : ' + e.message);
    closeCamera();
  }
}

async function switchCamera() {
  cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
  await startCamera();
}

function capturePhoto() {
  const video  = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  // Compression
  const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
  cameraPages.push({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
  updateCameraThumbs();
  // Flash visuel
  const flash = document.createElement('div');
  flash.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:600;opacity:0.8;pointer-events:none;';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 150);
}

function updateCameraThumbs() {
  const el    = document.getElementById('camera-thumbs');
  const empty = document.getElementById('camera-thumbs-empty');
  const count = document.getElementById('camera-count');
  const btn   = document.getElementById('camera-analyze-btn');

  count.textContent = cameraPages.length + ' page(s)';

  if (!cameraPages.length) {
    if (empty) empty.style.display = 'block';
    btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  btn.style.opacity = '1'; btn.style.pointerEvents = '';

  // Retire les anciennes thumbs
  el.querySelectorAll('.cam-thumb').forEach(t => t.remove());

  cameraPages.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'cam-thumb';
    div.style.cssText = 'position:relative;flex-shrink:0;';
    div.innerHTML = `
      <img src="data:image/jpeg;base64,${p.base64}" style="height:56px;width:40px;object-fit:cover;border-radius:4px;border:2px solid #fff;">
      <div style="position:absolute;top:-4px;right:-4px;background:#fff;color:#000;border-radius:50%;width:16px;height:16px;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;">${i+1}</div>
      <button onclick="removeCameraPage(${i})" style="position:absolute;bottom:-4px;right:-4px;background:var(--red);border:none;color:#fff;border-radius:50%;width:16px;height:16px;font-size:9px;cursor:pointer;padding:0;">✕</button>`;
    el.appendChild(div);
  });
}

function removeCameraPage(i) {
  cameraPages.splice(i, 1);
  updateCameraThumbs();
}

async function analyzeCameraPages() {
  if (!cameraPages.length) return;
  const btn = document.getElementById('camera-analyze-btn');
  btn.textContent = '⏳'; btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none';

  // Transfert vers multipageFiles et ferme la caméra
  closeCamera();

  // Lance l'analyse directement
  document.getElementById('scan-loading').style.display = 'block';
  document.getElementById('scan-result-card').style.display = 'none';

  try {
    const res = await appsScriptPost({
      action: 'scanDoc',
      docType: currentDocType,
      base64Data: cameraPages[0].base64,
      mediaType: cameraPages[0].mediaType,
      extraPages: cameraPages.slice(1)
    });

    document.getElementById('scan-loading').style.display = 'none';
    if (res.ok) {
      pendingScanData = res.data;
      if (res.extraDocs?.length > 0) pendingExtraDocs = res.extraDocs;
      showScanResult(res.data);
    } else {
      document.getElementById('scan-result-card').style.display = 'block';
      document.getElementById('scan-result-card').innerHTML = '<div class="alert alert-err">❌ ' + (res.error||'Erreur') + '</div>';
    }
  } catch(e) {
    document.getElementById('scan-loading').style.display = 'none';
    document.getElementById('scan-result-card').style.display = 'block';
    document.getElementById('scan-result-card').innerHTML = '<div class="alert alert-err">❌ ' + e.message + '</div>';
  }
}

function closeCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  document.getElementById('camera-modal').style.display = 'none';
}

// ── FILE D'ATTENTE VISUELLE ──
function updateScanQueueUI() {
  const panel = document.getElementById('scan-queue-panel');
  const list  = document.getElementById('scan-queue-list');
  if (!panel || !list) return;
  if (!fileQueue.length) { panel.style.display = 'none'; return; }

  panel.style.display = 'block';

  // Barre de progression globale
  const total    = fileQueue.length;
  const done     = fileQueueIndex;
  const pct      = Math.round((done / total) * 100);

  const progressHtml = `
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);margin-bottom:6px;">
        <span>Document ${Math.min(done + 1, total)} / ${total}</span>
        <span>${pct}%</span>
      </div>
      <div style="height:6px;background:var(--bg2);border-radius:3px;border:1.5px solid var(--border);overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:3px;transition:width .4s ease;"></div>
      </div>
    </div>`;

  // Liste des fichiers avec statut
  const filesHtml = fileQueue.map((f, i) => {
    let icon, style;
    if (i < fileQueueIndex) {
      icon = '✅'; style = 'color:var(--green);';
    } else if (i === fileQueueIndex) {
      icon = '<div class="loader" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;"></div>';
      style = 'color:var(--accent);font-weight:700;';
    } else {
      icon = '⏳'; style = 'color:var(--muted);';
    }
    const isNext = i > fileQueueIndex;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border2);">
        <span style="flex-shrink:0;width:20px;text-align:center;">${icon}</span>
        <span style="flex:1;font-size:13px;${style}overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
        ${isNext ? `<button onclick="removeFromQueue(${i})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:13px;flex-shrink:0;padding:2px 4px;">✕</button>` : ''}
      </div>`;
  }).join('');

  list.innerHTML = progressHtml + filesHtml;
}

function removeFromQueue(index) {
  fileQueue.splice(index, 1);
  updateScanQueueUI();
  toast('🗑️ Document retiré de la file');
}

function clearScanQueue() {
  fileQueue = [];
  fileQueueIndex = 0;
  const panel = document.getElementById('scan-queue-panel');
  if (panel) panel.style.display = 'none';
  toast('🗑️ File d\'attente vidée');
}
