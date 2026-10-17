'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers');

const page = createPage(
  '<!DOCTYPE html><html><body></body></html>',
  'https://www.vinted.pl/member/1',
  {}
);

const extractSize = page.internals.extractSizeFromItemLabel;

test.after(() => page.close());

test('extracts a composite size from the member-card label', () => {
  const label = 'Sukienka, marka: Topshop, stan: Nowy z metką, rozmiar: L / 40 / 12, 49,00 zł';
  assert.equal(extractSize(label), 'L / 40 / 12');
});

test('extracts an alpha size from the member-card label', () => {
  const label = 'Bluzka, marka: ASOS, stan: Nowy, rozmiar: S, 29,00 zł';
  assert.equal(extractSize(label), 'S');
});

test('keeps commas inside child sizes', () => {
  const label = 'Body, marka: H&M, stan: Nowy, rozmiar: do 44 cm, wcześniaki, 20,00 zł';
  assert.equal(extractSize(label), 'do 44 cm, wcześniaki');
});

test('returns an empty string when there is no size', () => {
  assert.equal(extractSize('Zegarek, marka: Casio, stan: Nowy, 99,00 zł'), '');
  assert.equal(extractSize(''), '');
  assert.equal(extractSize(null), '');
});
