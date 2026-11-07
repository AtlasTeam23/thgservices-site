# Concierge widget: button and control audit

Checked by reading the code and by running the built widget in a browser against a stubbed `/health`
(`{ok:true, voice:{stt:false, tts:'server', provider:'elevenlabs', configured:true}}`) and a stubbed `/chat`
(a valid reply with `offerCallback:true`), at 375 px (touch emulation, `pointer: coarse`) and 1280 px.
Sizes below are CSS px measured in that run. "Test" says whether an automated test exercises the control.

Owner's instruction: "check all buttons on the agent. Remove the no option". The "No thanks" offer chip
is gone (copy, handler, known-chip list, tests, the preview card mock). The lead form's "Not now, keep
chatting" is a different control (it closes the form and returns to the chat) and stays.

## Bubble and panel header

| Control | Component | Visible label | Accessible name | Does | Keyboard / focus | Touch size | Test |
|---|---|---|---|---|---|---|---|
| Chat bubble | `ChatBubble.tsx` | "Questions? Chat with us" (shown on hover/focus at desktop) | same text | Opens or closes the chat; `aria-expanded`, `aria-haspopup="dialog"` | Tab; 3 px focus ring | 56x56 | Yes (ChatBubble.test) |
| Sound toggle | `SpeakToggle.tsx` | Icon; "Sound on / Sound off" on touch | "Sound" with `aria-pressed` | Turns read-aloud on or off. Only shown when the Worker reports a server voice | Tab; 2 px ring | 44 tall (101 wide with label on touch, 44 wide at desktop) | Yes (voiceUi) |
| Stop reading (equalizer) | `Equalizer.tsx` | Animated bars | "Stop reading aloud" | Stops the spoken reply; only present while speaking | Tab; 2 px ring | 44x44 | Yes (voiceGreeting) |
| Call (header) | `ChatPanel.tsx` | Phone icon | "Call (866) 519-7993" | `tel:` link; only shown on short screens (keyboard up) | Tab when shown; 2 px ring | 44x44 | Partly (footer variant tested) |
| Close | `ChatPanel.tsx` | X icon | "Close chat" | Closes; Escape does the same; focus returns to the bubble | Tab; 2 px ring | 44x44 | Yes (ChatPanel, useFocusTrap) |

## Messages, chips, composer

| Control | Component | Label | Accessible name | Does | Keyboard / focus | Touch size | Test |
|---|---|---|---|---|---|---|---|
| "What do you do?" chip | `QuickReplies.tsx` (group "Quick replies") | What do you do? | same | Sends that question | Tab; 2 px ring | 44 tall | Yes |
| "Try the AI Concierge" chip | same | Try the AI Concierge | same | Sends that message | same | 44 tall | Yes |
| "Request a callback" chip | same | Request a callback | same | Opens the lead form | same | 44 tall | Yes |
| "Yes, call me" chip | same | Yes, call me | same | Opens the lead form (shown when a reply offers a callback). It is now the only offer chip; a visitor who does not want a call keeps typing | same | 105x44 | Yes |
| "Call (866) 519-7993" link in a reply | `MessageList.tsx` | Call (866) 519-7993 | same | `tel:` link, shown on handoff replies | Tab; 2 px ring | 44 tall | Yes (MessageList) |
| "Tap to hear replies" pill | `MessageList.tsx` | Tap to hear replies | same | Starts audio the browser blocked; shown under that reply | Tab; 2 px ring | 44 tall | Yes (voiceUi, voiceGreeting) |
| Message box | `Composer.tsx` | placeholder "Type your question..." | "Message" (label) | Enter sends, Shift+Enter newline; limit and error text announced | Focus on open (desktop); on touch the panel gets focus so the keyboard does not cover the greeting | 44 tall | Yes |
| Send | `Composer.tsx` | Arrow icon | "Send message" | Sends; disabled when empty, busy, over the limit or ended | Tab; 2 px ring | 44x44 | Yes |
| "Share my details" chip (cap notice) | `Composer.tsx` | Share my details | same | Opens the lead form from the read-aloud limit notice | Tab; 2 px ring | 44 tall | Yes (voiceUi, useVoice) |

The read-aloud limit text itself is a `role="status"` line (not a control).

## Lead form

| Control | Label | Accessible name | Does | Keyboard / focus | Touch size | Test |
|---|---|---|---|---|---|---|
| Name, Phone, Email, Business name | same | label | text fields with autocomplete and inline errors (`aria-invalid`, `aria-describedby`) | Tab; 2 px ring | 44 tall | Yes (LeadForm) |
| What do you need help with? | same | label | text area | same | 89 tall | Yes |
| Best callback window | same | label | select | same | 44 tall | Yes |
| Consent checkbox | consent sentence | label | required consent | Tab; Space; ring on the box | Row was 39 tall, **fixed to 44** (box itself is 20x20; the whole label row is the target) | Yes (LeadForm); size rule in touchTargets.test |
| Request my callback | same | same | Submits (Turnstile, then Worker); shows "Sending..." and disables | Tab; Enter; 2 px ring | 309x48 | Yes |
| Not now, keep chatting | same | same | Closes the form and returns to the chat, keeping what was typed; absent in lead-only mode | Tab; 2 px ring | 166x44 | Yes |

## Panel footer

| Control | Label | Does | Keyboard / focus | Touch size | Test |
|---|---|---|---|---|---|
| Prefer to talk? Call (866) 519-7993 | same | `tel:` link; hidden on short screens (the header icon replaces it) | Tab; 2 px ring | 186x44 | Yes (ChatPanel) |
| Privacy | "Privacy (opens in a new tab)" | Opens the privacy page in a new tab | Tab; 2 px ring | Was 41x16, **fixed to 44 tall on touch** (41 wide) | Yes (ChatPanel); size rule in touchTargets.test |

## Failed-download notice (only if the panel chunk cannot load)

| Control | Does | Keyboard / focus | Touch size | Test |
|---|---|---|---|---|
| Try again | Retries the download; takes focus when shown | Tab; ring; Escape closes | 44 tall | Yes (ChatBubble.chunkfail) |
| Close chat | Dismisses the notice, focus back to the bubble | same | 44 tall | Yes |

## Section on the page ("AI Website Concierge")

| Control | Component | Label | Accessible name | Does | Touch size | Test |
|---|---|---|---|---|---|---|
| Try it now | `sections/AiConcierge.tsx` | Try it now | same | Opens the chat with "Try the AI Concierge" | 141x48 | Yes |
| Call (866) 519-7993 | same | same | same | `tel:` link | 198x48 | Yes |
| Preview card | same | The card (clip or DOM mock) plus a "Click to try it" pill, both hidden from screen readers | "Try the AI Website Concierge" | Opens the chat. The card is one button; the chips drawn inside the mock are spans, not controls. The mock now shows only "Yes, call me" | whole card (440x527) | Yes |

## Keyboard and focus (verified)

- Opening moves focus into the panel; Tab and Shift+Tab wrap inside it (checked from the last link to the first button at 375 px); Escape closes and returns focus to the bubble.
- On phones the dialog is `aria-modal`; on desktop it is a non-modal dialog.
- Every control shows a 2 px focus ring (3 px on the bubble and preview card).
- Nothing in the widget is a button that does nothing: every control above has a handler.

## Fixed in this change

1. Consent row under 44 px on touch (39 px): `min-height: 44px`. Test: `touchTargets.test.ts`.
2. Footer Privacy link 16 px tall on touch: 44 px tall under `(pointer: coarse)`. Test: `touchTargets.test.ts`.

## Seen and deliberately not changed

- **Sound toggle name vs. visible text (fixed).** On touch the button reads "Sound on / Sound off" but its accessible name was "Spoken replies", which fails WCAG 2.5.3 (label in name) for voice-control users. The name is now "Sound", the word the visible label starts with; `aria-pressed` still carries on/off, the touch label stays, and desktop stays icon-only (tooltip unchanged).
- **Privacy link width** is 41 px on touch (height is 44). It is an inline link in a sentence, which WCAG 2.2 exempts; widening it would need padding that shifts the footnote text.
- **Consent checkbox box** is 20x20; the label row around it is the 44 px target, which is the usual pattern.
- **Desktop sizes** read 43 to 44 px in the run because the browser pane scales the emulated viewport; the CSS is 44 px.
- **Tap-to-hear pill, equalizer, "Share my details" chip, failed-download notice** need a blocked-audio, speaking, read-aloud-limit or failed-chunk state that the stub does not produce. Their sizes were measured by rendering the same classes in the panel and confirmed in CSS (44 px).
- **The recorded preview clip** (`concierge-card-loop.mp4`, poster) still shows the old two-chip card until it is regenerated; it is a hidden-from-assistive-tech picture, not a control.
- The Worker's name-detection test (`concierge-worker/test/mock.test.ts`) listed "No thanks" among phrases that must not be taken as a name; it was dropped from that list. No Worker code changed.
