'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers');

const EDIT_HTML = '<!DOCTYPE html><html><body>' +
  '<textarea data-testid="description--input"></textarea>' +
  '<button data-testid="upload-form-save-button">Save</button>' +
  '</body></html>';

test('beforeunload prompt is suppressed while the job navigates to the next item', async () => {
  const page = createPage(EDIT_HTML, 'https://www.vinted.pl/items/555/edit', {
    storage: {
      'sah-edit-job': JSON.stringify({
        queue: [{ id: '555', url: 'https://www.vinted.pl/items/555', title: 'Test item' }],
        done: [],
        returnUrl: 'https://www.vinted.pl/member/1',
        lastDoneAt: Date.now() - 6000
      })
    }
  });

  // Simulate Vinted's dirty-form beforeunload handler (bubble phase).
  let vintedRan = false;
  page.window.addEventListener('beforeunload', function (e) {
    vintedRan = true;
    e.preventDefault();
    e.returnValue = 'Changes you made may not be saved.';
  });

  // Let the job reach the save click + silenceLeavePrompt (save grace is 4s,
  // but the silencer is installed synchronously at the save click, ~800ms in).
  await page.wait(1500);

  const ev = new page.window.Event('beforeunload', { cancelable: true });
  page.window.dispatchEvent(ev);

  assert.equal(vintedRan, false, 'Vinted beforeunload handler was suppressed');
  assert.equal(ev.defaultPrevented, false, 'no leave-page confirmation would be shown');
  page.close();
});
