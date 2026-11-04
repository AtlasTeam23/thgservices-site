// The slice of scripts/eleven-greeting.mjs (plain JavaScript, run by Node) that test/greeting.test.ts imports.
declare module '*/eleven-greeting.mjs' {
  export const VOICE_SETTINGS: Readonly<{
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
  }>;
  export const requestBody: (
    text: string,
    modelId: string
  ) => {
    text: string;
    model_id: string;
    voice_settings: { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean };
    apply_text_normalization: string;
  };
}
