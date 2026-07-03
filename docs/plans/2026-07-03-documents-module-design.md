# Plan — Module Documents (ex-RenderInspire) dans TeachInspire Studio

Date : 2026-07-03 · Statut : approuvé sur le principe (Greg), à construire
après Stripe et Bibliothèque. Exigence centrale de Greg : des sauts de
page parfaits — le rendu HTML→PDF doit être irréprochable.

## État des lieux RenderInspire (audité 2026-07-03)

- Next.js 16, ~3 400 LOC, 19 fichiers. Sans auth, sans base, sans données
  utilisateur : outil stateless (coller du contenu → 3 documents HTML
  prêts à imprimer via OpenRouter → aperçu → PDF via WeasyPrint/Python).
- Rien à migrer. La fusion = réécriture du module dans le monorepo
  Workers, pas une migration.
- WeasyPrint (Python natif) ne tourne pas sur Workers → remplacé par
  Cloudflare Browser Rendering (Chromium à la périphérie).
- Piège identifié de l'app actuelle : aperçu (media screen) et PDF
  (WeasyPrint) = deux moteurs différents → WYSIWYG impossible.

## Architecture du rendu — quatre piliers pour des coupes parfaites

1. Contrat de structure au niveau du prompt système : le LLM émet du
   HTML sémantique avec des classes imposées ; chaque unité insécable
   (exercice, question+réponses, consigne+tableau, figure+légende) est
   enveloppée dans un bloc dédié. Le LLM ne produit AUCUN CSS de mise
   en page.
2. Feuille de style print maison, versionnée dans l'app : @page A4
   marges fixes ; break-inside: avoid sur les blocs ; break-after:
   avoid sur les titres ; orphans/widows: 3 ; thead répété et lignes
   insécables pour les tableaux.
3. Pagination unique via Paged.js dans Chromium : l'aperçu montre les
   vraies pages A4 (numéros, en-têtes/pieds courants — ce que Chromium
   ne sait pas faire en CSS pur) et le PDF est imprimé par le même
   moteur → identique au pixel.
4. Harnais de qualité (pattern du pilote audio) : set de documents
   représentatifs (fiche d'exercices, compréhension + questions,
   tableau de conjugaison, document avec images) rendus en PDF
   automatiquement, avec détection mécanique des mauvaises coupes
   (titre en bas de page, bloc scindé) par mesure des positions de
   blocs vs limites de page. Zéro défaut sur le set = non-régression.

## Intégration Studio

- Troisième onglet « Documents » : page React + route Hono, pattern
  OpenRouter existant (jobs en file, mêmes conventions que interviews).
- Auth/tier : requireParticipant, comme l'Audio (décision existante).
- UI refondue au design TeachInspire (pas de port du style Next.js) ;
  guide au point d'usage comme l'Audio.
- Binding Browser Rendering à ajouter au wrangler.jsonc (plan Workers
  payant requis — vérifier la disponibilité sur le compte au démarrage).

## Contexte architecture cible (décision Greg, 2026-07-03)

teachinspire.me → vitrine (inchangée) ; studio.teachinspire.me → app
unique (Prompts / Audio / Documents) ; promptomatik.com → 301 ;
renderinspire.* → 301 vers /documents. Points ouverts du chantier
domaine : reconnexion unique (cookies non transférables), domaine
d'envoi des emails (noreply@promptomatik.com aujourd'hui), sort du nom
« Promptomatik ». La bascule domaine est une phase séparée, APRÈS le
module Documents.
