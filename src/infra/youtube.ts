import { VideoMetaSource } from '../domain/ports.js';

/**
 * Title and channel from YouTube's oEmbed endpoint: no API key, no scraping, no
 * account. Cached, because the same video is seen on every tick while it plays.
 */
export class YouTubeOEmbed implements VideoMetaSource {
  private readonly cache = new Map<string, { title: string; channel: string }>();

  async lookup(videoId: string): Promise<{ title: string; channel: string } | null> {
    const cached = this.cache.get(videoId);
    if (cached) return cached;
    try {
      const target = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${target}&format=json`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as { title?: string; author_name?: string };
      const meta = { title: body.title ?? '', channel: body.author_name ?? '' };
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(videoId, meta);
      return meta;
    } catch {
      return null;
    }
  }
}
