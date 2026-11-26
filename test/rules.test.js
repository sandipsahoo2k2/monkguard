import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shortsRule, browserGamesRule, videoBudgetRule,
  continuousWatchRule, gameAppsRule, unreadableBrowsersRule,
} from '../dist/domain/rules/index.js';
import { app, classified, configWith, snapshot, at } from './helpers.js';

const of = (actions, type) => actions.filter((action) => action.type === type);

test('shorts are stopped during focus time', () => {
  const actions = shortsRule.evaluate(snapshot({ tabs: [classified('shorts')] }));
  assert.equal(of(actions, 'stopTab').length, 1);
  assert.equal(of(actions, 'count')[0].field, 'shortsBlocked');
});

test('shorts are left alone when the parent switched that rule off', () => {
  const config = configWith({ rules: { blockShorts: false } });
  assert.deepEqual(shortsRule.evaluate(snapshot({ config, tabs: [classified('shorts')] })), []);
});

test('a background shorts tab is stopped too, not only the visible one', () => {
  const background = classified('shorts', { watched: false, tab: { active: false } });
  assert.equal(of(shortsRule.evaluate(snapshot({ tabs: [background] })), 'stopTab').length, 1);
});

test('browser games are stopped', () => {
  const actions = browserGamesRule.evaluate(snapshot({ tabs: [classified('gameSite')] }));
  assert.equal(of(actions, 'stopTab').length, 1);
});

test('nothing happens while the daily budget still has room', () => {
  const state = snapshot({ tabs: [classified('entertainment')], usage: { entertainmentSeconds: 60 } });
  assert.deepEqual(videoBudgetRule.evaluate(state), []);
});

test('two minutes before the budget runs out the kid is warned, not cut off', () => {
  const state = snapshot({
    tabs: [classified('entertainment')],
    usage: { entertainmentSeconds: 29 * 60 },    // 30 minute budget
  });
  const actions = videoBudgetRule.evaluate(state);
  assert.equal(of(actions, 'stopTab').length, 0);
  assert.equal(of(actions, 'notify').length, 1);
  assert.match(of(actions, 'notify')[0].body, /more minute/);
});

test('the video stops once the budget is spent', () => {
  const state = snapshot({
    tabs: [classified('entertainment')],
    usage: { entertainmentSeconds: 30 * 60 },
  });
  const stop = of(videoBudgetRule.evaluate(state), 'stopTab');
  assert.equal(stop.length, 1);
  assert.equal(stop[0].reason, 'budget');
});

test('learning video is unlimited when its budget is zero', () => {
  const state = snapshot({
    tabs: [classified('educational')],
    usage: { educationalSeconds: 5 * 3600 },
  });
  assert.deepEqual(videoBudgetRule.evaluate(state), []);
});

test('a budget only applies to the tab actually being watched', () => {
  const state = snapshot({
    tabs: [classified('entertainment', { watched: false })],
    usage: { entertainmentSeconds: 99 * 60 },
  });
  assert.deepEqual(videoBudgetRule.evaluate(state), []);
});

test('watching too long in a row forces a break, budget or no budget', () => {
  const now = at('2026-01-05T15:30:00');
  const state = snapshot({
    now,
    tabs: [classified('entertainment')],
    watchStreakStart: at('2026-01-05T15:00:00'),   // 30 minutes, limit is 25
  });
  const actions = continuousWatchRule.evaluate(state);
  assert.equal(of(actions, 'startBreak').length, 1);
  assert.equal(of(actions, 'stopTab')[0].reason, 'break');
});

test('a break that is already running keeps the video stopped', () => {
  const now = at('2026-01-05T15:30:00');
  const state = snapshot({
    now,
    tabs: [classified('educational')],
    breakUntil: at('2026-01-05T15:33:00'),
  });
  assert.equal(of(continuousWatchRule.evaluate(state), 'stopTab').length, 1);
});

test('a short streak is left alone', () => {
  const state = snapshot({
    now: at('2026-01-05T15:10:00'),
    tabs: [classified('entertainment')],
    watchStreakStart: at('2026-01-05T15:00:00'),
  });
  assert.deepEqual(continuousWatchRule.evaluate(state), []);
});

test('a confirmed game is closed, with a warning first', () => {
  const judged = { app: app({ name: 'Steam' }), judgement: { verdict: 'game', score: 100, reasons: ['known launcher'] } };
  const actions = gameAppsRule.evaluate(snapshot({ apps: [judged] }));
  assert.equal(of(actions, 'stopApp').length, 1);
  assert.equal(of(actions, 'stopApp')[0].graceSeconds, 60);
});

test('an app that merely looks like a game is never closed, only asked about', () => {
  const judged = { app: app({ name: 'Mystery' }), judgement: { verdict: 'candidate', score: 6, reasons: ['keeps the display awake'] } };
  const actions = gameAppsRule.evaluate(snapshot({ apps: [judged] }));
  assert.equal(of(actions, 'stopApp').length, 0);
  assert.equal(of(actions, 'notify').length, 1);
});

test('Firefox is closed during focus time because its tabs cannot be read', () => {
  const judged = { app: app({ bundleId: 'org.mozilla.firefox', name: 'Firefox' }), judgement: { verdict: 'notGame', score: 0, reasons: [] } };
  const actions = unreadableBrowsersRule.evaluate(snapshot({ apps: [judged] }));
  assert.equal(of(actions, 'stopApp').length, 1);
  assert.match(of(actions, 'notify')[0].body, /Safari or Chrome/);
});

test('Safari is not touched by that rule', () => {
  const judged = { app: app({ bundleId: 'com.apple.Safari', name: 'Safari' }), judgement: { verdict: 'notGame', score: 0, reasons: [] } };
  assert.deepEqual(unreadableBrowsersRule.evaluate(snapshot({ apps: [judged] })), []);
});
