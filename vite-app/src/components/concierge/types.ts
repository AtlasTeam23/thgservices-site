export type Role = 'user' | 'assistant';

export type Intent = 'answer' | 'pricing' | 'off_topic' | 'handoff' | 'unsure';

export type CallbackWindow =
  | 'morning_9_11'
  | 'midday_11_1'
  | 'afternoon_1_3'
  | 'late_afternoon_3_5';

export type OpenSource = 'bubble' | 'section_cta';

/** One entry in the visible thread. */
export type Message = {
  id: string;
  role: Role;
  content: string;
  /** ISO-8601 timestamp. */
  at: string;
  /** The local greeting. Never sent to the server or included in a lead transcript. */
  greeting?: boolean;
  /** Render a tap-to-call link under this message (handoff replies). */
  callLink?: boolean;
};

export type ChatTurn = { role: Role; content: string };

export type ChatRequest = {
  sessionId: string;
  messages: ChatTurn[];
  turnstileToken?: string;
};

export type ChatResponse = {
  reply: string;
  intent: Intent;
  offerCallback: boolean;
};

/** What the visitor typed into the lead form, trimmed and normalized. */
export type LeadInput = {
  name: string;
  /** Exactly 10 digits. */
  phone: string;
  email?: string;
  business: string;
  need?: string;
  callbackWindow: CallbackWindow;
  consent: true;
};

export type TranscriptEntry = {
  role: Role;
  content: string;
  /** ISO-8601 timestamp. */
  at: string;
};

export type LeadRequest = LeadInput & {
  sessionId: string;
  transcript: TranscriptEntry[];
  page: { url: string; utm: Record<string, string> };
  turnstileToken?: string;
};

export type LeadDelivery = 'email' | 'email+leadquik' | 'leadquik';

/** Field name to message, as returned by the server on a 400 or built locally. */
export type FieldErrors = Partial<Record<keyof LeadInput, string>>;
