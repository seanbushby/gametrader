'use strict';
window.BotLab = window.BotLab || {};

BotLab.Chart = (function() {
  var TIMEFRAMES = [1, 2, 3, 5, 10, 15, 30, 60];
  var AXIS_WIDTH = 68;
  var AXIS_HEIGHT = 22;
  var _canvas = null;
  var _ctx = null;
  var _sessionCtrl = null;
  var _managedRunner = null;
  var _actions = {};
  var _resizeObserver = null;
  var _timeframe = 1;
  var _showVWAP = false;
  var _zoom = 1;
  var _viewOffset = 0;
  var _scaleY = { min: 0, max: 1, manual: false };
  var _cross = null;
  var _drag = null;
  var _rulerEnabled = false;
  var _ruler = null;
  var _referenceCache = null;
  var _displayHistoryCache = null;
  var _dayHistoryCache = null;
  var _ukTimeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  var _ukDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  var _lastGeo = null;

  function init(canvasId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.isConnected) return false;
    destroy();
    _canvas = canvas;
    _ctx = canvas.getContext('2d');
    if (!_ctx) { _canvas = null; return false; }
    _canvas.style.touchAction = 'none';
    _canvas.addEventListener('wheel', _onWheel, { passive: false });
    _canvas.addEventListener('pointerdown', _onPointerDown);
    _canvas.addEventListener('pointermove', _onPointerMove);
    _canvas.addEventListener('pointerup', _onPointerUp);
    _canvas.addEventListener('pointercancel', _onPointerUp);
    _canvas.addEventListener('pointerleave', _onPointerLeave);
    window.addEventListener('resize', _resize);
    document.addEventListener('fullscreenchange', _syncControls);
    document.addEventListener('webkitfullscreenchange', _syncControls);
    if (typeof ResizeObserver !== 'undefined' && _canvas.parentElement) {
      _resizeObserver = new ResizeObserver(_resize);
      _resizeObserver.observe(_canvas.parentElement);
    }
    _resize();
    return true;
  }

  function setSessionController(controller) { _sessionCtrl = controller; }
  function setManagedRunner(runner) { _managedRunner = runner; }
  function setActions(actions) { _actions = actions || {}; }
  function setAutoRunner() {}

  function isScalePrice(value) {
    return value != null && Number.isFinite(Number(value)) && Number(value) > 0;
  }

  function isDisplayBar(bar) {
    if (!Array.isArray(bar) || bar.length < 6) return false;
    var open = Number(bar[1]), high = Number(bar[2]), low = Number(bar[3]), close = Number(bar[4]);
    if (![open, high, low, close].every(Number.isFinite)) return false;
    // SQLite includes low-volume quote-heartbeat rows outside the usable feed.
    // They are retained for strategy parity but must not be rendered as candles.
    return !(Number(bar[5]) <= 2 && open === high && high === low && low === close);
  }

  function _displayHistory(rows) {
    var source = Array.isArray(rows) ? rows : [];
    var key = source.length + '|' + (source.length ? source[source.length - 1][0] : '');
    if (!_displayHistoryCache || _displayHistoryCache.key !== key) {
      _displayHistoryCache = { key: key, bars: source.filter(isDisplayBar) };
    }
    return _displayHistoryCache.bars;
  }

  function _visibleHistory(rows, state) {
    // Intraday views follow the main chart: current session plus its pre-open
    // context. Weekly history is reserved for the higher timeframe views.
    if (_timeframe >= 15) return rows;
    var timestamp = Number(state.currentTimestamp) || (Array.isArray(state.bars) && state.bars.length ? Number(state.bars[0][0]) * 1000 : 0);
    var date = _ukDate(timestamp);
    var key = date + '|' + rows.length + '|' + (rows.length ? rows[rows.length - 1][0] : '');
    if (!_dayHistoryCache || _dayHistoryCache.key !== key) {
      _dayHistoryCache = { key: key, bars: rows.filter(function(bar) { return _ukDate(bar[0] * 1000) === date; }) };
    }
    return _dayHistoryCache.bars;
  }

  function _continuousTail(rows) {
    if (!Array.isArray(rows) || _timeframe >= 15) return Array.isArray(rows) ? rows : [];
    for (var index = rows.length - 1; index > 0; index--) {
      if (Number(rows[index][0]) - Number(rows[index - 1][0]) > 120) return rows.slice(index);
    }
    return rows;
  }

  function orderCardTop(entryY, plotHeight, cardHeight) {
    var height = Number(cardHeight) || 28;
    return Math.max(2, Math.min(Number(plotHeight) - height - 2, Number(entryY) - height / 2));
  }

  function aggregateBars(rows, timeframe) {
    if (!Array.isArray(rows)) return [];
    timeframe = Math.max(1, Number(timeframe) || 1);
    if (timeframe === 1) return rows.slice();
    var bucket = timeframe * 60;
    var output = [];
    var current = null;
    rows.forEach(function(bar) {
      var key = Math.floor(Number(bar[0]) / bucket) * bucket;
      if (!current || current[0] !== key) {
        if (current) output.push(current);
        current = [key, Number(bar[1]), Number(bar[2]), Number(bar[3]), Number(bar[4]), Number(bar[5]) || 0];
      } else {
        current[2] = Math.max(current[2], Number(bar[2]));
        current[3] = Math.min(current[3], Number(bar[3]));
        current[4] = Number(bar[4]);
        current[5] += Number(bar[5]) || 0;
      }
    });
    if (current) output.push(current);
    return output;
  }

  function priceToY(price, minPrice, maxPrice, plotHeight) {
    var span = Number(maxPrice) - Number(minPrice);
    return Number(plotHeight) - (Number(price) - Number(minPrice)) / (span || 1) * Number(plotHeight);
  }

  function yToPrice(value, minPrice, maxPrice, plotHeight) {
    return Number(minPrice) + (Number(plotHeight) - Number(value)) / Math.max(1, Number(plotHeight)) * (Number(maxPrice) - Number(minPrice));
  }

  function _resize() {
    if (!_canvas || !_canvas.isConnected || !_canvas.parentElement) return;
    var dpr = window.devicePixelRatio || 1;
    var width = Math.max(1, _canvas.parentElement.clientWidth);
    var height = Math.max(1, _canvas.parentElement.clientHeight);
    if (_canvas.width !== Math.round(width * dpr)) _canvas.width = Math.round(width * dpr);
    if (_canvas.height !== Math.round(height * dpr)) _canvas.height = Math.round(height * dpr);
    _canvas.style.width = width + 'px';
    _canvas.style.height = height + 'px';
    render();
  }

  function render() {
    if (!_ctx || !_canvas || !_canvas.isConnected || !_sessionCtrl) return;
    var state = _sessionCtrl.getState();
    var replayBars = Array.isArray(state.bars) ? state.bars.slice(0, Math.min(Number(state.currentBarIndex) || 0, state.bars.length)).filter(isDisplayBar) : [];
    // Chart context includes SQLite quote-heartbeat rows; never let those
    // one-price rows distort the visible candle scale.
    var chartHistory = Array.isArray(state.chartHistory) ? _visibleHistory(state.chartHistory.filter(isDisplayBar), state) : [];
    // Do not draw candles across a SQLite outage as though it were one market move.
    var baseBars = _continuousTail(chartHistory.concat(replayBars));
    var dpr = window.devicePixelRatio || 1;
    var width = _canvas.width / dpr;
    var height = _canvas.height / dpr;
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    if (!baseBars.length || width <= AXIS_WIDTH || height <= AXIS_HEIGHT) { _syncControls(); return; }

    var plotWidth = Math.max(1, width - AXIS_WIDTH);
    var plotHeight = Math.max(1, height - AXIS_HEIGHT);
    // Aggregate one ordered stream so timeframe buckets remain continuous at
    // the history-to-replay boundary.
    var allBars = aggregateBars(baseBars, _timeframe);
    var visibleCount = Math.max(8, Math.min(400, Math.round(90 / _zoom)));
    var maxOffset = Math.max(0, allBars.length - 1);
    // Negative offsets reserve right-side space, so the current bar can be
    // positioned away from the edge just as it can on the main chart.
    _viewOffset = Math.max(-(visibleCount - 8), Math.min(maxOffset, _viewOffset));
    var futureBars = Math.max(0, -Math.round(_viewOffset));
    var end = Math.max(0, allBars.length - Math.max(0, Math.round(_viewOffset)));
    // Leave `futureBars` empty slots on the right instead of merely allowing
    // an offset value that still draws a full-width bar set.
    var renderedCount = Math.max(1, visibleCount - futureBars);
    var start = Math.max(0, end - renderedCount);
    var shown = allBars.slice(start, end);
    var openPositions = _managedRunner ? _managedRunner.getPositions().filter(function(position) { return !position.closed; }) : [];
    var vwapByBucket = _showVWAP ? _buildVWAP(baseBars, _timeframe) : null;
    var low = Infinity;
    var high = -Infinity;

    shown.forEach(function(bar) { low = Math.min(low, Number(bar[3])); high = Math.max(high, Number(bar[2])); });
    openPositions.forEach(function(position) {
      [position.entryPrice, position.stopLoss, position.takeProfit].forEach(function(price) {
        if (isScalePrice(price)) { low = Math.min(low, Number(price)); high = Math.max(high, Number(price)); }
      });
    });
    if (vwapByBucket) shown.forEach(function(bar) {
      var point = vwapByBucket[String(bar[0])];
      if (point) { low = Math.min(low, point.lower3); high = Math.max(high, point.upper3); }
    });
    if (!Number.isFinite(low) || !Number.isFinite(high)) return;
    var padding = Math.max(2, (high - low) * 0.12);
    if (!_scaleY.manual || !isScalePrice(_scaleY.max) || !Number.isFinite(_scaleY.min)) {
      _scaleY.min = low - padding;
      _scaleY.max = high + padding;
    }
    if (_scaleY.max <= _scaleY.min) _scaleY.max = _scaleY.min + 1;
    var y = function(price) { return priceToY(price, _scaleY.min, _scaleY.max, plotHeight); };
    var slotWidth = plotWidth / visibleCount;
    var leftPad = Math.max(0, renderedCount - shown.length);
    var bodyWidth = Math.max(2, slotWidth * 0.68);
    _lastGeo = { plotWidth: plotWidth, plotHeight: plotHeight, slotWidth: slotWidth, shown: shown, leftPad: leftPad, y: y, positions: openPositions };

    _ctx.save();
    _ctx.scale(dpr, dpr);
    _drawGrid(plotWidth, plotHeight, y);
    shown.forEach(function(bar, index) {
      var x = slotWidth * (leftPad + index + 0.5);
      var open = Number(bar[1]);
      var close = Number(bar[4]);
      var color = close >= open ? '#00e58c' : '#ff4d5e';
      _ctx.strokeStyle = color;
      _ctx.fillStyle = color;
      _ctx.beginPath();
      _ctx.moveTo(x, y(bar[2]));
      _ctx.lineTo(x, y(bar[3]));
      _ctx.stroke();
      _ctx.fillRect(x - bodyWidth / 2, Math.min(y(open), y(close)), bodyWidth, Math.max(1, Math.abs(y(close) - y(open))));
    });
    if (vwapByBucket) _drawVWAP(shown, vwapByBucket, slotWidth, leftPad, y, plotWidth);
    _drawClosedPositions(baseBars, start, end, shown, slotWidth, leftPad, y);
    openPositions.forEach(function(position) {
      var direction = Number(position.dir) === 1 || position.direction === 'long' ? 1 : -1;
      _drawPriceLine(position.entryPrice, '#d4a574', 'ENTRY', direction, y, plotWidth, plotHeight, false);
      var stop = _previewPrice(position, 'stop');
      var target = _previewPrice(position, 'tp');
      if (stop != null) _drawPriceLine(stop, position.humanStopOverride ? '#ff9d3a' : '#ff4d5e', position.humanStopOverride ? 'H-STOP' : 'STOP', direction, y, plotWidth, plotHeight, _isPreview(position, 'stop'));
      if (target != null) _drawPriceLine(target, '#00e58c', 'TP', direction, y, plotWidth, plotHeight, _isPreview(position, 'tp'));
    });
    _positionOrderCards(openPositions, y, plotHeight);
    _drawCurrentPrice(state, shown, y, plotWidth);
    _drawTimeAxis(shown, slotWidth, leftPad, plotHeight, plotWidth);
    _drawRuler(y, plotWidth, plotHeight);
    _drawCrosshair(y, plotWidth, plotHeight, slotWidth, leftPad, shown);
    _ctx.restore();
    _syncControls();
  }

  function _buildVWAP(baseBars, timeframe) {
    var sum = 0;
    var squareSum = 0;
    var volumeSum = 0;
    var bucketSeconds = timeframe * 60;
    var points = {};
    baseBars.forEach(function(bar) {
      var volume = Math.max(0, Number(bar[5]) || 0);
      if (!volume) return;
      var typical = (Number(bar[2]) + Number(bar[3]) + Number(bar[4])) / 3;
      sum += typical * volume;
      squareSum += typical * typical * volume;
      volumeSum += volume;
      var center = sum / volumeSum;
      var deviation = Math.sqrt(Math.max(0, squareSum / volumeSum - center * center));
      points[String(Math.floor(Number(bar[0]) / bucketSeconds) * bucketSeconds)] = {
        v: center,
        upper1: center + deviation, lower1: center - deviation,
        upper2: center + deviation * 2, lower2: center - deviation * 2,
        upper3: center + deviation * 3, lower3: center - deviation * 3
      };
    });
    return points;
  }

  function _referenceLevels(bars, timestamp) {
    var activeDate = _ukDate(timestamp);
    var dayBars = (bars || []).filter(function(bar) { return _ukDate(bar[0] * 1000) === activeDate; });
    var asiaBars = dayBars.filter(function(bar) { var minute = _ukMinute(bar[0]); return minute >= 60 && minute < 480; });
    var sessionBars = dayBars.filter(function(bar) { return _ukMinute(bar[0]) >= 480; });
    return {
      open: sessionBars.length ? Number(sessionBars[0][1]) : null,
      asiaHigh: asiaBars.length ? Math.max.apply(null, asiaBars.map(function(bar) { return Number(bar[2]); })) : null,
      asiaLow: asiaBars.length ? Math.min.apply(null, asiaBars.map(function(bar) { return Number(bar[3]); })) : null,
      sessionBars: sessionBars
    };
  }

  function _cachedReferenceLevels(state) {
    var history = Array.isArray(state.chartHistory) ? state.chartHistory : [];
    var firstReplayBar = Array.isArray(state.bars) && state.bars.length ? state.bars[0] : null;
    var timestamp = Number(state.currentTimestamp) || (firstReplayBar ? Number(firstReplayBar[0]) * 1000 : 0);
    var key = _ukDate(timestamp) + '|' + history.length + '|' + (history.length ? history[history.length - 1][0] : '') + '|' + (firstReplayBar ? firstReplayBar[0] : '');
    if (!_referenceCache || _referenceCache.key !== key) {
      var sourceBars = history.slice(-600);
      var levels = _referenceLevels(sourceBars.concat(firstReplayBar ? [firstReplayBar] : []), timestamp);
      // The first replay bar establishes the open when playback starts at 08:00,
      // but must not be pre-counted in VWAP before that bar has been processed.
      levels.sessionBars = _referenceLevels(sourceBars, timestamp).sessionBars;
      _referenceCache = { key: key, levels: levels };
    }
    return _referenceCache.levels;
  }

  function _drawReferenceLevels(levels, y, plotWidth) {
    _drawReferenceLine(levels.open, '#f2f4f8', 'OPEN', y, plotWidth);
    _drawReferenceLine(levels.asiaHigh, '#ff9b3d', 'ASIA H', y, plotWidth);
    _drawReferenceLine(levels.asiaLow, '#ff9b3d', 'ASIA L', y, plotWidth);
  }

  function _drawReferenceLine(price, color, label, y, plotWidth) {
    if (!isScalePrice(price)) return;
    var lineY = y(price);
    _ctx.strokeStyle = color; _ctx.globalAlpha = 0.72; _ctx.lineWidth = 1; _ctx.setLineDash([3, 3]);
    _ctx.beginPath(); _ctx.moveTo(0, lineY); _ctx.lineTo(plotWidth, lineY); _ctx.stroke();
    _ctx.setLineDash([]); _ctx.globalAlpha = 1;
    _ctx.font = '9px JetBrains Mono,monospace'; _ctx.fillStyle = color; _ctx.textAlign = 'left'; _ctx.textBaseline = 'bottom';
    _ctx.fillText(label + ' ' + Number(price).toFixed(1), 4, lineY - 3);
  }

  function _drawVWAP(shown, points, slotWidth, leftPad, y, plotWidth) {
    var series = [];
    shown.forEach(function(bar, index) {
      var point = points[String(bar[0])];
      if (point) series.push({ x: slotWidth * (leftPad + index + 0.5), point: point });
    });
    function draw(key, color, width) {
      if (!series.length) return;
      _ctx.strokeStyle = color;
      _ctx.lineWidth = width;
      _ctx.beginPath();
      series.forEach(function(item, index) {
        var py = y(item.point[key]);
        if (index) _ctx.lineTo(item.x, py); else _ctx.moveTo(item.x, py);
      });
      if (series.length === 1) _ctx.lineTo(Math.min(plotWidth, series[0].x + 20), y(series[0].point[key]));
      _ctx.stroke();
    }
    draw('upper3', '#009688', 0.9); draw('lower3', '#009688', 0.9);
    draw('upper2', '#808000', 1); draw('lower2', '#808000', 1);
    draw('upper1', '#4caf50', 1.1); draw('lower1', '#4caf50', 1.1);
    draw('v', '#2962ff', 1.7);
    var last = series[series.length - 1];
    if (last) _drawPill(Math.min(plotWidth - 76, last.x + 5), y(last.point.v) - 12, 'VWAP ' + last.point.v.toFixed(1), '#2962ff', '#0b0e13');
  }

  function _drawGrid(plotWidth, plotHeight, y) {
    var step = _niceStep((_scaleY.max - _scaleY.min) / 9);
    _ctx.font = '11px JetBrains Mono,monospace';
    _ctx.textBaseline = 'middle';
    for (var price = Math.ceil(_scaleY.min / step) * step; price < _scaleY.max; price += step) {
      var gridY = Math.round(y(price)) + 0.5;
      _ctx.strokeStyle = '#1a2030';
      _ctx.beginPath(); _ctx.moveTo(0, gridY); _ctx.lineTo(plotWidth, gridY); _ctx.stroke();
      _ctx.fillStyle = '#5a6379'; _ctx.textAlign = 'left'; _ctx.fillText(price.toFixed(0), plotWidth + 6, gridY);
    }
  }

  function _drawTimeAxis(shown, slotWidth, leftPad, plotHeight, plotWidth) {
    _ctx.strokeStyle = '#1a2030';
    _ctx.beginPath(); _ctx.moveTo(0, plotHeight + 0.5); _ctx.lineTo(plotWidth, plotHeight + 0.5); _ctx.stroke();
    _ctx.textBaseline = 'top'; _ctx.font = '10px JetBrains Mono,monospace'; _ctx.fillStyle = '#5a6379';
    var previous = -Infinity;
    shown.forEach(function(bar, index) {
      var minute = _ukMinute(bar[0]);
      var spacing = _timeframe >= 15 ? 60 : 30;
      if (minute >= previous + spacing || minute < previous) {
        var x = slotWidth * (leftPad + index + 0.5);
        _ctx.strokeStyle = 'rgba(26,32,48,.72)';
        _ctx.beginPath(); _ctx.moveTo(Math.round(x) + 0.5, 0); _ctx.lineTo(Math.round(x) + 0.5, plotHeight); _ctx.stroke();
        _ctx.fillStyle = '#5a6379';
        _ctx.textAlign = 'center'; _ctx.fillText(_ukTime(bar[0]), x, plotHeight + 6); previous = minute;
      }
    });
  }

  function _drawPriceLine(price, color, label, direction, y, plotWidth, plotHeight, preview) {
    price = Number(price);
    if (!Number.isFinite(price)) return;
    var lineY = y(price);
    var aboveChart = lineY < 0;
    var belowChart = lineY > plotHeight;
    var visibleY = Math.max(9, Math.min(plotHeight - 9, lineY));
    _ctx.strokeStyle = color; _ctx.lineWidth = preview ? 2 : 1; _ctx.globalAlpha = preview ? 0.95 : 0.78;
    _ctx.setLineDash(preview ? [7, 3] : [4, 3]);
    _ctx.beginPath(); _ctx.moveTo(0, visibleY); _ctx.lineTo(plotWidth, visibleY); _ctx.stroke();
    _ctx.setLineDash([]); _ctx.globalAlpha = 1;
    _ctx.fillStyle = color; _ctx.font = '9px JetBrains Mono,monospace'; _ctx.textAlign = 'left';
    _ctx.textBaseline = aboveChart ? 'top' : belowChart ? 'bottom' : (direction === 1 ? 'bottom' : 'top');
    _ctx.fillText(label + (aboveChart ? ' ^' : belowChart ? ' v' : '') + ' ' + price.toFixed(1), 4, visibleY + (aboveChart ? 3 : belowChart ? -3 : (direction === 1 ? -4 : 4)));
  }

  function _drawCurrentPrice(state, shown, y, plotWidth) {
    var current = Number(state.currentPrice);
    if (!Number.isFinite(current)) return;
    var lineY = y(current);
    var previous = shown.length > 1 ? Number(shown[shown.length - 2][4]) : current;
    var color = current >= previous ? '#00e58c' : '#ff4d5e';
    _ctx.strokeStyle = 'rgba(89,210,254,.4)'; _ctx.lineWidth = 1;
    _ctx.beginPath(); _ctx.moveTo(0, Math.round(lineY) + 0.5); _ctx.lineTo(plotWidth, Math.round(lineY) + 0.5); _ctx.stroke();
    _drawPill(plotWidth + 1, lineY, current.toFixed(1), color, '#0b0e13');
  }

  function _drawPill(x, y, text, background, foreground) {
    _ctx.font = '700 10px JetBrains Mono,monospace';
    var width = _ctx.measureText(text).width + 12;
    _ctx.fillStyle = background; _ctx.fillRect(x, y - 9, width, 18);
    _ctx.fillStyle = foreground || '#0b0e13'; _ctx.textAlign = 'left'; _ctx.textBaseline = 'middle'; _ctx.fillText(text, x + 6, y);
  }

  function _drawRuler(y, plotWidth, plotHeight) {
    if (!_ruler) return;
    var startX = Math.max(0, Math.min(plotWidth, _ruler.startX));
    var endX = Math.max(0, Math.min(plotWidth, _ruler.endX));
    var startY = Math.max(0, Math.min(plotHeight, y(_ruler.startPrice)));
    var endY = Math.max(0, Math.min(plotHeight, y(_ruler.endPrice)));
    var delta = _ruler.endPrice - _ruler.startPrice;
    var color = delta >= 0 ? '#00e58c' : '#ff4d5e';
    _ctx.strokeStyle = color; _ctx.fillStyle = color; _ctx.lineWidth = 1.5; _ctx.setLineDash([5, 3]);
    _ctx.beginPath(); _ctx.moveTo(startX, startY); _ctx.lineTo(endX, endY); _ctx.stroke(); _ctx.setLineDash([]);
    _ctx.beginPath(); _ctx.arc(startX, startY, 3, 0, Math.PI * 2); _ctx.arc(endX, endY, 3, 0, Math.PI * 2); _ctx.fill();
    _drawPill(Math.min(plotWidth - 88, Math.max(2, (startX + endX) / 2)), Math.max(12, Math.min(plotHeight - 12, (startY + endY) / 2)), (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' pts', color, '#0b0e13');
  }

  function _drawCrosshair(y, plotWidth, plotHeight, slotWidth, leftPad, shown) {
    if (!_cross) return;
    var x = Math.max(0, Math.min(plotWidth, _cross.x));
    var cy = Math.max(0, Math.min(plotHeight, _cross.y));
    _ctx.setLineDash([4, 4]); _ctx.strokeStyle = 'rgba(139,147,167,.65)';
    _ctx.beginPath(); _ctx.moveTo(x, 0); _ctx.lineTo(x, plotHeight); _ctx.stroke();
    _ctx.beginPath(); _ctx.moveTo(0, cy); _ctx.lineTo(plotWidth, cy); _ctx.stroke(); _ctx.setLineDash([]);
    _drawPill(plotWidth + 1, cy, yToPrice(cy, _scaleY.min, _scaleY.max, plotHeight).toFixed(1), '#8b93a7', '#0b0e13');
    var index = Math.round(x / slotWidth - leftPad - 0.5);
    if (shown[index]) {
      _ctx.fillStyle = '#8b93a7'; _ctx.font = '10px JetBrains Mono,monospace'; _ctx.textAlign = 'center'; _ctx.textBaseline = 'top';
      _ctx.fillText(_ukTime(shown[index][0]), x, plotHeight + 6);
    }
  }

  function _drawClosedPositions(baseBars, start, end, shown, slotWidth, leftPad, y) {
    var closed = _managedRunner ? _managedRunner.getClosedPositions() : [];
    closed.forEach(function(position) {
      var entry = _findVisibleBar(shown, position.entryTimestamp, 0, shown.length);
      var exit = _findVisibleBar(shown, position.exitTimestamp, 0, shown.length);
      if (entry == null && exit == null) return;
      var color = Number(position.pnl) >= 0 ? '#00e58c' : '#ff4d5e';
      var entryX = entry == null ? null : slotWidth * (leftPad + entry + 0.5);
      var exitX = exit == null ? null : slotWidth * (leftPad + exit + 0.5);
      if (entryX != null && exitX != null) {
        _ctx.strokeStyle = color; _ctx.globalAlpha = 0.5; _ctx.setLineDash([3, 3]);
        _ctx.beginPath(); _ctx.moveTo(entryX, y(position.entryPrice)); _ctx.lineTo(exitX, y(position.exitPrice)); _ctx.stroke();
        _ctx.setLineDash([]); _ctx.globalAlpha = 1;
      }
    });
  }

  function _positionOrderCards(positions, y, plotHeight) {
    var container = document.getElementById('blChartOrders');
    if (!container) return;
    var usedTops = [];
    Array.from(container.children).forEach(function(card) {
      var position = positions.find(function(item) { return String(item.id) === String(card.dataset.positionId); });
      if (!position || !isScalePrice(position.entryPrice)) { card.style.display = 'none'; return; }
      card.style.display = 'flex';
      var top = orderCardTop(y(position.entryPrice), plotHeight, card.offsetHeight || 28);
      while (usedTops.some(function(existing) { return Math.abs(existing - top) < 30; })) top += 31;
      top = orderCardTop(top + (card.offsetHeight || 28) / 2, plotHeight, card.offsetHeight || 28);
      usedTops.push(top); card.style.top = top + 'px';
    });
  }

  function _findVisibleBar(bars, timestamp, startBar, endBar) {
    if (!Number.isFinite(Number(timestamp)) || startBar >= endBar) return null;
    var seconds = Number(timestamp) > 1e10 ? Math.floor(Number(timestamp) / 1000) : Math.floor(Number(timestamp));
    var timeframeSeconds = _timeframe * 60;
    for (var index = startBar; index < endBar; index++) {
      if (seconds >= Number(bars[index][0]) && seconds < Number(bars[index][0]) + timeframeSeconds) return index;
    }
    return null;
  }

  function _previewPrice(position, kind) {
    if (_drag && _drag.type === 'risk' && _drag.kind === kind && String(_drag.positionId) === String(position.id)) return _drag.previewPrice;
    return kind === 'stop' ? position.stopLoss : position.takeProfit;
  }

  function _isPreview(position, kind) {
    return !!(_drag && _drag.type === 'risk' && _drag.kind === kind && String(_drag.positionId) === String(position.id));
  }

  function _eventPoint(event) {
    var rect = _canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function _hitRiskLine(point, pointerType) {
    if (!_lastGeo || point.x >= _lastGeo.plotWidth) return null;
    var band = pointerType === 'touch' ? 24 : 16;
    var best = null;
    _lastGeo.positions.forEach(function(position) {
      [['stop', position.stopLoss], ['tp', position.takeProfit]].forEach(function(level) {
        if (!isScalePrice(level[1])) return;
        var distance = Math.abs(point.y - _lastGeo.y(level[1]));
        if (distance <= band && (!best || distance < best.distance)) best = { kind: level[0], positionId: position.id, distance: distance, price: Number(level[1]) };
      });
    });
    return best;
  }

  function _onPointerDown(event) {
    if (!_lastGeo || (event.button != null && event.button !== 0)) return;
    var point = _eventPoint(event);
    var hit = _hitRiskLine(point, event.pointerType);
    if (_rulerEnabled && point.x < _lastGeo.plotWidth) {
      var price = yToPrice(Math.max(0, Math.min(_lastGeo.plotHeight, point.y)), _scaleY.min, _scaleY.max, _lastGeo.plotHeight);
      _ruler = { startX: point.x, endX: point.x, startPrice: price, endPrice: price };
      _drag = { type: 'ruler', pointerId: event.pointerId };
    } else if (hit) {
      _drag = { type: 'risk', kind: hit.kind, positionId: hit.positionId, previewPrice: hit.price, startY: point.y, moved: false, pointerId: event.pointerId };
      _canvas.classList.add('blRiskDragging');
    } else if (point.x >= _lastGeo.plotWidth) {
      _drag = { type: 'axis', pointerId: event.pointerId, startY: point.y, startMin: _scaleY.min, startMax: _scaleY.max };
    } else {
      _drag = { type: 'pan', pointerId: event.pointerId, lastX: point.x, lastY: point.y };
    }
    _cross = null;
    try { _canvas.setPointerCapture(event.pointerId); } catch (error) {}
    event.preventDefault();
  }

  function _onPointerMove(event) {
    if (!_lastGeo) return;
    var point = _eventPoint(event);
    if (!_drag) {
      if (event.pointerType !== 'touch') { _cross = point; _canvas.style.cursor = _hitRiskLine(point, event.pointerType) || point.x >= _lastGeo.plotWidth ? 'ns-resize' : 'crosshair'; render(); }
      return;
    }
    if (event.pointerId !== _drag.pointerId) return;
    if (_drag.type === 'ruler') {
      _ruler.endX = point.x;
      _ruler.endPrice = yToPrice(Math.max(0, Math.min(_lastGeo.plotHeight, point.y)), _scaleY.min, _scaleY.max, _lastGeo.plotHeight);
    } else if (_drag.type === 'risk') {
      if (Math.abs(point.y - _drag.startY) >= 2) _drag.moved = true;
      _drag.previewPrice = yToPrice(Math.max(0, Math.min(_lastGeo.plotHeight, point.y)), _scaleY.min, _scaleY.max, _lastGeo.plotHeight);
    } else if (_drag.type === 'axis') {
      var span = Math.max(0.0001, _drag.startMax - _drag.startMin);
      var factor = Math.max(0.2, Math.min(6, 1 + (point.y - _drag.startY) / 180));
      var middle = (_drag.startMin + _drag.startMax) / 2;
      _scaleY.min = middle - span * factor / 2; _scaleY.max = middle + span * factor / 2;
      if (Math.abs(point.y - _drag.startY) >= 1) _scaleY.manual = true;
    } else {
      var dx = point.x - _drag.lastX;
      var dy = point.y - _drag.lastY;
      _viewOffset += dx / Math.max(1, _lastGeo.slotWidth);
      if (Math.abs(dy) >= 0.01) {
        var pricePerPixel = (_scaleY.max - _scaleY.min) / _lastGeo.plotHeight;
        _scaleY.min += dy * pricePerPixel; _scaleY.max += dy * pricePerPixel; _scaleY.manual = true;
      }
      _drag.lastX = point.x; _drag.lastY = point.y;
    }
    event.preventDefault(); render();
  }

  function _onPointerUp(event) {
    if (!_drag || event.pointerId !== _drag.pointerId) return;
    var completed = _drag;
    _drag = null;
    _canvas.classList.remove('blRiskDragging');
    try { _canvas.releasePointerCapture(event.pointerId); } catch (error) {}
    if (completed.type === 'risk' && completed.moved) {
      var action = completed.kind === 'stop' ? _actions.moveStop : _actions.moveTP;
      if (typeof action === 'function') Promise.resolve(action(completed.positionId, completed.previewPrice)).catch(function(error) { console.error(error); }).then(render);
    }
    render();
  }

  function _onPointerLeave() {
    if (!_drag) { _cross = null; if (_canvas) _canvas.style.cursor = 'crosshair'; render(); }
  }

  function _onWheel(event) {
    if (!_lastGeo) return;
    event.preventDefault();
    var point = _eventPoint(event);
    if (point.x >= _lastGeo.plotWidth) {
      var span = _scaleY.max - _scaleY.min;
      var anchor = yToPrice(point.y, _scaleY.min, _scaleY.max, _lastGeo.plotHeight);
      var ratio = Math.max(0, Math.min(1, point.y / _lastGeo.plotHeight));
      var nextSpan = Math.max(0.0001, span * (event.deltaY < 0 ? 0.9 : 1.1));
      _scaleY.max = anchor + nextSpan * ratio;
      _scaleY.min = _scaleY.max - nextSpan;
      _scaleY.manual = true;
    } else {
      _zoom = Math.max(0.15, Math.min(6, _zoom * (event.deltaY < 0 ? 1.08 : 0.93)));
    }
    render();
  }

  function cycleTimeframe() {
    _timeframe = TIMEFRAMES[(TIMEFRAMES.indexOf(_timeframe) + 1) % TIMEFRAMES.length];
    _dayHistoryCache = null; _viewOffset = 0; _scaleY.manual = false; render();
    return _timeframe;
  }

  function toggleVWAP() { _showVWAP = !_showVWAP; render(); return _showVWAP; }
  function toggleRuler() { _rulerEnabled = !_rulerEnabled; if (!_rulerEnabled) _ruler = null; render(); return _rulerEnabled; }
  function resetLive() { _viewOffset = 0; _zoom = 1; _scaleY.manual = false; _cross = null; render(); }

  function toggleFullscreen() {
    if (!_canvas || !_canvas.parentElement) return;
    var element = _canvas.parentElement;
    var fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (fullscreen) {
      var exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    } else {
      var request = element.requestFullscreen || element.webkitRequestFullscreen;
      if (request) request.call(element);
    }
  }

  function _syncControls() {
    var tf = document.getElementById('blChartTF');
    var vwap = document.getElementById('blChartVWAP');
    var ruler = document.getElementById('blChartRuler');
    var live = document.getElementById('blChartLive');
    var full = document.getElementById('blChartFull');
    if (tf) tf.textContent = _timeframe + 'm';
    if (vwap) vwap.classList.toggle('active', _showVWAP);
    if (ruler) ruler.classList.toggle('active', _rulerEnabled);
    if (live) live.style.display = (_viewOffset > 0.01 || Math.abs(_zoom - 1) > 0.01 || _scaleY.manual) ? 'inline-flex' : 'none';
    if (full) full.classList.toggle('active', !!(document.fullscreenElement || document.webkitFullscreenElement));
  }

  function _ukMinute(timestamp) {
    var parts = _ukTimeFormatter.formatToParts(new Date(Number(timestamp) * 1000));
    return Number(parts.find(function(part) { return part.type === 'hour'; }).value) * 60 + Number(parts.find(function(part) { return part.type === 'minute'; }).value);
  }

  function _ukDate(timestamp) {
    return _ukDateFormatter.format(new Date(Number(timestamp) > 1e11 ? Number(timestamp) : Number(timestamp) * 1000));
  }

  function _ukTime(timestamp) {
    return new Date(Number(timestamp) * 1000).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function _niceStep(raw) {
    if (!(raw > 0)) return 1;
    var magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    var normalized = raw / magnitude;
    return (normalized <= 1.5 ? 1 : normalized <= 3 ? 2 : normalized <= 7 ? 5 : 10) * magnitude;
  }

  function destroy() {
    window.removeEventListener('resize', _resize);
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', _syncControls);
      document.removeEventListener('webkitfullscreenchange', _syncControls);
    }
    if (_canvas) {
      _canvas.removeEventListener('wheel', _onWheel);
      _canvas.removeEventListener('pointerdown', _onPointerDown);
      _canvas.removeEventListener('pointermove', _onPointerMove);
      _canvas.removeEventListener('pointerup', _onPointerUp);
      _canvas.removeEventListener('pointercancel', _onPointerUp);
      _canvas.removeEventListener('pointerleave', _onPointerLeave);
    }
    if (_resizeObserver) _resizeObserver.disconnect();
    _resizeObserver = null; _canvas = null; _ctx = null; _sessionCtrl = null; _managedRunner = null; _actions = {}; _cross = null; _drag = null; _lastGeo = null;
    _timeframe = 1; _showVWAP = false; _rulerEnabled = false; _ruler = null; _referenceCache = null; _displayHistoryCache = null; _dayHistoryCache = null; _zoom = 1; _viewOffset = 0; _scaleY = { min: 0, max: 1, manual: false };
  }

  return {
    init: init,
    render: render,
    setSessionController: setSessionController,
    setManagedRunner: setManagedRunner,
    setAutoRunner: setAutoRunner,
    setActions: setActions,
    cycleTimeframe: cycleTimeframe,
    toggleVWAP: toggleVWAP,
    toggleRuler: toggleRuler,
    resetLive: resetLive,
    toggleFullscreen: toggleFullscreen,
    _test: { isScalePrice: isScalePrice, isDisplayBar: isDisplayBar, visibleHistory: _visibleHistory, continuousTail: _continuousTail, orderCardTop: orderCardTop, aggregateBars: aggregateBars, priceToY: priceToY, yToPrice: yToPrice, referenceLevels: _referenceLevels },
    destroy: destroy
  };
})();
