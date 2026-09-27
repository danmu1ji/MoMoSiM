# World package distribution patterns

Research date: 2026-09-26

## What other projects do

- **OpenMW** distributes the engine without Morrowind content. Users install the game and point OpenMW at the local data files. The project describes that content as copyrighted material users must provide themselves ([FAQ](https://openmw.org/faq/), [install game files](https://openmw.readthedocs.io/en/stable/manuals/installation/install-game-files.html)).
- **OpenRCT2** follows the same pattern: users install RCT2 or RCT Classic, then OpenRCT2 locates or asks for the local game-data directory ([getting RCT2](https://docs.openrct2.io/en/latest/installing/getting-rct2.html), [Windows setup](https://docs.openrct2.io/en/latest/installing/installing-on-windows.html)).
- **Ship of Harkinian** distributes its engine without copyrighted assets. Users provide a supported game dump; the tool checks it and extracts/repackages assets locally ([project README](https://github.com/HarbourMasters/Shipwright/blob/develop/README.md), [dump guide](https://www.shipofharkinian.com/setup-guide/dump-guide), [build instructions](https://github.com/HarbourMasters/Shipwright/blob/develop/docs/BUILDING.md)).
- **OpenTTD** offers another route: users can select original game data or use OpenGFX, an independently produced replacement asset set distributed under open terms ([installation](https://wiki.openttd.org/en/Manual/Installation), [OpenGFX](https://github.com/OpenTTD/OpenGFX)).

These are useful distribution patterns, not legal precedents that automatically apply to MoMoSiM. In particular, requiring local files or extracting assets on the user's device does not itself establish that the source, extraction, or resulting use is authorized.

## What the current Blue Archive package contains

The local ignored archive `worlds/blue-archive.😭` is about 1.43 GB. Its 25,599 ZIP entries expand to about 1.49 GB. It contains 21,933 `.ogg` files (about 810 MB), 584 images (PNG and JPG files totaling about 563 MB), WAV/MP3 audio, and Markdown/YAML/JSON world data. This is a mixed content archive, not merely a text-only wiki export.

The ignored package-building tools also do more than generic packaging:

- `collect-media.py` queries `bluearchive.wiki` and downloads images and audio.
- `build-tts-references.mjs` trims and concatenates selected source audio into voice-reference WAV files.
- `build-story-docs.py` assembles story descriptions with named NamuWiki and Blue Archive Wiki sources.
- `make-english-corpus.py` maps English story sources and produces English package data.

The generic importer/validator is a different category: it can turn author-supplied Markdown/YAML into a MoMoSiM-compatible archive without fetching Blue Archive material. The BA-specific source pipeline also names NamuWiki and official/wiki English sources. NamuWiki's stated default text license is commonly identified as CC BY-NC-SA 2.0 KR; check the live [NamuWiki policy](https://namu.wiki/Policy/CCL) and each page/source before reuse. CC BY-NC-SA is non-commercial and share-alike, which is another reason not to relicense the mixed world archive as one freely reusable package without auditing its inputs.

## Relevant published rules

Nexon Korea's [Game IP guide](https://m.nexon.com/terms/716) defines its game IP to include world settings, narrative, characters, images, and music. It says producing, distributing, or servicing other games using Nexon IP is prohibited, and its listed exception for non-profit digital content (such as games or applications) requires prior written consent. The [Nexon America guide](https://playersupport.nexon.com/hc/en-us/articles/360059079812-Nexon-Game-IP-Guide-for-Content-Creators) also requires attribution, prohibits commercial access to UGC, and reserves the right to stop distribution of UGC that violates the guide or other rights. The Korean and English versions are not identical, so the safer plan should not rely on the broadest reading of one version.

The Blue Archive Fandom wiki says its community text is generally [CC BY-SA 3.0](https://bluearchive.fandom.com/wiki/Blue_Archive_Wiki%3ARules). That license can govern eligible wiki text and adaptations, with attribution and ShareAlike requirements ([license legal code](https://creativecommons.org/licenses/by-sa/3.0/legalcode)). It does not license Nexon game art, audio, game dialogue, or other material merely because a wiki hosts or references it. Every image/audio file needs its own rights analysis.

## Are the build scripts a safer thing to share?

Sharing code without the generated 1.43 GB archive is a meaningful reduction in what MoMoSiM itself distributes, but it is not automatic legal clearance. A script can embed copied text/assets; fetch material from a source that does not authorize bulk reuse; bypass access controls; or generate a package that reproduces/adapts protected content. Copyright and anti-circumvention rules can also apply separately; see [17 U.S.C. §106](https://www.copyright.gov/title17/92chap1.html) and [17 U.S.C. §1201](https://uscode.house.gov/view.xhtml?req=%28title%3A17+section%3A1201+edition%3Aprelim%29). Applicability varies by jurisdiction and implementation.

The lower-risk, useful subset to publish is the **generic packager, schema, validator, and a tiny original example**. Keep Blue Archive-specific scrapers, source corpora, media downloaders, and voice-reference builders out of the public repo unless their source permissions and permitted downstream use have been confirmed. A local-only converter that accepts user-provided files is a better pattern than a public scraper, but users still need rights to those files and to the generated output. A build script can be independently copyrightable code, but that answers who may copy the script—not whether its collection method or resulting package is authorized.

## Practical release options

1. **Lowest legal friction now:** release only an original MoMoSiM example world and generic authoring/build tools, each under a clear license. Keep the Blue Archive package and its content-specific collection pipeline out of public downloads.
2. **Blue Archive content with broad access:** obtain written permission from Nexon that explicitly covers this application and package distribution, the intended free/non-profit or commercial status, source types, game assets/audio, derived TTS references, territories, and channels. If granted, publish a separately versioned world package with a file-level source/license manifest, attribution, and checksums.
3. **User-provided package flow:** keep the app content-free and let users open a package they independently obtained. This avoids MoMoSiM hosting or bundling that package; it does not by itself make user acquisition or use lawful.
4. **Original replacement world:** commission or create a setting and characters that do not use Blue Archive names, canon, copied wiki prose, or game assets, and release all content under a license that permits redistribution. This is the route most compatible with unrestricted public distribution.

## Recommendation

Do not publicly distribute the current Blue Archive package or its asset-collection scripts on the assumption that attribution, non-commercial status, a user-side build, or a Fandom license makes them clear. The current package includes substantial game-sourced audio and imagery, and Nexon Korea's guide calls for prior written consent for non-profit digital content using its IP. For an accessible public release without that rights uncertainty, publish a fully original/openly licensed world and the generic builder. Pursue written permission separately if the specific Blue Archive package is essential.
