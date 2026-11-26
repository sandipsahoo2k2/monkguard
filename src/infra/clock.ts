import { Clock } from '../domain/ports.js';

export const systemClock: Clock = { now: () => new Date() };

/** For tests: a clock that stands still until it is told to move. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date { return this.current; }
  set(date: Date): void { this.current = date; }
  advance(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
}
