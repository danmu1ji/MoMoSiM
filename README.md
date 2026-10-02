# DanmuTalk

[한국어 README](README.ko.md)

> [!WARNING]
> **Package rights:** This repository includes a community Blue Archive world package. Material in it remains subject to its source terms; review permissions and attribution before redistributing it. For content you can share, start with the [world package structure template](worlds/import-samples/world-package-template/).

The repository includes the [Blue Archive world package](worlds/blue-archive.😭), which you can choose from the startup screen.

DanmuTalk is a local-first character chat player. Load a `.😭` or `.zip` world, select a timeline, and chat with one or more characters using an OpenAI-compatible model endpoint. Chat history and credentials stay on your device.

## Features

- **Direct and group conversations** — Chat with one character or create a shared room.
- **World selection at startup** — Packages in `worlds/` appear in the opening screen; you can also open or drag in a package file.
- **Timeline-aware context** — Choose a story point before beginning a conversation.
- **Bring your own model** — Connect an OpenAI-compatible endpoint, choose a model, and save your system instructions.
- **English and Korean UI** — Switch the interface language independently of package content.
- **Local LLM helper** — Scan hardware, review model suggestions, and build llama.cpp from source for your CPU architecture and available GPU backend. Its terminal menus use ↑/↓ plus Space or Enter. Run `python tools/local_llm_setup.py` on Windows or `python3 tools/local_llm_setup.py` on macOS/Linux.
- **Local-first storage** — Conversation history and provider credentials are stored on your device.
- **Conversation drafts** — Unsent text stays with its world and conversation, including after a restart. Drafts are local text; pending image attachments are not saved as drafts.
- **Search and saved messages** — Search message text or speakers, bookmark messages, and filter to saved messages.
- **Quoted replies** — Reply to a specific message by inserting its speaker and text into your draft.
- **Continue conversation** — Let characters continue without submitting another user message.
- **Transcript export** — Preview and copy the full visible transcript; desktop/browser builds can download a `.txt` file. Images are represented by descriptions.
- **Multiline composer** — Enter sends on desktop, Shift+Enter adds a line, and mobile Enter adds a line. IME composition never sends prematurely.

## Screenshots

| Character roster | Model settings and search |
|---|---|
| ![Fictional character roster](docs/images/01-roster.png) | ![Model settings, model search, and system instructions](docs/images/02-model-search.png) |
| **Timeline selection** | **Group setup** |
| ![Timeline selection](docs/images/04-timeline-selection.png) | ![Group setup](docs/images/07-group-setup.png) |
| **Direct conversation** | **Group conversation** |
| ![Direct conversation](docs/images/06-direct-chat.png) | ![Group conversation](docs/images/08-group-chat.png) |

## Install

### Windows desktop installer

The easiest way to install DanmuTalk on Windows is the setup program from [GitHub Releases](https://github.com/danmu1ji/danmutalk/releases). Download the DanmuTalk Windows setup `.exe`, open it, choose an install location, and click **Install**. On the final screen, you can choose to create a desktop shortcut and launch DanmuTalk. The app is installed for your Windows account and is also available from the Start menu.

The first Windows installer has not been published yet. Until it appears on the Releases page, use the Python installer below.

On first launch, DanmuTalk opens a short guide. It links to Releases to download a world package, then explains how to open it, choose a character, connect a model in **Settings**, send a message, and start a group chat. To begin, download the `.😭` or `.zip` asset from a world package release and choose **Open a world package** in DanmuTalk.

### Python installer (all platforms / Windows fallback)

Install Python 3.10 or newer, then run:

```sh
# Windows
py install.py

# macOS / Linux
python3 install.py
```

The installer downloads the public source, installs a verified Node.js 22 runtime and pnpm inside the app folder if needed, installs dependencies, and builds the app so it is ready to launch. Run `python run.py` in the installed folder. To update, run `python install.py` again. The default install folder is `~/DanmuTalk` (`%USERPROFILE%\DanmuTalk` on Windows). Set `MOMOSIM_DIR` to change it.

### Install Python

- **Windows:** Download Python 3.10+ from [python.org](https://www.python.org/downloads/windows/) and select “Add Python to PATH”. Run `py --version` to check.
- **macOS:** Use the installer at [python.org](https://www.python.org/downloads/macos/), or install with `brew install python` if Homebrew is already installed. Check `python3 --version`.
- **Ubuntu/Debian:** `sudo apt install python3 python3-venv python3-pip`
- **Fedora:** `sudo dnf install python3 python3-pip`
- **Arch Linux:** `sudo pacman -S python python-pip`
- **openSUSE:** `sudo zypper install python3 python3-pip`
- **Alpine Linux:** `sudo apk add python3 py3-pip`

Python dependencies: none; installer and helper use the standard library. `requirements.txt` is provided for tooling compatibility.

The local LLM helper also needs CMake and a native C/C++ compiler. CUDA and HIP acceleration require their matching toolkits; on macOS the build enables Metal.

### Android APK

APK releases are published with tagged releases. To build locally:

```sh
pnpm install
pnpm android:init
pnpm android:build
```

Prerequisites: Rust, JDK 17, Android SDK, and Android NDK. See [Tauri Android prerequisites](https://v2.tauri.app/start/prerequisites/).

## Add world packages

Copy `.😭` or `.zip` files into the installed `worlds/` folder. On the next app load they appear in the world selection screen for everyone using that installation. Choose **Open package** or drag a package into the window to open a package from elsewhere. See [worlds/README.txt](worlds/README.txt).

The [template archive](worlds/import-samples/world-package-template.😭) contains fictional records and placeholder artwork only. Copy [the template folder](worlds/import-samples/world-package-template/) to build your own world. Game artwork and all audio are excluded. [Submit volunteer artwork](https://forms.gle/UnhotZ14Xp66HR4F7) or see [media contributors](docs/media-contributors.md) for artist credits.

## Contributing

Ideas, bug reports, and improvements are welcome. Please [open an issue](https://github.com/danmu1ji/danmutalk/issues) to discuss a change or report a problem, and feel free to submit a pull request. For world packages or artwork, make sure you have the rights to share the material and include its required attribution.

## Run from source

Requirements: Python 3.10+. `py run.py --prepare` on Windows or `python3 run.py --prepare` on macOS/Linux installs Node.js/pnpm as needed and builds. Start with `py run.py` or `python3 run.py`; add `--dev` for the Vite development server. The local model helper is `py tools/local_llm_setup.py` or `python3 tools/local_llm_setup.py`.

## Licensing

DanmuTalk's original application code and supporting tools are licensed under [MIT](LICENSE). World packages, fonts, third-party components, and contributor media retain their own terms; see [NOTICE.md](NOTICE.md) and [media contributors](docs/media-contributors.md). DanmuTalk does not include Blue Archive game art, recordings, or voice-reference audio.

### External projects

- [llama.cpp](https://github.com/ggml-org/llama.cpp) can serve locally selected GGUF models. The helper builds it from source using CMake for the detected CPU architecture, enabling Metal, CUDA, or HIP when the matching toolkit is available. See llama.cpp’s [official build guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md).
- The application uses [Tauri](https://github.com/tauri-apps/tauri), [React](https://github.com/facebook/react), [fflate](https://github.com/101arrowz/fflate), [eemeli/yaml](https://github.com/eemeli/yaml), and Rust crates listed in [NOTICE.md](NOTICE.md).
- Bundled fonts are [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) (SIL OFL 1.1) and Gyeonggi Title; see their notices under `apps/desktop/public/fonts/`.
