import { networkInterfaces } from 'node:os';

export interface LocalAddress {
  address: string;
  /** The network this address sits on, as a prefix to compare others against. */
  prefix: string;
}

/**
 * The addresses this Mac answers on, used both to tell people where to find the
 * admin page and to decide who is allowed to reach it.
 */
export function localAddresses(): LocalAddress[] {
  const found: LocalAddress[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      const parts = entry.address.split('.');
      if (parts.length !== 4) continue;
      found.push({ address: entry.address, prefix: `${parts[0]}.${parts[1]}.${parts[2]}.` });
    }
  }
  return found;
}

export function isLoopback(address: string): boolean {
  const value = address.replace(/^::ffff:/, '');
  return value === '127.0.0.1' || value === '::1' || value.startsWith('127.');
}

/**
 * Only this Mac and the machines sharing its network may reach the admin page.
 *
 * Checking the actual subnet rather than "any private address" matters on a
 * guest network or a VPN, where plenty of private addresses are not the family's
 * at all.
 */
export function isOnOurNetwork(address: string, addresses = localAddresses()): boolean {
  const value = address.replace(/^::ffff:/, '');
  if (isLoopback(value)) return true;
  if (value.startsWith('fe80') || value.startsWith('fd')) return true;   // link-local and unique-local IPv6
  return addresses.some((local) => value.startsWith(local.prefix));
}

/**
 * The names the admin page may be addressed by.
 *
 * A request whose Host header is anything else is refused, which is the standard
 * defence against DNS rebinding: a website the child visits cannot point its own
 * domain at this Mac and then talk to the admin API from inside their browser.
 */
export function allowedHosts(port: number, hostName: string): Set<string> {
  const names = new Set<string>();
  const add = (name: string) => {
    names.add(name.toLowerCase());
    names.add(`${name.toLowerCase()}:${port}`);
  };
  add('localhost');
  add('127.0.0.1');
  add('[::1]');
  add('::1');
  if (hostName) {
    add(hostName);
    add(`${hostName}.local`);
  }
  for (const { address } of localAddresses()) add(address);
  return names;
}

export function hostIsAllowed(hostHeader: string | undefined, allowed: Set<string>): boolean {
  if (!hostHeader) return false;
  return allowed.has(hostHeader.trim().toLowerCase());
}
