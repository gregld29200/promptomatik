# TeachInspire tutorials

Tutorial videos for TeachInspire Studio, edited in code with [Remotion](https://www.remotion.dev): the real studio is captured screen by screen, then a camera frames, spotlights and clicks what the narration talks about.

The first one is **Prise en main du Studio audio** (Module 5, video 1), in two cuts:

- `StudioAudioModule`: with the module's opening and its hand-off to video 2;
- `StudioAudioSite`: the same tutorial on its own, for the help pages.

## Making the video

```bash
cd tutorials
npm install

npm run demo      # the demo dialogue: suggestions, take at B1, the A1/B1 comparison
npm run voice     # temporary narration, one take per paragraph
npm run capture   # the studio's screens, from the app's sources, with its API mocked
npm run render:module
npm run render:site
```

`demo` needs `GEMINI_API_KEY` (first run only: the review it gets is kept in `fixtures/`) and `OPENROUTER_API_KEY`; `voice` needs `OPENROUTER_API_KEY`. Everything they make lands in `public/` and the videos in `out/`, neither of which is committed.

`capture` drives Chromium with Playwright: run `npx playwright install chromium` once, or point `CHROMIUM_PATH` at a Chromium. Remotion downloads its own browser; `REMOTION_BROWSER` points it at a local one instead.

To look at a few frames without a full render: `npm run stills -- StudioAudioModule 300,2300,4950` (PNGs in `out/stills/`). `npm run studio` opens the edit in Remotion Studio.

## Changing the tutorial

Everything that is said and shown is in `src/studio-audio/script.ts`: one entry per paragraph of narration, with its beats, what the screen shows while it is spoken: the captured state (`shot`), what the camera frames (`focus`), what is spotlit, clicked and labelled. `at` is the share of the paragraph already spoken when a beat starts.

- New wording: edit the paragraph, then `npm run voice` re-reads only what changed.
- Something new on screen: add the state to the walk in `scripts/capture.mts`, and the element to its `BOXES`.
- After a change in the studio's interface: `npm run capture` again; the edit follows the new layout.

## The real voice-over

The narration in `public/studio-audio/voice/` is a temporary studio voice. A recorded one replaces it paragraph by paragraph: the same file names (`intro-1.wav`, `ch0-1.wav`…), and their durations in `manifest.json` with `"source": "recorded"`. The edit is timed on the narration, so it follows the new takes without other changes.
