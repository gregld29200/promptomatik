import { AbsoluteFill, Html5Audio, Sequence, interpolate, staticFile, type CalculateMetadataFunction } from "remotion";
import { ChapterCard, EndCard, TitleCard } from "../components/cards";
import { CompareCard, ResultCard } from "../components/listening";
import { Captions, ChapterTag, Recap } from "../components/overlays";
import { DocumentResult } from "../components/pages";
import { Stage } from "../components/stage";
import { COMPARE_LINE } from "../studio-audio/script";
import { fontsReady } from "../fonts";
import { C } from "../theme";
import { tutorialScript } from "./catalog";
import { audioDemo, documentsDemo, loadTutorialData, type TutorialData } from "./data";
import { buildTimeline, type Overlay, type Sound, type Timeline } from "./timeline";
import type { Cut, TutorialScript } from "./types";

export type TutorialProps = {
  tutorial: string;
  cut: Cut;
  captions: boolean;
  data?: TutorialData;
  timeline?: Timeline;
};

export const tutorialMetadata: CalculateMetadataFunction<TutorialProps> = async ({ props, abortSignal }) => {
  await fontsReady;
  const script = tutorialScript(props.tutorial);
  const data = await loadTutorialData(script.id, abortSignal);
  const timeline = buildTimeline(script, data, props.cut);
  return { durationInFrames: timeline.duration, props: { ...props, data, timeline } };
};

// A tutorial's own full-screen scenes, by the name its script gives them.
function SceneView({ name, duration, data }: { name: string; duration: number; data: TutorialData }) {
  if (name === "result") return <DocumentResult duration={duration} demo={documentsDemo(data)} />;
  throw new Error(`Unknown scene "${name}".`);
}

function OverlayView({ overlay, data, cut, script }: { overlay: Overlay; data: TutorialData; cut: Cut; script: TutorialScript }) {
  switch (overlay.kind) {
    case "title":
      return <TitleCard duration={overlay.duration} cut={cut} title={script.title} />;
    case "card":
      return <ChapterCard duration={overlay.duration} chapter={overlay.chapter} count={script.chapters.filter((chapter) => chapter.label !== undefined).length} />;
    case "result": {
      const demo = audioDemo(data);
      return (
        <ResultCard
          duration={overlay.duration}
          audioFrom={overlay.audioFrom - overlay.from}
          turns={demo.take.turns.slice(0, 3)}
          peaks={demo.take.peaks}
          takeSeconds={demo.take.seconds}
          cast={demo.cast}
        />
      );
    }
    case "compare":
      return <CompareCard duration={overlay.duration} starts={overlay.starts.map((start) => start - overlay.from)} takes={audioDemo(data).compare} line={COMPARE_LINE} />;
    case "recap":
      return <Recap duration={overlay.duration} steps={overlay.steps.map((step) => step - overlay.from)} labels={script.recap.labels} />;
    case "scene":
      return <SceneView name={overlay.name} duration={overlay.duration} data={data} />;
    case "end":
      return <EndCard duration={overlay.duration} end={script.end[cut] ?? script.end.site} />;
  }
}

function Sounds({ sounds, fadeOut = 0 }: { sounds: Sound[]; fadeOut?: number }) {
  return (
    <>
      {sounds.map((sound) => (
        <Sequence key={`${sound.file}-${sound.from}`} from={sound.from} durationInFrames={sound.frames} layout="none">
          <Html5Audio
            src={staticFile(sound.file)}
            volume={(frame) => (fadeOut ? interpolate(frame, [sound.frames - fadeOut, sound.frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1)}
          />
        </Sequence>
      ))}
    </>
  );
}

export function Tutorial({ tutorial, cut, captions, data, timeline }: TutorialProps) {
  if (!data || !timeline) return <AbsoluteFill style={{ background: C.cream }} />;
  const script = tutorialScript(tutorial);
  return (
    <AbsoluteFill style={{ background: C.cream }}>
      <Stage keys={timeline.keys} shots={data.shots} />
      <ChapterTag chapters={timeline.chapters} overlays={timeline.overlays} />
      {captions && <Captions captions={timeline.captions} />}
      {timeline.overlays.map((overlay) => (
        <Sequence key={`${overlay.kind}-${overlay.from}`} from={overlay.from} durationInFrames={overlay.duration}>
          <OverlayView overlay={overlay} data={data} cut={cut} script={script} />
        </Sequence>
      ))}
      <Sounds sounds={timeline.voices} />
      <Sounds sounds={timeline.sounds} fadeOut={10} />
    </AbsoluteFill>
  );
}
