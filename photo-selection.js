(function (root) {
  'use strict';

  function normalizeUrl(url) {
    return typeof url === 'string' ? url.trim() : '';
  }

  function isVintedImageUrl(url) {
    const value = normalizeUrl(url);
    return !!value && (value.includes('images1.vinted.net') || value.includes('images2.vinted.net'));
  }

  function getQualityScore(url) {
    const value = normalizeUrl(url);
    if (!value) return 0;

    const hasTc = value.includes('/tc/');
    const hasF800 = value.includes('/f800/');
    const hasF600 = value.includes('/f600/');
    const hasF400 = value.includes('/f400/');
    const hasF200 = value.includes('/f200/');

    let score = 0;
    if (hasTc) score += 100;
    if (hasF800) score += 80;
    else if (hasF600) score += 60;
    else if (hasF400) score += 40;
    else if (hasF200) score += 20;

    if (value.includes('/f800/')) score += 20;
    if (value.includes('/tc/')) score += 10;

    return score;
  }

  function selectBestPhotoUrl(urls) {
    const values = (urls || [])
      .map(normalizeUrl)
      .filter(isVintedImageUrl)
      .filter(Boolean);

    if (!values.length) return '';

    return values.reduce(function (best, current) {
      if (!best) return current;
      if (getQualityScore(current) > getQualityScore(best)) return current;
      return best;
    }, '');
  }

  function collectPhotoUrlsFromItem(item) {
    const photos = [];
    const seen = new Set();

    try {
      const rawPhotos = item && item.photos;
      if (!Array.isArray(rawPhotos)) return photos;

      rawPhotos.forEach(function (photo) {
        if (!photo || photo.is_user_photo) return;

        const candidates = [];
        if (photo.full_size_url) candidates.push(photo.full_size_url);
        if (photo.url) candidates.push(photo.url);
        if (Array.isArray(photo.thumbnails)) {
          photo.thumbnails.forEach(function (thumb) {
            if (thumb && thumb.url) candidates.push(thumb.url);
          });
        }

        const best = selectBestPhotoUrl(candidates);
        if (best && !seen.has(best)) {
          seen.add(best);
          photos.push(best);
        }
      });
    } catch (e) {
      return [];
    }

    return photos;
  }

  const api = { selectBestPhotoUrl, collectPhotoUrlsFromItem, isVintedImageUrl, getQualityScore };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.photoSelection = api;
  root.__sahPhotoSelection = api;

  // Firefox: the content-script sandbox global and the xrayed page window are
  // distinct. content.js reads the helpers off `window`, so publish there too.
  try {
    if (typeof window !== 'undefined' && window !== root) {
      window.photoSelection = api;
      window.__sahPhotoSelection = api;
    }
  } catch (e) {}
}(typeof globalThis !== 'undefined' ? globalThis : this));
