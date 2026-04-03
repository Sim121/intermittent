
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
