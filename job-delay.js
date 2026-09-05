(function (root) {
  'use strict';

  function normalizePauseSeconds(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return parsed;
  }

  function getPauseMs(value, fallbackMs) {
    const seconds = normalizePauseSeconds(value);
    return seconds > 0 ? seconds * 1000 : fallbackMs;
  }

  const api = { normalizePauseSeconds, getPauseMs };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.jobDelay = api;
  root.__sahJobDelay = api;

  // Firefox: the content-script sandbox global and the xrayed page window are
  // distinct. content.js reads the helpers off `window`, so publish there too.
  try {
    if (typeof window !== 'undefined' && window !== root) {
      window.jobDelay = api;
      window.__sahJobDelay = api;
    }
  } catch (e) {}
}(typeof globalThis !== 'undefined' ? globalThis : this));
