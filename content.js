(function () {
  'use strict';

  // ── Selectors ────────────────────────────────────────────────────────────
  // Vinted hashes component class names (e.g. ...__new-item-box__overlay), so
  // these rely on stable data-testid patterns first, with class fallbacks.
  const SEL_GRID      = '.feed-grid, [data-testid="feed-grid"], [data-testid="feed-grid-content"], [class$="__feed-grid"]';
  const SEL_GRID_ITEM = '[data-testid="grid-item"], [data-testid="feed-grid-item"]';
  const SEL_CARD_ITEM = '[data-testid^="product-item-id-"], .new-item-box__container';
  const SEL_CARD      = '[data-testid^="product-item-id-"]';
  const SEL_LINK      = 'a[data-testid$="--overlay-link"], a.new-item-box__overlay--clickable, a[href*="/items/"]';
  const SEL_THUMB     = 'img[data-testid$="--image--img"]';
  const SEL_PRICE     = 'p[data-testid$="--price-text"]';

  // ── URL patterns ─────────────────────────────────────────────────────────
  const RE_EDIT_PAGE = /\/items\/(\d+)(?:-[^/]*)?\/edit/;
  const RE_NEW_PAGE  = /\/items\/new($|[?#])/;
  const RE_MEMBER_PAGE = /^\/member\/\d+(?:\/|$)/;

  // ── Job storage keys ─────────────────────────────────────────────────────
  const SAH_JOB_KEY    = 'sah-edit-job';
  const SAH_RELIST_KEY = 'sah-relist-job';
  const SAH_LOG_KEY    = 'sah-relist-log';
  const SAH_RECORD_KEY = 'sah-record-clicks';
  const SAH_PAUSE_KEY  = 'sah-job-pause-seconds';

  // ── Timing constants ─────────────────────────────────────────────────────
  // Grace period given to Vinted's save request to finish before the job
  // navigates to the next item. Navigating instantly would abort the save and
  // hit Vinted's beforeunload guard while the form is still dirty.
  const SAVE_GRACE_MS   = 4000;
  const DRAFT_GRACE_MS  = 4000;

  // ── State ────────────────────────────────────────────────────────────────
  let mode     = null;
  let selected = new Set();

  // ── Leave-page prompt suppression ────────────────────────────────────────
  // Vinted registers a beforeunload handler once its form is dirty, which makes
  // the browser ask for confirmation on every job navigation. A capture-phase
  // listener that stops immediate propagation runs before Vinted's bubble-phase
  // handler and prevents the prompt entirely.
  let _leavePromptSilencer = null;
  function silenceLeavePrompt() {
    if (_leavePromptSilencer) return;
    _leavePromptSilencer = function (e) { e.stopImmediatePropagation(); };
    window.addEventListener('beforeunload', _leavePromptSilencer, true);
  }
  function unsilenceLeavePrompt() {
    if (!_leavePromptSilencer) return;
    window.removeEventListener('beforeunload', _leavePromptSilencer, true);
    _leavePromptSilencer = null;
  }

  // ── Shared helpers ───────────────────────────────────────────────────────
  function getFeedGrid() {
    return document.querySelector(SEL_GRID) || document.body;
  }

  function getFeedItems() {
    const grid = getFeedGrid();
    if (!grid || !grid.querySelectorAll) return [];

    const seen = new Set();
    const items = [];
    const candidates = Array.from(grid.querySelectorAll(SEL_GRID_ITEM + ', ' + SEL_CARD_ITEM));

    candidates.forEach(function (node) {
      if (!node) return;

      let item = node;
      if (node.matches && node.matches(SEL_CARD_ITEM) && !node.matches(SEL_GRID_ITEM)) {
        const parent = node.closest ? node.closest(SEL_GRID_ITEM) : null;
        if (parent) item = parent;
      }

      if (!item || seen.has(item)) return;

      const link = item.matches && item.matches(SEL_LINK) ? item : (item.querySelector ? item.querySelector(SEL_LINK) : null);
      const href = link ? link.getAttribute('href') || '' : '';
      if (!href || !href.includes('/items/')) return;

      seen.add(item);
      items.push(item);
    });

    return items;
  }

  function resolveItemElement(el) {
    if (!el) return null;
    if (el.matches && el.matches(SEL_GRID_ITEM)) return el;
    if (el.matches && el.matches(SEL_CARD_ITEM)) {
      const parent = el.closest ? el.closest(SEL_GRID_ITEM) : null;
      return parent || el;
    }
    return el.closest ? el.closest(SEL_GRID_ITEM) || (el.closest(SEL_CARD_ITEM) || null) : null;
  }

  function timestamp() {
    const now = new Date();
    return now.getHours().toString().padStart(2, '0') + ':' +
           now.getMinutes().toString().padStart(2, '0') + ':' +
           now.getSeconds().toString().padStart(2, '0');
  }

  function parseLocalStorage(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function getJobPauseSeconds(cb) {
    const helper = window.__sahJobDelay || window.jobDelay || null;
    const normalizePause = helper && helper.normalizePauseSeconds ? helper.normalizePauseSeconds : function (value) {
      const parsed = parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 0) return 0;
      return parsed;
    };

    try {
      if (chrome && chrome.storage && chrome.storage.local && chrome.storage.local.get) {
        chrome.storage.local.get(SAH_PAUSE_KEY, function (items) {
          const raw = items && Object.prototype.hasOwnProperty.call(items, SAH_PAUSE_KEY) ? items[SAH_PAUSE_KEY] : null;
          const fallback = localStorage.getItem(SAH_PAUSE_KEY);
          const value = raw == null ? fallback : raw;
          cb(normalizePause(value));
        });
        return;
      }
    } catch (e) {}

    cb(normalizePause(localStorage.getItem(SAH_PAUSE_KEY)));
  }

  // Enforces the configured pause between jobs at the START of each job item.
  // The completion time is persisted in the job and the remaining time is waited
  // here regardless of how we arrived on this page (survives tab reloads and
  // save-triggered navigations that would kill a plain setTimeout).
  function waitRemainingPause(job, fallbackMs, cb) {
    getJobPauseSeconds(function (seconds) {
      const pauseMs = seconds > 0 ? seconds * 1000 : (fallbackMs || 0);
      if (!pauseMs || !job || !job.lastDoneAt) { cb(); return; }
      const remaining = pauseMs - (Date.now() - job.lastDoneAt);
      if (remaining <= 0) { cb(); return; }
      const title = job.title || (job.queue && job.queue[0] && job.queue[0].title) || '';
      const secs = Math.ceil(remaining / 1000);
      editPageStatus('Pause ' + secs + 's — then: ' + title);
      sahBroadcast({ type: 'log', msg: 'Pausing ' + secs + 's before next job...' });
      setTimeout(cb, remaining);
    });
  }

  function normalizePhotoUrl(url) {
    return typeof url === 'string' ? url.trim() : '';
  }

  function getPhotoQualityScore(url) {
    const value = normalizePhotoUrl(url);
    if (!value) return 0;

    const hasTc = value.includes('/tc/');
    const hasF800 = value.includes('/f800/');
    const hasF600 = value.includes('/f600/');
    const hasF400 = value.includes('/f400/');
    const hasF200 = value.includes('/f200/');

    let score = 0;
    if (hasTc) score += 100;
    if (hasF800) score += 80;
    else if (hasF600) score += 60;
    else if (hasF400) score += 40;
    else if (hasF200) score += 20;

    if (value.includes('/f800/')) score += 20;
    if (value.includes('/tc/')) score += 10;
    return score;
  }

  function selectBestPhotoUrl(urls) {
    const values = (urls || [])
      .map(normalizePhotoUrl)
      .filter(function (u) { return u && (u.includes('images1.vinted.net') || u.includes('images2.vinted.net')); })
      .filter(Boolean);

    if (!values.length) return '';

    return values.reduce(function (best, current) {
      if (!best) return current;
      if (getPhotoQualityScore(current) > getPhotoQualityScore(best)) return current;
      return best;
    }, '');
  }

  function collectPhotoUrlsFromItem(item) {
    const photos = [];
    const seen = new Set();

    try {
      const rawPhotos = item && item.photos;
      if (!Array.isArray(rawPhotos)) return photos;

      rawPhotos.forEach(function (photo) {
        if (!photo || photo.is_user_photo) return;

        const candidates = [];
        if (photo.full_size_url) candidates.push(photo.full_size_url);
        if (photo.url) candidates.push(photo.url);
        if (Array.isArray(photo.thumbnails)) {
          photo.thumbnails.forEach(function (thumb) {
            if (thumb && thumb.url) candidates.push(thumb.url);
          });
        }

        const best = selectBestPhotoUrl(candidates);
        if (best && !seen.has(best)) {
          seen.add(best);
          photos.push(best);
        }
      });
    } catch (e) {
      return [];
    }

    return photos;
  }

  function getTestIdVal(testid) {
    const el = document.querySelector('[data-testid="' + testid + '"]');
    return el ? (el.value || el.getAttribute('value') || '') : '';
  }

  function getMountRoot() {
    return document.body || document.documentElement;
  }

  // ── On-screen log box ────────────────────────────────────────────────────
  function createLogBox() {
    if (document.getElementById('sah-log')) return;
    const box = document.createElement('div');
    box.className = 'sah-log';
    box.id = 'sah-log';
    box.innerHTML =
      '<div class="sah-log-header">' +
        '<span class="sah-log-title">Log</span>' +
        '<button class="sah-log-clear" id="sah-log-clear">Clear</button>' +
      '</div>' +
      '<div class="sah-log-entries" id="sah-log-entries"></div>';
    getMountRoot().appendChild(box);
    document.getElementById('sah-log-clear').addEventListener('click', function (e) {
      e.stopPropagation();
      const entries = document.getElementById('sah-log-entries');
      if (entries) entries.innerHTML = '';
    });
  }

  function toggleLogBox() {
    const box = document.getElementById('sah-log');
    if (!box) return;
    const visible = box.classList.toggle('sah-log--visible');
    const btn = document.getElementById('sah-tb-log');
    if (btn) btn.classList.toggle('sah-toolbar-btn--active', visible);
  }

  function showLogBox() {
    const box = document.getElementById('sah-log');
    if (!box || box.classList.contains('sah-log--visible')) return;
    box.classList.add('sah-log--visible');
    const btn = document.getElementById('sah-tb-log');
    if (btn) btn.classList.add('sah-toolbar-btn--active');
  }

  function sahLog(msg) {
    const entries = document.getElementById('sah-log-entries');
    if (!entries) return;
    const line = document.createElement('div');
    line.className = 'sah-log-entry';
    line.textContent = '[' + timestamp() + '] ' + msg;
    entries.appendChild(line);
    entries.scrollTop = entries.scrollHeight;
  }

  // ── Cross-tab relist log (localStorage-backed) ──────────────────────────
  function relistLog(msg) {
    editPageStatus(msg);
    sahBroadcast({ type: 'log', msg: msg });
    try {
      var arr = JSON.parse(localStorage.getItem(SAH_LOG_KEY) || '[]');
      arr.push('[' + timestamp() + '] ' + msg);
      if (arr.length > 300) arr = arr.slice(-300);
      localStorage.setItem(SAH_LOG_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  function listenRelistLog() {
    var _cursor = 0;
    try { _cursor = JSON.parse(localStorage.getItem(SAH_LOG_KEY) || '[]').length; } catch (e) {}
    window.addEventListener('storage', function onRelistLog(e) {
      if (e.key !== SAH_LOG_KEY) return;
      try {
        var arr = JSON.parse(e.newValue || '[]');
        arr.slice(_cursor).forEach(function (line) {
          var entries = document.getElementById('sah-log-entries');
          if (!entries) return;
          var div = document.createElement('div');
          div.className = 'sah-log-entry';
          div.textContent = line;
          entries.appendChild(div);
          entries.scrollTop = entries.scrollHeight;
          showLogBox();
        });
        _cursor = arr.length;
      } catch (err) {}
    });
  }

  // ── Description edit logic ───────────────────────────────────────────────
  function editDescription(desc) {
    var USPACES = [' ', ' ', ' ', ' ', ' ', ' '];

    // Strip any previously inserted unicode spaces to get clean base.
    var clean = desc.replace(/[      ]/g, ' ');
    var trimmed = clean.trimEnd();

    var withSuffix;
    if (trimmed.endsWith('Polecam!')) {
      withSuffix = clean;
    } else if ((clean + ' Polecam!').length <= 2000) {
      withSuffix = clean.trimEnd() + ' Polecam!';
    } else {
      withSuffix = clean;
    }

    // Replace one randomly chosen space with a random unicode lookalike space.
    var positions = [];
    for (var i = 0; i < withSuffix.length; i++) {
      if (withSuffix[i] === ' ') positions.push(i);
    }
    if (!positions.length) return withSuffix;
    var pos = positions[Math.floor(Math.random() * positions.length)];
    var usp = USPACES[Math.floor(Math.random() * USPACES.length)];
    return withSuffix.slice(0, pos) + usp + withSuffix.slice(pos + 1);
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────
  function waitForElement(selector, timeoutMs, cb) {
    const el = document.querySelector(selector);
    if (el) { cb(el); return; }
    let fired = false;
    const obs = new MutationObserver(function () {
      if (fired) return;
      const found = document.querySelector(selector);
      if (found) { fired = true; obs.disconnect(); cb(found); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () {
      if (fired) return;
      fired = true;
      obs.disconnect();
      cb(document.querySelector(selector) || null);
    }, timeoutMs);
  }

  // Sets a React-controlled textarea value via execCommand (fires synthetic events).
  function setReactTextarea(el, value) {
    el.focus();
    el.select();
    const ok = document.execCommand('insertText', false, value);
    if (!ok) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new InputEvent('input',  { bubbles: true, cancelable: true }));
      el.dispatchEvent(new InputEvent('change', { bubbles: true, cancelable: true }));
    }
  }

  function setReactInput(el, value) {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new InputEvent('input',  { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change',      { bubbles: true, cancelable: true }));
  }

  // Status overlay shown on edit/new-item tabs.
  function editPageStatus(msg) {
    let el = document.getElementById('sah-edit-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'sah-edit-status';
      el.style.cssText = [
        'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
        'background:#09B1BA', 'color:#fff', 'padding:10px 14px',
        'border-radius:8px', 'font:700 13px/1.4 sans-serif',
        'box-shadow:0 4px 16px rgba(0,0,0,.28)', 'max-width:340px',
        'word-break:break-word'
      ].join(';');
      getMountRoot().appendChild(el);
    }
    el.textContent = 'VR: ' + msg;
  }

  function setSelectionFeedback(msg) {
    sahLog(msg);
    editPageStatus(msg);
  }

  // ── BroadcastChannel (live log updates member tab from edit tab) ──────────
  let _sahChannel = null;
  function getSahChannel() {
    if (!_sahChannel) _sahChannel = new BroadcastChannel('sah-vr');
    return _sahChannel;
  }
  function sahBroadcast(data) {
    try { getSahChannel().postMessage(data); } catch (e) {}
  }
  function listenSahChannel() {
    getSahChannel().onmessage = function (e) {
      const d = e.data;
      if (d.type === 'log')  { sahLog(d.msg); }
      if (d.type === 'done') {
        sahLog('Edit Description complete — ' + d.done.length + ' item(s).');
        d.done.forEach(function (it) {
          sahLog((it.result === 'ok' ? '[OK] ' : '[ERR] ') + it.title);
        });
      }
    };
  }

  // ── Edit-description job engine ──────────────────────────────────────────
  function startEditDescriptionJob(items) {
    if (!items.length) { sahLog('No items selected.'); return; }
    const job = {
      queue:     items.map(function (it) { return { id: it.id, url: it.url, title: it.title }; }),
      done:      [],
      returnUrl: location.href
    };
    localStorage.setItem(SAH_JOB_KEY, JSON.stringify(job));
    listenSahChannel();
    sahLog('Edit Description: ' + items.length + ' item(s) queued — opening edit tab...');
    const tab = window.open('https://www.vinted.pl/items/' + job.queue[0].id + '/edit', '_blank');
    if (!tab) {
      sahLog('[ERR] Popup blocked — allow popups for vinted.pl and retry.');
      localStorage.removeItem(SAH_JOB_KEY);
    }
  }

  function runEditJobOnEditPage() {
    const idMatch = location.pathname.match(RE_EDIT_PAGE);
    if (!idMatch) return;
    const currentId = idMatch[1];

    editPageStatus('Job check for ID ' + currentId + '...');

    const raw = localStorage.getItem(SAH_JOB_KEY);
    if (!raw) { editPageStatus('No edit job found.'); return; }
    let job;
    try { job = JSON.parse(raw); } catch (e) { editPageStatus('Job parse error.'); return; }
    if (!job || !job.queue || !job.queue.length) { editPageStatus('Edit job queue empty.'); return; }
    if (job.queue[0].id !== currentId) {
      editPageStatus('ID mismatch: job=' + job.queue[0].id + ' page=' + currentId);
      return;
    }

    const item = job.queue[0];

    waitRemainingPause(job, 5000, function () {
      editPageStatus('Waiting for form... (' + item.title + ')');
      sahBroadcast({ type: 'log', msg: 'Editing: ' + item.title + '...' });

      waitForElement('[data-testid="description--input"]', 15000, function (textarea) {
        if (!textarea) {
          editPageStatus('Textarea not found after 15s.');
          job.done.push({ id: currentId, title: item.title, result: 'error: textarea not found' });
          sahBroadcast({ type: 'log', msg: '[ERR] Textarea not found: ' + item.title });
          job.queue.shift();
          localStorage.setItem(SAH_JOB_KEY, JSON.stringify(job));
          advanceEditJob(job);
          return;
        }

        editPageStatus('Setting description...');
        setReactTextarea(textarea, editDescription(textarea.value));

        setTimeout(function () {
          const saveBtn = document.querySelector('[data-testid="upload-form-save-button"]');
          if (!saveBtn) {
            editPageStatus('Save button not found.');
            job.done.push({ id: currentId, title: item.title, result: 'error: save button not found' });
            sahBroadcast({ type: 'log', msg: '[ERR] Save btn not found: ' + item.title });
            job.queue.shift();
            localStorage.setItem(SAH_JOB_KEY, JSON.stringify(job));
            advanceEditJob(job);
            return;
          }

          job.done.push({ id: currentId, title: item.title, result: 'ok' });
          job.queue.shift();
          job.lastDoneAt = Date.now();
          localStorage.setItem(SAH_JOB_KEY, JSON.stringify(job));
          sahBroadcast({ type: 'log', msg: '[OK] Saved: ' + item.title });

          sessionStorage.setItem('sah-edit-advance', '1');
          saveBtn.click();
          editPageStatus('Saved — advancing...');

          // Let the save request finish before leaving, and suppress Vinted's
          // beforeunload prompt so the next item loads without confirmation.
          silenceLeavePrompt();
          let advanced = false;
          function doAdvance() {
            if (advanced) return;
            advanced = true;
            advanceEditJob(job);
          }
          setTimeout(doAdvance, SAVE_GRACE_MS);
        }, 800);
      });
    });
  }

  function advanceEditJob(job) {
    if (job.queue.length > 0) {
      silenceLeavePrompt();
      location.replace('https://www.vinted.pl/items/' + job.queue[0].id + '/edit');
    } else {
      unsilenceLeavePrompt();
      sahBroadcast({ type: 'done', done: job.done });
      localStorage.removeItem(SAH_JOB_KEY);
      setTimeout(function () { window.close(); }, 300);
    }
  }

  // ── Full-refresh (relist) job engine ─────────────────────────────────────

  function startRelistJob(item) {
    localStorage.removeItem(SAH_RECORD_KEY);
    const job = {
      phase:     'scrape',
      itemId:    item.id,
      title:     item.title,
      priceText: item.priceText,
      url:       item.url
    };
    localStorage.setItem(SAH_RELIST_KEY, JSON.stringify(job));
    sahLog('Full Refresh: opening edit page for ' + item.title + '...');
    const tab = window.open('https://www.vinted.pl/items/' + item.id + '/edit', '_blank');
    if (!tab) {
      sahLog('[ERR] Popup blocked — allow popups for vinted.pl and retry.');
      localStorage.removeItem(SAH_RELIST_KEY);
    }
  }

  function startBatchRelistJob(items) {
    if (!items.length) { sahLog('No items selected.'); return; }
    localStorage.removeItem(SAH_RECORD_KEY);
    const first = items[0];
    const rest  = items.slice(1);
    const job = {
      phase:     'scrape',
      itemId:    first.id,
      title:     first.title,
      priceText: first.priceText,
      url:       first.url,
      batch: {
        queue: rest.map(function (it) {
          return { id: it.id, title: it.title, priceText: it.priceText, url: it.url };
        }),
        done: []
      }
    };
    localStorage.setItem(SAH_RELIST_KEY, JSON.stringify(job));
    sahLog('Full Refresh: ' + items.length + ' item(s) queued — opening edit tab...');
    const tab = window.open('https://www.vinted.pl/items/' + first.id + '/edit', '_blank');
    if (!tab) {
      sahLog('[ERR] Popup blocked — allow popups for vinted.pl and retry.');
      localStorage.removeItem(SAH_RELIST_KEY);
    }
  }

  // Called on the item edit page — scrapes data then navigates to /items/new.
  function runRelistJobOnEditPage() {
    const job = parseLocalStorage(SAH_RELIST_KEY);
    if (!job || job.phase !== 'scrape') return;

    const idMatch = location.pathname.match(/\/items\/(\d+)/);
    if (!idMatch || idMatch[1] !== job.itemId) {
      relistLog('ID mismatch: page=' + (idMatch && idMatch[1]) + ' job=' + job.itemId + ' — redirecting');
      setTimeout(function () { location.replace('https://www.vinted.pl/items/' + job.itemId + '/edit'); }, 500);
      return;
    }

    relistLog('Scraping item ' + job.itemId + ': ' + (job.title || ''));

    waitRemainingPause(job, 3000, function () {
      const scraped = scrapeItemFromNextData() || {};
      relistLog('__NEXT_DATA__: title=' + (scraped.title || 'NONE') + ' photos=' + (scraped.photos || []).length);
      if (!scraped.title)  scraped.title  = job.title    || '';
      if (!scraped.price)  scraped.price  = job.priceText || '';
      scraped.itemId = job.itemId;

      waitForElement('[data-testid="description--input"]', 12000, function (desc) {
        relistLog('description textarea: ' + (desc ? 'found' : 'NOT FOUND'));
        if (desc && !scraped.description) scraped.description = desc.value;
        if (!scraped.photos || !scraped.photos.length) scraped.photos = scrapePhotosFromDom();

        waitForAttributesHydrated(8000, function () {
          scrapeColorsFromDropdown(function (colorList) {
            var attrs = scrapeAttributesFromDom();
            if (colorList.length) attrs.colors = colorList;
            relistLog('Attrs: cat=' + (attrs.category || 'NONE') + ' brand=' + (attrs.brand || 'NONE') + ' size=' + (attrs.size || 'NONE') + ' cond=' + (attrs.condition || 'NONE') + ' colors=[' + (attrs.colors || []).join(',') + '] mats=[' + (attrs.materials || []).join(',') + '] ship=' + (attrs.shipmentSize || 'NONE'));
            if (attrs.category)                            scraped.category     = attrs.category;
            if (attrs.catalogId && !scraped.catalogId)    scraped.catalogId    = attrs.catalogId;
            if (attrs.brand)                               scraped.brand        = attrs.brand;
            if (attrs.size)                                scraped.size         = attrs.size;
            if (attrs.condition)                           scraped.condition    = attrs.condition;
            if (attrs.shipmentSize)                        scraped.shipmentSize = attrs.shipmentSize;
            if (attrs.colors && attrs.colors.length)       scraped.colors       = attrs.colors;
            if (attrs.materials && attrs.materials.length) scraped.materials    = attrs.materials;
            relistLog('Final: cat=' + (scraped.category || 'NONE') + ' brand=' + (scraped.brand || 'NONE') + ' photos=' + (scraped.photos || []).length);
            finalizeRelistScrape(job, scraped);
          });
        });
      });
    });
  }

  // Reads the Next.js page-data object. Firefox Xray vision hides page-script
  // expandos from content scripts, so prefer the <script id="__NEXT_DATA__">
  // element (portable), then the unwrapped page window (Firefox only).
  function getNextData() {
    try {
      const tag = document.getElementById('__NEXT_DATA__');
      if (tag && tag.textContent) return JSON.parse(tag.textContent);
    } catch (e) {}
    try {
      if (window.wrappedJSObject && window.wrappedJSObject.__NEXT_DATA__) {
        return JSON.parse(JSON.stringify(window.wrappedJSObject.__NEXT_DATA__));
      }
    } catch (e) {}
    try { return window.__NEXT_DATA__ || null; } catch (e) { return null; }
  }

  function scrapeItemFromNextData() {
    try {
      const nd = getNextData();
      if (!nd) return null;
      const pp = nd.props && nd.props.pageProps;
      if (!pp) return null;
      const item = pp.item || pp.itemData || (pp.initialState && pp.initialState.item);
      if (!item) return null;

      const helper = window.__sahPhotoSelection || window.photoSelection || null;
      const photos = helper && helper.collectPhotoUrlsFromItem
        ? helper.collectPhotoUrlsFromItem(item)
        : collectPhotoUrlsFromItem(item);

      return {
        title:       item.title       || '',
        description: item.description || '',
        price:       String(item.price_numeric != null ? item.price_numeric : (item.price || '')),
        photos:      photos,
        catalogId:   item.catalog_id  || null
      };
    } catch (e) {
      return null;
    }
  }

  function scrapePhotosFromDom() {
    const photos = [];
    const seen   = new Set();
    document.querySelectorAll('img').forEach(function (img) {
      const src = img.src || img.dataset.src || '';
      if (!src || seen.has(src)) return;
      if (!src.includes('images1.vinted.net') && !src.includes('images2.vinted.net')) return;
      if (img.naturalWidth > 0 && img.naturalWidth < 60) return; // skip tiny avatars
      seen.add(src);
      const helper = window.__sahPhotoSelection || window.photoSelection || null;
      if (helper && helper.selectBestPhotoUrl) {
        const best = helper.selectBestPhotoUrl([src]);
        if (best) photos.push(best);
      } else {
        const best = selectBestPhotoUrl([src]);
        if (best) photos.push(best);
      }
    });
    return photos;
  }

  function scrapeColorsFromDropdown(cb) {
    var CMAP = {1:'Czarny',2:'Brązowy',3:'Szary',4:'Beżowy',5:'Różowy',6:'Fioletowy',7:'Czerwony',8:'Żółty',9:'Niebieski',10:'Zielony',11:'Pomarańczowy',12:'Biały',13:'Srebrny',14:'Złoty',15:'Wielobarwny',16:'Khaki',17:'Turkus',20:'Kremowy',21:'Morelowy',22:'Koralowy',23:'Burgundowy',24:'Pudrowy róż',25:'Liliowy',26:'Jasnoniebieski',27:'Granatowy',28:'Ciemnozielony',29:'Musztardowy',30:'Miętowy',32:'Przezroczysty'};
    if (!document.querySelector('[data-testid="color-select-dropdown-input"]')) { relistLog('scrapeColors: no trigger'); cb([]); return; }
    pageClick('[data-testid="color-select-dropdown-input"]');
    var n = 0;
    var t = setInterval(function () {
      n++;
      var content = document.querySelector('[data-testid="color-select-dropdown-content"]');
      if (content && isVisible(content)) {
        clearInterval(t);
        var colors = [];

        // New structure: options are div[role=checkbox][aria-checked=true]
        // with data-testid="filter-grid-option-<id>" and an aria-label / text span.
        content.querySelectorAll('[data-testid^="filter-grid-option-"]').forEach(function (opt) {
          if (opt.getAttribute('aria-checked') !== 'true') return;
          var name = (opt.getAttribute('aria-label') || '').trim();
          if (!name) name = getOptionTitle(opt);
          if (name && colors.indexOf(name) === -1) colors.push(name);
        });

        // Legacy structure fallback: input[type=checkbox]:checked with id color-checkbox-<id>.
        if (!colors.length) {
          content.querySelectorAll('input[type="checkbox"]:checked').forEach(function (inp) {
            var m = inp.id.match(/^(?:suggested-)?color-checkbox-(\d+)$/);
            if (m) { var name = CMAP[parseInt(m[1])]; if (name && colors.indexOf(name) === -1) colors.push(name); }
          });
        }

        relistLog('scrapeColors: [' + colors.join(',') + ']');
        pageClick('[data-testid="color-select-dropdown-input"]');
        cb(colors);
      } else if (n === 10) {
        pageClick('[data-testid^="color-select-dropdown-chevron"]');
      } else if (n >= 20) {
        clearInterval(t);
        relistLog('scrapeColors: dropdown did not open');
        cb([]);
      }
    }, 150);
  }

  function scrapeAttributesFromDom() {
    // Package size — map checked radio id to label
    var shipmentSize = '';
    var pkgMap = { package_type_selector_1: 'Mały', package_type_selector_2: 'Średni', package_type_selector_3: 'Duży' };
    Object.keys(pkgMap).forEach(function (id) {
      if (!shipmentSize && document.querySelector('#' + id + ':checked')) shipmentSize = pkgMap[id];
    });

    // Colors are scraped via scrapeColorsFromDropdown before this function runs
    var colors = [];

    function nextDataItem() {
      try {
        var nd = getNextData();
        if (!nd) return null;
        var pp = nd.props && nd.props.pageProps;
        if (pp) { var item = pp.item || pp.itemData || (pp.initialState && pp.initialState.item); if (item) return item; }
        function findItem(obj, depth) {
          if (!obj || typeof obj !== 'object' || depth > 8) return null;
          if (Array.isArray(obj)) { for (var i = 0; i < obj.length; i++) { var r = findItem(obj[i], depth + 1); if (r) return r; } return null; }
          if (obj.material_ids !== undefined || (Array.isArray(obj.materials) && obj.materials.length)) return obj;
          for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) { var f = findItem(obj[k], depth + 1); if (f) return f; } }
          return null;
        }
        return findItem(nd, 0);
      } catch (e) { return null; }
    }

    // Materials — field may be material_ids array or materials array of objects
    var matsVal = getTestIdVal('category-material-multi-list-input');
    var materials = matsVal ? matsVal.split(/,\s*/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
    if (!materials.length) {
      var ndItem2 = nextDataItem();
      if (ndItem2) {
        var matIds = [];
        if (Array.isArray(ndItem2.material_ids)) {
          matIds = ndItem2.material_ids;
        } else if (Array.isArray(ndItem2.materials)) {
          matIds = ndItem2.materials.map(function (m) { return typeof m === 'object' ? m.id : m; });
        }
        relistLog('material IDs from __NEXT_DATA__: [' + matIds.join(',') + ']');
        matIds.forEach(function (mid) {
          var titleEl = document.querySelector('[data-testid="material-' + mid + '--title"]');
          if (titleEl) { materials.push(titleEl.textContent.trim()); }
          else { relistLog('material ID ' + mid + ' title not found in DOM'); }
        });
      }
    }
    relistLog('materials scraped: [' + materials.join(',') + ']');

    var ndItemCat = nextDataItem();
    var catalogId = ndItemCat ? (ndItemCat.catalog_id || null) : null;

    return {
      category:     getTestIdVal('catalog-select-dropdown-input'),
      catalogId:    catalogId,
      brand:        getTestIdVal('brand-select-dropdown-input'),
      size:         getTestIdVal('category-size-single-grid-input'),
      condition:    getTestIdVal('category-condition-single-list-input'),
      shipmentSize: shipmentSize,
      colors:       colors,
      materials:    materials
    };
  }

  function waitForAttributesHydrated(timeoutMs, cb) {
    var deadline = Date.now() + timeoutMs;
    function catCheck() {
      if (getTestIdVal('catalog-select-dropdown-input')) {
        // Category ready — now wait for brand/condition to hydrate (up to 2s more)
        attrCheck(Date.now() + 2000);
        return;
      }
      if (Date.now() >= deadline) { cb(); return; }
      setTimeout(catCheck, 200);
    }
    function attrCheck(attrDeadline) {
      if (getTestIdVal('brand-select-dropdown-input') || getTestIdVal('category-condition-single-list-input')) { cb(); return; }
      if (Date.now() >= attrDeadline) { cb(); return; }
      setTimeout(function () { attrCheck(attrDeadline); }, 200);
    }
    catCheck();
  }

  function finalizeRelistScrape(job, scraped) {
    job.data  = scraped;
    job.phase = 'relist';
    localStorage.setItem(SAH_RELIST_KEY, JSON.stringify(job));
    editPageStatus('Scraped: ' + (scraped.photos ? scraped.photos.length : 0) + ' photo(s). Opening new-item form...');
    silenceLeavePrompt();
    setTimeout(function () { location.href = 'https://www.vinted.pl/items/new'; }, 800);
  }

  // Called on /items/new — auto-selects category, fills form, uploads photos, saves as draft.
  function runRelistJobOnNewItemPage() {
    if (activateClickRecorderOnPage()) return;
    const job = parseLocalStorage(SAH_RELIST_KEY);
    if (!job || job.phase !== 'relist' || !job.data) return;
    if (document.getElementById('sah-relist-overlay')) return;

    const data = job.data;
    relistLog('New-item page: cat=' + (data.category || 'NONE') + ' brand=' + (data.brand || 'NONE') + ' photos=' + (data.photos ? data.photos.length : 0));
    showRelistOverlay(data, job.batch);

    relistLog('Waiting for form to hydrate...');
    waitForElement('[data-testid="description--input"]', 120000, function (desc) {
      if (!desc) {
        localStorage.removeItem(SAH_RELIST_KEY);
        updateRelistOverlay('Form timed out. Fill manually, then click "Wersja robocza".');
        return;
      }
      relistLog('Form hydrated — description textarea found');

      function fillFormFields() {
        var liveDesc = document.querySelector('[data-testid="description--input"]') || desc;
        relistLog('fillFormFields: desc attached=' + document.contains(desc) + (liveDesc !== desc ? ' (re-queried)' : ''));
        setReactTextarea(liveDesc, data.description);
        setTimeout(function () {
          const titleEl = document.querySelector('[data-testid="title--input"]');
          if (titleEl) setReactInput(titleEl, data.title);
          const priceEl = document.querySelector('[data-testid="price-input--input"]');
          if (priceEl && data.price) setReactInput(priceEl, data.price);

          relistLog('Filling brand/size/condition...');
          fillItemAttributes(data, function () {
            relistLog('Attributes filled — uploading photos...');
            const photoCount = data.photos ? data.photos.length : 0;
            if (photoCount > 0) {
              updateRelistOverlay('Uploading ' + photoCount + ' photo(s)...');
              uploadPhotos(data.photos, function (uploaded) {
                if (uploaded > 0) {
                  updateRelistOverlay('Waiting for ' + uploaded + ' photo(s) to upload to CDN...');
                  waitForPhotosUploaded(uploaded, 90000, function (ok) {
                    if (!ok) {
                      localStorage.removeItem(SAH_RELIST_KEY);
                      updateRelistOverlay('Photo upload timed out. Verify photos, then click "Wersja robocza" manually.');
                      return;
                    }
                    clickDraftAndFinish(data);
                  });
                } else {
                  localStorage.removeItem(SAH_RELIST_KEY);
                  updateRelistOverlay('Photos not injected. Add manually, then click "Wersja robocza".');
                }
              });
            } else {
              updateRelistOverlay('No source photos — saving draft...');
              setTimeout(function () { clickDraftAndFinish(data); }, 500);
            }
          });
        }, 600);
      }

      if (data.category) {
        setTimeout(function () {
          relistLog('Selecting category: ' + data.category);
          selectCategory(data.category, data.catalogId || null, function (ok) {
            if (!ok) {
              relistLog('Category auto-select failed — continuing without category');
              updateRelistOverlay('Auto-select failed for "' + escHtml(data.category) + '". Select manually.');
            } else {
              updateRelistOverlay('Category selected — filling form fields...');
            }
            setTimeout(fillFormFields, 800);
          });
        }, 1500);
      } else {
        fillFormFields();
      }
    });
  }

  function waitForPhotosUploaded(count, timeoutMs, cb) {
    const deadline = Date.now() + timeoutMs;
    function check() {
      const wrappers = document.querySelectorAll('[data-testid^="image-wrapper-"]');
      if (wrappers.length >= count) {
        let allReady = true;
        wrappers.forEach(function (w) {
          const img = w.querySelector('img');
          if (!img || !img.src || img.src.startsWith('blob:')) allReady = false;
        });
        if (allReady) { cb(true); return; }
      }
      if (Date.now() >= deadline) { cb(false); return; }
      setTimeout(check, 800);
    }
    check();
  }

  function clickDraftAndFinish(data) {
    const btn = document.querySelector('[data-testid="upload-form-save-draft-button"]');
    if (!btn || btn.disabled) {
      updateRelistOverlay('Draft button unavailable. Click "Wersja robocza" manually.');
      editPageStatus('Draft button unavailable.');
      return;
    }

    let batchQueue = [], batchDone = [];
    const job = parseLocalStorage(SAH_RELIST_KEY);
    if (job && job.batch) {
      batchDone = (job.batch.done || []).concat([{ id: data.itemId, title: data.title, result: 'ok' }]);
      batchQueue = job.batch.queue || [];
    }
    localStorage.removeItem(SAH_RELIST_KEY);

    btn.click();
    editPageStatus('Draft saved.');

    if (batchQueue.length > 0) {
      const next = batchQueue[0];
      const nextJob = {
        phase:      'scrape',
        itemId:     next.id,
        title:      next.title,
        priceText:  next.priceText,
        url:        next.url,
        lastDoneAt: Date.now(),
        batch:      { queue: batchQueue.slice(1), done: batchDone }
      };
      localStorage.setItem(SAH_RELIST_KEY, JSON.stringify(nextJob));
      sessionStorage.setItem('sah-relist-advance', '1');
      const total = batchDone.length + batchQueue.length;
      updateRelistOverlay(batchDone.length + '/' + total + ' drafts saved. Next: ' + next.title + '...');
      editPageStatus('Advancing to next item...');

      // Let the draft-save request finish before leaving; suppress Vinted's
      // beforeunload prompt so the next edit page loads without confirmation.
      silenceLeavePrompt();
      let advanced = false;
      function doAdvance() {
        if (advanced) return;
        advanced = true;
        location.replace('https://www.vinted.pl/items/' + next.id + '/edit');
      }
      setTimeout(doAdvance, DRAFT_GRACE_MS);
    } else if (batchDone.length > 0) {
      unsilenceLeavePrompt();
      updateRelistOverlay('All ' + batchDone.length + ' draft(s) saved. Verify and publish. Originals still active.');
    } else {
      unsilenceLeavePrompt();
      updateRelistOverlay('Draft saved. Verify and publish. Original #' + data.itemId + ' still active.');
    }
  }

  // Sends a click request to content-main.js (MAIN world) via CustomEvent on document.
  // document is a shared DOM node — CustomEvents cross isolated↔MAIN world boundaries.
  // Firefox: objects created in the content-script compartment are opaque to page
  // (MAIN world) scripts. cloneInto() re-creates the payload in the page's scope so
  // content-main.js can read it. No-op fallback on Chrome and in jsdom tests.
  function bridgeDetail(obj) {
    try {
      if (typeof cloneInto === 'function') return cloneInto(obj, window);
    } catch (e) {}
    return obj;
  }

  function pageClick(selector) {
    document.dispatchEvent(new CustomEvent('sah-ext-click', { detail: bridgeDetail({ selector: selector }) }));
  }

  // Sends a type request to content-main.js (MAIN world) — simulates real per-character
  // keyboard events so React search handlers fire (isolated world synthetic events don't).
  function pageType(selector, value) {
    document.dispatchEvent(new CustomEvent('sah-ext-type', { detail: bridgeDetail({ selector: selector, value: value }) }));
  }

  function selectCategory(categoryName, catalogId, cb) {
    relistLog('selectCategory: "' + categoryName + '" catalogId=' + (catalogId || 'none'));
    waitForElement('[data-testid="catalog-select-dropdown-input"]', 10000, function (catInput) {
      if (!catInput) {
        relistLog('catalog-select-dropdown-input NOT found after 10s');
        cb(false); return;
      }
      relistLog('catalog-select-dropdown-input found — clicking via MAIN world');
      updateRelistOverlay('Opening category dropdown...');
      pageClick('#category');

      waitForElement('input#catalog-search-input', 10000, function (searchEl) {
        if (!searchEl) {
          relistLog('catalog-search-input NOT found after 10s');
          updateRelistOverlay('Category search input not found. Select manually.');
          cb(false); return;
        }
        relistLog('catalog-search-input found — typing "' + categoryName + '" via MAIN world');
        updateRelistOverlay('Typing category: ' + categoryName + '...');
        pageType('input#catalog-search-input', categoryName);
        // Wait for typing (30ms/char) + React debounce + results to render
        var typingMs = categoryName.length * 30 + 500;
        setTimeout(function () {
          var snap = Array.from(document.querySelectorAll('[id^="catalog-"]'))
            .slice(0, 8).map(function (e) { return e.id; }).join(', ');
          relistLog('catalog-* snapshot after typing: ' + (snap || 'none'));
          updateRelistOverlay('Waiting for category results...');
          waitForCategoryResult(categoryName, catalogId, 12000, cb);
        }, typingMs);
      });
    });
  }

  function waitForCatalogDropdownClose(timeoutMs, cb) {
    var deadline = Date.now() + timeoutMs;
    function check() {
      if (!document.querySelector('[data-testid="catalog-select-dropdown-content"]')) { cb(true); return; }
      if (Date.now() >= deadline) {
        relistLog('catalog dropdown still open after ' + timeoutMs + 'ms — click did not register');
        cb(false);
        return;
      }
      setTimeout(check, 150);
    }
    check();
  }

  function waitForCategoryResult(categoryName, catalogId, timeoutMs, cb) {
    var deadline = Date.now() + timeoutMs;
    function findResults() {
      // IDs are catalog-search-{catalogId}-result
      var results = document.querySelectorAll('[id^="catalog-search-"][id$="-result"]');
      if (!results.length) results = document.querySelectorAll('[id^="catalog-suggestion-"]');
      if (!results.length) {
        var container = document.querySelector('[data-testid="catalog-select-dropdown-content"]');
        if (container) results = container.querySelectorAll('[role="button"]');
      }
      return results;
    }
    function check() {
      var results = findResults();
      if (results.length) {
        var toClick = null;

        // Priority 1: exact catalog ID match — unambiguous even when same name appears in multiple sections
        if (catalogId) {
          toClick = document.getElementById('catalog-search-' + catalogId + '-result') ||
                    document.getElementById('catalog-suggestion-' + catalogId) ||
                    null;
          if (toClick) relistLog('category ID match: catalogId=' + catalogId + ' id=' + toClick.id);
        }

        // Priority 2: exact title match
        if (!toClick) {
          for (var i = 0; i < results.length; i++) {
            var titleEl = results[i].querySelector('.web_ui__Cell__title');
            var title = titleEl ? titleEl.textContent.trim() : results[i].textContent.trim().slice(0, 30);
            if (title === categoryName) {
              relistLog('category name match: "' + categoryName + '" id=' + results[i].id);
              toClick = results[i];
              break;
            }
          }
        }

        // Priority 3: first result (original fallback)
        if (!toClick) {
          toClick = results[0];
          relistLog('category fallback: first result id=' + toClick.id);
        }
        var titles = Array.from(results).map(function (r) {
          var t = r.querySelector('.web_ui__Cell__title');
          return (t ? t.textContent.trim() : r.textContent.trim().slice(0, 20)) + '(id=' + r.id + ',dt=' + (r.getAttribute('data-testid') || '') + ')';
        });
        relistLog('Clicking result. Options: ' + titles.slice(0, 5).join(' | '));
        updateRelistOverlay('Clicking category result...');
        // Click the radio input inside the result — that's what registers React form state
        var radio = toClick.querySelector('input[type="radio"]');
        if (radio) {
          radio.click();
        } else if (toClick.id) {
          pageClick('#' + toClick.id);
        } else {
          toClick.click();
        }
        waitForCatalogDropdownClose(4000, function (closed) {
          if (!closed) relistLog('Category click did not dismiss dropdown — selection may have failed');
          cb(closed);
        });
        return;
      }
      if (Date.now() >= deadline) {
        var snap = Array.from(document.querySelectorAll('[id^="catalog-"]'))
          .slice(0, 8).map(function (e) { return e.id; }).join(', ');
        relistLog('category results NOT found after ' + (timeoutMs / 1000) + 's. catalog-*: ' + (snap || 'none'));
        updateRelistOverlay('Category results not found. Select "' + categoryName + '" manually.');
        cb(false);
        return;
      }
      setTimeout(check, 200);
    }
    check();
  }

  // Extracts display title from a Vinted option element.
  // Tries .web_ui__Cell__title span first (size grid), then .web_ui__Cell__title, then full textContent.
  function getOptionTitle(el) {
    var span = el.querySelector('.web_ui__Cell__title span');
    if (span) return span.textContent.trim();
    var title = el.querySelector('.web_ui__Cell__title');
    if (title) return title.textContent.trim();
    return el.textContent.trim();
  }

  function clickOptionEl(el) {
    var checkbox = el.querySelector('input[type="checkbox"]');
    if (checkbox) {
      var csel = null;
      if (el.getAttribute('data-testid')) csel = '[data-testid="' + el.getAttribute('data-testid') + '"]';
      else if (el.id)                     csel = '#' + el.id;
      if (csel) { pageClick(csel); return; }
      checkbox.click(); return;
    }
    var radio = el.querySelector('input[type="radio"]');
    if (radio) { radio.click(); return; }
    var sel = null;
    if (el.getAttribute('data-testid')) sel = '[data-testid="' + el.getAttribute('data-testid') + '"]';
    else if (el.id)                     sel = '#' + el.id;
    if (sel) { pageClick(sel); } else { el.click(); }
  }

  var OPTION_SEL = 'button, [role="option"], [role="button"], [role="checkbox"], [role="radio"], label, a';

  function isVisible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  function optionTextMatches(optionText, target) {
    if (optionText === target) return true;
    // Partial match: "38" matches "M / 38 / 10", "S" matches "S / 36 / 8"
    var parts = optionText.split(/\s*\/\s*/);
    return parts.indexOf(target) !== -1;
  }

  // Checks current DOM first (visible options only), then watches mutations for dynamic results.
  function clickExistingOrNewOption(targetText, timeoutMs, cb) {
    if (!targetText) { cb(false); return; }
    var existing = Array.from(document.querySelectorAll(OPTION_SEL));
    var visibleTitles = [];
    var partialMatch = null;
    for (var i = 0; i < existing.length; i++) {
      if (!isVisible(existing[i])) continue;
      var t = getOptionTitle(existing[i]);
      visibleTitles.push(t);
      if (t === targetText) {
        relistLog('clickExistingOrNew: exact match "' + targetText + '" → clicking');
        clickOptionEl(existing[i]);
        cb(true);
        return;
      }
      if (!partialMatch && optionTextMatches(t, targetText)) {
        partialMatch = existing[i];
      }
    }
    if (partialMatch) {
      relistLog('clickExistingOrNew: partial match "' + targetText + '" in "' + getOptionTitle(partialMatch) + '" → clicking');
      clickOptionEl(partialMatch);
      cb(true);
      return;
    }
    relistLog('clickExistingOrNew: "' + targetText + '" not in ' + visibleTitles.length + ' visible options — watching mutations. Sample: ' + visibleTitles.slice(0, 5).join(' | '));
    waitForMatchingOption(targetText, timeoutMs, cb);
  }

  // Watches newly added DOM nodes for matching text (used for search results loaded dynamically).
  function waitForMatchingOption(targetText, timeoutMs, cb) {
    if (!targetText) { cb(false); return; }
    var found = false;
    var obs = new MutationObserver(function (mutations) {
      if (found) return;
      for (var i = 0; i < mutations.length; i++) {
        var added = Array.from(mutations[i].addedNodes);
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node.nodeType !== 1) continue;
          var candidates = [node].concat(Array.from(node.querySelectorAll(OPTION_SEL)));
          for (var k = 0; k < candidates.length; k++) {
            if (getOptionTitle(candidates[k]) === targetText) {
              found = true;
              obs.disconnect();
              clickOptionEl(candidates[k]);
              cb(true);
              return;
            }
          }
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // React often RE-USES existing option nodes when filtering (removing the
    // non-matching ones), so added-node mutations alone can miss the target.
    // Poll the existing DOM as well until it appears or we time out.
    var deadline = Date.now() + timeoutMs;
    var poll = setInterval(function () {
      if (found) return;
      var existing = Array.from(document.querySelectorAll(OPTION_SEL));
      for (var i = 0; i < existing.length; i++) {
        if (!isVisible(existing[i])) continue;
        if (getOptionTitle(existing[i]) === targetText) {
          found = true;
          clearInterval(poll);
          obs.disconnect();
          clickOptionEl(existing[i]);
          cb(true);
          return;
        }
      }
      if (Date.now() >= deadline) {
        clearInterval(poll);
        obs.disconnect();
        cb(false);
      }
    }, 250);

    setTimeout(function () { if (!found) { clearInterval(poll); obs.disconnect(); cb(false); } }, timeoutMs);
  }

  function fillBrand(brandName, cb) {
    if (!brandName) { cb(false); return; }
    relistLog('fillBrand: "' + brandName + '"');
    waitForElement('[data-testid="brand-select-dropdown-input"]', 8000, function (input) {
      if (!input) { relistLog('fillBrand: input NOT found after 8s'); cb(false); return; }
      relistLog('fillBrand: input found — clicking to open');
      pageClick('[data-testid="brand-select-dropdown-input"]');
      setTimeout(function () {
        relistLog('fillBrand: typing "' + brandName + '" into brand-search-input');
        pageType('input#brand-search-input', brandName);
        var waitMs = brandName.length * 30 + 600;
        setTimeout(function () {
          relistLog('fillBrand: selecting result "' + brandName + '"');
          // Scan the CURRENT filtered list first (React re-uses existing option
          // nodes when filtering, so a new-node MutationObserver alone misses it).
          clickExistingOrNewOption(brandName, 4000, function (ok) {
            relistLog('fillBrand: result ' + (ok ? 'CLICKED' : 'NOT FOUND'));
            cb(ok);
          });
        }, waitMs);
      }, 400);
    });
  }

  function fillSingleSelect(fieldTestId, targetText, cb) {
    if (!targetText) { cb(false); return; }
    relistLog('fillSingleSelect: ' + fieldTestId + ' → "' + targetText + '"');
    waitForElement('[data-testid="' + fieldTestId + '"]', 8000, function (input) {
      if (!input) { relistLog('fillSingleSelect: ' + fieldTestId + ' NOT found after 8s'); cb(false); return; }
      relistLog('fillSingleSelect: found — clicking to open');
      pageClick('[data-testid="' + fieldTestId + '"]');
      setTimeout(function () {
        // Check if dropdown actually opened; if not, click the chevron toggle button
        var contentTestId = fieldTestId.replace(/-input$/, '-content');
        var contentEl = document.querySelector('[data-testid="' + contentTestId + '"]');
        if (!contentEl || !isVisible(contentEl)) {
          var chevronPrefix = fieldTestId.replace(/-input$/, '-chevron');
          relistLog('fillSingleSelect: dropdown not open — clicking chevron ' + chevronPrefix + '*');
          pageClick('[data-testid^="' + chevronPrefix + '"]');
          setTimeout(function () {
            relistLog('fillSingleSelect: looking for visible "' + targetText + '"');
            clickExistingOrNewOption(targetText, 5000, function (ok) {
              relistLog('fillSingleSelect: "' + targetText + '" ' + (ok ? 'CLICKED' : 'NOT FOUND'));
              cb(ok);
            });
          }, 500);
        } else {
          relistLog('fillSingleSelect: looking for visible "' + targetText + '"');
          clickExistingOrNewOption(targetText, 5000, function (ok) {
            relistLog('fillSingleSelect: "' + targetText + '" ' + (ok ? 'CLICKED' : 'NOT FOUND'));
            cb(ok);
          });
        }
      }, 300);
    });
  }

  function fillMultiSelect(fieldTestId, values, cb) {
    if (!values || !values.length) { cb(false); return; }
    relistLog('fillMultiSelect: ' + fieldTestId + ' → ' + JSON.stringify(values));
    waitForElement('[data-testid="' + fieldTestId + '"]', 8000, function (input) {
      if (!input) { relistLog('fillMultiSelect: ' + fieldTestId + ' NOT found after 8s'); cb(false); return; }
      relistLog('fillMultiSelect: found — clicking to open');
      pageClick('[data-testid="' + fieldTestId + '"]');
      setTimeout(function () {
        var contentTestId = fieldTestId.replace(/-input$/, '-content');
        var contentEl = document.querySelector('[data-testid="' + contentTestId + '"]');
        if (!contentEl || !isVisible(contentEl)) {
          var chevronPrefix = fieldTestId.replace(/-input$/, '-chevron');
          relistLog('fillMultiSelect: dropdown not open — clicking chevron ' + chevronPrefix + '*');
          pageClick('[data-testid^="' + chevronPrefix + '"]');
          setTimeout(function () { runClickLoop(); }, 500);
        } else {
          runClickLoop();
        }
        function runClickLoop() {
          var i = 0;
          function clickNext() {
            if (i >= values.length) {
              pageClick('[data-testid="' + fieldTestId + '"]');
              cb(true);
              return;
            }
            var v = values[i++];
            relistLog('fillMultiSelect: clicking "' + v + '"');
            clickExistingOrNewOption(v, 3000, function () { setTimeout(clickNext, 300); });
          }
          clickNext();
        }
      }, 400);
    });
  }

  function selectShipmentSize(sizeName, cb) {
    var map = { 'Mały': 1, 'Średni': 2, 'Duży': 3 };
    var n = map[sizeName];
    if (!n) { relistLog('selectShipmentSize: unknown "' + sizeName + '"'); cb(false); return; }
    relistLog('selectShipmentSize: "' + sizeName + '" → #package_type_selector_' + n);
    waitForElement('#package_type_selector_' + n, 5000, function (radio) {
      if (!radio) { relistLog('selectShipmentSize: radio #' + n + ' NOT found after 5s'); cb(false); return; }
      relistLog('selectShipmentSize: radio found — clicking via MAIN world');
      pageClick('#package_type_selector_' + n);
      cb(true);
    });
  }

  function fillItemAttributes(data, onDone) {
    relistLog('fillItemAttributes: brand="' + (data.brand || '') + '" cond="' + (data.condition || '') + '" size="' + (data.size || '') + '" colors=' + JSON.stringify(data.colors || []) + ' mats=' + JSON.stringify(data.materials || []) + ' ship="' + (data.shipmentSize || '') + '"');
    var steps = [];
    if (data.brand)                              steps.push(function (next) { fillBrand(data.brand, function () { next(); }); });
    if (data.condition)                          steps.push(function (next) { fillSingleSelect('category-condition-single-list-input', data.condition, function () { next(); }); });
    if (data.size)                               steps.push(function (next) { fillSingleSelect('category-size-single-grid-input', data.size, function () { next(); }); });
    if (data.colors && data.colors.length)       steps.push(function (next) { fillMultiSelect('color-select-dropdown-input', data.colors, function () { next(); }); });
    if (data.materials && data.materials.length) steps.push(function (next) { fillMultiSelect('category-material-multi-list-input', data.materials, function () { next(); }); });
    var shipment = 'Duży';
    steps.push(function (next) {
      relistLog('Selecting shipment size: ' + shipment);
      selectShipmentSize(shipment, function () { next(); });
    });
    relistLog('fillItemAttributes: ' + steps.length + ' step(s) queued');
    var i = 0;
    function run() {
      if (i >= steps.length) { onDone(); return; }
      steps[i++](function () { setTimeout(run, 800); });
    }
    run();
  }

  function showRelistOverlay(data, batch) {
    const div = document.createElement('div');
    div.id = 'sah-relist-overlay';
    div.style.cssText = [
      'position:fixed', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:2147483647', 'background:#09B1BA', 'color:#fff',
      'padding:12px 18px', 'border-radius:10px',
      'font:600 12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'box-shadow:0 4px 20px rgba(0,0,0,.32)', 'max-width:420px', 'width:90%',
      'text-align:center', 'word-break:break-word'
    ].join(';');
    var batchLine = '';
    if (batch && batch.queue) {
      var bTotal = (batch.done ? batch.done.length : 0) + batch.queue.length + 1;
      var bCurrent = (batch.done ? batch.done.length : 0) + 1;
      batchLine = '<div style="opacity:.7;font-size:11px">Item ' + bCurrent + ' of ' + bTotal + '</div>';
    }
    div.innerHTML =
      '<div style="font-size:13px;font-weight:700;margin-bottom:4px">VR: Full Refresh' + (batch ? ' (batch)' : '') + '</div>' +
      batchLine +
      '<div style="opacity:.9">' + escHtml(data.title) + '</div>' +
      '<div style="opacity:.8;font-size:11px">' +
        escHtml(data.price) + ' &nbsp;|&nbsp; ' +
        (data.photos ? data.photos.length : 0) + ' photo(s)' +
      '</div>' +
      '<div id="sah-relist-status" style="margin-top:6px;font-size:11px;opacity:.85">' +
        'Select a category to continue...' +
      '</div>';
    document.body.appendChild(div);
  }

  function updateRelistOverlay(msg) {
    const el = document.getElementById('sah-relist-status');
    if (el) el.textContent = msg;
    editPageStatus(msg);
  }

  // Fetches images via background service worker (bypasses CORS) and injects
  // them into the file upload input on the new-item form.
  function uploadPhotos(urls, onDone) {
    const filtered = urls
      .filter(function (u) {
        return u && (u.includes('images1.vinted.net') || u.includes('images2.vinted.net'));
      })
      .slice(0, 20);

    if (!filtered.length) { onDone(0); return; }

    let pending = filtered.length;
    const results = [];

    filtered.forEach(function (url, i) {
      fetch(url)
        .then(function (r) { return r.blob(); })
        .then(function (blob) {
          results.push({ idx: i, file: new File([blob], 'photo' + (i + 1) + '.jpg', { type: blob.type || 'image/jpeg' }) });
          checkDone();
        })
        .catch(function () {
          chrome.runtime.sendMessage({ type: 'fetchImage', url: url }, function (resp) {
            if (resp && resp.success) {
              const bin = atob(resp.b64);
              const buf = new Uint8Array(bin.length);
              for (let k = 0; k < bin.length; k++) buf[k] = bin.charCodeAt(k);
              results.push({ idx: i, file: new File([new Blob([buf])], 'photo' + (i + 1) + '.jpg', { type: 'image/jpeg' }) });
            }
            checkDone();
          });
        });
    });

    function checkDone() {
      pending--;
      if (pending > 0) return;

      results.sort(function (a, b) { return a.idx - b.idx; });
      const files = results.map(function (r) { return r.file; });

      const fileInput =
        document.querySelector('[data-testid="add-photos-input"]') ||
        document.querySelector('input[type="file"][accept*="image"]') ||
        document.querySelector('input[type="file"]');

      if (!fileInput) {
        updateRelistOverlay('Photo input not found — add photos manually.');
        onDone(0);
        return;
      }

      try {
        const dt = new DataTransfer();
        files.forEach(function (f) { dt.items.add(f); });
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        onDone(files.length);
      } catch (e) {
        updateRelistOverlay('Photo inject failed: ' + e.message + '. Add manually.');
        onDone(0);
      }
    }
  }

  // ── Extract item data from a grid-item element ───────────────────────────
  function getItemData(gridItem) {
    const item = resolveItemElement(gridItem);
    if (!item) return { url: '', title: '', thumbSrc: '', id: '', priceText: '' };

    const link  = item.matches && item.matches(SEL_LINK) ? item : item.querySelector(SEL_LINK);
    const thumb = item.matches && item.matches(SEL_THUMB) ? item : item.querySelector(SEL_THUMB);
    const card  = item.matches && item.matches(SEL_CARD) ? item : item.querySelector(SEL_CARD);
    const price = item.matches && item.matches(SEL_PRICE) ? item : item.querySelector(SEL_PRICE);

    const url       = link  ? link.href  : '';
    const rawTitle  = thumb ? thumb.alt  : (link ? link.title : '');
    const title     = rawTitle.split(', marka:')[0] || rawTitle;
    const thumbSrc  = thumb ? thumb.src  : '';
    const idMatch   = card && card.dataset && card.dataset.testid ? card.dataset.testid.match(/product-item-id-(\d+)/) : null;
    const hrefMatch = url.match(/\/items\/(\d+)/);
    const id        = (idMatch ? idMatch[1] : '') || (hrefMatch ? hrefMatch[1] : '');
    const priceText = price ? price.textContent.trim() : '';

    return { url, title, thumbSrc, id, priceText };
  }

  function isSkippableItem(gridItem) {
    // Status overlay div present on all non-active items: Ukryte, Sprzedane, verification, etc.
    if (gridItem.querySelector('[data-testid$="--status"]')) return true;
    // Class-based fallbacks in case Vinted changes their data-testid scheme
    if (gridItem.querySelector('[class*="--sold"]'))         return true;
    if (gridItem.querySelector('[data-testid*="sold"]'))     return true;
    if (gridItem.querySelector('[class*="verification"]'))   return true;
    return false;
  }

  function scrollToLoadAll(onDone) {
    let lastCount = 0;
    let stable    = 0;
    sahLog('Loading all items — scrolling...');
    function step() {
      const count = getFeedItems().length;
      sahLog('Current item count: ' + count + ' (stable: ' + stable + '/5)');
      if (count === lastCount) {
        stable++;
        if (stable >= 5) { sahLog('All items loaded — ' + count + ' found.'); onDone(); return; }
      } else {
        lastCount = count;
        stable = 0;
      }
      window.scrollTo(0, document.body.scrollHeight);
      setTimeout(step, 1500);
    }
    step();
  }

  // ── Click recorder (debug) ───────────────────────────────────────────────
  // Arming sets a localStorage flag; items/new page picks it up on load and
  // activates recording there, streaming results back via relistLog.

  function startClickRecorder() {
    showLogBox();
    localStorage.setItem(SAH_RECORD_KEY, '1');
    listenRelistLog();
    sahLog('Recorder armed. Open NEW TAB: vinted.pl/items/new — then click category field. Results appear here.');
    var btn = document.getElementById('sah-tb-record');
    if (btn) btn.classList.add('sah-toolbar-btn--active');
  }

  function activateClickRecorderOnPage() {
    if (localStorage.getItem(SAH_RECORD_KEY) !== '1') return false;
    if (localStorage.getItem(SAH_RELIST_KEY)) {
      localStorage.removeItem(SAH_RECORD_KEY);
      return false;
    }
    localStorage.removeItem(SAH_RECORD_KEY);
    relistLog('Click recorder active — click any element (10s DOM watch after click)');

    document.addEventListener('click', function handler(e) {
      document.removeEventListener('click', handler, true);

      var el = e.target;
      var path = [];
      for (var cur = el; cur && cur !== document.body; cur = cur.parentElement) {
        var desc = cur.tagName.toLowerCase();
        if (cur.id) desc += '#' + cur.id;
        var dt = cur.getAttribute('data-testid');
        if (dt) desc += '[dt=' + dt + ']';
        path.unshift(desc);
      }
      relistLog('CLICKED: ' + path.join(' > '));

      var seen = new Set();
      var obs = new MutationObserver(function (muts) {
        muts.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            var id = n.id || n.getAttribute('data-testid') || '';
            var key = n.tagName + id;
            if (seen.has(key)) return;
            seen.add(key);
            var targets = [n].concat(Array.from(n.querySelectorAll('input, [role="listbox"], [id^="catalog"], [role="button"]')));
            targets.forEach(function (t) {
              if (t === n && !id) return;
              relistLog('NEW: ' + t.tagName.toLowerCase() +
                (t.id ? '#' + t.id : '') +
                (t.getAttribute('data-testid') ? '[dt=' + t.getAttribute('data-testid') + ']' : '') +
                (t.getAttribute('placeholder') ? ' ph="' + t.getAttribute('placeholder') + '"' : '') +
                (t.getAttribute('role') ? ' role=' + t.getAttribute('role') : ''));
            });
          });
        });
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { obs.disconnect(); relistLog('Recorder done.'); }, 10000);
    }, true);
    return true;
  }

  // ── Kill all queued jobs ─────────────────────────────────────────────────
  function killAllJobs() {
    localStorage.removeItem(SAH_JOB_KEY);
    localStorage.removeItem(SAH_RELIST_KEY);
    try { sessionStorage.removeItem('sah-relist-advance'); } catch (e) {}
    try { sessionStorage.removeItem('sah-edit-advance'); } catch (e) {}
    unsilenceLeavePrompt();
    sahLog('All jobs cleared. Queue is empty.');
  }

  // ── Toolbar (right-edge vertical stack) ─────────────────────────────────
  function createToolbar() {
    if (document.getElementById('sah-toolbar')) return;
    const bar = document.createElement('div');
    bar.className = 'sah-toolbar';
    bar.id        = 'sah-toolbar';
    bar.innerHTML =
      '<div class="sah-toolbar-section-label">Item actions</div>' +
      '<button class="sah-toolbar-btn" id="sah-tb-multi">Multi-select</button>' +
      '<button class="sah-toolbar-btn" id="sah-tb-single">Refresh 1 item</button>' +
      '<div class="sah-toolbar-section-label">Global</div>' +
      '<button class="sah-toolbar-btn sah-toolbar-btn--global" id="sah-tb-all-desc">All descriptions</button>' +
      '<button class="sah-toolbar-btn sah-toolbar-btn--danger" id="sah-tb-kill">Stop all jobs</button>' +
      '<div class="sah-toolbar-section-label">Debug</div>' +
      '<button class="sah-toolbar-btn sah-toolbar-btn--debug" id="sah-tb-log">Log</button>' +
      '<button class="sah-toolbar-btn sah-toolbar-btn--debug" id="sah-tb-record">Record click</button>';
    getMountRoot().appendChild(bar);

    document.getElementById('sah-tb-multi').addEventListener('click', function (e) {
      e.stopPropagation(); enterMultiMode();
    });
    document.getElementById('sah-tb-single').addEventListener('click', function (e) {
      e.stopPropagation(); enterSingleMode();
    });
    document.getElementById('sah-tb-all-desc').addEventListener('click', function (e) {
      e.stopPropagation(); runRefreshAllDescriptions();
    });
    document.getElementById('sah-tb-kill').addEventListener('click', function (e) {
      e.stopPropagation(); killAllJobs();
    });
    document.getElementById('sah-tb-log').addEventListener('click', function (e) {
      e.stopPropagation(); toggleLogBox();
    });
    document.getElementById('sah-tb-record').addEventListener('click', function (e) {
      e.stopPropagation(); startClickRecorder();
    });
  }

  function runRefreshAllDescriptions() {
    scrollToLoadAll(function () {
      const items = [];
      let skipped = 0;
      getFeedItems().forEach(function (item) {
        if (isSkippableItem(item)) { skipped++; return; }
        const data = getItemData(item);
        if (!data.id) return;
        items.push({ id: data.id, url: data.url, title: data.title });
      });
      if (!items.length) {
        sahLog('No eligible items found.');
        return;
      }
      if (skipped) sahLog(skipped + ' item(s) skipped (sold/hidden/Ukryte/verification).');
      startEditDescriptionJob(items);
    });
  }

  // ── Bottom bar factory ───────────────────────────────────────────────────
  function createBottomBar(isSingle) {
    const disabledAttr = isSingle ? ' disabled' : '';
    const bar = document.createElement('div');
    bar.className = 'sah-bottom-bar';
    bar.id        = 'sah-bottom-bar';
    bar.innerHTML =
      '<span class="sah-count" id="sah-count">' + (isSingle ? 'Select an item' : '0 items selected') + '</span>' +
      '<div class="sah-bar-actions">' +
        '<button class="sah-btn sah-btn--primary" id="sah-bar-refresh"' + disabledAttr + '>' +
          'Full Refresh <span class="sah-live-badge">live</span>' +
        '</button>' +
        '<button class="sah-btn sah-btn--secondary" id="sah-bar-edit"' + disabledAttr + '>' +
          'Edit Description <span class="sah-live-badge">live</span>' +
        '</button>' +
        '<button class="sah-btn sah-btn--ghost" id="sah-bar-cancel">&#10005; Cancel</button>' +
      '</div>';
    getMountRoot().appendChild(bar);
    document.getElementById('sah-bar-cancel').addEventListener('click', exitCurrentMode);
    requestAnimationFrame(function () { bar.classList.add('sah-bottom-bar--visible'); });
    return bar;
  }

  // ── Multi-select mode ────────────────────────────────────────────────────
  function enterMultiMode() {
    exitCurrentMode();
    mode = 'multi';
    selected.clear();

    const grid = getFeedGrid();
    if (!grid) return;
    if (grid.classList) grid.classList.add('sah-multi-mode');

    grid._sahHandler = function (e) {
      // Allow clicks on bottom bar buttons to pass through
      if (e.target.closest('#sah-bottom-bar')) {
        // Only block if NOT clicking a button
        if (!e.target.closest('button')) return;
      }
      if (e.target.closest('#sah-toolbar') ||
          e.target.closest('#sah-log')) return;
      
      const item = resolveItemElement(e.target);
      if (!item) return;
      
      // Skip if clicking on sold/hidden items
      if (isSkippableItem(item)) {
        sahLog('Cannot select sold/hidden items');
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      const checkbox = item.querySelector('.sah-checkbox');
      toggleSelect(item, checkbox);
    };
    grid.addEventListener('click', grid._sahHandler, true);

    document.querySelectorAll('.sah-checkbox').forEach(function (el) { el.remove(); });
    // Add checkboxes immediately and watch for new items
    function addCheckboxes() {
      getFeedItems().forEach(function (item) {
        if (item.querySelector('.sah-checkbox')) return;
        const cb = document.createElement('div');
        cb.className = 'sah-checkbox';
        item.appendChild(cb);
      });
    }
    addCheckboxes();
    // Watch for dynamically loaded items
    const checkboxObserver = new MutationObserver(function() {
      if (mode === 'multi') addCheckboxes();
    });
    checkboxObserver.observe(getFeedGrid(), { childList: true, subtree: true });
    grid._sahCheckboxObserver = checkboxObserver;

    createBottomBar(false);
    setSelectionFeedback('Multi-select mode: click cards to choose items.');

    // Attach listeners immediately - buttons are already in DOM
    const refreshBtn = document.getElementById('sah-bar-refresh');
    const editBtn = document.getElementById('sah-bar-edit');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const items = getSelectedItems();
        if (!items.length) {
          sahLog('No items selected.');
          return;
        }
        sahLog('Starting batch relist for ' + items.length + ' item(s)...');
        exitCurrentMode();
        startBatchRelistJob(items);
      });
    }
    if (editBtn) {
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const items = getSelectedItems();
        if (!items.length) {
          sahLog('No items selected.');
          return;
        }
        sahLog('Starting edit description for ' + items.length + ' item(s)...');
        exitCurrentMode();
        startEditDescriptionJob(items);
      });
    }
  }

  function toggleSelect(gridItem, cbEl) {
    const data = getItemData(gridItem);
    sahLog('toggleSelect: id=' + data.id + ' title=' + data.title);
    if (!data.id) {
      sahLog('toggleSelect: no ID found, skipping');
      return;
    }
    if (selected.has(data.id)) {
      selected.delete(data.id);
      gridItem.classList.remove('sah-selected');
      if (cbEl) cbEl.classList.remove('sah-checkbox--checked');
      sahLog('Deselected: ' + data.title);
    } else {
      selected.add(data.id);
      gridItem.classList.add('sah-selected');
      if (cbEl) cbEl.classList.add('sah-checkbox--checked');
      sahLog('Selected: ' + data.title);
    }
    updateBottomBar();
    setSelectionFeedback(selected.size + (selected.size === 1 ? ' item selected' : ' items selected'));
  }

  function getSelectedItems() {
    const items = [];
    const seenIds = new Set();
    getFeedItems().forEach(function (item) {
      const data = getItemData(item);
      if (!data.id || seenIds.has(data.id)) return;
      if (selected.has(data.id)) {
        seenIds.add(data.id);
        items.push({ id: data.id, url: data.url, title: data.title, priceText: data.priceText });
      }
    });
    return items;
  }

  function updateBottomBar() {
    const el = document.getElementById('sah-count');
    const refreshBtn = document.getElementById('sah-bar-refresh');
    const editBtn = document.getElementById('sah-bar-edit');
    
    if (el) {
      const n = selected.size;
      el.textContent = n + (n === 1 ? ' item selected' : ' items selected');
    }
    
    // Enable/disable buttons based on selection
    const hasSelection = selected.size > 0;
    if (refreshBtn) refreshBtn.disabled = !hasSelection;
    if (editBtn) editBtn.disabled = !hasSelection;
  }

  // ── Single-select mode ───────────────────────────────────────────────────
  function enterSingleMode() {
    exitCurrentMode();
    mode = 'single';
    selected.clear();

    const grid = getFeedGrid();
    if (!grid) return;

    grid._sahHandler = function (e) {
      if (e.target.closest('#sah-bottom-bar')) {
        if (!e.target.closest('button')) return;
      }
      if (e.target.closest('#sah-toolbar') ||
          e.target.closest('#sah-log')) return;
      
      const item = resolveItemElement(e.target);
      if (!item) return;
      
      if (isSkippableItem(item)) {
        sahLog('Cannot select sold/hidden items');
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      selectSingle(item);
    };
    grid.addEventListener('click', grid._sahHandler, true);

    document.querySelectorAll('.sah-radio').forEach(function (el) { el.remove(); });
    function addRadios() {
      getFeedItems().forEach(function (item) {
        if (item.querySelector('.sah-radio')) return;
        const radio = document.createElement('div');
        radio.className = 'sah-radio';
        item.appendChild(radio);
      });
    }
    addRadios();
    const radioObserver = new MutationObserver(function() {
      if (mode === 'single') addRadios();
    });
    radioObserver.observe(getFeedGrid(), { childList: true, subtree: true });
    grid._sahRadioObserver = radioObserver;

    createBottomBar(true);
    setSelectionFeedback('Single-select mode: click one card to pick it.');

    // Attach listeners immediately - buttons are already in DOM
    const refreshBtn = document.getElementById('sah-bar-refresh');
    const editBtn = document.getElementById('sah-bar-edit');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const items = getSelectedItems();
        if (!items.length) {
          sahLog('No item selected.');
          return;
        }
        sahLog('Starting relist for: ' + items[0].title);
        exitCurrentMode();
        startRelistJob(items[0]);
      });
    }
    if (editBtn) {
      editBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const items = getSelectedItems();
        if (!items.length) {
          sahLog('No item selected.');
          return;
        }
        sahLog('Starting edit description for: ' + items[0].title);
        startEditDescriptionJob(items);
      });
    }
  }

  function selectSingle(gridItem) {
    const data = getItemData(gridItem);
    sahLog('selectSingle: id=' + data.id + ' title=' + data.title);
    if (!data.id) {
      sahLog('selectSingle: no ID found, skipping');
      return;
    }

    getFeedItems().forEach(function (item) {
      item.classList.remove('sah-selected');
      const radio = item.querySelector('.sah-radio');
      if (radio) radio.classList.remove('sah-radio--checked');
    });
    selected.clear();

    selected.add(data.id);
    gridItem.classList.add('sah-selected');
    const radio = gridItem.querySelector('.sah-radio');
    if (radio) radio.classList.add('sah-radio--checked');
    sahLog('Selected single item: ' + data.title);

    updateSingleBottomBar();
    setSelectionFeedback(selected.size === 1 ? '1 item selected' : 'No item selected');
  }

  function updateSingleBottomBar() {
    const countEl    = document.getElementById('sah-count');
    const refreshBtn = document.getElementById('sah-bar-refresh');
    const editBtn    = document.getElementById('sah-bar-edit');
    const hasItem    = selected.size === 1;
    if (countEl)    countEl.textContent = hasItem ? '1 item selected' : 'Select an item';
    if (refreshBtn) refreshBtn.disabled = !hasItem;
    if (editBtn)    editBtn.disabled    = !hasItem;
  }

  // ── Exit any active mode ─────────────────────────────────────────────────
  function exitCurrentMode() {
    const grid = getFeedGrid();
    if (grid && grid.classList) {
      grid.classList.remove('sah-multi-mode');
      if (grid._sahHandler) {
        grid.removeEventListener('click', grid._sahHandler, true);
        delete grid._sahHandler;
      }
      if (grid._sahCheckboxObserver) {
        grid._sahCheckboxObserver.disconnect();
        delete grid._sahCheckboxObserver;
      }
      if (grid._sahRadioObserver) {
        grid._sahRadioObserver.disconnect();
        delete grid._sahRadioObserver;
      }
    }
    document.querySelectorAll('.sah-checkbox').forEach(function (el) { el.remove(); });
    document.querySelectorAll('.sah-radio').forEach(function (el) { el.remove(); });
    getFeedItems().forEach(function (item) {
      item.classList.remove('sah-selected');
    });
    const bar = document.getElementById('sah-bottom-bar');
    if (bar) bar.remove();
    selected.clear();
    mode = null;
    setSelectionFeedback('Selection mode cancelled.');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── init ─────────────────────────────────────────────────────────────────
  function init() {
    if (RE_EDIT_PAGE.test(location.pathname)) {
      runEditJobOnEditPage();
      runRelistJobOnEditPage();
      return;
    }
    if (RE_NEW_PAGE.test(location.href)) {
      runRelistJobOnNewItemPage();
      return;
    }
    if (document.getElementById('sah-toolbar')) return;

    const shouldBootstrap = RE_MEMBER_PAGE.test(location.pathname) || document.querySelector(SEL_GRID);
    if (!shouldBootstrap) return;

    createLogBox();
    createToolbar();
    listenSahChannel();
    listenRelistLog();
  }

  // ── Entry point ──────────────────────────────────────────────────────────
  // Batch job recovery: redirect to correct page if we were sent somewhere unexpected.
  // Only fires when clickDraftAndFinish set the advance flag — prevents false redirects.
  (function () {
    try {
      if (!sessionStorage.getItem('sah-relist-advance')) return;
      var _rj = parseLocalStorage(SAH_RELIST_KEY);
      if (!_rj) { sessionStorage.removeItem('sah-relist-advance'); return; }
      if (_rj.phase === 'scrape' && _rj.itemId) {
        var _em = location.pathname.match(RE_EDIT_PAGE);
        if (!_em || String(_em[1]) !== String(_rj.itemId)) {
          sessionStorage.removeItem('sah-relist-advance');
          location.replace('https://www.vinted.pl/items/' + _rj.itemId + '/edit');
          return;
        }
      } else if (_rj.phase === 'relist') {
        if (!RE_NEW_PAGE.test(location.href)) {
          sessionStorage.removeItem('sah-relist-advance');
          location.replace('https://www.vinted.pl/items/new');
          return;
        }
      }
      sessionStorage.removeItem('sah-relist-advance');
    } catch (e) {}
  })();

  // Description-only refresh batch recovery: same pattern as relist.
  (function () {
    try {
      if (!sessionStorage.getItem('sah-edit-advance')) return;
      sessionStorage.removeItem('sah-edit-advance');
      var _ej = parseLocalStorage(SAH_JOB_KEY);
      if (!_ej || !_ej.queue || _ej.queue.length === 0) return;
      var _nextId = _ej.queue[0].id;
      var _ep = location.pathname.match(RE_EDIT_PAGE);
      if (!_ep || String(_ep[1]) !== String(_nextId)) {
        location.replace('https://www.vinted.pl/items/' + _nextId + '/edit');
      }
    } catch (e) {}
  })();

  let _didInit = false;

  function bootstrap() {
    if (RE_EDIT_PAGE.test(location.pathname)) {
      _didInit = true; init();
      return;
    }
    if (RE_NEW_PAGE.test(location.href)) {
      _didInit = true; init();
      return;
    }

    if (RE_MEMBER_PAGE.test(location.pathname) || document.querySelector(SEL_GRID)) {
      _didInit = true; init();
      return;
    }

    const observer = new MutationObserver(function () {
      if (_didInit) {
        observer.disconnect();
        return;
      }
      if (RE_MEMBER_PAGE.test(location.pathname) || document.querySelector(SEL_GRID)) {
        observer.disconnect();
        _didInit = true;
        init();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () {
      if (_didInit) return;
      observer.disconnect();
      if (RE_MEMBER_PAGE.test(location.pathname) || document.querySelector(SEL_GRID)) {
        _didInit = true;
        init();
      }
    }, 8000);
  }

  bootstrap();

  if (!_didInit) {
    // Advance pending edit job ONLY on item detail pages (after save redirect).
    // Guard against running on member/profile pages where the grid may not be
    // in the DOM yet — those must fall through to the MutationObserver below.
    const _isItemDetail = /\/items\/\d+/.test(location.pathname) &&
      !RE_EDIT_PAGE.test(location.pathname) &&
      !RE_NEW_PAGE.test(location.href);
    if (_isItemDetail) {
      const _job = parseLocalStorage(SAH_JOB_KEY);
      if (_job && _job.queue && _job.queue.length > 0) {
        _didInit = true;
        location.replace('https://www.vinted.pl/items/' + _job.queue[0].id + '/edit');
      }
      if (!_didInit) {
        const _rj = parseLocalStorage(SAH_RELIST_KEY);
        if (_rj && _rj.phase === 'scrape' && _rj.itemId) {
          _didInit = true;
          location.replace('https://www.vinted.pl/items/' + _rj.itemId + '/edit');
        } else if (_rj && _rj.phase === 'relist') {
          _didInit = true;
          location.replace('https://www.vinted.pl/items/new');
        }
      }
    }
  }

  if (!_didInit) {
    // Member page via SPA — wait for feed grid to appear.
    const _obs = new MutationObserver(function () {
      if (document.querySelector(SEL_GRID)) {
        _obs.disconnect();
        init();
      }
    });
    _obs.observe(document.body, { childList: true, subtree: true });
  }
})();
