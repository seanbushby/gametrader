'use strict';
window.BotLab = window.BotLab || {};

BotLab.InterventionTracker = (function() {
  function create() {
    const state = {
      log: [],
      testId: null
    };

    function setTestId(id) {
      state.testId = id;
    }

    function log(entry) {
      if (!entry.interventionId) {
        entry.interventionId = 'int-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      }
      entry.testId = entry.testId || state.testId;
      state.log.push({
        interventionId: entry.interventionId,
        testId: entry.testId,
        dayId: entry.dayId || null,
        marketTimestamp: entry.marketTimestamp,
        positionId: entry.positionId,
        signalId: entry.signalId || null,
        action: entry.action,
        previousValue: entry.previousValue,
        newValue: entry.newValue,
        managedEquityBefore: entry.managedEquityBefore,
        source: entry.source || 'human',
        reason: entry.reason || null,
        createdAt: new Date().toISOString()
      });
    }

    function getLog() {
      return state.log.map(e => ({ ...e }));
    }

    function getLogForDay(dayId) {
      return state.log.filter(e => e.dayId === dayId).map(e => ({ ...e }));
    }

    function getLogForPosition(positionId) {
      return state.log.filter(e => e.positionId === positionId).map(e => ({ ...e }));
    }

    function getSnapshot() {
      return state.log.map(e => ({ ...e }));
    }

    function restoreSnapshot(logData) {
      state.log = (logData || []).map(e => ({ ...e }));
    }

    function getSummary() {
      const actions = { ADD_STOP: 0, MOVE_STOP: 0, MOVE_TP: 0, MANUAL_CLOSE: 0 };
      for (const entry of state.log) {
        if (actions[entry.action] !== undefined) {
          actions[entry.action]++;
        }
      }
      return {
        totalInterventions: state.log.length,
        stopsAdded: actions.ADD_STOP,
        stopsMoved: actions.MOVE_STOP,
        targetsMoved: actions.MOVE_TP,
        manualCloses: actions.MANUAL_CLOSE
      };
    }

    function clear() {
      state.log = [];
    }

    return {
      log,
      getLog,
      getLogForDay,
      getLogForPosition,
      getSnapshot,
      restoreSnapshot,
      getSummary,
      setTestId,
      clear
    };
  }

  return { create };
})();
