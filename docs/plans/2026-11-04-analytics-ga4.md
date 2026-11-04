# GA4 Analytics and Estimate-Link Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install GA4 on the thgservices.io SPA with no PII, attribute visits from LeadQuik estimate links per brand through a `/from-estimate` landing path, record calls, leads, CTA and App Store clicks as events, and leave the property ready for the daily-report bot to read.

**Architecture:** One module, `vite-app/src/lib/analytics.ts`, owns everything: it decides whether tracking is allowed (real Measurement ID, production build, no Do Not Track / Global Privacy Control), injects gtag and the optional Cloudflare beacon at runtime, captures the brand from `utm_campaign` once per session, sends manual `page_view` on route change through a `RouteTracker`, and attaches one delegated click listener for phone, App Store and CTA clicks. The existing concierge wrapper `track()` becomes a thin alias of `trackEvent()`. A `/from-estimate` route renders the homepage with a short welcome block; a post-build step emits `from-estimate/index.html` so a direct hit on GitHub Pages returns 200.

**Tech Stack:** Vite 7, React 19, react-router 7 (`BrowserRouter`, `useLocation`), gtag.js, Cloudflare Web Analytics beacon, vitest + jsdom.

Source spec: `~/Downloads/THG-AI-Services-analytics-builder-spec-2026-11-03.docx`. Section numbers (§1…§7) below refer to it.

---

## 0. Decisions and facts

| Item | Value |
|---|---|
| GA4 owner | db4732@gmail.com; David creates the property (`thgservices.io`, America/New_York, USD, web stream `https://thgservices.io`) and gives the **Measurement ID** (`G-…`) and numeric **Property ID** |
| Brand slugs | `thg-ga`, `thg-ct` (CT and NY), `sunshine`, `flooring-guys`, `tile-guys`, `cabinet-painting`; anything else with a `utm_campaign` → `other`; no UTM → `direct` |
| Cloudflare Web Analytics | Yes, as backup; David supplies the beacon token from Analytics & Logs → Web Analytics → Add a site |
| `/from-estimate` | Short welcome block on top of the normal homepage; query string preserved; no redirect |
| Router | `BrowserRouter` in `src/main.tsx`; single route `/` in `src/App.tsx`; `<Concierge />` mounted outside `<Routes>`; no 404.html; `/service-request/` works only because it is a real folder |
| Build/deploy | `cd vite-app && npm run build` → `cp -R vite-app/dist/* ./` → prune stale `assets/*` → commit built output on the branch → PR → squash merge. `CNAME` and `.nojekyll` must survive |
| Existing analytics | None (no gtag, dataLayer, beacon). `src/lib/track.ts` is a no-op wrapper used by the concierge with nine `concierge_*` events |
| Phone links | `About.tsx:266`, `AiConcierge.tsx:235`, chat panel (`ChatPanel.tsx:140,193`, `MessageList.tsx:68`, `PhoneText.tsx:14`); none in Hero, Work, Consulting, Footer |
| App Store links | `Work.tsx:347–375` (inside a card that is itself an `<a>`, with `stopPropagation`), `FeaturedApp.tsx:101` via `AppStoreBadge.tsx` |
| Primary CTAs | Hero "Our products →" and "Contact us" (`Hero.tsx:189–194`), hero pill "Contact us" (`:143`), Work "Start a Conversation →" (`Work.tsx:381–420`), Consulting "Book a Conversation →" (`Consulting.tsx:300–335`), AiConcierge "Try it now" (`AiConcierge.tsx:213–232`), About "Get in Touch" (`About.tsx:126–145`) |
| Contact form success | `ContactForm.tsx:90–93` (`if (data.success)` → `setStatus('success')`); FormData with PII is in scope there, so the event call must take no arguments from it |
| Privacy text | `vite-app/public/privacy.html` §5 "Cookies and tracking" (`:165–166`) |
| `Navigation.tsx` | Dead code, not rendered; ignore it |

Branch: `feat/analytics-ga4` in the worktree `/Users/davidbrannan/Lead Quik/thgservices-site-ga4`. Two other branches are in flight (`feat/concierge-card-link` touches `AiConcierge.tsx`; `feat/concierge-conversational` touches the concierge components); keep edits to those files minimal (attributes only) so the coordinator can rebase.

## 1. Working agreement

Same as the concierge plan: work only inside `/vite-app` of this worktree (plus `vite-app/public/privacy.html`); no `git` commands, no deploy, no copying `dist` to the root; never put a real ID in a committed file until the coordinator supplies it (use the `G-XXXXXXX` placeholder, which the code treats as "off"); TDD for every logic module; `tsc -b`, `npm run lint` on changed files, and `npm run build` must pass; report exact outputs.

## 2. Contracts

### 2.1 Environment variables (`vite-app/.env.production`, all public)

```
VITE_GA4_ID=G-XXXXXXX            # placeholder = analytics off; David's real ID goes here
VITE_GA4_DEBUG=                  # "true" sends debug_mode and allows loading in dev
VITE_CF_BEACON_TOKEN=            # Cloudflare Web Analytics token; empty = beacon off
```
`.env.development` gets the same three keys, empty / placeholder. Type them in `src/vite-env.d.ts`.

### 2.2 `src/lib/analytics.ts` (the only place that touches `gtag`)

```ts
export function initAnalytics(): void;                       // idempotent; call once from main.tsx before render
export function trackPageView(path: string): void;           // manual page_view
export function trackEvent(name: string, params?: Params): void; // adds brand to every event
export function getBrand(): string;                           // 'direct' | slug | 'other'
export function isAnalyticsEnabled(): boolean;                // for tests and the concierge wrapper
export type Params = Record<string, string | number | boolean>;
```

Rules:
- **Enabled** only when `VITE_GA4_ID` is non-empty and not `G-XXXXXXX`, and (`import.meta.env.PROD` or `VITE_GA4_DEBUG === 'true'`), and `dntOn()` is false, where `dntOn()` is `navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true`. When disabled, every export is a no-op and no script tag is created (assert in tests).
- **Loading** (§1.2 of the spec, verbatim semantics): create `<script async src="https://www.googletagmanager.com/gtag/js?id=ID">`, define `window.dataLayer` and `window.gtag`, then `gtag('consent','default',{analytics_storage:'granted', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'})`, `gtag('js', new Date())`, `gtag('config', ID, {send_page_view:false, allow_google_signals:false, allow_ad_personalization_signals:false, debug_mode: VITE_GA4_DEBUG==='true'})`, then `gtag('set', { brand })`.
- **Brand capture** happens inside `initAnalytics()` regardless of enabled state (so the concierge's UTM data and `brand` agree): read `location.search` once; if `utm_campaign` is in the allowlist → that slug; present but unknown → `other`; absent → `direct`. Store as `sessionStorage['thg_brand']`; on later loads prefer the stored value unless a new `utm_campaign` is present. Try/catch every storage access.
- **`trackPageView(path)`** sends `gtag('event','page_view',{page_path, page_location, page_title, brand})` where `page_location` is `origin + path + cleanedQuery` and `cleanedQuery` keeps only `utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid` (no hash).
- **`trackEvent(name, params)`** merges `{ ...params, brand }` and calls `gtag('event', name, merged)`. In dev (`import.meta.env.DEV`) also `console.debug('[analytics]', name, merged)`.
- **Delegated click listener** (added once by `initAnalytics()`, on `document`, capture phase so `stopPropagation` in the Work card cannot hide it):
  - `a[href^="tel:"]` → `phone_call_click { link_location }`
  - `a[href*="apps.apple.com"]` → `app_store_click { store: 'ios', link_location }`
  - closest `[data-cta-id]` → `cta_click { cta_id, cta_label, link_location }` where `cta_label` is the element's `data-cta-label` (static text set in markup, never `textContent`)
  - `link_location` = the clicked element's closest `[data-analytics-location]` value, else the `id` of the closest `section[id]`, else `footer` inside `<footer>`, else `page`. The chat panel root gets `data-analytics-location="concierge"`.
- **Cloudflare beacon**: when enabled and `VITE_CF_BEACON_TOKEN` is set, append `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"<token>","spa":true}'>`. Same DNT rule.
- Never pass names, emails, phone numbers, message text or form values into any event. The only free-text params are static labels from markup.

### 2.3 Events (names and params exactly)

| Event | When | Params | GA4 key event |
|---|---|---|---|
| `page_view` | initial load + every pathname change | `page_path, page_location, page_title, brand` | no |
| `phone_call_click` | any `tel:` link | `link_location, brand` | **yes** |
| `generate_lead` | `ContactForm` success branch | `form_id: 'contact', brand` | **yes** |
| `concierge_lead` | chat lead delivered (next to the existing `concierge_lead_submitted`) | `brand` | **yes** |
| `concierge_open` | existing concierge event, unchanged params | `source, brand` | no |
| `app_store_click` | any apps.apple.com link | `store: 'ios', link_location, brand` | no |
| `cta_click` | elements with `data-cta-id` | `cta_id, cta_label, link_location, brand` | no |

The other existing `concierge_*` events keep firing through the alias with `brand` added. `concierge_call_click` stays (it is a sub-signal; `phone_call_click` is the key event and counts the same click).

`data-cta-id` / `data-cta-label` to add: `hero_products` "Our products", `hero_contact` "Contact us", `nav_contact` "Contact us" (hero pill), `products_start_conversation` "Start a Conversation", `consulting_book` "Book a Conversation", `concierge_try` "Try it now", `about_contact` "Get in Touch". Attributes only; no other changes to those components.

### 2.4 `/from-estimate`

- `App.tsx`: add `<Route path="/from-estimate" element={<Home fromEstimate />} />` and a `<RouteTracker />` inside `BrowserRouter` (it can live in `App.tsx` above `<Routes>`).
- `Home.tsx`: when `fromEstimate` is true render `<FromEstimateWelcome />` as the first child of `<main>`, above the hero: a slim band using the site's section idiom (`--thg-bg-section`, `font-mono-label` eyebrow "From your estimate", one sentence: "Thanks for reviewing your estimate. Here's how THG AI Services helps local businesses like yours run smoother." and a text link "See how we work ↓" that smooth-scrolls to `#ai-concierge`). No prices. Mobile-first, no overflow.
- The query string is preserved automatically (no navigation happens). `initAnalytics()` runs before render, so the brand is captured before anything else.
- **Direct hits**: `package.json` build becomes `tsc -b && vite build && node scripts/postbuild.mjs`; the script copies `dist/index.html` to `dist/from-estimate/index.html`, inserting `<meta name="robots" content="noindex">` in the copy's `<head>`, and fails loudly if `dist/index.html` is missing. Asset URLs are absolute (`base: '/'`), so the copy works unchanged. Add `from-estimate/` to nothing else; `sitemap.xml` stays as is.
- `RouteTracker`: `useLocation()`; on mount and whenever `pathname` changes, call `trackPageView(pathname)`; guard StrictMode double-invocation with a ref holding the last tracked path.

### 2.5 Concierge alias

`src/lib/track.ts` becomes: `export const track = (name, params) => trackEvent(name, params)` (keep the signature and the existing tests passing with the new behavior). In `useConcierge.ts`, right after the existing `track('concierge_lead_submitted', …)` call, add `track('concierge_lead')` (no other params). Add `data-analytics-location="concierge"` to the panel root in `ChatPanel.tsx` and to the bubble root in `ChatBubble.tsx`. Nothing else in the concierge changes.

### 2.6 Privacy text

In `vite-app/public/privacy.html` §5 "Cookies and tracking", append one sentence to the existing paragraph: "We use Google Analytics and Cloudflare Web Analytics to count visits and see which pages people use. No personal information is collected, advertising features are turned off, and if your browser sends a Do Not Track or Global Privacy Control signal, analytics does not load." Update "Last updated" to the deploy date.

## 3. Tasks (each: failing test → run → implement → run green)

A1. `analytics.ts` gating and brand: tests for enabled/disabled matrix (placeholder ID, dev without debug, DNT, GPC), brand allowlist including `other`/`direct` and the stored-value rule, storage throwing. No script tag when disabled.
A2. `analytics.ts` loading: with a fake `G-TEST` and `VITE_GA4_DEBUG=true` in tests, assert the script `src`, the `consent` default call, the `config` call and its options, and `gtag('set', {brand})` order.
A3. `trackPageView` / `trackEvent`: query cleaning (drops `email=`, keeps `utm_*`/`gclid`, strips hash), brand merged into params, dev console.debug.
A4. Delegated clicks: jsdom fixtures for a tel link inside `section#about`, an App Store link inside the Work card with `stopPropagation`, a `data-cta-id` button in `section#hero`, a tel link inside `[data-analytics-location="concierge"]`; assert names, params, and that `cta_label` comes from the attribute.
A5. Cloudflare beacon: appended only when enabled and token set; attribute JSON exact; DNT blocks it.
A6. `RouteTracker`: renders inside a `MemoryRouter`; one page_view on mount, one per path change, none on re-render (StrictMode test).
A7. Wiring: `main.tsx` calls `initAnalytics()` before `createRoot`; `App.tsx` route and tracker; `Home.tsx` + `FromEstimateWelcome`; `data-cta-id`/`data-cta-label` attributes (A1–A7 files: `Hero.tsx`, `Work.tsx`, `Consulting.tsx`, `AiConcierge.tsx`, `About.tsx`); `ContactForm.tsx` success → `trackEvent('generate_lead', { form_id: 'contact' })` with a test that the call carries no form values; concierge alias and `concierge_lead`; `data-analytics-location` attributes.
A8. `scripts/postbuild.mjs` + `package.json` build script; test by running `npm run build` and asserting `dist/from-estimate/index.html` exists and contains the noindex meta and the same `/assets/index-*.js` reference as `dist/index.html`.
A9. Privacy sentence; `.env.*` keys; `vite-env.d.ts`.
A10. Final: `npm test`, `npx tsc -b`, `npm run lint` on changed files, `npm run build`; browser check with `VITE_GA4_ID=G-TEST VITE_GA4_DEBUG=true npm run dev` (port 3000): open `/from-estimate?utm_source=leadquik&utm_medium=estimate&utm_campaign=thg-ga&utm_content=TEST123`, confirm the welcome band, the console.debug lines for `page_view` with `brand: thg-ga` and the cleaned `page_location`, a `phone_call_click` from the About phone link, a `cta_click` from "Our products", and that `window.dataLayer` contains no email/phone/name strings. Report sizes (the main bundle should grow by under 3 KB gzipped).

## 4. Coordinator steps after the build

1. Put David's real `VITE_GA4_ID` and `VITE_CF_BEACON_TOKEN` into `.env.production`; rebuild; verify in the browser (production build served locally) that requests go to `google-analytics.com/g/collect` with `en=page_view` and no PII in the payload; DNT on → no requests.
2. GA4 Admin (with David, in his browser): Data streams → Enhanced measurement → Page views → Advanced → turn off "Page changes based on browser history events"; Custom definitions → event-scoped dimension `brand` (parameter `brand`); Key events → mark `phone_call_click`, `generate_lead`, `concierge_lead`; Property details → time zone America/New_York, currency USD. Realtime check with the three UTM test links.
3. Deploy via PR; then verify `https://thgservices.io/from-estimate?...` returns HTTP 200 directly and shows the band.
4. Hand David the per-brand URL table from spec §2 for the LeadQuik templates (unchanged from the spec; `{estimate_id}` is the merge field).
5. Bot access (spec §4) is a separate, later step: Google Cloud project, Analytics Data API, service account with Viewer on the property, JSON key created by David himself; deliver `GA4_PROPERTY_ID` + key to the bot privately. Not part of this PR.

## 5. Out of scope

LeadQuik template edits; Search Console verification (needs a DNS TXT at Porkbun; optional later); cookie banner (US traffic only per spec); any copy changes beyond the welcome band and the privacy sentence.
