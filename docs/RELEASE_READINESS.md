# Release readiness

## Prepared in the current working tree

- The web player has no editor page or audio playback/voice generation controls.
- The Blue Archive package source and generated `.😭` archive contain only text and metadata; images, audio, and derived voice references were removed.
- `worlds/` archives are listed in the startup world picker, and the repository ignore rules allow the media-free package to ship.
- Python entry points replace shell and PowerShell launchers. The installer prepares Node.js, pnpm, dependencies, and a build before it finishes.
- `NOTICE.md`, bilingual READMEs, the volunteer artwork contribution specification, and local model setup helper are present.

## Remaining publication work

1. Choose and publish a license for original DanmuTalk code.
2. Review the Blue Archive-derived text sources and their attribution/licensing obligations before distributing that package.
3. Select and legally review the artwork contribution license wording before enabling public submissions.
4. Generate and review a complete dependency inventory/SBOM for each exact release artifact, including transitive packages and platform integrations.
5. Build and smoke-test Windows, macOS, and Linux installs on their target platforms.

No release has been published by this change; nothing was pushed.
