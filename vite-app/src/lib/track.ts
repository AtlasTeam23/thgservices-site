// The concierge's tracking entry point. It is an alias of analytics.trackEvent()
// so every concierge_* event gets the brand, the DNT/GPC gate and the dev
// logging from one place. Never pass names, phone numbers, emails or message
// text as params.
import { trackEvent, type Params } from './analytics';

export const track = (name: string, params?: Params): void => trackEvent(name, params);
