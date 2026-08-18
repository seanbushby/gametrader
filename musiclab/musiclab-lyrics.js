'use strict';
window.MusicLab = window.MusicLab || {};

MusicLab.Lyrics = (function() {
  const SECTION_ORDER = (MusicLab.Fingerprint && Array.isArray(MusicLab.Fingerprint.SECTION_ORDER)) ? MusicLab.Fingerprint.SECTION_ORDER.slice() : ['Intro', 'Verse 1', 'Pre-Chorus', 'Chorus', 'Verse 2', 'Bridge', 'Final Chorus', 'Outro'];
  const STYLE_LABELS = {
    'Dreamy Deep House': 'Dreamy hypnotic deep house with subtle 1980s arcade textures, restrained warm bass, spacious pads, soft electronic percussion, gradual progression, focus-oriented atmosphere, soft female lead and distant ghostly whispers.',
    'Dark Arcade Deep House': 'Dark arcade deep house with shadowed synths, restrained low end, distant machine textures, slow pulse and a nocturnal focus.',
    'Ambient Focus': 'Ambient focus music with airy pads, patient movement, gentle pulse and wide quiet space.',
    'Cinematic Electronic': 'Cinematic electronic with gradual build, spacious synths, subtle tension and polished low-frequency weight.',
    'Minimal Tech House': 'Minimal tech house with clean percussion, tight bass, restrained variation and a forward-driving studio feel.'
  };
  const VOCAL_LABELS = {
    'Female whisper': 'Female whisper with distant ghostly phrasing.',
    'Male whisper': 'Male whisper with distant ghostly phrasing.',
    'Mixed whispers': 'Mixed whispers with layered distance and restraint.',
    'Minimal spoken vocal': 'Minimal spoken vocal with sparse phrasing.',
    'Mostly instrumental': 'Mostly instrumental with only occasional vocal fragments.'
  };

  const PHRASES = {
    asia_high_sweep: {
      Atmospheric: ['The ceiling bends', 'Then fades away'],
      Subtle: ['The upper edge was taken', 'But nothing stayed above'],
      Guided: ['Watch the upper edge', 'The break will not remain'],
      Training: ['Asia high was swept', 'The breakout failed']
    },
    asia_low_sweep: {
      Atmospheric: ['A shadow crossed beneath us', 'Then quietly returned'],
      Subtle: ['Below the morning floor', 'The darkness could not stay'],
      Guided: ['The lower edge gives way', 'Then rises back again'],
      Training: ['Asia low was swept', 'Then reclaimed']
    },
    session_open_reclaim: {
      Atmospheric: ['The first light found us again'],
      Subtle: ['The opening light returned'],
      Guided: ['The opening line returned', 'And held beneath the climb'],
      Training: ['The 08:00 open was reclaimed']
    },
    vwap_rejection: {
      Atmospheric: ['Circles in the quiet', 'Nowhere left to run'],
      Subtle: ['Around the centre', 'Back and forth again'],
      Guided: ['Wait through the circles', 'The centre has no answer'],
      Training: ['VWAP rejection', 'Wait for direction']
    },
    vwap_reclaim: {
      Atmospheric: ['The centre opens again'],
      Subtle: ['The middle gives way', 'Then opens to the light'],
      Guided: ['The middle line returns', 'And holds the move'],
      Training: ['VWAP reclaimed']
    },
    bullish_breakout: {
      Atmospheric: ['The morning starts to rise'],
      Subtle: ['Higher through the light', 'The rhythm carries on'],
      Guided: ['The opening line holds below', 'The climb continues'],
      Training: ['Bullish breakout', 'Higher lows remain']
    },
    bearish_breakout: {
      Atmospheric: ['The light begins to fall'],
      Subtle: ['Lower through the silence', 'The rhythm carries down'],
      Guided: ['The opening line holds above', 'The fall continues'],
      Training: ['Bearish breakout', 'Lower highs remain']
    },
    bullish_fakeout: {
      Atmospheric: ['The door appeared to open', 'Then vanished in the dark'],
      Subtle: ['The break looked certain', 'Then folded into silence'],
      Guided: ['Do not trust the first break', 'It returns inside'],
      Training: ['The breakout was false', 'Price returned to range']
    },
    bearish_fakeout: {
      Atmospheric: ['The door appeared to open', 'Then vanished in the dark'],
      Subtle: ['The break looked certain', 'Then folded into silence'],
      Guided: ['Do not trust the first break', 'It returns inside'],
      Training: ['The breakout was false', 'Price returned to range']
    },
    bullish_continuation: {
      Atmospheric: ['The morning starts to rise'],
      Subtle: ['Higher through the light', 'The rhythm carries on'],
      Guided: ['The opening line holds below', 'The climb continues'],
      Training: ['Bullish continuation', 'Higher lows remain']
    },
    bearish_continuation: {
      Atmospheric: ['The light begins to fall'],
      Subtle: ['Lower through the silence', 'The rhythm carries down'],
      Guided: ['The opening line holds above', 'The fall continues'],
      Training: ['Bearish continuation', 'Lower highs remain']
    },
    bullish_reversal: {
      Atmospheric: ['The quiet turns and lifts'],
      Subtle: ['The edge gives back', 'Then opens higher'],
      Guided: ['The first move failed', 'The return climbs higher'],
      Training: ['Bullish reversal', 'The downside failed']
    },
    bearish_reversal: {
      Atmospheric: ['The bright line softens'],
      Subtle: ['The first move fades', 'Then turns lower'],
      Guided: ['The first move failed', 'The return falls lower'],
      Training: ['Bearish reversal', 'The upside failed']
    },
    chop: {
      Atmospheric: ['Circles in the quiet', 'Nowhere left to run'],
      Subtle: ['Around the centre', 'Back and forth again'],
      Guided: ['Wait through the circles', 'The centre has no answer'],
      Training: ['Chop around the centre', 'Wait for direction']
    },
    range: {
      Atmospheric: ['The motion holds its breath'],
      Subtle: ['Inside the quiet frame', 'The edges stay intact'],
      Guided: ['The range stays in place', 'No side gets away'],
      Training: ['Range holds', 'No confirmed breakout']
    },
    bullish_trend: {
      Atmospheric: ['The morning starts to rise'],
      Subtle: ['Higher through the light', 'The rhythm carries on'],
      Guided: ['The climb stays intact', 'Higher lows remain'],
      Training: ['Bullish trend', 'Higher highs stay intact']
    },
    bearish_trend: {
      Atmospheric: ['The light begins to fall'],
      Subtle: ['Lower through the silence', 'The rhythm carries down'],
      Guided: ['The fall stays intact', 'Lower highs remain'],
      Training: ['Bearish trend', 'Lower lows stay intact']
    },
    session_open_test: {
      Atmospheric: ['The opening line is touched'],
      Subtle: ['The first edge is tested'],
      Guided: ['The opening line is tested'],
      Training: ['The 08:00 open was tested']
    },
    session_open_rejection: {
      Atmospheric: ['The first light turns away'],
      Subtle: ['The opening line refused the move'],
      Guided: ['The opening line pushed back'],
      Training: ['The 08:00 open rejected the move']
    },
    previous_day_high_sweep: {
      Atmospheric: ['The older ceiling bent'],
      Subtle: ['The upper memory was taken'],
      Guided: ['The prior high was swept'],
      Training: ['Previous-day high swept']
    },
    previous_day_low_sweep: {
      Atmospheric: ['The older floor bent'],
      Subtle: ['The lower memory was taken'],
      Guided: ['The prior low was swept'],
      Training: ['Previous-day low swept']
    },
    failed_upper_break: {
      Atmospheric: ['The upper door appears', 'Then falls back quiet'],
      Subtle: ['The upper door opened', 'Then withdrew again'],
      Guided: ['The upper attempt faded', 'And stepped back inside'],
      Training: ['Failed upper break', 'Price returned below the edge']
    },
    failed_lower_break: {
      Atmospheric: ['The lower door appears', 'Then falls back quiet'],
      Subtle: ['The lower door opened', 'Then withdrew again'],
      Guided: ['The lower attempt faded', 'And stepped back inside'],
      Training: ['Failed lower break', 'Price returned above the edge']
    },
    repeated_upper_rejection: {
      Atmospheric: ['The upper edge keeps turning away'],
      Subtle: ['The upper edge will not hold'],
      Guided: ['The upper edge keeps rejecting'],
      Training: ['Repeated upper rejection']
    },
    repeated_lower_rejection: {
      Atmospheric: ['The lower floor keeps turning away'],
      Subtle: ['The lower floor will not hold'],
      Guided: ['The lower floor keeps rejecting'],
      Training: ['Repeated lower rejection']
    },
    two_sided_whipsaw: {
      Atmospheric: ['The centre pulls both sides back'],
      Subtle: ['Around the centre', 'Back and forth again'],
      Guided: ['Both edges pull the morning back', 'The centre does not yield'],
      Training: ['Two-sided whipsaw', 'Alternating fakeouts around VWAP']
    },
    centre_chop: {
      Atmospheric: ['The motion holds its breath', 'The centre does not yield'],
      Subtle: ['Around the centre', 'Back and forth again'],
      Guided: ['The centre will not release', 'The turns keep circling back'],
      Training: ['Centre chop', 'Repeated overlap around VWAP']
    },
    bullish_resolution: {
      Atmospheric: ['The morning rises and keeps rising'],
      Subtle: ['Higher through the light', 'The side is chosen now'],
      Guided: ['The higher path is held', 'The morning chooses up'],
      Training: ['Bullish resolution', 'Higher side confirmed']
    },
    bearish_resolution: {
      Atmospheric: ['The morning sinks and keeps sinking'],
      Subtle: ['Lower through the silence', 'The side is chosen now'],
      Guided: ['The lower path is held', 'The morning chooses down'],
      Training: ['Bearish resolution', 'Lower side confirmed']
    },
    neutral_resolution: {
      Atmospheric: ['The morning settles in the middle'],
      Subtle: ['The centre remains', 'No side owns the close'],
      Guided: ['The centre holds to the end'],
      Training: ['Neutral resolution']
    }
  };

  function seededRandom(seed) {
    const text = String(seed == null ? '' : seed);
    let state = 2166136261;
    for (let i = 0; i < text.length; i++) {
      state ^= text.charCodeAt(i);
      state = Math.imul(state, 16777619);
    }
    return function() {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickLine(type, hintStrength, seed) {
    const set = PHRASES[type] || PHRASES.range;
    const lines = set[hintStrength] || set.Subtle || [''];
    const random = seededRandom(seed + '|' + type + '|' + hintStrength);
    const line = lines[Math.floor(random() * lines.length)] || lines[0] || '';
    return line;
  }

  function generalWhisperLines(hintStrength) {
    if (hintStrength === 'Atmospheric') return ['Watch the open line'];
    if (hintStrength === 'Subtle') return ['Around the centre'];
    if (hintStrength === 'Guided') return ['Wait through the centre'];
    return ['Watch the open price', 'Do not chase the first move'];
  }

  function fingerprintLinesForType(type, hintStrength, seed) {
    const set = PHRASES[type] || PHRASES.range;
    return pickLine(type, hintStrength, seed);
  }

  function pickLyricLines(type, hintStrength, seed, count) {
    const set = PHRASES[type] || PHRASES.range;
    const lines = Array.isArray(set[hintStrength]) ? set[hintStrength].slice() : Array.isArray(set.Subtle) ? set.Subtle.slice() : [''];
    const out = [];
    const seen = new Set();
    const random = seededRandom(String(seed || '') + '|' + String(type || '') + '|' + String(hintStrength || 'Subtle'));
    while (out.length < Math.max(1, count || 1) && lines.length) {
      const index = Math.floor(random() * lines.length);
      const line = String(lines.splice(index, 1)[0] || '').trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
    return out;
  }

  function renderSectionLyrics(sections) {
    return (Array.isArray(sections) ? sections : []).map(function(section) {
      const lines = Array.isArray(section.lines) ? section.lines.slice() : [];
      if (!lines.length && section.instrumentalInstruction) lines.push('[Instrumental] ' + section.instrumentalInstruction);
      return '[' + section.section + ']\n' + lines.join('\n');
    }).join('\n\n');
  }

  function renderLegacyLyrics(entries) {
    const grouped = [];
    let current = null;
    entries.forEach((entry) => {
      if (!current || current.section !== entry.section) {
        current = { section: entry.section, lines: [] };
        grouped.push(current);
      }
      current.lines.push(entry.text);
    });
    return grouped.map((group) => '[' + group.section + ']\n' + group.lines.join('\n')).join('\n\n');
  }

  function legacyTitleSuggestions({ events, classification }) {
    const first = events[0];
    const last = events[events.length - 1];
    const titles = [];
    if (first && /asia_high/.test(first.type)) titles.push('Above the Morning Line');
    else if (first && /asia_low/.test(first.type)) titles.push('Below the Morning Floor');
    else titles.push('Around the Centre');
    if (last && /reclaim|continuation|trend/.test(last.type)) titles.push('The Opening Light Returned');
    else titles.push('The First Break Fades');
    titles.push(classification.finalDirection === 'Bullish' ? 'Higher Through the Light' : classification.finalDirection === 'Bearish' ? 'Lower Through the Silence' : 'Nothing Stayed Above');
    return titles.slice(0, 3);
  }

  function fingerprintTitleSuggestions(fingerprint) {
    const direction = String(fingerprint && fingerprint.resolution && fingerprint.resolution.direction || 'neutral');
    const motifs = Array.isArray(fingerprint && fingerprint.motifs) ? fingerprint.motifs : [];
    const hasWhipsaw = motifs.some(function(motif) { return motif.type === 'two_sided_whipsaw' || motif.type === 'centre_chop'; });
    if (direction === 'bullish') {
      return hasWhipsaw ? ['Morning on the Turn', 'Higher Through the Light', 'Held by the Morning'] : ['Higher Through the Light', 'Held by the Morning', 'The Side We Chose'];
    }
    if (direction === 'bearish') {
      return hasWhipsaw ? ['Morning in Shadow', 'Lower Through the Silence', 'Held by the Quiet'] : ['Lower Through the Silence', 'Held by the Quiet', 'The Side That Held'];
    }
    return hasWhipsaw ? ['Around the Centre', 'Turning Back Again', 'Still in the Middle'] : ['Around the Centre', 'Still in the Middle', 'The Opening Drift'];
  }

  function sectionRoleToDelivery(section, hintStrength) {
    if (section.section === 'Intro') return 'distant whisper';
    if (section.section === 'Instrumental Break') return 'fragmented hush';
    if (section.section === 'Bridge') return hintStrength === 'Training' ? 'clear spoken turn' : 'close whisper';
    if (section.section === 'Final Chorus') return 'settled lead';
    return 'quiet lead';
  }

  function lyricFromMotif(motif, hintStrength, wordingSeed, index) {
    const seed = String(wordingSeed || '0') + '|' + String(motif.id || '') + '|' + String(index);
    return fingerprintLinesForType(motif.type, hintStrength, seed) || pickLine('range', hintStrength, seed);
  }

  function sparseFallbackLines(section, motifs, hintStrength, wordingSeed, sectionIndex) {
    if (section && section.section === 'Instrumental Break') return [];
    const role = String(section && section.section || 'Verse 1');
    const motif = Array.isArray(motifs) && motifs[0] ? motifs[0] : null;
    const type = String(motif && motif.type || '').toLowerCase();
    const seeds = [String(wordingSeed || '0') + '|' + role + '|' + String(sectionIndex || 0), String(wordingSeed || '0') + '|' + role + '|alt|' + String(sectionIndex || 0)];
    const roleLines = {
      Intro: ['The morning opens softly', 'The first move stays quiet'],
      'Verse 1': ['The first turn stays inside', 'The path keeps moving on'],
      'Pre-Chorus': ['The middle gathers now', 'The next turn is near'],
      Chorus: ['The chosen side stays clear', 'The turn holds in the light'],
      'Verse 2': ['The second line keeps moving', 'The story stays in motion'],
      Bridge: ['The middle turns the story', 'The quieter turn holds on'],
      'Final Chorus': ['The chosen side stays clear', 'The ending holds its shape'],
      Outro: ['The last line stays open', 'The morning settles down']
    };
    const motifLines = {
      asia_high_sweep: ['The upper edge gives it back', 'The ceiling does not stay'],
      asia_low_sweep: ['The lower floor gives it back', 'The floor does not stay'],
      bullish_fakeout: ['The first rise returns inside', 'The climb was only a test'],
      bearish_fakeout: ['The first fall returns inside', 'The drop was only a test'],
      bullish_continuation: ['The climb keeps moving on', 'The higher path stays open'],
      bearish_continuation: ['The fall keeps moving on', 'The lower path stays open'],
      bullish_reversal: ['The failed move turns higher', 'The return climbs again'],
      bearish_reversal: ['The failed move turns lower', 'The return falls again'],
      centre_chop: ['The centre keeps circling back', 'The middle will not settle'],
      two_sided_whipsaw: ['Both sides keep circling back', 'The middle will not settle']
    };
    const fallback = (motifLines[type] || roleLines[role] || roleLines.Verse1 || []).slice();
    if (/resolution/.test(type) && role !== 'Outro') fallback.push('The ending holds its shape');
    return fallback.concat(seeds.map(function(seed, index) {
      return pickLine(type || 'range', hintStrength, seed + '|' + index);
    }));
  }

  function buildFingerprintEntries(opts) {
    const fingerprint = opts.fingerprint || (MusicLab.Fingerprint ? MusicLab.Fingerprint.compileFingerprint(opts) : null);
    const sectionPlan = Array.isArray(opts.sectionPlan) ? opts.sectionPlan : fingerprint && fingerprint.sectionPlan ? fingerprint.sectionPlan : [];
    const hintStrength = opts.hintStrength || 'Subtle';
    const wordingSeed = String(opts.wordingSeed || '0');
    const maxLineWords = 18;
    const used = new Set();
    const motifById = new Map((fingerprint && Array.isArray(fingerprint.motifs) ? fingerprint.motifs : []).map(function(motif) { return [String(motif.id), motif]; }));
    const entries = [];
    sectionPlan.forEach(function(section, sectionIndex) {
      const motifIds = Array.isArray(section.motifIds) ? section.motifIds : [];
      const motifs = motifIds.map(function(id) { return motifById.get(String(id)); }).filter(Boolean);
      const lines = [];
      const maxWords = Math.max(12, Number(section.maximumWords) || 15);
      motifs.forEach(function(motif, motifIndex) {
        if (lines.length >= Math.max(2, Number(section.lineCount) || 2)) return;
        const target = Math.max(2, motif.importance >= 0.85 ? 3 : 2);
        const choices = pickLyricLines(motif.type, hintStrength, wordingSeed + '|' + sectionIndex + ':' + motifIndex, target);
        choices.forEach(function(choice) {
          if (lines.length >= Math.max(2, Number(section.lineCount) || 2)) return;
          const text = String(choice || '').trim();
          if (text && !used.has(text) && text.split(/\s+/).length <= maxWords) {
            used.add(text);
            lines.push(text);
          }
        });
      });
      if (!lines.length && section.lyricRequired !== false) {
        const fallback = section.generalRefrain ? generalWhisperLines(hintStrength)[0] : fingerprintLinesForType(motifs[0] && motifs[0].type || 'centre_chop', hintStrength, wordingSeed + '|section|' + sectionIndex);
        if (fallback) lines.push(fallback);
      }
      if (section.lyricRequired !== false && lines.length < Math.max(2, Number(section.lineCount) || 2)) {
        const sparseLines = sparseFallbackLines(section, motifs, hintStrength, wordingSeed, sectionIndex);
        sparseLines.forEach(function(line) {
          if (lines.length >= Math.max(2, Number(section.lineCount) || 2)) return;
          const text = String(line || '').trim();
          if (text && !used.has(text) && text.split(/\s+/).length <= maxWords) {
            used.add(text);
            lines.push(text);
          }
        });
      }
      if (section.lyricRequired === false && section.instrumentalInstruction) {
        lines.splice(0, lines.length, '[Instrumental] ' + section.instrumentalInstruction);
      }
      entries.push({
        section: String(section.section || SECTION_ORDER[0]),
        lines: lines.slice(0, Math.max(2, Number(section.lineCount) || 2)),
        text: lines.join('\n'),
        sourceEventIds: motifIds.reduce(function(list, id) {
          const motif = motifById.get(String(id));
          if (motif) list.push.apply(list, motif.sourceEventIds || []);
          return list;
        }, []),
        motifIds: motifIds.slice(),
        instrumentalInstruction: section.instrumentalInstruction || '',
        delivery: sectionRoleToDelivery(section, hintStrength)
      });
    });
    return entries;
  }

  function fingerprintStylePrompt(opts, fingerprint) {
    const style = opts.customMusicStyle || STYLE_LABELS[opts.musicStyle] || opts.musicStyle || STYLE_LABELS['Dreamy Deep House'];
    const vocals = VOCAL_LABELS[opts.vocalStyle] || opts.vocalStyle || VOCAL_LABELS['Female whisper'];
    const sections = Array.isArray(fingerprint && fingerprint.sectionPlan) ? fingerprint.sectionPlan : [];
    const sectionText = sections.map(function(section) {
      return section.section + ' carries ' + String(section.purpose || '').replace(/\s+/g, ' ').trim() + '.';
    }).join(' ');
    const refinement = String(opts.hintStrength || 'Subtle') === 'Atmospheric'
      ? 'The lyrics should feel airy, indirect, and chronological.'
      : String(opts.hintStrength || 'Subtle') === 'Subtle'
      ? 'The lyrics should stay indirect but still clearly follow the session arc.'
      : String(opts.hintStrength || 'Subtle') === 'Guided'
      ? 'The lyrics may use recognisable trading imagery while keeping the story natural.'
      : 'The lyrics may use explicit trading terms while keeping the story natural.';
    return style + ' Approximately ' + (opts.duration || '4:30') + '. ' + vocals + ' Focus on a clear chronological arc from opening tension to final resolution. ' + sectionText + ' ' + refinement;
  }

  function sectionForIndex(index, total) {
    if (!total) return SECTION_ORDER[0];
    const slot = Math.min(SECTION_ORDER.length - 1, Math.floor(index * SECTION_ORDER.length / Math.max(1, total)));
    return SECTION_ORDER[slot];
  }

  function lineCountTarget(density, totalEvents) {
    if (density === 'Very minimal') return Math.min(4, Math.max(2, totalEvents));
    if (density === 'Moderate') return Math.min(9, Math.max(4, totalEvents + 1));
    return Math.min(7, Math.max(3, totalEvents));
  }

  function buildLines({ events, hintStrength, wordingSeed, includeGeneralWhispers, lyricDensity }) {
    const entries = [];
    const eventList = Array.isArray(events) ? events : [];
    const lineTarget = lineCountTarget(lyricDensity || 'Minimal', eventList.length);
    let eventIndex = 0;
    for (const event of eventList) {
      const section = sectionForIndex(eventIndex, Math.max(1, eventList.length - 1));
      const line = pickLine(event.type, hintStrength, wordingSeed + '|' + event.id + '|' + eventIndex);
      entries.push({ section, text: line, sourceEventIds: [event.id] });
      eventIndex++;
      if (entries.length >= lineTarget) break;
    }
    if (!entries.length) entries.push({ section: 'Intro', text: pickLine('range', hintStrength, wordingSeed + '|empty'), sourceEventIds: [] });
    if (includeGeneralWhispers !== false && entries.length < lineTarget) {
      for (const whisper of generalWhisperLines(hintStrength)) {
        if (entries.length >= lineTarget) break;
        entries.push({ section: entries.length === 1 ? 'Outro' : 'Bridge', text: whisper, sourceEventIds: [] , generalWhisper: true });
      }
    }
    return entries;
  }

  function renderLyrics(entries) {
    return renderLegacyLyrics(entries);
  }

  function stylePrompt({ musicStyle, customMusicStyle, vocalStyle, duration, classification, lyricDensity, hintStrength, events }) {
    const style = customMusicStyle || STYLE_LABELS[musicStyle] || musicStyle || STYLE_LABELS['Dreamy Deep House'];
    const vocals = VOCAL_LABELS[vocalStyle] || vocalStyle || VOCAL_LABELS['Female whisper'];
    const density = lyricDensity || 'Minimal';
    const structure = classification.primaryCondition + '; final direction ' + classification.finalDirection.toLowerCase() + '; ' + classification.secondaryCondition.toLowerCase() + '.';
    const avoid = hintStrength === 'Atmospheric' || hintStrength === 'Subtle'
      ? 'Avoid commercial pop vocals, aggressive festival EDM, large drops, dense lyrics, rap, and obvious financial jargon.'
      : 'Avoid commercial pop vocals, aggressive festival EDM, huge drops, and dense explanations.';
    return style + ' Approximately ' + duration + '. Restraint-first low end, spacious pads, focused percussion and a controlled nocturnal atmosphere. ' + vocals + ' Minimal vocals with long instrumental sections. The musical structure should follow the historical morning session: ' + structure + ' ' + avoid;
  }

  function titleSuggestions(opts) {
    if (opts && opts.fingerprint) return fingerprintTitleSuggestions(opts.fingerprint);
    const events = opts.events || [];
    const classification = opts.classification || { finalDirection: 'Neutral' };
    return legacyTitleSuggestions({ events: events, classification: classification });
  }

  function buildSummary({ events, classification }) {
    if (!events.length) return 'No qualifying morning events were detected.';
    const parts = events.map((event) => {
      const time = event.timestamp.slice(11, 16);
      if (event.endTimestamp && event.endTimestamp !== event.timestamp) {
        const end = event.endTimestamp.slice(11, 16);
        return time + '–' + end + ' — ' + event.description;
      }
      return time + ' — ' + event.description;
    });
    return parts.join('. ') + '. Final direction: ' + classification.finalDirection + '.';
  }

  function mapSections(entries) {
    return entries.map((entry) => ({ section: entry.section, text: entry.text, sourceEventIds: entry.sourceEventIds || [] }));
  }

  function generatePackage(opts) {
    const fingerprint = opts.fingerprint || (opts.sectionPlan ? (MusicLab.Fingerprint ? MusicLab.Fingerprint.compileFingerprint(opts) : null) : null);
    if (fingerprint) {
      const sections = buildFingerprintEntries(Object.assign({}, opts, { fingerprint: fingerprint, sectionPlan: opts.sectionPlan || fingerprint.sectionPlan || [] }));
      const lyrics = renderSectionLyrics(sections);
      return {
        schemaVersion: 'musiclab-song-package-v2',
        titles: titleSuggestions(Object.assign({}, opts, { fingerprint: fingerprint })),
        titleSuggestions: titleSuggestions(Object.assign({}, opts, { fingerprint: fingerprint })),
        stylePrompt: fingerprintStylePrompt(opts, fingerprint),
        sections: sections.map(function(section) {
          return {
            section: section.section,
            motifIds: section.motifIds || [],
            delivery: section.delivery,
            lines: section.lines || [],
            instrumentalInstruction: section.instrumentalInstruction || ''
          };
        }),
        lyrics: lyrics,
        lyricEntries: sections.map(function(section) {
          return {
            section: section.section,
            text: (section.lines || []).join('\n'),
            sourceEventIds: section.sourceEventIds || [],
            motifIds: section.motifIds || [],
            instrumentalInstruction: section.instrumentalInstruction || '',
            delivery: section.delivery
          };
        }),
        fingerprint: fingerprint,
        sectionPlan: fingerprint.sectionPlan || [],
        generationSeed: String(opts.date || '') + '|' + String(opts.instrument || '') + '|' + String(opts.wordingSeed || '0') + '|' + String(opts.musicStyle || '') + '|' + String(opts.vocalStyle || '') + '|' + String(opts.hintStrength || ''),
        wordingSeed: String(opts.wordingSeed || '0')
      };
    }
    const entries = buildLines(opts);
    const lyrics = renderLyrics(entries);
    return {
      schemaVersion: 1,
      lyricEntries: mapSections(entries),
      lyrics,
      stylePrompt: stylePrompt(opts),
      titleSuggestions: titleSuggestions(opts),
      generationSeed: String(opts.date || '') + '|' + String(opts.instrument || '') + '|' + String(opts.wordingSeed || '0') + '|' + String(opts.musicStyle || '') + '|' + String(opts.vocalStyle || '') + '|' + String(opts.hintStrength || ''),
      wordingSeed: String(opts.wordingSeed || '0')
    };
  }

  return {
    SECTION_ORDER,
    STYLE_LABELS,
    VOCAL_LABELS,
    PHRASES,
    pickLine,
    buildLines,
    renderLyrics,
    stylePrompt,
    titleSuggestions,
    buildSummary,
    generatePackage,
    renderSectionLyrics,
    fingerprintStylePrompt,
    buildFingerprintEntries
  };
})();
