'use strict';
window.MusicLab = window.MusicLab || {};

MusicLab.AI = (function() {
  const VERSION = 'musiclab-ai-v1';
  const CONFIG = {
    enabled: true,
    baseUrl: 'http://192.168.0.164:4096',
    model: { providerID: 'openai', modelID: 'gpt-5.4-mini-fast' },
    timeoutMs: 60000,
    promptUrl: '../prompts/opencode-musiclab.txt?v=0.35.87'
  };

  let promptPromise = null;

  function stripMarkdownJsonFence(text) {
    const s = String(text || '').trim();
    if (s.startsWith('```')) {
      const firstNl = s.indexOf('\n');
      const lastFence = s.lastIndexOf('```');
      if (firstNl >= 0 && lastFence > firstNl) return s.slice(firstNl + 1, lastFence).trim();
    }
    return s;
  }

  function safeJsonParse(text) {
    try { return JSON.parse(stripMarkdownJsonFence(text)); }
    catch (error) { return null; }
  }

  function clampText(value, max) {
    const text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return typeof max === 'number' && max > 0 && text.length > max ? text.slice(0, max) : text;
  }

  function sectionOrder() {
    return (MusicLab.Lyrics && Array.isArray(MusicLab.Lyrics.SECTION_ORDER)) ? MusicLab.Lyrics.SECTION_ORDER : ['Intro', 'Verse 1', 'Pre-Chorus', 'Chorus', 'Verse 2', 'Bridge', 'Final Chorus', 'Outro'];
  }

  function uniqueStrings(list, limit, fallback) {
    const out = [];
    const seen = new Set();
    const values = Array.isArray(list) ? list : [];
    for (const value of values) {
      const text = clampText(value, 180);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= limit) break;
    }
    if (!out.length && Array.isArray(fallback)) return fallback.slice(0, limit);
    while (out.length < limit && Array.isArray(fallback) && fallback[out.length]) out.push(fallback[out.length]);
    return out.slice(0, limit);
  }

  function eventSpanText(event) {
    const start = event && event.timestamp ? String(event.timestamp).slice(11, 16) : '??:??';
    const end = event && event.endTimestamp ? String(event.endTimestamp).slice(11, 16) : null;
    const label = event && event.description ? event.description : String(event && event.type ? event.type.replace(/_/g, ' ') : 'event');
    return end ? start + '–' + end + ' ' + label : start + ' ' + label;
  }

  function clampWords(text, maxWords) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    return words.length > maxWords ? words.slice(0, maxWords).join(' ') : words.join(' ');
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function looksLikeDetectorSummary(text) {
    const s = String(text || '').trim().toLowerCase();
    if (!s) return true;
    return /\b(repeated|failed|breakout|rejection|whipsaw|accepted|asia high|asia low|vwap|open|sweep|reclaim|fakeout|test|break|level)\b/.test(s) || /^\s*(two sided|repeated|failed|asia|vwap|open|bullish|bearish)/.test(s);
  }

  function normalizeLyricEntries(entries, fallbackEntries) {
    const allowed = new Set(sectionOrder());
    const source = Array.isArray(entries) ? entries : [];
    const fallback = Array.isArray(fallbackEntries) ? fallbackEntries : [];
    const out = [];
    for (let i = 0; i < source.length; i++) {
      const entry = source[i] || {};
      const fallbackEntry = fallback[i] || fallback[0] || { section: 'Intro', text: '', sourceEventIds: [] };
      const section = allowed.has(String(entry.section || '')) ? String(entry.section) : String(fallbackEntry.section || 'Intro');
      const text = clampText(entry.text != null ? entry.text : fallbackEntry.text, 500);
      const ids = Array.isArray(entry.sourceEventIds) ? entry.sourceEventIds : Array.isArray(fallbackEntry.sourceEventIds) ? fallbackEntry.sourceEventIds : [];
      out.push({
        section: section,
        text: text,
        sourceEventIds: ids.map(function(id) { return String(id); }).filter(Boolean)
      });
    }
    return out.length ? out : fallback.map(function(entry) {
      return {
        section: String(entry.section || 'Intro'),
        text: clampText(entry.text, 500),
        sourceEventIds: Array.isArray(entry.sourceEventIds) ? entry.sourceEventIds.map(function(id) { return String(id); }).filter(Boolean) : []
      };
    });
  }

  function eventSummary(event) {
    const start = event && event.timestamp ? String(event.timestamp).slice(11, 16) : '??:??';
    const end = event && event.endTimestamp ? String(event.endTimestamp).slice(11, 16) : null;
    const label = event && event.description ? event.description : String(event && event.type ? event.type.replace(/_/g, ' ') : 'event');
    return end ? start + '–' + end + ' ' + label : start + ' ' + label;
  }

  function buildSessionArc(analysis, fingerprint) {
    const events = Array.isArray(analysis && analysis.songEvents) ? analysis.songEvents : [];
    if (!events.length) return 'No qualifying morning events were detected.';
    const motifs = Array.isArray(fingerprint && fingerprint.motifs) ? fingerprint.motifs : [];
    const first = events[0];
    const last = events[events.length - 1];
    const keyMotifs = motifs.slice(0, 3).map(function(motif) { return motif.type.replace(/_/g, ' '); });
    const parts = [eventSpanText(first)];
    if (keyMotifs.length) parts.push(keyMotifs.join(', '));
    if (last && last !== first) parts.push(eventSpanText(last));
    const direction = fingerprint && fingerprint.resolution ? String(fingerprint.resolution.direction || 'neutral') : (analysis && analysis.classification && analysis.classification.finalDirection ? String(analysis.classification.finalDirection).toLowerCase() : 'neutral');
    return 'Morning arc: ' + parts.join(' -> ') + '. Final direction: ' + direction + '.';
  }

  function buildFallbackPackage(analysis, opts) {
    const fingerprint = analysis && analysis.fingerprint ? analysis.fingerprint : (MusicLab.Fingerprint ? MusicLab.Fingerprint.compileFingerprint({
      events: analysis.songEvents,
      classification: analysis.classification,
      levels: analysis.levels,
      duration: opts.duration || '4:30',
      hintStrength: opts.hintStrength || 'Subtle',
      musicStyle: opts.musicStyle || 'Dreamy Deep House',
      vocalStyle: opts.vocalStyle || 'Female whisper',
      wordingSeed: String(opts.wordingSeed || '0')
    }) : null);
    const packageData = MusicLab.Lyrics.generatePackage({
      instrument: analysis.instrument,
      date: analysis.date,
      events: analysis.songEvents,
      levels: analysis.levels,
      classification: analysis.classification,
      sensitivity: opts.sensitivity || 'Balanced',
      hintStrength: opts.hintStrength || 'Subtle',
      musicStyle: opts.musicStyle || 'Dreamy Deep House',
      customMusicStyle: opts.customMusicStyle || null,
      vocalStyle: opts.vocalStyle || 'Female whisper',
      duration: opts.duration || '4:30',
      maximumEvents: opts.maximumEvents || 8,
      wordingSeed: String(opts.wordingSeed || '0'),
      includeGeneralWhispers: opts.includeGeneralWhispers !== false,
      fingerprint: fingerprint,
      sectionPlan: fingerprint ? fingerprint.sectionPlan : null
    });
    return {
      schemaVersion: packageData.schemaVersion || (fingerprint ? 'musiclab-song-package-v2' : 1),
      state: opts.enabled === false ? 'disabled' : 'fallback',
      source: 'deterministic',
      mode: opts.mode || 'generate',
      sessionArc: buildSessionArc(analysis, fingerprint),
      titles: Array.isArray(packageData.titles) ? packageData.titles.slice(0, 3) : Array.isArray(packageData.titleSuggestions) ? packageData.titleSuggestions.slice(0, 3) : [],
      titleSuggestions: Array.isArray(packageData.titleSuggestions) ? packageData.titleSuggestions.slice(0, 3) : Array.isArray(packageData.titles) ? packageData.titles.slice(0, 3) : [],
      stylePrompt: packageData.stylePrompt,
      lyrics: packageData.lyrics,
      lyricEntries: packageData.lyricEntries,
      sections: Array.isArray(packageData.sections) ? packageData.sections.slice() : [],
      fingerprint: fingerprint,
      sectionPlan: fingerprint ? fingerprint.sectionPlan : [],
      generationSeed: packageData.generationSeed,
      wordingSeed: packageData.wordingSeed,
      debug: {
        reason: opts.enabled === false ? 'AI disabled' : 'OpenCode unavailable'
      }
    };
  }

  function buildVerifiedPayload(analysis, opts, fallbackPackage) {
    const q = analysis.dataQuality || {};
    const fingerprint = analysis.fingerprint || (MusicLab.Fingerprint ? MusicLab.Fingerprint.compileFingerprint({
      events: analysis.songEvents,
      classification: analysis.classification,
      levels: analysis.levels,
      duration: opts.duration || '4:30',
      hintStrength: opts.hintStrength || 'Subtle',
      musicStyle: opts.musicStyle || 'Dreamy Deep House',
      vocalStyle: opts.vocalStyle || 'Female whisper',
      wordingSeed: String(opts.wordingSeed || '0')
    }) : null);
    const sectionPlan = fingerprint ? fingerprint.sectionPlan : [];
    return {
      schemaVersion: 'musiclab-song-package-v2',
      requestType: 'musiclab-song-package',
      mode: opts.mode || 'generate',
      generatedAt: new Date().toISOString(),
      instrument: analysis.instrument,
      date: analysis.date,
      timezone: analysis.timezone,
      source: analysis.source,
      detectorVersion: analysis.detectorVersion,
      dataQuality: {
        expectedCandles: q.expectedCandles,
        loadedCandles: q.loadedCandles,
        completeness: q.completeness,
        warnings: Array.isArray(q.warnings) ? q.warnings.slice() : []
      },
      levels: analysis.levels,
      detectorConfiguration: analysis.detectorConfiguration,
      metrics: analysis.metrics,
      classification: analysis.classification,
      morningSummary: analysis.morningSummary,
      timeRange: analysis.timeRange,
      warnings: Array.isArray(analysis.warnings) ? analysis.warnings.slice() : [],
      songEvents: (analysis.songEvents || []).map(function(event) {
        return {
          id: event.id,
          type: event.type,
          timestamp: event.timestamp,
          endTimestamp: event.endTimestamp,
          direction: event.direction,
          price: event.price,
          levelName: event.levelName,
          levelPrice: event.levelPrice,
          confidence: event.confidence,
          importance: event.importance,
          description: event.description,
          evidence: event.evidence
        };
      }),
      fingerprint: fingerprint,
      sectionPlan: sectionPlan,
      motifOverrides: cloneJson(analysis.motifOverrides || {}),
      userPreferences: {
        sensitivity: opts.sensitivity || 'Balanced',
        hintStrength: opts.hintStrength || 'Subtle',
        musicStyle: opts.musicStyle || 'Dreamy Deep House',
        customMusicStyle: opts.customMusicStyle || null,
        vocalStyle: opts.vocalStyle || 'Female whisper',
        duration: opts.duration || '4:30',
        maximumEvents: opts.maximumEvents || 8,
        includeGeneralWhispers: opts.includeGeneralWhispers !== false,
        wordingSeed: String(opts.wordingSeed || '0')
      },
      lyricSlots: (sectionPlan || []).map(function(section) {
        return {
          section: section.section,
          motifIds: Array.isArray(section.motifIds) ? section.motifIds.slice() : [],
          purpose: section.purpose,
          lineCount: section.lineCount,
          maximumWords: section.maximumWords,
          requiredContrast: !!section.requiredContrast,
          generalRefrain: !!section.generalRefrain,
          bannedPhrases: Array.isArray(section.bannedPhrases) ? section.bannedPhrases.slice() : [],
          lyricRequired: section.lyricRequired !== false,
          sectionTagInstruction: section.sectionTagInstruction,
          energy: section.energy
        };
      }),
      deterministicPackage: {
        sessionArc: buildSessionArc(analysis, fingerprint),
        titleSuggestions: fallbackPackage.titleSuggestions,
        titles: fallbackPackage.titles,
        stylePrompt: fallbackPackage.stylePrompt,
        lyrics: fallbackPackage.lyrics,
        lyricEntries: fallbackPackage.lyricEntries,
        sections: fallbackPackage.sections,
        sectionPlan: fallbackPackage.sectionPlan,
        fingerprint: fallbackPackage.fingerprint
      }
    };
  }

  function buildPrompt(template, payload) {
    const json = JSON.stringify(payload, null, 2);
    const source = String(template || '');
    return source.indexOf('{{verifiedPayload}}') >= 0 ? source.replace('{{verifiedPayload}}', json) : source + '\n\nVerified payload:\n\n' + json;
  }

  function normalizeSections(sections, fallbackSections) {
    const allowed = new Set(sectionOrder());
    const source = Array.isArray(sections) ? sections : [];
    const fallback = Array.isArray(fallbackSections) ? fallbackSections : [];
    const out = [];
    for (let i = 0; i < source.length; i++) {
      const entry = source[i] || {};
      const fallbackEntry = fallback[i] || fallback[0] || { section: 'Intro', lines: [], motifIds: [], instrumentalInstruction: '' };
      const section = allowed.has(String(entry.section || '')) ? String(entry.section) : String(fallbackEntry.section || 'Intro');
      const motifIds = uniqueStrings(entry.motifIds, 6, fallbackEntry.motifIds || []);
      const lines = uniqueStrings(entry.lines, 6, fallbackEntry.lines || []);
      out.push({
        section: section,
        motifIds: motifIds,
        delivery: clampText(entry.delivery != null ? entry.delivery : fallbackEntry.delivery || '', 80),
        lines: lines,
        instrumentalInstruction: clampText(entry.instrumentalInstruction != null ? entry.instrumentalInstruction : fallbackEntry.instrumentalInstruction || '', 300)
      });
    }
    return out.length ? out : fallback.map(function(entry) {
      return {
        section: String(entry.section || 'Intro'),
        motifIds: Array.isArray(entry.motifIds) ? entry.motifIds.slice() : [],
        delivery: clampText(entry.delivery || '', 80),
        lines: Array.isArray(entry.lines) ? entry.lines.slice() : [],
        instrumentalInstruction: clampText(entry.instrumentalInstruction || '', 300)
      };
    });
  }

  function validatePackage(raw, fingerprint, sectionPlan, hintStrength) {
    const issues = [];
    const titles = Array.isArray(raw && (raw.titles || raw.titleSuggestions)) ? (raw.titles || raw.titleSuggestions) : [];
    const sections = Array.isArray(raw && raw.sections) ? raw.sections : [];
    const motifs = new Map(Array.isArray(fingerprint && fingerprint.motifs) ? fingerprint.motifs.map(function(motif) { return [String(motif.id), motif]; }) : []);
    const expectedSections = Array.isArray(sectionPlan) ? sectionPlan.map(function(section) { return section.section; }) : [];
    const lines = [];
    const finalDirection = fingerprint && fingerprint.resolution ? String(fingerprint.resolution.direction || 'neutral') : 'neutral';
    if (titles.some(looksLikeDetectorSummary)) issues.push('detector_summary_title');
    sections.forEach(function(section, index) {
      if (expectedSections[index] && String(section.section) !== String(expectedSections[index])) issues.push('section_order_mismatch');
      const ids = Array.isArray(section.motifIds) ? section.motifIds : [];
      ids.forEach(function(id) { if (!motifs.has(String(id))) issues.push('unknown_motif:' + String(id)); });
      const sectionLines = Array.isArray(section.lines) ? section.lines.map(function(line) { return String(line || '').trim(); }).filter(Boolean) : [];
      if (section.section === 'Instrumental Break' && sectionLines.length) issues.push('instrumental_contains_lyrics');
      if (section.lyricRequired !== false && section.section !== 'Instrumental Break' && sectionLines.length < 2) issues.push('two_line_block_missing:' + section.section);
      sectionLines.forEach(function(line) {
        lines.push(line);
        const words = line.split(/\s+/).filter(Boolean).length;
        if (words > 10) issues.push('line_too_long');
        if (words < 3) issues.push('line_too_short');
      });
      if ((section.section === 'Final Chorus' || section.section === 'Outro') && finalDirection !== 'neutral' && !sectionLines.length && !String(section.instrumentalInstruction || '').trim()) issues.push('missing_final_resolution_lyrics');
    });
    const uniqueLines = new Set();
    const duplicates = [];
    lines.forEach(function(line) {
      if (!line) return;
      const lowered = line.toLowerCase();
      if (uniqueLines.has(lowered)) duplicates.push(line);
      else uniqueLines.add(lowered);
    });
    if (duplicates.length) issues.push('duplicate_lines');
    const joined = lines.join(' \n ');
    const joinedLower = joined.toLowerCase();
    ['The break looked certain', 'Then folded into silence', 'But nothing stayed above'].forEach(function(phrase) {
      if (joinedLower.indexOf(phrase.toLowerCase()) >= 0) issues.push('overused_phrase:' + phrase);
    });
    if (hintStrength === 'Atmospheric' || hintStrength === 'Subtle') {
      ['Asia High', 'Asia Low', 'VWAP', '08:00', 'fakeout', 'sweep', 'reversal', '$', ':'].forEach(function(term) {
        if (joinedLower.indexOf(term.toLowerCase()) >= 0) issues.push('restricted_term:' + term);
      });
    }
    const hasFinal = sections.some(function(section) { return section.section === 'Final Chorus' || section.section === 'Outro'; });
    if (!hasFinal) issues.push('missing_final_resolution');
    if (Array.isArray(fingerprint && fingerprint.motifs) && fingerprint.motifs.filter(function(m) { return (m.importance || 0) >= 0.65; }).length >= 3) {
      if (lines.filter(function(line) { return /centre|upper|lower|vwap|asia|open|fakeout|sweep|reversal/i.test(line); }).length < 2) issues.push('insufficient_session_specific_concepts');
    }
    if (finalDirection !== 'neutral' && !/final chorus|outro/i.test(JSON.stringify(sections))) issues.push('missing_final_resolution');
    const stylePrompt = String(raw && raw.stylePrompt || '');
    if (/motif-\d{3}|sourceEventIds|keep the phrase tied|avoid generic filler|OpenCode|detector|verified payload/i.test(stylePrompt)) issues.push('style_prompt_leak');
    return issues;
  }

  async function loadPromptTemplate() {
    if (!promptPromise) {
      promptPromise = fetch(CONFIG.promptUrl, { method: 'GET', mode: 'cors' }).then(function(response) {
        if (!response.ok) throw new Error('prompt_' + response.status);
        return response.text();
      }).catch(function(error) {
        promptPromise = null;
        throw error;
      });
    }
    return promptPromise;
  }

  class OpenCodeLanMusicLabProvider {
    constructor(cfg) {
      this.cfg = cfg || CONFIG;
    }

    async healthCheck(signal) {
      const response = await fetch(this.cfg.baseUrl + '/global/health', { method: 'GET', signal: signal, mode: 'cors' });
      if (!response.ok) throw new Error('health_' + response.status);
      return response.json();
    }

    async createSession(title, signal) {
      const response = await fetch(this.cfg.baseUrl + '/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title }),
        signal: signal,
        mode: 'cors'
      });
      if (!response.ok) throw new Error('session_' + response.status);
      return response.json();
    }

    async sendMessage(sessionId, prompt, signal) {
      const response = await fetch(this.cfg.baseUrl + '/session/' + encodeURIComponent(sessionId) + '/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.cfg.model, parts: [{ type: 'text', text: prompt }] }),
        signal: signal,
        mode: 'cors'
      });
      if (!response.ok) throw new Error('message_' + response.status);
      return response.json();
    }

    extractText(response) {
      const parts = Array.isArray(response && response.parts) ? response.parts : [];
      return parts.filter(function(part) { return part && part.type === 'text' && typeof part.text === 'string'; }).map(function(part) { return part.text; }).join('\n').trim();
    }
  }

  function normalizeResponse(raw, fallbackPackage, analysis) {
    if (!raw || typeof raw !== 'object') return fallbackPackage;
    const fingerprint = raw.fingerprint || fallbackPackage.fingerprint || analysis.fingerprint || null;
    const sectionPlan = Array.isArray(raw.sectionPlan) ? raw.sectionPlan : fallbackPackage.sectionPlan || (fingerprint ? fingerprint.sectionPlan : []);
    const sections = normalizeSections(raw.sections, fallbackPackage.sections);
    const validationIssues = validatePackage(raw, fingerprint, sectionPlan, analysis && analysis.hintStrength ? analysis.hintStrength : 'Subtle');
    if (validationIssues.length) {
      const rejected = cloneJson(fallbackPackage);
      rejected.debug = Object.assign({}, rejected.debug || {}, { validationIssues: validationIssues, rejected: true });
      return rejected;
    }
    const sessionArc = clampText(raw.sessionArc != null ? raw.sessionArc : fallbackPackage.sessionArc, 800);
    const titles = uniqueStrings((raw.titles || raw.titleSuggestions || []).filter(function(title) { return !looksLikeDetectorSummary(title); }), 3, fallbackPackage.titles || fallbackPackage.titleSuggestions);
    const stylePrompt = clampText(raw.stylePrompt != null ? raw.stylePrompt : fallbackPackage.stylePrompt, 2400);
    const lyrics = clampText(raw.lyrics != null ? raw.lyrics : fallbackPackage.lyrics, 6000);
    const lyricEntries = Array.isArray(sections) && sections.length ? sections.map(function(section) {
      return {
        section: section.section,
        text: Array.isArray(section.lines) ? section.lines.join('\n') : '',
        sourceEventIds: Array.isArray(section.motifIds) ? section.motifIds.slice() : [],
        motifIds: Array.isArray(section.motifIds) ? section.motifIds.slice() : [],
        instrumentalInstruction: section.instrumentalInstruction || '',
        delivery: section.delivery || ''
      };
    }) : normalizeLyricEntries(raw.lyricEntries, fallbackPackage.lyricEntries);
    return {
      schemaVersion: 'musiclab-song-package-v2',
      state: 'ok',
      source: 'opencode',
      mode: raw.mode || fallbackPackage.mode || 'generate',
      sessionArc: sessionArc || buildSessionArc(analysis),
      titles: titles,
      titleSuggestions: titles,
      stylePrompt: stylePrompt,
      lyrics: lyrics,
      lyricEntries: lyricEntries,
      sections: sections,
      fingerprint: fingerprint,
      sectionPlan: sectionPlan,
      generationSeed: String(raw.generationSeed || fallbackPackage.generationSeed || ''),
      wordingSeed: String(raw.wordingSeed || fallbackPackage.wordingSeed || '0'),
      debug: {
        validated: true,
        validationIssues: []
      }
    };
  }

  async function generateSongPackage(input) {
    const opts = input || {};
    const analysis = opts.analysis || {};
    const enabled = opts.enabled !== false && CONFIG.enabled !== false;
    const fallbackPackage = buildFallbackPackage(analysis, opts);
    if (!enabled) return fallbackPackage;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : { signal: null, abort: function() {} };
    const timeout = typeof setTimeout === 'function' ? setTimeout(function() { if (controller && typeof controller.abort === 'function') controller.abort(new Error('timeout')); }, CONFIG.timeoutMs) : null;
    const debug = { model: CONFIG.model, mode: opts.mode || 'generate' };
    try {
      const provider = new OpenCodeLanMusicLabProvider(CONFIG);
      await provider.healthCheck(controller.signal);
      const sessionTitle = 'Game Trader MusicLab: ' + String(analysis.instrument || 'unknown') + ' ' + String(analysis.date || 'unknown');
      const session = await provider.createSession(sessionTitle, controller.signal);
      const promptTemplate = await loadPromptTemplate();
      const verifiedPayload = buildVerifiedPayload(analysis, opts, fallbackPackage);
      const prompt = buildPrompt(promptTemplate, verifiedPayload);
      debug.promptChars = prompt.length;
      const response = await provider.sendMessage(session.sessionId || session.id || session.sid, prompt, controller.signal);
      const rawText = provider.extractText(response);
      const parsed = safeJsonParse(rawText);
      const normalised = normalizeResponse(parsed, fallbackPackage, analysis);
      const rejected = !!(normalised && normalised.debug && normalised.debug.rejected);
      return {
        schemaVersion: normalised.schemaVersion || fallbackPackage.schemaVersion || 'musiclab-song-package-v2',
        state: parsed && !rejected ? 'ok' : 'fallback',
        source: parsed && !rejected ? 'opencode' : 'deterministic',
        mode: opts.mode || 'generate',
        sessionArc: normalised.sessionArc,
        titles: normalised.titles || normalised.titleSuggestions,
        titleSuggestions: normalised.titleSuggestions,
        stylePrompt: normalised.stylePrompt,
        lyrics: normalised.lyrics,
        lyricEntries: normalised.lyricEntries,
        sections: normalised.sections || [],
        fingerprint: normalised.fingerprint || fallbackPackage.fingerprint || null,
        sectionPlan: normalised.sectionPlan || fallbackPackage.sectionPlan || [],
        generationSeed: normalised.generationSeed || fallbackPackage.generationSeed,
        wordingSeed: normalised.wordingSeed || fallbackPackage.wordingSeed,
        sessionId: session.sessionId || session.id || session.sid || null,
        model: CONFIG.model.modelID,
        rawText: rawText,
        debug: Object.assign({}, debug, {
          responseChars: rawText.length,
          parsed: !!parsed,
          fallbackReason: parsed ? (rejected ? 'validation_failed' : null) : 'invalid_json',
          validationIssues: normalised && normalised.debug ? normalised.debug.validationIssues || [] : []
        })
      };
    } catch (error) {
      return Object.assign({}, fallbackPackage, {
        error: String(error && error.message || error),
        debug: Object.assign({}, fallbackPackage.debug || {}, debug, { error: String(error && error.message || error) })
      });
    } finally {
      if (timeout && typeof clearTimeout === 'function') clearTimeout(timeout);
    }
  }

  return {
    VERSION: VERSION,
    CONFIG: CONFIG,
    safeJsonParse: safeJsonParse,
    stripMarkdownJsonFence: stripMarkdownJsonFence,
    loadPromptTemplate: loadPromptTemplate,
    buildPrompt: buildPrompt,
    buildVerifiedPayload: buildVerifiedPayload,
    buildFallbackPackage: buildFallbackPackage,
    normalizeResponse: normalizeResponse,
    generateSongPackage: generateSongPackage,
    OpenCodeLanMusicLabProvider: OpenCodeLanMusicLabProvider
  };
})();
