import { useId, useState } from 'react';
import { Loader2, Unlock } from 'lucide-react';
import * as copy from '../../lib/checker/copy';
import type { UnlockFields } from '../../lib/checker/types';
import { EMAIL_RE, LIMITS, normalizePhone } from '../concierge/validation';
import { Honeypot } from './StartForm';

export type UnlockValues = { name: string; email: string; phone: string; okToCall: boolean };

type Props = {
  gated: boolean;
  busy: boolean;
  /** The server's per-field verdicts from a 400, if any. */
  serverFields: UnlockFields | null;
  /** A whole-form problem (rate limit, network). */
  error: string | null;
  onSubmit: (values: UnlockValues | null, honeypot: string) => void;
};

const serverMessage = (v: unknown, fallback: string): string | null => {
  if (v === undefined || v === null || v === false) return null;
  return typeof v === 'string' && v.trim() ? v : fallback;
};

export default function UnlockForm({ gated, busy, serverFields, error, onSubmit }: Props) {
  const id = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [trap, setTrap] = useState('');
  const [local, setLocal] = useState<{ name?: string; email?: string; phone?: string }>({});

  if (!gated) {
    return (
      <section className="ck-card ck-unlock" aria-labelledby={`${id}-h`}>
        <h3 id={`${id}-h`} className="ck-h3">
          {copy.UNLOCK_HEADING}
        </h3>
        <p className="ck-muted">{copy.UNLOCK_TEXT}</p>
        <Honeypot value={trap} onChange={setTrap} />
        {error ? <p className="ck-error" role="alert">{error}</p> : null}
        <button type="button" className="ck-btn ck-btn--primary ck-btn--block" disabled={busy} onClick={() => onSubmit(null, trap)}>
          {busy ? <Loader2 size={18} className="ck-spin" aria-hidden="true" /> : <Unlock size={18} aria-hidden="true" />}
          {copy.SHOW_BREAKDOWN}
        </button>
      </section>
    );
  }

  const errors = {
    name: local.name ?? serverMessage(serverFields?.name, copy.NAME_ERROR) ?? undefined,
    email: local.email ?? serverMessage(serverFields?.email, copy.EMAIL_ERROR) ?? undefined,
    phone: local.phone ?? serverMessage(serverFields?.phone, copy.PHONE_ERROR) ?? undefined,
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof local = {};
    if (!name.trim()) next.name = copy.NAME_ERROR;
    if (!EMAIL_RE.test(email.trim()) || email.trim().length > LIMITS.emailMax) next.email = copy.EMAIL_ERROR;
    if (!normalizePhone(phone)) next.phone = copy.PHONE_ERROR;
    setLocal(next);
    const first = (['name', 'email', 'phone'] as const).find((k) => next[k]);
    if (first) {
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    onSubmit({ name: name.trim(), email: email.trim(), phone: phone.trim(), okToCall: true }, trap);
  };

  const field = (key: 'name' | 'email' | 'phone', label: string, input: React.ReactNode) => (
    <div className="ck-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      {input}
      {errors[key] ? (
        <p id={`${id}-${key}-err`} className="ck-error" role="alert">
          {errors[key]}
        </p>
      ) : null}
    </div>
  );
  const aria = (key: 'name' | 'email' | 'phone') => ({
    'aria-invalid': errors[key] ? (true as const) : undefined,
    'aria-describedby': errors[key] ? `${id}-${key}-err` : undefined,
  });

  return (
    <form className="ck-card ck-unlock ck-form" onSubmit={submit} noValidate aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="ck-h3">
        {copy.UNLOCK_HEADING}
      </h3>
      <p className="ck-muted">{copy.UNLOCK_TEXT}</p>

      {field(
        'name',
        copy.NAME_LABEL,
        <input
          id={`${id}-name`}
          name="name"
          type="text"
          autoComplete="name"
          maxLength={LIMITS.nameMax}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          {...aria('name')}
        />
      )}
      {field(
        'email',
        copy.EMAIL_LABEL,
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          maxLength={LIMITS.emailMax}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          {...aria('email')}
        />
      )}
      {field(
        'phone',
        copy.PHONE_LABEL,
        <input
          id={`${id}-phone`}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={20}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          {...aria('phone')}
        />
      )}

      <Honeypot value={trap} onChange={setTrap} />
      {error ? <p className="ck-error" role="alert">{error}</p> : null}

      <p className="ck-muted" id={`${id}-consent`}>
        {copy.CHECKER_CONSENT_TEXT} <a href={copy.PRIVACY_HREF}>{copy.PRIVACY_LINK_TEXT}</a>.
      </p>
      <button type="submit" className="ck-btn ck-btn--primary ck-btn--block" disabled={busy} aria-describedby={`${id}-consent`}>
        {busy ? <Loader2 size={18} className="ck-spin" aria-hidden="true" /> : <Unlock size={18} aria-hidden="true" />}
        {copy.SHOW_BREAKDOWN}
      </button>
    </form>
  );
}
