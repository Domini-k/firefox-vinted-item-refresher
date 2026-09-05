# Vinted Item Refresher — Firefox Add-on (MV3)

A Firefox port of the [Chrome extension](https://github.com/djagodzki/chrome-vinted-item-refresher).
It works exactly the same as the Chrome version. This manifest is Firefox-only and
requires **Firefox 128+** (the `content_scripts[].world: "MAIN"` key needs it).

## Loading in Firefox

1. Run `node generate-icons.js` once to create the `icons/` folder (already done if it exists)
2. Open Firefox → `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select `manifest.json` in this folder (`firefox-vinted-item-refresher/`)
5. Navigate to `https://www.vinted.pl/member/<your-id>`

> A temporary add-on loses its ID (`browser_specific_settings.gecko.id`) and stored
> settings on browser restart. For a persistent install, use `web-ext` or sign the
> add-on on AMO.

---

## Using the extension

Click the **VR** button fixed to the bottom-right corner of the page.

### Select multiple
- Checkboxes appear on every listing card
- Click anywhere on a card (or its checkbox) to toggle selection
- Bottom bar shows count + two action buttons
- **Full Refresh** / **Edit Description** → starts the selected job
- **✕ Cancel** → exits mode and removes all checkboxes

### Refresh one item
- Cursor changes to crosshair over listing cards
- Click any card → selects it, bottom bar enables
- **Full Refresh** / **Edit Description** → starts that job
- **✕ Cancel** → exits mode

**Full Refresh** scrapes the item's title, description, price, photos and attributes
(category, brand, size, condition, colours, materials, shipment size) from the edit
page, then opens `/items/new`, auto-fills the form, re-uploads the photos and saves a
draft. **Edit Description** appends ` Polecam!` (with one randomised unicode space) to
each item's description and saves.

---

## Popup / toolbar

The toolbar popup shows the running queue, lets you set a **pause between jobs**
(seconds) and **Stop all jobs**. Job state lives in `localStorage` on vinted.pl under
`https://www.vinted.pl` origin and advances across tabs; the on-screen **Log** box
mirrors progress live via `BroadcastChannel('sah-vr')`.

---

## Project structure

```
manifest.json        MV3 manifest (Firefox: background.scripts, gecko id, FF128+)
content.js           All extension logic — toolbar, job queues, form filling
content.css          Injected styles — all classes prefixed sah-
content-main.js      MAIN-world bridge for React event interaction (world: "MAIN")
background.js        Background event page — CORS image proxy fallback
photo-selection.js   Photo URL quality scoring / best-photo selection
job-delay.js         Job pause (seconds) normalisation
popup.html/js/css    Browser action popup
generate-icons.js    One-time: creates icons/ with 16/48/128px PNGs
icons/               Generated teal PNG icons
tests/               Node test suite (jsdom) — npm test
learning-sources/    Reference: saved Vinted page DOM (fixtures for the test suite)
```

## Where selectors are defined

All DOM selectors are constants at the top of `content.js` (lines 7–13):

```js
const SEL_GRID      = '.feed-grid, [data-testid="feed-grid"], [data-testid="feed-grid-content"], [class$="__feed-grid"]';
const SEL_GRID_ITEM = '[data-testid="grid-item"], [data-testid="feed-grid-item"]';
const SEL_CARD_ITEM = '[data-testid^="product-item-id-"], .new-item-box__container';
const SEL_CARD      = '[data-testid^="product-item-id-"]';
const SEL_LINK      = 'a[data-testid$="--overlay-link"], a.new-item-box__overlay--clickable, a[href*="/items/"]';
const SEL_THUMB     = 'img[data-testid$="--image--img"]';
const SEL_PRICE     = 'p[data-testid$="--price-text"]';
```

If Vinted updates their DOM, adjust these constants only — no other changes needed.

---

## Firefox-specific notes (vs the Chrome build)

- **Firefox-only manifest**: `background.scripts` (Chrome MV3 uses a service worker)
  plus `browser_specific_settings.gecko`. Chrome will not load this manifest.
- **`chrome.*` namespace retained**: Firefox aliases `chrome` with callback support,
  so `background.js`, `popup.js` and `content.js` needed no API rewrite.
- **Xray vision**: Firefox content scripts run in an isolated sandbox with Xray
  vision over the page. Two code paths were adapted:
  - `content.js` `bridgeDetail()` `cloneInto()`s the `CustomEvent` detail so the
    MAIN-world script can read it (Chrome passes it through unchanged).
  - `content.js` `getNextData()` reads page data via the `<script id="__NEXT_DATA__">`
    element or `window.wrappedJSObject`, not `window.__NEXT_DATA__` directly.
- Popup blocking on the programmatic `window.open(...)` can be stricter in Firefox;
  if a job reports *"Popup blocked"*, allow popups for `vinted.pl` (or click the
  toolbar's VR button / popup once first).

---

## Tests

Run the test suite with `npm test` (after `npm install`). It covers the member-page
selection/relist flows, dropdown filling (brand/color), the job pause, and
beforeunload suppression. Tests that need a live Vinted page snapshot are skipped
automatically when the fixture file is missing from `learning-sources/` — re-export
the current page HTML to re-enable them.
