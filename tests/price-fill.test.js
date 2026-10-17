'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers');

function buildPage() {
  return createPage(
    '<!DOCTYPE html><html><body>' +
      '<input data-testid="price-input--input" id="price" type="text" value="" />' +
    '</body></html>',
    'https://www.vinted.pl/items/new',
    {}
  );
}

test('normalizePriceValue handles localized and numeric prices', () => {
  const page = buildPage();
  const normalize = page.internals.normalizePriceValue;

  assert.equal(normalize('49,00 zł'), '49,00');
  assert.equal(normalize('49.00'), '49,00');
  assert.equal(normalize('1.234,56 zł'), '1234,56');
  assert.equal(normalize('1,234.56'), '1234,56');
  assert.equal(normalize('1.234'), '1234');
  assert.equal(normalize('1 234,50 zł'), '1234,50');
  assert.equal(normalize(''), '');
  assert.equal(normalize(null), '');
  page.close();
});

test('fillPrice sets a normalized price value', async () => {
  const page = buildPage();
  const input = page.q('[data-testid="price-input--input"]');

  const ok = await new Promise((resolve) => {
    page.internals.fillPrice('49,00 zł', resolve);
  });

  assert.equal(ok, true);
  assert.equal(input.value, '49,00');
  page.close();
});

test('fillPrice retries when the setter leaves a dot decimal', async () => {
  const page = buildPage();
  const input = page.q('[data-testid="price-input--input"]');
  let allowTyping = false;

  input.addEventListener('keydown', () => { allowTyping = true; });
  input.addEventListener('input', () => {
    if (!allowTyping) input.value = input.value.replace(',', '.');
  });

  const ok = await new Promise((resolve) => {
    page.internals.fillPrice('49.99', resolve);
  });

  assert.equal(ok, true);
  assert.equal(page.internals.normalizePriceValue(input.value), '49,99');
  assert.equal(String(input.value).includes(','), true);
  page.close();
});

test('fillPrice falls back to typing when the setter does not stick', async () => {
  const page = buildPage();
  const input = page.q('[data-testid="price-input--input"]');
  let allowTyping = false;

  input.addEventListener('keydown', () => { allowTyping = true; });
  input.addEventListener('input', () => {
    if (!allowTyping) input.value = '';
  });

  const ok = await new Promise((resolve) => {
    page.internals.fillPrice('49.99', resolve);
  });

  assert.equal(ok, true);
  assert.equal(page.internals.normalizePriceValue(input.value), '49,99');
  page.close();
});
