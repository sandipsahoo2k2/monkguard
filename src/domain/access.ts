import { Config } from './types.js';

export interface AccessDecision {
  allowed: boolean;
  /** Said plainly, because this is what a refused device is shown. */
  reason: string;
}

/**
 * May a device other than this Mac reach the admin page right now?
 *
 * A laptop travels. On the home network the family's phones should reach it; in
 * a cafe, the strangers sharing that network should not, and nobody should have
 * to remember to switch that off at the door. The router is the test.
 */
export function mayReachFromNetwork(config: Config, networkId: string): AccessDecision {
  if (config.lanAccess === 'never') {
    return { allowed: false, reason: 'FocusGuard is set to answer only on this Mac.' };
  }
  if (config.lanAccess === 'always') return { allowed: true, reason: '' };

  if (!config.homeNetwork) {
    return {
      allowed: false,
      reason: 'No home network has been chosen yet. Open FocusGuard on the Mac itself and trust this network.',
    };
  }
  if (!networkId) {
    return { allowed: false, reason: 'This network cannot be recognised, so FocusGuard is answering only on the Mac.' };
  }
  if (networkId !== config.homeNetwork) {
    return { allowed: false, reason: 'This is not the home network, so FocusGuard is answering only on the Mac.' };
  }
  return { allowed: true, reason: '' };
}
