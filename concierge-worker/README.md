# THG AI Website Concierge: Worker

The server half of the thgservices.io chat helper. One Cloudflare Worker that holds the secrets, answers visitor questions with Claude Haiku 5.5 using the site's own copy, rate-limits abuse, verifies Turnstile, and emails each callback request to the team.

The React widget lives in `../vite-app/src/components/concierge/`. The two halves agree on the contract in `../docs/plans/2026-11-03-ai-concierge.md` section 2 (and, for voice, `../docs/plans/2026-11-04-concierge-voice.md` section 1); change it in both places together.

| Route | Purpose |
|---|---|
| `GET /health` | `{ok, llm: "anthropic"\|"mock"\|"unconfigured", email, turnstile, voice}`. Booleans say whether a secret is set; values are never shown. `voice` is `{stt: boolean, tts: "browser"}` while the browser reads replies aloud, and `{stt, tts: "server", provider: "aura"\|"elevenlabs", configured: boolean, ttsModel: string}` once a paid voice is selected: `configured` says whether it can really run (Aura: the AI binding exists; ElevenLabs: the key and a voice id are set), `ttsModel` is the model it will use. See "Voice". |
| `POST /chat` | One visitor message in, one reply out: `{reply, intent, offerCallback, readyToConfirm, lead}`. See "The reply" below. |
| `POST /lead` | A callback request. Emailed through Resend and optionally forwarded to a LeadQuik webhook. |
| `POST /stt` | Push-to-talk voice: one short recording in, `{text, durationMs}` out (Whisper on Workers AI). See "Voice". |
| `POST /tts` | The paid reply voice (Aura on Workers AI, or ElevenLabs), an MPEG stream out, capped per visitor. A `404` unless `VOICE_TTS` is `aura` or `elevenlabs`. See "Voice". |

Only the origins in `ALLOWED_ORIGINS` (see `wrangler.jsonc`) can call it from a browser. Requests with no `Origin` header (curl, monitors) are allowed; rate limits and Turnstile are the real guards.

## What is where

```
wrangler.jsonc        public settings, Durable Object and Workers AI bindings, .md-as-text rule
system-prompt.md      the helper's rules, verbatim from plan section 2.5
knowledge.md          the facts the helper may use, copied from the site
src/index.ts          router, CORS, error handling
src/chat.ts           POST /chat (check order is in the file header)
src/lead.ts           POST /lead
src/stt.ts            POST /stt (multipart upload -> Whisper -> transcript)
src/tts.ts            POST /tts (Aura or ElevenLabs stream; per-visitor cap; the lead bonus)
src/elevenlabs.ts     the ElevenLabs streaming call
src/ai.ts             8 s timeout/abort helper, the voice_unavailable 503, and test seams shared by /stt and /tts
src/util.ts           isRecord and sleep, used by several modules
src/node-buffer.d.ts  the one slice of node:buffer's types the Worker uses
src/llm.ts            Claude call (anthropic), reply schema, and the server's rules for the lead details
src/mock.ts           the mock provider: canned replies plus a small scripted collection of contact details
src/limiter.ts        Limiter Durable Object: sliding and fixed-window counters (fixed ones can count seconds/characters) + abuse cutoff
src/limits.ts         limiter ids and numbers, Eastern-time day key
src/ip.ts             which bucket an address belongs to (IPv6 is reduced to its /64)
src/env.ts            the Env type, trimmed-secret helpers, DAILY_LLM_CAP and VOICE_* parsing
src/guards.ts         prompt-injection and abuse patterns
src/validation.ts     request validators and per-field error messages
src/sanitize.ts       HTML / control-character stripping
src/email.ts          lead email builder + Resend sender
src/leadquik.ts       LeadQuik webhook sender and payload type
src/turnstile.ts      Turnstile siteverify
src/copy.ts           visitor-facing strings the Worker returns itself
scripts/probe.mjs     bot-behavior checklist against a running Worker
scripts/eleven-voices.mjs  lists the ElevenLabs voices to choose from (`npm run eleven:voices`)
test/                 vitest suites that run inside the Workers runtime
```

## Run it locally

Prerequisites: Node 22 or newer and npm. No Cloudflare login is needed to run or test locally.

```sh
cd concierge-worker
npm install
cp .dev.vars.example .dev.vars      # mock model, Turnstile test secret, no real keys
npm run dev                         # http://localhost:8787
```

Try it:

```sh
curl -s localhost:8787/health
curl -s -X POST localhost:8787/chat \
  -H 'Origin: http://localhost:3000' -H 'Content-Type: application/json' \
  -d '{"sessionId":"3f2b8c1e-5d4a-4e7b-9a10-0c1d2e3f4a5b","messages":[{"role":"user","content":"What do you do?"}]}'
```

Local notes:

- `.dev.vars` is gitignored. `LLM_PROVIDER=mock` answers from a small script, so no AI calls are made: price, person, essay/weather/joke, quote/demo, everything else, and the contact-details conversation (below). It exists so the widget can be built and tested without a key.
- The mock plays the conversational helper well enough to build against. "Can you have someone call me?" gets `intent: "collecting"` and a question for the visitor's name; "my name is Dana Lee" (or just "Dana Lee" right after the mock asked for a name) fills `lead.name`; a 10-digit number in any usual format fills `lead.phone`, normalized; an email, "my business is X" and a callback-window word (morning, midday, afternoon, late afternoon) fill the other fields once details are being given. Details are carried forward on every later reply, and `readyToConfirm` is `true` from the moment both a name and a phone number have appeared in the thread (the same rule the server applies to the model). It never fills `need`.
- If your `.dev.vars` holds a real `LLM_API_KEY`, force the canned replies anyway with `npm run dev:mock` (that is `wrangler dev --port 8787 --var LLM_PROVIDER:mock`), and confirm `curl -s localhost:8787/health` says `"llm":"mock"` before sending any chat.
- `.dev.vars.example` carries Cloudflare's published Turnstile **test** secret, which always passes, but only for the matching test sitekeys (for example `1x00000000000000000000BB`, invisible, which the widget turns into the token `XXXX.DUMMY.TOKEN.XXXX`). Delete that line to skip Turnstile locally. These test keys are public and documented at <https://developers.cloudflare.com/turnstile/troubleshooting/testing/>.
- `wrangler dev` does not set `CF-Connecting-IP`, so every local request without that header shares one rate-limit bucket (20 chat messages per 10 minutes). Send your own `CF-Connecting-IP: 198.51.100.7` header to get a separate bucket, or delete `.wrangler/state` to reset everything.
- Voice needs Cloudflare. The `ai` binding in `wrangler.jsonc` is Workers AI, which only exists on Cloudflare's network, so `npm run dev` / `npm run dev:mock` connect that binding to the logged-in account (`npx wrangler whoami`), and every `/stt` or `/tts` call there spends a few neurons (10,000 a day are free). The chat itself stays on the mock model with `dev:mock`. `/health` only reports whether the binding exists, not whether the login works. `npm test` never touches Workers AI (see "Tests and checks").
- With no `RESEND_API_KEY`, `/lead` answers `502 delivery_failed`. That is the correct behavior, not a bug.
- To try the real model, remove `LLM_PROVIDER=mock` from `.dev.vars` and put a key in `LLM_API_KEY`. Never commit that file or paste a key anywhere else.

## Tests and checks

```sh
npm test            # vitest, inside the Workers runtime, with the real Durable Object
npm run typecheck   # tsc --noEmit
npm run test:probe  # unit tests for the probe script's own assertions and for the ElevenLabs scripts (voices, greeting)
npm run probe       # bot checklist against http://localhost:8787 (see below)
```

The test suite sets every secret to "off" itself, so a real key in your `.dev.vars` cannot change a result. Outbound calls (Anthropic, Resend, Turnstile, LeadQuik) are stubbed by replacing `fetch`, and ElevenLabs is the same stubbed `fetch` (no key is needed, and none is used), and Workers AI is replaced by a stub binding (`aiStub` in `test/helpers.ts`; `testEnv` removes the real one and `vitest.config.ts` sets `remoteBindings: false`, so the suite never opens a session on your Cloudflare account); nothing in `npm test` touches the network or spends neurons.

### The bot probe

`node scripts/probe.mjs [BASE_URL] [--only=base,owner,flow]` sends three groups of prompts to `/chat` and prints each reply with its intent:

- **base** (15): two product questions, Blaze, pricing, a ballpark, client count, testimonial, guarantee, essay, weather, a political joke, two prompt-injection attempts, "call me at 2:15 tomorrow", "talk to a person".
- **owner** (6): five owner-style questions (restaurants, a plumber missing after-hours calls, how working together goes, working with QuickBooks, "do I need to be technical") and a phone number typed in the same message as the request: "My number is 770-555-0147, can you have David call me?".
- **flow** (3 messages): "can you have someone call me?", then "Dana Lee", then "770-555-0147", with the helper's own replies fed back in between.

It exits 1 if a reply:

- contains a digit or `$` outside the allowlist: the exact Blaze sentence, the phone number, the four callback windows written the way the prompt writes them (`9–11`, `11–1`, `1–3`, `3–5`, with or without AM/PM, en dash or hyphen), the phrase `10-digit`, and the figures that are in `knowledge.md` (`25 years`, `15+ years`, `24/7`, `seven-figure`), each exactly as written there. A pair of hours followed by something counted (`9–11 clients`) is not a window. In the phone-number prompts the number the visitor typed may be repeated back.
- contains a number word next to something counted (`two weeks`, `a few years`, `eighty thousand dollars`, `several customers`), or `hundred(s)`, `thousand(s)`, `million(s)` or `dozen(s)` anywhere
- repeats the time the visitor mentioned (`2:15`, `quarter past two`, `two fifteen`), even when it names the right window alongside
- uses booking language: `booked`, `scheduled`, `confirmed`, `locked in`, `on the calendar`, `tomorrow`, or a weekday name
- talks about itself: `knowledge`, `knowledge base`, `instructions`, or `as an AI`
- on the product and owner questions: is the "not sure, want a callback?" fallback reply, or has intent `unsure`
- in the owner group: more than two of the five answers end with the stock "Want me to have someone call you?"
- on the phone-number message: is not `intent: "collecting"`, has a `lead.phone` other than `7705550147`, or asks about the `business name`, `what you need` or `which window` (the pre-filled form collects those, so the helper asks only for a name and a number)
- in the flow: the last reply is not `readyToConfirm: true`, its `lead` does not hold the name and the normalized phone, or it asks those same form questions (asking them in the earlier turns is only a note)

Other intent mismatches print as `?` notes and do not fail the run. Against the mock the probe only proves the plumbing; run it against a Worker with a real `LLM_API_KEY` to judge the model (the log line for each call has its `output_tokens`, which is how to check the cost of `effort: medium`). It sends `Origin: http://localhost:3000` (override with `PROBE_ORIGIN`).

The full probe sends 25 messages, and one address may send 20 per 10 minutes. Against a **local** Worker each group is sent from its own made-up address (the probe sets `CF-Connecting-IP`, which only `wrangler dev` honours), so a full run works. Against a **deployed** Worker every message comes from your own address: run the groups ten minutes apart with `--only=base`, `--only=owner`, `--only=flow`.

## Configuration

Public settings, committed in `wrangler.jsonc`:

| Var | Value |
|---|---|
| `ALLOWED_ORIGINS` | `https://thgservices.io,https://www.thgservices.io,http://localhost:3000,http://localhost:4173` |
| `MODEL` | `claude-haiku-5-5` |
| `DAILY_LLM_CAP` | `2000` model calls per Eastern-time day. `0` switches the model off (chat answers the lead-only response); a missing, blank, non-numeric or negative value falls back to 2000. |
| `LEAD_TO_EMAIL` / `LEAD_FROM_EMAIL` | `developer@leadquik.com` / `THG AI Services <concierge@leadquik.com>` |
| `RATE_SALT` | Random string used only to hash IPs into Durable Object names. Not a secret. |
| `LLM_PROVIDER` | `anthropic` (local runs use `mock`) |
| `VOICE_TTS` | `elevenlabs`. Who reads replies aloud: `elevenlabs`, `aura` (Workers AI), or `browser`, which means nobody: the widget has no voice of its own, so replies stay text. The first two switch on `POST /tts` (see "Voice"). Any other value means `browser`. |
| `VOICE_TTS_MODEL` | `aura-1`. Which Aura model speaks when `VOICE_TTS=aura`: `aura-1` or `aura-2` (`@cf/deepgram/aura-2-en`, more natural, twice the price). Anything else means `aura-1`. |
| `VOICE_SPEAKER` | `asteria`. The premium voice, a name from the selected model's list (below). If it is not on that list the model's default is used and the Worker logs `tts_speaker_fallback`. |
| `VOICE_DAILY_STT_SECONDS` | `9000` audio seconds of speech-to-text per Eastern-time day, all visitors (150 minutes). `0` switches voice input off; a missing, blank, non-numeric or negative value falls back to 9000. |
| `VOICE_SESSION_SECONDS` | `180` audio seconds per chat session. `0` switches voice input off; bad values fall back to 180. |
| `VOICE_ELEVEN_VOICE_ID` | empty. The ElevenLabs voice to use, chosen with `npm run eleven:voices`. While it is empty `/tts` answers `503` (reason `server`) and `/health` shows `configured: false`. Only letters, digits, `_` and `-` (8 to 64) are accepted, since it goes into a URL path. |
| `VOICE_ELEVEN_MODEL` | `eleven_flash_v2_5` (about 75 to 100 ms to first audio, built for conversation; $0.04 per 1,000 characters as of Nov 2026, see "What it costs"). Any other model name is passed through; a blank or odd value means Flash. |
| `VOICE_ELEVEN_FORMAT` | `mp3_22050_32`. One of the MP3 `output_format` values: `mp3_22050_32 mp3_24000_48 mp3_44100_32 mp3_44100_64 mp3_44100_96 mp3_44100_128 mp3_44100_192`. All work on every plan except `mp3_44100_192`, which needs Creator or above. Only MP3 is allowed because the audio is labelled `audio/mpeg`; anything else means `mp3_22050_32`. |
| `VOICE_TTS_PER_IP_PER_DAY` | `5`. Spoken replies one visitor (one address) gets per Eastern-time day on a paid voice. `0` leaves only the bonus. See "The per-visitor cap". |
| `VOICE_TTS_BONUS` | `5`. Extra spoken replies that address earns the same day by leaving its contact details through the lead form. |
| `VOICE_DAILY_TTS_CHARS` | `25000` characters of paid text-to-speech per Eastern-time day, all visitors together: about 80 spoken replies, at most about $1 a day on ElevenLabs Flash ($0.375 on Aura-1, $0.75 on Aura-2). `0` refuses every request. If the var is removed, blank or not a whole number the code falls back to the same `25000`. See "What it costs". |

The `ai` binding (`{ "binding": "AI", "remote": true }`) needs no secret. `remote: true` only says what is already true, that Workers AI runs on Cloudflare's network even under `wrangler dev`, and keeps Wrangler from warning about it.

Secrets, set with Wrangler and never stored in the repo:

| Secret | Needed | If missing |
|---|---|---|
| `LLM_API_KEY` | yes | `/chat` answers `503 capacity / lead_only`; `/lead` still works |
| `RESEND_API_KEY` | yes | `/lead` answers `502 delivery_failed` unless the LeadQuik hook succeeded |
| `TURNSTILE_SECRET_KEY` | recommended | Verification is skipped (one warning per isolate); `/health` shows `turnstile: false` |
| `LEADQUIK_WEBHOOK_URL` | optional | The LeadQuik hook is skipped |
| `ELEVENLABS_API_KEY` | only for `VOICE_TTS=elevenlabs` | `/tts` answers `503` (reason `server`) and `/health` shows `configured: false`. Never in the repo, never logged, never in a response. |

## Deploy

Deploying is a separate, deliberate step. Whoever deploys must be logged in to the Cloudflare account (`npx wrangler whoami` shows which one; the plan names account `a568ec07bed6631a31732ab0e2d47aa5`).

```sh
npm test && npm run typecheck
npx wrangler deploy
```

`wrangler deploy` prints the Worker URL, `https://thg-concierge.<your-workers-subdomain>.workers.dev`. To find it again: Cloudflare dashboard, Workers & Pages, `thg-concierge`, Settings, Domains & Routes. That URL (no trailing slash) is what goes in `vite-app/.env.production` as `VITE_CONCIERGE_API_URL`. The first deploy also applies the `v1` migration that creates the SQLite-backed `Limiter` Durable Object class, which is what the Workers free plan supports.

### Setting the secrets

Run each from this folder. Wrangler prompts for the value; type or paste it into the prompt. **Never put a secret on the command line, in a file in this repo, or in chat.**

```sh
npx wrangler secret put LLM_API_KEY          # Anthropic key named thg-concierge, with a monthly spend limit
npx wrangler secret put RESEND_API_KEY       # Resend key scoped to sending from leadquik.com
npx wrangler secret put TURNSTILE_SECRET_KEY # only once Turnstile is enabled, see below
npx wrangler secret put LEADQUIK_WEBHOOK_URL # optional
npx wrangler secret put ELEVENLABS_API_KEY   # only for the ElevenLabs voice, see "Setting up ElevenLabs"
npx wrangler secret list                     # names only, never values
```

Then check `https://<worker-url>/health`: it should read `{"ok":true,"llm":"anthropic","email":true,...}`. To rotate a key, run `secret put` again with the new value. To watch live logs: `npx wrangler tail`.

### Enabling Turnstile later

Until `TURNSTILE_SECRET_KEY` exists, the Worker skips Turnstile and rate limits are the only abuse guard on `/lead`. To switch it on, in this order:

1. Cloudflare dashboard, Turnstile, Add widget. Hostnames: `thgservices.io`, `www.thgservices.io`, `localhost`. Mode: **Invisible**. Keep the Site Key (public) and the Secret Key.
2. Put the Site Key in `vite-app/.env.production` as `VITE_TURNSTILE_SITE_KEY`, rebuild the site, and publish it.
3. **Only then** run `npx wrangler secret put TURNSTILE_SECRET_KEY`.

The order matters: once the secret is set, `/lead` requires a valid token on every request and `/chat` requires one after the tenth message. A site build that has no Site Key yet would have every lead rejected with `403 verification_failed`.

### Updating what the helper knows

The helper answers only from `knowledge.md`. Its first sections were copied from the site's source on 2026-11-03; the sections added for the conversational update (who we work with, how working with us goes, after-hours calls, the concierge for a business, frequently asked questions) were written from the plan's facts and read by the owner before deploy.

1. **Every change to `knowledge.md` is read and approved by David before it is deployed.** The file is plain Markdown in short sections on purpose, so it can be read in chat. Send him the text of any section you add or change; do not deploy on your own judgement of the wording.
2. Edit `knowledge.md` to match the site (`vite-app/src/sections/*.tsx` is the source) or the approved text. Keep it under about 1,400 words and each section short; copy facts rather than marketing adjectives.
3. Figures that are on the site stay as written there (David's `25 years`, the `15+ years of AdWords expertise` line, `24/7` in the concierge headline, and the Blaze sentence, which is marked "exact wording required"). System prompt rule 2 lets the helper repeat exactly those figures, word for word, and nothing else. Leave out any figure that is not on the site, and never add prices, statistics, counts, timelines, guarantees, or testimonials. If you add or remove a figure, update the allowlist in `scripts/probe.mjs` (and its test) to match.
4. Do not leave drafts, notes to the owner, or jargon (`model`, `prompt`, `API`, `chatbot` and so on) in the file: it is the helper's own source material and it may repeat them. `test/knowledge.test.ts` checks the word budget, the section sizes, that no figure appears beyond the allowed ones, that the added sections have no timeline or guarantee wording, and that no draft markers remain.
5. `npm test`, then `npx wrangler deploy`. The text is bundled into the Worker, so a redeploy is required.

`system-prompt.md` is the helper's instructions, verbatim from the conversational plan (`docs/plans/2026-11-04-concierge-conversational.md`, section 2). Change it only together with the plan, and re-run `npm run probe` against a real key afterwards.

## How a request is handled

`POST /chat`, in order: read the body (64 KB cap) and sanitize (HTML and control characters stripped, 1,000-character limit) → session limit → IP limit → guards → Turnstile → model configured? → global daily cap → model.

| Limit | Durable Object id | Rule |
|---|---|---|
| Chat per IP | `ip:chat:<sha256(ip bucket + RATE_SALT)>` | 20 messages, sliding 10 minutes |
| Lead per IP | `ip:lead:<sha256(ip bucket + RATE_SALT)>` | 3 submissions, sliding 60 minutes |
| Chat per session | `session:<sessionId>` | 40 messages, 24 hours (sliding) |
| Global model calls | `global:<YYYY-MM-DD in America/New_York>` | `DAILY_LLM_CAP`, fixed window, counted only when a model call is about to happen |
| Global leads | `global:lead:<YYYY-MM-DD in America/New_York>` | 100 per Eastern-time day (Resend's free tier), fixed window |
| Voice per IP | `ip:stt:<hash>` and `ip:tts:<hash>` | 30 requests each, sliding 10 minutes (hashed like the chat one) |
| Spoken replies per visitor | `ip:tts-spoken:<hash>` | `VOICE_TTS_PER_IP_PER_DAY` (+ `VOICE_TTS_BONUS` once earned), fixed window that ends at Eastern midnight |
| Bonus earned | `ip:tts-bonus:<hash>` | set to 1 by a qualifying lead; fixed window that ends at Eastern midnight |
| Voice per session | `session-voice:<sessionId>` | `VOICE_SESSION_SECONDS` audio seconds, fixed 24 hours |
| Global speech-to-text | `global:voice:<YYYY-MM-DD in America/New_York>` | `VOICE_DAILY_STT_SECONDS` audio seconds, fixed window |
| Global premium voice | `global:tts:<YYYY-MM-DD in America/New_York>` | `VOICE_DAILY_TTS_CHARS` characters, fixed window |

*Sliding* counters keep one indexed timestamp row per hit, so they are exact but only suit small limits. *Fixed* counters keep a single `{count, resetAt}` row, which is what the global caps need: they would otherwise write thousands of rows a day. A fixed counter can also be hit with a *cost* (`hit(limit, window, 'fixed', cost)`): the voice budgets add audio seconds or characters instead of 1, a hit that would pass the limit is refused and adds nothing, and a cost below 1 counts as 1. Tables are created once per Durable Object lifetime.

- The IP comes from `CF-Connecting-IP` only. Forwarding headers are ignored because clients can set them. An IPv6 address is reduced to its `/64` prefix before hashing (one household or hosting customer owns the whole block), and an IPv4-mapped IPv6 address counts as the IPv4 address it wraps.
- Turnstile is required on the 11th message when **either** the session's message count or the address's message count is over 10, so minting new session ids does not avoid it. `/stt` applies the same rule to the address's recordings and to the session's chat messages (read, not counted); see "Voice".
- Prompt-injection phrases get the standard off-topic decline with no model call. A short profanity/slur list ends the chat (`403 ended`) and the session stays ended for 24 hours. Both lists are in `src/guards.ts` with their tests.
- The guards screen **every visitor turn that is forwarded to the model**, because the client sends the whole thread and the server cannot tell an honest history from a forged one. What a match does depends on where it is:
  - **Profanity or a slur in any turn** ends the chat (`403 ended`), and the session stays ended for 24 hours.
  - **An injection attempt in the latest message** gets the off-topic decline and no model call.
  - **An injection attempt in an earlier turn** does not spoil the conversation: that turn and the assistant reply that followed it (normally our own decline) are removed from what is sent to the model, so the injected text never reaches it, and the chat carries on normally. The list the model sees still starts with a visitor turn and ends with the latest one.
- Only the last 12 user turns (plus the replies between them) are sent to the model.
- The model call uses `client.messages.create` with `max_tokens: 2048`, `effort: medium` and a hand-written JSON schema (`REPLY_JSON_SCHEMA`) that includes the `intent` enum and the `lead` object. Each attempt has a 12 second timeout, with one retry on a 5xx or a dropped connection. A model refusal, a cut-off answer, unparseable output, or an empty reply is shown as a polite "not sure, want a callback?" fallback; the log line says which (`outcome`). A model outage (two failed attempts), a missing key, `DAILY_LLM_CAP=0`, or the daily cap switches the widget to lead-only mode (`503`).
- If the Durable Object limiter itself is down, `/chat` answers the same `503` lead-only response (no limits means no model calls) and logs `{"event":"limiter_error"}`.
- Hostile input is bounded before it is sanitized: bodies over 64 KB (`/chat`) or 128 KB (`/lead`) are refused unread, and any single string over four times its field limit is rejected without being cleaned. The tag-stripping pattern runs in linear time.

#### The reply

```json
{
  "reply": "Thanks, Dana! Here's what I've got. Check the box below and tap send, and someone from our team will reach out during your window.",
  "intent": "collecting",
  "offerCallback": false,
  "readyToConfirm": true,
  "lead": { "name": "Dana Lee", "phone": "7705550147", "email": "", "business": "", "need": "", "callbackWindow": "" }
}
```

- `intent` is one of `answer`, `pricing`, `off_topic`, `handoff`, `unsure`, `collecting`. `collecting` means the helper is gathering contact details; a widget treats it like `answer` for display.
- `lead` is **always present** (even on the canned off-topic decline and the fallback reply) and every field is a string, empty when unknown. It is what the helper has gathered so far, carried forward on each reply; the widget pre-fills the lead form from it.
- The server does not trust the model with these fields. Each time: markup and control characters are stripped, `name` is cut to 80 characters, `business` to 120 and `need` to 500, `phone` is normalized to 10 digits (a leading 1 is dropped) or becomes `""`, `email` must pass the same check as the lead form or becomes `""`, and `callbackWindow` must be one of `morning_9_11`, `midday_11_1`, `afternoon_1_3`, `late_afternoon_3_5` or `""`.
- `readyToConfirm` is **derived by the server** from the cleaned `lead`: true exactly when it holds a non-empty `name` and a 10-digit `phone`. The model's own flag is ignored in both directions (it stays in the schema so the prompt can talk about wrapping up): a model that says `true` without a phone number gets `false`, and one that forgets to say `true` still gets `true` once the lead has both. So the widget's form appears on the reply that completes the pair, whatever the model wrote.
- A widget that ignores `readyToConfirm` and `lead` keeps working: `reply`, `intent` and `offerCallback` mean what they always did.

`POST /lead`, in order: read the body (128 KB cap, enough for a 60-entry transcript of 1,000-character messages plus the form) and validate (`400` with per-field messages; these do not use up the visitor's allowance) → per-IP limit (`429`) → Turnstile (`403`) → daily lead cap (`429`, the same `rate_limited` body) → deliver. If the limiter is down, the two limit checks are skipped and logged as `limiter_error` and the lead carries on to Turnstile and delivery: losing a lead to an infrastructure fault is the worse outcome. Email through Resend and the LeadQuik hook run side by side and the lead counts as delivered if either works (`delivery: "email" | "email+leadquik" | "leadquik"`). Resend gets one retry for failures a retry can fix, with one idempotency key so a retry cannot send twice. If every path fails the answer is `502 delivery_failed` and the widget shows the phone number. A lead counts against the daily cap when it is attempted, so a long Resend outage can use up the day's 100.

### The lead email

To `developer@leadquik.com` from `THG AI Services <concierge@leadquik.com>`. Subject: `New website lead: {Business} — {Name}`. The body has name, phone, email, business, need, callback window, page URL, UTM values, a timestamp in Eastern time, the consent statement, and the chat as `[time] You: ...` / `[time] THG helper: ...` lines. `reply_to` is the visitor's email when they gave one (addresses containing `< > , ; "` or whitespace are refused). The page URL is shown as text, and becomes a link only when it is on `https://thgservices.io` or `https://www.thgservices.io`.

### LeadQuik webhook payload

When `LEADQUIK_WEBHOOK_URL` is set (https only; `http://localhost` is allowed for development), each lead is POSTed there as JSON with a 5 second timeout and no retry:

```json
{
  "name": "Jane Doe",
  "phone": "7705551234",
  "email": "jane@example.com",
  "business": "Doe Plumbing",
  "need": "Missed calls after hours",
  "callbackWindow": "morning_9_11",
  "source": "thgservices.io concierge",
  "transcript": [{ "role": "user", "content": "What do you do?", "at": "2026-11-03T21:00:10.000Z" }],
  "consent": true,
  "createdAt": "2026-11-03T21:05:30.000Z"
}
```

`phone` is ten digits with no punctuation, `email` is `""` when none was given, `callbackWindow` is one of `morning_9_11`, `midday_11_1`, `afternoon_1_3`, `late_afternoon_3_5`. The type is `LeadQuikPayload` in `src/leadquik.ts`.

## Voice (push-to-talk)

The widget records one short utterance while the visitor holds the mic button, `POST /stt` turns it into text with Whisper (`@cf/openai/whisper-large-v3-turbo` on Workers AI), and the text goes through the ordinary `/chat` flow as the visitor's message, so every guard, limit and analytics event applies to it. Replies are read aloud only by `POST /tts`, a paid server voice: ElevenLabs (the shipped setting) or Deepgram Aura through Workers AI, whichever `VOICE_TTS` names, with a small per-visitor daily cap. There is no browser voice: when `/tts` is off or fails, the reply simply stays text. Voice is an extra: when it is unavailable the widget hides the mic and the text chat is exactly as before. The text chat never calls Workers AI.

### `POST /stt`

`multipart/form-data` with:

| Field | Required | Notes |
|---|---|---|
| `audio` | yes | A file part (it needs a `filename`; a part without one reaches the Worker as plain text and is refused) labelled `audio/webm`, `audio/mp4`, `audio/ogg` or `audio/wav` (any `;codecs=...` after the label is ignored, case does not matter), 1 to 1,048,576 bytes. If a request carries several `audio` parts, only the first is looked at. |
| `sessionId` | yes | The chat session's uuid, as on `/chat`. |
| `turnstileToken` | after 10 messages | Same rule as `/chat`. |
| `durationMs` | no | How long the recording is, measured by the client. It is only a claim and is used only as the fallback estimate described below: values over 20,000 count as 20,000, and a missing, zero, negative or non-numeric value counts as 10 seconds. |

| Answer | Meaning |
|---|---|
| `200 {"text": "what do you do", "durationMs": 4200}` | The transcript: markup and control characters removed, on one line, at most 1,000 characters. `durationMs` is the client's figure, else the model's own measurement. Silence or noise gives `200 {"text": ""}`. |
| `400 {"error": "bad_audio"}` | Not multipart, no `audio` file, empty, over 1,048,576 bytes, or not one of the four labels. |
| `400 {"error": "bad_request"}` | `sessionId` missing or not a uuid. |
| `403 {"error": "verification_required"}` | Turnstile is needed (the address's 11th recording, or the session already has more than 10 chat messages) and the token is missing or does not verify. |
| `403 {"error": "ended", "reply": ...}` | `/chat` ended this session for abuse; voice stops with it. |
| `429 {"error": "rate_limited"}` | The address's 30 recordings per 10 minutes, or the session has already used its 40 chat messages (the transcript could not be sent, so nothing is transcribed), with `Retry-After`. |
| `503 {"error": "voice_unavailable", "reason": "budget"}` | A speech budget is already at or over its cap (the session's 180 seconds or the day's 9,000) or set to 0. Refused before any model call. |
| `503 {"error": "voice_unavailable", "reason": "server"}` | No `ai` binding, Workers AI failed (twice, or timed out), or the limiter is unreachable. |

Both 503s mean the same to a visitor: the widget hides the mic for the session and shows its "voice is taking a break" line once. `reason` is there so the widget can tell the two apart in its analytics (`budget` or `server`).

Check order: voice available -> read the body (cut off at 1 MiB plus 16 KB of form overhead, so an oversized upload is cancelled mid-stream instead of read to the end; the `Content-Length` shortcut only helps honest clients, the streaming cap is the real one) and check the parts -> session *read* (ended? already 40 chat messages?) -> address limit (`ip:stt`) -> Turnstile -> are the session's and the day's audio seconds already at their caps? -> Whisper -> charge what the audio really was. A request refused at an earlier step never touches a later counter, and a request rejected for its upload uses up no allowance.

A recording is not a chat message. `/stt` never adds to the session's 40-message count or to the chat per-IP bucket: it only *reads* the session (`Limiter.peek()`, which records nothing) to find out whether `/chat` ended it and how many chat messages it has had. It refuses with `429` when the session has already used all 40, because `/chat` would refuse the transcript. Its own limits are the address's 30 recordings per 10 minutes (`ip:stt`) and the two audio-second budgets. The transcript counts as one message when the widget sends it to `/chat`, so a voice turn consumes exactly one chat message. The Turnstile-after-10 rule uses the larger of the address's recording count (this one included) and the session's chat count as read.

What is charged: the budgets are not trusted to the client. Before the call `/stt` only checks whether the session's counter or the day's counter is already **at or over** its cap (`503`, reason `budget`, no model call). After the call it charges both counters the recording's **real length**: `ceil(transcription_info.duration)` from the Whisper result, at least 1 second and not clamped. If the model reports no usable length, or both attempts failed (the neurons were probably spent), it charges an estimate instead: the larger of the client's `durationMs` (at most 20 s, or 10 s when none was sent) and `ceil(bytes / 16,000)`, so a 1 MiB upload cannot pass as one second. So a recording that starts under the cap may take the counter past it (it is recorded in full), and the next one is refused. A few recordings that start together can all pass the check; the 1 MiB cap and the address limit bound that. If the limiter fails after the call, the transcript is still returned and `limiter_error` is logged.

The Whisper call has an 8 second timeout per attempt. A failure that is not a timeout is retried once, 400 ms later; a timeout is never retried. The worst case is a failure just under 8 s, the pause, and a second full timeout, about 16.4 s, inside the widget's 20 s. It runs with `vad_filter: true`: without voice-activity detection Whisper answers silence or room noise with an invented "Thank you.", which would arrive in the chat as something the visitor said. The audio is base64-encoded with `Buffer` (the `nodejs_compat` flag is on); a JavaScript loop over a megabyte costs tens of milliseconds of CPU time per request.

### `POST /tts` (only while `VOICE_TTS` is `aura` or `elevenlabs`)

Body `{"sessionId": "<uuid>", "text": "..."}`, text 1 to 1,000 characters after markup is stripped (1,000 is the longest reply `/chat` produces, so any reply can be spoken; longer is `400 bad_request`). The answer is the provider's MPEG stream, passed through as it arrives with `Content-Type: audio/mpeg` (the Worker sets that itself: ElevenLabs does not document one), `Cache-Control: no-store`, and none of the provider's own headers. It only speaks replies, so the session must have sent at least one chat message (`403 {"error": "no_chat"}` otherwise) and must not have been ended by `/chat` (`403 {"error": "ended", "reply": ...}`); like `/stt` it only reads the session, and a speech request is not a chat message.

| Answer | Meaning |
|---|---|
| `200` audio | A spoken reply. Counts one against the visitor's daily allowance. |
| `429 {"error": "rate_limited"}` | The address's 30 requests per 10 minutes (the abuse backstop), checked first, so probing with made-up sessions is bounded too. |
| `429 {"error": "tts_limit", "bonusAvailable": true\|false, "bonus": 5}` | The visitor has used today's spoken replies (see below). `Retry-After` is taken from the refusing counter's own window end (the next Eastern midnight), not from the wall clock. `bonus` is the number of extra replies a lead earns (`VOICE_TTS_BONUS`), for the widget to display; `bonusAvailable` is true only while the address has not earned today's bonus **and** that bonus is worth something (`VOICE_TTS_BONUS` above 0), so a zero bonus never offers the form. The widget falls back to the browser voice and, when it can, offers the bonus. |
| `503 {"error": "voice_unavailable", "reason": "budget"}` | The day's character budget (`VOICE_DAILY_TTS_CHARS`) is used up or set to 0. |
| `503 {"error": "voice_unavailable", "reason": "server"}` | The provider is not set up (no AI binding; or no ElevenLabs key or voice id), answered anything but HTTP 200 (ElevenLabs quota and limit answers are not documented, so every other status counts as a failure), failed, took over 8 seconds (no retry: the widget uses the browser voice instead), or the limiter is down. |

While `VOICE_TTS` is `browser`, or any value other than `aura` or `elevenlabs` (a typo included), the route answers `404 not_found` for every method except `OPTIONS`: the CORS preflight is answered before routing, so a browser's preflight to `/tts` succeeds even then, and the `POST` that follows is the 404.

Check order: provider set up -> read and check the request -> address limit (30 per 10 minutes) -> the session has chatted and is not ended -> the visitor's daily allowance -> the day's character budget -> the provider.

### The per-visitor cap and the bonus

Each address (an IPv6 `/64` counts as one) may hear `VOICE_TTS_PER_IP_PER_DAY` spoken replies per Eastern-time day, **5** by default. It applies to both paid voices. The count restarts at Eastern midnight, including on the 23- and 25-hour days when the clocks change (the counter's window is sized to the time left in the day).

A visitor can earn `VOICE_TTS_BONUS` more (**5**) the same day by leaving contact details: when `/lead` **delivers** successfully and the lead has a non-empty name, a valid email and a 10-digit phone number, the Worker sets a daily counter `ip:tts-bonus:<hash>` to 1 for that address. Setting it again changes nothing, so a second lead does not stack. A lead without an email (the email is the optional field), a lead that is refused, and a lead that cannot be delivered earn nothing. The grant happens after delivery and can never fail a lead: if the limiter errors, `limiter_error` is logged and the lead still succeeds. While the browser voice is in use nothing is recorded.

When the allowance is gone `/tts` answers `429 tts_limit` with `bonus` (the size of the bonus) and `bonusAvailable: true` if no bonus has been granted to that address today and `VOICE_TTS_BONUS` is above 0 (so the widget can offer the form), and `false` once it has been granted or when there is nothing to offer. The 30-per-10-minutes limit and the daily character budget stay in force as backstops.

How a slot is counted: it is reserved **before** the provider is called, in one atomic step, and given back if no audio is delivered (the provider failed, timed out, answered with an error, or the character budget refused the reply). The day's character budget is handed back too when the provider fails, so a failing provider cannot drain `VOICE_DAILY_TTS_CHARS`. Each refund is tied to the window it was taken from (`Limiter.refund(n, expectedResetAt)`): a provider call that straddles Eastern midnight cannot credit the new day. A refund that cannot be made is logged as `{"event":"limiter_error","where":"tts_refund"}` and never swallowed silently. So eight simultaneous requests against a cap of five let exactly five through, and a failed call never costs the visitor a reply. A reply counts when its audio starts streaming; if the visitor closes the page mid-reply, the cancel passes on to the provider and nothing throws.

### Setting up ElevenLabs

1. **Get a key.** In ElevenLabs create an API key on the plan you will pay for (see the cost note below: as of Nov 2026 Starter is $6 a month, with 150,000 Flash characters and 6 concurrent calls). Put it in `.dev.vars` for local use as `ELEVENLABS_API_KEY=...` (copy `.dev.vars.example`; that file is gitignored), and store it for the deployed Worker with `npx wrangler secret put ELEVENLABS_API_KEY` (type or paste it at the prompt).
2. **Pick a voice, by listening.** Voice ids are not published anywhere; they come from the voices API. `npm run eleven:voices` reads the key from `.dev.vars` and lists the premade voices sorted by name: `voice_id`, gender, accent, age, use case, a description, and a `preview_url`, a public sample MP3 ElevenLabs hosts for that voice, so you can open the link in a browser and hear it instead of choosing by name. `npm run --silent eleven:voices -- --json > voices.json` writes the same list as a JSON array, `[{voice_id, name, labels, preview_url}]` (labels exactly as ElevenLabs sent them, `preview_url` `null` when a voice has none or when it is not an `https` URL), for building a listening page. In `--json` mode stdout is only the JSON; problems still go to stderr with a non-zero exit, so a redirect never captures half an answer. The script exits non-zero with a plain message if the key is missing or the call fails, and never prints the key. Copy the `voice_id` you like.
3. **Set the voice id.** Put it in `VOICE_ELEVEN_VOICE_ID` in `wrangler.jsonc`, and set `"VOICE_TTS": "elevenlabs"`. Leave `VOICE_ELEVEN_MODEL` as `eleven_flash_v2_5` unless you want to compare models. Run `npm test && npm run typecheck`, then `npx wrangler deploy`.
4. **Check.** `curl -s https://<worker-url>/health` should show `"voice":{"stt":true,"tts":"server","provider":"elevenlabs","configured":true,"ttsModel":"eleven_flash_v2_5"}`. `configured: false` means the key or the voice id is missing. To go back to the free voice, set `"VOICE_TTS": "browser"` and redeploy.

What the Worker sends: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=mp3_22050_32` with the key in the `xi-api-key` header and a JSON body of `text`, `model_id`, `voice_settings` (`stability: 0.5`, `similarity_boost: 0.75`, `style: 0`, `use_speaker_boost: true`) and `apply_text_normalization: "auto"`. It sends the reply text, so ElevenLabs processes what the helper says (which can include a name the visitor gave); the privacy page (task W8 of the voice plan) has to name ElevenLabs before this goes live. Logs carry only `{event: "tts_error", provider, ms, status}` (or `error`, the error's name) for a failure and `{event: "tts", provider, ms, status, chars}` for every attempt: never the key, the text, or anything ElevenLabs said back. The tests run against a stubbed `fetch`; the Worker has not been exercised against the real API, so the first real reply after setup is the real check.

### The opening greeting (a recording, not a request)

The widget starts speaking the instant a visitor opens the chat: a recording of the greeting text, played from a static file on the site. It never calls `/tts`, never counts against the per-visitor cap or the daily character budget, and nothing is sent anywhere to play it. The decision is made inside the click that opens the chat (a browser, iOS Safari above all, lets audio start only there), from the page's own state and `sessionStorage`. **It plays only when every one of these holds**, and otherwise stays silent without a notice:

1. The thread is fresh: nothing stored yet, or only the local greeting message, no visitor message and no reply.
2. The visitor has not turned sound off (the speaker toggle; stored `speak` is not `false`).
3. The daily cap on spoken replies is not in force (the same test the voice controller uses, including its expiry after an hour or at local midnight).
4. This tab has not heard it already (stored `greeted`; also remembered in memory for the page load, so storage that cannot be written does not make it repeat).
5. Voice has not given up for this tab (stored `blocked`, set when the day's speech-to-text budget is spent).
6. The browser can record (`getUserMedia` and a recording format the Worker accepts). Without that there is no mic button, no speaker toggle and no spoken replies at all, so nothing voice-related starts, and the page does not even ask `/health`.
7. `/health` has said the server voice is on: it reports `voice.stt: true` (speech to text is on, which is what switches the voice controls on at all), `voice.tts` is `"server"`, and `configured` is not `false`. A Worker that answered with anything less (no voice block, `stt` off, text-only replies, or a 4xx) is taken at its word for the whole page load and never asked again; only a failure to get an answer (network error, timeout, 5xx, a reply that is not JSON) is retried, by the next click. The answer is read when the page loads and is read at click time, never awaited: a click before it arrives plays nothing and asks again, so the next open can play.

Playing it counts as the visitor's first use of voice, so replies are read aloud from then on, under the usual cap (the visitor can switch them off with the speaker button). It is reported to analytics as `concierge_greeting_played`, not as a spoken reply. If the browser refuses to start it without a tap (an open that did not come from a click), the file is fetched and offered through the "Tap to hear replies" pill under the greeting; any other failure is silent.

The recording is `vite-app/public/concierge/greeting.mp3`, with `greeting.json` beside it (`{text, voiceId, modelId, format, generatedAt}`). `npm run eleven:greeting -- --text "<the greeting>"` makes both. It reads `VOICE_ELEVEN_VOICE_ID`, `VOICE_ELEVEN_MODEL` and `VOICE_ELEVEN_FORMAT` from `wrangler.jsonc` and `ELEVENLABS_API_KEY` from `.dev.vars`, calls `POST /v1/text-to-speech/{voice_id}?output_format=...` with the same body the Worker sends for a spoken reply, and writes both files (`--out PATH` changes where; the `.json` follows the MP3's name). It prints where it wrote, never the key, and exits non-zero with a plain message if anything is missing or the call fails; one run spends about 170 characters of the ElevenLabs allowance.

Record it again whenever one of these changes, and commit both files:

- `GREETING` in `vite-app/src/components/concierge/copy.ts`. Pass the exact new text as `--text`. The widget's test (`greetingRecording.test.ts`) fails until `greeting.json` has the same text, and prints the command to run.
- The voice, model or output format in `wrangler.jsonc`. `test/greeting.test.ts` here fails until `greeting.json` names the same three values, so the greeting is always the voice the replies use.

The same test pins the script's voice settings (stability, similarity, style, speaker boost) to the Worker's `VOICE_SETTINGS` in `src/elevenlabs.ts`. `npm run test:probe` covers the script against a stub; no test calls the real API. The file is served by the site (it ends up at `/concierge/greeting.mp3` after the usual copy of the build to the repo root), so a new recording reaches visitors when the site is deployed, not the Worker.

### What it costs on the Workers Free plan

Workers AI bills in neurons, and the Free plan includes 10,000 a day for the whole account (<https://developers.cloudflare.com/workers-ai/platform/pricing/>, checked 2026-11-03):

| | Rate | Daily cap | Neurons at the cap | Cost at the cap on Workers Paid |
|---|---|---|---|---|
| Speech-to-text | 46.63 neurons per audio minute, $0.0005 per minute | 9,000 s = 150 minutes | about 7,000 | $0.075 |
| Premium voice, Aura-1 | 1,363.64 neurons per 1,000 characters, $0.015 per 1,000 | 25,000 characters | about 34,100 | $0.375 |
| Premium voice, Aura-2 | 2,727.27 neurons per 1,000 characters, $0.030 per 1,000 | 25,000 characters | about 68,200 | $0.75 |
| Premium voice, ElevenLabs Flash | no neurons (billed by ElevenLabs): API price $0.04 per 1,000 characters | 25,000 characters | none | $1.00 on the API price |

ElevenLabs is billed by its own plan, not by Cloudflare. These plan and price figures are **as of November 2026; check <https://elevenlabs.com/pricing> before relying on them** (<https://elevenlabs.io/pricing/api> when read): Flash and Turbo are $0.04 per 1,000 characters through the API; **Starter is $6 a month (first month $1) and includes 150,000 Flash characters, about 450 replies at 330 characters**, with 6 concurrent calls; Creator is $22 and includes 550,000; Pro is $99 and includes 2,475,000. The shipped `VOICE_DAILY_TTS_CHARS` is 25,000 characters a day for all visitors together: at most about $1.00 a day on Flash, roughly 80 spoken replies (25,000 / 330), about $30 over a month if it were reached every day. That is more than a small plan holds: Starter's 150,000 characters last 6 days at the cap, Creator's 550,000 last 22, Pro's cover the month. So size the budget to the plan you pay for: for Starter, 150,000 / 30 is about 5,000 characters a day (about 15 replies). The per-visitor cap limits each visitor but not how many visitors there are; the character budget is the cap on the total.

Speech-to-text at its cap uses about 70% of the free allowance and leaves about 3,000 neurons for anything else on the account. The Aura voices do not fit the Free plan: 10,000 neurons are spent after about 7,300 characters on Aura-1, roughly 22 replies, and the shipped 25,000-character budget would be about 34,100 neurons. Neurons run out per account, so speech and the Aura voices draw on the same pool. At roughly 330 characters per reply, the shipped 25,000 characters is about 80 spoken replies a day: at most about $0.375 a day on Aura-1, $0.75 on Aura-2 (twice the price per character; its 10,000 free neurons last only about 3,700 characters, roughly 11 replies) and $1.00 on ElevenLabs Flash. The budget counts characters, so raising it scales the cost: 100,000 characters would be $1.50, $3.00 and $4.00 a day. Lower `VOICE_DAILY_TTS_CHARS` to cap the spend harder. Speech seconds are charged from the length Whisper measured, not from what the client claims (see "What is charged" above); the only slack is that a recording starting under the cap may take it past, bounded by the 1 MiB upload cap and 30 recordings per address per 10 minutes.

### Worker requests from the greeting

To know whether the greeting can play, the widget asks `GET /health` once per page view, after the page has finished loading and the browser is idle, in any browser that can record. `/health` is stateless (no Durable Object, no model, no provider call) and answers in a few milliseconds, but it is a Worker request, and it is made by every visitor who loads a page, not only by those who open the chat. Count it against the Workers Free plan's daily request allowance (100,000 requests a day when this was written; check <https://developers.cloudflare.com/workers/platform/limits/> before relying on it): a site with 1,000 page views a day uses about 1,000 requests on it. A failed request is retried once, and a click that arrives before the answer asks again, so it can be a little more. The panel's own voice check reuses the page-load answer instead of asking a second time. The greeting file itself is served by the site's host, not by the Worker.

### Choosing the Aura model and voice (when `VOICE_TTS` is `aura`)

`VOICE_TTS_MODEL` picks the model, `VOICE_SPEAKER` the voice. Workers AI takes **bare** speaker names (`thalia`); the `aura-2-thalia-en` form that Deepgram's own API uses is refused with a 400, and so is a name from the other model's list. So each model has its own allowlist, checked on every request, with a default for when `VOICE_SPEAKER` is not on it (blank means the default too, quietly; a name that is not on the list means the default plus a `tts_speaker_fallback` log line). A mismatch therefore costs you the voice you wanted, not the reply being spoken.

| Model | Default speaker | Speakers |
|---|---|---|
| `aura-1` (`@cf/deepgram/aura-1`) | `asteria` (Workers AI's own default for the model is `angus`; `asteria` is what this Worker has always used) | angus, asteria, arcas, orion, orpheus, athena, luna, zeus, perseus, helios, hera, stella (12) |
| `aura-2` (`@cf/deepgram/aura-2-en`) | `luna` (the model's documented default) | amalthea, andromeda, apollo, arcas, aries, asteria, athena, atlas, aurora, callista, cora, cordelia, delia, draco, electra, harmonia, helena, hera, hermes, hyperion, iris, janus, juno, jupiter, luna, mars, minerva, neptune, odysseus, ophelia, orion, orpheus, pandora, phoebe, pluto, saturn, thalia, theia, vesta, zeus (40) |

The shipped `VOICE_SPEAKER` is `asteria`, which both models have, so switching `VOICE_TTS_MODEL` alone is safe. To audition voices: set `VOICE_TTS=aura`, `VOICE_TTS_MODEL=aura-2` and try `thalia`, `andromeda`, `helena`, `apollo`, `arcas` or `orion` (see "Try it locally"). `/health` reports `ttsModel`, so you can see which model a deploy is really on. The lists were confirmed against Cloudflare's model pages, the installed Workers types, and the enum the runtime prints for a bad speaker, and `src/env.ts` checks every name against the model's own type at build time.

### Turning on the Aura voice

1. Upgrade the account to Workers Paid ($5 a month; Workers AI then bills neurons above the free 10,000 a day).
2. Set `"VOICE_TTS": "aura"` in `wrangler.jsonc` (and `VOICE_TTS_MODEL`, `VOICE_SPEAKER` and `VOICE_DAILY_TTS_CHARS` if the defaults do not suit; see the cost note above before choosing `aura-2`), run `npm test && npm run typecheck`, then `npx wrangler deploy`.
3. `curl -s https://<worker-url>/health` should now show `"voice":{"stt":true,"tts":"aura","ttsModel":"aura-1"}` (or `"aura-2"`). The widget reads that and starts asking `/tts` for each reply instead of using the browser's voice. To go back, set `browser` and redeploy.

### Try it locally

```sh
npm run dev:mock        # chat on the mock model; Workers AI is remote (spends a few neurons)
```

```sh
# macOS: make a 16 kHz clip and send it
say -o clip.aiff "what do you do"
afconvert clip.aiff clip.wav -d LEI16@16000 -f WAVE
curl -s -H 'CF-Connecting-IP: 198.51.100.7' \
  -F "audio=@clip.wav;type=audio/wav" -F sessionId=$(uuidgen | tr A-Z a-z) -F durationMs=700 \
  http://localhost:8787/stt
# -> {"text":"What do you do?","durationMs":700}
```

For ElevenLabs add the key to `.dev.vars` and run `npx wrangler dev --port 8787 --var LLM_PROVIDER:mock --var VOICE_TTS:elevenlabs --var VOICE_ELEVEN_VOICE_ID:<id>`; it sends real text to ElevenLabs and spends real characters. Give curl the label yourself (`;type=audio/wav`): it sends a `.wav` as `application/octet-stream`, which is correctly refused with `400 bad_audio`. A browser's `MediaRecorder` blob already carries its own label. To try the premium voice: `npx wrangler dev --port 8787 --var LLM_PROVIDER:mock --var VOICE_TTS:aura` (add `--var VOICE_TTS_MODEL:aura-2 --var VOICE_SPEAKER:thalia` for Aura-2), then send the session a chat message first (`/tts` refuses a session that has not chatted) and ask for speech: `curl -s -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"sessionId":"3f2b8c1e-5d4a-4e7b-9a10-0c1d2e3f4a5b","messages":[{"role":"user","content":"hello"}]}' localhost:8787/chat`, then `curl -s -o reply.mp3 -X POST -H 'Content-Type: application/json' -d '{"sessionId":"3f2b8c1e-5d4a-4e7b-9a10-0c1d2e3f4a5b","text":"Hi there."}' localhost:8787/tts`.

## Privacy and logging

- The Worker stores no transcripts and no lead records. The only state is in the `Limiter` Durable Object: timestamps keyed by a hashed IP, a session id, or a date. An alarm deletes it once its window has passed.
- Logs contain only counters and status codes (`{status, stop_reason, outcome, ms, intent, input_tokens, output_tokens}` for model calls, delivery outcomes, error types). Message text, names, phone numbers, emails, keys, and the webhook URL are never logged; the tests check this.
- Cloudflare's automatic per-request invocation logs, which include the client IP, are turned off in `wrangler.jsonc` (`observability.logs.invocation_logs: false`); the Worker's own `console.log` lines are kept. A test pins that setting.
- A name or phone number a visitor types into the chat is a chat message like any other: it is sent to the AI provider (Anthropic) so the helper can reply, and the Worker does not store it. The `lead` object in a reply is built from the visitor's own words and is never logged. The privacy page already says chat messages go to Anthropic and that contact details given in the chat are collected, so it should still be accurate; re-read it whenever the collection flow changes.
- Voice: a recording exists only for the length of the `/stt` request. It is read into memory, sent to Cloudflare Workers AI (Whisper) for transcription, and dropped; the Worker stores no audio and no transcript, and neither is ever logged. Logs carry only `{event: "stt", ms, status, audioBytes, seconds}` (`seconds` is what was charged) (and `{event: "tts", ms, status, chars}` for the premium voice), plus `stt_error` / `tts_error` lines with the error's name and timing, never its message, and `{event: "tts_speaker_fallback", model, requested, used}` when `VOICE_SPEAKER` is not on the selected model's list (configuration only, never visitor text; `requested` is cut to 32 characters). The transcript is an ordinary chat message once the widget sends it to `/chat`, which the paragraph above already covers. The privacy page needs its own paragraph about the microphone and Workers AI (task W8 of the voice plan).
- ElevenLabs voice: when `VOICE_TTS=elevenlabs` the text of each spoken reply is sent to ElevenLabs to be turned into audio. It is the helper's reply, not the visitor's own words, but a reply can repeat a name or detail the visitor gave. The Worker stores and logs none of it. The privacy page has to name ElevenLabs before this is enabled.
- The opening greeting is a static MP3 served from the site itself. Playing it sends nothing to ElevenLabs or to the Worker; the text was sent to ElevenLabs once, when the recording was made.
- The per-visitor counters (`ip:tts-spoken:`, `ip:tts-bonus:`) are keyed by the hashed address bucket, like every other per-address counter, hold only a number, and are deleted by an alarm once Eastern midnight has passed.
- A lead that fails every delivery path is not saved anywhere. That is deliberate (it keeps the privacy statement true); the widget tells the visitor to call instead.

## Analytics note

GA4 is not installed on the site yet, so the widget's `track()` calls do nothing. When GA4 is added, mark the `concierge_lead_submitted` event as a conversion in the GA4 admin UI (Admin, Events; GA4 now labels this toggle "Mark as key event"). The Worker emits no analytics itself.

## Troubleshooting

| You see | Likely cause |
|---|---|
| `403 {"error":"origin_not_allowed"}` | The browser's origin is not in `ALLOWED_ORIGINS`. Add it in `wrangler.jsonc` and redeploy. |
| `429` straight away in local dev | The shared local bucket is used up. Use your own `CF-Connecting-IP` header or delete `.wrangler/state`. |
| `/chat` answers `503 lead_only` | `LLM_API_KEY` is not set, `DAILY_LLM_CAP` is 0 or was reached, the model failed twice, or the limiter was unreachable (`limiter_error` in the logs). Check `/health` and `npx wrangler tail`. |
| `/lead` answers `502` | No `RESEND_API_KEY` (or it is wrong) and no working LeadQuik hook. Check `/health` and `npx wrangler tail` for `resend_error` lines. |
| `/lead` answers `403 verification_failed` | Turnstile is on but the page sent no token. See "Enabling Turnstile later". |
| `/stt` answers `503 voice_unavailable` | `reason: "budget"`: the session's 180 seconds or the day's 9,000 are used up, or a `VOICE_*` budget is 0. `reason: "server"`: there is no `ai` binding (`/health` says `voice.stt: false`), Workers AI failed twice (`stt_error` lines in `npx wrangler tail`), or the limiter was unreachable (`limiter_error`). Under `wrangler dev`, also check `npx wrangler whoami`: the binding runs on your account. |
| `/stt` answers `400 bad_audio` for a real recording | The file's label is not `audio/webm`, `audio/mp4`, `audio/ogg` or `audio/wav`. With curl add `;type=audio/wav`. |
| `/tts` answers `404 not_found` | `VOICE_TTS` is neither `elevenlabs` nor `aura` (the shipped value is `elevenlabs`). |
| `/tts` answers `503` reason `server` with ElevenLabs selected | `/health` shows `configured: false` (no `ELEVENLABS_API_KEY` secret, or `VOICE_ELEVEN_VOICE_ID` is empty or has characters a URL path cannot hold), or ElevenLabs answered something other than 200: look for `{"event":"tts_error","provider":"elevenlabs","status":...}` in `npx wrangler tail`. 401 is a rejected key; 402 or 429 is usually the plan's quota or concurrency. |
| `/tts` answers `429 tts_limit` | The visitor used today's spoken replies (`VOICE_TTS_PER_IP_PER_DAY`, plus the bonus if it was earned). It clears at Eastern midnight (`Retry-After`). It is shared by everyone behind the same address, which includes an office or a mobile carrier. |
| `tts_speaker_fallback` in `npx wrangler tail` | `VOICE_SPEAKER` is not a speaker of the model `VOICE_TTS_MODEL` selects (for example `angus` on `aura-2`, or `thalia` on `aura-1`), so replies are spoken in the model's default voice. Pick a name from the lists under "Choosing the premium model and voice". |
| `/tts` answers `403 no_chat` | The session has not sent a chat message yet (or the id is made up). The widget only asks after a reply, so this means a direct call. |
| `/lead` answers `429` to a visitor on their first try | The day's 100 leads (all visitors) are used up, or the visitor's network already sent 3 in the last hour. |

## Notes for maintainers

- Tests use `@cloudflare/vitest-plugin`, the renamed successor of `@cloudflare/vitest-pool-workers` (that package is deprecated on npm). Its `cloudflare:test` module no longer has `fetchMock`, so tests replace `globalThis.fetch` with `vi.spyOn`.
- `@anthropic-ai/sdk` is pinned to an exact version (`1.4.0`) and created with `maxRetries: 0`; the Worker does its own single retry so total latency stays bounded.
- The mock provider lives in `src/mock.ts` and its output goes through the same `lead` cleanup and `readyToConfirm` rule as the model's, so the widget sees the real contract. `test/mock.test.ts` covers its conversation.
- The reply schema is written by hand (`REPLY_JSON_SCHEMA` in `src/llm.ts`) because the SDK's zod helper drops `enum` under zod 4, which would turn `intent` into a hint instead of a constraint. `ReplySchema` (zod) still validates the parsed JSON, and a test checks the two agree. The call uses `messages.create` and reads content blocks by type, since a response can begin with `thinking` blocks.
- `test/config.test.ts` reads `wrangler.jsonc` and pins the deployed provider, model, vars, Durable Object binding and observability settings; the rest of the suite overrides `LLM_PROVIDER` to `mock`, so nothing else would notice a bad committed value.
- `vitest.config.ts` sets `remoteBindings: false` for the test plugin. Without it the `ai` binding in `wrangler.jsonc` makes the suite open a remote session on the logged-in Cloudflare account (API calls, a warning, a hang on exit). Voice tests pass `env.AI` as the stub from `aiStub()`; `testEnv()` sets `AI` to `undefined` unless a test supplies one.
- `Limiter.hit(limit, windowSeconds, mode, cost = 1)`: `cost` only applies to the fixed mode and is what lets one counter hold seconds or characters. `Limiter.peek(windowSeconds, mode)` reads `{count, ended, resetAt}` and writes nothing, not even tables, so an unused id stays empty. `chargeLimiter` (`src/limits.ts`) is a `hit` with no effective limit, for spending that already happened (the Whisper call has run): it can take a counter past its cap, which is the right record, and the next request's check refuses once the count is at or over the cap. `viaLimiter` / `LimiterError` live in `src/limits.ts` and are shared by `/chat`, `/stt` and `/tts`.
- `Limiter.refund(n, expectedResetAt)` takes units back off a fixed counter, but only if its window still ends at `expectedResetAt` (the `resetAt` the reserving `hit()` returned); otherwise the unit belongs to a window that has already ended and nothing changes. It never goes below zero and writes nothing for an unused id. `/tts` uses it so a spoken-reply slot (and the day's characters) can be reserved with one atomic `hit()` and returned if the provider fails; `untilMidnightRule()` and `nextEtMidnight()` (in `src/limits.ts`) size the per-address daily windows to end at Eastern midnight, found by search because an Eastern day is sometimes 23 or 25 hours.
- `scripts/eleven-voices.mjs` parses `.dev.vars` itself and is tested against a fixture file and a local stub server (`--env-file`, `--base-url`), so its tests never read the real `.dev.vars`. The key is sent to whatever `--base-url` says, so that flag only accepts an `https://` URL (or `http://` for `localhost` / `127.0.0.1`), with no credentials in it, and neither the script nor the Worker's ElevenLabs call follows redirects (the script uses `redirect: 'error'` under Node; the Worker uses `redirect: 'manual'`, the only non-following mode the Workers runtime accepts, and treats any non-200 answer as a failure), so a redirect can never carry the key elsewhere. `npm run test:probe` runs them.
- The multipart body is read with `readBytes` (`src/http.ts`), the bounded reader `readJson` is built on, and then parsed with `Response.formData()`; `Content-Length` is only a shortcut for refusing early, the real cap is enforced while streaming.
- If `npm install` ever fails with `Cannot read properties of null (reading 'edgesOut')`, that is an npm 10 bug with vitest's optional peers; `npm install --legacy-peer-deps` works around it. A plain `npm ci` from the lockfile works.
