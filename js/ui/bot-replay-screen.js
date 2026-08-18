'use strict';
window.BotLab = window.BotLab || {};

BotLab.UI = BotLab.UI || {};

BotLab.UI.ReplayScreen = (function() {
  let _testConfig = null;
  let _sessionController = null;
  let _autonomousRunner = null;
  let _managedRunner = null;
  let _tracker = null;
  let _autoEngine = null;
  let _managedEngine = null;
  let _rafId = null;
  let _lastFrame = 0;
  let _barAccumulator = 0;
  let _loopToken = 0;
  let _processingFrame = false;
  let _dayActive = false;
  let _handlingDayComplete = false;
  let _aborting = false;
  let _completionStarted = false;
  let _speedMessageTimer = null;

  async function start(testConfig) {
    stopLoop();
    BotLab.Chart.destroy();
    _sessionController = null;
    _autonomousRunner = null;
    _managedRunner = null;
    _autoEngine = null;
    _managedEngine = null;
    _testConfig = testConfig;
    _completionStarted = false;
    _aborting = false;
    _handlingDayComplete = false;
    _testConfig.completedDays = _testConfig.completedDays || [];
    _testConfig.daySnapshots = _testConfig.daySnapshots || [];

    _tracker = BotLab.InterventionTracker.create();
    _tracker.setTestId(_testConfig.testId);
    _tracker.restoreSnapshot(_testConfig.interventions || []);

    show('botLabReplay');
    renderReplayUI();
    if (!_testConfig.configuration.blindRun && !BotLab.Chart.init('blChartCanvas')) {
      alert('Unable to initialize the replay chart.');
      return;
    }

    const days = _testConfig.selectedDays || [];
    const dayIndex = Number(_testConfig.currentDayIndex) || 0;
    if (dayIndex >= days.length && _testConfig.completedDays.length) {
      showDaySummary(_testConfig.completedDays[_testConfig.completedDays.length - 1]);
      return;
    }

    try {
      await startNextDay();
      if (_testConfig.configuration.blindRun) runBlindDays();
    } catch (error) {
      console.error(error);
      alert('Replay could not be started: ' + error.message);
      backToHub();
    }
  }

  function resume() {
    const activeTest = BotLab.Storage.getActiveTest();
    if (!activeTest) {
      alert('No active test to resume.');
      return;
    }
    if (activeTest.status === 'test_complete') {
      BotLab.UI.ReportScreen.open(activeTest);
      return;
    }
    return start(activeTest);
  }

  async function startNextDay() {
    if (!_testConfig || _dayActive) return;
    const days = _testConfig.selectedDays || [];
    const dayIndex = Number(_testConfig.currentDayIndex) || 0;
    if (dayIndex >= days.length) return;

    const day = days[dayIndex] || {};
    const openingBalances = getOpeningBalances(dayIndex);
    _testConfig.currentDayStartBalances = {
      dayIndex: dayIndex,
      autonomous: openingBalances.autonomous,
      managed: openingBalances.managed
    };
    createDayRuntime(openingBalances);
    if (!_testConfig.configuration.blindRun) {
      BotLab.Chart.setSessionController(_sessionController);
      BotLab.Chart.setManagedRunner(_managedRunner);
      BotLab.Chart.setActions({ moveStop: moveStopFromChart, moveTP: moveTPFromChart });
    }

    _dayActive = true;
    _testConfig.status = 'running';
    persistActiveState();
    updateReplayDisplay();

    try {
      await _sessionController.startDay({
        bars: Array.isArray(day.bars) ? day.bars : [],
        warmupBars: Array.isArray(day.warmupBars) ? day.warmupBars : [],
        chartHistory: Array.isArray(day.chartHistory) && day.chartHistory.length ? day.chartHistory : day.warmupBars,
        key: day.key
      }, dayIndex);
    } catch (error) {
      _dayActive = false;
      throw error;
    }

    _lastFrame = performance.now();
    _barAccumulator = 0;
    updateReplayDisplay();
    if (!_testConfig.configuration.blindRun) ensureLoop();
  }

  function getOpeningBalances(dayIndex) {
    const saved = _testConfig.currentDayStartBalances;
    if (_testConfig.status === 'running' && saved && Number(saved.dayIndex) === dayIndex) {
      const savedAutonomous = Number(saved.autonomous);
      const savedManaged = Number(saved.managed);
      if (Number.isFinite(savedAutonomous) && Number.isFinite(savedManaged)) {
        return {
          autonomous: savedAutonomous,
          managed: savedManaged
        };
      }
    }
    const previous = (_testConfig.completedDays || [])[dayIndex - 1];
    const startBalance = Number(_testConfig.configuration.startBalance) || 10000;
    return {
      autonomous: previous ? Number(previous.autonomousBalance) : startBalance,
      managed: previous ? Number(previous.managedBalance) : startBalance
    };
  }

  async function runBlindDays() {
    try {
      while (_dayActive && _sessionController && !_completionStarted) {
        await _sessionController.processBar();
      }
    } catch (error) {
      console.error(error);
      alert('Blind run stopped because a bar could not be processed: ' + error.message);
      backToHub();
    }
  }

  function createDayRuntime(openingBalances) {
    const cfg = _testConfig.configuration;
    const instrument = typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS[cfg.instrument] : null;
    const engineOptions = {
      ptValue: cfg.ptValue || 1,
      spread: cfg.spread || 0,
      commission: cfg.commission || 0,
      contractSize: cfg.contractSize == null ? (instrument && instrument.contractSize) || 1 : cfg.contractSize,
      quoteToAccountRate: cfg.quoteToAccountRate == null ? (instrument && instrument.quoteToAccountRate) || 1 : cfg.quoteToAccountRate,
      marginRate: cfg.marginRate == null ? (instrument && instrument.marginRate) || 0 : cfg.marginRate,
      minSize: cfg.minSize == null ? 1 : cfg.minSize,
      sizeStep: cfg.sizeStep == null ? 1 : cfg.sizeStep,
      sizeDecimals: cfg.sizeDecimals == null ? 0 : cfg.sizeDecimals,
      decimals: cfg.decimals == null ? 1 : cfg.decimals,
      currency: cfg.currency || '$',
      maxSize: cfg.maxSize || 50
    };
    const bokkeBacktestExecution = cfg.botId === 'bokke-one-pack' && BotLab.BokkeOnePack
      ? BotLab.BokkeOnePack.executionForInstrument(cfg.instrument).engine : {};
    _autoEngine = BotLab.ExecutionEngine.create({ ...engineOptions, ...bokkeBacktestExecution, startBalance: openingBalances.autonomous, branch: 'autonomous' });
    _managedEngine = BotLab.ExecutionEngine.create({ ...engineOptions, ...bokkeBacktestExecution, startBalance: openingBalances.managed, branch: 'managed' });

    const bot = BotLab.BotRegistry.get(cfg.botId);
    if (!bot) throw new Error('Configured bot is not available');
    _autonomousRunner = BotLab.AutonomousRunner.create(bot.createInstance(cfg.botSettings, cfg.instrument), _autoEngine, cfg);
    _managedRunner = BotLab.ManagedRunner.create(bot.createInstance(cfg.botSettings, cfg.instrument), _managedEngine, cfg, _tracker);
    const controller = BotLab.SessionController.create(
      { ...cfg, testId: _testConfig.testId },
      _autonomousRunner,
      _managedRunner,
      _tracker
    );
    _sessionController = controller;
    controller.setCallbacks({
      onSpeedChange: function(info) {
        if (_sessionController === controller) handleSpeedChange(info);
      },
      onDayComplete: function(result) {
        if (_sessionController === controller) return handleDayComplete(result);
      },
      onTradeOpened: function() {}
    });
  }

  function ensureLoop() {
    if (_rafId != null || !_dayActive || _completionStarted) return;
    const token = _loopToken;
    _rafId = requestAnimationFrame(function(timestamp) { runFrame(timestamp, token); });
  }

  async function runFrame(timestamp, token) {
    _rafId = null;
    if (token !== _loopToken || !_dayActive || !_sessionController || _completionStarted) return;
    if (_processingFrame) {
      ensureLoop();
      return;
    }

    const speed = _sessionController.getSpeedState();
    const elapsed = Math.max(0, (timestamp - _lastFrame) / 1000);
    _lastFrame = timestamp;
    if (speed.paused) {
      _barAccumulator = 0;
      ensureLoop();
      return;
    }

    _barAccumulator += elapsed * Number(speed.currentSpeed || 0);
    const barsDue = Math.floor(_barAccumulator);
    if (!barsDue) {
      ensureLoop();
      return;
    }
    _barAccumulator -= barsDue;
    _processingFrame = true;
    try {
      for (let index = 0; index < barsDue && _dayActive && token === _loopToken; index++) {
        const result = await _sessionController.processBar();
        updateReplayDisplay();
        BotLab.Chart.render();
        if (!result || result.type === 'day_complete') break;
      }
    } catch (error) {
      console.error(error);
      pause();
      alert('Replay stopped because a bar could not be processed: ' + error.message);
    } finally {
      _processingFrame = false;
    }
    ensureLoop();
  }

  function stopLoop() {
    _loopToken++;
    _dayActive = false;
    _processingFrame = false;
    if (_rafId != null) cancelAnimationFrame(_rafId);
    _rafId = null;
    _barAccumulator = 0;
  }

  function handleSpeedChange(info) {
    const message = document.getElementById('blSpeedMessage');
    if (message) {
      message.textContent = info && info.message ? info.message : '';
      message.style.display = info && info.message ? 'block' : 'none';
    }
    if (_speedMessageTimer) clearTimeout(_speedMessageTimer);
    if (info && info.message) {
      _speedMessageTimer = setTimeout(function() {
        const current = document.getElementById('blSpeedMessage');
        if (current) current.style.display = 'none';
      }, 3000);
    }
    updateSpeedDisplay();
  }

  async function handleDayComplete(dayResult) {
    if (_handlingDayComplete || !_testConfig) return;
    _handlingDayComplete = true;
    stopLoop();

    try {
      const opening = _testConfig.currentDayStartBalances || {};
      const autoMetrics = dailyMetrics(dayResult.autonomous, Number(opening.autonomous), dayResult.dayId);
      const managedMetrics = dailyMetrics(dayResult.managed, Number(opening.managed), dayResult.dayId);
      const snapshot = {
        dayIndex: dayResult.dayIndex,
        dayId: dayResult.dayId,
        reason: dayResult.reason,
        autonomousOpeningBalance: Number(opening.autonomous),
        managedOpeningBalance: Number(opening.managed),
        autonomousMetrics: autoMetrics,
        managedMetrics: managedMetrics,
        autonomousBalance: Number(dayResult.autonomous.balance),
        managedBalance: Number(dayResult.managed.balance)
      };

      const completed = _testConfig.completedDays || [];
      const existingIndex = completed.findIndex(function(day) { return Number(day.dayIndex) === Number(snapshot.dayIndex); });
      if (existingIndex >= 0) completed[existingIndex] = snapshot;
      else completed.push(snapshot);
      _testConfig.completedDays = completed;
      _testConfig.daySnapshots = completed.slice();
      _testConfig.interventions = _tracker.getSnapshot();

      if (_aborting || dayResult.reason === 'user_aborted') {
        _testConfig.status = 'user_aborted';
        persistActiveState();
        completeTest();
        return;
      }

      _testConfig.currentDayIndex = Number(dayResult.dayIndex) + 1;
      _testConfig.currentDayStartBalances = null;
      _testConfig.status = 'day_complete';
      persistActiveState();
      if (_testConfig.configuration.blindRun) {
        if (_testConfig.currentDayIndex < (_testConfig.selectedDays || []).length) await startNextDay();
        else completeTest();
        return;
      }
      showDaySummary(snapshot);
    } finally {
      _handlingDayComplete = false;
    }
  }

  function dailyMetrics(branch, openingBalance, dayId) {
    const trades = (Array.isArray(branch.trades) ? branch.trades : []).map(function(trade) {
      return { ...trade, dayId: trade.dayId || dayId };
    });
    const metrics = BotLab.ComparisonMetrics.computeDailyMetrics({
      closedPositions: trades,
      equity: branch.equity,
      balance: branch.balance,
      equityCurve: Array.isArray(branch.equityCurve) ? branch.equityCurve : []
    });
    metrics.trades = trades;
    metrics.openingBalance = openingBalance;
    metrics.returnPct = openingBalance > 0 ? (Number(branch.balance) - openingBalance) / openingBalance * 100 : 0;
    return metrics;
  }

  function showDaySummary(daySnapshot) {
    const container = document.getElementById('botLabDaySummary');
    if (!container) return;
    let html = '<div class="blDaySummary">';
    html += '<div class="blDaySummaryHead">DAY ' + (Number(daySnapshot.dayIndex) + 1) + ' COMPLETE</div>';
    if (_testConfig.configuration.includeBotAlone !== false) html += BotLab.Report.renderDayComparisonHTML(daySnapshot, '$');
    html += '<div class="blTradeLedgers">' +
      (_testConfig.configuration.includeBotAlone !== false ? BotLab.Report.renderTradeLedgerHTML(daySnapshot.autonomousMetrics.trades, 'Bot Alone', '$', noTradeReason(daySnapshot.autonomousOpeningBalance)) : '') +
      BotLab.Report.renderTradeLedgerHTML(daySnapshot.managedMetrics.trades, 'You Managing', '$', noTradeReason(daySnapshot.managedOpeningBalance)) +
      '</div>';
    const summary = _tracker.getSummary();
    html += '<div class="blInterventionSum"><div class="blIntHead">Interventions</div>';
    html += '<div>Stops added: ' + summary.stopsAdded + '</div>';
    html += '<div>Stops moved: ' + summary.stopsMoved + '</div>';
    html += '<div>Targets moved: ' + (summary.targetsMoved || 0) + '</div>';
    html += '<div>Manual closes: ' + summary.manualCloses + '</div></div>';
    html += '<div class="blDayActions">';
    if (_testConfig.currentDayIndex < (_testConfig.selectedDays || []).length) {
      html += '<button class="btn primary" onclick="BotLab.UI.ReplayScreen.nextDay()">Next Day</button>';
    } else {
      html += '<button class="btn primary" onclick="BotLab.UI.ReplayScreen.completeTest()">Finish &amp; View Report</button>';
    }
    html += '<button class="btn" onclick="BotLab.UI.ReplayScreen.backToHub()">Return to Bot Lab</button></div></div>';
    container.innerHTML = html;
    container.style.display = 'flex';
    const replay = document.getElementById('botLabReplay');
    if (replay) replay.style.display = 'none';
  }

  function nextDay() {
    const summary = document.getElementById('botLabDaySummary');
    if (summary) summary.style.display = 'none';
    const replay = document.getElementById('botLabReplay');
    if (replay) replay.style.display = 'flex';
    startNextDay().catch(function(error) {
      console.error(error);
      alert('The next day could not be started: ' + error.message);
    });
  }

  function completeTest() {
    if (_completionStarted || !_testConfig) return;
    _completionStarted = true;
    stopLoop();
    BotLab.Chart.destroy();
    const startBalance = Number(_testConfig.configuration.startBalance) || 10000;
    const comparison = BotLab.ComparisonMetrics.computeTestComparison(_testConfig.completedDays || [], startBalance);
    _testConfig.comparisonMetrics = comparison;
    _testConfig.interventions = _tracker ? _tracker.getSnapshot() : (_testConfig.interventions || []);
    _testConfig.interventionSummary = _tracker ? _tracker.getSummary() : null;
    _testConfig.status = _aborting ? 'user_aborted' : 'test_complete';
    _testConfig.completedAt = new Date().toISOString();
    const completedSnapshot = { ..._testConfig };
    const summary = document.getElementById('botLabDaySummary');
    if (summary) summary.style.display = 'none';
    BotLab.Storage.saveCompletedTest(completedSnapshot);
    BotLab.Storage.clearActiveTest();
    BotLab.UI.ReportScreen.open(completedSnapshot);
  }

  function backToHub() {
    stopLoop();
    BotLab.Chart.destroy();
    if (_speedMessageTimer) clearTimeout(_speedMessageTimer);
    const summary = document.getElementById('botLabDaySummary');
    if (summary) summary.style.display = 'none';
    BotLab.UI.HubScreen.render();
    show('botLabHub');
  }

  function pause() {
    if (_sessionController) _sessionController.pause();
    _barAccumulator = 0;
    updateSpeedDisplay();
    ensureLoop();
  }

  function resumePlay() {
    if (_sessionController) _sessionController.resume();
    _lastFrame = performance.now();
    _barAccumulator = 0;
    updateSpeedDisplay();
    ensureLoop();
  }

  function restoreCruise() {
    if (_sessionController) _sessionController.restoreCruiseSpeed();
    updateSpeedDisplay();
  }

  async function endTest() {
    if (!_sessionController || !_testConfig) return;
    if (!await siteConfirm('End this test and finalize the partial results?', 'Bot Lab')) return;
    _aborting = true;
    stopLoop();
    await _sessionController.completeDay('user_aborted');
  }

  function updateManagedPositionDisplay() {
    const container = document.getElementById('blManagedPositions');
    if (!container) return;
    const positions = _sessionController ? _sessionController.getCurrentManagedPositions() : [];
    if (!positions.length) {
      container.innerHTML = '<div class="blNoPos">No open positions</div>';
      return;
    }

    container.innerHTML = '<div class="blPosTableHead"><span>Market</span><span>Side / Size</span><span>Entry</span><span>Stop / TP</span><span>P/L / Excursion</span><span>Actions</span></div>' + positions.map(function(position) {
      const direction = Number(position.dir) === 1 ? 'LONG' : 'SHORT';
      const directionClass = Number(position.dir) === 1 ? 'long' : 'short';
      const idArgument = JSON.stringify(String(position.id)).replace(/</g, '\\u003c');
      const pnl = positionPL(position);
      return '<div class="blPosCard">' +
        '<div class="blPosMarket"><b>' + escapeHTML(instrumentName()) + '</b><small>#' + escapeHTML(position.id) + ' · ' + formatMarketTime(position.entryTimestamp) + ' UK</small></div>' +
        '<div class="blPosSide"><span class="blPosPill ' + directionClass + '">' + direction + '</span><b>' + formatSize(position.size) + ' lots</b></div>' +
        '<div class="blPosValue"><small>ENTRY</small><b>' + formatPrice(position.entryPrice) + '</b></div>' +
        '<div class="blPosRisk"><span>SL ' + (position.stopLoss == null ? '-' : formatPrice(position.stopLoss)) + (position.humanStopOverride ? ' H' : '') + '</span><span>TP ' + (position.takeProfit == null ? '-' : formatPrice(position.takeProfit)) + '</span></div>' +
        '<div class="blPosPnl ' + (pnl >= 0 ? 'good' : 'bad') + '">' + formatMoney(pnl, true) + '<small>DD ' + formatPoints(position.maxDrawdownPoints) + ' · MFE ' + formatPoints(position.maxFavorablePoints) + '</small></div>' +
        '<div class="blPosActions"><button class="btn" onclick="BotLab.UI.ReplayScreen.addStop(' + idArgument.replace(/"/g, '&quot;') + ')">Add/Move Stop</button>' +
        '<button class="btn" onclick="BotLab.UI.ReplayScreen.editTP(' + idArgument.replace(/"/g, '&quot;') + ')">Edit TP</button>' +
        '<button class="btn blCloseBtn" onclick="BotLab.UI.ReplayScreen.closePos(' + idArgument.replace(/"/g, '&quot;') + ')">Close</button></div></div>';
    }).join('');
  }

  async function addStop(positionId) {
    if (!_sessionController) return;
    const position = _sessionController.getCurrentManagedPositions().find(function(item) { return String(item.id) === String(positionId); });
    if (!position) return;
    const stopPrice = smartStopPrice(position);
    const success = position.stopLoss == null
      ? await _sessionController.humanAddStop(positionId, stopPrice)
      : await _sessionController.humanMoveStop(positionId, stopPrice);
    if (!success) alert('Invalid stop price for this position. Stops may only be tightened.');
    persistInterventions();
    updateManagedPositionDisplay();
    BotLab.Chart.render();
  }

  async function moveStopFromChart(positionId, stopPrice) {
    if (!_sessionController) return false;
    const position = _sessionController.getCurrentManagedPositions().find(function(item) { return String(item.id) === String(positionId); });
    if (!position) return false;
    const success = position.stopLoss == null
      ? await _sessionController.humanAddStop(positionId, stopPrice)
      : await _sessionController.humanMoveStop(positionId, stopPrice);
    if (!success) alert('Invalid stop price for this position. Stops may only be tightened.');
    persistInterventions();
    updateReplayDisplay();
    BotLab.Chart.render();
    return success;
  }

  async function moveTPFromChart(positionId, targetPrice) {
    if (!_sessionController) return false;
    const success = await _sessionController.humanModifyTP(positionId, targetPrice);
    if (!success) alert('For a long position TP must be above market; for a short it must be below market.');
    persistInterventions();
    updateReplayDisplay();
    BotLab.Chart.render();
    return success;
  }

  async function closePos(positionId) {
    if (!_sessionController) return;
    const success = await _sessionController.humanClosePosition(positionId);
    if (!success) alert('The position could not be closed.');
    persistInterventions();
    updateReplayDisplay();
    BotLab.Chart.render();
  }

  async function editTP(positionId) {
    if (!_sessionController) return;
    const position = _sessionController.getCurrentManagedPositions().find(function(item) { return String(item.id) === String(positionId); });
    if (!position) return;
    const targetPrice = smartTargetPrice(position);
    const success = await _sessionController.humanModifyTP(positionId, targetPrice);
    if (!success) alert('For a long position TP must be above market; for a short it must be below market.');
    persistInterventions();
    updateReplayDisplay();
    BotLab.Chart.render();
  }

  function persistInterventions() {
    if (!_testConfig || !_tracker) return;
    _testConfig.interventions = _tracker.getSnapshot();
    persistActiveState();
  }

  function persistActiveState() {
    _testConfig.updatedAt = new Date().toISOString();
    BotLab.Storage.saveActiveTest(_testConfig);
  }

  function updateSpeedDisplay() {
    if (!_sessionController) return;
    const speed = _sessionController.getSpeedState();
    const display = document.getElementById('blSpeedDisplay');
    const cruise = document.getElementById('blCruiseDisplay');
    if (display) display.textContent = speed.paused ? 'PAUSED' : speed.currentSpeed + ' bars/s';
    if (cruise) cruise.textContent = 'Cruise: ' + speed.cruiseSpeed + ' bars/s';
  }

  function updateReplayDisplay() {
    const progress = _sessionController ? _sessionController.getProgress() : {
      percent: 0,
      dayIndex: Number(_testConfig && _testConfig.currentDayIndex) || 0
    };
    const day = _testConfig && (_testConfig.selectedDays || [])[progress.dayIndex];
    const dayLabel = document.getElementById('blReplayDayLabel');
    const countLabel = document.getElementById('blReplayDayCount');
    const percentLabel = document.getElementById('blReplayPercent');
    const progressFill = document.getElementById('blProgressFill');
    if (dayLabel) dayLabel.textContent = day ? [day.day, day.date].filter(Boolean).join(' ') : 'Day ' + (progress.dayIndex + 1);
    if (countLabel) countLabel.textContent = 'Day ' + (progress.dayIndex + 1) + ' / ' + ((_testConfig && _testConfig.selectedDays || []).length);
    if (percentLabel) percentLabel.textContent = progress.percent + '%';
    if (progressFill) progressFill.style.width = progress.percent + '%';
    updateAccountDisplay();
    updateSpeedDisplay();
    updateManagedPositionDisplay();
    updateChartOrders();
  }

  function cycleChartTimeframe() { BotLab.Chart.cycleTimeframe(); }
  function toggleChartVWAP() { BotLab.Chart.toggleVWAP(); }
  function toggleChartRuler() { BotLab.Chart.toggleRuler(); }
  function resetChartLive() { BotLab.Chart.resetLive(); }
  function toggleChartFullscreen() { BotLab.Chart.toggleFullscreen(); }

  function updateChartOrders() {
    const container = document.getElementById('blChartOrders');
    if (!container) return;
    const positions = _sessionController ? _sessionController.getCurrentManagedPositions() : [];
    if (!positions.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = positions.map(function(position) {
      const direction = Number(position.dir) === 1 ? 'LONG' : 'SHORT';
      const directionClass = Number(position.dir) === 1 ? 'long' : 'short';
      const pnl = positionPL(position);
      const idArgument = JSON.stringify(String(position.id)).replace(/</g, '\\u003c').replace(/"/g, '&quot;');
      return '<div class="blChartOrder ' + directionClass + '" data-position-id="' + escapeHTML(position.id) + '"><span class="blChartOrderSide">' + direction + '</span>' +
        '<span>' + formatSize(position.size) + ' lots</span><span class="' + (pnl >= 0 ? 'good' : 'bad') + '">' + formatMoney(pnl, true) + '</span>' +
        '<button onclick="BotLab.UI.ReplayScreen.addStop(' + idArgument + ')">Edit SL</button>' +
        '<button onclick="BotLab.UI.ReplayScreen.editTP(' + idArgument + ')">Edit TP</button>' +
        '<button onclick="BotLab.UI.ReplayScreen.closePos(' + idArgument + ')">Close</button></div>';
    }).join('');
  }

  function renderReplayUI() {
    const container = document.getElementById('botLabReplay');
    if (!container) return;
    const existingCanvas = document.getElementById('blChartCanvas');
    if (existingCanvas && existingCanvas.isConnected && container.contains(existingCanvas)) {
      updateReplayDisplay();
      return;
    }
    container.innerHTML = '<div class="blAccountHud"><div class="blMarketIdentity"><b id="blReplayInstrument">' + escapeHTML(instrumentName()) + '</b><span>BOT LAB · MANAGED ACCOUNT</span></div>' +
      '<div class="blOpenPL"><span>OPEN P/L</span><b id="blOpenPL">' + formatMoney(0, true) + '</b></div>' +
      '<div class="blHudMetric"><span>BALANCE</span><b id="blBalance">' + formatMoney(0) + '</b></div>' +
      '<div class="blHudMetric"><span>EQUITY</span><b id="blEquity">' + formatMoney(0) + '</b></div>' +
      '<div class="blHudMetric"><span>FREE MARGIN</span><b id="blFreeMargin">' + formatMoney(0) + '</b></div></div>' +
      '<div class="blReplayTop">' +
      '<div class="blReplayControls"><button class="blCtrlBtn" onclick="BotLab.UI.ReplayScreen.resumePlay()" title="Play">\u25b6</button>' +
      '<button class="blCtrlBtn" onclick="BotLab.UI.ReplayScreen.pause()" title="Pause">\u275a\u275a</button>' +
      '<span class="blSpeedChip" id="blSpeedDisplay">PAUSED</span><span class="blSpeedLabel" id="blCruiseDisplay"></span>' +
      '<button class="blCtrlBtn blCruiseBtn" onclick="BotLab.UI.ReplayScreen.restoreCruise()" title="Resume cruise speed">&raquo;</button></div>' +
      '<div class="blReplayInfo"><span class="blInfoChip" id="blReplayDayLabel"></span>' +
      '<span class="blInfoChip" id="blReplayDayCount"></span><span class="blInfoChip" id="blReplayPercent">0%</span></div>' +
      '<button class="btn" onclick="BotLab.UI.ReplayScreen.endTest()" style="margin-left:auto">End Test</button></div>' +
      '<div class="blReplayBody"><div class="blReplayChart">' +
      '<div class="blChartQuote"><b id="blChartSymbol">' + escapeHTML(instrumentName()) + '</b><span id="blChartOHLC">O - H - L - C -</span><span id="blChartBidAsk">BID - · ASK -</span></div>' +
       '<div class="blChartControls"><button id="blChartTF" class="blChartControl" onclick="BotLab.UI.ReplayScreen.cycleChartTimeframe()" title="Cycle chart timeframe">1m</button>' +
       '<button id="blChartVWAP" class="blChartControl" onclick="BotLab.UI.ReplayScreen.toggleChartVWAP()" title="Toggle VWAP bands">VWAP</button>' +
       '<button id="blChartRuler" class="blChartControl" onclick="BotLab.UI.ReplayScreen.toggleChartRuler()" title="Measure price movement">RULER</button>' +
      '<button id="blChartLive" class="blChartControl live" onclick="BotLab.UI.ReplayScreen.resetChartLive()" title="Return to live view" style="display:none">LIVE</button>' +
      '<button id="blChartFull" class="blChartControl icon" onclick="BotLab.UI.ReplayScreen.toggleChartFullscreen()" title="Toggle chart fullscreen">&#x26F6;</button></div>' +
      '<canvas id="blChartCanvas" style="position:absolute;inset:0;width:100%;height:100%"></canvas>' +
      '<div class="blChartOrders" id="blChartOrders"></div>' +
      '<div class="blProgressFill" id="blProgressFill" style="width:0%"></div></div>' +
      '<div class="blReplaySidebar"><div class="blSidebarSection"><div class="blSidebarHead"><span>POSITIONS</span><span>AUTONOMOUS RESULT HIDDEN UNTIL COMPLETION</span></div>' +
      '<div id="blManagedPositions"><div class="blNoPos">No open positions</div></div></div></div>' +
      '<div class="blSpeedMessage" id="blSpeedMessage" style="display:none"></div>';
    updateReplayDisplay();
  }

  function formatPrice(value) {
    return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '-';
  }

  function formatSize(value) {
    if (!Number.isFinite(Number(value))) return '-';
    return Number(value).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  function currency() {
    return (_testConfig && _testConfig.configuration && _testConfig.configuration.currency) || '$';
  }

  function instrumentName() {
    const cfg = _testConfig && _testConfig.configuration || {};
    return String(cfg.instrumentLabel || cfg.instrument || 'Market').split(' · ')[0].toUpperCase();
  }

  function formatMoney(value, signed) {
    const amount = Number(value) || 0;
    return (signed && amount > 0 ? '+' : amount < 0 ? '-' : '') + currency() + Math.abs(amount).toFixed(2);
  }

  function formatPoints(value) {
    return (Math.max(0, Number(value) || 0)).toFixed(1) + ' pts';
  }

  function smartStepPoints() { return 5; }

  function currentReplayPrice() {
    return _sessionController ? Number(_sessionController.getState().currentPrice) : NaN;
  }

  function smartTargetPrice(position) {
    const price = currentReplayPrice();
    const entry = Number(position.entryPrice);
    const step = smartStepPoints();
    if (Number(position.dir) === 1) return Math.max(price + step * 2, entry + step);
    return Math.min(price - step * 2, entry - step);
  }

  function smartStopPrice(position) {
    const price = currentReplayPrice();
    const entry = Number(position.entryPrice);
    const step = smartStepPoints();
    const long = Number(position.dir) === 1;
    const clearlyProfitable = long ? price > entry + step * 2 : price < entry - step * 2;
    if (clearlyProfitable) return entry + (long ? step : -step);
    return long ? Math.min(price - step, entry - step) : Math.max(price + step, entry + step);
  }

  function positionPL(position) {
    if (!_managedEngine || !_sessionController) return 0;
    const price = Number(_sessionController.getState().currentPrice);
    if (!Number.isFinite(price)) return 0;
    const exit = _managedEngine.exitFillAt(price, Number(position.dir));
    return _managedEngine.netPL(Number(position.entryPrice), exit, Number(position.dir), Number(position.size));
  }

  function updateAccountDisplay() {
    if (!_managedEngine) return;
    const balance = Number(_managedEngine.getBalance()) || 0;
    const equity = Number(_managedEngine.getEquity()) || balance;
    const usedMargin = Number(_managedEngine.getUsedMargin()) || 0;
    const freeMargin = Number(_managedEngine.getFreeMargin()) || 0;
    const openPL = equity - balance;
    const open = document.getElementById('blOpenPL');
    const balanceEl = document.getElementById('blBalance');
    const equityEl = document.getElementById('blEquity');
    const freeMarginEl = document.getElementById('blFreeMargin');
    if (open) { open.textContent = formatMoney(openPL, true); open.className = openPL > 0 ? 'good' : openPL < 0 ? 'bad' : ''; }
    if (balanceEl) balanceEl.textContent = formatMoney(balance);
    if (equityEl) { equityEl.textContent = formatMoney(equity); equityEl.className = openPL > 0 ? 'good' : openPL < 0 ? 'bad' : ''; }
    if (freeMarginEl) { freeMarginEl.textContent = formatMoney(freeMargin) + (usedMargin > 0 ? ' / ' + formatMoney(usedMargin) + ' used' : ''); freeMarginEl.className = freeMargin < 0 ? 'bad' : ''; }
    const state = _sessionController && _sessionController.getState();
    const bars = state && state.bars;
    const index = state && Array.isArray(bars) && bars.length ? Math.max(0, Math.min((Number(state.currentBarIndex) || 1) - 1, bars.length - 1)) : -1;
    const bar = index >= 0 && bars[index];
    const ohlc = document.getElementById('blChartOHLC');
    const bidAsk = document.getElementById('blChartBidAsk');
    if (ohlc && bar) ohlc.textContent = 'O ' + formatPrice(bar[1]) + '  H ' + formatPrice(bar[2]) + '  L ' + formatPrice(bar[3]) + '  C ' + formatPrice(bar[4]);
    const price = state && Number(state.currentPrice);
    const spread = Number((_testConfig.configuration || {}).spread) || 0;
    if (bidAsk && Number.isFinite(price)) bidAsk.textContent = 'BID ' + formatPrice(price - spread / 2) + ' · ASK ' + formatPrice(price + spread / 2);
  }

  function formatMarketTime(timestamp) {
    if (!Number.isFinite(Number(timestamp))) return '-';
    const milliseconds = Number(timestamp) > 1e11 ? Number(timestamp) : Number(timestamp) * 1000;
    return new Date(milliseconds).toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false
    });
  }

  function noTradeReason(openingBalance) {
    const cfg = _testConfig && _testConfig.configuration || {};
    const settings = cfg.botSettings || {};
    if (cfg.botId === 'bokke-one-pack') {
      const live = settings.sizing_mode === 'live';
      const threshold = live ? 15 : 150;
      if (Number(openingBalance) < threshold) {
        return 'No trades - opening balance $' + Number(openingBalance).toFixed(0) +
          ' was below the $' + threshold + ' ' + (live ? '0.1-lot live' : '1-lot demo') + ' sizing minimum.';
      }
    }
    return 'No trades - no valid entry signal during this playback window.';
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function(character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function getTracker() { return _tracker; }
  function getAutoEngine() { return _autoEngine; }
  function getManagedEngine() { return _managedEngine; }
  function getTestConfig() { return _testConfig; }

  return {
    start: start,
    resume: resume,
    pause: pause,
    resumePlay: resumePlay,
    restoreCruise: restoreCruise,
    endTest: endTest,
    nextDay: nextDay,
    completeTest: completeTest,
    backToHub: backToHub,
    addStop: addStop,
    editTP: editTP,
    closePos: closePos,
    cycleChartTimeframe: cycleChartTimeframe,
    toggleChartVWAP: toggleChartVWAP,
    toggleChartRuler: toggleChartRuler,
    resetChartLive: resetChartLive,
    toggleChartFullscreen: toggleChartFullscreen,
    renderReplayUI: renderReplayUI,
    updateManagedPositionDisplay: updateManagedPositionDisplay,
    getTracker: getTracker,
    getAutoEngine: getAutoEngine,
    getManagedEngine: getManagedEngine,
    getTestConfig: getTestConfig,
    handleDayComplete: handleDayComplete,
    handleSpeedChange: handleSpeedChange
  };
})();
