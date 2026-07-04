# Plan d'implémentation — Documents D2 : l'interface `/documents`

Date : 2026-07-04 · Statut : approuvé par Greg, prêt à exécuter.
Ce document est **autoportant** : il contient tout le contexte nécessaire pour
coder D2 sans accès aux conversations précédentes. Suivre `CLAUDE.md` à la
lettre (TypeScript strict, pas de `any`, kebab-case, i18n via `t()`, tokens
CSS, messages d'erreur chaleureux).

---

## 1. Contexte — ce qui existe déjà (ne pas reconstruire)

Le module Documents transforme un contenu collé par un enseignant en
**3 supports pédagogiques imprimables**. Le backend (phases D0+D1) est **déjà
en production** :

- `POST /api/documents/transform` — body `{content, title?, level?,
  languageFocus?, inputKind?, outputIntent?, customRequest?}` → `202 {jobId}`.
  Erreurs 400 : `invalid_request`, `content_too_short` (< 30 mots),
  `content_too_long` (> 15 000 caractères). Gating `requireParticipant`
  (403 pour tier free). Fichier : `worker/routes/documents.ts`.
- `GET /api/documents/jobs/:id` → `{job: {id, status, result, error,
  createdAt}}`, status ∈ `queued|processing|completed|failed`. Propriété
  vérifiée (404 sinon). La génération LLM (OpenRouter, var `DOCS_MODEL`)
  prend de 1 à 6 minutes (jusqu'à 2×180 s), pipeline async via queue
  `document-jobs` + table `document_jobs` (migration 0013 déjà appliquée
  en remote — **aucune migration D1 dans ce chantier**).
- `result` = `TransformResponse` : exactement **3 materials**
  (`worker/lib/documents/types.ts`). Chaque `TransformMaterial` porte :
  `id`, `preset_id` (`studio_academic|modern_training|warm_coaching`),
  `material_type` (31 valeurs), `title`, `skill_focus` (7 valeurs),
  `interaction_pattern` (6 valeurs), `estimated_minutes`, `blocks`.
- **Renderer HTML déterministe** : `renderMaterialHtml(material)` dans
  `worker/lib/documents/material-renderer.ts` → page HTML complète,
  autonome (CSS inline, print-ready, contenu échappé — testé). Exports
  utiles : `presetLabel()`, `presetMeta()`.
- **Pattern PDF prouvé** (spike D0) : `worker/lib/documents-spike.ts` —
  `puppeteer.launch(env.BROWSER)` (dép `@cloudflare/puppeteer` déjà
  installée), `page.setContent(html)`, `page.pdf({format: "A4"})`,
  fermeture en `finally`. **Ne pas toucher au spike** (il meurt en D3).
- Tests existants : `worker/lib/documents.test.ts` (12 tests, avec un
  `TEST_SCHEMA` local pour `document_jobs` — l'étendre, pas le dupliquer).

**Aucune nouvelle dépendance npm. Aucun quota/consommation** pour Documents
(décision Greg 2026-07-03) : participant = accès illimité.

## 2. Décisions verrouillées (revues Opus + Fable, validées par Greg)

1. Route frontend : **`/documents`** (cible du futur 301 `renderinspire.*`).
2. **PDF inclus dès D2** (base fonctionnelle ; la perfection des coupes = D3).
3. **Aperçu = iframe du HTML rendu serveur** — la même chaîne que le PDF,
   jamais de re-rendu React du contenu (c'est le piège qui a tué l'ancêtre
   RenderInspire : deux moteurs = WYSIWYG impossible).
4. **Auto-save partout** : brouillon du contenu en localStorage, jobId dans
   l'URL (`?job=`), état d'échec avec retry qui conserve la saisie.
5. Liste « Documents récents » (10 derniers jobs) sur l'écran de saisie.
6. i18n FR/EN **complet**, y compris les ~49 libellés d'enums (§6).
7. UI au design TeachInspire (tokens, boutons rectangulaires, Fraunces/DM
   Sans) — ne PAS porter le style Next.js de RenderInspire. Les 3 presets
   ne concernent que les documents imprimés, pas l'app.

## 3. Backend — 3 routes à ajouter dans `worker/routes/documents.ts`

Toutes derrière `requireAuth` + `requireParticipant`, propriété vérifiée.

### 3.1 `GET /jobs` (liste) — à déclarer AVANT `/jobs/:id` (ordre Hono)
Ajouter `listDocumentJobsForUser(env, userId, limit=10)` dans
`worker/lib/document-jobs.ts` : `SELECT id, status, request_payload,
created_at FROM document_jobs WHERE user_id = ? ORDER BY created_at DESC
LIMIT ?`. Réponse : `{jobs: [{id, status, label, createdAt}]}` où `label` =
`title` du payload sinon les ~8 premiers mots du `content`.

### 3.2 `GET /jobs/:id/materials/:idx.html` (aperçu)
Garde-fous : job du user (404), `status === "completed"` (409
`job_not_ready`), `idx` entier ∈ [0,2] (404). Réponse :
`renderMaterialHtml(result.materials[idx])` en `text/html; charset=utf-8`
+ `X-Frame-Options: SAMEORIGIN`.

### 3.3 `GET /jobs/:id/materials/:idx.pdf` (téléchargement)
Mêmes garde-fous. Puis :
- **Si `!c.env.BROWSER`** → `503 {error: "documents_pdf_unavailable"}`
  (Browser Rendering n'existe ni en vitest ni en dev local — ce chemin est
  le comportement normal hors prod, pas un bug).
- Sinon : nouveau `worker/lib/documents/pdf.ts` exportant
  `renderMaterialPdf(env, html): Promise<Uint8Array>` (copier le pattern
  puppeteer du spike : launch → setContent avec `waitUntil:
  "networkidle0"` → `page.pdf({format: "A4", printBackground: true})` →
  `browser.close()` en `finally`).
- Headers : `Content-Type: application/pdf`, `Content-Disposition:
  attachment; filename="<slug-du-titre>-<idx+1>.pdf"` (slug ASCII du
  `material.title`, fallback `document`).

## 4. Client API — `src/lib/api.ts`

Suivre le pattern `request<T>()` existant. Ajouter les types
`DocumentJobSummary`, `DocumentJob`, `DocumentMaterial` (miroir minimal de
`TransformMaterial` : id, preset_id, material_type, title, skill_focus,
interaction_pattern, estimated_minutes) et les méthodes :
`transformDocument(payload)`, `getDocumentJob(id)`, `getDocumentJobs()`.
Les URLs d'aperçu/PDF sont construites en dur dans la page (iframe `src` et
`<a href>` — les cookies de session passent en same-origin).

## 5. Frontend — page `src/pages/documents.tsx` + `documents.module.css`

Machine à 4 états (`"input" | "waiting" | "results" | "preview"`), un seul
état pilote l'affichage (pas de booléens épars). S'inspirer de la structure
de `src/pages/audio.tsx` (fieldsets, pastilles d'aide `helpDot`, overlay
guide) et de son module CSS — mêmes conventions, page classique (PAS
`mainWide`).

### État `input`
- Grande textarea (contenu à transformer), **compteur vivant** : mots
  (min 30) + caractères (max 15 000) ; bouton désactivé hors bornes avec
  raison affichée.
- Champs visibles : titre (optionnel), niveau (chips A1→C2 + « non
  précisé »), langue cible (texte libre, ex. « anglais », placeholder).
- Repliés sous « Options avancées » : type d'entrée (`inputKind`, 7 choix),
  intention de sortie (`outputIntent`, 5 choix), demande sur-mesure
  (`customRequest`, textarea courte, visible seulement si intent=custom).
- **Brouillon auto-sauvé** : localStorage `ti-docs-draft-v1`
  (content+titre+niveau+langue), debounce ~500 ms, restauré au montage,
  purgé après une génération réussie.
- **Documents récents** : liste des 10 derniers jobs (label, date, statut) ;
  clic sur un job `completed` → navigue vers `?job=<id>` et affiche ses
  résultats. Pattern visuel des « prises récentes » du studio audio.
- Guide au point d'usage : pastilles `(i)` (une ouverte à la fois) sur
  niveau / type d'entrée / intention, + panneau « Guide » global (overlay,
  pattern audio) expliquant : quoi coller, ce qu'on obtient (3 supports
  variés + corrigé), le délai (1 à 3 min en général), et que le PDF final
  se télécharge par document.

### État `waiting`
- `POST /transform` → `jobId` → **pousser `?job=<id>` dans l'URL**
  (`history.replaceState` ou router) → polling `GET /jobs/:id` toutes les
  **3 s, puis 5 s après 60 s**. Arrêt sur `completed`/`failed`.
- Attente soignée : spinner + messages qui évoluent dans le temps (analyse →
  construction des 3 supports → finalisation) + compteur de temps écoulé +
  attente annoncée « 1 à 3 minutes ». Après 10 min : message doux « c'est
  plus long que prévu, on continue d'essayer » (on continue le polling).
- `failed` → message chaleureux (jamais technique), bouton « Réessayer »
  qui **revient à `input` avec tout le contenu intact**.

### État `results`
- Les **3 cartes** : titre, type d'exercice traduit, focus + interaction
  traduits, `~X min`, nom du preset visuel. Entrée animée sobre (stagger
  léger, respecter `prefers-reduced-motion`).
- Carte → « Aperçu » (état `preview`) et « Télécharger le PDF ».
- Bouton « Nouveau document » (retour saisie, vide le brouillon).

### État `preview`
- Iframe `src=/api/documents/jobs/<id>/materials/<idx>.html`,
  `sandbox="allow-same-origin"` (le HTML rendu ne contient aucun script),
  largeur type A4 (~800 px max, scroll vertical), fond léger autour.
- Barre : retour aux résultats, navigation entre les 3 documents,
  « Télécharger le PDF ».
- Bouton PDF : état de chargement pendant la génération (~2-5 s). Si 503
  (`documents_pdf_unavailable`, cas dev local) : toast « Le PDF est
  disponible sur la version en ligne ».

### Restauration au montage (`?job=`)
`completed` → `results` ; `queued|processing` → `waiting` (reprendre le
polling) ; `failed` → message + retour saisie (brouillon restauré) ;
404 → ignorer le paramètre, écran saisie.

## 6. Navigation, route, i18n

- `src/App.tsx` : route `/documents` sous `ProtectedRoute` (copier le bloc
  `/audio`).
- `src/components/layout/shell.tsx` : lien « Documents » après « Audio »,
  même pattern actif/tier que le lien Audio (`documents.nav_label`).
- i18n : **toute chaîne via `t()`**, parité stricte fr.json/en.json.
  Namespace `documents.*`. Libellés d'enums — utiliser EXACTEMENT ces
  traductions FR (EN = version anglaise naturelle) :

  `material_type` (31) : gap_fill=Texte à trous ·
  comprehension_quiz=Quiz de compréhension · role_play_cards=Cartes de jeu
  de rôle · sentence_reordering=Phrases à remettre en ordre ·
  matching_exercise=Exercice d'appariement · dictogloss_notes=Notes de
  dictogloss · vocabulary_in_context=Vocabulaire en contexte ·
  summary_completion=Résumé à compléter · headline_matching=Titres à
  associer · discussion_cards=Cartes de discussion ·
  text_reconstruction=Reconstruction de texte ·
  categorization_grid=Grille de catégorisation · gap_fill_sentences=Phrases
  à trous · odd_one_out=Chassez l'intrus · word_formation_table=Tableau de
  formation des mots · flashcard_sheet=Planche de cartes mémo ·
  rule_summary_card=Fiche de synthèse · controlled_practice=Pratique
  guidée · error_correction=Correction d'erreurs · sorting_exercise=Exercice
  de tri · guided_production=Production guidée · register_analysis=Analyse
  de registre · reply_template=Modèle de réponse ·
  phrase_bank_extraction=Banque d'expressions ·
  sequencing_exercise=Exercice de séquençage ·
  imperative_extraction=Repérage des impératifs ·
  comprehension_check=Vérification de compréhension ·
  transformation_exercise=Exercice de transformation ·
  timeline_exercise=Exercice de chronologie ·
  character_analysis_card=Fiche d'analyse de personnage ·
  prediction_exercise=Exercice de prédiction

  `skill_focus` (7) : reading=Lecture · writing=Écriture ·
  speaking=Expression orale · listening=Compréhension orale ·
  grammar=Grammaire · vocabulary=Vocabulaire · mixed=Compétences mixtes

  `interaction_pattern` (6) : individual=Individuel ·
  teacher_student=Enseignant-élève · pairs=En binômes · group=En groupe ·
  small_group=Petits groupes · whole_class=Classe entière

  `inputKind` (7) : auto=Détection automatique · raw_content=Contenu brut
  (article, texte, dialogue) · lesson_plan=Plan de cours ·
  curriculum=Programme · worksheet_spec=Cahier des charges de fiche ·
  assessment_spec=Cahier des charges d'évaluation ·
  other_structured_spec=Autre document structuré

  `outputIntent` (5) : three_materials=Trois supports variés (recommandé) ·
  lesson_pack=Pack de cours · assessment_pack=Pack d'évaluation ·
  unit_snapshot=Synthèse d'unité · custom=Sur mesure

## 7. Tests à écrire (étendre `worker/lib/documents.test.ts`)

1. `GET /jobs` : liste les jobs du user (label depuis titre puis fallback
   contenu), n'expose jamais ceux d'un autre user, ordre anti-chrono.
2. `.html` : 200 + `text/html` + le titre du material présent dans le corps
   pour un job completed du user ; 404 job d'autrui ; 404 `idx` hors
   bornes (3, -1, non-numérique) ; 409 job non terminé ; 403 tier free.
3. `.pdf` : 503 `documents_pdf_unavailable` quand `BROWSER` est absent
   (c'est le cas en vitest — tester APRÈS les garde-fous : un job d'autrui
   doit répondre 404, pas 503) ; 403 tier free.
4. `listDocumentJobsForUser` : limite respectée.
Frontend : pas de harnais de test UI dans ce repo — la vérification UX est
manuelle (§8.2).

## 8. Checks de fin — Definition of Done (dans l'ordre, TOUS obligatoires)

### 8.1 Gate technique (les 4 checks du projet)
```
npm test              # 100 % vert (94 tests existants + les nouveaux)
npm run build         # build Vite + worker sans erreur TS
npm audit --omit=dev  # 0 vulnérabilité
git status            # arbre PROPRE après commit (rien d'oublié)
```

### 8.2 Vérification UX locale (manuelle, avant commit)
ATTENTION piège connu : `wrangler dev` sert le **dist prébuild** →
toujours `npm run build` avant `npx wrangler dev`. Ensuite, avec un compte
participant local, dérouler ce scénario complet :
1. Coller < 30 mots → bouton désactivé avec la raison ; coller un vrai
   contenu (> 100 mots) → compteurs OK.
2. Recharger la page AVANT de générer → le brouillon est restauré.
3. Générer → l'URL porte `?job=` ; recharger PENDANT l'attente → l'attente
   reprend (pas de perte).
4. Résultats : 3 cartes, tous les libellés traduits (aucun enum anglais
   brut à l'écran), durées affichées.
5. Aperçu de chaque document dans l'iframe (contenu lisible, style print).
6. Bouton PDF en local → toast « disponible sur la version en ligne »
   (503 attendu, PAS une erreur générique).
7. Basculer l'app en EN → toute la page est en anglais (zéro chaîne FR
   résiduelle) ; re-basculer FR.
8. « Documents récents » : le job apparaît ; cliquer dessus recharge ses
   résultats.
9. Échec simulé (couper OPENROUTER_API_KEY en dev ou forcer un job failed
   en base) → message chaleureux + « Réessayer » avec contenu intact.

### 8.3 Déploiement + vérification prod
Aucune migration D1. Séquence : `npm run build` → `npx wrangler deploy` →
puis :
1. `curl -s https://studio.teachinspire.me/api/health` → 200.
2. Login réel, générer un document de bout en bout sur
   https://studio.teachinspire.me/documents.
3. **Télécharger les 3 PDF réels** (Browser Rendering n'existe qu'en
   prod — c'est LA vérification qui ne peut pas se faire avant). Ouvrir
   chaque PDF : contenu complet, A4, corrigé présent. Noter d'éventuelles
   mauvaises coupes de page dans BUILD_LOG (elles nourrissent D3, ne pas
   les corriger ici).
4. Vérifier qu'un compte free reçoit bien le blocage participant (403)
   sur `/api/documents/transform`.

### 8.4 Clôture
- Entrée datée dans `BUILD_LOG.md` (section « Documents D2 ») : ce qui est
  livré, les observations PDF de prod pour D3, la version Worker déployée.
- Commit(s) atomiques, style du repo (ex. « documents: D2 — page
  /documents, aperçu iframe, PDF Browser Rendering ») ; push si les droits
  GitHub le permettent (voir note ci-dessous), sinon le signaler.

## 9. Hors périmètre (ne PAS faire ici)
- Perfection des sauts de page, harnais de coupes, numéros de page → D3.
- Aperçu paginé WYSIWYG (vraies pages A4 à l'écran) → D4, si D3 le justifie.
- Rebranding des 3 presets imprimés → décision produit séparée avec Greg.
- Suppression du spike D0 (`documents-spike.ts` + route `spike-pdf`) → D3.
- 301 renderinspire.* → chantier domaine, après D2.

## 10. Notes opérationnelles pour l'exécutant
- Push GitHub : le remote `gregld29200/promptomatik` peut refuser le push
  (droits en cours de résolution côté Greg). Committer localement propre ;
  si le push échoue, le dire explicitement, ne pas forcer.
- `DOCS_MODEL` est déjà configuré en prod (`google/gemini-3.1-pro-preview`
  via wrangler.jsonc) ; en dev, `.dev.vars` contient OPENROUTER_API_KEY.
- Le renderer échappe déjà le HTML (testé) — ne pas ré-échapper.
- Français des libellés : utiliser le §6 tel quel (déjà validé, accents
  compris — le test `i18n-fr-lint` bloque certaines régressions).
