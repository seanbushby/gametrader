'use strict';
window.BotLab = window.BotLab || {};
BotLab.UI = BotLab.UI || {};

BotLab.UI.ReportScreen = (function() {
  let _testData = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function open(testData) {
    _testData = testData || null;
    const daySummary = document.getElementById('botLabDaySummary');
    if (daySummary) daySummary.style.display = 'none';
    show('botLabReport');
    renderReport();
  }

  function openFromHistory(testId) {
    const item = BotLab.Storage.getHistoryItem(testId);
    if (item) open(item);
    else alert('Test not found.');
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value.length === 10 ? value + 'T00:00:00' : value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-GB');
  }

  function getDateRange(data, cfg) {
    const selected = Array.isArray(data.selectedDays) ? data.selectedDays : [];
    const dates = selected.map(function(day) { return day && (day.date || day.key); }).filter(Boolean).sort();
    const from = cfg.dateFrom || dates[0];
    const to = cfg.dateTo || dates[dates.length - 1];
    if (!from && !to) return 'N/A';
    if (!to || from === to) return formatDate(from || to);
    return formatDate(from) + ' - ' + formatDate(to);
  }

  function renderReport() {
    const container = document.getElementById('botLabReport');
    if (!container || !_testData) return;
    const cfg = _testData.configuration || {};
    const comparison = _testData.comparisonMetrics || {};
    const auto = comparison.autonomous || {};
    const managed = comparison.managed || {};
    const includeBotAlone = cfg.includeBotAlone !== false;
    const impact = number(comparison.managementImpact);
    const currency = '$';
    const selectedDays = Array.isArray(_testData.selectedDays) ? _testData.selectedDays : [];
    const completedDays = number(comparison.daysTested) || selectedDays.length || number(cfg.days);
    const plannedDays = selectedDays.length || number(cfg.days);
    const matched = includeBotAlone ? BotLab.ComparisonMetrics.matchInterventionsToTrades(_testData.interventions, managed.trades, auto.trades) : [];
    const interventionReport = BotLab.Report.renderInterventionReport(matched);

    let html = '<div class="blReportCard">';
    html += '<div class="blReportHead"><div><div class="blReportTitle">' + (cfg.blindRun ? 'BLIND BOT RUN COMPLETE' : 'BOT MANAGEMENT TEST COMPLETE') + '</div>' +
      '<div class="blReportSub">' + (includeBotAlone ? 'Frozen comparison of autonomous bot versus human-managed bot performance.' : 'Completed managed-bot run.') + '</div></div>' +
      '<div class="blReportActions"><button class="btn primary" onclick="BotLab.UI.ReportScreen.backToHub()">Back to Bot Lab</button></div></div>';
    html += '<div class="blReportHero"><div class="blReportHeroMain"><div class="blReportMetaGrid">';
    html += '<div class="blReportMeta"><div class="blMetaLb">Bot</div><div class="blMetaVl">' + escapeHtml(cfg.botName || 'Unknown') + ' v' + escapeHtml(cfg.botVersion || '1.0') + '</div></div>';
    html += '<div class="blReportMeta"><div class="blMetaLb">Instrument</div><div class="blMetaVl">' + escapeHtml(cfg.instrumentLabel || cfg.instrument || 'DE40') + '</div></div>';
    html += '<div class="blReportMeta"><div class="blMetaLb">Date range</div><div class="blMetaVl">' + escapeHtml(getDateRange(_testData, cfg)) + '</div></div>';
    html += '<div class="blReportMeta"><div class="blMetaLb">Days completed</div><div class="blMetaVl">' + completedDays + (plannedDays > completedDays ? ' of ' + plannedDays + ' (partial)' : '') + '</div></div>';
    html += '<div class="blReportMeta"><div class="blMetaLb">Session</div><div class="blMetaVl">' + escapeHtml(cfg.sessionWindow || '08:00-11:00') + '</div></div>';
    html += '<div class="blReportMeta"><div class="blMetaLb">Starting balance</div><div class="blMetaVl">' + currency + number(cfg.startBalance || 10000).toLocaleString() + '</div></div>';
    html += '<div class="blReportMeta"><div class="blMetaLb">Completed</div><div class="blMetaVl">' + escapeHtml(formatDate(_testData.completedAt) || 'N/A') + '</div></div>';
    html += '</div></div>' + (includeBotAlone ? '<div class="blReportHeroAside"><div class="blReportImpact ' + (impact >= 0 ? 'pos' : 'neg') + '">' +
      '<div class="blImpactLabel">Management Impact</div><div class="blImpactVal">' + BotLab.Report.formatCurrency(impact, currency) + '</div>' +
      '<div class="blImpactSub">' + (impact > 0 ? 'Managing improved performance' : impact < 0 ? 'Managing harmed performance' : 'No difference') + '</div></div></div>' : '') + '</div>';

    if (includeBotAlone) {
      html += '<div class="blReportCompareTable"><div class="blCompareHead"><div class="blCompareCol"></div><div class="blCompareCol blAuto">BOT ALONE</div><div class="blCompareCol blManaged">YOU MANAGING</div></div>';
      BotLab.Report.renderComparisonTable(auto, managed, currency).forEach(function(row) {
        html += '<div class="blCompareRow"><div class="blCompareCol blCompareKey">' + row[0] + '</div><div class="blCompareCol">' + row[1] + '</div><div class="blCompareCol">' + row[2] + '</div></div>';
      });
      html += '</div>';
    }

    html += '<div class="blReportSection"><div class="blReportSectionHead">Full Test Trade Ledger</div><div class="blTradeLedgers">' +
      (includeBotAlone ? BotLab.Report.renderTradeLedgerHTML(auto.trades, 'Bot Alone', currency, null, number(cfg.startBalance || 10000)) : '') +
      BotLab.Report.renderTradeLedgerHTML(managed.trades, includeBotAlone ? 'You Managing' : 'Run Result', currency, null, number(cfg.startBalance || 10000)) +
      '</div></div>';

    if (includeBotAlone) {
      html += '<div class="blReportSection"><div class="blReportSectionHead">Intervention Analysis</div><div class="blIntAnalysis">';
      html += interventionCard('Manual Closes', interventionReport.manualCloses, currency);
      html += interventionCard('Stop Interventions', interventionReport.stopInterventions, currency);
      html += '<div class="blIntCard"><div class="blIntCardHead">Overall</div><div>Total interventions: ' + matched.length + '</div><div>Net attributable impact: ' + BotLab.Report.formatCurrency(interventionReport.overallImpact, currency) + '</div></div></div></div>';
    }

    html += '<div class="blReportSection"><div class="blReportSectionHead">Equity Curves</div><div class="blChartRow"><div class="blChartBox">' +
      '<div class="blChartLabel">' + (includeBotAlone ? 'Bot Alone vs You Managing' : 'Run Result') + '</div>' +
      (includeBotAlone ? BotLab.Report.renderDualEquitySVG(auto.equityCurve, managed.equityCurve, 600, 200) : BotLab.Report.renderEquityCurveSVG(managed.equityCurve, 600, 200, '#00e58c')) +
      '</div></div></div></div>';
    container.innerHTML = html;
  }

  function interventionCard(title, report, currency) {
    report = report || {};
    return '<div class="blIntCard"><div class="blIntCardHead">' + title + '</div>' +
      '<div>Total: ' + number(report.total) + '</div><div>Improved: ' + number(report.improved) + '</div>' +
      '<div>Worsened: ' + number(report.worsened) + '</div><div>No effect: ' + number(report.noEffect) + '</div>' +
      '<div>Net impact: ' + BotLab.Report.formatCurrency(report.netImpact, currency) + '</div></div>';
  }

  function backToHub() {
    const daySummary = document.getElementById('botLabDaySummary');
    if (daySummary) daySummary.style.display = 'none';
    BotLab.UI.HubScreen.render();
    show('botLabHub');
  }

  return { open, openFromHistory, renderReport, backToHub };
})();
