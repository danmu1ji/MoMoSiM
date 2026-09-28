# Third-party notices

DanmuTalk's original application code and supporting tools are licensed under the MIT License in [LICENSE](LICENSE). The MIT grant does not relicense separately licensed world-package content, fonts, third-party components, or contributed media. This notice summarizes third-party components. Exact release artifacts still need a complete transitive dependency inventory.

## Application libraries

- [Tauri](https://github.com/tauri-apps/tauri) — MIT or Apache-2.0, depending on component.
- [React](https://github.com/facebook/react) — MIT.
- [fflate](https://github.com/101arrowz/fflate) — MIT; archive handling.
- [eemeli/yaml](https://github.com/eemeli/yaml) — ISC; YAML parsing.
- [reqwest](https://github.com/seanmonstar/reqwest) and [Serde](https://github.com/serde-rs/serde) — MIT or Apache-2.0.
- [rusqlite](https://github.com/rusqlite/rusqlite) — MIT; its `bundled` feature includes SQLite, which is public domain.
- [keyring-rs](https://github.com/open-source-cooperative/keyring-rs) — MIT or Apache-2.0; platform credential-store integrations may have separate terms.

Workspace lockfiles pin versions. Generate and review a software bill of materials and the complete license set for each platform release.

## Fonts

- **Gyeonggi Title Medium (경기천년제목 Medium)** — Gyeonggi Province. Follow the [official font terms](https://www.gg.go.kr/contents/contents.do?ciIdx=679&menuId=2457). Local details are in `apps/desktop/public/fonts/FONTS.md`.
- **Noto Sans Variable** — SIL Open Font License 1.1. Retain `apps/desktop/public/fonts/OFL-Noto-Sans.txt` with the font.

## World package content

World packages are separate content. The included Blue Archive-derived text has its own sources and conditions; check attribution in the package before redistribution. English/Korean appearance prose adapted from the [Blue Archive Wiki on Fandom](https://bluearchive.fandom.com/wiki/Blue_Archive_Wiki) is generally subject to CC BY-SA 3.0 according to its [wiki rules](https://bluearchive.fandom.com/wiki/Blue_Archive_Wiki%3ARules), unless a page states otherwise. That license does not cover game scripts or other Nexon material merely because they appear in a wiki. The package may contain additional game-derived prose; the wiki license does not grant rights to that material. This repository contains no Blue Archive game artwork, audio recordings, or derived voice-reference clips. Do not add or redistribute content without the applicable rights.

## Local language model setup

The optional setup helper downloads the [llama.cpp](https://github.com/ggml-org/llama.cpp) source (MIT) and builds it locally; its license is available in the upstream [`LICENSE`](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE). It can also download GGUF models from Hugging Face. Model licenses and terms vary by model; the helper displays the selected model's repository and license reference. Review those terms before downloading or using a model. No source tree, built binary, or model weights are bundled in the repository.
