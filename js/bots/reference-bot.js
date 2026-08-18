'use strict';
window.BotLab = window.BotLab || {};

BotLab.ReferenceBot = (function() {
  function create() {
    return {
      id: 'reference-simple-ma',
      name: 'Simple MA Crossover',
      version: '1.0.0',
      description: 'A deterministic reference bot that enters long when price closes above its 20-bar moving average and short when it closes below. This is a demo bot for testing the Bot Lab architecture.',
      settingsSchema: {
        fastPeriod: { type: 'number', min: 5, max: 50, default: 10, label: 'Fast MA Period' },
        slowPeriod: { type: 'number', min: 10, max: 200, default: 20, label: 'Slow MA Period' },
        stopLossPct: { type: 'number', min: 0.02, max: 0.5, default: 0.08, label: 'Stop Loss %' },
        takeProfitPct: { type: 'number', min: 0.02, max: 1.0, default: 0.12, label: 'Take Profit %' },
        size: { type: 'number', min: 1, max: 10, default: 1, label: 'Position Size' }
      },
      createInstance: function(settings) {
        const fastPeriod = settings.fastPeriod || 10;
        const slowPeriod = settings.slowPeriod || 20;
        const stopPct = settings.stopLossPct || 0.08;
        const tpPct = settings.takeProfitPct || 0.12;
        const size = settings.size || 1;

        const bars = [];
        let lastSignal = null;
        let hasPosition = false;

        function sma(period) {
          if (bars.length < period) return null;
          let sum = 0;
          for (let i = bars.length - period; i < bars.length; i++) {
            sum += bars[i][4];
          }
          return sum / period;
        }

        return {
          onStart: function(ctx) {
            bars.length = 0;
            lastSignal = null;
            hasPosition = false;
          },

          onBar: function(bar, ctx) {
            bars.push(bar);
            if (bars.length < slowPeriod + 1) return;

            const fastMA = sma(fastPeriod);
            const slowMA = sma(slowPeriod);
            if (fastMA == null || slowMA == null) return;

            const currentClose = bar[4];
            const prevBars = bars.slice(0, -1);
            const prevFast = (function() {
              if (prevBars.length < fastPeriod) return null;
              let s = 0;
              for (let i = prevBars.length - fastPeriod; i < prevBars.length; i++) s += prevBars[i][4];
              return s / fastPeriod;
            })();
            const prevSlow = (function() {
              if (prevBars.length < slowPeriod) return null;
              let s = 0;
              for (let i = prevBars.length - slowPeriod; i < prevBars.length; i++) s += prevBars[i][4];
              return s / slowPeriod;
            })();

            if (prevFast == null || prevSlow == null) return;

            const crossUp = prevFast <= prevSlow && fastMA > slowMA;
            const crossDown = prevFast >= prevSlow && fastMA < slowMA;

            if (hasPosition) {
              return;
            }

            if (crossUp) {
              hasPosition = true;
              lastSignal = 'long';
              return {
                type: 'OPEN_POSITION',
                direction: 'long',
                size: size,
                stopLoss: currentClose * (1 - stopPct / 100),
                takeProfit: currentClose * (1 + tpPct / 100)
              };
            }

            if (crossDown) {
              hasPosition = true;
              lastSignal = 'short';
              return {
                type: 'OPEN_POSITION',
                direction: 'short',
                size: size,
                stopLoss: currentClose * (1 + stopPct / 100),
                takeProfit: currentClose * (1 - tpPct / 100)
              };
            }
          },

          onTick: function(tick) {},

          onPositionOpened: function(position, ctx) {
            hasPosition = true;
          },

          onPositionModified: function(position, ctx) {},

          onPositionClosed: function(position, ctx) {
            hasPosition = false;
            lastSignal = null;
          },

          onSessionEnd: function(ctx) {}
        };
      }
    };
  }

  return { create };
})();
