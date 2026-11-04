/** JSON response helper. Every body this Worker returns goes through here. */
export const json = (body: unknown, status = 200, headers?: HeadersInit): Response => {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json');
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
};

export const methodNotAllowed = (allow: string): Response =>
  json({ error: 'method_not_allowed' }, 405, { Allow: allow });

export type JsonBody = { ok: true; value: unknown } | { ok: false };

/**
 * Reads and parses a JSON request body without ever buffering more than `maxBytes`:
 * oversized bodies are cancelled mid-stream instead of being read to the end.
 */
export const readJson = async (request: Request, maxBytes: number): Promise<JsonBody> => {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false };
  if (!request.body) return { ok: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false };
  }
};

/** Whole seconds until `resetAt`, at least 1, for a Retry-After header. */
export const retryAfterSeconds = (resetAt: number, now: number = Date.now()): string =>
  String(Math.max(1, Math.ceil((resetAt - now) / 1000)));
