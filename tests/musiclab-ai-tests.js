'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const requests = [];

function ts(text) { return Date.parse(text) / 1000; }
function bar(time, open, high, low, close, volume) { return [ts(time), open, high, low, close, volume == null ? 100 : volume]; }

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
  fetch: async function(url, options) {
    requests.push({ url: String(url), options: options || null });
    if (String(url).includes('opencode-musiclab.txt')) {
      return { ok: true, text: async function() { return 'MusicLab prompt\n\n{{verifiedPayload}}'; } };
    }
    if (String(url).includes('/global/health')) {
      return { ok: true, json: async function() { return { status: 'ok' }; } };
    }
    if (String(url).endsWith('/session')) {
      return { ok: true, json: async function() { return { sessionId: 'session-123' }; } };
    }
    if (String(url).includes('/message')) {
      return {
        ok: true,
        json: async function() {
          return {
            parts: [{ type: 'text', text: JSON.stringify(sandbox.__aiValidResponse || {
              schemaVersion: 'musiclab-song-package-v2',
              sessionArc: 'Verified morning arc',
              titles: ['Title One', 'Title Two', 'Title Three'],
              stylePrompt: 'Verified style prompt',
              lyrics: '[Intro]\nLine one',
              sections: [{ section: 'Intro', motifIds: ['motif-001'], delivery: 'distant whisper', lines: ['Line one'], instrumentalInstruction: '' }]
            }) }]
          };
        }
      };
    }
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
load('musiclab/musiclab.js');

const AI = sandbox.MusicLab.AI;
const Detector = sandbox.MusicLab.Detector;
const App = sandbox.MusicLab.App;

function analysis() {
  const bars = [
    bar('2026-07-24T00:00:00Z', 100, 110, 99, 105),
    bar('2026-07-24T00:01:00Z', 105, 111, 104, 109),
    bar('2026-07-24T07:00:00Z', 109, 112, 108.5, 111.7),
    bar('2026-07-24T07:01:00Z', 111.7, 113.1, 111.4, 112.9),
    bar('2026-07-24T07:02:00Z', 112.9, 114, 112.6, 113.5)
  ];
  return Detector.analyzeSession({
    bars: bars,
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
  });
}

(async function run() {
  const baseAnalysis = analysis();
  const fallbackSeed = AI.buildFallbackPackage(baseAnalysis, {
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
  const payload = AI.buildVerifiedPayload(baseAnalysis, {
    mode: 'generate',
    sensitivity: 'Balanced',
    hintStrength: 'Subtle',
    musicStyle: 'Dreamy Deep House',
    vocalStyle: 'Female whisper',
    duration: '4:30',
    maximumEvents: 8,
    wordingSeed: '7',
    includeGeneralWhispers: true
  }, fallbackSeed);
  assert.strictEqual(payload.requestType, 'musiclab-song-package', 'payload is tagged for MusicLab');
  assert(Array.isArray(payload.songEvents) && payload.songEvents.length > 0, 'verified payload includes song events');
  assert(payload.fingerprint && Array.isArray(payload.sectionPlan), 'verified payload includes fingerprint and section plan');
  assert(!Object.prototype.hasOwnProperty.call(payload, 'rawBars'), 'verified payload excludes raw bars');
  function lineForMotifType(type, index) {
    if (/centre_chop|two_sided_whipsaw/.test(type)) return index % 2 === 0 ? 'Around the centre again' : 'The centre still holds';
    if (/upper/.test(type)) return index % 2 === 0 ? 'Around the upper edge' : 'The upper edge answers back';
    if (/lower/.test(type)) return index % 2 === 0 ? 'Below the lower floor' : 'The lower floor answers back';
    if (/bullish_resolution|bullish_reversal|bullish_continuation/.test(type)) return index % 2 === 0 ? 'Higher through the light' : 'The light keeps rising';
    if (/bearish_resolution|bearish_reversal|bearish_continuation/.test(type)) return index % 2 === 0 ? 'Lower through the silence' : 'The silence keeps falling';
    return 'The morning keeps moving';
  }
  sandbox.__aiValidResponse = {
    schemaVersion: 'musiclab-song-package-v2',
    sessionArc: 'Verified morning arc',
    titles: ['Title One', 'Title Two', 'Title Three'],
    stylePrompt: 'Verified style prompt',
    lyrics: '[Intro]\nLine one',
    sections: payload.sectionPlan.map((section, index) => ({
      section: section.section,
      motifIds: section.motifIds.slice(),
      delivery: index === 0 ? 'distant whisper' : 'quiet lead',
      lines: section.section === 'Instrumental Break' ? [] : [
        lineForMotifType((payload.fingerprint.motifs.find((motif) => motif.id === section.motifIds[0]) || {}).type || 'centre_chop', 0),
        lineForMotifType((payload.fingerprint.motifs.find((motif) => motif.id === section.motifIds[section.motifIds.length - 1]) || {}).type || 'centre_chop', 1)
      ],
      instrumentalInstruction: section.lyricRequired === false ? section.sectionTagInstruction : ''
    }))
  };

  const ok = await AI.generateSongPackage({
    analysis: baseAnalysis,
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
  assert.strictEqual(ok.state, 'ok', 'valid AI response is accepted');
  assert.strictEqual(ok.source, 'opencode', 'accepted response is marked as OpenCode');
  assert.strictEqual(ok.sessionArc, 'Verified morning arc', 'session arc is preserved');
  assert.strictEqual(ok.schemaVersion, 'musiclab-song-package-v2', 'v2 schema is preserved');
  assert.strictEqual(ok.titleSuggestions.length, 3, 'title suggestions are normalised');
  assert.strictEqual(ok.sections[0].section, 'Intro', 'section entries are preserved');
  assert.strictEqual(ok.lyricEntries[0].section, 'Intro', 'lyric entries are preserved');
  assert.strictEqual(requests.some((req) => String(req.url).includes('/global/health')), true, 'health check was called');

  const originalFetch = sandbox.fetch;
  sandbox.fetch = async function(url) {
    requests.push({ url: String(url), options: null });
    if (String(url).includes('opencode-musiclab.txt')) return { ok: true, text: async function() { return 'MusicLab prompt\n\n{{verifiedPayload}}'; } };
    if (String(url).includes('/global/health')) return { ok: true, json: async function() { return { status: 'ok' }; } };
    if (String(url).endsWith('/session')) return { ok: true, json: async function() { return { sessionId: 'session-456' }; } };
    if (String(url).includes('/message')) return { ok: true, json: async function() { return { parts: [{ type: 'text', text: 'not json' }] }; } };
    throw new Error('Unexpected fetch: ' + url);
  };
  const fallback = await AI.generateSongPackage({
    analysis: baseAnalysis,
    enabled: true,
    mode: 'reword',
    sensitivity: 'Balanced',
    hintStrength: 'Subtle',
    musicStyle: 'Dreamy Deep House',
    vocalStyle: 'Female whisper',
    duration: '4:30',
    maximumEvents: 8,
    wordingSeed: '9',
    includeGeneralWhispers: true
  });
  assert.strictEqual(fallback.state, 'fallback', 'invalid AI response falls back');
  assert.strictEqual(fallback.source, 'deterministic', 'fallback source is deterministic');
  assert(Array.isArray(fallback.titleSuggestions) && fallback.titleSuggestions.length > 0, 'fallback still provides titles');

  const disabled = await AI.generateSongPackage({
    analysis: baseAnalysis,
    enabled: false,
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
  assert.strictEqual(disabled.state, 'disabled', 'disabled mode returns deterministic fallback');
  assert.strictEqual(disabled.source, 'deterministic', 'disabled mode does not use OpenCode');

  assert.strictEqual(App.formatChartTime(ts('2026-07-24T07:00:00Z')).length, 5, 'chart time formatter returns HH:MM');

  sandbox.fetch = originalFetch;
  console.log('musiclab ai tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
