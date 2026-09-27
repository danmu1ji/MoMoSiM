# Third-party notices

MoMoSiM does not yet declare a project-wide license. This file records third-party components used by the application and is not a license for MoMoSiM itself.

## Runtime voice model

**VoxCPM2** is published by OpenBMB under Apache License 2.0. The application downloads the Q8_0 GGUF conversion from CrispStrobe at first use; it is not included in this source tree. The conversion page identifies the original model and states that the conversion/quantization does not modify the model. If a release bundles model weights, include the applicable Apache-2.0 license and model attribution alongside them.

- Original model: [OpenBMB/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)
- Q8_0 GGUF conversion: [cstr/voxcpm2-GGUF](https://huggingface.co/cstr/voxcpm2-GGUF)

## Downloaded voice runtime

The application downloads **CrispASR** on first use from its upstream GitHub releases. CrispASR is MIT-licensed and its release repository includes a separate `THIRD_PARTY_NOTICES.txt` covering bundled dependencies. The downloader queries the latest release metadata, verifies the published SHA-256 digest, and saves that release's matching `LICENSE` and `THIRD_PARTY_NOTICES.txt` beside the cached runtime. The selected release is still a moving `latest`; pin it and retain the matching notices before publishing a binary distribution.

- [CrispASR source and MIT license](https://github.com/CrispStrobe/CrispASR)
- [CrispASR third-party notices](https://github.com/CrispStrobe/CrispASR/blob/main/THIRD_PARTY_NOTICES.txt)

## Application libraries

The application directly uses several open-source libraries. This is a source-level summary, not a substitute for a release-specific dependency inventory; transitive packages and platform integrations must be recorded from the exact release build before distribution.

- [Tauri](https://github.com/tauri-apps/tauri) — MIT or Apache-2.0, depending on component.
- [React](https://github.com/facebook/react) — MIT.
- [fflate](https://github.com/101arrowz/fflate) — MIT; used for archive handling.
- [eemeli/yaml](https://github.com/eemeli/yaml) — ISC; used for YAML parsing.
- [reqwest](https://github.com/seanmonstar/reqwest) and [Serde](https://github.com/serde-rs/serde) — MIT or Apache-2.0.
- [rusqlite](https://github.com/rusqlite/rusqlite) — MIT; the enabled `bundled` feature includes SQLite, which is public domain.
- [keyring-rs](https://github.com/open-source-cooperative/keyring-rs) — MIT or Apache-2.0; platform credential-store integrations may have their own terms.

The workspace lockfiles pin versions, but this list is not exhaustive of transitive dependencies. Generate and review an SBOM and the full license set for every shipped platform artifact.

On Linux with NVIDIA detected, the runtime also installs NVIDIA CUDA runtime and cuBLAS Python wheels into a private user cache. These are proprietary NVIDIA components; they are not included by this project as bundled files. See the [CUDA EULA](https://docs.nvidia.com/cuda/eula/index.html) and the package notices for the installed wheel versions.

## Fonts

- **Gyeonggi Title Medium (경기천년제목 Medium)** — Gyeonggi Province. Software embedding and distribution are permitted with attribution under the published terms. [Official font terms](https://www.gg.go.kr/contents/contents.do?ciIdx=679&menuId=2457). The local `apps/desktop/public/fonts/FONTS.md` records the bundled font details.
- **Noto Sans Variable** — SIL Open Font License 1.1. The license text is included as `apps/desktop/public/fonts/OFL-Noto-Sans.txt`; retain it with the font.

## Blue Archive wiki-derived prose

Some English and Korean appearance descriptions are paraphrases/adaptations of the Blue Archive Wiki on Fandom. Fandom's default community-content license is CC BY-SA 3.0 unless a page states otherwise. Each description carries its source page and access/revision note. Where an exact revision ID was unavailable, the profile says so; those entries need revision-level attribution captured before redistribution.

- [Blue Archive Wiki licensing notice](https://bluearchive.fandom.com/wiki/Blue_Archive_Wiki%3ARules)
- [Fandom licensing policy](https://community.fandom.com/wiki/Copyright)

Blue Archive game illustrations, character art, voice recordings, and derived TTS reference clips are not licensed by the Fandom text license. They are excluded from installer/release defaults and must not be redistributed without independent permission.
