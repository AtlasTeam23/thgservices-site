import { useMemo, useState, type FormEvent } from 'react';

// Web3Forms access key. This is a public, per-destination key — it's
// designed to be exposed in client-side code. To rotate, generate a new
// one at https://web3forms.com/ with developer@leadquik.com.
const WEB3FORMS_ACCESS_KEY = '433cf71b-c9f0-4bce-b431-a25edde9d59a';

type Status = 'idle' | 'submitting' | 'success' | 'error';

const labelStyle = {
  display: 'block',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: '11px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: 'rgba(255, 255, 255, 0.55)',
  marginBottom: '8px',
  textAlign: 'left' as const,
};

const inputBase = {
  width: '100%',
  padding: '12px 16px',
  backgroundColor: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: '8px',
  color: '#FFFFFF',
  fontFamily: "'Outfit', sans-serif",
  fontSize: '15px',
  outline: 'none',
  transition: 'border-color 0.2s ease, background-color 0.2s ease',
  boxSizing: 'border-box' as const,
};

function focusOn(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.4)';
  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
}
function focusOff(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
}

export default function ContactForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [mathSeed, setMathSeed] = useState(0);

  const { a, b } = useMemo(() => {
    const a = 1 + Math.floor(Math.random() * 8);
    const b = 1 + Math.floor(Math.random() * 8);
    return { a, b };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mathSeed]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const mathInput = parseInt((fd.get('math_answer') as string) || '', 10);
    if (mathInput !== a + b) {
      setErrorMsg(`That doesn't add up — what is ${a} + ${b}?`);
      setStatus('error');
      return;
    }

    setStatus('submitting');
    setErrorMsg('');

    try {
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          name: fd.get('name'),
          email: fd.get('email'),
          phone: fd.get('phone') || '',
          message: fd.get('message'),
          botcheck: fd.get('botcheck') || '',
          subject: 'Inquiry from thgservices.io',
          from_name: 'thgservices.io contact form',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus('success');
        form.reset();
        setMathSeed((s) => s + 1);
      } else {
        setStatus('error');
        setErrorMsg(data.message || 'Something went wrong. Please try again.');
      }
    } catch {
      setStatus('error');
      setErrorMsg('Network error. Please try again.');
    }
  }

  if (status === 'success') {
    return (
      <div
        role="status"
        style={{
          marginTop: '36px',
          padding: '32px 24px',
          borderRadius: '12px',
          backgroundColor: 'rgba(37, 99, 235, 0.08)',
          border: '1px solid rgba(37, 99, 235, 0.25)',
          color: '#FFFFFF',
          fontFamily: "'Outfit', sans-serif",
          fontSize: '16px',
          lineHeight: 1.5,
          textAlign: 'center',
        }}
      >
        Thanks — your message is on its way. We&rsquo;ll be in touch shortly.
        <div style={{ marginTop: '16px' }}>
          <button
            type="button"
            onClick={() => setStatus('idle')}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.55)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Send another →
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        marginTop: '36px',
        maxWidth: '480px',
        marginLeft: 'auto',
        marginRight: 'auto',
        textAlign: 'left',
      }}
      noValidate
    >
      {/* Honeypot — bots fill this, humans don't see it */}
      <input
        type="checkbox"
        name="botcheck"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '-9999px',
          width: 0,
          height: 0,
          opacity: 0,
        }}
      />

      <div style={{ marginBottom: '18px' }}>
        <label htmlFor="cf-name" style={labelStyle}>
          Name
        </label>
        <input
          id="cf-name"
          name="name"
          type="text"
          required
          autoComplete="name"
          style={inputBase}
          onFocus={focusOn}
          onBlur={focusOff}
        />
      </div>

      <div style={{ marginBottom: '18px' }}>
        <label htmlFor="cf-email" style={labelStyle}>
          Email
        </label>
        <input
          id="cf-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          style={inputBase}
          onFocus={focusOn}
          onBlur={focusOff}
        />
      </div>

      <div style={{ marginBottom: '18px' }}>
        <label htmlFor="cf-phone" style={labelStyle}>
          Phone <span style={{ textTransform: 'none', opacity: 0.6 }}>(optional)</span>
        </label>
        <input
          id="cf-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          style={inputBase}
          onFocus={focusOn}
          onBlur={focusOff}
        />
      </div>

      <div style={{ marginBottom: '18px' }}>
        <label htmlFor="cf-message" style={labelStyle}>
          Message
        </label>
        <textarea
          id="cf-message"
          name="message"
          required
          rows={5}
          style={{
            ...inputBase,
            resize: 'vertical',
            minHeight: '120px',
            lineHeight: 1.5,
            fontFamily: "'Outfit', sans-serif",
          }}
          onFocus={focusOn}
          onBlur={focusOff}
        />
      </div>

      <div style={{ marginBottom: '24px' }}>
        <label htmlFor="cf-math" style={labelStyle}>
          Quick check: what is {a} + {b}?
        </label>
        <input
          id="cf-math"
          name="math_answer"
          type="text"
          inputMode="numeric"
          required
          autoComplete="off"
          style={{ ...inputBase, maxWidth: '140px' }}
          onFocus={focusOn}
          onBlur={focusOff}
        />
      </div>

      {status === 'error' && (
        <div
          role="alert"
          style={{
            marginBottom: '18px',
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: 'rgba(255, 200, 200, 0.95)',
            fontFamily: "'Outfit', sans-serif",
            fontSize: '14px',
            lineHeight: 1.5,
          }}
        >
          {errorMsg}
        </div>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '48px',
          padding: '0 32px',
          borderRadius: '24px',
          backgroundColor: status === 'submitting' ? '#1E40AF' : '#2563EB',
          color: '#FFFFFF',
          fontFamily: "'Outfit', sans-serif",
          fontSize: '14px',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          border: 'none',
          cursor: status === 'submitting' ? 'wait' : 'pointer',
          transition: 'background-color 0.2s ease',
          opacity: status === 'submitting' ? 0.85 : 1,
        }}
        onMouseEnter={(e) => {
          if (status !== 'submitting')
            (e.currentTarget as HTMLElement).style.backgroundColor = '#1E40AF';
        }}
        onMouseLeave={(e) => {
          if (status !== 'submitting')
            (e.currentTarget as HTMLElement).style.backgroundColor = '#2563EB';
        }}
      >
        {status === 'submitting' ? 'Sending…' : 'Send Message'}
      </button>
    </form>
  );
}
