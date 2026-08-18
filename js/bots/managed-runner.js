'use strict';
window.BotLab = window.BotLab || {};

BotLab.ManagedRunner = (function() {
  function create(botInstance, executionEngine, config, interventionTracker) {
    if (!botInstance || !executionEngine) throw new Error('ManagedRunner requires a bot and execution engine');
    const state = {
      bot: botInstance,
      engine: executionEngine,
      config: config || {},
      tracker: interventionTracker,
      positions: [],
      closedPositions: [],
      commands: [],
      nextPositionId: 1,
      nextSignalId: 1,
      started: false,
      currentPrice: null,
      currentTimestamp: null,
      context: {}
    };

    function commandsFrom(value) {
      if (value == null) return [];
      return (Array.isArray(value) ? value : [value]).filter(cmd => cmd != null);
    }

    function hookContext(extra) {
      return {
        ...state.context,
        ...(extra || {}),
        price: state.currentPrice,
        timestamp: state.currentTimestamp,
        balance: state.engine.getBalance(),
        equity: state.engine.getEquity(),
        openPositions: state.positions.filter(pos => !pos.closed).map(pos => ({ ...pos }))
      };
    }

    async function invokeHook(name, args) {
      if (typeof botInstance[name] !== 'function') return [];
      return commandsFrom(await botInstance[name].apply(botInstance, args));
    }

    async function executeCommands(returned) {
      const queued = state.commands.splice(0);
      const seen = new Set();
      for (const cmd of queued.concat(returned || [])) {
        if (cmd && typeof cmd === 'object') {
          if (seen.has(cmd)) continue;
          seen.add(cmd);
        }
        await executeCommand(cmd);
      }
    }

    async function start(context) {
      state.started = true;
      state.context = { ...(context || {}) };
      state.currentPrice = context && context.price;
      state.currentTimestamp = context && context.timestamp;
      await executeCommands(await invokeHook('onStart', [hookContext()]));
    }

    async function processBar(bar, context) {
      if (!state.started) return [];
      state.context = { ...state.context, ...(context || {}), bar: bar, barIndex: context && context.barIndex };
      state.currentPrice = context && context.price;
      state.currentTimestamp = context && context.timestamp;
      const returned = await invokeHook('onBar', [bar, hookContext({ bar: bar })]);
      await executeCommands(returned);
      return returned;
    }

    async function processTick(price, timestamp, context) {
      if (!state.started) return [];
      state.context = { ...state.context, ...(context || {}) };
      state.currentPrice = price;
      state.currentTimestamp = timestamp;
      const tick = { price: price, timestamp: timestamp };
      const returned = await invokeHook('onTick', [tick, hookContext()]);
      await executeCommands(returned);
      return returned;
    }

    async function executeCommand(cmd) {
      if (!BotLab.Bot.validateCommand(cmd)) return null;
      const timestamp = state.currentTimestamp;
      const marketPrice = state.currentPrice;
      if (!Number.isFinite(Number(marketPrice))) return null;

      if (cmd.type === 'OPEN_POSITION') {
        const dayPrefix = state.context.dayId ? String(state.context.dayId) + '-' : '';
        const posId = 'M-' + dayPrefix + (state.nextPositionId++);
        const signalId = cmd.signalId || (dayPrefix + 'sig-' + (state.nextSignalId++));
        const fill = state.engine.openPosition({
          positionId: posId,
          signalId: signalId,
          direction: cmd.direction,
          size: cmd.size,
          price: marketPrice,
          timestamp: timestamp,
          branch: 'managed',
          rawFill: Boolean(cmd.rawFill)
        });
        if (!fill) return null;
        const dir = String(cmd.direction).toLowerCase() === 'long' ? 1 : -1;
        const stopLoss = cmd.stopLoss != null ? Number(cmd.stopLoss) :
          cmd.stopLossPoints != null ? fill.price - dir * Number(cmd.stopLossPoints) : null;
        const takeProfit = cmd.takeProfit != null ? Number(cmd.takeProfit) :
          cmd.takeProfitPoints != null ? fill.price + dir * Number(cmd.takeProfitPoints) : null;
        if (stopLoss != null) state.engine.modifyStop(posId, stopLoss, timestamp, 'bot');
        if (takeProfit != null && !cmd.strategyManagedTakeProfit) state.engine.modifyTP(posId, takeProfit, timestamp, 'bot');
        const pos = {
          id: posId,
          signalId: signalId,
          direction: dir === 1 ? 'long' : 'short',
          dir: dir,
          size: Number(cmd.size),
          entryPrice: fill.price,
          entryTimestamp: timestamp,
          stopLoss: stopLoss,
          takeProfit: takeProfit,
          branch: 'managed',
          closed: false,
          maxDrawdownPoints: 0,
          maxFavorablePoints: 0,
          humanStopOverride: false,
          humanStopCount: 0,
          humanTPOverride: false
        };
        state.positions.push(pos);
        await executeCommands(await invokeHook('onPositionOpened', [{ ...pos }, hookContext()]));
        return pos;
      }

      const pos = state.positions.find(item => item.id === cmd.positionId && !item.closed);
      if (!pos) return null;
      if (cmd.type === 'MODIFY_STOP') {
        if (!pos.humanStopOverride && state.engine.modifyStop(pos.id, cmd.stopLoss, timestamp, 'bot')) {
          pos.stopLoss = Number(cmd.stopLoss);
          await executeCommands(await invokeHook('onPositionModified', [{ ...pos }, hookContext()]));
          return pos;
        }
      } else if (cmd.type === 'MODIFY_TP') {
        if (!pos.humanTPOverride && state.engine.modifyTP(pos.id, cmd.takeProfit, timestamp, 'bot')) {
          pos.takeProfit = Number(cmd.takeProfit);
          await executeCommands(await invokeHook('onPositionModified', [{ ...pos }, hookContext()]));
          return pos;
        }
      } else if (cmd.type === 'CLOSE_POSITION') {
        const closePrice = cmd.closePrice == null ? marketPrice : Number(cmd.closePrice);
        const result = state.engine.closePosition(pos.id, closePrice, timestamp, cmd.reason || 'bot_exit', Boolean(cmd.rawFill));
        if (result) return applyExecutionClosure(result.record);
      }
      return null;
    }

    async function applyExecutionClosure(record) {
      if (!record) return null;
      const pos = state.positions.find(item => item.id === record.id && !item.closed);
      if (!pos) return null;
      Object.assign(pos, record, { closed: true });
      state.closedPositions.push({ ...pos });
      await executeCommands(await invokeHook('onPositionClosed', [{ ...pos }, hookContext()]));
      return pos;
    }

    async function applyExecutionClosures(records) {
      const applied = [];
      for (const record of records || []) {
        const pos = await applyExecutionClosure(record.record || record);
        if (pos) applied.push(pos);
      }
      return applied;
    }

    function updateExcursions(highPrice, lowPrice) {
      const high = Number(highPrice);
      const low = Number(lowPrice);
      if (!Number.isFinite(high) || !Number.isFinite(low)) return;
      for (const pos of state.positions) {
        if (pos.closed) continue;
        const favorable = pos.dir === 1 ? high - pos.entryPrice : pos.entryPrice - low;
        const adverse = pos.dir === 1 ? pos.entryPrice - low : high - pos.entryPrice;
        pos.maxFavorablePoints = Math.max(Number(pos.maxFavorablePoints) || 0, favorable);
        pos.maxDrawdownPoints = Math.max(Number(pos.maxDrawdownPoints) || 0, adverse);
      }
    }

    async function humanAddStop(positionId, stopPrice, marketPrice, timestamp, testId, dayId) {
      const pos = state.positions.find(item => item.id === positionId && !item.closed);
      const stop = Number(stopPrice);
      const market = Number(marketPrice);
      if (!pos || !Number.isFinite(stop) || !Number.isFinite(market)) return false;
      if ((pos.dir === 1 && stop >= market) || (pos.dir === -1 && stop <= market)) return false;
      if (pos.humanStopOverride) {
        const tightened = pos.dir === 1 ? stop > pos.stopLoss : stop < pos.stopLoss;
        if (!tightened) return false;
      }

      const previousStop = pos.stopLoss;
      const equityBefore = state.engine.getEquity();
      if (!state.engine.modifyStop(positionId, stop, timestamp, 'human')) return false;
      pos.stopLoss = stop;
      pos.humanStopOverride = true;
      pos.humanStopCount = (pos.humanStopCount || 0) + 1;
      if (state.tracker) state.tracker.log({
        testId: testId,
        dayId: dayId,
        marketTimestamp: new Date(timestamp).toISOString(),
        positionId: positionId,
        signalId: pos.signalId,
        action: previousStop == null ? 'ADD_STOP' : 'MOVE_STOP',
        previousValue: previousStop,
        newValue: stop,
        managedEquityBefore: equityBefore,
        source: 'human'
      });
      state.currentPrice = market;
      state.currentTimestamp = timestamp;
      await executeCommands(await invokeHook('onPositionModified', [{ ...pos }, hookContext()]));
      return true;
    }

    function humanMoveStop(positionId, stopPrice, marketPrice, timestamp, testId, dayId) {
      return humanAddStop(positionId, stopPrice, marketPrice, timestamp, testId, dayId);
    }

    async function humanModifyTP(positionId, targetPrice, marketPrice, timestamp, testId, dayId) {
      const pos = state.positions.find(item => item.id === positionId && !item.closed);
      const target = Number(targetPrice);
      const market = Number(marketPrice);
      if (!pos || !Number.isFinite(target) || !Number.isFinite(market)) return false;
      if ((pos.dir === 1 && target <= market) || (pos.dir === -1 && target >= market)) return false;
      const previousTarget = pos.takeProfit;
      const equityBefore = state.engine.getEquity();
      if (!state.engine.modifyTP(positionId, target, timestamp, 'human')) return false;
      pos.takeProfit = target;
      pos.humanTPOverride = true;
      if (state.tracker) state.tracker.log({
        testId: testId,
        dayId: dayId,
        marketTimestamp: new Date(timestamp).toISOString(),
        positionId: positionId,
        signalId: pos.signalId,
        action: 'MOVE_TP',
        previousValue: previousTarget,
        newValue: target,
        managedEquityBefore: equityBefore,
        source: 'human'
      });
      state.currentPrice = market;
      state.currentTimestamp = timestamp;
      await executeCommands(await invokeHook('onPositionModified', [{ ...pos }, hookContext()]));
      return true;
    }

    async function humanClosePosition(positionId, marketPrice, timestamp, testId, dayId) {
      const pos = state.positions.find(item => item.id === positionId && !item.closed);
      if (!pos || !Number.isFinite(Number(marketPrice))) return false;
      const equityBefore = state.engine.getEquity();
      const result = state.engine.closePosition(positionId, marketPrice, timestamp, 'manual_close');
      if (!result) return false;
      if (state.tracker) state.tracker.log({
        testId: testId,
        dayId: dayId,
        marketTimestamp: new Date(timestamp).toISOString(),
        positionId: positionId,
        signalId: pos.signalId,
        action: 'MANUAL_CLOSE',
        previousValue: null,
        newValue: null,
        managedEquityBefore: equityBefore,
        source: 'human'
      });
      state.currentPrice = Number(marketPrice);
      state.currentTimestamp = timestamp;
      await applyExecutionClosure(result.record);
      return true;
    }

    async function closeAllPositions(price, timestamp, reason) {
      state.currentPrice = price;
      state.currentTimestamp = timestamp;
      const records = [];
      for (const pos of state.positions.filter(item => !item.closed)) {
        const result = state.engine.closePosition(pos.id, price, timestamp, reason || 'session_end');
        if (result) records.push(result.record);
      }
      return applyExecutionClosures(records);
    }

    async function endSession(context) {
      state.context = { ...state.context, ...(context || {}) };
      await executeCommands(await invokeHook('onSessionEnd', [hookContext()]));
    }

    function getSnapshot() {
      return {
        positions: state.positions.map(pos => ({ ...pos })),
        closedPositions: state.closedPositions.map(pos => ({ ...pos })),
        nextPositionId: state.nextPositionId,
        nextSignalId: state.nextSignalId,
        started: state.started
      };
    }

    function restoreSnapshot(snap) {
      if (!snap) return;
      state.positions = (snap.positions || []).map(pos => ({ ...pos }));
      state.closedPositions = (snap.closedPositions || []).map(pos => ({ ...pos }));
      state.nextPositionId = snap.nextPositionId || 1;
      state.nextSignalId = snap.nextSignalId || 1;
      state.started = Boolean(snap.started);
    }

    function issueCommand(cmd) { state.commands.push(cmd); }

    return {
      engine: executionEngine,
      start, processBar, processTick, closeAllPositions, endSession, applyExecutionClosures,
      humanAddStop, humanMoveStop, humanModifyTP, humanClosePosition,
      updateExcursions, getSnapshot, restoreSnapshot, issueCommand,
      getPositions: () => state.positions,
      getClosedPositions: () => state.closedPositions
    };
  }

  return { create };
})();
