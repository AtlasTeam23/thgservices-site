import type { ElevenConfig } from './env';

// The slice of the ElevenLabs API this Worker uses: streaming text-to-speech. Contract (API reference, read
// 2026-11-03): POST /v1/text-to-speech/{voice_id}/stream?output_format=..., header `xi-api-key`, a JSON body, and
// a 200 that streams audio with no Content-Type documented (the caller labels it audio/mpeg itself). Quota and
// limit answers (401, 402, 429) are not documented, so the caller treats any status but 200 as a failure.

export const ELEVEN_API = 'https://api.elevenlabs.io';

/**
 * Voice settings are sent with every request so a voice's stored defaults cannot change how replies sound.
 * These are ElevenLabs' own documented defaults for the four fields (stability 0.5, similarity 0.75, style 0,
 * speaker boost on); `speed` is left at its default of 1.
 */
const VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } as const;

/**
 * Starts the streaming call and resolves when the response headers arrive; the body keeps streaming after
 * that. `apply_text_normalization: "auto"` lets ElevenLabs decide whether to spell out numbers and dates.
 * The voice id was checked against a safe pattern in elevenConfig(), and is escaped here as well.
 */
export const fetchElevenLabs = (config: ElevenConfig, text: string, signal: AbortSignal): Promise<Response> =>
  fetch(`${ELEVEN_API}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}/stream?output_format=${config.format}`, {
    method: 'POST',
    headers: { 'xi-api-key': config.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: config.model,
      voice_settings: VOICE_SETTINGS,
      apply_text_normalization: 'auto',
    }),
    signal,
    // The key is in a header: never follow a redirect to somewhere else with it. A redirect is an error here.
    redirect: 'error',
  });
