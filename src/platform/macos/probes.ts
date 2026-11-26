import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProbeReader, ProbeSnapshot } from '../../domain/ports.js';
import { AppObservation } from '../../domain/types.js';
import { run } from './exec.js';

/** A value re-read only when it is older than its lifetime. `pmset` and `ioreg`
 *  cost tens of milliseconds, and nothing they report changes faster. */
class Cached<T> {
  private value: T | null = null;
  private at = 0;
  constructor(private readonly ttlMs: number, private readonly load: () => Promise<T>) {}

  async get(): Promise<T> {
    if (this.value !== null && Date.now() - this.at <= this.ttlMs) return this.value;
    this.value = await this.load();
    this.at = Date.now();
    return this.value;
  }
}

/**
 * Processes holding the display awake. Games and video players take this
 * assertion and text editors do not, which makes it the strongest "something is
 * running in earnest" signal available without asking for any permission.
 */
const displayAwake = new Cached<Set<string>>(15_000, async () => {
  const output = await run('/usr/bin/pmset', ['-g', 'assertions'], 6000);
  const names = new Set<string>();
  for (const line of output.split('\n')) {
    if (!line.includes('PreventUserIdleDisplaySleep') && !line.includes('NoDisplaySleepAssertion')) continue;
    const match = /pid\s+\d+\(([^)]+)\)/.exec(line);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
});

/** The highest utilisation any accelerator reports, 0–100. */
const gpuBusy = new Cached<number>(15_000, async () => {
  const output = await run('/usr/sbin/ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], 6000);
  let best = 0;
  for (const line of output.split('\n')) {
    if (!line.includes('Device Utilization')) continue;
    const numbers = line.match(/\d+/g);
    const value = numbers ? Number(numbers[numbers.length - 1]) : 0;
    if (Number.isFinite(value)) best = Math.max(best, value);
  }
  return best;
});

const controller = new Cached<boolean>(60_000, async () => {
  const output = (await run('/usr/sbin/ioreg', ['-c', 'IOHIDDevice', '-r', '-d', '1', '-w', '0'], 6000)).toLowerCase();
  return ['gamepad', 'controller', 'dualsense', 'dualshock', 'xbox', 'joystick', 'joy-con', 'stadia']
    .some((needle) => output.includes(needle));
});

/** `LSApplicationCategoryType` from the app's own Info.plist — the single most
 *  reliable game signal there is, and it costs one file read, once per app. */
const categories = new Map<string, string>();
async function appCategory(bundlePath: string): Promise<string> {
  if (!bundlePath) return '';
  const cached = categories.get(bundlePath);
  if (cached !== undefined) return cached;

  let category = '';
  const plist = join(bundlePath, 'Contents', 'Info.plist');
  try {
    if (existsSync(plist)) {
      // Info.plist is often a binary plist, so let the OS read it rather than parsing XML.
      const output = (await run('/usr/bin/plutil',
        ['-extract', 'LSApplicationCategoryType', 'raw', '-o', '-', plist], 4000)).trim();
      if (output && !output.startsWith('<')) category = output;
      if (!category) {
        const raw = readFileSync(plist, 'utf8');
        category = /<key>LSApplicationCategoryType<\/key>\s*<string>([^<]*)<\/string>/.exec(raw)?.[1] ?? '';
      }
    }
  } catch {
    category = '';
  }
  categories.set(bundlePath, category);
  return category;
}

async function cpuPercent(pid: number): Promise<number> {
  const output = await run('/bin/ps', ['-p', String(pid), '-o', '%cpu='], 4000);
  return Number(output.trim()) || 0;
}

/**
 * Gathers every behavioural signal for this tick in one go. Doing it here, and
 * handing the rules a plain snapshot, is what keeps the game verdict a pure
 * function that a test can run in a millisecond.
 */
export const macProbeReader: ProbeReader = {
  async read(apps: AppObservation[]): Promise<ProbeSnapshot> {
    const front = apps.filter((app) => app.frontmost);
    const [awake, gpu, hasController, cpuPairs, categoryPairs] = await Promise.all([
      displayAwake.get(),
      gpuBusy.get(),
      controller.get(),
      Promise.all(front.map(async (app) => [app.pid, await cpuPercent(app.pid)] as const)),
      Promise.all(apps.map(async (app) => [app.path, await appCategory(app.path)] as const)),
    ]);

    return {
      appsKeepingDisplayAwake: awake,
      gpuBusyPercent: gpu,
      gameControllerAttached: hasController,
      cpuByPid: Object.fromEntries(cpuPairs),
      categoryByPath: Object.fromEntries(categoryPairs),
    };
  },
};
