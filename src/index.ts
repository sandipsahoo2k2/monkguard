#!/usr/bin/env node
import { buildSystem } from './app/wiring.js';
import { AdminServer } from './server/http.js';
import { install, paths, uninstall } from './app/install.js';
import { judgeGame } from './domain/games.js';
import { policyStatus } from './domain/schedule.js';
import { buildView } from './server/view.js';
import { log } from './infra/store.js';
import { run } from './platform/macos/exec.js';
import { permissions } from './platform/macos/exec.js';
import { macProbeReader } from './platform/macos/probes.js';
import { readDeviceIdentity } from './platform/macos/device.js';
import { currentNetwork } from './platform/macos/wifi.js';
import { runningBrowsers, runningUnreadableBrowsers, tabsOf } from './platform/macos/browsers.js';
import { macAppLister } from './platform/macos/apps.js';
import { ContentClassifier } from './domain/classifier.js';
import { ScrollFeedTracker } from './domain/scrollFeed.js';
import { systemClock } from './infra/clock.js';
import { YouTubeOEmbed } from './infra/youtube.js';

const [command = 'run', ...args] = process.argv.slice(2);
const flag = (name: string): boolean => args.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const hostName = async (): Promise<string> =>
  (await run('/usr/sbin/scutil', ['--get', 'LocalHostName'], 3000)).trim() || 'this-mac';

const lanAddress = async (): Promise<string> => {
  for (const device of ['en0', 'en1']) {
    const address = (await run('/usr/sbin/ipconfig', ['getifaddr', device], 3000)).trim();
    if (address) return address;
  }
  return '';
};

async function printAddresses(port: number): Promise<void> {
  const address = await lanAddress();
  console.log(`\n  On this Mac:   http://127.0.0.1:${port}`);
  if (address) console.log(`  On your phone: http://${address}:${port}`);
  console.log(`  Also reaches it when the address changes:`);
  console.log(`                 http://${await hostName()}.local:${port}`);
}

switch (command) {
  case 'run': {
    const system = buildSystem();
    const device = await readDeviceIdentity();
    await currentNetwork();
    const port = system.store.get().serverPort;
    const firstPin = system.store.takeFirstPin();
    log(`watching ${device.name} (account "${device.account}")`);
    if (firstPin) log(`a PIN was created for the admin page: ${firstPin} — change it under More`);
    new AdminServer(system.store, system.engine).listen(port);
    system.engine.start();
    system.store.appendEvent({ kind: 'started', subject: 'focusguard', detail: `watching, admin page on port ${port}` });
    break;
  }

  case 'install': {
    const pin = value('pin');
    const port = Number(value('port') ?? '0');
    const system = buildSystem();
    if (pin) system.store.setPin(pin);
    if (port) system.store.update((config) => { config.serverPort = port; });

    if (flag('this-mac-only')) {
      system.store.update((config) => { config.lanAccess = 'never'; config.bindAddress = '127.0.0.1'; });
    } else {
      // Installing is done at home, so this is the network the family's phones
      // may use. Anywhere else, the admin page stays on the Mac.
      const network = await currentNetwork(0);
      if (network.id) {
        system.store.update((config) => {
          config.homeNetwork = network.id;
          config.lanAccess = 'home';
          config.bindAddress = '0.0.0.0';
        });
      }
    }
    const generated = system.store.takeFirstPin();

    const { running } = await install({
      appBundle: !flag('no-app-bundle'),
      signIdentity: value('sign'),
    });
    console.log(running
      ? '\nFocusGuard is running, and starts again every time this Mac logs in.'
      : `\nInstalled, but it is not running. Check ${paths.LOG_DIR}/focusguard.log`);
    await printAddresses(system.store.get().serverPort);
    if (generated && !pin) {
      console.log(`\n  The PIN for the admin page is  ${generated}`);
      console.log('  It was made up just now and is written nowhere else. Change it under More.');
    }
    console.log(`
  One more step, once only:

    The first time FocusGuard reads a browser tab, macOS asks whether it may
    control Safari or Chrome. Say OK. If you miss it, open System Settings >
    Privacy & Security > Automation and switch the browsers on under FocusGuard.

    Check it worked with:  focusguard probe
`);
    break;
  }

  case 'uninstall': {
    await uninstall(flag('purge'));
    console.log(flag('purge')
      ? 'FocusGuard removed, along with its settings and history.'
      : `FocusGuard removed. Settings kept in ${paths.APP_DIR} (delete with --purge).`);
    break;
  }

  case 'set-pin': {
    const pin = args[0];
    if (!pin || pin.length < 4) {
      console.error('usage: focusguard set-pin <at least 4 characters>');
      process.exit(1);
    }
    buildSystem().store.setPin(pin);
    console.log('PIN updated.');
    break;
  }

  case 'status': {
    const system = buildSystem();
    console.log(JSON.stringify(buildView(system.store, system.engine), null, 2));
    break;
  }

  /** One detection pass, printed. The first thing to run when something looks wrong. */
  case 'probe': {
    const system = buildSystem();
    const config = system.store.get();
    const status = policyStatus(config);
    console.log(`policy: ${status.state} — ${status.reason}`);
    if (status.until) console.log(`until:  ${status.until.toLocaleString()}`);

    console.log('\nrunning apps:');
    const apps = await macAppLister.list();
    const probeSnapshot = await macProbeReader.read(apps);
    for (const app of apps) {
      const judgement = judgeGame(app, config, probeSnapshot);
      const mark = judgement.verdict === 'game' ? 'GAME ' : judgement.verdict === 'candidate' ? 'MAYBE' : '  ok ';
      console.log(`  ${mark} ${app.name.padEnd(26)} ${judgement.reasons.join(', ')}`);
    }

    const browsers = await runningBrowsers();
    console.log(`\nbrowsers open: ${browsers.map((browser) => browser.appName).join(', ') || 'none'}`);
    const unreadable = await runningUnreadableBrowsers();
    if (unreadable.length) console.log(`cannot be read: ${unreadable.join(', ')} (closed during focus time)`);

    const classifier = new ContentClassifier(
      new ScrollFeedTracker(systemClock),
      { get: () => undefined, set: () => {} },
      new YouTubeOEmbed(),
    );
    const tabs = (await Promise.all(browsers.map(tabsOf))).flat();
    if (browsers.length && tabs.length === 0) {
      console.log('\nNo tabs could be read. macOS is probably still waiting for you to allow');
      console.log('Automation: System Settings > Privacy & Security > Automation.');
    }
    console.log('\ntabs:');
    for (const tab of tabs) {
      const verdict = await classifier.classify(tab, config);
      console.log(`  ${tab.active ? '*' : ' '} [${verdict.kind}] ${verdict.label.slice(0, 60)}`);
      if (verdict.why) console.log(`      ${verdict.why}`);
    }
    for (const problem of permissions.current()) console.log(`\npermission problem: ${problem}`);
    break;
  }

  default:
    console.log(`focusguard — family focus guard for macOS

  focusguard install          install and start it, and start it at every login
      --pin <pin>             set the admin PIN now, instead of being given one
      --this-mac-only         do not answer other devices on the wifi
      --port <port>           admin page port (default 8787)
      --no-app-bundle         run node directly instead of the signed wrapper
      --sign <identity>       codesign with a Developer ID instead of ad-hoc
  focusguard run              run in the foreground (what the login service calls)
  focusguard probe            one detection pass, printed
  focusguard status           the current state as JSON
  focusguard set-pin <pin>    change the admin PIN
  focusguard uninstall        stop it and remove it (--purge also deletes settings)
`);
    if (command !== 'help' && command !== '--help' && command !== '-h') process.exit(1);
}
