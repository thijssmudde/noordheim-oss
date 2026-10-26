import { Video } from "@remotion/media";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Clip } from "./timeline";

/** A slice of recorded game footage with a slow push-in and a cinematic vignette. */
export const Footage: React.FC<{ clip: Clip; push?: number }> = ({ clip, push = 0.06 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#0d1319", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          scale: interpolate(frame, [0, durationInFrames], [1.02, 1.02 + push], {
            easing: Easing.inOut(Easing.quad),
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <Video
          src={staticFile(`footage/${clip.map}.mp4`)}
          trimBefore={Math.round(clip.from * fps)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse 75% 70% at 50% 45%, rgba(0,0,0,0) 55%, rgba(8,12,18,0.55) 100%), linear-gradient(0deg, rgba(8,12,18,0.55) 0%, rgba(8,12,18,0) 38%)",
        }}
      />
    </AbsoluteFill>
  );
};
