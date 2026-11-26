import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContentClassifier } from '../dist/domain/classifier.js';
import { ScrollFeedTracker } from '../dist/domain/scrollFeed.js';
import { configWith, tab, at, FixedClock } from './helpers.js';

function build(options = {}) {
  const clock = new FixedClock(options.now ?? at('2026-01-05T15:00:00'));
  const store = new Map();
  const memory = { get: (id) => store.get(id), set: (id, verdict) => store.set(id, verdict) };
  const meta = options.meta ? { lookup: async () => options.meta } : undefined;
  const model = options.model ? { isEducational: async () => options.model() } : undefined;
  return {
    clock,
    store,
    classifier: new ContentClassifier(new ScrollFeedTracker(clock), memory, meta, model),
  };
}

test('a shorts URL is caught on the path, not the domain', async () => {
  const { classifier } = build();
  const verdict = await classifier.classify(
    tab({ url: 'https://www.youtube.com/shorts/abc123', title: 'funny cat' }), configWith());
  assert.equal(verdict.kind, 'shorts');
});

test('the same domain can still serve a normal video', async () => {
  const { classifier } = build({ meta: { title: 'Algebra lesson 4: solving equations', channel: 'MathsClass' } });
  const verdict = await classifier.classify(
    tab({ url: 'https://www.youtube.com/watch?v=xyz' }), configWith());
  assert.equal(verdict.kind, 'educational');
});

test('a browser game site is caught', async () => {
  const { classifier } = build();
  const verdict = await classifier.classify(tab({ url: 'https://poki.com/en/g/subway-surfers' }), configWith());
  assert.equal(verdict.kind, 'gameSite');
});

test('four title changes in five minutes is a scroll feed whatever the URL says', async () => {
  const { classifier, clock } = build();
  const config = configWith();
  const url = 'https://www.youtube.com/watch?v=feed';
  let verdict;
  for (const title of ['one', 'two', 'three', 'four', 'five']) {
    verdict = await classifier.classify(tab({ url, title }), config);
    clock.advance(20_000);
  }
  assert.equal(verdict.kind, 'shorts');
  assert.match(verdict.why, /scroll feed/);
});

test('slow, normal watching is not mistaken for a feed', async () => {
  const { classifier, clock } = build({ meta: { title: 'Physics documentary', channel: 'BBC' } });
  const config = configWith();
  let verdict;
  for (const title of ['part one', 'part two']) {
    verdict = await classifier.classify(tab({ url: 'https://www.youtube.com/watch?v=slow', title }), config);
    clock.advance(20 * 60_000);
  }
  assert.notEqual(verdict.kind, 'shorts');
});

test('an allowed channel is educational whatever the title looks like', async () => {
  const { classifier } = build({ meta: { title: 'Funny prank compilation', channel: 'Khan Academy' } });
  const verdict = await classifier.classify(tab({ url: 'https://www.youtube.com/watch?v=k1' }), configWith());
  assert.equal(verdict.kind, 'educational');
  assert.match(verdict.why, /allowed list/);
});

test('gaming videos count as entertainment', async () => {
  const { classifier } = build({ meta: { title: 'INSANE Fortnite gameplay clutch', channel: 'SomeGamer' } });
  const verdict = await classifier.classify(tab({ url: 'https://www.youtube.com/watch?v=g1' }), configWith());
  assert.equal(verdict.kind, 'entertainment');
});

test('a verdict is remembered so it is decided once, not every five seconds', async () => {
  const { classifier, store } = build({ meta: { title: 'Chemistry lesson: moles', channel: 'ScienceClass' } });
  await classifier.classify(tab({ url: 'https://www.youtube.com/watch?v=remember' }), configWith());
  assert.equal(store.get('remember'), 'edu');
});

test('the model is only asked when the word lists cannot decide', async () => {
  let asked = 0;
  const { classifier } = build({
    meta: { title: 'Thing about stuff', channel: 'Someone' },
    model: () => { asked += 1; return true; },
  });
  const verdict = await classifier.classify(tab({ url: 'https://www.youtube.com/watch?v=unclear' }), configWith());
  assert.equal(asked, 1);
  assert.equal(verdict.kind, 'educational');

  const clear = build({ meta: { title: 'Fortnite gameplay montage', channel: 'Gamer' }, model: () => { asked += 1; return true; } });
  await clear.classifier.classify(tab({ url: 'https://www.youtube.com/watch?v=clear' }), configWith());
  assert.equal(asked, 1, 'a clear title must not cost an API call');
});

test("the family's own blocked list wins", async () => {
  const config = configWith({ rules: { blockedDomains: ['example.com'] } });
  const { classifier } = build();
  const verdict = await classifier.classify(tab({ url: 'https://example.com/anything' }), config);
  assert.equal(verdict.kind, 'shorts');
});
