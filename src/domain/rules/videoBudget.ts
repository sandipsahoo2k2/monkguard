import { Action, notify, stopTab } from '../actions.js';
import { countSongAs } from '../music.js';
import { ClassifiedTab, Rule, Snapshot } from '../snapshot.js';

const COUNTS: ClassifiedTab['verdict']['kind'][] =
  ['entertainment', 'educational', 'music', 'musicVideo'];

const isVideo = ({ verdict }: ClassifiedTab): boolean => COUNTS.includes(verdict.kind);

/** Midnight tonight: when a daily budget comes back. */
function endOfDay(now: Date): Date {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date;
}

/** The daily caps, one for entertainment and one for learning. */
export const videoBudgetRule: Rule = {
  name: 'video-budget',
  evaluate(snapshot: Snapshot): Action[] {
    const { rules } = snapshot.config;
    const actions: Action[] = [];

    for (const { tab, verdict, watched } of snapshot.tabs.filter(isVideo)) {
      if (!watched) continue;

      // Listening while working is not screen time; a music video is. One
      // function decides which, so no two rules can disagree about it.
      const asMusic = countSongAs(verdict.kind, rules) === 'music';
      const educational = verdict.kind === 'educational';
      const budgetMinutes = asMusic ? rules.musicBudgetMin
        : educational ? rules.educationalVideoBudgetMin
        : rules.entertainmentVideoBudgetMin;
      if (budgetMinutes <= 0) continue;          // 0 means unlimited

      const limitSeconds = budgetMinutes * 60;
      const usedSeconds = asMusic ? snapshot.usage.musicSeconds
        : educational ? snapshot.usage.educationalSeconds
        : snapshot.usage.entertainmentSeconds;

      if (usedSeconds >= limitSeconds) {
        actions.push(stopTab({
          tab,
          reason: 'budget',
          detail: `${budgetMinutes} minutes of ${asMusic ? 'music' : educational ? 'learning' : 'entertainment'} today`,
          until: endOfDay(snapshot.now),
          subject: verdict.label,
          eventKind: 'blocked_budget',
        }));
        continue;
      }

      const secondsLeft = limitSeconds - usedSeconds;
      if (secondsLeft <= 120) {
        const minutesLeft = Math.ceil(secondsLeft / 60);
        actions.push(notify(`budget-warning:${verdict.kind}`,
          `About ${minutesLeft} more minute${minutesLeft === 1 ? '' : 's'} of `
          + `${asMusic ? 'music' : 'video'} today.`, 300_000));
      }
    }
    return actions;
  },
};
