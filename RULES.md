# RÈGLES MÉTIER — Intermittent du Spectacle
> Document de référence permanent. Ne jamais modifier sans raison valable.
> Dernière mise à jour : 2026-04-04

---

## 1. PRIORITÉ DES SOURCES DE DONNÉES

L'ordre de priorité pour toutes les valeurs est **AEM > Bulletin de Salaire > Contrat**.

- **AEM** : source principale pour France Travail. Prévaut TOUJOURS pour le salaire brut à déclarer, les cachets, et les heures.
- **Bulletin de Salaire** : source principale pour net imposable, net perçu, PAS prélevé, taux PAS.
- **Contrat** : source d'information complémentaire uniquement. Ne prévaut jamais sur l'AEM ou le BS.

### Priorité par champ
| Champ | Source 1 | Source 2 | Source 3 |
|-------|----------|----------|----------|
| Salaire brut | AEM | Bulletin | Contrat |
| Cachets | AEM | Bulletin | Contrat |
| Heures | AEM | Bulletin | Contrat |
| Net imposable | Bulletin | — | — |
| Net perçu | Bulletin | — | — |
| PAS prélevé | Bulletin | — | — |
| Taux PAS | Bulletin | — | — |
| Poste/Emploi | AEM | Bulletin | Contrat |
| Dates | Contrat | AEM | Bulletin |

---

## 2. CACHETS VS JOURS TRAVAILLÉS

**DISTINCTION FONDAMENTALE :**
- **Cachets** → uniquement pour les **ARTISTES** (comédiens, musiciens, chanteurs, danseurs...)
- **Jours travaillés** → pour les **TECHNICIENS** (directeur artistique, ingénieur son, réalisateur, monteur...)

### Cas concrets
- Un comédien fait 3 représentations = **3 cachets**
- Un directeur artistique travaille 3 jours = **3 jours travaillés, 0 cachet**
- Le bulletin SILAE affiche "Nombre de jour(s)/cachet(s) travaillé(s) : 3" → si technicien = 3 jours, PAS 3 cachets

### Sur l'AEM
L'AEM a deux cases distinctes :
- "Nombre d'HEURES effectuées" (colonne gauche)
- "Nombre de CACHETS" (colonne droite, uniquement artistes)
- "Nombre de JOURS travaillés" (colonne centrale)

**L'AEM prévaut TOUJOURS** sur le contrat et le bulletin pour ces valeurs.

---

## 3. ANNEXE 10 — RÈGLE DES 12 HEURES

Pour les intermittents relevant de l'**Annexe 10** (techniciens) :
- **1 cachet = 12 heures** pour France Travail
- Si l'AEM n'indique pas d'heures explicites → heures FT = cachets × 12
- Si l'AEM indique des heures explicites → utiliser ces heures
- Ne JAMAIS inventer des heures si elles ne sont pas inscrites sur le document

---

## 4. SALAIRE BRUT SUR L'AEM

L'AEM distingue deux montants :
- **"Salaires bruts"** (ex: 1818,00 €) → montant TOTAL à déclarer à France Travail ✅
- **"Salaires bruts soumis à contributions d'assurance chômage"** (ex: 1419,09 €) → montant partiel, NE PAS utiliser pour FT ❌

**Toujours utiliser "Salaires bruts" (le montant le plus élevé) pour la déclaration France Travail.**

---

## 5. CONTRAT — DÉCOMPOSITION DU SALAIRE

Un contrat peut décomposer le salaire en :
- **Salaire de base** (ex: 711,12 € ou 1500,00 €)
- **Droits complémentaires / DADR / primes** (ex: 195,56 € ou 318,00 €)
- **Total brut** = salaire de base + droits (ex: 906,68 € ou 1818,00 €)

→ Le **total brut** est le montant à utiliser, pas la base seule.
→ L'AEM confirmera toujours le total correct.

---

## 6. DÉCLARATION FRANCE TRAVAIL

Format fidèle à l'AEM pour chaque contrat :

```
NOM DE L'EMPLOYEUR

HEURES TRAVAILLÉES (si et seulement si indiquées sur l'AEM)
NOMBRE DE CACHETS (fidèle à l'AEM)
MONTANT TOTAL DU SALAIRE BRUT (arrondi à l'euro le plus proche)
PÉRIODE D'ACTIVITÉ : [jour] [chiffre] [mois] [année] → [jour] [chiffre] [mois] [année]
```

- Si aucune heure n'est mentionnée sur l'AEM → ne rien afficher (pas "0h")
- Le brut est TOUJOURS arrondi à l'euro le plus proche
- Le format de date inclut le nom du jour (lundi, mardi...)

---

## 7. STATUT DE PAIEMENT

- Nouveau contrat → statut "En attente" par défaut
- Contrat de plus d'un an → automatiquement marqué "Payé" avec date estimée à J+30 après la fin du contrat
- Date de paiement réelle = date de virement sur le bulletin de salaire si disponible
- L'utilisateur peut toujours corriger manuellement

---

## 8. EMPLOYEURS

- Toujours stocker en **MAJUSCULES**
- Normaliser les espaces (supprimer les espaces multiples)
- Exemples : "CRUNCHYROLL STUDIOS FRANCE", "VARIASON STUDIO"

---

## 9. FORMATS DE DATES

- Toujours stocker au format **YYYY-MM-DD**
- Accepter en entrée : DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD
- Jamais inventer une date — mettre null si absente

---

## 10. TYPES DE DOCUMENTS

| Type | Identifiants clés |
|------|-------------------|
| `bulletin` | Cotisations sociales, net imposable, net payé, PAS, SILAE |
| `contrat` | CDDU, dates d'engagement, rémunération, signatures |
| `aem` | Unédic, Annexes 8 et 10, cases MOIS/ANNÉE, contributions chômage |
| `conges` | Les Congés Spectacles, BASE CONGÉ, NIR, certificat d'emploi |
| `frais` | Facture, ticket, reçu, dépense professionnelle |

---

## 11. FORMATS DE FICHIERS ACCEPTÉS

`.pdf`, `.jpg`, `.jpeg`, `.png`, `.heic`, `.heif`, `.webp`, `.tiff`, `.bmp`

---

## 12. ARCHITECTURE TECHNIQUE

- **Frontend** : GitHub Pages (sim121.github.io/intermittent)
- **Backend** : Google Apps Script
- **IA** : Claude API (claude-sonnet via Apps Script)
- **Stockage** : Drive (intermittent-backup.json)
- **Auth** : Token session 30 jours

### Ordre de chargement JS
1. `utils.js` — constantes, fmt, fmtDate, parseDate, toast, heuresFT, recalcContrat, removeSource
2. `bilan.js` — renderBilan, calcImpots, renderFrais, addFrais
3. `contrats.js` — renderContrats, openDetail, renderDetailBody, renderFTPage, renderFT
4. `scan.js` — processFile, showScanResult, confirmScanInline, openInlineUpload
5. `app.js` — state global, auth, sync, navigation, init

### Structure d'un contrat
```js
{
  id, employeur, poste, dateDebut, dateFin,
  cachets, heures, brutV, netImp, netV, pasV, tauxPas,
  paye, datePaiement, paiementAuto,
  isEstimated,
  ref, comment, docs: [],
  hasContrat, hasBulletin, hasAEM, hasCS,
  sources: {
    contrat:  { brutV, salaireBase, droits, cachets, heures, poste, dateDebut, dateFin },
    bulletin: { brutV, netImp, netV, pasV, tauxPas, heures, cachets, poste },
    aem:      { brutV, cachets, heures, poste },
    conges:   { brutV, cachets }
  }
}
```
