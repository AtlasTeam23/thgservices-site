import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CONSENT, DELIVERY_FAILED, FOOTER_CALL, WINDOW_KEYS, WINDOWS } from './copy';
import PhoneText from './PhoneText';
import type { FieldErrors, LeadInput } from './types';
import type { SubmitLeadOutcome } from './useConcierge';
import { validateLead, type LeadFormValues } from './validation';

type Props = {
  onSubmit: (input: LeadInput) => Promise<SubmitLeadOutcome>;
  /** A submit is in flight. */
  sending: boolean;
  /** The last submit could not be delivered; show the phone fallback. */
  deliveryFailed: boolean;
  /** Replaces the default delivery-failed text (for example a server message). */
  failureMessage?: string | null;
};

type Field = keyof LeadFormValues;

const FIELD_ORDER: Field[] = [
  'name',
  'phone',
  'email',
  'business',
  'need',
  'callbackWindow',
  'consent',
];

const EMPTY: LeadFormValues = {
  name: '',
  phone: '',
  email: '',
  business: '',
  need: '',
  callbackWindow: '',
  consent: false,
};

export default function LeadForm({ onSubmit, sending, deliveryFailed, failureMessage }: Props) {
  const [values, setValues] = useState<LeadFormValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  const idOf = (field: Field) => `${uid}-${field}`;
  const errorIdOf = (field: Field) => `${uid}-${field}-error`;

  // The chip that opened the form has just disappeared, so move focus into it, but
  // only if focus was in the chat (or nowhere): never take it from the rest of the page.
  useEffect(() => {
    const form = formRef.current;
    if (!form || deliveryFailed) return; // a failure notice takes focus instead
    const active = document.activeElement;
    const panel = form.closest('[role="dialog"]');
    const ownsFocus = !active || active === document.body || !!panel?.contains(active);
    if (ownsFocus) form.querySelector<HTMLElement>('[name="name"]')?.focus({ preventScroll: true });
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

  const describe = (field: Field) => ({
    'aria-invalid': errors[field] ? (true as const) : undefined,
    'aria-describedby': errors[field] ? errorIdOf(field) : undefined,
  });

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
      noValidate
      onSubmit={handleSubmit}
    >
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
    </form>
  );
}
