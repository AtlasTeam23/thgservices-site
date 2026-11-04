import { describe, expect, it } from 'vitest';
import { readBytes, readJson } from '../src/http';

/** A request-shaped object over a stream that counts how many chunks were pulled from it. */
const streamed = (chunkBytes: number, chunkCount: number, headers: Record<string, string> = {}) => {
  const state = { pulled: 0, cancelled: false };
  // highWaterMark 0: nothing is pulled until a reader asks, so `pulled` counts real reads only.
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (state.pulled >= chunkCount) return controller.close();
        state.pulled += 1;
        controller.enqueue(new Uint8Array(chunkBytes).fill(97));
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { state, request: { headers: new Headers(headers), body } as unknown as Request };
};

describe('readBytes', () => {
  it('returns the whole body when it fits, exactly at the cap included', async () => {
    const fits = streamed(10, 4);
    expect((await readBytes(fits.request, 40))?.byteLength).toBe(40);
    const over = streamed(10, 4);
    expect(await readBytes(over.request, 39)).toBeNull();
  });

  it('refuses a declared Content-Length over the cap without touching the body', async () => {
    const { request, state } = streamed(10, 4, { 'Content-Length': '5000000' });
    expect(await readBytes(request, 1000)).toBeNull();
    expect(state.pulled).toBe(0);
  });

  it('stops reading and cancels the stream soon after the cap is crossed, when no length is declared', async () => {
    const { request, state } = streamed(1000, 10_000); // 10 MB on offer, no Content-Length
    expect(await readBytes(request, 5000)).toBeNull();
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(20); // nowhere near the 10,000 chunks available
  });

  it('is null for a request with no body', async () => {
    expect(await readBytes(new Request('https://x.test/', { method: 'POST' }), 100)).toBeNull();
  });

  it('joins chunks in order', async () => {
    const request = new Request('https://x.test/', { method: 'POST', body: new Uint8Array([1, 2, 3, 4]) });
    expect(Array.from((await readBytes(request, 100)) ?? [])).toEqual([1, 2, 3, 4]);
  });
});

describe('readJson (built on readBytes)', () => {
  it('parses JSON, refuses oversized or malformed bodies', async () => {
    const post = (body: string) => new Request('https://x.test/', { method: 'POST', body });
    expect(await readJson(post('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
    expect(await readJson(post('{"a":1}'), 3)).toEqual({ ok: false });
    expect(await readJson(post('{nope'), 100)).toEqual({ ok: false });
  });
});
