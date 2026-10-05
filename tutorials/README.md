# TeachInspire tutorials

Tutorial videos for TeachInspire Studio, edited in code with [Remotion](https://www.remotion.dev): the real studio is captured screen by screen, then a camera frames, spotlights and clicks what the narration talks about.

Two tutorials so far:

- **Prise en main du Studio audio** (Module 5, video 1), in two cuts: `StudioAudioModule`, with the module's opening and its hand-off to video 2, and `StudioAudioSite`, the same tutorial on its own, for the help pages;
- **Prise en main de Documents**, for the site: `DocumentsSite`.

## Making the videos

```bash
cd tutorials
npm install

# Studio audio
npm run demo      # the demo dialogue: suggestions, take at B1, the A1/B1 comparison
npm run voice     # the narration, one take per paragraph
npm run capture   # the studio's screens, from the app's sources, with its API mocked
npm run render:module
npm run render:site

# Documents
npm run voice -- documents
npm run capture -- documents   # also builds the demo worksheet and prints its PDF
npm run render:documents
```

`demo` needs `GEMINI_API_KEY` (first run only: the review it gets is kept in `fixtures/`) and `OPENROUTER_API_KEY`; `voice` needs `OPENROUTER_API_KEY`, and so does the Documents capture the first time (the comprehension questions it adds are kept in `fixtures/documents/`). Everything they make lands in `public/` and the videos in `out/`, neither of which is committed.

`capture` drives Chromium with Playwright: run `npx playwright install chromium` once, or point `CHROMIUM_PATH` at a Chromium (the full browser, not the headless shell: the Documents capture uses its PDF viewer). Remotion downloads its own browser; `REMOTION_BROWSER` points it at a local one instead.

`npm run transcript` writes the narration as plain text, chapter by chapter, with each chapter's start time (`out/prise-en-main-studio-audio-script.txt`; `npm run transcript -- documents` for Documents).

To look at a few frames without a full render: `npm run stills -- StudioAudioModule 300,2300,4950` (PNGs in `out/stills/`). `npm run studio` opens the edit in Remotion Studio.

## Changing a tutorial

Everything that is said and shown is in the tutorial's script, `src/studio-audio/script.ts` or `src/documents/script.ts`: one entry per paragraph of narration, with its beats, what the screen shows while it is spoken: the captured state (`shot`), what the camera frames (`focus`), what is spotlit, clicked and labelled. `at` is the share of the paragraph already spoken when a beat starts.

- New wording: edit the paragraph, then `npm run voice [-- documents]` re-reads only what changed.
- Something new on screen: add the state to the tutorial's walk in `scripts/capture/` (`studio-audio.mts`, `documents.mts`), and the element to its `BOXES`.
- After a change in the studio's interface: capture again; the edit follows the new layout.
- A new tutorial: a script in `src/<id>/script.ts` listed in `src/tutorial/catalog.ts`, a walk in `scripts/capture/<id>.mts`, and a composition in `src/root.tsx`.

## A recorded voice-over

The narration in `public/<tutorial>/voice/` is read by a studio voice. A recorded one can replace it paragraph by paragraph: the same file names (`intro-1.wav`, `ch0-1.wav`…), and their durations in `manifest.json` with `"source": "recorded"`. The edit is timed on the narration, so it follows the new takes without other changes.
