import { Action, notify, stopApp } from '../actions.js';
import { Rule, Snapshot } from '../snapshot.js';

/**
 * Installed games. A confident verdict is closed with a warning first; an app
 * that merely behaves like a game is never touched, only queued as a question
 * for the admin page, which the engine records.
 */
export const gameAppsRule: Rule = {
  name: 'game-apps',
  evaluate(snapshot: Snapshot): Action[] {
    if (!snapshot.config.rules.blockGames) return [];
    const actions: Action[] = [];
    for (const { app, judgement } of snapshot.apps) {
      if (judgement.verdict === 'game') {
        actions.push(stopApp(app, snapshot.config.rules.gameGraceSeconds, judgement.reasons.join(', ')));
      } else if (judgement.verdict === 'candidate') {
        actions.push(notify(`candidate:${app.bundleId}`,
          `${app.name} looks like a game. It is waiting to be confirmed in the admin page.`,
          1_800_000));
      }
    }
    return actions;
  },
};
