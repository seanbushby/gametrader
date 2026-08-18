'use strict';
window.BotLab = window.BotLab || {};

BotLab.Bot = {
  create(botDef) {
    if (!botDef || !botDef.id || !botDef.name || !botDef.createInstance) {
      throw new Error('Invalid bot definition: must have id, name, and createInstance');
    }
    return {
      id: String(botDef.id),
      name: String(botDef.name),
      version: String(botDef.version || '1.0.0'),
      description: String(botDef.description || ''),
      instruments: Array.isArray(botDef.instruments) ? botDef.instruments.slice() : null,
      settingsSchema: botDef.settingsSchema || {},
      createInstance(settings, instrument) {
        const instance = botDef.createInstance(settings || {}, instrument);
        if (!instance || typeof instance !== 'object') throw new Error('createInstance must return an object');
        const requiredHooks = ['onStart', 'onBar', 'onTick', 'onSessionEnd'];
        for (const h of requiredHooks) {
          if (typeof instance[h] !== 'function') {
            instance[h] = function() {};
          }
        }
        return instance;
      }
    };
  },

  validateCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') return false;
    const validTypes = ['OPEN_POSITION', 'MODIFY_STOP', 'MODIFY_TP', 'CLOSE_POSITION'];
    if (validTypes.indexOf(cmd.type) < 0) return false;
    if (cmd.type === 'OPEN_POSITION') {
      const direction = String(cmd.direction || '').toLowerCase();
      if (direction !== 'long' && direction !== 'short') return false;
      if (!Number.isFinite(Number(cmd.size)) || Number(cmd.size) <= 0) return false;
      if (cmd.stopLoss != null && !Number.isFinite(Number(cmd.stopLoss))) return false;
      if (cmd.takeProfit != null && !Number.isFinite(Number(cmd.takeProfit))) return false;
      if (cmd.stopLossPoints != null && (!Number.isFinite(Number(cmd.stopLossPoints)) || Number(cmd.stopLossPoints) <= 0)) return false;
      if (cmd.takeProfitPoints != null && (!Number.isFinite(Number(cmd.takeProfitPoints)) || Number(cmd.takeProfitPoints) <= 0)) return false;
    } else {
      if (!cmd.positionId) return false;
      if (cmd.type === 'MODIFY_STOP' && !Number.isFinite(Number(cmd.stopLoss))) return false;
      if (cmd.type === 'MODIFY_TP' && !Number.isFinite(Number(cmd.takeProfit))) return false;
    }
    return true;
  },

  normalizeCommands(value) {
    if (value == null) return [];
    return (Array.isArray(value) ? value : [value]).filter(cmd => cmd != null);
  },

  validateSettings(schema, settings) {
    if (!schema || typeof schema !== 'object') return true;
    for (const [key, def] of Object.entries(schema)) {
      const val = settings[key];
      if (def.required && (val === undefined || val === null)) return false;
      if (def.type === 'number' && typeof val !== 'number') return false;
      if (def.min !== undefined && val < def.min) return false;
      if (def.max !== undefined && val > def.max) return false;
    }
    return true;
  },

  makeContext(state) {
    return {
      price: state.price,
      bar: state.bar,
      barIndex: state.barIndex,
      timestamp: state.timestamp,
      balance: state.balance,
      equity: state.equity,
      openPositions: state.openPositions || [],
      currentSession: state.currentSession,
      instrument: state.instrument,
      sessionStart: state.sessionStart,
      sessionEnd: state.sessionEnd,
      warmupBars: state.warmupBars || [],
      dayId: state.dayId == null ? null : state.dayId
    };
  }
};
