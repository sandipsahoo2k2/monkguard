import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  PBKDF2_ITERATIONS, deriveVerifier, generatePin, newSalt, proofFor, proofMatches,
} from './credentials.js';
import { ConfigStore, Housekeeping, StateStore } from '../domain/ports.js';
import {
  Config, Event, State, defaultConfig, defaultState, emptyDay,
} from '../domain/types.js';

export const APP_DIR = join(homedir(), 'Library', 'Application Support', 'MonkGuard');

const MAX_EVENTS = 400;
const MAX_DOWNTIME = 50;

export function log(message: string): void {
  process.stdout.write(`${new Date().toISOString().replace('T', ' ').slice(0, 19)} ${message}\n`);
}

/** Written once the admin page is accepting connections, so `monk install` and
 *  `monk address` can say which port it really got. */
export const LISTENING_FILE = 'listening.json';

export function readListeningPort(directory = APP_DIR): number | null {
  try {
    const { port } = JSON.parse(readFileSync(join(directory, LISTENING_FILE), 'utf8')) as { port?: unknown };
    return typeof port === 'number' ? port : null;
  } catch {
    return null;
  }
}

export function dayString(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Lays a saved file over the defaults, so settings written by an older version,
 *  or hand-edited with a key missing, still load instead of being thrown away. */
function layerOnDefaults<T>(defaults: T, saved: unknown): T {
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) {
    return saved === undefined ? defaults : (saved as T);
  }
  if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) return saved as T;
  const merged: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
    merged[key] = key in (defaults as object)
      ? layerOnDefaults((defaults as Record<string, unknown>)[key], value)
      : value;
  }
  return merged as T;
}

function readFile<T>(path: string, defaults: T): T {
  try {
    if (!existsSync(path)) return defaults;
    return layerOnDefaults(defaults, JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return defaults;
  }
}

function writeFile(path: string, value: unknown, mode?: number): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, path);
  if (mode !== undefined) chmodSync(path, mode);
}

/**
 * The only thing that touches disk. Implements the three small storage ports the
 * rest of the system knows about, so everything else can be handed a fake.
 */
export class FileStore implements ConfigStore, Housekeeping {
  private config: Config;
  private state: State;
  private lastWritten = '';
  private firstPin: string | null = null;

  constructor(private readonly directory = APP_DIR) {
    mkdirSync(this.directory, { recursive: true });
    this.config = readFile(this.configPath, defaultConfig());
    this.firstPin = this.ensurePin();
    this.state = readFile(this.statePath, defaultState());
    this.saveConfig();
    this.rollDay();
  }

  private get configPath(): string { return join(this.directory, 'config.json'); }
  private get statePath(): string { return join(this.directory, 'state.json'); }

  // --- ConfigStore ---------------------------------------------------------

  get(): Config { return this.config; }

  update(mutate: (config: Config) => void): Config {
    mutate(this.config);
    this.saveConfig();
    return this.config;
  }

  private saveConfig(): void {
    writeFile(this.configPath, this.config, 0o600);
    this.lastWritten = createHash('sha256').update(JSON.stringify(this.config, null, 2)).digest('hex');
  }

  // --- StateStore ----------------------------------------------------------

  /** Deliberately a separate pair of methods from the config ones: the two have
   *  different lifetimes, and mixing them is how settings get lost. */
  readonly stateView: StateStore = {
    get: () => this.state,
    update: (mutate) => {
      mutate(this.state);
      writeFile(this.statePath, this.state);
      return this.state;
    },
    appendEvent: (event) => this.appendEvent(event),
  };

  appendEvent(event: Omit<Event, 'at'>): void {
    const full: Event = { at: new Date().toISOString(), ...event };
    this.stateView.update((state) => {
      state.events.unshift(full);
      if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
    });
    log(`[${full.kind}] ${full.subject}${full.detail ? ` — ${full.detail}` : ''}`);
  }

  // --- Housekeeping --------------------------------------------------------

  rollDay(): void {
    const today = dayString();
    this.stateView.update((state) => {
      if (!state.today.day) { state.today = emptyDay(today); return; }
      if (state.today.day === today) return;
      state.today = emptyDay(today);
      state.watchStreakStart = null;
      state.breakUntil = null;
    });
  }

  /** A gap between heartbeats means somebody stopped the service. The admin
   *  page shows exactly when and for how long, which is the real deterrent. */
  heartbeat(): void {
    const now = Date.now();
    const previous = this.state.lastHeartbeat ? Date.parse(this.state.lastHeartbeat) : null;
    this.stateView.update((state) => { state.lastHeartbeat = new Date(now).toISOString(); });
    if (previous === null || now - previous <= 60_000) return;

    const minutes = Math.round((now - previous) / 60_000);
    const event: Event = {
      at: new Date(now).toISOString(),
      kind: 'service_downtime',
      subject: 'monkguard',
      detail: `the service was not running for about ${minutes} min`,
    };
    this.stateView.update((state) => {
      state.downtime.unshift(event);
      if (state.downtime.length > MAX_DOWNTIME) state.downtime.length = MAX_DOWNTIME;
      state.events.unshift(event);
    });
    log(`[service_downtime] about ${minutes} min`);
  }

  reloadIfChangedOnDisk(): void {
    try {
      if (!existsSync(this.configPath)) { this.saveConfig(); return; }
      const raw = readFileSync(this.configPath, 'utf8');
      const digest = createHash('sha256').update(raw).digest('hex');
      if (digest === this.lastWritten) return;
      this.config = layerOnDefaults(defaultConfig(), JSON.parse(raw));
      this.lastWritten = digest;
      this.appendEvent({
        kind: 'config_edited_externally',
        subject: 'config.json',
        detail: 'the settings file was changed outside the admin page',
      });
    } catch {
      this.saveConfig();
      this.appendEvent({
        kind: 'config_repaired',
        subject: 'config.json',
        detail: 'an unreadable settings file was rewritten',
      });
    }
  }

  /** Keeps the port that worked, so the address stays the same next time. */
  recordListening(port: number): void {
    if (this.config.serverPort !== port) {
      this.appendEvent({
        kind: 'port_changed',
        subject: `port ${port}`,
        detail: `port ${this.config.serverPort} was in use`,
      });
      this.update((config) => { config.serverPort = port; });
    }
    writeFile(join(this.directory, LISTENING_FILE), { port });
  }

  // --- PIN -----------------------------------------------------------------

  /**
   * There is no default PIN to leave unchanged: a random one is made the first
   * time the service runs, and said out loud exactly once.
   */
  private ensurePin(): string | null {
    if (this.config.pinVerifier && this.config.pinSalt) return null;
    const pin = generatePin();
    this.config.pinSalt = newSalt();
    this.config.pinIterations = PBKDF2_ITERATIONS;
    this.config.pinVerifier = deriveVerifier(pin, this.config.pinSalt, PBKDF2_ITERATIONS);
    return pin;
  }

  /** The generated PIN, available only on the run that created it. */
  takeFirstPin(): string | null {
    const pin = this.firstPin;
    this.firstPin = null;
    return pin;
  }

  /** What the browser is asked to prove it can compute. */
  challengeFor(): { salt: string; iterations: number } {
    return { salt: this.config.pinSalt, iterations: this.config.pinIterations };
  }

  expectedProof(nonce: string): string {
    return proofFor(this.config.pinVerifier, nonce);
  }

  checkProof(nonce: string, given: string): boolean {
    if (!this.config.pinVerifier) return false;
    return proofMatches(this.expectedProof(nonce), given);
  }

  /** The browser derives the new verifier itself, so a PIN change also never
   *  puts the PIN on the network. */
  setVerifier(salt: string, verifier: string, iterations: number): void {
    this.update((config) => {
      config.pinSalt = salt;
      config.pinVerifier = verifier;
      config.pinIterations = iterations;
    });
  }

  /** Setting a PIN from the command line, where there is no browser to help. */
  setPin(pin: string): void {
    const salt = newSalt();
    this.setVerifier(salt, deriveVerifier(pin, salt, PBKDF2_ITERATIONS), PBKDF2_ITERATIONS);
  }
}
