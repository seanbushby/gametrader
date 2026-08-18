'use strict';
window.BotLab = window.BotLab || {};

BotLab.MarketData = (function() {
  const cache = new Map();
  const apiSymbols = { de40: 'DE40', xauusd: 'XAUUSD', ustec: 'USTEC' };
  const londonDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const londonTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const dayLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', weekday: 'short'
  });
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', day: '2-digit', month: 'short', year: 'numeric'
  });
  const CHART_HISTORY_BARS = 10080;

  function parts(formatter, date) {
    const out = {};
    for (const part of formatter.formatToParts(date)) out[part.type] = part.value;
    return out;
  }

  function dateKey(timestamp) {
    const p = parts(londonDate, new Date(timestamp * 1000));
    return p.year + '-' + p.month + '-' + p.day;
  }

  function minuteOfDay(timestamp) {
    const p = parts(londonTime, new Date(timestamp * 1000));
    return Number(p.hour) * 60 + Number(p.minute);
  }

  function fallbackParse(text) {
    const lines = text.trim().split(/\r?\n/);
    if (!lines.length) return [];
    const headers = lines[0].toLowerCase().split(',').map(function(value) {
      return value.trim().replace(/"/g, '');
    });
    const index = function(name) {
      return headers.findIndex(function(header) { return header === name || header.startsWith(name); });
    };
    const ti = index('time'), oi = index('open'), hi = index('high');
    const li = index('low'), ci = index('close'), vi = index('volume');
    if (ti < 0 || oi < 0 || hi < 0 || li < 0 || ci < 0) {
      throw new Error('missing time/open/high/low/close columns');
    }
    const bars = [];
    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split(',');
      let timestamp = columns[ti] ? columns[ti].replace(/"/g, '') : '';
      timestamp = /^\d+$/.test(timestamp) ? Number(timestamp) : Math.floor(Date.parse(timestamp) / 1000);
      if (timestamp > 1e12) timestamp = Math.floor(timestamp / 1000);
      const bar = [timestamp, Number(columns[oi]), Number(columns[hi]), Number(columns[li]), Number(columns[ci]), vi >= 0 ? Number(columns[vi]) || 0 : 0];
      if (bar.every(Number.isFinite)) bars.push(bar);
    }
    return bars;
  }

  function isSynthetic(bar) {
    return !bar || bar.synthetic === true || bar.isSynthetic === true;
  }

  function prepare(rawBars) {
    const bars = rawBars.filter(function(bar) {
      return Array.isArray(bar) && bar.length >= 5 && !isSynthetic(bar) &&
        bar.slice(0, 5).every(Number.isFinite) && bar.slice(1, 5).every(function(value) { return value > 0; });
    }).slice().sort(function(a, b) { return a[0] - b[0]; });
    const deduped = [];
    for (let i = 0; i < bars.length; i++) {
      if (deduped.length && deduped[deduped.length - 1][0] === bars[i][0]) deduped[deduped.length - 1] = bars[i];
      else deduped.push(bars[i]);
    }
    const groups = new Map();
    for (let i = 0; i < deduped.length; i++) {
      const key = dateKey(deduped[i][0]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    return { bars: deduped, groups: groups, dates: Array.from(groups.keys()).sort() };
  }

  function calendarDates(firstDate, lastDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(lastDate || '') || firstDate > lastDate) {
      throw new Error('Market data API returned invalid coverage dates.');
    }
    const dates = [];
    const current = new Date(firstDate + 'T00:00:00Z');
    const end = new Date(lastDate + 'T00:00:00Z');
    if (!Number.isFinite(current.getTime()) || !Number.isFinite(end.getTime())) {
      throw new Error('Market data API returned invalid coverage dates.');
    }
    while (current <= end) {
      dates.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }

  function apiBaseUrl() {
    return typeof location !== 'undefined' && location && location.hostname ? '/gametrader-api/v1/candles' : '';
  }

  async function loadApiMetadata(entry, key) {
    const baseUrl = apiBaseUrl();
    const symbol = apiSymbols[key];
    if (!baseUrl || !symbol) return false;
    const response = await fetch(baseUrl + '?action=meta&symbol=' + encodeURIComponent(symbol), { cache: 'no-store' });
    if (!response.ok) throw new Error('Market data API returned ' + response.status + '.');
    const meta = await response.json();
    const dates = calendarDates(meta.firstDate, meta.lastDate);
    Object.assign(entry, {
      source: 'sqlite', dates: dates, firstDate: meta.firstDate, lastDate: meta.lastDate,
      bars: null, groups: null, ranges: []
    });
    return true;
  }

  async function loadCsv(entry, instrument) {
    const response = await fetch(instrument.csvFile, { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load ' + instrument.csvFile + ' (' + response.status + ')');
    const parser = typeof parseTV === 'function' ? parseTV : fallbackParse;
    const prepared = prepare(parser(await response.text()));
    if (!prepared.bars.length) throw new Error('No non-synthetic market bars found in ' + instrument.csvFile);
    Object.assign(entry, prepared, { source: 'csv', ranges: [] });
    return prepared.bars;
  }

  async function loadInstrument(key) {
    if (cache.has(key)) {
      const cached = cache.get(key);
      if (cached.source !== 'csv' || !apiBaseUrl() || !apiSymbols[key]) return cached.promise;
      if (!cached.retryPromise) {
        cached.retryPromise = loadApiMetadata(cached, key).catch(function() { return false; }).finally(function() {
          cached.retryPromise = null;
        });
      }
      await cached.retryPromise;
      return cached.source === 'sqlite' ? [] : cached.bars;
    }
    const instruments = typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS : {};
    const instrument = instruments[key];
    if (!instrument || !instrument.csvFile) throw new Error('Unknown instrument: ' + key);

    const entry = { ranges: [] };
    entry.promise = (async function() {
      const baseUrl = apiBaseUrl();
      const symbol = apiSymbols[key];
      if (baseUrl && symbol) {
        try {
          await loadApiMetadata(entry, key);
          return [];
        } catch (error) {
          return loadCsv(entry, instrument);
        }
      }
      return loadCsv(entry, instrument);
    })().catch(function(error) {
      cache.delete(key);
      throw error;
    });
    cache.set(key, entry);
    return entry.promise;
  }

  async function loadRange(key, from, to) {
    await loadInstrument(key);
    const entry = cache.get(key);
    if (entry.source === 'csv') return entry.bars;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) {
      throw new Error('Select a valid From/To date range.');
    }
    if (from < entry.firstDate || to > entry.lastDate) {
      throw new Error('Selected dates must be within available market coverage.');
    }
    const activation = (entry.activation || 0) + 1;
    entry.activation = activation;

    let range = entry.ranges.find(function(item) { return item.from <= from && item.to >= to; });
    if (!range) {
      range = { from: from, to: to, prepared: null, promise: null };
      const symbol = apiSymbols[key];
      const url = apiBaseUrl() + '?action=candles&symbol=' + encodeURIComponent(symbol) +
        '&from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
      range.promise = fetch(url, { cache: 'no-store' }).then(async function(response) {
        let payload;
        try { payload = await response.json(); } catch (error) { payload = null; }
        if (!response.ok) {
          const detail = payload && (payload.error || payload.message);
          throw new Error(detail || 'Could not load selected market range (' + response.status + ').');
        }
        if (!payload || !Array.isArray(payload.bars)) throw new Error('Market data API returned an invalid candle range.');
        const prepared = prepare(payload.bars);
        if (!prepared.bars.length) throw new Error('No market bars are available for the selected range.');
        range.prepared = prepared;
        range.warmupCount = Number(payload.warmupCount) || 0;
        range.rangeCount = Number(payload.rangeCount) || 0;
        return prepared;
      }).catch(function(error) {
        const index = entry.ranges.indexOf(range);
        if (index >= 0) entry.ranges.splice(index, 1);
        throw error;
      });
      entry.ranges.push(range);
    }
    const prepared = range.prepared || await range.promise;
    if (activation === entry.activation) {
      entry.bars = prepared.bars;
      entry.groups = prepared.groups;
    }
    return entry.bars;
  }

  function getAvailableDates(key) {
    const entry = cache.get(key);
    return entry && entry.dates ? entry.dates.slice() : [];
  }

  function getSource(key) {
    const entry = cache.get(key);
    return entry ? entry.source || '' : '';
  }

  function seededRandom(seed) {
    const text = String(seed == null ? 0 : seed);
    let state = 2166136261;
    for (let i = 0; i < text.length; i++) {
      state ^= text.charCodeAt(i);
      state = Math.imul(state, 16777619);
    }
    return function() {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildDays(options) {
    const instrument = options && options.instrument;
    const entry = cache.get(instrument);
    if (!entry || !entry.bars) throw new Error('Market data is not loaded for ' + instrument);
    const from = options.dateFrom || entry.dates[0];
    const to = options.dateTo || entry.dates[entry.dates.length - 1];
    const startMin = Number(options.sessionStartMin);
    const endMin = Number(options.sessionEndMin);
    if (!from || !to || from > to) throw new Error('Select a valid From/To date range.');
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
      throw new Error('Playback end must be after playback start.');
    }

    const days = [];
    for (const key of entry.dates) {
      if (key < from || key > to) continue;
      const indexes = entry.groups.get(key);
      if (!indexes) continue;
      const sessionIndexes = indexes.filter(function(index) {
        const minute = minuteOfDay(entry.bars[index][0]);
        return minute >= startMin && minute < endMin;
      });
      if (!sessionIndexes.length) continue;
      const firstIndex = sessionIndexes[0];
      // The canonical Bokke backtest begins indicator state at midnight UTC for
      // the selected date, rather than at the London calendar-day boundary.
      const strategyStart = Date.parse(key + 'T00:00:00Z') / 1000;
      const warmupBars = indexes.filter(function(index) {
        return index < firstIndex && entry.bars[index][0] >= strategyStart;
      }).map(function(index) { return entry.bars[index]; });
      const chartHistory = entry.bars.slice(Math.max(0, firstIndex - CHART_HISTORY_BARS), firstIndex);
      const bars = sessionIndexes.map(function(index) { return entry.bars[index]; });
      if (warmupBars.length + bars.length < 120) continue;
      const firstDate = new Date(bars[0][0] * 1000);
      days.push({
        key: key,
        day: dayLabel.format(firstDate),
        date: dateLabel.format(firstDate),
        bars: bars,
        warmupBars: warmupBars,
        chartHistory: chartHistory
      });
    }

    if (options.count === 'all') return days;
    const requested = Math.max(0, Math.floor(Number(options.count) || 0));
    if (requested >= days.length) return days;
    const random = seededRandom(options.seed);
    const sampled = days.slice();
    for (let i = sampled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const temp = sampled[i]; sampled[i] = sampled[j]; sampled[j] = temp;
    }
    return sampled.slice(0, requested).sort(function(a, b) { return a.key.localeCompare(b.key); });
  }

  return {
    loadInstrument: loadInstrument, loadRange: loadRange, getAvailableDates: getAvailableDates,
    getSource: getSource, buildDays: buildDays
  };
})();
