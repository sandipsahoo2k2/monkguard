import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../platform/macos/exec.js';
import { APP_DIR, LISTENING_FILE, log, readListeningPort } from '../infra/store.js';

export const LABEL = 'com.monkguard.agent';
const LAUNCH_AGENTS = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_PATH = join(LAUNCH_AGENTS, `${LABEL}.plist`);
const LOG_DIR = join(homedir(), 'Library', 'Logs', 'MonkGuard');
const BUNDLE_PATH = join(APP_DIR, 'MonkGuard.app');

/** dist/app/install.js -> dist/index.js, the CLI the service is started with. */
const entryPoint = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', 'index.js');

/**
 * macOS attaches "may control Safari" to the binary that asks, so running the
 * service as bare `node` means the permission belongs to node: the prompt says
 * "node", every other script on the Mac inherits the grant, and upgrading node
 * quietly invalidates it.
 *
 * Giving the service its own small app bundle, with its own identifier and an
 * ad-hoc signature, fixes all three: the prompt says MonkGuard, the grant is
 * ours alone, and it survives node upgrades.
 */
async function createAppBundle(identity: string): Promise<string> {
  const macOSDir = join(BUNDLE_PATH, 'Contents', 'MacOS');
  mkdirSync(macOSDir, { recursive: true });

  const executable = join(macOSDir, 'MonkGuard');
  copyFileSync(process.execPath, executable);

  writeFileSync(join(BUNDLE_PATH, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>MonkGuard</string>
  <key>CFBundleDisplayName</key><string>MonkGuard</string>
  <key>CFBundleIdentifier</key><string>${LABEL}</string>
  <key>CFBundleExecutable</key><string>MonkGuard</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key>
  <string>MonkGuard checks which pages are open so it can switch off reels and games during focus time.</string>
</dict>
</plist>
`);

  // An ad-hoc signature ("-") is what makes macOS call this an unidentified
  // developer. Pass a Developer ID identity to install and it says your name
  // instead; the bundle has to be built here, on the machine, because it wraps
  // whichever copy of node is installed.
  await run('/usr/bin/codesign',
    ['--force', '--sign', identity, '--identifier', LABEL, BUNDLE_PATH], 120_000);
  return executable;
}

function writeLaunchAgent(programArguments: string[]): void {
  mkdirSync(LAUNCH_AGENTS, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
  const args = programArguments.map((value) => `    <string>${value}</string>`).join('\n');
  writeFileSync(PLIST_PATH, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${join(LOG_DIR, 'monkguard.log')}</string>
  <key>StandardErrorPath</key><string>${join(LOG_DIR, 'monkguard.log')}</string>
</dict>
</plist>
`);
}

/** Reinstalling over a running service means overwriting the very binary it is
 *  executing, which the kernel refuses. Always stop first. */
async function stopService(): Promise<void> {
  const uid = process.getuid?.() ?? 0;
  await run('/bin/launchctl', ['bootout', `gui/${uid}/${LABEL}`], 10_000);
  await new Promise((resolve) => { setTimeout(resolve, 1200); });
}

async function startService(): Promise<void> {
  const uid = process.getuid?.() ?? 0;
  await run('/bin/launchctl', ['bootstrap', `gui/${uid}`, PLIST_PATH], 15_000);
  await run('/bin/launchctl', ['kickstart', '-k', `gui/${uid}/${LABEL}`], 15_000);
}

/** A loaded service can still be failing, so the only proof that it works is
 *  the admin page reporting its port. */
export async function waitForAdminPage(directory = APP_DIR, timeoutMs = 30_000): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const port = readListeningPort(directory);
    if (port !== null || Date.now() >= deadline) return port;
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
}

export interface InstallOptions {
  appBundle: boolean;
  /** A codesign identity. "-" is ad-hoc; a "Developer ID Application: …" string
   *  makes macOS show your name instead of "unidentified developer". */
  signIdentity?: string;
  port?: number;
  pin?: string;
}

export interface InstallResult {
  /** The port the admin page is answering on, or null if it never started. */
  port: number | null;
  command: string[];
}

export async function install(options: InstallOptions): Promise<InstallResult> {
  const entry = entryPoint();
  if (!existsSync(entry)) throw new Error(`cannot find ${entry}. Run "npm run build" first.`);

  await stopService();
  const executable = options.appBundle
    ? await createAppBundle(options.signIdentity ?? '-')
    : process.execPath;
  const command = [executable, entry, 'run'];
  writeLaunchAgent(command);
  rmSync(join(APP_DIR, LISTENING_FILE), { force: true });     // left over from the last run
  await startService();
  const port = await waitForAdminPage();
  log(port === null ? 'service installed but not answering' : 'service installed and running');
  return { port, command };
}

export async function uninstall(purge: boolean): Promise<void> {
  const uid = process.getuid?.() ?? 0;
  await run('/bin/launchctl', ['bootout', `gui/${uid}/${LABEL}`], 10_000);
  rmSync(PLIST_PATH, { force: true });
  rmSync(join(APP_DIR, LISTENING_FILE), { force: true });
  rmSync(BUNDLE_PATH, { recursive: true, force: true });
  if (purge) {
    rmSync(APP_DIR, { recursive: true, force: true });
    rmSync(LOG_DIR, { recursive: true, force: true });
  }
}

export const paths = { PLIST_PATH, LOG_DIR, BUNDLE_PATH, APP_DIR };
