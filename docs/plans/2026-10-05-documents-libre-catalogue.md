# Documents — mode libre, catalogue, images et personnalisation

Date : 2026-10-05 · Statut : livré sur la branche `claude/documents-libre-catalogue`

## Pourquoi

Audit du 2026-10-05 (parcours TeachInspire face à l'onglet Documents). Les
vrais documents du cas Katrin (fiche cadre de séance, brief, fiche
récapitulative, exportés de Google Docs) et les sorties typiques de Gemini
(plan de cours en tableau, fiche d'exercices avec choix a/b/c) sortaient
cassés. Les tableaux devenaient des titres numérotés, les options lettrées
avalaient le titre suivant, et les puces vides des exports Docs restaient.
Les participants demandaient aussi plus de liberté de design.

## Ce qui change

- **Analyseur** (`simple-structure.ts`, `markdown-lines.ts`). Il reconnaît :
  - tableaux en pipes ou tabulés, listes imbriquées, lettrées et à cocher ;
  - encadrés `>`, grilles « Libellé : valeur », banque de mots ;
  - dialogues (locuteurs répétés) et transcriptions horodatées ;
  - filets `---`, `[saut de page]`, `[lignes: n]` et images `![légende](studio:id)`.
  
  Il nettoie les artefacts Docs (puces vides, `**` orphelins, échappements)
  sans toucher aux mots. Un texte propre ressort à l'identique, octet pour octet.
- **Catalogue** : 12 types au lieu de 4, groupés pour l'apprenant, pour
  l'enseignant et pour le parcours, plus « Document libre » par défaut. Chaque
  type n'ajoute que de l'habillage : bandeau, ligne nom/date, cases vrai/faux,
  corrigé encadré, cartes à découper, paysage par défaut pour le calendrier.
- **Personnaliser** (aperçu) : couleur d'accent (palette dérivée,
  contraste garanti pour le texte blanc), police des titres et du texte
  (polices embarquées, PDF identique), densité, en-tête, logo, pied de page
  sur chaque page du PDF, orientation. Le réglage est enregistré sur le
  document (PATCH `/jobs/:id/materials/:idx/presentation`) et repris pour les
  documents suivants (localStorage).
- **Images** : POST `/api/documents/images`. PNG, JPEG, WebP ou GIF, 5 Mo
  maximum, type vérifié par les octets et non par l'en-tête. Stockage R2 sous
  `documents/images/<userId>/`, puis intégration en data URI dans l'aperçu et
  le PDF.
- **Collage riche** : un collage depuis Google Docs, Word ou Gemini est
  converti en Markdown (titres, gras, listes imbriquées via `aria-level`,
  tableaux) avant d'arriver dans la zone de texte.
- **Ajouts** : une demande que Documents ne sait pas traiter est signalée
  (`request_status: not_applied`), au lieu d'être ignorée en silence. Les
  libellés des blocs ajoutés sont traduits ; le guide enseignant montre les
  réponses.
- **Limites** : 8 mots minimum (checklist, cartes de rôle), 30 000
  caractères maximum (guide complet avec corrigés).

## À vérifier au déploiement

- La règle de cycle de vie du bucket `teachinspire-media` ne doit pas
  couvrir `documents/images/`, sinon les logos et illustrations
  disparaîtraient.
- Le test `transcription-jobs.test.ts › keeps the prompt ladder…` échoue
  déjà sur `main`, indépendamment de ce chantier.

## Pour la capsule D4 (« Finaliser un support dans Documents »)

1. Coller depuis Docs ou Gemini : la structure est conservée.
2. Choisir le type.
3. Aperçu, puis Personnaliser.
4. Télécharger le PDF.

La consigne à ajouter à la demande Gemini figure dans le Guide, avec un
bouton de copie.
