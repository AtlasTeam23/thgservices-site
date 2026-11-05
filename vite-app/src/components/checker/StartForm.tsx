import { useId, useState } from 'react';
import { Search } from 'lucide-react';
import * as copy from '../../lib/checker/copy';
import { INDUSTRIES, isProfile } from '../../lib/checker/config';
import type { Profile } from '../../lib/checker/types';

export type StartValues = { website: string; industry: Profile | ''; city: string };

type Props = {
  initial: StartValues;
  /** A message from a failed attempt (already worded for the visitor). */
  error?: string | null;
  onSubmit: (values: StartValues, honeypot: string) => void;
};

export default function StartForm({ initial, error, onSubmit }: Props) {
  const id = useId();
  const [website, setWebsite] = useState(initial.website);
  const [industry, setIndustry] = useState<Profile | ''>(initial.industry);
  const [city, setCity] = useState(initial.city);
  const [trap, setTrap] = useState('');
  const [industryError, setIndustryError] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!industry) {
      setIndustryError(true);
      return;
    }
    setIndustryError(false);
    onSubmit({ website, industry, city }, trap);
  };

  return (
    <form className="ck-card ck-form" onSubmit={submit} noValidate>
      <div className="ck-field">
        <label htmlFor={`${id}-site`}>{copy.WEBSITE_LABEL}</label>
        <input
          id={`${id}-site`}
          name="website"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={copy.WEBSITE_PLACEHOLDER}
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          required
        />
        {error ? (
          <p id={`${id}-err`} className="ck-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="ck-field">
        <label htmlFor={`${id}-industry`}>{copy.INDUSTRY_LABEL}</label>
        <select
          id={`${id}-industry`}
          name="industry"
          value={industry}
          onChange={(e) => {
            const v = e.target.value;
            setIndustry(isProfile(v) ? v : '');
            setIndustryError(false);
          }}
          aria-invalid={industryError ? true : undefined}
          aria-describedby={industryError ? `${id}-ind-err` : undefined}
        >
          <option value="">{copy.INDUSTRY_PLACEHOLDER}</option>
          {INDUSTRIES.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </select>
        {industryError ? (
          <p id={`${id}-ind-err`} className="ck-error" role="alert">
            {copy.INDUSTRY_REQUIRED}
          </p>
        ) : null}
      </div>

      <div className="ck-field">
        <label htmlFor={`${id}-city`}>{copy.CITY_LABEL}</label>
        <input
          id={`${id}-city`}
          name="city"
          type="text"
          autoComplete="postal-code"
          maxLength={60}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          aria-describedby={`${id}-city-help`}
        />
        <p id={`${id}-city-help`} className="ck-help">
          {copy.CITY_HELP}
        </p>
      </div>

      <Honeypot value={trap} onChange={setTrap} />

      <button type="submit" className="ck-btn ck-btn--primary ck-btn--block">
        <Search size={18} aria-hidden="true" />
        {copy.CHECK_BUTTON}
      </button>
      <p className="ck-muted">{copy.START_SMALL_PRINT}</p>
    </form>
  );
}

/** A field people never see. Bots that fill every input fill this one too. */
export function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="ck-trap" aria-hidden="true">
      <label>
        Company website
        <input
          type="text"
          name="company_website"
          tabIndex={-1}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}
