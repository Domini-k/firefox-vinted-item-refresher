const test = require('node:test');
const assert = require('node:assert/strict');

const photoSelection = require('../photo-selection.js');
const jobDelay = require('../job-delay.js');

test('prefers the lossless /tc/ challenge URL over scaled fallbacks', function () {
  const best = photoSelection.selectBestPhotoUrl([
    'https://images1.vinted.net/t/03_0039f_dhLpHTe7FZzApiftFsPV6baH/f600/1784569397.webp?s=abc',
    'https://images1.vinted.net/t/03_0039f_dhLpHTe7FZzApiftFsPV6baH/f800/1784569397.webp?s=def',
    'https://images1.vinted.net/tc/03_0039f_dhLpHTe7FZzApiftFsPV6baH/1784569397.webp?s=ghi'
  ]);

  assert.equal(best, 'https://images1.vinted.net/tc/03_0039f_dhLpHTe7FZzApiftFsPV6baH/1784569397.webp?s=ghi');
});

test('collects the best URL from photo objects that expose multiple variants', function () {
  const urls = photoSelection.collectPhotoUrlsFromItem({
    photos: [
      {
        full_size_url: 'https://images1.vinted.net/t/06_01243_EPQCFiBuSSY8sZ6HJUz9Co4h/f600/1784569397.webp?s=one',
        url: 'https://images1.vinted.net/t/06_01243_EPQCFiBuSSY8sZ6HJUz9Co4h/f800/1784569397.webp?s=two',
        thumbnails: [
          { url: 'https://images1.vinted.net/t/06_01243_EPQCFiBuSSY8sZ6HJUz9Co4h/1784569397.webp?s=thumb' }
        ]
      }
    ]
  });

  assert.deepEqual(urls, [
    'https://images1.vinted.net/t/06_01243_EPQCFiBuSSY8sZ6HJUz9Co4h/f800/1784569397.webp?s=two'
  ]);
});

test('parses the pause setting as seconds for the job delay helper', function () {
  assert.equal(jobDelay.normalizePauseSeconds('10'), 10);
  assert.equal(jobDelay.normalizePauseSeconds('-1'), 0);
  assert.equal(jobDelay.getPauseMs('5', 1000), 5000);
});
