import type { CallbackWindow, LeadPayload, TranscriptEntry } from './validation';

/** JSON body POSTed to LEADQUIK_WEBHOOK_URL. Documented in README.md; keep them in sync. */
export interface LeadQuikPayload {
  name: string;
  /** Ten digits, no punctuation. */
  phone: string;
  /** Empty string when the visitor gave none. */
  email: string;
  business: string;
  need: string;
  callbackWindow: CallbackWindow;
  source: 'thgservices.io concierge';
  transcript: TranscriptEntry[];
  consent: true;
  /** ISO-8601 UTC. */
  createdAt: string;
}

export type LeadQuikResult = 'ok' | 'failed' | 'skipped';

const TIMEOUT_MS = 5000;

export const buildLeadQuikPayload = (lead: LeadPayload, now: Date = new Date()): LeadQuikPayload => ({
  name: lead.name,
  phone: lead.phone,
  email: lead.email ?? '',
  business: lead.business,
  need: lead.need,
  callbackWindow: lead.callbackWindow,
  source: 'thgservices.io concierge',
  transcript: lead.transcript,
  consent: lead.consent,
  createdAt: now.toISOString(),
});

const isAllowedUrl = (url: URL): boolean =>
  url.protocol === 'https:' ||
  (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));

/**
 * Placeholder integration for the LeadQuik CRM: POSTs the lead as JSON to the URL held in
 * the LEADQUIK_WEBHOOK_URL secret. A no-op ('skipped') when the URL is empty. The URL is
 * the credential, so it is never logged.
 */
export const sendToLeadQuik = async (
  lead: LeadPayload,
  url: string | undefined,
  now: Date = new Date(),
  timeoutMs: number = TIMEOUT_MS,
): Promise<LeadQuikResult> => {
  // The caller passes the trimmed value from leadquikUrl(env); blank means "not configured".
  const target = url;
  if (!target) return 'skipped';

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    console.error(JSON.stringify({ event: 'leadquik_error', reason: 'invalid_url' }));
    return 'failed';
  }
  if (!isAllowedUrl(parsed)) {
    console.error(JSON.stringify({ event: 'leadquik_error', reason: 'url_not_https' }));
    return 'failed';
  }

  try {
    const response = await fetch(parsed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildLeadQuikPayload(lead, now)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    if (response.ok) return 'ok';
    console.error(JSON.stringify({ event: 'leadquik_error', status: response.status }));
    return 'failed';
  } catch (error) {
    console.error(JSON.stringify({ event: 'leadquik_error', status: 0, error: (error as Error)?.name ?? 'Error' }));
    return 'failed';
  }
};
