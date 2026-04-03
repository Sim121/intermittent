/* ============================================================
   INTERMITTENT — contrats.js
   Gestion des contrats : CRUD, détail, fusion, France Travail
   ============================================================ */

// ── RENDER LISTE ──
function renderContrats() {
  const el = document.getElementById('contrats-list');
  if (!state.contrats.length) {
    el.innerHTML = '<div class="empty" style="padding:48px 20px;"><div class="empty-icon">📁</div><div class="empty-text">Aucun contrat enregistré<br>Scanne ou ajoute manuellement</div></div>';
    return;
  }

  const grouped = {};
  state.contrats.forEach(c => {
    const d = new Date((c.dateDebut || '1970-01-01') + 'T12:00:00');
    const y = d.getFullYear();
    const m = d.getMonth();
    if (isNaN(y)) return;
    if (!grouped[y]) grouped[y] = {};
    if (!grouped[y][m]) grouped[y][m] = [];
    grouped[y][m].push(c);
  });

  let html = '';
  Object.keys(grouped).sort((a,b) => b-a).forEach(y => {
    html += `<div class="year-group"><div class="year-header">${y}</div>`;
    Object.keys(grouped[y]).sort((a,b) => b-a).forEach(m => {
      const contrats  = grouped[y][m].sort((a,b) => (b.dateDebut||'').localeCompare(a.dateDebut||''));
      const totalBrut = contrats.reduce((s,c) => s+(c.brutV||0), 0);
      const totalH    = contrats.reduce((s,c) => s+(c.heures||0), 0);
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

// ── AJOUTER / MODIFIER ──
function addContrat() {
  const emp   = document.getElementById('c-emp').value.trim();
  const debut = document.getElementById('c-debut').value;
  if (!emp || !debut) { toast('❌ Employeur et date début requis'); return; }

  const sheet  = document.getElementById('sheet-add-contrat');
  const editId = sheet.dataset.editId;

  const data = {
    employeur: emp.toUpperCase().trim(),
    poste:     document.getElementById('c-poste').value.trim(),
    dateDebut: debut,
    dateFin:   document.getElementById('c-fin').value || debut,
    cachets:   parseInt(document.getElementById('c-cachets').value) || 0,
    heures:    parseFloat(document.getElementById('c-heures').value) || 0,
    brutV:     parseFloat(document.getElementById('c-brut').value) || 0,
    netImp:    parseFloat(document.getElementById('c-net-imp').value) || 0,
    netV:      parseFloat(document.getElementById('c-net').value) || 0,
    pasV:      parseFloat(document.getElementById('c-pas').value) || 0,
    ref:       document.getElementById('c-ref').value.trim(),
    comment:   document.getElementById('c-comment').value.trim(),
    docs: []
  };

  if (editId) {
    const idx = state.contrats.findIndex(x => x.id === editId);
    if (idx >= 0) state.contrats[idx] = { ...state.contrats[idx], ...data };
    delete sheet.dataset.editId;
    document.getElementById('sheet-contrat-title').textContent = 'Nouveau contrat';
    document.getElementById('btn-save-contrat').textContent    = '✓ Enregistrer';
    toast('✅ Contrat mis à jour');
  } else {
    data.id   = Date.now().toString();
    data.paye = false;
    data.hasContrat  = false;
    data.hasBulletin = false;
    data.hasAEM      = false;
    data.hasCS       = false;
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

// ── DÉTAIL ──
function openDetail(id) {
  currentContratId = id;
  const c = state.contrats.find(x => x.id === id);
  if (!c) return;
  document.getElementById('detail-title').textContent = c.employeur || 'Contrat';
  renderDetailBody(c);
  if (isDesktop) {
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
  const fraisLies  = state.frais.filter(f => f.contratId === c.id);
  const totalFrais = fraisLies.reduce((s,f) => s + f.montant, 0);
  const nbJours    = c.dateDebut && c.dateFin
    ? Math.ceil((new Date(c.dateFin + 'T12:00:00') - new Date(c.dateDebut + 'T12:00:00')) / 86400000) + 1 : 0;

  const html = `
    <div style="margin-bottom:16px;">
      <div style="font-family:'DM Mono',monospace;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Statut paiement</div>
      <div class="paiement-toggle">
        <div class="paiement-btn ${c.paye===true?'active-paye':''}" onclick="togglePaiement('${c.id}',true)">✅ Payé</div>
        <div class="paiement-btn ${c.paye===false?'active-attente':''}" onclick="togglePaiement('${c.id}',false)">⏳ En attente</div>
      </div>
    </div>
    <div class="card" id="docs-card-${c.id}">
      <div class="card-head"><div class="card-head-title">Documents rattachés</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <span class="tag ${c.hasContrat?'tag-green':'tag-gray'}" style="${!c.hasContrat?'cursor:pointer':''}" onclick="${!c.hasContrat?`openInlineUpload('${c.id}','contrat')`:''}">📝 Contrat ${c.hasContrat?'✓':'+ Ajouter'}</span>
        <span class="tag ${c.hasBulletin?'tag-green':'tag-gray'}" style="${!c.hasBulletin?'cursor:pointer':''}" onclick="${!c.hasBulletin?`openInlineUpload('${c.id}','bulletin')`:''}">📄 Bulletin ${c.hasBulletin?'✓':'+ Ajouter'}</span>
        <span class="tag ${c.hasAEM?'tag-green':'tag-gray'}" style="${!c.hasAEM?'cursor:pointer':''}" onclick="${!c.hasAEM?`openInlineUpload('${c.id}','aem')`:''}">📋 AEM ${c.hasAEM?'✓':'+ Ajouter'}</span>
        <span class="tag ${c.hasCS?'tag-green':'tag-gray'}" style="${!c.hasCS?'cursor:pointer':''}" onclick="${!c.hasCS?`openInlineUpload('${c.id}','conges')`:''}">🌴 CS ${c.hasCS?'✓':'+ Ajouter'}</span>
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
      <div class="ft-row"><span class="ft-label">Heures</span><span class="ft-value">${heuresFT(c)} h</span></div>
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
    <button class="btn btn-ghost" onclick="openMergeContrat('${c.id}')" style="width:100%;margin-bottom:10px;">🔀 Fusionner avec un autre contrat</button>`;

  document.getElementById('detail-body').innerHTML = html;
  const dp = document.getElementById('desktop-detail-body');
  if (dp) dp.innerHTML = html;
}

function getMoisDeclaration(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
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

function editContrat(id) {
  const c = state.contrats.find(x => x.id === id);
  if (!c) return;
  document.getElementById('c-emp').value     = c.employeur || '';
  document.getElementById('c-poste').value   = c.poste || '';
  document.getElementById('c-debut').value   = c.dateDebut || '';
  document.getElementById('c-fin').value     = c.dateFin || '';
  document.getElementById('c-cachets').value = c.cachets || '';
  document.getElementById('c-heures').value  = c.heures || '';
  document.getElementById('c-brut').value    = c.brutV || '';
  document.getElementById('c-net-imp').value = c.netImp || '';
  document.getElementById('c-net').value     = c.netV || '';
  document.getElementById('c-pas').value     = c.pasV || '';
  document.getElementById('c-ref').value     = c.ref || '';
  document.getElementById('c-comment').value = c.comment || '';
  document.getElementById('sheet-add-contrat').dataset.editId = id;
  document.getElementById('sheet-contrat-title').textContent  = 'Modifier le contrat';
  document.getElementById('btn-save-contrat').textContent      = '✓ Mettre à jour';
  closeDetail();
  openSheet('sheet-add-contrat');
}

// ── FUSION ──
function openMergeContrat(id) {
  const c = state.contrats.find(x => x.id === id);
  if (!c) return;
  const others = state.contrats.filter(x => x.id !== id);
  if (!others.length) { toast('Aucun autre contrat à fusionner'); return; }

  const opts = others.map(o =>
    `<option value="${o.id}">${o.employeur} — ${fmtDate(o.dateDebut)}${o.dateDebut !== o.dateFin ? ' → '+fmtDate(o.dateFin) : ''} (${fmt(o.brutV)})</option>`
  ).join('');

  const mergeHtml = `
    <div class="card" style="background:var(--blue-light);border-color:rgba(26,74,122,.2);margin-top:12px;" id="merge-panel">
      <div class="card-head">
        <div class="card-head-title" style="color:var(--blue);">Fusionner avec…</div>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('merge-panel').remove()">✕</button>
      </div>
      <div class="field">
        <label>Contrat à absorber (sera supprimé)</label>
        <select id="merge-target-select">${opts}</select>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Les valeurs manquantes de <strong>"${c.employeur}"</strong> seront complétées depuis l'absorbé.</div>
      <button class="btn btn-primary" onclick="doMergeContrat('${id}')">🔀 Fusionner</button>
    </div>`;

  const body = document.getElementById('detail-body');
  if (body) body.insertAdjacentHTML('beforeend', mergeHtml);
  const dp = document.getElementById('desktop-detail-body');
  if (dp) dp.insertAdjacentHTML('beforeend', mergeHtml.replace('id="merge-panel"', 'id="merge-panel-desktop"').replace("getElementById('merge-panel').remove()", "getElementById('merge-panel-desktop').remove()"));
}

function doMergeContrat(keepId) {
  const sel     = document.getElementById('merge-target-select');
  if (!sel) return;
  const absorbId = sel.value;
  const keep     = state.contrats.find(x => x.id === keepId);
  const absorb   = state.contrats.find(x => x.id === absorbId);
  if (!keep || !absorb) return;
  if (!confirm(`Fusionner "${absorb.employeur} (${fmtDate(absorb.dateDebut)})" dans "${keep.employeur} (${fmtDate(keep.dateDebut)})" ?`)) return;

  if (!keep.brutV   && absorb.brutV)   keep.brutV   = absorb.brutV;
  if (!keep.netImp  && absorb.netImp)  keep.netImp  = absorb.netImp;
  if (!keep.netV    && absorb.netV)    keep.netV    = absorb.netV;
  if (!keep.pasV    && absorb.pasV)    keep.pasV    = absorb.pasV;
  if (!keep.heures  && absorb.heures)  keep.heures  = absorb.heures;
  if (!keep.cachets && absorb.cachets) keep.cachets = absorb.cachets;
  if (!keep.poste   && absorb.poste)   keep.poste   = absorb.poste;
  if (!keep.ref     && absorb.ref)     keep.ref     = absorb.ref;
  keep.hasContrat  = keep.hasContrat  || absorb.hasContrat;
  keep.hasBulletin = keep.hasBulletin || absorb.hasBulletin;
  keep.hasAEM      = keep.hasAEM      || absorb.hasAEM;
  keep.hasCS       = keep.hasCS       || absorb.hasCS;
  state.frais.forEach(f => { if (f.contratId === absorbId) f.contratId = keepId; });
  state.contrats = state.contrats.filter(x => x.id !== absorbId);

  saveState();
  toast('✅ Contrats fusionnés');
  renderDetailBody(keep);
  renderContrats();
  renderBilan();
}

// ── FRANCE TRAVAIL ──
function renderFTPage() {
  const sel = document.getElementById('ft-mois-select');
  if (!sel) return;

  // Remonte jusqu'au contrat le plus ancien
  const oldest = state.contrats.reduce((min, c) => {
    if (!c.dateDebut) return min;
    return !min || c.dateDebut < min ? c.dateDebut : min;
  }, null);

  const now   = new Date();
  const start = oldest ? new Date(oldest + 'T12:00:00') : now;
  const opts  = [];

  let d = new Date(now.getFullYear(), now.getMonth(), 1);
  while (d >= new Date(start.getFullYear(), start.getMonth(), 1)) {
    const val = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    opts.push(`<option value="${val}">${MONTHS[d.getMonth()]} ${d.getFullYear()}</option>`);
    d = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  }

  sel.innerHTML = opts.join('');
  renderFT();
}

function renderFT() {
  const val = document.getElementById('ft-mois-select').value;
  if (!val) return;
  const [y, m] = val.split('-').map(Number);

  const contrats  = state.contrats.filter(c => {
    if (!c.dateDebut) return false;
    const d = new Date(c.dateDebut + 'T12:00:00');
    return d.getFullYear() === y && d.getMonth() === m - 1;
  });
  const totalH    = contrats.reduce((s,c) => s+heuresFT(c), 0);
  const totalBrut = contrats.reduce((s,c) => s+(c.brutV||0), 0);
  const totalC    = contrats.reduce((s,c) => s+(c.cachets||0), 0);
  const totalJ    = contrats.reduce((s,c) => {
    if (!c.dateDebut || !c.dateFin) return s;
    return s + Math.ceil((new Date(c.dateFin + 'T12:00:00') - new Date(c.dateDebut + 'T12:00:00')) / 86400000) + 1;
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
        const nj = c.dateDebut && c.dateFin ? Math.ceil((new Date(c.dateFin+'T12:00:00')-new Date(c.dateDebut+'T12:00:00'))/86400000)+1 : 0;
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
    <button class="btn btn-ghost" style="width:100%;margin-bottom:10px;" onclick="copyFTRecap(${y},${m})">📋 Copier le récapitulatif</button>`;
}

function copyFTRecap(y, m) {
  const contrats = state.contrats.filter(c => {
    if (!c.dateDebut) return false;
    const d = new Date(c.dateDebut + 'T12:00:00');
    return d.getFullYear() === y && d.getMonth() === m - 1;
  });
  let text = `DÉCLARATION FRANCE TRAVAIL — ${MONTHS[m-1]} ${y}\n${'─'.repeat(40)}\n`;
  text += `Heures : ${contrats.reduce((s,c)=>s+(c.heures||0),0)} h\n`;
  text += `Brut : ${fmt(contrats.reduce((s,c)=>s+(c.brutV||0),0))}\n`;
  text += `Cachets : ${contrats.reduce((s,c)=>s+(c.cachets||0),0)}\n\nDÉTAIL :\n`;
  contrats.forEach(c => { text += `\n• ${c.employeur}\n  ${c.heures||0}h — ${fmt(c.brutV)} brut — ${c.cachets||0} cachet(s)\n`; });
  navigator.clipboard.writeText(text).then(() => toast('📋 Copié !')).catch(() => toast('❌ Impossible de copier'));
}
