/**
 * The lists. Kept apart from the logic on purpose: this is the file people will
 * send pull requests against, and it should be readable by a parent.
 */

/** Vertical scroll feeds, matched on the path — which is exactly what a DNS or
 *  hosts-file blocker cannot do, because the same domain also hosts homework. */
export const SHORTS_PATTERNS = [
  'youtube.com/shorts', 'youtube.com/feed/shorts', '/shorts/',
  'instagram.com/reel', 'instagram.com/reels', 'instagram.com/stories',
  'facebook.com/reel', 'fb.watch',
  'snapchat.com/spotlight', 'snapchat.com/discover',
  'tiktok.com', 'douyin.com', 'youtube.com/hashtag',
  'likee.video', 'kuaishou.com', 'x.com/i/videos', 'twitter.com/i/videos',
];

export const SHORTS_HOSTS = new Set(['tiktok.com', 'vm.tiktok.com', 'snapchat.com', 'likee.video']);

export const GAME_SITE_PATTERNS = [
  'poki.com', 'crazygames.com', 'now.gg', 'coolmathgames.com',
  'roblox.com/games', 'roblox.com/home', 'miniclip.com', 'y8.com',
  'addictinggames.com', 'friv.com', 'kizi.com', 'silvergames.com',
  '1v1.lol', 'slither.io', 'agar.io', 'krunker.io', 'shellshock.io',
  'geforcenow.com', 'xbox.com/play', 'luna.amazon', 'itch.io/games',
  'chess.com/play/online', 'store.steampowered.com',
];

export const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com',
  'twitch.tv', 'netflix.com', 'primevideo.com', 'hotstar.com', 'disneyplus.com'];

/** Sites that are only ever music. */
export const MUSIC_HOSTS = ['music.youtube.com', 'open.spotify.com', 'spotify.com',
  'music.apple.com', 'soundcloud.com', 'music.amazon.com', 'gaana.com',
  'jiosaavn.com', 'wynk.in', 'bandcamp.com', 'last.fm', 'deezer.com'];

/**
 * How a song announces itself on YouTube, without anybody having to ask a model.
 *
 * The strongest signal by far is the channel: YouTube generates "<Artist> -
 * Topic" channels for licensed music automatically, and a VEVO channel is a
 * record label by definition. Neither can be faked by a gaming video.
 */
export const MUSIC_CHANNEL_PATTERNS = [
  ' - topic', 'vevo', 'records', 'music', ' official',
  't-series', 'saregama', 'zee music', 'sony music', 'tips official',
  'speed records', 'universal music', 'warner music', 'mass appeal',
];

/** A song you are watching: there is something on the screen worth looking at. */
export const MUSIC_VIDEO_PATTERNS = [
  'official music video', 'official video', 'video song', 'full video',
  'full video song', 'mtv unplugged', 'unplugged', 'live performance',
  'live session', 'concert', 'dance video', 'dance cover', 'choreography',
  'music video', '4k video',
];

/** A song you are only listening to. The screen could be off and nothing is lost. */
export const MUSIC_AUDIO_PATTERNS = [
  'official audio', '(audio)', 'audio song', 'full audio', 'lyric video',
  'lyrics', 'full song', 'full album', 'album', 'soundtrack', 'ost',
  'remix', 'mashup', 'dj mix', 'nightcore', 'slowed + reverb',
  'slowed and reverb', 'lo-fi', 'lofi', 'bgm', 'instrumental', 'karaoke',
  'cover song', 'ft.', 'feat.', '| song', 'song |', 'jukebox', 'playlist',
];

export const LEARNING_HOSTS = ['khanacademy.org', 'coursera.org', 'edx.org', 'brilliant.org',
  'byjus.com', 'unacademy.com', 'vedantu.com', 'duolingo.com', 'scratch.mit.edu', 'code.org'];

export const EDU_WORDS: Record<string, number> = {
  lesson: 3, tutorial: 3, explained: 3, lecture: 3, course: 3, chapter: 2, homework: 3,
  revision: 3, syllabus: 3, theorem: 3, proof: 2, derivation: 3, formula: 2, equation: 2,
  grammar: 3, vocabulary: 2, spelling: 2, 'how does': 2, 'how to solve': 3, 'why does': 2,
  science: 2, math: 2, maths: 2, algebra: 3, geometry: 3, calculus: 3, physics: 3,
  chemistry: 3, biology: 3, geography: 2, documentary: 2, 'khan academy': 5,
  'crash course': 4, ncert: 4, experiment: 2, coding: 2, programming: 2, python: 2,
  exam: 2, jee: 3, neet: 3, olympiad: 3, study: 2, educational: 4, learn: 2, museum: 2,
};

export const FUN_WORDS: Record<string, number> = {
  gameplay: 4, 'lets play': 4, "let's play": 4, walkthrough: 3, speedrun: 3,
  fortnite: 4, minecraft: 3, roblox: 4, gta: 3, 'free fire': 4, pubg: 4, bgmi: 4,
  valorant: 4, 'among us': 3, prank: 4, reaction: 3, vlog: 3, funny: 3, meme: 3,
  memes: 4, compilation: 3, satisfying: 3, asmr: 2, troll: 3, noob: 3, 'pro vs': 3,
  tiktok: 4, shorts: 4, reels: 4, mrbeast: 3, cringe: 3, montage: 3,
  'whatsapp status': 4, clutch: 2, unboxing: 2,
};

/** Browsers whose tabs can be read. */
export const READABLE_BROWSERS: { bundleId: string; appName: string; chromeLike: boolean }[] = [
  { bundleId: 'com.apple.Safari', appName: 'Safari', chromeLike: false },
  { bundleId: 'com.google.Chrome', appName: 'Google Chrome', chromeLike: true },
  { bundleId: 'com.brave.Browser', appName: 'Brave Browser', chromeLike: true },
  { bundleId: 'com.microsoft.edgemac', appName: 'Microsoft Edge', chromeLike: true },
  { bundleId: 'company.thebrowser.Browser', appName: 'Arc', chromeLike: true },
  { bundleId: 'com.vivaldi.Vivaldi', appName: 'Vivaldi', chromeLike: true },
  { bundleId: 'org.chromium.Chromium', appName: 'Chromium', chromeLike: true },
];

/** Browsers that expose no way to read their tabs. A blind spot wide enough to
 *  drive every reel through, so during focus time they are closed, not watched. */
export const UNREADABLE_BROWSERS: Record<string, string> = {
  'org.mozilla.firefox': 'Firefox',
  'org.torproject.torbrowser': 'Tor Browser',
  'com.operasoftware.Opera': 'Opera',
};
