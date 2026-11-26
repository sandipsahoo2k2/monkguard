import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeGame } from '../dist/domain/games.js';
import { app, configWith, fakeProbes } from './helpers.js';

test("the app's own App Store category settles it", () => {
  const judgement = judgeGame(app({ name: 'Celeste' }), configWith(),
    fakeProbes({ category: 'public.app-category.action-games' }));
  assert.equal(judgement.verdict, 'game');
});

test('a known launcher is a game without any guessing', () => {
  const steam = app({ bundleId: 'com.valvesoftware.steam', name: 'Steam' });
  assert.equal(judgeGame(steam, configWith(), fakeProbes()).verdict, 'game');
});

test('anything inside the Steam library folder is a game', () => {
  const unknown = app({
    bundleId: 'com.unknown.thing',
    path: '/Users/kid/Library/Application Support/Steam/steamapps/common/Hollow Knight/x.app',
  });
  assert.equal(judgeGame(unknown, configWith(), fakeProbes()).verdict, 'game');
});

test('a homework app is never a game, however busy it looks', () => {
  const pages = app({ bundleId: 'com.apple.iWork.Pages', name: 'Pages', frontmost: true });
  const busy = fakeProbes({ awake: new Set(['Pages']), cpu: 99, gpu: 99, controller: true });
  assert.equal(judgeGame(pages, configWith(), busy).verdict, 'notGame');
});

test("the parent's answer beats every other signal", () => {
  const config = configWith({ learned: { appVerdicts: { 'com.valvesoftware.steam': false }, videoVerdicts: {} } });
  const steam = app({ bundleId: 'com.valvesoftware.steam', name: 'Steam' });
  assert.equal(judgeGame(steam, config, fakeProbes()).verdict, 'notGame');
});

test('an unknown app that behaves like a game is only a candidate, never a kill', () => {
  const unknown = app({ bundleId: 'com.unknown.rogue', name: 'Rogue Quest', frontmost: true });
  const gamey = fakeProbes({ awake: new Set(['Rogue Quest']), cpu: 80, gpu: 70, controller: true });
  const judgement = judgeGame(unknown, configWith(), gamey);
  assert.equal(judgement.verdict, 'candidate');
  assert.ok(judgement.score >= 5);
  assert.ok(judgement.reasons.length >= 3);
});

test('a quiet unknown app is left alone entirely', () => {
  const unknown = app({ bundleId: 'com.unknown.quiet', name: 'Notes Plus' });
  assert.equal(judgeGame(unknown, configWith(), fakeProbes()).verdict, 'notGame');
});
