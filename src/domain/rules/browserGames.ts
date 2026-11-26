import { Action, count, stopTab } from '../actions.js';
import { Rule, Snapshot } from '../snapshot.js';

/** Games that need no install because they run in a tab. */
export const browserGamesRule: Rule = {
  name: 'browser-games',
  evaluate(snapshot: Snapshot): Action[] {
    if (!snapshot.config.rules.blockBrowserGames) return [];
    return snapshot.tabs
      .filter(({ verdict }) => verdict.kind === 'gameSite')
      .flatMap(({ tab, verdict }) => [
        count('gamesBlocked'),
        stopTab({
          tab,
          reason: 'game',
          detail: verdict.why,
          until: snapshot.policy.until,
          subject: verdict.label,
          eventKind: 'blocked_browser_game',
        }),
      ]);
  },
};
