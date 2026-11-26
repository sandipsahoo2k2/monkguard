import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../dist/infra/store.js';
import { buildRoutes } from '../dist/server/routes.js';

function withRoutes(run) {
  const directory = mkdtempSync(join(tmpdir(), 'monk-'));
  try {
    const store = new FileStore(directory);
    run(store, buildRoutes(store, { live: [] }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('pausing under "Always" keeps "Always", so blocking comes back', () => {
  withRoutes((store, routes) => {
    routes['POST /api/mode']({ mode: 'lockdown' });
    const paused = routes['POST /api/unlock']({ minutes: 15 }).body;
    assert.equal(paused.state, 'free');
    assert.equal(store.get().mode, 'lockdown');

    const resumed = routes['POST /api/endunlock']({}).body;
    assert.equal(resumed.state, 'focus');
    assert.equal(resumed.mode, 'lockdown');
  });
});

test('choosing a blocking mode cancels a running pause', () => {
  withRoutes((store, routes) => {
    routes['POST /api/unlock']({ minutes: 60 });
    routes['POST /api/mode']({ mode: 'lockdown' });
    assert.equal(store.get().tempUnlockUntil, null);
  });
});

test('answering "is this a game?" is remembered and clears the question', () => {
  withRoutes((store, routes) => {
    store.stateView.update((state) => {
      state.pending.push({ bundleId: 'com.example.quest', name: 'Quest', secondsToday: 60, reasons: [], firstSeen: '' });
    });
    const view = routes['POST /api/verdict']({ bundleId: 'com.example.quest', isGame: true }).body;
    assert.equal(view.pending.length, 0);
    assert.equal(store.get().learned.appVerdicts['com.example.quest'], true);
  });
});

test('the admin page spells the app id the way the server does', () => {
  const page = readFileSync(new URL('../web/admin.html', import.meta.url), 'utf8');
  assert.match(page, /p\.bundleId/);
  assert.doesNotMatch(page, /bundleID/);
});
