import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, pbkdf2Sync } from 'node:crypto';
import { allowedHosts, hostIsAllowed, isOnOurNetwork, isLoopback } from '../dist/infra/network.js';
import { deriveVerifier, proofFor, proofMatches, generatePin, isHex, PBKDF2_ITERATIONS }
  from '../dist/infra/credentials.js';

const ourNetwork = [{ address: '192.168.50.10', prefix: '192.168.50.' }];

test('this Mac can always reach itself', () => {
  assert.equal(isOnOurNetwork('127.0.0.1', ourNetwork), true);
  assert.equal(isLoopback('::1'), true);
});

test('another device on the same wifi is allowed', () => {
  assert.equal(isOnOurNetwork('192.168.50.70', ourNetwork), true);
});

test('a private address on some other network is refused', () => {
  // A VPN or a guest network hands out private addresses too, and those are
  // not the family's devices.
  assert.equal(isOnOurNetwork('192.168.1.50', ourNetwork), false);
  assert.equal(isOnOurNetwork('10.8.0.6', ourNetwork), false);
});

test('a public address is refused outright', () => {
  assert.equal(isOnOurNetwork('93.184.216.34', ourNetwork), false);
});

test('only the names this Mac answers to are accepted', () => {
  const hosts = allowedHosts(8787, 'Family-MacBook');
  assert.equal(hostIsAllowed('127.0.0.1:8787', hosts), true);
  assert.equal(hostIsAllowed('family-macbook.local:8787', hosts), true);
  assert.equal(hostIsAllowed('localhost:8787', hosts), true);
});

test('a rebinding attempt is refused', () => {
  // The signature of DNS rebinding: a page points its own domain at this Mac so
  // its scripts can talk to the admin page from inside somebody's browser.
  const hosts = allowedHosts(8787, 'Family-MacBook');
  assert.equal(hostIsAllowed('evil.example.com:8787', hosts), false);
  assert.equal(hostIsAllowed('focusguard.attacker.net', hosts), false);
  assert.equal(hostIsAllowed(undefined, hosts), false);
});

test('the verifier is ordinary PBKDF2, so the browser can derive the same one', () => {
  const salt = 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8';
  assert.equal(
    deriveVerifier('482913', salt),
    pbkdf2Sync('482913', salt, PBKDF2_ITERATIONS, 32, 'sha256').toString('hex'),
  );
});

test('the right PIN proves itself and a wrong one does not', () => {
  const salt = 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8';
  const stored = deriveVerifier('482913', salt);
  const nonce = 'f00dcafef00dcafef00dcafef00dcafe';

  const honest = proofFor(deriveVerifier('482913', salt), nonce);
  assert.equal(proofMatches(proofFor(stored, nonce), honest), true);

  const guess = proofFor(deriveVerifier('000000', salt), nonce);
  assert.equal(proofMatches(proofFor(stored, nonce), guess), false);
});

test('a proof for one number is useless for another, so nothing replays', () => {
  const salt = 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8';
  const stored = deriveVerifier('482913', salt);
  const captured = proofFor(stored, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(proofMatches(proofFor(stored, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'), captured), false);
});

test('rubbish instead of a proof is rejected without throwing', () => {
  const stored = deriveVerifier('482913', 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8');
  const expected = proofFor(stored, 'f00dcafef00dcafef00dcafef00dcafe');
  for (const nonsense of ['', 'zz', 'not hex at all', 'a'.repeat(64)]) {
    assert.equal(proofMatches(expected, nonsense), false);
  }
});

test('the proof is a plain HMAC, which is what the page computes', () => {
  const verifier = deriveVerifier('123456', 'a1b2c3d4e5f6a7b8a1b2c3d4e5f6a7b8');
  const nonce = 'f00dcafef00dcafef00dcafef00dcafe';
  assert.equal(proofFor(verifier, nonce),
    createHmac('sha256', Buffer.from(verifier, 'hex')).update(nonce).digest('hex'));
});

test('a generated PIN is six digits and not a memorable default', () => {
  const pins = new Set(Array.from({ length: 50 }, () => generatePin()));
  for (const pin of pins) assert.match(pin, /^\d{6}$/);
  assert.ok(pins.size > 40, 'generated PINs should not repeat');
  assert.equal(pins.has('1234'), false);
});

test('hex checking is strict about length', () => {
  assert.equal(isHex('a'.repeat(64), 32), true);
  assert.equal(isHex('a'.repeat(63), 32), false);
  assert.equal(isHex('g'.repeat(64), 32), false);
  assert.equal(isHex(42, 32), false);
});

import { mayReachFromNetwork } from '../dist/domain/access.js';
import { defaultConfig } from '../dist/domain/types.js';

const withNetwork = (overrides) => ({ ...defaultConfig(), ...overrides });

test('at home, the family phones are let in', () => {
  const config = withNetwork({ homeNetwork: 'abc123', lanAccess: 'home' });
  assert.equal(mayReachFromNetwork(config, 'abc123').allowed, true);
});

test('on a cafe network, nobody but the Mac itself is let in', () => {
  const config = withNetwork({ homeNetwork: 'abc123', lanAccess: 'home' });
  const decision = mayReachFromNetwork(config, 'cafe999');
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /not the home network/);
});

test('an unrecognised network is treated as strange, not as home', () => {
  const config = withNetwork({ homeNetwork: 'abc123', lanAccess: 'home' });
  assert.equal(mayReachFromNetwork(config, '').allowed, false);
});

test('before a home network is chosen, the page stays on the Mac', () => {
  assert.equal(mayReachFromNetwork(withNetwork({ homeNetwork: null }), 'abc123').allowed, false);
});

test('"only this Mac" means exactly that, even at home', () => {
  const config = withNetwork({ homeNetwork: 'abc123', lanAccess: 'never' });
  assert.equal(mayReachFromNetwork(config, 'abc123').allowed, false);
});

test('"any network" is honoured for anybody who really wants it', () => {
  const config = withNetwork({ homeNetwork: null, lanAccess: 'always' });
  assert.equal(mayReachFromNetwork(config, 'cafe999').allowed, true);
});
