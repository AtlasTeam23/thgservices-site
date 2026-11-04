import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  CONSENT,
  DELIVERY_FAILED,
  FOOTER_CALL,
  LEAD_FORM_DISMISS,
  WINDOW_KEYS,
  WINDOWS,
} from './copy';
import { LEAD_DRAFT_KEYS, parseLeadDraft } from './leadDraft';
import PhoneText from './PhoneText';
import type { FieldErrors, LeadDraft, LeadInput } from './types';
import type { SubmitLeadOutcome } from './useConcierge';
import { formatPhone, validateLead, type LeadFormValues } from './validation';

type Props = {
  onSubmit: (input: LeadInput) => Promise<SubmitLeadOutcome>;
  /** A submit is in flight. */
  sending: boolean;
  /** The last submit could not be delivered; show the phone fallback. */
  deliveryFailed: boolean;
  /** Replaces the default delivery-failed text (for example a server message). */
  failureMessage?: string | null;
  /**
   * Details the helper gathered in conversation. Used only for the first render;
   * after that the visitor's own edits win. Consent is never part of it.
   */
  prefill?: LeadDraft;
  /** One line above the fields, for example when the helper opened the form itself. */
  heading?: string | null;
  /**
   * Shows a "Not now, keep chatting" button under the submit button. Leave it out
   * when there is nothing to go back to (lead-only mode). It receives what the visitor
   * has typed so far, cleaned like a model draft, so their edits are not lost.
   */
  onDismiss?: (draft: LeadDraft) => void;
};

type Field = keyof LeadFormValues;

/** The fields that must be filled before the form can be sent, in order (consent comes after). */
const REQUIRED_FIELDS = ['name', 'phone', 'business', 'callbackWindow'] as const;

const FIELD_ORDER: Field[] = [
  'name',
  'phone',
  'email',
  'business',
  'need',
  'callbackWindow',
  'consent',
];

const initialValues = (prefill?: LeadDraft): LeadFormValues => {
  const values: LeadFormValues = {
    name: '',
    phone: '',
    email: '',
    business: '',
    need: '',
    callbackWindow: '',
    // Never pre-checked: the visitor must tick it themselves.
    consent: false,
  };
  if (prefill) for (const key of LEAD_DRAFT_KEYS) values[key] = prefill[key];
  // A clean 10-digit number reads better as (770) 555-0147; submitting normalizes it back.
  values.phone = formatPhone(values.phone);
  return values;
};

/** The first required field still empty, or 'consent' when only the box is left. */
const firstUnfilled = (values: LeadFormValues): (typeof REQUIRED_FIELDS)[number] | 'consent' =>
  REQUIRED_FIELDS.find((name) => !values[name].trim()) ?? 'consent';

export default function LeadForm({
  onSubmit,
  sending,
  deliveryFailed,
  failureMessage,
  prefill,
  heading,
  onDismiss,
}: Props) {
  const [values, setValues] = useState<LeadFormValues>(() => initialValues(prefill));
  // Where focus goes when the form appears; decided once, from the pre-filled values.
  const [focusTarget] = useState(() => firstUnfilled(initialValues(prefill)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const headingId = `${uid}-heading`;

  const idOf = (field: Field) => `${uid}-${field}`;
  const errorIdOf = (field: Field) => `${uid}-${field}-error`;

  // The chip that opened the form has just disappeared, so move focus into it, but
  // only if focus was in the chat (or nowhere): never take it from the rest of the page.
  // Where it lands: the first required field that is still empty; if the helper filled
  // name, phone and business already, the consent box, which is the one thing left to do.
  useEffect(() => {
    const form = formRef.current;
    if (!form || deliveryFailed) return; // a failure notice takes focus instead
    const active = document.activeElement;
    const panel = form.closest('[role="dialog"]');
    const ownsFocus = !active || active === document.body || !!panel?.contains(active);
    if (!ownsFocus) return;

    const target = form.querySelector<HTMLElement>(`[name="${focusTarget}"]`);
    target?.focus({ preventScroll: true });

    // A pre-filled form is taller than the chat area, so the target can sit below the fold.
    // Wait a frame so the list's own scroll-to-the-reply has started, then reveal it. For the
    // consent box reveal the end of the form, so consent, send and "not now" show together.
    if (!target || focusTarget === 'name') return;
    const reveal = focusTarget === 'consent' ? (form.lastElementChild ?? target) : target;
    let frame = 0;
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(() => {
        if (typeof reveal.scrollIntoView === 'function') reveal.scrollIntoView({ block: 'nearest' });
      });
    }
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the form first appears
  }, []);

  // A failed send is easy to miss: announce it, scroll it into view and put focus on it.
  useEffect(() => {
    const notice = alertRef.current;
    if (!deliveryFailed || !notice) return;
    notice.focus({ preventScroll: true });
    if (typeof notice.scrollIntoView === 'function') notice.scrollIntoView({ block: 'center' });
  }, [deliveryFailed, failureMessage]);

  const update = <K extends Field>(field: K, value: LeadFormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => {
      if (!(field in e)) return e;
      const next = { ...e };
      delete next[field as keyof FieldErrors];
      return next;
    });
  };

  const focusFirstInvalid = (fields: FieldErrors) => {
    const first = FIELD_ORDER.find((f) => f in fields);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const result = validateLead(values);
    if (!result.ok) {
      setErrors(result.fields);
      focusFirstInvalid(result.fields);
      return;
    }
    setErrors({});
    const outcome = await onSubmit(result.value);
    if (!outcome.ok && outcome.fields && Object.keys(outcome.fields).length > 0) {
      setErrors(outcome.fields);
      focusFirstInvalid(outcome.fields);
    }
  };

  const describe = (field: Field) => {
    // When focus lands on the consent box, the heading ("Check the box and tap send") is
    // what a screen reader should hear with it; keep the field's own error in there too.
    const ids = [
      errors[field] ? errorIdOf(field) : null,
      field === 'consent' && focusTarget === 'consent' && heading ? headingId : null,
    ].filter(Boolean);
    return {
      'aria-invalid': errors[field] ? (true as const) : undefined,
      'aria-describedby': ids.length > 0 ? ids.join(' ') : undefined,
    };
  };

  const fieldError = (field: Field) =>
    errors[field] ? (
      <p id={errorIdOf(field)} className="thg-cc-field-error">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form
      ref={formRef}
      className="thg-cc-form"
      data-cc-form
      aria-label="Callback request"
      aria-describedby={heading ? headingId : undefined}
      noValidate
      onSubmit={handleSubmit}
    >
      {heading && (
        <p id={headingId} className="thg-cc-form-heading">
          {heading}
        </p>
      )}

      {deliveryFailed && (
        <div ref={alertRef} role="alert" tabIndex={-1} className="thg-cc-alert">
          {failureMessage ? (
            <>
              <p>{failureMessage}</p>
              <p>
                <PhoneText text={FOOTER_CALL} />
              </p>
            </>
          ) : (
            <PhoneText text={DELIVERY_FAILED} />
          )}
        </div>
      )}

      <div className="thg-cc-field">
        <label htmlFor={idOf('name')}>Name</label>
        <input
          id={idOf('name')}
          name="name"
          className="thg-cc-input"
          type="text"
          autoComplete="name"
          aria-required="true"
          value={values.name}
          onChange={(e) => update('name', e.target.value)}
          {...describe('name')}
        />
        {fieldError('name')}
      </div>

      <div className="thg-cc-field">
        <label htmlFor={idOf('phone')}>Phone</label>
        <input
          id={idOf('phone')}
          name="phone"
          className="thg-cc-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          aria-required="true"
          value={values.phone}
          onChange={(e) => update('phone', e.target.value)}
          {...describe('phone')}
        />
        {fieldError('phone')}
      </div>

      <div className="thg-cc-field">
        <label htmlFor={idOf('email')}>Email (optional)</label>
        <input
          id={idOf('email')}
          name="email"
          className="thg-cc-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={values.email}
          onChange={(e) => update('email', e.target.value)}
          {...describe('email')}
        />
        {fieldError('email')}
      </div>

      <div className="thg-cc-field">
        <label htmlFor={idOf('business')}>Business name</label>
        <input
          id={idOf('business')}
          name="business"
          className="thg-cc-input"
          type="text"
          autoComplete="organization"
          aria-required="true"
          value={values.business}
          onChange={(e) => update('business', e.target.value)}
          {...describe('business')}
        />
        {fieldError('business')}
      </div>

      <div className="thg-cc-field">
        <label htmlFor={idOf('need')}>What do you need help with? (optional)</label>
        <textarea
          id={idOf('need')}
          name="need"
          className="thg-cc-input thg-cc-need"
          rows={3}
          value={values.need}
          onChange={(e) => update('need', e.target.value)}
          {...describe('need')}
        />
        {fieldError('need')}
      </div>

      <div className="thg-cc-field">
        <label htmlFor={idOf('callbackWindow')}>Best callback window</label>
        <select
          id={idOf('callbackWindow')}
          name="callbackWindow"
          className="thg-cc-input thg-cc-select"
          aria-required="true"
          value={values.callbackWindow}
          onChange={(e) => update('callbackWindow', e.target.value)}
          {...describe('callbackWindow')}
        >
          <option value="">Choose a time…</option>
          {WINDOW_KEYS.map((key) => (
            <option key={key} value={key}>
              {WINDOWS[key]}
            </option>
          ))}
        </select>
        {fieldError('callbackWindow')}
      </div>

      <div className="thg-cc-field">
        <label className="thg-cc-check" htmlFor={idOf('consent')}>
          <input
            id={idOf('consent')}
            name="consent"
            type="checkbox"
            aria-required="true"
            checked={values.consent}
            onChange={(e) => update('consent', e.target.checked)}
            {...describe('consent')}
          />
          <span>{CONSENT}</span>
        </label>
        {fieldError('consent')}
      </div>

      <button type="submit" className="thg-cc-submit" disabled={sending}>
        {sending ? 'Sending…' : 'Request my callback'}
      </button>

      {onDismiss && (
        <button
          type="button"
          className="thg-cc-form-dismiss"
          disabled={sending}
          onClick={() => onDismiss(parseLeadDraft(values))}
        >
          {LEAD_FORM_DISMISS}
        </button>
      )}
    </form>
  );
}
