import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContentClassifier } from '../dist/domain/classifier.js';
import { ScrollFeedTracker } from '../dist/domain/scrollFeed.js';
import { videoBudgetRule, continuousWatchRule } from '../dist/domain/rules/index.js';
import { FixedClock } from '../dist/infra/clock.js';
import { classified, configWith, snapshot, tab, at } from './helpers.js';

function build(meta) {
  const clock = new FixedClock(at('2026-01-05T15:00:00'));
  const store = new Map();
  return new ContentClassifier(
    new ScrollFeedTracker(clock),
    { get: (id) => store.get(id), set: (id, verdict) => store.set(id, verdict) },
    meta ? { lookup: async () => meta } : undefined,
  );
}

const watch = (id = 'song1') => tab({ url: `https://www.youtube.com/watch?v=${id}` });
const of = (actions, type) => actions.filter((action) => action.type === type);

test('a "- Topic" channel is listening: YouTube uploads those as audio', async () => {
  const classifier = build({ title: 'Kesariya', channel: 'Arijit Singh - Topic' });
  const verdict = await classifier.classify(watch(), configWith());
  assert.equal(verdict.kind, 'music');
  assert.match(verdict.why, /audio channel/);
});

test('a VEVO channel with no other clue is a music video', async () => {
  const classifier = build({ title: 'Blinding Lights', channel: 'TheWeekndVEVO' });
  assert.equal((await classifier.classify(watch(), configWith())).kind, 'musicVideo');
});

test('"Official Video" is watching, "Official Audio" is listening', async () => {
  const watching = build({ title: 'Kesariya (Official Video) | Brahmastra', channel: 'Some Uploader' });
  assert.equal((await watching.classify(watch(), configWith())).kind, 'musicVideo');
  const listening = build({ title: 'Kesariya (Official Audio) | Brahmastra', channel: 'Some Uploader' });
  assert.equal((await listening.classify(watch('b'), configWith())).kind, 'music');
});

test('lyrics, audio and lo-fi are songs', async () => {
  for (const title of ['Perfect (Lyrics)', 'Tum Hi Ho (Audio)', 'lofi beats to study to']) {
    const classifier = build({ title, channel: 'Someone' });
    assert.equal((await classifier.classify(watch(), configWith())).kind, 'music', title);
  }
});

test('YouTube Music and Spotify are always music', async () => {
  const classifier = build();
  for (const url of ['https://music.youtube.com/watch?v=x', 'https://open.spotify.com/track/x']) {
    assert.equal((await classifier.classify(tab({ url }), configWith())).kind, 'music', url);
  }
});

test('a gaming montage is still entertainment, not music', async () => {
  const classifier = build({ title: 'INSANE Fortnite montage', channel: 'SomeGamer' });
  assert.equal((await classifier.classify(watch(), configWith())).kind, 'entertainment');
});

test('a lesson is still educational, not music', async () => {
  const classifier = build({ title: 'Algebra lesson 4: solving equations', channel: 'MathsClass' });
  assert.equal((await classifier.classify(watch(), configWith())).kind, 'educational');
});

test('a music video is watching, so it is counted as video by default', async () => {
  const classifier = build({ title: 'Shape of You (Official Music Video)', channel: 'Ed Sheeran' });
  assert.equal((await classifier.classify(watch(), configWith())).kind, 'musicVideo');
});

test('an audio upload is listening, so it is music', async () => {
  const classifier = build({ title: 'Shape of You (Official Audio)', channel: 'Ed Sheeran' });
  assert.equal((await classifier.classify(watch(), configWith())).kind, 'music');
});

test('by default a music video burns the video budget, listening does not', () => {
  const watching = snapshot({
    tabs: [classified('musicVideo')],
    usage: { entertainmentSeconds: 30 * 60 },
  });
  assert.equal(of(videoBudgetRule.evaluate(watching), 'stopTab').length, 1);

  const listening = snapshot({
    tabs: [classified('music')],
    usage: { entertainmentSeconds: 30 * 60 },
  });
  assert.deepEqual(videoBudgetRule.evaluate(listening), []);
});

test('"all music free" lets a music video through too', () => {
  const config = configWith({ rules: { musicMode: 'all' } });
  const state = snapshot({
    config,
    tabs: [classified('musicVideo')],
    usage: { entertainmentSeconds: 30 * 60 },
  });
  assert.deepEqual(videoBudgetRule.evaluate(state), []);
});

test('music is unlimited by default, so songs never hit the video budget', () => {
  const state = snapshot({
    tabs: [classified('music')],
    usage: { musicSeconds: 4 * 3600, entertainmentSeconds: 29 * 60 },
  });
  assert.deepEqual(videoBudgetRule.evaluate(state), []);
});

test('a parent can still put a daily limit on music', () => {
  const config = configWith({ rules: { musicBudgetMin: 60 } });
  const state = snapshot({ config, tabs: [classified('music')], usage: { musicSeconds: 60 * 60 } });
  const stop = of(videoBudgetRule.evaluate(state), 'stopTab');
  assert.equal(stop.length, 1);
  assert.match(stop[0].detail, /music/);
});

test('switching music off makes songs count as ordinary entertainment', () => {
  const config = configWith({ rules: { musicMode: 'off' } });
  const state = snapshot({
    config,
    tabs: [classified('music')],
    usage: { entertainmentSeconds: 30 * 60 },
  });
  assert.equal(of(videoBudgetRule.evaluate(state), 'stopTab').length, 1);
});

test('music never triggers the "you have watched too long" break', () => {
  const state = snapshot({
    now: at('2026-01-05T15:30:00'),
    tabs: [classified('music')],
    watchStreakStart: at('2026-01-05T15:00:00'),
  });
  assert.deepEqual(continuousWatchRule.evaluate(state), []);
});
