// Just the slice of node:buffer this Worker uses. `nodejs_compat` (wrangler.jsonc) provides the real
// module at runtime; the Workers type definitions do not declare it and @types/node is not a dependency.
declare module 'node:buffer' {
  export const Buffer: {
    from(data: ArrayBufferLike, byteOffset?: number, length?: number): { toString(encoding: 'base64'): string };
  };
}
