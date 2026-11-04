// Run with: npm run test:probe
// Checks scripts/eleven-voices.mjs without a real key or the real .dev.vars: the file is a fixture in a temp
// folder, ElevenLabs is a stub (a function for the unit tests, a local HTTP server for the end-to-end ones).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fetchPremadeVoices, normalizeVoice, parseDevVars, renderTable, run } from './eleven-voices.mjs';

const SCRIPT = fileURLToPath(new URL('./eleven-voices.mjs', import.meta.url));
const KEY = 'sk_placeholder_not_a_real_key_0123456789';

const preview = (id) => `https://example.com/previews/${id}.mp3`;
const voice = (name, id, labels = {}, previewUrl = preview(id)) => ({ voice_id: id, name, category: 'premade', labels, preview_url: previewUrl });
const page = (voices, next = null) => ({ voices, has_more: next !== null, total_count: voices.length, next_page_token: next });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let dir;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eleven-voices-test-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const devVarsFile = async (text, name = '.dev.vars') => {
  const path = join(dir, `${Math.random().toString(36).slice(2)}-${name}`);
  await writeFile(path, text);
  return path;
};

/** Runs the script's main function with captured output. */
const runScript = async ({ file, fetchImpl, args = [] }) => {
  let out = '';
  let err = '';
  const code = await run({
    argv: ['--env-file', file, ...args],
    stdout: { write: (text) => (out += text) },
    stderr: { write: (text) => (err += text) },
    fetchImpl,
  });
  return { code, out, err };
};

describe('parseDevVars', () => {
  test('reads KEY=VALUE lines, skipping blanks and comments', () => {
    const vars = parseDevVars('# a comment\n\nLLM_PROVIDER=mock\nELEVENLABS_API_KEY=abc123\n   # indented comment\nEMPTY=\n');
    assert.deepEqual(vars, { LLM_PROVIDER: 'mock', ELEVENLABS_API_KEY: 'abc123', EMPTY: '' });
  });

  test('trims, strips matching quotes, and accepts an export prefix and CRLF', () => {
    const vars = parseDevVars('A = spaced \r\nB="quoted value"\r\nC=\'single\'\nexport D=exported\nE="unterminated\n');
    assert.deepEqual(vars, { A: 'spaced', B: 'quoted value', C: 'single', D: 'exported', E: '"unterminated' });
  });

  test('keeps an equals sign or a hash inside a value, and drops a trailing comment on a bare value', () => {
    const vars = parseDevVars('K=a=b=c\nH=token#withhash\nT=value # note\n');
    assert.deepEqual(vars, { K: 'a=b=c', H: 'token#withhash', T: 'value' });
  });

  test('ignores lines that are not assignments, and lets a later line win', () => {
    assert.deepEqual(parseDevVars('just words\n=novalue\nK=1\nK=2\n'), { K: '2' });
  });
});

describe('normalizeVoice', () => {
  test('keeps exactly voice_id, name, labels and preview_url, in that order', () => {
    const normalized = normalizeVoice({ ...voice('Aria', 'id-aria-000000001', { gender: 'female' }), category: 'premade', description: 'ignored', samples: [] });
    assert.deepEqual(Object.keys(normalized), ['voice_id', 'name', 'labels', 'preview_url']);
    assert.deepEqual(normalized, { voice_id: 'id-aria-000000001', name: 'Aria', labels: { gender: 'female' }, preview_url: preview('id-aria-000000001') });
  });

  test('passes every label through as it came, including keys the table does not show', () => {
    const labels = { accent: 'american', descriptive: 'calm', age: 'young', gender: 'female', language: 'en', use_case: 'narration', something_new: 'x' };
    assert.deepEqual(normalizeVoice(voice('A', 'id-a-0000000001', labels)).labels, labels);
  });

  test('gives null for a missing preview and {} for missing labels', () => {
    assert.deepEqual(normalizeVoice({ voice_id: 'id-x-0000000001', name: 'X' }), { voice_id: 'id-x-0000000001', name: 'X', labels: {}, preview_url: null });
  });

  for (const [label, value] of [
    ['an empty string', ''],
    ['not a string', 42],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:audio/mpeg;base64,AAAA'],
    ['plain http', 'http://example.com/a.mp3'],
    ['not a URL at all', 'preview.mp3'],
  ]) {
    test(`gives null for a preview_url that is ${label}: it will end up in a page`, () => {
      assert.equal(normalizeVoice(voice('A', 'id-a-0000000001', {}, value)).preview_url, null);
    });
  }

  test('ignores labels that are not a plain object', () => {
    for (const labels of [null, 'gender=male', ['male'], 7]) {
      assert.deepEqual(normalizeVoice({ voice_id: 'id-x-0000000001', name: 'X', labels }).labels, {});
    }
  });
});

describe('renderTable', () => {
  test('sorts by name, ignoring case, and shows the id, the labels and the preview link', () => {
    const table = renderTable([
      voice('river', 'id-river-00000001', { gender: 'neutral', accent: 'american', age: 'middle_aged', use_case: 'conversational' }),
      voice('Aria', 'id-aria-000000001', { gender: 'female', accent: 'american', age: 'young', use_case: 'social_media', descriptive: 'expressive' }),
      voice('adam', 'id-adam-00000001', { gender: 'male', accent: 'american', age: 'middle_aged', use_case: 'narration' }),
    ]);
    const lines = table.split('\n');
    assert.match(lines[0], /NAME\s+VOICE_ID\s+GENDER\s+ACCENT\s+AGE\s+USE CASE\s+DESCRIPTION\s+PREVIEW_URL/);
    assert.deepEqual(
      lines.slice(1).map((line) => line.split(/\s+/)[0]),
      ['adam', 'Aria', 'river'],
    );
    assert.match(
      lines[2],
      /Aria\s+id-aria-000000001\s+female\s+american\s+young\s+social_media\s+expressive\s+https:\/\/example\.com\/previews\/id-aria-000000001\.mp3$/,
    );
  });

  test('shows the description label, or the descriptive one ElevenLabs actually uses when there is no description', () => {
    const table = renderTable([
      voice('Both', 'id-both-00000001', { description: 'warm and steady', descriptive: 'calm' }),
      voice('Only', 'id-only-00000001', { descriptive: 'calm' }),
    ]);
    assert.match(table, /Both\s+id-both-00000001\s+-\s+-\s+-\s+-\s+warm and steady\s+https:/);
    assert.match(table, /Only\s+id-only-00000001\s+-\s+-\s+-\s+-\s+calm\s+https:/);
  });

  test('shows a dash for anything a voice does not have, including the preview, and copes with no labels at all', () => {
    const table = renderTable([voice('Plain', 'id-plain-0000001', {}, null), { voice_id: 'id-nolabels-0001', name: 'Bare' }]);
    assert.match(table, /Bare\s+id-nolabels-0001\s+-\s+-\s+-\s+-\s+-\s+-$/m);
    assert.match(table, /Plain\s+id-plain-0000001\s+-\s+-\s+-\s+-\s+-\s+-$/m);
  });

  test('shows a dash instead of a preview link that is not a safe https URL', () => {
    const table = renderTable([voice('Odd', 'id-odd-000000001', { gender: 'male' }, 'javascript:alert(1)')]);
    assert.ok(!table.includes('javascript'), table);
    assert.match(table, /Odd\s+id-odd-000000001\s+male\s+-\s+-\s+-\s+-\s+-$/m);
  });

  test('lines the columns up', () => {
    const table = renderTable([voice('A', 'id-a-0000000001', { gender: 'female' }), voice('A very long voice name', 'id-b-0000000002', { gender: 'male' })]);
    const starts = table.split('\n').map((line) => line.indexOf('id-') >= 0 ? line.indexOf('id-') : line.indexOf('VOICE_ID'));
    assert.equal(new Set(starts).size, 1);
  });
});

describe('fetchPremadeVoices', () => {
  test('asks for the premade voices, 100 at a time, with the key in xi-api-key', async () => {
    const seen = [];
    const voices = await fetchPremadeVoices(KEY, {
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), headers: new Headers(init?.headers), redirect: init?.redirect });
        return json(page([voice('Aria', 'id-aria-000000001')]));
      },
    });
    assert.equal(voices.length, 1);
    assert.equal(seen.length, 1);
    const url = new URL(seen[0].url);
    assert.equal(url.origin + url.pathname, 'https://api.elevenlabs.io/v2/voices');
    assert.equal(url.searchParams.get('category'), 'premade');
    assert.equal(url.searchParams.get('page_size'), '100');
    assert.equal(seen[0].headers.get('xi-api-key'), KEY);
    assert.ok(!seen[0].url.includes(KEY), 'the key goes in a header, never in the URL');
    assert.equal(seen[0].redirect, 'error', 'a redirect must be an error: the key would travel with it');
  });

  test('follows next_page_token until has_more is false', async () => {
    const tokens = [];
    const voices = await fetchPremadeVoices(KEY, {
      fetchImpl: async (url) => {
        const token = new URL(String(url)).searchParams.get('next_page_token');
        tokens.push(token);
        if (token === null) return json(page([voice('A', 'id-a-0000000001')], 'tok/2='));
        if (token === 'tok/2=') return json(page([voice('B', 'id-b-0000000002')], 'tok3'));
        return json(page([voice('C', 'id-c-0000000003')]));
      },
    });
    assert.deepEqual(tokens, [null, 'tok/2=', 'tok3']);
    assert.deepEqual(voices.map((v) => v.name), ['A', 'B', 'C']);
  });

  test('gives up on a runaway listing instead of looping forever', async () => {
    let calls = 0;
    await assert.rejects(
      fetchPremadeVoices(KEY, {
        fetchImpl: async () => {
          calls += 1;
          return json(page([voice('A', 'id-a-0000000001')], 'again'));
        },
      }),
      /too many pages/i,
    );
    assert.ok(calls <= 25);
  });
});

describe('run', () => {
  test('prints the table sorted by name and exits 0', async () => {
    const file = await devVarsFile(`LLM_PROVIDER=mock\nELEVENLABS_API_KEY=${KEY}\n`);
    const { code, out, err } = await runScript({
      file,
      fetchImpl: async () => json(page([voice('Zed', 'id-zed-000000001', { gender: 'male' }), voice('Aria', 'id-aria-000000001', { gender: 'female' })])),
    });
    assert.equal(code, 0);
    assert.equal(err, '');
    assert.ok(out.indexOf('Aria') < out.indexOf('Zed'));
    assert.match(out, /VOICE_ELEVEN_VOICE_ID/);
  });

  test('exits 1 with a plain message when the file is missing', async () => {
    const { code, out, err } = await runScript({ file: join(dir, 'no-such-file'), fetchImpl: async () => assert.fail('must not call the API') });
    assert.equal(code, 1);
    assert.equal(out, '');
    assert.match(err, /could not read/i);
    assert.match(err, /\.dev\.vars/);
  });

  for (const [label, text] of [
    ['has no ELEVENLABS_API_KEY line', 'LLM_PROVIDER=mock\n'],
    ['has an empty key', 'ELEVENLABS_API_KEY=\n'],
    ['has a key that is only spaces', 'ELEVENLABS_API_KEY=   \n'],
    ['has the key only in a comment', '# ELEVENLABS_API_KEY=abc\n'],
  ]) {
    test(`exits 1 and says the key is missing when the file ${label}`, async () => {
      const file = await devVarsFile(text);
      const { code, out, err } = await runScript({ file, fetchImpl: async () => assert.fail('must not call the API') });
      assert.equal(code, 1);
      assert.equal(out, '');
      assert.match(err, /ELEVENLABS_API_KEY is not set/);
    });
  }

  for (const [status, expected] of [
    [401, /rejected the key/i],
    [403, /HTTP 403/],
    [429, /HTTP 429/],
    [500, /HTTP 500/],
  ]) {
    test(`exits 1 for HTTP ${status}, saying so in plain words and printing nothing the server sent`, async () => {
      const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
      const { code, out, err } = await runScript({
        file,
        fetchImpl: async () => json({ detail: { status: 'nope', message: `server text that must not be echoed ${KEY}` } }, status),
      });
      assert.equal(code, 1);
      assert.equal(out, '');
      assert.match(err, expected);
      assert.ok(!err.includes('server text'), err);
    });
  }

  test('exits 1 when the call cannot be made, and never prints the key even if the error does', async () => {
    const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
    const { code, out, err } = await runScript({
      file,
      fetchImpl: async () => {
        throw new TypeError(`fetch failed (while using ${KEY})`);
      },
    });
    assert.equal(code, 1);
    assert.equal(out, '');
    assert.match(err, /could not reach elevenlabs/i);
    assert.ok(!err.includes(KEY), 'the key must never be printed');
  });

  test('exits 1 when the answer is not a voice list', async () => {
    const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
    for (const fetchImpl of [async () => new Response('<html>', { status: 200 }), async () => json({ nope: true })]) {
      const { code, err } = await runScript({ file, fetchImpl });
      assert.equal(code, 1);
      assert.match(err, /not a voice list/i);
    }
  });

  test('exits 1 when no premade voices come back', async () => {
    const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
    const { code, err } = await runScript({ file, fetchImpl: async () => json(page([])) });
    assert.equal(code, 1);
    assert.match(err, /no premade voices/i);
  });

  test('never prints the key on any path', async () => {
    const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
    const results = await Promise.all([
      runScript({ file, fetchImpl: async () => json(page([voice(`Name ${KEY}`, 'id-a-0000000001', { accent: KEY })])) }),
      runScript({ file, fetchImpl: async () => json({}, 401) }),
      runScript({ file, fetchImpl: async () => { throw new Error(KEY); } }),
    ]);
    for (const { out, err } of results) {
      assert.ok(!out.includes(KEY), out);
      assert.ok(!err.includes(KEY), err);
    }
  });

  describe('--json', () => {
    const fixtureVoices = () => [
      voice('Zed', 'id-zed-000000001', { gender: 'male', accent: 'british', age: 'old', use_case: 'narration', descriptive: 'deep' }),
      voice('Aria', 'id-aria-000000001', { gender: 'female', accent: 'american', age: 'young', use_case: 'social_media', descriptive: 'expressive', language: 'en' }),
      { voice_id: 'id-bare-00000001', name: 'bare' },
    ];

    test('writes only a JSON array to stdout, sorted by name, with voice_id, name, labels and preview_url', async () => {
      const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
      const { code, out, err } = await runScript({ file, args: ['--json'], fetchImpl: async () => json(page(fixtureVoices())) });
      assert.equal(code, 0);
      assert.equal(err, '');
      assert.ok(out.endsWith('\n'));
      const list = JSON.parse(out); // the whole of stdout is one JSON document: nothing else is printed
      assert.ok(Array.isArray(list));
      assert.deepEqual(list.map((entry) => entry.name), ['Aria', 'bare', 'Zed']);
      for (const entry of list) assert.deepEqual(Object.keys(entry), ['voice_id', 'name', 'labels', 'preview_url']);
      assert.deepEqual(list[0], {
        voice_id: 'id-aria-000000001',
        name: 'Aria',
        labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'social_media', descriptive: 'expressive', language: 'en' },
        preview_url: 'https://example.com/previews/id-aria-000000001.mp3',
      });
    });

    test('gives {} and null where a voice has no labels or no preview', async () => {
      const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
      const { out } = await runScript({ file, args: ['--json'], fetchImpl: async () => json(page(fixtureVoices())) });
      assert.deepEqual(JSON.parse(out)[1], { voice_id: 'id-bare-00000001', name: 'bare', labels: {}, preview_url: null });
    });

    test('lists the voices from every page, as one array', async () => {
      const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
      const { out } = await runScript({
        file,
        args: ['--json'],
        fetchImpl: async (url) =>
          new URL(String(url)).searchParams.get('next_page_token') === null
            ? json(page([voice('B', 'id-b-0000000002')], 'next'))
            : json(page([voice('A', 'id-a-0000000001')])),
      });
      assert.deepEqual(JSON.parse(out).map((entry) => entry.name), ['A', 'B']);
    });

    test('drops a preview URL that is not https, so it is safe to put in a page', async () => {
      const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
      const { out } = await runScript({
        file,
        args: ['--json'],
        fetchImpl: async () => json(page([voice('Odd', 'id-odd-000000001', {}, 'javascript:alert(1)'), voice('Plain', 'id-plain-0000001', {}, 'http://example.com/a.mp3')])),
      });
      assert.deepEqual(JSON.parse(out).map((entry) => entry.preview_url), [null, null]);
    });

    test('scrubs the key out of the JSON and leaves it valid', async () => {
      const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
      const { code, out } = await runScript({
        file,
        args: ['--json'],
        fetchImpl: async () => json(page([voice(`Name ${KEY}`, 'id-a-0000000001', { accent: KEY, nested: KEY })])),
      });
      assert.equal(code, 0);
      assert.ok(!out.includes(KEY), out);
      const [entry] = JSON.parse(out);
      assert.equal(entry.name, 'Name [key]');
      assert.equal(entry.labels.accent, '[key]');
    });

    test('keeps errors on stderr with nothing on stdout, so a redirect never captures a half-answer', async () => {
      const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
      for (const fetchImpl of [async () => json({}, 401), async () => json(page([])), async () => { throw new Error(KEY); }]) {
        const { code, out, err } = await runScript({ file, args: ['--json'], fetchImpl });
        assert.equal(code, 1);
        assert.equal(out, '');
        assert.ok(err.length > 0);
        assert.ok(!err.includes(KEY));
      }
      const missing = await runScript({ file: await devVarsFile('LLM_PROVIDER=mock\n'), args: ['--json'], fetchImpl: async () => assert.fail('no call') });
      assert.equal(missing.code, 1);
      assert.equal(missing.out, '');
      assert.match(missing.err, /ELEVENLABS_API_KEY is not set/);
    });

    test('is described by --help', async () => {
      const { out } = await runScript({ file: join(dir, 'no-such-file'), args: ['--help'], fetchImpl: async () => assert.fail('no call') });
      assert.match(out, /--json/);
      assert.match(out, /preview/i);
    });
  });

  describe('--base-url', () => {
    const attempt = async (baseUrl, fetchImpl) => {
      const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
      return runScript({ file, args: ['--base-url', baseUrl], fetchImpl });
    };

    for (const baseUrl of [
      'https://api.elevenlabs.io',
      'https://api.us.elevenlabs.io',
      'https://api.eu.residency.elevenlabs.io',
      'https://example.com',
      'http://localhost',
      'http://localhost:8787',
      'http://127.0.0.1',
      'http://127.0.0.1:4173',
      'HTTP://LOCALHOST:80',
    ]) {
      test(`accepts ${baseUrl}`, async () => {
        const { code } = await attempt(baseUrl, async () => json(page([voice('A', 'id-a-0000000001')])));
        assert.equal(code, 0);
      });
    }

    for (const baseUrl of [
      'http://example.com',
      'http://api.elevenlabs.io',
      'http://localhost.evil.example',
      'http://127.0.0.1.evil.example',
      'http://localhost@evil.example',
      'http://user:pass@localhost',
      'https://user:pass@api.elevenlabs.io',
      'http://[::1]:8787',
      'http://0.0.0.0',
      'http://192.168.1.10',
      'ftp://example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/plain,hi',
      'api.elevenlabs.io',
      'not a url',
      'https://',
    ]) {
      test(`refuses ${baseUrl} with exit 2 before reading anything or calling anything`, async () => {
        const { code, out, err } = await attempt(baseUrl, async () => assert.fail('must not call the API'));
        assert.equal(code, 2);
        assert.equal(out, '');
        assert.match(err, /--base-url/);
        assert.match(err, /https/);
        assert.ok(!err.includes(KEY));
      });
    }

    test('is checked before the key file is read, so a bad flag never even opens it', async () => {
      const { code, err } = await runScript({ file: join(dir, 'no-such-file'), args: ['--base-url', 'http://example.com'], fetchImpl: async () => assert.fail('no call') });
      assert.equal(code, 2);
      assert.match(err, /--base-url/); // not "could not read"
    });
  });

  test('--help prints usage and exits 0 without reading anything', async () => {
    const { code, out } = await runScript({ file: join(dir, 'no-such-file'), args: ['--help'], fetchImpl: async () => assert.fail('no call') });
    assert.equal(code, 0);
    assert.match(out, /eleven:voices/);
  });

  test('rejects an option it does not know, exit 2', async () => {
    const { code, err } = await runScript({ file: join(dir, 'x'), args: ['--wat'], fetchImpl: async () => assert.fail('no call') });
    assert.equal(code, 2);
    assert.match(err, /unknown option/i);
  });
});

describe('the script as a command', () => {
  let server;
  let base;
  let lastRequest;
  before(async () => {
    server = createServer((req, res) => {
      lastRequest = { url: req.url, key: req.headers['xi-api-key'] };
      res.setHeader('content-type', 'application/json');
      if (req.headers['xi-api-key'] !== KEY) {
        res.statusCode = 401;
        res.end('{"detail":"bad key"}');
        return;
      }
      res.end(JSON.stringify(page([voice('Zed', 'id-zed-000000001', { gender: 'male', accent: 'british', age: 'old', use_case: 'narration' }), voice('Aria', 'id-aria-000000001', { gender: 'female', accent: 'american', age: 'young', use_case: 'social_media', descriptive: 'expressive' })])));
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

  test('lists the voices from a real HTTP call, exit 0, key sent only as a header', async () => {
    const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
    const { code, out, err } = await command(['--env-file', file, '--base-url', base]);
    assert.equal(code, 0, err);
    assert.ok(out.indexOf('Aria') < out.indexOf('Zed'));
    assert.match(out, /id-aria-000000001/);
    assert.match(out, /https:\/\/example\.com\/previews\/id-aria-000000001\.mp3/);
    assert.equal(lastRequest.key, KEY);
    assert.ok(!lastRequest.url.includes(KEY));
    assert.ok(!out.includes(KEY) && !err.includes(KEY));
  });

  test('--json prints one JSON array of voice_id, name, labels and preview_url from a real HTTP call', async () => {
    const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
    const { code, out, err } = await command(['--env-file', file, '--base-url', base, '--json']);
    assert.equal(code, 0, err);
    assert.equal(err, '');
    assert.deepEqual(JSON.parse(out), [
      {
        voice_id: 'id-aria-000000001',
        name: 'Aria',
        labels: { gender: 'female', accent: 'american', age: 'young', use_case: 'social_media', descriptive: 'expressive' },
        preview_url: 'https://example.com/previews/id-aria-000000001.mp3',
      },
      {
        voice_id: 'id-zed-000000001',
        name: 'Zed',
        labels: { gender: 'male', accent: 'british', age: 'old', use_case: 'narration' },
        preview_url: 'https://example.com/previews/id-zed-000000001.mp3',
      },
    ]);
    assert.ok(!out.includes(KEY) && !err.includes(KEY));
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
      const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
      const { code, out, err } = await command(['--env-file', file, '--base-url', `http://127.0.0.1:${redirector.address().port}`]);
      assert.equal(code, 1);
      assert.equal(out, '');
      assert.match(err, /could not reach elevenlabs/i);
      assert.equal(reachedTarget, false, 'the redirect target must never be contacted');
      assert.ok(!err.includes(KEY));
    } finally {
      await Promise.all([new Promise((r) => target.close(r)), new Promise((r) => redirector.close(r))]);
    }
  });

  test('exits non-zero with a plain message when the key is wrong', async () => {
    const file = await devVarsFile('ELEVENLABS_API_KEY=wrong-key-value\n');
    const { code, out, err } = await command(['--env-file', file, '--base-url', base]);
    assert.equal(code, 1);
    assert.equal(out, '');
    assert.match(err, /rejected the key/i);
    assert.ok(!err.includes('wrong-key-value'));
  });

  test('exits non-zero with a plain message when the key line is missing', async () => {
    const file = await devVarsFile('LLM_PROVIDER=mock\n');
    const { code, err } = await command(['--env-file', file, '--base-url', base]);
    assert.equal(code, 1);
    assert.match(err, /ELEVENLABS_API_KEY is not set/);
  });

  test('exits non-zero when nothing is listening', async () => {
    const file = await devVarsFile(`ELEVENLABS_API_KEY=${KEY}\n`);
    const { code, err } = await command(['--env-file', file, '--base-url', 'http://127.0.0.1:9']);
    assert.equal(code, 1);
    assert.match(err, /could not reach elevenlabs/i);
    assert.ok(!err.includes(KEY));
  });
});
