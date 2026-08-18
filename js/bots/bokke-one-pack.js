'use strict';
window.BotLab = window.BotLab || {};

BotLab.BokkeOnePack = (function() {
  var WOLF_FAST = 3;
  var WOLF_SLOW = 8;
  var MA_FAST = 25;
  var MA_SLOW = 100;
  var MIN_CANDLES = 120;
  var PROFILES = {
    de40: {
      tp_pts: 55, tight_sl_trig: 15, band_pts: 10, hard_sl_pts: 14,
      hard_sl_time: '11:00', entry_start: '08:15', entry_cutoff: '11:00',
      stop_time: '13:00', gate_on: true, sizing_mode: 'demo', max_lot_cap: 250,
      rawFill: true
    },
    ustec: {
      tp_pts: 55, tight_sl_trig: 25, band_pts: 10, hard_sl_pts: 5,
      hard_sl_time: '12:00', entry_start: '08:15', entry_cutoff: '11:00',
      stop_time: '13:00', gate_on: false, sizing_mode: 'live', max_lot_cap: 50,
      rawFill: false
    }
  };

  var ukFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  var ukDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  });

  function ema(previous, value, period) {
    var alpha = 2.0 / (period + 1.0);
    return alpha * value + (1.0 - alpha) * previous;
  }

  function ukMinute(timestampSeconds) {
    var parts = ukFormatter.formatToParts(new Date(Number(timestampSeconds) * 1000));
    var hour = 0;
    var minute = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'hour') hour = Number(parts[i].value);
      if (parts[i].type === 'minute') minute = Number(parts[i].value);
    }
    return hour * 60 + minute;
  }

  function ukDate(timestampSeconds) {
    var parts = ukDateFormatter.formatToParts(new Date(Number(timestampSeconds) * 1000));
    var values = {};
    for (var i = 0; i < parts.length; i++) values[parts[i].type] = parts[i].value;
    return values.year + '-' + values.month + '-' + values.day;
  }

  function createGateState() {
    return {
      closesCount: 0, ema3: null, ema8: null, previousSpread: 0.0,
      previousBucket: null, bucketBars: [], crossedUp: false, crossedDown: false
    };
  }

  function parseMinute(value, fallback) {
    var parts = String(value == null ? fallback : value).split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function isEntryTime(timestampSeconds, startMinute, cutoffMinute) {
    var minute = ukMinute(timestampSeconds);
    return minute >= startMinute && minute < cutoffMinute;
  }

  function isOpeningSync(timestampSeconds) {
    var minute = ukMinute(timestampSeconds);
    return minute >= 8 * 60 + 15 && minute <= 9 * 60;
  }

  function isGateTime(timestampSeconds) {
    var minute = ukMinute(timestampSeconds);
    return minute >= 11 * 60 && minute <= 15 * 60;
  }

  function computePositionSize(balance, mode, maximumLots) {
    var available = Number(balance);
    var cap = Number(maximumLots);
    if (!Number.isFinite(available) || available <= 0) return 0;
    if (!Number.isFinite(cap) || cap <= 0) cap = 250;
    if (mode === 'live') {
      if (available < 15) return 0;
      return Math.min(cap, Math.floor(available / 15) / 10);
    }
    if (available < 150) return 0;
    return Math.min(cap, Math.floor(available / 150));
  }

  function profileForInstrument(instrument) {
    return PROFILES[instrument] || PROFILES.de40;
  }

  function settingsForInstrument(settings, instrument) {
    return Object.assign({}, profileForInstrument(instrument), settings || {});
  }

  function executionForInstrument(instrument) {
    return instrument === 'de40'
      ? { engine: { ptValue: 1, spread: 0, commission: 0 }, rawFill: true }
      : { engine: {}, rawFill: false };
  }

  function stepGate(bar, gateState) {
    var timestamp = Number(bar[0]);
    var minute = ukMinute(timestamp);
    gateState.crossedUp = false;
    gateState.crossedDown = false;
    if (minute < 8 * 60 || minute > 16 * 60) return gateState;

    var bucket = Math.floor(timestamp / 600) * 600;
    if (gateState.previousBucket !== null && bucket !== gateState.previousBucket && gateState.bucketBars.length) {
      var close = Number(gateState.bucketBars[gateState.bucketBars.length - 1][4]);
      gateState.closesCount++;
      if (gateState.ema3 === null) {
        gateState.ema3 = close;
        gateState.ema8 = close;
      } else {
        gateState.ema3 = ema(gateState.ema3, close, 3);
        gateState.ema8 = ema(gateState.ema8, close, 8);
      }
      var spread = (gateState.ema3 - gateState.ema8) * 1.001;
      gateState.crossedUp = gateState.closesCount >= 2 && gateState.previousSpread <= 0 && spread > 0;
      gateState.crossedDown = gateState.closesCount >= 2 && gateState.previousSpread >= 0 && spread < 0;
      gateState.previousSpread = spread;
      gateState.bucketBars = [];
    }
    gateState.bucketBars.push(bar);
    gateState.previousBucket = bucket;
    return gateState;
  }

  function create() {
    return {
      id: 'bokke-one-pack',
       name: 'Bokke DE40 Wolf Cross Engine',
        version: '1.4.0',
       description: 'DE40 EMA3/8 Wolf Cross strategy with London-session management and balance-based IC-style sizing.',
       instruments: ['de40', 'ustec'],
      settingsSchema: {
        tp_pts: { type: 'number', min: 10, max: 200, default: 55, label: 'Take Profit (pts)' },
        tight_sl_trig: { type: 'number', min: 5, max: 100, default: 15, label: 'Tight SL Trigger (pts)' },
        band_pts: { type: 'number', min: 1, max: 50, default: 10, label: 'Min EMA Band Width (pts)' },
         hard_sl_pts: { type: 'number', min: 0, max: 100, default: 14, label: 'Hard SL Distance (pts)' },
        hard_sl_time: { type: 'text', default: '11:00', label: 'Hard SL Activation (UK)' },
        entry_start: { type: 'text', default: '08:15', label: 'Entry Start (UK)' },
        entry_cutoff: { type: 'text', default: '11:00', label: 'Entry Cutoff (UK)' },
        stop_time: { type: 'text', default: '13:00', label: 'Time Stop (UK)' },
        gate_on: { type: 'boolean', default: true, label: 'Trend Gate' },
        sizing_mode: {
          type: 'select', default: 'demo', label: 'Dynamic Lot Sizing',
          options: [
            { value: 'demo', label: 'Demo - 1 lot per $150' },
            { value: 'live', label: 'Live - 0.1 lot per $15' }
          ]
        },
        max_lot_cap: { type: 'number', min: 1, max: 250, default: 250, label: 'Maximum Lots' }
      },

       createInstance: function(settings, instrument) {
         settings = settingsForInstrument(settings, instrument);
         var profile = profileForInstrument(instrument);
         var takeProfitPoints = Number(settings.tp_pts);
         var tightStopTrigger = Number(settings.tight_sl_trig);
         var bandPoints = Number(settings.band_pts);
          var hardStopPoints = Number(settings.hard_sl_pts);
         var hardStopMinute = parseMinute(settings.hard_sl_time, profile.hard_sl_time);
         var entryStartMinute = parseMinute(settings.entry_start, profile.entry_start);
         var entryCutoffMinute = parseMinute(settings.entry_cutoff, profile.entry_cutoff);
         var stopMinute = parseMinute(settings.stop_time, profile.stop_time);
         var gateEnabled = Boolean(settings.gate_on);
        var sizingMode = settings.sizing_mode === 'live' ? 'live' : 'demo';
         var maximumLots = Number(settings.max_lot_cap);
         var rawFill = Boolean(profile.rawFill);
        var bars = [];
        var state;

        function resetState() {
          state = {
            hasPosition: false,
            positionId: null,
            direction: null,
            entryPrice: null,
            tightStop: null,
            tightStopPlaced: false,
            hardStop: null,
            hardStopActive: false,
             stopped: false,
             currentBarTs: null,
             ema3: null,
             ema8: null,
             ema25: null,
             ema100: null,
             previousWolfSpread: 0.0,
             entryBlockUntilTs: 0,
             gateDate: null,
             gate: createGateState()
          };
        }

        resetState();

        return {
           onStart: function(ctx) {
             bars = ctx && Array.isArray(ctx.warmupBars) ? ctx.warmupBars.slice() : [];
             resetState();
             for (var i = 0; i < bars.length; i++) updateIndicators(bars[i]);
           },

          onBar: function(bar, ctx) {
             bars.push(bar);
             var timestamp = Number(bar[0]);
             state.currentBarTs = timestamp;
             var indicators = updateIndicators(bar);
             if (bars.length < MIN_CANDLES) return null;

            var high = Number(bar[2]);
            var low = Number(bar[3]);
            var close = Number(bar[4]);

            if (state.hasPosition && state.direction) {
              var entry = state.entryPrice;
              var isLong = state.direction === 'LONG';
              var profit = isLong ? close - entry : entry - close;
              var hardStopHit = state.hardStop !== null && (isLong ? low <= state.hardStop : high >= state.hardStop);

              if (!state.hardStopActive && hardStopPoints > 0 && ukMinute(timestamp) >= hardStopMinute) {
                state.hardStop = isLong ? entry - hardStopPoints : entry + hardStopPoints;
                state.hardStopActive = true;
              }
               if (hardStopHit) {
                 return closeAt(state.hardStop, 'hard_sl');
              }

              var tightStopHit = state.tightStop !== null && (isLong ? low <= state.tightStop : high >= state.tightStop);
              if (profit >= tightStopTrigger && !state.tightStopPlaced) {
                state.tightStop = isLong ? entry - 1.0 : entry + 1.0;
                state.tightStopPlaced = true;
              }
              if (tightStopHit) {
                 return closeAt(state.tightStop, 'tight_sl');
              }

              if (!state.tightStopPlaced && !state.stopped && ukMinute(timestamp) >= stopMinute) {
                state.stopped = true;
                 return closeAt(null, 'time_stop');
              }

              var takeProfit = isLong ? entry + takeProfitPoints : entry - takeProfitPoints;
              var takeProfitHit = isLong ? high >= takeProfit : low <= takeProfit;
              if (takeProfitHit) {
                 return closeAt(takeProfit, 'tp_hit');
              }

              if (gateEnabled && isGateTime(timestamp)) {
                 if ((isLong && state.gate.crossedDown) || (!isLong && state.gate.crossedUp)) {
                   return closeAt(null, 'gate_exit');
                }
              }
              return null;
            }

            if (timestamp <= state.entryBlockUntilTs) return null;
            if (!isEntryTime(timestamp, entryStartMinute, entryCutoffMinute)) return null;

             var wolfUp = indicators.wolfUp;
             var wolfDown = indicators.wolfDown;
             var bandOk = Math.abs(state.ema25 - state.ema100) >= bandPoints;
            var openingSync = isOpeningSync(timestamp);
            var direction = null;

             if (wolfUp && bandOk && (openingSync || state.ema25 > state.ema100)) direction = 'LONG';
             else if (wolfDown && bandOk && (openingSync || state.ema25 < state.ema100)) direction = 'SHORT';
            if (!direction) return null;

            var size = computePositionSize(ctx && ctx.balance, sizingMode, maximumLots);
            if (!(size > 0)) return null;

            return {
              type: 'OPEN_POSITION',
               direction: direction === 'LONG' ? 'long' : 'short',
               size: size,
               takeProfitPoints: takeProfitPoints,
               strategyManagedTakeProfit: true,
                rawFill: rawFill
            };
          },

          onTick: function(tick, ctx) {},

          onPositionOpened: function(position, ctx) {
            state.hasPosition = true;
            state.positionId = position.id;
            state.direction = String(position.direction).toLowerCase() === 'long' ? 'LONG' : 'SHORT';
            state.entryPrice = Number(position.entryPrice);
            state.tightStop = null;
            state.tightStopPlaced = false;
            state.hardStop = null;
            state.hardStopActive = false;
            state.stopped = false;
          },

          onPositionModified: function(position, ctx) {},

          onPositionClosed: function(position, ctx) {
            var closedTimestamp = position && Number(position.exitTimestamp);
            if (Number.isFinite(closedTimestamp)) {
              if (closedTimestamp > 100000000000) closedTimestamp /= 1000;
            } else {
              closedTimestamp = state.currentBarTs;
            }
            state.entryBlockUntilTs = closedTimestamp == null ? 0 : closedTimestamp + 60;
            state.hasPosition = false;
            state.positionId = null;
            state.direction = null;
            state.entryPrice = null;
            state.tightStop = null;
            state.tightStopPlaced = false;
            state.hardStop = null;
            state.hardStopActive = false;
            state.stopped = false;
          },

          onSessionEnd: function(ctx) {
            state.hasPosition = false;
            state.positionId = null;
            state.direction = null;
          }
        };

        function updateIndicators(bar) {
          var close = Number(bar[4]);
          if (state.ema3 === null) {
            state.ema3 = state.ema8 = state.ema25 = state.ema100 = close;
          } else {
            state.ema3 = ema(state.ema3, close, WOLF_FAST);
            state.ema8 = ema(state.ema8, close, WOLF_SLOW);
            state.ema25 = ema(state.ema25, close, MA_FAST);
            state.ema100 = ema(state.ema100, close, MA_SLOW);
          }
          var spread = (state.ema3 - state.ema8) * 1.001;
          var result = {
            wolfUp: state.previousWolfSpread <= 0 && spread > 0,
            wolfDown: state.previousWolfSpread >= 0 && spread < 0
          };
          state.previousWolfSpread = spread;
          var date = ukDate(bar[0]);
          if (state.gateDate !== date) {
            state.gateDate = date;
            state.gate = createGateState();
          }
          stepGate(bar, state.gate);
          return result;
        }

        function closeAt(price, reason) {
          var command = { type: 'CLOSE_POSITION', positionId: state.positionId, reason: reason, rawFill: rawFill };
          if (price !== null) command.closePrice = price;
          return command;
        }
      }
    };
  }

  return {
    create: create,
    profileForInstrument: function(instrument) { return Object.assign({}, profileForInstrument(instrument)); },
    settingsForInstrument: settingsForInstrument,
    executionForInstrument: executionForInstrument,
    _test: {
       ukMinute: ukMinute,
       ukDate: ukDate,
      isEntryTime: isEntryTime,
      isOpeningSync: isOpeningSync,
      isGateTime: isGateTime,
       computePositionSize: computePositionSize,
       profileForInstrument: profileForInstrument,
       settingsForInstrument: settingsForInstrument,
       executionForInstrument: executionForInstrument,
       stepGate: stepGate
    }
  };
})();
