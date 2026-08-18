'use strict';
window.ProShell = (function() {
  const ROUTES = new Set(['dashboard', 'replay', 'prop', 'academy', 'reports', 'account', 'settings', 'report/latest', 'challenge/current']);
  const NAV_ITEMS = [
    ['dashboard', 'Overview'],
    ['replay', 'Replay'],
    ['challenge/current', 'Challenge'],
    ['prop', 'Prop Challenge'],
    ['academy', 'Academy'],
    ['reports', 'Reports'],
    ['account', 'Account'],
    ['settings', 'Settings']
  ];
  const SELECTED_REPORT_KEY = 'tradeRider.pro.selectedReportId.v1';
  const SELECTED_REPLAY_KEY = 'tradeRider.pro.selectedReplayId.v1';
  const PRO_SETTINGS_KEY = 'tradeRider.pro.settings.v1';
  const PRO_REPLAY_AI_CACHE_KEY = 'tradeRider.pro.replayAiReview.v1';
  const DEFAULT_SETTINGS = {
    landingRoute: 'dashboard',
    soundHints: true,
    compactCards: false
  };

  const PAGE_META = {
    dashboard: { title: 'Overview', sub: 'Latest sessions, prop progress, and journal summary.' },
    replay: { title: 'Replay', sub: 'Saved practice sessions and quick re-entry.' },
    prop: { title: 'Prop Challenge', sub: 'Account progress and challenge history.' },
    academy: { title: 'Academy', sub: 'Reference notes and training placeholders.' },
    reports: { title: 'Reports', sub: 'Saved journal and report history.' },
    account: { title: 'Account', sub: 'Guest mode and account-ready storage.' },
    settings: { title: 'Settings', sub: 'Appearance, sound, and replay defaults.' },
    'report/latest': { title: 'Latest Report', sub: 'Detailed view of the selected session.' },
    'challenge/current': { title: 'Mystery Challenge', sub: 'Pick a hidden day and share a code.' }
  };

  const EMPTY_TEXT = {
    title: 'No saved sessions yet.',
    body: 'Start a replay to build your trading history.',
    note: 'Guest reports are stored only on this device.'
  };

  const DEMO_REPORT = {
    id: 'demo-example',
    title: 'Demo example',
    subtitle: 'Demo example — not your trading history.',
    isDemo: true,
    instrument: 'DE40',
    mode: 'Sim Arcade',
    result: 'Demo example',
    netPL: null,
    score: null,
    trades: null,
    maxDrawdown: null,
    breachStatus: 'Not recorded',
    dateLabel: 'Not recorded',
    currency: '$',
    badgeText: 'Demo example',
    badges: ['Demo example', 'Guest only']
  };

  function readJSON(key, fallback) {
    try {
      const raw = store && typeof store.get === 'function' ? store.get(key) : localStorage.getItem(key);
      if (raw == null || raw === '') return fallback;
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function writeValue(key, value) {
    try {
      if (store && typeof store.set === 'function') store.set(key, value);
      else localStorage.setItem(key, value);
    } catch (error) {}
  }

  function safeNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatMoney(value, currency) {
    if (!Number.isFinite(Number(value))) return 'Not recorded';
    const n = Number(value);
    const c = currency || '$';
    return `${n >= 0 ? '+' : '-'}${c}${Math.abs(n).toFixed(0)}`;
  }

  function formatDate(value) {
    if (!value) return 'Not recorded';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not recorded';
    return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatScore(value) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-GB') : 'Not recorded';
  }

  function formatTrades(value) {
    return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-GB') : 'Not recorded';
  }

  function formatDrawdown(value, currency) {
    return Number.isFinite(Number(value)) ? formatMoney(value, currency) : 'Not recorded';
  }

  function formatBalance(value, currency) {
    if (!Number.isFinite(Number(value))) return 'Not recorded';
    const n = Number(value);
    const c = currency || '$';
    return `${n < 0 ? '-' : ''}${c}${Math.abs(n).toFixed(0)}`;
  }

  function reportBadge(text, tone) {
    return `<span class="proBadge${tone ? ' ' + tone : ''}">${escapeHtml(text)}</span>`;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function reportCurrency(report) {
    return report && report.currency ? report.currency : (typeof CUR !== 'undefined' && CUR && CUR.currency) ? CUR.currency : '$';
  }

  function reportValue(report, keys) {
    if (!report || !keys) return null;
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      const value = key.split('.').reduce((acc, part) => (acc && acc[part] != null ? acc[part] : null), report);
      if (value != null) return value;
    }
    return null;
  }

  function createSummary(report) {
    const currency = reportCurrency(report);
    return {
      id: report.id,
      kind: report.kind,
      source: report.source,
      title: report.title,
      subtitle: report.subtitle,
      instrument: report.instrument || 'Not recorded',
      mode: report.mode || 'Not recorded',
      result: report.result || 'Not recorded',
      netPL: report.netPL,
      score: report.score,
      trades: report.trades,
      maxDrawdown: report.maxDrawdown,
      breachStatus: report.breachStatus || 'Not recorded',
      dateLabel: report.dateLabel || 'Not recorded',
      currency,
      badges: Array.isArray(report.badges) ? report.badges.slice() : [],
      selected: !!report.selected,
      demo: !!report.isDemo,
      good: !!report.good,
      notes: report.notes || null,
      aiReview: report.aiReview || null,
      details: report.details || {},
      report
    };
  }

  function getSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, readJSON(PRO_SETTINGS_KEY, {}));
  }

  function saveSettings(settings) {
    writeValue(PRO_SETTINGS_KEY, JSON.stringify(settings));
  }

  function updateSetting(key, value) {
    const next = getSettings();
    next[key] = value;
    saveSettings(next);
    return next;
  }

  function reportTimestamp(report) {
    if (!report) return 0;
    const candidateValues = [
      reportValue(report, ['details.completion.completedAt', 'details.completion.finishHistoricalTime', 'details.snapshot.t', 'details.snapshot.report.t', 'details.report.t']),
      reportValue(report, ['details.snapshot.report.historicalDate', 'details.report.historicalDate'])
    ];
    for (let i = 0; i < candidateValues.length; i += 1) {
      const value = candidateValues[i];
      if (Number.isFinite(Number(value))) return Number(value);
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    const parsedLabel = Date.parse(report.dateLabel || '');
    return Number.isFinite(parsedLabel) ? parsedLabel : 0;
  }

  function getRecentReports() {
    return getReports().slice().sort(function(left, right) {
      const delta = reportTimestamp(right) - reportTimestamp(left);
      return delta || compareRank(left, right);
    });
  }

  function getReplaySeries() {
    return getRecentReports().filter(function(report) {
      return report.kind === 'prop-day' || report.kind === 'prop' || !!report.aiReview || !!(report.details && (report.details.snapshot || report.details.completion));
    });
  }

  function getReportAiReview(report) {
    if (!report) return null;
    if (report.aiReview) return report.aiReview;
    if (report.details && report.details.completion && report.details.completion.aiReview) return report.details.completion.aiReview;
    if (report.details && report.details.snapshot && report.details.snapshot.aiReview) return report.details.snapshot.aiReview;
    if (report.details && report.details.report && report.details.report.aiReview) return report.details.report.aiReview;
    return null;
  }

  function getReplayAiCache() {
    const cached = readJSON(PRO_REPLAY_AI_CACHE_KEY, null);
    if (!cached || typeof cached !== 'object') return { latestKey: null, entries: {} };
    return {
      latestKey: cached.latestKey || null,
      entries: cached.entries && typeof cached.entries === 'object' ? cached.entries : {}
    };
  }

  function saveReplayAiCache(cache) {
    writeValue(PRO_REPLAY_AI_CACHE_KEY, JSON.stringify({
      latestKey: cache && cache.latestKey ? cache.latestKey : null,
      entries: cache && cache.entries ? cache.entries : {}
    }));
  }

  function replayAiCacheKey(testId, dayIndex, mode) {
    return `${String(testId || 'test')}::${mode || 'week'}::${dayIndex == null ? 'all' : dayIndex}`;
  }

  function botLabCompletedTests() {
    const history = window.BotLab && BotLab.Storage && typeof BotLab.Storage.getHistory === 'function' ? BotLab.Storage.getHistory() : [];
    return history.filter(function(item) {
      return item && (item.status === 'test_complete' || Array.isArray(item.completedDays) && item.completedDays.length);
    }).sort(function(left, right) {
      return reportTimestamp(right) - reportTimestamp(left);
    });
  }

  function buildBotLabReviewSnapshot(test, dayIndex) {
    if (!test) return null;
    const cfg = test.configuration || {};
    const completedDays = Array.isArray(test.completedDays) ? test.completedDays : [];
    const isWeek = dayIndex == null;
    const dayList = isWeek ? completedDays : [completedDays[Number(dayIndex)]].filter(Boolean);
    if (!dayList.length) return null;
    const days = [];
    const trades = [];
    dayList.forEach(function(day, ix) {
      const managed = day.managedMetrics || {};
      const dayTrades = Array.isArray(managed.trades) ? managed.trades : [];
      trades.push.apply(trades, dayTrades);
      days.push({
        dayId: day.dayId || `day-${day.dayIndex != null ? day.dayIndex + 1 : ix + 1}`,
        dayNumber: day.dayIndex != null ? Number(day.dayIndex) + 1 : ix + 1,
        phaseKey: 'replay',
        phaseLabel: isWeek ? 'Selected week' : 'Selected day',
        netResult: Number(managed.netPL != null ? managed.netPL : managed.netProfit || 0),
        tradeCount: Number(managed.trades ? managed.trades.length : managed.totalTrades || 0),
        readableReason: day.reason || 'Completed',
        lowestEquity: Number(managed.lowestEquity || 0),
        maxDrawdown: Number(managed.maxDrawdown || 0),
        trades: dayTrades
      });
    });
    const metrics = typeof summarizeTrades === 'function' ? summarizeTrades(trades) : { totalTrades: trades.length, winningTrades: 0, losingTrades: 0, winRate: 0, profitFactor: 0, maxDrawdown: 0, averageTradeResult: 0 };
    const startingBalance = Number(cfg.startBalance || test.startBalance || 0);
    const finalBalance = Number(test.comparisonMetrics && test.comparisonMetrics.managed ? test.comparisonMetrics.managed.netProfit + startingBalance : test.finalBalance || startingBalance);
    const weekLabel = isWeek ? 'Week review' : `Day ${dayList[0].dayIndex != null ? Number(dayList[0].dayIndex) + 1 : dayIndex + 1}`;
    return {
      challengeId: replayAiCacheKey(test.testId, dayIndex, isWeek ? 'week' : 'day'),
      challengeName: `${cfg.botName || 'Bot Lab'} ${weekLabel}`,
      status: 'passed',
      instrument: cfg.instrumentLabel || cfg.instrument || 'Not recorded',
      startingBalance,
      finalBalance,
      targetBalance: null,
      netProfit: finalBalance - startingBalance,
      completedAt: test.completedAt || test.updatedAt || null,
      phases: [],
      days,
      trades,
      calculatedMetrics: metrics,
      detectedBehaviours: []
    };
  }

  function renderReplayAiReviewState(message, review) {
    const mount = document.querySelector('[data-pro-botlab-ai-review]');
    if (!mount) return;
    if (!review) {
      mount.innerHTML = `<div class="proMuted">${escapeHtml(message || 'Select a day or week to review.')}</div>`;
      return;
    }
    const strengths = Array.isArray(review.strengths) ? review.strengths.slice(0, 3) : [];
    const improvements = Array.isArray(review.improvements) ? review.improvements.slice(0, 3) : [];
    mount.innerHTML = `
      <div class="proDetailGrid">
        <div><span>Headline</span><b>${escapeHtml(review.headline || 'AI review')}</b></div>
        <div><span>Summary</span><b>${escapeHtml(review.executiveSummary || review.closingSummary || 'Not recorded')}</b></div>
      </div>
      <div class="proDetailNotes"><div class="proSectionTitle">Strengths</div><div class="proNotes">${escapeHtml(strengths.map(function(item) { return item.summary || item.text || item.verdict || String(item); }).join(' · ') || 'Not recorded')}</div></div>
      <div class="proDetailNotes"><div class="proSectionTitle">Improvements</div><div class="proNotes">${escapeHtml(improvements.map(function(item) { return item.summary || item.text || item.verdict || String(item); }).join(' · ') || 'Not recorded')}</div></div>
      <div class="proDetailNotes"><div class="proSectionTitle">Next objective</div><div class="proNotes">${escapeHtml(review.nextChallengeObjective || 'Not recorded')}</div></div>`;
  }

  async function runReplayAiReview(test, dayIndex) {
    const mount = document.querySelector('[data-pro-botlab-ai-review]');
    const snapshot = buildBotLabReviewSnapshot(test, dayIndex);
    if (!snapshot) {
      renderReplayAiReviewState('No completed day data is available for that selection.', null);
      return null;
    }
    const cache = getReplayAiCache();
    const key = replayAiCacheKey(test.testId, dayIndex, dayIndex == null ? 'week' : 'day');
    if (cache.entries[key] && cache.entries[key].review) {
      cache.latestKey = key;
      saveReplayAiCache(cache);
      renderReplayAiReviewState('', cache.entries[key].review);
      return cache.entries[key].review;
    }
    renderReplayAiReviewState('Generating AI review...', null);
    try {
      const provider = typeof getAIReviewProvider === 'function' ? getAIReviewProvider() : null;
      if (!provider) throw new Error('AI provider unavailable');
      const payload = buildChallengeAiPayload(snapshot);
      const response = await provider.generateDayReview(payload);
      if (!response || response.state !== 'ok') throw new Error(response && response.error ? response.error : 'review_failed');
      const candidate = response.review || response.raw;
      const parsed = typeof normalizeOpenCodeAiReviewResponse === 'function'
        ? (normalizeOpenCodeAiReviewResponse(candidate, payload) || (typeof candidate === 'string' ? safeJsonParse(stripMarkdownJsonFence(candidate)) : candidate))
        : (typeof candidate === 'string' ? safeJsonParse(stripMarkdownJsonFence(candidate)) : candidate);
      const checked = typeof validateAiReviewResponse === 'function' ? validateAiReviewResponse(parsed, payload) : { ok: !!parsed, errors: [] };
      if (!checked.ok) throw new Error('invalid_review');
      cache.entries[key] = { review: parsed, completedAt: snapshot.completedAt || null };
      cache.latestKey = key;
      saveReplayAiCache(cache);
      renderReplayAiReviewState('', parsed);
      return parsed;
    } catch (error) {
      renderReplayAiReviewState('AI review could not be generated for that selection.', null);
      if (mount) {
        mount.innerHTML += '<div class="proActionRow"><button class="btn" type="button" data-replay-ai-retry>Try again</button></div>';
        const retry = mount.querySelector('[data-replay-ai-retry]');
        if (retry) retry.addEventListener('click', function() { runReplayAiReview(test, dayIndex).catch(function() {}); });
      }
      return null;
    }
  }

  function renderAiReviewSnapshot(report) {
    const review = getReportAiReview(report);
    if (!review) {
      return '<div class="proMuted">No AI review stored for this session yet.</div>';
    }
    const strengths = Array.isArray(review.strengths) ? review.strengths.slice(0, 2) : [];
    const improvements = Array.isArray(review.improvements) ? review.improvements.slice(0, 2) : [];
    const findings = Array.isArray(review.keyBehaviourFindings) ? review.keyBehaviourFindings.slice(0, 3) : [];
    return `
      <div class="proDetailGrid">
        <div><span>Summary</span><b>${escapeHtml(review.executiveSummary || review.closingSummary || 'Not recorded')}</b></div>
        <div><span>Next objective</span><b>${escapeHtml(review.nextChallengeObjective || 'Not recorded')}</b></div>
      </div>
      <div class="proDetailNotes">
        <div class="proSectionTitle">Strengths</div>
        <div class="proNotes${strengths.length ? '' : ' dim'}">${escapeHtml(strengths.length ? strengths.map(function(item) { return item.summary || item.text || item.verdict || String(item); }).join(' · ') : 'Not recorded')}</div>
      </div>
      <div class="proDetailNotes">
        <div class="proSectionTitle">Improvements</div>
        <div class="proNotes${improvements.length ? '' : ' dim'}">${escapeHtml(improvements.length ? improvements.map(function(item) { return item.summary || item.text || item.verdict || String(item); }).join(' · ') : 'Not recorded')}</div>
      </div>
      <div class="proDetailNotes">
        <div class="proSectionTitle">Behaviour findings</div>
        <div class="proNotes${findings.length ? '' : ' dim'}">${escapeHtml(findings.length ? findings.map(function(item) { return item.summary || item.text || item.verdict || String(item); }).join(' · ') : 'Not recorded')}</div>
      </div>`;
  }

  function normaliseBotLabHistory(history) {
    return (Array.isArray(history) ? history : []).map(function(item) {
      const cfg = item && item.configuration || {};
      const comparison = item && item.comparisonMetrics || {};
      const managed = comparison.managed || {};
      const auto = comparison.autonomous || {};
      const mode = cfg.propRules ? 'Prop Challenge' : 'Sim Arcade';
      const completedAt = item.completedAt || item.updatedAt || item.createdAt || null;
      const netPL = managed.netProfit != null ? managed.netProfit : managed.netPL;
      const trades = managed.totalTrades;
      const score = reportValue(item, ['score', 'totalScore', 'points']);
      const drawdown = managed.maxDrawdown;
      const result = item.status === 'test_complete' ? 'Completed' : (item.status ? String(item.status).replace(/_/g, ' ') : 'Completed');
      const badges = ['Saved locally'];
      if (Number(netPL) > 0) badges.unshift('Profitable');
      return createSummary({
        id: 'botlab:' + String(item.testId || completedAt || Math.random()),
        kind: 'botlab',
        source: 'gt_botlab_history',
        title: cfg.botName || 'Bot Lab test',
        subtitle: cfg.botVersion ? `${cfg.botName || 'Bot Lab test'} v${cfg.botVersion}` : 'Bot Lab test',
        instrument: cfg.instrumentLabel || cfg.instrument || 'Not recorded',
        mode,
        result,
        netPL,
        score,
        trades,
        maxDrawdown: drawdown,
        breachStatus: cfg.propRules ? 'Not recorded' : 'No breach',
        dateLabel: formatDate(completedAt),
        currency: cfg.currency || '$',
        badges,
        good: Number(netPL) > 0 && Number(trades) > 0,
        notes: null,
        details: { comparison, testData: item, auto, managed }
      });
    });
  }

  function normaliseChallengeCompletion(item) {
    if (!item || typeof item !== 'object') return null;
    const currency = typeof challengeCurrency === 'function' ? challengeCurrency() : '$';
    const netPL = item.netProfit != null ? item.netProfit : item.calculatedMetrics && item.calculatedMetrics.totalNet;
    const trades = item.calculatedMetrics && item.calculatedMetrics.totalTrades != null
      ? item.calculatedMetrics.totalTrades
      : Array.isArray(item.trades) ? item.trades.length : null;
    const score = reportValue(item, ['score', 'calculatedMetrics.score']);
    const breachStatus = item.status === 'failed' ? 'Breached' : 'No breach';
    const badges = [item.status === 'passed' ? 'Passed' : 'Failed', Number(netPL) > 0 ? 'Profitable' : 'Failed', breachStatus, 'Saved locally'];
    const aiReview = item.aiReview || null;
    return createSummary({
      id: 'challenge:' + String(item.challengeId || item.snapshotHash || item.completedAt || Math.random()),
      kind: 'prop',
      source: 'tradeRider.challengeComplete.v1',
      title: item.challengeName || 'Prop Challenge',
      subtitle: item.challengeName || 'Prop Challenge',
      instrument: item.instrument || 'Not recorded',
      mode: 'Prop Challenge',
      result: item.status === 'passed' ? 'Passed' : 'Failed',
      netPL,
      score,
      trades,
      maxDrawdown: item.maximumIntradayDrawdown != null ? item.maximumIntradayDrawdown : item.maximumOverallDrawdown,
      breachStatus,
      dateLabel: formatDate(item.completedAt),
      currency,
      badges,
      good: item.status === 'passed' && Number(netPL) > 0 && Number(trades) > 0,
      notes: aiReview && aiReview.executiveSummary ? aiReview.executiveSummary : null,
      aiReview,
      details: { completion: item, phases: Array.isArray(item.phases) ? item.phases : [], days: Array.isArray(item.days) ? item.days : [], tradesList: Array.isArray(item.trades) ? item.trades : [], aiReview }
    });
  }

  function normaliseChallengeSnapshot(item) {
    if (!item || typeof item !== 'object') return null;
    const report = item.report || {};
    const currency = typeof challengeCurrency === 'function' ? challengeCurrency() : '$';
    const netPL = report.totalNetPL != null ? report.totalNetPL : report.netProfit;
    const trades = report.tradeCount != null ? report.tradeCount : (Array.isArray(item.trades) ? item.trades.length : null);
    const score = report.score != null ? report.score : null;
    const completionReason = String(report.completionReason || '').toLowerCase();
    const breached = completionReason.includes('breach') || report.breached === true;
    const breachStatus = breached ? 'Breached' : 'No breach';
    const badges = [breached ? 'Breached' : 'No breach', Number(netPL) > 0 ? 'Profitable' : 'Failed', 'Saved locally'];
    if (item.status === 'passed') badges.unshift('Passed');
    if (item.status === 'failed') badges.unshift('Failed');
    const aiReview = item.aiReview || report.aiReview || null;
    return createSummary({
      id: 'snapshot:' + String(item.dayKey || report.historicalDate || item.t || Math.random()),
      kind: 'prop-day',
      source: 'tradeRider.challengeSnapshotHistory.v1',
      title: report.phaseLabel || 'Challenge day',
      subtitle: report.phaseLabel || 'Challenge day',
      instrument: report.instrument || 'Not recorded',
      mode: 'Prop Challenge',
      result: report.readableReason || report.completionReason || 'Completed',
      netPL,
      score,
      trades,
      maxDrawdown: report.maxPeakToTroughDrawdown != null ? report.maxPeakToTroughDrawdown : report.maxDrawdown,
      breachStatus,
      dateLabel: formatDate(report.historicalDate || item.t),
      currency,
      badges,
      good: Number(netPL) > 0 && Number(trades) > 0 && !breached,
      notes: aiReview && aiReview.executiveSummary ? aiReview.executiveSummary : null,
      aiReview,
      details: { snapshot: item, report, tradesList: Array.isArray(item.trades) ? item.trades : [] }
    });
  }

  function normaliseStoredReports() {
    const reports = [];

    if (window.BotLab && BotLab.Storage && typeof BotLab.Storage.getHistory === 'function') {
      reports.push.apply(reports, normaliseBotLabHistory(BotLab.Storage.getHistory()));
    }

    const completion = readJSON('tradeRider.challengeComplete.v1', null);
    const challengeSnapshots = readJSON('tradeRider.challengeSnapshotHistory.v1', []);
    const currentSnapshot = readJSON('tradeRider.challengeSnapshot.v1', null);

    const completionReport = normaliseChallengeCompletion(completion);
    if (completionReport) reports.push(completionReport);

    (Array.isArray(challengeSnapshots) ? challengeSnapshots : []).forEach(function(item) {
      const report = normaliseChallengeSnapshot(item);
      if (report) reports.push(report);
    });

    const currentSnapshotReport = normaliseChallengeSnapshot(currentSnapshot);
    if (currentSnapshotReport) reports.push(currentSnapshotReport);

    const seen = new Set();
    return reports.filter(function(report) {
      if (!report || !report.id) return false;
      if (seen.has(report.id)) return false;
      seen.add(report.id);
      return true;
    });
  }

  function rankReport(report) {
    const passedProp = report.kind === 'prop' && report.result === 'Passed' ? 1 : 0;
    const score = Number.isFinite(Number(report.score)) ? Number(report.score) : -Infinity;
    const netPL = Number.isFinite(Number(report.netPL)) ? Number(report.netPL) : -Infinity;
    const drawdown = Number.isFinite(Number(report.maxDrawdown)) ? Number(report.maxDrawdown) : Infinity;
    const dateValue = report.dateLabel && report.dateLabel !== 'Not recorded' ? Date.parse(report.dateLabel) : 0;
    const modePref = report.mode === 'Prop Challenge' ? 1 : (report.mode === 'Sim Arcade' ? 0 : -1);
    return [passedProp, score, netPL, -drawdown, modePref, dateValue];
  }

  function compareRank(left, right) {
    const a = rankReport(left);
    const b = rankReport(right);
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return b[i] - a[i];
    }
    return 0;
  }

  function reportIsGood(report) {
    if (!report) return false;
    const net = Number(report.netPL);
    const trades = Number(report.trades);
    const score = report.score == null || Number(report.score) > 0;
    const breached = report.breachStatus === 'Breached';
    return Number.isFinite(net) && net > 0 && Number.isFinite(trades) && trades > 0 && score && !breached;
  }

  function getReports() {
    return normaliseStoredReports().sort(compareRank);
  }

  function getSelectedReportId() {
    return readJSON(SELECTED_REPORT_KEY, null);
  }

  function setSelectedReportId(id) {
    if (!id) {
      try {
        if (store && typeof store.remove === 'function') store.remove(SELECTED_REPORT_KEY);
        else localStorage.removeItem(SELECTED_REPORT_KEY);
      } catch (error) {}
      return;
    }
    writeValue(SELECTED_REPORT_KEY, JSON.stringify(id));
  }

  function getSelectedReplayId() {
    return readJSON(SELECTED_REPLAY_KEY, null);
  }

  function setSelectedReplayId(id) {
    if (!id) {
      try {
        if (store && typeof store.remove === 'function') store.remove(SELECTED_REPLAY_KEY);
        else localStorage.removeItem(SELECTED_REPLAY_KEY);
      } catch (error) {}
      return;
    }
    writeValue(SELECTED_REPLAY_KEY, JSON.stringify(id));
  }

  function selectReplayReport(id) {
    if (!id) return;
    setSelectedReplayId(id);
    setSelectedReportId(id);
  }

  function findReportById(id) {
    return getReports().find(function(report) { return report.id === id; }) || null;
  }

  function getLatestReport() {
    const reports = getReports();
    const good = reports.filter(reportIsGood);
    return good[0] || reports[0] || null;
  }

  function getActiveReport() {
    const selected = getSelectedReportId() || getSelectedReplayId();
    if (selected) {
      const item = findReportById(selected);
      if (item) return item;
    }
    return getLatestReport();
  }

  function getSelectedReplayReport() {
    const selected = getSelectedReplayId();
    if (selected) {
      const item = findReportById(selected);
      if (item) return item;
    }
    return getRecentReports()[0] || getActiveReport();
  }

  function routeFromHash() {
    const raw = String(location.hash || '').replace(/^#\/?/, '');
    if (!raw) return null;
    const route = raw.split('?')[0].split('&')[0].replace(/^\/?/, '');
    return ROUTES.has(route) ? route : null;
  }

  function normalizeRoute(route) {
    if (route === 'report/latest') return 'report/latest';
    return ROUTES.has(route) ? route : 'dashboard';
  }

  function setTheme(route) {
    const proRoutes = new Set(['dashboard', 'replay', 'prop', 'academy', 'reports', 'account', 'settings', 'report/latest', 'challenge/current']);
    const pro = proRoutes.has(route);
    if (!document.body) return;
    document.body.classList.toggle('theme-pro', pro);
    document.body.classList.toggle('theme-arcade', !pro);
  }

  function pageMeta(route) {
    return PAGE_META[normalizeRoute(route)] || PAGE_META.dashboard;
  }

  function navigate(route, reportId) {
    if (reportId) setSelectedReportId(reportId);
    route = normalizeRoute(route);
    const hash = '#/' + route;
    if (location.hash !== hash) location.hash = hash;
    else render(route);
  }

  async function startPropChallenge() {
    const manager = getChallengeManager();
    if (!manager) {
      if (typeof siteAlert === 'function') await siteAlert('Prop Challenge is unavailable right now.', 'Prop Challenge');
      return;
    }
    try {
      if (typeof Snd !== 'undefined' && Snd && typeof Snd.init === 'function') Snd.init();
      if (!manager.state && typeof manager.reset === 'function') {
        const created = await manager.reset(false);
        if (!created) return;
      }
      if (typeof manager.startOrResume === 'function') {
        const started = await manager.startOrResume();
        if (started === false && typeof siteAlert === 'function') {
          await siteAlert('Prop Challenge could not start.', 'Prop Challenge');
        }
        if (manager.state) {
          try { if (typeof toast === 'function') toast('Prop challenge started', 'good', 1400); } catch (error) {}
          renderProp();
        }
        return;
      }
      if (typeof siteAlert === 'function') await siteAlert('Prop Challenge is not ready yet.', 'Prop Challenge');
    } catch (error) {
      if (typeof siteAlert === 'function') await siteAlert('Prop Challenge could not start.', 'Prop Challenge');
    }
  }

  function launchMysteryChallenge(levelKey) {
    if (typeof startMystery === 'function') {
      return startMystery(levelKey);
    }
    return Promise.resolve();
  }

  async function promptMysteryCode() {
    if (typeof sitePrompt !== 'function' || typeof mysteryDecode !== 'function') return;
    const code = await sitePrompt('Mystery Challenge', 'Enter mystery code');
    if (!code) return;
    const key = mysteryDecode(code);
    if (!key) {
      if (typeof siteAlert === 'function') await siteAlert('Invalid code.', 'Mystery Challenge');
      return;
    }
    await launchMysteryChallenge(key);
  }

  const CHALLENGE_STORE_KEY = 'tradeRider.challenge.v2';
  const CHALLENGE_COMPLETE_KEY = 'tradeRider.challengeComplete.v1';
  const CHALLENGE_SNAPSHOT_KEY = 'tradeRider.challengeSnapshot.v1';
  const CHALLENGE_SNAPSHOT_HISTORY_KEY = 'tradeRider.challengeSnapshotHistory.v1';

  function getChallengeManager() {
    return typeof ChallengeManager !== 'undefined' ? ChallengeManager : null;
  }

  function getChallengeState() {
    const manager = getChallengeManager();
    if (manager && manager.state) return manager.state;
    const raw = readJSON(CHALLENGE_STORE_KEY, null);
    if (raw && typeof challengeNormalizeState === 'function') return challengeNormalizeState(raw);
    return raw;
  }

  function getChallengeCompletion() {
    return readJSON(CHALLENGE_COMPLETE_KEY, null);
  }

  function getChallengeSnapshot() {
    const manager = getChallengeManager();
    if (manager && typeof manager.currentReviewData === 'function') return manager.currentReviewData();
    return readJSON(CHALLENGE_SNAPSHOT_KEY, null);
  }

  function getChallengeSnapshotHistory() {
    return readJSON(CHALLENGE_SNAPSHOT_HISTORY_KEY, []);
  }

  function challengeActiveSummary(state) {
    if (!state) {
      return {
        status: 'No active challenge',
        phase: 'Not recorded',
        day: 'Not recorded',
        balance: 'Not recorded',
        daily: 'Not recorded',
        overall: 'Not recorded'
      };
    }
    const phase = state.plan && Array.isArray(state.plan.phases) && state.plan.phases[state.phaseIx]
      ? state.plan.phases[state.phaseIx]
      : null;
    const progress = state.progress && state.progress[state.phaseIx] ? state.progress[state.phaseIx] : null;
    const phaseDays = phase && Array.isArray(phase.days) ? phase.days.length : 0;
    const phaseDone = progress ? Number(progress.completed || 0) : 0;
    return {
      status: state.breachLocked ? 'Breached' : (state.status === 'passed' ? 'Passed' : (state.status === 'failed' ? 'Failed' : 'Active')),
      phase: phase ? `${phase.label || phase.key || 'Phase'} · ${phaseDone}/${phaseDays} days` : 'Not recorded',
      day: state.currentDayKey || 'Not recorded',
      balance: Number.isFinite(Number(state.currentEquity)) ? formatBalance(state.currentEquity, '$') : 'Not recorded',
      daily: Number.isFinite(Number(state.dailyBufferRemaining)) ? formatBalance(state.dailyBufferRemaining, '$') : 'Not recorded',
      overall: Number.isFinite(Number(state.overallBufferRemaining)) ? formatBalance(state.overallBufferRemaining, '$') : 'Not recorded'
    };
  }

  function challengePlanRows(state) {
    const phases = state && state.plan && Array.isArray(state.plan.phases) ? state.plan.phases : [];
    if (!phases.length) return '<div class="proMuted">No challenge plan is loaded yet.</div>';
    return phases.map(function(phase, index) {
      const progress = state.progress && state.progress[index] ? state.progress[index] : null;
      const days = Array.isArray(phase.days) ? phase.days.length : 0;
      return `<div class="proTimelineRow"><b>${escapeHtml(phase.label || phase.key || `Phase ${index + 1}`)}</b><span>${escapeHtml(String(progress && progress.completed != null ? progress.completed : 0))} / ${escapeHtml(String(days))} days</span><span>${progress && progress.passed ? 'Passed' : 'In progress'}</span></div>`;
    }).join('');
  }

  function challengeSnapshotRows(items) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return '<div class="proMuted">No saved challenge snapshots yet.</div>';
    return list.slice(-6).reverse().map(function(item) {
      const label = item && (item.phaseLabel || item.sessionName || 'Challenge');
      const day = item && (item.dayKey || item.report && item.report.historicalDate || 'Not recorded');
      return `<div class="proTimelineRow"><b>${escapeHtml(label)}</b><span>${escapeHtml(day)}</span><button class="btn" type="button" data-open-challenge-review="${escapeHtml(String(day))}">Review</button></div>`;
    }).join('');
  }

  function renderChallengeCurrent() {
    const state = getChallengeState();
    const completion = state ? (state.completedChallenge || getChallengeCompletion()) : getChallengeCompletion();
    const mystery = typeof Mystery !== 'undefined' ? Mystery : null;
    const snapshot = getChallengeSnapshot();
    const snapshots = getChallengeSnapshotHistory();
    const summary = challengeActiveSummary(state);
    const hasState = !!state;
    renderShell('challenge/current', `
      <div class="proContentStack">
        <div class="proSummaryRow">
          ${dashboardMetric('Status', mystery && mystery.active ? 'Mystery running' : 'Ready')}
          ${dashboardMetric('Code', mystery && mystery.code ? mystery.code : 'Not recorded')}
          ${dashboardMetric('Attempts', mystery && mystery.attempts != null ? String(mystery.attempts) : '0')}
          ${dashboardMetric('Latest snapshot', snapshot ? (snapshot.dayKey || snapshot.report && snapshot.report.historicalDate || 'Recorded') : 'Not recorded')}
        </div>
        <div class="proMainGrid">
          <div class="proMainCol">
            <div class="proPanel">
              <div class="proSectionHead">Mystery challenge</div>
              <div class="proDetailTitle">${escapeHtml(mystery && mystery.active ? 'Mystery day active' : 'Pick a hidden day')}</div>
              <div class="proMuted">Start a hidden day, then share the code so someone else can run the same session.</div>
              <div class="proActionRow">
                <button class="btn primary" type="button" data-mystery-start>Start mystery day</button>
                <button class="btn" type="button" data-mystery-code>Enter code</button>
                <button class="btn" type="button" data-route="prop">Prop challenge</button>
              </div>
            </div>
            <div class="proPanel">
              <div class="proSectionHead">How it works</div>
              <div class="proMuted">Mystery picks one historical day, creates a shareable code, and launches that hidden day for the trader.</div>
              <div class="proMuted">The code can be entered by another trader to open the same day from their loaded data.</div>
            </div>
            <div class="proPanel">
              <div class="proSectionHead">Latest mystery state</div>
              <div class="proStatList">
                <div><span>Code</span><b>${escapeHtml(mystery && mystery.code ? mystery.code : 'Not recorded')}</b></div>
                <div><span>Attempts</span><b>${escapeHtml(mystery && mystery.attempts != null ? String(mystery.attempts) : '0')}</b></div>
                <div><span>Mode</span><b>${escapeHtml(mystery && mystery.active ? 'Active' : 'Idle')}</b></div>
              </div>
            </div>
            <div class="proPanel">
              <div class="proSectionHead">Latest snapshot</div>
              ${snapshot ? latestCard({
                id: snapshot.dayKey || snapshot.report && snapshot.report.historicalDate || 'challenge-snapshot',
                instrument: snapshot.report && snapshot.report.instrument || (state && state.instrument) || 'Not recorded',
                mode: snapshot.report && snapshot.report.mode || 'Mystery Challenge',
                result: snapshot.report && snapshot.report.result || 'Not recorded',
                subtitle: snapshot.report && snapshot.report.sessionName || snapshot.phaseLabel || '',
                netPL: snapshot.report && snapshot.report.totalNetPL,
                score: snapshot.report && snapshot.report.score,
                trades: snapshot.report && snapshot.report.tradeCount,
                maxDrawdown: snapshot.report && snapshot.report.maximumIntradayDrawdown,
                breachStatus: snapshot.report && snapshot.report.completionReason ? snapshot.report.completionReason : 'Not recorded',
                dateLabel: snapshot.report && snapshot.report.historicalDate || 'Not recorded',
                currency: (state && state.currency) || '$',
                badges: []
              }) : '<div class="proMuted">No challenge snapshot is available yet.</div>'}
            </div>
          </div>
          <div class="proSideCol">
            <div class="proPanel">
              <div class="proSectionHead">Shared code history</div>
              ${challengeSnapshotRows(snapshots)}
            </div>
            <div class="proPanel">
              <div class="proSectionHead">Mystery notes</div>
              <div class="proMuted">Launch a hidden day or enter a shared code. The finished run is captured in the latest snapshot and report history.</div>
              <div class="proActionRow">
                <button class="btn" type="button" data-route="report/latest">Open latest report</button>
                <button class="btn" type="button" data-route="replay">Replay history</button>
              </div>
            </div>
            <div class="proPanel">
              <div class="proSectionHead">Loaded replay data</div>
              <div class="proStatList">
                <div><span>Instrument</span><b>${escapeHtml(state && state.instrument ? state.instrument : 'Not recorded')}</b></div>
                <div><span>Session</span><b>${escapeHtml(state && state.session ? state.session : 'Not recorded')}</b></div>
                <div><span>Phase</span><b>${escapeHtml(state && state.phaseIx != null ? String(Number(state.phaseIx) + 1) : 'Not recorded')}</b></div>
                <div><span>Mode</span><b>${escapeHtml(state && state.status ? state.status : 'Not recorded')}</b></div>
              </div>
            </div>
          </div>
        </div>
      </div>`);

    document.querySelectorAll('[data-mystery-start]').forEach(function(button) {
      button.addEventListener('click', function() { launchMysteryChallenge(); });
    });
    document.querySelectorAll('[data-mystery-code]').forEach(function(button) {
      button.addEventListener('click', function() { promptMysteryCode().catch(function() {}); });
    });
    document.querySelectorAll('[data-open-challenge-review]').forEach(function(button) {
      button.addEventListener('click', function() {
        navigate('report/latest');
      });
    });
  }

  function getHistoricalLevels() {
    return Array.isArray(window.LEVELS) ? LEVELS.filter(function(level) {
      return level && !level.academy;
    }) : [];
  }

  function historicalDayTs(level) {
    if (!level) return 0;
    const ts = Array.isArray(level.bars) && level.bars.length ? Number(level.bars[0][0]) * 1000 : 0;
    return Number.isFinite(ts) ? ts : 0;
  }

  function historicalWeekLabel(level) {
    const ts = historicalDayTs(level);
    const date = ts ? new Date(ts) : null;
    if (!date || Number.isNaN(date.getTime())) return 'Unsorted week';
    const start = new Date(date);
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} - ${end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
  }

  function groupHistoricalLevels() {
    const map = new Map();
    getHistoricalLevels().slice().sort(function(a, b) { return historicalDayTs(b) - historicalDayTs(a); }).forEach(function(level) {
      const key = historicalWeekLabel(level);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(level);
    });
    return Array.from(map.entries()).map(function(entry) {
      return { label: entry[0], levels: entry[1] };
    });
  }

  function openHistoricalDay(levelKey) {
    if (!levelKey) return;
    if (typeof startLevel === 'function') {
      const ix = Array.isArray(window.LEVELS) ? LEVELS.findIndex(function(level) { return level && level.key === levelKey; }) : -1;
      if (ix >= 0) {
        startLevel(ix);
        return;
      }
    }
    if (typeof startMystery === 'function') startMystery(levelKey);
  }

  function switchInstrument(key) {
    if (!key) return;
    if (typeof selectInstrument === 'function') {
      selectInstrument(key);
      return;
    }
    if (typeof show === 'function') show('instrumentMenu');
  }

  function openReplayTrainer() {
    try { if (location.hash) location.hash = ''; } catch (error) {}
    if (typeof show === 'function') show('menu');
  }

  function setReportFromButton(reportId) {
    if (reportId) setSelectedReportId(reportId);
    navigate('report/latest');
  }

  function badgeList(report) {
    const badges = Array.isArray(report.badges) ? report.badges.slice() : [];
    if (report.demo) badges.push('Demo example');
    if (report.source) badges.push('Saved locally');
    if (report.mode === 'Prop Challenge' && report.result === 'Passed') badges.push('Passed');
    if (Number(report.netPL) > 0) badges.push('Profitable');
    if (report.breachStatus === 'Breached') badges.push('Breached');
    else if (report.breachStatus === 'No breach') badges.push('No breach');
    const uniq = [];
    const seen = new Set();
    badges.forEach(function(badge) {
      if (!badge || seen.has(badge)) return;
      seen.add(badge);
      uniq.push(badge);
    });
    return uniq;
  }

  function renderShell(route, bodyHtml) {
    const mount = document.getElementById('proShell');
    if (!mount) return;
    route = normalizeRoute(route);
    setTheme(route);
    document.body.classList.toggle('pro-compact', !!getSettings().compactCards);
    show('proShell');
    const reportCount = getReports().length;
    const active = getActiveReport();
    const meta = pageMeta(route);
    const instrument = active ? active.instrument : (typeof CUR !== 'undefined' && CUR ? CUR.label || CUR.key.toUpperCase() : 'Not recorded');
    const mode = active ? active.mode : (typeof currentMode === 'function' ? currentMode().label : 'Not recorded');
    const profileLabel = reportCount ? `${reportCount} saved locally` : 'Guest mode';
    const nav = NAV_ITEMS.map(function(item) {
      const activeClass = route === item[0] || (route === 'report/latest' && item[0] === 'reports') ? ' active' : '';
      return `<button class="proSideNavItem${activeClass}" data-route="${item[0]}" type="button">${escapeHtml(item[1])}</button>`;
    }).join('');
    mount.innerHTML = `
      <div class="proApp">
        <aside class="proSidebar">
          <div class="proBrand">
            <div class="proBrandMark"><img src="images/TradeRider-trans.png?v=0.35.60" alt="Trade Rider Pro"></div>
            <div>
              <div class="proBrandName">Trade Rider Pro</div>
              <div class="proBrandSub">Trading journal and replay workspace</div>
            </div>
          </div>
          <div class="proSideSection">Navigation</div>
          <nav class="proSideNav">${nav}</nav>
          <div class="proSidebarFooter">
            <div class="proSidebarStat"><span>Instrument</span><b>${escapeHtml(instrument)}</b></div>
            <div class="proSidebarStat"><span>Mode</span><b>${escapeHtml(mode)}</b></div>
            <div class="proSidebarStat"><span>State</span><b>${escapeHtml(profileLabel)}</b></div>
            <div class="proVersion">v0.35.63</div>
          </div>
        </aside>
        <div class="proMain">
          <header class="proTopbar">
            <div>
              <div class="proPageKicker">${escapeHtml(meta.title)}</div>
            <div class="proPageTitle">${escapeHtml(meta.title)}</div>
            <div class="proPageSub">${escapeHtml(meta.sub)}</div>
          </div>
          <div class="proTopbarMeta">
              <button class="proIconBtn proMenuBtn" type="button" data-pro-menu-toggle title="Navigation">Menu</button>
              <button class="proIconBtn" type="button" data-route="account" title="Account">Account</button>
              <button class="proIconBtn" type="button" data-route="settings" title="Settings">Settings</button>
              <button class="proIconBtn" type="button" data-route="menu" title="Arcade">Arcade</button>
            </div>
          </header>
          <main class="proContent">
            ${bodyHtml}
          </main>
        </div>
      </div>`;

    mount.querySelectorAll('[data-route]').forEach(function(button) {
      button.addEventListener('click', function() {
        const target = button.getAttribute('data-route');
        document.body.classList.remove('pro-nav-open');
        if (target === 'menu') {
          try { location.hash = ''; } catch (error) {}
          setTheme('menu');
          show('menu');
          return;
        }
        navigate(target);
      });
    });

    const menuToggle = mount.querySelector('[data-pro-menu-toggle]');
    if (menuToggle) {
      menuToggle.addEventListener('click', function() {
        document.body.classList.toggle('pro-nav-open');
      });
    }
  }

  function latestCard(report) {
    if (!report) return '';
    const badges = badgeList(report).map(function(text) {
      const tone = text === 'Passed' || text === 'Profitable' || text === 'No breach' ? ' good' : (text === 'Breached' || text === 'Failed' ? ' bad' : '');
      return reportBadge(text, tone.trim());
    }).join('');
    const currency = report.currency || '$';
    return `
      <div class="proPanel proLatestCard">
        <div class="proCardHead">
          <div>
            <div class="proCardKicker">Latest Session</div>
            <div class="proCardTitle">${escapeHtml(report.instrument)} · ${escapeHtml(report.mode)}</div>
          </div>
          <div class="proBadgeRow">${badges}</div>
        </div>
        <div class="proLatestMain">
          <div class="proLatestResult">${escapeHtml(report.result)}</div>
          ${report.subtitle ? `<div class="proLatestMeta">${escapeHtml(report.subtitle)}</div>` : ''}
          <div class="proLatestPnl ${Number(report.netPL) >= 0 ? 'good' : 'bad'}">${formatMoney(report.netPL, currency)}</div>
          <div class="proLatestMeta">Score: ${escapeHtml(formatScore(report.score))}</div>
          <div class="proLatestMeta">Trades: ${escapeHtml(formatTrades(report.trades))}</div>
          <div class="proLatestMeta">Max drawdown: ${escapeHtml(formatDrawdown(report.maxDrawdown, currency))}</div>
          <div class="proLatestMeta">Breach status: ${escapeHtml(report.breachStatus || 'Not recorded')}</div>
          <div class="proLatestMeta">Date: ${escapeHtml(report.dateLabel || 'Not recorded')}</div>
        </div>
        ${report.demo ? '' : '<div class="proActionRow"><button class="btn primary" type="button" data-open-latest>View Report</button></div>'}
      </div>`;
  }

  function renderDashboard() {
    const reports = getReports();
    const latest = getLatestReport();
    const currency = latest ? latest.currency : '$';
    const propReport = reports.find(function(report) { return report.kind === 'prop'; }) || latest || null;
    const kpis = [
      dashboardMetric('Balance', latest && latest.details && latest.details.completion ? formatBalance(latest.details.completion.finalBalance, currency) : 'Not recorded'),
      dashboardMetric('Latest P/L', latest ? formatMoney(latest.netPL, currency) : 'Not recorded', latest && latest.score != null ? `Score ${formatScore(latest.score)}` : null),
      dashboardMetric('Sessions saved', String(reports.length), 'Saved locally'),
      dashboardMetric('Prop status', propReport ? propReport.breachStatus || propReport.result || 'Not recorded' : 'No active challenge'),
      dashboardMetric('Win rate', latest && latest.details && latest.details.completion && latest.details.completion.calculatedMetrics ? `${Number(latest.details.completion.calculatedMetrics.winRate || 0).toFixed(1)}%` : 'Not recorded'),
      dashboardMetric('Max drawdown', latest ? formatDrawdown(latest.maxDrawdown, currency) : 'Not recorded')
    ].join('');
    const reportRows = reports.length ? reports.slice(0, 6) : [];
    const propCard = propReport && propReport.kind === 'prop'
      ? latestCard(propReport)
      : `
        <div class="proPanel proLatestCard">
          <div class="proCardHead"><div><div class="proCardKicker">Prop Challenge Progress</div><div class="proCardTitle">No active prop challenge yet</div></div></div>
          <div class="proMuted">Start a prop challenge to track phase progress and buffers here.</div>
          <div class="proActionRow"><button class="btn primary" type="button" data-start-prop>Start Prop Challenge</button></div>
        </div>`;
    const latestPanel = latest ? latestCard(latest) : `
      <div class="proPanel proLatestCard">
        <div class="proEmptyTitle">${escapeHtml(EMPTY_TEXT.title)}</div>
        <div class="proEmptyBody">${escapeHtml(EMPTY_TEXT.body)}</div>
        <div class="proEmptyNote">${escapeHtml(EMPTY_TEXT.note)}</div>
        <div class="proBadgeRow">${reportBadge('Demo example', 'demo')}</div>
      </div>`;
    const recentPanel = reports.length ? reportsTable(reportRows) : `
      <div class="proMuted">No saved sessions yet.</div>
      <div class="proMuted">Start a replay to build your trading history.</div>
      <div class="proMuted">Guest reports are stored only on this device.</div>`;

    renderShell('dashboard', `
      <div class="proContentStack">
        <div class="proSummaryRow">${kpis}</div>
        <div class="proMainGrid">
          <div class="proMainCol">${latestPanel}</div>
          <div class="proSideCol">${propCard}</div>
        </div>
        <div class="proPanel">
          <div class="proSectionHead">Recent Reports</div>
          ${recentPanel}
        </div>
      </div>`);
    bindLatestButton(latest ? latest.id : null);
    bindReportRows();
    document.querySelectorAll('[data-start-prop]').forEach(function(button) {
      button.addEventListener('click', function() { startPropChallenge().catch(function() {}); });
    });
  }

  function bindLatestButton(reportId) {
    const button = document.querySelector('[data-open-latest]');
    if (button) button.addEventListener('click', function() { setReportFromButton(reportId || getLatestReport()?.id); });
  }

  function dashboardMetric(label, value, sub, tone) {
    return `<div class="proStatBox${tone ? ' ' + tone : ''}"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</div>`;
  }

  function reportsTable(reports) {
    const rows = (Array.isArray(reports) ? reports : []).map(function(report) {
      const currency = report.currency || '$';
      return `<tr data-report-row="${escapeHtml(report.id)}">
        <td>${escapeHtml(report.dateLabel || 'Not recorded')}</td>
        <td>${escapeHtml(report.instrument || 'Not recorded')}</td>
        <td>${escapeHtml(report.mode || 'Not recorded')}</td>
        <td>${escapeHtml(report.result || 'Not recorded')}</td>
        <td class="${Number(report.netPL) >= 0 ? 'good' : 'bad'}">${escapeHtml(formatMoney(report.netPL, currency))}</td>
        <td>${escapeHtml(formatTrades(report.trades))}</td>
        <td>${escapeHtml(formatDrawdown(report.maxDrawdown, currency))}</td>
        <td>${escapeHtml(report.breachStatus || 'Not recorded')}</td>
        <td><button class="btn" type="button" data-report-view="${escapeHtml(report.id)}">View Report</button></td>
      </tr>`;
    }).join('');
    return `<div class="proTableWrap"><table class="proTable"><thead><tr><th>Date</th><th>Instrument</th><th>Mode</th><th>Result</th><th>P/L</th><th>Trades</th><th>Drawdown</th><th>Breach</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="9" class="proTableEmpty">Not recorded</td></tr>'}</tbody></table></div>`;
  }

  function latestSummaryCards(report) {
    const currency = report ? report.currency || '$' : '$';
    return [
      dashboardMetric('Instrument', report ? report.instrument : 'Not recorded'),
      dashboardMetric('Mode', report ? report.mode : 'Not recorded'),
      dashboardMetric('Result', report ? report.result : 'Not recorded'),
      dashboardMetric('P/L', report ? formatMoney(report.netPL, currency) : 'Not recorded', null, report && Number(report.netPL) >= 0 ? 'good' : 'bad'),
      dashboardMetric('Trades', report ? formatTrades(report.trades) : 'Not recorded'),
      dashboardMetric('Max drawdown', report ? formatDrawdown(report.maxDrawdown, currency) : 'Not recorded')
    ].join('');
  }

  function renderReports() {
    const reports = getReports();
    if (!reports.length) {
      const demo = createSummary(DEMO_REPORT);
      renderShell('reports', `
        <div class="proContentStack">
          <div class="proSummaryRow">
            ${dashboardMetric('Reports', '0')}
            ${dashboardMetric('Status', 'Guest mode')}
            ${dashboardMetric('Saved locally', 'No')}
          </div>
          <div class="proPanel">
            <div class="proEmptyTitle">${escapeHtml(EMPTY_TEXT.title)}</div>
            <div class="proEmptyBody">${escapeHtml(EMPTY_TEXT.body)}</div>
            <div class="proEmptyNote">${escapeHtml(EMPTY_TEXT.note)}</div>
          </div>
          <div class="proPanel">
            <div class="proSectionHead">Demo example</div>
            ${renderReportRow(demo, true)}
          </div>
        </div>`);
      return;
    }

    const firstGood = reports.find(reportIsGood) || reports[0];
    const ordered = [firstGood].concat(reports.filter(function(report) { return report.id !== firstGood.id; }));
    const rows = ordered.map(function(report) {
      return renderReportRow(report, false);
    }).join('');
    renderShell('reports', `
      <div class="proContentStack">
        <div class="proSummaryRow">
          ${dashboardMetric('Reports', String(reports.length))}
          ${dashboardMetric('Latest', firstGood ? firstGood.instrument : 'Not recorded')}
          ${dashboardMetric('Mode', firstGood ? firstGood.mode : 'Not recorded')}
        </div>
        <div class="proPanel">
          <div class="proSectionHead">Saved Reports</div>
          ${reportsTable(ordered)}
        </div>
      </div>`);
    bindReportRows();
  }

  function renderReportRow(report, demo) {
    const badges = badgeList(report).slice(0, 3).map(function(text) {
      const tone = text === 'Passed' || text === 'Profitable' || text === 'No breach' ? ' good' : (text === 'Breached' || text === 'Failed' ? ' bad' : '');
      return reportBadge(text, tone.trim());
    }).join('');
    const currency = report.currency || '$';
    return `
      <div class="proReportRow${demo ? ' demo' : ''}" data-report-id="${escapeHtml(report.id)}">
        <div class="proReportMain">
          <div class="proReportHeadLine">
            <b>${escapeHtml(report.dateLabel || 'Not recorded')}</b>
            <span>${escapeHtml(report.instrument || 'Not recorded')} · ${escapeHtml(report.mode || 'Not recorded')}</span>
          </div>
          <div class="proReportResult">${escapeHtml(report.result || 'Not recorded')}</div>
          ${report.subtitle ? `<div class="proLatestMeta">${escapeHtml(report.subtitle)}</div>` : ''}
          <div class="proBadgeRow">${badges}${demo ? reportBadge('Demo example', 'demo') : ''}</div>
        </div>
        <div class="proReportMetrics">
          <div><span>P/L</span><b class="${Number(report.netPL) >= 0 ? 'good' : 'bad'}">${escapeHtml(formatMoney(report.netPL, currency))}</b></div>
          <div><span>Score</span><b>${escapeHtml(formatScore(report.score))}</b></div>
          <div><span>Trades</span><b>${escapeHtml(formatTrades(report.trades))}</b></div>
          <div><span>Max drawdown</span><b>${escapeHtml(formatDrawdown(report.maxDrawdown, currency))}</b></div>
          <div><span>Breach</span><b>${escapeHtml(report.breachStatus || 'Not recorded')}</b></div>
        </div>
        <div class="proReportActions">${demo ? '<div class="proMuted">Demo example</div>' : '<button class="btn" type="button" data-report-view="' + escapeHtml(report.id) + '">View Report</button>'}</div>
      </div>`;
  }

  function bindReportRows() {
    document.querySelectorAll('[data-report-view]').forEach(function(button) {
      button.addEventListener('click', function() {
        const id = button.getAttribute('data-report-view');
        if (id) setReportFromButton(id);
      });
    });
  }

  function renderLatest() {
    const selectedId = getSelectedReportId();
    const reports = getReports();
    const selected = selectedId ? findReportById(selectedId) : null;
    const report = selected || getLatestReport();

    if (!report) {
      navigate('reports');
      return;
    }

    if (selectedId && !selected) {
      navigate('reports');
      return;
    }

    const currency = report.currency || '$';
    const review = getReportAiReview(report);
    const detailCompletion = report.details && report.details.completion ? report.details.completion : null;
    const detailSnapshot = report.details && report.details.snapshot && report.details.snapshot.report ? report.details.snapshot.report : null;
    const notes = report.notes ? `<div class="proNotes">${escapeHtml(report.notes)}</div>` : (review && review.executiveSummary ? `<div class="proNotes">${escapeHtml(review.executiveSummary)}</div>` : `<div class="proNotes dim">Not recorded</div>`);
    const tradeCount = detailCompletion && detailCompletion.calculatedMetrics ? detailCompletion.calculatedMetrics.totalTrades : (detailSnapshot && detailSnapshot.tradeCount != null ? detailSnapshot.tradeCount : report.trades);
    const winRate = detailCompletion && detailCompletion.calculatedMetrics ? Number(detailCompletion.calculatedMetrics.winRate || 0).toFixed(1) + '%' : (detailSnapshot && detailSnapshot.winRate != null ? Number(detailSnapshot.winRate).toFixed(1) + '%' : 'Not recorded');
    const tradeList = Array.isArray(report.details && report.details.completion && report.details.completion.trades)
      ? report.details.completion.trades
      : Array.isArray(report.details && report.details.tradesList) ? report.details.tradesList : [];
    const tradeRows = tradeList.length ? tradeList.slice(0, 20).map(function(trade, ix) {
      const side = Number(trade.dir) === 1 ? 'LONG' : (Number(trade.dir) === -1 ? 'SHORT' : 'Not recorded');
      return `<tr><td>${ix + 1}</td><td>${escapeHtml(side)}</td><td>${escapeHtml(trade.dayId || trade.dayKey || 'Not recorded')}</td><td>${escapeHtml(formatMoney(trade.pl, currency))}</td><td>${escapeHtml(String(trade.reason || 'Not recorded').replace(/_/g, ' '))}</td></tr>`;
    }).join('') : '';
    renderShell('report/latest', `
      <div class="proContentStack">
        <div class="proSummaryRow">
          ${dashboardMetric('Instrument', report.instrument || 'Not recorded')}
          ${dashboardMetric('Mode', report.mode || 'Not recorded')}
          ${dashboardMetric('P/L', formatMoney(report.netPL, currency), null, Number(report.netPL) >= 0 ? 'good' : 'bad')}
          ${dashboardMetric('Trades', formatTrades(tradeCount))}
          ${dashboardMetric('Win rate', winRate)}
          ${dashboardMetric('Max drawdown', formatDrawdown(report.maxDrawdown, currency))}
        </div>
        <div class="proMainGrid">
          <div class="proMainCol">
            <div class="proPanel proDetailPanel">
              <div class="proDetailHead">
                <div>
                  <div class="proSectionHead">Latest Report</div>
                  <div class="proDetailTitle">${escapeHtml(report.result || 'Not recorded')}</div>
                  <div class="proDetailSub">${escapeHtml(report.dateLabel || 'Not recorded')}</div>
                </div>
                <div class="proBadgeRow">${badgeList(report).map(function(text) {
                  const tone = text === 'Passed' || text === 'Profitable' || text === 'No breach' ? ' good' : (text === 'Breached' || text === 'Failed' ? ' bad' : '');
                  return reportBadge(text, tone.trim());
                }).join('')}</div>
              </div>
              <div class="proDetailGrid">
                <div><span>Balance start/end</span><b>${escapeHtml(report.details && report.details.completion ? formatBalance(report.details.completion.startingBalance, currency) + ' / ' + formatBalance(report.details.completion.finalBalance, currency) : 'Not recorded')}</b></div>
                <div><span>Breach status</span><b>${escapeHtml(report.breachStatus || 'Not recorded')}</b></div>
                <div><span>Score</span><b>${escapeHtml(formatScore(report.score))}</b></div>
                <div><span>Session</span><b>${escapeHtml(report.dateLabel || 'Not recorded')}</b></div>
              </div>
              <div class="proDetailNotes">
                <div class="proSectionTitle">Discipline notes</div>
                ${notes}
              </div>
              <div class="proDetailNotes">
                <div class="proSectionTitle">AI review</div>
                ${renderAiReviewSnapshot(report)}
              </div>
              <div class="proDetailNotes">
                <div class="proSectionTitle">Trade list</div>
                <div class="proTableWrap"><table class="proTable"><thead><tr><th>#</th><th>Side</th><th>Day</th><th>P/L</th><th>Reason</th></tr></thead><tbody>${tradeRows || '<tr><td colspan="5" class="proTableEmpty">Not recorded</td></tr>'}</tbody></table></div>
              </div>
              <div class="proActionRow"><button class="btn" type="button" data-back-reports>Back to Reports</button></div>
            </div>
          </div>
          <div class="proSideCol">
            ${latestCard(report)}
          </div>
        </div>
      </div>`);

    const back = document.querySelector('[data-back-reports]');
    if (back) back.addEventListener('click', function() { navigate('reports'); });
    if (reports.length && !selected && selectedId) navigate('reports');
  }

  function renderProp() {
    const manager = getChallengeManager();
    const liveState = manager && manager.state ? manager.state : null;
    const report = getActiveReport();
    const completion = report && report.kind === 'prop' && report.details && report.details.completion ? report.details.completion : null;
    const days = completion && Array.isArray(completion.days) ? completion.days : [];
    const phases = completion && Array.isArray(completion.phases) ? completion.phases : [];
    const startBalance = completion && completion.startingBalance != null ? completion.startingBalance : null;
    const finalBalance = completion && completion.finalBalance != null ? completion.finalBalance : null;
    const targetBalance = completion && completion.targetBalance != null ? completion.targetBalance : null;
    const dailyBuffer = completion && completion.minimumDailyBufferRemaining != null ? completion.minimumDailyBufferRemaining : null;
    const propStatus = liveState ? (liveState.breachLocked ? 'Breached' : (liveState.status === 'passed' ? 'Passed' : (liveState.status === 'failed' ? 'Failed' : 'Running'))) : (report ? (report.breachStatus === 'Breached' ? 'Breached' : (report.result === 'Passed' ? 'Passed' : 'Failed')) : 'Not recorded');
    const livePhase = liveState && liveState.plan && Array.isArray(liveState.plan.phases) ? liveState.plan.phases[liveState.phaseIx] : null;
    const liveProgress = liveState && liveState.progress && liveState.progress[liveState.phaseIx] ? liveState.progress[liveState.phaseIx] : null;
    const recentChallenges = getReplaySeries().filter(function(item) { return item.kind === 'prop-day' || item.kind === 'prop'; }).slice(0, 4);
    const progressCards = [
      dashboardMetric('Days completed', liveProgress ? String(liveProgress.completed || 0) : (completion ? String(days.length) : 'Not recorded')),
      dashboardMetric('Balance/equity', liveState ? `${formatBalance(liveState.balance, '$')} / ${formatBalance(liveState.startBalance, '$')}` : (completion ? `${formatBalance(startBalance, report.currency)} / ${formatBalance(finalBalance, report.currency)}` : 'Not recorded')),
      dashboardMetric('Target progress', livePhase ? `${escapeHtml(livePhase.label || livePhase.key || 'Phase')} · ${escapeHtml(String(liveProgress && liveProgress.completed != null ? liveProgress.completed : 0))}/${escapeHtml(String(Array.isArray(livePhase.days) ? livePhase.days.length : 0))}` : (completion && targetBalance != null ? formatBalance(targetBalance, report.currency) : 'Not recorded')),
      dashboardMetric('Daily loss buffer', liveState ? formatBalance(liveState.dailyBufferRemaining, '$') : (completion ? formatMoney(dailyBuffer, report.currency) : 'Not recorded')),
      dashboardMetric('Status', propStatus),
      dashboardMetric('Max loss buffer', liveState ? formatBalance(liveState.overallBufferRemaining, '$') : (completion && completion.minimumOverallBufferRemaining != null ? formatBalance(completion.minimumOverallBufferRemaining, report.currency) : 'Not recorded'))
    ].join('');
    const phaseRows = liveState && liveState.plan && Array.isArray(liveState.plan.phases)
      ? liveState.plan.phases.map(function(phase, ix) {
        const progress = liveState.progress && liveState.progress[ix] ? liveState.progress[ix] : null;
        return `<div class="proTimelineRow"><b>${escapeHtml(phase.label || phase.phaseId || 'Phase')}</b><span>${escapeHtml(String(progress && progress.completed != null ? progress.completed : 0))} / ${escapeHtml(String(Array.isArray(phase.days) ? phase.days.length : 0))} days</span><span>${progress && progress.passed ? 'Passed' : 'In progress'}</span></div>`;
      }).join('')
      : phases.length ? phases.map(function(phase) {
      return `<div class="proTimelineRow"><b>${escapeHtml(phase.name || phase.phaseId || 'Phase')}</b><span>${escapeHtml(String(phase.daysCompleted || 0))} / ${escapeHtml(String(phase.daysRequired || 0))} days</span><span>${phase.passed ? 'Passed' : 'In progress'}</span></div>`;
    }).join('') : '<div class="proEmptyBody">Not recorded</div>';
    const actionLabel = liveState ? 'Resume active prop challenge' : (completion ? 'Resume challenge' : 'Start Prop Challenge');
    const rulesPanel = liveState ? `
      <div class="proPanel">
        <div class="proSectionHead">Rules</div>
        <div class="proStatList">
          <div><span>Daily loss buffer</span><b>${escapeHtml(formatBalance(liveState.dailyBufferRemaining, '$'))}</b></div>
          <div><span>Max loss buffer</span><b>${escapeHtml(formatBalance(liveState.overallBufferRemaining, '$'))}</b></div>
          <div><span>Challenge status</span><b>${escapeHtml(propStatus)}</b></div>
        </div>
      </div>` : completion ? `
      <div class="proPanel">
        <div class="proSectionHead">Rules</div>
        <div class="proStatList">
          <div><span>Daily loss buffer</span><b>${escapeHtml(formatBalance(completion.minimumDailyBufferRemaining, report.currency))}</b></div>
          <div><span>Max loss buffer</span><b>${escapeHtml(formatBalance(completion.minimumOverallBufferRemaining, report.currency))}</b></div>
          <div><span>Challenge status</span><b>${escapeHtml(propStatus)}</b></div>
        </div>
      </div>` : `
      <div class="proPanel">
        <div class="proSectionHead">Rules</div>
        <div class="proMuted">No active challenge. Start one to track daily loss buffer, max loss buffer, and phase completion here.</div>
      </div>`;

    if (!report || report.kind !== 'prop' || !completion) {
      renderShell('prop', `
      <div class="proContentStack">
        <div class="proSummaryRow">
          ${dashboardMetric('Status', liveState ? 'Active challenge loaded' : 'No active prop challenge yet')}
          ${dashboardMetric('Days completed', liveState && liveProgress ? String(liveProgress.completed || 0) : 'Not recorded')}
          ${dashboardMetric('Daily buffer', liveState ? formatBalance(liveState.dailyBufferRemaining, '$') : 'Not recorded')}
          </div>
          <div class="proMainGrid">
          <div class="proMainCol">
            <div class="proPanel">
              <div class="proEmptyTitle">${escapeHtml(liveState ? 'Active prop challenge loaded' : 'No active prop challenge yet')}</div>
              <div class="proEmptyBody">${escapeHtml(liveState ? 'Continue the active run or let it play out in the challenge area.' : 'Prop progress only appears when the selected session belongs to Prop Challenge.')}</div>
              <div class="proActionRow">
                <button class="btn primary" type="button" data-start-prop>Start / resume prop challenge</button>
                <button class="btn" type="button" data-route="replay">Review replay history</button>
              </div>
            </div>
            ${rulesPanel}
          </div>
            <div class="proSideCol">
              <div class="proPanel">
                <div class="proSectionHead">Previous challenge reports</div>
                ${reportsTable(getReports().filter(function(item) { return item.kind === 'prop'; }).slice(0, 4))}
              </div>
              <div class="proPanel">
                <div class="proSectionHead">Recent day series</div>
                ${recentChallenges.length ? recentChallenges.map(function(item) {
                  return `<div class="proTimelineRow"><b>${escapeHtml(item.dateLabel || 'Not recorded')}</b><span>${escapeHtml(item.instrument || 'Not recorded')} · ${escapeHtml(item.result || 'Not recorded')}</span><button class="btn" type="button" data-report-view="${escapeHtml(item.id)}">Open</button></div>`;
                }).join('') : '<div class="proMuted">No finished day snapshots yet.</div>'}
              </div>
            </div>
          </div>
        </div>`);
      document.querySelectorAll('[data-start-prop]').forEach(function(button) {
        button.addEventListener('click', function() { startPropChallenge().catch(function() {}); });
      });
      bindReportRows();
      return;
    }

    renderShell('prop', `
      <div class="proContentStack">
        <div class="proSummaryRow">${progressCards}</div>
        <div class="proMainGrid">
          <div class="proMainCol">
            <div class="proPanel">
              <div class="proSectionHead">Prop Challenge Progress</div>
              <div class="proStatGrid">${progressCards}</div>
              <div class="proSectionTitle">Progress</div>
              <div class="proTimeline">${phaseRows}</div>
              <div class="proActionRow">
                <button class="btn primary" type="button" data-open-challenge>${escapeHtml(actionLabel)}</button>
                <button class="btn" type="button" data-route="report/latest">Open latest report</button>
              </div>
            </div>
            ${rulesPanel}
          </div>
          <div class="proSideCol">
            ${latestCard(report)}
            <div class="proPanel">
              <div class="proSectionHead">AI review</div>
              ${renderAiReviewSnapshot(report)}
            </div>
          </div>
        </div>
        <div class="proPanel">
          <div class="proSectionHead">Previous challenge reports</div>
          ${reportsTable(getReports().filter(function(item) { return item.kind === 'prop'; }).slice(0, 6))}
        </div>
      </div>`);
    bindLatestButton(report.id);
    bindReportRows();
    document.querySelectorAll('[data-open-challenge]').forEach(function(button) {
      button.addEventListener('click', function() { startPropChallenge().catch(function() {}); });
    });
  }

  function renderAccount() {
    const reports = getReports();
    const latest = getLatestReport();
    const latestReview = getReportAiReview(latest);
    const latestSummary = latest ? `Latest report: ${latest.instrument} · ${latest.mode} · ${latest.result}` : 'No saved sessions yet.';
    renderShell('account', `
      <div class="proContentStack">
        <div class="proSummaryRow">
          ${dashboardMetric('Reports saved', String(reports.length))}
          ${dashboardMetric('Latest session', latest ? latest.result : 'Not recorded')}
          ${dashboardMetric('Storage', 'Saved locally')}
          ${dashboardMetric('Cloud sync', 'Not available')}
        </div>
        <div class="proMainGrid">
          <div class="proMainCol">
            <div class="proPanel">
              <div class="proSectionHead">Guest mode</div>
              <div class="proDetailTitle">Guest mode</div>
              <div class="proBadgeRow">${reportBadge('Guest only', 'demo')}${reportBadge('Saved locally', 'good')}</div>
              <div class="proMuted">Reports are saved on this device.</div>
              <div class="proMuted">Create an account later to sync challenge history and reports across devices.</div>
              <div class="proActionRow">
                <button class="btn primary" type="button" data-guest-continue>Continue as guest</button>
                <button class="btn" type="button" data-open-latest-account>Open latest report</button>
                <button class="btn" type="button" data-start-prop-account>Start prop challenge</button>
                <button class="btn" type="button" data-guest-login>Login</button>
                <button class="btn" type="button" data-create-account>Create account</button>
              </div>
            </div>
          </div>
          <div class="proSideCol">
            <div class="proPanel">
              <div class="proSectionHead">Account-ready</div>
              <div class="proAccountCard">
                <div class="proDetailTitle">Profile card</div>
                <div class="proMuted">Reports saved: ${escapeHtml(String(reports.length))}</div>
                <div class="proMuted">${escapeHtml(latestSummary)}</div>
                <div class="proMuted">Prop challenge history: ${escapeHtml(latestReview && latestReview.nextChallengeObjective ? latestReview.nextChallengeObjective : 'Stored locally')}</div>
                ${latest ? latestCard(latest) : '<div class="proMuted">Not recorded</div>'}
              </div>
            </div>
            <div class="proPanel">
              <div class="proSectionHead">Local storage</div>
              <div class="proStatList">
                <div><span>Report count</span><b>${escapeHtml(String(reports.length))}</b></div>
                <div><span>Latest session</span><b>${escapeHtml(latest ? `${latest.instrument} · ${latest.mode}` : 'Not recorded')}</b></div>
                <div><span>Storage</span><b>Saved locally</b></div>
                <div><span>Selection</span><b>${escapeHtml(getSelectedReportId() || 'None')}</b></div>
              </div>
              <div class="proActionRow">
                <button class="btn" type="button" data-clear-selection>Clear selection</button>
              </div>
            </div>
          </div>
        </div>
      </div>`);

    const create = document.querySelector('[data-create-account]');
    if (create) create.addEventListener('click', function() { try { toast('Account creation is not available in this demo.', 'info', 1800); } catch (error) {} });
    const guestContinue = document.querySelector('[data-guest-continue]');
    if (guestContinue) guestContinue.addEventListener('click', function() { navigate('dashboard'); });
    const openLatest = document.querySelector('[data-open-latest-account]');
    if (openLatest) openLatest.addEventListener('click', function() { if (latest) setReportFromButton(latest.id); });
    document.querySelectorAll('[data-start-prop-account]').forEach(function(button) {
      button.addEventListener('click', function() { startPropChallenge().catch(function() {}); });
    });
    const guestLogin = document.querySelector('[data-guest-login]');
    if (guestLogin) guestLogin.addEventListener('click', function() { try { toast('Login is not connected in this demo.', 'info', 1800); } catch (error) {} });
    const clearSelection = document.querySelector('[data-clear-selection]');
    if (clearSelection) clearSelection.addEventListener('click', function() {
      setSelectedReportId(null);
      setSelectedReplayId(null);
      renderAccount();
    });
    if (latest) bindLatestButton(latest.id);
  }

  function renderReplay() {
    const reports = getRecentReports();
    const selected = getSelectedReplayReport();
    const latest = selected || reports[0] || getLatestReport();
    const recent = reports.slice(0, 5);
    const replaySeries = getReplaySeries().filter(function(report) { return report.kind === 'prop-day'; }).slice(0, 8);
    const groupedLevels = groupHistoricalLevels().slice(0, 6);
    const hasUstec = !!(window.INSTRUMENTS && INSTRUMENTS.ustec);
    const botLabHistory = botLabCompletedTests().slice(0, 4);
    renderShell('replay', `
      <div class="proContentStack">
        <div class="proSummaryRow">
          ${dashboardMetric('Selected instrument', latest ? latest.instrument : 'Not recorded')}
          ${dashboardMetric('Mode', latest ? latest.mode : 'Not recorded')}
          ${dashboardMetric('Recent sessions', String(reports.length))}
          ${dashboardMetric('Selected run', latest ? latest.dateLabel : 'Not recorded')}
        </div>
        <div class="proMainGrid">
          <div class="proMainCol">
            <div class="proPanel">
              <div class="proSectionHead">Replay workspace</div>
              <div class="proStatList">
                <div><span>Instrument selector</span><b>${escapeHtml(latest ? latest.instrument : 'DE40 / GOLD / USTEC')}</b></div>
                <div><span>Mode selector</span><b>${escapeHtml(latest ? latest.mode : 'Sim Arcade')}</b></div>
                <div><span>Replay session list</span><b>${escapeHtml(String(reports.length))} saved sessions</b></div>
                <div><span>Series filter</span><b>${escapeHtml(String(replaySeries.length))} day reviews</b></div>
              </div>
              <div class="proSectionTitle">Selected replay details</div>
              ${latest ? latestCard(latest) : '<div class="proMuted">Not recorded</div>'}
              <div class="proPanel" style="margin-top:14px;padding:14px">
              <div class="proSectionHead">Replay AI review</div>
                ${renderAiReviewSnapshot(latest)}
              </div>
              <div class="proActionRow">
        <button class="btn primary" type="button" data-open-arcade>Open Replay Trainer</button>
                <button class="btn" type="button" data-start-prop>Start prop challenge</button>
                <button class="btn" type="button" data-route="reports">Review reports</button>
              </div>
            </div>
          </div>
          <div class="proSideCol">
            <div class="proPanel">
              <div class="proSectionHead">Recent replay sessions</div>
              ${reportsTable(recent)}
            </div>
            <div class="proPanel">
              <div class="proSectionHead">Back-to-back day series</div>
              ${replaySeries.length ? replaySeries.map(function(report) {
                const active = selected && report.id === selected.id ? ' active' : '';
                return `<div class="proTimelineRow${active}"><b>${escapeHtml(report.dateLabel || 'Not recorded')}</b><span>${escapeHtml(report.instrument || 'Not recorded')} · ${escapeHtml(report.result || 'Not recorded')}</span><button class="btn" type="button" data-series-open="${escapeHtml(report.id)}">Open</button></div>`;
              }).join('') : '<div class="proMuted">No day series available yet.</div>'}
            </div>
            <div class="proPanel">
              <div class="proSectionHead">Historical day picker</div>
              <div class="proMuted">Pick a loaded week, then open any historical day in the legacy replay trainer.</div>
              <div class="proActionRow">
                <button class="btn" type="button" data-switch-inst="de40">DE40</button>
                ${hasUstec ? '<button class="btn" type="button" data-switch-inst="ustec">USTEC</button>' : ''}
                <button class="btn" type="button" data-route="challenge/current">Mystery challenge</button>
              </div>
              ${groupedLevels.length ? groupedLevels.map(function(group) {
                return `
                  <div class="proDetailNotes">
                    <div class="proSectionTitle">${escapeHtml(group.label)}</div>
                    <div class="proTimeline">${group.levels.slice(0, 6).map(function(level) {
                      return `<div class="proTimelineRow"><b>${escapeHtml(level.day || 'Historical day')}</b><span>${escapeHtml(level.date || 'Not recorded')}</span><button class="btn" type="button" data-day-open="${escapeHtml(level.key)}">Open day</button></div>`;
                    }).join('')}</div>
                  </div>`;
              }).join('') : '<div class="proMuted">No historical levels are loaded yet.</div>'}
            </div>
            <div class="proPanel">
              <div class="proSectionHead">AI review library</div>
              <div class="proMuted">Pick any completed Bot Lab day or review a full week of replay history.</div>
              <div class="proDetailNotes" data-pro-botlab-ai-review>
                <div class="proMuted">Select a Bot Lab test below to generate a review.</div>
              </div>
              ${botLabHistory.length ? botLabHistory.map(function(test) {
                const cfg = test.configuration || {};
                const days = Array.isArray(test.completedDays) ? test.completedDays : [];
                return `
                  <div class="proDetailNotes">
                    <div class="proSectionTitle">${escapeHtml((cfg.botName || 'Bot Lab') + ' · ' + (cfg.instrumentLabel || cfg.instrument || 'Not recorded'))}</div>
                    <div class="proMuted">${escapeHtml(String(days.length || 0))} completed day${days.length === 1 ? '' : 's'} · ${escapeHtml(cfg.sessionWindow || 'Session not recorded')}</div>
                    <div class="proActionRow">
                      <button class="btn primary" type="button" data-botlab-week-review="${escapeHtml(test.testId)}">Review week</button>
                    </div>
                    <div class="proTimeline">${days.length ? days.map(function(day) {
                      const label = `Day ${Number(day.dayIndex || 0) + 1}`;
                      return `<div class="proTimelineRow"><b>${escapeHtml(label)}</b><span>${escapeHtml(day.dayId || 'Not recorded')}</span><button class="btn" type="button" data-botlab-day-review="${escapeHtml(test.testId)}" data-botlab-day-index="${escapeHtml(String(day.dayIndex || 0))}">Review day</button></div>`;
                    }).join('') : '<div class="proMuted">No day snapshots saved for this test.</div>'}</div>
                  </div>`;
              }).join('') : '<div class="proMuted">No completed Bot Lab tests were found yet.</div>'}
            </div>
          </div>
        </div>
      </div>`);
    const launch = document.querySelector('[data-open-arcade]');
    if (launch) launch.addEventListener('click', function() { openReplayTrainer(); });
    document.querySelectorAll('[data-start-prop]').forEach(function(button) {
      button.addEventListener('click', function() { startPropChallenge().catch(function() {}); });
    });
    document.querySelectorAll('[data-series-open]').forEach(function(button) {
      button.addEventListener('click', function() {
        const id = button.getAttribute('data-series-open');
        if (!id) return;
        selectReplayReport(id);
        navigate('report/latest', id);
      });
    });
    document.querySelectorAll('[data-day-open]').forEach(function(button) {
      button.addEventListener('click', function() {
        openHistoricalDay(button.getAttribute('data-day-open'));
      });
    });
    document.querySelectorAll('[data-switch-inst]').forEach(function(button) {
      button.addEventListener('click', function() {
        switchInstrument(button.getAttribute('data-switch-inst'));
      });
    });
    document.querySelectorAll('[data-botlab-week-review]').forEach(function(button) {
      button.addEventListener('click', function() {
        const testId = button.getAttribute('data-botlab-week-review');
        const test = botLabCompletedTests().find(function(item) { return item && item.testId === testId; });
        if (test) runReplayAiReview(test, null).catch(function() {});
      });
    });
    document.querySelectorAll('[data-botlab-day-review]').forEach(function(button) {
      button.addEventListener('click', function() {
        const testId = button.getAttribute('data-botlab-day-review');
        const dayIndex = Number(button.getAttribute('data-botlab-day-index'));
        const test = botLabCompletedTests().find(function(item) { return item && item.testId === testId; });
        if (test) runReplayAiReview(test, dayIndex).catch(function() {});
      });
    });
    bindReportRows();
  }

  function renderAcademy() {
    renderShell('academy', `
      <div class="proContentStack">
        <div class="proSummaryRow">
          ${dashboardMetric('Lessons', 'Not recorded')}
          ${dashboardMetric('Trade examples', 'Not recorded')}
          ${dashboardMetric('Local notes', 'Saved locally')}
        </div>
        <div class="proMainGrid">
          <div class="proMainCol">
            <div class="proPanel">
              <div class="proSectionHead">Academy</div>
              <div class="proDetailTitle">Professional training workspace</div>
              <div class="proMuted">Reference notes, trade examples, and future curriculum placeholders belong here.</div>
            </div>
          </div>
          <div class="proSideCol">
            <div class="proPanel">
              <div class="proSectionHead">Recent learning</div>
              <div class="proStatList">
                <div><span>Pattern library</span><b>Not recorded</b></div>
                <div><span>Trade notes</span><b>Not recorded</b></div>
                <div><span>Replay clips</span><b>Not recorded</b></div>
              </div>
            </div>
          </div>
        </div>
      </div>`);
  }

  function renderSettings() {
    const settings = getSettings();
    const landingLabel = settings.landingRoute === 'replay' ? 'Replay' : (settings.landingRoute === 'reports' ? 'Reports' : 'Overview');
    renderShell('settings', `
      <div class="proContentStack">
        <div class="proSummaryRow">
          ${dashboardMetric('Appearance', settings.compactCards ? 'Compact cards' : 'Professional dark')}
          ${dashboardMetric('Gameplay defaults', landingLabel)}
          ${dashboardMetric('Sound', settings.soundHints ? 'Enabled' : 'Muted')}
          ${dashboardMetric('Chart prefs', 'Saved locally')}
        </div>
        <div class="proMainGrid">
          <div class="proMainCol">
            <div class="proPanel">
              <div class="proSectionHead">Settings</div>
              <div class="proStatList">
                <div><span>Appearance</span><b>${escapeHtml(settings.compactCards ? 'Compact cards' : 'Professional dark')}</b><button class="btn" type="button" data-toggle-compact>Toggle</button></div>
                <div><span>Gameplay default</span><b>${escapeHtml(landingLabel)}</b><button class="btn" type="button" data-cycle-landing>Cycle</button></div>
                <div><span>Sound</span><b>${escapeHtml(settings.soundHints ? 'Enabled' : 'Muted')}</b><button class="btn" type="button" data-toggle-sound>Toggle</button></div>
                <div><span>Chart preferences</span><b>Saved locally</b><button class="btn" type="button" data-reset-settings>Reset</button></div>
              </div>
            </div>
          </div>
          <div class="proSideCol">
            <div class="proPanel">
              <div class="proSectionHead">Account placeholder</div>
              <div class="proMuted">This area keeps the Pro shell state local until real account sync is available.</div>
              <div class="proActionRow">
                <button class="btn primary" type="button" data-route="account">Open account</button>
                <button class="btn" type="button" data-route="dashboard">Back to overview</button>
              </div>
            </div>
          </div>
        </div>
      </div>`);
    const toggleCompact = document.querySelector('[data-toggle-compact]');
    if (toggleCompact) toggleCompact.addEventListener('click', function() {
      updateSetting('compactCards', !getSettings().compactCards);
      renderSettings();
    });
    const cycleLanding = document.querySelector('[data-cycle-landing]');
    if (cycleLanding) cycleLanding.addEventListener('click', function() {
      const current = getSettings().landingRoute;
      const next = current === 'dashboard' ? 'replay' : (current === 'replay' ? 'reports' : 'dashboard');
      updateSetting('landingRoute', next);
      renderSettings();
    });
    const toggleSound = document.querySelector('[data-toggle-sound]');
    if (toggleSound) toggleSound.addEventListener('click', function() {
      updateSetting('soundHints', !getSettings().soundHints);
      renderSettings();
    });
    const resetSettings = document.querySelector('[data-reset-settings]');
    if (resetSettings) resetSettings.addEventListener('click', function() {
      saveSettings(DEFAULT_SETTINGS);
      renderSettings();
    });
  }

  function render(routeOverride) {
    const route = routeOverride || routeFromHash() || 'dashboard';
    const selected = getSelectedReportId();
    const reports = getReports();
    if (selected && !findReportById(selected)) setSelectedReportId(null);
    if (route === 'dashboard') renderDashboard();
    else if (route === 'replay') renderReplay();
    else if (route === 'academy') renderAcademy();
    else if (route === 'reports') renderReports();
    else if (route === 'report/latest') renderLatest();
    else if (route === 'prop') renderProp();
    else if (route === 'challenge/current') renderChallengeCurrent();
    else if (route === 'settings') renderSettings();
    else if (route === 'account') renderAccount();
    else renderDashboard();
  }

  function boot() {
    if (!routeFromHash()) return;
    render(routeFromHash());
  }

  window.addEventListener('hashchange', function() {
    if (routeFromHash()) render(routeFromHash());
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  return {
    render,
    navigate,
    getReports,
    getLatestReport,
    getActiveReport,
    reportIsGood
  };
})();
