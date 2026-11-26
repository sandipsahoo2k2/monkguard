import { Clock } from '../domain/ports.js';

export const systemClock: Clock = { now: () => new Date() };
