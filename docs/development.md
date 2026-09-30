# Development

## Local checks

Use a supported Node version, then run:

```sh
npm ci
npm run verify
npm audit
npm pack
```

`verify` runs lint, tests and installation checks. The real-media integration test needs FFmpeg; set `FERMAX_TEST_FFMPEG` if it is not installed at a detected path. Without FFmpeg, that test is explicitly skipped. CI installs FFmpeg and exercises Node 22, 24 and 26.

The suite covers authentication, safe selection, single-attempt commands, cache privacy, ring deduplication, cancellation, stalled HTTP bodies, real UDP reservations and authenticated local video. These checks cannot establish physical monitor operation or Pi performance. Homebridge 2.4's HAP implementation is exercised by the suite; compatibility with other supported versions needs deployment checks.

A local package can be installed into the Pi's plugin directory:

```sh
npm install /path/to/homebridge-fermax-blue-0.2.0-beta.1.tgz --omit=dev --legacy-peer-deps
```

Restart Homebridge after installation. Keep the previous package and a private config/accessory backup for rollback. Old unscoped token files remain unused and can be removed from Homebridge storage after taking a private backup.

## Hardware acceptance

Before treating a beta installation as reliable:

- Confirm DuoxMe works and the dedicated integration user preserves phone notifications.
- Press the physical doorbell repeatedly; verify one current Apple Home event per press, including after restart.
- Observe one explicit release command operating the intended entrance. Check the physical door before retrying an uncertain error.
- Verify changing video frames in cold, warm and active-call sessions. Record startup time and Pi CPU usage; reopen after preview expiry.
- Interrupt Internet/HA connectivity, restore it and verify fresh events resume without historical rings.
- Check local and remote Apple Home access through the home's hub.
- Inspect log privacy, config/cache permissions and a 24-hour burn-in for missed rings or failed previews.

## Contribution and release

Use focused branches and pull requests. Preserve unrelated work, test failure paths, update the affected documentation and keep release claims tied to evidence. The recovery used the [AI Development Spine](https://github.com/olly-j/ai-development-spine) work loop: orient, define, implement, verify, reconcile and review. A formal template migration is a separate change.

GitHub's `main` branch is the source-install target. Version `0.2.0-beta.1` denotes unvalidated hardware status; it is not an npm publication. Public releases and deployment are explicit owner decisions. Do not commit dependency folders, credentials, generated packages or personal machine paths.
