import { Action, event, startBreak, stopTab } from '../actions.js';
import { isVideoTime } from '../music.js';
import { ClassifiedTab, Rule, Snapshot } from '../snapshot.js';

/** Listening is deliberately absent: an album on in the background while
 *  somebody works is not a watching streak, and interrupting it to enforce a
 *  "break" would be nonsense. A music video is watching, so it counts. */
const isVideo = ({ verdict }: ClassifiedTab, snapshot: Snapshot): boolean =>
  isVideoTime(verdict.kind, snapshot.config.rules);

/**
 * The limit that actually closes the three-hour autoplay hole: after so many
 * minutes in a row, a break happens whether or not there is daily budget left.
 * A break already running keeps the video stopped until it is over.
 */
export const continuousWatchRule: Rule = {
  name: 'continuous-watch',
  evaluate(snapshot: Snapshot): Action[] {
    const { continuousWatchLimitMin, forcedBreakMin } = snapshot.config.rules;
    const watchedVideo = snapshot.tabs.filter((candidate) => candidate.watched && isVideo(candidate, snapshot));
    if (watchedVideo.length === 0) return [];

    const onBreak = snapshot.breakUntil !== null && snapshot.breakUntil > snapshot.now;
    if (onBreak) {
      return watchedVideo.map(({ tab, verdict }) => stopTab({
        tab,
        reason: 'break',
        detail: `a ${forcedBreakMin} minute break after ${continuousWatchLimitMin} minutes of video`,
        until: snapshot.breakUntil,
        subject: verdict.label,
        eventKind: 'forced_break',
      }));
    }

    if (continuousWatchLimitMin <= 0 || !snapshot.watchStreakStart) return [];
    const streakMs = snapshot.now.getTime() - snapshot.watchStreakStart.getTime();
    if (streakMs < continuousWatchLimitMin * 60_000) return [];

    const until = new Date(snapshot.now.getTime() + forcedBreakMin * 60_000);
    const first = watchedVideo[0]!;
    return [
      startBreak(until),
      event('throttle', first.verdict.label,
        `${continuousWatchLimitMin} minutes in a row, so a ${forcedBreakMin} minute break`),
      ...watchedVideo.map(({ tab, verdict }) => stopTab({
        tab,
        reason: 'break',
        detail: `a ${forcedBreakMin} minute break`,
        until,
        subject: verdict.label,
        eventKind: 'forced_break',
      })),
    ];
  },
};
