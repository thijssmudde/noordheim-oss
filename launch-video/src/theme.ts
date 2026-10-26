import { loadFont as loadDisplay } from "@remotion/google-fonts/BarlowCondensed";
import { loadFont as loadBody } from "@remotion/google-fonts/Barlow";

export const display = loadDisplay("normal", { weights: ["500", "600", "700", "800"], subsets: ["latin"] }).fontFamily;
export const body = loadBody("normal", { weights: ["500", "600"], subsets: ["latin"] }).fontFamily;

// Frost-iron palette from the game's HUD.
export const color = {
  plate: "rgba(22, 30, 40, 0.78)",
  plateEdge: "rgba(185, 200, 220, 0.28)",
  signal: "#ff8f3a",
  ice: "#cfe3f2",
  snow: "#f3efe6",
  ink: "#0d1319",
};
