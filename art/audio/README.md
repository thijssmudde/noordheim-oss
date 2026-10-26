# Noordheim audio

Commander Ravn, both instrumental tracks and the five weapon one-shots are original ElevenLabs-generated assets authored for Noordheim. Speech uses Eleven v4 (`brief.voice.model`), music uses `music_v2`, and weapons use sound generation. The voice was designed from the Scandinavian commander description in `brief.json`; no actor recording or existing game soundtrack was supplied.

- **29 radio clips**, with variations for selection, movement, and attacks. The remaining calls cover production, incoming forces, damage, losses, power, objectives, and results.
- **Faction commanders**: Captain Sigrid Havn (Fjordborn), Colonel Brand Hammar (Ironclad), Major Liv Åker (Hearthkin) and Captain Tor Aske (Ashwalkers) each voice all 29 cues in their own designed voice. Their personal lines live under `commanders.<culture>.cues` in `brief.json`; any cue they leave out uses Ravn's script. Ravn remains the voice for unaligned commanders.
- **Map scores**: every map in `brief.maps` has its own exploration and combat pair (`public/audio/music/<map>/`). A battle plays its map's pair; off the battlefield the realm pair below plays.
- **Skerry Watch**: restrained Nordic industrial exploration/base-building music.
- **Northern Advance**: heavier combat music. Both tracks are about 88 seconds, processed with a two-second tail/head overlap for looping.

`brief.json` contains the editable scripts and music prompts. `commander-voice.json` records the created voice ID; `music-production.json` records generation provenance. These IDs are not API credentials. Hashed, finished MP3s live in `public/audio`; generated manifests in `lib/generated` connect them to the game.

## Authoring

Run from the project root with Node 22+ and FFmpeg/ffprobe available on PATH:

```sh
node scripts/generate-audio.mjs design --env-file /absolute/path/to/.env.local
node scripts/generate-audio.mjs voice --preview 1 --env-file /absolute/path/to/.env.local
node scripts/generate-audio.mjs design --commander fjordborn --env-file /absolute/path/to/.env.local
node scripts/generate-audio.mjs voice --commander fjordborn --preview 1 --env-file /absolute/path/to/.env.local
node scripts/generate-audio.mjs speech --env-file /absolute/path/to/.env.local
node scripts/generate-audio.mjs music --env-file /absolute/path/to/.env.local
node scripts/generate-audio.mjs effects --env-file /absolute/path/to/.env.local
```

The external environment file must contain `ELEVENLABS_API_KEY`. Authoring makes billable provider requests when raw files are absent. Existing raw clips are reused from ignored `work/audio`; remove the corresponding raw input before regenerating a changed script or music prompt. Do not add the key or raw design responses to this repository. The game serves finished assets and never calls ElevenLabs.

Bracketed delivery tags in cue lines (for example `[urgent]`) steer the v4 performance and are stripped from subtitles. Weapon effects keep fixed paths in `public/audio/combat` as 22.05 kHz mono WAV.

Speech is trimmed, radio-filtered, compressed, and normalized near −17 LUFS; music is normalized near −20 LUFS. All assets are MP3/44.1 kHz. Voice is mono/96 kbps, music stereo/128 kbps. The full shipped soundtrack and voice collection is about 3.5 MB.

## Playback

Audio unlocks on the first user interaction. Music streams through Web Audio gain channels, crossfades between moods, and ducks while the commander speaks. Voice clips are fetched and decoded on demand, then cached for the session. Warnings have priority over acknowledgements; cooldowns and a short queue prevent repeated chatter. Each playing line displays a matching subtitle.

Volume and mute preferences are saved only on the current device. Hidden tabs pause music, stop voice, and discard pending calls. Returning establishes current battle state without replaying past reports. Realm navigation retains the soundtrack and exposes the same controls.

`tests/audio.test.ts` covers authoritative snapshot transitions, fog boundaries, cooldowns, queue priority, preference validation, and shipped asset integrity. `tests/game-audio.test.ts` covers autoplay gating, ducking, interruption, late downloads after mute, visibility, failures, and cleanup using a mocked audio device; it does not claim browser listening or visual QA.

Provider references: [voice design](https://elevenlabs.io/docs/api-reference/text-to-voice/design), [text to speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), [music](https://elevenlabs.io/docs/api-reference/music/compose).
