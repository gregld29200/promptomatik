// "Prise en main du Studio audio" — narration and shot list.
//
// Each paragraph is one voice-over take. Its beats say what the screen shows
// while it is spoken: which captured state (shot), what the camera frames,
// what is spotlit, where the cursor clicks and which label appears. `at` is
// the share of the paragraph already spoken when the beat starts.

export type BoxId = string;

export interface Beat {
  at?: number;
  shot: string;
  /** Box to frame; "page" shows the whole studio. */
  focus: BoxId | "page";
  spotlight?: BoxId;
  click?: BoxId;
  callout?: { target: BoxId; text: string; side?: "above" | "below" };
}

export interface Paragraph {
  id: string;
  text: string;
  beats: Beat[];
  /** A sound inserted after the paragraph, with its own visual. */
  after?: "compare";
  /** The recap steps appear over this paragraph. */
  recap?: boolean;
}

export interface Chapter {
  id: string;
  label?: string;
  title: string;
  /** Only in the module 5 cut, not in the site cut. */
  moduleOnly?: boolean;
  paragraphs: Paragraph[];
  /** A sound played before the first paragraph. */
  before?: "result";
}

export const DEMO_SCRIPT = `Leïla : Antoine, tu peux m'aider ? Ce carton est trop lourd pour moi.
Antoine : J'arrive ! Qu'est-ce que tu as mis dedans ? (il prend le carton) Je le pose où ?
Leïla : Dans le salon, sous la fenêtre. Ce sont tous nos livres.
Antoine : D'accord. Tu sais, il reste de la place à côté du canapé, on pourrait y mettre une petite bibliothèque.
Leïla : Bonne idée ! Et la table, on la met où ?
Antoine : Près de la cuisine, c'est plus pratique. (il rit) Enfin, quand on aura retrouvé les assiettes !
Leïla : (elle soupire) Ah… Il reste encore une vingtaine de cartons à ouvrir.
Antoine : Pas de panique, on a tout le week-end. Ce soir, on commande des pizzas ?
Leïla : Avec plaisir ! Je suis tellement contente qu'on soit enfin chez nous.`;

/** The line used to compare levels: Antoine, 4th line. */
export const COMPARE_LINE = "D'accord. Tu sais, il reste de la place à côté du canapé, on pourrait y mettre une petite bibliothèque.";

export const DEMO_SCENE = "Un salon encore plein de cartons, le jour de l'emménagement.";
/** How the second character speaks, typed in the per-character settings. */
export const SECOND_NOTES = "détendu, souriant";

/** The settings the teacher picks on screen, as the studio sends them. */
export const DEMO_DIRECTION = {
  level: "B1",
  accent: "Neutral",
  accentDetail: "",
  pace: "Natural classroom speed",
  style: "Informal conversation",
  scene: DEMO_SCENE,
  speakers: {
    "Speaker 1": { accent: "Neutral", style: "Informal conversation" },
    "Speaker 2": { notes: SECOND_NOTES },
  },
} as const;

/** Leïla speaks first, so she is Speaker 1: Rosa; Antoine gets Daniel. */
export const DEMO_VOICES = { "Speaker 1": "Sulafat", "Speaker 2": "Charon" } as const;

/** The two settings compared on the same line in chapter 3. */
export const COMPARE_TAKES = [
  { id: "a1", level: "A1", pace: "Slow learner-friendly", label: "A1 · Lent et apprenant" },
  { id: "b1", level: "B1", pace: "Natural classroom speed", label: "B1 · Rythme naturel de classe" },
] as const;

export const CHAPTERS: Chapter[] = [
  {
    id: "intro",
    title: "Le Studio audio",
    moduleOnly: true,
    paragraphs: [
      {
        id: "intro-1",
        text: "Avant d'attaquer la génération de leçons, je vous propose un petit détour par le Studio audio. En quelques minutes, on va voir comment transformer un simple texte en une écoute prête pour la classe. Alors, c'est parti.",
        beats: [{ shot: "pasted", focus: "page" }],
      },
    ],
  },
  {
    id: "ch0",
    label: "0",
    title: "Le résultat d'abord",
    before: "result",
    paragraphs: [
      {
        id: "ch0-1",
        text: "Ce que vous venez d'entendre, c'est un dialogue créé en quelques minutes dans le Studio audio. On a deux personnages, deux voix naturelles et un débit réglé pour le niveau B1. Alors voyons comment on y arrive.",
        beats: [{ shot: "ready", focus: "player", spotlight: "player" }],
      },
      {
        id: "ch0-2",
        text: "L'écran se lit de gauche à droite, avec trois zones. D'abord le Script, c'est le texte qui sera dit. Ensuite la Direction, qui règle la façon de le dire. Et enfin la Cabine, où on choisit les voix, donc qui le dit. En haut à droite, vous voyez aussi les minutes qu'il vous reste ce mois-ci.",
        beats: [
          { shot: "pasted", focus: "page" },
          { at: 0.14, shot: "pasted", focus: "page", spotlight: "zoneScript", callout: { target: "zoneScript", text: "Ce qui est dit" } },
          { at: 0.36, shot: "pasted", focus: "page", spotlight: "zoneDirection", callout: { target: "zoneDirection", text: "Comment c'est dit" } },
          { at: 0.56, shot: "pasted", focus: "page", spotlight: "zoneCabine", callout: { target: "zoneCabine", text: "Qui le dit" } },
          { at: 0.82, shot: "pasted", focus: "quota", spotlight: "quota" },
        ],
      },
    ],
  },
  {
    id: "ch1",
    label: "1",
    title: "Le script",
    paragraphs: [
      {
        id: "ch1-1",
        text: "Tout commence par le texte. La première chose à choisir, c'est le format : Dialogue pour deux personnages, ou Monologue pour une seule voix.",
        beats: [
          { shot: "empty", focus: "zoneScript", spotlight: "zoneScript" },
          { at: 0.45, shot: "empty", focus: "modeToggle", spotlight: "modeToggle", click: "modeDialogue", callout: { target: "modeToggle", text: "Le format" } },
        ],
      },
      {
        id: "ch1-2",
        text: "Pour un dialogue, il n'y a qu'une règle à retenir : une réplique par ligne, avec le prénom du personnage suivi de deux-points, exactement comme vous l'écririez au tableau. Et deux personnages au maximum.",
        beats: [
          { shot: "empty", focus: "editor", spotlight: "editor", click: "editor" },
          { at: 0.3, shot: "pasted", focus: "editorTop", spotlight: "editorTop", callout: { target: "editorTop", text: "Prénom : réplique" } },
        ],
      },
      {
        id: "ch1-3",
        text: "Je colle donc mon dialogue : Leïla et Antoine, un couple qui emménage dans son nouvel appartement. Regardez juste sous le texte, le studio me confirme qu'il a bien compris : deux personnages, Leïla et Antoine, et environ cinquante-huit secondes d'écoute.",
        beats: [
          { shot: "pasted", focus: "zoneScript", spotlight: "editor" },
          { at: 0.42, shot: "pasted", focus: "status", spotlight: "statusCast", callout: { target: "statusCast", text: "Le studio a compris", side: "above" } },
        ],
      },
      {
        id: "ch1-4",
        text: "Il me signale aussi que trois indications entre parenthèses seraient lues à voix haute. Pas de souci, on s'en occupe à l'étape suivante.",
        beats: [{ shot: "pasted", focus: "status", spotlight: "statusParens" }],
      },
      {
        id: "ch1-5",
        text: "Alors, et si je me trompe ? J'ajoute volontairement une troisième personne, Mei.",
        beats: [{ shot: "pasted", focus: "zoneScript", spotlight: "editor", click: "editorEnd" }],
      },
      {
        id: "ch1-6",
        text: "Voilà, le studio me le dit tout de suite, et en clair : trois personnages détectés, il en accepte deux. Je supprime tout simplement la ligne, et tout redevient vert. Vous voyez, s'il y a un souci, le message vous dit quoi faire.",
        beats: [
          { shot: "third", focus: "problemArea", spotlight: "problem", callout: { target: "problem", text: "Un seul message, en clair" } },
          { at: 0.55, shot: "pasted", focus: "status", spotlight: "statusCast" },
        ],
      },
    ],
  },
  {
    id: "ch2",
    label: "2",
    title: "Les émotions",
    paragraphs: [
      {
        id: "ch2-1",
        text: "Un dialogue sans intonation, ça donne une lecture à plat. Alors on va demander au studio de nous proposer des émotions.",
        beats: [{ shot: "pasted", focus: "actions", spotlight: "suggestBtn", click: "suggestBtn" }],
      },
      {
        id: "ch2-2",
        text: "En quelques secondes, les propositions apparaissent directement dans le texte, à l'endroit exact où elles s'appliqueraient. Ici, « il rit » entre parenthèses devient un vrai rire. Et là, « il prend le carton » est retiré du texte, sinon la voix le lirait à voix haute.",
        beats: [
          { shot: "review", focus: "review", spotlight: "review" },
          { at: 0.45, shot: "review", focus: "fixLaugh", spotlight: "fixLaugh", callout: { target: "fixLaugh", text: "(il rit) → rit" } },
          { at: 0.72, shot: "review", focus: "fixCarton", spotlight: "fixCarton", callout: { target: "fixCarton", text: "Retiré du texte" } },
        ],
      },
      {
        id: "ch2-3",
        text: "Pour chaque proposition, c'est à vous de trancher : la coche pour garder, la croix pour écarter. Si vous voulez savoir pourquoi une émotion est proposée, touchez-la, l'explication s'affiche juste en dessous.",
        beats: [
          { shot: "review", focus: "firstTag", spotlight: "firstTag", callout: { target: "firstTag", text: "✓ garder · ✗ écarter" } },
          { at: 0.55, shot: "reviewReason", focus: "review", spotlight: "reason", click: "firstTagLabel" },
        ],
      },
      {
        id: "ch2-4",
        text: "Je garde celle-ci, j'écarte celle-là, et je clique sur « Appliquer ». Le studio laisse vos mots tels quels, il ajoute seulement des indications de jeu. Et si je change d'avis, « Annuler les suggestions » remet mon texte d'origine.",
        beats: [
          { shot: "reviewDecided", focus: "firstTag", spotlight: "review", click: "firstTagAccept" },
          { at: 0.25, shot: "reviewDecided", focus: "reviewFooter", spotlight: "applyBtn", click: "applyBtn" },
          { at: 0.5, shot: "applied", focus: "zoneScript", spotlight: "editor" },
          { at: 0.78, shot: "applied", focus: "actions", spotlight: "undoBtn", callout: { target: "undoBtn", text: "Retour en arrière" } },
        ],
      },
      {
        id: "ch2-5",
        text: "Vous remarquerez que dans le texte, les émotions s'écrivent entre crochets, et en anglais. Pourquoi ? Parce que c'est la langue que comprennent les voix. Si vous préférez les placer vous-même, cliquez à l'endroit voulu, ouvrez le menu « Émotion » et choisissez : chuchote, soupire, rit...",
        beats: [
          { shot: "applied", focus: "editor", spotlight: "editor", callout: { target: "editor", text: "[laughs] = rit" } },
          { at: 0.55, shot: "menu", focus: "menuArea", spotlight: "menu", click: "emotionBtn" },
        ],
      },
      {
        id: "ch2-6",
        text: "Un petit conseil : avec des débutants, restez sobre. Une ou deux émotions bien placées suffisent pour faire comprendre l'intention, alors qu'avec trop d'effets, l'écoute devient brouillonne.",
        beats: [{ shot: "applied", focus: "zoneScript" }],
      },
    ],
  },
  {
    id: "ch3",
    label: "3",
    title: "La direction",
    paragraphs: [
      {
        id: "ch3-1",
        text: "On passe à la deuxième zone, la Direction. C'est ici qu'on règle la façon de parler.",
        beats: [{ shot: "applied", focus: "zoneDirection", spotlight: "zoneDirection" }],
      },
      {
        id: "ch3-2",
        text: "Le réglage le plus important, c'est le Niveau. Il adapte la lecture et laisse votre texte intact. En A1, la voix ralentit, détache bien les mots et évite les liaisons. En C1, on retrouve le débit d'une vraie conversation. Écoutez plutôt la différence sur la même réplique : en A1 avec un rythme lent, puis en B1.",
        beats: [{ shot: "applied", focus: "levelPace", spotlight: "level", callout: { target: "level", text: "Le réglage clé" } }],
        after: "compare",
      },
      {
        id: "ch3-3",
        text: "Ensuite, le Rythme règle le tempo général, et le Style donne le ton : classe neutre, chaleureux et encourageant, conversation informelle, narration...",
        beats: [
          { shot: "applied", focus: "levelPace", spotlight: "pace", callout: { target: "pace", text: "Le tempo" } },
          { at: 0.45, shot: "speakers", focus: "styleArea", spotlight: "style", click: "speakerSummary", callout: { target: "style", text: "Le ton" } },
        ],
      },
      {
        id: "ch3-4",
        text: "Pour aller plus loin, on ouvre les réglages par personnage, parce que chacun peut avoir son accent et sa façon de s'exprimer. Pour Antoine, j'écris « détendu, souriant ». C'est aussi très utile pour un rôle d'apprenant, avec par exemple « hésite, cherche ses mots ».",
        beats: [
          { shot: "speakers", focus: "zoneDirection", spotlight: "speakerSummary", callout: { target: "speakerSummary", text: "Un réglage par personnage" } },
          { at: 0.35, shot: "speakers", focus: "secondGroup", spotlight: "secondNotes", callout: { target: "secondNotes", text: "Façon de s'exprimer" } },
        ],
      },
      {
        id: "ch3-5",
        text: "Enfin, la Scène décrit le contexte. Ici, un salon encore plein de cartons, le jour de l'emménagement.",
        beats: [{ shot: "speakers", focus: "scene", spotlight: "scene" }],
      },
      {
        id: "ch3-6",
        text: "Si vous débutez, réglez simplement le niveau, tout le reste est facultatif.",
        beats: [{ shot: "applied", focus: "levelPace", spotlight: "level" }],
      },
    ],
  },
  {
    id: "ch4",
    label: "4",
    title: "Les voix",
    paragraphs: [
      {
        id: "ch4-1",
        text: "Troisième zone, la Cabine, c'est là qu'on choisit les voix. En haut, il y a une carte par personnage, avec son prénom.",
        beats: [
          { shot: "speakers", focus: "zoneCabine", spotlight: "zoneCabine" },
          { at: 0.5, shot: "speakers", focus: "cards", spotlight: "cards", callout: { target: "cards", text: "Une carte par personnage" } },
        ],
      },
      {
        id: "ch4-2",
        text: "Je clique sur la carte de Leïla, puis je filtre : voix féminines, ton chaleureux. Le petit bouton de lecture me permet d'écouter chaque voix avant de choisir. Écoutons celle-ci, puis celle-là. Très bien, je prends Rosa.",
        beats: [
          { shot: "speakers", focus: "cards", spotlight: "cardFirst", click: "cardFirst" },
          { at: 0.2, shot: "filtered", focus: "filters", spotlight: "filters", click: "filterWarm" },
          { at: 0.45, shot: "filtered", focus: "voiceList", spotlight: "previewFirst", click: "previewFirst", callout: { target: "previewFirst", text: "Écouter" } },
          { at: 0.8, shot: "filtered", focus: "voiceList", spotlight: "voiceRosa", click: "voiceRosa" },
        ],
      },
      {
        id: "ch4-3",
        text: "Même chose pour Antoine : je choisis Daniel, une voix masculine posée.",
        beats: [{ shot: "cast", focus: "cards", spotlight: "cardSecond" }],
      },
      {
        id: "ch4-4",
        text: "Un dernier conseil : prenez deux voix bien contrastées. Pourquoi ? Parce que vos apprenants distingueront beaucoup plus facilement qui parle.",
        beats: [{ shot: "cast", focus: "cards", spotlight: "cards" }],
      },
    ],
  },
  {
    id: "ch5",
    label: "5",
    title: "Générer et écouter",
    paragraphs: [
      {
        id: "ch5-1",
        text: "Tout est prêt, je clique sur « Générer la prise ». Si jamais le bouton est grisé, pas de panique, la raison est écrite juste en dessous : une voix à choisir, une relecture à terminer...",
        beats: [
          { shot: "cast", focus: "generate", spotlight: "generateBtn", click: "generateBtn" },
          { at: 0.45, shot: "reviewDecided", focus: "generate", spotlight: "generateHint", callout: { target: "generateHint", text: "La raison, en clair" } },
        ],
      },
      {
        id: "ch5-2",
        text: "La génération prend en général quelques secondes, parfois un peu plus. Et voilà, la prise apparaît dans le lecteur. Je vous conseille de l'écouter en entier.",
        beats: [
          { shot: "generating", focus: "console", spotlight: "console" },
          { at: 0.45, shot: "ready", focus: "player", spotlight: "player", click: "playBtn" },
        ],
      },
      {
        id: "ch5-3",
        text: "Sur un texte long, la prise est découpée en blocs : si un passage ne vous convient pas, on clique dessus pour régénérer uniquement celui-là. Seul ce passage est décompté de vos minutes.",
        beats: [
          { shot: "ready", focus: "player", spotlight: "waveform" },
          { at: 0.45, shot: "block", focus: "player", spotlight: "waveform", click: "block0" },
          { at: 0.76, shot: "block", focus: "player", spotlight: "regenArea", callout: { target: "regenArea", text: "Seul ce passage est décompté" } },
        ],
      },
      {
        id: "ch5-4",
        text: "C'est bon à savoir pour vos minutes : avant la génération, le studio affiche une durée estimée, et une fois l'audio créé, il affiche la durée réelle. C'est la durée réelle qui est décomptée.",
        beats: [{ shot: "ready", focus: "playerHead", spotlight: "estActual", callout: { target: "estActual", text: "Estimé · réel" } }],
      },
      {
        id: "ch5-5",
        text: "Il ne reste plus qu'à télécharger : le MP3 pour la classe ou pour votre plateforme, et la transcription si vous voulez la donner à vos apprenants.",
        beats: [{ shot: "ready", focus: "playerHead", spotlight: "downloads", click: "downloadMp3", callout: { target: "downloads", text: "MP3 · WAV · Transcription" } }],
      },
    ],
  },
  {
    id: "ch6",
    label: "6",
    title: "Retrouver et décliner",
    paragraphs: [
      {
        id: "ch6-1",
        text: "Vos prises se retrouvent dans les « Prises récentes », et toutes ensemble dans la bibliothèque, où vous pouvez les renommer pour vous y retrouver.",
        beats: [
          { shot: "ready", focus: "history", spotlight: "history" },
          { at: 0.45, shot: "library", focus: "libraryList", spotlight: "libraryRow", callout: { target: "libraryRename", text: "Renommer" } },
        ],
      },
      {
        id: "ch6-2",
        text: "Envie d'une variante ? Le bouton « Dupliquer » recharge le script et tous les réglages en un clic. Je passe le niveau en A1 et le rythme en lent, je relance, et j'ai une version plus lente pour mon groupe de débutants.",
        beats: [
          { shot: "ready", focus: "history", spotlight: "historyRow", click: "historyRow", callout: { target: "historyRow", text: "Dupliquer" } },
          { at: 0.42, shot: "variant", focus: "levelPace", spotlight: "levelPace", callout: { target: "levelPace", text: "A1 · rythme lent" } },
        ],
      },
      {
        id: "ch6-3",
        text: "Petite précision qui compte : les fichiers audio sont conservés sept jours. En revanche, le script et les réglages restent. Pensez donc à télécharger les audios que vous voulez garder.",
        beats: [{ shot: "ready", focus: "history", spotlight: "historyExpiry", callout: { target: "historyExpiry", text: "7 jours" } }],
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
        text: "Pour résumer ce qu'on vient de faire : on écrit un texte avec des prénoms, on ajoute des émotions si on le souhaite, on règle le niveau en fonction de ses apprenants, on choisit deux voix bien contrastées, et un clic suffit pour générer.",
        beats: [{ shot: "cast", focus: "page" }],
        recap: true,
      },
      {
        id: "ch7-2",
        text: "Si jamais vous avez un doute, le « Guide du studio » reste accessible à tout moment, juste sous le texte. Voilà, à vous de jouer !",
        beats: [{ shot: "pasted", focus: "actions", spotlight: "guideLink", callout: { target: "guideLink", text: "Guide du studio" } }],
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
        text: "Voilà pour la prise en main du Studio audio. Gardez vos premiers audios sous la main, parce que dans la prochaine vidéo on attaque la génération de leçons, et ils pourront accompagner vos séances. Je vous retrouve tout de suite.",
        beats: [{ shot: "ready", focus: "page" }],
      },
    ],
  },
];

/** The recap shown over chapter 7: each step appears on its cue. */
export const RECAP = ["Écrire", "Émotions", "Niveau", "Voix", "Générer"];
export const RECAP_CUES = ["on écrit", "on ajoute", "on règle", "on choisit", "un clic"];
