import { hostname, userInfo } from 'node:os';
import { localAddresses } from '../../infra/network.js';
import { run } from './exec.js';

export interface DeviceIdentity {
  /** What this Mac is called in Settings, e.g. "Anya's MacBook Air". */
  name: string;
  /** The macOS account MonkGuard is watching. */
  account: string;
  addresses: string[];
  hostName: string;
}

let cached: DeviceIdentity = {
  name: hostname(), account: userInfo().username, addresses: [], hostName: hostname(),
};

/**
 * Which Mac this is.
 *
 * Every Mac runs its own MonkGuard with its own settings, so an admin page
 * only ever controls the machine serving it. Saying plainly which machine that
 * is matters once a house has more than one.
 */
export async function readDeviceIdentity(): Promise<DeviceIdentity> {
  const [name, hostName] = await Promise.all([
    run('/usr/sbin/scutil', ['--get', 'ComputerName'], 4000),
    run('/usr/sbin/scutil', ['--get', 'LocalHostName'], 4000),
  ]);
  cached = {
    name: name.trim() || hostname(),
    account: userInfo().username,
    hostName: hostName.trim() || hostname(),
    addresses: localAddresses().map((entry) => entry.address),
  };
  return cached;
}

export function deviceIdentity(): DeviceIdentity {
  return cached;
}
