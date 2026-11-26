import { ContentClassifier, VerdictMemory } from '../domain/classifier.js';
import { ConfigStore, ModelClassifier, } from '../domain/ports.js';
import { RULES } from '../domain/rules/index.js';
import { ScrollFeedTracker } from '../domain/scrollFeed.js';
import { ClaudeClassifier } from '../infra/claude.js';
import { systemClock } from '../infra/clock.js';
import { FileStore, log } from '../infra/store.js';
import { YouTubeOEmbed } from '../infra/youtube.js';
import { macAppController, macAppLister } from '../platform/macos/apps.js';
import { macTabController, macTabLister } from '../platform/macos/browsers.js';
import { macNotifier } from '../platform/macos/notifier.js';
import { macProbeReader } from '../platform/macos/probes.js';
import { Engine } from './engine.js';
import { ActionExecutor } from './executor.js';

/** Uses whatever key is in the settings right now, and nothing at all when
 *  there is none. Lets a parent add or remove the key without a restart. */
class ConfiguredModel implements ModelClassifier {
  private cached: { key: string; client: ClaudeClassifier } | null = null;

  constructor(private readonly config: ConfigStore) {}

  async isEducational(title: string, channel: string): Promise<boolean | null> {
    const key = this.config.get().rules.llmApiKey;
    if (!key) return null;
    if (this.cached?.key !== key) this.cached = { key, client: new ClaudeClassifier(key) };
    return this.cached.client.isEducational(title, channel);
  }
}

/** Verdicts live in the settings file so they survive a restart. */
function verdictMemory(config: ConfigStore): VerdictMemory {
  return {
    get: (videoId) => config.get().learned.videoVerdicts[videoId],
    set: (videoId, verdict) => config.update((current) => {
      if (Object.keys(current.learned.videoVerdicts).length > 2000) current.learned.videoVerdicts = {};
      current.learned.videoVerdicts[videoId] = verdict;
    }),
  };
}

export interface System {
  store: FileStore;
  engine: Engine;
}

/**
 * The composition root: the one place that knows which real implementation
 * stands behind each port. Everything above this line is testable with fakes.
 */
export function buildSystem(options: { directory?: string } = {}): System {
  const store = new FileStore(options.directory);
  const state = store.stateView;

  const blockPageUrl = (reason: string, detail: string, until: Date | null): string => {
    const params = new URLSearchParams({ reason, detail });
    if (until) params.set('until', until.toISOString());
    return `http://127.0.0.1:${store.get().serverPort}/blocked?${params.toString()}`;
  };

  const executor = new ActionExecutor(
    macTabController, macAppController, macNotifier, state, systemClock, blockPageUrl,
  );

  const classifier = new ContentClassifier(
    new ScrollFeedTracker(systemClock),
    verdictMemory(store),
    new YouTubeOEmbed(),
    new ConfiguredModel(store),
  );

  const engine = new Engine({
    clock: systemClock,
    config: store,
    state,
    housekeeping: store,
    apps: macAppLister,
    tabs: macTabLister,
    probes: macProbeReader,
    classifier,
    executor,
    rules: RULES,
    log,
  });

  return { store, engine };
}
