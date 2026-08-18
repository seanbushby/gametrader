'use strict';
window.MusicLab = window.MusicLab || {};

MusicLab.Fingerprint = (function() {
  const VERSION = 'musiclab-fingerprint-v1';
  const SECTION_ORDER = ['Intro', 'Verse 1', 'Pre-Chorus', 'Chorus', 'Verse 2', 'Bridge', 'Final Chorus', 'Outro'];
  const BAN_PHRASES = [
    'The break looked certain',
    'Then folded into silence',
    'But nothing stayed above'
  ];

  function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function round(value, digits) {
    const factor = Math.pow(10, digits == null ? 2 : digits);
    return Math.round(clamp(value, -1e9, 1e9) * factor) / factor;
  }

  function parseDuration(value) {
    const parts = String(value || '4:30').split(':').map(function(part) { return Number(part); }).filter(function(part) { return Number.isFinite(part); });
    if (!parts.length) return 270;
    if (parts.length === 1) return clamp(parts[0] * 60, 120, 420);
    return clamp(parts[0] * 60 + parts[1], 120, 420);
  }

  function sortEvents(events) {
    return (Array.isArray(events) ? events : []).slice().sort(function(a, b) {
      return Number(a.timestampSeconds || 0) - Number(b.timestampSeconds || 0) || String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  function sessionBounds(events) {
    const sorted = sortEvents(events);
    if (!sorted.length) return { start: 0, end: 1, span: 1 };
    const start = Number(sorted[0].timestampSeconds || 0);
    const last = sorted[sorted.length - 1];
    const end = Number(last.endTimestampSeconds != null ? last.endTimestampSeconds : last.timestampSeconds || start);
    return { start: start, end: Math.max(start + 1, end), span: Math.max(1, end - start) };
  }

  function rel(value, bounds) {
    if (!bounds || !Number.isFinite(Number(value))) return 0;
    return clamp((Number(value) - bounds.start) / bounds.span, 0, 1);
  }

  function phraseIncludes(text, pattern) {
    return String(text || '').toLowerCase().indexOf(String(pattern || '').toLowerCase()) >= 0;
  }

  function sideForEvent(event) {
    const type = String(event && event.type || '');
    const level = String(event && event.levelName || '').toLowerCase();
    if (type === 'bullish_fakeout') return 'upper';
    if (type === 'bearish_fakeout') return 'lower';
    if (/asia_high|previous_day_high|upper/.test(type) || level === 'asia high' || level === 'previous-day high') return 'upper';
    if (/asia_low|previous_day_low|lower/.test(type) || level === 'asia low' || level === 'previous-day low') return 'lower';
    if (/bullish_reversal|bullish_continuation|bullish_trend/.test(type)) return 'upper';
    if (/bearish_reversal|bearish_continuation|bearish_trend/.test(type)) return 'lower';
    return 'centre';
  }

  function motifTypeForEvent(event, classification) {
    const type = String(event && event.type || '');
    const dir = String(event && event.direction || '').toLowerCase();
    const side = sideForEvent(event);
    if (/asia_high_sweep/.test(type) || /asia_high_rejection/.test(type)) return 'asia_high_sweep_recovery';
    if (/asia_low_sweep/.test(type) || /asia_low_rejection/.test(type)) return 'asia_low_sweep_recovery';
    if (/previous_day_high/.test(type) && /sweep|reclaim|rejection|fakeout/.test(type)) return 'repeated_upper_rejection';
    if (/previous_day_low/.test(type) && /sweep|reclaim|rejection|fakeout/.test(type)) return 'repeated_lower_rejection';
    if (/session_open|vwap|chop|range/.test(type)) return 'centre_chop';
    if (/fakeout/.test(type)) return side === 'lower' ? 'failed_lower_break' : 'failed_upper_break';
    if (/reversal/.test(type)) return dir === 'bullish' ? 'bullish_reversal' : 'bearish_reversal';
    if (/continuation|trend/.test(type)) return dir === 'bearish' ? 'bearish_continuation' : 'bullish_continuation';
    if (/breakout/.test(type)) {
      if (dir === 'bearish' || side === 'lower') return 'bearish_continuation';
      return 'bullish_continuation';
    }
    if (/reclaim/.test(type)) return dir === 'bearish' ? 'bearish_reversal' : 'bullish_reversal';
    if (/sweep/.test(type)) return side === 'lower' ? 'asia_low_sweep_recovery' : 'asia_high_sweep_recovery';
    return classification && classification.finalDirection === 'Bullish' ? 'bullish_continuation' : classification && classification.finalDirection === 'Bearish' ? 'bearish_continuation' : 'centre_chop';
  }

  function purposeForType(type) {
    const map = {
      asia_high_sweep_recovery: 'An upper sweep fails to hold and gives the market back.',
      asia_low_sweep_recovery: 'A lower sweep fails to hold and hands price back above the floor.',
      repeated_upper_rejection: 'The upper edge keeps rejecting repeated attempts.',
      repeated_lower_rejection: 'The lower floor keeps rejecting repeated attempts.',
      failed_upper_break: 'An upward attempt appears convincing, then withdraws.',
      failed_lower_break: 'A downward attempt appears convincing, then withdraws.',
      two_sided_whipsaw: 'Opposite sides keep pulling the session back to the middle.',
      centre_chop: 'The centre holds price in a repeated, unresolved rotation.',
      bullish_continuation: 'The market keeps climbing after the early test.',
      bearish_continuation: 'The market keeps falling after the early test.',
      bullish_reversal: 'The early move fails and the turn carries higher.',
      bearish_reversal: 'The early move fails and the turn carries lower.',
      bullish_resolution: 'The morning chooses the upside and holds it.',
      bearish_resolution: 'The morning chooses the downside and holds it.',
      neutral_resolution: 'The session resolves without a decisive edge.'
    };
    return map[type] || 'A structural market event is carried into the song.';
  }

  function sectionEnergyForType(type) {
    if (type === 'centre_chop' || type === 'two_sided_whipsaw') return 'unstable_medium';
    if (/resolution/.test(type)) return 'settled_high';
    if (/reversal/.test(type)) return 'turning_rising';
    if (/continuation/.test(type)) return 'driving';
    return 'rising_then_cut';
  }

  function allowedSectionsForMotif(type, index, total, isFinal) {
    if (/resolution/.test(type) || isFinal) return ['Bridge', 'Final Chorus', 'Outro'];
    if (type === 'centre_chop' || type === 'two_sided_whipsaw') return ['Instrumental Break', 'Bridge'];
    if (/reversal/.test(type)) return ['Pre-Chorus', 'Bridge', 'Chorus'];
    if (/continuation/.test(type)) return ['Verse 1', 'Verse 2', 'Chorus'];
    if (index === 0) return ['Intro', 'Verse 1'];
    return ['Verse 1', 'Pre-Chorus', 'Verse 2'];
  }

  function familyKey(motif) {
    const type = String(motif && motif.type || '');
    if (/two_sided_whipsaw|centre_chop/.test(type)) return 'centre';
    if (/upper|asia_high|failed_upper|repeated_upper/.test(type)) return 'upper';
    if (/lower|asia_low|failed_lower|repeated_lower/.test(type)) return 'lower';
    if (/bullish_/.test(type)) return 'bullish';
    if (/bearish_/.test(type)) return 'bearish';
    return [motif.side, type.replace(/_(recovery|resolution|continuation|reversal)$/, '')].join('|');
  }

  function makeMotif(event, index, bounds, classification) {
    const type = motifTypeForEvent(event, classification);
    const startRelative = rel(event.timestampSeconds, bounds);
    const endRelative = rel(event.endTimestampSeconds == null ? event.timestampSeconds : event.endTimestampSeconds, bounds);
    const duration = Math.max(0.01, endRelative - startRelative);
    const side = sideForEvent(event);
    const sourceEventIds = Array.isArray(event.sourceEventIds) && event.sourceEventIds.length ? event.sourceEventIds.map(String) : [String(event.id || 'event-' + String(index + 1).padStart(3, '0'))];
    return {
      id: 'motif-' + String(index + 1).padStart(3, '0'),
      order: index + 1,
      type: type,
      sourceEventIds: sourceEventIds,
      startRelative: round(startRelative, 3),
      endRelative: round(Math.max(endRelative, startRelative + 0.01), 3),
      durationWeight: round(duration, 3),
      importance: round(clamp(Number(event.importance) || 0, 0, 1), 2),
      repetitionCount: Math.max(1, sourceEventIds.length),
      relationshipToPrevious: null,
      allowedSections: allowedSectionsForMotif(type, index, 1, false),
      requiredRepresentation: /resolution/.test(type) || event.importance >= 0.85 ? ['lyrics'] : type === 'centre_chop' ? ['instrumental'] : ['lyrics'],
      lyricPurpose: purposeForType(type),
      sectionEnergy: sectionEnergyForType(type),
      side: side,
      finalOutcome: null,
      rawEvent: event
    };
  }

  function sameFamily(a, b) {
    return familyKey(a) === familyKey(b);
  }

  function canMergeWhipsaw(a, b) {
    if (!a || !b) return false;
    const gap = b.startRelative - a.endRelative;
    if (gap > 0.18) return false;
    const conflict = (a.side !== b.side) && (a.side !== 'centre' || b.side !== 'centre');
    return conflict && (/failed_|repeated_|centre_chop|whipsaw/.test(a.type) || /failed_|repeated_|centre_chop|whipsaw/.test(b.type));
  }

  function mergeMotifs(a, b, type) {
    const sourceEventIds = Array.from(new Set([].concat(a.sourceEventIds || [], b.sourceEventIds || [])));
    const startRelative = Math.min(a.startRelative, b.startRelative);
    const endRelative = Math.max(a.endRelative, b.endRelative);
    const importance = Math.max(a.importance, b.importance, round((a.importance + b.importance) / 2 + 0.08, 2));
    const repetitionCount = (a.repetitionCount || 1) + (b.repetitionCount || 1);
    return {
      id: a.id,
      order: a.order,
      type: type || a.type,
      sourceEventIds: sourceEventIds,
      startRelative: round(startRelative, 3),
      endRelative: round(endRelative, 3),
      durationWeight: round(Math.max(a.durationWeight || 0.01, b.durationWeight || 0.01, endRelative - startRelative), 3),
      importance: round(importance, 2),
      repetitionCount: repetitionCount,
      relationshipToPrevious: a.relationshipToPrevious,
      allowedSections: Array.from(new Set([].concat(a.allowedSections || [], b.allowedSections || []))),
      requiredRepresentation: Array.from(new Set([].concat(a.requiredRepresentation || [], b.requiredRepresentation || []))),
      lyricPurpose: purposeForType(type || a.type),
      sectionEnergy: sectionEnergyForType(type || a.type),
      side: a.side === b.side ? a.side : 'centre',
      finalOutcome: b.finalOutcome || a.finalOutcome || null
    };
  }

  function collapseMotifs(motifs, classification) {
    const collapsed = [];
    for (const motif of motifs) {
      const prev = collapsed[collapsed.length - 1];
      if (prev && sameFamily(prev, motif) && (motif.startRelative - prev.endRelative) <= 0.08) {
        const merged = mergeMotifs(prev, motif, prev.type);
        merged.relationshipToPrevious = 'repeat';
        merged.repetitionCount = (prev.repetitionCount || 1) + (motif.repetitionCount || 1);
        if (merged.side === 'upper') merged.type = 'repeated_upper_rejection';
        else if (merged.side === 'lower') merged.type = 'repeated_lower_rejection';
        else if (merged.type === 'centre_chop') merged.type = 'centre_chop';
        collapsed[collapsed.length - 1] = merged;
        continue;
      }
      if (prev && canMergeWhipsaw(prev, motif)) {
        const merged = mergeMotifs(prev, motif, 'two_sided_whipsaw');
        merged.relationshipToPrevious = prev.side === motif.side ? 'repeat' : (prev.side === 'centre' || motif.side === 'centre' ? 'mirrored_conflict' : 'contrast');
        collapsed[collapsed.length - 1] = merged;
        continue;
      }
      const copy = Object.assign({}, motif);
      if (prev) {
        copy.relationshipToPrevious = relationshipBetween(prev, copy);
      }
      collapsed.push(copy);
    }
    const last = collapsed[collapsed.length - 1];
    if (last) {
      const finalDirection = String(classification && classification.finalDirection || 'Neutral').toLowerCase();
      if (finalDirection === 'bullish') last.finalOutcome = 'bullish_resolution';
      else if (finalDirection === 'bearish') last.finalOutcome = 'bearish_resolution';
      else last.finalOutcome = 'neutral_resolution';
      if (/resolution/.test(last.type) === false) {
        last.type = last.finalOutcome;
        last.lyricPurpose = purposeForType(last.type);
        last.sectionEnergy = sectionEnergyForType(last.type);
      }
    }
    return collapsed.map(function(motif, index) {
      const copy = Object.assign({}, motif);
      copy.id = 'motif-' + String(index + 1).padStart(3, '0');
      copy.order = index + 1;
      copy.allowedSections = allowedSectionsForMotif(copy.type, index, collapsed.length, index === collapsed.length - 1);
      return copy;
    });
  }

  function relationshipBetween(prev, curr) {
    if (!prev) return null;
    if (prev.type === curr.type || familyKey(prev) === familyKey(curr)) return 'repeat';
    if (prev.side !== curr.side) {
      if (prev.side === 'centre' || curr.side === 'centre') return 'interruption';
      return 'mirrored_conflict';
    }
    if (/resolution$/.test(curr.type)) return 'resolution';
    if (/reversal$/.test(curr.type)) return 'reversal';
    if (/continuation$/.test(curr.type)) return 'continuation';
    return 'contrast';
  }

  function determineMacroShape(motifs, classification) {
    const types = motifs.map(function(m) { return m.type; });
    const final = String(classification && classification.finalDirection || 'Neutral').toLowerCase();
    if (types.indexOf('two_sided_whipsaw') >= 0) return 'two_sided_whipsaw_then_' + final + '_resolution';
    if (types.indexOf('centre_chop') >= 0 && final !== 'neutral') return 'centre_chop_into_' + final + '_resolution';
    if (types.indexOf('failed_upper_break') >= 0 && final === 'bullish') return 'failed_upper_then_bullish_resolution';
    if (types.indexOf('failed_lower_break') >= 0 && final === 'bearish') return 'failed_lower_then_bearish_resolution';
    return types.slice(0, 2).join('_then_') + (final ? '_to_' + final + '_resolution' : '_resolution');
  }

  function computeCoverage(motifs) {
    const represented = motifs.filter(function(m) { return (m.importance || 0) >= 0.65; }).length;
    const high = motifs.filter(function(m) { return (m.importance || 0) >= 0.85; }).length;
    return { representedMotifs: represented, highImportanceMotifs: high, totalMotifs: motifs.length };
  }

  function baseSectionRole(motif, index, total, finalDirection) {
    if (index === 0) return motif.startRelative < 0.14 ? 'Intro' : 'Verse 1';
    if (index === total - 1) return finalDirection === 'Neutral' ? 'Outro' : 'Final Chorus';
    if (motif.type === 'two_sided_whipsaw' || motif.type === 'centre_chop') return index < total - 1 ? 'Instrumental Break' : 'Bridge';
    if (/reversal/.test(motif.type)) return index < 3 ? 'Pre-Chorus' : 'Bridge';
    if (/continuation/.test(motif.type)) return motif.importance >= 0.8 ? 'Chorus' : 'Verse 2';
    if (/resolution/.test(motif.type)) return 'Final Chorus';
    return index % 3 === 1 ? 'Verse 1' : index % 3 === 2 ? 'Pre-Chorus' : 'Verse 2';
  }

  function buildSectionPlan(fingerprint, opts) {
    const motifs = Array.isArray(fingerprint && fingerprint.motifs) ? fingerprint.motifs : [];
    const finalDirection = String(fingerprint && fingerprint.resolution && fingerprint.resolution.direction || 'neutral').toLowerCase();
    const sections = [];
    let current = null;
    motifs.forEach(function(motif, index) {
      let role = baseSectionRole(motif, index, motifs.length, finalDirection === 'bullish' ? 'Bullish' : finalDirection === 'bearish' ? 'Bearish' : 'Neutral');
      if (motif.type === 'two_sided_whipsaw' || motif.type === 'centre_chop') role = motif.repetitionCount > 1 ? 'Instrumental Break' : 'Pre-Chorus';
      if (index === motifs.length - 1 && /resolution/.test(motif.type)) role = finalDirection === 'neutral' ? 'Outro' : 'Final Chorus';
      if (motif.importance >= 0.85 && role === 'Verse 2') role = 'Chorus';
      const section = current && current.section === role ? current : {
        section: role,
        motifIds: [],
        relativeStart: motif.startRelative,
        relativeEnd: motif.endRelative,
        purpose: '',
        lyricRequired: true,
        sectionTagInstruction: '',
        energy: motif.sectionEnergy,
        lineCount: 0,
        maximumWords: 18,
        generalRefrain: false,
        bannedPhrases: BAN_PHRASES.slice(),
        requiredContrast: false,
        motifSummaries: []
      };
      if (section !== current) {
        sections.push(section);
        current = section;
      }
      section.motifIds.push(motif.id);
      section.relativeStart = Math.min(section.relativeStart, motif.startRelative);
      section.relativeEnd = Math.max(section.relativeEnd, motif.endRelative);
      section.energy = section.energy || motif.sectionEnergy;
      section.motifSummaries.push(motif.lyricPurpose);
      const structuralWords = motif.type === 'two_sided_whipsaw' || motif.type === 'centre_chop' ? 2 : /resolution/.test(motif.type) ? 3 : 1;
      section.lineCount = Math.max(section.lineCount, motif.importance >= 0.85 ? 3 : motif.importance >= 0.65 ? 2 : 1);
      section.maximumWords = Math.max(section.maximumWords, motif.importance >= 0.85 ? 15 : 12 + structuralWords * 2);
      section.lyricRequired = section.lyricRequired || motif.importance >= 0.65 || /resolution/.test(motif.type);
      section.requiredContrast = section.requiredContrast || motif.relationshipToPrevious === 'mirrored_conflict' || motif.relationshipToPrevious === 'contrast';
      if (motif.type === 'two_sided_whipsaw' || motif.type === 'centre_chop') section.sectionTagInstruction = 'Use mirrored short vocal fragments and keep the centre unresolved for a long middle passage.';
      else if (/reversal/.test(motif.type)) section.sectionTagInstruction = 'Carry cause before consequence and let the turn arrive after the failed move.';
      else if (/resolution/.test(motif.type)) section.sectionTagInstruction = 'Make the ending unmistakable and let the final direction settle clearly.';
      else section.sectionTagInstruction = 'Keep the phrase tied to the chronological market move and avoid generic filler.';
      if (section.section === 'Instrumental Break') section.lyricRequired = false;
      section.purpose = section.purpose ? section.purpose + ' ' + motif.lyricPurpose : motif.lyricPurpose;
      if (motif.importance >= 0.85) section.generalRefrain = false;
      if (current === section) current = section;
    });

    function cloneSection(section, name, motifRef, extra) {
      const source = section || {};
      const motifIds = Array.isArray(source.motifIds) ? source.motifIds.slice() : [];
      const cloned = Object.assign({}, source, extra || {}, {
        section: name,
        motifIds: motifIds.length ? motifIds : (motifRef && motifRef.id ? [motifRef.id] : []),
        relativeStart: typeof (extra && extra.relativeStart) === 'number' ? extra.relativeStart : source.relativeStart,
        relativeEnd: typeof (extra && extra.relativeEnd) === 'number' ? extra.relativeEnd : source.relativeEnd,
        lineCount: Math.max(2, source.lineCount || 2),
        maximumWords: Math.max(12, source.maximumWords || 12),
        lyricRequired: true,
        generalRefrain: false
      });
      if (name === 'Bridge') cloned.sectionTagInstruction = 'Shift the phrasing into a more reflective turn before the finish.';
      if (name === 'Final Chorus') cloned.sectionTagInstruction = 'Land the ending clearly and let the resolution feel unmistakable.';
      return cloned;
    }

    if (motifs.length > 0 && motifs.length <= 2 && sections.length <= 3) {
      const expanded = [];
      const first = motifs[0];
      const second = motifs[1] || motifs[0];
      const introEnd = first ? Math.min(first.endRelative, Math.max(first.startRelative + 0.12, 0.12)) : 0.12;
      const verseEnd = first ? Math.min(first.endRelative, Math.max(introEnd + 0.14, 0.34)) : 0.34;
      const middleRole = motifs.length === 1 ? 'Pre-Chorus' : 'Bridge';
      const closingRole = finalDirection === 'neutral' ? 'Outro' : 'Final Chorus';
      expanded.push(cloneSection(sections[0], 'Intro', first, { relativeStart: first.startRelative, relativeEnd: introEnd }));
      expanded.push(cloneSection(sections[0], 'Verse 1', first, { relativeStart: Math.min(first.endRelative, Math.max(first.startRelative + 0.14, introEnd + 0.02)), relativeEnd: verseEnd }));
      expanded.push(cloneSection(sections[1] || sections[0], middleRole, second, { relativeStart: Math.max(first.endRelative, second.startRelative), relativeEnd: Math.min(second.endRelative, 0.78) }));
      expanded.push(cloneSection(sections[1] || sections[0], closingRole, second, { relativeStart: Math.max(second.startRelative, 0.8), relativeEnd: Math.max(second.endRelative, 0.98) }));
      sections.length = 0;
      expanded.forEach(function(section) { sections.push(section); });
    }

    sections.forEach(function(section, index) {
      section.relativeStart = round(section.relativeStart, 3);
      section.relativeEnd = round(section.relativeEnd, 3);
      section.purpose = String(section.purpose || '').trim();
      section.motifIds = Array.from(new Set(section.motifIds));
      section.bannedPhrases = Array.from(new Set((section.bannedPhrases || []).concat(BAN_PHRASES)));
      if (index === 0) section.section = 'Intro';
      if (index === sections.length - 1 && finalDirection !== 'neutral' && !/resolution/.test(section.purpose.toLowerCase())) section.section = 'Final Chorus';
    });
    return sections;
  }

  function applyOverrides(fingerprint, analysis, overrides) {
    const sourceEvents = new Map(sortEvents(analysis && analysis.songEvents).map(function(event) { return [String(event.id), event]; }));
    const out = JSON.parse(JSON.stringify(fingerprint || {}));
    out.motifs = Array.isArray(out.motifs) ? out.motifs.slice() : [];
    const manual = overrides || {};
    const next = [];
    const omitted = Array.isArray(out.omittedMotifs) ? out.omittedMotifs.slice() : [];
    out.motifs.forEach(function(motif) {
      const override = manual[motif.id] || null;
      if (override && override.included === false) {
        omitted.push(Object.assign({}, motif, { omissionReason: 'user excluded' }));
        return;
      }
      if (override && override.split && motif.sourceEventIds && motif.sourceEventIds.length > 1) {
        motif.sourceEventIds.forEach(function(id, index) {
          const event = sourceEvents.get(String(id));
          if (!event) return;
          const splitMotif = makeMotif(Object.assign({}, event, { id: id }), next.length, { start: event.timestampSeconds || motif.startRelative, end: event.endTimestampSeconds || event.timestampSeconds || motif.endRelative, span: Math.max(1, (event.endTimestampSeconds || event.timestampSeconds || 0) - (event.timestampSeconds || 0)) }, { finalDirection: out.resolution && out.resolution.direction ? String(out.resolution.direction).charAt(0).toUpperCase() + String(out.resolution.direction).slice(1) : 'Neutral' });
          splitMotif.id = motif.id + '-' + String(index + 1);
          splitMotif.order = next.length + 1;
          splitMotif.importance = round(clamp(splitMotif.importance + 0.04, 0, 1), 2);
          next.push(splitMotif);
        });
        return;
      }
      const copy = Object.assign({}, motif);
      if (override && override.dominant) {
        copy.importance = 1;
        copy.dominant = true;
      }
      next.push(copy);
    });
    out.motifs = next.map(function(motif, index) {
      const copy = Object.assign({}, motif);
      copy.id = 'motif-' + String(index + 1).padStart(3, '0');
      copy.order = index + 1;
      return copy;
    });
    out.omittedMotifs = omitted;
    out.macroShape = determineMacroShape(out.motifs, { finalDirection: out.resolution && out.resolution.direction ? String(out.resolution.direction).replace(/^./, function(ch) { return ch.toUpperCase(); }) : 'Neutral' });
    out.resolution = out.resolution || { direction: 'neutral', strength: 0.5 };
    out.coverage = computeCoverage(out.motifs);
    out.sectionPlan = buildSectionPlan(out, { hintStrength: analysis && analysis.hintStrength });
    out.infusion = {
      status: out.coverage.highImportanceMotifs && out.coverage.representedMotifs >= out.coverage.highImportanceMotifs ? 'Strong' : out.coverage.representedMotifs ? 'Partial' : 'Weak',
      macroShape: out.macroShape,
      finalResolution: out.resolution.direction,
      motifCount: out.motifs.length
    };
    return out;
  }

  function compileFingerprint(input) {
    const analysis = input || {};
    const events = sortEvents(analysis.events || analysis.songEvents || []);
    const bounds = sessionBounds(events);
    const classification = analysis.classification || { finalDirection: 'Neutral' };
    const rawMotifs = events.map(function(event, index) { return makeMotif(event, index, bounds, classification); });
    const motifs = collapseMotifs(rawMotifs, classification);
    const resolution = {
      direction: String(classification.finalDirection || 'Neutral').toLowerCase(),
      strength: round(clamp((motifs[motifs.length - 1] && motifs[motifs.length - 1].importance || 0.7) + (classification.finalDirection === 'Neutral' ? -0.15 : 0.08), 0.05, 0.99), 2)
    };
    const fingerprint = {
      schemaVersion: VERSION,
      macroShape: determineMacroShape(motifs, classification),
      resolution: resolution,
      motifs: motifs,
      coverage: computeCoverage(motifs),
      omittedMotifs: [],
      songDurationSeconds: parseDuration(analysis.duration || '4:30'),
      songTiming: {
        sessionStartRelative: 0,
        sessionEndRelative: 1,
        songStartSeconds: 0,
        songEndSeconds: parseDuration(analysis.duration || '4:30')
      }
    };
    fingerprint.sectionPlan = buildSectionPlan(fingerprint, { hintStrength: analysis.hintStrength, vocalStyle: analysis.vocalStyle });
    fingerprint.timelineMap = fingerprint.sectionPlan.map(function(section) {
      return {
        section: section.section,
        relativeStart: section.relativeStart,
        relativeEnd: section.relativeEnd,
        motifIds: section.motifIds.slice(),
        purpose: section.purpose
      };
    });
    fingerprint.infusion = {
      status: fingerprint.coverage.highImportanceMotifs && fingerprint.coverage.representedMotifs >= fingerprint.coverage.highImportanceMotifs ? 'Strong' : fingerprint.coverage.representedMotifs ? 'Partial' : 'Weak',
      macroShape: fingerprint.macroShape,
      finalResolution: fingerprint.resolution.direction,
      motifCount: fingerprint.motifs.length
    };
    return fingerprint;
  }

  function renderSectionMap(sectionPlan, duration) {
    const total = parseDuration(duration || '4:30');
    return (Array.isArray(sectionPlan) ? sectionPlan : []).map(function(section) {
      return {
        section: section.section,
        startSeconds: round(section.relativeStart * total, 1),
        endSeconds: round(section.relativeEnd * total, 1),
        motifIds: Array.isArray(section.motifIds) ? section.motifIds.slice() : [],
        purpose: section.purpose || ''
      };
    });
  }

  return {
    VERSION: VERSION,
    SECTION_ORDER: SECTION_ORDER,
    BAN_PHRASES: BAN_PHRASES,
    parseDuration: parseDuration,
    sessionBounds: sessionBounds,
    compileFingerprint: compileFingerprint,
    applyOverrides: applyOverrides,
    buildSectionPlan: buildSectionPlan,
    renderSectionMap: renderSectionMap
  };
})();
