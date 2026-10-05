// "Prise en main de Documents": narration, shots and the demo worksheet.
import type { Chapter, TutorialScript } from "../tutorial/types";

/** The worksheet the teacher copies from Google Docs, as Docs puts it on the clipboard. */
export const DEMO_PASTE_HTML = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-demo">
<h1 dir="ltr"><span style="font-size:20pt;font-weight:700;">Fiche apprenant — Le jour de l'emménagement</span></h1>
<p dir="ltr"><span style="font-weight:700;">Objectif :</span><span> comprendre un dialogue du quotidien et parler de son logement.</span></p>
<p dir="ltr"><span style="font-weight:700;">Niveau :</span><span> B1 · </span><span style="font-weight:700;">Durée :</span><span> 45 min</span></p>
<h2 dir="ltr"><span>Activité 1 — Écoute globale</span></h2>
<p dir="ltr"><span>Écoutez le dialogue entre Leïla et Antoine. Où sont-ils ?</span></p>
<p dir="ltr"><span>a) Dans un magasin de meubles</span></p>
<p dir="ltr"><span>b) Dans leur nouvel appartement</span></p>
<p dir="ltr"><span>c) Chez des voisins</span></p>
<h2 dir="ltr"><span>Activité 2 — Vrai ou faux ?</span></h2>
<ol><li aria-level="1"><p><span>Leïla porte un carton plein de livres.</span></p></li><li aria-level="1"><p><span>Antoine veut mettre la table dans la chambre.</span></p></li><li aria-level="1"><p><span>Il reste encore une vingtaine de boîtes à ouvrir.</span></p></li></ol>
<h2 dir="ltr"><span>Activité 3 — Où va chaque meuble ?</span></h2>
<div dir="ltr"><table><tbody>
<tr><td><p><span style="font-weight:700;">Meuble</span></p></td><td><p><span style="font-weight:700;">Pièce</span></p></td><td><p><span style="font-weight:700;">Où exactement ?</span></p></td></tr>
<tr><td><p><span>La bibliothèque</span></p></td><td><p><span>Le salon</span></p></td><td><p><span>À côté du canapé</span></p></td></tr>
<tr><td><p><span>La table</span></p></td><td><p><span> </span></p></td><td><p><span> </span></p></td></tr>
<tr><td><p><span>Les livres</span></p></td><td><p><span> </span></p></td><td><p><span> </span></p></td></tr>
</tbody></table></div>
<h2 dir="ltr"><span>Activité 4 — Complétez</span></h2>
<p dir="ltr"><span>Banque de mots : bibliothèque, carton, week-end</span></p>
<ol><li aria-level="1"><p><span>Ce _______ est trop lourd pour moi.</span></p></li><li aria-level="1"><p><span>On pourrait mettre une petite _______ à côté du canapé du salon.</span></p></li><li aria-level="1"><p><span>Pas de panique, on a tout le _______.</span></p></li></ol>
<blockquote><p><span style="font-weight:700;">Rappel :</span><span> on </span><span style="font-style:italic;">emménage</span><span> dans un nouveau logement ; on </span><span style="font-style:italic;">déménage</span><span> quand on le quitte.</span></p></blockquote>
<h2 dir="ltr"><span>Activité 5 — À vous !</span></h2>
<p dir="ltr"><span>Décrivez la pièce que vous préférez chez vous, en quelques phrases.</span></p>
<p dir="ltr"><span>[lignes: 5]</span></p>
<p dir="ltr"><span>- [ ] Je nomme au moins trois meubles.</span></p>
<p dir="ltr"><span>- [ ] J'utilise des prépositions de lieu.</span></p>
<p dir="ltr"><span>- [ ] Je dis pourquoi j'aime cette pièce.</span></p>
</b>`;

/** The illustration is placed just before this line. */
export const IMAGE_BEFORE = "## Activité 1";
export const IMAGE_FILE = "Cartons du déménagement.png";
export const EMPHASIS = "carton, canapé, bibliothèque";
export const FOOTER = "Atelier de français · Session d'automne";
/** The colour picked in the Apparence panel. */
export const ACCENT = "#2c5f7c";

export const CHAPTERS: Chapter[] = [
  {
    id: "ch0",
    label: "0",
    title: "Le résultat d'abord",
    paragraphs: [
      {
        id: "ch0-1",
        text: "Voici ce qu'on va obtenir : une fiche d'exercices propre, prête à imprimer ou à partager en PDF. Et tout part d'un texte que j'avais déjà. Vos mots ne sont jamais réécrits : Documents s'occupe seulement de la mise en page.",
        scene: "result",
        beats: [{ shot: "empty", focus: "page" }],
      },
      {
        id: "ch0-2",
        text: "L'écran suit trois étapes. D'abord, on colle son texte. Ensuite, on dit de quel document il s'agit. Puis on vérifie l'aperçu avant de télécharger. À droite, vos documents récents restent à portée de main.",
        beats: [
          { shot: "empty", focus: "page" },
          { at: 0.14, shot: "empty", focus: "page", spotlight: "step1", callout: { target: "step1", text: "1 · Coller" } },
          { at: 0.32, shot: "empty", focus: "page", spotlight: "step2", callout: { target: "step2", text: "2 · Dire ce que c'est", side: "above" } },
          { at: 0.55, shot: "preview", focus: "page", spotlight: "reviewTop", callout: { target: "reviewTop", text: "3 · Vérifier, télécharger" } },
          { at: 0.78, shot: "empty", focus: "recent", spotlight: "recent" },
        ],
      },
    ],
  },
  {
    id: "ch1",
    label: "1",
    title: "Coller son texte",
    paragraphs: [
      {
        id: "ch1-1",
        text: "Tout commence à l'étape 1. Ma fiche, je l'ai préparée dans Google Docs. Je la copie, et je la colle ici telle quelle. Ça marche aussi depuis Gemini ou Word.",
        beats: [
          { shot: "empty", focus: "step1", spotlight: "step1" },
          { at: 0.5, shot: "empty", focus: "step1", spotlight: "textarea", click: "textarea", callout: { target: "textarea", text: "Coller tel quel" } },
        ],
      },
      {
        id: "ch1-2",
        text: "Regardez : les titres, le gras, les listes et même le tableau sont conservés. Rien n'est réécrit, et je peux encore tout modifier, directement dans le cadre.",
        beats: [
          { shot: "pasted", focus: "textarea", spotlight: "textarea", callout: { target: "textarea", text: "Titres et gras conservés" } },
          { at: 0.42, shot: "pastedTable", focus: "textarea", spotlight: "textarea", callout: { target: "textarea", text: "Le tableau aussi" } },
        ],
      },
      {
        id: "ch1-3",
        text: "Je veux aussi une illustration. Je place le curseur à l'endroit voulu, je clique sur « Ajouter une image », et je choisis mon fichier. L'image se place là, avec sa légende.",
        beats: [
          { shot: "cursor", focus: "textarea", spotlight: "textarea" },
          { at: 0.12, shot: "cursor", focus: "textarea", spotlight: "textarea", click: "caret" },
          { at: 0.38, shot: "cursor", focus: "contentTools", spotlight: "addImage", click: "addImage" },
          { at: 0.72, shot: "image", focus: "textarea", spotlight: "textarea", callout: { target: "caret", text: "L'image et sa légende" } },
        ],
      },
      {
        id: "ch1-4",
        text: "Et pour savoir ce que Documents reconnaît, ouvrez ce petit aide-mémoire : titres, listes, cases à cocher, tableaux, encadrés, et même des lignes pour écrire la réponse.",
        beats: [
          { shot: "image", focus: "contentTools", spotlight: "syntaxToggle", click: "syntaxToggle" },
          { at: 0.3, shot: "syntax", focus: "syntaxHelp", spotlight: "syntaxHelp" },
        ],
      },
    ],
  },
  {
    id: "ch2",
    label: "2",
    title: "Dire ce que c'est",
    paragraphs: [
      {
        id: "ch2-1",
        text: "Deuxième étape : c'est quel document ? Le catalogue est rangé selon qui va le lire : ce qu'on distribue à l'apprenant, ce qui est pour vous, l'enseignant, et ce qui sert à cadrer une formation.",
        beats: [
          { shot: "types", focus: "step2", spotlight: "step2Head" },
          { at: 0.42, shot: "types", focus: "catalogue", spotlight: "groupLearner", callout: { target: "groupLearner", text: "Pour l'apprenant", side: "above" } },
          { at: 0.64, shot: "types", focus: "catalogue", spotlight: "groupTeacher", callout: { target: "groupTeacher", text: "Pour vous" } },
          { at: 0.82, shot: "types", focus: "catalogue", spotlight: "groupCourse", callout: { target: "groupCourse", text: "Pour la formation" } },
        ],
      },
      {
        id: "ch2-2",
        text: "Ici, c'est une fiche d'exercices : je choisis « Support apprenant ». Le type ajoute seulement l'habillage utile : une ligne pour le nom et la date, des cases vrai ou faux, de la place pour répondre. Votre texte, lui, ne change pas.",
        beats: [
          { shot: "types", focus: "groupLearner", spotlight: "typeWorksheet", click: "typeWorksheet" },
          { at: 0.3, shot: "typeSelected", focus: "groupLearner", spotlight: "typeWorksheet", callout: { target: "typeWorksheet", text: "L'habillage, pas le texte" } },
        ],
      },
      {
        id: "ch2-3",
        text: "Et si aucun type ne correspond, « Document libre » met votre texte en page tel quel, sans habillage.",
        beats: [{ shot: "typeSelected", focus: "groupOther", spotlight: "typeFree", callout: { target: "typeFree", text: "Tel quel" } }],
      },
    ],
  },
  {
    id: "ch3",
    label: "3",
    title: "Les précisions",
    paragraphs: [
      {
        id: "ch3-1",
        text: "Juste en dessous, les précisions facultatives. Rien d'obligatoire : le titre, le niveau et la langue s'affichent dans l'en-tête du document.",
        beats: [
          { shot: "typeSelected", focus: "optionalSummary", spotlight: "optionalSummary", click: "optionalSummary" },
          { at: 0.32, shot: "optional", focus: "optionalBody", spotlight: "titleLanguage", callout: { target: "titleLanguage", text: "Dans l'en-tête" } },
        ],
      },
      {
        id: "ch3-2",
        text: "Je règle le niveau sur B1. Et j'indique les mots à mettre en gras : ils le seront partout où ils apparaissent dans le texte.",
        beats: [
          { shot: "optional", focus: "levelEmphasis", spotlight: "levelChips", click: "levelB1" },
          { at: 0.35, shot: "optionalFilled", focus: "levelEmphasis", spotlight: "emphasisField", callout: { target: "emphasisField", text: "En gras partout" } },
        ],
      },
      {
        id: "ch3-3",
        text: "Dernière option : « Ajouter au document ». C'est le seul ajout que l'IA peut faire, et seulement si vous cochez. Je demande des questions de compréhension : elles seront tirées de mon texte et placées à la fin.",
        beats: [
          { shot: "optionalFilled", focus: "additions", spotlight: "additions", callout: { target: "additions", text: "Seulement si vous cochez", side: "above" } },
          { at: 0.58, shot: "addition", focus: "additions", spotlight: "additionQuestions", click: "additionQuestions" },
        ],
      },
    ],
  },
  {
    id: "ch4",
    label: "4",
    title: "Mettre en page",
    paragraphs: [
      {
        id: "ch4-1",
        text: "Tout est prêt, je clique sur « Mettre en page ». Si le bouton reste grisé, la raison est écrite juste à côté : un texte trop court, ou un type à choisir.",
        beats: [
          { shot: "addition", focus: "submitBar", spotlight: "submitBtn", click: "submitBtn" },
          { at: 0.42, shot: "pasted", focus: "submitBar", spotlight: "submitHint", callout: { target: "submitHint", text: "La raison, en clair", side: "above" } },
        ],
      },
      {
        id: "ch4-2",
        text: "La mise en page prend en général quelques secondes, jusqu'à une minute quand on a coché un ajout. Et l'aperçu s'ouvre tout seul.",
        beats: [
          { shot: "waiting", focus: "waiting", spotlight: "waiting" },
          { at: 0.62, shot: "preview", focus: "page" },
        ],
      },
    ],
  },
  {
    id: "ch5",
    label: "5",
    title: "L'apparence",
    paragraphs: [
      {
        id: "ch5-1",
        text: "Nous voici à l'étape 3. À gauche, le document. À droite, le panneau Apparence : il change l'allure du document, jamais son texte.",
        beats: [
          { shot: "preview", focus: "page" },
          { at: 0.3, shot: "preview", focus: "workspace", spotlight: "previewFrame", callout: { target: "previewFrame", text: "Votre document" } },
          { at: 0.55, shot: "preview", focus: "workspace", spotlight: "panel", callout: { target: "panel", text: "L'allure, jamais le texte" } },
        ],
      },
      {
        id: "ch5-2",
        text: "On commence par le style : Lecture éditoriale, Support de classe ou Professionnel compact. Pour une fiche de classe, je prends « Support de classe ».",
        beats: [
          { shot: "preview", focus: "panelTop", spotlight: "stylePicker" },
          { at: 0.62, shot: "classroom", focus: "workspace", spotlight: "styleClassroom", click: "styleClassroom" },
        ],
      },
      {
        id: "ch5-3",
        text: "Ensuite, la couleur, et l'orientation : portrait ou paysage. L'aperçu se met à jour à chaque réglage.",
        beats: [
          { shot: "classroom", focus: "panelTop", spotlight: "accent", click: "swatch" },
          { at: 0.32, shot: "color", focus: "workspace", spotlight: "previewFrame" },
          { at: 0.6, shot: "color", focus: "panelTop", spotlight: "orientation", callout: { target: "orientation", text: "Portrait ou paysage" } },
        ],
      },
      {
        id: "ch5-4",
        text: "Pour aller plus loin, « Plus de réglages » : les polices, la densité, l'en-tête, votre logo, ou un pied de page au nom de votre établissement. Et vos choix sont repris pour les documents suivants.",
        beats: [
          { shot: "color", focus: "panel", spotlight: "moreSummary", click: "moreSummary" },
          { at: 0.22, shot: "more", focus: "moreBody", spotlight: "moreBody" },
          { at: 0.42, shot: "band", focus: "workspace", spotlight: "headerBand", click: "headerBand" },
          { at: 0.62, shot: "footer", focus: "footerArea", spotlight: "footerField", callout: { target: "footerField", text: "Votre pied de page", side: "above" } },
          { at: 0.82, shot: "footer", focus: "panel", spotlight: "panelIntro", callout: { target: "panelIntro", text: "Repris la prochaine fois" } },
        ],
      },
      {
        id: "ch5-5",
        text: "Un réglage ne vous plaît pas ? « Revenir au style d'origine » rend au style choisi son allure de départ.",
        beats: [{ shot: "footer", focus: "footerArea", spotlight: "resetBtn", callout: { target: "resetBtn", text: "L'allure de départ" } }],
      },
    ],
  },
  {
    id: "ch6",
    label: "6",
    title: "Vérifier et télécharger",
    paragraphs: [
      {
        id: "ch6-1",
        text: "L'aperçu rapide se met à jour en direct. Pour voir exactement où tombent les sauts de page, passez en « Pages exactes » : c'est le PDF, tel qu'il sera téléchargé.",
        beats: [
          { shot: "footer", focus: "viewArea", spotlight: "viewQuick" },
          { at: 0.45, shot: "exact", focus: "viewArea", spotlight: "viewExact", click: "viewExact" },
          { at: 0.7, shot: "exact", focus: "workspace", spotlight: "previewFrame", callout: { target: "previewFrame", text: "Le PDF, page par page" } },
        ],
      },
      {
        id: "ch6-2",
        text: "Et tout à la fin, voici les questions de compréhension : elles ont été ajoutées à partir de mon texte, avec des lignes pour répondre.",
        beats: [{ shot: "exactLast", focus: "workspace", spotlight: "previewFrame", callout: { target: "previewFrame", text: "Ajoutées à partir de votre texte" } }],
      },
      {
        id: "ch6-3",
        text: "Il ne reste plus qu'à cliquer sur « Télécharger le PDF ». Un mot à corriger ? « Modifier le texte » vous ramène à l'étape 1. Et « Copier le texte » le récupère, pour un mail ou une plateforme.",
        beats: [
          { shot: "exactLast", focus: "reviewTop", spotlight: "downloadBtn", click: "downloadBtn" },
          { at: 0.4, shot: "exactLast", focus: "reviewTop", spotlight: "editText", callout: { target: "editText", text: "Retour à l'étape 1" } },
          { at: 0.74, shot: "exactLast", focus: "reviewTop", spotlight: "copyText" },
        ],
      },
      {
        id: "ch6-4",
        text: "Vos derniers documents restent dans « Documents récents » : un clic suffit pour les rouvrir.",
        beats: [{ shot: "recent", focus: "recent", spotlight: "recentRow", click: "recentRow" }],
      },
    ],
  },
  {
    id: "ch7",
    label: "7",
    title: "Clôture",
    paragraphs: [
      {
        id: "ch7-1",
        text: "Pour résumer : on colle son texte, on choisit le type de document, on précise ce qu'on veut, on ajuste l'apparence, et on télécharge le PDF.",
        beats: [{ shot: "recent", focus: "page" }],
        recap: true,
      },
      {
        id: "ch7-2",
        text: "Et si vous avez un doute, le « Guide », en haut à droite, reprend ces trois étapes, avec une astuce pour que Gemini prépare un texte encore mieux reconnu. À vous de jouer !",
        beats: [
          { shot: "recent", focus: "header", spotlight: "guideBtn", click: "guideBtn" },
          { at: 0.32, shot: "guide", focus: "guidePanel", spotlight: "guideSteps" },
          { at: 0.62, shot: "guide", focus: "guidePanel", spotlight: "guidePrompt", callout: { target: "guidePrompt", text: "L'astuce Gemini" } },
        ],
      },
    ],
  },
];

export const TUTORIAL: TutorialScript = {
  id: "documents",
  title: {
    lead: "Prise en main de",
    name: "Documents",
    subtitle: "Du texte collé au PDF prêt à imprimer.",
    kicker: { site: "TeachInspire Studio · Tutoriel" },
    scrap: "page",
  },
  chapters: CHAPTERS,
  recap: {
    labels: ["Coller", "Choisir", "Préciser", "Ajuster", "Télécharger"],
    cues: ["on colle", "on choisit", "on précise", "on ajuste", "on télécharge"],
  },
  end: {
    site: { kicker: "À vous de jouer", title: "studio.teachinspire.me", line: "Le Guide reste accessible en haut à droite de la page." },
  },
  appendix: {
    title: "La fiche de démonstration",
    lines: [
      "Collée depuis Google Docs : « Fiche apprenant — Le jour de l'emménagement » (B1, 45 min).",
      "Type : Support apprenant (exercices). Niveau B1, langue enseignée : français.",
      `Mots en gras : ${EMPHASIS}. Ajout demandé : des questions de compréhension.`,
      `Apparence : Support de classe, couleur ${ACCENT}, titre sur fond de couleur, pied de page « ${FOOTER} ».`,
    ],
  },
};
