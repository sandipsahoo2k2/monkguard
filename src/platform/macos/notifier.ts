import { Notifier } from '../../domain/ports.js';
import { notify } from './exec.js';

/** macOS notifications, which need no entitlement and no bundle. */
export const macNotifier: Notifier = { notify };
