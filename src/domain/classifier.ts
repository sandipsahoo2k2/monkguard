import {
  EDU_WORDS, FUN_WORDS, GAME_SITE_PATTERNS, LEARNING_HOSTS,
  MUSIC_AUDIO_PATTERNS, MUSIC_CHANNEL_PATTERNS, MUSIC_HOSTS, MUSIC_VIDEO_PATTERNS,
  SHORTS_HOSTS, SHORTS_PATTERNS, VIDEO_HOSTS,
} from './patterns.js';
import { ModelClassifier, VideoMetaSource } from './ports.js';
import { ScrollFeedTracker } from './scrollFeed.js';
import { ContentVerdict } from './snapshot.js';
import { Config, TabObservation } from './types.js';
import { hostOf, youtubeId } from './url.js';

/** Remembers a verdict for a video so it is decided once, not once per tick. */
export type VideoVerdict = 'edu' | 'fun' | 'music' | 'musicVideo';

export interface VerdictMemory {
  get(videoId: string): VideoVerdict | undefined;
  set(videoId: string, verdict: VideoVerdict): void;
}

function score(haystack: string, words: Record<string, number>): number {
  let total = 0;
  for (const [word, weight] of Object.entries(words)) if (haystack.includes(word)) total += weight;
  return total;
}

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

const tabKey = (tab: TabObservation): string => `${tab.browser}|${tab.windowIndex}|${tab.tabIndex}`;

/**
 * Turns one browser tab into a verdict. Everything it needs from the outside —
 * video titles, the optional model, where verdicts are remembered — arrives
 * through the constructor, so the whole thing runs in a test with no network.
 */
export class ContentClassifier {
  constructor(
    private readonly feed: ScrollFeedTracker,
    private readonly memory: VerdictMemory,
    private readonly meta?: VideoMetaSource,
    private readonly model?: ModelClassifier,
  ) {}

  async classify(tab: TabObservation, config: Config): Promise<ContentVerdict> {
    const url = tab.url.toLowerCase();
    const host = hostOf(tab.url);
    const label = tab.title || host;
    const base = { label, host };

    const blocked = config.rules.blockedDomains.find((entry) => entry && url.includes(entry.toLowerCase()));
    if (blocked) {
      return { ...base, kind: 'shorts', videoId: null, why: "on the family's blocked list" };
    }

    if (SHORTS_PATTERNS.some((pattern) => url.includes(pattern)) || SHORTS_HOSTS.has(host)) {
      return { ...base, kind: 'shorts', videoId: youtubeId(tab.url), why: 'a short-form video feed' };
    }

    if (GAME_SITE_PATTERNS.some((pattern) => url.includes(pattern))) {
      return { ...base, kind: 'gameSite', videoId: null, why: 'a browser game site' };
    }

    // A music service has no video to watch, so it is listening by definition.
    if (MUSIC_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
      return { ...base, kind: 'music', videoId: null, why: 'a music service' };
    }

    const isVideoHost = VIDEO_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
    if (!isVideoHost) {
      this.feed.reset(tabKey(tab));
      return { ...base, kind: 'other', videoId: null, why: '' };
    }

    if (tab.active && tab.title && this.feed.isFeed(tabKey(tab), tab.title)) {
      return {
        ...base,
        kind: 'shorts',
        videoId: youtubeId(tab.url),
        why: 'the video kept changing every few seconds, so this is a scroll feed',
      };
    }

    const videoId = youtubeId(tab.url);
    const [verdict, why] = await this.judgeVideo(tab, videoId, host, config);
    const kind = verdict === 'edu' ? 'educational'
      : verdict === 'music' ? 'music'
      : verdict === 'musicVideo' ? 'musicVideo'
      : 'entertainment';
    return { ...base, kind, videoId, why };
  }

  private async judgeVideo(
    tab: TabObservation, videoId: string | null, host: string, config: Config,
  ): Promise<[VideoVerdict, string]> {
    if (LEARNING_HOSTS.some((suffix) => host.endsWith(suffix))) return ['edu', 'a learning site'];

    if (videoId) {
      const known = this.memory.get(videoId);
      if (known) return [known, 'already decided for this video'];
    }

    let title = tab.title;
    let channel = '';
    if (videoId && this.meta) {
      const meta = await this.meta.lookup(videoId);
      if (meta) {
        title = meta.title || title;
        channel = meta.channel;
      }
    }

    const remember = (verdict: VideoVerdict, why: string): [VideoVerdict, string] => {
      if (videoId) this.memory.set(videoId, verdict);
      return [verdict, why];
    };

    if (channel) {
      if (config.rules.channelBlock.some((name) => sameName(name, channel))) {
        return remember('fun', 'this channel is on the blocked list');
      }
      if (config.rules.channelAllow.some((name) => sameName(name, channel))) {
        return remember('edu', 'this channel is on the allowed list');
      }
    }

    // A song is recognised before the word lists run, because "dance", "cover"
    // and "live" mean something quite different in a title than in a lesson.
    const song = this.recogniseMusic(title, channel);
    if (song) return remember(song.kind, song.why);

    const haystack = `${title} ${channel}`.toLowerCase();
    const edu = score(haystack, EDU_WORDS);
    const fun = score(haystack, FUN_WORDS);

    if (Math.abs(edu - fun) >= 3) {
      const educational = edu > fun;
      return remember(educational ? 'edu' : 'fun',
        `the title reads ${educational ? 'educational' : 'like entertainment'} (${edu} to ${fun})`);
    }

    if (this.model && haystack.trim()) {
      const answer = await this.model.isEducational(title, channel);
      if (answer !== null) return remember(answer ? 'edu' : 'fun', 'decided by the model');
    }

    const educational = edu > fun;
    return remember(educational ? 'edu' : 'fun',
      `unclear, counted as ${educational ? 'learning' : 'entertainment'}`);
  }

  /**
   * Is this a song? Decided from how music labels itself, with no model and no
   * API key. The channel is the strong signal: YouTube creates "<Artist> -
   * Topic" channels for licensed music automatically, and VEVO is a record
   * label by definition — neither is something a gaming video can claim.
   */
  private recogniseMusic(
    title: string, channel: string,
  ): { kind: 'music' | 'musicVideo'; why: string } | null {
    const name = channel.toLowerCase();
    const lowerTitle = title.toLowerCase();

    // What the title says it is wins, because it is the thing that says whether
    // there is anything on the screen worth looking at.
    const watching = MUSIC_VIDEO_PATTERNS.find((pattern) => lowerTitle.includes(pattern));
    const listening = MUSIC_AUDIO_PATTERNS.find((pattern) => lowerTitle.includes(pattern));
    if (watching) return { kind: 'musicVideo', why: `a music video ("${watching}")` };
    if (listening) return { kind: 'music', why: `a song to listen to ("${listening}")` };

    // A "- Topic" channel is YouTube's own auto-generated audio upload: there is
    // nothing on screen but cover art.
    if (name.endsWith(' - topic')) return { kind: 'music', why: `${channel} is an artist's audio channel` };

    // A label or VEVO channel with no other clue is almost always a video.
    const channelHit = MUSIC_CHANNEL_PATTERNS.find((pattern) => name.includes(pattern));
    if (channelHit) return { kind: 'musicVideo', why: `${channel} is a music channel` };
    return null;
  }
}
