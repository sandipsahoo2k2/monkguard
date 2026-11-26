import { Clock } from './ports.js';

/**
 * A shorts feed rewrites the tab title on every swipe. Four title changes in
 * five minutes on a video site is a scroll feed whatever the URL says, which
 * catches shorts played from the home feed and pages whose path never changes.
 */
export class ScrollFeedTracker {
  private readonly titles = new Map<string, string>();
  private readonly changes = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly windowMs = 300_000,
    private readonly threshold = 4,
  ) {}

  /** Returns how many times the title changed inside the window. */
  record(key: string, title: string): number {
    const now = this.clock.now().getTime();
    const previous = this.titles.get(key);
    if (previous !== undefined && previous !== title) {
      const recent = (this.changes.get(key) ?? []).filter((at) => now - at < this.windowMs);
      recent.push(now);
      this.changes.set(key, recent);
    }
    this.titles.set(key, title);
    if (this.titles.size > 300) {
      this.titles.clear();
      this.changes.clear();
    }
    return (this.changes.get(key) ?? []).filter((at) => now - at < this.windowMs).length;
  }

  isFeed(key: string, title: string): boolean {
    return this.record(key, title) >= this.threshold;
  }

  reset(key: string): void {
    this.changes.delete(key);
  }
}
