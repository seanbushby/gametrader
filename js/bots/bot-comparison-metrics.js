'use strict';
window.BotLab = window.BotLab || {};

BotLab.ComparisonMetrics = (function() {
  function number(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : (fallback == null ? 0 : fallback);
  }

  function tradePL(trade) {
    return number(trade && (trade.pl != null ? trade.pl : trade.pnl));
  }

  function tradeEntry(trade) {
    return number(trade && (trade.entryTs != null ? trade.entryTs : trade.entryTimestamp), NaN);
  }

  function tradeExit(trade) {
    return number(trade && (trade.outTs != null ? trade.outTs : trade.exitTimestamp), NaN);
  }

  function equityValue(point) {
    if (typeof point === 'number') return number(point, NaN);
    if (!point || typeof point !== 'object') return NaN;
    if (point.equity != null) return number(point.equity, NaN);
    if (point.balance != null) return number(point.balance, NaN);
    if (point.value != null) return number(point.value, NaN);
    return NaN;
  }

  function getTrades(branch) {
    if (!branch || typeof branch !== 'object') return [];
    if (Array.isArray(branch.trades) && branch.trades.length) return branch.trades;
    return Array.isArray(branch.closedPositions) ? branch.closedPositions : [];
  }

  function calculateMetrics(trades, openingBalance, closingBalance, equityCurve, fallback) {
    trades = Array.isArray(trades) ? trades : [];
    fallback = fallback || {};
    const values = trades.map(tradePL);
    const hasTrades = trades.length > 0;
    const netPL = hasTrades
      ? values.reduce(function(sum, value) { return sum + value; }, 0)
      : number(fallback.netPL != null ? fallback.netPL : fallback.netProfit);
    const totalTrades = hasTrades ? trades.length : number(fallback.totalTrades);
    const wins = hasTrades
      ? values.filter(function(value) { return value > 0; }).length
      : number(fallback.wins, Math.round(number(fallback.winRate) * totalTrades / 100));
    const losses = hasTrades ? totalTrades - wins : number(fallback.losses, Math.max(0, totalTrades - wins));
    const grossWins = hasTrades
      ? values.filter(function(value) { return value > 0; }).reduce(function(sum, value) { return sum + value; }, 0)
      : 0;
    const grossLosses = hasTrades
      ? Math.abs(values.filter(function(value) { return value <= 0; }).reduce(function(sum, value) { return sum + value; }, 0))
      : 0;
    const durations = trades.map(function(trade) {
      return tradeExit(trade) - tradeEntry(trade);
    }).filter(function(duration) { return Number.isFinite(duration) && duration >= 0; });
    const curve = (Array.isArray(equityCurve) ? equityCurve : []).map(equityValue).filter(Number.isFinite);
    if (!curve.length && Number.isFinite(openingBalance)) curve.push(openingBalance);
    if (Number.isFinite(closingBalance) && (!curve.length || curve[curve.length - 1] !== closingBalance)) curve.push(closingBalance);

    let peak = curve.length ? curve[0] : number(fallback.peakEquity, closingBalance);
    let lowest = curve.length ? curve[0] : number(fallback.lowestEquity, closingBalance);
    let maxDrawdown = 0;
    curve.forEach(function(value) {
      peak = Math.max(peak, value);
      lowest = Math.min(lowest, value);
      maxDrawdown = Math.max(maxDrawdown, peak - value);
    });

    const final = Number.isFinite(closingBalance) ? closingBalance : openingBalance + netPL;
    return {
      netPL: netPL,
      returnPct: openingBalance ? netPL / openingBalance * 100 : 0,
      maxDrawdown: curve.length ? maxDrawdown : number(fallback.maxDrawdown),
      totalTrades: totalTrades,
      wins: wins,
      losses: losses,
      winRate: totalTrades ? wins / totalTrades * 100 : 0,
      profitFactor: hasTrades
        ? (grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99 : 0)
        : number(fallback.profitFactor),
      avgTrade: totalTrades ? netPL / totalTrades : 0,
      largestWin: hasTrades && values.some(function(value) { return value > 0; })
        ? Math.max.apply(null, values.filter(function(value) { return value > 0; }))
        : number(fallback.largestWin != null ? fallback.largestWin : fallback.largestWinner),
      largestLoss: hasTrades && values.some(function(value) { return value <= 0; })
        ? Math.min.apply(null, values.filter(function(value) { return value <= 0; }))
        : number(fallback.largestLoss != null ? fallback.largestLoss : fallback.largestLoser),
      avgHoldingTime: durations.length
        ? durations.reduce(function(sum, duration) { return sum + duration; }, 0) / durations.length
        : number(fallback.avgHoldingTime),
      closingBalance: final,
      peakEquity: curve.length ? peak : number(fallback.peakEquity, final),
      lowestEquity: curve.length ? lowest : number(fallback.lowestEquity, final),
      trades: trades.slice(),
      equityCurve: curve
    };
  }

  function computeDailyMetrics(branch) {
    branch = branch && typeof branch === 'object' ? branch : {};
    const trades = getTrades(branch);
    const suppliedClosing = branch.finalBalance != null ? number(branch.finalBalance, NaN)
      : branch.balance != null ? number(branch.balance, NaN) : number(branch.equity, NaN);
    const tradeTotal = trades.reduce(function(sum, trade) { return sum + tradePL(trade); }, 0);
    const opening = branch.openingBalance != null
      ? number(branch.openingBalance)
      : Number.isFinite(suppliedClosing) ? suppliedClosing - tradeTotal : 0;
    const closing = Number.isFinite(suppliedClosing) ? suppliedClosing : opening + tradeTotal;
    return calculateMetrics(trades, opening, closing, branch.equityCurve, branch);
  }

  function summarizeInterventions(interventions) {
    const list = Array.isArray(interventions) ? interventions.filter(Boolean) : [];
    return {
      total: list.length,
      stopsAdded: list.filter(function(item) { return item.action === 'ADD_STOP'; }).length,
      stopsMoved: list.filter(function(item) { return item.action === 'MOVE_STOP'; }).length,
      manualCloses: list.filter(function(item) { return item.action === 'MANUAL_CLOSE'; }).length
    };
  }

  function computeComparison(autoMetrics, managedMetrics, interventions) {
    autoMetrics = autoMetrics || {};
    managedMetrics = managedMetrics || {};
    const autoPL = number(autoMetrics.netPL != null ? autoMetrics.netPL : autoMetrics.netProfit);
    const managedPL = number(managedMetrics.netPL != null ? managedMetrics.netPL : managedMetrics.netProfit);
    const diff = managedPL - autoPL;
    const ddDiff = number(autoMetrics.maxDrawdown) - number(managedMetrics.maxDrawdown);
    return {
      managementImpact: diff,
      profitImpact: diff,
      drawdownImpact: ddDiff,
      autoReturnPct: number(autoMetrics.returnPct),
      managedReturnPct: number(managedMetrics.returnPct),
      betterByProfit: diff > 0 ? 'managed' : diff < 0 ? 'autonomous' : 'tied',
      betterByDrawdown: ddDiff > 0 ? 'managed' : ddDiff < 0 ? 'autonomous' : 'tied',
      interventionCount: Array.isArray(interventions) ? interventions.length : 0,
      interventionSummary: summarizeInterventions(interventions)
    };
  }

  function combineBranchDays(completedDays, key, startBalance) {
    const trades = [];
    const curve = [startBalance];
    let runningBalance = startBalance;
    let fallbackTrades = 0;
    let fallbackWins = 0;
    let fallbackLosses = 0;
    let fallbackHoldingTotal = 0;
    let fallbackHoldingCount = 0;
    let fallbackLargestWin = 0;
    let fallbackLargestLoss = 0;

    completedDays.forEach(function(day) {
      const metrics = day && day[key + 'Metrics'] || {};
      const dayTrades = Array.isArray(metrics.trades) ? metrics.trades : [];
      Array.prototype.push.apply(trades, dayTrades);
      if (!dayTrades.length) {
        const count = number(metrics.totalTrades);
        fallbackTrades += count;
        fallbackWins += number(metrics.wins, Math.round(number(metrics.winRate) * count / 100));
        fallbackLosses += number(metrics.losses, Math.max(0, count - number(metrics.wins)));
        if (count && number(metrics.avgHoldingTime)) {
          fallbackHoldingTotal += number(metrics.avgHoldingTime) * count;
          fallbackHoldingCount += count;
        }
        fallbackLargestWin = Math.max(fallbackLargestWin, number(metrics.largestWin != null ? metrics.largestWin : metrics.largestWinner));
        fallbackLargestLoss = Math.min(fallbackLargestLoss, number(metrics.largestLoss != null ? metrics.largestLoss : metrics.largestLoser));
      }

      const dayPL = number(metrics.netPL != null ? metrics.netPL : metrics.netProfit,
        number(day && day[key + 'Balance'], runningBalance) - runningBalance);
      const dayCurve = (Array.isArray(metrics.equityCurve) ? metrics.equityCurve : [])
        .map(equityValue).filter(Number.isFinite);
      const dayOpening = dayCurve.length ? dayCurve[0]
        : number(metrics.closingBalance != null ? metrics.closingBalance : metrics.finalBalance, runningBalance + dayPL) - dayPL;
      dayCurve.forEach(function(value, index) {
        const absolute = runningBalance + (value - dayOpening);
        if (index || curve[curve.length - 1] !== absolute) curve.push(absolute);
      });
      runningBalance += dayPL;
      if (curve[curve.length - 1] !== runningBalance) curve.push(runningBalance);
    });

    const fallback = {
      netPL: runningBalance - startBalance,
      totalTrades: fallbackTrades,
      wins: fallbackWins,
      losses: fallbackLosses,
      largestWin: fallbackLargestWin,
      largestLoss: fallbackLargestLoss,
      avgHoldingTime: fallbackHoldingCount ? fallbackHoldingTotal / fallbackHoldingCount : 0
    };
    const metrics = calculateMetrics(trades, startBalance, runningBalance, curve, fallback);
    metrics.netPL = runningBalance - startBalance;
    metrics.returnPct = startBalance ? metrics.netPL / startBalance * 100 : 0;
    metrics.closingBalance = runningBalance;
    metrics.avgTrade = metrics.totalTrades ? metrics.netPL / metrics.totalTrades : 0;
    if (trades.length && fallbackTrades) {
      metrics.totalTrades += fallbackTrades;
      metrics.wins += fallbackWins;
      metrics.losses += fallbackLosses;
      metrics.winRate = metrics.totalTrades ? metrics.wins / metrics.totalTrades * 100 : 0;
      metrics.avgTrade = metrics.totalTrades ? metrics.netPL / metrics.totalTrades : 0;
      metrics.largestWin = Math.max(metrics.largestWin, fallbackLargestWin);
      metrics.largestLoss = Math.min(metrics.largestLoss, fallbackLargestLoss);
    }
    metrics.netProfit = metrics.netPL;
    metrics.finalBalance = metrics.closingBalance;
    metrics.largestWinner = metrics.largestWin;
    metrics.largestLoser = metrics.largestLoss;
    return metrics;
  }

  function computeTestComparison(completedDays, startBalance) {
    if (!Array.isArray(completedDays) || !completedDays.length) return null;
    const firstMetrics = completedDays[0] && (completedDays[0].autonomousMetrics || completedDays[0].managedMetrics) || {};
    const inferredOpening = number(firstMetrics.closingBalance != null ? firstMetrics.closingBalance : firstMetrics.finalBalance, 10000) -
      number(firstMetrics.netPL != null ? firstMetrics.netPL : firstMetrics.netProfit);
    const opening = Number.isFinite(Number(startBalance)) ? Number(startBalance) : inferredOpening;
    const autonomous = combineBranchDays(completedDays, 'autonomous', opening);
    const managed = combineBranchDays(completedDays, 'managed', opening);
    const impact = managed.netPL - autonomous.netPL;
    return {
      autonomous: autonomous,
      managed: managed,
      managementImpact: impact,
      profitImpact: impact,
      managementImpactPct: opening ? impact / opening * 100 : 0,
      daysTested: completedDays.length,
      betterByProfit: impact > 0 ? 'managed' : impact < 0 ? 'autonomous' : 'tied'
    };
  }

  function sameTrade(left, right) {
    if (!left || !right) return false;
    if (left.signalId != null && right.signalId != null && left.signalId === right.signalId) return true;
    const leftEntry = tradeEntry(left);
    const rightEntry = tradeEntry(right);
    return left.dir != null && left.dir === right.dir && Number.isFinite(leftEntry) &&
      Number.isFinite(rightEntry) && Math.abs(leftEntry - rightEntry) < 60000;
  }

  function matchInterventionsToTrades(interventions, managedTrades, autonomousTrades) {
    const interventionList = Array.isArray(interventions) ? interventions.filter(Boolean) : [];
    const managedList = Array.isArray(managedTrades) ? managedTrades.filter(Boolean) : [];
    const autonomousList = Array.isArray(autonomousTrades) ? autonomousTrades.filter(Boolean) : [];
    return interventionList.map(function(intervention) {
      const matchedTrade = managedList.find(function(trade) {
        return (intervention.signalId != null && trade.signalId === intervention.signalId) ||
          (intervention.positionId != null && (trade.id === intervention.positionId || trade.positionId === intervention.positionId));
      }) || null;
      const autoTrade = matchedTrade ? autonomousList.find(function(trade) {
        return sameTrade(trade, matchedTrade);
      }) || null : null;
      const directPLDiff = matchedTrade && autoTrade ? tradePL(matchedTrade) - tradePL(autoTrade) : 0;
      return {
        intervention: intervention,
        managedTrade: matchedTrade,
        autonomousTrade: autoTrade,
        impact: directPLDiff > 0 ? 'improved' : directPLDiff < 0 ? 'worsened' : 'no_effect',
        directPLDiff: directPLDiff
      };
    });
  }

  function buildAIPayload(testConfig, autoMetrics, managedMetrics, interventions, matchedInterventions) {
    testConfig = testConfig || {};
    autoMetrics = autoMetrics || {};
    managedMetrics = managedMetrics || {};
    interventions = Array.isArray(interventions) ? interventions : [];
    matchedInterventions = Array.isArray(matchedInterventions) ? matchedInterventions : [];
    const summary = summarizeInterventions(interventions);
    return {
      reviewType: 'bot_management_test',
      bot: { id: testConfig.botId, name: testConfig.botName, version: testConfig.botVersion, settings: testConfig.botSettings || {} },
      configuration: {
        instrument: testConfig.instrument,
        sessionWindow: testConfig.sessionWindow,
        days: testConfig.days,
        startBalance: testConfig.startBalance
      },
      autonomousMetrics: autoMetrics,
      managedMetrics: managedMetrics,
      interventionMetrics: {
        totalInterventions: summary.total,
        stopsAdded: summary.stopsAdded,
        stopsMoved: summary.stopsMoved,
        manualCloses: summary.manualCloses,
        improved: matchedInterventions.filter(function(match) { return match && match.impact === 'improved'; }).length,
        worsened: matchedInterventions.filter(function(match) { return match && match.impact === 'worsened'; }).length,
        noEffect: matchedInterventions.filter(function(match) { return !match || match.impact === 'no_effect'; }).length,
        netImpact: matchedInterventions.reduce(function(sum, match) { return sum + number(match && match.directPLDiff); }, 0)
      },
      matchedInterventions: matchedInterventions,
      branchDivergence: {
        tradeCountDifference: number(managedMetrics.totalTrades) - number(autoMetrics.totalTrades),
        winRateDifference: number(managedMetrics.winRate) - number(autoMetrics.winRate)
      },
      detectedBehaviours: []
    };
  }

  return {
    computeDailyMetrics,
    computeComparison,
    computeTestComparison,
    matchInterventionsToTrades,
    buildAIPayload
  };
})();
