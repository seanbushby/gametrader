'use strict';
window.BotLab = window.BotLab || {};

BotLab.BotRegistry = (function() {
  const _bots = new Map();

  function register(botDef) {
    const bot = BotLab.Bot.create(botDef);
    _bots.set(bot.id, bot);
    return bot;
  }

  function get(botId) {
    return _bots.get(botId) || null;
  }

  function list() {
    return Array.from(_bots.values());
  }

  function has(botId) {
    return _bots.has(botId);
  }

  return { register, get, list, has };
})();
