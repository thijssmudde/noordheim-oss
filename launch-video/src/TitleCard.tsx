import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { color, body, display } from "./theme";

/** The closing lock-up: the name, the promise and the address. */
export const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const at = (start: number, length = 20) =>
    interpolate(frame, [start, start + length], [0, 1], {
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse 60% 55% at 50% 50%, rgba(13,19,25,0.82) 0%, rgba(13,19,25,0.55) 65%, rgba(13,19,25,0.3) 100%)",
          opacity: at(0, 30),
        }}
      />
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: display,
            fontWeight: 700,
            fontSize: 38,
            letterSpacing: "0.34em",
            textShadow: "0 2px 16px rgba(0,0,0,0.7)",
            color: color.signal,
            opacity: at(10),
          }}
        >
          THE NORTHERN FRONT
        </div>
        <div
          style={{
            fontFamily: display,
            fontWeight: 800,
            fontSize: 250,
            lineHeight: 0.9,
            color: color.snow,
            textShadow: "0 6px 40px rgba(0,0,0,0.6)",
            opacity: at(4, 26),
            scale: interpolate(at(4, 40), [0, 1], [1.12, 1], { output: "perceptual-scale" }),
            letterSpacing: `${interpolate(at(4, 40), [0, 1], [0.14, 0.02])}em`,
          }}
        >
          NOORDHEIM
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: body,
            fontWeight: 500,
            fontSize: 46,
            color: color.ice,
            opacity: at(30),
            translate: `0px ${interpolate(at(30), [0, 1], [16, 0])}px`,
          }}
        >
          Co-op Cold War RTS · Free, in your browser
        </div>
        <div
          style={{
            display: "inline-block",
            marginTop: 54,
            padding: "18px 44px",
            fontFamily: display,
            fontWeight: 700,
            fontSize: 56,
            letterSpacing: "0.08em",
            color: color.ink,
            backgroundColor: color.signal,
            clipPath: "polygon(18px 0, 100% 0, calc(100% - 18px) 100%, 0 100%)",
            opacity: at(44),
            scale: interpolate(at(44), [0, 1], [0.9, 1], { output: "perceptual-scale" }),
          }}
        >
          NOORDHEIM.COM
        </div>
      </div>
    </AbsoluteFill>
  );
};
