# Plan D3 — Sauts de page parfaits (module Documents)

Date : 2026-07-04 · Autoportant, à exécuter tel quel. Suivre CLAUDE.md.
Exigence Greg : rendu premium — plus de grands vides en bas de page.

## 1. Diagnostic (confirmé sur le code, ne pas re-vérifier)

Dans `worker/lib/documents/material-renderer.ts` (~l.571), `.section-shell`
— l'enveloppe d'une **section entière** (quiz complet, article entier) —
porte `page-break-inside: avoid`. Toute section qui ne tient pas dans
l'espace restant saute entière à la page suivante → grand vide. C'est LE
bug à corriger. `.answer-item` (l.~883) a déjà le bon grain ; le corrigé
a déjà `page-break-before: always` (l.~869).

## 2. Correctif CSS (dans `buildCss()` du renderer)

1. **Retirer** `page-break-inside: avoid` de `.section-shell` — les
   sections doivent COULER entre les pages.
2. **Descendre l'insécabilité aux items atomiques** : repérer dans le
   renderer les classes des unités par type de bloc (item de question +
   ses lignes de réponse, paire d'appariement, phrase à trous, entrée de
   liste de référence, carte de rôle, item de word bank) et leur donner
   `break-inside: avoid; page-break-inside: avoid;`. Une carte de rôle
   entière = atomique ; un article = sécable au paragraphe (orphans/widows
   3 déjà en place, garder).
3. **Titres jamais orphelins** : `break-after: avoid; page-break-after:
   avoid;` sur les titres de section et le header de document.
4. Tableaux éventuels : `thead { display: table-header-group }`, `tr {
   break-inside: avoid }`.
5. Mettre à jour les snapshots de tests existants (documents.test.ts).

## 3. Harnais mécanique de détection des vides (la pièce maîtresse)

Créer `scripts/documents-break-harness.mjs` (node, hors Workers) :

- **Rendu local avec le MÊME moteur que la prod** : `renderMaterialHtml()`
  est pur → l'importer (via tsx ou build), écrire le HTML en fichier, puis
  `chrome --headless=new --print-to-pdf=out.pdf --no-pdf-header-footer
  fichier.html` (Chrome local = même Chromium que Browser Rendering →
  boucle d'itération RAPIDE sans déployer).
- **Fixtures** : 5-6 materials représentatifs construits en dur (quiz 10
  questions, article long + questions, appariement 12 paires, cartes de
  rôle, fill_blanks avec word bank, mix de blocs) — assez longs pour
  forcer 2-3 pages chacun.
- **Mesures par PDF** (poppler : `pdftotext -bbox` + `pdfinfo`) :
  1. *Vide de fin de page* : y du dernier texte de chaque page vs hauteur
     utile ; ÉCHEC si vide > 22 % sur une page non-finale et non suivie
     d'un `page-break-before` volontaire (le corrigé).
  2. *Titre orphelin* : un texte de titre (préfixer les titres d'un
     marqueur invisible « ⟪H⟫ » en mode harnais, ou matcher le texte des
     fixtures) est le dernier élément d'une page → ÉCHEC.
  3. *Item scindé* : marqueurs « ⟪Bn⟫ »/« ⟪En⟫ » (pattern du spike D0,
     voir `documents-spike.ts`) autour de chaque item atomique des
     fixtures ; Bn et En sur des pages différentes → ÉCHEC.
- Sortie : tableau par fixture/page (vide %, violations), exit code ≠ 0 si
  violation. Script npm : `"docs:breaks": "node scripts/..."`.

## 4. Boucle de vérification (l'ordre exact)

1. Écrire le harnais AVANT de toucher au CSS ; le lancer sur l'état
   actuel → il DOIT échouer (preuve qu'il détecte le bug). Noter les
   chiffres avant/après dans BUILD_LOG.
2. Appliquer §2, relancer le harnais, itérer CSS ↔ harnais jusqu'à
   0 violation sur toutes les fixtures.
3. Gate repo : `npm test && npm run build && npm audit --omit=dev` +
   arbre git propre.
4. Déployer (`npm run build && npx wrangler deploy` — pas de migration).
5. **Confirmation prod** : générer un vrai document sur
   studio.teachinspire.me (session KV temporaire, recette dans
   BUILD_LOG § « Documents D2 »), télécharger les 3 PDF, repasser les
   mesures §3 dessus (mêmes seuils). Browser Rendering ≠ exactement
   Chrome local en théorie — cette étape ferme l'écart.
6. BUILD_LOG : chiffres avant/après, verdict, version déployée.

## 5. Hors périmètre
Numéros de page / en-têtes courants (D4 si demandé), aperçu paginé
WYSIWYG (D4), refonte des 3 presets (décision produit Greg), Paged.js
(interdit sauf si le harnais prouve que le natif ne suffit pas — le
spike D0 a conclu que si).

## 6. Pièges connus
- `wrangler dev` sert le dist prébuild → `npm run build` d'abord.
- Chrome local : binaire = `"Google Chrome"` sur macOS
  (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).
- poppler (`pdftotext`, `pdfinfo`) est installé sur la machine.
- Ne pas toucher au spike D0 ni à sa route admin (suppression = fin de
  D3, dernier commit du chantier, avec la route `spike-pdf` retirée de
  `worker/routes/documents.ts`).
- Push GitHub : peut échouer (droits) — committer localement, le dire.
