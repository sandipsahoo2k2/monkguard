import { ContentKind, Rules } from './types.js';

/**
 * How a song should be counted right now.
 *
 * Listening to music while working is not screen time, so by default it is
 * unlimited. Watching a music video is screen time like any other video, so by
 * default it is not. One setting moves that line, and both rules and the engine
 * ask this single function, so they can never disagree about it.
 */
export function countSongAs(kind: ContentKind, rules: Rules): 'music' | 'video' | null {
  if (kind !== 'music' && kind !== 'musicVideo') return null;
  if (rules.musicMode === 'off') return 'video';
  if (rules.musicMode === 'all') return 'music';
  return kind === 'music' ? 'music' : 'video';
}

/** True when this tab should be measured against a video budget. */
export function isVideoTime(kind: ContentKind, rules: Rules): boolean {
  if (kind === 'entertainment' || kind === 'educational') return true;
  return countSongAs(kind, rules) === 'video';
}

/** True when this tab is music by the current setting. */
export function isMusicTime(kind: ContentKind, rules: Rules): boolean {
  return countSongAs(kind, rules) === 'music';
}
