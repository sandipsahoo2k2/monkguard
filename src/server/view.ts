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
      hostName: device.hostName,
    },
    displayName: config.displayName,
    blockPageNote: config.blockPageNote,
    mode: config.mode,
    state: status.state,
    reason: status.reason,
    until: status.until?.toISOString() ?? '',
    tempUnlockUntil: config.tempUnlockUntil ?? '',
    breakUntil: state.breakUntil ?? '',
    today: {
      entertainmentMin: toMinutes(state.today.entertainmentSeconds),
      educationalMin: toMinutes(state.today.educationalSeconds),
      musicMin: toMinutes(state.today.musicSeconds),
      shortsBlocked: state.today.shortsBlocked,
      gamesBlocked: state.today.gamesBlocked,
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
  };
}
