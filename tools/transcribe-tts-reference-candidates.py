#!/usr/bin/env python3
"""Transcribe local Japanese voice-reference candidates and reject vocalization-heavy clips."""
from __future__ import annotations

import json
import logging
import re
import sys
import warnings
from pathlib import Path

import torch
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline


MODEL_ID = 'openai/whisper-large-v3-turbo'
warnings.filterwarnings('ignore', category=FutureWarning, message='The input name `inputs` is deprecated.*')
logging.getLogger('transformers.models.whisper.generation_whisper').setLevel(logging.ERROR)
logging.getLogger('transformers.pipelines.base').setLevel(logging.ERROR)

# Standalone expressive syllables that can bleed into cloned speech as tearing, breathy, or moaning sounds.
INTERJECTION = re.compile(
    r'(?:(?<=^)|(?<=[、。！？!?…\s（(]))'
    r'(?:は+[ぁあ]+|あ+[ぁあ]+|へ+[ぇえ]+|ふ+[ぅう]+|わ+[ぁあ]+|え+[ぇえ]+|う+[ぇえ]+|や+[ぁあ]+|お+[ぉお]+'
    r'|ん+[ー〜～]+|あっ|はっ|へっ|えっ|ふっ|うっ)[ー〜～]*'
    r'(?=$|[、。！？!?…\s）)])'
)
EXPRESSIVE = re.compile(r'(?:あくび|欠伸|くしゃみ|咳き?込|すすり泣|泣き声|笑い声|あはは|わはは|悲鳴|号泣)')


def main() -> None:
    INPUT = Path(sys.argv[1])
    OUTPUT = Path(sys.argv[2])
    candidates = json.loads(INPUT.read_text(encoding='utf-8'))
    processor = AutoProcessor.from_pretrained(MODEL_ID, local_files_only=True)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        MODEL_ID,
        local_files_only=True,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        low_cpu_mem_usage=True,
        use_safetensors=True,
    )
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model.to(device)
    asr = pipeline(
        'automatic-speech-recognition', model=model,
        tokenizer=processor.tokenizer, feature_extractor=processor.feature_extractor,
        torch_dtype=next(model.parameters()).dtype, device=device,
    )
    groups: dict[str, list[dict[str, object]]] = {}
    for candidate in candidates:
        groups.setdefault(str(candidate['slug']), []).append(candidate)
    output = []
    for slug, group in groups.items():
        group.sort(key=lambda item: (int(item['rank']), float(item['seconds'])))
        clean_seconds = 0.0
        for candidate in group:
            try:
                text = asr(
                    candidate['absolutePath'],
                    generate_kwargs={'language': 'japanese', 'task': 'transcribe', 'num_beams': 1},
                )['text'].strip()
                text = re.sub(r'\s+', '', text)
                if not text:
                    safe, reason = False, 'ASR found no speech'
                elif EXPRESSIVE.search(text):
                    safe, reason = False, 'transcript indicates non-speech vocalization'
                elif INTERJECTION.search(text):
                    safe, reason = False, 'contains an expressive standalone interjection'
                else:
                    safe, reason = True, ''
            except Exception as error:  # A failed transcription must not silently enter a voice reference.
                text, safe, reason = '', False, f'ASR failed: {type(error).__name__}'
            output.append({'path': candidate['path'], 'transcript': text, 'safe': safe, 'reason': reason})
            if safe:
                clean_seconds += float(candidate['seconds'])
            if clean_seconds >= 8:
                break
        print(f'Transcribed {slug}: {clean_seconds:.1f}s clean', file=sys.stderr, flush=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
