import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const wordsData = [
  { word: 'RESPOND', subtitle: 'Inbound Lead Response in Seconds' },
  { word: 'CONNECT', subtitle: 'SMS, Email & Voice in One Place' },
  { word: 'OPERATE', subtitle: 'Workflows that Match How You Work' },
  { word: 'REPORT', subtitle: 'Visibility Into What Matters' },
];

const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

class ScrambleText {
  textElement: HTMLElement;
  onComplete?: () => void;
  totalDuration: number;
  persist: boolean;
  actualText: string;
  progress: { t: number };
  complete: { c: number };
  totalCharacters: number;

  constructor(textElement: HTMLElement, options: {
    text?: string;
    duration?: number;
    persist?: boolean;
    onComplete?: () => void;
  } = {}) {
    this.textElement = textElement;
    this.onComplete = options.onComplete;
    this.totalDuration = options.duration || 2.0;
    this.persist = options.persist || false;
    this.actualText = options.text || '';
    this.totalCharacters = this.actualText.length;
    this.progress = { t: 0 };
    this.complete = { c: 0 };

    gsap.fromTo(
      this.progress,
      { t: 0 },
      {
        t: 100,
        duration: this.totalDuration,
        ease: 'power2.out',
        onUpdate: () => {
          this.textElement.innerHTML = this.animate();
        },
        onComplete: () => {
          this.textElement.innerHTML = this.actualText;
          if (this.onComplete) this.onComplete();
          if (!this.persist) this.hide();
        },
      }
    );
  }

  animate(): string {
    let str = '';
    for (let i = 0; i < this.totalCharacters; i++) {
      let progress =
        (this.progress.t - i * (100 / this.totalCharacters)) /
        (100 / this.totalCharacters);
      progress = Math.max(0, Math.min(1, progress));
      if (Math.random() < progress * 0.5) {
        str += this.actualText[i];
      } else {
        str += CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      }
    }
    return str;
  }

  hide() {
    gsap.to(this.textElement, {
      opacity: 0,
      duration: 0.6,
      delay: 1.5,
      ease: 'power2.inOut',
    });
  }
}

export default function Capabilities() {
  const sectionRef = useRef<HTMLElement>(null);
  const wordRefs = useRef<(HTMLDivElement | null)[]>([]);
  const subtitleRef = useRef<HTMLDivElement>(null);
  const hasTriggered = useRef(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const st = ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: '+=3000',
      pin: true,
      scrub: false,
      onEnter: () => {
        if (hasTriggered.current) return;
        hasTriggered.current = true;

        // Fade in section
        gsap.to(section, { opacity: 1, duration: 0.6, onComplete: startSequence });
      },
    });

    function startSequence() {
      let wordIndex = 0;

      function showNextWord() {
        if (wordIndex >= wordsData.length) return;
        const data = wordsData[wordIndex];
        const wordEl = wordRefs.current[wordIndex];
        const subtitleEl = subtitleRef.current;
        if (!wordEl || !subtitleEl) return;

        // Hide previous words
        wordRefs.current.forEach((el, i) => {
          if (el && i !== wordIndex) {
            gsap.set(el, { opacity: 0 });
          }
        });

        gsap.set(wordEl, { opacity: 1 });
        gsap.set(subtitleEl, { opacity: 0, textContent: data.subtitle });

        new ScrambleText(wordEl, {
          text: data.word,
          duration: 2,
          persist: true,
          onComplete: () => {
            gsap.to(subtitleEl, { opacity: 1, duration: 0.4 });
            gsap.to(subtitleEl, {
              opacity: 0,
              duration: 0.4,
              delay: 1.5,
              onComplete: () => {
                wordIndex++;
                showNextWord();
              },
            });
          },
        });
      }

      showNextWord();
    }

    return () => {
      st.kill();
    };
  }, []);

  return (
    <section
      id="capabilities"
      ref={sectionRef}
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        backgroundColor: '#000000',
        backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
        opacity: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          position: 'relative',
          minHeight: '200px',
          justifyContent: 'center',
        }}
      >
        {wordsData.map((_data, i) => (
          <div
            key={i}
            ref={(el) => { wordRefs.current[i] = el; }}
            className="scramble-word"
            style={{
              position: i === 0 ? 'relative' : 'absolute',
              opacity: 0,
              whiteSpace: 'nowrap',
            }}
          />
        ))}
      </div>
      <div ref={subtitleRef} className="scramble-subtitle" />
    </section>
  );
}