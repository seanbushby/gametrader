'use strict';
window.BotLab = window.BotLab || {};

BotLab.Storage = (function() {
  const STORE_KEY = 'gt_botlab_tests';
  const HISTORY_KEY = 'gt_botlab_history';
  const SCHEMA_VERSION = 2;
  const HISTORY_LIMIT = 50;

  function getStore(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (error) {
      return null;
    }
  }

  function setStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeStore(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function generateTestId() {
    try {
      return 'bl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    } catch (error) {
      return 'bl-' + String(Date.now());
    }
  }

  function migrate(data) {
    try {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      const version = data.schemaVersion == null ? 1 : Number(data.schemaVersion);
      if (version !== 1 && version !== SCHEMA_VERSION) return null;

      data.schemaVersion = SCHEMA_VERSION;
      data.createdAt = data.createdAt || data.updatedAt || new Date().toISOString();
      data.updatedAt = data.updatedAt || data.createdAt;
      data.configuration = data.configuration && typeof data.configuration === 'object'
        ? data.configuration
        : {};
      data.selectedDays = Array.isArray(data.selectedDays) ? data.selectedDays : [];
      data.completedDays = Array.isArray(data.completedDays) ? data.completedDays : [];
      data.daySnapshots = Array.isArray(data.daySnapshots) ? data.daySnapshots : [];
      data.interventions = Array.isArray(data.interventions) ? data.interventions : [];
      return data;
    } catch (error) {
      return null;
    }
  }

  function saveActiveTest(testState) {
    try {
      const migrated = migrate(testState);
      if (!migrated) return false;
      migrated.updatedAt = new Date().toISOString();
      return setStore(STORE_KEY, migrated);
    } catch (error) {
      return false;
    }
  }

  function getActiveTest() {
    try {
      const stored = getStore(STORE_KEY);
      const originalVersion = stored && stored.schemaVersion;
      const migrated = migrate(stored);
      if (!migrated) return null;
      if (originalVersion !== SCHEMA_VERSION) setStore(STORE_KEY, migrated);
      return migrated;
    } catch (error) {
      return null;
    }
  }

  function clearActiveTest() {
    return removeStore(STORE_KEY);
  }

  function compactSnapshot(snapshot) {
    try {
      const json = JSON.stringify(snapshot, function(key, value) {
        return key === 'bars' || key === 'warmupBars' ? undefined : value;
      });
      return migrate(JSON.parse(json));
    } catch (error) {
      return null;
    }
  }

  function readHistory() {
    const stored = getStore(HISTORY_KEY);
    if (!Array.isArray(stored)) return [];
    return stored.map(compactSnapshot).filter(Boolean).slice(-HISTORY_LIMIT);
  }

  function saveCompletedTest(testSnapshot) {
    try {
      const compact = compactSnapshot(testSnapshot);
      if (!compact || !compact.testId) return false;
      compact.status = compact.status || 'test_complete';
      compact.completedAt = compact.completedAt || new Date().toISOString();
      compact.updatedAt = new Date().toISOString();

      const history = readHistory().filter(function(item) {
        return item.testId !== compact.testId;
      });
      history.push(compact);
      const saved = setStore(HISTORY_KEY, history.slice(-HISTORY_LIMIT));
      if (saved) clearActiveTest();
      return saved;
    } catch (error) {
      return false;
    }
  }

  function getHistory() {
    try {
      const history = readHistory();
      setStore(HISTORY_KEY, history);
      return history;
    } catch (error) {
      return [];
    }
  }

  function getHistoryItem(testId) {
    try {
      return getHistory().find(function(item) { return item.testId === testId; }) || null;
    } catch (error) {
      return null;
    }
  }

  function deleteHistoryItem(testId) {
    try {
      return setStore(HISTORY_KEY, getHistory().filter(function(item) {
        return item.testId !== testId;
      }));
    } catch (error) {
      return false;
    }
  }

  function createTestConfig(params) {
    try {
      params = params || {};
      const now = new Date().toISOString();
      return {
        schemaVersion: SCHEMA_VERSION,
        testId: generateTestId(),
        status: 'configured',
        configuration: {
          botId: params.botId,
          botName: params.botName,
          botVersion: params.botVersion,
          botSettings: params.botSettings || {},
          instrument: params.instrument || 'de40',
          instrumentLabel: params.instrumentLabel || 'DE40',
          sessionWindow: params.sessionWindow || '08:00-11:00',
          sessionStartMin: params.sessionStartMin == null ? 8 * 60 : params.sessionStartMin,
          sessionEndMin: params.sessionEndMin == null ? 11 * 60 : params.sessionEndMin,
          days: params.days == null ? 1 : params.days,
          selectedDayKeys: params.selectedDayKeys || [],
          randomSeed: params.randomSeed == null ? Date.now() : params.randomSeed,
          startBalance: params.startBalance == null ? 10000 : params.startBalance,
          spread: params.spread == null ? 0 : params.spread,
          commission: params.commission == null ? 0 : params.commission,
          ptValue: params.ptValue == null ? 1 : params.ptValue,
          minSize: params.minSize == null ? 1 : params.minSize,
          sizeStep: params.sizeStep == null ? 1 : params.sizeStep,
          sizeDecimals: params.sizeDecimals == null ? 0 : params.sizeDecimals,
          decimals: params.decimals == null ? 1 : params.decimals,
          currency: params.currency || '$',
          maxSize: params.maxSize == null ? 50 : params.maxSize,
          cruiseSpeed: params.cruiseSpeed == null ? 50 : params.cruiseSpeed,
          includeBotAlone: params.includeBotAlone !== false,
          blindRun: Boolean(params.blindRun),
          propRules: params.propRules || false,
          propPreset: params.propPreset || null,
          endOfDayPolicy: 'close_all'
        },
        selectedDays: [],
        currentDayIndex: 0,
        autonomous: null,
        managed: null,
        interventions: [],
        completedDays: [],
        daySnapshots: [],
        comparisonMetrics: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null
      };
    } catch (error) {
      return null;
    }
  }

  function createBranchState(startBalance) {
    try {
      const opening = Number.isFinite(Number(startBalance)) ? Number(startBalance) : 0;
      return {
      openingBalance: opening,
      balance: opening,
      equity: opening,
      positions: {},
      closedPositions: [],
      trades: [],
      nextPositionId: 1,
      nextSignalId: 1,
      equityPeak: opening,
      maxDrawdown: 0,
      equityCurve: [],
      dailyPL: [],
      peakEquity: opening,
      lowestEquity: opening,
      finalBalance: opening,
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPL: 0,
      profitFactor: 0,
      avgTrade: 0,
      largestWin: 0,
      largestLoss: 0,
      avgHoldingTime: 0,
        winRate: 0
      };
    } catch (error) {
      return null;
    }
  }

  function updateBranchMetrics(branch, closedTrades, finalBalance) {
    try {
      if (!branch || typeof branch !== 'object') return branch;
      const trades = Array.isArray(closedTrades) ? closedTrades : [];
      const values = trades.map(function(trade) {
        const value = trade && trade.pl != null ? trade.pl : trade && trade.pnl;
        return Number.isFinite(Number(value)) ? Number(value) : 0;
      });
      const wins = values.filter(function(value) { return value > 0; });
      const losses = values.filter(function(value) { return value <= 0; });
      const totalPL = values.reduce(function(sum, value) { return sum + value; }, 0);
      const grossWins = wins.reduce(function(sum, value) { return sum + value; }, 0);
      const grossLosses = Math.abs(losses.reduce(function(sum, value) { return sum + value; }, 0));
      const holdingTimes = trades.map(function(trade) {
        const entry = trade && (trade.entryTs != null ? trade.entryTs : trade.entryTimestamp);
        const exit = trade && (trade.outTs != null ? trade.outTs : trade.exitTimestamp);
        return Number(exit) - Number(entry);
      }).filter(function(duration) { return Number.isFinite(duration) && duration >= 0; });

      branch.totalTrades = trades.length;
      branch.wins = wins.length;
      branch.losses = losses.length;
      branch.totalPL = totalPL;
      branch.profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 99 : 0;
      branch.winRate = trades.length ? wins.length / trades.length * 100 : 0;
      branch.avgTrade = trades.length ? totalPL / trades.length : 0;
      branch.largestWin = wins.length ? Math.max.apply(null, wins) : 0;
      branch.largestLoss = losses.length ? Math.min.apply(null, losses) : 0;
      branch.finalBalance = Number.isFinite(Number(finalBalance)) ? Number(finalBalance) : Number(branch.balance) || 0;
      branch.avgHoldingTime = holdingTimes.length
        ? holdingTimes.reduce(function(sum, duration) { return sum + duration; }, 0) / holdingTimes.length
        : 0;
      return branch;
    } catch (error) {
      return branch || null;
    }
  }

  return {
    generateTestId,
    saveActiveTest,
    getActiveTest,
    clearActiveTest,
    saveCompletedTest,
    getHistory,
    getHistoryItem,
    deleteHistoryItem,
    createTestConfig,
    createBranchState,
    updateBranchMetrics,
    migrate,
    SCHEMA_VERSION
  };
})();
