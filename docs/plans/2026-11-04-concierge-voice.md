# Concierge Voice (Tier 1, push-to-talk) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a visitor hold a mic button, speak a question, see it transcribed and answered by the same THG helper, and hear the answer read aloud, with the chat's equalizer reacting while it listens and speaks. Walkie-talkie, not a phone call; nothing in the text chat changes.

**Architecture:** The widget records short utterances with `MediaRecorder`, posts them to a new Worker route `POST /stt`, which runs Cloudflare Workers AI's `@cf/openai/whisper-large-v3-turbo` and returns the transcript; the transcript becomes the user's message through the existing `/chat` flow. Replies are spoken in the browser with `speechSynthesis` (zero cost, zero extra latency). A premium server voice (`POST /tts` on `@cf/deepgram/aura-1`) is built behind a flag and off by default. Voice degrades to typing whenever anything is unavailable (no mic permission, unsupported browser, daily budget spent, Worker error).

**Tech Stack:** Workers AI binding (`ai`), `MediaRecorder`, Web Speech `speechSynthesis`, the existing Durable Object limiter, vitest.

Prerequisite: the conversational update (`docs/plans/2026-11-04-concierge-conversational.md`) is merged first; this plan builds on its widget.

---

## 0. Facts and decisions (sources: Cloudflare Workers AI docs, read 2026-11-04)

| Item | Decision | Why |
|---|---|---|
| STT model | `@cf/openai/whisper-large-v3-turbo`, batch, base64 audio input | $0.0005 per audio minute (46.63 neurons/min). The Workers Free plan's 10,000 neurons/day covers ~214 minutes of speech; Deepgram Nova-3 is 10× the price and WebSocket-only for streaming |
| TTS default | Browser `speechSynthesis`, best available en-US voice | Free, instant, works offline from the Worker; quality is acceptable on iOS/macOS (Samantha/Ava) and Android/Chrome (Google voices) |
| TTS premium (flag) | `@cf/deepgram/aura-1`, voice `asteria`, mp3 | $0.015 per 1k characters (1,364 neurons/1k chars); 300 replies/day ≈ $1.50/day and needs Workers Paid ($5/mo). Built and tested, default off (`VOICE_TTS=browser`) |
| Daily voice budget | 150 audio-minutes/day of STT (fixed counter in the limiter), 3 minutes per session, 20 s per utterance, 1 MB per upload | Keeps the Free plan's neuron cap from being hit; when hit, the mic hides and the chat keeps working by text |
| Rate limits | `POST /stt`: 30 per IP per 10 min, shares the session's 40-message cap and the Turnstile-after-10 rule | Same abuse model as `/chat` |
| Privacy | Audio is sent only while the button is held, processed by Cloudflare Workers AI (Whisper, zero data retention), never stored; transcripts are ordinary chat messages | Privacy page gets one paragraph; the panel shows a one-line disclosure the first time voice is used |
| Realtime (Tier 2) | Out of scope; separate spec if the (866) line is wanted | Different stack (WebRTC/telephony) |

## 1. Contracts

### 1.1 `POST /stt` (Worker)

Request: `multipart/form-data` with `audio` (file, `audio/webm`, `audio/mp4`, `audio/ogg`, `audio/wav`; ≤ 1,048,576 bytes), `sessionId` (uuid), optional `turnstileToken`, optional `durationMs` (client-measured, ≤ 20,000). CORS and Origin rules identical to `/chat`.

Responses:
- `200 { "text": "what do you do", "durationMs": 4200 }` (text trimmed, HTML-stripped, ≤ 1,000 chars; empty transcript → `{ "text": "" }`)
- `400 { "error": "bad_audio" }` (missing/oversized/unsupported)
- `403 { "error": "verification_required" }` (same rule as `/chat`)
- `429 { "error": "rate_limited" }`
- `503 { "error": "voice_unavailable" }` (daily budget spent, binding missing, or Workers AI failed twice) → widget hides the mic for the session and shows `VOICE_OFF` copy once

Server behavior: session limiter hit (counts as a message), IP limiter (`ip:stt:<hash>`, 30/10 min), Turnstile rule, per-session audio-seconds counter (`session-voice:<id>`, fixed, 180 s), global `global:voice:<ET day>` fixed counter in seconds (9,000 s = 150 min; incremented by `durationMs/1000` rounded up, or by 10 when the client sent none), then `env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: <base64 of the upload>, task: 'transcribe', language: 'en' })`. Read `text` from the result. Log `{event:'stt', ms, status, audioBytes, seconds}` only.

### 1.2 `POST /tts` (Worker, behind `VOICE_TTS=aura`)

Request: `{ "sessionId", "text" }` with text ≤ 600 chars (the reply is already capped at 1,000; the client sends the reply verbatim). Response: `audio/mpeg` stream from `env.AI.run('@cf/deepgram/aura-1', { text, speaker: env.VOICE_SPEAKER ?? 'asteria' }, { returnRawResponse: true })`, or `503 { "error": "voice_unavailable" }`. Counted against a `global:tts:<day>` fixed counter in characters (default 20,000/day). When `VOICE_TTS` is not `aura`, the route returns `404` and the widget never calls it.

### 1.3 `GET /health` adds `"voice": { "stt": true|false, "tts": "browser"|"aura" }`.

### 1.4 Widget behavior

- **Mic button** in the composer (left of the send button, 44 px): on pointer devices, click to start, click again to stop (toggle, `aria-pressed`); on touch, press-and-hold. Space bar toggles when focused. Hidden entirely when `MediaRecorder` or `getUserMedia` is unavailable, when the Worker reports `voice.stt: false`, or after a `voice_unavailable`.
- **Recording**: `getUserMedia({ audio: true })` on first use (permission prompt); `MediaRecorder` with the first supported of `audio/webm;codecs=opus`, `audio/mp4`, `audio/ogg;codecs=opus`; 20 s hard stop with a visible countdown ring in the last 5 s; a live level meter drives the equalizer bars (same `v2-eq` look as the hero, inside the panel header) using an `AnalyserNode`.
- **Transcript**: on stop, show "Listening…" → post to `/stt` → the returned text is inserted as the visitor's message and sent through the existing `send()` (so every guard, limit and analytics event applies). Empty text → inline `VOICE_HEARD_NOTHING` copy, no send.
- **Speaking**: a speaker toggle in the panel header ("Read replies aloud"), default ON after the first voice use and OFF otherwise, remembered in `sessionStorage`. When on, each new assistant reply is spoken (`speechSynthesis`, or `/tts` audio when `VOICE_TTS=aura`), the equalizer animates while speaking, a tap on the equalizer or any new input stops speech. iOS unlock: on the first mic press, speak an empty utterance inside the gesture so later `speak()` calls are allowed.
- **Disclosure**: first voice use shows one line under the composer: `VOICE_DISCLOSURE` = "Voice uses your microphone only while you hold the button. Audio isn't stored."
- **Reduced motion**: the equalizer shows static bars; no pulsing.
- **Analytics** (through `track()`): `concierge_voice_start`, `concierge_voice_transcribed { seconds }`, `concierge_voice_empty`, `concierge_voice_reply_spoken { mode: 'browser'|'aura' }`, `concierge_greeting_played` (the recorded opening greeting started; not a spoken reply, so it is not counted in `concierge_voice_reply_spoken`), `concierge_voice_error { reason: 'permission'|'unsupported'|'server'|'budget' }`. No audio or text in params.

Copy (add to `copy.ts`): `VOICE_BUTTON` "Hold to talk" / `VOICE_BUTTON_DESKTOP` "Click to talk", `VOICE_STOP` "Stop", `VOICE_LISTENING` "Listening…", `VOICE_HEARD_NOTHING` "I didn't catch that. Try again or type your question.", `VOICE_OFF` "Voice is taking a break today. You can still type.", `VOICE_SPEAK_TOGGLE` "Read replies aloud", `VOICE_DISCLOSURE` as above.

## 2. Worker tasks (`/concierge-worker`)

V1. `wrangler.jsonc`: add `"ai": { "binding": "AI" }` and vars `VOICE_TTS` (`browser`), `VOICE_SPEAKER` (`asteria`), `VOICE_DAILY_STT_SECONDS` (`9000`), `VOICE_SESSION_SECONDS` (`180`), `VOICE_DAILY_TTS_CHARS` (`20000`). `Env` types. `/health` voice block. Tests pin the config.
V2. `src/stt.ts` + route: multipart parsing with the size cap enforced before reading the whole body, MIME allowlist, base64 conversion, Workers AI call with one retry and 15 s timeout, transcript sanitizing. Tests with a stubbed `env.AI.run` (vitest-plugin supports binding stubs; if not, inject through `AppDeps`): happy path, empty transcript, oversized → 400, wrong MIME → 400, AI throws twice → 503, limits and Turnstile rules, counters incremented by the right seconds, logs contain no transcript.
V3. `src/tts.ts` + route behind the flag; 404 when off; tests for the flag, the char counter, and the raw-response pass-through.
V4. README: voice section (how it works, the free-plan budget math, turning on the premium voice: upgrade to Workers Paid, set `VOICE_TTS=aura`, redeploy).
V5. `npm test`, `tsc`, dry-run. A manual check with a real 5-second clip: generate with macOS `say -o clip.aiff "what do you do"` → `afconvert clip.aiff clip.wav -d LEI16@16000` → `curl -F audio=@clip.wav -F sessionId=<uuid> http://localhost:8787/stt` (note: `wrangler dev` runs Workers AI remotely and needs the logged-in account, so this spends a few neurons).

## 3. Widget tasks (`/vite-app/src/components/concierge/`)

W1. `voice/recorder.ts`: feature detection, MIME choice, start/stop, 20 s cap, level meter via `AnalyserNode`, cleanup of tracks. Tests with mocked `MediaRecorder`/`AudioContext`.
W2. `voice/speech.ts`: `speak(text, mode)`, `stop()`, voice selection (prefer `en-US`, names containing "Samantha", "Ava", "Google US English"), iOS unlock, `onstart/onend` hooks for the equalizer; `/tts` playback path with an `<audio>` element when mode is `aura`. Tests with a mocked `speechSynthesis`.
W3. `api.ts`: `postStt(blob, mime, sessionId, token?)` and `fetchTts(text)`; typed results per §1.1–1.2.
W4. `useConcierge.ts`: `voice` state (`idle|recording|transcribing|speaking|off`), `startVoice/stopVoice`, `speakEnabled`, wiring to `send()`, `voice_unavailable` handling, analytics events.
W5. Components: `MicButton`, the header `Equalizer` (reuse the hero bar styles scoped under `.thg-cc-eq`), the speaker toggle, the disclosure line, countdown ring; CSS in `concierge.css` (lazy chunk; nothing voice-related in the main bundle).
W6. Tests for W3–W5: unsupported browser hides the mic; permission denied → error copy + event; transcript → `send()` called once with the text; empty → copy, no send; `voice_unavailable` → mic hidden for the session; speak toggle persisted; reduced motion.
W7. Browser checks: Chrome desktop (click-to-toggle), the pane's mobile emulation for layout only; a real iPhone (Safari) and an Android phone are required for sign-off because `MediaRecorder` MIME support and `speechSynthesis` behavior differ there (the coordinator asks David to test both and reports what he sees).
W8. Privacy page: one paragraph under the AI chat section about the microphone and Workers AI processing.

## 4. Acceptance

- Hold/click, speak "what do you do", release: the transcript appears as the visitor's message within ~2 s on Wi-Fi, the normal reply arrives, and it is read aloud while the equalizer moves; stopping works by tapping.
- Everything still works by typing when the mic is denied, unsupported, or the budget is spent; the text chat never calls Workers AI.
- `/stt` rejects a 2 MB upload and a `text/plain` upload; 31 requests in 10 min from one IP → 429; the day counter stops voice at 150 minutes with `503 voice_unavailable`.
- No transcript text, audio bytes, or secrets in logs; the main bundle grows by less than 2 KB gzipped (voice code lives in the panel chunk).
- Lighthouse unchanged within noise; no new accessibility failures (mic button labeled, `aria-pressed`, countdown has text equivalent).

## 5. Out of scope

Full-duplex conversation, barge-in, the (866) phone line, voice on the static privacy/terms pages, languages other than English.
