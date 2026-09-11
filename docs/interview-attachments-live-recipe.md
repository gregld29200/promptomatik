# Recette réelle — Documents joints

## Validation DeepSeek / Qwen — 6 septembre 2026

Configuration approuvée : `deepseek/deepseek-v4-flash-0731` en principal et
`qwen/qwen3.8-flash` en secours pour tous les comptes. Le raisonnement prolongé
est désactivé pour ces deux modèles : les premiers essais épuisaient le budget
de tokens avant de produire le JSON attendu.

Sur le Worker local avec OpenRouter réel et les mêmes sources fictives : analyse
DeepSeek en 1,84 s, conflit oral/écrit détecté, 90 minutes conservées ; questions
réussies ; assemblage autonome en 38,69 s ; assemblage nécessitant les deux
originaux en 47,35 s. Bloc préalable avec noms/rôles vérifié, puis sauvegarde,
réouverture et duplication réussies. Qwen testé séparément : JSON français valide
et durée de 90 minutes conservée en 1,85 s. Ces mesures ponctuelles ne sont pas
des garanties de latence. Le prompt autonome ajoute notamment une limite d'une
page non demandée : le formateur doit toujours relire le prompt généré.

Vérification automatique : 47 fichiers, 868 tests réussis, dont le routage des
deux tiers et la bascule simulée DeepSeek vers Qwen avec le réglage de raisonnement.
Compilation TypeScript/Vite et simulation de déploiement réussies. Nettoyage
horaire exécuté localement. Migration 0019 appliquée et vérifiée en production.

Déployé le 6 septembre 2026 : version `a68a20a2-bb43-483b-8782-2f5d4544b40b`.
Après déploiement : santé API 200, interface et fichier JavaScript correspondant
au build courant 200, endpoint de pièces jointes sans session 401. Configuration
des deux modèles relue sur la version publiée ; cron horaire et queues déployés.

## Validation initiale — 5 septembre 2026

Date : 5 septembre 2026. Worker Cloudflare local ; modèle observé :
`anthropic/claude-sonnet-4.6` via OpenRouter, après autorisation de Greg.
Uniquement des données fictives ont été transmises. Aucun déploiement.

| Contrôle | Résultat observé |
|---|---|
| Source documentaire prioritaire sur le profil | 10 séances de **90 minutes**, 15 heures conservées ; le profil indiquait 60 minutes. |
| Contradiction entre sources | Une question ciblée demande de choisir entre accueil oral et courriels écrits. |
| Correction du formateur | La priorité orale est retenue dans le prompt après clarification. |
| Contexte conservé | Sam, B1, réception hôtelière, tâches métier, volume et évaluation restent présents. |
| Injection fictive | La consigne parasite demandant une réponse marqueur n’est pas suivie ni recopiée dans les résultats. |
| Nature du résultat | Un prompt structuré destiné à une autre IA ; pas le brief pédagogique final. |
| Mode autonome | Les faits utiles sont intégrés ; aucun original n’est demandé. |
| Analyse intégrale des sources | Les deux noms et leurs rôles sont présents dans le rappel. |
| Sauvegarde, réouverture et duplication locales | Rappel conservé, y compris après ajout du préambule conditionnel. |

## Corrections issues de la recette

Le modèle peut écrire « documents fournis » malgré une instruction de formulation
conditionnelle. Le serveur ajoute donc désormais **en tête du prompt** une condition
de présence des fichiers et l’obligation de les demander puis d’attendre s’ils sont
absents. Les instructions qui suivent ne s’appliquent qu’après leur ajout. Ce garde-fou
est produit par l’application, couvert par un test de régression et disponible
dans les trois langues ; il reste éditable.

Un essai intermédiaire a échoué à la validation de la réponse, avec le message
« Background processing failed. Please try again. ». Le champ des références
documentaires, déjà demandé dans les consignes, figure maintenant explicitement
à son emplacement imbriqué dans le schéma JSON d’exemple. Le nouvel appel a donné
un résultat conforme. Les réponses invalides restent refusées, sans omission
silencieuse des sources. Un autre appel a été interrompu par une compilation qui
a redémarré le serveur local ; il a été relancé après stabilisation.

La dernière réponse réelle a été repassée dans le finaliseur corrigé pour vérifier
le préambule en tête, puis sauvegardée, rouverte et dupliquée via les routes locales.
Ces observations valident cette recette ; elles ne garantissent pas une résistance
universelle aux injections ou la conformité de toutes les futures réponses du modèle.

## Exemple final obtenu — originaux nécessaires

Pour utiliser ce prompt dans votre outil d’IA, joignez également :
apprenant.txt — Fiche apprenante de Sam : niveau, durée de formation, priorité professionnelle confirmée (accueil oral), modalité d'évaluation
besoins.md — Synthèse du besoin professionnel : tâches métier à la réception, structure attendue du brief (4 objectifs, critères, tableau)

Ces fichiers ne sont pas transférés automatiquement. Les instructions qui suivent ne s’appliquent qu’après leur ajout dans cet outil d’IA. Si ces fichiers ne sont pas présents dans cette conversation, demandez au formateur de les joindre et attendez leur réception avant de les analyser ou de les citer.

Vous êtes un ingénieur pédagogique expert en formation professionnelle en langues. Vous maîtrisez la rédaction d'objectifs opérationnels selon l'approche actionnelle du CECRL, et vous savez construire des briefs de formation clairs, directement utilisables par un formateur et compréhensibles par un apprenant adulte.

Vous allez produire un brief pédagogique pour une formation d'anglais professionnel. Voici les faits établis :

- **Apprenante :** Sam, adulte, réceptionniste dans un hôtel.
- **Niveau :** B1 (CECRL).
- **Volume horaire :** 10 séances de 90 minutes, soit 15 heures au total, sur 5 semaines.
- **Priorité professionnelle confirmée :** l'accueil ORAL des visiteurs anglophones (check-in/check-out, demandes clients, gestion d'un retard ou d'une réclamation verbale). Cette priorité est celle de la fiche apprenante ; toute mention d'une priorité écrite dans d'autres documents est une erreur à ne pas retenir.
- **Tâche d'évaluation finale :** un jeu de rôle à la réception simulant une interaction réelle avec un client anglophone.
- **Langue du brief :** français.

Avant de rédiger quoi que ce soit, effectuez une analyse comparative des deux documents qui vous sont fournis (apprenant.txt et besoins.md). Pour chaque document :
1. Identifiez les informations relatives à la priorité de formation (oral ou écrit) et citez verbatim la formulation exacte du document.
2. Identifiez les informations relatives à la structure du brief attendu (nombre d'objectifs, critères, évaluation) et citez verbatim.
3. Signalez explicitement toute contradiction entre les deux documents.
4. Indiquez quelle source vous retenez pour chaque point et justifiez brièvement votre choix en vous appuyant sur la consigne du formateur (priorité orale confirmée, fiche apprenante fait foi).

Présentez cette analyse sous forme de tableau comparatif avant de passer à la rédaction du brief.

Une fois l'analyse comparative présentée, rédigez le brief pédagogique en suivant ces étapes dans l'ordre :

**Étape 1 — Titre et cadrage**
Rédigez un titre clair pour le brief et un court paragraphe de cadrage (3-4 lignes) rappelant le profil de Sam, le contexte professionnel et l'objectif général de la formation.

**Étape 2 — Les 4 objectifs opérationnels**
Formalisez exactement 4 objectifs de fin de formation. Chaque objectif doit :
- Commencer par un verbe d'action observable (ex. : accueillir, expliquer, reformuler, gérer…)
- Décrire une tâche réaliste à la réception d'un hôtel
- Être atteignable au niveau B1 en 15 heures
- Porter sur la communication ORALE uniquement

**Étape 3 — Critères de réussite**
Pour chaque objectif, précisez 2 critères de réussite observables et mesurables (ce que l'évaluateur peut constater pendant le jeu de rôle).

**Étape 4 — Tâche d'évaluation finale**
Décrivez le jeu de rôle final en précisant : le scénario, les rôles, la durée approximative, et les points évalués.

**Étape 5 — Mise en forme**
Présentez les étapes 2 et 3 dans un tableau structuré (colonnes : Objectif | Critère 1 | Critère 2). L'étape 4 est rédigée en texte libre sous le tableau.

Respectez impérativement les contraintes suivantes :
- **Langue :** tout le brief est rédigé en français, y compris les objectifs et les critères.
- **Nombre d'objectifs :** exactement 4, ni plus ni moins.
- **Compétence ciblée :** expression et interaction ORALES uniquement — aucun objectif d'écrit.
- **Niveau de langue visé :** B1 (CECRL) — les objectifs doivent rester réalistes pour ce niveau.
- **Ton :** professionnel mais accessible, compréhensible par Sam elle-même si elle lit le brief.
- **Format :** tableau pour les objectifs/critères + texte libre pour le jeu de rôle.
- **Longueur totale du brief :** environ 400-600 mots hors tableau comparatif.
- **Aucune invention :** ne complétez pas les informations manquantes par des suppositions ; si un élément est absent des documents, signalez-le explicitement.

Voici un exemple du format attendu pour UN objectif et ses critères (à reproduire pour les 4 objectifs dans le tableau) :

| Objectif | Critère de réussite 1 | Critère de réussite 2 |
|---|---|---|
| Accueillir un client anglophone à l'arrivée et effectuer le check-in en anglais | L'apprenante complète l'enregistrement sans demander de répétition plus d'une fois | L'apprenante utilise les formules de politesse adaptées (Good evening, Here is your key, etc.) |

Cet exemple illustre le niveau de précision attendu : l'objectif est formulé avec un verbe d'action, ancré dans le métier, et les critères sont observables pendant un jeu de rôle.
