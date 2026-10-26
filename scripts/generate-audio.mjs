/** Offline asset authoring only. No provider credentials are shipped to the game. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const option = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
};
if (option('--env-file')) process.loadEnvFile(option('--env-file'));
const key = process.env.ELEVENLABS_API_KEY;
if (!key)
  throw new Error('ELEVENLABS_API_KEY is required for offline generation.');
const brief = JSON.parse(
  readFileSync(resolve(root, 'art/audio/brief.json'), 'utf8'),
);
const raw = resolve(root, 'work/audio');
mkdirSync(raw, { recursive: true });
const metadataFile = resolve(
  root,
  process.argv[2] === 'music'
    ? 'art/audio/music-production.json'
    : 'art/audio/commander-voice.json',
);
const metadata = existsSync(metadataFile)
  ? JSON.parse(readFileSync(metadataFile, 'utf8'))
  : { provider: 'ElevenLabs', voice: {}, music: {} };
const save = () =>
  writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
async function request(endpoint, body) {
  const r = await fetch('https://api.elevenlabs.io' + endpoint, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240000),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(
      `ElevenLabs ${r.status}: ${e.detail?.status ?? 'request_failed'} — ${e.detail?.message ?? e.detail?.[0]?.msg ?? 'generation failed'}`,
    );
  }
  return r;
}
function ffmpeg(args) {
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', ...args],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(r.stderr);
}
function probe(path) {
  return JSON.parse(
    spawnSync(
      'ffprobe',
      ['-v', 'quiet', '-show_format', '-show_streams', '-of', 'json', path],
      { encoding: 'utf8' },
    ).stdout,
  );
}
function publish(path, folder, stem) {
  const bytes = readFileSync(path),
    hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10),
    url = `/audio/${folder}/${stem}-${hash}.mp3`;
  mkdirSync(resolve(root, 'public/audio', folder), { recursive: true });
  writeFileSync(resolve(root, 'public' + url), bytes);
  return {
    file: url,
    bytes: bytes.length,
    duration: Number(probe(path).format.duration),
  };
}
const command = process.argv[2];
// Commander Ravn is the unaligned voice; each culture brings its own commander.
const RAVN = 'ravn';
const speakerKey = option('--commander') ?? RAVN;
const speakerBrief = (key) =>
  key === RAVN
    ? { ...brief.voice, name: 'Commander Ravn', cues: {} }
    : brief.commanders[key];
const speakerVoice = (key) =>
  key === RAVN ? metadata.voice : (metadata.voices?.[key] ?? {});
// Ravn keeps the original raw filenames so earlier takes stay reusable.
const rawName = (key, name) => (key === RAVN ? name : `${key}-${name}`);
if (command === 'design') {
  if (!speakerBrief(speakerKey)) throw new Error('Unknown commander.');
  if (speakerVoice(speakerKey).id) {
    console.log('An authored voice already exists. Reusing it.');
    process.exit(0);
  }
  const speaker = speakerBrief(speakerKey),
    designFile = resolve(raw, rawName(speakerKey, 'voice-design.json'));
  let design;
  if (existsSync(designFile))
    design = JSON.parse(readFileSync(designFile, 'utf8'));
  else {
    const r = await request(
      '/v1/text-to-voice/design?output_format=mp3_44100_128',
      {
        voice_description: speaker.description,
        text: speaker.preview,
        model_id: 'eleven_multilingual_ttv_v2',
        seed: 48123,
        guidance_scale: 6,
      },
    );
    design = await r.json();
    writeFileSync(designFile, JSON.stringify(design));
  }
  const preview = (i) =>
    resolve(raw, rawName(speakerKey, `voice-preview-${i + 1}.mp3`));
  for (let i = 0; i < design.previews.length; i++)
    writeFileSync(
      preview(i),
      Buffer.from(design.previews[i].audio_base_64, 'base64'),
    );
  console.log(
    JSON.stringify({
      previews: design.previews.map((p, i) => ({
        number: i + 1,
        duration: p.duration_secs,
        path: preview(i),
      })),
    }),
  );
} else if (command === 'voice') {
  const speaker = speakerBrief(speakerKey);
  if (!speaker) throw new Error('Unknown commander.');
  if (speakerVoice(speakerKey).id) {
    console.log(`Reusing ${speaker.name}.`);
    process.exit(0);
  }
  const design = JSON.parse(
      readFileSync(resolve(raw, rawName(speakerKey, 'voice-design.json')), 'utf8'),
    ),
    index = Number(option('--preview') ?? 1) - 1;
  const r = await request('/v1/text-to-voice', {
    voice_name: `Noordheim — ${speaker.name}`,
    voice_description: speaker.description,
    generated_voice_id: design.previews[index].generated_voice_id,
    labels: { language: 'en', accent: 'Scandinavian', use_case: 'video_games' },
  });
  const v = await r.json(),
    voice = {
      id: v.voice_id,
      name: `Noordheim — ${speaker.name}`,
      model: brief.voice.model ?? 'eleven_multilingual_v2',
      description: speaker.description,
    };
  if (speakerKey === RAVN) metadata.voice = voice;
  else metadata.voices = { ...metadata.voices, [speakerKey]: voice };
  save();
  console.log(`Created original ${speaker.name} voice.`);
} else if (command === 'speech') {
  if (!metadata.voice.id) throw new Error('Create the commander voice first.');
  const speechModel = brief.voice.model ?? 'eleven_multilingual_v2';
  metadata.voice.model = speechModel;
  for (const voice of Object.values(metadata.voices ?? {}))
    voice.model = speechModel;
  save();
  const voices = {};
  for (const key of [RAVN, ...Object.keys(brief.commanders ?? {})]) {
    const speaker = speakerBrief(key),
      voiceId = speakerVoice(key).id;
    if (!voiceId) {
      console.log(`Skipping ${speaker.name}: create the voice first.`);
      continue;
    }
    const clips = {};
    for (const [cue, shared] of Object.entries(brief.cues)) {
      const lines = speaker.cues[cue] ?? shared;
      clips[cue] = [];
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i],
          stem = `${cue}-${i + 1}`,
          input = resolve(raw, rawName(key, stem + '.mp3')),
          output = resolve(raw, rawName(key, stem + '-radio.mp3'));
        if (!existsSync(input)) {
          const r = await request(
            `/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
            {
              text,
              model_id: speechModel,
              seed: 310 + i,
              // v4 ignores style and speaker boost; bracketed tags steer delivery instead.
              voice_settings: {
                stability: 0.5,
                similarity_boost: 0.8,
                speed: 1.06,
              },
            },
          );
          writeFileSync(input, Buffer.from(await r.arrayBuffer()));
        }
        ffmpeg([
          '-i',
          input,
          '-af',
          'silenceremove=start_periods=1:start_duration=0.015:start_threshold=-48dB,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-48dB,areverse,highpass=f=180,lowpass=f=6200,acompressor=threshold=0.12:ratio=2.5:attack=5:release=70,loudnorm=I=-17:TP=-2:LRA=7,afade=t=in:d=0.012',
          '-ar',
          '44100',
          '-ac',
          '1',
          '-c:a',
          'libmp3lame',
          '-b:a',
          '96k',
          output,
        ]);
        clips[cue].push({
          ...publish(
            output,
            key === RAVN ? 'commander' : `commander/${key}`,
            stem,
          ),
          // Delivery tags such as [urgent] are performed, never subtitled.
          text: text.replace(/\[[^\]]*\]\s*/g, '').trim(),
        });
        console.log(`Authored ${key} ${stem}`);
      }
    }
    voices[key] = { commander: speaker.name, clips };
  }
  writeFileSync(
    resolve(root, 'lib/generated/commander-audio.json'),
    JSON.stringify({ voices }, null, 2) + '\n',
  );
} else if (command === 'music') {
  // The default pair plays off the battlefield; each map brings its own pair.
  const scores = [
    [null, brief.music],
    ...Object.entries(brief.maps ?? {}),
  ];
  const tracks = {},
    maps = {};
  for (const [map, pair] of scores) {
    const published = map ? (maps[map] = {}) : tracks;
    for (const [mood, track] of Object.entries(pair)) {
      const name = map ? `${map}-${mood}` : mood,
        input = resolve(raw, name + '.mp3'),
        output = resolve(raw, name + '-loop.mp3');
      if (!existsSync(input)) {
        const r = await request('/v1/music?output_format=mp3_44100_128', {
          prompt: track.prompt,
          music_length_ms: track.durationMs,
          force_instrumental: true,
          model_id: track.model ?? 'music_v1',
        });
        writeFileSync(input, Buffer.from(await r.arrayBuffer()));
        metadata.music[name] = {
          title: track.title,
          model: track.model ?? 'music_v1',
          songId: r.headers.get('song-id'),
        };
        save();
      }
      // Join a short tail/head overlap to remove an abrupt seam without a silent gap.
      const d = Number(probe(input).format.duration),
        overlap = 2;
      ffmpeg([
        '-i',
        input,
        '-filter_complex',
        `[0:a]asplit=3[a][b][c];[a]atrim=start=${overlap}:end=${d - overlap},asetpts=PTS-STARTPTS[body];[b]atrim=start=${d - overlap},asetpts=PTS-STARTPTS[tail];[c]atrim=end=${overlap},asetpts=PTS-STARTPTS[head];[tail][head]acrossfade=d=${overlap}:c1=tri:c2=tri[seam];[body][seam]concat=n=2:v=0:a=1,loudnorm=I=-20:TP=-3:LRA=9[out]`,
        '-map',
        '[out]',
        '-ar',
        '44100',
        '-ac',
        '2',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '128k',
        output,
      ]);
      published[mood] = {
        ...publish(output, map ? `music/${map}` : 'music', mood),
        title: track.title,
      };
      console.log('Authored ' + track.title);
    }
  }
  writeFileSync(
    resolve(root, 'lib/generated/music-audio.json'),
    JSON.stringify({ tracks, maps }, null, 2) + '\n',
  );
} else if (command === 'effects') {
  // Weapon one-shots keep their fixed /audio/combat/<family>.wav paths.
  for (const [family, effect] of Object.entries(brief.effects)) {
    const input = resolve(raw, `sfx-${family}.mp3`);
    if (!existsSync(input)) {
      const r = await request(
        '/v1/sound-generation?output_format=mp3_44100_128',
        {
          text: effect.prompt,
          duration_seconds: Math.max(1, effect.duration),
          prompt_influence: 0.6,
        },
      );
      writeFileSync(input, Buffer.from(await r.arrayBuffer()));
    }
    ffmpeg([
      '-i',
      input,
      '-af',
      `silenceremove=start_periods=1:start_duration=0.005:start_threshold=-50dB,atrim=end=${effect.duration},afade=t=out:st=${effect.duration * 0.7}:d=${effect.duration * 0.3},loudnorm=I=-16:TP=-1.5:LRA=11`,
      '-ar',
      '22050',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      resolve(root, 'public/audio/combat', family + '.wav'),
    ]);
    console.log('Authored ' + family);
  }
} else throw new Error('Choose design, voice, speech, music, or effects.');
