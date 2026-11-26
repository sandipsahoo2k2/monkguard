import { Action, notify, stopApp } from '../actions.js';
import { UNREADABLE_BROWSERS } from '../patterns.js';
import { Rule, Snapshot } from '../snapshot.js';

/**
 * Firefox, Tor and Opera cannot be read, so during focus time they are closed
 * rather than watched — an unreadable browser is a hole big enough for every
 * reel on the internet. The kid is told which browsers do work.
 */
export const unreadableBrowsersRule: Rule = {
  name: 'unreadable-browsers',
  evaluate(snapshot: Snapshot): Action[] {
    if (!snapshot.config.rules.blockUnreadableBrowsers) return [];
    const actions: Action[] = [];
    for (const { app } of snapshot.apps) {
      const name = UNREADABLE_BROWSERS[app.bundleId];
      if (!name) continue;
      actions.push(
        notify(`unreadable:${app.bundleId}`,
          `${name} cannot be checked, so it closes during focus time. Use Safari or Chrome.`, 600_000),
        stopApp(app, Math.min(20, snapshot.config.rules.gameGraceSeconds),
          'this browser cannot be checked during focus time'),
      );
    }
    return actions;
  },
};
