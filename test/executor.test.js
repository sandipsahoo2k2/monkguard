import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionExecutor } from '../dist/app/executor.js';
import { stopTab, stopApp, notify } from '../dist/domain/actions.js';
import { defaultState } from '../dist/domain/types.js';
import { app, tab, at, FixedClock } from './helpers.js';

function build() {
  const clock = new FixedClock(at('2026-01-05T15:00:00'));
  const calls = { redirected: [], closed: [], quit: [], forced: [], notices: [], events: [] };
  const state = defaultState();
  state.today.day = '2026-01-05';

  const executor = new ActionExecutor(
    { redirect: (t, url) => calls.redirected.push({ t, url }), close: (t) => calls.closed.push(t) },
    {
      quit: (a) => { calls.quit.push(a); return 'asked'; },
      forceQuit: (a) => calls.forced.push(a),
      isRunning: () => true,
    },
    { notify: (_title, body) => calls.notices.push(body) },
    {
      get: () => state,
      update: (mutate) => { mutate(state); return state; },
      appendEvent: (event) => calls.events.push(event),
    },
    clock,
    (reason) => `http://127.0.0.1:8787/blocked?reason=${reason}`,
  );
  return { executor, calls, clock, state };
}

const block = (overrides = {}) => stopTab({
  tab: tab(overrides.tab), reason: overrides.reason ?? 'shorts', detail: 'because',
  until: null, subject: 'Some reel', eventKind: 'blocked_shorts',
});

test('stopping a tab replaces the page and records why', async () => {
  const { executor, calls } = build();
  await executor.run([block()]);
  assert.equal(calls.redirected.length, 1);
  assert.match(calls.redirected[0].url, /reason=shorts/);
  assert.equal(calls.events[0].kind, 'blocked_shorts');
});

test('a tab is acted on once per tick, so the kid gets one clear reason', async () => {
  const { executor, calls } = build();
  await executor.run([block({ reason: 'shorts' }), block({ reason: 'budget' })]);
  assert.equal(calls.redirected.length, 1);
});

test('a page that keeps coming back loses its tab', async () => {
  const { executor, calls, clock } = build();
  for (let i = 0; i < 4; i += 1) {
    await executor.run([block()]);
    clock.advance(6000);
  }
  assert.equal(calls.closed.length, 1);
  assert.equal(calls.redirected.length, 3);
});

test('strikes fade, so a tab blocked this morning is not closed tonight', async () => {
  const { executor, calls, clock } = build();
  for (let i = 0; i < 6; i += 1) {
    await executor.run([block()]);
    clock.advance(10 * 60_000);
  }
  assert.equal(calls.closed.length, 0);
});

test('a game is warned before it is closed, never surprised', async () => {
  const { executor, calls, clock } = build();
  const action = stopApp(app({ name: 'Steam' }), 60, 'known launcher');

  await executor.run([action]);
  assert.equal(calls.quit.length, 0);
  assert.match(calls.notices[0], /will close in 60 seconds/);

  clock.advance(30_000);
  await executor.run([action]);
  assert.equal(calls.quit.length, 0, 'still inside the grace period');

  clock.advance(31_000);
  await executor.run([action]);
  assert.equal(calls.quit.length, 1);
  assert.equal(calls.events.at(-1).kind, 'app_quit');
});

test('notifications are rate limited rather than repeated every five seconds', async () => {
  const { executor, calls, clock } = build();
  for (let i = 0; i < 10; i += 1) {
    await executor.run([notify('same-thing', 'Time is nearly up')]);
    clock.advance(5000);
  }
  assert.equal(calls.notices.length, 1);
  clock.advance(130_000);
  await executor.run([notify('same-thing', 'Time is nearly up')]);
  assert.equal(calls.notices.length, 2);
});

test('counters land in today, not in a void', async () => {
  const { executor, state } = build();
  await executor.run([{ type: 'count', field: 'shortsBlocked' }, { type: 'count', field: 'shortsBlocked' }]);
  assert.equal(state.today.shortsBlocked, 2);
});

test('a game that is closed and opened again gets a fresh warning', async () => {
  const { executor, calls, clock } = build();
  const action = stopApp(app({ name: 'Steam' }), 60, 'known launcher');

  await executor.run([action]);
  clock.advance(61_000);
  await executor.run([action]);
  assert.equal(calls.quit.length, 1);

  await executor.run([]);                 // the game is gone
  clock.advance(3_600_000);
  await executor.run([action]);           // and now it is back
  assert.equal(calls.quit.length, 1, 'warned again, not closed on sight');
  assert.equal(calls.notices.length, 2);
});
