import swatches from '../art/cultures.json';
import type { Culture } from './cultures';

export const cultureArt = (culture: Culture) => {
  const palette = swatches[culture];
  return {
    primary: `#${palette.primary}`,
    light: `#${palette.light}`,
    dark: `#${palette.dark}`,
    accent: `#${palette.accent}`,
    roof: `#${palette.roof}`,
  };
};
