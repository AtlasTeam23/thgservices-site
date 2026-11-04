import ChatBubble from './ChatBubble';
import { isConciergeEnabled } from './config';

/**
 * The chat helper as the app mounts it. A production build with no Worker URL
 * has nothing to talk to, so it renders nothing (see config.ts).
 */
export default function Concierge() {
  return isConciergeEnabled() ? <ChatBubble /> : null;
}
