# Performance benchmark

Measurements made 2026-09-25 on Linux 7.2, Node 22.23, NVIDIA RTX 4060 8 GB. The Blue Archive package was served from the same machine over HTTP range requests. Startup numbers include opening the ranged ZIP source and loading the selected locale's world metadata; lazy character documents are measured separately. The old startup values are the pre-optimization readings captured during this work; optimized values are medians of five consecutive runs.

| Path | Before | After | Speedup |
| --- | ---: | ---: | ---: |
| Korean world startup | 1,843.9 ms | 259.9 ms | 7.1× |
| English world startup | 1,673.9 ms | 260.3 ms | 6.4× |
| First character document, Korean | included in startup | 3.8 ms | deferred |
| First character document, English | included in startup | 3.9 ms | deferred |

The old startup cost was dominated by parsing the 5.5 MB YAML media index (1,423.7 ms by itself). Package exports now include a JSON mirror, which parses in about 69 ms, and the player skips parsing hundreds of Markdown documents until a chat or profile needs them. The source object is retained across locale switches, allowing its ZIP range cache and the loaded locale data to be reused. The first alternate locale is also warmed in the background after startup.

Run the current startup benchmark after building the engine and starting `tools/serve.mjs`:

```sh
node tools/benchmark-world-load.mjs http://127.0.0.1:5173/ 5
```

It prints JSON with per-run times, median, entity count, startup-loaded document count, and the time to fetch the first character document.
