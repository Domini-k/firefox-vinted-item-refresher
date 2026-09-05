'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CONTENT_JS = path.join(__dirname, '..', 'content.js');
const CONTENT_MAIN_JS = path.join(__dirname, '..', 'content-main.js');

// List of internals exposed on window.__sahInternals after content.js loads.
const INTERNALS = [
  'getFeedItems', 'getItemData', 'isSkippableItem', 'resolveItemElement',
  'clickExistingOrNewOption', 'waitForMatchingOption', 'scrapeColorsFromDropdown',
  'clickOptionEl', 'getOptionTitle', 'isVisible', 'waitRemainingPause',
  'editDescription'
];

/**
 * Creates a jsdom window that simulates the extension's content-script
 * environment, loads content.js (with an export hook) and returns helpers.
 *
 * @param {string} html      Page HTML to load.
 * @param {string} url       Page URL.
 * @param {Object} [opts]
 * @param {Object} [opts.storage]        Initial localStorage/sessionStorage data.
 * @param {number} [opts.pauseSeconds]   Value chrome.storage returns for the pause key.
 * @param {boolean} [opts.visible]       Patch getBoundingClientRect so isVisible() works.
 */
function createPage(html, url, opts) {
  const o = opts || {};
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: url,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.scrollBy = () => {};
      window.open = () => ({ closed: false });
      window.BroadcastChannel = class {
        constructor() { this.onmessage = null; }
        postMessage() {}
        close() {}
      };
      window.document.execCommand = () => false;
      window.chrome = {
        runtime: { sendMessage: (m, cb) => { if (cb) cb({ success: true, b64: '' }); } },
        storage: {
          local: {
            get: (key, cb) => {
              const out = {};
              if (o.pauseSeconds != null) out['sah-job-pause-seconds'] = String(o.pauseSeconds);
              cb(out);
            },
            set: (obj, cb) => { if (cb) cb(); }
          }
        }
      };
      if (o.visible !== false) {
        window.HTMLElement.prototype.getBoundingClientRect = function () {
          return { width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 };
        };
      }
    }
  });

  const window = dom.window;
  const document = window.document;
  const storageData = Object.assign({}, o.storage);

  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k) => (k in storageData ? storageData[k] : null),
      setItem: (k, v) => { storageData[k] = String(v); },
      removeItem: (k) => { delete storageData[k]; }
    }
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: {
      getItem: (k) => (k in storageData ? storageData[k] : null),
      setItem: (k, v) => { storageData[k] = String(v); },
      removeItem: (k) => { delete storageData[k]; }
    }
  });

  // Simulate the MAIN-world bridge (content-main.js) so pageClick/pageType work.
  window.eval(fs.readFileSync(CONTENT_MAIN_JS, 'utf8'));

  // Load content.js with an export hook appended before the IIFE close.
  let code = fs.readFileSync(CONTENT_JS, 'utf8');
  const exportBlock = '\n  window.__sahInternals = { ' +
    INTERNALS.map((n) => n + ': ' + n).join(', ') + ' };\n})();';
  code = code.replace(/\}\)\(\);\s*$/, exportBlock);
  window.eval(code);

  return {
    window,
    document,
    storageData,
    q: (sel) => document.querySelector(sel),
    qa: (sel) => Array.from(document.querySelectorAll(sel)),
    internals: window.__sahInternals,
    wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); },
    click(sel) { const el = document.querySelector(sel); if (el) el.click(); return el; },
    close() { window.close(); }
  };
}

// Returns a path inside learning-sources or null when the fixture is missing.
function fixture(rel) {
  const p = path.join(__dirname, '..', 'learning-sources', rel);
  return fs.existsSync(p) ? p : null;
}

module.exports = { createPage, fixture };
