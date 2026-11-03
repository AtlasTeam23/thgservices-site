import { useEffect, useRef } from 'react';

type Msg = { c: 'in' | 'out'; t: string; m: string };

const SCRIPTS: Msg[][] = [
  [
    { c: 'in', t: 'NEW LEAD · WEB FORM', m: 'Hi — need a quote to refinish about 800 sq ft of oak floors. Marietta.' },
    { c: 'out', t: 'LEADQUIK AI · REPLIED', m: 'Thanks, Sarah! We can get you a quote this week. Does Thursday at 10 or 2 work for a quick walkthrough?' },
    { c: 'in', t: 'LEAD', m: 'Thursday at 2 works.' },
  ],
  [
    { c: 'in', t: 'MISSED CALL · AFTER HOURS', m: '(678) ••• 0412 — no voicemail left' },
    { c: 'out', t: 'LEADQUIK AI · TEXTED', m: "Sorry we missed you! This is THG — what can we help with? You can book a time right here." },
    { c: 'in', t: 'LEAD', m: 'Looking for a quote on cabinet painting.' },
  ],
  [
    { c: 'in', t: 'GOOGLE ADS · NEW LEAD', m: 'Epoxy garage floor, 2-car. How soon can you start?' },
    { c: 'out', t: 'LEADQUIK AI · REPLIED', m: 'We have openings next week. Want me to set up a free estimate? I just need your address.' },
    { c: 'in', t: 'LEAD', m: 'Yes please — Woodstock, 30189.' },
  ],
];

const LINE_1 = ['Software', 'built', 'by'];
const LINE_2 = ['an', 'operator,', 'not', 'a', 'vendor.'];

export default function Hero() {
  const feedRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const stTitleRef = useRef<HTMLElement>(null);
  const stSubRef = useRef<HTMLElement>(null);
  const timerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    let scriptIndex = 0;
    const feed = feedRef.current;
    const bars = barsRef.current?.querySelectorAll<HTMLSpanElement>('span');
    const stT = stTitleRef.current;
    const stS = stSubRef.current;
    const timer = timerRef.current;
    if (!feed || !bars || !stT || !stS || !timer) return;

    const wait = (ms: number) =>
      new Promise<void>((r) => setTimeout(r, ms));

    async function run() {
      while (!cancelled) {
        const s = SCRIPTS[scriptIndex++ % SCRIPTS.length];
        feed!.innerHTML = '';
        bars!.forEach((b) => b.classList.remove('on'));
        stT!.textContent = 'Listening for leads…';
        stS!.textContent = 'AI first touch · human fallback';
        timer!.textContent = '0.0s';
        await wait(900);
        if (cancelled) return;

        const start = performance.now();
        let ticking = true;
        const tick = () => {
          if (!ticking || cancelled) return;
          timer!.textContent =
            (((performance.now() - start) / 1000) * 6.2).toFixed(1) + 's';
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);

        for (let k = 0; k < s.length; k++) {
          if (cancelled) return;
          const d = document.createElement('div');
          d.className = 'msg ' + s[k].c;
          const small = document.createElement('small');
          small.textContent = s[k].t;
          d.appendChild(small);
          d.appendChild(document.createTextNode(s[k].m));
          feed!.appendChild(d);
          requestAnimationFrame(() => d.classList.add('show'));
          bars![k].classList.add('on');
          stT!.textContent =
            k === 0 ? 'Lead captured' : k === 1 ? 'Replied instantly' : 'Conversation routed';
          await wait(1700);
        }
        ticking = false;
        bars![3].classList.add('on');
        stT!.textContent = 'Appointment booked';
        stS!.textContent = 'Synced to LeadQuik CRM';
        await wait(3400);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const smooth = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="hero-v2" id="hero">
      <div className="bg">
        <div className="field" />
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          src="/thg-ambient-loop.mp4"
          poster="/thg-hero-poster.jpg"
          onError={() => videoRef.current?.remove()}
        />
      </div>
      <div className="scrim" />
      <div className="grain" />

      <header className="hero-header">
        <a
          className="logo"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          aria-label="THG AI Services"
        >
          <span className="mark">
            <span className="t">T</span>
            <span className="h">H</span>
            <span className="g">G</span>
          </span>
          <span className="sub">AI SERVICES</span>
        </a>
        <nav className="pill">
          <a href="#why" onClick={smooth('#why')}>Why</a>
          <a href="#products" onClick={smooth('#products')}>Products</a>
          <a href="#consulting" onClick={smooth('#consulting')}>Consulting</a>
          <a href="#capabilities" onClick={smooth('#capabilities')}>Capabilities</a>
          <a href="#about" onClick={smooth('#about')}>About</a>
          <a className="cta" href="#contact" onClick={smooth('#contact')}>Contact us</a>
        </nav>
      </header>

      <div className="wrap">
        <div>
          <div className="eyebrow">
            <span className="dot" />
            SOFTWARE STUDIO · WOODSTOCK, GA
          </div>
          <h1>
            <span className="line">
              {LINE_1.map((w, i) => (
                <span key={w + i}>
                  <span
                    className="w"
                    style={{ animationDelay: `${0.15 + 0.07 * i}s` }}
                  >
                    {w}
                  </span>
                  {i < LINE_1.length - 1 ? ' ' : null}
                </span>
              ))}
            </span>
            <span className="soft">
              {LINE_2.map((w, i) => (
                <span key={w + i}>
                  <span
                    className="w"
                    style={{ animationDelay: `${0.15 + 0.07 * (LINE_1.length + i)}s` }}
                  >
                    {w}
                  </span>
                  {i < LINE_2.length - 1 ? ' ' : null}
                </span>
              ))}
            </span>
          </h1>
          <p className="lede">
            THG AI Services is the software studio of a 25-year
            entrepreneur — a multi-state operator who&rsquo;s been
            running companies since long before the apps existed.
            LeadQuik is our flagship, with more products in the
            pipeline.
          </p>
          <div className="actions">
            <a className="btn primary" href="#products" onClick={smooth('#products')}>
              Our products →
            </a>
            <a className="btn ghost" href="#contact" onClick={smooth('#contact')}>
              Contact us
            </a>
          </div>
          <div className="proof">
            <div className="chips">
              <span style={{ background: '#2563EB' }}>LQ</span>
              <span style={{ background: '#0EA5E9' }}>BB</span>
              <span style={{ background: '#6366F1' }}>ML</span>
              <span style={{ background: '#1E3A8A' }}>CP</span>
            </div>
            <span className="proof-text">
              <span>Multiple products shipped</span>
              <span className="sep"> · </span>
              <span>More in the pipeline</span>
            </span>
          </div>
        </div>

        <aside className="card" aria-label="LeadQuik live session demo">
          <div className="card-top">
            <span>LeadQuik · Live session</span>
            <span className="live"><i />LIVE</span>
          </div>
          <div className="orb" aria-hidden="true">
            <span /><span /><span /><span /><span />
            <span /><span /><span /><span />
          </div>
          <div className="feed-stack">
            {/* Invisible copies reserve the tallest script's height so the card never resizes. */}
            {SCRIPTS.map((script, i) => (
              <div className="feed sizer" aria-hidden="true" key={i}>
                {script.map((m) => (
                  <div className={`msg ${m.c}`} key={m.t}>
                    <small>{m.t}</small>
                    {m.m}
                  </div>
                ))}
              </div>
            ))}
            <div className="feed" ref={feedRef} />
          </div>
          <div className="bars" ref={barsRef}>
            <span /><span /><span /><span />
          </div>
          <div className="status">
            <div>
              <b ref={stTitleRef as React.RefObject<HTMLElement>}>Listening for leads…</b>
              <br />
              <em ref={stSubRef as React.RefObject<HTMLElement>}>AI first touch · human fallback</em>
            </div>
            <div className="timer" ref={timerRef}>0.0s</div>
          </div>
        </aside>
      </div>
      <div className="loc">33.97° N · 84.52° W</div>

      <style>{`
        .hero-v2 {
          --v2-navy: #050B1C;
          --v2-navy-2: #0A1128;
          --v2-blue: #2563EB;
          --v2-blue-2: #3B82F6;
          --v2-sky: #7DB4FF;
          --v2-silver: #C9D2E3;
          --v2-text: #F4F7FC;
          --v2-muted: #94A3BF;
          --v2-line: rgba(160, 190, 255, .16);
          --v2-glass: rgba(14, 26, 58, .42);
          position: relative;
          min-height: 100vh;
          overflow: hidden;
          isolation: isolate;
          display: flex;
          flex-direction: column;
          background: var(--v2-navy);
          color: var(--v2-text);
          font-family: Inter, system-ui, sans-serif;
          -webkit-font-smoothing: antialiased;
        }
        .hero-v2 * { box-sizing: border-box; }

        .hero-v2 .bg { position: absolute; inset: 0; z-index: -2; overflow: hidden; }
        .hero-v2 .bg video {
          position: absolute; inset: 0; width: 100%; height: 100%;
          object-fit: cover; opacity: .95;
        }
        .hero-v2 .field {
          position: absolute; inset: -20%; z-index: -3;
          background:
            radial-gradient(40% 45% at 72% 48%, rgba(37, 99, 235, .55), transparent 70%),
            radial-gradient(30% 35% at 85% 20%, rgba(125, 180, 255, .25), transparent 70%),
            radial-gradient(35% 40% at 60% 85%, rgba(30, 64, 175, .45), transparent 70%),
            var(--v2-navy);
          filter: blur(20px);
          animation: v2-breathe 14s ease-in-out infinite alternate;
        }
        @keyframes v2-breathe {
          0% { transform: scale(1) translate(0, 0); }
          100% { transform: scale(1.12) translate(-3%, 2%); }
        }
        .hero-v2 .scrim {
          position: absolute; inset: 0; z-index: -1;
          background:
            linear-gradient(90deg, rgba(5, 11, 28, .92) 0%, rgba(5, 11, 28, .62) 42%, rgba(5, 11, 28, .12) 70%, rgba(5, 11, 28, .35) 100%),
            linear-gradient(180deg, rgba(5, 11, 28, .55) 0%, transparent 25%, transparent 75%, rgba(5, 11, 28, .9) 100%);
        }
        .hero-v2 .grain {
          position: absolute; inset: 0; z-index: -1; opacity: .07; pointer-events: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        }

        .hero-v2 .hero-header {
          display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
          padding: 22px clamp(16px, 4vw, 48px); gap: 16px;
          max-width: 1360px; margin: 0 auto; width: 100%;
        }
        .hero-v2 .logo {
          display: flex; flex-direction: column; align-items: center; line-height: 1; text-decoration: none;
          justify-self: start;
        }
        .hero-v2 .logo .mark {
          font-family: Outfit; font-weight: 800; font-size: 28px; letter-spacing: .02em;
        }
        .hero-v2 .logo .t { color: #fff; }
        .hero-v2 .logo .h {
          background: linear-gradient(180deg, #E8EDF5, #8C99B0);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .hero-v2 .logo .g {
          background: linear-gradient(180deg, #5B9BFF, #1D4ED8);
          -webkit-background-clip: text; background-clip: text; color: transparent;
        }
        .hero-v2 .logo .sub {
          font-family: Outfit; font-weight: 600; font-size: 8.5px; letter-spacing: .32em;
          color: var(--v2-silver); margin-top: 3px; display: flex; align-items: center; gap: 5px;
        }
        .hero-v2 .logo .sub::before, .hero-v2 .logo .sub::after {
          content: ""; width: 10px; height: 1px; background: var(--v2-silver); opacity: .6;
        }
        .hero-v2 nav.pill {
          display: flex; align-items: center; gap: 4px; padding: 6px;
          border: 1px solid var(--v2-line); border-radius: 999px;
          background: rgba(10, 20, 46, .45); backdrop-filter: blur(14px);
        }
        .hero-v2 nav.pill a {
          color: var(--v2-silver); text-decoration: none; font-size: 13.5px;
          padding: 8px 14px; border-radius: 999px; transition: .2s;
        }
        .hero-v2 nav.pill a:hover { color: #fff; background: rgba(255, 255, 255, .06); }
        .hero-v2 nav.pill a.cta { background: #fff; color: var(--v2-navy); font-weight: 600; }

        .hero-v2 .wrap {
          flex: 1; display: grid; grid-template-columns: 1.15fr .85fr;
          align-items: center; gap: clamp(24px, 4vw, 64px);
          padding: clamp(24px, 5vh, 60px) clamp(16px, 4vw, 48px) clamp(48px, 8vh, 96px);
          max-width: 1360px; margin: 0 auto; width: 100%;
        }
        .hero-v2 .eyebrow {
          font-family: "JetBrains Mono", monospace; font-size: 12px; letter-spacing: .18em;
          color: var(--v2-sky); display: inline-flex; align-items: center; gap: 10px; margin-bottom: 22px;
        }
        .hero-v2 .eyebrow .dot {
          width: 7px; height: 7px; border-radius: 50%; background: var(--v2-blue-2);
          box-shadow: 0 0 12px var(--v2-blue-2); animation: v2-pulse 2s infinite;
        }
        @keyframes v2-pulse { 50% { opacity: .35; } }
        .hero-v2 h1 {
          font-family: Outfit; font-weight: 600;
          font-size: clamp(40px, 6.4vw, 88px); line-height: .98; letter-spacing: -.035em;
          margin: 0;
        }
        .hero-v2 h1 .line, .hero-v2 h1 .soft { display: block; }
        .hero-v2 h1 .soft { text-wrap: balance; }
        .hero-v2 h1 .soft .w {
          background: linear-gradient(90deg, #B4C4E4 0%, #6E9BFF 70%, #3B82F6 100%);
          -webkit-background-clip: text; background-clip: text; color: transparent;
          padding-bottom: .08em;
        }
        .hero-v2 h1 .w {
          display: inline-block; opacity: 0; transform: translateY(24px); filter: blur(8px);
          animation: v2-rise .9s cubic-bezier(.2, .7, .2, 1) forwards;
        }
        @keyframes v2-rise { to { opacity: 1; transform: none; filter: none; } }
        .hero-v2 .lede {
          max-width: 520px; color: var(--v2-muted);
          font-size: clamp(15px, 1.25vw, 17px); line-height: 1.6; margin-top: 26px;
          opacity: 0; animation: v2-rise .9s .9s forwards;
        }
        .hero-v2 .actions {
          display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px;
          opacity: 0; animation: v2-rise .9s 1.1s forwards;
        }
        .hero-v2 .btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 13px 20px; border-radius: 12px; font-size: 14.5px; font-weight: 600;
          text-decoration: none; transition: .2s;
        }
        .hero-v2 .btn.primary {
          background: var(--v2-blue); color: #fff;
          box-shadow: 0 8px 30px rgba(37, 99, 235, .45), inset 0 1px 0 rgba(255, 255, 255, .2);
        }
        .hero-v2 .btn.primary:hover { background: var(--v2-blue-2); transform: translateY(-1px); }
        .hero-v2 .btn.ghost {
          border: 1px solid var(--v2-line); color: var(--v2-text);
          background: rgba(255, 255, 255, .04); backdrop-filter: blur(8px);
        }
        .hero-v2 .btn.ghost:hover { background: rgba(255, 255, 255, .09); }
        .hero-v2 .proof {
          display: inline-flex; align-items: center; gap: 12px; margin-top: 34px;
          padding: 7px 14px 7px 7px; border: 1px solid var(--v2-line); border-radius: 999px;
          background: rgba(10, 20, 46, .5); backdrop-filter: blur(10px);
          font-size: 13px; color: var(--v2-silver);
          opacity: 0; animation: v2-rise .9s 1.3s forwards;
        }
        .hero-v2 .chips { display: flex; }
        .hero-v2 .chips span {
          width: 26px; height: 26px; border-radius: 50%;
          border: 2px solid var(--v2-navy-2);
          display: grid; place-items: center;
          font-size: 8.5px; letter-spacing: -.02em; font-weight: 700; color: #fff;
          margin-left: -8px;
        }
        .hero-v2 .chips span:first-child { margin-left: 0; }

        .hero-v2 .card {
          position: relative; border: 1px solid var(--v2-line); border-radius: 22px;
          background: var(--v2-glass); backdrop-filter: blur(22px) saturate(140%);
          padding: 18px;
          box-shadow: 0 30px 80px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .08);
          opacity: 0; animation: v2-rise 1s .6s forwards;
          max-width: 430px; justify-self: end; width: 100%;
        }
        .hero-v2 .card::before {
          content: ""; position: absolute; inset: -1px; border-radius: 22px; padding: 1px;
          background: linear-gradient(140deg, rgba(125, 180, 255, .55), transparent 40%, transparent 60%, rgba(37, 99, 235, .5));
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none;
        }
        .hero-v2 .card-top {
          display: flex; justify-content: space-between; align-items: center;
          font-size: 12.5px; color: var(--v2-silver);
        }
        .hero-v2 .live {
          font-family: "JetBrains Mono", monospace; font-size: 10.5px; letter-spacing: .12em;
          color: #9EF0C5; display: flex; align-items: center; gap: 6px;
          padding: 4px 9px; border-radius: 999px;
          background: rgba(30, 200, 120, .1); border: 1px solid rgba(80, 230, 150, .25);
        }
        .hero-v2 .live i {
          width: 6px; height: 6px; border-radius: 50%; background: #4ADE80;
          box-shadow: 0 0 8px #4ADE80; animation: v2-pulse 1.4s infinite;
        }
        .hero-v2 .orb {
          height: 150px; margin: 14px 0; border-radius: 14px; position: relative; overflow: hidden;
          border: 1px solid rgba(120, 160, 255, .08);
          background: radial-gradient(80% 100% at 50% 50%, rgba(20, 30, 65, .6), rgba(6, 10, 24, .9) 80%);
          display: flex; align-items: center; justify-content: center; gap: 7px;
        }
        .hero-v2 .orb span {
          width: 5px; height: 40%; border-radius: 3px;
          background: linear-gradient(180deg, #22D3EE, #4A9EFF, #2563EB);
          box-shadow: 0 0 12px rgba(74, 158, 255, .55);
          animation: v2-eq 1.4s ease-in-out infinite;
        }
        @keyframes v2-eq {
          0%, 100% { height: 9%; opacity: .55; }
          50%     { height: 65%; opacity: 1; }
        }
        .hero-v2 .orb span:nth-child(1) { animation-delay: 0.00s; animation-duration: 1.10s; }
        .hero-v2 .orb span:nth-child(2) { animation-delay: 0.18s; animation-duration: 1.30s; }
        .hero-v2 .orb span:nth-child(3) { animation-delay: 0.32s; animation-duration: 1.00s; }
        .hero-v2 .orb span:nth-child(4) { animation-delay: 0.08s; animation-duration: 1.50s; }
        .hero-v2 .orb span:nth-child(5) { animation-delay: 0.42s; animation-duration: 1.20s; }
        .hero-v2 .orb span:nth-child(6) { animation-delay: 0.14s; animation-duration: 1.35s; }
        .hero-v2 .orb span:nth-child(7) { animation-delay: 0.26s; animation-duration: 1.15s; }
        .hero-v2 .orb span:nth-child(8) { animation-delay: 0.38s; animation-duration: 1.45s; }
        .hero-v2 .orb span:nth-child(9) { animation-delay: 0.06s; animation-duration: 1.25s; }
        .hero-v2 .feed-stack { display: grid; }
        .hero-v2 .feed-stack > .feed { grid-area: 1 / 1; min-width: 0; }
        .hero-v2 .feed { display: flex; flex-direction: column; gap: 9px; }
        .hero-v2 .feed.sizer { visibility: hidden; }
        .hero-v2 .msg {
          font-size: 13px; line-height: 1.45; padding: 10px 12px; border-radius: 12px;
          border: 1px solid var(--v2-line);
          opacity: 0; transform: translateY(8px); transition: .5s;
        }
        .hero-v2 .msg.show { opacity: 1; transform: none; }
        .hero-v2 .msg small {
          display: block; font-family: "JetBrains Mono", monospace;
          font-size: 10px; letter-spacing: .08em; color: var(--v2-muted); margin-bottom: 3px;
        }
        .hero-v2 .msg.in { background: rgba(255, 255, 255, .04); }
        .hero-v2 .msg.out { background: rgba(37, 99, 235, .18); border-color: rgba(91, 140, 255, .35); }
        .hero-v2 .bars { display: flex; gap: 6px; margin: 14px 0 10px; }
        .hero-v2 .bars span {
          flex: 1; height: 3px; border-radius: 3px;
          background: rgba(255, 255, 255, .12); overflow: hidden; position: relative;
        }
        .hero-v2 .bars span::after {
          content: ""; position: absolute; inset: 0;
          background: linear-gradient(90deg, var(--v2-blue), var(--v2-sky));
          transform: scaleX(0); transform-origin: left; transition: transform .6s;
        }
        .hero-v2 .bars span.on::after { transform: scaleX(1); }
        .hero-v2 .status {
          display: flex; justify-content: space-between; align-items: flex-end; gap: 10px;
        }
        .hero-v2 .status b { font-family: Outfit; font-weight: 600; font-size: 16px; }
        .hero-v2 .status em { font-style: normal; font-size: 12px; color: var(--v2-muted); }
        .hero-v2 .timer {
          font-family: "JetBrains Mono", monospace; font-size: 22px; color: var(--v2-sky);
        }

        .hero-v2 .loc {
          position: absolute; bottom: 22px;
          left: calc(max(0px, (100% - 1360px) / 2) + clamp(16px, 4vw, 48px));
          font-family: "JetBrains Mono", monospace;
          font-size: 11px; letter-spacing: .16em; color: var(--v2-muted);
        }

        @media (max-width: 900px) {
          .hero-v2 nav.pill a:not(.cta) { display: none; }
          .hero-v2 .hero-header { grid-template-columns: 1fr auto; }
          .hero-v2 .wrap { grid-template-columns: 1fr; }
          .hero-v2 .card { justify-self: stretch; max-width: none; }
          .hero-v2 .loc { display: none; }
        }
        @media (max-width: 450px) {
          .hero-v2 .proof-text > span { display: block; }
          .hero-v2 .proof-text .sep { display: none; }
        }
        @media (max-width: 380px) {
          .hero-v2 .eyebrow { letter-spacing: .1em; }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-v2 *,
          .hero-v2 *::before,
          .hero-v2 *::after { animation: none !important; transition: none !important; }
          .hero-v2 .orb span:nth-child(3n+1) { height: 28%; }
          .hero-v2 .orb span:nth-child(3n+2) { height: 62%; }
          .hero-v2 h1 .w, .hero-v2 .lede, .hero-v2 .actions,
          .hero-v2 .proof, .hero-v2 .card {
            opacity: 1; transform: none; filter: none;
          }
        }
      `}</style>
    </section>
  );
}
