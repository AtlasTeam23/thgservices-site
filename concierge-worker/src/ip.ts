// Rate-limit buckets are keyed on a client address, but one household or one hosting
// customer typically controls a whole IPv6 /64 (billions of addresses). Keying on the full
// address would let a single client rotate through fresh buckets at will, so IPv6 is reduced
// to its /64 prefix (the first four hextets). IPv4 is left exactly as it is.

const HEXTET = /^[0-9a-f]{1,4}$/i;
const OCTET = /^\d{1,3}$/;

const parseIpv4 = (text: string): [number, number, number, number] | null => {
  const parts = text.split('.');
  if (parts.length !== 4 || !parts.every((part) => OCTET.test(part))) return null;
  const [a, b, c, d] = parts.map(Number) as [number, number, number, number];
  return [a, b, c, d].every((n) => n <= 255) ? [a, b, c, d] : null;
};

const parseHextets = (text: string): number[] | null => {
  if (text === '') return [];
  const items = text.split(':');
  return items.every((item) => HEXTET.test(item)) ? items.map((item) => Number.parseInt(item, 16)) : null;
};

/** The eight 16-bit groups of an IPv6 address, or null when the text is not one. */
const expandIpv6 = (address: string): number[] | null => {
  let text = address;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    // Embedded IPv4 in the last 32 bits (::ffff:203.0.113.7, 64:ff9b::203.0.113.7).
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = parseHextets(halves[0] ?? '');
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;

  const rest = parseHextets(halves[1] ?? '');
  if (!rest) return null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null; // "::" has to stand for at least one group
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
};

/**
 * The string that identifies a client for rate limiting: the address itself for IPv4,
 * the wrapped IPv4 address for IPv4-mapped IPv6, "v6:" plus the /64 prefix for other IPv6.
 * Anything that does not parse is returned as-is rather than guessed at.
 */
export const ipBucketKey = (rawIp: string): string => {
  let ip = rawIp.trim();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (!ip.includes(':')) return rawIp; // IPv4 (or something unknown): unchanged

  const groups = expandIpv6(ip);
  if (!groups) return rawIp;

  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (mapped) {
    const hi = groups[6] ?? 0;
    const lo = groups[7] ?? 0;
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return `v6:${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}`;
};
