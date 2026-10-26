import audio from './generated/commander-audio.json';

export type CommanderVoice = keyof typeof audio.voices;

/** Portraits and radio clips share one identity, including legacy players. */
export const voiceFor = (culture: string | undefined): CommanderVoice =>
  culture && Object.hasOwn(audio.voices, culture)
    ? (culture as CommanderVoice)
    : 'ravn';

export function commanderFor(culture: string | undefined) {
  const voice = voiceFor(culture);
  return {
    voice,
    name: audio.voices[voice].commander,
    portrait: `/art/commanders/${voice}.png`,
  };
}
