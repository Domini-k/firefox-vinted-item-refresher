'use strict';

const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPage, fixture } = require('./helpers');

const BRAND_HTML = fixture('page-scrape-23-08-2026/edit-item-page-elements/brand-dropdown/edytuj-ogłoszenie-vinted (2).html');
const COLOR_HTML = fixture('page-scrape-23-08-2026/edit-item-page-elements/color-dropdown/edytuj-ogłoszenie-vinted (1).html');

function buildPage() {
  const brand = fs.readFileSync(BRAND_HTML, 'utf8');
  let color = fs.readFileSync(COLOR_HTML, 'utf8');
  // Simulate Różowy + Koralowy already being selected.
  color = color
    .replace('aria-checked="false" aria-label="Różowy"', 'aria-checked="true" aria-label="Różowy"')
    .replace('aria-checked="false" aria-label="Koralowy"', 'aria-checked="true" aria-label="Koralowy"');

  const body =
    '<div><input data-testid="color-select-dropdown-input" id="color" readonly value="" />' +
    '<input data-testid="brand-select-dropdown-input" id="brand" readonly value="" />' +
    color +
    brand +
    '</div>';

  return createPage('<!DOCTYPE html><html><body>' + body + '</body></html>', 'https://www.vinted.pl/items/new', {});
}

const suiteOpts = { skip: !BRAND_HTML || !COLOR_HTML };

test('waitForMatchingOption finds an existing filtered option via polling', suiteOpts, async () => {
  const page = buildPage();
  const found = await new Promise((resolve) => {
    page.internals.waitForMatchingOption('Vero Moda', 1500, (ok) => resolve(ok));
  });
  assert.equal(found, true, 'existing "Vero Moda" option is found');
  page.close();
});

test('clickExistingOrNewOption selects the brand', suiteOpts, async () => {
  const page = buildPage();
  let clicked = false;
  page.document.addEventListener('sah-ext-click', (e) => {
    if (e.detail && e.detail.selector === '#brand-55') clicked = true;
  });
  const ok = await new Promise((resolve) => {
    page.internals.clickExistingOrNewOption('Vero Moda', 1500, (r) => resolve(r));
  });
  assert.equal(ok, true);
  assert.equal(clicked, true, '#brand-55 was clicked');
  page.close();
});

test('scrapeColorsFromDropdown returns the checked colors', suiteOpts, async () => {
  const page = buildPage();
  const colors = await new Promise((resolve) => {
    page.internals.scrapeColorsFromDropdown((c) => resolve(c));
  });
  // Compare via JSON: the array comes from the jsdom realm, so deepStrictEqual
  // fails on the Array prototype even though the values are identical.
  assert.equal(JSON.stringify(colors), JSON.stringify(['Różowy', 'Koralowy']));
  page.close();
});

test('clickExistingOrNewOption selects a color checkbox', suiteOpts, async () => {
  const page = buildPage();
  let clicked = false;
  page.document.addEventListener('sah-ext-click', (e) => {
    if (e.detail && e.detail.selector && e.detail.selector.indexOf('filter-grid-option-5') !== -1) clicked = true;
  });
  const ok = await new Promise((resolve) => {
    page.internals.clickExistingOrNewOption('Różowy', 1500, (r) => resolve(r));
  });
  assert.equal(ok, true);
  assert.equal(clicked, true, 'filter-grid-option-5 was clicked');
  page.close();
});
