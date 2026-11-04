// knowledge.md and system-prompt.md are bundled as text (see "rules" in wrangler.jsonc).
declare module '*.md' {
  const content: string;
  export default content;
}
