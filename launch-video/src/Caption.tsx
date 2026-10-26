import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { color, display } from "./theme";

/** Lower-left title: a signal-orange kicker over a large condensed headline. */
export const Caption: React.FC<{ kicker: string; headline: string; delay?: number }> = ({
  kicker,
  headline,
  delay = 8,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const enter = (offset: number) =>
    interpolate(frame, [delay + offset, delay + offset + 18], [0, 1], {
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const exit = interpolate(frame, [durationInFrames - 22, durationInFrames - 8], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div style={{ position: "absolute", left: 128, bottom: 132, opacity: exit }}>
      {kicker ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 16,
            fontFamily: display,
            fontWeight: 600,
            fontSize: 34,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: color.signal,
            opacity: enter(0),
            translate: `${interpolate(enter(0), [0, 1], [-24, 0])}px 0px`,
          }}
        >
          <span style={{ width: 44, height: 4, backgroundColor: color.signal }} />
          {kicker}
        </div>
      ) : null}
      {headline ? (
        <div
          style={{
            marginTop: 6,
            fontFamily: display,
            fontWeight: 800,
            fontSize: 136,
            lineHeight: 0.92,
            textTransform: "uppercase",
            color: color.snow,
            textShadow: "0 4px 28px rgba(0,0,0,0.55)",
            opacity: enter(5),
            translate: `0px ${interpolate(enter(5), [0, 1], [30, 0])}px`,
            clipPath: `inset(0 ${interpolate(enter(5), [0, 1], [100, 0])}% 0 0)`,
          }}
        >
          {headline}
        </div>
      ) : null}
    </div>
  );
};
