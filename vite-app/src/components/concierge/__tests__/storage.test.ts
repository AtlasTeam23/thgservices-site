import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY,
  captureLanding,
  captureUtm,
  isFreshThread,
  isOnlyGreeting,
  loadState,
  newId,
  saveState,
  type StoredState,
} from '../storage';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the documented key', () => {
    expect(STORAGE_KEY).toBe('thg-concierge-v1');
  });

  it('creates a fresh state with a v4 session id when nothing is stored', () => {
    const s = loadState();
    expect(s.sessionId).toMatch(UUID_V4);
    expect(s.messages).toEqual([]);
    expect(s.leadSubmitted).toBe(false);
    expect(s.ended).toBe(false);
    expect(s.utm).toEqual({});
  });

  it('round-trips a saved state', () => {
    const state: StoredState = {
      sessionId: newId(),
      messages: [
        {
          id: 'a',
          role: 'assistant',
          content: 'Hi',
          at: '2026-11-03T15:00:00.000Z',
          greeting: true,
        },
        { id: 'b', role: 'user', content: 'Hello', at: '2026-11-03T15:00:05.000Z' },
      ],
      leadSubmitted: true,
      ended: false,
      utm: { utm_source: 'google' },
    };
    saveState(state);
    expect(loadState()).toEqual(state);
    expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual(state);
  });

  it('captures only utm_ keys from location.search on first load', () => {
    window.history.replaceState({}, '', '/?utm_source=google&foo=bar&utm_campaign=spring');
    const s = loadState();
    expect(s.utm).toEqual({ utm_source: 'google', utm_campaign: 'spring' });
  });

  it('captures UTM once: a later load keeps the stored values', () => {
    window.history.replaceState({}, '', '/?utm_source=google');
    saveState(loadState());
    window.history.replaceState({}, '', '/?utm_source=bing');
    expect(loadState().utm).toEqual({ utm_source: 'google' });
  });

  it('captureUtm ignores non-utm keys and returns an empty object for no query', () => {
    expect(captureUtm('')).toEqual({});
    expect(captureUtm('?a=1&utm_term=plumber')).toEqual({ utm_term: 'plumber' });
  });

  it('falls back to a fresh state when the stored JSON is corrupt', () => {
    window.sessionStorage.setItem(STORAGE_KEY, '{not json');
    const s = loadState();
    expect(s.sessionId).toMatch(UUID_V4);
    expect(s.messages).toEqual([]);
  });

  it('drops malformed messages from stored state', () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId: '3f2b8c1e-5d4a-4e7b-9c6d-1a2b3c4d5e6f',
        messages: [
          { id: '1', role: 'user', content: 'ok', at: 'now' },
          { id: '2', role: 'robot', content: 'bad role', at: 'now' },
          'junk',
          { id: '3', role: 'assistant', content: 42, at: 'now' },
        ],
        leadSubmitted: 'yes',
        ended: true,
        utm: { utm_source: 'x', evil: 'y' },
      })
    );
    const s = loadState();
    expect(s.sessionId).toBe('3f2b8c1e-5d4a-4e7b-9c6d-1a2b3c4d5e6f');
    expect(s.messages.map((m) => m.id)).toEqual(['1']);
    expect(s.leadSubmitted).toBe(false);
    expect(s.ended).toBe(true);
    expect(s.utm).toEqual({ utm_source: 'x' });
  });

  it('replaces a stored session id that is not a v4 UUID, keeping the rest', () => {
    for (const bad of ['abc', '', '3f2b8c1e-5d4a-1e7b-9c6d-1a2b3c4d5e6f', '<script>', 'x'.repeat(500)]) {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessionId: bad,
          messages: [{ id: '1', role: 'user', content: 'hi', at: 'now' }],
          ended: true,
        })
      );
      const s = loadState();
      expect(s.sessionId).toMatch(UUID_V4);
      expect(s.sessionId).not.toBe(bad);
      expect(s.messages).toHaveLength(1);
      expect(s.ended).toBe(true);
    }
  });

  it('keeps a valid v4 session id', () => {
    const id = newId();
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: id }));
    expect(loadState().sessionId).toBe(id);
  });

  it('captureLanding stores the UTM parameters at page load, before any chat state exists', () => {
    window.history.replaceState({}, '', '/?utm_source=google&utm_campaign=spring&ref=x');
    captureLanding();
    const raw = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    expect(raw.utm).toEqual({ utm_source: 'google', utm_campaign: 'spring' });
    expect(raw.sessionId).toMatch(UUID_V4);
    expect(raw.messages).toEqual([]);

    // Much later the URL no longer carries them; the stored capture wins.
    window.history.replaceState({}, '', '/#ai-concierge');
    expect(loadState().utm).toEqual({ utm_source: 'google', utm_campaign: 'spring' });
  });

  it('captureLanding keeps an existing session untouched', () => {
    window.history.replaceState({}, '', '/?utm_source=google');
    captureLanding();
    const first = window.sessionStorage.getItem(STORAGE_KEY);
    window.history.replaceState({}, '', '/?utm_source=bing');
    captureLanding();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(first);
  });

  it('captureLanding does not throw when sessionStorage is unavailable', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => captureLanding()).not.toThrow();
  });

  describe('leadFormDismissedAfter (additive field)', () => {
    const base = { sessionId: '3f2b8c1e-5d4a-4e7b-9c6d-1a2b3c4d5e6f', messages: [], leadSubmitted: false, ended: false, utm: {} };

    it('round-trips when set', () => {
      saveState({ ...base, leadFormDismissedAfter: 'msg-42' });
      expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}').leadFormDismissedAfter).toBe('msg-42');
      expect(loadState().leadFormDismissedAfter).toBe('msg-42');
    });

    it('is left out of the stored object when not set, so the v1 shape is unchanged', () => {
      saveState(base);
      expect(Object.keys(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}')).sort()).toEqual([
        'ended',
        'leadSubmitted',
        'messages',
        'sessionId',
        'utm',
      ]);
      expect(loadState().leadFormDismissedAfter).toBeUndefined();
    });

    it('a stored v1 object without it still loads, with its messages and flags intact', () => {
      const v1 = {
        sessionId: base.sessionId,
        messages: [
          { id: 'a', role: 'assistant', content: 'Hi', at: '2026-11-04T15:00:00.000Z', greeting: true },
          { id: 'b', role: 'user', content: 'Hello', at: '2026-11-04T15:00:05.000Z' },
        ],
        leadSubmitted: true,
        ended: true,
        utm: { utm_source: 'google' },
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(v1));
      const loaded = loadState();
      expect(loaded).toMatchObject(v1);
      expect(loaded.messages).toHaveLength(2);
      expect(loaded.leadSubmitted).toBe(true);
      expect(loaded.ended).toBe(true);
      expect(loaded.leadFormDismissedAfter).toBeUndefined();
      expect(loaded.leadFormOpenAfter).toBeUndefined();
      expect(loaded.leadDraft).toBeUndefined();
    });

    it('ignores a value that is not a non-empty string', () => {
      for (const bad of [5, null, '', {}, ['x'], true]) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, leadFormDismissedAfter: bad }));
        expect(loadState().leadFormDismissedAfter, JSON.stringify(bad)).toBeUndefined();
      }
    });
  });

  describe('leadFormOpenAfter and leadDraft (additive fields for an open readyToConfirm form)', () => {
    const base = { sessionId: '3f2b8c1e-5d4a-4e7b-9c6d-1a2b3c4d5e6f', messages: [], leadSubmitted: false, ended: false, utm: {} };
    const draft = {
      name: 'Dana Lee',
      phone: '7705550147',
      email: '',
      business: 'Lee Landscaping',
      need: '',
      callbackWindow: 'afternoon_1_3' as const,
    };

    it('round-trips together', () => {
      saveState({ ...base, leadFormOpenAfter: 'msg-9', leadDraft: draft });
      const raw = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}');
      expect(raw.leadFormOpenAfter).toBe('msg-9');
      expect(raw.leadDraft).toEqual(draft);
      const loaded = loadState();
      expect(loaded.leadFormOpenAfter).toBe('msg-9');
      expect(loaded.leadDraft).toEqual(draft);
    });

    it('is absent from the stored object when not set', () => {
      saveState(base);
      const keys = Object.keys(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? '{}'));
      expect(keys).not.toContain('leadFormOpenAfter');
      expect(keys).not.toContain('leadDraft');
    });

    it('cleans a stored draft the same way as one from the server', () => {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...base,
          leadFormOpenAfter: 'msg-9',
          leadDraft: { name: ' Dana ', phone: '(770) 555-0147', email: 'nope', callbackWindow: 'evening', extra: 1 },
        })
      );
      expect(loadState().leadDraft).toEqual({
        name: 'Dana',
        phone: '7705550147',
        email: '',
        business: '',
        need: '',
        callbackWindow: '',
      });
    });

    it('ignores a marker that is not a non-empty string, and a draft that is not an object', () => {
      for (const bad of [5, null, '', {}, ['x'], true]) {
        window.sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...base, leadFormOpenAfter: bad, leadDraft: bad })
        );
        const loaded = loadState();
        expect(loaded.leadFormOpenAfter, JSON.stringify(bad)).toBeUndefined();
        if (bad === null || typeof bad !== 'object' || Array.isArray(bad) || Object.keys(bad).length === 0) {
          expect(loaded.leadDraft, JSON.stringify(bad)).toBeUndefined();
        }
      }
    });
  });

  it('works when sessionStorage throws on every access', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => loadState()).not.toThrow();
    const s = loadState();
    expect(s.sessionId).toMatch(UUID_V4);
    expect(() => saveState(s)).not.toThrow();
  });

  it('works when setItem throws (quota or private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(() => saveState(loadState())).not.toThrow();
  });

  it('falls back to a Math.random v4 id when crypto.randomUUID is missing', () => {
    vi.stubGlobal('crypto', {});
    expect(newId()).toMatch(UUID_V4);
  });
});

describe('what counts as a fresh thread', () => {
  const msg = (role: 'user' | 'assistant', greeting = false) => ({
    id: newId(),
    role,
    content: 'text',
    at: new Date().toISOString(),
    ...(greeting ? { greeting: true } : {}),
  });

  it('is only the local greeting message, for the chat and for the greeting audio alike', () => {
    expect(isOnlyGreeting([msg('assistant', true)])).toBe(true);
    expect(isOnlyGreeting([])).toBe(false);
    expect(isOnlyGreeting([msg('assistant')])).toBe(false);
    expect(isOnlyGreeting([msg('assistant', true), msg('user')])).toBe(false);
    expect(isOnlyGreeting([msg('user')])).toBe(false);
  });

  it('is fresh when there is nothing, or only the greeting', () => {
    expect(isFreshThread([])).toBe(true);
    expect(isFreshThread([msg('assistant', true)])).toBe(true);
    expect(isFreshThread([msg('user')])).toBe(false);
    expect(isFreshThread([msg('assistant', true), msg('user'), msg('assistant')])).toBe(false);
  });
});
