/**
 * Generates the launch video's voice-over (Commander Ravn) and score with ElevenLabs.
 * Reads ELEVENLABS_API_KEY from the environment or ../.env.local. Existing files are
 * kept; delete one to regenerate it. Writes src/audio-manifest.json with durations.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
for (const f of ['.env.local', '../.env.local'])
  if (!process.env.ELEVENLABS_API_KEY && existsSync(resolve(root, f))) process.loadEnvFile(resolve(root, f));
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error('ELEVENLABS_API_KEY is required (env or .env.local).');

const script = JSON.parse(readFileSync(resolve(root, 'src/script.json'), 'utf8'));
const voice = JSON.parse(readFileSync(resolve(root, '../art/audio/commander-voice.json'), 'utf8')).voice;
const only = process.argv[2]; // 'voice' | 'music' | undefined (both)

async function request(endpoint, body) {
  const r = await fetch('https://api.elevenlabs.io' + endpoint, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`ElevenLabs ${r.status}: ${e.detail?.status ?? ''} ${e.detail?.message ?? JSON.stringify(e)}`);
  }
  return Buffer.from(await r.arrayBuffer());
}
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}
const duration = (p) =>
  Number(spawnSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', p], { encoding: 'utf8' }).stdout);

const manifest = { voice: {}, music: null };
if (only !== 'music')
  for (const [i, line] of script.lines.entries()) {
    const raw = resolve(root, `public/audio/vo-${line.id}.raw.mp3`);
    const out = resolve(root, `public/audio/vo-${line.id}.mp3`);
    if (!existsSync(raw)) {
      writeFileSync(
        raw,
        await request(`/v1/text-to-speech/${voice.id}?output_format=mp3_44100_128`, {
          text: line.text,
          model_id: 'eleven_multilingual_v2',
          seed: 900 + i,
          voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true, speed: 0.96 },
        }),
      );
      console.log('voice', line.id);
    }
    // Trim silence, warm it up a little, and level every line the same.
    ffmpeg(['-i', raw, '-af',
      'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB,areverse,highpass=f=70,acompressor=threshold=0.15:ratio=2.5:attack=5:release=90,loudnorm=I=-16:TP=-1.5:LRA=7',
      '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '192k', out]);
    manifest.voice[line.id] = { src: `audio/vo-${line.id}.mp3`, seconds: duration(out), text: line.text };
  }
if (only !== 'voice') {
  const out = resolve(root, 'public/audio/music.mp3');
  if (!existsSync(out)) {
    writeFileSync(
      out,
      await request('/v1/music?output_format=mp3_44100_128', {
        prompt: script.music.prompt,
        music_length_ms: script.music.durationMs,
        force_instrumental: true,
        model_id: 'music_v1',
      }),
    );
    console.log('music');
  }
  manifest.music = { src: 'audio/music.mp3', seconds: duration(out), title: script.music.title };
}
const file = resolve(root, 'src/audio-manifest.json');
const previous = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
writeFileSync(file, JSON.stringify({ voice: { ...previous.voice, ...manifest.voice }, music: manifest.music ?? previous.music ?? null }, null, 2) + '\n');
console.log('wrote src/audio-manifest.json');
