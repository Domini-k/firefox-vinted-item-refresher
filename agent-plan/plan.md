# Implementation Plan — Firefox Vinted Item Refresher

Last updated: 2026-10-17
Current version: 1.4.5
Default branch: `main`

> Working agreement: update this file after every implementation session and
> whenever a new requirement, decision, or blocker is established — even before
> the related code is written.

## Status checklist

- [x] Phase 1 — Clean, versioned XPI build
- [x] Phase 1.5 — Build docs, `.env` support, AMO signing
- [x] Phase 1.6 — Two-command release workflow + version alignment
- [ ] Phase 2 — Title length validation (max 100 characters)
- [ ] Phase 3 — ROZMIAR UI fix
- [~] Phase 4 — GitHub Actions workflows implemented; first push/manual run pending

Legend: `[x]` done · `[ ]` not started · `[~]` implemented but not yet verified in GitHub

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
- `scripts/download-signed-xpi.js`
  - Downloads a signed XPI directly from AMO by version.
  - Verifies the SHA-256 hash reported by AMO.
  - Supports `--wait` and `--timeout` while AMO is still approving.
  - Used as `npm run download:signed -- <version>`.
- `package.json`
  - `build:xpi` → build current version.
  - `sign:xpi` → sign current version.
  - `release` → bump patch + build unsigned.
  - `release:sign` → sign current version on demand.
  - `web-ext` devDependency.
- `.github/workflows/release-unsigned.yml`
  - Runs on push to `main` and manually.
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
- Built artifacts exist:
  - `firefox-permanent-addon-file-build/firefox-vinted-item-refresher-1.4.5.xpi`
    — 29 KB, 13 runtime files.
  - `firefox-permanent-addon-file-build/firefox-vinted-item-refresher-1.4.5-signed.xpi`
    — 39 KB, downloaded from AMO after approval; SHA-256 verified.
- `npm test`: 14/14 passing.
- `npm run sign:xpi` fails fast with a clear message when credentials are missing.
- AMO credentials are stored locally in `.env` (gitignored).

### Not done yet

- First real GitHub Actions run (unsigned auto-release).
- First manual signed workflow run.
- Title truncation (Phase 2).
- ROZMIAR fix (Phase 3).

### Known notes

- `web-ext lint` still reports:
  - `MISSING_DATA_COLLECTION_PERMISSIONS` (left out intentionally; adding it would warn until `strict_min_version` is raised to Firefox 140).
  - Two `UNSAFE_VAR_ASSIGNMENT` warnings in `content.js` (`innerHTML`).
- AMO versions cannot be reused. Bump the version before every signed submission.
- On 2026-10-17, AMO version `1.4.5` was accidentally submitted as unlisted during
  testing. It was approved at 13:02 UTC and the signed XPI was downloaded to
  `firefox-permanent-addon-file-build/firefox-vinted-item-refresher-1.4.5-signed.xpi`
  (SHA-256 verified against the AMO `file.hash`). Version `1.4.5` cannot be reused;
  the next release is `1.4.6`.
- AMO signing limits per account: 3/minute, 10/hour, 24/day. File uploads: 6/minute, 20/hour, 48/day. Do not retry signing in a loop.
- `npm run release` auto-increments the patch every run. Repeated local runs before committing move the version forward each time; only the committed version matters.
- The unsigned workflow may push a version-bump commit to `main` with `GITHUB_TOKEN`. Such pushes do not trigger another workflow, so there is no loop.
- Branch protection must allow the Actions bot to push to `main`; otherwise CI cannot auto-bump.
- If CI bumps the version, pull the new commit before continuing local work.
- The signed workflow never bumps the version. It signs an existing release tag.
- `release:sign` waits up to 30 minutes for AMO approval by default, then downloads the signed XPI automatically. Override with `WEB_EXT_APPROVAL_TIMEOUT_MS`; set `0` to submit without waiting.
- The GitHub signed workflow sets `WEB_EXT_APPROVAL_TIMEOUT_MS=3600000` (60 minutes).
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
2. Signs it as AMO unlisted.
3. Waits up to 30 minutes for approval by default, then downloads the signed XPI automatically.
4. Uses `WEB_EXT_APPROVAL_TIMEOUT_MS` to override the wait; `0` skips waiting.
5. Does not bump the version.
6. Does not prompt.

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

**Status:** not started

Problem: legacy titles over 100 characters cause Vinted save failures and stall the tool.

Implementation:

1. Add `TITLE_MAX_LENGTH = 100` and `truncateTitle()` in `content.js`.
2. Trim surrounding whitespace.
3. Truncate using JS string length without splitting a surrogate pair.
4. Apply in:
   - `scrapeItemFromNextData()`
   - the feed-title fallback in `runRelistJobOnEditPage()`
   - before `setReactInput(titleEl, ...)` in `runRelistJobOnNewItemPage()`
5. Log original and final lengths when truncation happens.
6. Add `tests/title-length.test.js` covering:
   - 99, 100, 101 characters
   - trailing whitespace
   - emoji at the boundary
   - null/undefined
7. Expose `truncateTitle` through `tests/helpers.js`.

Verification:

- `npm test`
- Manual refresh of an item with a >100-character title.

---

## Phase 3 — ROZMIAR UI fix

**Status:** not started

Source snapshot:

`/home/djagodzki/Projects/vinted/chrome-vinted-item-refresher/learning-sources/ui-changes-snapshots/size-menu-changes-on-item-add-screen.html`

What changed:

- New size-system chip bar: `data-testid="size-grid-chips"`.
- Chips: `S/M/L`, `EU`, `UK`, `FR`, `IT`, `US`.
- Options are single values (`M`, `38`, `10`, ...), not composites (`M / 38 / 10`).
- Options use `role="checkbox"` and `aria-label`.
- Default active chip is `S/M/L`.

Root cause:

- Edit page still scrapes `M / 38 / 10`.
- The generic matcher does not split the target on `/`, so it cannot match single-value options.
- The size dropdown then stays blank.

Implementation:

1. Copy the snapshot into the Firefox repo as a test fixture.
2. Add `parseSizeValue()` to extract tokens:
   - `M / 38 / 10` → alpha `M`, numeric `38`, `10`.
3. Add a dedicated `fillSize()` adapter:
   - Open via input/chevron.
   - Anchor the dropdown on `[data-testid="size-grid-chips"]`.
   - Prefer the alpha token on the active `S/M/L` chip.
   - Fall back to switching chips and matching numeric tokens.
   - Verify `aria-checked` and the trigger value.
   - Close the dropdown after selection.
4. Improve scraping fallbacks:
   - input value
   - checked/selected option text
   - `__NEXT_DATA__` size fields
5. On failure, log the scraped value, active chip, and visible option labels/testids.
6. Add regression tests using the snapshot.

Decision:

- Prefer alpha size (`M`) when available; otherwise use numeric token matching and chip switching.

Verification:

- `npm test`
- Manual refresh of an item with size `M / 38 / 10` or equivalent.

---

## Phase 4 — GitHub Actions

**Status:** implemented, first real run pending

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
  5. Run `npm run release:sign`.
  6. Upload the signed XPI to the release.
  7. Copy it forward to newer releases without downgrading a newer signed asset.
- Secrets: `WEB_EXT_API_KEY`, `WEB_EXT_API_SECRET`.

### Verification pending

- Push to `main` and confirm:
  - unsigned artifact exists;
  - release `v<version>` exists with the unsigned XPI;
  - latest signed XPI is carried forward when available.
- Run the signed workflow manually and confirm:
  - the signed XPI is attached to the correct release;
  - newer releases receive the signed asset;
  - a newer signed asset is never downgraded.

---

## Update protocol

Update this file after each implementation session or whenever a new requirement,
decision, or blocker is established:

1. Mark the phase in the status checklist.
2. Update `Last updated`.
3. Move completed items into **Current state → Done**.
4. Record new requirements, decisions, blockers, and known warnings.
5. Update `Current version` if it changed.
