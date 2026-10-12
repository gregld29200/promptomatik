// "Prise en main de Documents": narration, shots and the demo worksheet.
import type { Chapter, TutorialScript } from "../tutorial/types";

/** The worksheet the teacher copies from Google Docs, as Docs puts it on the clipboard. */
export const DEMO_PASTE_HTML = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-demo">
<h1 dir="ltr"><span style="font-size:20pt;font-weight:700;">Samedi matin au marché</span></h1>
<h2 dir="ltr"><span>Consigne</span></h2>
<p dir="ltr"><span>Lisez le texte, puis répondez aux questions. Aidez-vous des mots utiles en bas de la fiche.</span></p>
<h2 dir="ltr"><span>Le texte</span></h2>
<p dir="ltr"><span>Tous les samedis, Inès va au marché de son quartier. Elle aime l'ambiance : les marchands parlent fort, les clients discutent, ça sent le pain chaud et les fraises.</span></p>
<p dir="ltr"><span>Elle commence toujours par l'étal de Marcel, le maraîcher. Aujourd'hui, elle achète un kilo de tomates et une barquette de fraises. Marcel lui propose de goûter une nouvelle variété de pommes. Elle en prend trois.</span></p>
<p dir="ltr"><span>Ensuite, elle passe chez le fromager. Il y a la queue, mais elle n'est pas pressée. Elle paie en espèces, compte sa monnaie et rentre à pied, son panier bien rempli.</span></p>
<h2 dir="ltr"><span>Questions</span></h2>
<ol><li aria-level="1"><p><span>Quel jour Inès va-t-elle au marché ?</span></p></li><li aria-level="1"><p><span>Qu'est-ce qu'elle achète chez Marcel ?</span></p></li><li aria-level="1"><p><span>Pourquoi est-ce qu'elle n'est pas pressée chez le fromager ?</span></p></li></ol>
<p dir="ltr"><span>Vocabulaire utile : un étal, une barquette, goûter, la queue, la monnaie</span></p>
<blockquote><p><span style="font-weight:700;">Pour aller plus loin :</span><span> racontez à votre voisin votre marché préféré.</span></p></blockquote>
</b>`;

/** The illustration is placed just before this line, under the text. */
export const IMAGE_BEFORE = "## Questions";
export const IMAGE_FILE = "Un étal de fruits et légumes.png";
export const LEVEL = "A2";
export const LANGUAGE = "français";
export const EMPHASIS = "étal, barquette, goûter";
export const FOOTER = "Cours du soir · Maison des associations";
/** The colour picked in the Apparence panel: the green swatch. */
export const ACCENT = "#355343";

export const CHAPTERS: Chapter[] = [
  {
    id: "intro",
    title: "Introduction",
    moduleOnly: true,
    paragraphs: [
      {
        id: "intro-1",
        text: "Votre séance est presque prête. Avant de la finaliser, je vous propose un petit détour par l'atelier Documents. En quelques minutes, on va voir comment transformer un texte que vous avez déjà en une fiche propre, prête à imprimer. Alors, c'est parti.",
        beats: [{ shot: "empty", focus: "page" }],
      },
    ],
  },
  {
    id: "ch0",
    label: "0",
    title: "Le résultat d'abord",
    paragraphs: [
      {
        id: "ch0-1",
        text: "Voici ce qu'on va obtenir : une fiche d'activité de niveau A2. Une consigne, un texte illustré, trois questions avec des lignes pour répondre, et un encadré de vocabulaire. Au départ, c'était un simple texte, tapé dans Google Docs. Retenez une chose : Documents ne réécrit jamais vos mots. Il s'occupe de la mise en page.",
        scene: "result",
        beats: [{ shot: "empty", focus: "page" }],
      },
      {
        id: "ch0-2",
        text: "L'écran suit trois étapes. À l'étape 1, on colle son texte. À l'étape 2, on dit de quel document il s'agit. L'étape 3 arrive après la mise en page : on vérifie, puis on télécharge. À droite, « Documents récents » garde vos derniers documents.",
        beats: [
          { shot: "empty", focus: "page" },
          { at: 0.12, shot: "empty", focus: "page", spotlight: "step1", callout: { target: "step1", text: "1 · Coller" } },
          { at: 0.3, shot: "empty", focus: "page", spotlight: "step2", callout: { target: "step2", text: "2 · Dire ce que c'est", side: "above" } },
          { at: 0.52, shot: "preview", focus: "page", spotlight: "reviewTop", callout: { target: "reviewTop", text: "3 · Vérifier, télécharger" } },
          { at: 0.8, shot: "empty", focus: "recent", spotlight: "recent" },
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
        text: "Étape 1, « Collez votre texte ». Ma fiche, je l'ai écrite dans Google Docs. Je copie, et je colle ici, tel quel. Ça marche aussi depuis Gemini ou Word.",
        beats: [
          { shot: "empty", focus: "step1", spotlight: "step1" },
          { at: 0.5, shot: "empty", focus: "step1", spotlight: "textarea", click: "textarea", callout: { target: "textarea", text: "Coller tel quel" } },
        ],
      },
      {
        id: "ch1-2",
        text: "Regardez : les titres, le gras et la liste des questions sont conservés. Rien n'est réécrit. Un mot à corriger ? Je le fais directement dans le cadre.",
        beats: [
          { shot: "pasted", focus: "textarea", spotlight: "textarea", callout: { target: "textarea", text: "Titres et gras conservés" } },
          { at: 0.45, shot: "pastedList", focus: "textarea", spotlight: "textarea", callout: { target: "textarea", text: "La liste aussi" } },
        ],
      },
      {
        id: "ch1-3",
        text: "Je veux aussi une illustration sous le texte. Je place le curseur à cet endroit, je clique sur « Ajouter une image », et je choisis mon fichier. L'image se place là, avec une légende tirée du nom du fichier.",
        beats: [
          { shot: "cursor", focus: "textarea", spotlight: "textarea" },
          { at: 0.14, shot: "cursor", focus: "textarea", spotlight: "textarea", click: "caret" },
          { at: 0.36, shot: "cursor", focus: "contentTools", spotlight: "addImage", click: "addImage" },
          { at: 0.68, shot: "image", focus: "textarea", spotlight: "textarea", callout: { target: "caret", text: "L'image et sa légende" } },
        ],
      },
      {
        id: "ch1-4",
        text: "Les images doivent faire moins de 5 Mo.",
        beats: [{ shot: "image", focus: "contentTools", spotlight: "addImage", callout: { target: "addImage", text: "Moins de 5 Mo" } }],
      },
      {
        id: "ch1-5",
        text: "Pour savoir ce que Documents comprend, ouvrez « Ce que Documents reconnaît ». C'est un aide-mémoire. Par exemple, « Banque de mots » ou « Vocabulaire utile », suivis de deux-points, donnent un encadré de mots. Et « lignes » entre crochets donne un espace ligné pour répondre.",
        beats: [
          { shot: "image", focus: "contentTools", spotlight: "syntaxToggle", click: "syntaxToggle" },
          { at: 0.3, shot: "syntax", focus: "syntaxHelp", spotlight: "syntaxHelp" },
          { at: 0.45, shot: "syntax", focus: "syntaxHelp", spotlight: "syntaxWordBank", callout: { target: "syntaxWordBank", text: "Un encadré de mots" } },
          { at: 0.78, shot: "syntax", focus: "syntaxHelp", spotlight: "syntaxBreaks", callout: { target: "syntaxBreaks", text: "Des lignes pour répondre" } },
        ],
      },
      {
        id: "ch1-6",
        text: "Pas de panique, inutile de tout retenir. Un texte bien structuré dans Google Docs suffit presque toujours.",
        beats: [{ shot: "syntax", focus: "step1", spotlight: "textarea" }],
      },
    ],
  },
  {
    id: "ch2",
    label: "2",
    title: "Choisir le type",
    paragraphs: [
      {
        id: "ch2-1",
        text: "Deuxième étape : « C'est quel document ? ». Les types sont rangés selon qui va le lire : l'apprenant, vous l'enseignant, ou la formation dans son ensemble.",
        beats: [
          { shot: "types", focus: "step2", spotlight: "step2Head" },
          { at: 0.42, shot: "types", focus: "catalogue", spotlight: "groupLearner", callout: { target: "groupLearner", text: "Pour l'apprenant", side: "above" } },
          { at: 0.64, shot: "types", focus: "catalogue", spotlight: "groupTeacher", callout: { target: "groupTeacher", text: "Pour vous" } },
          { at: 0.82, shot: "types", focus: "catalogue", spotlight: "groupCourse", callout: { target: "groupCourse", text: "Pour la formation" } },
        ],
      },
      {
        id: "ch2-2",
        text: "Ici, c'est une fiche à distribuer : je choisis « Support apprenant (exercices) ».",
        beats: [
          { shot: "types", focus: "groupLearner", spotlight: "typeWorksheet", click: "typeWorksheet" },
          { at: 0.6, shot: "typeSelected", focus: "groupLearner", spotlight: "typeWorksheet" },
        ],
      },
      {
        id: "ch2-3",
        text: "Le type ne touche pas à votre texte. Il ajoute l'habillage utile : ici, une ligne pour le nom et la date, et des lignes de réponse sous chaque question. Si une section s'appelle « Vrai ou faux », vous aurez même les cases à cocher.",
        beats: [
          { shot: "typeSelected", focus: "groupLearner", spotlight: "typeWorksheet", callout: { target: "typeWorksheet", text: "L'habillage, pas le texte" } },
          { at: 0.3, shot: "preview", focus: "workspace", spotlight: "previewFrame", callout: { target: "previewFrame", text: "Nom, date, lignes de réponse" } },
        ],
      },
      {
        id: "ch2-4",
        text: "Un conseil : pour votre corrigé, repartez du même texte avec ses réponses, et choisissez « Guide enseignant et corrigés ». La section de réponses sera encadrée.",
        beats: [{ shot: "typeSelected", focus: "groupTeacher", spotlight: "typeTeacherGuide", callout: { target: "typeTeacherGuide", text: "Pour le corrigé" } }],
      },
      {
        id: "ch2-5",
        text: "Et si aucun type ne correspond, choisissez « Document libre » : votre texte est mis en page tel quel, sans habillage.",
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
        text: "Juste en dessous, les « Précisions facultatives ». Rien n'est obligatoire ici.",
        beats: [{ shot: "typeSelected", focus: "optionalSummary", spotlight: "optionalSummary", click: "optionalSummary" }],
      },
      {
        id: "ch3-2",
        text: "Le « Titre du document » : laissé vide, il reprend le premier titre de votre texte. J'indique la « Langue enseignée », français, et le « Niveau », A2. Le niveau guide aussi la difficulté de l'ajout que je vais demander.",
        beats: [
          { shot: "optional", focus: "optionalBody", spotlight: "titleField", callout: { target: "titleField", text: "Vide : le titre du texte" } },
          { at: 0.42, shot: "optionalLanguage", focus: "optionalBody", spotlight: "languageField" },
          { at: 0.62, shot: "optionalLanguage", focus: "levelEmphasis", spotlight: "levelChips", click: "levelChoice" },
          { at: 0.78, shot: "optionalLevel", focus: "levelEmphasis", spotlight: "levelChips", callout: { target: "levelChips", text: "Guide l'ajout" } },
        ],
      },
      {
        id: "ch3-3",
        text: "Ensuite, les « Mots à mettre en gras ». J'écris « étal, barquette, goûter », séparés par des virgules. Ils seront en gras partout dans le texte.",
        beats: [
          { shot: "optionalLevel", focus: "levelEmphasis", spotlight: "emphasisField", click: "emphasisField" },
          { at: 0.4, shot: "optionalFilled", focus: "levelEmphasis", spotlight: "emphasisField", callout: { target: "emphasisField", text: "En gras partout" } },
        ],
      },
      {
        id: "ch3-4",
        text: "Dernière option : « Ajouter au document ». C'est le seul endroit où l'IA intervient, et seulement si vous cochez. L'ajout est tiré de votre texte et placé à la fin. Je coche « Un exercice d'appariement ».",
        beats: [
          { shot: "optionalFilled", focus: "additions", spotlight: "additions", callout: { target: "additions", text: "Seulement si vous cochez", side: "above" } },
          { at: 0.74, shot: "addition", focus: "additions", spotlight: "additionMatching", click: "additionMatching" },
        ],
      },
      {
        id: "ch3-5",
        text: "Avec des débutants, restez sobre : un seul ajout suffit. Et relisez-le toujours, comme vous relisez la copie d'un collègue.",
        beats: [{ shot: "addition", focus: "additions", spotlight: "additionMatching", callout: { target: "additionMatching", text: "Un seul ajout" } }],
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
        text: "Tout est prêt. Je clique sur « Mettre en page ».",
        beats: [{ shot: "addition", focus: "submitBar", spotlight: "submitBtn", click: "submitBtn" }],
      },
      {
        id: "ch4-2",
        text: "Si le bouton reste grisé, pas de panique : la raison est écrite juste à côté. Par exemple : « Choisissez le type de document à l'étape 2. » Il faut au moins huit mots, et au plus 30 000 caractères.",
        beats: [
          { shot: "pasted", focus: "submitBar", spotlight: "submitBar" },
          { at: 0.3, shot: "pasted", focus: "submitBar", spotlight: "submitHint", callout: { target: "submitHint", text: "La raison, en clair", side: "above" } },
        ],
      },
      {
        id: "ch4-3",
        text: "La mise en page prend en général quelques secondes, jusqu'à une minute quand on a coché un ajout. Puis l'aperçu s'ouvre tout seul.",
        beats: [
          { shot: "waiting", focus: "waiting", spotlight: "waiting" },
          { at: 0.72, shot: "preview", focus: "page" },
        ],
      },
      {
        id: "ch4-4",
        text: "Si quelque chose bloque, votre texte reste là : vous pouvez réessayer.",
        beats: [{ shot: "preview", focus: "page" }],
      },
    ],
  },
  {
    id: "ch5",
    label: "5",
    title: "Vérifier et ajuster",
    paragraphs: [
      {
        id: "ch5-1",
        text: "Nous voici à l'étape 3, « Vérifiez puis téléchargez ». À gauche, la fiche. À droite, le panneau « Apparence ». Il change l'allure du document, jamais son texte.",
        beats: [
          { shot: "preview", focus: "page", spotlight: "reviewTop" },
          { at: 0.36, shot: "preview", focus: "workspace", spotlight: "previewFrame", callout: { target: "previewFrame", text: "Votre fiche" } },
          { at: 0.56, shot: "preview", focus: "workspace", spotlight: "panel", callout: { target: "panel", text: "L'allure, jamais le texte" } },
        ],
      },
      {
        id: "ch5-2",
        text: "D'abord le « Style du document » : « Lecture éditoriale », « Support de classe » ou « Professionnel compact ». Pour une fiche de classe, je prends « Support de classe ».",
        beats: [
          { shot: "preview", focus: "panelTop", spotlight: "stylePicker" },
          { at: 0.7, shot: "classroom", focus: "workspace", spotlight: "styleClassroom", click: "styleClassroom" },
        ],
      },
      {
        id: "ch5-3",
        text: "Puis la « Couleur » : ce vert. L'« Orientation » : je reste en portrait. À chaque réglage, le panneau affiche « Enregistré ».",
        beats: [
          { shot: "classroom", focus: "panelTop", spotlight: "accent", click: "swatch" },
          { at: 0.28, shot: "color", focus: "workspace", spotlight: "previewFrame" },
          { at: 0.5, shot: "color", focus: "panelTop", spotlight: "orientation", callout: { target: "orientation", text: "Portrait ou paysage" } },
          { at: 0.76, shot: "color", focus: "panelTop", spotlight: "saveStatus", callout: { target: "saveStatus", text: "Enregistré" } },
        ],
      },
      {
        id: "ch5-4",
        text: "« Plus de réglages : polices, densité, en-tête, logo, pied de page » va plus loin : aérer la page, ajouter le logo de votre établissement. Moi, j'écris simplement un « Pied de page » : « Cours du soir · Maison des associations ».",
        beats: [
          { shot: "color", focus: "panel", spotlight: "moreSummary", click: "moreSummary" },
          { at: 0.2, shot: "more", focus: "moreBody", spotlight: "moreBody" },
          { at: 0.42, shot: "more", focus: "moreBody", spotlight: "logoArea", callout: { target: "logoArea", text: "Votre logo" } },
          { at: 0.64, shot: "footer", focus: "footerArea", spotlight: "footerField", callout: { target: "footerField", text: "Votre pied de page", side: "above" } },
        ],
      },
      {
        id: "ch5-5",
        text: "Un réglage ne vous plaît pas ? Cliquez sur « Revenir au style d'origine ». Et vos choix sont repris pour les documents suivants, dans ce navigateur.",
        beats: [
          { shot: "footer", focus: "footerArea", spotlight: "resetBtn", callout: { target: "resetBtn", text: "L'allure de départ" } },
          { at: 0.5, shot: "footer", focus: "panel", spotlight: "panelIntro", callout: { target: "panelIntro", text: "Repris la prochaine fois" } },
        ],
      },
      {
        id: "ch5-6",
        text: "Dernier contrôle. L'« Aperçu rapide » suit vos réglages en direct. Pour voir où tombent les pages, passez en « Pages exactes » : c'est le PDF, tel qu'il sera téléchargé.",
        beats: [
          { shot: "footer", focus: "viewArea", spotlight: "viewQuick" },
          { at: 0.42, shot: "exact", focus: "viewArea", spotlight: "viewExact", click: "viewExact" },
          { at: 0.68, shot: "exact", focus: "workspace", spotlight: "previewFrame", callout: { target: "previewFrame", text: "Le PDF, page par page" } },
        ],
      },
      {
        id: "ch5-7",
        text: "En page 2, l'exercice d'appariement, tiré de mon texte. Je le relis : c'est bon. Une question seule en bas de page ? Écrivez « saut de page » entre crochets dans votre texte.",
        beats: [
          { shot: "exactLast", focus: "workspace", spotlight: "previewFrame", callout: { target: "previewFrame", text: "Tiré de votre texte" } },
          { at: 0.55, shot: "exactLast", focus: "workspace", spotlight: "previewFrame", callout: { target: "previewFrame", text: "[saut de page]" } },
        ],
      },
    ],
  },
  {
    id: "ch6",
    label: "6",
    title: "Exporter et retrouver",
    paragraphs: [
      {
        id: "ch6-1",
        text: "Il ne reste plus qu'à cliquer sur « Télécharger le PDF ». Le fichier porte le titre de la fiche.",
        beats: [
          { shot: "exactLast", focus: "reviewTop", spotlight: "downloadBtn", click: "downloadBtn" },
          { at: 0.6, shot: "exactLast", focus: "reviewTop", spotlight: "docTitle", callout: { target: "docTitle", text: "Samedi matin au marché.pdf" } },
        ],
      },
      {
        id: "ch6-2",
        text: "Vous préparez sur téléphone ? Le bouton de téléchargement reste en bas de l'écran.",
        beats: [{ shot: "exactLast", focus: "reviewTop", spotlight: "downloadBtn", callout: { target: "downloadBtn", text: "Aussi sur téléphone" } }],
      },
      {
        id: "ch6-3",
        text: "« Copier le texte » récupère le texte sans mise en forme, pour un mail ou votre plateforme. « Modifier le texte » vous ramène à l'étape 1, avec votre texte et vos précisions. La nouvelle mise en page crée un nouveau document, l'ancien reste. Pensez à recocher votre ajout.",
        beats: [
          { shot: "exactLast", focus: "reviewTop", spotlight: "copyText", callout: { target: "copyText", text: "Pour un mail" } },
          { at: 0.3, shot: "exactLast", focus: "reviewTop", spotlight: "editText", callout: { target: "editText", text: "Retour à l'étape 1" } },
          { at: 0.84, shot: "addition", focus: "additions", spotlight: "additionMatching" },
        ],
      },
      {
        id: "ch6-4",
        text: "Vos dix derniers documents restent dans « Documents récents ». Un clic pour en rouvrir un. La corbeille le supprime, et c'est définitif.",
        beats: [
          { shot: "recent", focus: "recent", spotlight: "recent" },
          { at: 0.42, shot: "recent", focus: "recent", spotlight: "recentRow", click: "recentRow" },
          { at: 0.7, shot: "recent", focus: "recent", spotlight: "recentDelete", callout: { target: "recentDelete", text: "Définitif" } },
        ],
      },
      {
        id: "ch6-5",
        text: "Bon à savoir : votre texte en cours est enregistré dans ce navigateur. Fermez l'onglet, vous le retrouvez en revenant. Et contrairement au Studio audio, rien n'est décompté ici.",
        beats: [{ shot: "pasted", focus: "step1", spotlight: "textarea", callout: { target: "textarea", text: "Enregistré au fil de l'eau" } }],
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
        text: "Pour résumer. On colle son texte, tel quel. On choisit le type de document. On ajoute des précisions si besoin. On met en page. On ajuste l'apparence et on vérifie les pages exactes. Et on télécharge le PDF.",
        beats: [{ shot: "recent", focus: "page" }],
        recap: true,
      },
      {
        id: "ch7-2",
        text: "Si vous avez un doute, le « Guide », en haut à droite, reprend ces trois étapes. Il vous donne aussi une consigne à ajouter à votre demande à Gemini, pour un texte encore mieux reconnu. Voilà, à vous de jouer !",
        beats: [
          { shot: "recent", focus: "header", spotlight: "guideBtn", click: "guideBtn" },
          { at: 0.3, shot: "guide", focus: "guidePanel", spotlight: "guideSteps" },
          { at: 0.56, shot: "guide", focus: "guidePanel", spotlight: "guidePrompt", callout: { target: "guideCopy", text: "Copier la consigne" } },
        ],
      },
    ],
  },
  {
    id: "outro",
    title: "À suivre",
    moduleOnly: true,
    paragraphs: [
      {
        id: "outro-1",
        text: "Voilà pour la prise en main de Documents. Gardez cet onglet ouvert. Dans la prochaine vidéo, on assemble la séance de Katrin : ses documents, et son déroulé minuté. Je vous retrouve tout de suite.",
        beats: [{ shot: "footer", focus: "page" }],
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
    kicker: { module: "TeachInspire Studio · Module 6 · Vidéo 1", site: "TeachInspire Studio · Tutoriel" },
    scrap: "page",
  },
  chapters: CHAPTERS,
  recap: {
    labels: ["Coller", "Choisir", "Préciser", "Ajuster", "Télécharger"],
    cues: ["On colle", "On choisit", "On ajoute", "On ajuste", "on télécharge"],
  },
  end: {
    module: { kicker: "À suivre · Module 6 · Vidéo 2", title: "La séance de Katrin", line: "Ses documents et son déroulé minuté." },
    site: { kicker: "À vous de jouer", title: "studio.teachinspire.me", line: "Le Guide reste accessible en haut à droite de la page." },
  },
  appendix: {
    title: "Le document de démonstration",
    lines: [
      "Collé depuis Google Docs : « Samedi matin au marché » (consigne, texte, trois questions, vocabulaire utile, encadré « Pour aller plus loin »).",
      `Image : « ${IMAGE_FILE} », ajoutée sous le texte avec « Ajouter une image ».`,
      `Type : « Support apprenant (exercices) ». Langue enseignée : ${LANGUAGE}. Niveau : ${LEVEL}. Titre laissé vide.`,
      `Mots à mettre en gras : ${EMPHASIS}. Ajouter au document : « Un exercice d'appariement ».`,
      `Apparence : « Support de classe », couleur ${ACCENT}, portrait, pied de page « ${FOOTER} ».`,
    ],
  },
};
