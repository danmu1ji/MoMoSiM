# DanmuTalk

[한국어](README.ko.md)

> [!WARNING]
> The complete Blue Archive world package is not available for download. It combines Nexon game material with Fandom-derived text under separate rights and license terms, and redistribution rights for the bundle have not been cleared. Make your own package using material you may redistribute; see the [world package guide](#create-your-own-world-package).

DanmuTalk is a local-first character chat player. Load a world package, choose a timeline, and chat with one or more characters using an OpenAI-compatible model endpoint. Conversations and credentials stay on the user's device.

## Features

- **Timeline-aware conversations** — Choose a story point before starting a chat so character context matches the selected timeline.
- **Direct and group chats** — Talk with one student or bring several students into a shared conversation.
- **Bring your own model endpoint** — Configure an OpenAI-compatible provider, model, and API key in the app.
- **Optional generated voice** — Enable local VoxCPM2 speech generation; text chat works without setting up voice generation.
- **Separate world packages** — Load `.😭` or `.zip` packages separately, keeping the app install lightweight and letting users choose their own content.
- **English and Korean interface** — Switch the app UI language without changing the world package.
- **Local-first storage** — Chat history and credentials stay on the user's device.

## Run from source

Requirements: Node.js 22 or newer and pnpm 9.

```sh
./run.sh          # macOS / Linux
./run.ps1         # Windows PowerShell
./run.sh --dev    # Vite development server (macOS / Linux)
```

Open the local URL printed by the launcher. Choose a `.😭` world package and configure the model endpoint and API key in **LLM Settings**. `pnpm serve` starts an already-built player.

## Install and update

### One command, no Python required

macOS or Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/danmu1ji/danmutalk/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/danmu1ji/danmutalk/main/install.ps1 | iex
```

The installer downloads DanmuTalk, checks the SHA-256 checksum for Node.js when it needs to install a local copy, installs pnpm, and builds the app. It does not require Python or administrator access. Node.js comes from the [official Node.js distribution](https://nodejs.org/en/download). The default location is `~/DanmuTalk` on macOS/Linux and `%USERPROFILE%\DanmuTalk` on Windows. Run the same command again to update; the `worlds/` folder is preserved.

### Add a world package

World packages are separate downloads. Put a `.😭` or `.zip` package in the install's `worlds/` folder, then click **Open package** in DanmuTalk and choose it. Or drag the package onto the app window. See [worlds/README.txt](worlds/README.txt).

Need a starter package? Download the [sanitized world package template](worlds/import-samples/world-package-template.😭) or browse its [source folder](worlds/import-samples/world-package-template/). It contains only fictional sample records, placeholder artwork, and silent audio; it is a structure example, not a playable Blue Archive package.

The Python-based cross-platform TUI remains available for users who want to install from a local source checkout and select optional files: `python tools/install.py`. No prebuilt release archives are published yet; the no-Python installer downloads the public source and builds it locally.

## Optional local assets

The installer lets you choose optional example-world assets, character images, voice-reference audio, and the local TTS runtime. These choices only work when the corresponding files are present in the source checkout. Blue Archive artwork, voice recordings, and derived reference audio are excluded by default; include or redistribute them only when you have the required rights.

## Project layout

- `apps/desktop/` — player UI and static assets
- `packages/` — world package, dialogue, and provider logic
- `crates/`, `src-tauri/` — desktop shell and local services
- `tools/` — local server, installer, import, and validation tools
- `worlds/examples/` — redistributable example world source
- `docs/` — architecture, verification, research, and release notes

## Development commands

```sh
pnpm install
pnpm build
pnpm validate
pnpm check:placeholder
```

## Licensing and release status

This repository does not yet declare a project-wide license. The license obligations for a release depend on the original project code and the exact bundled or downloaded components. [NOTICE.md](NOTICE.md) identifies the active TTS model, CrispASR voice runtime, core application libraries, fonts, and adapted wiki text. It is a source-level summary; a release-specific SBOM and full transitive dependency license review are still required. Blue Archive game assets and voice recordings are not included in release packages by default.

### External projects used

- [CrispASR](https://github.com/CrispStrobe/CrispASR) provides the local voice runtime. It is downloaded on first TTS use; its upstream license is MIT and it publishes a separate third-party notices file.
- [VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) is the active TTS model (Apache-2.0). The application fetches the Q8_0 GGUF conversion from [CrispStrobe/cstr](https://huggingface.co/cstr/voxcpm2-GGUF) at runtime; the model weights are not included in the installer by default.
- The application stack uses [Tauri](https://github.com/tauri-apps/tauri), [React](https://github.com/facebook/react), [fflate](https://github.com/101arrowz/fflate), [eemeli/yaml](https://github.com/eemeli/yaml), and Rust crates including [reqwest](https://github.com/seanmonstar/reqwest), [rusqlite](https://github.com/rusqlite/rusqlite), and [keyring-rs](https://github.com/open-source-cooperative/keyring-rs). License summaries and scope are in [NOTICE.md](NOTICE.md).
- [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) (SIL OFL 1.1) and [Gyeonggi Title](https://www.gg.go.kr/contents/contents.do?ciIdx=679&menuId=2457) are the bundled fonts. Their notices are retained in the font directory.
- English and Korean appearance notes cite the [Blue Archive Wiki on Fandom](https://bluearchive.fandom.com/wiki/Blue_Archive_Wiki), whose text is generally CC BY-SA 3.0. Each adapted profile carries attribution; revision IDs unavailable from the captured page are marked as such.

## Create your own world package

You can start by copying [`worlds/import-samples/world-package-template/`](worlds/import-samples/world-package-template/). Its YAML keeps the real package field layout, nesting, and value types, with a single fictional sample record per entity and media kind. Replace the sample IDs, references, Markdown, and silent media with content you created or are authorized to use. The ready-made [`.😭` template archive](worlds/import-samples/world-package-template.😭) can also be opened directly in the app.

The easiest way to create a smaller package is to write Markdown files in a folder. Each `.md` file becomes an entity. Optional front matter sets its type, title, summary, and tags; `[[Name]]` links connect entities.

```text
my-world/
├── characters/
│   └── aria.md
├── locations/
│   └── harbor.md
└── lore/
    └── records.md
```

For example, `characters/aria.md` can start with:

```markdown
---
type: character
title: Aria
summary: An optimistic archivist who keeps careful records.
tags: [archivist]
---
# Aria

Aria works in [[Harbor]].
```

From a source checkout with dependencies installed, build a package with:

```sh
pnpm exec tsx tools/importer/cli.ts ./my-world ./my-world.😭 --id my-world --name "My World"
```

The importer creates a ZIP-compatible `.😭` package with the core files below. You can add optional Markdown documents and media; for a fully customized world, use [`worlds/examples/echo-world/`](worlds/examples/echo-world/) as a complete reference.

```text
my-world.😭
├── manifest.yaml
├── world.yaml
├── index/entities.yaml
├── timeline/
│   ├── time-slices.yaml
│   └── states.yaml
├── assets/media.yaml
├── characters/…
├── lore/…
└── assets/images/…
```
