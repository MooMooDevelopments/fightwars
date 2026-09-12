# FORK-CHANGES

Every divergence from `upstream/main` (openfrontio/OpenFrontIO), one line of reasoning each.
New files under `tests/`, `docs/` and the FightWars-only modules are listed once; edits to
shared upstream files are listed individually because each one is a future rebase conflict.

## Shared upstream files edited

- `package.json` — added `test:determinism` and `test:determinism:full` scripts (additive; the
  determinism gate must be runnable by name in CI).

## FightWars-only files added

- `tests/determinism.test.ts`, `tests/determinism/DeterminismRunner.ts` — the determinism gate:
  record + two replays in separate processes, SHA-256 state digest every 100 ticks, two negative
  controls. Runs under `npm test`.
- `FORK-CHANGES.md`, `BUILD-STATE.md`, `docs/MECHANICS.md` — build bookkeeping.

## Phase 1 — foundation (2026-09-12)

### Shared upstream files edited

- `vite.config.ts` — removed the `proprietary/` overlay (`serveProprietaryDir`, `getProprietaryDir`,
  `sourceDirs`); the fork has no all-rights-reserved assets.
- `src/server/PublicAssetManifest.ts` — removed `getProprietaryDir()` for the same reason.
- `Dockerfile` — dropped `COPY proprietary`.
- `tsconfig.json` — dropped `proprietary/**/*` from `include`.
- `package.json` — `name` → `fightwars`; added `licenses:check` and `perf:gate` scripts.
- `README.md`, `LICENSING.md`, `LICENSE-ASSETS` — fork identity, attribution and the Phase 6
  licensing entry. `LICENSE` itself is unchanged (AGPL-3.0 + OpenFront's §7 terms must stay).
- `.github/workflows/ci.yml` — `npm ci --ignore-scripts`; new jobs `determinism` (quick on push,
  full nightly), `perf` and `licenses`.
- `.github/workflows/{deploy,release,pr-*,issue-lifecycle-*,claude-code-review}.yml` — deleted;
  all were guarded by `github.repository == 'openfrontio/OpenFrontIO'` or needed OpenFront's
  secrets and Hetzner hosts.
- `resources/icons/icon512_*.png`, `resources/images/Favicon.svg` — replaced with FightWars marks
  (CC BY-SA 4.0 like the rest of `resources/`).

### Removed

- `proprietary/` (17 files: `OpenFront.ttf`, logos, favicon, six music tracks, the game-start
  alert) — all rights reserved upstream, not licensed for use outside OpenFront.

### FightWars-only files added

- `src/brand/Brand.ts` — the single source of every brand string, asset path, community link,
  telemetry name and monetisation switch. Components read `BRAND.*`; nothing hardcodes a name.
- `resources/images/FightWarsLogo.svg`, `FightWarsLogoDark.svg` — placeholder wordmarks until
  Phase 4 art.
- `resources/sounds/effects/game-start-alert.wav` — synthesised two-tone chime (Node script,
  no third-party audio).
- `scripts/checkLicenses.ts` — walks the production dependency tree, fails on any licence outside
  the AGPL-compatible allowlist.
- `scripts/perfGate.ts` — runs the headless full-game harness and fails on regression past the
  budgets recorded in `BUILD-STATE.md`.
- `CHANGELOG.md` — player-facing changes.

## Phase 2 (started early, 2026-09-12)

### FightWars-only files added

- `tests/load/LoadTest.ts` (`npm run load:test`) — the Section 8 load harness: N simulated clients
  per lobby over the real binary WebSocket protocol, dev persistent-id tokens, real intents from
  `ScriptedHuman`, real hashes from one shared headless `GameRunner` per lobby, optional send
  latency/jitter and disconnect-rejoin churn, per-client bandwidth and turn-cadence report, exit 1
  on desync/error/budget breach.
- `tests/determinism/DeterminismRunner.ts` — `ScriptedHuman` is now exported for the load harness.

### Brand sweep (Phase 1, agent-assisted, 2026-09-12)

- `index.html` — title/og from the brand; canonical and `og:url` removed until `BRAND.siteUrl`
  is set; every ad and tracking script removed (Playwire/`ramp`, `googletag`, both `gtag`
  blocks, the obfuscated `HgWESkOz` anti-adblock loader, Cloudflare Insights) and their CSS.
- `src/client/Admiral.ts` — deleted (the `introjava.com` loader).
- ~45 client files, 6 server files and 4 core files now read `BRAND.*` for every product name,
  logo, community link, telemetry name and desktop identifier; ad, store and Steam surfaces are
  gated on `BRAND.monetisation.*` and render nothing when off (upstream code kept, tests keep it
  covered by mocking the switch on). Footer + loading screen show `BRAND.upstream.copyright`
  (AGPL §7(b)); title screen shows "Based on OpenFront"; Help modal has an About section with
  the source link (AGPL §13). `resources/lang/en.json` values rebranded (keys frozen;
  `win_modal.support_openfront` is the one key still carrying the old name).
- `src/client/DesktopShell.ts` — the desktop bridge is `window.fightwarsDesktop` and the scheme
  `app://fightwars`: a separate desktop shell, if ever built, must inject those names.
- `tests/Brand.test.ts` — asserts the copyright text, that no `src/` file outside `src/brand/`
  mentions the upstream name except via `BRAND.upstream`, and that `index.html` carries none of
  the ad/tracking markers.
- `scripts/pr-gate/`, `scripts/issue-lifecycle/`, `tests/PrGateRules.test.ts` — deleted with the
  workflows they served; `tsconfig.json` now includes `scripts/**/*` so the two FightWars
  scripts are type-checked and lintable.

### Desync alerting (Phase 2, 2026-09-12)

- `src/server/DesyncAlert.ts` — new: error-level structured log on the first desync per game
  (warn on repeats), a process-wide event counter, optional `DESYNC_WEBHOOK_URL` POST.
- `src/server/GameServer.ts` — one call to `alertDesync()` in `handleSynchronization()` where
  the tally already finds out-of-sync clients (additive; nothing else changed).
- `src/server/WorkerMetrics.ts` — `<prefix>.desync_events.total` observable gauge.
- `tests/server/DesyncAlert.test.ts` — unit + turn-loop integration.
