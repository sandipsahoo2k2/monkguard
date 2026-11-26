import { randomBytes } from 'node:crypto';
import { Engine } from '../app/engine.js';
import { minutesOfDay } from '../domain/schedule.js';
import { Config, TimeWindow } from '../domain/types.js';
import { FileStore } from '../infra/store.js';
import { lastKnownNetwork } from '../platform/macos/wifi.js';
import { buildView } from './view.js';

export interface RouteResult {
  status: number;
  body: unknown;
}

export type Route = (body: Record<string, unknown>) => RouteResult;

function clamp(value: unknown, low: number, high: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, Math.round(number)));
}

function parseWindows(input: unknown): TimeWindow[] {
  if (!Array.isArray(input)) return [];
  const windows: TimeWindow[] = [];
  for (const item of input as Record<string, unknown>[]) {
    const start = String(item.start ?? '');
    const end = String(item.end ?? '');
    const days = Array.isArray(item.days)
      ? (item.days as unknown[]).map(Number).filter((day) => day >= 1 && day <= 7)
      : [];
    if (minutesOfDay(start) === null || minutesOfDay(end) === null || days.length === 0) continue;
    windows.push({
      id: typeof item.id === 'string' && item.id ? item.id : randomBytes(6).toString('hex'),
      label: String(item.label ?? 'Free time').trim().slice(0, 40) || 'Free time',
      days,
      start,
      end,
      enabled: item.enabled !== false,
    });
  }
  return windows;
}

function applyRules(body: Record<string, unknown>, config: Config): void {
  const { rules } = config;
  for (const key of ['blockShorts', 'blockGames', 'blockBrowserGames',
    'blockUnreadableBrowsers'] as const) {
    if (typeof body[key] === 'boolean') rules[key] = body[key] as boolean;
  }
  const numbers = [
    ['entertainmentVideoBudgetMin', 0, 1440],
    ['educationalVideoBudgetMin', 0, 1440],
    ['musicBudgetMin', 0, 1440],
    ['continuousWatchLimitMin', 0, 480],
    ['forcedBreakMin', 1, 120],
    ['gameGraceSeconds', 5, 600],
  ] as const;
  for (const [key, low, high] of numbers) {
    if (key in body) rules[key] = clamp(body[key], low, high, rules[key]);
  }
  if (Array.isArray(body.blockedDomains)) {
    rules.blockedDomains = (body.blockedDomains as unknown[])
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }
  if (body.musicMode === 'audio' || body.musicMode === 'all' || body.musicMode === 'off') {
    rules.musicMode = body.musicMode;
  }
  if (typeof body.llmApiKey === 'string') {
    rules.llmApiKey = body.llmApiKey.trim() || null;
  }
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    config.displayName = body.displayName.trim().slice(0, 40);
  }
  if (typeof body.blockPageNote === 'string') config.blockPageNote = body.blockPageNote.trim().slice(0, 120);
}

/**
 * One function per thing a parent can do. Each returns a status and a body; the
 * transport layer knows nothing about what any of them mean.
 */
export function buildRoutes(store: FileStore, engine: Engine): Record<string, Route> {
  const view = (): RouteResult => ({ status: 200, body: buildView(store, engine) });

  return {
    'POST /api/mode': (body) => {
      const mode = body.mode;
      if (mode !== 'auto' && mode !== 'free' && mode !== 'lockdown') {
        return { status: 400, body: { error: 'mode must be auto, free or lockdown' } };
      }
      store.update((config) => {
        config.mode = mode;
        if (mode !== 'free') config.tempUnlockUntil = null;
      });
      store.appendEvent({ kind: 'mode_changed', subject: mode, detail: 'set from the admin page' });
      return view();
    },

    'POST /api/unlock': (body) => {
      const minutes = clamp(body.minutes, 1, 480, 15);
      const until = new Date(Date.now() + minutes * 60_000);
      // A pause sits on top of the chosen mode and never changes it, so
      // "Always" is still "Always" when the pause runs out.
      store.update((config) => { config.tempUnlockUntil = until.toISOString(); });
      store.appendEvent({
        kind: 'temp_unlock',
        subject: `${minutes} min`,
        detail: 'blocking paused from the admin page',
      });
      return view();
    },

    'POST /api/endunlock': () => {
      store.update((config) => { config.tempUnlockUntil = null; });
      store.appendEvent({ kind: 'temp_unlock_ended', subject: 'pause', detail: 'ended from the admin page' });
      return view();
    },

    'POST /api/rules': (body) => {
      store.update((config) => applyRules(body, config));
      return view();
    },

    'POST /api/windows': (body) => {
      const windows = parseWindows(body.windows);
      store.update((config) => { config.windows = windows; });
      store.appendEvent({
        kind: 'schedule_changed',
        subject: `${windows.length} windows`,
        detail: 'set from the admin page',
      });
      return view();
    },

    'POST /api/verdict': (body) => {
      const bundleId = typeof body.bundleId === 'string' ? body.bundleId : '';
      if (!bundleId) return { status: 400, body: { error: 'bundleId required' } };
      const isGame = body.isGame === true;
      store.update((config) => { config.learned.appVerdicts[bundleId] = isGame; });
      store.stateView.update((state) => {
        state.pending = state.pending.filter((question) => question.bundleId !== bundleId);
      });
      store.appendEvent({
        kind: 'verdict',
        subject: bundleId,
        detail: isGame ? 'marked as a game' : 'marked as not a game',
      });
      return view();
    },

    // The browser derives the new verifier itself and sends only that, so a PIN
    // change puts no more on the network than a login does.
    'POST /api/pin': (body) => {
      const salt = String(body.salt ?? '');
      const verifier = String(body.verifier ?? '');
      const iterations = Number(body.iterations ?? 0);
      const valid = /^[0-9a-f]{32}$/.test(salt)
        && /^[0-9a-f]{64}$/.test(verifier)
        && iterations >= 50_000 && iterations <= 1_000_000;
      if (!valid) return { status: 400, body: { error: 'that PIN could not be saved' } };

      store.setVerifier(salt, verifier, iterations);
      store.appendEvent({
        kind: 'pin_changed',
        subject: 'admin page',
        detail: 'the PIN was changed, and every signed-in device was signed out',
      });
      return view();
    },

    'POST /api/endbreak': () => {
      store.stateView.update((state) => {
        state.breakUntil = null;
        state.watchStreakStart = null;
      });
      return view();
    },

    'POST /api/resetbudget': () => {
      store.stateView.update((state) => {
        state.today.entertainmentSeconds = 0;
        state.today.educationalSeconds = 0;
        state.breakUntil = null;
        state.watchStreakStart = null;
      });
      store.appendEvent({
        kind: 'budget_reset',
        subject: 'today',
        detail: "today's video budget was cleared",
      });
      return view();
    },

    /** Says "this is the network my family's phones may use", once, from the Mac. */
    'POST /api/trust-network': () => {
      const network = lastKnownNetwork();
      if (!network.id) {
        return { status: 400, body: { error: 'this network cannot be recognised yet, try again in a moment' } };
      }
      store.update((config) => {
        config.homeNetwork = network.id;
        config.lanAccess = 'home';
      });
      store.appendEvent({
        kind: 'network_trusted',
        subject: network.gateway,
        detail: 'phones on this network may now open the admin page',
      });
      return view();
    },

    'POST /api/lan-access': (body) => {
      const mode = body.mode;
      if (mode !== 'home' && mode !== 'always' && mode !== 'never') {
        return { status: 400, body: { error: 'mode must be home, always or never' } };
      }
      store.update((config) => { config.lanAccess = mode; });
      store.appendEvent({ kind: 'lan_access_changed', subject: mode, detail: 'set from the admin page' });
      return view();
    },

    'GET /api/status': () => view(),
  };
}
