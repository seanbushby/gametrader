'use strict';
window.MusicLab = window.MusicLab || {};

MusicLab.Detector = (function() {
  const VERSION = 'musiclab-detector-v1';
  const LONDON = 'Europe/London';
  const DETECTOR_SETTINGS = {
    Conservative: {
      touchTolerance: 0.12,
      sweepDistance: 0.28,
      breakoutDistance: 0.34,
      breakoutConfirmationCandles: 2,
      fakeoutReturnCandles: 3,
      reclaimConfirmationCandles: 2,
      chopMinimumMinutes: 14,
      chopOverlapThreshold: 0.76,
      trendEfficiencyThreshold: 0.66
    },
    Balanced: {
      touchTolerance: 0.10,
      sweepDistance: 0.22,
      breakoutDistance: 0.28,
      breakoutConfirmationCandles: 2,
      fakeoutReturnCandles: 3,
      reclaimConfirmationCandles: 2,
      chopMinimumMinutes: 12,
      chopOverlapThreshold: 0.70,
      trendEfficiencyThreshold: 0.61
    },
    Sensitive: {
      touchTolerance: 0.08,
      sweepDistance: 0.18,
      breakoutDistance: 0.22,
      breakoutConfirmationCandles: 1,
      fakeoutReturnCandles: 2,
      reclaimConfirmationCandles: 2,
      chopMinimumMinutes: 10,
      chopOverlapThreshold: 0.66,
      trendEfficiencyThreshold: 0.56
    }
  };
  const INSTRUMENT_META = {
    DE40: { tickSize: 0.1, precision: 1 },
    USTEC: { tickSize: 1, precision: 1 },
    XAUUSD: { tickSize: 0.01, precision: 2 }
  };

  function num(value) { const n = Number(value); return Number.isFinite(n) ? n : NaN; }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function roundTo(value, precision) { const factor = Math.pow(10, precision || 0); return Math.round(value * factor) / factor; }
  function timeFormatter() { return new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  function dateFormatter() { return new Intl.DateTimeFormat('en-CA', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit' }); }
  function timestampFormatter() { return new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }

  function toParts(formatter, timestampMs) {
    const out = {};
    for (const part of formatter.formatToParts(new Date(timestampMs))) out[part.type] = part.value;
    return out;
  }

  function londonDateKey(timestampSeconds) { return dateFormatter().format(new Date(Number(timestampSeconds) * 1000)); }
  function londonMinuteOfDay(timestampSeconds) {
    const parts = toParts(timeFormatter(), Number(timestampSeconds) * 1000);
    return Number(parts.hour) * 60 + Number(parts.minute);
  }
  function londonIso(timestampSeconds) {
    const ts = Number(timestampSeconds) * 1000;
    const parts = toParts(timestampFormatter(), ts);
    const localAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const offsetMinutes = Math.round((localAsUtc - ts) / 60000);
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMinutes);
    const offset = sign + String(Math.floor(abs / 60)).padStart(2, '0') + ':' + String(abs % 60).padStart(2, '0');
    return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second + offset;
  }

  function previousAvailableTradingDay(availableDates, selectedDate) {
    const list = Array.isArray(availableDates) ? availableDates.filter(Boolean).slice().sort() : [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i] < selectedDate) return list[i];
    return null;
  }

  function normalizeBars(rawBars) {
    const warnings = [];
    const rows = Array.isArray(rawBars) ? rawBars.slice() : [];
    const invalid = [];
    const filtered = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const t = num(row[0]), o = num(row[1]), h = num(row[2]), l = num(row[3]), c = num(row[4]), v = num(row[5] || 0);
      if (![t, o, h, l, c].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l || h < o && h < c || l > o && l > c) {
        invalid.push(row);
        continue;
      }
      filtered.push({ timestamp: t, open: o, high: h, low: l, close: c, volume: Number.isFinite(v) ? v : 0 });
    }
    filtered.sort((a, b) => a.timestamp - b.timestamp);
    const deduped = [];
    let duplicates = 0;
    let outOfOrder = false;
    for (const bar of filtered) {
      if (deduped.length && bar.timestamp < deduped[deduped.length - 1].timestamp) outOfOrder = true;
      if (deduped.length && deduped[deduped.length - 1].timestamp === bar.timestamp) {
        deduped[deduped.length - 1] = bar;
        duplicates++;
      } else {
        deduped.push(bar);
      }
    }
    if (invalid.length) warnings.push('Invalid OHLC rows were ignored: ' + invalid.length + '.');
    if (duplicates) warnings.push('Duplicate candle timestamps were deduplicated: ' + duplicates + '.');
    if (outOfOrder) warnings.push('Input candles were not ordered and were re-sorted.');
    return { bars: deduped, warnings, duplicates, invalidCount: invalid.length, outOfOrder };
  }

  function parseTimeToMinutes(value) {
    const parts = String(value || '').split(':').map(Number);
    return Number.isFinite(parts[0]) && Number.isFinite(parts[1]) ? parts[0] * 60 + parts[1] : NaN;
  }

  function instrumentMeta(instrument) {
    return INSTRUMENT_META[String(instrument || '').toUpperCase()] || { tickSize: 0.1, precision: 1 };
  }

  function stats(numbers) {
    const values = (Array.isArray(numbers) ? numbers : []).map(num).filter(Number.isFinite).sort((a, b) => a - b);
    if (!values.length) return { median: NaN, mean: NaN, min: NaN, max: NaN };
    const median = values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { median, mean, min: values[0], max: values[values.length - 1] };
  }

  function rangeOfBars(bars) {
    let high = -Infinity, low = Infinity;
    for (const bar of bars) { high = Math.max(high, bar.high); low = Math.min(low, bar.low); }
    return { high: high === -Infinity ? NaN : high, low: low === Infinity ? NaN : low };
  }

  function computeATR(bars, length) {
    const trs = [];
    for (let i = 1; i < bars.length; i++) {
      const bar = bars[i];
      const prev = bars[i - 1];
      const tr = Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(bar.low - prev.close));
      trs.push(tr);
    }
    return stats(trs.slice(-Math.max(1, length || 14))).mean;
  }

  function buildToleranceConfig({ instrument, sensitivity, medianRange, atr, tickSize }) {
    const base = DETECTOR_SETTINGS[sensitivity] || DETECTOR_SETTINGS.Balanced;
    const priceBase = Math.max(tickSize * 2, medianRange * 0.1, atr * 0.06);
    return {
      touchTolerance: roundTo(Math.max(tickSize, priceBase * base.touchTolerance / 0.1), 4),
      sweepDistance: roundTo(Math.max(tickSize * 2, priceBase * base.sweepDistance / 0.1), 4),
      breakoutDistance: roundTo(Math.max(tickSize * 3, priceBase * base.breakoutDistance / 0.1), 4),
      breakoutConfirmationCandles: base.breakoutConfirmationCandles,
      fakeoutReturnCandles: base.fakeoutReturnCandles,
      reclaimConfirmationCandles: base.reclaimConfirmationCandles,
      chopMinimumMinutes: base.chopMinimumMinutes,
      chopOverlapThreshold: base.chopOverlapThreshold,
      trendEfficiencyThreshold: base.trendEfficiencyThreshold,
      instrument: instrument,
      sensitivity: sensitivity
    };
  }

  function classifyVolatility(ratio) {
    if (!Number.isFinite(ratio)) return 'Unknown';
    if (ratio < 0.5) return 'Low';
    if (ratio < 1.1) return 'Medium';
    return 'High';
  }

  function directionLabel(dir) { return dir > 0 ? 'bullish' : dir < 0 ? 'bearish' : 'neutral'; }

  function eventBase(type) {
    if (/sweep|fakeout|rejection/.test(type)) return 0.9;
    if (/breakout|reclaim/.test(type)) return 0.86;
    if (/continuation|reversal/.test(type)) return 0.84;
    if (/trend/.test(type)) return 0.8;
    if (/chop|range/.test(type)) return 0.74;
    return 0.72;
  }

  function importanceFor(event, levels, metrics) {
    const levelBonus = event.levelName ? 0.08 : 0.05;
    const duration = event.endTimestamp ? Math.max(0.02, Math.min(0.12, (event.endTimestampSeconds - event.timestampSeconds) / 9000)) : 0;
    const structural = /fakeout|reversal|trend|continuation|breakout/.test(event.type) ? 0.15 : 0.05;
    const volatility = metrics.volatilityScore ? Math.min(0.08, metrics.volatilityScore / 8) : 0;
    return clamp(event.confidence * 0.55 + levelBonus + duration + structural + volatility, 0, 1);
  }

  function eventBaseName(levelName) {
    const normalized = String(levelName || '').toLowerCase();
    if (normalized === 'asia high') return 'asia_high';
    if (normalized === 'asia low') return 'asia_low';
    if (normalized === 'session open') return 'session_open';
    if (normalized === 'previous-day high') return 'previous_day_high';
    if (normalized === 'previous-day low') return 'previous_day_low';
    if (normalized === 'vwap') return 'vwap';
    if (normalized === 'morning range') return 'range';
    if (normalized === 'morning continuation') return 'continuation';
    if (normalized === 'morning reversal') return 'reversal';
    return normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function levelSide(levelName) {
    const normalized = String(levelName || '').toLowerCase();
    if (normalized === 'asia high' || normalized === 'previous-day high') return 'high';
    if (normalized === 'asia low' || normalized === 'previous-day low') return 'low';
    if (normalized === 'session open' || normalized === 'vwap') return 'both';
    return 'both';
  }

  function buildLevelStateTrace(status, nextStatus, bar, reason) {
    return {
      from: status,
      to: nextStatus,
      timestamp: londonIso(bar.timestamp),
      reason: reason
    };
  }

  function makeEvent(seed) {
    return {
      id: 'event-' + String(seed.index).padStart(3, '0'),
      type: seed.type,
      timestamp: londonIso(seed.timestamp),
      timestampSeconds: seed.timestamp,
      endTimestamp: seed.endTimestamp == null ? null : londonIso(seed.endTimestamp),
      endTimestampSeconds: seed.endTimestamp == null ? null : seed.endTimestamp,
      direction: seed.direction,
      price: roundTo(seed.price, seed.precision),
      levelName: seed.levelName || null,
      levelPrice: seed.levelPrice == null ? null : roundTo(seed.levelPrice, seed.precision),
      confidence: roundTo(clamp(seed.confidence, 0, 0.99), 2),
      importance: 0,
      description: seed.description,
      evidence: seed.evidence
    };
  }

  function addEvent(list, seed, levels, metrics) {
    const event = makeEvent(seed);
    event.importance = roundTo(importanceFor(event, levels, metrics), 2);
    list.push(event);
    return event;
  }

  function candleSide(bar, level, tolerance) {
    if (bar.close > level + tolerance) return 1;
    if (bar.close < level - tolerance) return -1;
    return 0;
  }

  function findRangeCrossCount(bars, level) {
    let crosses = 0;
    let prev = null;
    for (const bar of bars) {
      const side = candleSide(bar, level, 0);
      if (prev != null && side !== 0 && prev !== 0 && side !== prev) crosses++;
      if (side !== 0) prev = side;
    }
    return crosses;
  }

  function detectLevelEvents(bars, levelName, levelPrice, opts) {
    const out = [];
    if (!Number.isFinite(levelPrice)) return out;
    const tolerance = opts.touchTolerance;
    const sweep = opts.sweepDistance;
    const breakout = opts.breakoutDistance;
    const confirm = opts.breakoutConfirmationCandles;
    const fakeoutWindow = opts.fakeoutReturnCandles;
    const reclaimConfirm = opts.reclaimConfirmationCandles;
    const baseName = eventBaseName(levelName);
    const side = levelSide(levelName);
    const allowBreakouts = baseName !== 'session_open';
    const canAbove = side === 'both' || side === 'high';
    const canBelow = side === 'both' || side === 'low';
    const testType = baseName + '_test';
    const rejectionType = baseName + '_rejection';
    const sweepType = baseName + '_sweep';
    const breakoutType = baseName + '_breakout';
    const reclaimType = baseName + '_reclaim';

    let seenTouch = false;
    let breakoutState = null;
    let lastSide = 0;
    let levelState = 'untested';
    let acceptedSide = 0;
    const stateTrace = [];

    function setLevelState(nextState, bar, reason) {
      if (levelState === nextState) return;
      stateTrace.push(buildLevelStateTrace(levelState, nextState, bar, reason));
      levelState = nextState;
    }

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const touched = bar.high >= levelPrice - tolerance && bar.low <= levelPrice + tolerance;
      const aboveClose = bar.close > levelPrice + breakout;
      const belowClose = bar.close < levelPrice - breakout;
      const aboveSweep = bar.high > levelPrice + sweep;
      const belowSweep = bar.low < levelPrice - sweep;
      const closeSide = bar.close > levelPrice + tolerance ? 1 : bar.close < levelPrice - tolerance ? -1 : 0;

      if (touched && !seenTouch) {
        setLevelState('tested', bar, 'first touch of level');
        const noAcceptance = !aboveClose && !belowClose;
        if (noAcceptance) {
          const rejection = baseName === 'session_open' || baseName === 'vwap';
          addEvent(out, {
            index: out.length + 1,
            type: testType,
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: candleSide(bar, levelPrice, tolerance) >= 0 ? 'bullish' : 'bearish',
            price: bar.high >= levelPrice ? bar.high : bar.low,
            levelName,
            levelPrice,
            confidence: 0.72,
            description: 'Price tested ' + levelName + ' without establishing acceptance.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance, confirmationCandles: 1 },
            precision: opts.precision
          }, opts.levels, opts.metrics);
          if (rejection && (Math.abs(bar.close - levelPrice) > breakout)) {
            addEvent(out, {
              index: out.length + 1,
              type: rejectionType,
              timestamp: bar.timestamp,
              endTimestamp: null,
              direction: bar.close > levelPrice ? 'bullish' : 'bearish',
              price: bar.close,
              levelName,
              levelPrice,
              confidence: 0.76,
              description: 'Price tested ' + levelName + ' and rejected away from it.',
              evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance, confirmationCandles: 1 },
              precision: opts.precision
            }, opts.levels, opts.metrics);
            setLevelState('rejected', bar, 'rejected away from ' + levelName);
          }
          seenTouch = true;
        }
      }

      if (touched && seenTouch && levelState === 'accepted') {
        if ((acceptedSide === 1 && closeSide >= 0) || (acceptedSide === -1 && closeSide <= 0)) {
          addEvent(out, {
            index: out.length + 1,
            type: testType,
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: acceptedSide === 1 ? 'bullish' : 'bearish',
            price: bar.close,
            levelName,
            levelPrice,
            confidence: 0.74,
            description: 'Price tested ' + levelName + ' after acceptance.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance, confirmationCandles: 1 },
            precision: opts.precision
          }, opts.levels, opts.metrics);
        }
      }

      if ((baseName === 'session_open' || baseName === 'vwap') && lastSide !== 0 && closeSide !== 0 && closeSide !== lastSide) {
        const confirmBars = bars.slice(i, i + reclaimConfirm).filter((next) => (closeSide > 0 ? next.close > levelPrice + tolerance : next.close < levelPrice - tolerance));
        if (confirmBars.length >= reclaimConfirm) {
          addEvent(out, {
            index: out.length + 1,
            type: reclaimType,
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: closeSide > 0 ? 'bullish' : 'bearish',
            price: bar.close,
            levelName,
            levelPrice,
            confidence: 0.8,
            description: 'Price reclaimed ' + levelName + ' and accepted on the opposite side.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance, confirmationCandles: reclaimConfirm },
            precision: opts.precision
          }, opts.levels, opts.metrics);
          setLevelState('reclaimed', bar, 'reclaimed ' + levelName + ' on the opposite side');
          acceptedSide = 0;
        }
      }
      if (closeSide !== 0) lastSide = closeSide;

      if (canAbove && aboveSweep && bar.close <= levelPrice && !(levelState === 'accepted' && acceptedSide === 1)) {
        const returnWindow = bars.slice(i + 1, i + 1 + fakeoutWindow);
        if (returnWindow.some((next) => next.close < levelPrice)) {
          addEvent(out, {
            index: out.length + 1,
            type: sweepType,
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: 'bearish',
            price: bar.high,
            levelName,
            levelPrice,
            confidence: 0.91,
            description: 'Price traded above ' + levelName + ' and closed back below it.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance: sweep, confirmationCandles: fakeoutWindow },
            precision: opts.precision
            }, opts.levels, opts.metrics);
          breakoutState = { breakoutSide: 1, breakoutIndex: i };
        }
      }
      if (canBelow && belowSweep && bar.close >= levelPrice && !(levelState === 'accepted' && acceptedSide === -1)) {
        const returnWindow = bars.slice(i + 1, i + 1 + fakeoutWindow);
        if (returnWindow.some((next) => next.close > levelPrice)) {
          addEvent(out, {
            index: out.length + 1,
            type: sweepType,
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: 'bullish',
            price: bar.low,
            levelName,
            levelPrice,
            confidence: 0.91,
            description: 'Price traded below ' + levelName + ' and closed back above it.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance: sweep, confirmationCandles: fakeoutWindow },
            precision: opts.precision
            }, opts.levels, opts.metrics);
          breakoutState = { breakoutSide: -1, breakoutIndex: i };
        }
      }

      if (allowBreakouts && canAbove && aboveClose) {
        const closes = bars.slice(i, i + confirm).filter((next) => next.close > levelPrice + breakout);
        const later = bars.slice(i + 1, i + 1 + fakeoutWindow);
        const accepted = (closes.length >= confirm || (bar.close - levelPrice) > breakout * 1.5) && !later.some((next) => next.close <= levelPrice);
        if (accepted) {
          setLevelState('broken', bar, 'confirmed closes beyond ' + levelName);
          addEvent(out, {
            index: out.length + 1,
            type: breakoutType,
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: 'bullish',
            price: bar.close,
            levelName,
            levelPrice,
            confidence: 0.88,
            description: 'Price closed above ' + levelName + ' with acceptance.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance: breakout, confirmationCandles: confirm },
            precision: opts.precision
          }, opts.levels, opts.metrics);
          setLevelState('accepted', bar, 'accepted above ' + levelName + ' after confirmed closes');
          acceptedSide = 1;
          if (later.some((next) => next.close < levelPrice)) {
          addEvent(out, {
            index: out.length + 1,
            type: 'bullish_fakeout',
              timestamp: bar.timestamp,
              endTimestamp: null,
              direction: 'bearish',
              price: bar.close,
              levelName,
              levelPrice,
              confidence: 0.84,
              description: 'Breakout above ' + levelName + ' failed within the confirmation window.',
              evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance: breakout, confirmationCandles: fakeoutWindow },
              precision: opts.precision
            }, opts.levels, opts.metrics);
          }
        } else if (later.some((next) => next.close <= levelPrice)) {
          addEvent(out, {
            index: out.length + 1,
            type: 'bullish_fakeout',
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: 'bearish',
            price: bar.close,
            levelName,
            levelPrice,
            confidence: 0.84,
            description: 'Breakout above ' + levelName + ' failed within the confirmation window.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance: breakout, confirmationCandles: fakeoutWindow },
            precision: opts.precision
          }, opts.levels, opts.metrics);
        }
      }
      if (allowBreakouts && canBelow && belowClose) {
        const closes = bars.slice(i, i + confirm).filter((next) => next.close < levelPrice - breakout);
        const later = bars.slice(i + 1, i + 1 + fakeoutWindow);
        const accepted = (closes.length >= confirm || (levelPrice - bar.close) > breakout * 1.5) && !later.some((next) => next.close >= levelPrice);
        if (accepted) {
          setLevelState('broken', bar, 'confirmed closes beyond ' + levelName);
          addEvent(out, {
            index: out.length + 1,
            type: breakoutType,
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: 'bearish',
            price: bar.close,
            levelName,
            levelPrice,
            confidence: 0.88,
            description: 'Price closed below ' + levelName + ' with acceptance.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance: breakout, confirmationCandles: confirm },
            precision: opts.precision
          }, opts.levels, opts.metrics);
          setLevelState('accepted', bar, 'accepted below ' + levelName + ' after confirmed closes');
          acceptedSide = -1;
          if (later.some((next) => next.close > levelPrice)) {
          addEvent(out, {
            index: out.length + 1,
            type: 'bearish_fakeout',
              timestamp: bar.timestamp,
              endTimestamp: null,
              direction: 'bullish',
              price: bar.close,
              levelName,
              levelPrice,
              confidence: 0.84,
              description: 'Breakout below ' + levelName + ' failed within the confirmation window.',
              evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance: breakout, confirmationCandles: fakeoutWindow },
              precision: opts.precision
            }, opts.levels, opts.metrics);
          }
        } else if (later.some((next) => next.close >= levelPrice)) {
          addEvent(out, {
            index: out.length + 1,
            type: 'bearish_fakeout',
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: 'bullish',
            price: bar.close,
            levelName,
            levelPrice,
            confidence: 0.84,
            description: 'Breakout below ' + levelName + ' failed within the confirmation window.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance: breakout, confirmationCandles: fakeoutWindow },
            precision: opts.precision
          }, opts.levels, opts.metrics);
        }
      }

      if (breakoutState && breakoutState.breakoutSide === 1 && i > breakoutState.breakoutIndex && canAbove && acceptedSide !== 1) {
        const confirmBack = bars.slice(i, i + reclaimConfirm).filter((next) => next.close < levelPrice - tolerance);
        if (confirmBack.length >= reclaimConfirm) {
          addEvent(out, {
            index: out.length + 1,
            type: reclaimType,
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: 'bearish',
            price: bar.close,
            levelName,
            levelPrice,
            confidence: 0.8,
            description: levelName + ' was reclaimed from above and accepted back below.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance, confirmationCandles: reclaimConfirm },
            precision: opts.precision
            }, opts.levels, opts.metrics);
          setLevelState('reclaimed', bar, 'reclaimed back below ' + levelName);
        }
      }
      if (breakoutState && breakoutState.breakoutSide === -1 && i > breakoutState.breakoutIndex && canBelow && acceptedSide !== -1) {
        const confirmBack = bars.slice(i, i + reclaimConfirm).filter((next) => next.close > levelPrice + tolerance);
        if (confirmBack.length >= reclaimConfirm) {
          addEvent(out, {
            index: out.length + 1,
            type: reclaimType,
            timestamp: bar.timestamp,
            endTimestamp: null,
            direction: 'bullish',
            price: bar.close,
            levelName,
            levelPrice,
            confidence: 0.8,
            description: levelName + ' was reclaimed from below and accepted back above.',
            evidence: { candleTimestamp: londonIso(bar.timestamp), open: bar.open, high: bar.high, low: bar.low, close: bar.close, tolerance, confirmationCandles: reclaimConfirm },
            precision: opts.precision
            }, opts.levels, opts.metrics);
          setLevelState('reclaimed', bar, 'reclaimed back above ' + levelName);
        }
      }
    }
    out.levelStateTrace = stateTrace;
    out.levelStatus = levelState;
    out.acceptedSide = acceptedSide;
    return out;
  }

  function detectSessionStructure(bars, levels, opts) {
    const out = [];
    if (!bars.length) return out;
    const first = bars[0];
    const last = bars[bars.length - 1];
    const net = last.close - first.open;
    const totalTravel = bars.reduce((sum, bar, index) => sum + (index ? Math.abs(bar.close - bars[index - 1].close) : 0), 0) || 1;
    const efficiency = Math.abs(net) / totalTravel;
    const direction = net > 0 ? 'bullish' : net < 0 ? 'bearish' : 'neutral';
    const crossesOpen = levels.sessionOpen ? findRangeCrossCount(bars, levels.sessionOpen) : 0;
    const crossesVwap = Number.isFinite(levels.vwap) ? findRangeCrossCount(bars, levels.vwap) : 0;
    const overlap = bars.slice(1).reduce((sum, bar, index) => {
      const prev = bars[index];
      const top = Math.min(prev.high, bar.high);
      const bottom = Math.max(prev.low, bar.low);
      const inner = Math.max(0, top - bottom);
      const span = Math.max(prev.high - prev.low, bar.high - bar.low, 0.0001);
      return sum + inner / span;
    }, 0) / Math.max(1, bars.length - 1);
    const changes = bars.slice(1).reduce((sum, bar, index) => sum + (Math.sign(bar.close - bars[index].close) !== Math.sign(index ? bars[index].close - bars[index - 1].close : 0) ? 1 : 0), 0);
    const chopScore = (changes / Math.max(1, bars.length - 1)) * 0.35 + overlap * 0.35 + Math.min(0.3, (crossesOpen + crossesVwap) * 0.08);

    if (bars.length >= opts.chopMinimumMinutes && chopScore >= opts.chopOverlapThreshold && efficiency < 0.32) {
      addEvent(out, {
        index: out.length + 1,
        type: 'chop',
        timestamp: bars[0].timestamp,
        endTimestamp: bars[bars.length - 1].timestamp,
        direction: 'neutral',
        price: last.close,
        levelName: crossesVwap > crossesOpen ? 'VWAP' : '08:00 Open',
        levelPrice: Number.isFinite(levels.vwap) && crossesVwap > crossesOpen ? levels.vwap : levels.sessionOpen,
        confidence: 0.84,
        description: 'Price chopped with repeated overlap and repeated level crossings.',
        evidence: { candleTimestamp: londonIso(bars[0].timestamp), open: first.open, high: rangeOfBars(bars).high, low: rangeOfBars(bars).low, close: last.close, tolerance: opts.touchTolerance, confirmationCandles: bars.length },
        precision: opts.precision
      }, opts.levels, opts.metrics);
    } else if (bars.length >= opts.chopMinimumMinutes && efficiency < 0.45 && overlap > 0.58) {
      addEvent(out, {
        index: out.length + 1,
        type: 'range',
        timestamp: bars[0].timestamp,
        endTimestamp: bars[bars.length - 1].timestamp,
        direction: 'neutral',
        price: last.close,
        levelName: 'Morning Range',
        levelPrice: null,
        confidence: 0.78,
        description: 'Price stayed inside a broad morning range without efficient displacement.',
        evidence: { candleTimestamp: londonIso(bars[0].timestamp), open: first.open, high: rangeOfBars(bars).high, low: rangeOfBars(bars).low, close: last.close, tolerance: opts.touchTolerance, confirmationCandles: bars.length },
        precision: opts.precision
      }, opts.levels, opts.metrics);
    }

    if (efficiency >= opts.trendEfficiencyThreshold) {
      const dir = direction === 'bullish' ? 'bullish' : 'bearish';
      const type = dir === 'bullish' ? 'bullish_trend' : 'bearish_trend';
      addEvent(out, {
        index: out.length + 1,
        type: type,
        timestamp: bars[0].timestamp,
        endTimestamp: bars[bars.length - 1].timestamp,
        direction: dir,
        price: last.close,
        levelName: 'Morning Structure',
        levelPrice: null,
        confidence: 0.86,
        description: 'Price held a ' + dir + ' structure with efficient displacement.',
        evidence: { candleTimestamp: londonIso(bars[0].timestamp), open: first.open, high: rangeOfBars(bars).high, low: rangeOfBars(bars).low, close: last.close, tolerance: opts.touchTolerance, confirmationCandles: bars.length },
        precision: opts.precision
      }, opts.levels, opts.metrics);
    }

    const firstLeg = bars.slice(0, Math.max(5, Math.min(15, Math.floor(bars.length / 3))));
    const midLeg = bars.slice(Math.floor(bars.length / 3), Math.floor(bars.length * 2 / 3));
    const lastLeg = bars.slice(Math.floor(bars.length * 2 / 3));
    if (firstLeg.length && lastLeg.length) {
      const firstMove = firstLeg[firstLeg.length - 1].close - firstLeg[0].open;
      const lastMove = lastLeg[lastLeg.length - 1].close - lastLeg[0].open;
      if (firstMove > opts.breakoutDistance * 2 && lastMove > opts.breakoutDistance * 1.5) {
        addEvent(out, {
          index: out.length + 1,
          type: 'bullish_continuation',
          timestamp: midLeg.length ? midLeg[0].timestamp : bars[0].timestamp,
          endTimestamp: bars[bars.length - 1].timestamp,
          direction: 'bullish',
          price: last.close,
          levelName: 'Morning Continuation',
          levelPrice: null,
          confidence: 0.83,
          description: 'Initial upside strength continued into the later morning.',
          evidence: { candleTimestamp: londonIso(bars[0].timestamp), open: first.open, high: rangeOfBars(bars).high, low: rangeOfBars(bars).low, close: last.close, tolerance: opts.breakoutDistance, confirmationCandles: 2 },
          precision: opts.precision
        }, opts.levels, opts.metrics);
      }
      if (firstMove < -opts.breakoutDistance * 2 && lastMove < -opts.breakoutDistance * 1.5) {
        addEvent(out, {
          index: out.length + 1,
          type: 'bearish_continuation',
          timestamp: midLeg.length ? midLeg[0].timestamp : bars[0].timestamp,
          endTimestamp: bars[bars.length - 1].timestamp,
          direction: 'bearish',
          price: last.close,
          levelName: 'Morning Continuation',
          levelPrice: null,
          confidence: 0.83,
          description: 'Initial downside strength continued into the later morning.',
          evidence: { candleTimestamp: londonIso(bars[0].timestamp), open: first.open, high: rangeOfBars(bars).high, low: rangeOfBars(bars).low, close: last.close, tolerance: opts.breakoutDistance, confirmationCandles: 2 },
          precision: opts.precision
        }, opts.levels, opts.metrics);
      }
    }

    if (bars.length >= 8) {
      const firstHalf = bars.slice(0, Math.floor(bars.length / 2));
      const secondHalf = bars.slice(Math.floor(bars.length / 2));
      const firstMove = firstHalf[firstHalf.length - 1].close - firstHalf[0].open;
      const secondMove = secondHalf[secondHalf.length - 1].close - secondHalf[0].open;
      if (firstMove > opts.breakoutDistance * 2 && secondMove < -opts.breakoutDistance * 2) {
        addEvent(out, {
          index: out.length + 1,
          type: 'bearish_reversal',
          timestamp: secondHalf[0].timestamp,
          endTimestamp: bars[bars.length - 1].timestamp,
          direction: 'bearish',
          price: last.close,
          levelName: 'Morning Reversal',
          levelPrice: null,
          confidence: 0.86,
          description: 'An early bullish move failed and reversed lower.',
          evidence: { candleTimestamp: londonIso(secondHalf[0].timestamp), open: secondHalf[0].open, high: rangeOfBars(bars).high, low: rangeOfBars(bars).low, close: last.close, tolerance: opts.breakoutDistance, confirmationCandles: 2 },
          precision: opts.precision
        }, opts.levels, opts.metrics);
      } else if (firstMove < -opts.breakoutDistance * 2 && secondMove > opts.breakoutDistance * 2) {
        addEvent(out, {
          index: out.length + 1,
          type: 'bullish_reversal',
          timestamp: secondHalf[0].timestamp,
          endTimestamp: bars[bars.length - 1].timestamp,
          direction: 'bullish',
          price: last.close,
          levelName: 'Morning Reversal',
          levelPrice: null,
          confidence: 0.86,
          description: 'An early bearish move failed and reversed higher.',
          evidence: { candleTimestamp: londonIso(secondHalf[0].timestamp), open: secondHalf[0].open, high: rangeOfBars(bars).high, low: rangeOfBars(bars).low, close: last.close, tolerance: opts.breakoutDistance, confirmationCandles: 2 },
          precision: opts.precision
        }, opts.levels, opts.metrics);
      }
    }
    return out;
  }

  function deriveClassification(events, metrics) {
    const order = events.slice().sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    const lastDirectional = order.filter((e) => /bullish_|bearish_/.test(e.type)).slice(-1)[0];
    const acceptedBreakout = order.filter((e) => /_breakout$/.test(e.type)).slice(-1)[0];
    const continuation = order.filter((e) => /continuation|trend/.test(e.type)).slice(-1)[0];
    const earlyRejection = order.find((e) => /rejection|sweep/.test(e.type));
    let primary = 'Mixed morning price action';
    if (acceptedBreakout && continuation) primary = 'Accepted breakout above ' + String(acceptedBreakout.levelName || 'the level') + ' with continuation';
    else if (acceptedBreakout) primary = 'Accepted breakout above ' + String(acceptedBreakout.levelName || 'the level');
    else if (continuation) primary = continuation.description;
    else if (earlyRejection) primary = earlyRejection.description;
    const secondary = order.some((e) => /chop|range/.test(e.type)) ? 'Early chop around the centre' : (order.some((e) => /vwap/.test(e.type)) ? 'VWAP interactions' : 'Limited early rotation');
    const finalDirection = continuation ? (continuation.direction === 'bullish' ? 'Bullish' : continuation.direction === 'bearish' ? 'Bearish' : 'Neutral') : (acceptedBreakout ? (acceptedBreakout.direction === 'bullish' ? 'Bullish' : acceptedBreakout.direction === 'bearish' ? 'Bearish' : 'Neutral') : (lastDirectional ? (lastDirectional.direction === 'bullish' ? 'Bullish' : lastDirectional.direction === 'bearish' ? 'Bearish' : 'Neutral') : (metrics.netDisplacement > 0 ? 'Bullish' : metrics.netDisplacement < 0 ? 'Bearish' : 'Neutral')));
    const volatility = classifyVolatility(metrics.volatilityRatio);
    const directionalEfficiency = metrics.efficiency >= 0.7 ? 'High' : metrics.efficiency >= 0.45 ? 'Moderate' : 'Low';
    const averageConfidence = events.reduce((sum, e) => sum + e.confidence, 0) / Math.max(1, events.length);
    const sessionConflict = !!acceptedBreakout && !!earlyRejection && acceptedBreakout.timestampSeconds > earlyRejection.timestampSeconds;
    const confidence = clamp(averageConfidence * 0.75 + metrics.completeness * 0.25 - (sessionConflict ? 0.08 : 0), 0, 0.99);
    return { primaryCondition: primary, secondaryCondition: secondary, finalDirection, volatility, directionalEfficiency, confidence: roundTo(confidence, 2) };
  }

  function mergeSongEvents(events, maxEvents) {
    const sorted = events.slice().sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    const merged = [];
    for (const event of sorted) {
      const previous = merged[merged.length - 1];
      const previousEnd = previous ? (previous.endTimestampSeconds == null ? previous.timestampSeconds : previous.endTimestampSeconds) : null;
      if (previous && previous.levelName && event.levelName && previous.levelName === event.levelName && previous.type === event.type && previousEnd != null && event.timestampSeconds - previousEnd <= 4 * 60) {
        previous.endTimestamp = event.endTimestamp || event.timestamp;
        previous.endTimestampSeconds = event.endTimestampSeconds || event.timestampSeconds;
        previous.description = previous.description;
        previous.evidence.confirmationCandles = Math.max(previous.evidence.confirmationCandles || 1, event.evidence.confirmationCandles || 1);
        previous.sourceEventIds = (previous.sourceEventIds || [previous.id]).concat(event.id);
        previous.importance = roundTo(Math.max(previous.importance, event.importance), 2);
        continue;
      }
      merged.push(Object.assign({}, event, { sourceEventIds: [event.id] }));
    }
    const priorities = [
      /^asia_.*_sweep$/,
      /fakeout$/,
      /reversal$/,
      /breakout$/,
      /^session_open_/,
      /^vwap_/,
      /^chop$|^range$/,
      /trend$/,
      /continuation$/
    ];
    const scored = merged.map((event) => {
      let rank = priorities.length;
      priorities.forEach((pattern, index) => { if (pattern.test(event.type)) rank = Math.min(rank, index); });
      return Object.assign({ rank: rank }, event);
    });
    scored.sort((a, b) => a.rank - b.rank || b.importance - a.importance || a.timestampSeconds - b.timestampSeconds);
    const selected = scored.slice(0, Math.max(3, Math.min(Number(maxEvents) || 8, 10))).sort((a, b) => a.timestampSeconds - b.timestampSeconds || a.rank - b.rank);
    const collapsed = [];
    selected.forEach((event) => {
      const previous = collapsed[collapsed.length - 1];
      const previousEnd = previous ? (previous.endTimestampSeconds == null ? previous.timestampSeconds : previous.endTimestampSeconds) : null;
      if (previous && previous.levelName && event.levelName && previous.levelName === event.levelName && previous.type === event.type && previousEnd != null && event.timestampSeconds - previousEnd <= 4 * 60) {
        previous.endTimestamp = event.endTimestamp || event.timestamp;
        previous.endTimestampSeconds = event.endTimestampSeconds || event.timestampSeconds;
        previous.importance = roundTo(Math.max(previous.importance, event.importance), 2);
        previous.sourceEventIds = (previous.sourceEventIds || [previous.id]).concat(event.id);
      } else {
        collapsed.push(Object.assign({}, event));
      }
    });
    return collapsed.map((event, index) => Object.assign({}, event, { id: 'event-' + String(index + 1).padStart(3, '0') }));
  }

  function analyzeSession(input) {
    const normalized = normalizeBars(input.bars || []);
    const bars = normalized.bars;
    const timezone = input.timezone || LONDON;
    const selectedDate = input.date;
    const startMinute = parseTimeToMinutes(input.startTime || '08:00');
    const endMinute = parseTimeToMinutes(input.endTime || '11:00');
    const analysisBars = bars.filter((bar) => londonDateKey(bar.timestamp) === selectedDate && londonMinuteOfDay(bar.timestamp) >= startMinute && londonMinuteOfDay(bar.timestamp) <= endMinute);
    const prevDate = previousAvailableTradingDay(input.availableDates || [], selectedDate);
    const prevBars = prevDate ? bars.filter((bar) => londonDateKey(bar.timestamp) === prevDate) : [];
    const asiaBars = bars.filter((bar) => londonDateKey(bar.timestamp) === selectedDate && londonMinuteOfDay(bar.timestamp) >= 60 && londonMinuteOfDay(bar.timestamp) < 480);
    const preMorningBars = bars.filter((bar) => londonDateKey(bar.timestamp) === selectedDate && londonMinuteOfDay(bar.timestamp) < startMinute);
    const morningBars = analysisBars.slice();
    const sourceMeta = instrumentMeta(input.instrument);
    const medianRange = stats(morningBars.map((bar) => bar.high - bar.low)).median;
    const atr = computeATR((preMorningBars.concat(morningBars)).slice(-24), 14);
    const vwapBars = morningBars.filter((bar) => bar.volume > 0);
    let vwap = NaN;
    let cumulativePv = 0;
    let cumulativeVolume = 0;
    const vwapSeries = [];
    for (const bar of morningBars) {
      if (bar.volume > 0) {
        const typical = (bar.high + bar.low + bar.close) / 3;
        cumulativePv += typical * bar.volume;
        cumulativeVolume += bar.volume;
        vwap = cumulativePv / cumulativeVolume;
      }
      vwapSeries.push({ timestamp: bar.timestamp, value: Number.isFinite(vwap) ? vwap : NaN });
    }
    const levels = {
      asiaHigh: asiaBars.length ? rangeOfBars(asiaBars).high : NaN,
      asiaLow: asiaBars.length ? rangeOfBars(asiaBars).low : NaN,
      sessionOpen: morningBars.length ? morningBars[0].open : NaN,
      previousDayHigh: prevBars.length ? rangeOfBars(prevBars).high : NaN,
      previousDayLow: prevBars.length ? rangeOfBars(prevBars).low : NaN,
      morningHigh: morningBars.length ? rangeOfBars(morningBars).high : NaN,
      morningLow: morningBars.length ? rangeOfBars(morningBars).low : NaN,
      vwap: Number.isFinite(vwap) ? vwap : NaN
    };
    const volatilityRatio = Number.isFinite(atr) && Number.isFinite(medianRange) && medianRange > 0 ? atr / medianRange : NaN;
    const config = buildToleranceConfig({ instrument: input.instrument, sensitivity: input.sensitivity || 'Balanced', medianRange: medianRange || sourceMeta.tickSize * 4, atr: atr || sourceMeta.tickSize * 6, tickSize: sourceMeta.tickSize });
    const completeness = analysisBars.length / Math.max(1, Math.round((endMinute - startMinute) + 1));
    const warnings = normalized.warnings.slice();
    if (!analysisBars.length) warnings.push('No morning candles were available for the selected date.');
    if (analysisBars.length && completeness < 0.98) warnings.push('Only ' + Math.round(completeness * 100) + '% of the expected morning candles are available.');
    if (completeness < 0.9) warnings.push('MusicLab did not generate a soundtrack because the morning session is too incomplete.');
    if (!asiaBars.length) warnings.push('Asia-session data is incomplete, so Asia High and Asia Low could not be calculated.');
    if (!morningBars.length || !Number.isFinite(levels.sessionOpen)) warnings.push('The 08:00 Open is unavailable.');
    if (!prevBars.length) warnings.push('Previous-day data is unavailable for the selected instrument/date.');
    if (!vwapBars.length) warnings.push('VWAP detection is unavailable because usable volume data is missing.');

    const rawEvents = [];
    const levelStates = {};
    const levelOpts = Object.assign({ precision: sourceMeta.precision, levels: levels, metrics: { completeness, volatilityRatio, volatilityScore: Number.isFinite(volatilityRatio) ? volatilityRatio : 0, netDisplacement: morningBars.length ? morningBars[morningBars.length - 1].close - morningBars[0].open : 0, efficiency: morningBars.length ? Math.abs((morningBars[morningBars.length - 1].close - morningBars[0].open)) / Math.max(1e-6, morningBars.reduce((sum, bar, index) => sum + (index ? Math.abs(bar.close - morningBars[index - 1].close) : 0), 0)) : 0 } }, config);
    if (Number.isFinite(levels.asiaHigh)) { const e = detectLevelEvents(morningBars, 'Asia High', levels.asiaHigh, levelOpts); rawEvents.push.apply(rawEvents, e); levelStates['Asia High'] = { status: e.levelStatus, acceptedSide: e.acceptedSide, transitions: e.levelStateTrace || [] }; }
    if (Number.isFinite(levels.asiaLow)) { const e = detectLevelEvents(morningBars, 'Asia Low', levels.asiaLow, levelOpts); rawEvents.push.apply(rawEvents, e); levelStates['Asia Low'] = { status: e.levelStatus, acceptedSide: e.acceptedSide, transitions: e.levelStateTrace || [] }; }
    if (Number.isFinite(levels.sessionOpen)) { const e = detectLevelEvents(morningBars, 'Session Open', levels.sessionOpen, levelOpts); rawEvents.push.apply(rawEvents, e); levelStates['Session Open'] = { status: e.levelStatus, acceptedSide: e.acceptedSide, transitions: e.levelStateTrace || [] }; }
    if (Number.isFinite(levels.previousDayHigh)) { const e = detectLevelEvents(morningBars, 'Previous-Day High', levels.previousDayHigh, levelOpts); rawEvents.push.apply(rawEvents, e); levelStates['Previous-Day High'] = { status: e.levelStatus, acceptedSide: e.acceptedSide, transitions: e.levelStateTrace || [] }; }
    if (Number.isFinite(levels.previousDayLow)) { const e = detectLevelEvents(morningBars, 'Previous-Day Low', levels.previousDayLow, levelOpts); rawEvents.push.apply(rawEvents, e); levelStates['Previous-Day Low'] = { status: e.levelStatus, acceptedSide: e.acceptedSide, transitions: e.levelStateTrace || [] }; }
    if (Number.isFinite(levels.vwap)) { const e = detectLevelEvents(morningBars, 'VWAP', levels.vwap, levelOpts); rawEvents.push.apply(rawEvents, e); levelStates['VWAP'] = { status: e.levelStatus, acceptedSide: e.acceptedSide, transitions: e.levelStateTrace || [] }; }
    rawEvents.push.apply(rawEvents, detectSessionStructure(morningBars, { sessionOpen: levels.sessionOpen, vwap: levels.vwap, majorNames: ['Asia High', 'Asia Low', 'Session Open', 'Previous-Day High', 'Previous-Day Low', 'VWAP'] }, Object.assign({}, config, { precision: sourceMeta.precision, levels: levels, metrics: levelOpts.metrics })));
    rawEvents.sort((a, b) => a.timestampSeconds - b.timestampSeconds || a.importance - b.importance);

    const songEvents = mergeSongEvents(rawEvents, input.maximumEvents || 8);
    const classification = deriveClassification(songEvents, { completeness, volatilityRatio, efficiency: levelOpts.metrics.efficiency, netDisplacement: levelOpts.metrics.netDisplacement });
    const summary = MusicLab.Lyrics.buildSummary({ events: songEvents, levels: levels, classification: classification, timezone: timezone, date: selectedDate, startTime: input.startTime, endTime: input.endTime, precision: sourceMeta.precision });
    const fingerprint = MusicLab.Fingerprint ? MusicLab.Fingerprint.compileFingerprint({
      events: songEvents,
      classification: classification,
      levels: levels,
      duration: input.duration || '4:30',
      hintStrength: input.hintStrength || 'Subtle',
      musicStyle: input.musicStyle || 'Dreamy Deep House',
      vocalStyle: input.vocalStyle || 'Female whisper',
      wordingSeed: input.wordingSeed || '0',
      includeGeneralWhispers: input.includeGeneralWhispers !== false,
      timeRange: { startTime: input.startTime || '08:00', endTime: input.endTime || '11:00' }
    }) : null;
    const song = MusicLab.Lyrics.generatePackage({ instrument: input.instrument, date: selectedDate, events: songEvents, levels: levels, classification: classification, sensitivity: input.sensitivity || 'Balanced', hintStrength: input.hintStrength || 'Subtle', musicStyle: input.musicStyle || 'Dreamy Deep House', customMusicStyle: input.customMusicStyle || null, vocalStyle: input.vocalStyle || 'Female whisper', duration: input.duration || '4:30', maximumEvents: input.maximumEvents || 8, wordingSeed: input.wordingSeed || '0', includeGeneralWhispers: input.includeGeneralWhispers !== false, fingerprint: fingerprint, sectionPlan: fingerprint ? fingerprint.sectionPlan : null });
    return {
      success: warnings.length < 1 || completeness >= 0.9,
      detectorVersion: VERSION,
      instrument: input.instrument,
      date: selectedDate,
      timezone,
      source: input.source || 'Game Trader candle API',
      dataQuality: {
        expectedCandles: Math.round((endMinute - startMinute) + 1),
        loadedCandles: analysisBars.length,
        completeness: roundTo(completeness, 3),
        warnings
      },
      levels,
      detectorConfiguration: config,
      metrics: { medianRange: medianRange, atr: atr, volatilityRatio: volatilityRatio, tickSize: sourceMeta.tickSize, precision: sourceMeta.precision },
      rawEvents,
      songEvents,
      classification,
      morningSummary: summary,
      titleSuggestions: song.titleSuggestions,
      sunoStylePrompt: song.stylePrompt,
      sunoLyrics: song.lyrics,
      lyricEntries: song.lyricEntries,
      fingerprint: fingerprint,
      sectionPlan: fingerprint ? fingerprint.sectionPlan : null,
      sessionInfusion: fingerprint ? fingerprint.infusion : null,
      levelStates,
      generationSeed: song.generationSeed,
      wordingSeed: song.wordingSeed,
      vwapSeries: vwapSeries,
      analysisBars: analysisBars,
      morningBars: morningBars,
      chartBars: morningBars,
      rawBars: bars,
      timeRange: { startTime: input.startTime || '08:00', endTime: input.endTime || '11:00' },
      previousAvailableTradingDay: prevDate,
      warnings
    };
  }

  return {
    VERSION,
    DETECTOR_SETTINGS,
    londonDateKey,
    londonMinuteOfDay,
    londonIso,
    previousAvailableTradingDay,
    normalizeBars,
    buildToleranceConfig,
    analyzeSession,
    classifyVolatility
  };
})();
