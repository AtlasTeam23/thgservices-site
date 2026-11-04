# THG AI Website Concierge: Worker

The server half of the thgservices.io chat helper. One Cloudflare Worker that holds the secrets, answers visitor questions with Claude Haiku 5.5 using the site's own copy, rate-limits abuse, verifies Turnstile, and emails each callback request to the team.

The React widget lives in `../vite-app/src/components/concierge/`. The two halves agree on the contract in `../docs/plans/2026-11-03-ai-concierge.md` section 2; change it in both places together.

| Route | Purpose |
|---|---|
| `GET /health` | `{ok, llm: "anthropic"\|"mock"\|"unconfigured", email, turnstile}`. Booleans say whether a secret is set; values are never shown. |
| `POST /chat` | One visitor message in, one reply out: `{reply, intent, offerCallback, readyToConfirm, lead}`. See "The reply" below. |
| `POST /lead` | A callback request. Emailed through Resend and optionally forwarded to a LeadQuik webhook. |

Only the origins in `ALLOWED_ORIGINS` (see `wrangler.jsonc`) can call it from a browser. Requests with no `Origin` header (curl, monitors) are allowed; rate limits and Turnstile are the real guards.

## What is where

```
wrangler.jsonc        public settings, Durable Object binding, .md-as-text rule
system-prompt.md      the helper's rules, verbatim from plan section 2.5
knowledge.md          the facts the helper may use, copied from the site
src/index.ts          router, CORS, error handling
src/chat.ts           POST /chat (check order is in the file header)
src/lead.ts           POST /lead
src/llm.ts            Claude call (anthropic), reply schema, and the server's rules for the lead details
src/mock.ts           the mock provider: canned replies plus a small scripted collection of contact details
src/limiter.ts        Limiter Durable Object: sliding and fixed-window counters + abuse cutoff
src/limits.ts         limiter ids and numbers, Eastern-time day key
src/ip.ts             which bucket an address belongs to (IPv6 is reduced to its /64)
src/env.ts            the Env type, trimmed-secret helpers, DAILY_LLM_CAP parsing
src/guards.ts         prompt-injection and abuse patterns
src/validation.ts     request validators and per-field error messages
src/sanitize.ts       HTML / control-character stripping
src/email.ts          lead email builder + Resend sender
src/leadquik.ts       LeadQuik webhook sender and payload type
src/turnstile.ts      Turnstile siteverify
src/copy.ts           visitor-facing strings the Worker returns itself
scripts/probe.mjs     bot-behavior checklist against a running Worker
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
- With no `RESEND_API_KEY`, `/lead` answers `502 delivery_failed`. That is the correct behavior, not a bug.
- To try the real model, remove `LLM_PROVIDER=mock` from `.dev.vars` and put a key in `LLM_API_KEY`. Never commit that file or paste a key anywhere else.

## Tests and checks

```sh
npm test            # vitest, inside the Workers runtime, with the real Durable Object
npm run typecheck   # tsc --noEmit
npm run test:probe  # unit tests for the probe script's own assertions
npm run probe       # bot checklist against http://localhost:8787 (see below)
```

The test suite sets every secret to "off" itself, so a real key in your `.dev.vars` cannot change a result. Outbound calls (Anthropic, Resend, Turnstile, LeadQuik) are stubbed by replacing `fetch`; nothing in `npm test` touches the network.

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

The full probe sends 24 messages, and one address may send 20 per 10 minutes. Against a **local** Worker each group is sent from its own made-up address (the probe sets `CF-Connecting-IP`, which only `wrangler dev` honours), so a full run works. Against a **deployed** Worker every message comes from your own address: run the groups ten minutes apart with `--only=base`, `--only=owner`, `--only=flow`.

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

Secrets, set with Wrangler and never stored in the repo:

| Secret | Needed | If missing |
|---|---|---|
| `LLM_API_KEY` | yes | `/chat` answers `503 capacity / lead_only`; `/lead` still works |
| `RESEND_API_KEY` | yes | `/lead` answers `502 delivery_failed` unless the LeadQuik hook succeeded |
| `TURNSTILE_SECRET_KEY` | recommended | Verification is skipped (one warning per isolate); `/health` shows `turnstile: false` |
| `LEADQUIK_WEBHOOK_URL` | optional | The LeadQuik hook is skipped |

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

*Sliding* counters keep one indexed timestamp row per hit, so they are exact but only suit small limits. *Fixed* counters keep a single `{count, resetAt}` row, which is what the two global caps need: they would otherwise write thousands of rows a day. Tables are created once per Durable Object lifetime.

- The IP comes from `CF-Connecting-IP` only. Forwarding headers are ignored because clients can set them. An IPv6 address is reduced to its `/64` prefix before hashing (one household or hosting customer owns the whole block), and an IPv4-mapped IPv6 address counts as the IPv4 address it wraps.
- Turnstile is required on the 11th message when **either** the session's message count or the address's message count is over 10, so minting new session ids does not avoid it.
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

## Privacy and logging

- The Worker stores no transcripts and no lead records. The only state is in the `Limiter` Durable Object: timestamps keyed by a hashed IP, a session id, or a date. An alarm deletes it once its window has passed.
- Logs contain only counters and status codes (`{status, stop_reason, outcome, ms, intent, input_tokens, output_tokens}` for model calls, delivery outcomes, error types). Message text, names, phone numbers, emails, keys, and the webhook URL are never logged; the tests check this.
- Cloudflare's automatic per-request invocation logs, which include the client IP, are turned off in `wrangler.jsonc` (`observability.logs.invocation_logs: false`); the Worker's own `console.log` lines are kept. A test pins that setting.
- A name or phone number a visitor types into the chat is a chat message like any other: it is sent to the AI provider (Anthropic) so the helper can reply, and the Worker does not store it. The `lead` object in a reply is built from the visitor's own words and is never logged. The privacy page already says chat messages go to Anthropic and that contact details given in the chat are collected, so it should still be accurate; re-read it whenever the collection flow changes.
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
| `/lead` answers `429` to a visitor on their first try | The day's 100 leads (all visitors) are used up, or the visitor's network already sent 3 in the last hour. |

## Notes for maintainers

- Tests use `@cloudflare/vitest-plugin`, the renamed successor of `@cloudflare/vitest-pool-workers` (that package is deprecated on npm). Its `cloudflare:test` module no longer has `fetchMock`, so tests replace `globalThis.fetch` with `vi.spyOn`.
- `@anthropic-ai/sdk` is pinned to an exact version (`1.4.0`) and created with `maxRetries: 0`; the Worker does its own single retry so total latency stays bounded.
- The mock provider lives in `src/mock.ts` and its output goes through the same `lead` cleanup and `readyToConfirm` rule as the model's, so the widget sees the real contract. `test/mock.test.ts` covers its conversation.
- The reply schema is written by hand (`REPLY_JSON_SCHEMA` in `src/llm.ts`) because the SDK's zod helper drops `enum` under zod 4, which would turn `intent` into a hint instead of a constraint. `ReplySchema` (zod) still validates the parsed JSON, and a test checks the two agree. The call uses `messages.create` and reads content blocks by type, since a response can begin with `thinking` blocks.
- `test/config.test.ts` reads `wrangler.jsonc` and pins the deployed provider, model, vars, Durable Object binding and observability settings; the rest of the suite overrides `LLM_PROVIDER` to `mock`, so nothing else would notice a bad committed value.
- If `npm install` ever fails with `Cannot read properties of null (reading 'edgesOut')`, that is an npm 10 bug with vitest's optional peers; `npm install --legacy-peer-deps` works around it. A plain `npm ci` from the lockfile works.
