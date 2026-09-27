export type VoiceModelId = 'voxcpm2';
export type VoiceLanguage = 'ja' | 'en' | 'ko';

export interface VoiceModelInfo {
  id: VoiceModelId;
  name: string;
  license: string;
  licenseUrl: string;
  expectedVramMB: number;
  downloadSize: string;
  languages: VoiceLanguage[];
  features: string;
  backend?: string;
  voiceCloning: boolean;
  styleControl: boolean;
  quantization?: string;
}

// Figures are rounded measured peaks for this RTX 4060 test machine; they are
// informational only. The UI also shows live aggregate and per-process readings.
export const VOICE_MODELS: VoiceModelInfo[] = [
  { id: 'voxcpm2', name: 'VoxCPM2 · 2B Q8', license: 'Apache-2.0', licenseUrl: 'https://huggingface.co/cstr/voxcpm2-GGUF', expectedVramMB: 4588, downloadSize: '~2.8 GB Q8_0', languages: ['ja', 'en', 'ko'], backend: 'voxcpm2-tts', features: 'Voice cloning · context-aware prosody · style guidance · 48 kHz', voiceCloning: true, styleControl: true, quantization: 'Q8_0' },
];

export const VOICE_LANGUAGES: { value: VoiceLanguage; label: string }[] = [
  { value: 'ja', label: '日本語 / Japanese' },
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어 / Korean' },
];

export function voiceModel(id?: VoiceModelId): VoiceModelInfo {
  return VOICE_MODELS.find(model => model.id === id) ?? VOICE_MODELS[0]!;
}
