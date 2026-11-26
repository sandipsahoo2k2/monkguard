/** Everything the owner of this Mac can change. Written to config.json. */
export interface Config {
  version: number;
  enabled: boolean;
  /** `auto` follows the schedule; `free` and `lockdown` override it until changed. */
  mode: 'auto' | 'free' | 'lockdown';
  /** What applies when no window matches. `focus` = restricted by default. */
  defaultState: 'focus' | 'free';
  /** Windows flip the default. With `defaultState: focus` these are the free windows. */
  windows: TimeWindow[];
  rules: Rules;
  learned: Learned;
  /** Free time granted from the phone. Expires by itself so it cannot be forgotten. */
  tempUnlockUntil: string | null;
  serverPort: number;
  /** 0.0.0.0 to reach it from a phone on the same wifi, 127.0.0.1 for this Mac only. */
  bindAddress: string;
  /** A hash of the home router. Other devices are answered on this network only. */
  homeNetwork: string | null;
  /** `home` answers other devices at home only, `always` anywhere, `never` keeps
   *  the admin page on this Mac. */
  lanAccess: 'home' | 'always' | 'never';
  pinSalt: string;
  /** PBKDF2 of the PIN. The PIN itself is never stored and never transmitted. */
  pinVerifier: string;
  pinIterations: number;
  /** What the admin decided to call this Mac. Empty means it is known by its
   *  address instead; macOS's own name for the machine is never used as the
   *  identity, only offered as a suggestion. */
  displayName: string;
  /** An optional line on the block page. Leave it empty for the default. */
  blockPageNote: string;
}

export interface TimeWindow {
  id: string;
  label: string;
  /** 1 = Sunday … 7 = Saturday. */
  days: number[];
  /** HH:MM, local time. A window may cross midnight. */
  start: string;
  end: string;
  enabled: boolean;
}

export interface Rules {
  blockShorts: boolean;
  blockGames: boolean;
  blockBrowserGames: boolean;
  /** Close browsers whose tabs cannot be read (Firefox, Tor, Opera) during focus time. */
  blockUnreadableBrowsers: boolean;
  /** Minutes of non-educational video per day. 0 = none allowed. */
  entertainmentVideoBudgetMin: number;
  /** Minutes of educational video per day. 0 = unlimited. */
  educationalVideoBudgetMin: number;
  /** Music is its own thing: something to have on while working, not a video
   *  to sit and watch. */
  musicMode: MusicMode;
  /** Minutes of music per day. 0 = unlimited. */
  musicBudgetMin: number;
  /** Minutes of watching in a row before a forced break. 0 = off. */
  continuousWatchLimitMin: number;
  forcedBreakMin: number;
  /** Seconds of warning before a game is closed, so work can be saved. */
  gameGraceSeconds: number;
  allowedApps: string[];
  blockedDomains: string[];
  channelAllow: string[];
  channelBlock: string[];
  /** Optional Claude key for ambiguous video titles. Everything works without it. */
  llmApiKey: string | null;
}

/** Answers already given in the admin page, so nothing is ever asked twice. */
export interface Learned {
  appVerdicts: Record<string, boolean>;
  domainVerdicts: Record<string, boolean>;
  videoVerdicts: Record<string, 'edu' | 'fun' | 'music' | 'musicVideo'>;
}

export type ContentKind =
  | 'shorts'
  | 'entertainment'
  | 'educational'
  /** Listening: a music service, an artist's audio track, a lyric video. */
  | 'music'
  /** Watching: an official music video, a live performance, a dance number. */
  | 'musicVideo'
  | 'gameSite'
  | 'other';

/**
 * What songs count as.
 *  `audio`  listening is unlimited, but a music video is screen time like any other
 *  `all`    any song counts as music, videos included
 *  `off`    songs are ordinary entertainment and share that budget
 */
export type MusicMode = 'audio' | 'all' | 'off';

export interface TabObservation {
  browser: string;
  windowIndex: number;
  tabIndex: number;
  active: boolean;
  url: string;
  title: string;
}

export interface AppObservation {
  bundleId: string;
  name: string;
  path: string;
  pid: number;
  frontmost: boolean;
}

export interface GameJudgement {
  verdict: 'game' | 'candidate' | 'notGame';
  score: number;
  reasons: string[];
}

export interface Event {
  at: string;
  kind: string;
  subject: string;
  detail: string;
}

export interface DayUsage {
  day: string;
  entertainmentSeconds: number;
  educationalSeconds: number;
  musicSeconds: number;
  gamesSeconds: number;
  shortsBlocked: number;
  gamesBlocked: number;
  appSeconds: Record<string, number>;
}

export interface PendingQuestion {
  bundleId: string;
  name: string;
  secondsToday: number;
  reasons: string[];
  firstSeen: string;
}

export interface State {
  today: DayUsage;
  history: DayUsage[];
  events: Event[];
  pending: PendingQuestion[];
  /** Start of the current uninterrupted watching streak. */
  watchStreakStart: string | null;
  breakUntil: string | null;
  lastHeartbeat: string | null;
  downtime: Event[];
}

export function defaultRules(): Rules {
  return {
    blockShorts: true,
    blockGames: true,
    blockBrowserGames: true,
    blockUnreadableBrowsers: true,
    entertainmentVideoBudgetMin: 30,
    educationalVideoBudgetMin: 0,
    musicMode: 'audio',
    musicBudgetMin: 0,
    continuousWatchLimitMin: 25,
    forcedBreakMin: 5,
    gameGraceSeconds: 60,
    allowedApps: [],
    blockedDomains: [],
    channelAllow: ['Khan Academy', 'CrashCourse', 'Veritasium', '3Blue1Brown'],
    channelBlock: [],
    llmApiKey: null,
  };
}

export function defaultConfig(): Config {
  return {
    version: 1,
    enabled: true,
    mode: 'auto',
    defaultState: 'focus',
    windows: [
      { id: 'after-school', label: 'After school', days: [2, 3, 4, 5, 6], start: '16:00', end: '17:30', enabled: true },
      { id: 'weekend', label: 'Weekend morning', days: [1, 7], start: '09:00', end: '11:00', enabled: true },
    ],
    rules: defaultRules(),
    learned: { appVerdicts: {}, domainVerdicts: {}, videoVerdicts: {} },
    tempUnlockUntil: null,
    serverPort: 8787,
    bindAddress: '0.0.0.0',
    homeNetwork: null,
    lanAccess: 'home',
    pinSalt: '',
    pinVerifier: '',
    pinIterations: 120_000,
    displayName: '',
    blockPageNote: '',
  };
}

export function defaultState(): State {
  return {
    today: emptyDay(''),
    history: [],
    events: [],
    pending: [],
    watchStreakStart: null,
    breakUntil: null,
    lastHeartbeat: null,
    downtime: [],
  };
}

export function emptyDay(day: string): DayUsage {
  return {
    day,
    entertainmentSeconds: 0,
    educationalSeconds: 0,
    musicSeconds: 0,
    gamesSeconds: 0,
    shortsBlocked: 0,
    gamesBlocked: 0,
    appSeconds: {},
  };
}
