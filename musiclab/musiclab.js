'use strict';
window.MusicLab = window.MusicLab || {};

MusicLab.App = (function() {
  const INSTRUMENT_OPTIONS = ['DE40', 'USTEC', 'XAUUSD'];
  const STORAGE_KEY = 'gt_musiclab_state_v1';
  let state = {
    instrument: 'DE40',
    date: '',
    startTime: '08:00',
    endTime: '11:00',
    timezone: 'Europe/London',
    sensitivity: 'Balanced',
    hintStrength: 'Subtle',
    musicStyle: 'Dreamy Deep House',
    vocalStyle: 'Female whisper',
    duration: '4:30',
    maximumEvents: 8,
    wordingSeed: '0',
    includeGeneralWhispers: true,
    analysis: null,
    selectedEventId: null,
    dataLoaded: false,
    dates: [],
    loading: false,
    warningAck: false,
    aiEnabled: true,
    aiDebug: false,
    aiLoading: false,
    aiPackage: null,
    motifOverrides: {}
  };
  let canvas = null;
  let ctx = null;
  let resizeObserver = null;
  let pointer = { hoverX: -1, hoverY: -1 };

  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>"]/g, function(ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]; }); }
  function formatPrice(value, precision) { return Number.isFinite(Number(value)) ? Number(value).toFixed(precision == null ? 1 : precision) : '-'; }
  function isFinitePrice(value) { return Number.isFinite(Number(value)); }
  function formatChartTime(timestampSeconds) {
    if (MusicLab.Detector && typeof MusicLab.Detector.londonIso === 'function') return MusicLab.Detector.londonIso(timestampSeconds).slice(11, 16);
    return new Date(Number(timestampSeconds) * 1000).toISOString().slice(11, 16);
  }

  function readStorage() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
       if (parsed && typeof parsed === 'object') state = Object.assign(state, parsed);
       if (!state.motifOverrides || typeof state.motifOverrides !== 'object') state.motifOverrides = {};
    } catch (error) {}
  }
  function writeStorage() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ instrument: state.instrument, startTime: state.startTime, endTime: state.endTime, sensitivity: state.sensitivity, hintStrength: state.hintStrength, musicStyle: state.musicStyle, vocalStyle: state.vocalStyle, duration: state.duration, maximumEvents: state.maximumEvents, wordingSeed: state.wordingSeed, includeGeneralWhispers: state.includeGeneralWhispers, aiEnabled: state.aiEnabled, aiDebug: state.aiDebug, motifOverrides: state.motifOverrides })); } catch (error) {}
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function getAdjustedAnalysis() {
    if (!state.analysis) return null;
    const analysis = cloneJson(state.analysis);
    analysis.motifOverrides = cloneJson(state.motifOverrides || {});
    if (!analysis.fingerprint && MusicLab.Fingerprint && typeof MusicLab.Fingerprint.compileFingerprint === 'function') {
      analysis.fingerprint = MusicLab.Fingerprint.compileFingerprint({
        events: analysis.songEvents,
        classification: analysis.classification,
        levels: analysis.levels,
        duration: analysis.duration || state.duration,
        hintStrength: state.hintStrength,
        musicStyle: state.musicStyle,
        vocalStyle: state.vocalStyle,
        wordingSeed: state.wordingSeed
      });
      analysis.sectionPlan = analysis.fingerprint.sectionPlan || [];
      analysis.sessionInfusion = analysis.fingerprint.infusion || null;
    }
    if (analysis.fingerprint && MusicLab.Fingerprint && typeof MusicLab.Fingerprint.applyOverrides === 'function') {
      analysis.fingerprint = MusicLab.Fingerprint.applyOverrides(analysis.fingerprint, analysis, state.motifOverrides || {});
      analysis.sectionPlan = analysis.fingerprint.sectionPlan || analysis.sectionPlan || [];
      analysis.sessionInfusion = analysis.fingerprint.infusion || analysis.sessionInfusion || null;
    }
    return analysis;
  }

  function updateStatus(message, kind) {
    const el = $('mlLoadState');
    if (!el) return;
    el.className = 'blDataStatus' + (kind ? ' ' + kind : '');
    el.textContent = message;
  }

  function setButtonEnabled() {
    const btn = $('mlAnalyseBtn');
    if (!btn) return;
    btn.disabled = !state.date || state.loading || !state.dataLoaded;
    setAiButtonEnabled();
  }

  function setAiButtonEnabled() {
    const canRun = !!state.analysis && !state.loading && !state.aiLoading;
    const generate = $('mlAiGenerate');
    const retry = $('mlAiRetry');
    const reword = $('mlAiReword');
    const copyStyle = $('mlAiCopyStyle');
    const copyLyrics = $('mlAiCopyLyrics');
    const copyPackage = $('mlAiCopyPackage');
    if (generate) generate.disabled = !canRun;
    if (retry) retry.disabled = !canRun || !state.aiPackage;
    if (reword) reword.disabled = !canRun;
    if (copyStyle) copyStyle.disabled = !state.aiPackage;
    if (copyLyrics) copyLyrics.disabled = !state.aiPackage;
    if (copyPackage) copyPackage.disabled = !state.aiPackage;
  }

  function populateInstruments() {
    const select = $('mlInstrument');
    if (!select) return;
    select.innerHTML = INSTRUMENT_OPTIONS.map(function(option) { return '<option value="' + option + '"' + (option === state.instrument ? ' selected' : '') + '>' + option + '</option>'; }).join('');
  }

  function populateDates() {
    const input = $('mlDate');
    if (!input) return;
    const dates = state.dates.slice();
    if (dates.length) {
      input.min = dates[0];
      input.max = dates[dates.length - 1];
      if (state.date && dates.indexOf(state.date) < 0) state.date = '';
    }
    input.value = state.date || '';
  }

  async function loadInstrumentData() {
    state.loading = true;
    setButtonEnabled();
    updateStatus('Loading ' + state.instrument + ' market data...', '');
    try {
      await BotLab.MarketData.loadInstrument(state.instrument.toLowerCase());
      state.dates = BotLab.MarketData.getAvailableDates(state.instrument.toLowerCase());
      state.dataLoaded = !!state.dates.length;
      const source = BotLab.MarketData.getSource(state.instrument.toLowerCase()) || 'candle API';
      updateStatus((state.dates.length ? 'Loaded ' + state.instrument + ' coverage: ' + state.dates[0] + ' to ' + state.dates[state.dates.length - 1] + '. ' : 'No dates returned. ') + 'Source: ' + source + '.', state.dates.length ? 'isReady' : 'isError');
      if (!state.date && state.dates.length) state.date = state.dates[state.dates.length - 1];
      if (state.date && state.dates.indexOf(state.date) < 0) state.date = state.dates[state.dates.length - 1] || '';
      populateDates();
    } catch (error) {
      state.dataLoaded = false;
      state.dates = [];
      updateStatus(error.message || 'Could not load market data.', 'isError');
    }
    state.loading = false;
    setButtonEnabled();
  }

  function bindControls() {
    $('mlInstrument').addEventListener('change', async function(event) {
      state.instrument = event.target.value;
      state.motifOverrides = {};
      writeStorage();
      state.date = '';
      populateDates();
      await loadInstrumentData();
    });
    $('mlDate').addEventListener('change', function(event) {
      state.date = event.target.value;
      writeStorage();
      setButtonEnabled();
    });
    ['mlStartTime', 'mlEndTime', 'mlSensitivity', 'mlHintStrength', 'mlMusicStyle', 'mlVocalStyle', 'mlDuration', 'mlMaxEvents'].forEach(function(id) {
      const element = $(id);
      if (!element) return;
      element.addEventListener('change', function(event) {
        if (id === 'mlStartTime') state.startTime = event.target.value;
        else if (id === 'mlEndTime') state.endTime = event.target.value;
        else if (id === 'mlSensitivity') state.sensitivity = event.target.value;
        else if (id === 'mlHintStrength') state.hintStrength = event.target.value;
        else if (id === 'mlMusicStyle') state.musicStyle = event.target.value;
        else if (id === 'mlVocalStyle') state.vocalStyle = event.target.value;
        else if (id === 'mlDuration') state.duration = event.target.value;
        else if (id === 'mlMaxEvents') state.maximumEvents = clampNumber(event.target.value, 3, 10, 8);
        writeStorage();
      });
    });
    $('mlAnalyseBtn').addEventListener('click', analyseMorning);
    $('mlResetBtn').addEventListener('click', resetPage);
    $('mlRegenerate').addEventListener('click', regenerateWording);
    $('mlAiGenerate').addEventListener('click', function() { generateAiSongPackage('generate'); });
    $('mlAiRetry').addEventListener('click', function() { generateAiSongPackage('retry'); });
    $('mlAiReword').addEventListener('click', function() { generateAiSongPackage('reword'); });
    $('mlAiEnabled').addEventListener('change', function(event) { state.aiEnabled = !!event.target.checked; writeStorage(); renderAiPanels(); });
    $('mlAiDebugToggle').addEventListener('change', function(event) { state.aiDebug = !!event.target.checked; writeStorage(); renderAiPanels(); });
    $('mlDownload').addEventListener('click', downloadAnalysisJson);
    $('mlCopySummary').addEventListener('click', function() { copyText(renderSummaryText()); });
    $('mlCopyTimeline').addEventListener('click', function() { copyText(renderTimelineText()); });
    $('mlCopyStyle').addEventListener('click', function() { copyText(state.analysis ? state.analysis.sunoStylePrompt : ''); });
    $('mlCopyLyrics').addEventListener('click', function() { copyText(state.analysis ? state.analysis.sunoLyrics : ''); });
    $('mlCopyPackage').addEventListener('click', function() { copyText(renderCompletePackage()); });
    $('mlAiCopyStyle').addEventListener('click', function() { copyText(renderAiStyleText()); });
    $('mlAiCopyLyrics').addEventListener('click', function() { copyText(renderAiLyricsText()); });
    $('mlAiCopyPackage').addEventListener('click', function() { copyText(renderAiPackageText()); });
    const motifReview = $('mlMotifReview');
    if (motifReview) {
      motifReview.addEventListener('click', function(event) {
        const button = event.target && event.target.closest ? event.target.closest('button[data-motif-action]') : null;
        if (!button || !state.analysis || !state.analysis.fingerprint) return;
        const motifId = button.getAttribute('data-motif-id');
        const action = button.getAttribute('data-motif-action');
        const current = state.motifOverrides[motifId] || {};
        const next = Object.assign({}, current);
        if (action === 'toggle-include') next.included = current.included === false ? true : false;
        if (action === 'toggle-dominant') next.dominant = !current.dominant;
        if (action === 'toggle-split') next.split = !current.split;
        state.motifOverrides[motifId] = next;
        writeStorage();
        renderStatusPanels();
      });
    }
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function renderStatusPanels() {
    const data = state.analysis;
    if (!data) {
      $('mlDataStatus').innerHTML = '<div class="mlStat"><div class="k">Instrument</div><div class="v">' + escapeHtml(state.instrument) + '</div></div><div class="mlStat"><div class="k">Date</div><div class="v">' + escapeHtml(state.date || '-') + '</div></div>';
      $('mlClassification').innerHTML = '<div class="mlStat"><div class="k">Primary condition</div><div class="v">-</div></div>';
      $('mlSummary').textContent = 'Run an analysis to generate a factual summary.';
      $('mlTimeline').innerHTML = '';
      $('mlEvidence').textContent = 'Select a timeline event.';
      $('mlStructure').textContent = '';
      if ($('mlInfusion')) $('mlInfusion').textContent = '';
      if ($('mlMotifReview')) $('mlMotifReview').innerHTML = '';
      $('mlTitles').textContent = '';
      $('mlStylePrompt').textContent = '';
      $('mlLyrics').textContent = '';
      $('mlPackage').textContent = '';
      renderAiPanels();
      return;
    }
    const q = data.dataQuality || {};
    $('mlDataStatus').innerHTML = [
      ['Instrument', data.instrument], ['Date', data.date], ['Source', data.source], ['Timezone', data.timezone],
      ['Loaded candles', q.loadedCandles + ' / ' + q.expectedCandles], ['Data completeness', (Number(q.completeness) * 100).toFixed(1) + '%'], ['Detector version', data.detectorVersion]
    ].map(function(item) { return '<div class="mlStat"><div class="k">' + escapeHtml(item[0]) + '</div><div class="v">' + escapeHtml(item[1]) + '</div></div>'; }).join('');
    const c = data.classification || {};
    $('mlClassification').innerHTML = [
      ['Primary condition', c.primaryCondition], ['Secondary condition', c.secondaryCondition], ['Final direction', c.finalDirection], ['Volatility', c.volatility], ['Directional efficiency', c.directionalEfficiency], ['Confidence', Math.round((Number(c.confidence) || 0) * 100) + '%']
    ].map(function(item) { return '<div class="mlStat"><div class="k">' + escapeHtml(item[0]) + '</div><div class="v">' + escapeHtml(item[1]) + '</div></div>'; }).join('');
    $('mlSummary').textContent = data.morningSummary || '';
    $('mlTimeline').innerHTML = (data.songEvents || []).map(function(event) {
      const selected = state.selectedEventId === event.id ? ' sel' : '';
      const label = timelineLabel(event);
      return '<div class="mlTimelineItem' + selected + '" data-event-id="' + escapeHtml(event.id) + '"><div class="t">' + escapeHtml(label.time) + '</div><div class="d">' + escapeHtml(label.text) + '</div></div>';
    }).join('') || '<div class="mlTextBlock">No events met the filter threshold.</div>';
    $('mlStructure').innerHTML = renderStructure(data);
    if ($('mlInfusion')) $('mlInfusion').innerHTML = renderInfusion(data);
    if ($('mlMotifReview')) $('mlMotifReview').innerHTML = renderMotifReview(data);
    $('mlTitles').innerHTML = (data.titleSuggestions || []).map(function(title) { return '<div class="mlStat"><div class="v">' + escapeHtml(title) + '</div></div>'; }).join('');
    $('mlStylePrompt').textContent = data.sunoStylePrompt || '';
    $('mlLyrics').textContent = data.sunoLyrics || '';
    $('mlPackage').textContent = renderCompletePackage();
    bindTimelineClicks();
    renderEvidence();
    renderAiPanels();
  }

  function renderInfusion(data) {
    const fingerprint = data.fingerprint || null;
    const plan = Array.isArray(data.sectionPlan) ? data.sectionPlan : fingerprint && Array.isArray(fingerprint.sectionPlan) ? fingerprint.sectionPlan : [];
    const infusion = data.sessionInfusion || (fingerprint && fingerprint.infusion) || {};
    const motifs = fingerprint && Array.isArray(fingerprint.motifs) ? fingerprint.motifs : [];
    const map = MusicLab.Fingerprint && typeof MusicLab.Fingerprint.renderSectionMap === 'function' ? MusicLab.Fingerprint.renderSectionMap(plan, state.duration) : [];
    const parts = [];
    parts.push('<div class="mlStat"><div class="k">Macro shape</div><div class="v">' + escapeHtml(fingerprint && fingerprint.macroShape || 'n/a') + '</div></div>');
    parts.push('<div class="mlStat"><div class="k">Final resolution</div><div class="v">' + escapeHtml(fingerprint && fingerprint.resolution ? fingerprint.resolution.direction + ' · ' + Math.round((fingerprint.resolution.strength || 0) * 100) + '%' : 'n/a') + '</div></div>');
    parts.push('<div class="mlStat"><div class="k">Infusion</div><div class="v">' + escapeHtml(infusion.status || 'Weak') + '</div></div>');
    parts.push('<div class="mlStat"><div class="k">Motifs</div><div class="v">' + escapeHtml(String(motifs.length)) + '</div></div>');
    parts.push('<div class="mlStat"><div class="k">Coverage</div><div class="v">' + escapeHtml(fingerprint && fingerprint.coverage ? fingerprint.coverage.representedMotifs + ' represented · ' + fingerprint.coverage.highImportanceMotifs + ' high importance' : 'n/a') + '</div></div>');
    parts.push('<div class="mlStat"><div class="k">Session map</div><div class="v">' + escapeHtml(map.map(function(item) { return item.section + ' → ' + item.startSeconds.toFixed(0) + 's-' + item.endSeconds.toFixed(0) + 's'; }).join('\n') || 'n/a') + '</div></div>');
    return parts.join('');
  }

  function renderMotifReview(data) {
    const fingerprint = data.fingerprint || null;
    const motifs = fingerprint && Array.isArray(fingerprint.motifs) ? fingerprint.motifs : [];
    if (!motifs.length) return '<div class="mlTextBlock">No compiled motifs yet.</div>';
    return motifs.map(function(motif) {
      const override = state.motifOverrides[motif.id] || {};
      const tag = motif.type.replace(/_/g, ' ');
      const status = override.included === false ? 'excluded' : override.split ? 'split' : override.dominant ? 'dominant' : 'included';
      return '<div class="mlStat mlMotifRow" data-motif-id="' + escapeHtml(motif.id) + '">' +
        '<div class="k">' + escapeHtml(motif.id + ' · ' + status) + '</div>' +
        '<div class="v"><b>' + escapeHtml(tag) + '</b> · ' + escapeHtml(Math.round((motif.importance || 0) * 100) + '%') + ' · ' + escapeHtml(motif.lyricPurpose || '') + '</div>' +
        '<div class="mlMotifActions">' +
          '<button class="btn" data-motif-action="toggle-include" data-motif-id="' + escapeHtml(motif.id) + '">' + (override.included === false ? 'Include' : 'Exclude') + '</button>' +
          '<button class="btn" data-motif-action="toggle-dominant" data-motif-id="' + escapeHtml(motif.id) + '">' + (override.dominant ? 'Unset dominant' : 'Dominant') + '</button>' +
          '<button class="btn" data-motif-action="toggle-split" data-motif-id="' + escapeHtml(motif.id) + '">' + (override.split ? 'Keep grouped' : 'Split') + '</button>' +
        '</div></div>';
    }).join('');
  }

  function renderAiMetaText(pkg) {
    if (!pkg) return '';
    const bits = [];
    if (pkg.model) bits.push('Model: ' + pkg.model);
    if (pkg.mode) bits.push('Mode: ' + pkg.mode);
    if (pkg.sessionId) bits.push('Session: ' + pkg.sessionId);
    if (pkg.source) bits.push('Source: ' + pkg.source);
    return bits.join(' · ');
  }

  function renderAiMapText(pkg) {
    if (!pkg || !Array.isArray(pkg.lyricEntries)) return '';
    return pkg.lyricEntries.map(function(entry, index) {
      const refs = Array.isArray(entry.motifIds) && entry.motifIds.length ? ' [' + entry.motifIds.join(', ') + ']' : (Array.isArray(entry.sourceEventIds) && entry.sourceEventIds.length ? ' [' + entry.sourceEventIds.join(', ') + ']' : '');
      const text = Array.isArray(entry.lines) ? entry.lines.join(' / ') : entry.text;
      return String(index + 1).padStart(2, '0') + '. ' + entry.section + ' — ' + text + refs;
    }).join('\n');
  }

  function renderAiStyleText() {
    return state.aiPackage ? state.aiPackage.stylePrompt || '' : '';
  }

  function renderAiLyricsText() {
    return state.aiPackage ? state.aiPackage.lyrics || '' : '';
  }

  function renderAiPackageText() {
    const pkg = state.aiPackage;
    if (!pkg) return '';
    return [
      'SESSION ARC',
      pkg.sessionArc || '',
      '',
      'TITLE SUGGESTIONS',
      (pkg.titles || pkg.titleSuggestions || []).join('\n'),
      '',
      'STYLE PROMPT',
      pkg.stylePrompt || '',
      '',
      'LYRICS',
      pkg.lyrics || '',
      '',
      'SECTIONS',
      Array.isArray(pkg.sections) ? pkg.sections.map(function(section) { return section.section + ' [' + (section.motifIds || []).join(', ') + ']'; }).join('\n') : '',
      '',
      'EVENT MAPPING',
      renderAiMapText(pkg)
    ].join('\n');
  }

  function renderAiPanels() {
    const status = $('mlAiStatus');
    const meta = $('mlAiMeta');
    const badge = $('mlAiBadge');
    const arc = $('mlAiArc');
    const titles = $('mlAiTitles');
    const style = $('mlAiStyle');
    const lyrics = $('mlAiLyrics');
    const map = $('mlAiMap');
    const debugWrap = $('mlAiDebugWrap');
    const debug = $('mlAiDebug');
    if (!status || !meta || !badge || !arc || !titles || !style || !lyrics || !map || !debugWrap || !debug) return;
    if (!state.analysis) {
      status.textContent = 'Run a morning analysis to enable AI packaging.';
      meta.textContent = '';
      badge.textContent = '';
      arc.textContent = '';
      titles.textContent = '';
      style.textContent = '';
      lyrics.textContent = '';
      map.textContent = '';
      debug.textContent = '';
      debugWrap.style.display = 'none';
      setAiButtonEnabled();
      return;
    }
    if (!state.aiPackage) {
      status.textContent = state.aiLoading ? 'Generating an AI song package from verified analysis...' : (state.aiEnabled ? 'Ready to generate an AI song package from verified analysis.' : 'OpenCode AI is disabled. A deterministic fallback is available.');
      meta.textContent = renderAiMetaText({ model: MusicLab.AI && MusicLab.AI.CONFIG ? MusicLab.AI.CONFIG.model.modelID : 'n/a', mode: 'pending' });
      badge.innerHTML = '<span class="tag">Pending</span> Verified analysis only';
      arc.textContent = 'No AI package generated yet.';
      titles.textContent = '';
      style.textContent = '';
      lyrics.textContent = '';
      map.textContent = '';
      debug.textContent = '';
      debugWrap.style.display = 'none';
      setAiButtonEnabled();
      return;
    }
    const pkg = state.aiPackage;
    status.textContent = pkg.state === 'ok' ? 'OpenCode AI generated a verified song package.' : 'MusicLab used the deterministic fallback package.';
    meta.textContent = renderAiMetaText(pkg);
    badge.innerHTML = '<span class="tag">' + escapeHtml(pkg.state === 'ok' ? 'AI' : 'Fallback') + '</span> ' + escapeHtml(pkg.sessionArc || '');
    arc.textContent = pkg.sessionArc || '';
    titles.innerHTML = (pkg.titles || pkg.titleSuggestions || []).map(function(title) { return '<div class="mlStat"><div class="v">' + escapeHtml(title) + '</div></div>'; }).join('');
    style.textContent = pkg.stylePrompt || '';
    lyrics.textContent = pkg.lyrics || '';
    map.textContent = renderAiMapText(pkg);
    debug.textContent = state.aiDebug ? JSON.stringify(pkg.debug || {}, null, 2) : '';
    debugWrap.style.display = state.aiDebug ? 'block' : 'none';
    setAiButtonEnabled();
  }

  function renderStructure(data) {
    const plan = Array.isArray(data.sectionPlan) ? data.sectionPlan : data.fingerprint && Array.isArray(data.fingerprint.sectionPlan) ? data.fingerprint.sectionPlan : [];
    if (!plan.length) return '<div class="mlTextBlock">No section plan yet.</div>';
    return plan.map(function(section) {
      return '<div class="mlStat"><div class="k">' + escapeHtml(section.section) + '</div><div class="v">' + escapeHtml((section.motifIds || []).join(', ') || 'Instrumental') + '\n' + escapeHtml(section.purpose || '') + '</div></div>';
    }).join('');
  }

  function timelineLabel(event) {
    const time = event.endTimestamp ? event.timestamp.slice(11, 16) + '–' + event.endTimestamp.slice(11, 16) : event.timestamp.slice(11, 16);
    const text = event.endTimestamp ? event.type.replace(/_/g, ' ') : event.description;
    return { time: time, text: text };
  }

  function bindTimelineClicks() {
    document.querySelectorAll('.mlTimelineItem').forEach(function(node) {
      node.addEventListener('click', function() {
        state.selectedEventId = node.getAttribute('data-event-id');
        renderEvidence();
        renderChart();
        document.querySelectorAll('.mlTimelineItem').forEach(function(item) { item.classList.toggle('sel', item.getAttribute('data-event-id') === state.selectedEventId); });
      });
    });
  }

  function selectedEvent() {
    const data = state.analysis;
    return data && (data.songEvents || []).find(function(event) { return event.id === state.selectedEventId; }) || null;
  }

  function renderEvidence() {
    const event = selectedEvent();
    const el = $('mlEvidence');
    if (!el) return;
    if (!event) { el.textContent = 'Select a timeline event.'; return; }
    el.innerHTML = [
      ['Event type', event.type], ['Timestamp', event.timestamp], ['Price', formatPrice(event.price, 1)], ['Level', event.levelName ? event.levelName + ' · ' + formatPrice(event.levelPrice, 1) : '-'], ['Confidence', Math.round(event.confidence * 100) + '%'], ['Importance', Math.round(event.importance * 100) + '%'], ['Description', event.description], ['Evidence', JSON.stringify(event.evidence, null, 2)]
    ].map(function(item) { return '<div class="mlStat"><div class="k">' + escapeHtml(item[0]) + '</div><div class="v">' + escapeHtml(item[1]) + '</div></div>'; }).join('');
  }

  function renderTimelineText() {
    if (!state.analysis) return '';
    return (state.analysis.songEvents || []).map(function(event) {
      return (event.endTimestamp ? event.timestamp.slice(11, 16) + '–' + event.endTimestamp.slice(11, 16) : event.timestamp.slice(11, 16)) + ' — ' + (event.endTimestamp ? event.type.replace(/_/g, ' ') : event.description);
    }).join('\n');
  }

  function renderSummaryText() { return state.analysis ? state.analysis.morningSummary || '' : ''; }

  function renderCompletePackage() {
    if (!state.analysis) return '';
    return [
      'TITLE SUGGESTIONS',
      (state.analysis.titleSuggestions || []).join('\n'),
      '',
      'STYLE PROMPT',
      state.analysis.sunoStylePrompt || '',
      '',
      'LYRICS',
      state.analysis.sunoLyrics || '',
      '',
      'MARKET SUMMARY',
      state.analysis.morningSummary || '',
      '',
      'DETECTED EVENT TIMELINE',
      renderTimelineText()
    ].join('\n');
  }

  function renderChart() {
    if (!canvas || !ctx || !state.analysis) return;
    const data = state.analysis;
    const bars = (data.morningBars || data.analysisBars || data._bars || data.rawBars || []).length ? (data.morningBars || data.analysisBars || data._bars || data.rawBars) : [];
    const chartBars = data.chartBars || data.morningBars || data.analysisBars || [];
    const levels = data.levels || {};
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!chartBars.length) return;

    const paddingLeft = 50;
    const paddingRight = 90;
    const paddingTop = 16;
    const paddingBottom = 26;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    const visible = chartBars;
    let min = Infinity;
    let max = -Infinity;
    visible.forEach(function(bar) { min = Math.min(min, bar.low); max = Math.max(max, bar.high); });
    [levels.asiaHigh, levels.asiaLow, levels.sessionOpen, levels.previousDayHigh, levels.previousDayLow, levels.vwap].forEach(function(level) {
      if (isFinitePrice(level)) { min = Math.min(min, level); max = Math.max(max, level); }
    });
    const pad = Math.max(1, (max - min) * 0.12);
    min -= pad; max += pad;
    const y = function(price) { return paddingTop + plotHeight - (price - min) / Math.max(0.0001, max - min) * plotHeight; };
    const xFor = function(index) { return paddingLeft + (index + 0.5) * (plotWidth / visible.length); };
    const candleWidth = Math.max(2, (plotWidth / visible.length) * 0.65);

    ctx.fillStyle = '#0b0e13';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#1b2030';
    for (let i = 0; i <= 5; i++) {
      const gy = paddingTop + (plotHeight / 5) * i;
      ctx.beginPath(); ctx.moveTo(paddingLeft, gy); ctx.lineTo(width - paddingRight, gy); ctx.stroke();
    }
    visible.forEach(function(bar, index) {
      const x = xFor(index);
      const up = bar.close >= bar.open;
      ctx.strokeStyle = up ? '#00e58c' : '#ff4d5e';
      ctx.fillStyle = up ? '#00e58c' : '#ff4d5e';
      ctx.beginPath(); ctx.moveTo(x, y(bar.high)); ctx.lineTo(x, y(bar.low)); ctx.stroke();
      ctx.fillRect(x - candleWidth / 2, Math.min(y(bar.open), y(bar.close)), candleWidth, Math.max(1, Math.abs(y(bar.close) - y(bar.open))));
    });
    drawLevel(levels.asiaHigh, '#ff9b3d', 'Asia High');
    drawLevel(levels.asiaLow, '#ff9b3d', 'Asia Low');
    drawLevel(levels.sessionOpen, '#f2f4f8', '08:00 Open');
    drawLevel(levels.previousDayHigh, '#7ee0ff', 'Previous-Day High');
    drawLevel(levels.previousDayLow, '#7ee0ff', 'Previous-Day Low');
    drawLevel(levels.vwap, '#59d2fe', 'VWAP');
    drawEventRanges();
    drawMarkers();
    drawTimeAxis();
    drawPriceAxis();
    if (state.selectedEventId) {
      const event = selectedEvent();
      if (event) drawSelection(event);
    }

    function drawLevel(price, color, label) {
      if (!isFinitePrice(price)) return;
      const yy = y(price);
      ctx.strokeStyle = color; ctx.globalAlpha = 0.8; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(paddingLeft, yy); ctx.lineTo(width - paddingRight, yy); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = color; ctx.font = '10px JetBrains Mono,monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(label + ' ' + formatPrice(price, data.metrics && data.metrics.precision), width - paddingRight + 6, yy - 2);
    }

    function drawEventRanges() {
      (data.songEvents || []).forEach(function(event) {
        if (!event.endTimestampSeconds) return;
        const start = indexFor(event.timestampSeconds);
        const end = indexFor(event.endTimestampSeconds);
        if (start < 0 || end < 0) return;
        const x1 = xFor(start) - candleWidth / 2;
        const x2 = xFor(end) + candleWidth / 2;
        ctx.fillStyle = state.selectedEventId === event.id ? 'rgba(212,165,116,.18)' : 'rgba(89,210,254,.12)';
        ctx.fillRect(x1, paddingTop, Math.max(2, x2 - x1), plotHeight);
      });
    }

    function drawMarkers() {
      (data.songEvents || []).forEach(function(event) {
        const index = indexFor(event.timestampSeconds);
        if (index < 0) return;
        const x = xFor(index);
        const yy = y(event.price || chartBars[index].close);
        ctx.beginPath();
        ctx.fillStyle = state.selectedEventId === event.id ? '#d4a574' : '#59d2fe';
        ctx.strokeStyle = '#0b0e13';
        ctx.arc(x, yy, state.selectedEventId === event.id ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }

    function drawTimeAxis() {
      ctx.fillStyle = '#8b93a7';
      ctx.font = '10px JetBrains Mono,monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const step = Math.max(20, Math.round(visible.length / 6));
      for (let i = 0; i < visible.length; i += step) {
        const x = xFor(i);
        ctx.strokeStyle = 'rgba(26,32,48,.7)';
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, paddingTop); ctx.lineTo(Math.round(x) + 0.5, paddingTop + plotHeight); ctx.stroke();
        ctx.fillText(formatChartTime(visible[i].timestamp), x, paddingTop + plotHeight + 4);
      }
    }

    function drawPriceAxis() {
      ctx.fillStyle = '#8b93a7';
      ctx.font = '10px JetBrains Mono,monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const step = (max - min) / 5;
      for (let i = 0; i <= 5; i++) {
        const price = min + step * i;
        const yy = y(price);
        ctx.fillText(formatPrice(price, data.metrics && data.metrics.precision), width - paddingRight + 6, yy);
      }
    }

    function drawSelection(event) {
      const index = indexFor(event.timestampSeconds);
      if (index >= 0) {
        const x = xFor(index);
        ctx.fillStyle = 'rgba(212,165,116,.1)';
        ctx.fillRect(Math.max(paddingLeft, x - 6), paddingTop, 12, plotHeight);
      }
    }

    function indexFor(timestampSeconds) {
      return visible.findIndex(function(bar) { return bar.timestamp === timestampSeconds; });
    }
  }

  function handleChartPointer(event) {
    if (!canvas || !state.analysis) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    pointer = { hoverX: x, hoverY: y };
    const data = state.analysis;
    const bars = data.chartBars || data.morningBars || [];
    const selected = hitTestEvent(x, y, rect.width, rect.height, bars);
    if (selected) {
      state.selectedEventId = selected.id;
      showTip(event.clientX, event.clientY, selected.description + '\n' + selected.timestamp + (selected.endTimestamp ? ' - ' + selected.endTimestamp : ''));
      renderEvidence();
      renderChart();
      highlightTimeline(selected.id);
      return;
    }
    hideTip();
  }

  function hitTestEvent(x, y, width, height, bars) {
    const data = state.analysis;
    if (!data) return null;
    const chartBars = data.chartBars || [];
    if (!chartBars.length) return null;
    const paddingLeft = 50;
    const paddingRight = 90;
    const paddingTop = 16;
    const paddingBottom = 26;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    let min = Infinity, max = -Infinity;
    chartBars.forEach(function(bar) { min = Math.min(min, bar.low); max = Math.max(max, bar.high); });
    [data.levels.asiaHigh, data.levels.asiaLow, data.levels.sessionOpen, data.levels.previousDayHigh, data.levels.previousDayLow, data.levels.vwap].forEach(function(level) { if (isFinitePrice(level)) { min = Math.min(min, level); max = Math.max(max, level); } });
    const pad = Math.max(1, (max - min) * 0.12); min -= pad; max += pad;
    const yFromPrice = function(price) { return paddingTop + plotHeight - (price - min) / Math.max(0.0001, max - min) * plotHeight; };
    const xFor = function(index) { return paddingLeft + (index + 0.5) * (plotWidth / chartBars.length); };
    const precision = data.metrics && data.metrics.precision || 1;
    let hit = null;
    (data.songEvents || []).forEach(function(event) {
      const idx = chartBars.findIndex(function(bar) { return bar.timestamp === event.timestampSeconds; });
      if (idx < 0) return;
      const ex = xFor(idx);
      const ey = yFromPrice(event.price || chartBars[idx].close);
      const dist = Math.sqrt(Math.pow(x - ex, 2) + Math.pow(y - ey, 2));
      if (dist <= 8) hit = event;
      if (!hit && event.endTimestampSeconds) {
        const endIdx = chartBars.findIndex(function(bar) { return bar.timestamp === event.endTimestampSeconds; });
        if (endIdx >= 0) {
          const x1 = xFor(idx) - 5, x2 = xFor(endIdx) + 5;
          if (x >= x1 && x <= x2 && y >= paddingTop && y <= paddingTop + plotHeight) hit = event;
        }
      }
    });
    return hit;
  }

  function showTip(clientX, clientY, text) {
    const tip = $('mlChartTip');
    if (!tip) return;
    tip.style.display = 'block';
    tip.style.left = Math.min(window.innerWidth - 320, clientX + 14) + 'px';
    tip.style.top = Math.min(window.innerHeight - 120, clientY + 14) + 'px';
    tip.textContent = text;
  }

  function hideTip() {
    const tip = $('mlChartTip');
    if (tip) tip.style.display = 'none';
  }

  function highlightTimeline(id) {
    document.querySelectorAll('.mlTimelineItem').forEach(function(item) { item.classList.toggle('sel', item.getAttribute('data-event-id') === id); });
  }

  async function analyseMorning() {
    if (!state.date) return;
    state.aiPackage = null;
    if (!state.dates.length) await loadInstrumentData();
    const available = state.dates.slice();
    if (available.indexOf(state.date) < 0) {
      updateStatus('No one-minute candles are available for ' + state.instrument + ' on ' + state.date + '.', 'isError');
      return;
    }
    const previousDate = MusicLab.Detector.previousAvailableTradingDay(available, state.date);
    if (!previousDate) {
      updateStatus('Previous-day data is unavailable for the selected morning.', 'isError');
      return;
    }
    state.loading = true;
    setButtonEnabled();
    updateStatus('Loading selected morning plus prior trading day...', '');
    try {
      const bars = await BotLab.MarketData.loadRange(state.instrument.toLowerCase(), previousDate, state.date);
      if (!Array.isArray(bars) || !bars.length) {
        updateStatus('No one-minute candles are available for ' + state.instrument + ' on ' + state.date + '.', 'isError');
        state.analysis = null;
        state.selectedEventId = null;
        state.aiPackage = null;
        renderStatusPanels();
        renderChart();
        state.loading = false;
        setButtonEnabled();
        return;
      }
      const result = MusicLab.Detector.analyzeSession({
        bars: bars,
        instrument: state.instrument,
        date: state.date,
        startTime: state.startTime,
        endTime: state.endTime,
        timezone: state.timezone,
        sensitivity: state.sensitivity,
        hintStrength: state.hintStrength,
        musicStyle: state.musicStyle,
        vocalStyle: state.vocalStyle,
        duration: state.duration,
        maximumEvents: clampNumber(state.maximumEvents, 3, 10, 8),
        wordingSeed: state.wordingSeed,
        includeGeneralWhispers: state.includeGeneralWhispers,
        source: 'Game Trader candle API',
        availableDates: available
      });
      if ((result.dataQuality && Number(result.dataQuality.completeness) < 0.9)) {
        state.analysis = null;
        state.selectedEventId = null;
        state.aiPackage = null;
        updateStatus('Only ' + result.dataQuality.loadedCandles + ' / ' + result.dataQuality.expectedCandles + ' candles are available. MusicLab did not generate a soundtrack.', 'isError');
        renderStatusPanels();
        renderChart();
        state.loading = false;
        setButtonEnabled();
        writeStorage();
        return;
      }
      result.chartBars = result.analysisBars || result.morningBars || [];
      state.analysis = result;
      state.aiPackage = null;
      state.selectedEventId = (result.songEvents[0] && result.songEvents[0].id) || null;
      const completeness = Number(result.dataQuality.completeness) || 0;
      updateStatus('Loaded: ' + result.dataQuality.loadedCandles + ' / ' + result.dataQuality.expectedCandles + ' candles · Completeness: ' + (completeness * 100).toFixed(1) + '% · Timezone: ' + state.timezone + ' · Source: Game Trader candle API', completeness >= 0.98 ? 'isReady' : completeness >= 0.9 ? 'mlWarn' : 'isError');
      renderStatusPanels();
      renderChart();
      setButtonEnabled();
    } catch (error) {
      state.aiPackage = null;
      updateStatus(error.message || 'Analysis failed.', 'isError');
    }
    state.loading = false;
    setButtonEnabled();
  }

  async function generateAiSongPackage(mode) {
    if (!state.analysis) return;
    if (mode === 'reword') state.wordingSeed = String(Date.now());
    const analysis = getAdjustedAnalysis();
    state.aiLoading = true;
    setAiButtonEnabled();
    renderAiPanels();
    try {
      const packageData = await MusicLab.AI.generateSongPackage({
        analysis: analysis,
        enabled: $('mlAiEnabled') ? $('mlAiEnabled').checked : state.aiEnabled,
        mode: mode || 'generate',
        sensitivity: state.sensitivity,
        hintStrength: state.hintStrength,
        musicStyle: state.musicStyle,
        customMusicStyle: null,
        vocalStyle: state.vocalStyle,
        duration: state.duration,
        maximumEvents: clampNumber(state.maximumEvents, 3, 10, 8),
        wordingSeed: state.wordingSeed,
        includeGeneralWhispers: state.includeGeneralWhispers,
        aiDebug: state.aiDebug
      });
      state.aiPackage = packageData;
      if (packageData && packageData.wordingSeed) state.wordingSeed = String(packageData.wordingSeed);
      writeStorage();
      renderAiPanels();
    } catch (error) {
      state.aiPackage = MusicLab.AI.buildFallbackPackage(analysis || state.analysis, {
        mode: mode || 'generate',
        enabled: false,
        sensitivity: state.sensitivity,
        hintStrength: state.hintStrength,
        musicStyle: state.musicStyle,
        vocalStyle: state.vocalStyle,
        duration: state.duration,
        maximumEvents: clampNumber(state.maximumEvents, 3, 10, 8),
        wordingSeed: state.wordingSeed,
        includeGeneralWhispers: state.includeGeneralWhispers
      });
      updateStatus('AI packaging failed. Deterministic fallback is still available.', 'mlWarn');
      renderAiPanels();
    }
    state.aiLoading = false;
    setAiButtonEnabled();
  }

  function regenerateWording() {
    if (!state.analysis) return;
    state.wordingSeed = String(Date.now());
    const analysis = getAdjustedAnalysis();
    const packageData = MusicLab.Lyrics.generatePackage({
      instrument: analysis.instrument,
      date: analysis.date,
      events: analysis.songEvents,
      levels: analysis.levels,
      classification: analysis.classification,
      sensitivity: state.sensitivity,
      hintStrength: state.hintStrength,
      musicStyle: state.musicStyle,
      customMusicStyle: null,
      vocalStyle: state.vocalStyle,
      duration: state.duration,
      lyricDensity: 'Minimal',
      maximumEvents: state.maximumEvents,
      wordingSeed: state.wordingSeed,
      includeGeneralWhispers: state.includeGeneralWhispers,
      fingerprint: analysis.fingerprint,
      sectionPlan: analysis.sectionPlan
    });
    state.analysis.sunoLyrics = packageData.lyrics;
    state.analysis.lyricEntries = packageData.lyricEntries;
    state.analysis.titleSuggestions = packageData.titleSuggestions || packageData.titles;
    state.analysis.titles = packageData.titles || packageData.titleSuggestions;
    state.analysis.sections = packageData.sections || [];
    state.analysis.sectionPlan = packageData.sectionPlan || analysis.sectionPlan || [];
    state.analysis.fingerprint = analysis.fingerprint;
    state.analysis.sessionInfusion = analysis.sessionInfusion;
    state.analysis.generationSeed = packageData.generationSeed;
    state.analysis.wordingSeed = packageData.wordingSeed;
    renderStatusPanels();
    renderChart();
    writeStorage();
  }

  function downloadAnalysisJson() {
    if (!state.analysis) return;
    const payload = {
      instrument: state.analysis.instrument,
      date: state.analysis.date,
      analysisWindow: state.analysis.timeRange,
      timezone: state.analysis.timezone,
      source: state.analysis.source,
      dataCompleteness: state.analysis.dataQuality,
      calculatedLevels: state.analysis.levels,
      detectorConfiguration: state.analysis.detectorConfiguration,
      detectorVersion: state.analysis.detectorVersion,
      rawEvents: state.analysis.rawEvents,
      songEvents: state.analysis.songEvents,
      fingerprint: state.analysis.fingerprint,
      sectionPlan: state.analysis.sectionPlan,
      sessionInfusion: state.analysis.sessionInfusion,
      motifOverrides: state.motifOverrides,
      classification: state.analysis.classification,
      morningSummary: state.analysis.morningSummary,
      titleSuggestions: state.analysis.titleSuggestions,
      titles: state.analysis.titles,
      sunoStylePrompt: state.analysis.sunoStylePrompt,
      sunoLyrics: state.analysis.sunoLyrics,
      aiPackage: state.aiPackage,
      generationSeed: state.analysis.generationSeed,
      wordingSeed: state.analysis.wordingSeed,
      warnings: state.analysis.warnings,
      createdTimestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'musiclab-' + state.instrument.toLowerCase() + '-' + state.date + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
  }

  function resetPage() {
    state.date = '';
    state.analysis = null;
    state.selectedEventId = null;
    state.aiPackage = null;
    state.wordingSeed = '0';
    state.motifOverrides = {};
    populateDates();
    updateStatus('Select an instrument and date.', '');
    renderStatusPanels();
    renderChart();
    setButtonEnabled();
    writeStorage();
  }

  function resize() { if (state.analysis) renderChart(); }

  async function init() {
    readStorage();
    populateInstruments();
    bindControls();
    const aiEnabled = $('mlAiEnabled');
    const aiDebugToggle = $('mlAiDebugToggle');
    if (aiEnabled) aiEnabled.checked = state.aiEnabled !== false;
    if (aiDebugToggle) aiDebugToggle.checked = !!state.aiDebug;
    canvas = $('mlChart');
    if (canvas) {
      ctx = canvas.getContext('2d');
      canvas.addEventListener('mousemove', handleChartPointer);
      canvas.addEventListener('mouseleave', hideTip);
      canvas.addEventListener('click', function(event) { handleChartPointer(event); });
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas.parentElement);
      }
    }
    populateDates();
    if (state.instrument) await loadInstrumentData();
    renderStatusPanels();
    setButtonEnabled();
    writeStorage();
  }

  return { init, analyseMorning, regenerateWording, formatChartTime };
})();

window.addEventListener('DOMContentLoaded', function() {
  if (!window.BotLab || !BotLab.MarketData) return;
  MusicLab.App.init();
});
