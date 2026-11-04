import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/hash';
import { ipBucketKey } from '../src/ip';
import { chatIpName, leadIpName } from '../src/limits';

describe('ipBucketKey', () => {
  it('leaves IPv4 addresses unchanged', () => {
    expect(ipBucketKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucketKey('198.51.100.255')).toBe('198.51.100.255');
  });

  it('reduces an IPv6 address to its /64 prefix (the first four hextets)', () => {
    expect(ipBucketKey('2001:db8:1:2:3:4:5:6')).toBe('v6:2001:db8:1:2');
    expect(ipBucketKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('v6:2001:db8:1:2');
  });

  it('gives every address in one /64 the same key, however it is written', () => {
    const key = 'v6:2001:db8:1:2';
    for (const address of [
      '2001:db8:1:2::1',
      '2001:DB8:1:2::ABCD',
      '2001:0db8:0001:0002:0000:0000:0000:0001',
      '2001:db8:1:2:dead:beef:cafe:f00d',
      '[2001:db8:1:2::9]',
      '2001:db8:1:2::9%eth0',
    ]) {
      expect(ipBucketKey(address), address).toBe(key);
    }
  });

  it('separates different /64 prefixes', () => {
    expect(ipBucketKey('2001:db8:1:3::1')).not.toBe(ipBucketKey('2001:db8:1:2::1'));
    expect(ipBucketKey('2001:db9:1:2::1')).not.toBe(ipBucketKey('2001:db8:1:2::1'));
  });

  it('expands :: correctly, including at the start and end', () => {
    expect(ipBucketKey('2001:db8::1')).toBe('v6:2001:db8:0:0');
    expect(ipBucketKey('::1')).toBe('v6:0:0:0:0');
    expect(ipBucketKey('::')).toBe('v6:0:0:0:0');
    expect(ipBucketKey('fe80::')).toBe('v6:fe80:0:0:0');
    expect(ipBucketKey('1:2:3:4::')).toBe('v6:1:2:3:4');
    expect(ipBucketKey('1::8')).toBe('v6:1:0:0:0');
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 address it wraps', () => {
    expect(ipBucketKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucketKey('::FFFF:cb00:7107')).toBe('203.0.113.7');
  });

  it('handles an embedded IPv4 tail in other positions', () => {
    expect(ipBucketKey('64:ff9b::203.0.113.7')).toBe('v6:64:ff9b:0:0');
  });

  it.each(['', 'garbage', '1:2:3', '2001:db8:::1', '12345::1', 'g::1', '1:2:3:4:5:6:7:8:9', '::ffff:999.1.1.1', '1::2::3'])(
    'returns unparseable input %j unchanged rather than guessing',
    (value) => {
      expect(ipBucketKey(value)).toBe(value);
    },
  );
});

describe('limiter names use the /64 bucket', () => {
  const SALT = 'test-salt';

  it('hashes IPv4 exactly as before', async () => {
    expect(await chatIpName('203.0.113.7', SALT)).toBe(`ip:chat:${await sha256Hex('203.0.113.7' + SALT)}`);
    expect(await leadIpName('203.0.113.7', SALT)).toBe(`ip:lead:${await sha256Hex('203.0.113.7' + SALT)}`);
  });

  it('gives two addresses in one /64 the same chat and lead bucket', async () => {
    expect(await chatIpName('2001:db8:1:2::1', SALT)).toBe(await chatIpName('2001:db8:1:2:aaaa:bbbb:cccc:dddd', SALT));
    expect(await leadIpName('2001:db8:1:2::1', SALT)).toBe(await leadIpName('2001:db8:1:2:aaaa:bbbb:cccc:dddd', SALT));
  });

  it('gives different /64 prefixes different buckets, and never exposes the address', async () => {
    const a = await chatIpName('2001:db8:1:2::1', SALT);
    const b = await chatIpName('2001:db8:1:3::1', SALT);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^ip:chat:[0-9a-f]{64}$/);
    expect(a).not.toContain('2001');
  });
});
