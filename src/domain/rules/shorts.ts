import { Action, count, stopTab } from '../actions.js';
import { Rule, Snapshot } from '../snapshot.js';

/** Reels, shorts and anything the family added to the blocked list. */
export const shortsRule: Rule = {
  name: 'shorts',
  evaluate(snapshot: Snapshot): Action[] {
    if (!snapshot.config.rules.blockShorts) return [];
    return snapshot.tabs
      .filter(({ verdict }) => verdict.kind === 'shorts')
      .flatMap(({ tab, verdict }) => [
        count('shortsBlocked'),
        stopTab({
          tab,
          reason: 'shorts',
          detail: verdict.why,
          until: snapshot.policy.until,
          subject: verdict.label,
          eventKind: 'blocked_shorts',
        }),
      ]);
  },
};
