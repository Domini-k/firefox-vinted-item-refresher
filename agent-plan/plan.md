# Implementation Plan — Firefox Vinted Item Refresher

Last updated: 2026-10-17
Current version: 1.4.10 (uncommitted local bump; Phase 5 follow-up changes uncommitted)
Default branch: `main`

> Working agreement: update this file after every implementation session and
> whenever a new requirement, decision, or blocker is established — even before
> the related code is written.

## Status checklist

- [x] Phase 1 — Clean, versioned XPI build
- [x] Phase 1.5 — Build docs, `.env` support, AMO signing
- [x] Phase 1.6 — Two-command release workflow + version alignment
- [x] Phase 2 — Title length validation (max 100 characters)
- [x] Phase 3 — ROZMIAR UI fix
- [x] Phase 4 — GitHub Actions unsigned + manual signed releases
- [~] Phase 5 — Live size/price reliability fixes (implemented; live verification pending)

Legend: `[x]` done · `[ ]` not started · `[~]` implemented but not yet verified

---

## Current state

### Done

- `scripts/build-xpi.js`
  - Runtime-file allowlist.
  - Manifest/package version validation.
  - Versioned output: `firefox-permanent-addon-file-build/firefox-vinted-item-refresher-<version>.xpi`.
- `scripts/sign-xpi.js`
  - AMO unlisted signing through `web-ext sign`.
  - Output: `firefox-vinted-item-refresher-<version>-signed.xpi`.
- `scripts/version.js`
  - Reads the current version.
  - Validates `X.Y.Z` versions.
  - Increments the patch version.
  - Updates `manifest.json`, `package.json`, and `package-lock.json`.
  - Verifies all version files after updating.
- `scripts/release-xpi.js`
  - `npm run release` bumps the patch version and builds the unsigned XPI.
  - `npm run release -- 1.4.6` uses an explicit version.
  - `--bump-only` updates version files without building (used by CI).
  - Does not sign, commit, tag, or push.
- `scripts/release-assets.js`
  - `carry-forward` copies the latest signed XPI into a new release.
  - `publish-signed` uploads a signed XPI to its release and newer releases.
  - Never downgrades a newer signed asset.
- `scripts/amo-signing.js`
  - Shared AMO JWT, status lookup, download, and SHA-256 verification.
  - Shared polling used by both signing and recovery.
- `scripts/download-signed-xpi.js`
  - Downloads a signed XPI directly from AMO by version.
  - Verifies the SHA-256 hash reported by AMO.
  - Supports `--wait`, `--timeout`, and `--interval` while AMO is still approving.
  - Used as `npm run download:signed -- <version>`.
- `content.js` title handling
  - `TITLE_MAX_LENGTH = 100`.
  - `truncateTitle()` trims whitespace and limits titles without splitting surrogate pairs.
  - Applied during scrape, feed-title fallback, and before filling the new-item title field.
  - Logs original/final lengths when truncation happens.
- `tests/title-length.test.js` — 7 tests covering limits, whitespace, emoji boundaries, null/undefined, and callback behavior.
- `content.js` ROZMIAR handling
  - `parseSizeValue()` splits composite sizes such as `M / 38 / 10`.
  - `fillSize()` uses `size-grid-chips`, prefers alpha sizes on `S/M/L`, and falls back to numeric chip switching.
  - `scrapeSelectedSize()` falls back to checked size options; `__NEXT_DATA__` size is used when the DOM value is empty.
  - Failure logs the active chips and visible options.
- `learning-sources/ui-changes-snapshots/size-menu-changes-on-item-add-screen.html` — ROZMIAR markup fixture.
- `tests/size-selection.test.js` — 12 tests covering parsing, scrape fallback, `_chips` testid, id fallback, alpha/numeric selection, explicit S/M/L chip click, chip switching, no-chip grid, delayed render, node replacement, and no-match behavior.
- `tests/price-fill.test.js` — 4 tests covering price normalization, setter fill, strict decimal localization, and typing fallback.
- `tests/item-metadata.test.js` — 4 tests covering size extraction from member-card labels, including child sizes with commas.
- `content.js` reliability fixes:
  - `fillSize()` waits up to 6s for the dropdown, re-queries the root/chips/options after re-renders, and retries via child/parent click targets.
  - `sizeDropdownRoot()` also supports categories with no chip bar (single size grid).
  - Enhanced size failure diagnostics list size-related elements and visible controls.
  - `fillPrice()` normalizes localized prices, requires comma decimals to be localized, verifies the input value, and falls back to character typing.
- `package.json`
  - `build:xpi` → build current version.
  - `sign:xpi` → sign current version.
  - `release` → bump patch + build unsigned.
  - `release:sign` → sign current version on demand.
  - `web-ext` devDependency.
- `.github/workflows/release-unsigned.yml`
  - Runs on push to `main` and manually.
  - Actions run name is `Unsigned release build from <commit SHA>`.
  - Detects whether the pushed commit already bumped the version.
  - Bumps the patch and pushes a bot commit when needed.
  - Builds and uploads the unsigned XPI.
  - Creates/updates release `v<version>`.
  - Carries the latest signed XPI forward.
- `.github/workflows/release-signed.yml`
  - Manual `workflow_dispatch` only.
  - Signs a chosen release tag (default: latest release).
  - Uploads the signed XPI and copies it forward to newer releases.
- `BUILD.md` — build, release, permanent-install, GitHub Actions, and AMO limits.
- `.env.example` — AMO credential template.
- `.gitignore` — ignores generated XPIs, `.env`, and `.env.*`, keeps `.env.example`.
- Version remains `1.4.5` in `manifest.json`, `package.json`, `package-lock.json`.
- Local build artifact:
  - `firefox-permanent-addon-file-build/firefox-vinted-item-refresher-1.4.10.xpi`
    — 34.6 KB, 13 runtime files, built after Phase 5.
- GitHub releases verified:
  - `v1.4.5` — unsigned only (intentional).
  - `v1.4.6` — unsigned + signed `1.4.6`.
  - `v1.4.7` — unsigned + signed `1.4.7`.
  - `v1.4.8` — unsigned `1.4.8` + signed `1.4.7` (carry-forward verified).
- `npm test`: 14/14 passing.
- `npm run sign:xpi` fails fast with a clear message when credentials are missing.
- AMO credentials are stored locally in `.env` (gitignored).

### Not done yet

- Manual live verification of Phase 5 size/price fixes on Vinted.
- Commit the Phase 5 changes and release the next version.

### Known notes

- `web-ext lint` still reports:
  - `MISSING_DATA_COLLECTION_PERMISSIONS` (left out intentionally; adding it would warn until `strict_min_version` is raised to Firefox 140).
  - Two `UNSAFE_VAR_ASSIGNMENT` warnings in `content.js` (`innerHTML`).
- Titles are trimmed and limited to 100 UTF-16 code units; a trailing high surrogate is dropped so emoji are not corrupted.
- Vinted can show a size on the listing while the edit page shows no selected size. The member-card `rozmiar:` value is now extracted and carried through the job as a fallback.
- If both the edit page and member card have no size, `fillSize()` is skipped correctly.
- The size menu also exists in a no-chip variant (single grid). `sizeDropdownRoot()` now supports both chip and no-chip layouts.
- React can replace the dropdown nodes after opening/chip clicks. `fillSize` now re-queries the DOM after each interaction and waits up to 6s.
- The `S/M/L` chip often needs an explicit click before its grid renders. `fillSize` clicks the preferred chip when it is not pressed or when the grid is empty.
- Chip clicks now retry on the button, its text span, and its parent, and check `aria-pressed`.
- The current size input uses `category-size-single-grid_chips-input`; the code also supports the old testid and `#size`/`name="size"` fallbacks.
- Edit-page logs now include `Size sources:` (NextData vs member card) and `Size final:` (DOM vs selected value).
- Price failures are locale/timing related. `fillPrice` strips currency/NBSP, sets a dot decimal (`49.00`) because Vinted parses comma decimals to NaN, verifies the numeric value, and retries with per-character typing if the setter does not stick.
- Shipment/package size is always set to `Średni` (middle), regardless of the scraped value.
- AMO versions cannot be reused. Bump the version before every signed submission.
- On 2026-10-17, AMO version `1.4.5` was accidentally submitted as unlisted during
  testing. It was approved and the signed XPI was downloaded (SHA-256 verified).
- Versions `1.4.6` and `1.4.7` were released through the normal workflow and are
  signed on AMO and attached to their GitHub releases.
- `v1.4.8` is unsigned on GitHub and carries the signed `1.4.7` XPI forward, which
  verifies the release-asset carry-forward behavior.
- The working tree currently has an uncommitted local bump to `1.4.9` plus the
  Phase 3 changes; `origin/main` is at `1.4.8`.
- AMO signing limits per account: 3/minute, 10/hour, 24/day. File uploads: 6/minute, 20/hour, 48/day. Do not retry signing in a loop.
- `npm run release` auto-increments the patch every run. Repeated local runs before committing move the version forward each time; only the committed version matters.
- The unsigned workflow run name is `Unsigned release build from <commit SHA>`. The auto-bumped version cannot appear in `run-name` because GitHub only exposes `github`/`inputs` contexts there, not step outputs.
- The unsigned workflow may push a version-bump commit to `main` with `GITHUB_TOKEN`. Such pushes do not trigger another workflow, so there is no loop.
- Branch protection must allow the Actions bot to push to `main`; otherwise CI cannot auto-bump.
- If CI bumps the version, pull the new commit before continuing local work.
- The signed workflow never bumps the version. It signs an existing release tag, or
  downloads and reuses the signed XPI if that version is already signed on AMO.
- `release-assets.js` lists releases with `gh api` because `gh release list --json`
  does not expose an `assets` field in the GitHub runner's `gh` version.
- The GitHub `v1.4.5` release was intentionally left unsigned-only after the first
  workflow failure; only future releases get the automatic signed-asset carry-forward.
- `download:signed --if-signed` exits `0` when the XPI is public, `2` when the version is not submitted/not signed yet, and `1` for real errors. The signed workflow uses this to decide whether to sign or reuse.
- `release:sign` submits with `--approval-timeout 0`, then polls AMO itself. Defaults: 30-minute approval timeout, 5-second check interval, 5-minute validation timeout.
- Approval controls: `WEB_EXT_APPROVAL_TIMEOUT_MS`, `WEB_EXT_APPROVAL_CHECK_INTERVAL_MS`, `WEB_EXT_VALIDATION_TIMEOUT_MS`. Set the approval timeout to `0` to submit without waiting.
- The GitHub signed workflow sets `WEB_EXT_APPROVAL_TIMEOUT_MS=3600000` (60 minutes) and `WEB_EXT_APPROVAL_CHECK_INTERVAL_MS=10000` (10 seconds).
- It does not wait indefinitely. If approval takes longer, the AMO submission still exists; use `npm run download:signed -- <version> [--wait]` to recover it later.
- If signing is interrupted before approval, no local signed file is written.
- Release assets carry the latest signed XPI forward. A signed asset may be older than the release's unsigned asset.
- The old unversioned XPI is no longer present in the build directory.
- AMO credential mapping:
  - Wystawca JWT → `WEB_EXT_API_KEY`
  - Klucz tajny JWT → `WEB_EXT_API_SECRET`

---

## Phase 1.6 — Two-command release workflow

**Status:** done

Commands:

```bash
npm run release
npm run release -- 1.4.6
npm run release:sign
```

`release`:

1. Reads the current version.
2. Increments the patch version, or uses the explicit argument.
3. Updates `manifest.json`, `package.json`, and `package-lock.json`.
4. Verifies all three files.
5. Builds the unsigned XPI.
6. Does not sign, commit, tag, or push.

`release:sign`:

1. Reads the current version.
2. Submits it to AMO with web-ext using `--approval-timeout 0`.
3. Polls AMO until the signed XPI is public, then downloads it automatically.
4. Defaults: 30-minute approval timeout, 5-second check interval, 5-minute validation timeout.
5. Uses `WEB_EXT_APPROVAL_TIMEOUT_MS`, `WEB_EXT_APPROVAL_CHECK_INTERVAL_MS`, and `WEB_EXT_VALIDATION_TIMEOUT_MS` to override the waits.
6. Does not bump the version.
7. Does not prompt.

Recovery:

- `npm run download:signed -- <version>` downloads an already-signed version from
  AMO and verifies its SHA-256 hash.
- `--wait` and `--timeout` can be used while AMO is still approving.

Verification completed:

- Auto-increment and explicit versions tested in a temporary copy.
- All three version files updated together.
- Unsigned XPI built at the new version.
- `npm test` passes.

---

## Phase 2 — Title length validation

**Status:** done

Problem: legacy titles over 100 characters cause Vinted save failures and stall the tool.

Implementation:

1. `TITLE_MAX_LENGTH = 100` and `truncateTitle()` in `content.js`.
2. Trims surrounding whitespace.
3. Truncates using JS string length without splitting a surrogate pair.
4. Applied in:
   - `scrapeItemFromNextData()`
   - the feed-title fallback in `runRelistJobOnEditPage()`
   - before `setReactInput(titleEl, ...)` in `runRelistJobOnNewItemPage()`
5. Logs original and final lengths when truncation happens.
6. `tests/title-length.test.js` covers 99/100/101 characters, whitespace, emoji boundaries, null/undefined, and callback behavior.
7. `truncateTitle` exposed through `tests/helpers.js`.

Verification completed:

- `npm test`: 21/21 passing (14 existing + 7 title tests).
- Manual refresh with a >100-character title still needs a live Vinted check.

---

## Phase 3 — ROZMIAR UI fix

**Status:** done

Source snapshot copied into the repo:

`learning-sources/ui-changes-snapshots/size-menu-changes-on-item-add-screen.html`

What changed:

- New size-system chip bar: `data-testid="size-grid-chips"`.
- Chips: `S/M/L`, `EU`, `UK`, `FR`, `IT`, `US`.
- Options are single values (`M`, `38`, `10`, ...), not composites (`M / 38 / 10`).
- Options use `role="checkbox"` and `aria-label`.
- Default active chip is `S/M/L`.

Root cause:

- Edit page scrapes a composite value such as `M / 38 / 10`.
- The generic matcher could not match that against single-value options.
- The size dropdown stayed blank.

Implementation:

1. `parseSizeValue()` splits composite sizes into raw, alpha, and numeric tokens.
2. `fillSize()`:
   - Opens via input/chevron.
   - Anchors on `[data-testid="size-grid-chips"]`.
   - Prefers alpha tokens on the active `S/M/L` chip.
   - Switches chips and retries numeric tokens when needed.
   - Verifies `aria-checked` and the trigger value.
   - Closes the dropdown after selection.
3. Scraping fallbacks:
   - input value
   - checked size option
   - `__NEXT_DATA__` `size_title`/`size`
4. Failure logs the target, active chips, and visible option labels/testids.
5. Added 8 regression tests using the snapshot, including delayed render and node replacement.

Decision:

- Prefer alpha size (`M`) when available; otherwise use numeric token matching and chip switching.

Verification completed:

- `npm test`: 41/41 passing (14 existing + 7 title + 12 size + 4 price + 4 metadata).
- Alpha/numeric selection, no-chip grid, chip switching, delayed render, node replacement, price normalization/localization, member-card size extraction, and no-match tests pass.
- Manual live Vinted check with `M / 38 / 10` is still pending.

---

## Phase 4 — GitHub Actions

**Status:** done

### Unsigned workflow

`.github/workflows/release-unsigned.yml`

- Trigger: push to `main`, plus `workflow_dispatch`.
- Permissions: `contents: write`.
- Concurrency: one unsigned release at a time.
- Steps:
  1. Checkout with full history.
  2. Node 22 + npm cache.
  3. `npm ci` and `npm test`.
  4. Compare current `manifest.json` version with `HEAD^`.
  5. If unchanged, run `release-xpi.js --bump-only`, commit the version files, and push back to `main` with `GITHUB_TOKEN`.
  6. Build the unsigned XPI.
  7. Upload a workflow artifact.
  8. Create/update release `v<version>`.
  9. Carry the latest signed XPI forward with `release-assets.js`.

### Signed workflow

`.github/workflows/release-signed.yml`

- Trigger: manual `workflow_dispatch`.
- Input: version/tag; empty means latest release.
- Steps:
  1. Resolve the target release tag.
  2. Check out that exact tag.
  3. `npm ci` and `npm test`.
  4. Verify the manifest version matches.
  5. Check AMO for an existing signed file. If present, download and reuse it.
  6. Otherwise run `npm run release:sign`: submit to AMO, then poll for up to 60 minutes (every 10 seconds) and download the signed XPI.
  7. Upload the signed XPI to the release.
  8. Copy it forward to newer releases without downgrading a newer signed asset.
- Secrets: `WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET`.

### Verification completed

- Push to `main` confirmed:
  - unsigned artifacts exist;
  - releases `v<version>` exist with unsigned XPIs;
  - signed XPI carry-forward works.
- Manual signed workflow confirmed:
  - signed XPI attached to the correct release;
  - `v1.4.6` and `v1.4.7` each have unsigned + signed assets;
  - newer signed assets are not downgraded.
- Run names use the commit SHA (`Unsigned release build from <sha>`).

---

## Phase 5 — Live size/price reliability

**Status:** implemented; live verification pending

Problem: size still failed on the live page even though the static fixture tests passed, and price failed intermittently.

Root causes:

- The reported failing item genuinely had no size on the edit page (`Attrs: ... size=NONE`), so `fillSize()` was correctly skipped.
- The current add screen also has categories with no chip bar, only a single size grid.
- React can replace the size dropdown/chip nodes after opening or switching chips, leaving stale element references.
- The size dropdown can render after the one-shot chips check, causing an early legacy fallback.
- Price values arrived as `49.00` or `49,00 zł`; Vinted expects localized comma decimals, and the input can hydrate/format asynchronously.

Implementation:

1. Size:
   - `waitForSizeRoot()` waits up to 6s for the dropdown.
   - `sizeDropdownRoot()` supports categories with no chip bar.
   - Root, chips, and options are re-queried after every click/re-render.
   - Chip iteration uses a tried-label set against the live DOM.
   - Option clicks retry on the element, its child span, and its parent.
   - Verification checks current DOM plus the trigger value.
   - Failure logs size-related elements and visible controls.
2. Price:
   - `normalizePriceValue()` strips currency/NBSP and normalizes decimal separators.
   - `fillPrice()` waits for the input, sets a dot decimal to avoid Vinted's comma-to-NaN parsing, verifies the numeric value, and retries with per-character typing.
   - Failure logs raw/normalized/actual values.
3. Tests:
   - `tests/size-selection.test.js` now has 12 tests, including `_chips` testid, id fallback, explicit S/M/L chip click, no-chip grid, delayed render, and node replacement.
   - `tests/price-fill.test.js` has 4 tests, including strict comma localization.
   - `tests/item-metadata.test.js` has 4 tests for member-card size extraction.
4. Scraping:
   - `getItemData()` extracts `rozmiar:` from the member-card alt/title.
   - The size is carried through single and batch jobs.
   - `runRelistJobOnEditPage()` uses the job size when the edit page exposes none.

Verification:

- `npm test`: 41/41 passing.
- Manual live Vinted check still pending.

---

## Update protocol

Update this file after each implementation session or whenever a new requirement,
decision, or blocker is established:

1. Mark the phase in the status checklist.
2. Update `Last updated`.
3. Move completed items into **Current state → Done**.
4. Record new requirements, decisions, blockers, and known warnings.
5. Update `Current version` if it changed.
