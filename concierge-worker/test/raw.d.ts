// Vite's `?raw` suffix imports a file's text. Used by test/config.test.ts to read wrangler.jsonc.
declare module '*?raw' {
  const content: string;
  export default content;
}
