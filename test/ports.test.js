import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listenOnFreePort } from '../dist/infra/ports.js';
import { FileStore, readListeningPort } from '../dist/infra/store.js';
import { AdminServer } from '../dist/server/http.js';
import { waitForAdminPage } from '../dist/app/install.js';

const close = (server) => new Promise((resolve) => server.close(resolve));

/** Stands in for some other app that got to a port first. */
async function occupy(host) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, host, resolve));
  return { server, port: server.address().port };
}

function temporary() {
  return mkdtempSync(join(tmpdir(), 'monkguard-'));
}

test('a free port is used as it is', async () => {
  const other = await occupy('127.0.0.1');
  await close(other.server);
  const server = createServer();
  assert.equal(await listenOnFreePort(server, other.port, '127.0.0.1'), other.port);
  await close(server);
});

test('a busy port is skipped for a higher free one', async () => {
  for (const [theirs, ours] of [['127.0.0.1', '127.0.0.1'], ['127.0.0.1', '0.0.0.0'], ['0.0.0.0', '0.0.0.0']]) {
    const other = await occupy(theirs);
    const server = createServer();
    const port = await listenOnFreePort(server, other.port, ours);
    assert.ok(port > other.port, `${ours} must not share ${theirs}:${other.port}`);
    await close(server);
    await close(other.server);
  }
});

test('the admin page saves the port it moved to, and answers there', async () => {
  const other = await occupy('127.0.0.1');
  const directory = temporary();
  const store = new FileStore(directory);
  store.update((config) => { config.serverPort = other.port; config.bindAddress = '127.0.0.1'; });
  const admin = new AdminServer(store, { live: [] });
  try {
    const port = await admin.listen();
    assert.ok(port > other.port);
    assert.equal(store.get().serverPort, port);
    assert.equal(readListeningPort(directory), port);
    assert.equal(store.stateView.get().events[0].kind, 'port_changed');
    const answer = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(answer.status, 200);
  } finally {
    admin.close();
    await close(other.server);
    rmSync(directory, { recursive: true, force: true });
  }
});

test('install waits for the page to report its port, and gives up if it never does', async () => {
  const directory = temporary();
  try {
    assert.equal(await waitForAdminPage(directory, 10), null);
    setTimeout(() => writeFileSync(join(directory, 'listening.json'), '{"port":8790}'), 100);
    assert.equal(await waitForAdminPage(directory, 5000), 8790);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
