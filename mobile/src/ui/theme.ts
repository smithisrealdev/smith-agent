// The web app's colours (public/app.css :root and dark theme) for places that need a value, not a class:
// every style in the app (Nativewind 5 RC broke font and image loading on Expo SDK 58, so styles are plain RN).
import { useColorScheme } from "react-native";

const light = {
  ink: "#0B1B4D", blue: "#0A4BFF", yel: "#FFC21A", cor: "#F4472F", mut: "#4A5778", line: "#E3E9F6", soft: "#EAF1FF", field: "#EEF3FC",
  gtxt: "#0B7A3E", gsoft: "#D9F5E6", rtxt: "#A81D0C", rsoft: "#FFE9E5", ysoft: "#FFF1C4", ytxt: "#7A5200", psoft: "#ECE6FF", ptxt: "#5B3CC4",
  page: "#FFFFFF", surf: "#FFFFFF", inkbg: "#0B1B4D", link: "#0A4BFF", dash: "#D6DEF0", off: "#C3CDE3", ph: "#66729A", dangerbg: "#A81D0C",
  white: "#FFFFFF", dark: false,
};
const dark: typeof light = {
  ...light,
  page: "#0B1020", surf: "#151C33", ink: "#EEF2FF", inkbg: "#2A3556", mut: "#A9B4D0", line: "#2A3556", soft: "#1B2747", field: "#1E2742", link: "#8FB0FF",
  gtxt: "#5BE39B", gsoft: "#12352A", rtxt: "#FF9A8B", rsoft: "#3A1C1F", ysoft: "#3A3014", ytxt: "#FFD36B", psoft: "#2A2452",
  dash: "#2A3556", off: "#3A4670", ph: "#8590B0", dangerbg: "#D8361F", dark: true,
};
export type Colors = typeof light;
export const useColors = () => (useColorScheme() === "dark" ? dark : light);

// Cards float on a soft shadow in light mode and get an outline in dark mode, like --lift.
export const lift = (c: Colors) => (c.dark
  ? { borderWidth: 1, borderColor: c.line }
  : { shadowColor: "#0B1B4D", shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 6 }, elevation: 3 });

// Tone → [background, foreground], as .pill.good, .note.warn, .tile.bad ...
export const tone = (c: Colors, t: string = "") => ({
  good: [c.gsoft, c.gtxt], bad: [c.rsoft, c.rtxt], warn: [c.ysoft, c.ytxt], grey: [c.field, c.mut],
  blu: [c.soft, c.link], cor: [c.rsoft, c.rtxt], grn: [c.gsoft, c.gtxt], yel: [c.ysoft, c.ytxt],
}[t] || [c.soft, c.link]) as [string, string];
