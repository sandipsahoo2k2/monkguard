import { ProbeSnapshot } from './ports.js';
import { GameJudgement } from './snapshot.js';
import { AppObservation, Config } from './types.js';

/** Launchers and games that need no guessing. Pull requests welcome. */
export const KNOWN_GAME_BUNDLES = new Set([
  'com.valvesoftware.steam', 'com.epicgames.launcher', 'com.epicgames.EpicGamesLauncher',
  'net.blizzard.BlizzardApp', 'com.blizzard.worldofwarcraft',
  'com.roblox.RobloxPlayer', 'com.roblox.robloxstudio',
  'com.mojang.minecraftlauncher', 'net.minecraft.client', 'com.mojang.minecraft',
  'com.gog.galaxy', 'io.itch.itch', 'com.riotgames.RiotClient',
  'com.ea.eadesktop', 'com.ubisoft.connect', 'com.codeweavers.CrossOver',
  'org.prismlauncher.PrismLauncher', 'com.atlauncher.ATLauncher',
  'org.openemu.OpenEmu', 'com.dolphin-emu.dolphin', 'org.ppsspp.ppsspp',
  'com.zhiliaoapp.musically', 'com.ss.iphone.ugc.Ame',
]);

/** Never a game, never asked about, so nobody is pestered. */
export const NEVER_GAME_BUNDLES = new Set([
  'com.apple.Safari', 'com.google.Chrome', 'com.brave.Browser', 'com.microsoft.edgemac',
  'company.thebrowser.Browser', 'org.mozilla.firefox', 'com.vivaldi.Vivaldi', 'com.operasoftware.Opera',
  'com.apple.finder', 'com.apple.Terminal', 'com.googlecode.iterm2', 'com.apple.dt.Xcode',
  'com.microsoft.VSCode', 'com.sublimetext.4', 'com.sublimetext.3', 'com.jetbrains.intellij',
  'com.apple.Notes', 'com.apple.Stickies', 'com.apple.TextEdit', 'com.apple.Preview',
  'com.apple.iWork.Pages', 'com.apple.iWork.Numbers', 'com.apple.iWork.Keynote',
  'com.microsoft.Word', 'com.microsoft.Excel', 'com.microsoft.Powerpoint',
  'com.apple.iCal', 'com.apple.mail', 'com.apple.MobileSMS', 'com.apple.AddressBook',
  'com.apple.reminders', 'com.apple.freeform', 'com.apple.Photos', 'com.apple.iBooksX',
  'com.apple.systempreferences', 'com.apple.ActivityMonitor',
  'com.tinyspeck.slackmacgap', 'us.zoom.xos', 'net.whatsapp.WhatsApp',
  'com.spotify.client', 'com.apple.Music', 'notion.id', 'md.obsidian', 'com.figma.Desktop',
  'com.anthropic.claudefordesktop', 'org.libreoffice.script',
]);

export const GAME_LIBRARY_PATHS = [
  '/Library/Application Support/Steam/steamapps/common',
  '/Applications/Epic Games/',
  '/Library/Application Support/Epic/',
  '/Roblox/', '/Minecraft', '/GOG Games/',
  '/Library/Application Support/itch/apps/',
];

const NAME_HINTS = ['game', 'play', 'craft', 'quest', 'racing', 'arena', 'simulator', 'clash', 'battle'];

const decided = (verdict: GameJudgement['verdict'], reason: string): GameJudgement =>
  ({ verdict, score: verdict === 'game' ? 100 : 0, reasons: [reason] });

/**
 * Is this app a video game?
 *
 * Decisive facts first: an answer the parent already gave, the category the app
 * claims in its own bundle, a known launcher, an install path inside a game
 * library. Only then a behaviour score — and a behaviour hit is never a kill. It
 * becomes a single question for the parent, answered once and remembered, which
 * is what stops a homework app from being force-quit.
 */
export function judgeGame(app: AppObservation, config: Config, probes: ProbeSnapshot): GameJudgement {
  const learned = config.learned.appVerdicts[app.bundleId];
  if (learned !== undefined) {
    return decided(learned ? 'game' : 'notGame', `confirmed in the admin page as ${learned ? 'a game' : 'not a game'}`);
  }
  if (config.rules.allowedApps.includes(app.bundleId)) return decided('notGame', 'on the allowed list');
  if (NEVER_GAME_BUNDLES.has(app.bundleId)) return decided('notGame', 'a known non-game app');
  if (KNOWN_GAME_BUNDLES.has(app.bundleId)) return decided('game', 'a known game or game launcher');

  const category = probes.categoryByPath[app.path];
  if (category?.includes('games')) {
    return decided('game', `the app calls itself ${category.replace('public.app-category.', '')}`);
  }
  if (GAME_LIBRARY_PATHS.some((prefix) => app.path.includes(prefix))) {
    return decided('game', 'installed inside a game library folder');
  }

  const signals: [boolean, number, string][] = [
    [probes.appsKeepingDisplayAwake.has(app.name), 3, 'keeps the display awake'],
    [app.frontmost && (probes.cpuByPid[app.pid] ?? 0) > 60, 2, 'heavy processor use while in front'],
    [app.frontmost && probes.gpuBusyPercent > 40, 2, 'heavy graphics use'],
    [probes.gameControllerAttached, 1, 'a game controller is connected'],
    [NAME_HINTS.some((hint) => app.name.toLowerCase().includes(hint)), 1, 'the name reads like a game'],
  ];

  let score = 0;
  const reasons: string[] = [];
  for (const [hit, weight, reason] of signals) {
    if (!hit) continue;
    score += weight;
    reasons.push(reason);
  }
  return { verdict: score >= 5 ? 'candidate' : 'notGame', score, reasons };
}
