'use strict';
window.BotLab = window.BotLab || {};

BotLab.SessionController = (function() {
  const ukTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });

  function minuteOfDay(timestampMs) {
    const parts = ukTime.formatToParts(new Date(timestampMs));
    let hour = 0;
    let minute = 0;
    for (const part of parts) {
      if (part.type === 'hour') hour = Number(part.value);
      if (part.type === 'minute') minute = Number(part.value);
    }
    return hour * 60 + minute;
  }

  function create(testConfig, autonomousRunner, managedRunner, interventionTracker) {
    const state = {
      config: testConfig,
      autonomous: autonomousRunner,
      managed: managedRunner,
      tracker: interventionTracker,
      currentDayIndex: 0,
      currentDayId: null,
      currentBarIndex: 0,
      currentPrice: 0,
      currentTimestamp: null,
      sessionActive: false,
      paused: false,
      cruiseSpeed: testConfig.cruiseSpeed || 50,
      currentSpeed: testConfig.cruiseSpeed || 50,
      replaySpeed: 1,
      sessionStartMin: testConfig.sessionStartMin == null ? 8 * 60 : Number(testConfig.sessionStartMin),
      sessionEndMin: testConfig.sessionEndMin == null ? 11 * 60 : Number(testConfig.sessionEndMin),
      bars: [],
      warmupBars: [],
      chartHistory: [],
      dayComplete: false,
      _slowdownActive: false,
      _slowdownTriggered: false,
      _onSpeedChange: null,
      _onDayComplete: null,
      _onTradeOpened: null
    };

    function setCallbacks(callbacks) {
      callbacks = callbacks || {};
      state._onSpeedChange = callbacks.onSpeedChange || null;
      state._onDayComplete = callbacks.onDayComplete || null;
      state._onTradeOpened = callbacks.onTradeOpened || null;
    }

    function contextFor(bar, barIndex, runner) {
      return {
        price: state.currentPrice,
        bar: bar || null,
        barIndex: barIndex,
        timestamp: state.currentTimestamp,
        balance: runner.engine.getBalance(),
        equity: runner.engine.getEquity(),
        usedMargin: runner.engine.getUsedMargin(),
        freeMargin: runner.engine.getFreeMargin(),
        openPositions: runner.getPositions().filter(pos => !pos.closed).map(pos => ({ ...pos })),
        currentSession: state.config.session || 'london',
        instrument: state.config.instrument || 'de40',
        sessionStart: state.sessionStartMin,
        sessionEnd: state.sessionEndMin,
        warmupBars: state.warmupBars,
        dayId: state.currentDayId
      };
    }

    async function startDay(dayBars, dayIndex, dayOptions, dayId) {
      let bars = dayBars;
      let options = dayOptions || {};
      if (!Array.isArray(dayBars) && dayBars && typeof dayBars === 'object') {
        bars = dayBars.bars;
        options = dayBars;
      } else if (Array.isArray(dayOptions)) {
        options = { warmupBars: dayOptions, dayId: dayId };
      }
      state.bars = Array.isArray(bars) ? bars : [];
      state.warmupBars = Array.isArray(options.warmupBars) ? options.warmupBars : [];
      state.chartHistory = Array.isArray(options.chartHistory) ? options.chartHistory : state.warmupBars;
      state.currentDayIndex = dayIndex == null ? 0 : dayIndex;
      state.currentDayId = options.dayId || options.key || String(state.currentDayIndex);
      state.currentBarIndex = 0;
      state.currentPrice = state.bars.length ? Number(state.bars[0][1]) : 0;
      state.currentTimestamp = state.bars.length ? Number(state.bars[0][0]) * 1000 : Date.now();
      state.sessionActive = true;
      state.paused = false;
      state.dayComplete = false;
      state._slowdownActive = false;
      state._slowdownTriggered = false;
      state.currentSpeed = state.cruiseSpeed;

      const firstBar = state.bars[0] || null;
      await Promise.all([
        state.autonomous.start(contextFor(firstBar, 0, state.autonomous)),
        state.managed.start(contextFor(firstBar, 0, state.managed))
      ]);
    }

    function isInSession(timestampMs) {
      const minute = minuteOfDay(timestampMs);
      return minute >= state.sessionStartMin && minute < state.sessionEndMin;
    }

    function isSessionOver(timestampMs) {
      return minuteOfDay(timestampMs) >= state.sessionEndMin;
    }

    async function processBar() {
      if (!state.sessionActive || state.paused || state.dayComplete) return null;
      if (state.currentBarIndex >= state.bars.length) {
        await completeDay('bars_exhausted');
        return { type: 'day_complete', reason: 'bars_exhausted' };
      }

      const bar = state.bars[state.currentBarIndex];
      const barTimestamp = Number(bar[0]) * 1000;
      if (isSessionOver(barTimestamp)) {
        await completeDay('session_end');
        return { type: 'day_complete', reason: 'session_end' };
      }
      if (!isInSession(barTimestamp)) {
        state.currentBarIndex++;
        return { type: 'skip', reason: 'outside_session' };
      }

      const barHigh = Number(bar[2]);
      const barLow = Number(bar[3]);
      const barClose = Number(bar[4]);
      state.currentPrice = barClose;
      state.currentTimestamp = barTimestamp;

      if (typeof state.managed.updateExcursions === 'function') state.managed.updateExcursions(barHigh, barLow);

      state.autonomous.engine.updateMFEMAE(barClose);
      state.managed.engine.updateMFEMAE(barClose);
      const autoClosures = state.autonomous.engine.checkStops(barClose, barHigh, barLow, barTimestamp)
        .concat(state.autonomous.engine.checkTPs(barClose, barHigh, barLow, barTimestamp));
      const managedClosures = state.managed.engine.checkStops(barClose, barHigh, barLow, barTimestamp)
        .concat(state.managed.engine.checkTPs(barClose, barHigh, barLow, barTimestamp));
      await Promise.all([
        state.autonomous.applyExecutionClosures(autoClosures),
        state.managed.applyExecutionClosures(managedClosures)
      ]);
      state.autonomous.engine.markToMarket(barClose, barTimestamp);
      state.managed.engine.markToMarket(barClose, barTimestamp);

      const managedPositionsBefore = state.managed.getPositions().filter(pos => !pos.closed).length;
      await Promise.all([
        state.autonomous.processBar(bar, contextFor(bar, state.currentBarIndex, state.autonomous)),
        state.managed.processBar(bar, contextFor(bar, state.currentBarIndex, state.managed))
      ]);
      const managedPositionsAfter = state.managed.getPositions().filter(pos => !pos.closed).length;
      if (managedPositionsAfter > managedPositionsBefore) await onManagedTradeOpened();

      const processedIndex = state.currentBarIndex;
      state.currentBarIndex++;
      return {
        type: 'bar',
        bar: bar,
        barIndex: processedIndex,
        timestamp: barTimestamp,
        price: barClose,
        autoEquity: state.autonomous.engine.getEquity(),
        managedEquity: state.managed.engine.getEquity(),
        autoOpenCount: state.autonomous.getPositions().filter(pos => !pos.closed).length,
        managedOpenCount: state.managed.getPositions().filter(pos => !pos.closed).length
      };
    }

    async function onManagedTradeOpened() {
      state._slowdownActive = true;
      state._slowdownTriggered = true;
      state.currentSpeed = 1;
      const info = {
        currentSpeed: 1,
        cruiseSpeed: state.cruiseSpeed,
        reason: 'trade_opened',
        message: 'Trade opened - replay slowed to 1x'
      };
      if (state._onSpeedChange) await state._onSpeedChange(info);
      if (state._onTradeOpened) await state._onTradeOpened(info);
    }

    function restoreCruiseSpeed() {
      if (state.paused) return;
      state.currentSpeed = state.cruiseSpeed;
      state._slowdownActive = false;
      if (state._onSpeedChange) state._onSpeedChange({
        currentSpeed: state.cruiseSpeed,
        cruiseSpeed: state.cruiseSpeed,
        reason: 'manual_restore',
        message: null
      });
    }

    function setCruiseSpeed(speed) {
      state.cruiseSpeed = speed;
      if (!state._slowdownActive && !state.paused) state.currentSpeed = speed;
    }

    function pause() { state.paused = true; }
    function resume() { state.paused = false; }

    async function completeDay(reason) {
      if (state.dayComplete) return;
      state.sessionActive = false;
      state.dayComplete = true;
      const closeContext = contextFor(null, state.currentBarIndex, state.autonomous);
      await Promise.all([
        state.autonomous.closeAllPositions(state.currentPrice, state.currentTimestamp, 'session_end'),
        state.managed.closeAllPositions(state.currentPrice, state.currentTimestamp, 'session_end')
      ]);
      await Promise.all([
        state.autonomous.endSession({ ...closeContext, balance: state.autonomous.engine.getBalance(), equity: state.autonomous.engine.getEquity() }),
        state.managed.endSession({ ...closeContext, balance: state.managed.engine.getBalance(), equity: state.managed.engine.getEquity() })
      ]);

      if (state._onDayComplete) await state._onDayComplete({
        dayIndex: state.currentDayIndex,
        dayId: state.currentDayId,
        reason: reason,
        autonomous: {
          equity: state.autonomous.engine.getEquity(),
          balance: state.autonomous.engine.getBalance(),
          equityCurve: state.autonomous.engine.getEquityCurve(),
          trades: state.autonomous.engine.getAllTrades(),
          closedPositions: state.autonomous.getClosedPositions()
        },
        managed: {
          equity: state.managed.engine.getEquity(),
          balance: state.managed.engine.getBalance(),
          equityCurve: state.managed.engine.getEquityCurve(),
          trades: state.managed.engine.getAllTrades(),
          closedPositions: state.managed.getClosedPositions()
        }
      });
    }

    function humanAddStop(positionId, stopPrice) {
      return state.managed.humanAddStop(positionId, stopPrice, state.currentPrice, state.currentTimestamp, state.config.testId, state.currentDayId);
    }

    function humanMoveStop(positionId, stopPrice) {
      return state.managed.humanMoveStop(positionId, stopPrice, state.currentPrice, state.currentTimestamp, state.config.testId, state.currentDayId);
    }

    function humanModifyTP(positionId, targetPrice) {
      return state.managed.humanModifyTP(positionId, targetPrice, state.currentPrice, state.currentTimestamp, state.config.testId, state.currentDayId);
    }

    function humanClosePosition(positionId) {
      return state.managed.humanClosePosition(positionId, state.currentPrice, state.currentTimestamp, state.config.testId, state.currentDayId);
    }

    function getCurrentManagedPositions() { return state.managed.getPositions().filter(pos => !pos.closed); }
    function getAllClosedPositions() {
      return { autonomous: state.autonomous.getClosedPositions(), managed: state.managed.getClosedPositions() };
    }
    function getProgress() {
      const total = state.bars.length;
      return {
        current: state.currentBarIndex,
        total: total,
        percent: total > 0 ? Math.round(state.currentBarIndex / total * 100) : 0,
        dayIndex: state.currentDayIndex,
        dayId: state.currentDayId,
        dayComplete: state.dayComplete
      };
    }
    function getSpeedState() {
      return {
        currentSpeed: state.currentSpeed,
        cruiseSpeed: state.cruiseSpeed,
        slowdownActive: state._slowdownActive,
        paused: state.paused
      };
    }

    return {
      setCallbacks, startDay, processBar, pause, resume, setCruiseSpeed, restoreCruiseSpeed,
      humanAddStop, humanMoveStop, humanModifyTP, humanClosePosition, getCurrentManagedPositions,
      getAllClosedPositions, getProgress, getSpeedState, isInSession, isSessionOver,
      completeDay, getState: () => ({ ...state })
    };
  }

  return { create };
})();
