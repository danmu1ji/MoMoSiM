# Release readiness

## Prepared

- Player-only Vite build; editor pages and launcher have been removed.
- Source installer supports Windows, macOS, and Linux, optional local TTS/reference/image/world assets, and private GitHub release downloads with SHA-256 verification.
- `NOTICE.md` records current third-party model, runtime, direct application library, font, and wiki-text provenance.
- Generated builds, abandoned model environments, and downloaded benchmark weights were removed; benchmark reports, scripts, logs, and demo audio were retained.

## Required before publication

1. Create the private `danmu1ji/momo-sim` repository and authenticate. The current `origin` still points at `danmu1ji/world-player`; this checkout has substantial existing uncommitted work, so review and stage an intentional file list before pushing.
2. Choose and publish a license for original MoMoSiM code. No project-wide license is declared yet.
3. Record the exact CrispASR release, binary hashes, and matching upstream third-party notices. The runtime currently downloads the moving `latest` release.
4. Keep Blue Archive art, game audio, and derived voice references out of releases until redistribution rights are confirmed. The installer asks for an explicit rights confirmation if locally present assets are selected; that confirmation is not itself a license.
5. Capture stable Fandom revision IDs for every adapted appearance description. Several profiles currently record that the accessible copy did not expose the revision ID.
6. Produce platform release archives named with `windows`, `macos`, or `linux` (or `universal`) plus `SHA256SUMS.txt`; the installer verifies these checksums before extraction. Build and smoke-test each package on its target platform.
7. Generate and review a dependency inventory/SBOM and complete license set for each exact shipped release, including transitive packages, runtime-downloaded components, platform-specific integrations, and retained notices.

The installer can be used from a source checkout now. A GitHub update download cannot succeed until the private repository contains a compatible release and the caller has authorized GitHub access with `gh auth login` or `GH_TOKEN`.
