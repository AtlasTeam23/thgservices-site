#!/usr/bin/env node
// Records the chat widget's opening greeting once, in the Worker's own voice, as a static MP3 the site serves.
//
//   npm run eleven:greeting -- --text "Hi there! I'm the THG helper. ..."
//   node scripts/eleven-greeting.mjs --text "<greeting text>" [--out PATH] [--env-file PATH] [--wrangler-file PATH] [--base-url URL]
//
// The widget plays this file the moment a visitor opens the chat (see vite-app/src/components/concierge/voice/greeting.ts),
// so it costs nothing per visitor and never touches /tts or any cap. Run it again whenever GREETING in
// vite-app/src/components/concierge/copy.ts changes; the widget's tests fail until the recording matches the text.
//
// It reads the voice id, the model and the output format from the `vars` in wrangler.jsonc (VOICE_ELEVEN_VOICE_ID,
// VOICE_ELEVEN_MODEL, VOICE_ELEVEN_FORMAT), so the greeting is always the voice the replies use. It reads
// ELEVENLABS_API_KEY from .dev.vars (it parses the file itself and never prints the key), then calls
//   POST /v1/text-to-speech/{voice_id}?output_format=...
// with the same body the Worker sends for a spoken reply (src/elevenlabs.ts): text, model_id, the four voice settings
// and apply_text_normalization "auto". The key travels only in the `xi-api-key` header.
//
// Writes --out (default ../vite-app/public/concierge/greeting.mp3 in this repo; it must end in .mp3) and, next to it, a
// file with the same name and a .json ending: { text, voiceId, modelId, format, generatedAt }, which the tests compare
// with the widget's text and with wrangler.jsonc. Both files are written to temporary names first and only then moved
// into place, so a failure never leaves a half-written file, and the recording is replaced before its description:
// if the second move failed, the old description would no longer match the new text and the widget's test would say
// so, instead of passing with a stale recording. Exits non-zero, with a plain message, if anything is missing or the
// call fails.
//
// --env-file, --wrangler-file and --base-url exist so the script can be tested against fixture files and a local stub;
// you should not need them. --base-url is where the key is sent, so it must be https:// (or http:// for localhost or
// 127.0.0.1 only), and the script never follows a redirect.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAllowedBaseUrl, parseDevVars, ScriptError } from './eleven-voices.mjs';

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_ENV_FILE = fileURLToPath(new URL('../.dev.vars', import.meta.url));
const DEFAULT_WRANGLER_FILE = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
const DEFAULT_OUT = fileURLToPath(new URL('../../vite-app/public/concierge/greeting.mp3', import.meta.url));

/** Same ceiling as the Worker's /tts (SERVER_MAX_CHARS in the widget): a greeting is a short reply, not a speech. */
const MAX_CHARS = 1000;
const REQUEST_TIMEOUT_MS = 60_000;
/** A real greeting is tens of kilobytes; anything this small is an error body, not audio. */
const MIN_AUDIO_BYTES = 1000;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

// The same checks the Worker applies in elevenConfig() (src/env.ts), because these go into a URL and a request body.
const VOICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MODEL_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const MP3_FORMAT = /^mp3_[0-9]+_[0-9]+$/;
/** --out names an MP3 file: something before the .mp3, and nothing after it. */
const OUT_PATH = /[^/\\]\.mp3$/i;

/**
 * Voice settings, sent with every request so the voice's stored defaults cannot change how it sounds. These MUST be
 * the Worker's VOICE_SETTINGS (src/elevenlabs.ts): a test in concierge-worker/test compares the two.
 */
export const VOICE_SETTINGS = Object.freeze({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true });

/** The request body, in the key order the Worker uses. Whitespace is collapsed the way the widget does before /tts. */
export const requestBody = (text, modelId) => ({
  text: text.replace(/\s+/g, ' ').trim(),
  model_id: modelId,
  voice_settings: { ...VOICE_SETTINGS },
  apply_text_normalization: 'auto',
});

/** Parses JSONC: removes // and /* *\/ comments outside strings, and trailing commas. */
export const parseJsonc = (text) => {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
};

/**
 * The voice id, model and format from wrangler.jsonc's vars. Throws a ScriptError with a plain message if the file
 * cannot be read or parsed, or a value is missing or not one the Worker would accept.
 */
export const readVoiceVars = async (wranglerFile, readFileImpl = readFile) => {
  let text;
  try {
    text = await readFileImpl(wranglerFile, 'utf8');
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? 'file not found' : (error?.message ?? 'unknown error');
    throw new ScriptError(`Could not read ${wranglerFile} (${reason}).`);
  }
  let vars;
  try {
    vars = parseJsonc(text).vars;
  } catch {
    throw new ScriptError(`${wranglerFile} is not valid JSON with comments.`);
  }
  const read = (name, pattern, hint) => {
    const value = typeof vars?.[name] === 'string' ? vars[name].trim() : '';
    if (!pattern.test(value)) throw new ScriptError(`${name} in ${wranglerFile} is ${value === '' ? 'empty' : 'not usable'}. ${hint}`);
    return value;
  };
  return {
    voiceId: read('VOICE_ELEVEN_VOICE_ID', VOICE_ID, 'Pick a voice with `npm run eleven:voices` and put its voice_id there.'),
    modelId: read('VOICE_ELEVEN_MODEL', MODEL_ID, 'It should be an ElevenLabs model name such as eleven_flash_v2_5.'),
    format: read('VOICE_ELEVEN_FORMAT', MP3_FORMAT, 'It should be an MP3 format such as mp3_22050_32.'),
  };
};

const STATUS_MESSAGES = {
  401: 'ElevenLabs rejected the key (HTTP 401). Check the ELEVENLABS_API_KEY line in your .dev.vars.',
  429: 'ElevenLabs answered HTTP 429 (too many requests). Wait a minute and try again.',
};

/** MP3 data starts with an ID3 tag or with a frame sync (11 set bits). */
const looksLikeMp3 = (bytes) =>
  bytes.length >= 3 && ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));

/**
 * Asks ElevenLabs to speak `text`. Returns the MP3 as a Buffer. Throws a ScriptError with a plain message for a network
 * failure, any status but 200, or an answer that is not audio. Nothing the server said is ever echoed.
 */
export const synthesize = async (apiKey, { text, voiceId, modelId, format }, { fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL } = {}) => {
  const url = new URL(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, baseUrl);
  url.searchParams.set('output_format', format);

  let response;
  try {
    // redirect: 'error' because the key is in a header: a redirect must never carry it somewhere else.
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(requestBody(text, modelId)),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'it took too long' : (error?.cause?.code ?? error?.message ?? 'unknown error');
    throw new ScriptError(`Could not reach ElevenLabs (${reason}). Check your connection and try again.`);
  }
  if (response.status !== 200) {
    await response.body?.cancel?.(); // never read or print what the server said
    throw new ScriptError(STATUS_MESSAGES[response.status] ?? `ElevenLabs answered HTTP ${response.status}. Try again later.`);
  }

  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new ScriptError('Could not read the audio ElevenLabs sent. Try again.');
  }
  if (bytes.length < MIN_AUDIO_BYTES || bytes.length > MAX_AUDIO_BYTES || !looksLikeMp3(bytes)) {
    throw new ScriptError('ElevenLabs answered with something that is not an MP3 recording.');
  }
  return bytes;
};

/** The sidecar goes next to the MP3, with the same name and a .json ending. */
export const sidecarPath = (mp3Path) => join(dirname(mp3Path), `${basename(mp3Path, extname(mp3Path))}.json`);

const USAGE = `Usage: npm run eleven:greeting -- --text "<greeting text>" [--out PATH]

Records the chat widget's opening greeting with the voice set in wrangler.jsonc (VOICE_ELEVEN_VOICE_ID,
VOICE_ELEVEN_MODEL, VOICE_ELEVEN_FORMAT), using ELEVENLABS_API_KEY from .dev.vars, and writes an MP3 plus a small
.json file next to it that says what was recorded.

  --text   the exact text of GREETING in vite-app/src/components/concierge/copy.ts (required, at most ${MAX_CHARS} characters)
  --out    where to write the MP3, a path ending in .mp3 (default: vite-app/public/concierge/greeting.mp3 in this repo)
`;

const parseArgs = (argv) => {
  const options = { envFile: DEFAULT_ENV_FILE, wranglerFile: DEFAULT_WRANGLER_FILE, baseUrl: DEFAULT_BASE_URL, out: DEFAULT_OUT, text: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (['--text', '--out', '--env-file', '--wrangler-file', '--base-url'].includes(flag)) {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') return { error: `Option ${flag} needs a value.` };
      if (flag === '--text') options.text = value;
      else if (flag === '--out') {
        if (!OUT_PATH.test(value)) return { error: '--out must be a file name ending in .mp3: the widget plays it as an MP3.' };
        options.out = resolve(value);
      }
      else if (flag === '--env-file') options.envFile = value;
      else if (flag === '--wrangler-file') options.wranglerFile = value;
      else if (isAllowedBaseUrl(value)) options.baseUrl = value;
      else return { error: '--base-url must be an https:// URL (or http://localhost or http://127.0.0.1 for a local stub), with no username or password in it.' };
    } else return { error: `Unknown option: ${arg}. Try --help.` };
  }
  return options;
};

/**
 * The whole command, with its inputs and outputs injected so a test can drive it. Returns the exit code:
 * 0 on success, 1 for a problem the person can fix (message on stderr), 2 for a bad option. Anything it prints
 * has the key scrubbed out first, as a last line of defence.
 */
export const run = async ({
  argv = [],
  stdout = process.stdout,
  stderr = process.stderr,
  fetchImpl = fetch,
  readFileImpl = readFile,
  fsImpl = { mkdir, writeFile, rename, rm },
  now = () => new Date(),
} = {}) => {
  const options = parseArgs(argv);
  if (options.error) {
    stderr.write(`${options.error}\n`);
    return 2;
  }
  if (options.help) {
    stdout.write(USAGE);
    return 0;
  }
  if (options.text === null || options.text.trim() === '') {
    stderr.write('--text is required: the exact text of GREETING in vite-app/src/components/concierge/copy.ts. Try --help.\n');
    return 2;
  }
  if (options.text.replace(/\s+/g, ' ').trim().length > MAX_CHARS) {
    stderr.write(`--text is longer than ${MAX_CHARS} characters, which is more than a greeting should be.\n`);
    return 2;
  }

  let voice;
  try {
    voice = await readVoiceVars(options.wranglerFile, readFileImpl);
  } catch (error) {
    stderr.write(`${error instanceof ScriptError ? error.message : `Unexpected error: ${error?.message ?? error}`}\n`);
    return 1;
  }

  let envText;
  try {
    envText = await readFileImpl(options.envFile, 'utf8');
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? 'file not found' : (error?.message ?? 'unknown error');
    stderr.write(
      `Could not read ${options.envFile} (${reason}).\n` +
        'Create it with `cp .dev.vars.example .dev.vars`, then add a line: ELEVENLABS_API_KEY=your-key\n',
    );
    return 1;
  }
  const key = (parseDevVars(envText).ELEVENLABS_API_KEY ?? '').trim();
  if (key === '') {
    stderr.write(`ELEVENLABS_API_KEY is not set in ${options.envFile}.\nAdd a line: ELEVENLABS_API_KEY=your-key (see .dev.vars.example), then run this again.\n`);
    return 1;
  }
  const scrub = (message) => message.split(key).join('[key]');

  let audio;
  try {
    audio = await synthesize(key, { text: options.text, ...voice }, { fetchImpl, baseUrl: options.baseUrl });
  } catch (error) {
    stderr.write(`${scrub(error instanceof ScriptError ? error.message : `Unexpected error: ${error?.message ?? error}`)}\n`);
    return 1;
  }

  const jsonPath = sidecarPath(options.out);
  const sidecar = {
    text: options.text,
    voiceId: voice.voiceId,
    modelId: voice.modelId,
    format: voice.format,
    generatedAt: now().toISOString(),
  };
  const partialAudio = `${options.out}.partial`;
  const partialJson = `${jsonPath}.partial`;
  let replaced = false;
  try {
    await fsImpl.mkdir(dirname(options.out), { recursive: true });
    // Both files are written under temporary names before either is put in place.
    await fsImpl.writeFile(partialAudio, audio);
    await fsImpl.writeFile(partialJson, `${JSON.stringify(sidecar, null, 2)}\n`);
    await fsImpl.rename(partialAudio, options.out);
    replaced = true;
    await fsImpl.rename(partialJson, jsonPath);
  } catch (error) {
    // Whatever went wrong, no temporary file is left behind (and a failure to clean up is not worth a message).
    await Promise.allSettled([fsImpl.rm(partialAudio, { force: true }), fsImpl.rm(partialJson, { force: true })]);
    const reason = error?.code ?? error?.message ?? 'unknown error';
    stderr.write(
      scrub(
        replaced
          ? `Could not finish writing ${jsonPath} (${reason}). ${options.out} was already replaced, so the two no longer match: run this again.\n`
          : `Could not write ${options.out} (${reason}). Nothing was changed.\n`,
      ),
    );
    return 1;
  }

  stdout.write(
    scrub(
      `Wrote ${options.out} (${(audio.length / 1024).toFixed(1)} KB) and ${jsonPath}.\n` +
        `Voice ${voice.voiceId}, model ${voice.modelId}, format ${voice.format}. Commit both files.\n`,
    ),
  );
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
