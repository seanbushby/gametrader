'use strict';
window.BotLab = window.BotLab || {};

BotLab.UI = BotLab.UI || {};

BotLab.UI.SetupScreen = (function() {
  let _selectedBot = null;
  let _selectedDays = 1;
  let _sessionWindow = { start: '08:00', end: '11:00' };
  let _cruiseSpeed = 50;
  let _startBalance = 500;
  let _applyPropRules = false;
  let _includeBotAlone = true;
  let _blindRun = false;
  let _selectedInstrument = 'de40';
  let _dateFrom = '';
  let _dateTo = '';
  let _duplicateData = null;
  let _botSettings = {};
  let _loadState = { key: null, loading: false, loaded: false, error: '', eligible: 0 };
  let _loadToken = 0;
  let _loadedRange = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function ensureBots() {
    if (BotLab.ReferenceBot && !BotLab.BotRegistry.has('reference-simple-ma')) {
      BotLab.BotRegistry.register(BotLab.ReferenceBot.create());
    }
    if (BotLab.BokkeOnePack && !BotLab.BotRegistry.has('bokke-one-pack')) {
      BotLab.BotRegistry.register(BotLab.BokkeOnePack.create());
    }
  }

  function open(duplicateTestId) {
    _duplicateData = null;
    _botSettings = {};
    if (duplicateTestId) {
      const item = BotLab.Storage.getHistoryItem(duplicateTestId);
      if (item && item.configuration) {
        _duplicateData = item.configuration;
        _selectedBot = _duplicateData.botId;
        _selectedInstrument = _duplicateData.instrument || 'de40';
        _selectedDays = _duplicateData.dayCount || _duplicateData.days || 1;
        _dateFrom = _duplicateData.dateFrom || '';
        _dateTo = _duplicateData.dateTo || '';
        _botSettings = Object.assign({}, _duplicateData.botSettings || {});
        const windowParts = (_duplicateData.sessionWindow || '08:00-15:30').split('-');
        _sessionWindow = { start: windowParts[0], end: windowParts[1] || '11:00' };
        _cruiseSpeed = _duplicateData.cruiseSpeed || 50;
        _startBalance = Number(_duplicateData.startBalance) || 500;
        _applyPropRules = _duplicateData.propRules || false;
        _includeBotAlone = _duplicateData.includeBotAlone !== false;
        _blindRun = Boolean(_duplicateData.blindRun);
      }
    } else {
      _dateFrom = '';
      _dateTo = '';
      _includeBotAlone = true;
      _blindRun = false;
    }
    BotLab.UI.HubScreen.render();
    show('botLabSetup');
    renderSetup();
    loadSelectedInstrument(!_duplicateData);
  }

  function duplicate(testId) {
    open(testId);
  }

  function captureSettings() {
    const bot = BotLab.BotRegistry.get(_selectedBot);
    if (!bot || !bot.settingsSchema) return;
    for (const [key, def] of Object.entries(bot.settingsSchema)) {
      const el = document.getElementById('blSetting_' + key);
      if (!el) continue;
      _botSettings[key] = def.type === 'number' ? Number(el.value) :
        def.type === 'boolean' ? el.checked : el.value;
    }
  }

  function settingValue(key, def) {
    const bot = BotLab.BotRegistry.get(_selectedBot);
    if (bot && typeof bot.settingsForInstrument === 'function') {
      const defaults = bot.settingsForInstrument({}, _selectedInstrument);
      if (!Object.prototype.hasOwnProperty.call(_botSettings, key) && Object.prototype.hasOwnProperty.call(defaults, key)) return defaults[key];
    }
    return Object.prototype.hasOwnProperty.call(_botSettings, key) ? _botSettings[key] : def.default;
  }

  function applyInstrumentProfile(bot, instrument) {
    if (bot && typeof bot.settingsForInstrument === 'function') _botSettings = bot.settingsForInstrument({}, instrument);
  }

  function supportsInstrument(bot, instrumentKey) {
    return !bot || !Array.isArray(bot.instruments) || bot.instruments.indexOf(instrumentKey) >= 0;
  }

  function renderSetting(key, def) {
    const value = settingValue(key, def);
    let html = '<div class="blSettingRow"><label class="blSettingLabel">' + escapeHtml(def.label || key) + '</label>';
    if (def.type === 'number') {
      html += '<input type="number" class="blSettingInput" id="blSetting_' + escapeHtml(key) + '" value="' + escapeHtml(value) + '"';
      if (def.min != null) html += ' min="' + escapeHtml(def.min) + '"';
      if (def.max != null) html += ' max="' + escapeHtml(def.max) + '"';
      html += ' step="' + escapeHtml(def.step != null ? def.step : 'any') + '">';
    } else if (def.type === 'select') {
      html += '<select class="blSettingInput" id="blSetting_' + escapeHtml(key) + '">';
      const options = Array.isArray(def.options) ? def.options : Object.entries(def.options || {}).map(function(option) {
        return { value: option[0], label: option[1] };
      });
      for (const option of options) {
        const optionValue = option && typeof option === 'object' ? option.value : option;
        const optionLabel = option && typeof option === 'object' ? (option.label || option.value) : option;
        html += '<option value="' + escapeHtml(optionValue) + '"' + (String(optionValue) === String(value) ? ' selected' : '') + '>' + escapeHtml(optionLabel) + '</option>';
      }
      html += '</select>';
    } else if (def.type === 'boolean') {
      html += '<input type="checkbox" id="blSetting_' + escapeHtml(key) + '"' + (value ? ' checked' : '') + '>';
    } else {
      html += '<input type="text" class="blSettingInput" id="blSetting_' + escapeHtml(key) + '" value="' + escapeHtml(value) + '">';
    }
    return html + '</div>';
  }

  function renderSetup() {
    const container = document.getElementById('botLabSetup');
    if (!container) return;
    ensureBots();
    const bots = BotLab.BotRegistry.list();
    if (!_selectedBot && bots.length) _selectedBot = bots[0].id;
    const instruments = typeof INSTRUMENTS !== 'undefined' ? Object.values(INSTRUMENTS) : [];
    const availableDates = _loadState.key === _selectedInstrument ? BotLab.MarketData.getAvailableDates(_selectedInstrument) : [];
    const minDate = availableDates[0] || '';
    const maxDate = availableDates[availableDates.length - 1] || '';
    const requested = _selectedDays === 'all' ? 0 : Number(_selectedDays);
    const validSelection = _loadState.loaded && !_loadState.loading && !_loadState.error && _loadState.eligible > 0 && _startBalance > 0 &&
      (_selectedDays === 'all' || requested <= _loadState.eligible);

    let html = '<div class="blSetupWrap"><div class="blSetupHead">';
    html += '<button onclick="BotLab.UI.HubScreen.render();show(\'botLabHub\')" style="background:none;border:none;color:var(--faint);font-size:12px;cursor:pointer;padding:6px">&lsaquo; Back to Bot Lab</button>';
    html += '<div class="blSetupTitle">NEW BOT TEST</div><div class="blSetupSub">Configure your Bot-vs-Human management test.</div></div>';
    html += '<div class="blSetupGrid"><div class="blSetupCol"><div class="blSetupSection">';
    html += '<div class="blSectionHead">A. Bot Selection</div><div class="blBotList">';
    for (const bot of bots) {
      const selected = bot.id === _selectedBot ? ' blBotSelected' : '';
      const displayName = bot.name;
      html += '<button class="blBotCard' + selected + '" onclick="BotLab.UI.SetupScreen.selectBot(' + escapeHtml(JSON.stringify(bot.id)) + ')">';
      html += '<div class="blBotName">' + escapeHtml(displayName) + '</div><div class="blBotVer">v' + escapeHtml(bot.version) + '</div>';
      html += '<div class="blBotDesc">' + escapeHtml(bot.description) + '</div></button>';
    }
    html += '</div>';
    const selectedBot = BotLab.BotRegistry.get(_selectedBot);
    if (selectedBot && selectedBot.settingsSchema && Object.keys(selectedBot.settingsSchema).length) {
      html += '<div class="blSettingsGroup"><div class="blSettingsLabel">Bot Settings</div>';
      for (const [key, def] of Object.entries(selectedBot.settingsSchema)) html += renderSetting(key, def);
      html += '</div>';
    }
    html += '</div><div class="blSetupSection"><div class="blSectionHead">B. Instrument</div><div class="blInstrList">';
    for (const instrument of instruments) {
      const selected = instrument.key === _selectedInstrument ? ' blInstrSelected' : '';
      const supported = supportsInstrument(selectedBot, instrument.key);
      const labels = String(instrument.label || instrument.key).split(' · ');
      html += '<button class="blInstrBtn' + selected + '"' + (supported ? ' onclick="BotLab.UI.SetupScreen.selectInstrument(' + escapeHtml(JSON.stringify(instrument.key)) + ')"' : ' disabled title="This bot does not support this instrument"') + '>';
      html += '<div class="blInstrLabel">' + escapeHtml(labels[0]) + '</div><div class="blInstrSub">' + escapeHtml(labels.slice(1).join(' · ') || instrument.key) + '</div></button>';
    }
    html += '</div></div></div><div class="blSetupCol">';

    html += '<div class="blSetupSection"><div class="blSectionHead">C. Date Range &amp; Days</div>';
    html += '<div class="blDateRow"><div class="blTimeField"><label class="blSettingLabel">From</label><input type="date" class="blSettingInput blDateInput" value="' + escapeHtml(_dateFrom) + '" min="' + minDate + '" max="' + maxDate + '" onchange="BotLab.UI.SetupScreen.setDateRange(\'from\',this.value)"></div>';
    html += '<div class="blTimeField"><label class="blSettingLabel">To</label><input type="date" class="blSettingInput blDateInput" value="' + escapeHtml(_dateTo) + '" min="' + minDate + '" max="' + maxDate + '" onchange="BotLab.UI.SetupScreen.setDateRange(\'to\',this.value)"></div></div>';
    html += '<div class="blDaysRow">';
    for (const count of [1, 3, 5, 10, 20, 'all']) {
      const selected = _selectedDays === count ? ' blDaySelected' : '';
      const label = count === 'all' ? 'All' : count + ' day' + (count === 1 ? '' : 's');
      html += '<button class="blDayBtn' + selected + '" onclick="BotLab.UI.SetupScreen.selectDays(' + (count === 'all' ? "'all'" : count) + ')">' + label + '</button>';
    }
    html += '</div></div>';

    html += '<div class="blSetupSection"><div class="blSectionHead">D. UK Playback Window</div><div class="blTimeRow">';
    html += '<div class="blTimeField"><label class="blSettingLabel">Start</label><input type="time" id="blStartTime" class="blSettingInput" value="' + escapeHtml(_sessionWindow.start) + '" onchange="BotLab.UI.SetupScreen.updateTimeWindow()"></div>';
    html += '<div class="blTimeSep">to</div><div class="blTimeField"><label class="blSettingLabel">End</label><input type="time" id="blEndTime" class="blSettingInput" value="' + escapeHtml(_sessionWindow.end) + '" onchange="BotLab.UI.SetupScreen.updateTimeWindow()"></div></div>';
    html += '<div class="blTimezone">Europe/London time, including UK daylight-saving changes.</div></div>';

    html += '<div class="blSetupSection"><div class="blSectionHead">E. Replay Speed</div><div class="blSpeedRow">';
    for (const speed of [10, 25, 50, 100]) {
      html += '<button class="blSpeedBtn' + (_cruiseSpeed === speed ? ' blSpeedSelected' : '') + '" onclick="BotLab.UI.SetupScreen.selectSpeed(' + speed + ')">' + speed + '\u00d7</button>';
    }
    html += '</div></div>';
    html += '<div class="blSetupSection"><div class="blSectionHead">F. Market Data</div><div class="blDataStatus ' + (_loadState.error ? 'isError' : (_loadState.loaded ? 'isReady' : '')) + '">';
    const dataSource = BotLab.MarketData.getSource(_selectedInstrument);
    const sourceLabel = dataSource === 'sqlite' ? 'SQLite history' : (dataSource === 'csv' ? 'CSV fallback' : '');
    const coverageLabel = minDate && maxDate ? 'Available coverage: ' + minDate + ' to ' + maxDate + '.' : '';
    if (_loadState.loading) html += 'Loading ' + escapeHtml(_selectedInstrument.toUpperCase()) + ' market data...';
    else if (_loadState.error) html += escapeHtml(_loadState.error);
    else if (_loadState.loaded) html += _loadState.eligible + ' eligible day' + (_loadState.eligible === 1 ? '' : 's') + ' in this date range and playback window.';
    else html += 'Select an instrument to load its market data.';
    if (sourceLabel || coverageLabel) html += '<div>' + escapeHtml(sourceLabel + (sourceLabel && coverageLabel ? ' · ' : '') + coverageLabel) + '</div>';
    if (_loadState.loaded && requested > _loadState.eligible) html += '<div>Select fewer days or widen the range.</div>';
    html += '</div></div>';

    html += '<div class="blSetupSection"><div class="blSectionHead">G. Starting Balance &amp; Conditions</div>';
    html += '<div class="blBalanceRow"><button class="blDayBtn' + (_startBalance === 200 ? ' blDaySelected' : '') + '" onclick="BotLab.UI.SetupScreen.setStartBalance(200)">$200</button>';
    html += '<button class="blDayBtn' + (_startBalance === 500 ? ' blDaySelected' : '') + '" onclick="BotLab.UI.SetupScreen.setStartBalance(500)">$500</button>';
    html += '<label class="blBalanceCustom">Custom $<input type="number" class="blSettingInput" min="15" step="1" value="' + escapeHtml(_startBalance) + '" onchange="BotLab.UI.SetupScreen.setStartBalance(this.value)"></label></div>';
    const brokerMargin = instrumentMarginSummary(typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS[_selectedInstrument] : null);
    html += '<div class="blConditionsList"><div class="blCondition"><span class="blCondKey">Starting balance:</span> $' + escapeHtml(_startBalance.toFixed(0)) + '</div><div class="blCondition"><span class="blCondKey">Costs:</span> Per instrument</div>';
    if (brokerMargin) html += '<div class="blCondition"><span class="blCondKey">Broker margin:</span> ' + escapeHtml(brokerMargin) + '</div>';
    html += '<div class="blCondition">Both branches use identical settings, market data, and random seed.</div></div></div>';
    html += '<div class="blSetupSection"><div class="blSectionHead">H. Run Options</div>';
    html += '<label class="blSettingRow"><input type="checkbox"' + (_includeBotAlone ? ' checked' : '') + ' onchange="BotLab.UI.SetupScreen.setIncludeBotAlone(this.checked)"> Include Bot Alone comparison</label>';
    html += '<label class="blSettingRow"><input type="checkbox"' + (_blindRun ? ' checked' : '') + ' onchange="BotLab.UI.SetupScreen.setBlindRun(this.checked)"> Blind run - skip replay and show only the final report</label></div>';
    html += '<div class="blSetupActions"><button class="btn primary blStartBtn" onclick="BotLab.UI.SetupScreen.startTest()"' + (validSelection ? '' : ' disabled') + '>Start Bot Test</button></div>';
    html += '</div></div></div>';
    container.innerHTML = html;
  }

  function timeToMinutes(value) {
    const parts = String(value || '').split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function instrumentMarginSummary(instrument) {
    if (!instrument || !(Number(instrument.marginRate) > 0)) return '';
    const effectiveLeverage = Math.round(1 / Number(instrument.marginRate));
    return (Number(instrument.marginRate) * 100).toFixed(2) + '% of notional (about 1:' + effectiveLeverage + ' effective leverage)';
  }

  function refreshEligibility() {
    if (!_loadState.loaded || _loadState.key !== _selectedInstrument) return;
    try {
      _loadState.eligible = BotLab.MarketData.buildDays({
        instrument: _selectedInstrument, dateFrom: _dateFrom, dateTo: _dateTo,
        sessionStartMin: timeToMinutes(_sessionWindow.start), sessionEndMin: timeToMinutes(_sessionWindow.end),
        count: 'all', seed: 0
      }).length;
      _loadState.error = '';
    } catch (error) {
      _loadState.eligible = 0;
      _loadState.error = error.message;
    }
  }

  async function loadSelectedInstrument(resetDates) {
    const key = _selectedInstrument;
    const token = ++_loadToken;
    _loadState = { key: key, loading: true, loaded: false, error: '', eligible: 0 };
    renderSetup();
    try {
      await BotLab.MarketData.loadInstrument(key);
      if (token !== _loadToken) return;
      const dates = BotLab.MarketData.getAvailableDates(key);
      if (!dates.length) throw new Error('No market dates are available for this instrument.');
      if (resetDates || !_dateFrom) _dateFrom = dates[Math.max(0, dates.length - 20)];
      if (resetDates || !_dateTo) _dateTo = dates[dates.length - 1];
      await BotLab.MarketData.loadRange(key, _dateFrom, _dateTo);
      if (token !== _loadToken) return;
      _loadedRange = { key: key, from: _dateFrom, to: _dateTo };
      _loadState = { key: key, loading: false, loaded: true, error: '', eligible: 0 };
      refreshEligibility();
    } catch (error) {
      if (token !== _loadToken) return;
      _loadState = { key: key, loading: false, loaded: false, error: error.message || 'Could not load market data.', eligible: 0 };
    }
    renderSetup();
  }

  async function loadSelectedRange() {
    const key = _selectedInstrument;
    const from = _dateFrom;
    const to = _dateTo;
    const token = ++_loadToken;
    _loadState = { key: key, loading: true, loaded: false, error: '', eligible: 0 };
    renderSetup();
    try {
      await BotLab.MarketData.loadRange(key, from, to);
      if (token !== _loadToken) return false;
      _loadedRange = { key: key, from: from, to: to };
      _loadState = { key: key, loading: false, loaded: true, error: '', eligible: 0 };
      refreshEligibility();
    } catch (error) {
      if (token !== _loadToken) return false;
      _loadedRange = null;
      _loadState = { key: key, loading: false, loaded: false, error: error.message || 'Could not load market data.', eligible: 0 };
    }
    renderSetup();
    return _loadState.loaded;
  }

  function selectBot(botId) {
    captureSettings();
    _selectedBot = botId;
    const bot = BotLab.BotRegistry.get(botId);
    applyInstrumentProfile(bot, _selectedInstrument);
    if (!supportsInstrument(bot, _selectedInstrument)) {
      _selectedInstrument = bot.instruments[0];
      applyInstrumentProfile(bot, _selectedInstrument);
      _dateFrom = '';
      _dateTo = '';
      loadSelectedInstrument(true);
      return;
    }
    renderSetup();
  }

  function selectInstrument(key) {
    if (key === _selectedInstrument) return;
    if (!supportsInstrument(BotLab.BotRegistry.get(_selectedBot), key)) return;
    captureSettings();
    _selectedInstrument = key;
    applyInstrumentProfile(BotLab.BotRegistry.get(_selectedBot), key);
    _dateFrom = '';
    _dateTo = '';
    loadSelectedInstrument(true);
  }

  function selectDays(days) {
    captureSettings();
    _selectedDays = days;
    renderSetup();
  }

  function setDateRange(which, value) {
    captureSettings();
    if (which === 'from') {
      _dateFrom = value;
      if (!_dateTo || _dateTo < _dateFrom) _dateTo = _dateFrom;
    } else {
      _dateTo = value;
      if (!_dateFrom || _dateFrom > _dateTo) _dateFrom = _dateTo;
    }
    loadSelectedRange();
  }

  function selectSpeed(speed) {
    captureSettings();
    _cruiseSpeed = speed;
    renderSetup();
  }

  function setIncludeBotAlone(value) { _includeBotAlone = Boolean(value); renderSetup(); }
  function setBlindRun(value) { _blindRun = Boolean(value); renderSetup(); }

  function setStartBalance(value) {
    captureSettings();
    const balance = Number(value);
    if (Number.isFinite(balance) && balance > 0) _startBalance = balance;
    renderSetup();
  }

  function updateTimeWindow() {
    captureSettings();
    const startEl = document.getElementById('blStartTime');
    const endEl = document.getElementById('blEndTime');
    if (startEl) _sessionWindow.start = startEl.value;
    if (endEl) _sessionWindow.end = endEl.value;
    refreshEligibility();
    renderSetup();
  }

  async function startTest() {
    captureSettings();
    const rangeReady = _loadedRange && _loadedRange.key === _selectedInstrument &&
      _loadedRange.from === _dateFrom && _loadedRange.to === _dateTo && _loadState.loaded && !_loadState.loading;
    if (!rangeReady && !await loadSelectedRange()) {
      return;
    }
    refreshEligibility();
    const bot = BotLab.BotRegistry.get(_selectedBot);
    if (!bot) { alert('Please select a bot.'); return; }
    if (_loadState.error || !_loadState.eligible) { renderSetup(); return; }
    if (_selectedDays !== 'all' && Number(_selectedDays) > _loadState.eligible) { renderSetup(); return; }

    const instrument = typeof INSTRUMENTS !== 'undefined' ? INSTRUMENTS[_selectedInstrument] : null;
    const seed = Date.now();
    let selectedDays;
    try {
      selectedDays = BotLab.MarketData.buildDays({
        instrument: _selectedInstrument, dateFrom: _dateFrom, dateTo: _dateTo,
        sessionStartMin: timeToMinutes(_sessionWindow.start), sessionEndMin: timeToMinutes(_sessionWindow.end),
        count: _selectedDays, seed: seed
      });
    } catch (error) {
      _loadState.error = error.message;
      renderSetup();
      return;
    }

    const botSettings = typeof bot.settingsForInstrument === 'function'
      ? bot.settingsForInstrument(_botSettings, _selectedInstrument) : Object.assign({}, _botSettings);
    const sizingMode = bot.id === 'bokke-one-pack' && botSettings.sizing_mode === 'live' ? 'live' : 'demo';
    const botMaxLots = bot.id === 'bokke-one-pack' ? Number(botSettings.max_lot_cap) : (instrument ? instrument.maxSize : 50);
    const executionMinSize = bot.id === 'bokke-one-pack' && sizingMode === 'live' ? 0.1 : (instrument ? instrument.minSize : 1);
    const executionStep = bot.id === 'bokke-one-pack' && sizingMode === 'live' ? 0.1 : (instrument ? instrument.sizeStep : 1);
    const executionDecimals = bot.id === 'bokke-one-pack' && sizingMode === 'live' ? 1 : (instrument ? instrument.sizeDecimals : 0);
    const testConfig = BotLab.Storage.createTestConfig({
      botId: bot.id, botName: bot.name,
      botVersion: bot.version, botSettings: botSettings,
      instrument: _selectedInstrument, instrumentLabel: instrument ? instrument.label : _selectedInstrument,
      sessionWindow: _sessionWindow.start + '-' + _sessionWindow.end,
      sessionStartMin: timeToMinutes(_sessionWindow.start), sessionEndMin: timeToMinutes(_sessionWindow.end),
      days: selectedDays.length, selectedDayKeys: selectedDays.map(function(day) { return day.key; }),
      randomSeed: seed, startBalance: _startBalance, spread: instrument ? instrument.spread : 0,
      commission: instrument ? instrument.roundTurnCommission : 0, ptValue: instrument ? instrument.ptValue : 1,
      contractSize: instrument ? instrument.contractSize : 1, quoteToAccountRate: instrument ? instrument.quoteToAccountRate : 1,
      marginRate: instrument ? instrument.marginRate : 0,
      minSize: executionMinSize, sizeStep: executionStep,
      sizeDecimals: executionDecimals, decimals: instrument ? instrument.decimals : 1,
      currency: instrument ? instrument.currency : '$', maxSize: botMaxLots,
      cruiseSpeed: _cruiseSpeed, propRules: _applyPropRules,
      includeBotAlone: _includeBotAlone, blindRun: _blindRun
    });
    testConfig.configuration.dateFrom = _dateFrom;
    testConfig.configuration.dateTo = _dateTo;
    testConfig.configuration.dayCount = _selectedDays;
    testConfig.configuration.dataSource = BotLab.MarketData.getSource(_selectedInstrument);
    testConfig.selectedDays = selectedDays.map(function(day) {
      return { key: day.key, day: day.day, date: day.date, bars: day.bars, warmupBars: day.warmupBars, chartHistory: day.chartHistory };
    });
    testConfig.status = 'running';
    if (!BotLab.Storage.saveActiveTest(testConfig)) {
      alert('The test could not be saved. Reduce the date range or clear older browser storage and try again.');
      return;
    }
    BotLab.UI.ReplayScreen.start(testConfig);
  }

  return {
    open: open, duplicate: duplicate, renderSetup: renderSetup, selectBot: selectBot,
    selectInstrument: selectInstrument, selectDays: selectDays, setDateRange: setDateRange,
    selectSpeed: selectSpeed, setIncludeBotAlone: setIncludeBotAlone, setBlindRun: setBlindRun,
    setStartBalance: setStartBalance, updateTimeWindow: updateTimeWindow, startTest: startTest
  };
})();
