'use strict';

const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPage, fixture } = require('./helpers');

const SIZE_HTML = fixture('ui-changes-snapshots/size-menu-changes-on-item-add-screen.html');

function buildPage() {
  const snapshot = fs.readFileSync(SIZE_HTML, 'utf8');
  const body =
    '<div>' +
      '<input data-testid="category-size-single-grid-input" id="size" readonly value="" />' +
      '<span data-testid="category-size-single-grid-chevron-down"></span>' +
      snapshot +
    '</div>';

  return createPage(
    '<!DOCTYPE html><html><body>' + body + '</body></html>',
    'https://www.vinted.pl/items/new',
    {}
  );
}

function wireChips(page) {
  const buttons = page.qa('[data-testid="size-grid-chips"] button');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      buttons.forEach((other) => other.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
    });
  });
}

function wireOptions(page, root) {
  const input = page.q('[data-testid="category-size-single-grid-input"]');
  const options = Array.from(root.querySelectorAll('[role="checkbox"]'));
  options.forEach((option) => {
    option.addEventListener('click', () => {
      options.forEach((other) => other.setAttribute('aria-checked', 'false'));
      option.setAttribute('aria-checked', 'true');
      input.value = option.getAttribute('aria-label') || option.textContent.trim();
    });
  });
}

function selectChip(page, label) {
  const button = page.qa('[data-testid="size-grid-chips"] button')
    .find((candidate) => candidate.textContent.trim() === label);
  assert.ok(button, 'chip exists: ' + label);
  button.setAttribute('aria-pressed', 'true');
  page.qa('[data-testid="size-grid-chips"] button').forEach((other) => {
    if (other !== button) other.setAttribute('aria-pressed', 'false');
  });
}

const suiteOpts = { skip: !SIZE_HTML };

test('parseSizeValue splits composite sizes into tokens', suiteOpts, () => {
  const page = buildPage();
  const parsed = page.internals.parseSizeValue('M / 38 / 10');
  assert.equal(JSON.stringify(parsed.tokens), JSON.stringify(['M', '38', '10']));
  assert.equal(JSON.stringify(parsed.alpha), JSON.stringify(['M']));
  assert.equal(JSON.stringify(parsed.numeric), JSON.stringify(['38', '10']));
  page.close();
});

test('scrapeSelectedSize falls back to a checked size option', suiteOpts, () => {
  const page = buildPage();
  const root = page.internals.sizeDropdownRoot();
  wireOptions(page, root);

  const option = page.q('[data-testid="size-group-80-grid-option-1739"]');
  option.setAttribute('aria-checked', 'true');

  assert.equal(page.internals.scrapeSelectedSize(), 'M');
  page.close();
});

test('fillSize selects the alpha token on the default S/M/L chip', suiteOpts, async () => {
  const page = buildPage();
  const root = page.internals.sizeDropdownRoot();
  wireChips(page);
  wireOptions(page, root);

  const ok = await new Promise((resolve) => {
    page.internals.fillSize('M / 38 / 10', resolve);
  });

  assert.equal(ok, true);
  assert.equal(page.q('[data-testid="category-size-single-grid-input"]').value, 'M');
  page.close();
});

test('fillSize selects a numeric token when a numeric chip is active', suiteOpts, async () => {
  const page = buildPage();
  const root = page.internals.sizeDropdownRoot();
  wireChips(page);
  selectChip(page, 'EU');

  const list = root.querySelector('ul');
  list.innerHTML =
    '<li><div role="checkbox" aria-checked="false" aria-label="38" data-testid="size-group-90-grid-option-38"><span>38</span></div></li>' +
    '<li><div role="checkbox" aria-checked="false" aria-label="10" data-testid="size-group-90-grid-option-10"><span>10</span></div></li>';
  wireOptions(page, root);

  const ok = await new Promise((resolve) => {
    page.internals.fillSize('M / 38 / 10', resolve);
  });

  assert.equal(ok, true);
  assert.equal(page.q('[data-testid="category-size-single-grid-input"]').value, '38');
  page.close();
});

test('fillSize switches chips when the active chip has no match', suiteOpts, async () => {
  const page = buildPage();
  const root = page.internals.sizeDropdownRoot();
  wireChips(page);
  wireOptions(page, root);

  const euChip = page.qa('[data-testid="size-grid-chips"] button')
    .find((button) => button.textContent.trim() === 'EU');
  assert.ok(euChip, 'EU chip exists');

  euChip.addEventListener('click', () => {
    root.querySelector('ul').innerHTML =
      '<li><div role="checkbox" aria-checked="false" aria-label="38" data-testid="size-group-90-grid-option-38"><span>38</span></div></li>' +
      '<li><div role="checkbox" aria-checked="false" aria-label="10" data-testid="size-group-90-grid-option-10"><span>10</span></div></li>';
    wireOptions(page, root);
  });

  const ok = await new Promise((resolve) => {
    page.internals.fillSize('Q / 38 / 10', resolve);
  });

  assert.equal(ok, true);
  assert.equal(page.q('[data-testid="category-size-single-grid-input"]').value, '38');
  page.close();
});

test('fillSize returns false and leaves the value empty when no option matches', suiteOpts, async () => {
  const page = buildPage();
  const root = page.internals.sizeDropdownRoot();
  wireChips(page);
  wireOptions(page, root);

  const ok = await new Promise((resolve) => {
    page.internals.fillSize('Q / 99 / 999', resolve);
  });

  assert.equal(ok, false);
  assert.equal(page.q('[data-testid="category-size-single-grid-input"]').value, '');
  page.close();
});
