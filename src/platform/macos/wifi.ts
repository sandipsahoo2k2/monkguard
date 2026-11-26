import { createHash } from 'node:crypto';
import { run } from './exec.js';

export interface NetworkFingerprint {
  /** A hash of the router this Mac is talking through. Never the address itself. */
  id: string;
  /** The gateway address, shown so a person can recognise their own network. */
  gateway: string;
}

const UNKNOWN: NetworkFingerprint = { id: '', gateway: '' };

/**
 * Which network this Mac is on, identified by its router rather than its name.
 *
 * The router's hardware address is stable for a given network and needs no
 * permission to read, unlike the wifi name, which modern macOS hides behind
 * Location Services. Only a hash of it is kept, so the settings file says
 * nothing about where the family lives.
 */
export async function readNetwork(): Promise<NetworkFingerprint> {
  const routes = await run('/usr/sbin/netstat', ['-rn', '-f', 'inet'], 5000);
  const line = routes.split('\n').find((candidate) => /^default\s/.test(candidate));
  const gateway = line?.split(/\s+/)[1] ?? '';
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(gateway)) return UNKNOWN;

  const arp = await run('/usr/sbin/arp', ['-n', gateway], 5000);
  const mac = /([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})/i.exec(arp)?.[1];
  if (!mac) return { id: '', gateway };

  return {
    id: createHash('sha256').update(mac.toLowerCase()).digest('hex').slice(0, 16),
    gateway,
  };
}

let current: NetworkFingerprint = UNKNOWN;
let checkedAt = 0;

/** Cached, because the answer only changes when somebody moves house or cafe. */
export async function currentNetwork(maxAgeMs = 30_000): Promise<NetworkFingerprint> {
  if (Date.now() - checkedAt < maxAgeMs) return current;
  current = await readNetwork();
  checkedAt = Date.now();
  return current;
}

export function lastKnownNetwork(): NetworkFingerprint {
  return current;
}
