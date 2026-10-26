import manifest from "./audio-manifest.json";
import script from "./script.json";

export const FPS = 30;
export const TRANSITION = 14; // frames of cross-dissolve between scenes

export type LineId = (typeof script.lines)[number]["id"];

/** A slice of recorded attract-mode footage (public/footage/<map>.mp4). */
export type Clip = { map: string; from: number; seconds: number };

export type Scene = {
  id: LineId;
  kicker: string;
  headline: string;
  /** Seconds of breathing room before the line starts. */
  lead: number;
  /** Minimum on-screen seconds, so short lines still let the footage play. */
  min: number;
  clips: Clip[];
};

export const SCENES: Scene[] = [
  { id: "open", kicker: "Cold War strategy", headline: "The northern front", lead: 1.2, min: 7, clips: [{ map: "nordlys", from: 48, seconds: 13 }] },
  { id: "build", kicker: "Your base", headline: "Build. Harvest. Power.", lead: 0.5, min: 8, clips: [{ map: "fjordmouth", from: 0.5, seconds: 9 }] },
  { id: "fight", kicker: "Tanks · rockets · artillery", headline: "Take the crossing", lead: 0.4, min: 9, clips: [{ map: "fjordmouth", from: 9.5, seconds: 12 }] },
  {
    id: "fronts",
    kicker: "Five hand-built fronts",
    headline: "",
    lead: 0.3,
    min: 14,
    clips: [
      { map: "fjordmouth", from: 22, seconds: 2.8 },
      { map: "ironpass", from: 24, seconds: 2.8 },
      { map: "glaciercrown", from: 30, seconds: 2.8 },
      { map: "skerryharbour", from: 40, seconds: 2.8 },
      { map: "nordlys", from: 33, seconds: 2.8 },
    ],
  },
  { id: "coop", kicker: "Co-op or solo", headline: "Up to 8 commanders", lead: 0.4, min: 7.5, clips: [{ map: "skerryharbour", from: 18.5, seconds: 9 }] },
  { id: "persist", kicker: "Simulated on the server", headline: "The war never pauses", lead: 0.4, min: 7, clips: [{ map: "hud", from: 1, seconds: 10 }] },
  { id: "call", kicker: "", headline: "", lead: 0.8, min: 10, clips: [{ map: "fjordmouth", from: 31, seconds: 14 }] },
];

export const MAP_NAMES: Record<string, string> = {
  fjordmouth: "Fjordmouth",
  ironpass: "Iron Pass",
  glaciercrown: "Glacier Crown",
  skerryharbour: "Skerry Harbour",
  nordlys: "Nordlys Valley",
};

type Voice = { src: string; seconds: number; text: string };
const voices = manifest.voice as Record<string, Voice | undefined>;

/** Before ElevenLabs has run, estimate a line at ~2.6 words per second. */
export function voiceFor(id: LineId): Voice | null {
  return voices[id] ?? null;
}
const lineSeconds = (id: LineId) =>
  voices[id]?.seconds ?? script.lines.find((l) => l.id === id)!.text.split(" ").length / 2.6;

export const TIMED = SCENES.map((s) => ({
  ...s,
  frames: Math.round(Math.max(s.min, s.lead + lineSeconds(s.id) + 1.1) * FPS),
}));

export const TOTAL_FRAMES = TIMED.reduce((n, s) => n + s.frames, 0) - TRANSITION * (TIMED.length - 1);

export const music = manifest.music as { src: string; seconds: number } | null;
