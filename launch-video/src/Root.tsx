import "./index.css";
import { Composition } from "remotion";
import { LaunchVideo } from "./LaunchVideo";
import { FPS, TOTAL_FRAMES } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <Composition id="NoordheimLaunch" component={LaunchVideo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={1920} height={1080} />
);
