import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption } from "./Caption";
import { Footage } from "./Footage";
import { color, display } from "./theme";
import { MAP_NAMES, type Clip } from "./timeline";

const MapName: React.FC<{ index: number; name: string }> = ({ index, name }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [2, 16], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        right: 128,
        top: 110,
        textAlign: "right",
        fontFamily: display,
        opacity: t,
        translate: `${interpolate(t, [0, 1], [40, 0])}px 0px`,
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "0.2em", color: color.ice }}>
        FRONT 0{index + 1} / 05
      </div>
      <div
        style={{
          fontSize: 112,
          fontWeight: 800,
          lineHeight: 0.95,
          textTransform: "uppercase",
          color: color.snow,
          textShadow: "0 4px 28px rgba(0,0,0,0.55)",
        }}
      >
        {name}
      </div>
    </div>
  );
};

/** Quick cuts across the five maps, each with its name, under one kicker. */
export const MapMontage: React.FC<{ clips: Clip[]; kicker: string }> = ({ clips, kicker }) => {
  const { durationInFrames } = useVideoConfig();
  const each = Math.floor(durationInFrames / clips.length);
  return (
    <AbsoluteFill>
      {clips.map((clip, i) => (
        <Sequence key={clip.map} from={i * each} durationInFrames={i === clips.length - 1 ? durationInFrames - i * each : each}>
          <Footage clip={clip} push={0.08} />
          <MapName index={i} name={MAP_NAMES[clip.map]} />
        </Sequence>
      ))}
      <Caption kicker={kicker} headline="" />
    </AbsoluteFill>
  );
};
