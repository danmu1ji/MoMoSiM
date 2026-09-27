# Local voice model catalog and benchmark

## Decision

Keep VoxCPM2 Q8_0 as the only selectable Japanese, English, and Korean model. Pocket-TTS Korean was benchmarked as a CPU candidate but is not retained as an app option. Remove OmniVoice. Qwen3-TTS, DIA, and IndexTTS-2.5 were evaluated but do not meet the full-response timing, termination, or VRAM criteria on the test machine, so they are not selectable in the app.

The visible catalog reports language, cloning support, emotion/tone controls, license, download size, and measured peak VRAM. VoxCPM2's LLM-generated delivery instruction is hidden in the response metadata and passed as its supported parenthesized style-control prefix, separately for each message bubble.

## Test setup

- Date: 2026-09-26
- GPU: NVIDIA GeForce RTX 4060, 8,188 MiB shown by `nvidia-smi`
- Reference: included Hibiki Japanese recording, 11.49 seconds; same reference was used for the cross-language samples
- Samples: same paragraph-sized, conversational text in Japanese, English, and Korean
- Generation time is measured per synthesis request after the model service is ready. VRAM peak is sampled from the entire GPU and from the serving process where available.
- The user cutoff is strict: a model is out if a language exceeds 30 seconds, runs out of memory, or returns a truncated/runaway response.

## Passing demo audio

| Model | Language | Synthesis | Audio | VRAM |
|---|---|---:|---:|---:|
| VoxCPM2 Q8_0 | Japanese | 14.77 s | 13.12 s | 4,588 MiB peak process; 5,408 MiB system peak |
| VoxCPM2 Q8_0 | English | 20.29 s | 10.32 s | same model run |
| VoxCPM2 Q8_0 | Korean | 25.37 s | 11.60 s | same model run |
| Pocket-TTS Korean 100M | Korean | 4.47 s warm | 14.32 s | CPU; 0 MiB VRAM |

VoxCPM2 service setup/configure took 1.54 s in this run. The GPU baseline was 815 MiB; the total allocation rose to 5,408 MiB. The UI estimate uses the measured 4,588 MiB process peak and keeps live `nvidia-smi` total/used/free separate to avoid counting model memory twice. Pocket-TTS's first cold model initialization took 11.70 s in the standalone benchmark; automatic service startup and configuration took 4.50 s with local caches populated.

Audio files and raw results:

- [VoxCPM2 Japanese](../experiments/tts-model-demos/voxcpm2-ja.wav)
- [VoxCPM2 English](../experiments/tts-model-demos/voxcpm2-en.wav)
- [VoxCPM2 Korean](../experiments/tts-model-demos/voxcpm2-ko.wav)
- [Pocket-TTS Korean historical benchmark (not selectable)](../experiments/tts-model-demos/pocket-tts-korean-ko.wav)
- [VoxCPM2 paragraph benchmark JSON](../experiments/tts-model-demos/voxcpm2-paragraph-results.json)

The audios were generated from the exact test prompts and the same Hibiki reference. The Pocket-TTS model card is for a Korean model; it supports reference-audio cloning but has no style-control interface. Its model license is CC BY 4.0, so attribution is required. [Pocket-TTS Korean model card](https://huggingface.co/seastar105/pocket-tts-korean-100m)

## Excluded candidates

| Model | Published capabilities / license | Local result |
|---|---|---|
| Qwen3-TTS 0.6B Base | Japanese, English, Korean and voice cloning; Base has no natural-language style control; Apache-2.0. | Native Python runtime returned truncated audio in all three languages: JA 23.32 s, EN 70.82 s, KO 20.43 s. All outputs reached the safety token ceiling and were discarded. Peak system use was 4,601 MiB (3,799 MiB above baseline); loaded PyTorch reserved 2,200 MiB. The Q8_0 CrispASR attempt also ran away to 64.3 seconds for a short 67-character input without EOS, and was discarded. [Official Qwen repository](https://github.com/QwenLM/Qwen3-TTS) · [0.6B model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base) |
| Qwen3-TTS 1.7B Base | Japanese, English, Korean, voice cloning; Base has no natural-language style control; Apache-2.0. | Loaded without OOM, with 6,381 MiB system use and 5,442 MiB attributed to the model process. English generation exceeded 30 seconds and was stopped; no complete three-language set passed. |
| DIA 1.6B Q8_0 | English dialogue with `[S1]`/`[S2]` speaker tags and nonverbal vocalizations; no reference voice cloning; Apache-2.0. | English paragraph took 70.42 s and failed the cutoff. Runtime peak was about 953 MiB system use. [Official model card](https://huggingface.co/nari-labs/Dia-1.6B) |
| IndexTTS-2.5 | English/Japanese support, reference cloning, text/vector emotion controls, speed control; Bilibili Model Use License. A separate license is required above its stated 100M monthly active user or RMB 1B annual revenue threshold. | OOM while encoding the reference voice on this 8 GB card: only 34 MiB remained when a further 22 MiB allocation failed. No audio was retained. [Official model card](https://huggingface.co/IndexTeam/IndexTTS-2.5) · [license terms](https://github.com/index-tts/index-tts/blob/main/LICENSE) |

The model descriptions above distinguish published capability from the runtime tested in the app. DIA's official model can be conditioned for vocal delivery, but the tested CrispASR adapter does not expose that control or voice cloning; it was excluded by speed regardless. IndexTTS-2.5 advertises more controls than the other candidates, but the reference-encoding OOM makes it unusable under the stated local hardware rule.

## Implementation notes

- VoxCPM2 uses the Q8_0 GGUF build with CrispASR, which provides this quantized backend and a working voice-cloning path. Its official style convention is a natural-language instruction in parentheses before the spoken text. [CrispASR VoxCPM2 backend](https://github.com/CrispStrobe/CrispASR/blob/main/docs/tts.md) · [VoxCPM2 style-control guide](https://voxcpm.readthedocs.io/en/latest/models/voxcpm2.html)
- Pocket-TTS was tested with a separate CPU-only Python service and is not part of the shipped app runtime or selectable catalog.
- The UI shows the model's published languages and controls, plus measured VRAM for the test RTX 4060. Live system allocation, service-process allocation, and free memory are displayed separately.
