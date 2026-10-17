'use strict';

const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPage, fixture } = require('./helpers');

const SIZE_HTML = fixture('ui-changes-snapshots/size-menu-changes-on-item-add-screen.html');
const SIZE_HTML_NO_CHIPS = fixture('ui-changes-snapshots/2.size-menu-changes-on-item-add-screen.html');

function buildPage(options) {
  const o = options || {};
  const snapshot = o.includeSnapshot === false
    ? ''
    : fs.readFileSync(o.snapshotPath || SIZE_HTML, 'utf8');
  const body =
    '<div>' +
      '<input data-testid="category-size-single-grid-input" id="size" readonly value="" />' +
      '<span data-testid="category-size-single-grid-chevron-down"></span>' +
      '<div id="size-slot">' + snapshot + '</div>' +
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
  const input = page.q('[data-testid="category-size-single-grid-input"], input#size');
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
const noChipsOpts = { skip: !SIZE_HTML_NO_CHIPS };

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

test('fillSize finds the size input by id when the data-testid changes', suiteOpts, async () => {
  const snapshot = fs.readFileSync(SIZE_HTML, 'utf8');
  const page = createPage(
    '<!DOCTYPE html><html><body>' +
      '<input id="size" name="size" readonly value="" />' +
      '<span data-testid="category-size-single-grid-chevron-down"></span>' +
      '<div id="size-slot">' + snapshot + '</div>' +
    '</body></html>',
    'https://www.vinted.pl/items/new',
    {}
  );

  const root = page.internals.sizeDropdownRoot();
  wireChips(page);
  wireOptions(page, root);

  const ok = await new Promise((resolve) => {
    page.internals.fillSize('M / 38 / 10', resolve);
  });

  assert.equal(ok, true);
  assert.equal(page.q('#size').value, 'M');
  page.close();
});

test('fillSize supports the category-size-single-grid_chips testid variant', suiteOpts, async () => {
  const snapshot = fs.readFileSync(SIZE_HTML, 'utf8');
  const page = createPage(
    '<!DOCTYPE html><html><body>' +
      '<input data-testid="category-size-single-grid_chips-input" id="size" name="size" readonly value="" />' +
      '<span data-testid="category-size-single-grid_chips-chevron-down"></span>' +
      '<div id="size-slot">' + snapshot + '</div>' +
    '</body></html>',
    'https://www.vinted.pl/items/new',
    {}
  );

  const root = page.internals.sizeDropdownRoot();
  wireChips(page);
  wireOptions(page, root);

  const ok = await new Promise((resolve) => {
    page.internals.fillSize('M / 38 / 10', resolve);
  });

  assert.equal(ok, true);
  assert.equal(page.q('[data-testid="category-size-single-grid_chips-input"]').value, 'M');
  page.close();
});

test('fillSize clicks S/M/L before selecting from the grid', async () => {
  const page = createPage(
    '<!DOCTYPE html><html><body>' +
      '<input data-testid="category-size-single-grid-input" id="size" readonly value="" />' +
      '<span data-testid="category-size-single-grid-chevron-down"></span>' +
      '<div class="web_ui__Card__card">' +
        '<div data-testid="size-grid-chips">' +
          '<div><button type="button">S/M/L</button></div>' +
          '<div><button type="button">EU</button></div>' +
        '</div>' +
        '<div id="grid"></div>' +
      '</div>' +
    '</body></html>',
    'https://www.vinted.pl/items/new',
    {}
  );

  const sml = page.qa('[data-testid="size-grid-chips"] button')
    .find((button) => button.textContent.trim() === 'S/M/L');
  assert.ok(sml, 'S/M/L chip exists');

  sml.addEventListener('click', () => {
    sml.setAttribute('aria-pressed', 'true');
    page.q('#grid').innerHTML =
      '<ul>' +
        '<li><div role="checkbox" aria-checked="false" aria-label="M" data-testid="size-group-80-grid-option-1739"><span>M</span></div></li>' +
        '<li><div role="checkbox" aria-checked="false" aria-label="L" data-testid="size-group-80-grid-option-1740"><span>L</span></div></li>' +
      '</ul>';
    const root = page.internals.sizeDropdownRoot();
    wireOptions(page, root);
  });

  const ok = await new Promise((resolve) => {
    page.internals.fillSize('M / 38 / 10', resolve);
  });

  assert.equal(ok, true);
  assert.equal(page.q('[data-testid="category-size-single-grid-input"]').value, 'M');
  page.close();
});

test('fillSize works without a chip bar (single size grid)', noChipsOpts, async () => {
  const page = buildPage({ snapshotPath: SIZE_HTML_NO_CHIPS });
  const root = page.internals.sizeDropdownRoot();
  assert.ok(root, 'size grid root found without chips');
  wireOptions(page, root);

  const ok = await new Promise((resolve) => {
    page.internals.fillSize('L / 40 / 12', resolve);
  });

  assert.equal(ok, true);
  assert.equal(page.q('[data-testid="category-size-single-grid-input"]').value, 'L');
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

test('fillSize waits for a delayed size dropdown render', suiteOpts, async () => {
  const page = buildPage({ includeSnapshot: false });
  const snapshot = fs.readFileSync(SIZE_HTML, 'utf8');

  setTimeout(() => {
    page.q('#size-slot').innerHTML = snapshot;
    const root = page.internals.sizeDropdownRoot();
    wireChips(page);
    wireOptions(page, root);
  }, 800);

  const ok = await new Promise((resolve) => {
    page.internals.fillSize('M / 38 / 10', resolve);
  });

  assert.equal(ok, true);
  assert.equal(page.q('[data-testid="category-size-single-grid-input"]').value, 'M');
  page.close();
});

test('fillSize survives the chip bar being replaced after a chip click', suiteOpts, async () => {
  const page = buildPage();
  const root = page.internals.sizeDropdownRoot();
  wireChips(page);
  wireOptions(page, root);

  const euChip = page.qa('[data-testid="size-grid-chips"] button')
    .find((button) => button.textContent.trim() === 'EU');
  assert.ok(euChip, 'EU chip exists');

  euChip.addEventListener('click', () => {
    const replacement = page.document.createElement('div');
    replacement.className = 'web_ui__Card__card';
    replacement.innerHTML =
      '<div data-testid="size-grid-chips">' +
        '<div><button type="button" aria-pressed="false">S/M/L</button></div>' +
        '<div><button type="button" aria-pressed="true">EU</button></div>' +
      '</div>' +
      '<ul>' +
        '<li><div role="checkbox" aria-checked="false" aria-label="38" data-testid="size-group-90-grid-option-38"><span>38</span></div></li>' +
      '</ul>';
    root.replaceWith(replacement);
    wireChips(page);
    wireOptions(page, replacement);
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
