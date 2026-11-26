import { test } from 'node:test';
import assert from 'node:assert/strict';
import { policyStatus, windowContains, minutesOfDay } from '../dist/domain/schedule.js';
import { configWith, at } from './helpers.js';

const MONDAY_4PM = at('2026-01-05T16:30:00');
const MONDAY_8PM = at('2026-01-05T20:00:00');

const freeWindow = {
  id: 'w', label: 'After school', days: [2, 3, 4, 5, 6],
  start: '16:00', end: '17:30', enabled: true,
};

test('inside a free window the rules do not apply', () => {
  const status = policyStatus(configWith({ windows: [freeWindow] }), MONDAY_4PM);
  assert.equal(status.state, 'free');
  assert.equal(status.enforcing, false);
  assert.match(status.reason, /After school/);
});

test('outside every window it is focus time', () => {
  const status = policyStatus(configWith({ windows: [freeWindow] }), MONDAY_8PM);
  assert.equal(status.state, 'focus');
  assert.equal(status.enforcing, true);
});

test('a window only counts on the days it is set for', () => {
  const sunday = at('2026-01-04T16:30:00');
  assert.equal(policyStatus(configWith({ windows: [freeWindow] }), sunday).state, 'focus');
});

test('a disabled window is ignored', () => {
  const windows = [{ ...freeWindow, enabled: false }];
  assert.equal(policyStatus(configWith({ windows }), MONDAY_4PM).state, 'focus');
});

test('a window that crosses midnight covers the small hours of the next day', () => {
  const night = { ...freeWindow, days: [2], start: '22:00', end: '06:00' };
  assert.equal(windowContains(night, at('2026-01-05T23:00:00')), true);   // Monday night
  assert.equal(windowContains(night, at('2026-01-06T02:00:00')), true);   // early Tuesday
  assert.equal(windowContains(night, at('2026-01-06T07:00:00')), false);
});

test('lockdown and allow-all beat the schedule', () => {
  const windows = [freeWindow];
  assert.equal(policyStatus(configWith({ windows, mode: 'lockdown' }), MONDAY_4PM).state, 'focus');
  assert.equal(policyStatus(configWith({ windows, mode: 'free' }), MONDAY_8PM).state, 'free');
});

test('extra free time expires by itself', () => {
  const config = configWith({ windows: [freeWindow], tempUnlockUntil: '2026-01-05T20:15:00.000Z' });
  const during = new Date('2026-01-05T20:05:00.000Z');
  const after = new Date('2026-01-05T20:20:00.000Z');
  assert.equal(policyStatus(config, during).state, 'free');
  assert.equal(policyStatus(config, after).state, 'focus');
});

test('switching the whole guard off stops everything', () => {
  assert.equal(policyStatus(configWith({ enabled: false }), MONDAY_8PM).enforcing, false);
});

test('rubbish times are rejected rather than guessed at', () => {
  assert.equal(minutesOfDay('25:00'), null);
  assert.equal(minutesOfDay('nonsense'), null);
  assert.equal(minutesOfDay('09:30'), 570);
});
