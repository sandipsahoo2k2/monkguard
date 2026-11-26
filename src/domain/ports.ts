import { AppObservation, Config, Event, State, TabObservation } from './types.js';

/** Time, injected so rules can be tested at any hour of any weekday. */
export interface Clock {
  now(): Date;
}

export interface Notifier {
  notify(title: string, body: string): Promise<void> | void;
}

export interface TabController {
  redirect(tab: TabObservation, url: string): Promise<void> | void;
  close(tab: TabObservation): Promise<void> | void;
}

export interface AppController {
  quit(app: AppObservation): Promise<'asked' | 'signalled' | 'failed'> | 'asked' | 'signalled' | 'failed';
  forceQuit(app: AppObservation): void;
  isRunning(pid: number): boolean;
}

export interface AppLister {
  list(): Promise<AppObservation[]>;
}

export interface TabLister {
  list(): Promise<TabObservation[]>;
}

/**
 * Every behavioural signal for one moment, already gathered. Passing a plain
 * snapshot rather than a live prober is what keeps the game verdict a pure
 * function: no awaiting, no I/O, no mocking a system inside a rule.
 */
export interface ProbeSnapshot {
  appsKeepingDisplayAwake: Set<string>;
  gpuBusyPercent: number;
  gameControllerAttached: boolean;
  /** Only the frontmost app is sampled; `ps` is not free. */
  cpuByPid: Record<number, number>;
  /** `LSApplicationCategoryType` from each app's own Info.plist. */
  categoryByPath: Record<string, string>;
}

export interface ProbeReader {
  read(apps: AppObservation[]): Promise<ProbeSnapshot>;
}

/** Title and channel for a video, so a verdict is about content, not a URL. */
export interface VideoMetaSource {
  lookup(videoId: string): Promise<{ title: string; channel: string } | null>;
}

/** Optional last resort for titles the word lists cannot separate. */
export interface ModelClassifier {
  isEducational(title: string, channel: string): Promise<boolean | null>;
}

export interface ConfigStore {
  get(): Config;
  update(mutate: (config: Config) => void): Config;
}

/** Periodic upkeep that belongs to storage, not to the loop. */
export interface Housekeeping {
  /** Rotates today's usage into history when the date changes. */
  rollDay(): void;
  /** Records that the service is alive, and notices gaps where it was killed. */
  heartbeat(): void;
  /** Reloads settings that were changed behind the service's back. */
  reloadIfChangedOnDisk(): void;
}

export interface StateStore {
  get(): State;
  update(mutate: (state: State) => void): State;
  appendEvent(event: Omit<Event, 'at'>): void;
}
