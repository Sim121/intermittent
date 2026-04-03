
/* ============================================================
   INTERMITTENT — utils.js
   Fonctions utilitaires partagées
   ============================================================ */

const MONTHS     = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const CAT_ICONS  = {transport:'🚗',navigo:'🚇',km:'🛣️',logiciel:'💻',formation:'📚',materiel:'🎭',repas:'🍽️',agent:'🤝',conges:'🌴',autre:'📦'};
const CAT_LABELS = {transport:'Transport',navigo:'Navigo',km:'Kilométrique',logiciel:'Logiciels',formation:'Formation',materiel:'Matériel',repas:'Repas',agent:'Agent',conges:'Congés Spectacle',autre:'Autre'};

function fmt(n) {
  if (!n && n !== 0) return '—';
  if (n === 0) return '0 €';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(n);
}

function fmtDate(s) {
  if (!s) return '—';
  const parsed = parseDate(s);
  if (!parsed) return '—';
  const d = new Date(parsed + 'T12:00:00');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [d, m, y] = dateStr.split('/');
    return `${y}-${m}-${d}`;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
    const [d, m, y] = dateStr.split('-');
    return `${y}-${m}-${d}`;
  }
  return dateStr;
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

// Annexe 10 : 1 cachet = 12h pour France Travail si pas d'heures explicites
function heuresFT(c) {
  if (c.heures && c.heures > 0) return c.heures;
  return (c.cachets || 0) * 12;
}

function toggleCard(headEl) {
  const card = headEl.closest('.card');
  if (!card) return;
  card.classList.toggle('collapsed');
}

// Recalcule les valeurs d'un contrat depuis ses sources
// Priorité : AEM > Bulletin > Contrat pour les montants
function recalcContrat(c) {
  if (!c.sources) c.sources = {};
  const s = c.sources;

  // brutV : AEM > Bulletin > Contrat
  c.brutV = (s.aem?.brutV) || (s.bulletin?.brutV) || (s.contrat?.brutV) || 0;

  // netImp, netV, pasV : Bulletin en priorité, sinon estimation depuis le brut
  if (s.bulletin) {
    c.netImp  = s.bulletin.netImp  || 0;
    c.netV    = s.bulletin.netV    || 0;
    c.pasV    = s.bulletin.pasV    || 0;
    c.tauxPas = s.bulletin.tauxPas || 0;
    c.isEstimated = false;
  } else if (c.brutV > 0) {
    // Estimation : cotisations salariales ~22% du brut
    const tauxPas = (state.config?.tauxPas || 14.6) / 100;
    c.netImp = Math.round(c.brutV * 0.78 * 100) / 100;
    c.netV   = Math.round(c.netImp * (1 - tauxPas) * 100) / 100;
    c.pasV   = Math.round(c.netImp * tauxPas * 100) / 100;
    c.isEstimated = true;
  } else {
    c.netImp = 0; c.netV = 0; c.pasV = 0;
    c.isEstimated = false;
  }

  // cachets : AEM > Bulletin > Contrat
  c.cachets = (s.aem?.cachets) || (s.bulletin?.cachets) || (s.contrat?.cachets) || 0;

  // heures : AEM > Bulletin > Contrat
  c.heures = (s.aem?.heures) || (s.bulletin?.heures) || (s.contrat?.heures) || 0;

  // poste : Contrat > existant
  if (s.contrat?.poste) c.poste = s.contrat.poste;

  // Flags
  c.hasContrat  = !!s.contrat;
  c.hasBulletin = !!s.bulletin;
  c.hasAEM      = !!s.aem;
  c.hasCS       = !!s.conges;

  return c;
}

// Retire une source et recalcule
function removeSource(c, sourceType) {
  if (!c.sources) c.sources = {};
  c.sources[sourceType] = null;
  recalcContrat(c);
}
