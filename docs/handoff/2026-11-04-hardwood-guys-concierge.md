# Handoff: the AI Website Concierge for hardwood-guys.com

**For the Claude Code session that maintains hardwood-guys.com (The Hardwood Guys, Woodstock GA; brand `thg-ga` in LeadQuik).**
Written 2026-11-04 by the thgservices.io session. Source of everything below: `https://github.com/AtlasTeam23/thgservices-site` at commit `6eebfee` or later.

The goal: put the same chat-and-voice helper that is live on thgservices.io onto hardwood-guys.com, tuned for a flooring company, with leads landing in the THG Georgia organization in LeadQuik and in an inbox. Owner: David Brannan. He is not a developer: when you need a secret from him, give him a one-click Run step and never ask him to paste a key into chat.

---

## 1. What you are getting

Two pieces, both in the repo above, both running in production for thgservices.io:

| Piece | Where | What it does |
|---|---|---|
| **Worker** `concierge-worker/` | Cloudflare Worker + one SQLite Durable Object (`Limiter`) | `POST /chat` (Claude Haiku 5.5 with a knowledge file and a strict prompt; returns `reply`, `lead`, `readyToConfirm`, `offerCallback`, `intent`), `POST /lead` (validates, emails via Resend, optionally POSTs to a LeadQuik webhook), `POST /stt` (Whisper on Workers AI), `POST /tts` (ElevenLabs, capped), `GET /health`. Rate limits per IP and per session, Turnstile hooks, a daily model cap, a daily voice budget. |
| **Widget** `vite-app/src/components/concierge/` | React 19 + TypeScript, ~6,400 lines incl. tests | Floating "Questions? Chat with us" bubble, chat panel, quick-reply chips, in-chat contact capture with a pre-filled lead form, callback windows, push-to-talk mic, spoken replies, a recorded greeting that plays when the chat opens, "Tap to hear replies" on phones, privacy disclosure. |

Read these first, in this order: `concierge-worker/README.md` (the whole thing; it is the operating manual), `concierge-worker/knowledge.md`, `concierge-worker/system-prompt.md`, `docs/plans/2026-11-04-concierge-conversational.md`, `docs/plans/2026-11-04-concierge-voice.md`, `vite-app/src/components/concierge/copy.ts`.

What is live and verified today on thgservices.io: the greeting plays on the opening click, typed and spoken questions are answered, replies are spoken by ElevenLabs voice "Matilda", 5 spoken replies per visitor per day plus 5 after a lead with email, leads arrive by email with the transcript, the per-day budgets hold.

## 2. The important difference: hardwood-guys.com is not a React app

hardwood-guys.com is plain HTML with its own scripts (`/lead-popup.js`, `/form-config.js`, `/analytics.js`, …). The widget today is React source compiled into the thgservices.io bundle. It cannot be dropped in as-is.

**Plan of record:** the thgservices.io side packages the widget as one embeddable script plus one stylesheet, with its brand settings passed as `data-*` attributes. Until David approves that build (asked 2026-11-04), do everything else in this document; the embed is the last step and the contract below is fixed now so you can prepare the page for it.

The embed contract (final names may differ slightly; the thgservices.io session will update this file when the build lands):

```html
<link rel="stylesheet" href="/concierge/concierge.css">
<script defer src="/concierge/concierge.js"
  data-api="https://hg-concierge.lqteam.workers.dev"
  data-title="Hardwood Guys helper"
  data-bubble="Questions? Chat with us"
  data-phone="(770) 000-0000" data-phone-href="tel:+17700000000"
  data-privacy="/privacy.html#ai-chat"
  data-greeting="/concierge/greeting.mp3"
  data-lead-place="address"
  data-turnstile=""></script>
```

- Both files are copied into the hardwood-guys.com repo like its other scripts; nothing is loaded from thgservices.io at run time.
- `data-lead-place="address"` switches the lead form's third field from "Business name" (right for THG AI Services, whose visitors are business owners) to "Property address or ZIP" (right for homeowners). The Worker gets a matching var so validation, the email and the webhook use `address` instead of `business`. This option does not exist yet; it ships with the embed.
- Theme: the widget is styled by CSS variables `--cc-bg --cc-surface --cc-fg --cc-fg-2 --cc-border --cc-brand --cc-brand-hover --cc-accent --cc-focus --cc-shadow --cc-field-bg --cc-field-border --cc-error --cc-error-bg`. Override them on `:root` in the site's own CSS to match The Hardwood Guys palette.
- The greeting MP3 and its `greeting.json` sidecar are site assets at `/concierge/`; see section 7.

**Fallback if David decides against the shared embed:** copy `vite-app/src/components/concierge/` into your repo, add a 20-line mount file that renders `<Concierge />` into a `div`, and build it with Vite in library mode (`build.lib`, format `iife`, React bundled). Expect about 70 KB gzipped. You then own a fork; prefer the shared embed.

## 3. Deliverables and acceptance

Done means all of these are true on the live hardwood-guys.com:

1. A Worker named `hg-concierge` is deployed in Cloudflare account `a568ec07bed6631a31732ab0e2d47aa5` (subdomain `lqteam`), and `https://hg-concierge.lqteam.workers.dev/health` returns `{"ok":true,"llm":"anthropic","email":true,...,"voice":{"stt":true,"tts":"server","provider":"elevenlabs","configured":true,...}}`.
2. The bot answers as The Hardwood Guys: services, service area, how an estimate works (in person is fine for this business; see section 5), hours, what it will not claim. `node scripts/probe.mjs` passes against the deployed Worker with scenarios rewritten for flooring (section 9).
3. A visitor who gives a name and phone gets them captured on the spot and is asked for a callback window; a visitor who asks for an estimate is asked for name and number right away.
4. A submitted lead arrives in the THG Georgia organization in LeadQuik through the same intake the site's web form leads use (required), and by email at the address David names (backup), with name, 10-digit phone, email if given, property address or ZIP, what they need, callback window, consent, and the transcript.
5. Voice: tapping the bubble plays the recorded greeting; replies are spoken; after 5 the chat says so and offers 5 more for contact details; the speaker toggle mutes; phones without autoplay show "Tap to hear replies".
6. The privacy page has the AI chat and voice section (section 8).
7. No secret appears in the repo, in a commit message, in a log line, or in chat. `wrangler secret list` shows names only.
8. Phones: layout works at 375 px wide; the widget never pushes the page sideways.

## 4. Inputs to collect before you start

Ask David, or the THG Georgia team, once, in one message. Defaults in brackets are what thgservices.io uses.

| Input | Why | Default / note |
|---|---|---|
| Lead inbox email | `LEAD_TO_EMAIL` | none; must be given |
| From address | `LEAD_FROM_EMAIL`; the domain must be verified in Resend | `THG AI Services <concierge@leadquik.com>` works today under the LeadQuik Resend account; `The Hardwood Guys <concierge@leadquik.com>` is the quickest; a hardwood-guys.com sender needs that domain verified in Resend first |
| Phone number to show in the widget and emails | widget `data-phone`, Worker `copy.ts` | none; must be given |
| LeadQuik intake for the THG Georgia org | `LEADQUIK_WEBHOOK_URL` (secret) | **required.** David's decision (2026-11-04): concierge leads go into LeadQuik the same way the site's existing web form leads do. You own this wiring: find how `/form-config.js` and `/lead-popup.js` on hardwood-guys.com submit today and give the Worker an https URL that lands a lead in the same place. Payload in 5.2 |
| Service area, services, hours, estimate process, pricing stance, warranty, financing, what not to say | `knowledge.md`, `system-prompt.md` | write it from the current hardwood-guys.com pages and David's answers; keep it in plain words |
| Callback windows | `CALLBACK_WINDOWS` in both Worker and widget | weekdays 9–11, 11–1, 1–3, 3–5 Eastern |
| Voice | `VOICE_ELEVEN_VOICE_ID` | Matilda `XrExE9yKIg1WjnnlVkGX`; list others with `npm run eleven:voices` |
| Greeting text | `GREETING` in widget copy and the recorded MP3 | "Hi there! I'm the Hardwood Guys helper. …" (write it; then record it, section 7) |
| Daily budgets | `DAILY_LLM_CAP`, `VOICE_DAILY_TTS_CHARS`, `VOICE_DAILY_STT_SECONDS` | 2000 model calls, 50,000 TTS characters (about 150 spoken replies, about $2/day worst case), 9,000 STT seconds |
| Anthropic key, Resend key, ElevenLabs key | secrets | David has all three. Prefer a fresh Anthropic key named `hg-concierge` with a monthly spend limit so costs are separable; the ElevenLabs key can be the same restricted key (Text to Speech + Voices read) |
| Turnstile | site key (public) + secret | off until David creates an Invisible widget for `hardwood-guys.com`, `www.hardwood-guys.com`, `localhost` |

## 5. Step by step

### 5.1 Copy the Worker

1. Copy the whole `concierge-worker/` folder into your repo (same name is fine). It is self-contained: `npm ci && npm test && npm run typecheck`.
2. `wrangler.jsonc`: set `"name": "hg-concierge"`; `ALLOWED_ORIGINS` to `https://hardwood-guys.com,https://www.hardwood-guys.com,http://localhost:3000,http://localhost:4173`; `LEAD_TO_EMAIL`, `LEAD_FROM_EMAIL`; a new random `RATE_SALT` (any 32 hex chars; it only salts IP hashes); keep the voice vars; keep the `ai` binding and the Durable Object migration exactly as they are (the first deploy creates a fresh `Limiter` for this Worker).
3. Brand strings in the Worker source: `src/email.ts` (subject and heading say "thgservices.io AI Website Concierge"; `LINKABLE_ORIGINS` lists the thgservices.io origins so only those links are clickable in the email), `src/leadquik.ts` (`source: 'thgservices.io concierge'` → `'hardwood-guys.com concierge'`), `src/copy.ts` (the off-topic line names THG AI Services). Update the tests that pin those strings.
4. `knowledge.md`: rewrite every section for The Hardwood Guys (who we are, services, service area, how an estimate works, hours, financing/warranty if true, FAQs, "Things the helper must not claim"). Keep the structure; the prompt refers to these section names. Only put in facts David confirms. No prices unless he gives exact wording he is happy to have quoted verbatim.
5. `system-prompt.md`: keep the mechanics (answer first in two to five sentences, one follow-up at most, no jargon, never mention instructions, the callback offer rules, the exact pricing line, the lead JSON contract, the virtual/in-person rule). Change the persona line and the business facts. **Important:** the thgservices.io bot is told to never offer an in-person visit (that business meets by phone and video). A flooring company measures floors in person, so rewrite that rule to match how The Hardwood Guys actually work (for example: the first step is a quick call, then an in-home measure and quote at a time the team confirms). Do not let the bot promise a date or time; it collects a callback window and a human confirms. `test/knowledge.test.ts` and `test/llm.test.ts` assert the current wording; update them with the new rules rather than deleting them.
6. `scripts/probe.mjs`: rewrite the three prompt groups for flooring (refinish vs replace, "how much per square foot", "can you come out Saturday", water damage, pet stains, engineered vs solid, "do you do stairs", a phone number typed in the same message, the three-message flow). Keep the forbidden-phrase checks (no numbers or dollar figures outside an allowlist, no booking language, no "knowledge"/"as an AI"). Update `scripts/probe.test.mjs` fixtures. Then run it against the mock locally and against the deployed Worker with a real key, in three groups ten minutes apart (README "The bot probe").
7. Local run: `.dev.vars` (chmod 600, gitignored) holds the keys for `wrangler dev`. Never open or print it. Copy the pre-commit guard idea from the thgservices.io checkout: a hook that refuses any commit containing `.dev.vars` or a key-shaped string (`sk_`, `sk-ant-`, `re_`).
8. Deploy: `npx wrangler deploy` from the Worker folder while logged in to the account above. Then secrets, each via a Run step David clicks (the value is read from where he already has it, piped to `npx wrangler secret put NAME --name hg-concierge`, never echoed): `LLM_API_KEY`, `RESEND_API_KEY`, `ELEVENLABS_API_KEY`, `LEADQUIK_WEBHOOK_URL`. Check `/health`.

### 5.2 Leads into LeadQuik (the THG Georgia organization)

**Decision from David, 2026-11-04:** concierge leads must land in LeadQuik exactly like the web leads hardwood-guys.com already sends (the existing form and popup), in the THG Georgia organization. The thgservices.io side does not know that intake; you do. Work out the mapping, the auth and any adapter on the LeadQuik side, then set `LEADQUIK_WEBHOOK_URL` on the Worker. Email delivery stays on as the backup channel.

When `LEADQUIK_WEBHOOK_URL` is set, every delivered lead is POSTed as JSON (5-second timeout, no retry, https only):

```json
{
  "name": "Jane Doe",
  "phone": "7705551234",
  "email": "jane@example.com",
  "business": "123 Main St, Woodstock",
  "need": "Refinish about 800 sq ft of oak, pet stains in two rooms",
  "callbackWindow": "morning_9_11",
  "source": "hardwood-guys.com concierge",
  "transcript": [{ "role": "user", "content": "...", "at": "2026-11-04T21:00:10.000Z" }],
  "consent": true,
  "createdAt": "2026-11-04T21:05:30.000Z"
}
```

`phone` is ten digits, `email` is `""` when not given, `callbackWindow` is one of `morning_9_11 | midday_11_1 | afternoon_1_3 | late_afternoon_3_5`. Until the `address` option ships (section 2) the property address travels in `business`; map it accordingly on the LeadQuik side and switch the mapping when the field is renamed. The type is `LeadQuikPayload` in `src/leadquik.ts`. Email delivery and the webhook are independent: a lead counts as delivered if either succeeds; the Worker logs `lead_delivered` with which channels worked. Point the URL at an inbound-lead endpoint for the THG Georgia organization that accepts this shape or add a thin adapter in LeadQuik; the Worker does not sign requests, so use a URL with an unguessable token in it.

### 5.3 The widget on the page

When the embed lands: copy `concierge.js`, `concierge.css`, `greeting.mp3`, `greeting.json` into the site under `/concierge/`, add the `<link>` and `<script>` from section 2 before `</body>` on every page, set the `data-*` values, override the `--cc-*` variables to the brand palette, and check:

- the bubble does not cover the existing lead popup's controls on phones (move one of them; the widget's bubble sits bottom-right with `env(safe-area-inset-*)` padding);
- the existing `/lead-popup.js` and the concierge do not both fire on the same visit in a way that annoys (consider disabling the popup for visitors who opened the chat; the widget stores its state in `sessionStorage` under `thg-concierge-v1`);
- the page's Content-Security-Policy, if any, allows `connect-src` to the Worker origin, `media-src blob:` and `'self'`, and microphone use is not blocked by a `Permissions-Policy` header.

### 5.4 Privacy page

Add a section like thgservices.io's "AI chat assistant" (`vite-app/public/privacy.html`, the `id="ai-chat"` section): what is collected, that messages go to Anthropic, that spoken replies send the reply text to ElevenLabs, that the opening greeting is a recording served from the site, that microphone audio is sent for transcription only when the visitor holds the button, the per-address daily count of spoken replies, retention, and how to ask for deletion. Link it from the widget with `data-privacy`.

### 5.5 Turnstile (spam protection), later

Order matters: (1) David creates an Invisible Turnstile widget for the hostnames; (2) the site key goes into the embed's `data-turnstile` and the page is published; (3) only then set `TURNSTILE_SECRET_KEY` on the Worker. Setting the secret first rejects every lead with `403 verification_failed`.

### 5.6 Analytics

The widget calls a `track(event, params)` function (`vite-app/src/lib/track.ts` on thgservices.io). Events: `concierge_open`, `concierge_lead` on a delivered lead, `concierge_voice_start`, `concierge_voice_reply_spoken`, `concierge_greeting_played`, `concierge_voice_error`. In the embed these go to `window.dataLayer` / `gtag` when present. Tag them with brand `thg-ga` in the site's GA4 configuration, as `docs/plans/2026-11-04-analytics-ga4.md` describes for the brand sites.

## 6. Field reference for the lead form

| Field | Rule (Worker `src/validation.ts`, mirrored in the widget) |
|---|---|
| `name` | required, one line, up to 80 characters |
| `phone` | required, normalizes to exactly 10 US digits |
| `email` | optional; if present must be valid; required for the +5 spoken-reply bonus |
| `business` (→ `address` with the new option) | required, up to 120 characters |
| `need` | optional, up to 500 characters |
| `callbackWindow` | required, one of the four keys |
| `consent` | must be `true` ("OK to contact me by phone, text, or email about my request.") |
| `transcript`, `page` | attached automatically |

Change the labels in `vite-app/src/components/concierge/copy.ts` and the matching Worker messages in `src/validation.ts` (`MESSAGES`) together; tests on both sides pin them.

## 7. Voice: choosing and recording

- Spoken replies use ElevenLabs Flash v2.5. Per visitor: 5 spoken replies per Eastern day, plus 5 after a lead with name, valid email and phone. Site-wide: `VOICE_DAILY_TTS_CHARS` characters a day (50,000 ≈ 150 replies ≈ $2 worst case). Each reply is about 400 characters.
- Pick a voice: `npm run eleven:voices` (reads the key from `.dev.vars`, never prints it) lists the premade voices with sample links; `--json` writes a list a listening page can use. Put the id in `VOICE_ELEVEN_VOICE_ID`.
- Record the greeting once: `npm run eleven:greeting -- --text "<the greeting sentence>" --out ../path/to/site/concierge/greeting.mp3`. It writes the MP3 and a `greeting.json` sidecar (text, voice id, model, format). Tests on both sides check the sidecar matches the widget's `GREETING` copy and the Worker's voice settings, so regenerate it whenever either changes. The greeting is served from the site and costs nothing per visitor; it never counts against the cap.
- Speech-to-text is Whisper on Workers AI (`VOICE_DAILY_STT_SECONDS`, `VOICE_SESSION_SECONDS`); no key needed, it runs on the account.

## 8. Costs to expect (as of November 2026)

| Item | Rough cost |
|---|---|
| Chat replies (Claude Haiku 5.5, ~150 output tokens each) | fractions of a cent per reply |
| Spoken replies (ElevenLabs Flash, ~400 characters each) | about 200 credits per reply; a plan's monthly credits ÷ 200 ≈ spoken replies included |
| Speech-to-text (Workers AI Whisper) | inside the Workers Free plan's 10,000 neurons a day at the default budget |
| Worker requests | one `/health` per page view plus chat traffic; Workers Free allows 100,000 a day |
| Email (Resend) | within the existing LeadQuik account |

## 9. Test plan before go-live

1. `npm test`, `npm run typecheck`, `npm run test:probe` green in the Worker; widget tests green if you build the fallback.
2. `/health` as in section 3.
3. Probe against the deployed Worker with a real key, three groups ten minutes apart; read every reply yourself once.
4. Three live leads from a browser: one from a typed conversation, one where the visitor volunteers name and number in the first message, one through the mic. Confirm each in the inbox and in LeadQuik; delete the test records.
5. Voice on a real iPhone (Safari) and a real Android phone: greeting on the first tap, a spoken reply, the sixth reply switching to text with the offer, the speaker toggle, "Tap to hear replies" when autoplay is blocked.
6. Search the deployed knowledge and prompt for any wording that does not fit the business (the thgservices.io bot says "virtual only"; this one must not).
7. Watch `npx wrangler tail hg-concierge` during the tests: no `limiter_error`, no `tts_error`, `lead_delivered` for each lead.

## 10. Rules that must not be broken

- Secrets never pass through chat, never go in a file in the repo, never appear in logs or responses. David runs secret commands himself from Run steps you give him.
- Every production change goes through a pull request with a review; `main` is protected.
- The bot never invents prices, dates, availability, guarantees or counts. The probe enforces the numbers rule; keep it.
- Keep the per-visitor voice cap. Raising the site-wide budget is David's call.

## 11. Open items on the thgservices.io side (as of 2026-11-04)

- Build the embeddable widget (`concierge.js` + `concierge.css`, `data-*` config, `address` lead-field option in widget and Worker). Awaiting David's go. This file will be updated with the final file names and the commit.
- Turnstile and GA4 IDs for thgservices.io are still pending from David; the same steps apply here.

Questions about anything above: the thgservices.io repo's `concierge-worker/README.md` is the authority; after that, ask David to relay to the thgservices.io session.
