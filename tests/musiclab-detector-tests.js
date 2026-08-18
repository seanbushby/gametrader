'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { console, Date, Intl, Map, Set, Math, Number, String, Array, Object, JSON, Blob, URL, navigator: { clipboard: { writeText: async function() {} } } };
sandbox.window = sandbox;
sandbox.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
vm.createContext(sandbox);

function load(relativePath) {
  const file = path.join(root, relativePath);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

load('musiclab/musiclab-fingerprint.js');
load('musiclab/musiclab-detector.js');
load('musiclab/musiclab-lyrics.js');

const Detector = sandbox.MusicLab.Detector;
const Lyrics = sandbox.MusicLab.Lyrics;

function ts(text) { return Date.parse(text) / 1000; }
function bar(time, open, high, low, close, volume) { return [ts(time), open, high, low, close, volume == null ? 100 : volume]; }

function analysisFromBars(bars, overrides) {
  return Detector.analyzeSession(Object.assign({
    bars,
    instrument: 'DE40',
    date: '2026-07-24',
    startTime: '08:00',
    endTime: '11:00',
    timezone: 'Europe/London',
    sensitivity: 'Balanced',
    hintStrength: 'Subtle',
    musicStyle: 'Dreamy Deep House',
    vocalStyle: 'Female whisper',
    duration: '4:30',
    maximumEvents: 8,
    wordingSeed: '7',
    includeGeneralWhispers: true,
    availableDates: ['2026-07-23', '2026-07-24']
  }, overrides || {}));
}

(function run() {
  assert.strictEqual(Detector.londonIso(ts('2026-01-15T08:00:00Z')).slice(-6), '+00:00', 'winter London conversion keeps GMT offset');
  assert.strictEqual(Detector.londonIso(ts('2026-07-15T08:00:00Z')).slice(-6), '+01:00', 'summer London conversion keeps BST offset');
  assert.strictEqual(Detector.previousAvailableTradingDay(['2026-07-18', '2026-07-21', '2026-07-22'], '2026-07-22'), '2026-07-21', 'previous available trading day skips gaps');

  const sweepBars = [
    bar('2026-07-24T00:00:00Z', 100, 110, 99, 105), bar('2026-07-24T00:01:00Z', 105, 111, 104, 109),
    bar('2026-07-24T07:00:00Z', 108, 112.1, 107.5, 109), bar('2026-07-24T07:01:00Z', 109, 110.2, 107.9, 108.2), bar('2026-07-24T07:02:00Z', 108.2, 109.1, 106.8, 107)
  ];
  let result = analysisFromBars(sweepBars);
  assert(result.rawEvents.some((event) => event.type === 'asia_high_sweep'), 'Asia-high sweep detected');

  const lowSweepBars = [
    bar('2026-07-24T00:00:00Z', 110, 111, 100, 105), bar('2026-07-24T00:01:00Z', 105, 106, 99, 101),
    bar('2026-07-24T07:00:00Z', 105, 106, 98.1, 100.1), bar('2026-07-24T07:01:00Z', 100.1, 101, 97.8, 99.4), bar('2026-07-24T07:02:00Z', 99.4, 102, 99.1, 101.5)
  ];
  result = analysisFromBars(lowSweepBars);
  assert(result.rawEvents.some((event) => event.type === 'asia_low_sweep'), 'Asia-low sweep detected');

  const breakoutBars = [
    bar('2026-07-24T00:00:00Z', 100, 110, 99, 105), bar('2026-07-24T00:01:00Z', 105, 111, 104, 109),
    bar('2026-07-24T07:00:00Z', 109, 112.0, 108.5, 111.7), bar('2026-07-24T07:01:00Z', 111.7, 113.1, 111.4, 112.9), bar('2026-07-24T07:02:00Z', 112.9, 114.0, 112.6, 113.5)
  ];
  result = analysisFromBars(breakoutBars);
  assert(result.rawEvents.some((event) => event.type === 'asia_high_breakout'), 'Asia-high breakout detected');

  const fakeoutBars = [
    bar('2026-07-24T00:00:00Z', 100, 110, 99, 105), bar('2026-07-24T00:01:00Z', 105, 111, 104, 109),
    bar('2026-07-24T07:00:00Z', 109, 112.0, 108.5, 111.8), bar('2026-07-24T07:01:00Z', 111.8, 113.0, 109.9, 109.8), bar('2026-07-24T07:02:00Z', 109.8, 110, 108.8, 108.9), bar('2026-07-24T07:03:00Z', 108.9, 109.2, 107.5, 108)
  ];
  result = analysisFromBars(fakeoutBars);
  assert(result.rawEvents.some((event) => event.type === 'bullish_fakeout'), 'Fakeout detected');

  const openReclaimBars = [
    bar('2026-07-24T00:00:00Z', 100, 110, 99, 105), bar('2026-07-24T00:01:00Z', 105, 111, 104, 109),
    bar('2026-07-24T07:00:00Z', 100, 101, 99, 99.5), bar('2026-07-24T07:01:00Z', 99.5, 100.8, 99.2, 100.7), bar('2026-07-24T07:02:00Z', 100.7, 101.9, 100.4, 101.6)
  ];
  result = analysisFromBars(openReclaimBars);
  assert(result.rawEvents.some((event) => event.type === 'session_open_reclaim'), '08:00-open reclaim detected');

  const chopBars = [];
  for (let i = 0; i < 20; i++) chopBars.push(bar('2026-07-24T07:' + String(i).padStart(2, '0') + ':00Z', 100 + (i % 2 ? 0.3 : -0.2), 100.6, 99.4, 100 + (i % 2 ? 0.2 : -0.1), 100));
  result = analysisFromBars(chopBars);
  assert(result.rawEvents.some((event) => event.type === 'chop' || event.type === 'range'), 'VWAP-style chop/range detected');

  const bullishBars = [];
  for (let i = 0; i < 25; i++) bullishBars.push(bar('2026-07-24T07:' + String(i).padStart(2, '0') + ':00Z', 100 + i * 0.8, 100.5 + i * 0.8, 99.8 + i * 0.8, 100.2 + i * 0.8, 100));
  result = analysisFromBars(bullishBars);
  assert(result.rawEvents.some((event) => event.type === 'bullish_trend' || event.type === 'bullish_continuation'), 'Bullish continuation/trend detected');

  const bearishBars = [];
  for (let i = 0; i < 25; i++) bearishBars.push(bar('2026-07-24T07:' + String(i).padStart(2, '0') + ':00Z', 120 - i * 0.8, 120.2 - i * 0.8, 119.5 - i * 0.8, 119.8 - i * 0.8, 100));
  result = analysisFromBars(bearishBars);
  assert(result.rawEvents.some((event) => event.type === 'bearish_trend' || event.type === 'bearish_continuation'), 'Bearish continuation/trend detected');

  const reversalBars = [];
  for (let i = 0; i < 10; i++) reversalBars.push(bar('2026-07-24T07:' + String(i).padStart(2, '0') + ':00Z', 100 + i * 0.8, 100.7 + i * 0.8, 99.6 + i * 0.8, 100.3 + i * 0.8, 100));
  for (let i = 10; i < 20; i++) reversalBars.push(bar('2026-07-24T07:' + String(i).padStart(2, '0') + ':00Z', 108 - (i - 10) * 0.9, 108.2 - (i - 10) * 0.9, 107.4 - (i - 10) * 0.9, 107.8 - (i - 10) * 0.9, 100));
  result = analysisFromBars(reversalBars);
  assert(result.rawEvents.some((event) => /reversal/.test(event.type)), 'Reversal detected');

  const dedupeBars = lowSweepBars.concat(lowSweepBars.slice(-2));
  result = analysisFromBars(dedupeBars, { maximumEvents: 10 });
  assert(result.songEvents.length <= 10, 'Maximum song-event limit respected');
  assert(result.songEvents.every((event, index, list) => index === 0 || event.timestampSeconds >= list[index - 1].timestampSeconds), 'Song events are chronological');

  const packageA = Lyrics.generatePackage({ instrument: 'DE40', date: '2026-07-24', events: result.songEvents, levels: result.levels, classification: result.classification, hintStrength: 'Subtle', musicStyle: 'Dreamy Deep House', vocalStyle: 'Female whisper', duration: '4:30', lyricDensity: 'Minimal', wordingSeed: '99', includeGeneralWhispers: true });
  const packageB = Lyrics.generatePackage({ instrument: 'DE40', date: '2026-07-24', events: result.songEvents, levels: result.levels, classification: result.classification, hintStrength: 'Subtle', musicStyle: 'Dreamy Deep House', vocalStyle: 'Female whisper', duration: '4:30', lyricDensity: 'Minimal', wordingSeed: '99', includeGeneralWhispers: true });
  assert.strictEqual(packageA.lyrics, packageB.lyrics, 'Identical inputs produce identical lyrics');
  const packageC = Lyrics.generatePackage({ instrument: 'DE40', date: '2026-07-24', events: result.songEvents, levels: result.levels, classification: result.classification, hintStrength: 'Subtle', musicStyle: 'Dreamy Deep House', vocalStyle: 'Female whisper', duration: '4:30', lyricDensity: 'Minimal', wordingSeed: '100', includeGeneralWhispers: true });
  assert.notStrictEqual(packageA.lyrics, packageC.lyrics, 'Wording seed changes lyrics');
  assert(packageA.lyricEntries.every((entry) => entry.sourceEventIds.length > 0 || entry.generalWhisper), 'Every lyric references an event or an approved whisper');
  assert(packageA.lyricEntries.every((entry) => !entry.sourceEventIds.some((id) => !/^event-\d{3}$/.test(id))), 'No lyric references unsupported event ids');
  assert(result.fingerprint && Array.isArray(result.sectionPlan), 'analysis includes compiled fingerprint and section plan');
  assert(result.fingerprint.motifs.length > 0, 'compiled fingerprint contains motifs');
  assert(result.detectorVersion === 'musiclab-detector-v1', 'Saved analysis retains detector version field');

  console.log('musiclab detector tests passed');
})();
