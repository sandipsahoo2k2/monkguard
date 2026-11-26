import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
