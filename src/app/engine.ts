import { ContentClassifier } from '../domain/classifier.js';
import { judgeGame } from '../domain/games.js';
import { isMusicTime } from '../domain/music.js';
import { READABLE_BROWSERS } from '../domain/patterns.js';
import { policyStatus } from '../domain/schedule.js';
import {
  AppLister, Clock, ConfigStore, Housekeeping, ProbeReader, StateStore, TabLister,
} from '../domain/ports.js';
import { ClassifiedTab, JudgedApp, Rule, Snapshot } from '../domain/snapshot.js';
import { ActionExecutor } from './executor.js';

export const TICK_SECONDS = 5;
const STREAK_IDLE_MS = 180_000;

export interface EngineDeps {
  clock: Clock;
  config: ConfigStore;
  state: StateStore;
  apps: AppLister;
  tabs: TabLister;
  probes: ProbeReader;
  housekeeping: Housekeeping;
  classifier: ContentClassifier;
  executor: ActionExecutor;
  rules: Rule[];
  log: (message: string) => void;
}

/**
 * The loop, and nothing but the loop: gather one honest picture of the moment,
 * hand it to the rules, carry out what they ask. Deciding what is a game, what
 * is a reel and when a break is due all happen elsewhere.
 */
export class Engine {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private lastVideoAt = 0;
  private lastConfigCheck = 0;
  private wasEnforcing = false;
  private liveLines: string[] = [];

  constructor(private readonly deps: EngineDeps) {}

  start(): void {
    this.timer = setInterval(() => void this.safeTick(), TICK_SECONDS * 1000);
    void this.safeTick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get live(): string[] {
    return this.liveLines;
  }

  /** One step of the loop, for tests and the demo. */
  async tickOnce(): Promise<void> {
    await this.safeTick();
  }

  private async safeTick(): Promise<void> {
    if (this.ticking) return;                 // a slow AppleScript must not stack ticks
    this.ticking = true;
    try {
      await this.tick();
    } catch (error) {
      this.deps.log(`tick failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async tick(): Promise<void> {
    const { executor, rules, state, housekeeping } = this.deps;
    housekeeping.rollDay();
    housekeeping.heartbeat();
    this.expireTemporaryUnlock();
    this.refreshConfigFromDisk();

    const snapshot = await this.observe();

    if (!snapshot.policy.enforcing) {
      if (this.wasEnforcing) {
        executor.reset();
        this.wasEnforcing = false;
      }
      // Free time means the rules genuinely do not run. Usage is still recorded,
      // so the day is visible and an unknown game still builds up the minutes
      // that make the question worth asking later.
      this.recordFrontmostApp(snapshot);
      this.publishLive(snapshot);
      this.expireStreak();
      return;
    }
    this.wasEnforcing = true;

    this.accrueWatchTime(snapshot);
    this.rememberQuestions(snapshot);
    const fresh = { ...snapshot, usage: state.get().today };
    await executor.run(rules.flatMap((rule) => rule.evaluate(fresh)));
    this.recordFrontmostApp(snapshot);
    this.publishLive(snapshot);
  }

  // --- gathering -----------------------------------------------------------

  private async observe(): Promise<Snapshot> {
    const { clock, config, state, apps, tabs, probes, classifier } = this.deps;
    const now = clock.now();
    const current = config.get();
    const policy = policyStatus(current, now);

    const observedApps = await apps.list();
    const probeSnapshot = await probes.read(observedApps);
    const judged: JudgedApp[] = observedApps.map((app) => ({
      app,
      judgement: judgeGame(app, current, probeSnapshot),
    }));
    const front = judged.find(({ app }) => app.frontmost) ?? null;
    const browserIsFront = READABLE_BROWSERS.some(
      (browser) => browser.bundleId === front?.app.bundleId,
    );

    const observedTabs = policy.enforcing ? await tabs.list() : [];
    const classified: ClassifiedTab[] = [];
    for (const tab of observedTabs) {
      const verdict = await classifier.classify(tab, current);
      classified.push({ tab, verdict, watched: tab.active && browserIsFront });
    }

    const live = state.get();
    return {
      now,
      config: current,
      policy,
      apps: judged,
      front,
      tabs: classified,
      usage: live.today,
      breakUntil: live.breakUntil ? new Date(live.breakUntil) : null,
      watchStreakStart: live.watchStreakStart ? new Date(live.watchStreakStart) : null,
    };
  }

  // --- bookkeeping ---------------------------------------------------------

  private expireTemporaryUnlock(): void {
    const { config, state, clock } = this.deps;
    const current = config.get();
    if (!current.tempUnlockUntil) return;
    if (new Date(current.tempUnlockUntil) > clock.now()) return;
    config.update((next) => { next.tempUnlockUntil = null; });
    state.appendEvent({ kind: 'temp_unlock_ended', subject: 'pause', detail: 'the pause finished' });
  }

  private refreshConfigFromDisk(): void {
    const now = this.deps.clock.now().getTime();
    if (now - this.lastConfigCheck < 20_000) return;
    this.lastConfigCheck = now;
    this.deps.housekeeping.reloadIfChangedOnDisk();
  }

  /** Only the tab being looked at burns budget, and only video counts.
   *  Music keeps its own tally and starts no watching streak: an album on in
   *  the background is not a binge. */
  private accrueWatchTime(snapshot: Snapshot): void {
    const counts = ['entertainment', 'educational', 'music', 'musicVideo'];
    const watched = snapshot.tabs.filter(({ verdict, watched: isWatched }) =>
      isWatched && counts.includes(verdict.kind));
    if (watched.length === 0) {
      this.expireStreak();
      return;
    }

    const kind = watched[0]!.verdict.kind;
    const isMusic = isMusicTime(kind, snapshot.config.rules);
    if (!isMusic) this.lastVideoAt = snapshot.now.getTime();

    this.deps.state.update((state) => {
      if (isMusic) state.today.musicSeconds += TICK_SECONDS;
      else if (kind === 'educational') state.today.educationalSeconds += TICK_SECONDS;
      else state.today.entertainmentSeconds += TICK_SECONDS;
      if (!isMusic && !state.watchStreakStart) state.watchStreakStart = snapshot.now.toISOString();
    });
  }

  /** Three minutes away from video ends the streak: a real pause is a break. */
  private expireStreak(): void {
    if (!this.lastVideoAt) return;
    if (this.deps.clock.now().getTime() - this.lastVideoAt <= STREAK_IDLE_MS) return;
    this.deps.state.update((state) => { state.watchStreakStart = null; });
    this.lastVideoAt = 0;
  }

  /** An app that behaves like a game becomes one question, asked once. */
  private rememberQuestions(snapshot: Snapshot): void {
    const candidates = snapshot.apps.filter(({ judgement }) => judgement.verdict === 'candidate');
    if (candidates.length === 0) return;
    this.deps.state.update((state) => {
      for (const { app, judgement } of candidates) {
        const seconds = state.today.appSeconds[app.bundleId] ?? 0;
        const existing = state.pending.find((question) => question.bundleId === app.bundleId);
        if (existing) {
          existing.secondsToday = seconds;
          existing.reasons = judgement.reasons;
          continue;
        }
        state.pending.push({
          bundleId: app.bundleId,
          name: app.name,
          secondsToday: seconds,
          reasons: judgement.reasons,
          firstSeen: snapshot.now.toISOString(),
        });
      }
      if (state.pending.length > 20) state.pending = state.pending.slice(-20);
    });
  }

  private recordFrontmostApp(snapshot: Snapshot): void {
    const front = snapshot.front;
    if (!front) return;
    this.deps.state.update((state) => {
      const seconds = state.today.appSeconds[front.app.bundleId] ?? 0;
      state.today.appSeconds[front.app.bundleId] = seconds + TICK_SECONDS;
      if (front.judgement.verdict === 'game') state.today.gamesSeconds += TICK_SECONDS;
    });
  }

  private publishLive(snapshot: Snapshot): void {
    const lines: string[] = [];
    if (snapshot.front) {
      const { app, judgement } = snapshot.front;
      const tag = judgement.verdict === 'game' ? ' — game'
        : judgement.verdict === 'candidate' ? ' — looks like a game' : '';
      lines.push(`${app.name}${tag}`);
    }
    for (const { tab, verdict } of snapshot.tabs) {
      if (tab.active && verdict.kind !== 'other') lines.push(`${verdict.kind}: ${verdict.label}`);
    }
    this.liveLines = lines.slice(0, 6);
  }
}
