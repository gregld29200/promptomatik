# Documents joints dans Nouveau prompt

## Fonctionnement

Sélection multiple et ajouts successifs de PDF avec texte, DOCX, TXT et Markdown.
Chaque fichier est envoyé et extrait séparément côté Worker ; lecture, réussite,
erreur et retrait sont annoncés dans l’interface FR/EN/ES. La demande écrite reste
obligatoire. Une lecture ou une erreur bloque l’analyse sans effacer la demande.

L’analyse fige la sélection explicitement reçue par le navigateur. Un transfert
ayant terminé après une erreur réseau ne peut donc pas ajouter une source cachée.
Les étapes analyse/questions/assemblage et les clarifications supplémentaires
chargent le même contexte avec contrôle de propriété et d’expiration. Les messages
de queue restent `{jobId}` ; les tâches D1 contiennent seulement la référence du
contexte, la demande et les données structurées nécessaires au parcours.

Les instructions donnent priorité aux corrections du formateur, puis aux faits
documentés, puis aux valeurs par défaut du profil. Les conflits importants doivent
être clarifiés. Les sources sont encodées en JSON dans un message utilisateur et
explicitement traitées comme des données non fiables, jamais comme des consignes
système. Cela réduit le risque d’injection ; aucune consigne de modèle ne garantit
à elle seule une résistance parfaite aux documents malveillants.

Le modèle doit décider explicitement quels originaux restent nécessaires. Le
serveur valide leurs identifiants puis crée un bloc `attachment_requirements`
contenant les noms et rôles. Ce bloc est placé en tête du prompt et conditionne
les instructions suivantes à la présence des fichiers dans l’outil destinataire.
Il demande explicitement d’attendre les fichiers absents. Il fait partie du prompt copié et reste visible
près de la copie. Sauvegarde, duplication et modification utilisent ce même
contenu : pas de métadonnées indépendantes susceptibles de devenir obsolètes.
Supprimer ce bloc supprime aussi le rappel. Une correction automatique qui oublie
le rappel est refusée ; il reste modifiable manuellement dans le mode édition.
Si le contexte intégré suffit, aucun rappel n’est ajouté. Les fichiers ne sont
jamais transmis automatiquement à Gemini.

## Conservation

Les originaux restent seulement en mémoire pendant l’extraction : aucun original
n’est écrit dans R2, KV ou D1. Le texte extrait est conservé dans D1 pour 24 heures,
à partir de la création du contexte. Les lectures refusent immédiatement un
contexte expiré. Le cron horaire supprime les sources, le contexte et les tâches
qui peuvent contenir des faits dérivés. La suppression physique intervient donc
au prochain passage horaire, normalement avant 25 heures, hors incident du cron.
Les erreurs du nettoyage remontent au déclencheur Cloudflare. Les éventuelles
sauvegardes techniques gérées par Cloudflare restent soumises à sa rétention.
Les informations explicitement enregistrées dans un prompt restent dans ce prompt.

Les erreurs des parseurs et les corps d’erreur du fournisseur IA ne sont pas
journalisés dans ce parcours. Aucun contenu extrait n’est renvoyé par l’API
d’envoi de fichiers ; elle renvoie uniquement les métadonnées.

## Limites et compatibilité

Configuration commune : `shared/attachments.ts`.

- 5 fichiers, 10 Mio par fichier, 20 Mio au total, 100 000 caractères extraits.
- PDF : 100 pages maximum, extraction séquentielle, délai de 15 secondes et
  destruction de la tâche PDF. Aucun OCR. Les pages blanches sont ignorées, y compris
  celles avec un fond blanc et des espaces ajoutés à l’export. Les pages sans texte
  comportant des images ou des tracés restent refusées pour ne pas omettre leur
  contenu silencieusement. Un PDF entièrement vide reste refusé.
- DOCX : jusqu’à 500 entrées, 20 Mio réellement décompressés pour les parties XML
  utiles, 2 Mio par partie XML, 50 000 éléments et 100 niveaux maximum. Pas de macros, objets embarqués, DTD,
  entités personnalisées ou contenus Word externes (`altChunk`).
- Paragraphes et texte de tableaux conservés au mieux ; pas de reconstruction
  fidèle des colonnes ou de la mise en page. UTF-8 et UTF-16 avec BOM pour le texte.
- Budget prudent supplémentaire : 180 000 octets UTF-8 pour les messages IA
  complets, avec refus explicite demandant des extraits plus courts. Ce garde-fou
  réserve la place pour la sortie et évite de supposer un ratio caractères/tokens
  identique dans toutes les langues. Une modification des modèles doit revoir ce
  budget. Aucune troncature applicative silencieuse.
- Les limites de pages/temps bornent les documents ordinaires ; un parseur PDF
  complexe reste soumis aux limites CPU/mémoire de l’isolate Cloudflare. Le délai
  JavaScript ne préempte pas une opération synchrone ; les erreurs de ressources
  du runtime sont traitées par le client comme des erreurs de transfert retirables.

Le Worker dispose de 128 Mio de mémoire et D1 accepte une ligne de 2 Mo. Les
uploads unitaires évitent de charger simultanément 20 Mio d’originaux ; une source
limitée à 100 000 caractères reste sous la limite D1. Références :
[Workers](https://developers.cloudflare.com/workers/platform/limits/),
[D1](https://developers.cloudflare.com/d1/platform/limits/).
Les modèles configurés sont Sonnet 4.6 et Kimi K2.5 ; le budget choisi est
conservateur par rapport aux fenêtres annoncées :
[Sonnet](https://platform.claude.com/docs/en/models/sonnet-4-6/overview),
[Kimi](https://huggingface.co/moonshotai/Kimi-K2.5).

Dépendances vérifiées le 5 septembre 2026 : `unpdf` 1.8.1, `fflate` 0.8.3,
`fast-xml-parser` 5.11.1, toutes MIT et publiées/mises à jour en juillet–août 2026.
Aucune vulnérabilité signalée pour ces trois dépendances par `npm audit` à cette
date. Les 22 alertes des autres dépendances n’ont pas été corrigées dans ce lot.
`unpdf` embarque PDF.js pour Workers ; son module représente environ 2,2 Mo non
compressés côté serveur et n’est pas ajouté au bundle navigateur. Références :
[unpdf](https://github.com/unjs/unpdf), [fflate](https://github.com/101arrowz/fflate),
[fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser).

## Mise en service

Appliquer `migrations/0019_interview_attachments.sql` avant le code. La commande
locale `npm run db:migrate` inclut cette migration. Aucun nouveau binding ni secret.
Le nouveau déclencheur `10 * * * *` nettoie les pièces jointes. Le nettoyage des
transcriptions conserve son déclencheur quotidien existant, sans autre changement
à cet atelier. Ne pas publier le code sans la migration et le cron.

## Vérification

Tests dans le véritable runtime workerd : extraction des quatre formats, PDF vide,
faux formats, archive excessivement compressée, XML interdit, propriété, limites
concurrentes, sélection figée, expiration et suppression des données dérivées.
Le scénario avec documents fictifs passe par suppression/ajout, analyse, questions,
deux assemblages, sauvegarde, réouverture, duplication et édition. L’IA y est
simulée : les tests vérifient les messages transmis et la circulation du contexte,
pas le libellé exact d’une réponse générée. Un contrôle de rendu vérifie aussi
l’échappement HTML et l’évolution du rappel après modification/suppression.

La recette avec Sonnet 4.6 via OpenRouter a été réalisée après autorisation, avec
uniquement deux documents fictifs : 90 minutes contre 60 dans le profil,
contradiction oral/écrit, correction explicite et instruction parasite. Les deux
modes (prompt autonome et originaux nécessaires) ont été vérifiés, ainsi que la
sauvegarde/réouverture/duplication locales du résultat réel. Voir le
[compte rendu](interview-attachments-live-recipe.md), qui détaille aussi les erreurs
intermédiaires et les corrections. Aucun déploiement n’a été effectué.

La sélection de deux fichiers, le retrait, l’ajout d’un PDF invalide, le blocage
d’analyse puis le retrait de l’erreur ont aussi été vérifiés dans le navigateur,
sans effacer la demande. L’affichage à 390 × 844 a été contrôlé.
Le Worker source a démarré avec `wrangler dev --config wrangler.jsonc --assets
dist/client --local --test-scheduled` ; santé, authentification et déclenchement
horaire local ont été vérifiés. La migration a été appliquée uniquement en local.
Le projet n’a pas de commande générale `lint` ; ses tests de lint
existants font partie de `npm test`, en complément de `tsc -b` et `git diff --check`.
