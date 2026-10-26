import { Audio } from "@remotion/media";
import { fade } from "@remotion/transitions/fade";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption } from "./Caption";
import { Footage } from "./Footage";
import { MapMontage } from "./MapMontage";
import { TitleCard } from "./TitleCard";
import { FPS, music, TIMED, TRANSITION, voiceFor } from "./timeline";

/** Where each scene starts on the final timeline (transitions overlap). */
const STARTS = TIMED.map((_, i) => TIMED.slice(0, i).reduce((n, s) => n + s.frames - TRANSITION, 0));

/** Voice lines on the final timeline, used to duck the score under them. */
const LINES = TIMED.flatMap((s, i) => {
  const v = voiceFor(s.id);
  if (!v) return [];
  const from = STARTS[i] + Math.round(s.lead * FPS);
  return [{ id: s.id, src: v.src, from, to: from + Math.round(v.seconds * FPS) }];
});

const duck = (frame: number) => {
  const near = LINES.some((l) => frame > l.from - 8 && frame < l.to + 10);
  return near ? 0.34 : 1;
};

/** Cannon fire over the crossing, timed to the firefight. */
const HITS: [string, number, number][] = [
  ["cannon", 0.6, 0.55],
  ["machine", 1.8, 0.35],
  ["rocket", 3.4, 0.45],
  ["artillery", 5.1, 0.6],
  ["cannon", 6.6, 0.5],
  ["machine", 8.0, 0.3],
];

export const LaunchVideo: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  const fight = TIMED.findIndex((s) => s.id === "fight");
  return (
    <AbsoluteFill style={{ backgroundColor: "#0d1319" }}>
      <TransitionSeries>
        {TIMED.flatMap((scene, i) => [
          ...(i > 0
            ? [<TransitionSeries.Transition key={`t-${scene.id}`} presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />]
            : []),
          <TransitionSeries.Sequence key={scene.id} durationInFrames={scene.frames}>
            {scene.id === "fronts" ? (
              <MapMontage clips={scene.clips} kicker={scene.kicker} />
            ) : (
              <>
                <Footage clip={scene.clips[0]} />
                {scene.id === "call" ? <TitleCard /> : <Caption kicker={scene.kicker} headline={scene.headline} />}
              </>
            )}
          </TransitionSeries.Sequence>,
        ])}
      </TransitionSeries>

      {/* Fade in from and out to black. */}
      <Sequence durationInFrames={24}>
        <FadeBlack from={1} to={0} />
      </Sequence>
      <Sequence from={durationInFrames - 30}>
        <FadeBlack from={0} to={1} />
      </Sequence>

      {music ? (
        <Audio
          src={staticFile(music.src)}
          volume={(f) =>
            0.72 *
            duck(f) *
            interpolate(f, [0, 20, durationInFrames - 60, durationInFrames - 4], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
        />
      ) : null}
      {LINES.map((l) => (
        <Sequence key={l.id} from={l.from} durationInFrames={l.to - l.from + 6}>
          <Audio src={staticFile(l.src)} volume={1} />
        </Sequence>
      ))}
      {HITS.map(([name, at, volume], i) => (
        <Sequence key={i} from={STARTS[fight] + Math.round(at * FPS)} durationInFrames={2 * FPS}>
          <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const FadeBlack: React.FC<{ from: number; to: number }> = ({ from, to }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#000",
        opacity: interpolate(frame, [0, durationInFrames], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      }}
    />
  );
};
