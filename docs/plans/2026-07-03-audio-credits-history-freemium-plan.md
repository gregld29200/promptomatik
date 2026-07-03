# Plan — Achat de crédits, gestion de l'historique audio, verrouillage freemium

Date : 2026-07-03 · Statut : proposition, en attente des décisions de Greg
Périmètre : trois évolutions post-V1 du TeachInspire Audio Studio.

---

## 1. Achat de crédits (Stripe — le « V1.5 » du PRD REQ-8.3)

### Existant sur lequel on s'appuie
- `credit_balances` (soldes non expirants) et `quota_ledger` (mouvements audités) sont en production.
- La consommation débite déjà « inclus d'abord, puis crédits ».
- L'entrée d'achat actuelle est le stub mailto affiché quand la génération est bloquée.
- L'octroi admin de crédits fonctionne (dashboard Audio).

### Architecture proposée (Stripe Checkout, hébergé par Stripe)
Aucune donnée carte ne touche notre Worker ; pas de SDK nécessaire (API REST Stripe via fetch, signature webhook vérifiable en WebCrypto).

1. **Packs** : 3 produits Stripe (ex. 60 min / 180 min / 600 min — prix à fixer).
   Les `price_id` vivent en vars wrangler ; les libellés/minutes dans la config audio.
2. **`POST /api/audio/credits/checkout`** (derrière `requireParticipant`) :
   crée une Checkout Session (`client_reference_id = userId`, metadata = pack),
   URLs de retour vers `/audio?checkout=success|cancelled`. Renvoie l'URL Stripe.
3. **`POST /api/stripe/webhook`** :
   - vérification de signature `Stripe-Signature` (HMAC-SHA256, WebCrypto) ;
   - sur `checkout.session.completed` : octroi **idempotent** — nouvelle table
     `stripe_events(event_id TEXT PRIMARY KEY, processed_at)` pour ne jamais
     créditer deux fois, puis ledger + solde en un batch D1.
4. **Migration 0012** : rebuild de `quota_ledger` pour ajouter la raison
   `credit_purchase` au CHECK + colonne `stripe_ref TEXT` (traçabilité).
5. **UI** :
   - le stub mailto devient un bouton « Acheter des minutes » (état bloqué **et**
     à côté de la jauge de quota) ;
   - modale de choix de pack (3 cartes, prix TTC) → redirection Checkout ;
   - au retour `checkout=success` : toast + rafraîchissement de la jauge
     (le webhook aura crédité ; prévoir un léger polling si le webhook arrive
     après le retour navigateur).
6. **Admin** : le dashboard Audio gagne une ligne « revenus crédits » et les
   achats apparaissent dans le ledger (`credit_purchase`, réf Stripe).
7. **Secrets/config** : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
   (wrangler secrets) ; price IDs en vars.

### Cas limites couverts par le plan
- Remboursement : webhook `charge.refunded` → mouvement négatif `admin_adjust`
  (si solde insuffisant au moment du remboursement : solde à 0 + alerte admin).
- TVA : activer **Stripe Tax** (géré côté Checkout, zéro code).
- Reçus : emails Stripe natifs.

### Décisions attendues (Greg)
- D1. Tailles et prix des packs (référence coût : ~1,80 $/h généré en Finale).
- D2. TVA via Stripe Tax : oui/non.
- D3. Les freemium peuvent-ils acheter des crédits sans être participants ?
  (Recommandation : **non** en V1.5 — le checkout reste derrière
  `requireParticipant` ; voir §3.)

### Effort estimé
Une phase (~1 journée de build + tests), plus la configuration du compte
Stripe (produits, webhook, clés) côté Greg. Testable de bout en bout en mode
test Stripe avant activation.

---

## 2. Historique des audios générés

### La réalité des coûts d'abord (mesurée sur les prises pilotes)
Un MP3 128 kbps pèse ~0,95 Mo/minute. R2 coûte ~0,015 $/Go-mois.
→ **100 utilisateurs conservant chacun 60 min = ~5,7 Go = ~0,09 $/mois.**
Le stockage n'est PAS le facteur limitant ; c'est un choix produit, pas un
problème de coût. Le vrai enjeu est la clarté pour l'utilisateur.

### Existant
- Les fichiers expirent à 7 jours (lifecycle R2 sur `audio/`) ; script et
  réglages restent en D1 pour toujours ; « Dupliquer » recharge tout en un clic.
- L'historique affiche « Expire dans X j ».

### Options
- **A. Statu quo assumé** : 7 jours, l'utilisateur télécharge ce qu'il garde.
  Zéro travail, mais frustration prévisible (« mon audio a disparu »).
- **B. Épingler pour conserver (recommandée)** :
  - une étoile « Conserver » par prise → copie `final.mp3` + `transcript.txt`
    vers un préfixe `keep/{userId}/{jobId}/` **sans** lifecycle ;
  - plafond de conservation par utilisateur (proposition : **120 min** de
    prises épinglées, soit ~115 Mo — coût ~0,002 $/utilisateur/mois) ;
  - jauge « Conservés : 43 / 120 min » dans l'historique ; désépingler libère ;
  - le reste continue d'expirer à 7 jours — comportement inchangé.
- **C. Régénération one-clic depuis l'historique** (complémentaire de B) :
  sur une ligne expirée, un bouton « Régénérer » relance le job avec les mêmes
  réglages (le pipeline existe déjà — c'est Dupliquer + Générer automatisés).
  Débite le quota normalement : l'audio expiré n'est jamais « perdu », il
  coûte juste une re-génération.
- **D. Ménage D1** (indépendant) : suppression manuelle d'une ligne
  d'historique + purge automatique des rows > 6 mois (les scripts s'accumulent
  sinon indéfiniment).

### Recommandation
**B + C + D** : 7 jours par défaut (inchangé), épingler ce qu'on veut garder
(plafonné), régénérer en un clic ce qui a expiré, ménage D1 en tâche de fond.
L'utilisateur comprend la règle en une phrase : « Vos audios vivent 7 jours ;
épinglez ceux à garder ; le reste se régénère en un clic. »

### Décisions attendues (Greg)
- D4. Choix des options (recommandation : B + C + D).
- D5. Plafond d'épinglage par utilisateur (proposition : 120 min).
- D6. Durée de rétention des lignes d'historique D1 (proposition : 6 mois).

### Effort estimé
B : ~½ journée (copie R2 sans lifecycle + plafond + UI étoile/jauge).
C : ~2 h (bouton + endpoint réutilisant createAudioJob). D : ~2 h.

---

## 3. Freemium : verrouillage du Studio audio

### État vérifié (2026-07-03) — la protection existe déjà
- Toutes les routes participant (`quota`, `voices`, `preview`, `prepare`,
  `jobs` ×5, `download`) sont derrière `requireParticipant`, qui lit le tier
  **en D1 à chaque requête** (un changement de tier s'applique immédiatement).
  Les routes admin sont derrière `requireAdmin`. Vérifié route par route.
- L'inscription freemium self-serve crée un compte tier `free` ; seules les
  invitations admin donnent `participant`.
- Un utilisateur free qui ouvre `/audio` voit l'écran verrouillé (teaser) ;
  tout appel API direct reçoit `403 tier_required`.
→ **Un freemium ne peut ni voir, ni générer, ni télécharger, ni acheter.**

### Renforts proposés (petits)
1. **Teaser vendeur plutôt que cadenas sec** : le teaser actuel liste les
   fonctionnalités ; ajouter un CTA explicite « Réservé aux participants de la
   formation TeachInspire » + lien vers la page formation (conversion, pas
   seulement blocage).
2. **Test automatisé de non-régression du gating** : un test worker-pool qui
   parcourt TOUTES les routes `/api/audio/*` avec une session free et exige
   403 — pour qu'aucune future route n'oublie le middleware (c'est l'erreur
   la plus probable à long terme).
3. **Règle produit à acter** : l'achat de crédits (§1) reste réservé aux
   participants — les crédits complètent le quota inclus, ils ne donnent pas
   l'accès. Si un jour l'audio se vend hors formation, ce sera un tier
   distinct, pas un contournement par la caisse.
4. **Option future (non construite)** : « découverte » — une prise d'essai
   unique de 2-3 min pour les freemium, comme aimant vers la formation.
   Décision marketing ; l'infrastructure quota/ledger la permettrait
   facilement le moment venu.

### Décisions attendues (Greg)
- D7. Renfort 1 (teaser + CTA formation) : oui/non, et l'URL de destination.
- D8. Option découverte freemium : à garder pour plus tard ou à planifier.

---

## Ordre de mise en œuvre proposé

1. **Gating** (renforts 1-2 du §3) — 2 h, aucun risque, verrouille l'avenir.
2. **Historique B + C + D** — ~1 jour, améliore l'expérience de tous les
   participants actuels.
3. **Stripe** — ~1 jour de build + setup compte, dès que D1-D3 sont tranchées.
