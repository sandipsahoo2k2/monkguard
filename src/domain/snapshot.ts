import { PolicyStatus } from './schedule.js';
import { AppObservation, Config, ContentKind, DayUsage, TabObservation } from './types.js';

export interface ContentVerdict {
  kind: ContentKind;
  /** What the activity log shows. */
  label: string;
  host: string;
  videoId: string | null;
  why: string;
}

export interface ClassifiedTab {
  tab: TabObservation;
  verdict: ContentVerdict;
  /** The tab is on screen and its browser is in front: this is what is being watched. */
  watched: boolean;
}

export interface GameJudgement {
  verdict: 'game' | 'candidate' | 'notGame';
  score: number;
  reasons: string[];
}

export interface JudgedApp {
  app: AppObservation;
  judgement: GameJudgement;
}

/** Everything the rules are allowed to know, gathered once per tick. */
export interface Snapshot {
  now: Date;
  config: Config;
  policy: PolicyStatus;
  apps: JudgedApp[];
  front: JudgedApp | null;
  tabs: ClassifiedTab[];
  usage: DayUsage;
  /** Set while a forced break is running. */
  breakUntil: Date | null;
  /** When the current uninterrupted watching streak began. */
  watchStreakStart: Date | null;
}

/**
 * One rule answers one question. Rules are pure: same snapshot, same actions,
 * no clock of their own and no access to the system, which is what makes them
 * testable without a Mac.
 */
export interface Rule {
  readonly name: string;
  evaluate(snapshot: Snapshot): import('./actions.js').Action[];
}
