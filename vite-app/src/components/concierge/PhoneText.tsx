import type { ReactNode } from 'react';
import { track } from '../../lib/track';
import { PHONE_DISPLAY, PHONE_HREF } from './copy';

/** Text in which every occurrence of the phone number is a tap-to-call link. */
export default function PhoneText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  text.split(PHONE_DISPLAY).forEach((part, i) => {
    if (i > 0) {
      nodes.push(
        <a
          key={`call-${i}`}
          className="thg-cc-link"
          href={PHONE_HREF}
          onClick={() => track('concierge_call_click', { location: 'panel' })}
        >
          {PHONE_DISPLAY}
        </a>
      );
    }
    if (part) nodes.push(part);
  });
  return <>{nodes}</>;
}
