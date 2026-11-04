#!/usr/bin/env node
// Lists the ElevenLabs premade voices you can pick from, so you can choose one for VOICE_ELEVEN_VOICE_ID.
//
//   npm run eleven:voices                 a table to read
//   npm run --silent eleven:voices -- --json > voices.json    the same list as JSON, for a listening page
//   node scripts/eleven-voices.mjs [--json] [--env-file PATH] [--base-url URL]
//
// It reads ELEVENLABS_API_KEY from .dev.vars (it parses the file itself and never prints the key), calls
// GET /v2/voices?category=premade&page_size=100 (following pages if there are more), and lists every voice
// sorted by name. For each one: name, voice_id, the labels (gender, accent, age, use case, description) and
// preview_url, a public sample MP3 ElevenLabs hosts for the voice, so you can choose by listening rather than
// by name. Voice ids are not published anywhere else: this is where they come from.
//
// --json writes a JSON array to stdout and nothing else, [{voice_id, name, labels, preview_url}], with the
// labels exactly as ElevenLabs sent them and preview_url null when a voice has none (or when it is not an
// https URL, since the list is meant to feed a web page). Errors always go to stderr, so a redirect never
// captures half an answer. Exits non-zero, with a plain message, if the key is missing or the call fails.
//
// --env-file and --base-url exist so the script can be tested against a fixture file and a local stub; you
// should not need them. --base-url is where the key is sent, so it must be https:// (or http:// for localhost or
// 127.0.0.1 only), and the script never follows a redirect.
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_ENV_FILE = fileURLToPath(new URL('../.dev.vars', import.meta.url));
const MAX_PAGES = 20;

/** An expected failure: its message is meant for the person running the script, and is safe to print. */
export class ScriptError extends Error {
  name = 'ScriptError';
}

/**
 * Reads a dotenv-style file: KEY=VALUE per line, `#` comments, an optional `export ` prefix, matching quotes
 * around a value removed, a trailing ` # comment` dropped from an unquoted value. A later line wins.
 */
export const parseDevVars = (text) => {
  const vars = {};
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const name = line.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(equals + 1).trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    vars[name] = value;
  }
  return vars;
};

const STATUS_MESSAGES = {
  401: 'ElevenLabs rejected the key (HTTP 401). Check the ELEVENLABS_API_KEY line in your .dev.vars.',
  429: 'ElevenLabs answered HTTP 429 (too many requests). Wait a minute and try again.',
};

/**
 * Every premade voice, following `next_page_token` while `has_more` is true. Throws a ScriptError with a plain
 * message for a network failure, any status but 200, an answer that is not a voice list, or a runaway listing.
 * The key travels only in the `xi-api-key` header.
 */
export const fetchPremadeVoices = async (apiKey, { fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL } = {}) => {
  const voices = [];
  let token = null;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const url = new URL('/v2/voices', baseUrl);
    url.searchParams.set('category', 'premade');
    url.searchParams.set('page_size', '100');
    if (token !== null) url.searchParams.set('next_page_token', token);

    let response;
    try {
      // redirect: 'error' because the key is in a header: a redirect must never carry it somewhere else.
      response = await fetchImpl(url, { headers: { 'xi-api-key': apiKey, Accept: 'application/json' }, redirect: 'error' });
    } catch (error) {
      const reason = error?.cause?.code ?? error?.message ?? 'unknown error';
      throw new ScriptError(`Could not reach ElevenLabs (${reason}). Check your connection and try again.`);
    }
    if (response.status !== 200) {
      await response.body?.cancel?.(); // never read or print what the server said
      throw new ScriptError(STATUS_MESSAGES[response.status] ?? `ElevenLabs answered HTTP ${response.status}. Try again later.`);
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      // handled below
    }
    if (data === null || typeof data !== 'object' || !Array.isArray(data.voices)) {
      throw new ScriptError('ElevenLabs answered with something that is not a voice list.');
    }
    voices.push(...data.voices);
    if (data.has_more === true && typeof data.next_page_token === 'string' && data.next_page_token !== '') {
      token = data.next_page_token;
    } else {
      return voices;
    }
  }
  throw new ScriptError(`ElevenLabs kept returning more pages (stopped after ${MAX_PAGES}): too many pages.`);
};

/** A preview link only if it is an https URL: the list ends up in a page, where other schemes are a hazard. */
const safePreviewUrl = (value) => {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
};

/**
 * One voice reduced to what a person (or a listening page) needs, in a fixed key order: its id, name, labels
 * exactly as ElevenLabs sent them ({} if it sent none) and preview_url (null if it sent none, or not an https
 * URL). Everything else in the API's answer is dropped.
 */
export const normalizeVoice = (voice) => ({
  voice_id: typeof voice?.voice_id === 'string' ? voice.voice_id : '',
  name: typeof voice?.name === 'string' ? voice.name : '',
  labels: voice?.labels !== null && typeof voice?.labels === 'object' && !Array.isArray(voice.labels) ? { ...voice.labels } : {},
  preview_url: safePreviewUrl(voice?.preview_url),
});

/** Normalized voices, sorted by name (case does not matter), then by id. */
const sortedVoices = (voices) =>
  voices
    .map(normalizeVoice)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.voice_id.localeCompare(b.voice_id));

const cell = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : typeof value === 'number' ? String(value) : '-');

// ElevenLabs' own label for this is `descriptive` (calm, confident, ...); `description` is accepted first if a voice has it.
const describe = (labels) => (cell(labels.description) !== '-' ? labels.description : labels.descriptive);

const COLUMNS = [
  ['NAME', (voice) => voice.name],
  ['VOICE_ID', (voice) => voice.voice_id],
  ['GENDER', (voice) => voice.labels.gender],
  ['ACCENT', (voice) => voice.labels.accent],
  ['AGE', (voice) => voice.labels.age],
  ['USE CASE', (voice) => voice.labels.use_case],
  ['DESCRIPTION', (voice) => describe(voice.labels)],
  ['PREVIEW_URL', (voice) => voice.preview_url],
];

/** A plain-text table, one voice per line, sorted by name, columns lined up, the preview link last. */
export const renderTable = (voices) => {
  const rows = [COLUMNS.map(([title]) => title), ...sortedVoices(voices).map((voice) => COLUMNS.map(([, read]) => cell(read(voice))))];
  const widths = COLUMNS.map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows.map((row) => row.map((text, column) => text.padEnd(widths[column])).join('  ').trimEnd()).join('\n');
};

/** The same list as an array of {voice_id, name, labels, preview_url}, for --json. */
export const voiceList = (voices) => sortedVoices(voices);

/** A copy of any JSON-shaped value with `secret` removed from every string in it. */
const scrubDeep = (value, secret) => {
  if (typeof value === 'string') return value.split(secret).join('[key]');
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, secret));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, secret)]));
  return value;
};

const USAGE = `Usage: npm run eleven:voices [-- --json]

Lists the ElevenLabs premade voices using ELEVENLABS_API_KEY from .dev.vars: name, voice_id, labels (gender,
accent, age, use case, description) and a preview_url, a sample MP3 you can open in a browser to hear the voice.
Copy the voice_id you want into VOICE_ELEVEN_VOICE_ID in wrangler.jsonc.

  --json   write a JSON array [{voice_id, name, labels, preview_url}] to stdout instead of the table
           (use \`npm run --silent eleven:voices -- --json > voices.json\` to keep npm's banner out of the file)
`;

/**
 * --base-url is where the key is sent, so it is restricted: any https:// URL, or plain http:// only for a stub on
 * this machine (localhost or 127.0.0.1). No credentials in the URL. Real use never needs the flag at all.
 */
const isAllowedBaseUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'https:') return url.hostname !== '';
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
};

const parseArgs = (argv) => {
  const options = { envFile: DEFAULT_ENV_FILE, baseUrl: DEFAULT_BASE_URL, help: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--json') options.json = true;
    else if (flag === '--env-file' || flag === '--base-url') {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '') return { error: `Option ${flag} needs a value.` };
      if (flag === '--env-file') options.envFile = value;
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
export const run = async ({ argv = [], stdout = process.stdout, stderr = process.stderr, fetchImpl = fetch, readFileImpl = readFile } = {}) => {
  const options = parseArgs(argv);
  if (options.error) {
    stderr.write(`${options.error}\n`);
    return 2;
  }
  if (options.help) {
    stdout.write(USAGE);
    return 0;
  }

  let text;
  try {
    text = await readFileImpl(options.envFile, 'utf8');
  } catch (error) {
    const reason = error?.code === 'ENOENT' ? 'file not found' : (error?.message ?? 'unknown error');
    stderr.write(
      `Could not read ${options.envFile} (${reason}).\n` +
        'Create it with `cp .dev.vars.example .dev.vars`, then add a line: ELEVENLABS_API_KEY=your-key\n',
    );
    return 1;
  }

  const key = (parseDevVars(text).ELEVENLABS_API_KEY ?? '').trim();
  if (key === '') {
    stderr.write(`ELEVENLABS_API_KEY is not set in ${options.envFile}.\nAdd a line: ELEVENLABS_API_KEY=your-key (see .dev.vars.example), then run this again.\n`);
    return 1;
  }
  const scrub = (message) => message.split(key).join('[key]');

  let voices;
  try {
    voices = await fetchPremadeVoices(key, { fetchImpl, baseUrl: options.baseUrl });
  } catch (error) {
    stderr.write(`${scrub(error instanceof ScriptError ? error.message : `Unexpected error: ${error?.message ?? error}`)}\n`);
    return 1;
  }
  if (voices.length === 0) {
    stderr.write('No premade voices came back. Nothing to choose from.\n');
    return 1;
  }

  if (options.json) {
    stdout.write(`${JSON.stringify(scrubDeep(voiceList(voices), key), null, 2)}\n`);
    return 0;
  }
  stdout.write(
    scrub(
      `${renderTable(voices)}\n\n${voices.length} premade voices. Open a preview_url in a browser to hear a voice. ` +
        'Put the voice_id you want in VOICE_ELEVEN_VOICE_ID in wrangler.jsonc, set VOICE_TTS to "elevenlabs", and store the key with:\n' +
        '  npx wrangler secret put ELEVENLABS_API_KEY\n',
    ),
  );
  return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run({ argv: process.argv.slice(2) });
}
