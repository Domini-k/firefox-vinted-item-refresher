'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers');

const page = createPage(
  '<!DOCTYPE html><html><body></body></html>',
  'https://www.vinted.pl/member/1',
  {}
);

const truncateTitle = page.internals.truncateTitle;

test.after(() => page.close());

test('keeps titles at or below the limit unchanged', () => {
  assert.equal(truncateTitle('a'.repeat(99)), 'a'.repeat(99));
  assert.equal(truncateTitle('a'.repeat(100)), 'a'.repeat(100));
});

test('truncates titles above the limit to 100 characters', () => {
  const result = truncateTitle('a'.repeat(101));
  assert.equal(result.length, 100);
  assert.equal(result, 'a'.repeat(100));

  const withTail = truncateTitle('a'.repeat(100) + ' EXTRA');
  assert.equal(withTail.length, 100);
  assert.equal(withTail, 'a'.repeat(100));
});

test('trims surrounding whitespace', () => {
  assert.equal(truncateTitle('  Title  '), 'Title');
  assert.equal(truncateTitle('a'.repeat(100) + '   '), 'a'.repeat(100));
});

test('never leaves a dangling high surrogate at the cut', () => {
  const value = 'a'.repeat(99) + '\uD83D\uDE00'; // 99 chars + emoji (2 code units)
  const result = truncateTitle(value);
  assert.equal(result, 'a'.repeat(99));
  assert.equal(/[\uD800-\uDBFF]$/.test(result), false);
});

test('keeps a complete emoji within the limit', () => {
  const value = 'a'.repeat(98) + '\uD83D\uDE00';
  assert.equal(truncateTitle(value), value);
});

test('handles null and undefined', () => {
  assert.equal(truncateTitle(null), '');
  assert.equal(truncateTitle(undefined), '');
});

test('calls the callback only when truncation happens', () => {
  let calls = 0;
  let before = 0;
  let after = 0;

  truncateTitle('a'.repeat(100), (b, a) => {
    calls++;
    before = b;
    after = a;
  });
  assert.equal(calls, 0);

  const result = truncateTitle('a'.repeat(101), (b, a) => {
    calls++;
    before = b;
    after = a;
  });
  assert.equal(result.length, 100);
  assert.equal(calls, 1);
  assert.equal(before, 101);
  assert.equal(after, 100);
});
