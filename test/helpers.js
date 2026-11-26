import { defaultConfig, emptyDay } from '../dist/domain/types.js';

export const at = (iso) => new Date(iso);

export function configWith(overrides = {}) {
  const config = defaultConfig();
  return {
    ...config,
    ...overrides,
    rules: { ...config.rules, ...(overrides.rules ?? {}) },
    learned: { ...config.learned, ...(overrides.learned ?? {}) },
  };
}

export function tab(overrides = {}) {
  return {
    browser: 'Safari', windowIndex: 1, tabIndex: 1, active: true,
    url: 'https://example.com', title: 'Example', ...overrides,
  };
}

export function app(overrides = {}) {
  return {
    bundleId: 'com.example.app', name: 'Example', path: '/Applications/Example.app',
    pid: 100, frontmost: false, ...overrides,
  };
}

export function classified(verdictKind, overrides = {}) {
  return {
    tab: tab(overrides.tab),
    verdict: {
      kind: verdictKind,
      label: overrides.label ?? 'Something',
      host: overrides.host ?? 'example.com',
      videoId: null,
      why: overrides.why ?? 'because',
    },
    watched: overrides.watched ?? true,
  };
}

export function snapshot(overrides = {}) {
  const config = overrides.config ?? configWith();
  return {
    now: overrides.now ?? at('2026-01-05T15:00:00'),
    config,
    policy: overrides.policy ?? { state: 'focus', reason: 'Focus time', until: null, enforcing: true },
    apps: overrides.apps ?? [],
    front: overrides.front ?? null,
    tabs: overrides.tabs ?? [],
    usage: { ...emptyDay('2026-01-05'), ...(overrides.usage ?? {}) },
    breakUntil: overrides.breakUntil ?? null,
    watchStreakStart: overrides.watchStreakStart ?? null,
  };
}

/** A snapshot of a quiet machine, unless a test says otherwise. */
export function fakeProbes(overrides = {}) {
  return {
    appsKeepingDisplayAwake: overrides.awake ?? new Set(),
    gpuBusyPercent: overrides.gpu ?? 0,
    gameControllerAttached: overrides.controller ?? false,
    cpuByPid: overrides.cpu === undefined ? {} : { 100: overrides.cpu },
    categoryByPath: overrides.category === undefined ? {} : { '/Applications/Example.app': overrides.category },
  };
}
