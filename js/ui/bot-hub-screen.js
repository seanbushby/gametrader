'use strict';
window.BotLab = window.BotLab || {};

BotLab.UI = BotLab.UI || {};

BotLab.UI.HubScreen = (function() {
  function render() {
    const container = document.getElementById('botLabHub');
    if (!container) return;
    const activeTest = BotLab.Storage.getActiveTest();
    const history = BotLab.Storage.getHistory();
    let html = '';

    html += '<div class="blHubTop">';
    html += '<div style="text-align:center;margin-bottom:2px">';
    html += '<button onclick="show(\'menu\')" style="background:none;border:none;color:var(--faint);font-size:12px;cursor:pointer;padding:6px">&lsaquo; Back to levels</button>';
    html += '</div>';
    html += '<div class="logo"><span class="g">BOT</span><span class="t"> LAB</span></div>';
    html += '<div class="tagline">Test whether managing your bot improves or damages its performance.</div>';
    html += '</div>';

    html += '<div class="blHubGrid">';

    html += '<div class="hubCard">';
    html += '<h3>New Bot Test</h3>';
    html += '<div class="hubMeta"><div>Set up a new Bot-vs-Human management test with a reference bot or your own bot.</div></div>';
    html += '<div class="menurow" style="margin-top:12px;justify-content:flex-start">';
    html += '<button class="btn primary" onclick="BotLab.UI.SetupScreen.open()">New Bot Test</button>';
    html += '</div>';
    html += '</div>';

    if (activeTest) {
      const cfg = activeTest.configuration || {};
      const status = activeTest.status || 'configured';
      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
      const progress = activeTest.completedDays ? activeTest.completedDays.length : 0;
      const totalDays = (activeTest.selectedDays || []).length || cfg.days || 0;

      html += '<div class="hubCard blActiveCard">';
      html += '<h3>Active Test</h3>';
      html += '<div class="hubMeta">';
      html += '<div><b>Bot:</b> ' + (cfg.botName || 'Unknown') + ' ' + (cfg.botVersion || '') + '</div>';
      html += '<div><b>Instrument:</b> ' + (cfg.instrumentLabel || cfg.instrument || 'DE40') + '</div>';
      html += '<div><b>Days:</b> ' + progress + ' / ' + totalDays + '</div>';
      html += '<div><b>Session:</b> ' + (cfg.sessionWindow || '08:00-11:00') + '</div>';
      html += '<div><b>Status:</b> ' + statusLabel + '</div>';
      if (activeTest.completedDays && activeTest.completedDays.length > 0) {
        const lastDay = activeTest.completedDays[activeTest.completedDays.length - 1];
        const autoPL = (lastDay.autonomousMetrics || {}).netPL || 0;
        const managedPL = (lastDay.managedMetrics || {}).netPL || 0;
        html += '<div><b>Last Managed:</b> ' + (managedPL >= 0 ? '+' : '') + '$' + Math.abs(managedPL).toFixed(0) + '</div>';
        html += '<div><b>Last Bot-Alone:</b> ' + (autoPL >= 0 ? '+' : '') + '$' + Math.abs(autoPL).toFixed(0) + '</div>';
      }
      html += '</div>';
      html += '<div class="menurow" style="margin-top:12px;justify-content:flex-start">';
      html += '<button class="btn primary" onclick="BotLab.UI.ReplayScreen.resume()">Resume</button>';
      html += '<button class="btn" onclick="BotLab.UI.HubScreen.abortTest()">Abort</button>';
      html += '</div>';
      html += '</div>';
    }

    if (history.length > 0) {
      html += '<div class="hubCard blHistoryCard" style="grid-column:1/-1">';
      html += '<h3>Previous Tests</h3>';
      html += '<div class="hubList">';
      for (let i = history.length - 1; i >= 0; i--) {
        const t = history[i];
        const cfg = t.configuration || {};
        const autoPL = (t.comparisonMetrics || {}).autonomous ? t.comparisonMetrics.autonomous.netProfit : 0;
        const managedPL = (t.comparisonMetrics || {}).managed ? t.comparisonMetrics.managed.netProfit : 0;
        const impact = t.comparisonMetrics ? t.comparisonMetrics.managementImpact : 0;
        const impactClass = impact >= 0 ? 'good' : 'bad';
        const impactSign = impact >= 0 ? '+' : '';
        const days = (t.selectedDays || []).length || cfg.days || 0;

        html += '<div class="hubRow">';
        html += '<div><b>' + (cfg.botName || 'Bot') + '</b> · ' + (cfg.instrumentLabel || cfg.instrument || '') + ' · ' + days + ' days · ' + (cfg.sessionWindow || '') + '</div>';
        html += '<div style="display:flex;gap:14px;align-items:center">';
        html += '<span class="good">Managed: ' + (managedPL >= 0 ? '+' : '') + '$' + Math.abs(managedPL).toFixed(0) + '</span>';
        html += '<span class="bad">Bot: ' + (autoPL >= 0 ? '+' : '') + '$' + Math.abs(autoPL).toFixed(0) + '</span>';
        html += '<span class="' + impactClass + '">' + impactSign + '$' + Math.abs(impact).toFixed(0) + '</span>';
        html += '<button class="btn" onclick="BotLab.UI.ReportScreen.openFromHistory(\'' + t.testId + '\')">View</button>';
        html += '<button class="btn" onclick="BotLab.UI.SetupScreen.duplicate(\'' + t.testId + '\')">Duplicate</button>';
        html += '<button class="btn" onclick="BotLab.UI.HubScreen.deleteHistory(\'' + t.testId + '\')">Delete</button>';
        html += '</div>';
        html += '</div>';
      }
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  async function abortTest() {
    if (await siteConfirm('Abort the current bot test? Progress will be lost.', 'Bot Lab')) {
      BotLab.Storage.clearActiveTest();
      render();
    }
  }

  async function deleteHistory(testId) {
    if (await siteConfirm('Delete this completed test? This cannot be undone.', 'Bot Lab')) {
      BotLab.Storage.deleteHistoryItem(testId);
      render();
    }
  }

  return { render, abortTest, deleteHistory };
})();
