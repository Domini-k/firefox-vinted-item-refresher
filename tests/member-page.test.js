'use strict';

const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPage, fixture } = require('./helpers');

const MEMBER_HTML = fixture('page-scrape-23-08-2026/royalitea-member-profile-vinted.html');
const memberHtml = MEMBER_HTML ? fs.readFileSync(MEMBER_HTML, 'utf8') : '';

const load = () => createPage(memberHtml, 'https://www.vinted.pl/member/119087255', { visible: false });

test('multi-select renders checkboxes and starts a batch relist', { skip: !MEMBER_HTML }, async () => {
  const page = load();
  await page.wait(200);

  page.click('#sah-tb-multi');
  await page.wait(100);

  const checkboxes = page.qa('.sah-checkbox');
  assert.ok(checkboxes.length > 0, 'checkboxes rendered over grid items');

  const link = page.q('a[data-testid$="--overlay-link"]');
  assert.ok(link, 'overlay link present');
  link.click();
  await page.wait(100);

  assert.match(page.q('#sah-count').textContent, /1 item selected/);
  assert.equal(page.qa('.sah-checkbox--checked').length, 1);
  assert.equal(page.q('#sah-bar-refresh').disabled, false);

  page.click('#sah-bar-refresh');
  await page.wait(100);

  const job = JSON.parse(page.storageData['sah-relist-job']);
  assert.equal(job.phase, 'scrape');
  assert.ok(job.itemId, 'relist job carries the item id');
  page.close();
});

test('single-select renders radios and starts a relist', { skip: !MEMBER_HTML }, async () => {
  const page = load();
  await page.wait(200);

  page.click('#sah-tb-single');
  await page.wait(100);

  const radios = page.qa('.sah-radio');
  assert.ok(radios.length > 0, 'radios rendered over grid items');

  const link = page.q('a[data-testid$="--overlay-link"]');
  link.click();
  await page.wait(100);

  assert.match(page.q('#sah-count').textContent, /1 item selected/);
  assert.equal(page.qa('.sah-radio--checked').length, 1);

  page.click('#sah-bar-refresh');
  await page.wait(100);

  const job = JSON.parse(page.storageData['sah-relist-job']);
  assert.ok(job.itemId, 'relist job carries the item id');
  page.close();
});

test('All descriptions scrolls, skips sold/hidden and queues the rest', { skip: !MEMBER_HTML, timeout: 30000 }, async () => {
  const page = load();
  await page.wait(200);

  page.click('#sah-tb-all-desc');

  // Scroll loop runs ~7.5s (5 stable checks x 1.5s). Poll the log for completion.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await page.wait(300);
    const logs = page.qa('#sah-log-entries .sah-log-entry').map((e) => e.textContent);
    if (logs.some((l) => l.includes('queued'))) break;
  }

  const raw = page.storageData['sah-edit-job'];
  assert.ok(raw, 'edit-description job was queued');
  const job = JSON.parse(raw);
  assert.ok(job.queue.length > 0, 'at least one eligible item queued');
  assert.ok(job.queue.length < page.qa('[data-testid="grid-item"]').length, 'sold/hidden items skipped');
  page.close();
});
