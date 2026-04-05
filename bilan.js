/* ============================================================
   INTERMITTENT — bilan.js
   Calculs bilan, impôts, ARE (formule officielle FT), frais réels
   ============================================================ */

// ── CALCUL ARE OFFICIEL (France Travail) ──
// AJ minimale depuis le 1er juillet 2023
const AJ_MIN    = 31.96;
const AJ_PLAF   = 174.80; // plafond depuis 1er janvier 2024
const AJ_PLANCH = { 8: 38, 10: 44 }; // planchers par annexe

// ── RENDER BILAN ──
function renderBilan() {
  const selectedYear = parseInt(document.getElementById('bilan-year-select')?.value) || new Date().getFullYear();
  const cs = state.contrats.filter(c => c.dateDebut && new Date(c.dateDebut + 'T12:00:00').getFullYear() === selectedYear);

  const tBrut   = cs.reduce((s,c) => s+(c.brutV||0), 0);
  const tNet    = cs.reduce((s,c) => s+(c.netV||0), 0);
  const tNetImp = cs.reduce((s,c) => s+(c.netImp||0), 0);
  const tPas    = cs.reduce((s,c) => s+(c.pasV||0), 0);
  const tH      = cs.reduce((s,c) => s+heuresFT(c), 0);
  const tC      = cs.reduce((s,c) => s+(c.cachets||0), 0);
  const tF      = state.frais
                    .filter(f => f.date && new Date(f.date + 'T12:00:00').getFullYear() === selectedYear)
                    .reduce((s,f) => s+(f.montant||0), 0);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  set('b-brut',    fmt(tBrut));
  set('b-net',     fmt(tNet));
  set('b-cachets', tC + ' cachet' + (tC > 1 ? 's' : ''));
  set('b-heures',  tH + ' h');
  set('b-pas',     fmt(tPas));
  set('b-frais',   fmt(tF));

  // Impôts
  const ie = calcImpots(tNetImp, tF, state.config.situation || 2);
  const tauxMoyen = tNetImp > 0 ? ((tPas / tNetImp) * 100).toFixed(1) : '—';
  set('b-taux-pas',      tauxMoyen + '% taux moyen');
  set('b-impots-estim',  fmt(ie));
  set('b-impots-payes',  fmt(tPas));
  set('b-impots-reste',  fmt(Math.max(0, ie - tPas)));

  // ARE — utilise les droits réels si disponibles, sinon calcule
  const tauxCsg  = state.config.tauxCsg || 6.2;
  const tauxPas  = state.config.tauxPas || 0;
  const sjrVal   = state.config.sjr || 0;
  const areCalc  = calcARENet(areJour, sjrVal, tauxCsg, tauxPas);

  if (tH >= 507 || state.config.areJour > 0) {
    set('q-are-jour',     fmt(areCalc.brut) + ' brut');
    set('q-are-jour-net', fmt(areCalc.netAvantPas) + ' net (avant PAS)');
    set('q-are-jour-pas', fmt(areCalc.net) + ' net (après PAS ' + tauxPas + '%)');
    set('q-are-mois',     fmt(state.config.areReel || areCalc.net * 30));
  }

  // Date anniversaire
  if (state.config.finDroits) {
    const fin    = new Date(state.config.finDroits + 'T12:00:00');
    const today  = new Date();
    const jRestants = Math.ceil((fin - today) / 86400000);
    const dateAnnivEl = document.getElementById('q-date-anniversaire');
    if (dateAnnivEl) {
      dateAnnivEl.textContent = fmtDate(state.config.finDroits)
        + (jRestants > 0 ? ` (dans ${jRestants}j)` : ' ⚠️ expiré');
    }
  }

  // Foyer
  const conjointLabel = state.config.conjointPrenom || 'Conjoint(e)';
  const conjointEl = document.getElementById('foyer-mathilde-label');
  if (conjointEl) conjointEl.textContent = conjointLabel.toUpperCase();
  set('foyer-simon',    fmt(tNet));
  set('foyer-conjoint', state.config.conjoint ? fmt(state.config.conjoint) : '—');
  set('foyer-reste',    fmt(tNet + (state.config.conjoint||0) + (state.config.areReel||0) * 12));

  // Affiche aussi le SJR calculé si on a les données
  const sjrEl = document.getElementById('q-sjr');
  if (sjrEl) sjrEl.textContent = tH >= 507 ? fmt(sjr) + '/j' : '—';

  // Progression 507h
  set('q-heures-prog', tH + ' / 507 h');
  const pct  = Math.min(100, (tH / 507) * 100);
  const fill = document.getElementById('q-heures-fill');
  if (fill) fill.style.width = pct + '%';

  const tag = document.getElementById('are-status-tag');
  if (tag) {
    tag.textContent = tH >= 507 ? '✓ 507h atteintes' : Math.round(pct) + '%';
    tag.className   = tH >= 507 ? 'tag tag-green' : 'tag tag-gold';
  }

   // Dates ARE
  if (state.config.areDebut) set('q-date-ouverture', fmtDate(state.config.areDebut));
  if (state.config.finDroits) {
    const fin = new Date(state.config.finDroits + 'T12:00:00');
    const today = new Date();
    const jRestants = Math.ceil((fin - today) / 86400000);
    const dateAnnivEl = document.getElementById('q-date-anniversaire');
    if (dateAnnivEl) dateAnnivEl.textContent = fmtDate(state.config.finDroits)
      + (jRestants > 0 ? ` (dans ${jRestants}j)` : ' ⚠️ expiré');
  }
}

// ── CALCUL IMPÔTS (barème 2024) ──
function calcAREJournaliere(srBrut, nht, annexe) {
  const ann = parseInt(annexe) || 8;
  if (!srBrut || !nht || nht < 507) return 0;

  let partA, partB, partC;

  if (ann === 8) {
    // Annexe 8 — Techniciens/Ouvriers
    const srA = Math.min(srBrut, 14400) * 0.42 + Math.max(0, srBrut - 14400) * 0.05;
    partA = (AJ_MIN * srA) / 5000;
    const nhtB = Math.min(nht, 720) * 0.26 + Math.max(0, nht - 720) * 0.08;
    partB = (AJ_MIN * nhtB) / 507;
    partC = AJ_MIN * 0.40;
  } else {
    // Annexe 10 — Artistes
    const srA = Math.min(srBrut, 13700) * 0.36 + Math.max(0, srBrut - 13700) * 0.05;
    partA = (AJ_MIN * srA) / 5000;
    const nhtB = Math.min(nht, 690) * 0.26 + Math.max(0, nht - 690) * 0.08;
    partB = (AJ_MIN * nhtB) / 507;
    partC = AJ_MIN * 0.70;
  }

  const brute = partA + partB + partC;
  return Math.min(AJ_PLAF, Math.max(AJ_PLANCH[ann] || 38, brute));
}

function calcARENet(areJourBrut, sjr, tauxCsg, tauxPas) {
  const assiette    = areJourBrut * 0.9825; // abattement 1.75%
  const csg         = assiette * (tauxCsg / 100);
  const crds        = tauxCsg > 0 ? assiette * 0.005 : 0;
  const retraiteC   = sjr * 0.03;
  const netAvantPas = areJourBrut - csg - crds - retraiteC;
  const pas         = netAvantPas * ((tauxPas || 0) / 100);
  return {
    brut:       areJourBrut,
    csg,
    crds,
    retraiteC,
    netAvantPas,
    pas,
    net:        netAvantPas - pas
  };
}

// SJR officiel : SR / (NHT/8) pour annexe 8, SR / (NHT/10) pour annexe 10
function calcSJR(srBrut, nht, annexe) {
  const ann = parseInt(annexe) || 8;
  if (!nht) return 0;
  return srBrut / (nht / (ann === 10 ? 10 : 8));
}

function calcImpots(n, f, p) {
  if (!n) return 0;
  const a  = Math.min(n * 0.1, 14171);
  const r  = n - Math.max(a, f);
  const rp = r / p;
  let i = 0;
  if      (rp <= 11294)  i = 0;
  else if (rp <= 28797)  i = (rp - 11294) * 0.11;
  else if (rp <= 82341)  i = 17503 * 0.11 + (rp - 28797) * 0.30;
  else if (rp <= 177106) i = 17503 * 0.11 + 53544 * 0.30 + (rp - 82341) * 0.41;
  else                   i = 17503 * 0.11 + 53544 * 0.30 + 94765 * 0.41 + (rp - 177106) * 0.45;
  return i * p;
}

// ── SÉLECTEUR D'ANNÉES ──
function populateYearSelect() {
  const sel = document.getElementById('bilan-year-select');
  if (!sel) return;
  const years = [...new Set(
    state.contrats.map(c => c.dateDebut ? new Date(c.dateDebut + 'T12:00:00').getFullYear() : null).filter(Boolean)
  )];
  const currentYear = new Date().getFullYear();
  if (!years.includes(currentYear)) years.push(currentYear);
  years.sort((a, b) => b - a);
  const current = parseInt(sel.value) || currentYear;
  sel.innerHTML = years.map(y => `<option value="${y}" ${y === current ? 'selected' : ''}>${y}</option>`).join('');
}

// ── FRAIS ──
function renderFrais() {
  const tF      = state.frais.reduce((s,f) => s+(f.montant||0), 0);
  const tNI     = state.contrats.reduce((s,c) => s+(c.netImp||0), 0);
  const forfait = Math.min(tNI * 0.1, 14171);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('f-total', fmt(tF));

  if (tNI > 0) {
    const diff = tF - forfait;
    const el = document.getElementById('f-compare');
    if (el) { el.textContent = diff > 0 ? '+' + fmt(diff) : fmt(diff); el.className = diff > 0 ? 'val green' : 'val red'; }
    set('f-compare-sub', diff > 0 ? `Frais réels avantageux (forfait=${fmt(forfait)})` : `Forfait 10% plus avantageux (${fmt(forfait)})`);
  }

  const bycat = {};
  state.frais.forEach(f => { if (!bycat[f.cat]) bycat[f.cat] = 0; bycat[f.cat] += (f.montant||0); });
  const catEl = document.getElementById('frais-by-cat');
  if (catEl) {
    catEl.innerHTML = !Object.keys(bycat).length
      ? '<div class="empty"><div class="empty-icon">🧾</div><div class="empty-text">Aucun frais</div></div>'
      : Object.entries(bycat).sort((a,b) => b[1]-a[1]).map(([cat,total]) =>
          `<div class="frais-cat-row"><div class="frais-cat-icon">${CAT_ICONS[cat]||'📦'}</div><div class="frais-cat-name">${CAT_LABELS[cat]||cat}</div><div class="frais-cat-amt">${fmt(total)}</div></div>`
        ).join('');
  }

  const moisDispo = [...new Set(state.frais.map(f => f.date?.slice(0,7)).filter(Boolean))].sort();
  const tabsEl = document.getElementById('frais-month-tabs');
  if (tabsEl) {
    tabsEl.innerHTML = `<div class="month-tab ${selectedMonthFrais==='all'?'active':''}" onclick="filterFrais('all')">Tout</div>` +
      moisDispo.map(m => {
        const [y,mo] = m.split('-');
        return `<div class="month-tab ${selectedMonthFrais===m?'active':''}" onclick="filterFrais('${m}')">${MONTHS[parseInt(mo)-1]?.slice(0,3)||''} ${y}</div>`;
      }).join('');
  }

  const ff = selectedMonthFrais === 'all' ? state.frais : state.frais.filter(f => f.date?.startsWith(selectedMonthFrais));
  const listEl = document.getElementById('frais-list');
  if (listEl) {
    listEl.innerHTML = !ff.length
      ? '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Aucun frais</div></div>'
      : ff.sort((a,b) => b.date.localeCompare(a.date)).map(f =>
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

function addFrais() {
  const date    = document.getElementById('f-date').value;
  const montant = parseFloat(document.getElementById('f-montant').value) || 0;
  if (!date || !montant) { toast('❌ Date et montant requis'); return; }
  state.frais.push({
    id: Date.now().toString(),
    cat:  document.getElementById('f-cat').value,
    desc: document.getElementById('f-desc').value.trim(),
    date, montant,
    km:    parseFloat(document.getElementById('f-km').value) || 0,
    repas: parseFloat(document.getElementById('f-repas').value) || 0,
    ref:   document.getElementById('f-ref').value.trim(),
    contratId: document.getElementById('f-contrat-link').value || ''
  });
  saveState();
  closeSheet();
  toast('✅ Frais enregistré');
  renderFrais();
  renderBilan();
  ['f-desc','f-montant','f-km','f-repas','f-ref'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function deleteFrais(id) {
  if (!confirm('Supprimer ?')) return;
  state.frais = state.frais.filter(f => f.id !== id);
  saveState(); renderFrais(); renderBilan();
  toast('🗑️ Supprimé');
}
