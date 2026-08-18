'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sandbox = { console, Date, Intl, Map, Set, Math, Number, String, Array, Object, JSON };
sandbox.window = sandbox;
vm.createContext(sandbox);

function load(relativePath) {
  const file = path.join(root, relativePath);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

function event(id, type, timestampSeconds, endTimestampSeconds, importance, direction, levelName, description) {
  return {
    id: id,
    type: type,
    timestampSeconds: timestampSeconds,
    endTimestampSeconds: endTimestampSeconds == null ? timestampSeconds : endTimestampSeconds,
    importance: importance,
    confidence: 0.8,
    direction: direction,
    levelName: levelName || null,
    description: description || type.replace(/_/g, ' '),
    sourceEventIds: [id]
  };
}

load('musiclab/musiclab-fingerprint.js');
load('musiclab/musiclab-lyrics.js');

const Fingerprint = sandbox.MusicLab.Fingerprint;
const Lyrics = sandbox.MusicLab.Lyrics;

(function run() {
  const collapsed = Fingerprint.compileFingerprint({
    events: [
      event('event-001', 'asia_high_sweep', 0, 20, 0.68, 'bearish', 'Asia High'),
      event('event-002', 'asia_high_sweep', 25, 45, 0.72, 'bearish', 'Asia High'),
      event('event-003', 'asia_high_sweep', 50, 70, 0.7, 'bearish', 'Asia High'),
      event('event-004', 'bullish_resolution', 1200, 1260, 0.95, 'bullish', 'VWAP')
    ],
    classification: { finalDirection: 'Bullish' },
    duration: '4:30',
    hintStrength: 'Subtle'
  });
  assert(collapsed.motifs.length <= 2, 'same-side repeated events collapse into a compact motif set');
  assert(collapsed.motifs[0].repetitionCount >= 3, 'collapsed motif keeps repetition count');
  assert(collapsed.motifs[0].type === 'repeated_upper_rejection' || collapsed.motifs[0].type === 'asia_high_sweep_recovery', 'collapsed motif keeps upper-side meaning');

  const whipsaw = Fingerprint.compileFingerprint({
    events: [
      event('event-001', 'bullish_fakeout', 0, 20, 0.7, 'bullish', 'VWAP'),
      event('event-002', 'bearish_fakeout', 24, 44, 0.74, 'bearish', 'VWAP'),
      event('event-003', 'bullish_fakeout', 48, 68, 0.76, 'bullish', 'VWAP'),
      event('event-004', 'bearish_fakeout', 72, 92, 0.78, 'bearish', 'VWAP'),
      event('event-005', 'bullish_resolution', 1200, 1260, 0.95, 'bullish', 'VWAP')
    ],
    classification: { finalDirection: 'Bullish' },
    duration: '4:30',
    hintStrength: 'Subtle'
  });
  assert(whipsaw.motifs.some((motif) => motif.type === 'two_sided_whipsaw'), 'alternating conflict becomes a whipsaw motif');

  const timing = Fingerprint.compileFingerprint({
    events: [
      event('event-001', 'centre_chop', 0, 600, 0.55, 'neutral', 'VWAP'),
      event('event-002', 'bullish_continuation', 900, 1050, 0.9, 'bullish', 'VWAP'),
      event('event-003', 'bullish_resolution', 1500, 1650, 0.95, 'bullish', 'VWAP')
    ],
    classification: { finalDirection: 'Bullish' },
    duration: '4:30',
    hintStrength: 'Guided'
  });
  const mapped = Fingerprint.renderSectionMap(timing.sectionPlan, '4:30');
  assert(mapped.length > 0, 'section map is built');
  assert(mapped.every((section, index, list) => index === 0 || section.startSeconds >= list[index - 1].startSeconds), 'section timings are chronological');
  assert(mapped[mapped.length - 1].section === 'Final Chorus' || mapped[mapped.length - 1].section === 'Outro', 'final resolution lands near the end');

  const sparseOne = Fingerprint.compileFingerprint({
    events: [
      event('event-001', 'centre_chop', 0, 420, 0.58, 'neutral', 'VWAP'),
      event('event-002', 'bullish_resolution', 1260, 1320, 0.94, 'bullish', 'VWAP')
    ],
    classification: { finalDirection: 'Bullish' },
    duration: '4:30',
    hintStrength: 'Subtle'
  });
  assert(sparseOne.sectionPlan.length >= 3, 'single-motif sessions expand into a fuller arc');
  assert.strictEqual(sparseOne.sectionPlan[0].section, 'Intro', 'single-motif arc starts with an intro');
  assert(sparseOne.sectionPlan.some((section) => section.section === 'Pre-Chorus' || section.section === 'Bridge'), 'single-motif arc includes a middle section');
  assert(/Final Chorus|Outro/.test(sparseOne.sectionPlan[sparseOne.sectionPlan.length - 1].section), 'single-motif arc closes at the end');

  const sparseTwo = Fingerprint.compileFingerprint({
    events: [
      event('event-001', 'asia_high_sweep', 0, 30, 0.7, 'bearish', 'Asia High'),
      event('event-002', 'bullish_resolution', 1320, 1380, 0.95, 'bullish', 'VWAP')
    ],
    classification: { finalDirection: 'Bullish' },
    duration: '4:30',
    hintStrength: 'Subtle'
  });
  assert(sparseTwo.sectionPlan.length >= 4, 'two-motif sessions expand into four sections');
  assert.strictEqual(sparseTwo.sectionPlan.map((section) => section.section).join('|'), 'Intro|Verse 1|Bridge|Final Chorus', 'two-motif sessions follow a chronological four-part arc');

  const longer = Fingerprint.compileFingerprint({
    events: [
      event('event-001', 'centre_chop', 0, 1200, 0.6, 'neutral', 'VWAP'),
      event('event-002', 'bullish_resolution', 1500, 1620, 0.9, 'bullish', 'VWAP')
    ],
    classification: { finalDirection: 'Bullish' },
    duration: '4:30',
    hintStrength: 'Training'
  });
  assert(longer.motifs[0].durationWeight >= longer.motifs[1].durationWeight, 'longer structural spans carry more weight');
  assert(longer.infusion.status === 'Strong' || longer.infusion.status === 'Partial', 'infusion status is computed');

  const overridden = Fingerprint.applyOverrides(longer, { songEvents: [
    event('event-001', 'centre_chop', 0, 1200, 0.6, 'neutral', 'VWAP'),
    event('event-002', 'bullish_resolution', 1500, 1620, 0.9, 'bullish', 'VWAP')
  ] }, { 'motif-001': { included: false } });
  assert(overridden.omittedMotifs.some((motif) => motif.omissionReason === 'user excluded'), 'excluded motifs are tracked');
  assert(overridden.sectionPlan.length > 0, 'overrides rebuild the section plan');

  const packageData = Lyrics.generatePackage({
    fingerprint: timing,
    sectionPlan: timing.sectionPlan,
    instrument: 'DE40',
    date: '2026-07-24',
    hintStrength: 'Subtle',
    musicStyle: 'Dreamy Deep House',
    vocalStyle: 'Female whisper',
    duration: '4:30',
    wordingSeed: '7',
    includeGeneralWhispers: true
  });
  assert(packageData.schemaVersion === 'musiclab-song-package-v2', 'fingerprint path returns v2 package');
  assert(packageData.sections.length > 0, 'fingerprint path generates sections');
  assert(!/The break looked certain/.test(packageData.lyrics), 'banned phrase is not reused');
  assert(packageData.sections.every((section, index, list) => index === 0 || section.section !== list[index - 1].section || section.lines.join(' ') !== list[index - 1].lines.join(' ')), 'non-refrain lines do not repeat verbatim');

  const deterministicA = Fingerprint.compileFingerprint({ events: timing.motifs.map(function(motif, index) {
    return event('event-' + String(index + 1).padStart(3, '0'), motif.type, motif.startRelative * 1800, motif.endRelative * 1800, motif.importance, motif.side === 'upper' ? 'bullish' : motif.side === 'lower' ? 'bearish' : 'neutral', motif.side === 'upper' ? 'Asia High' : motif.side === 'lower' ? 'Asia Low' : 'VWAP');
  }), classification: { finalDirection: 'Bullish' }, duration: '4:30', hintStrength: 'Subtle' });
  const deterministicB = Fingerprint.compileFingerprint({ events: timing.motifs.map(function(motif, index) {
    return event('event-' + String(index + 1).padStart(3, '0'), motif.type, motif.startRelative * 1800, motif.endRelative * 1800, motif.importance, motif.side === 'upper' ? 'bullish' : motif.side === 'lower' ? 'bearish' : 'neutral', motif.side === 'upper' ? 'Asia High' : motif.side === 'lower' ? 'Asia Low' : 'VWAP');
  }), classification: { finalDirection: 'Bullish' }, duration: '4:30', hintStrength: 'Subtle' });
  assert.strictEqual(JSON.stringify(deterministicA.motifs), JSON.stringify(deterministicB.motifs), 'fingerprint compilation is deterministic');

  console.log('musiclab fingerprint tests passed');
})();
