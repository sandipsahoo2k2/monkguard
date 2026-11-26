import { Engine } from '../app/engine.js';
import { policyStatus } from '../domain/schedule.js';
import { FileStore } from '../infra/store.js';
import { deviceIdentity } from '../platform/macos/device.js';
import { lastKnownNetwork } from '../platform/macos/wifi.js';
import { permissions } from '../platform/macos/exec.js';

const toMinutes = (seconds: number): number => Math.floor(seconds / 60);

/** Everything the admin page shows, in one object, shaped for the page rather
 *  than for storage. Keeping it here means the page never reads raw state. */
export function buildView(store: FileStore, engine: Engine): Record<string, unknown> {
  const config = store.get();
  const state = store.stateView.get();
  const status = policyStatus(config);

  const device = deviceIdentity();
  const network = lastKnownNetwork();

  return {
    network: {
      gateway: network.gateway,
      onHomeNetwork: Boolean(config.homeNetwork) && network.id === config.homeNetwork,
      homeNetworkChosen: Boolean(config.homeNetwork),
      lanAccess: config.lanAccess,
      bindAddress: config.bindAddress,
    },
    // Which Mac this page controls, and only this one: every Mac runs its own
    // MonkGuard with its own settings. The address comes first, because that is
    // what tells two machines apart before anybody has named them; the name is
    // whatever the admin typed, never what macOS decided to call the machine.
    device: {
      name: config.displayName,
      addresses: device.addresses,
      port: config.serverPort,
      account: device.account,
      /** Offered as a suggestion when naming it, nothing more. */
      systemName: device.name,
      model: device.model,
      hostName: device.hostName,
    },
    displayName: config.displayName,
    blockPageNote: config.blockPageNote,
    enabled: config.enabled,
    mode: config.mode,
    defaultState: config.defaultState,
    state: status.state,
    reason: status.reason,
    until: status.until?.toISOString() ?? '',
    tempUnlockUntil: config.tempUnlockUntil ?? '',
    breakUntil: state.breakUntil ?? '',
    streakMinutes: state.watchStreakStart
      ? Math.floor((Date.now() - Date.parse(state.watchStreakStart)) / 60_000)
      : 0,
    today: {
      entertainmentMin: toMinutes(state.today.entertainmentSeconds),
      educationalMin: toMinutes(state.today.educationalSeconds),
      musicMin: toMinutes(state.today.musicSeconds),
      gamesMin: toMinutes(state.today.gamesSeconds),
      shortsBlocked: state.today.shortsBlocked,
      gamesBlocked: state.today.gamesBlocked,
      topApps: Object.entries(state.today.appSeconds)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([bundleId, seconds]) => ({ bundleId, minutes: toMinutes(seconds) })),
    },
    rules: { ...config.rules, llmApiKey: undefined, hasLLMKey: Boolean(config.rules.llmApiKey) },
    windows: config.windows,
    pending: state.pending.map((question) => ({
      bundleId: question.bundleId,
      name: question.name,
      minutes: toMinutes(question.secondsToday),
      reasons: question.reasons,
    })),
    live: engine.live,
    events: state.events.slice(0, 40),
    downtime: state.downtime.slice(0, 5),
    permissionProblems: permissions.current(),
    history: state.history.slice(0, 7).map((day) => ({
      day: day.day,
      entertainmentMin: toMinutes(day.entertainmentSeconds),
      educationalMin: toMinutes(day.educationalSeconds),
      musicMin: toMinutes(day.musicSeconds ?? 0),
      gamesMin: toMinutes(day.gamesSeconds),
      shortsBlocked: day.shortsBlocked,
      gamesBlocked: day.gamesBlocked,
    })),
  };
}
