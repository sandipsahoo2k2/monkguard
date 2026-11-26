import { Config, TimeWindow } from './types.js';

export interface PolicyStatus {
  state: 'focus' | 'free';
  /** A sentence for the admin page and the block page. */
  reason: string;
  /** When this state is expected to flip, when that is knowable. */
  until: Date | null;
  enforcing: boolean;
}

export function minutesOfDay(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function windowContains(window: TimeWindow, now: Date): boolean {
  if (!window.enabled) return false;
  const start = minutesOfDay(window.start);
  const end = minutesOfDay(window.end);
  if (start === null || end === null) return false;

  const weekday = now.getDay() + 1; // JS 0=Sunday → 1=Sunday
  const current = now.getHours() * 60 + now.getMinutes();

  if (start <= end) {
    return window.days.includes(weekday) && current >= start && current < end;
  }
  // Crosses midnight: the small hours belong to the day the window started on.
  if (current >= start) return window.days.includes(weekday);
  const yesterday = weekday === 1 ? 7 : weekday - 1;
  return window.days.includes(yesterday) && current < end;
}

function nextOccurrence(minuteOfDay: number, now: Date): Date {
  const candidate = new Date(now);
  candidate.setHours(0, 0, 0, 0);
  candidate.setMinutes(minuteOfDay);
  if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

function endOf(window: TimeWindow, now: Date): Date | null {
  const end = minutesOfDay(window.end);
  return end === null ? null : nextOccurrence(end, now);
}

export function nextWindowStart(config: Config, now: Date): Date | null {
  const candidates: Date[] = [];
  for (const window of config.windows) {
    if (!window.enabled) continue;
    const start = minutesOfDay(window.start);
    if (start === null) continue;
    const candidate = nextOccurrence(start, now);
    for (let i = 0; i < 8; i += 1) {
      if (window.days.includes(candidate.getDay() + 1)) { candidates.push(new Date(candidate)); break; }
      candidate.setDate(candidate.getDate() + 1);
    }
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a < b ? a : b));
}

export function policyStatus(config: Config, now = new Date()): PolicyStatus {
  const done = (state: 'focus' | 'free', reason: string, until: Date | null): PolicyStatus =>
    ({ state, reason, until, enforcing: state === 'focus' });

  if (!config.enabled) return done('free', 'MonkGuard is switched off', null);

  if (config.tempUnlockUntil) {
    const until = new Date(config.tempUnlockUntil);
    if (until > now) return done('free', 'Blocking is paused', until);
  }
  if (config.mode === 'free') return done('free', 'Allow all, set in the admin page', null);
  if (config.mode === 'lockdown') return done('focus', 'Locked down, set in the admin page', null);

  const match = config.windows.find((window) => windowContains(window, now));
  // A window flips the default state. With the recommended `focus` default these
  // are the free windows and everything outside them is focus time.
  const flipped: 'focus' | 'free' = config.defaultState === 'focus' ? 'free' : 'focus';
  if (match) {
    return done(flipped,
      flipped === 'free' ? `Free time: ${match.label}` : `Focus time: ${match.label}`,
      endOf(match, now));
  }
  return done(config.defaultState,
    config.defaultState === 'focus' ? 'Focus time' : 'Free time',
    nextWindowStart(config, now));
}
