import { Composition } from "remotion";
import { FPS, HEIGHT, WIDTH } from "./theme";
import { Tutorial, tutorialMetadata, type TutorialProps } from "./studio-audio/tutorial";

const module: TutorialProps = { cut: "module", captions: true };
const site: TutorialProps = { cut: "site", captions: true };

export function Root() {
  return (
    <>
      {/* Module 5, video 1: with the module's opening and its hand-off. */}
      <Composition id="StudioAudioModule" component={Tutorial} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={FPS} defaultProps={module} calculateMetadata={tutorialMetadata} />
      {/* The help page on the site: the same tutorial, standing alone. */}
      <Composition id="StudioAudioSite" component={Tutorial} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={FPS} defaultProps={site} calculateMetadata={tutorialMetadata} />
    </>
  );
}
