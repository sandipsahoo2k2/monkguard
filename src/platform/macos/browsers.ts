import { READABLE_BROWSERS, UNREADABLE_BROWSERS } from '../../domain/patterns.js';
import { TabController, TabLister } from '../../domain/ports.js';
import { TabObservation } from '../../domain/types.js';
import { osascript, run } from './exec.js';

/** MONKGUARD_DEBUG=1 explains every decision this layer makes, which is the
 *  difference between "it does not work" and a fixable sentence. */
const debug = (message: string): void => {
  if (process.env.MONKGUARD_DEBUG) {
    process.stdout.write(`${new Date().toISOString().slice(11, 19)} [browsers] ${message}\n`);
  }
};

type Browser = (typeof READABLE_BROWSERS)[number];

/**
 * Fields are joined with this rather than a tab character, because inside
 * `tell application "Google Chrome"` the AppleScript word `tab` means a browser
 * tab, not whitespace. A separator that cannot collide with a URL or a page
 * title keeps the script unambiguous.
 */
const FIELD = '<|>';

/**
 * The very first request to a browser is the one that makes macOS show the
 * "allow MonkGuard to control Safari?" dialog, and it does not return until
 * somebody answers it. A normal eight second timeout would kill the request
 * while the parent is still reaching for the mouse, taking the dialog with it,
 * so the first call to each browser waits a minute and the rest are brisk.
 */
const answered = new Set<string>();

async function runningBundleIds(): Promise<Set<string>> {
  const listing = await run('/usr/bin/lsappinfo', ['list'], 6000);
  return new Set([...listing.matchAll(/bundleID="([^"]+)"/g)].map((match) => match[1]!));
}

export async function runningBrowsers(): Promise<Browser[]> {
  const running = await runningBundleIds();
  const found = READABLE_BROWSERS.filter((browser) => running.has(browser.bundleId));
  debug(`${running.size} apps seen, readable browsers: ${found.map((b) => b.appName).join(', ') || 'none'}`);
  return found;
}

export async function runningUnreadableBrowsers(): Promise<string[]> {
  const running = await runningBundleIds();
  return Object.entries(UNREADABLE_BROWSERS)
    .filter(([bundleId]) => running.has(bundleId))
    .map(([, name]) => name);
}

/**
 * Every tab of every window, with the active one flagged.
 *
 * Only browsers that are already running are asked, so reading the state of the
 * machine never launches an app — a guard that opens Chrome to check on Chrome
 * would be its own worst enemy.
 */
export async function tabsOf(browser: Browser): Promise<TabObservation[]> {
  const titleProperty = browser.chromeLike ? 'title' : 'name';
  const activeIndex = browser.chromeLike ? 'active tab index of w' : 'index of current tab of w';
  const script = `
tell application "${browser.appName}"
    set out to ""
    set wi to 0
    repeat with w in windows
        set wi to wi + 1
        set ct to 0
        try
            set ct to ${activeIndex}
        end try
        try
            set ti to 0
            repeat with t in tabs of w
                set ti to ti + 1
                set u to ""
                set n to ""
                try
                    set u to (URL of t) as text
                end try
                try
                    set n to (${titleProperty} of t) as text
                end try
                set act to "0"
                if ti is ct then set act to "1"
                set out to out & wi & "${FIELD}" & ti & "${FIELD}" & act & "${FIELD}" & u & "${FIELD}" & n & linefeed
            end repeat
        end try
    end repeat
    return out
end tell`;

  const firstTime = !answered.has(browser.bundleId);
  const startedAt = Date.now();
  const result = await osascript(script, firstTime ? 60_000 : 8000);
  if (!result.ok) {
    debug(`${browser.appName} refused after ${Date.now() - startedAt}ms: ${result.stderr.trim() || 'no message'}`);
    return [];
  }
  answered.add(browser.bundleId);
  debug(`${browser.appName} answered in ${Date.now() - startedAt}ms with ${result.stdout.split('\n').filter(Boolean).length} lines`);

  const tabs: TabObservation[] = [];
  for (const line of result.stdout.split('\n')) {
    const parts = line.split(FIELD);
    if (parts.length < 5) continue;
    const windowIndex = Number(parts[0]);
    const tabIndex = Number(parts[1]);
    const url = parts[3] ?? '';
    if (!windowIndex || !tabIndex || !url) continue;
    tabs.push({
      browser: browser.appName,
      windowIndex,
      tabIndex,
      active: parts[2] === '1',
      url,
      title: parts.slice(4).join(FIELD).trim(),
    });
  }
  return tabs;
}

export const macTabLister: TabLister = {
  async list() {
    const browsers = await runningBrowsers();
    const perBrowser = await Promise.all(browsers.map(tabsOf));
    return perBrowser.flat();
  },
};

export const macTabController: TabController = {
  /** Replacing the page genuinely stops playback, unlike a pause keystroke, and
   *  the page it lands on explains what happened and when it comes back. */
  async redirect(tab, url) {
    await osascript(`
tell application "${tab.browser}"
    try
        set URL of tab ${tab.tabIndex} of window ${tab.windowIndex} to "${url.replace(/"/g, '')}"
    end try
end tell`);
  },
  async close(tab) {
    await osascript(`
tell application "${tab.browser}"
    try
        close tab ${tab.tabIndex} of window ${tab.windowIndex}
    end try
end tell`);
  },
};
