'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = {
  console,
  Date,
  Intl,
  Map,
  Set,
  Math,
  Number,
  String,
  Array,
  Object,
  JSON,
  Blob,
  URL,
  navigator: { clipboard: { writeText: async function() {} } },
  document: { getElementById: function() { return null; }, querySelectorAll: function() { return []; } },
  window: null,
  fetch: async function(url) {
    const s = String(url);
    if (s.includes('opencode-musiclab.txt')) return { ok: true, text: async function() { return 'MusicLab prompt\n\n{{verifiedPayload}}'; } };
    if (s.includes('/global/health')) return { ok: true, json: async function() { return { status: 'ok' }; } };
    if (s.endsWith('/session')) return { ok: true, json: async function() { return { sessionId: 'session-007' }; } };
    if (s.includes('/message')) return {
      ok: true,
      json: async function() {
        return { parts: [{ type: 'text', text: JSON.stringify({
          schemaVersion: 'musiclab-song-package-v2',
          sessionArc: 'Session arc ok',
          titles: ['Repeated Lower Rejection', 'Failed Upper Break', 'two sided whipsaw Then bullish resolution'],
          stylePrompt: 'Leaky prompt motif-001 keep the phrase tied avoid generic filler',
          lyrics: '[Intro]\nOne line',
          sections: [{ section: 'Intro', motifIds: ['motif-001'], delivery: 'quiet lead', lines: ['One line'], instrumentalInstruction: '' }]
        }) }] };
      }
    };
    throw new Error('Unexpected fetch: ' + url);
  }
};
sandbox.window = sandbox;
sandbox.window.addEventListener = function() {};
sandbox.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
vm.createContext(sandbox);

function load(relativePath) {
  const file = path.join(root, relativePath);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

load('musiclab/musiclab-fingerprint.js');
load('musiclab/musiclab-detector.js');
load('musiclab/musiclab-lyrics.js');
load('musiclab/musiclab-ai.js');

const Detector = sandbox.MusicLab.Detector;
const Lyrics = sandbox.MusicLab.Lyrics;
const AI = sandbox.MusicLab.AI;

function ts(text) { return Date.parse(text) / 1000; }
function bar(time, open, high, low, close, volume) { return [ts(time), open, high, low, close, volume == null ? 100 : volume]; }

function buildRegressionBars() {
  const bars = [];
  const prevDay = [
    bar('2026-07-19T07:55:00Z', 100, 101.5, 98.8, 100.4),
    bar('2026-07-19T07:56:00Z', 100.4, 101.2, 99.1, 100.8),
    bar('2026-07-19T07:57:00Z', 100.8, 101.4, 99.3, 100.9)
  ];
  const asia = [];
  for (let i = 0; i < 60; i++) {
    const minute = String(i).padStart(2, '0');
    const base = 99.6 + Math.sin(i / 6) * 0.25;
    const high = i < 50 ? 102.6 + Math.sin(i / 4) * 0.15 : 103.3 + Math.sin(i / 3) * 0.15;
    const low = 98.7 + Math.cos(i / 8) * 0.18;
    const close = i < 45 ? base : 102.9 + Math.sin(i / 5) * 0.12;
    asia.push(bar('2026-07-20T' + (i < 10 ? '00:0' + i : '00:' + minute) + ':00Z', base, high, low, close));
  }
  const morning = [
    bar('2026-07-20T07:00:00Z', 100.0, 100.4, 98.9, 99.1),
    bar('2026-07-20T07:01:00Z', 99.1, 100.5, 98.8, 100.2),
    bar('2026-07-20T07:02:00Z', 100.2, 101.4, 100.0, 101.0),
    bar('2026-07-20T07:03:00Z', 101.0, 102.1, 100.8, 101.8),
    bar('2026-07-20T07:04:00Z', 101.8, 102.3, 101.2, 102.0),
    bar('2026-07-20T07:05:00Z', 102.0, 102.4, 101.6, 102.2),
    bar('2026-07-20T07:06:00Z', 102.2, 103.1, 102.0, 102.7),
    bar('2026-07-20T07:07:00Z', 102.7, 103.4, 102.5, 103.1),
    bar('2026-07-20T07:08:00Z', 103.1, 103.7, 102.9, 103.4),
    bar('2026-07-20T07:09:00Z', 103.4, 103.9, 103.2, 103.8),
    bar('2026-07-20T07:10:00Z', 103.8, 104.2, 103.5, 104.0),
    bar('2026-07-20T07:11:00Z', 104.0, 104.5, 103.8, 104.3),
    bar('2026-07-20T07:12:00Z', 104.3, 104.8, 104.0, 104.6)
  ];
  return prevDay.concat(asia, morning);
}

(async function run() {
  const analysis = Detector.analyzeSession({
    bars: buildRegressionBars(),
    instrument: 'DE40',
    date: '2026-07-20',
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
    availableDates: ['2026-07-19', '2026-07-20']
  });

  assert(analysis.rawEvents.some((event) => event.type === 'asia_high_rejection' || event.type === 'asia_high_test'), 'rejection is captured before acceptance');
  assert(analysis.rawEvents.some((event) => event.type === 'asia_high_breakout'), 'accepted breakout is captured');
  assert(analysis.rawEvents.some((event) => event.type === 'bullish_continuation' || event.type === 'bullish_trend'), 'bullish continuation is captured');
  assert(analysis.rawEvents.filter((event) => event.type === 'asia_high_sweep').length <= 1, 'no sweep classification after acceptance');
  assert(/breakout/i.test(analysis.classification.primaryCondition) || /continuation/i.test(analysis.classification.primaryCondition), 'dominant classification uses the whole session');
  assert.strictEqual(analysis.classification.finalDirection, 'Bullish', 'final classification is bullish');
  assert(analysis.classification.confidence <= 0.92, 'confidence is not inflated by early conflict');
  assert(analysis.levelStates && analysis.levelStates['Asia High'], 'level states are reported');
  assert(analysis.levelStates['Asia High'].transitions.some((step) => step.to === 'accepted'), 'Asia High reaches accepted state');

  const fingerprint = analysis.fingerprint;
  assert(fingerprint && Array.isArray(fingerprint.motifs) && fingerprint.motifs.some((motif) => motif.type === 'bullish_continuation' || motif.type === 'bullish_resolution'), 'motifs preserve accepted breakout and continuation');

  const packageData = Lyrics.generatePackage({
    fingerprint,
    sectionPlan: fingerprint.sectionPlan,
    instrument: 'DE40',
    date: '2026-07-20',
    hintStrength: 'Subtle',
    musicStyle: 'Dreamy Deep House',
    vocalStyle: 'Female whisper',
    duration: '4:30',
    wordingSeed: '7',
    includeGeneralWhispers: true
  });
  assert(packageData.sections.every((section) => section.section !== 'Instrumental Break' || !(section.lines || []).length), 'instrumental sections contain no lyrics');
  assert(packageData.sections.filter((section) => section.section !== 'Instrumental Break').every((section) => (section.lines || []).length >= 2), 'two-line lyric blocks are preserved');
  assert(packageData.sections.filter((section) => section.section !== 'Instrumental Break').every((section) => (section.lines || []).every((line) => String(line).trim().split(/\s+/).length >= 3 && String(line).trim().split(/\s+/).length <= 10)), 'line word counts stay natural');
  assert(!/motif-\d{3}|sourceEventIds|keep the phrase tied|avoid generic filler/i.test(packageData.stylePrompt), 'internal motif instructions are excluded from Suno output');

  const aiOk = await AI.generateSongPackage({
    analysis,
    enabled: true,
    mode: 'generate',
    sensitivity: 'Balanced',
    hintStrength: 'Subtle',
    musicStyle: 'Dreamy Deep House',
    vocalStyle: 'Female whisper',
    duration: '4:30',
    maximumEvents: 8,
    wordingSeed: '7',
    includeGeneralWhispers: true
  });
  assert(Array.isArray(aiOk.titles) && aiOk.titles.every((title) => !/repeated|failed|breakout|rejection|whipsaw|asia|vwap/i.test(title)), 'titles sound like songs, not detector summaries');

  console.log('musiclab regression 007 tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
