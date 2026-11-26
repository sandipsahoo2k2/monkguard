import { Rule } from '../snapshot.js';
import { browserGamesRule } from './browserGames.js';
import { continuousWatchRule } from './continuousWatch.js';
import { gameAppsRule } from './gameApps.js';
import { shortsRule } from './shorts.js';
import { unreadableBrowsersRule } from './unreadableBrowsers.js';
import { videoBudgetRule } from './videoBudget.js';

/**
 * Order matters only for tabs: the executor acts on a tab once per tick, so the
 * first rule to claim a tab decides what the kid is told. Hard bans come first,
 * then the break, then the budget — the most specific explanation wins.
 *
 * Adding a rule means adding a file and one line here. Nothing else changes.
 */
export const RULES: Rule[] = [
  shortsRule,
  browserGamesRule,
  unreadableBrowsersRule,
  continuousWatchRule,
  videoBudgetRule,
  gameAppsRule,
];

export {
  shortsRule, browserGamesRule, unreadableBrowsersRule,
  continuousWatchRule, videoBudgetRule, gameAppsRule,
};
