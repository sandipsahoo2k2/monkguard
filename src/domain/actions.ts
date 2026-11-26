import { AppObservation, TabObservation } from './types.js';

export type BlockReason = 'shorts' | 'game' | 'budget' | 'break';

/**
 * What a rule wants done. Rules never touch the system: they return intent, and
 * one executor decides how to carry it out, which is where the escalation ladder
 * and the "do not spam" limits live.
 */
export type Action =
  | {
      type: 'stopTab';
      tab: TabObservation;
      reason: BlockReason;
      detail: string;
      until: Date | null;
      subject: string;
      eventKind: string;
    }
  | { type: 'stopApp'; app: AppObservation; graceSeconds: number; why: string }
  | { type: 'notify'; key: string; body: string; everyMs?: number }
  | { type: 'event'; kind: string; subject: string; detail: string }
  | { type: 'count'; field: 'shortsBlocked' | 'gamesBlocked' }
  | { type: 'startBreak'; until: Date };

export const stopTab = (action: Omit<Extract<Action, { type: 'stopTab' }>, 'type'>): Action =>
  ({ type: 'stopTab', ...action });
export const stopApp = (app: AppObservation, graceSeconds: number, why: string): Action =>
  ({ type: 'stopApp', app, graceSeconds, why });
export const notify = (key: string, body: string, everyMs?: number): Action =>
  ({ type: 'notify', key, body, everyMs });
export const event = (kind: string, subject: string, detail: string): Action =>
  ({ type: 'event', kind, subject, detail });
export const count = (field: 'shortsBlocked' | 'gamesBlocked'): Action =>
  ({ type: 'count', field });
export const startBreak = (until: Date): Action => ({ type: 'startBreak', until });
