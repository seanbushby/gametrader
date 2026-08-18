'use strict';
window.BotLab = window.BotLab || {};

BotLab.ExecutionEngine = (function() {
  function create(config) {
    config = config || {};

    function finiteConfig(name, fallback, options) {
      const value = config[name] == null ? fallback : Number(config[name]);
      if (!Number.isFinite(value) || (options && options.positive && value <= 0) ||
          (options && options.nonNegative && value < 0)) {
        throw new Error('Invalid execution config: ' + name);
      }
      return value;
    }

    const startBalance = finiteConfig('startBalance', 10000, {});
    const engineConfig = {
      ptValue: finiteConfig('ptValue', 1, { positive: true }),
      spread: finiteConfig('spread', 0, { nonNegative: true }),
      commission: finiteConfig('commission', 0, { nonNegative: true }),
      contractSize: finiteConfig('contractSize', 1, { positive: true }),
      quoteToAccountRate: finiteConfig('quoteToAccountRate', 1, { positive: true }),
      marginRate: finiteConfig('marginRate', 0, { nonNegative: true }),
      maxSize: finiteConfig('maxSize', 50, { positive: true }),
      minSize: finiteConfig('minSize', 1, { positive: true }),
      sizeStep: finiteConfig('sizeStep', 1, { positive: true }),
      sizeDecimals: finiteConfig('sizeDecimals', 0, { nonNegative: true }),
      currency: config.currency || '$',
      decimals: finiteConfig('decimals', 1, { nonNegative: true }),
      branch: config.branch || 'unknown'
    };
    if (engineConfig.minSize > engineConfig.maxSize) {
      throw new Error('Invalid execution config: minSize exceeds maxSize');
    }
    if (!Number.isInteger(engineConfig.sizeDecimals) || !Number.isInteger(engineConfig.decimals)) {
      throw new Error('Invalid execution config: decimal counts must be integers');
    }

    const state = {
      balance: startBalance,
      equity: startBalance,
      equityCurve: [startBalance],
      positions: new Map(),
      closedPositions: [],
      nextTicketId: 1,
      config: engineConfig,
      lastMarketPrice: null,
      lastTimestamp: null
    };

    function getBalance() { return state.balance; }
    function getEquity() { return state.equity; }
    function getEquityCurve() { return state.equityCurve.slice(); }
    function marginFor(size, price) {
      return Math.abs(Number(size)) * Math.abs(Number(price)) * state.config.contractSize * state.config.quoteToAccountRate * state.config.marginRate;
    }
    function getUsedMargin() {
      let used = 0;
      for (const pos of state.positions.values()) used += marginFor(pos.size, pos.entryPrice);
      return used;
    }
    function getFreeMargin() { return state.equity - getUsedMargin(); }

    function validSize(value) {
      const size = Number(value);
      if (!Number.isFinite(size) || size < state.config.minSize || size > state.config.maxSize) return false;
      if (Math.abs(size - Number(size.toFixed(state.config.sizeDecimals))) > 1e-8) return false;
      const steps = (size - state.config.minSize) / state.config.sizeStep;
      return Math.abs(steps - Math.round(steps)) < 1e-8;
    }

    function entryFillAt(price, direction) {
      return Number(price) + (direction === 1 ? 1 : -1) * state.config.spread / 2;
    }

    function exitFillAt(price, direction) {
      return Number(price) - (direction === 1 ? 1 : -1) * state.config.spread / 2;
    }

    function netPL(entry, exit, direction, size) {
      const gross = (exit - entry) * direction * size * state.config.ptValue;
      return gross - Math.abs(size) * state.config.commission;
    }

    function markToMarket(currentPrice, timestamp) {
      const marketPrice = Number(currentPrice);
      if (!Number.isFinite(marketPrice)) throw new Error('Invalid market price');
      let unrealized = 0;
      for (const pos of state.positions.values()) {
        const exit = exitFillAt(marketPrice, pos.dir);
        unrealized += netPL(pos.entryPrice, exit, pos.dir, pos.size);
      }
      state.lastMarketPrice = marketPrice;
      if (timestamp != null) state.lastTimestamp = timestamp;
      state.equity = state.balance + unrealized;
      state.equityCurve.push(state.equity);
      return state.equity;
    }

    function openPosition(params) {
      params = params || {};
      const direction = String(params.direction || '').toLowerCase();
      const dir = direction === 'long' ? 1 : direction === 'short' ? -1 : 0;
      const marketPrice = Number(params.price);
      const size = Number(params.size);
      if (!dir || !Number.isFinite(marketPrice) || !validSize(size)) return null;

      const fill = params.rawFill ? marketPrice : entryFillAt(marketPrice, dir);
      if (marginFor(size, fill) > getFreeMargin() + 1e-8) return null;
      const posId = params.positionId || ('pos-' + (state.nextTicketId++));
      if (state.positions.has(posId)) return null;
      const stopLoss = params.stopLoss == null ? null : Number(params.stopLoss);
      const takeProfit = params.takeProfit == null ? null : Number(params.takeProfit);
      if ((stopLoss != null && !Number.isFinite(stopLoss)) || (takeProfit != null && !Number.isFinite(takeProfit))) return null;
      const timestamp = params.timestamp == null ? Date.now() : params.timestamp;
      const pos = {
        id: posId,
        signalId: params.signalId || null,
        direction: direction,
        dir: dir,
        size: size,
        entryPrice: fill,
        entryTimestamp: timestamp,
        stopLoss: stopLoss,
        takeProfit: takeProfit,
        branch: params.branch || state.config.branch,
        closed: false,
        initRiskPts: stopLoss == null ? 0 : Math.abs(fill - stopLoss),
        peakRiskEur: 0,
        mfe: 0,
        mae: 0
      };
      pos.peakRiskEur = Math.max(20, stopLoss == null ? 20 : Math.abs(netPL(fill, stopLoss, dir, size)));
      state.positions.set(posId, pos);
      state.lastMarketPrice = marketPrice;
      state.lastTimestamp = timestamp;
      markToMarket(marketPrice, timestamp);
      return { price: fill, positionId: posId, position: { ...pos } };
    }

    function closePositionAtPrice(posId, marketPrice, timestamp, reason, rawFill) {
      const pos = state.positions.get(posId);
      const suppliedPrice = Number(marketPrice);
      if (!pos || pos.closed || !Number.isFinite(suppliedPrice)) return null;
      const exit = rawFill ? suppliedPrice : exitFillAt(suppliedPrice, pos.dir);
      const pl = netPL(pos.entryPrice, exit, pos.dir, pos.size);
      const outTimestamp = timestamp == null ? Date.now() : timestamp;
      pos.closed = true;
      state.balance += pl;
      const record = {
        ...pos,
        exitPrice: exit,
        exitTimestamp: outTimestamp,
        pnl: pl,
        reason: reason || 'manual',
        closed: true,
        entry: pos.entryPrice,
        exit: exit,
        entryTs: pos.entryTimestamp,
        inTs: pos.entryTimestamp,
        outTs: outTimestamp,
        pl: pl
      };
      state.closedPositions.push(record);
      state.positions.delete(posId);
      state.lastMarketPrice = suppliedPrice;
      state.lastTimestamp = outTimestamp;
      markToMarket(suppliedPrice, outTimestamp);
      return { price: exit, pnl: pl, record: { ...record } };
    }

    function closePosition(posId, marketPrice, timestamp, reason, rawFill) {
      return closePositionAtPrice(posId, marketPrice, timestamp, reason, rawFill);
    }

    function modifyStop(posId, newStop) {
      const pos = state.positions.get(posId);
      const value = Number(newStop);
      if (!pos || pos.closed || !Number.isFinite(value)) return false;
      pos.stopLoss = value;
      return true;
    }

    function modifyTP(posId, newTP) {
      const pos = state.positions.get(posId);
      const value = Number(newTP);
      if (!pos || pos.closed || !Number.isFinite(value)) return false;
      pos.takeProfit = value;
      return true;
    }

    function checkStops(currentPrice, highPrice, lowPrice, timestamp) {
      const triggered = [];
      for (const [posId, pos] of Array.from(state.positions.entries())) {
        if (pos.stopLoss == null) continue;
        const hit = pos.dir === 1 ? Number(lowPrice) <= pos.stopLoss : Number(highPrice) >= pos.stopLoss;
        if (hit) {
          const result = closePositionAtPrice(posId, pos.stopLoss, timestamp, 'stop');
          if (result) triggered.push(result.record);
        }
      }
      return triggered;
    }

    function checkTPs(currentPrice, highPrice, lowPrice, timestamp) {
      const triggered = [];
      for (const [posId, pos] of Array.from(state.positions.entries())) {
        if (pos.takeProfit == null) continue;
        const hit = pos.dir === 1 ? Number(highPrice) >= pos.takeProfit : Number(lowPrice) <= pos.takeProfit;
        if (hit) {
          const result = closePositionAtPrice(posId, pos.takeProfit, timestamp, 'target');
          if (result) triggered.push(result.record);
        }
      }
      return triggered;
    }

    function updateMFEMAE(currentPrice) {
      const price = Number(currentPrice);
      if (!Number.isFinite(price)) return;
      for (const pos of state.positions.values()) {
        const unrealized = netPL(pos.entryPrice, exitFillAt(price, pos.dir), pos.dir, pos.size);
        if (unrealized > pos.mfe) pos.mfe = unrealized;
        if (unrealized < pos.mae) pos.mae = unrealized;
        if (pos.stopLoss != null) {
          pos.peakRiskEur = Math.max(pos.peakRiskEur, Math.abs(netPL(pos.entryPrice, pos.stopLoss, pos.dir, pos.size)));
        }
      }
    }

    function getOpenPositions() { return Array.from(state.positions.values(), pos => ({ ...pos })); }
    function getClosedPositions() { return state.closedPositions.map(pos => ({ ...pos })); }
    function getAllTrades() { return getClosedPositions(); }

    function getSnapshot() {
      const positions = {};
      for (const [key, value] of state.positions) positions[key] = { ...value };
      return {
        balance: state.balance,
        equity: state.equity,
        equityCurve: state.equityCurve.slice(),
        positions: positions,
        closedPositions: getClosedPositions(),
        nextTicketId: state.nextTicketId,
        lastMarketPrice: state.lastMarketPrice,
        lastTimestamp: state.lastTimestamp
      };
    }

    function restoreSnapshot(snap) {
      if (!snap) return;
      if (Number.isFinite(snap.balance)) state.balance = snap.balance;
      if (Number.isFinite(snap.equity)) state.equity = snap.equity;
      state.equityCurve = Array.isArray(snap.equityCurve) ? snap.equityCurve.slice() : [state.equity];
      state.positions.clear();
      for (const [key, value] of Object.entries(snap.positions || {})) state.positions.set(key, { ...value });
      state.closedPositions = (snap.closedPositions || []).map(pos => ({ ...pos }));
      if (Number.isFinite(snap.nextTicketId)) state.nextTicketId = snap.nextTicketId;
      state.lastMarketPrice = snap.lastMarketPrice == null ? null : snap.lastMarketPrice;
      state.lastTimestamp = snap.lastTimestamp == null ? null : snap.lastTimestamp;
    }

    return {
      getBalance, getEquity, getEquityCurve, markToMarket, openPosition, closePosition,
      closePositionAtPrice, modifyStop, modifyTP, checkStops, checkTPs, updateMFEMAE,
      getOpenPositions, getClosedPositions, getAllTrades, getSnapshot, restoreSnapshot,
      netPL, entryFillAt, exitFillAt, marginFor, getUsedMargin, getFreeMargin
    };
  }

  return { create };
})();
