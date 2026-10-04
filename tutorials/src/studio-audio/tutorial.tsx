import { AbsoluteFill, Html5Audio, Sequence, interpolate, staticFile, type CalculateMetadataFunction } from "remotion";
import { ChapterCard, EndCard, TitleCard } from "../components/cards";
import { CompareCard, ResultCard } from "../components/listening";
import { Captions, ChapterTag, Recap } from "../components/overlays";
import { Stage } from "../components/stage";
import { fontsReady } from "../fonts";
import { C } from "../theme";
import { loadTutorialData, type TutorialData } from "./data";
import { COMPARE_LINE, RECAP } from "./script";
import { buildTimeline, type Cut, type Overlay, type Sound, type Timeline } from "./timeline";

export type TutorialProps = {
  cut: Cut;
  captions: boolean;
  data?: TutorialData;
  timeline?: Timeline;
};

export const tutorialMetadata: CalculateMetadataFunction<TutorialProps> = async ({ props, abortSignal }) => {
  await fontsReady;
  const data = await loadTutorialData(abortSignal);
  const timeline = buildTimeline(data, props.cut);
  return { durationInFrames: timeline.duration, props: { ...props, data, timeline } };
};

function OverlayView({ overlay, data, cut }: { overlay: Overlay; data: TutorialData; cut: Cut }) {
  switch (overlay.kind) {
    case "title":
      return <TitleCard duration={overlay.duration} cut={cut} />;
    case "card":
      return <ChapterCard duration={overlay.duration} chapter={overlay.chapter} />;
    case "result":
      return (
        <ResultCard
          duration={overlay.duration}
          audioFrom={overlay.audioFrom - overlay.from}
          turns={data.demo.take.turns.slice(0, 3)}
          peaks={data.demo.take.peaks}
          takeSeconds={data.demo.take.seconds}
          voices={{ Chloé: "Rosa", Yanis: "Daniel" }}
        />
      );
    case "compare":
      return <CompareCard duration={overlay.duration} starts={overlay.starts.map((start) => start - overlay.from)} takes={data.demo.compare} line={COMPARE_LINE} />;
    case "recap":
      return <Recap duration={overlay.duration} steps={overlay.steps.map((step) => step - overlay.from)} labels={RECAP} />;
    case "end":
      return <EndCard duration={overlay.duration} cut={cut} />;
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

export function Tutorial({ cut, captions, data, timeline }: TutorialProps) {
  if (!data || !timeline) return <AbsoluteFill style={{ background: C.cream }} />;
  return (
    <AbsoluteFill style={{ background: C.cream }}>
      <Stage keys={timeline.keys} shots={data.shots} />
      <ChapterTag chapters={timeline.chapters} overlays={timeline.overlays} />
      {captions && <Captions captions={timeline.captions} />}
      {timeline.overlays.map((overlay) => (
        <Sequence key={`${overlay.kind}-${overlay.from}`} from={overlay.from} durationInFrames={overlay.duration}>
          <OverlayView overlay={overlay} data={data} cut={cut} />
        </Sequence>
      ))}
      <Sounds sounds={timeline.voices} />
      <Sounds sounds={timeline.sounds} fadeOut={10} />
    </AbsoluteFill>
  );
}
