'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers');

const EDIT_HTML = '<!DOCTYPE html><html><body>' +
  '<textarea data-testid="description--input"></textarea>' +
  '<button data-testid="upload-form-save-button">Save</button>' +
  '</body></html>';

function jobWith(extra) {
  return {
    queue: [{ id: '555', url: 'https://www.vinted.pl/items/555', title: 'Test item' }],
    done: [],
    returnUrl: 'https://www.vinted.pl/member/1',
    ...extra
  };
}

// Resolves when the edit job actually starts editing (pause released).
function waitForEditStart(page, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const t = setInterval(() => {
      const st = page.q('#sah-edit-status');
      const txt = st ? st.textContent : '';
      if (/Waiting for form|Setting description/.test(txt)) {
        clearInterval(t);
        resolve(Date.now() - started);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(t);
        resolve(-1);
      }
    }, 20);
  });
}

test('edit job respects the configured pause (remaining time)', async () => {
  const page = createPage(EDIT_HTML, 'https://www.vinted.pl/items/555/edit', {
    pauseSeconds: 5,
    storage: { 'sah-edit-job': JSON.stringify(jobWith({ lastDoneAt: Date.now() - 1000 })) }
  });
  const elapsed = await waitForEditStart(page, 9000);
  assert.ok(elapsed >= 3500 && elapsed <= 6000, 'waited remaining pause (~4s), got ' + elapsed + 'ms');
  page.close();
});

test('edit job proceeds immediately when the pause already elapsed', async () => {
  const page = createPage(EDIT_HTML, 'https://www.vinted.pl/items/555/edit', {
    pauseSeconds: 5,
    storage: { 'sah-edit-job': JSON.stringify(jobWith({ lastDoneAt: Date.now() - 6000 })) }
  });
  const elapsed = await waitForEditStart(page, 4000);
  assert.ok(elapsed >= 0 && elapsed < 1500, 'started immediately, got ' + elapsed + 'ms');
  page.close();
});

test('edit job starts immediately for the first item (no lastDoneAt)', async () => {
  const page = createPage(EDIT_HTML, 'https://www.vinted.pl/items/555/edit', {
    pauseSeconds: 5,
    storage: { 'sah-edit-job': JSON.stringify(jobWith({})) }
  });
  const elapsed = await waitForEditStart(page, 4000);
  assert.ok(elapsed >= 0 && elapsed < 1500, 'started immediately, got ' + elapsed + 'ms');
  page.close();
});
