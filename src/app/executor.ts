import { Action, BlockReason } from '../domain/actions.js';
import { AppController, Clock, Notifier, StateStore, TabController } from '../domain/ports.js';
import { TabObservation } from '../domain/types.js';

const SENTENCES: Record<BlockReason, (detail: string) => string> = {
  shorts: () => 'Reels and shorts are off during focus time.',
  game: () => 'Games are off during focus time.',
  budget: () => "Today's video time is used up.",
  break: (detail) => `Time for a break — ${detail}`,
};

const tabKey = (tab: TabObservation): string => `${tab.browser}|${tab.windowIndex}|${tab.tabIndex}`;

/**
 * Carries out what the rules asked for.
 *
 * Everything that is about *how* to stop something lives here and nowhere else:
 * the escalation ladder, the warning before a game closes, the limits that keep
 * notifications from turning into spam, and the promise that a tab is only acted
 * on once per tick so the kid gets one clear explanation rather than four.
 */
export class ActionExecutor {
  private readonly strikes = new Map<string, number[]>();
  private readonly lastNotice = new Map<string, number>();
  private readonly warnedApps = new Map<string, number>();
  private handledTabs = new Set<string>();

  constructor(
    private readonly tabs: TabController,
    private readonly apps: AppController,
    private readonly notifier: Notifier,
    private readonly state: StateStore,
    private readonly clock: Clock,
    private readonly blockPageUrl: (reason: string, detail: string, until: Date | null) => string,
  ) {}

  async run(actions: Action[]): Promise<void> {
    this.handledTabs = new Set();
    for (const action of actions) await this.apply(action);
  }

  /** Free time starts clean: no leftover warnings, strikes or half-told stories. */
  reset(): void {
    this.warnedApps.clear();
    this.strikes.clear();
  }

  private async apply(action: Action): Promise<void> {
    switch (action.type) {
      case 'stopTab': return this.stopTab(action);
      case 'stopApp': return this.stopApp(action);
      case 'notify': return this.notify(action.key, action.body, action.everyMs ?? 120_000);
      case 'event': return this.state.appendEvent(action);
      case 'count': {
        const field = action.field;
        this.state.update((state) => { state.today[field] += 1; });
        return;
      }
      case 'startBreak': {
        const until = action.until.toISOString();
        this.state.update((state) => {
          state.breakUntil = until;
          state.watchStreakStart = null;
        });
        return;
      }
    }
  }

  private async notify(key: string, body: string, everyMs: number): Promise<void> {
    const last = this.lastNotice.get(key) ?? 0;
    const now = this.clock.now().getTime();
    if (now - last < everyMs) return;
    this.lastNotice.set(key, now);
    await this.notifier.notify('FocusGuard', body);
  }

  private strike(key: string): number {
    const now = this.clock.now().getTime();
    const recent = (this.strikes.get(key) ?? []).filter((at) => now - at < 120_000);
    recent.push(now);
    this.strikes.set(key, recent);
    return recent.length;
  }

  private async stopTab(action: Extract<Action, { type: 'stopTab' }>): Promise<void> {
    const key = tabKey(action.tab);
    if (this.handledTabs.has(key)) return;        // one explanation per tab per tick
    this.handledTabs.add(key);

    const strikeKey = `${action.tab.browser}:${action.reason}`;
    if (this.strike(strikeKey) >= 4) {
      await this.tabs.close(action.tab);
      this.state.appendEvent({
        kind: `${action.eventKind}_tab_closed`,
        subject: action.subject,
        detail: 'it kept coming back, so the tab was closed',
      });
      await this.notify(`${strikeKey}:closed`, 'That page keeps coming back, so the tab is closed now.', 60_000);
      return;
    }

    await this.tabs.redirect(action.tab, this.blockPageUrl(action.reason, action.detail, action.until));
    this.state.appendEvent({ kind: action.eventKind, subject: action.subject, detail: action.detail });
    await this.notify(strikeKey, SENTENCES[action.reason](action.detail), 120_000);
  }

  /** Warn, wait, ask politely, and only then insist. */
  private async stopApp(action: Extract<Action, { type: 'stopApp' }>): Promise<void> {
    const { app, graceSeconds, why } = action;
    const now = this.clock.now().getTime();
    const warnedAt = this.warnedApps.get(app.bundleId);

    if (warnedAt === undefined) {
      this.warnedApps.set(app.bundleId, now);
      await this.notifier.notify('FocusGuard',
        `${app.name} will close in ${graceSeconds} seconds — save your work now.`);
      this.state.appendEvent({ kind: 'app_warning', subject: app.name, detail: why });
      return;
    }
    if (now - warnedAt < graceSeconds * 1000) return;

    const outcome = await this.apps.quit(app);
    this.state.appendEvent({
      kind: 'app_quit',
      subject: app.name,
      detail: outcome === 'asked' ? `asked to quit (${why})` : `sent a stop signal (${why})`,
    });
    this.state.update((state) => { state.today.gamesBlocked += 1; });
    this.warnedApps.set(app.bundleId, now + graceSeconds * 1000);

    setTimeout(() => {
      if (!this.apps.isRunning(app.pid)) return;
      this.apps.forceQuit(app);
      this.state.appendEvent({ kind: 'app_force_quit', subject: app.name, detail: 'it did not quit when asked' });
    }, graceSeconds * 1000).unref?.();
  }

  forget(bundleId: string): void {
    this.warnedApps.delete(bundleId);
  }
}
