import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The PIN is never sent anywhere, not even over the home network.
 *
 * Stored is a verifier, PBKDF2 over the PIN. To log in, the browser is given a
 * one-time number, derives the same verifier from the PIN that was typed, and
 * returns an HMAC of that number. The service checks it against its own copy.
 * Nothing on the wire can be replayed, and nothing on the wire reveals the PIN —
 * which is what makes plain HTTP on a home network acceptable here, with no
 * certificate warnings for anybody to learn to click through.
 *
 * The verifier is password-equivalent to whoever can read config.json, but
 * anybody who can read that file is already on the Mac as its owner.
 */
export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_KEY_BYTES = 32;

export function deriveVerifier(pin: string, salt: string, iterations = PBKDF2_ITERATIONS): string {
  return pbkdf2Sync(pin.normalize('NFKC'), salt, iterations, PBKDF2_KEY_BYTES, 'sha256').toString('hex');
}

export function proofFor(verifier: string, nonce: string): string {
  return createHmac('sha256', Buffer.from(verifier, 'hex')).update(nonce).digest('hex');
}

export function proofMatches(expected: string, given: string): boolean {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
  } catch {
    return false;
  }
}

export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

/** A PIN nobody has to think of, and nobody has seen before. */
export function generatePin(digits = 6): string {
  const max = 10 ** digits;
  return String(randomBytes(4).readUInt32BE(0) % max).padStart(digits, '0');
}

export const isHex = (value: unknown, bytes: number): value is string =>
  typeof value === 'string' && new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value);
