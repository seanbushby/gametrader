'use strict';
window.BotLab = window.BotLab || {};

BotLab.Report = (function() {
  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function metric(data, primary, alias) {
    data = data || {};
    return number(data[primary] != null ? data[primary] : data[alias]);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatCurrency(amount, currency) {
    const value = number(amount);
    return (value >= 0 ? '+' : '-') + (currency || '$') + Math.abs(value).toFixed(0);
  }

  function formatPct(pct) {
    return number(pct).toFixed(1) + '%';
  }

  function formatDuration(ms) {
    const mins = Math.round(number(ms) / 60000);
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  }

  function renderComparisonTable(autoMetrics, managedMetrics, currency) {
    const auto = autoMetrics || {};
    const managed = managedMetrics || {};
    currency = currency || '$';
    return [
      ['Net profit', formatCurrency(metric(auto, 'netPL', 'netProfit'), currency), formatCurrency(metric(managed, 'netPL', 'netProfit'), currency)],
      ['Return', formatPct(auto.returnPct), formatPct(managed.returnPct)],
      ['Maximum drawdown', currency + number(auto.maxDrawdown).toFixed(0), currency + number(managed.maxDrawdown).toFixed(0)],
      ['Profit factor', number(auto.profitFactor).toFixed(2), number(managed.profitFactor).toFixed(2)],
      ['Win rate', formatPct(auto.winRate), formatPct(managed.winRate)],
      ['Total trades', String(number(auto.totalTrades)), String(number(managed.totalTrades))],
      ['Average trade', formatCurrency(auto.avgTrade, currency), formatCurrency(managed.avgTrade, currency)],
      ['Largest winner', formatCurrency(metric(auto, 'largestWin', 'largestWinner'), currency), formatCurrency(metric(managed, 'largestWin', 'largestWinner'), currency)],
      ['Largest loser', formatCurrency(metric(auto, 'largestLoss', 'largestLoser'), currency), formatCurrency(metric(managed, 'largestLoss', 'largestLoser'), currency)],
      ['Average holding time', formatDuration(auto.avgHoldingTime), formatDuration(managed.avgHoldingTime)],
      ['Peak equity', currency + number(auto.peakEquity).toFixed(0), currency + number(managed.peakEquity).toFixed(0)],
      ['Lowest equity', currency + number(auto.lowestEquity).toFixed(0), currency + number(managed.lowestEquity).toFixed(0)],
      ['Final balance', currency + metric(auto, 'closingBalance', 'finalBalance').toFixed(0), currency + metric(managed, 'closingBalance', 'finalBalance').toFixed(0)]
    ];
  }

  function renderInterventionReport(matchedInterventions) {
    const matches = Array.isArray(matchedInterventions) ? matchedInterventions.filter(Boolean) : [];
    const manualCloses = matches.filter(function(match) {
      return match.intervention && match.intervention.action === 'MANUAL_CLOSE';
    });
    const stopInterventions = matches.filter(function(match) {
      const action = match.intervention && match.intervention.action;
      return action === 'ADD_STOP' || action === 'MOVE_STOP';
    });

    function summary(items) {
      return {
        total: items.length,
        improved: items.filter(function(match) { return match.impact === 'improved'; }).length,
        worsened: items.filter(function(match) { return match.impact === 'worsened'; }).length,
        noEffect: items.filter(function(match) { return match.impact === 'no_effect'; }).length,
        netImpact: items.reduce(function(sum, match) { return sum + number(match.directPLDiff); }, 0)
      };
    }

    return {
      manualCloses: summary(manualCloses),
      stopInterventions: summary(stopInterventions),
      overallImpact: matches.reduce(function(sum, match) { return sum + number(match.directPLDiff); }, 0)
    };
  }

  function formatMarketTime(timestamp) {
    const raw = Number(timestamp);
    if (!Number.isFinite(raw)) return '-';
    const milliseconds = raw > 1e11 ? raw : raw * 1000;
    return new Date(milliseconds).toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function formatPrice(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '-';
  }

  function formatSize(value) {
    if (!Number.isFinite(Number(value))) return '-';
    return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function renderTradeLedgerHTML(trades, title, currency, emptyReason, startingBalance) {
    const list = (Array.isArray(trades) ? trades : []).slice().sort(function(left, right) {
      return number(left.entryTs != null ? left.entryTs : left.entryTimestamp) - number(right.entryTs != null ? right.entryTs : right.entryTimestamp);
    });
    const hasRunningBalance = Number.isFinite(Number(startingBalance));
    let runningBalance = Number(startingBalance);
    let html = '<div class="blTradeLedger"><div class="blTradeLedgerHead">' + escapeHtml(title || 'Trades') + '</div>';
    if (!list.length) return html + '<div class="blNoTrades">' + escapeHtml(emptyReason || 'No completed trades') + '</div></div>';
    if (hasRunningBalance) html += '<div class="blLedgerOpening">Starting balance: ' + (currency || '$') + runningBalance.toFixed(2) + '</div>';
    html += '<div class="blTradeTableWrap"><table class="blTradeTable"><thead><tr>' +
      '<th>#</th><th>Day</th><th>Side</th><th>Lots</th><th>Entry UK</th><th>Entry</th><th>Exit UK</th><th>Exit</th><th>P/L</th>' + (hasRunningBalance ? '<th>Balance</th>' : '') + '<th>Reason</th>' +
      '</tr></thead><tbody>';
    list.forEach(function(trade, index) {
      const direction = Number(trade.dir) === 1 || trade.direction === 'long' ? 'LONG' : 'SHORT';
      const pl = number(trade.pl != null ? trade.pl : trade.pnl);
      if (hasRunningBalance) runningBalance += pl;
      html += '<tr><td>' + (index + 1) + '</td><td>' + escapeHtml(trade.dayId || '-') + '</td>' +
        '<td class="' + (direction === 'LONG' ? 'good' : 'bad') + '">' + direction + '</td>' +
        '<td>' + formatSize(trade.size) + '</td><td>' + formatMarketTime(trade.entryTs != null ? trade.entryTs : trade.entryTimestamp) + '</td>' +
        '<td>' + formatPrice(trade.entry != null ? trade.entry : trade.entryPrice) + '</td>' +
        '<td>' + formatMarketTime(trade.outTs != null ? trade.outTs : trade.exitTimestamp) + '</td>' +
        '<td>' + formatPrice(trade.exit != null ? trade.exit : trade.exitPrice) + '</td>' +
        '<td class="' + (pl >= 0 ? 'good' : 'bad') + '">' + formatCurrency(pl, currency) + '</td>' +
        (hasRunningBalance ? '<td>' + (currency || '$') + runningBalance.toFixed(2) + '</td>' : '') +
        '<td>' + escapeHtml(String(trade.reason || '-').replace(/_/g, ' ')) + '</td></tr>';
    });
    return html + '</tbody></table></div></div>';
  }

  function curveValues(curve) {
    return (Array.isArray(curve) ? curve : []).map(function(point) {
      if (typeof point === 'number') return number(point);
      if (!point || typeof point !== 'object') return NaN;
      return Number(point.equity != null ? point.equity : point.balance != null ? point.balance : point.value);
    }).filter(Number.isFinite);
  }

  function svgShell(width, height, contents) {
    width = Math.max(1, number(width));
    height = Math.max(1, number(height));
    return '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Equity curve">' + contents + '</svg>';
  }

  function curvePoints(curve, min, range, width, height, maxLen) {
    if (curve.length < 2) return '';
    const padding = 4;
    return curve.map(function(value, index) {
      const x = padding + (index / Math.max(1, maxLen - 1)) * (width - padding * 2);
      const y = padding + (height - padding * 2) - ((value - min) / range) * (height - padding * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
  }

  function renderEquityCurveSVG(curve, width, height, color) {
    const values = curveValues(curve);
    width = Math.max(1, number(width));
    height = Math.max(1, number(height));
    if (values.length < 2) return svgShell(width, height, '');
    const min = Math.min.apply(null, values);
    const range = Math.max.apply(null, values) - min || 1;
    return svgShell(width, height, '<polyline points="' + curvePoints(values, min, range, width, height, values.length) +
      '" fill="none" stroke="' + escapeHtml(color || '#00e58c') + '" stroke-width="1.5"/>');
  }

  function renderDualEquitySVG(autoCurve, managedCurve, width, height) {
    const auto = curveValues(autoCurve);
    const managed = curveValues(managedCurve);
    const all = auto.concat(managed);
    width = Math.max(1, number(width));
    height = Math.max(1, number(height));
    if (all.length < 2) return svgShell(width, height, '');
    const min = Math.min.apply(null, all);
    const range = Math.max.apply(null, all) - min || 1;
    const maxLen = Math.max(auto.length, managed.length);
    const autoPoints = curvePoints(auto, min, range, width, height, maxLen);
    const managedPoints = curvePoints(managed, min, range, width, height, maxLen);
    return svgShell(width, height,
      (autoPoints ? '<polyline points="' + autoPoints + '" fill="none" stroke="#8b93a7" stroke-width="1.5" stroke-dasharray="4,3"/>' : '') +
      (managedPoints ? '<polyline points="' + managedPoints + '" fill="none" stroke="#00e58c" stroke-width="1.5"/>' : ''));
  }

  function renderDayComparisonHTML(dayResult, currency) {
    dayResult = dayResult || {};
    const auto = dayResult.autonomousMetrics || {};
    const managed = dayResult.managedMetrics || {};
    const diff = metric(managed, 'netPL', 'netProfit') - metric(auto, 'netPL', 'netProfit');
    currency = currency || '$';
    return '<div class="blDayCompare">' +
      '<div class="blDayHeader"><span class="blDayLabel blAuto">BOT ALONE</span><span class="blDayVs">vs</span><span class="blDayLabel blManaged">YOU MANAGING</span></div>' +
      '<div class="blDayRow"><span>' + formatCurrency(metric(auto, 'netPL', 'netProfit'), currency) + '</span><span class="blDayKey">Net P/L</span><span>' + formatCurrency(metric(managed, 'netPL', 'netProfit'), currency) + '</span></div>' +
      '<div class="blDayRow"><span>' + number(auto.maxDrawdown).toFixed(0) + '</span><span class="blDayKey">Max DD</span><span>' + number(managed.maxDrawdown).toFixed(0) + '</span></div>' +
      '<div class="blDayRow"><span>' + number(auto.totalTrades) + '</span><span class="blDayKey">Trades</span><span>' + number(managed.totalTrades) + '</span></div>' +
      '<div class="blDayRow"><span>' + formatPct(auto.winRate) + '</span><span class="blDayKey">Win Rate</span><span>' + formatPct(managed.winRate) + '</span></div>' +
      '<div class="blDayRow"><span>' + number(auto.profitFactor).toFixed(2) + '</span><span class="blDayKey">Profit Factor</span><span>' + number(managed.profitFactor).toFixed(2) + '</span></div>' +
      '<div class="blDayRow"><span>' + formatCurrency(auto.avgTrade, currency) + '</span><span class="blDayKey">Avg Trade</span><span>' + formatCurrency(managed.avgTrade, currency) + '</span></div>' +
      '<div class="blDayRow"><span>' + formatCurrency(metric(auto, 'largestWin', 'largestWinner'), currency) + '</span><span class="blDayKey">Largest Win</span><span>' + formatCurrency(metric(managed, 'largestWin', 'largestWinner'), currency) + '</span></div>' +
      '<div class="blDayRow"><span>' + formatCurrency(metric(auto, 'largestLoss', 'largestLoser'), currency) + '</span><span class="blDayKey">Largest Loss</span><span>' + formatCurrency(metric(managed, 'largestLoss', 'largestLoser'), currency) + '</span></div>' +
      '<div class="blDayRow"><span>' + currency + metric(auto, 'closingBalance', 'finalBalance').toFixed(0) + '</span><span class="blDayKey">Closing Balance</span><span>' + currency + metric(managed, 'closingBalance', 'finalBalance').toFixed(0) + '</span></div>' +
      '<div class="blDayResult"><span class="' + (diff >= 0 ? 'good' : 'bad') + '">Management difference: ' + formatCurrency(diff, currency) + '</span></div></div>';
  }

  function renderMetricCol(data, currency) {
    const rows = renderComparisonTable(data, data, currency);
    return rows.map(function(row) {
      return '<div class="blTestRow"><span class="blTestKey">' + row[0] + '</span><span class="blTestVal">' + row[1] + '</span></div>';
    }).join('');
  }

  function renderTestComparisonHTML(testComparison, currency) {
    testComparison = testComparison || {};
    const impact = number(testComparison.managementImpact);
    currency = currency || '$';
    return '<div class="blTestCompare"><div class="blTestHero"><div class="blTestHeroKicker">BOT MANAGEMENT TEST COMPLETE</div></div>' +
      '<div class="blTestGrid"><div class="blTestCol"><div class="blTestColHead blAuto">BOT ALONE</div>' + renderMetricCol(testComparison.autonomous, currency) + '</div>' +
      '<div class="blTestCol"><div class="blTestColHead blManaged">YOU MANAGING</div>' + renderMetricCol(testComparison.managed, currency) + '</div></div>' +
      '<div class="blTestImpact ' + (impact >= 0 ? 'pos' : 'neg') + '">Management impact: ' + formatCurrency(impact, currency) + '</div></div>';
  }

  return {
    formatCurrency,
    formatPct,
    formatDuration,
    renderComparisonTable,
    renderInterventionReport,
    renderTradeLedgerHTML,
    renderEquityCurveSVG,
    renderDualEquitySVG,
    renderDayComparisonHTML,
    renderTestComparisonHTML
  };
})();
