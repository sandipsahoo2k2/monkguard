import { AppController, AppLister } from '../../domain/ports.js';
import { AppObservation } from '../../domain/types.js';
import { osascript, run } from './exec.js';

/**
 * Running applications, read from `lsappinfo`. No permission is needed, which is
 * why it is used instead of System Events (that would ask for Accessibility).
 */
export async function runningApps(): Promise<AppObservation[]> {
  const [frontRaw, listing] = await Promise.all([
    run('/usr/bin/lsappinfo', ['front'], 4000),
    run('/usr/bin/lsappinfo', ['list'], 6000),
  ]);
  const frontAsn = frontRaw.trim();
  const apps: AppObservation[] = [];

  // Entries look like:  12) "Safari" ASN:0x0-0x1b01b:
  //                        bundleID="com.apple.Safari"
  //                        bundle path="/Applications/Safari.app"
  //                        pid = 1234  type="Foreground" …
  const blocks = listing.split(/\n(?=\s*\d+\)\s)/);
  for (const block of blocks) {
    const header = /^\s*\d+\)\s+"([^"]*)"\s+(ASN:[^\s:]*:)/.exec(block);
    if (!header) continue;
    const name = header[1] ?? '';
    const asn = header[2] ?? '';
    const bundleId = /bundleID="([^"]+)"/.exec(block)?.[1];
    if (!bundleId) continue;                                  // helpers and daemons
    const type = /type="([^"]*)"/.exec(block)?.[1] ?? '';
    if (type !== 'Foreground') continue;                      // skip UIElement/BackgroundOnly
    const pid = Number(/pid\s*=\s*(\d+)/.exec(block)?.[1] ?? '0');
    if (!pid) continue;
    const path = /bundle path="([^"]*)"/.exec(block)?.[1] ?? '';
    apps.push({ bundleId, name, path, pid, frontmost: asn !== '' && asn === frontAsn });
  }
  return apps;
}

/**
 * Asks an app to quit with a real Quit Apple Event, the same thing Command-Q
 * sends, so documents and game saves get their usual chance. Falls back to
 * signals when the app ignores it.
 */
export async function quitApp(app: AppObservation): Promise<'asked' | 'signalled' | 'failed'> {
  const result = await osascript(`tell application id "${app.bundleId}" to quit`, 6000);
  if (result.ok) return 'asked';
  try {
    process.kill(app.pid, 'SIGTERM');
    return 'signalled';
  } catch {
    return 'failed';
  }
}

export function forceQuit(app: AppObservation): boolean {
  try {
    process.kill(app.pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const macAppLister: AppLister = { list: runningApps };

export const macAppController: AppController = {
  quit: quitApp,
  forceQuit: (app) => { forceQuit(app); },
  isRunning,
};
