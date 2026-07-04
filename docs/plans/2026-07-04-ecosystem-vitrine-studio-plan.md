# Plan — Unification vitrine (teachinspire.me) × Studio : écosystème & échelle de valeur

Date : 2026-07-04 · Statut : validé par Greg (option A). Chantier bi-repo :
`teach/promptomatik` (le Studio, Workers) et
`swift/teachinspire-mainsite-v2` (la vitrine, Cloudflare Pages).
Implémentation **phase par phase** ; les formulations sont relues avec Greg
après chaque phase, avant déploiement.

---

## 0. Décisions verrouillées (ne PAS rouvrir — arbitrées le 2026-07-04)

1. **Échelle de valeur (Hormozi)** : Free → **Individuel** (self-service à
   terme) → **Institut** (appel). Les trois visibles sur la vitrine.
   Offre individuelle = e-learning + accès apps (quotas 12 mois) + office
   hours 2×/mois. **Option A actée** : au lancement, le CTA Individuel
   pointe vers un appel/contact — la machinerie self-service (produit
   Stripe, tier avec expiration, provisioning auto) est un chantier
   ultérieur dédié, PAS celui-ci.
2. **Marque** : TeachInspire Studio = ombrelle. Modules descriptifs :
   Prompts (nom d'usage : Promptomatik), Audio, Documents. Aucune marque
   autonome, aucun domaine séparé pour le lead magnet.
3. **Lead magnet** : Promptomatik en freemium fait *visiter le Studio* —
   l'utilisateur gratuit voit Audio/Documents verrouillés dans la nav :
   c'est la porte entrouverte qui convertit.
4. **Grille freemium à afficher** (état réel du code, vérifié) :
   5 générations/jour (`DAILY_INTERVIEW_LIMIT`) · 3 prompts sauvegardés
   (`FREE_LIBRARY_LIMIT`) · pas d'éditeur de blocs · Audio/Documents
   verrouillés mais visibles. Essai audio gratuit : EN RÉSERVE, pas au
   lancement.
5. **Login vitrine** : UN bouton « Se connecter » → studio.teachinspire.me.
   Jamais deux logins côte à côte. La communauté (community.teachinspire.me,
   ne jamais nommer Heartbeat) s'atteint depuis l'intérieur du Studio et
   l'email d'onboarding. La couture des deux systèmes de comptes doit
   rester invisible pour le visiteur.
6. **Message** : « la méthode d'abord, les raccourcis ensuite ». La
   formation enseigne comment l'IA marche (outils ouverts) ET donne accès
   aux outils maison pensés pour l'enseignement. On n'enferme pas ; on
   accélère.
7. **Tutos/vidéos** : page `/tutoriels` DIFFÉRÉE (aucune vidéo n'existe).
   Hébergement futur : **Cloudflare Stream, pas YouTube** (choix Greg).
   Publics = tutos *outils* (font vendre) ; privés (e-learning communauté)
   = leçons de *méthode*.
8. **Page d'accueil vitrine** (login pour les connectés / présentation
   sinon) : **lot de Greg**, hors périmètre.
9. **Copywriting** : chaque texte visiteur passe par le skill `humanizer`
   (+ `french-ai-detector` pour le FR), puis liste [REVIEW GREG] → session
   de relecture commune → seulement ensuite déploiement.

## 1. État des lieux (audits 2026-07-04)

### Vitrine (mainsite-v2)
- Vite + React 19 + Tailwind + framer-motion/GSAP, **Cloudflare Pages**
  (wrangler.toml `pages_build_output_dir = "dist"`), français uniquement,
  pas de tests (gate = `npm run build` + `npm run lint` + QA visuelle).
- Design « Swiss editorial » — tokens quasi identiques au Studio (navy
  #2c3d57, cream, sage #85a2a3, yellow #f1d263, Fraunces + DM Sans).
- Routes : `/` (11 sections), `/formation`, `/a-propos`, `/contact`,
  légal ×2, cachées : `/offre`, `/invite`. `PlateformePage.tsx` existe
  mais N'EST PAS routée (code mort à supprimer).
- CTA unique partout : cal.com (`https://cal.com/teachinspire.me`).
- **Zéro mention** du Studio/Promptomatik/communauté. Références
  périmées : « Prompt Builder Pro (accès à vie) » (bloc Outils maison,
  `src/pages/FormationPage.tsx` ~l.103) ; FAQ « On travaille surtout avec
  Google AI Studio, gratuit » (`src/components/sections/FAQ.tsx` l.19).
- Fonctions Pages internes (`functions/__ti/...` growth board D1) : ne pas
  toucher.

### Studio (promptomatik)
- Arrivée post-login actuelle : directement `/prompts` — pas de hub.
- Nav Shell : Mes prompts · Nouveau prompt · Modèles · Audio · Documents ·
  Profil · Admin (+ langue) — collapse hamburger < 900 px (leçon apprise :
  vérifier la largeur à chaque ajout).
- Aucun lien vers la communauté nulle part.
- Freemium opérationnel (signup public `/signup`, gating par tier en D1).
- promptomatik.com : domaine custom qui SERT l'app (pas encore de 301).

## 2. Phase 1 — Studio : le hub « 3 portes » (repo promptomatik)

Objectif : une page d'accueil post-login qui unifie les trois modules,
donne accès aux bibliothèques, et rend la couture communauté invisible.

- **Route `/home`** (ProtectedRoute) = atterrissage par défaut post-login
  et cible du clic logo. Les redirections legacy existantes ne changent
  pas ; `/prompts` reste accessible tel quel.
- **Contenu** : 3 cartes module — Prompts (Promptomatik), Audio,
  Documents. Chaque carte : nom, une phrase d'usage (« ce que ça fait
  pour un cours »), compteur/aperçu récent (réutiliser les endpoints de
  liste existants : prompts récents, `getAudioJobs(3,0)`,
  `getDocumentJobs()`), lien principal + lien bibliothèque (Mes prompts /
  `/audio/library` / documents récents).
- **Tier free** : cartes Audio + Documents rendues en état verrouillé
  élégant (cadenas, une phrase de valeur, CTA upgrade réutilisant
  `UpgradeGate`/le pattern existant) — c'est la porte entrouverte, elle
  doit donner envie, pas punir.
- **Communauté** : carte/lien « Espace formation » →
  https://community.teachinspire.me, **participants uniquement** (les
  free ne voient rien — pas de teasing d'un espace qu'ils ne peuvent pas
  rejoindre). Ajouter aussi l'entrée dans le menu profil si trivial,
  sinon hub seulement. Ne PAS élargir la nav principale (largeur !).
- i18n FR/EN complet ; design tokens existants ; pas de nouvelle dépendance.
- **Checks** : gate 4 points du repo (test/build/audit/git propre) ;
  vérif UX locale (free vs participant, FR/EN, mobile 375 px) ; deploy +
  smoke prod ; BUILD_LOG.

## 3. Phase 2 — Vitrine : recalage du message (repo mainsite-v2)

Objectif : plus une seule ligne périmée ; le narratif outils reflète
l'écosystème. AUCUNE nouvelle page dans cette phase.

- `FormationPage` bloc « Outils maison » → « TeachInspire Studio » :
  Prompts (Promptomatik) · Audio · Documents, accès pendant la formation,
  mises à jour incluses. Supprimer « Prompt Builder Pro (accès à vie) ».
- `FAQ.tsx` réponse outils : réécrire — la formation enseigne sur les
  outils ouverts (Google AI Studio y compris) ET donne accès aux outils
  maison du Studio ; l'objectif anti-pile-d'abonnements reste vrai.
- Scan complet des sections (`Approach`, `HowItWorks`, `Problem`,
  `Philosophy`, `Founder`, `Results`, `Modules`, `Testimonials`) pour
  toute mention outil périmée ; le cœur « méthode d'abord » ne bouge pas.
- Supprimer `src/pages/PlateformePage.tsx` (non routée, code mort).
- **Copy protocol** (décision 9) : rédaction → humanizer +
  french-ai-detector → liste [REVIEW GREG] → relecture commune → deploy.
- **Checks** : `npm run build` + `npm run lint` verts ; diff de copy
  complet présenté à Greg ; QA visuelle des pages touchées ; commit propre.

## 4. Phase 3 — Vitrine : page /studio + échelle + login (repo mainsite-v2)

- **Page `/studio`** (routée, dans la nav « Studio ») :
  1. Hero : le narratif méthode/raccourcis (décision 6).
  2. Les 3 modules, chacun avec capture d'écran réelle (à prendre en prod
     avec un compte de démo au contenu propre — jamais de données
     personnelles) + 2-3 phrases de valeur enseignant.
  3. La porte entrouverte : ce que le compte gratuit permet (grille de la
     décision 4, chiffres exacts) — CTA « Créer un compte gratuit » →
     https://studio.teachinspire.me/signup.
  4. **Échelle des offres** : Free (self-service immédiat) · Individuel
     (e-learning + apps 12 mois + office hours — CTA appel/contact,
     option A) · Institut (formation d'équipe — CTA cal.com existant).
  5. Mini-FAQ outils (3-4 questions max).
- **Header** : bouton « Se connecter » (style secondaire, persistant
  desktop + menu mobile) → https://studio.teachinspire.me. Ajout du lien
  nav « Studio ». Footer : lien Studio.
- Style : composants existants (SectionTitle, Button, Badge, grille 12
  col, numéros décoratifs) — la page doit être indiscernable du reste.
- Même copy protocol + mêmes checks que Phase 2 ; captures optimisées
  (WebP, lazy).

## 5. Phase 4 — Bascule domaine (repo promptomatik)

- 301 dans `worker/index.ts` : si `Host: promptomatik.com` (ou www) →
  `https://studio.teachinspire.me{path}{query}`, 301 permanent. Le
  domaine custom reste attaché au Worker (c'est lui qui sert le 301).
- Emails : l'expéditeur `noreply@promptomatik.com` NE CHANGE PAS (DKIM).
- renderinspire.* → studio.teachinspire.me/documents : dépend de là où ce
  domaine est hébergé aujourd'hui (app Next.js séparée) — action DNS de
  Greg, checklist fournie le moment venu.
- **Checks** : test unitaire du redirect (Host header) ; deploy ; curl
  des deux hosts (200 studio / 301 promptomatik avec Location exact) ;
  vérifier qu'un lien profond (`promptomatik.com/prompts/xyz`) redirige
  chemin compris ; BUILD_LOG.

## 6. Hors périmètre (rappel)

- Machinerie self-service Individuel (Stripe + tier expirant +
  provisioning) → chantier dédié ultérieur.
- Page `/tutoriels` → quand ≥ 2-3 vidéos existent (Cloudflare Stream).
- Page d'accueil login/présentation de la vitrine → Greg.
- Unification des comptes Studio/communauté → non, seulement la
  *perception* d'unité (décision 5).
- Essai audio freemium → en réserve.

## 7. Ordre d'exécution et jalons de relecture

Phase 1 (Studio hub) → **relecture Greg** (UX + textes FR/EN du hub) →
Phase 2 (message) → **relecture Greg** (diff de copy) → Phase 3 (/studio)
→ **relecture Greg** (page complète + copy) → Phase 4 (301, mécanique,
pas de copy). Chaque phase se déploie indépendamment après sa relecture.
