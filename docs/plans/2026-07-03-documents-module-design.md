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

---

## Révision senior (2026-07-03, après lecture du code source)

### Découverte qui invalide le pilier n°1 tel qu'écrit
RenderInspire ne fait PAS générer du HTML au LLM. Le contrat existant est
un JSON typé (8 types de blocs, schémas Zod discriminés) rendu en HTML
par un moteur déterministe de 915 lignes (material-renderer.ts). La
discipline des sauts de page se joue donc dans le renderer (code possédé,
testable en snapshot), pas dans le prompt. Position plus forte que le
plan initial.

### Pièges attrapés
1. Collision de config : RenderInspire lit OPENROUTER_MODEL, déjà utilisé
   par les interviews avec une autre valeur → variable dédiée DOCS_MODEL.
2. Paged.js = dépendance prématurée : blocs grossiers + renderer possédé
   → la fragmentation native Chromium (break-inside, @page, header/footer
   via printToPDF) suffit probablement. Décision par spike, pas par
   anticipation.
3. Séparer portage et amélioration : porter fidèlement (schémas, boucle
   retry/validation existante — bien faite), puis améliorer la
   pagination sur base stable.
4. Style des documents imprimés (3 presets existants) ≠ design de l'app.
   Presets conservés au départ ; rebranding documents = décision produit
   séparée avec Greg.
5. Appel long (24k tokens, ≤2×180s) → queue + polling (pattern
   interviews) avec table dédiée document_jobs (petite migration).
6. Fontes à embarquer dans le HTML rendu (Chromium headless n'a pas les
   fontes système que WeasyPrint utilisait).
7. Limites Browser Rendering (concurrence/débit) à mesurer au spike.

### Phasage révisé
- D0 spike (½j) : binding + PDF natif d'un document représentatif,
  mesure des coupes, verdict natif vs Paged.js, quotas.
- D1 portage fidèle (1j) : schémas+renderer+prompt+validation en
  worker/lib pur avec snapshots ; DOCS_MODEL ; migration document_jobs ;
  endpoint async + polling.
- D2 UI /pdf (1j) : design TeachInspire, guide au point d'usage, FR/EN.
- D3 pagination parfaite (½-1j) : print CSS + harnais de coupes
  (pattern pilote audio) + numéros de page.
- D4 aperçu paginé WYSIWYG seulement si D3 le justifie.

### Écart conventions assumé
Zod conservé pour le portage des schémas (réécrire 200 lignes de
validation à la main = risque sans bénéfice). Signalé à Greg.

### Décisions Greg (non bloquantes pour D0)
- Rebranding des styles de documents imprimés : plus tard, avec lui.
- Quota Documents : tranché le 2026-07-03 — participant, sans quota.
