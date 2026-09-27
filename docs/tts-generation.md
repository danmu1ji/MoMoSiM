# Optional voice generation

Voice generation is off by default. The catalog retains OmniVoice and VoxCPM2. Users can select Japanese, English, or Korean. The chat LLM appends a hidden translation only when the chosen voice language differs from the chat language; otherwise the visible reply is synthesized directly.

## Models

| Model | Download | License | Notes |
| --- | ---: | --- | --- |
| [OmniVoice 0.6B](https://huggingface.co/k2-fsa/OmniVoice) | ~1.6 GB | CC BY-NC 4.0 (non-commercial model weights) | Zero-shot cloning; 600+ languages |
| [VoxCPM2 Q8](https://huggingface.co/cstr/voxcpm2-GGUF) | ~2.8 GB Q8 weights | Apache-2.0 | Context-aware prosody; optional style guidance; 30 languages |

Both support Japanese, English, and Korean. VoxCPM2 uses the shared CrispASR runtime; its generation service provisions CUDA 12 runtime libraries on NVIDIA Linux systems when needed. OmniVoice uses its own cached Python environment.

## Consent and reference audio

Before enabling cloning, users confirm they have permission to clone the included reference voices and will identify generated speech as AI-made. Generated players are labeled as AI voice. CrispASR applies its audio provenance marking.

Character references live in `worlds/blue-archive/tts-references/`, separate from pre-collected clips in `worlds/blue-archive/assets/audio/`. References target about 8 seconds and retain shorter eligible clips. Characters without eligible audio are skipped. Yawns, laughter, cries, screams, and similar expressive clips are excluded. Package exports include references by default; use `--without-tts-references` to omit them.

## RTX 4060 8 GB comparison

These measurements use the same 8.51-second Hina Japanese reference and equivalent short lines. VRAM is the system-wide `nvidia-smi` peak sampled every 200 ms; increase is above a 0.6 GiB idle baseline.

| Model | VRAM increase | JA / EN / KO time | Result |
| --- | ---: | ---: | --- |
| OmniVoice | 2,370 MiB | 2.40s / 1.95s / 1.98s | All three generated |
| VoxCPM2 | 4,314 MiB | 11.55s / 13.62s / 16.09s | All three generated |

OmniVoice and VoxCPM2 samples are in [`experiments/tts-model-demos/`](../experiments/tts-model-demos/README.md). OmniVoice and VoxCPM2 times are measured generation requests with the model loaded. The additional OmniVoice English opening check was generated separately to inspect its first word.

## Setup

CrispASR downloads from its official GitHub releases on first use; selected model weights download on first load. OmniVoice uses its private Python environment. Models load only after voice generation is enabled and settings are saved. Disabling voice generation or closing the app unloads the active model.
