// Run with: npm run test:probe
// Checks scripts/eleven-greeting.mjs without a real key or the real .dev.vars: both config files are fixtures in a
// temp folder, ElevenLabs is a stub (a function for the unit tests, a local HTTP server for the end-to-end ones),
// and every output goes to the temp folder. The real API is never called here.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseJsonc, readVoiceVars, requestBody, run, sidecarPath, synthesize, VOICE_SETTINGS } from './eleven-greeting.mjs';

const SCRIPT = fileURLToPath(new URL('./eleven-greeting.mjs', import.meta.url));
const REAL_WRANGLER = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
const KEY = 'sk_placeholder_not_a_real_key_0123456789';
const VOICE = '21m00Tcm4TlvDq8ikWAM';
const GREETING = "Hi there! I'm the THG helper.   What can I help with?";

const WRANGLER = `{
  // comments and trailing commas are normal in wrangler.jsonc
  "name": "fixture",
  "vars": {
    "VOICE_ELEVEN_VOICE_ID": "${VOICE}", // a premade voice
    "VOICE_ELEVEN_MODEL": "eleven_flash_v2_5",
    "VOICE_ELEVEN_FORMAT": "mp3_22050_32",
  },
}
`;

/** Looks like an MP3 to the script (an ID3 tag, then padding) and is long enough to be a recording. */
const mp3 = (size = 2400) => {
  const bytes = Buffer.alloc(size, 0x55);
  bytes.write('ID3', 0, 'latin1');
  return bytes;
};
const audio = (bytes = mp3(), status = 200) => new Response(bytes, { status, headers: { 'content-type': 'audio/mpeg' } });

let dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eleven-greeting-test-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

let counter = 0;
const fresh = () => join(dir, `case-${(counter += 1)}`);
const fixture = async (name, text) => {
  const path = join(dir, `${Math.random().toString(36).slice(2)}-${name}`);
  await writeFile(path, text);
  return path;
};
const exists = (path) => access(path).then(() => true, () => false);

/** Runs the script's main function with captured output; files go to a new folder inside the temp one. */
const runScript = async ({ envText = `ELEVENLABS_API_KEY=${KEY}\n`, wranglerText = WRANGLER, fetchImpl, args = ['--text', GREETING], now, fsImpl, out = join(fresh(), 'greeting.mp3') } = {}) => {
  const envFile = await fixture('.dev.vars', envText);
  const wranglerFile = await fixture('wrangler.jsonc', wranglerText);
  let stdout = '';
  let stderr = '';
  const code = await run({
    argv: ['--env-file', envFile, '--wrangler-file', wranglerFile, '--out', out, ...args],
    stdout: { write: (text) => (stdout += text) },
    stderr: { write: (text) => (stderr += text) },
    fetchImpl,
    now,
    ...(fsImpl ? { fsImpl } : {}),
  });
  return { code, stdout, stderr, out, envFile, wranglerFile };
};

describe('parseJsonc', () => {
  test('removes comments outside strings and trailing commas, and keeps // inside strings', () => {
    assert.deepEqual(parseJsonc('{ // note\n "a": "x//y", /* c */ "b": [1, 2,], }'), { a: 'x//y', b: [1, 2] });
  });

  test('reads the real wrangler.jsonc', async () => {
    const config = parseJsonc(await readFile(REAL_WRANGLER, 'utf8'));
    assert.equal(config.name, 'thg-concierge');
    assert.match(config.vars.VOICE_ELEVEN_VOICE_ID, /^[A-Za-z0-9]{20}$/);
  });
});

describe('readVoiceVars', () => {
  test('returns the voice id, model and format from the vars', async () => {
    const file = await fixture('wrangler.jsonc', WRANGLER);
    assert.deepEqual(await readVoiceVars(file), { voiceId: VOICE, modelId: 'eleven_flash_v2_5', format: 'mp3_22050_32' });
  });

  test('works on the real wrangler.jsonc: whatever voice the Worker speaks with is what it returns', async () => {
    const vars = parseJsonc(await readFile(REAL_WRANGLER, 'utf8')).vars;
    assert.deepEqual(await readVoiceVars(REAL_WRANGLER), {
      voiceId: vars.VOICE_ELEVEN_VOICE_ID,
      modelId: vars.VOICE_ELEVEN_MODEL,
      format: vars.VOICE_ELEVEN_FORMAT,
    });
  });

  for (const [label, name, value, expected] of [
    ['an empty voice id', 'VOICE_ELEVEN_VOICE_ID', '', /VOICE_ELEVEN_VOICE_ID.*empty/],
    ['a voice id with a slash in it', 'VOICE_ELEVEN_VOICE_ID', 'abc/../../x', /VOICE_ELEVEN_VOICE_ID.*not usable/],
    ['an empty model', 'VOICE_ELEVEN_MODEL', ' ', /VOICE_ELEVEN_MODEL.*empty/],
    ['a model with a space in it', 'VOICE_ELEVEN_MODEL', 'eleven flash', /VOICE_ELEVEN_MODEL.*not usable/],
    ['a format that is not an MP3', 'VOICE_ELEVEN_FORMAT', 'pcm_16000', /VOICE_ELEVEN_FORMAT.*not usable/],
    ['a format with a query string in it', 'VOICE_ELEVEN_FORMAT', 'mp3_22050_32&x=1', /VOICE_ELEVEN_FORMAT.*not usable/],
  ]) {
    test(`refuses ${label}`, async () => {
      const text = WRANGLER.replace(new RegExp(`("${name}": ")[^"]*(")`), `$1${value}$2`);
      await assert.rejects(readVoiceVars(await fixture('wrangler.jsonc', text)), expected);
    });
  }

  test('refuses a file that is missing, is not JSON, or has no vars', async () => {
    await assert.rejects(readVoiceVars(join(dir, 'no-such-file')), /could not read/i);
    await assert.rejects(readVoiceVars(await fixture('wrangler.jsonc', '{ nope')), /not valid JSON/);
    await assert.rejects(readVoiceVars(await fixture('wrangler.jsonc', '{ "name": "x" }')), /VOICE_ELEVEN_VOICE_ID.*empty/);
  });
});

describe('requestBody', () => {
  test('is what the Worker sends: text, model_id, the four voice settings, apply_text_normalization auto, in that order', () => {
    const body = requestBody(GREETING, 'eleven_flash_v2_5');
    assert.deepEqual(Object.keys(body), ['text', 'model_id', 'voice_settings', 'apply_text_normalization']);
    assert.deepEqual(body, {
      text: "Hi there! I'm the THG helper. What can I help with?", // whitespace collapsed, as the widget does before /tts
      model_id: 'eleven_flash_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true },
      apply_text_normalization: 'auto',
    });
  });

  test('exports the voice settings, frozen, and sends a copy of them', () => {
    assert.deepEqual(VOICE_SETTINGS, { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true });
    assert.ok(Object.isFrozen(VOICE_SETTINGS));
    assert.notEqual(requestBody('x', 'm').voice_settings, VOICE_SETTINGS);
  });
});

describe('synthesize', () => {
  const args = { text: GREETING, voiceId: VOICE, modelId: 'eleven_flash_v2_5', format: 'mp3_22050_32' };

  test('POSTs to the non-streaming endpoint with the key in xi-api-key, never in the URL, and refuses redirects', async () => {
    const seen = [];
    const bytes = await synthesize(KEY, args, {
      fetchImpl: async (url, init) => {
        seen.push({ url: new URL(String(url)), init, headers: new Headers(init?.headers) });
        return audio();
      },
    });
    assert.equal(bytes.length, 2400);
    assert.equal(seen.length, 1);
    const { url, init, headers } = seen[0];
    assert.equal(url.origin + url.pathname, `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`);
    assert.equal(url.searchParams.get('output_format'), 'mp3_22050_32');
    assert.equal(init.method, 'POST');
    assert.equal(headers.get('xi-api-key'), KEY);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.ok(!String(url).includes(KEY), 'the key goes in a header, never in the URL');
    assert.equal(init.redirect, 'error', 'a redirect must be an error: the key would travel with it');
    assert.deepEqual(JSON.parse(init.body), requestBody(GREETING, 'eleven_flash_v2_5'));
  });

  test('escapes the voice id in the path', async () => {
    let seenUrl;
    await synthesize(KEY, { ...args, voiceId: 'a/b c' }, { fetchImpl: async (url) => ((seenUrl = String(url)), audio()) });
    assert.match(seenUrl, /\/v1\/text-to-speech\/a%2Fb%20c\?/);
  });

  test('accepts an MP3 that starts with a frame sync instead of an ID3 tag', async () => {
    const bytes = mp3();
    bytes[0] = 0xff;
    bytes[1] = 0xf3;
    assert.equal((await synthesize(KEY, args, { fetchImpl: async () => audio(bytes) })).length, bytes.length);
  });

  for (const [status, expected] of [
    [401, /rejected the key/i],
    [422, /HTTP 422/],
    [429, /HTTP 429/],
    [500, /HTTP 500/],
  ]) {
    test(`fails for HTTP ${status} in plain words and echoes nothing the server sent`, async () => {
      await assert.rejects(
        synthesize(KEY, args, { fetchImpl: async () => new Response(JSON.stringify({ detail: `server text ${KEY}` }), { status }) }),
        (error) => expected.test(error.message) && !error.message.includes('server text') && !error.message.includes(KEY),
      );
    });
  }

  for (const [label, response] of [
    ['an empty body', () => audio(Buffer.alloc(0))],
    ['a body too small to be a recording', () => audio(mp3(200))],
    ['JSON where audio should be', () => audio(Buffer.from(`{"detail":"${'x'.repeat(2000)}"}`))],
    ['an enormous body', () => audio(mp3(6 * 1024 * 1024))],
  ]) {
    test(`fails when the answer is ${label}`, async () => {
      await assert.rejects(synthesize(KEY, args, { fetchImpl: async () => response() }), /not an MP3/);
    });
  }

  test('fails with a plain message when the call cannot be made', async () => {
    await assert.rejects(
      synthesize(KEY, args, {
        fetchImpl: async () => {
          throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
        },
      }),
      /could not reach elevenlabs \(ENOTFOUND\)/i,
    );
  });
});

describe('sidecarPath', () => {
  test('is the same name with a .json ending, in the same folder', () => {
    assert.equal(sidecarPath('/a/b/greeting.mp3'), join('/a/b', 'greeting.json'));
    assert.equal(sidecarPath('/a/b/hello.v2.mp3'), join('/a/b', 'hello.v2.json'));
  });
});

describe('run', () => {
  test('writes the MP3 and the sidecar, prints where, and exits 0', async () => {
    const bytes = mp3(5000);
    const { code, stdout, stderr, out } = await runScript({
      fetchImpl: async () => audio(bytes),
      now: () => new Date('2026-11-04T15:00:00.000Z'),
    });
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
    assert.deepEqual(await readFile(out), bytes);
    const sidecar = JSON.parse(await readFile(sidecarPath(out), 'utf8'));
    assert.deepEqual(Object.keys(sidecar), ['text', 'voiceId', 'modelId', 'format', 'generatedAt']);
    assert.deepEqual(sidecar, {
      text: GREETING, // exactly as given, so a test can compare it with the widget's text
      voiceId: VOICE,
      modelId: 'eleven_flash_v2_5',
      format: 'mp3_22050_32',
      generatedAt: '2026-11-04T15:00:00.000Z',
    });
    assert.match(stdout, /Wrote .*greeting\.mp3 \(4\.9 KB\)/);
    assert.match(stdout, new RegExp(VOICE));
    assert.deepEqual((await readdir(join(out, '..'))).sort(), ['greeting.json', 'greeting.mp3'], 'no partial file is left behind');
  });

  test('uses the voice, model and format from wrangler.jsonc in the request', async () => {
    const wranglerText = WRANGLER.replace('mp3_22050_32', 'mp3_44100_64').replace('eleven_flash_v2_5', 'eleven_multilingual_v2');
    let seen;
    const { code, out } = await runScript({
      wranglerText,
      fetchImpl: async (url, init) => ((seen = { url: new URL(String(url)), body: JSON.parse(init.body) }), audio()),
    });
    assert.equal(code, 0);
    assert.equal(seen.url.searchParams.get('output_format'), 'mp3_44100_64');
    assert.equal(seen.body.model_id, 'eleven_multilingual_v2');
    assert.equal(JSON.parse(await readFile(sidecarPath(out), 'utf8')).format, 'mp3_44100_64');
  });

  test('creates the folder it writes into, and names the sidecar after the MP3', async () => {
    const out = join(fresh(), 'deeper', 'still', 'hello.mp3');
    const envFile = await fixture('.dev.vars', `ELEVENLABS_API_KEY=${KEY}\n`);
    const wranglerFile = await fixture('wrangler.jsonc', WRANGLER);
    const code = await run({
      argv: ['--env-file', envFile, '--wrangler-file', wranglerFile, '--out', out, '--text=Hello there.'],
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      fetchImpl: async () => audio(),
    });
    assert.equal(code, 0);
    assert.ok(await exists(out));
    assert.equal(JSON.parse(await readFile(join(out, '..', 'hello.json'), 'utf8')).text, 'Hello there.');
  });

  test('--text is required, and not blank, and not longer than a greeting should be: exit 2, nothing called', async () => {
    for (const args of [[], ['--text', '   '], ['--text', 'x'.repeat(1001)]]) {
      const { code, stderr, out } = await runScript({ args, fetchImpl: async () => assert.fail('must not call the API') });
      assert.equal(code, 2);
      assert.match(stderr, /--text/);
      assert.equal(await exists(out), false);
    }
  });

  test('exits 1 and writes nothing when the key file has no key', async () => {
    for (const envText of ['LLM_PROVIDER=mock\n', 'ELEVENLABS_API_KEY=\n', 'ELEVENLABS_API_KEY=   \n', '# ELEVENLABS_API_KEY=abc\n']) {
      const { code, stderr, out } = await runScript({ envText, fetchImpl: async () => assert.fail('must not call the API') });
      assert.equal(code, 1);
      assert.match(stderr, /ELEVENLABS_API_KEY is not set/);
      assert.equal(await exists(out), false);
    }
  });

  test('exits 1 with a plain message when the key file does not exist', async () => {
    let stderr = '';
    const code = await run({
      argv: ['--text', GREETING, '--env-file', join(dir, 'no-such-file'), '--wrangler-file', REAL_WRANGLER, '--out', join(fresh(), 'g.mp3')],
      stdout: { write: () => {} },
      stderr: { write: (text) => (stderr += text) },
      fetchImpl: async () => assert.fail('must not call the API'),
    });
    assert.equal(code, 1);
    assert.match(stderr, /could not read/i);
    assert.match(stderr, /\.dev\.vars|no-such-file/);
  });

  test('exits 1 before asking for the key when wrangler.jsonc is unusable', async () => {
    for (const wranglerText of ['{ nope', '{ "vars": {} }']) {
      const { code, stderr } = await runScript({ wranglerText, fetchImpl: async () => assert.fail('must not call the API') });
      assert.equal(code, 1);
      assert.match(stderr, /wrangler|VOICE_ELEVEN/);
    }
  });

  for (const [status, expected] of [
    [401, /rejected the key/i],
    [429, /HTTP 429/],
    [500, /HTTP 500/],
  ]) {
    test(`exits 1 for HTTP ${status} and leaves no files`, async () => {
      const { code, stdout, stderr, out } = await runScript({ fetchImpl: async () => new Response('{"detail":"no"}', { status }) });
      assert.equal(code, 1);
      assert.equal(stdout, '');
      assert.match(stderr, expected);
      assert.equal(await exists(out), false);
      assert.equal(await exists(sidecarPath(out)), false);
    });
  }

  test('does not touch an existing recording when the new one fails', async () => {
    const out = join(fresh(), 'greeting.mp3');
    const envFile = await fixture('.dev.vars', `ELEVENLABS_API_KEY=${KEY}\n`);
    const wranglerFile = await fixture('wrangler.jsonc', WRANGLER);
    const argv = ['--text', GREETING, '--env-file', envFile, '--wrangler-file', wranglerFile, '--out', out];
    const quiet = { write: () => {} };
    assert.equal(await run({ argv, stdout: quiet, stderr: quiet, fetchImpl: async () => audio(mp3(3000)) }), 0);
    const before = await readFile(out);
    assert.equal(await run({ argv, stdout: quiet, stderr: quiet, fetchImpl: async () => new Response('{}', { status: 500 }) }), 1);
    assert.deepEqual(await readFile(out), before);
  });

  test('never prints the key on any path', async () => {
    const results = await Promise.all([
      runScript({ fetchImpl: async () => audio() }),
      runScript({ fetchImpl: async () => new Response(`{"detail":"${KEY}"}`, { status: 401 }) }),
      runScript({
        fetchImpl: async () => {
          throw new Error(`boom ${KEY}`);
        },
      }),
      runScript({ args: ['--text', `Say ${KEY}`], fetchImpl: async () => audio() }),
    ]);
    for (const { stdout, stderr } of results) {
      assert.ok(!stdout.includes(KEY), stdout);
      assert.ok(!stderr.includes(KEY), stderr);
    }
  });

  test('--help prints usage and exits 0 without reading anything', async () => {
    const { code, stdout } = await runScript({ args: ['--help'], fetchImpl: async () => assert.fail('no call') });
    assert.equal(code, 0);
    assert.match(stdout, /eleven:greeting/);
    assert.match(stdout, /--text/);
  });

  test('rejects an option it does not know, or one with no value: exit 2', async () => {
    for (const args of [['--wat'], ['--text'], ['--text', GREETING, '--out']]) {
      const { code, stderr } = await runScript({ args, fetchImpl: async () => assert.fail('no call') });
      assert.equal(code, 2);
      assert.ok(stderr.length > 0);
    }
  });

  describe('--base-url', () => {
    for (const baseUrl of ['https://api.elevenlabs.io', 'https://api.us.elevenlabs.io', 'http://localhost:8787', 'http://127.0.0.1:4173']) {
      test(`accepts ${baseUrl}`, async () => {
        const { code } = await runScript({ args: ['--text', GREETING, '--base-url', baseUrl], fetchImpl: async () => audio() });
        assert.equal(code, 0);
      });
    }

    for (const baseUrl of ['http://example.com', 'http://localhost@evil.example', 'https://user:pass@api.elevenlabs.io', 'ftp://example.com', 'not a url']) {
      test(`refuses ${baseUrl} with exit 2 before anything is called`, async () => {
        const { code, stderr } = await runScript({ args: ['--text', GREETING, '--base-url', baseUrl], fetchImpl: async () => assert.fail('must not call the API') });
        assert.equal(code, 2);
        assert.match(stderr, /--base-url/);
        assert.ok(!stderr.includes(KEY));
      });
    }
  });
});

describe('--out', () => {
  for (const [label, value] of [
    ['a .wav file', 'greeting.wav'],
    ['no extension', 'greeting'],
    ['something after .mp3', 'greeting.mp3.bak'],
    ['nothing before .mp3', '.mp3'],
    ['a folder', 'somewhere/'],
  ]) {
    test(`refuses ${label}: exit 2, nothing called, nothing written`, async () => {
      const target = join(dir, 'refused', value);
      const { code, stderr } = await runScript({ args: ['--text', GREETING, '--out', target], fetchImpl: async () => assert.fail('must not call the API') });
      assert.equal(code, 2);
      assert.match(stderr, /--out/);
      assert.match(stderr, /\.mp3/);
      assert.equal(await exists(join(dir, 'refused')), false);
    });
  }

  for (const name of ['greeting.mp3', 'Greeting.MP3', 'a.b.mp3']) {
    test(`accepts ${name}, and names the sidecar after it`, async () => {
      const out = join(fresh(), name);
      const { code, stderr } = await runScript({ args: ['--text', GREETING, '--out', out], fetchImpl: async () => audio() });
      assert.equal(code, 0, stderr);
      assert.ok(await exists(out));
      assert.ok(await exists(sidecarPath(out)));
    });
  }
});

describe('writing the files', () => {
  /** Real file operations, recorded, with one made to fail. `failOn` is the n-th call (1-based) of the named operation. */
  const recordingFs = (failOn = {}) => {
    const log = [];
    const real = { mkdir, writeFile, rename, rm };
    const wrap = (name) => async (...args) => {
      log.push([name, String(args[0]).split('/').pop()]);
      const count = log.filter(([op]) => op === name).length;
      if (failOn[name] === count) throw Object.assign(new Error(`${name} failed (${KEY})`), { code: 'EIO' });
      return real[name](...args);
    };
    return { log, fsImpl: { mkdir: wrap('mkdir'), writeFile: wrap('writeFile'), rename: wrap('rename'), rm: wrap('rm') } };
  };

  /** An earlier recording is already in place. */
  const withEarlierRecording = async () => {
    const out = join(fresh(), 'greeting.mp3');
    await mkdir(join(out, '..'), { recursive: true });
    await writeFile(out, 'old audio');
    await writeFile(sidecarPath(out), '{"text":"old"}\n');
    return out;
  };
  const leftovers = async (out) => (await readdir(join(out, '..'))).filter((name) => name.endsWith('.partial'));

  test('writes both files under temporary names before either is moved into place, the MP3 first', async () => {
    const { log, fsImpl } = recordingFs();
    const { code, out } = await runScript({ fetchImpl: async () => audio(), fsImpl });
    assert.equal(code, 0);
    assert.deepEqual(log.filter(([op]) => op !== 'mkdir'), [
      ['writeFile', 'greeting.mp3.partial'],
      ['writeFile', 'greeting.json.partial'],
      ['rename', 'greeting.mp3.partial'],
      ['rename', 'greeting.json.partial'],
    ]);
    assert.deepEqual(await leftovers(out), []);
  });

  for (const [label, failOn, wordsInMessage] of [
    ['creating the folder', { mkdir: 1 }, /Could not write .*greeting\.mp3 \(EIO\)/],
    ['writing the MP3', { writeFile: 1 }, /Could not write .*greeting\.mp3 \(EIO\)/],
    ['writing the sidecar', { writeFile: 2 }, /Could not write .*greeting\.mp3 \(EIO\)/],
    ['putting the MP3 in place', { rename: 1 }, /Could not write .*greeting\.mp3 \(EIO\)/],
  ]) {
    test(`a failure ${label}: exit 1, no .partial file is left, and the earlier recording is untouched`, async () => {
      const out = await withEarlierRecording();
      const { fsImpl } = recordingFs(failOn);
      const { code, stdout, stderr } = await runScript({ out, fetchImpl: async () => audio(mp3(3000)), fsImpl });
      assert.equal(code, 1);
      assert.equal(stdout, '');
      assert.match(stderr, wordsInMessage);
      assert.match(stderr, /Nothing was changed/);
      assert.ok(!stderr.includes(KEY), 'the key must never be printed');
      assert.deepEqual(await leftovers(out), []);
      assert.equal(await readFile(out, 'utf8'), 'old audio');
      assert.equal(await readFile(sidecarPath(out), 'utf8'), '{"text":"old"}\n');
    });
  }

  test('a failure putting the sidecar in place, after the MP3 was: says the two no longer match, and leaves no .partial file', async () => {
    const out = await withEarlierRecording();
    const { fsImpl } = recordingFs({ rename: 2 });
    const { code, stderr } = await runScript({ out, fetchImpl: async () => audio(mp3(3000)), fsImpl });
    assert.equal(code, 1);
    assert.match(stderr, /Could not finish writing .*greeting\.json \(EIO\)/);
    assert.match(stderr, /already replaced/);
    assert.match(stderr, /run this again/);
    assert.deepEqual(await leftovers(out), []);
    // The new recording is in place and the old description is not: a mismatch the widget's test will catch.
    assert.equal((await readFile(out)).length, 3000);
    assert.equal(await readFile(sidecarPath(out), 'utf8'), '{"text":"old"}\n');
  });

  test('a failure while cleaning up does not hide the real error', async () => {
    const out = await withEarlierRecording();
    const { fsImpl } = recordingFs({ writeFile: 2 });
    fsImpl.rm = async () => {
      throw new Error('cannot remove');
    };
    const { code, stderr } = await runScript({ out, fetchImpl: async () => audio(), fsImpl });
    assert.equal(code, 1);
    assert.match(stderr, /Could not write .*\(EIO\)/);
  });
});

describe('the script as a command', () => {
  let server;
  let base;
  let lastRequest;
  before(async () => {
    server = createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        lastRequest = { method: req.method, url: req.url, key: req.headers['xi-api-key'], type: req.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') };
        if (req.headers['xi-api-key'] !== KEY) {
          res.statusCode = 401;
          res.setHeader('content-type', 'application/json');
          res.end('{"detail":"bad key"}');
          return;
        }
        res.setHeader('content-type', 'audio/mpeg');
        res.end(mp3(3000));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  const command = (args) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (err += chunk));
      child.on('close', (code) => resolve({ code, out, err }));
    });

  const files = async (key = KEY) => ({
    out: join(fresh(), 'greeting.mp3'),
    envFile: await fixture('.dev.vars', `ELEVENLABS_API_KEY=${key}\n`),
    wranglerFile: await fixture('wrangler.jsonc', WRANGLER),
  });

  test('records the greeting from a real HTTP call: MP3 and sidecar written, key sent only as a header', async () => {
    const { out, envFile, wranglerFile } = await files();
    const { code, out: stdout, err } = await command(['--text', GREETING, '--out', out, '--env-file', envFile, '--wrangler-file', wranglerFile, '--base-url', base]);
    assert.equal(code, 0, err);
    assert.equal(err, '');
    assert.equal((await readFile(out)).length, 3000);
    assert.equal(JSON.parse(await readFile(sidecarPath(out), 'utf8')).voiceId, VOICE);
    assert.equal(lastRequest.method, 'POST');
    assert.equal(lastRequest.url, `/v1/text-to-speech/${VOICE}?output_format=mp3_22050_32`);
    assert.equal(lastRequest.key, KEY);
    assert.equal(lastRequest.type, 'application/json');
    assert.deepEqual(JSON.parse(lastRequest.body), requestBody(GREETING, 'eleven_flash_v2_5'));
    assert.ok(!lastRequest.url.includes(KEY));
    assert.ok(!stdout.includes(KEY) && !err.includes(KEY));
  });

  test('exits non-zero with a plain message when the key is wrong', async () => {
    const { out, envFile, wranglerFile } = await files('wrong-key-value');
    const { code, out: stdout, err } = await command(['--text', GREETING, '--out', out, '--env-file', envFile, '--wrangler-file', wranglerFile, '--base-url', base]);
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.match(err, /rejected the key/i);
    assert.ok(!err.includes('wrong-key-value'));
    assert.equal(await exists(out), false);
  });

  test('does not follow a redirect: the key never reaches the place it points at', async () => {
    let reachedTarget = false;
    const target = createServer((req, res) => {
      reachedTarget = true;
      res.end('{}');
    });
    await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
    const redirector = createServer((req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `http://127.0.0.1:${target.address().port}/stolen`);
      res.end();
    });
    await new Promise((resolve) => redirector.listen(0, '127.0.0.1', resolve));
    try {
      const { out, envFile, wranglerFile } = await files();
      const { code, out: stdout, err } = await command([
        '--text',
        GREETING,
        '--out',
        out,
        '--env-file',
        envFile,
        '--wrangler-file',
        wranglerFile,
        '--base-url',
        `http://127.0.0.1:${redirector.address().port}`,
      ]);
      assert.equal(code, 1);
      assert.equal(stdout, '');
      assert.match(err, /could not reach elevenlabs/i);
      assert.equal(reachedTarget, false, 'the redirect target must never be contacted');
      assert.ok(!err.includes(KEY));
      assert.equal(await exists(out), false);
    } finally {
      await Promise.all([new Promise((r) => target.close(r)), new Promise((r) => redirector.close(r))]);
    }
  });

  test('exits non-zero when nothing is listening', async () => {
    const { out, envFile, wranglerFile } = await files();
    const { code, err } = await command(['--text', GREETING, '--out', out, '--env-file', envFile, '--wrangler-file', wranglerFile, '--base-url', 'http://127.0.0.1:9']);
    assert.equal(code, 1);
    assert.match(err, /could not reach elevenlabs/i);
    assert.ok(!err.includes(KEY));
  });

  test('exits 2 without --text', async () => {
    const { code, err } = await command([]);
    assert.equal(code, 2);
    assert.match(err, /--text is required/);
  });
});
