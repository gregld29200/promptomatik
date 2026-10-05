import { Composition } from "remotion";
import { FPS, HEIGHT, WIDTH } from "./theme";
import { Tutorial, tutorialMetadata, type TutorialProps } from "./tutorial/tutorial";

const studioAudioModule: TutorialProps = { tutorial: "studio-audio", cut: "module", captions: true };
const studioAudioSite: TutorialProps = { tutorial: "studio-audio", cut: "site", captions: true };
const documentsSite: TutorialProps = { tutorial: "documents", cut: "site", captions: true };

export function Root() {
  return (
    <>
      {/* Module 5, video 1: with the module's opening and its hand-off. */}
      <Composition id="StudioAudioModule" component={Tutorial} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={FPS} defaultProps={studioAudioModule} calculateMetadata={tutorialMetadata} />
      {/* The help page on the site: the same tutorial, standing alone. */}
      <Composition id="StudioAudioSite" component={Tutorial} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={FPS} defaultProps={studioAudioSite} calculateMetadata={tutorialMetadata} />
      <Composition id="DocumentsSite" component={Tutorial} width={WIDTH} height={HEIGHT} fps={FPS} durationInFrames={FPS} defaultProps={documentsSite} calculateMetadata={tutorialMetadata} />
    </>
  );
}
