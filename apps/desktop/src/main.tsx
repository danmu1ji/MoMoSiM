import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRemoteZipSource, createZipSource, fromStoredTurns, loadWorld, loadWorldDocuments, resolveState, runConversationCycle, toStoredTurn, validateWorld, withLocaleOverlay,
  inferMessageStyle, readAssetBytes, releaseAssetUrls, type MessageStyle, type SamplingOptions,
} from '@world-player/engine/desktop';
import { OpenAICompatibleProvider, type ModelInfo } from '@world-player/provider';
import type { Character, ChatMessage, ChatNode, PlayerProfile, TimeSlice } from '@world-player/schema';
import type { WorldData, WorldSource } from '@world-player/engine/desktop';
import { parseChatMarkdown } from '@world-player/markdown';
import { invoke } from '@tauri-apps/api/core';
import { HomeScreen } from './player/home';
import { BrandMark } from './player/brand-mark';
import { ConversationView, type ConversationMessage } from './player/conversation-view';
import { backendLabel, isDesktopRuntime, loadApiKey, loadProviderSettings, saveApiKey, saveProviderSettings } from './player/credential-store';
import { clearConversation, listConversations, loadConversation, loadConversationContextMode, saveConversationContextMode, saveConversationTurn, type ConversationContextMode, type ConversationSummary } from './player/conversation-store';
import { BrowseOverlay } from './player/browse-overlay';
import { ChatOverlay } from './player/chat-overlay';
import { ConfigOverlay, ProfileOverlay, TimelinePromptOverlay, type ProviderConfig } from './player/overlays';
import { VOICE_MODELS, voiceModel, type VoiceLanguage, type VoiceModelId } from './player/tts-catalog';
import './styles.css';

type Screen = 'home' | 'chat';
const NO_TIMELINE_SLICE: TimeSlice = { id: 'none', label: '시점 없음', labelEn: 'None', position: Number.NaN };

function modelProgressText(status: { stage?: string; model?: string; percent?: number; detail?: string }, language: string) {
  const model = status.model || (language === 'en' ? 'selected model' : '선택한 모델');
  const percent = Math.max(0, Math.min(100, status.percent ?? 0));
  const detail = status.detail ? ` · ${status.detail}` : '';
  if (status.stage === 'downloading') return language === 'en' ? `Downloading ${model} · ${percent}%${detail}` : `${model} 다운로드 중 · ${percent}%${detail}`;
  return language === 'en' ? `Loading ${model} · ${percent}%${detail}` : `${model} 불러오는 중 · ${percent}%${detail}`;
}

function sanitizeVoiceText(text: string): string {
  return text
    .replace(/\[\[\/?voice-(?:ja|en|ko)\]\]/gi, '')
    .replace(/\[\[(?:bubble|next:[^\]]*)\]\]/gi, '')
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[^\n]*\n?|```/g, ''))
    .replace(/[`*_#]/g, '')
    .replace(/[\u2010-\u2015\u2e3a\u2e3b\ufe58\ufe63\uff0d]+/g, '、')
    .replace(/[ \t]*\r?\n+[ \t]*/g, '、')
    .replace(/[ \t]+/g, ' ')
    .replace(/([、。！？])\1+/g, '$1')
    .trim();
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [language, setLanguage] = useState<'ko' | 'en'>(() => localStorage.getItem('blue-archive.language') === 'en' || localStorage.getItem('blue-archive.locale') === 'en' ? 'en' : 'ko');
  const [data, setData] = useState<WorldData>();
  const [notice, setNotice] = useState<string>();
  const [worldPackageDrag, setWorldPackageDrag] = useState(false);
  const [startupLoading, setStartupLoading] = useState(true);
  const [browseCategory, setBrowseCategory] = useState<string>();
  const [selectedProfileCharacter, setSelectedProfileCharacter] = useState<string>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState('ba-inbox');
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([]);
  const [pendingConversation, setPendingConversation] = useState<{ id: string; participants: string[] }>();
  const [threadMessages, setThreadMessages] = useState<ConversationMessage[]>([]);
  const [generatedVoices, setGeneratedVoices] = useState<Record<string, { state: 'queued' | 'loading' | 'ready' | 'error'; stage?: string; generatedTokens?: number; textCharacters?: number; elapsedMs?: number; startedAt?: number; truncated?: boolean; url?: string; text?: string; error?: string }>>({});
  const [ttsPreviewAudio, setTtsPreviewAudio] = useState<string>();
  const [ttsPreviewStatus, setTtsPreviewStatus] = useState('');
  const [ttsPreviewBusy, setTtsPreviewBusy] = useState(false);
  const generatedVoiceUrls = useRef(new Map<string, string>());
  const referenceBase64Cache = useRef(new WeakMap<object, Map<string, string>>());
  const voiceGenerationControllers = useRef(new Map<string, { controller: AbortController; endpoint: string; requestId: string; phase: 'queued' | 'generating' }>());
  const voiceGenerationQueue = useRef(Promise.resolve());
  const clearGeneratedVoices = useCallback(() => {
    for (const active of voiceGenerationControllers.current.values()) {
      active.controller.abort();
      if (active.phase === 'generating') void fetch(`${active.endpoint}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: active.requestId }) }).catch(() => {});
    }
    voiceGenerationControllers.current.clear();
    for (const url of generatedVoiceUrls.current.values()) URL.revokeObjectURL(url);
    generatedVoiceUrls.current.clear();
    setGeneratedVoices({});
  }, []);
  useEffect(() => () => clearGeneratedVoices(), [clearGeneratedVoices, currentConversationId, data]);
  useEffect(() => { if (data) return () => releaseAssetUrls(data); }, [data]);
  useEffect(() => () => { if (ttsPreviewAudio) URL.revokeObjectURL(ttsPreviewAudio); }, [ttsPreviewAudio]);
  const [typingMessageId, setTypingMessageId] = useState<string>();
  const [pendingImages, setPendingImages] = useState<ChatNode[]>([]);
  const [theme, setTheme] = useState(() => localStorage.getItem('blue-archive.theme') ?? 'blue');
  const locale = language;
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const [situation, setSituation] = useState(() => localStorage.getItem('blue-archive.situation') ?? '');
  const [directorNotes, setDirectorNotes] = useState(() => localStorage.getItem('blue-archive.directorNotes') ?? '');
  const packageInput = useRef<HTMLInputElement>(null);

  const profileCustomized = useRef(localStorage.getItem('blue-archive.profile-customized') === 'true');
  const [profile, setProfile] = useState<PlayerProfile>(() => {
    const profileForLanguage = (selectedLanguage: 'ko' | 'en'): PlayerProfile => selectedLanguage === 'ko'
      ? { name: '사용자', description: '', tags: [] }
      : { name: 'User', description: '', tags: [] };
    try {
      const stored = localStorage.getItem('blue-archive.profile');
      if (!stored) return profileForLanguage(language);
      const parsed = JSON.parse(stored) as PlayerProfile;
      const isKnownDefault = (parsed.name === 'Sensei' && parsed.description === 'Teacher at Schale' && parsed.tags.length === 0)
        || (parsed.name === '선생님' && parsed.description === '샬레의 선생님' && parsed.tags.length === 0)
        || (parsed.name === 'User' && !parsed.description && parsed.tags.length === 0)
        || (parsed.name === '사용자' && !parsed.description && parsed.tags.length === 0);
      if (!isKnownDefault) profileCustomized.current = true;
      return parsed;
    } catch { return profileForLanguage(language); }
  });
  useEffect(() => { localStorage.setItem('blue-archive.profile', JSON.stringify(profile)); }, [profile]);
  useEffect(() => {
    if (profileCustomized.current) return;
    setProfile(language === 'ko'
      ? { name: '사용자', description: '', tags: [] }
      : { name: 'User', description: '', tags: [] });
  }, [language]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const providerSettingsEdited = useRef(false);
  const [provider, setProvider] = useState<ProviderConfig>(() => {
    // 키가 아닌 설정(엔드포인트·모델·생성 값)은 로컬에 남겨둔다. 서버가 있으면 아래에서 서버 값으로 맞춘다.
    try {
      const saved = JSON.parse(localStorage.getItem('world-player.provider') ?? '{}') as Partial<ProviderConfig>;
      const hasSupportedSavedEngine = VOICE_MODELS.some(model => model.id === saved.ttsEngine);
      const ttsEngine = hasSupportedSavedEngine ? saved.ttsEngine! : 'voxcpm2';
      const defaultTtsEndpoint = 'http://127.0.0.1:8177';
      return { ...saved, endpoint: saved.endpoint ?? '', model: saved.model ?? '', systemInstructions: saved.systemInstructions ?? '', apiKey: '', models: [], temperature: saved.temperature ?? 1, maxTokens: saved.maxTokens && saved.maxTokens > 0 ? saved.maxTokens : 32768, variation: saved.variation ?? true, maxCycleSpeakers: saved.maxCycleSpeakers ?? 8, ttsEnabled: saved.ttsEnabled ?? false, ttsCloningConsent: saved.ttsCloningConsent ?? false, ttsEngine, ttsLanguage: saved.ttsLanguage ?? 'ja', ttsEndpoint: !hasSupportedSavedEngine || !saved.ttsEndpoint || ['http://127.0.0.1:8174', 'http://127.0.0.1:8175'].includes(saved.ttsEndpoint) ? defaultTtsEndpoint : saved.ttsEndpoint };
    } catch {
      return { endpoint: '', model: '', systemInstructions: '', apiKey: '', models: [], temperature: 1, maxTokens: 32768, variation: true, maxCycleSpeakers: 8, ttsEnabled: false, ttsCloningConsent: false, ttsEngine: 'voxcpm2', ttsLanguage: 'ja', ttsEndpoint: 'http://127.0.0.1:8177' };
    }
  });
  const [voiceRuntime, setVoiceRuntime] = useState<{ ttsEnabled: boolean; ttsEndpoint: string; ttsEngine: VoiceModelId; ttsLanguage: VoiceLanguage; ttsStyle?: string }>();
  const [voiceSettingsSaving, setVoiceSettingsSaving] = useState(false);
  const voiceSettingsSavingRef = useRef(false);
  const [vramInfo, setVramInfo] = useState<{ device?: string; totalVramMB?: number; usedVramMB?: number; availableVramMB?: number; processVramMB?: number; acceleratorBackend?: string; acceleratorAvailable?: boolean }>();
  const refreshTtsVram = useCallback(() => {
    const endpoint = (provider.ttsEndpoint ?? 'http://127.0.0.1:8177').replace(/\/+$/, '');
    void fetch(`${endpoint}/health`, { cache: 'no-store', signal: AbortSignal.timeout(1200) })
      .then(response => response.ok ? response.json() : undefined)
      .then(health => { if (health) setVramInfo(current => ({ ...current, device: health.device ?? current?.device, totalVramMB: health.totalVramMB ?? current?.totalVramMB, usedVramMB: health.usedVramMB ?? current?.usedVramMB, availableVramMB: health.availableVramMB ?? current?.availableVramMB, processVramMB: health.processVramMB ?? 0, acceleratorBackend: health.acceleratorBackend ?? current?.acceleratorBackend, acceleratorAvailable: health.acceleratorAvailable ?? current?.acceleratorAvailable })); })
      .catch(() => setVramInfo(undefined));
  }, [provider.ttsEndpoint]);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [contextStrategy, setContextStrategy] = useState<ConversationContextMode>('full');
  const [mainCharacterId, setMainCharacterId] = useState<string>();
  const [sliceId, setSliceId] = useState('');
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  const characters = useMemo(() => [...(data?.entities.values() ?? [])].filter(entity => entity.type === 'character') as Character[], [data]);
  const displayStudentName = (character: Character | undefined) => character ? (language === 'en' ? character.nameEn ?? character.id.replace(/^character:/, '').replace(/(^|-)([a-z])/g, (_m, p1, p2) => `${p1}${p2.toUpperCase()}`) : character.name) : '';
  const localizedCharacters = useMemo(() => characters.map(character => ({ ...character, name: displayStudentName(character), summary: language === 'en' ? character.summaryEn : character.summary })), [characters, language]);
  const slice = data && sliceId ? (sliceId === 'none' ? NO_TIMELINE_SLICE : data.timeSlices.find(candidate => candidate.id === sliceId)) : undefined;
  const mainCharacter = characters.find(character => character.id === mainCharacterId) ?? characters[0];
  const participants = useMemo(() => characters.filter(character => participantIds.includes(character.id)), [characters, participantIds]);
  const localizedParticipants = useMemo(() => participants.map(character => ({ ...character, name: displayStudentName(character), summary: language === 'en' ? character.summaryEn : character.summary })), [participants, language]);
  const activeStateId = data && mainCharacter && slice ? resolveState(mainCharacter, data.states, slice, undefined, data.timeSlices)?.id : undefined;

  // World theme colours are only applied after a world is loaded; before that the palette is monochrome.
  const themeStyle = data?.world.theme?.colors ? { '--world-primary': data.world.theme.colors.primary, '--world-secondary': data.world.theme.colors.secondary, '--world-accent': data.world.theme.colors.accent } as React.CSSProperties : undefined;

  const localeBaseSource = useRef<WorldSource | undefined>(undefined);
  const localizedWorldCache = useRef(new WeakMap<WorldSource, Map<'ko' | 'en', Promise<WorldData>>>());
  const loadPackageForLanguage = async (source: WorldSource, requestedLanguage: 'ko' | 'en') => {
    if (requestedLanguage === 'ko') return loadWorld(source, { language: 'ko', lazyDocuments: true });
    const response = await fetch(`${import.meta.env.BASE_URL}locales/en/manifest.json`);
    if (!response.ok) throw new Error('English source overlay manifest is not installed.');
    const paths = await response.json() as string[];
    const pathSet = new Set(paths);
    const overlay: WorldSource = {
      read: async path => {
        if (!pathSet.has(path)) throw new Error(`No original English source is available for ${path}.`);
        const file = await fetch(`${import.meta.env.BASE_URL}${path}`);
        if (!file.ok) throw new Error(`English source file missing: ${path}`);
        return file.text();
      },
      exists: async path => pathSet.has(path),
      listPaths: async () => paths,
    };
    return loadWorld(withLocaleOverlay(source, overlay, paths), { language: 'en', lazyDocuments: true });
  };
  const loadCachedPackageForLanguage = (source: WorldSource, requestedLanguage: 'ko' | 'en') => {
    let packageCache = localizedWorldCache.current.get(source);
    if (!packageCache) { packageCache = new Map(); localizedWorldCache.current.set(source, packageCache); }
    const cached = packageCache.get(requestedLanguage);
    if (cached) return cached;
    const pending = loadPackageForLanguage(source, requestedLanguage);
    packageCache.set(requestedLanguage, pending);
    void pending.catch(() => { if (packageCache?.get(requestedLanguage) === pending) packageCache.delete(requestedLanguage); });
    return pending;
  };

  const applyLoaded = (loaded: WorldData) => {
    setNotice(undefined);
    setData(loaded);
    // 기본 선택 없음 — 대화 상대는 사용자가 직접 고른다.
    setMainCharacterId(undefined);
    setParticipantIds([]);
    setSliceId('');
    setThreadMessages([]);
    turnHistory.current = [];
    setBrowseCategory(undefined);
    setPickerOpen(false);
  };

  // 개발 편의: `?world=<url>`로 패키지를 바로 열 수 있다(브라우저 파일 선택 없이 UI 확인용).
  React.useEffect(() => {
    const startupWorld = new URLSearchParams(window.location.search).get('world') ?? '/api/blue-archive';
    let cancelled = false;
    void (async () => {
      try {
        if (startupWorld === '/api/blue-archive') {
          localeBaseSource.current = await createRemoteZipSource(startupWorld);
        } else {
          const response = await fetch(startupWorld);
          if (!response.ok) throw new Error(`패키지 요청 실패 (${response.status}). URL 설정이나 패키지 위치를 확인해 주세요.`);
          localeBaseSource.current = createZipSource(new Uint8Array(await response.arrayBuffer()));
        }
        const loaded = await loadCachedPackageForLanguage(localeBaseSource.current, language);
        if (cancelled) return;
        applyLoaded(loaded);
        setScreen('home');
        const source = localeBaseSource.current;
        if (source) window.setTimeout(() => {
          void loadCachedPackageForLanguage(source, language === 'en' ? 'ko' : 'en').catch(() => {});
        }, 300);
      } catch (error) {
        if (!cancelled) setNotice(`${language === 'en' ? 'Could not load the requested language source' : '블루 아카이브 데이터를 열지 못했습니다'}: ${error instanceof Error ? error.message : 'invalid package'} — ${language === 'en' ? 'choose another package' : '패키지 열기로 직접 선택할 수 있습니다'}.`);
      } finally {
        if (!cancelled) setStartupLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The local worker can outlive the UI process. Drop model references on window close so CUDA
  // memory is released even when the worker itself was started separately from the app.
  useEffect(() => {
    const endpoint = (provider.ttsEndpoint ?? 'http://127.0.0.1:8177').replace(/\/+$/, '');
    let localService = false;
    try { localService = ['localhost', '127.0.0.1', '::1'].includes(new URL(endpoint).hostname); } catch { /* invalid until fixed in settings */ }
    if (!localService) return undefined;
    const unload = () => { try { navigator.sendBeacon(`${endpoint}/unload`, new Blob([], { type: 'text/plain' })); } catch { /* best effort during process shutdown */ } };
    window.addEventListener('pagehide', unload);
    return () => window.removeEventListener('pagehide', unload);
  }, [provider.ttsEndpoint]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    void (async () => {
      try {
        const source = localeBaseSource.current ?? data.source;
        if (!source) throw new Error('Package source is unavailable.');
        const localized = await loadCachedPackageForLanguage(source, language);
        if (!cancelled) { setData(localized); setSliceId(current => current === 'none' || !current || localized.timeSlices.some(item => item.id === current) ? current : ''); }
      } catch (error) {
        if (!cancelled) setNotice(language === 'en' ? `English source coverage is incomplete: ${error instanceof Error ? error.message : 'load failed'}` : '한국어 원문을 다시 불러오지 못했습니다.');
      }
    })();
    return () => { cancelled = true; };
  }, [language]);

  const openWorld = async (file: File) => {
    setNotice(undefined);
    try {
      localeBaseSource.current = createZipSource(new Uint8Array(await file.arrayBuffer()));
      const loaded = await loadCachedPackageForLanguage(localeBaseSource.current, language);
      const errors = validateWorld(loaded).filter(issue => issue.level === 'error');
      if (errors.length) { setNotice(`세계관 패키지를 열 수 없습니다: ${errors.map(issue => issue.message).join(' · ')}`); return; }
      applyLoaded(loaded);
      setScreen('home');
    } catch (error) {
      setNotice(`${language === 'en' ? 'Could not load the English package' : '세계관 패키지를 열 수 없습니다'}: ${error instanceof Error ? error.message : 'invalid package'}`);
    }
  };

  // API 키는 로컬 서버 파일(권장) → 브라우저 저장소 → OS 키체인 순으로 저장된다(웹 서버 모드에서도 유지).
  const providerSettingsSnapshot = (config: ProviderConfig) => ({ endpoint: config.endpoint, model: config.model, systemInstructions: config.systemInstructions ?? '', temperature: config.temperature, maxTokens: config.maxTokens, variation: config.variation, maxCycleSpeakers: config.maxCycleSpeakers, ttsEnabled: config.ttsEnabled, ttsEndpoint: config.ttsEndpoint, ttsEngine: config.ttsEngine, ttsLanguage: config.ttsLanguage, ttsStyle: config.ttsStyle, ttsCloningConsent: config.ttsCloningConsent });
  const saveProvider = async () => {
    const backend = await saveProviderSettings(providerSettingsSnapshot(provider));
    setProvider(current => ({ ...current, status: backend === 'none' ? (language === 'en' ? 'Could not save settings.' : '설정을 저장하지 못했습니다.') : (language === 'en' ? `Settings saved — ${backendLabel(backend)}` : `설정을 저장했습니다 — ${backendLabel(backend)}`) }));
  };
  const loadSavedProviderSettings = async () => {
    const { settings, backend } = await loadProviderSettings();
    setSettingsLoaded(true);
    if (!settings) {
      setProvider(current => ({ ...current, status: language === 'en' ? 'No saved endpoint and model settings were found.' : '저장된 엔드포인트와 모델 설정이 없습니다.' }));
      return;
    }
    providerSettingsEdited.current = false;
    setProvider(current => ({ ...current, ...settings, maxTokens: settings.maxTokens && settings.maxTokens > 0 ? settings.maxTokens : 32768, status: language === 'en' ? `Saved endpoint and model loaded — ${backendLabel(backend)}` : `저장된 엔드포인트와 모델을 불러왔습니다 — ${backendLabel(backend)}` }));
  };
  const changeProviderSettings = (next: ProviderConfig) => {
    providerSettingsEdited.current = true;
    setProvider(next);
  };
  const saveKey = async () => {
    const settingsBackend = await saveProviderSettings(providerSettingsSnapshot(provider));
    if (!provider.apiKey) {
      setProvider(current => ({ ...current, status: settingsBackend === 'none' ? '설정을 저장하지 못했습니다.' : `엔드포인트와 모델을 저장했습니다 — ${backendLabel(settingsBackend)}` }));
      return;
    }
    const backend = await saveApiKey(provider.apiKey);
    setProvider(current => ({ ...current, apiKey: '', status: backend === 'none' || settingsBackend === 'none' ? '키 또는 설정을 저장하지 못했습니다.' : `키, 엔드포인트 및 모델을 저장했습니다 — ${backendLabel(backend)}` }));
  };
  const loadKey = async () => {
    const { secret, backend } = await loadApiKey();
    setProvider(current => ({ ...current, apiKey: secret, status: secret ? `저장된 키를 불러왔습니다 — ${backendLabel(backend)}` : '저장된 키가 없습니다.' }));
  };
  const loadModels = async () => {
    try {
      // Saving a key clears it from the form and stores it in the OS keychain/server/browser store.
      // Reuse that saved credential here just as chat generation does.
      const secret = provider.apiKey || (await loadApiKey()).secret;
      let models: ModelInfo[];
      if (isDesktopRuntime()) {
        models = await invoke<ModelInfo[]>('provider_list_models', { endpoint: provider.endpoint, apiKey: secret });
      } else {
        const response = await fetch('/api/provider/models', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: provider.endpoint, apiKey: secret }),
        });
        const responseText = await response.text();
        let result: { models?: ModelInfo[]; error?: string } = {};
        try { result = JSON.parse(responseText) as typeof result; } catch { /* report the HTTP status below */ }
        if (!response.ok) throw new Error(result.error ?? `Model proxy returned HTTP ${response.status}. Restart the local app server if this is a 404.`);
        models = result.models ?? [];
      }
      setProvider(current => ({ ...current, models, status: language === 'en' ? `Loaded ${models.length} models.` : `${models.length}개 모델을 불러왔습니다.` }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error';
      setProvider(current => ({ ...current, models: [], status: language === 'en' ? `Could not load models: ${message}` : `모델 목록을 불러오지 못했습니다: ${message}` }));
    }
  };

  const saveVoiceSettings = async (requestedConfig: ProviderConfig = provider) => {
    if (voiceSettingsSavingRef.current) return;
    voiceSettingsSavingRef.current = true;
    setVoiceSettingsSaving(true);
    let modelProgressTimer: number | undefined;
    try {
      const ttsEngine: VoiceModelId = VOICE_MODELS.some(model => model.id === requestedConfig.ttsEngine) ? requestedConfig.ttsEngine! : 'voxcpm2';
      const settings = { ttsEnabled: requestedConfig.ttsEnabled ?? false, ttsEngine, ttsLanguage: requestedConfig.ttsLanguage ?? 'ja', ttsStyle: requestedConfig.ttsStyle ?? '', ttsCloningConsent: requestedConfig.ttsCloningConsent ?? false, ttsEndpoint: requestedConfig.ttsEndpoint ?? 'http://127.0.0.1:8177' };
      // Saving only TTS fields used to replace the provider settings object and erase endpoint/model.
      await saveProviderSettings(providerSettingsSnapshot({ ...requestedConfig, ...settings }));
      if (!settings.ttsEnabled) {
        if (voiceRuntime?.ttsEnabled) void fetch(`${voiceRuntime.ttsEndpoint.replace(/\/+$/, '')}/unload`, { method: 'POST' }).catch(() => {});
        setVoiceRuntime(settings);
        setProvider(current => ({ ...current, ttsStatus: language === 'en' ? 'Voice generation is off; no local model is loaded.' : '음성 생성이 꺼져 있어 로컬 모델을 불러오지 않았습니다.' }));
        return;
      }
      if (!settings.ttsCloningConsent) throw new Error(language === 'en' ? 'Confirm that you have permission to clone the included reference voices and will identify generated speech as AI-made.' : '포함된 음성 참조를 복제할 권한과 AI 음성 표시를 확인해 주세요.');
      const endpoint = settings.ttsEndpoint.replace(/\/+$/, '');
      let localEndpoint = false;
      try { localEndpoint = ['localhost', '127.0.0.1', '::1'].includes(new URL(endpoint).hostname); } catch { /* invalid endpoint is reported by fetch */ }
      const startupResponse = localEndpoint
        ? await fetch('/api/tts/ensure', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint, engine: settings.ttsEngine }) })
        : await fetch(`${endpoint}/health`);
      const startup = await startupResponse.json().catch(() => ({})) as { error?: string; engine?: string };
      if (!startupResponse.ok) throw new Error(startup.error ?? (language === 'en' ? 'Could not start or reach the local voice service.' : '로컬 음성 서비스를 시작하거나 연결하지 못했습니다.'));
      if (startup.engine && startup.engine !== settings.ttsEngine) throw new Error(language === 'en' ? `The service at this address runs ${startup.engine}; choose its matching voice model or use its default local address.` : `이 주소의 서비스는 ${startup.engine}을 실행 중입니다. 일치하는 음성 모델을 선택하거나 기본 로컬 주소를 사용하세요.`);
      let progressPollActive = false;
      modelProgressTimer = window.setInterval(() => {
        if (progressPollActive) return;
        progressPollActive = true;
        void fetch(`${endpoint}/health`, { cache: 'no-store' })
          .then(response => response.ok ? response.json() : undefined)
          .then(health => {
            if (health?.loadStatus?.state === 'loading') setProvider(current => ({ ...current, ttsStatus: modelProgressText(health.loadStatus, language) }));
          })
          .catch(() => {})
          .finally(() => { progressPollActive = false; });
      }, 700);
      const response = await fetch(`${endpoint}/configure`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ttsEnabled: true, engine: settings.ttsEngine, language: settings.ttsLanguage, cloningConsent: settings.ttsCloningConsent }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; expectedVramMB?: number; usedVramMB?: number; availableVramMB?: number; totalVramMB?: number; processVramMB?: number; warning?: boolean; device?: string; acceleratorBackend?: string; acceleratorAvailable?: boolean };
      if (!response.ok) throw new Error(payload.error ?? `Voice service returned HTTP ${response.status}.`);
      setVoiceRuntime(settings);
      setVramInfo(current => ({ ...current, device: payload.device ?? current?.device, totalVramMB: payload.totalVramMB ?? current?.totalVramMB, usedVramMB: payload.usedVramMB ?? current?.usedVramMB, availableVramMB: payload.availableVramMB ?? current?.availableVramMB, processVramMB: payload.processVramMB ?? 0, acceleratorBackend: payload.acceleratorBackend ?? current?.acceleratorBackend, acceleratorAvailable: payload.acceleratorAvailable ?? current?.acceleratorAvailable }));
      const status = payload.warning
        ? (language === 'en' ? 'Voice model loaded, but GPU memory is below the estimate plus 500 MB headroom.' : '음성 모델을 불러왔지만 GPU 메모리가 예상치와 500 MB 여유보다 적습니다.')
        : (language === 'en' ? `Voice settings saved${payload.expectedVramMB ? ` · expected ${(payload.expectedVramMB / 1024).toFixed(1)} GB VRAM` : ''}.` : `음성 설정을 저장했습니다${payload.expectedVramMB ? ` · 예상 VRAM ${(payload.expectedVramMB / 1024).toFixed(1)} GB` : ''}.`);
      setProvider(current => ({ ...current, ttsStatus: status }));
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = /failed to fetch|networkerror|fetch failed/i.test(rawMessage)
        ? (language === 'en' ? 'The local voice model service could not be started automatically. Check Python and GPU runtime setup.' : '로컬 음성 모델 서비스를 자동으로 시작하지 못했습니다. Python 및 GPU 런타임 설정을 확인해 주세요.')
        : rawMessage;
      setProvider(current => ({ ...current, ttsStatus: message }));
    } finally {
      if (modelProgressTimer !== undefined) window.clearInterval(modelProgressTimer);
      voiceSettingsSavingRef.current = false;
      setVoiceSettingsSaving(false);
    }
  };

  const generateTtsPreview = async () => {
    if (!voiceRuntime?.ttsEnabled) {
      setTtsPreviewStatus(language === 'en' ? 'Save voice settings first.' : '먼저 음성 설정을 저장해 주세요.');
      return;
    }
    if (!data?.source) { setTtsPreviewStatus(language === 'en' ? 'Open a world package with voice references first.' : '음성 참조가 포함된 세계관 패키지를 먼저 열어 주세요.'); return; }
    const sampleStatusLanguage = voiceRuntime.ttsLanguage === 'ja' ? 'Japanese' : voiceRuntime.ttsLanguage === 'ko' ? 'Korean' : 'English';
    setTtsPreviewStatus(language === 'en' ? `Generating a ${sampleStatusLanguage} voice sample…` : `${voiceRuntime.ttsLanguage === 'ja' ? '일본어' : voiceRuntime.ttsLanguage === 'ko' ? '한국어' : '영어'} 음성 샘플 생성 중…`);
    setTtsPreviewBusy(true);
    setTtsPreviewAudio(undefined);
    try {
      const manifestPath = 'tts-references/manifest.json';
      if (!await data.source.exists(manifestPath)) throw new Error(language === 'en' ? 'This package has no voice references.' : '이 패키지에 음성 참조 파일이 없습니다.');
      const manifest = JSON.parse(await data.source.read(manifestPath)) as { references?: Record<string, { file: string; transcript: string }> };
      const [studentId, reference] = Object.entries(manifest.references ?? {})[0] ?? [];
      if (!reference) throw new Error(language === 'en' ? 'This package has no voice references.' : '이 패키지에 음성 참조 파일이 없습니다.');
      const bytes = await readAssetBytes(data, reference.file);
      if (!bytes) throw new Error(language === 'en' ? 'Could not read the voice reference.' : '음성 참조 파일을 읽지 못했습니다.');
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      const endpoint = (voiceRuntime.ttsEndpoint ?? 'http://127.0.0.1:8177').replace(/\/+$/, '');
      const previewText: Record<VoiceLanguage, string> = { ja: 'こんにちは、先生。今日もよろしくお願いします。', en: 'Hello, Sensei. I hope you have a wonderful day.', ko: '안녕하세요, 선생님. 오늘도 잘 부탁드려요.' };
      const response = await fetch(`${endpoint}/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: previewText[voiceRuntime.ttsLanguage], referenceText: reference.transcript, referenceAudioBase64: btoa(binary), requestId: crypto.randomUUID(), engine: voiceRuntime.ttsEngine, language: voiceRuntime.ttsLanguage, style: voiceRuntime.ttsStyle }) });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `Voice service returned HTTP ${response.status}`);
      }
      const audioUrl = URL.createObjectURL(await response.blob());
      setTtsPreviewAudio(audioUrl);
      const studentName = displayStudentName(characters.find(character => character.id === studentId)) || studentId;
      setTtsPreviewStatus(language === 'en' ? `Sample generated with ${studentName}'s reference.` : `${studentName}의 음성 참조로 샘플을 생성했습니다.`);
    } catch (error) {
      setTtsPreviewStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setTtsPreviewBusy(false);
    }
  };

  const activeConversationId = `ba-${participantIds.slice().sort().join('+') || mainCharacterId || 'inbox'}`;
  const refreshConversations = async (worldId = data?.world.id) => {
    if (!worldId) return;
    try { setConversationSummaries(await listConversations(worldId)); } catch { setConversationSummaries([]); }
  };
  useEffect(() => { void refreshConversations(); }, [data?.world.id]);
  const persistTurn = async (turn: ChatMessage, conversationId = currentConversationId === 'ba-inbox' ? activeConversationId : currentConversationId) => {
    if (!data || !slice) return;
    try {
      await saveConversationTurn({ id: conversationId, world: data.world.id, timeSlice: slice.id, player: profile.name, updatedAt: new Date().toISOString(), message: toStoredTurn(conversationId, turn) });
      void refreshConversations(data.world.id);
    } catch { /* Storage is unavailable; chat itself remains usable. */ }
  };

  const openCharacterProfile = (id: string) => {
    const character = characters.find(candidate => candidate.id === id);
    const category = character?.categories?.[0] ?? data?.world.entrypoints.find(entry => entry.startsWith('category:'))?.slice('category:'.length) ?? '';
    setBrowseCategory(category);
    setSelectedProfileCharacter(id);
  };
  const toggleParticipant = (id: string) => setParticipantIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const toggleFolder = (ids: string[], next: boolean) => setParticipantIds(current => next ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)));

  const openConversation = async (conversationId: string, ids: string[]) => {
    if (!ids.length) return;
    const requestId = ++conversationRequest.current;
    setParticipantIds(ids);
    setMainCharacterId(ids[0]);
    setCurrentConversationId(conversationId);
    setContextStrategy(loadConversationContextMode(conversationId, ids.length));
    try {
      const turns = fromStoredTurns(await loadConversation(conversationId));
      if (requestId !== conversationRequest.current) return;
      turnHistory.current = turns;
      lastSpeakers.current = [];
      const restored = turns.map(message => ({ speaker: message.speaker.type === 'player' ? (language === 'en' ? 'You' : '나') : displayStudentName(data?.entities.get(message.speaker.id) as Character | undefined) || message.speaker.id, nodes: message.content }));
      setThreadMessages(restored.map((message, index) => ({ id: turns[index]?.id ?? `restored-${index}`, speaker: message.speaker, nodes: message.nodes, createdAt: turns[index]?.timestamp ?? new Date().toISOString(), edited: false, reactions: {} })));
      setPickerOpen(false);
      setScreen('chat');
    } catch {
      if (requestId !== conversationRequest.current) return;
      turnHistory.current = []; setThreadMessages([]); setPickerOpen(false); setScreen('chat');
    }
  };
  const conversationRequest = useRef(0);
  const startChat = (mode: ConversationContextMode) => {
    if (participantIds.length === 0 || !sliceId) return;
    const ids = [...participantIds].sort();
    const conversationId = `ba-${ids.join('+')}`;
    saveConversationContextMode(conversationId, mode);
    setContextStrategy(mode);
    void openConversation(conversationId, ids);
  };

  const requestTimelineSelection = async (id: string, participants: string[], forceSelection = false) => {
    const normalizeId = (value: string) => value.replace(/^character:/, '');
    const wanted = participants.map(normalizeId).sort();
    const hasSameParticipants = (conversationId: string) => {
      const stored = conversationId.startsWith('ba-') ? conversationId.slice(3).split('+').map(normalizeId).sort() : [];
      return stored.length === wanted.length && stored.every((participant, index) => participant === wanted[index]);
    };
    let existing = !forceSelection && (
      conversationSummaries.find(conversation => conversation.id === id)
      ?? conversationSummaries.find(conversation => hasSameParticipants(conversation.id))
    );
    if (!forceSelection && !existing && data) {
      const latest = await listConversations(data.world.id).catch(() => []);
      setConversationSummaries(latest);
      existing = latest.find(conversation => conversation.id === id)
        ?? latest.find(conversation => hasSameParticipants(conversation.id));
    }
    if (existing) {
      const rememberedSlice = existing.timeSlice;
      setSliceId(rememberedSlice === 'none' || data?.timeSlices.some(item => item.id === rememberedSlice) ? rememberedSlice : 'none');
      setPendingConversation(undefined);
      void openConversation(existing.id, participants);
      return;
    }
    if (!forceSelection) {
      const turns = await loadConversation(id).catch(() => []);
      if (turns.length) {
        setSliceId('none');
        setPendingConversation(undefined);
        void openConversation(id, participants);
        return;
      }
    }
    setPendingConversation({ id, participants });
    setSliceId('');
    setScreen('home');
  };
  const continueAfterTimelineSelection = () => {
    if (!pendingConversation || !sliceId) return;
    const pending = pendingConversation;
    setPendingConversation(undefined);
    void openConversation(pending.id, pending.participants);
  };

  const sendToStudent = (characterId: string) => {
    requestTimelineSelection(`ba-${characterId}`, [characterId]);
  };

  const resetChat = async () => {
    const participants = [...participantIds].sort();
    if (!participants.length) return;
    const accepted = window.confirm(language === 'en' ? 'Delete this conversation and all of its messages?' : '이 대화와 모든 메시지를 삭제할까요?');
    if (!accepted) return;
    const id = currentConversationId;
    clearGeneratedVoices();
    await clearConversation(id);
    setThreadMessages([]);
    turnHistory.current = [];
    lastSpeakers.current = [];
    await refreshConversations(data?.world.id);
    requestTimelineSelection(id, participants, true);
  };

  /** 진행 중인 대화의 원본 기록(화자 id 포함). 화면용 messages와 달리 이름이 아니라 id를 유지한다. */
  const turnHistory = useRef<ChatMessage[]>([]);
  const lastSpeakers = useRef<string[]>([]);
  useEffect(() => {
    if (!data) return;
    const turnsById = new Map(turnHistory.current.map(turn => [turn.id, turn]));
    setThreadMessages(current => current.map(message => {
      if (message.speaker === '나' || message.speaker === 'You') return { ...message, speaker: language === 'en' ? 'You' : '나' };
      const turn = turnsById.get(message.id);
      if (turn?.speaker.type !== 'character') return message;
      const student = data.entities.get(turn.speaker.id) as Character | undefined;
      return student ? { ...message, speaker: displayStudentName(student) } : message;
    }));
  }, [data, language]);

  const sampling = useMemo<SamplingOptions>(() => ({
    temperature: provider.temperature ?? 1,
    ...(provider.maxTokens && provider.maxTokens > 0 ? { maxTokens: provider.maxTokens } : {}),
  }), [provider.temperature, provider.maxTokens]);

  // 저장된 설정(엔드포인트·모델·temperature 등)을 시작할 때 불러온다 — API 키와 같은 저장소를 쓴다.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { settings, backend } = await loadProviderSettings();
      if (cancelled) return;
      setSettingsLoaded(true);
      if (!settings) return;
      if (providerSettingsEdited.current) return;
      const ttsEngine: VoiceModelId = VOICE_MODELS.some(model => model.id === settings.ttsEngine)
        ? settings.ttsEngine!
        : provider.ttsEngine ?? 'voxcpm2';
      const loadedTtsEndpoint = settings.ttsEndpoint;
      const defaultTtsEndpoint = 'http://127.0.0.1:8177';
      const hasSupportedSavedEngine = VOICE_MODELS.some(model => model.id === settings.ttsEngine);
      const loadedProvider = { ...provider, ...settings, ttsLanguage: settings.ttsLanguage ?? 'ja', ttsCloningConsent: settings.ttsCloningConsent ?? false, ttsEngine, ttsEndpoint: !hasSupportedSavedEngine || !loadedTtsEndpoint || ['http://127.0.0.1:8174', 'http://127.0.0.1:8175'].includes(loadedTtsEndpoint) ? defaultTtsEndpoint : loadedTtsEndpoint, maxTokens: settings.maxTokens && settings.maxTokens > 0 ? settings.maxTokens : 32768 };
      setProvider(current => ({ ...current, ...loadedProvider, status: language === 'en' ? `Saved settings loaded — ${backendLabel(backend)}` : `저장된 설정을 불러왔습니다 — ${backendLabel(backend)}` }));
      if (loadedProvider.ttsEnabled) void saveVoiceSettings(loadedProvider);
    })();
    return () => { cancelled = true; };
  }, []);

  // 설정이 바뀌면 자동 저장(입력 중 매 글자마다 요청하지 않도록 잠깐 모았다가 보낸다).
  useEffect(() => {
    if (!settingsLoaded) return undefined;
    const settings = providerSettingsSnapshot(provider);
    const timer = setTimeout(() => { void saveProviderSettings(settings); }, 500);
    return () => clearTimeout(timer);
  }, [settingsLoaded, provider.endpoint, provider.model, provider.systemInstructions, provider.temperature, provider.maxTokens, provider.variation, provider.maxCycleSpeakers, provider.ttsEnabled, provider.ttsEndpoint, provider.ttsEngine, provider.ttsLanguage, provider.ttsStyle, provider.ttsCloningConsent]);

  /** 진행 중인 사이클 제어(멈추기 버튼 + 요청 중단). */
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const messageStyleCache = useRef(new Map<string, MessageStyle | null>());
  const loadMessageStyles = async (loaded: WorldData, activeCharacters: Character[]) => {
    const result: Record<string, MessageStyle> = {};
    await Promise.all(activeCharacters.map(async character => {
      const cacheKey = `${loaded.world.id}:${language}:${character.id}`;
      if (messageStyleCache.current.has(cacheKey)) {
        const style = messageStyleCache.current.get(cacheKey);
        if (style) result[character.id] = style;
        return;
      }
      const slug = character.id.replace(/^character:/, '');
      const paths = language === 'en'
        ? [`locales/en/characters/${slug}/conversation.md`, `characters/${slug}/conversation.md`]
        : [`characters/${slug}/conversation.md`, `locales/en/characters/${slug}/conversation.md`];
      let style: MessageStyle | undefined;
      for (const path of paths) {
        try {
          let transcript: string | undefined;
          if (loaded.source && await loaded.source.exists(path)) transcript = await loaded.source.read(path);
          else if (path.startsWith('locales/en/')) {
            const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
            if (response.ok) transcript = await response.text();
          }
          if (!transcript) continue;
          style = inferMessageStyle(transcript, [character.name, character.nameEn ?? '', slug]);
          if (style) break;
        } catch { /* Some packages omit transcript references; use the generic cadence. */ }
      }
      messageStyleCache.current.set(cacheKey, style ?? null);
      if (style) result[character.id] = style;
    }));
    return result;
  };

  const generateVoice = async (speaker: Character, messageId: string, voiceText: string, parentSignal?: AbortSignal, deliveryStyle?: string) => {
    voiceGenerationControllers.current.get(messageId)?.controller.abort();
    const controller = new AbortController();
    const requestId = crypto.randomUUID();
    const endpoint = (voiceRuntime?.ttsEndpoint ?? 'http://127.0.0.1:8177').replace(/\/+$/, '');
    const queuedAt = Date.now();
    const activeGeneration: { controller: AbortController; endpoint: string; requestId: string; phase: 'queued' | 'generating' } = { controller, endpoint, requestId, phase: 'queued' };
    voiceGenerationControllers.current.set(messageId, activeGeneration);
    const abortFromParent = () => controller.abort();
    if (parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    setGeneratedVoices(current => ({ ...current, [messageId]: { state: 'queued', stage: 'queued', text: voiceText, textCharacters: Array.from(voiceText).length, startedAt: queuedAt, elapsedMs: 0 } }));
    let progressTimer: number | undefined;
    let progressRequestActive = false;
    progressTimer = window.setInterval(() => {
      const elapsedMs = Date.now() - queuedAt;
      setGeneratedVoices(current => {
        const voice = current[messageId];
        return voice && (voice.state === 'queued' || voice.state === 'loading') ? { ...current, [messageId]: { ...voice, elapsedMs } } : current;
      });
      if (activeGeneration.phase !== 'generating' || progressRequestActive || controller.signal.aborted) return;
      progressRequestActive = true;
      void fetch(`${endpoint}/progress?requestId=${encodeURIComponent(requestId)}`, { signal: controller.signal, cache: 'no-store' })
        .then(response => response.ok ? response.json() : undefined)
        .then((progress: { stage?: string; generatedTokens?: number; elapsedMs?: number } | undefined) => {
          if (!progress || controller.signal.aborted) return;
          setGeneratedVoices(current => {
            const voice = current[messageId];
            return voice?.state === 'loading' ? { ...current, [messageId]: { ...voice, stage: progress.stage ?? voice.stage, generatedTokens: progress.generatedTokens ?? voice.generatedTokens, elapsedMs: Math.max(elapsedMs, progress.elapsedMs ?? 0) } } : current;
          });
        })
        .catch(() => {})
        .finally(() => { progressRequestActive = false; });
    }, 500);
    const previousJob = voiceGenerationQueue.current;
    let releaseJob!: () => void;
    const thisJob = new Promise<void>(resolve => { releaseJob = resolve; });
    voiceGenerationQueue.current = previousJob.catch(() => {}).then(() => thisJob);
    try {
      await previousJob.catch(() => {});
      if (controller.signal.aborted) return;
      if (!voiceRuntime?.ttsEnabled) throw new Error(locale === 'en' ? 'Voice generation is not active. Save TTS settings first.' : '음성 생성이 활성화되지 않았습니다. TTS 설정을 저장해 주세요.');
      if (!data?.source) throw new Error(locale === 'en' ? 'World package data is unavailable.' : '세계관 패키지 데이터를 읽을 수 없습니다.');
      const manifestPath = 'tts-references/manifest.json';
      if (!await data.source.exists(manifestPath)) throw new Error(locale === 'en' ? 'This world package was exported without voice references. Re-export it with TTS references included.' : '이 패키지에 음성 참조 파일이 없습니다. TTS 참조 파일을 포함해 다시 내보내 주세요.');
      const manifest = JSON.parse(await data.source.read(manifestPath)) as { references?: Record<string, { file: string; transcript: string }> };
      const reference = manifest.references?.[speaker.id];
      if (!reference) throw new Error(locale === 'en' ? `No suitable voice reference audio for ${speaker.name}.` : `${speaker.name}의 음성 참조 파일이 없습니다.`);
      const referenceBytes = await readAssetBytes(data, reference.file);
      if (!referenceBytes) throw new Error(locale === 'en' ? `Could not read ${speaker.name}'s reference audio.` : `${speaker.name}의 음성 참조 파일을 읽지 못했습니다.`);

      if (!voiceText) throw new Error(locale === 'en' ? 'The LLM did not return voice text in the selected language.' : 'LLM이 선택한 음성 언어의 문장을 반환하지 않았습니다.');
      const bytesToBase64 = (bytes: Uint8Array) => {
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        return btoa(binary);
      };
      const sourceKey = data.source ?? data;
      let sourceBase64 = referenceBase64Cache.current.get(sourceKey);
      if (!sourceBase64) {
        sourceBase64 = new Map();
        referenceBase64Cache.current.set(sourceKey, sourceBase64);
      }
      let referenceAudioBase64 = sourceBase64.get(reference.file);
      if (!referenceAudioBase64) {
        referenceAudioBase64 = bytesToBase64(referenceBytes);
        sourceBase64.set(reference.file, referenceAudioBase64);
        if (sourceBase64.size > 32) sourceBase64.delete(sourceBase64.keys().next().value!);
      }
      activeGeneration.phase = 'generating';
      setGeneratedVoices(current => ({ ...current, [messageId]: { state: 'loading', stage: 'preparing_reference', text: voiceText, textCharacters: Array.from(voiceText).length, startedAt: queuedAt, elapsedMs: Date.now() - queuedAt } }));
      const response = await fetch(`${endpoint}/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ text: voiceText, referenceText: reference.transcript, referenceAudioBase64, requestId, engine: voiceRuntime.ttsEngine, language: voiceRuntime.ttsLanguage, style: deliveryStyle || voiceRuntime.ttsStyle }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `Voice service returned HTTP ${response.status}`);
      }
      const audio = await response.blob();
      if (controller.signal.aborted) return;
      const priorUrl = generatedVoiceUrls.current.get(messageId);
      if (priorUrl) URL.revokeObjectURL(priorUrl);
      const audioUrl = URL.createObjectURL(audio);
      generatedVoiceUrls.current.set(messageId, audioUrl);
      const truncated = response.headers.get('X-World-Player-TTS-Truncated') === 'true';
      const generatedTokens = Number(response.headers.get('X-World-Player-TTS-Tokens')) || undefined;
      setGeneratedVoices(current => ({ ...current, [messageId]: { state: 'ready', url: audioUrl, text: voiceText, truncated, generatedTokens } }));
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        setGeneratedVoices(current => { const next = { ...current }; delete next[messageId]; return next; });
      } else {
        setGeneratedVoices(current => ({ ...current, [messageId]: { state: 'error', error: error instanceof Error ? error.message : String(error) } }));
      }
    } finally {
      if (progressTimer !== undefined) window.clearInterval(progressTimer);
      releaseJob();
      parentSignal?.removeEventListener('abort', abortFromParent);
      if (voiceGenerationControllers.current.get(messageId)?.controller === controller) voiceGenerationControllers.current.delete(messageId);
    }
  };
  const cancelVoiceGeneration = (messageId: string) => {
    const active = voiceGenerationControllers.current.get(messageId);
    active?.controller.abort();
    voiceGenerationControllers.current.delete(messageId);
    const audioUrl = generatedVoiceUrls.current.get(messageId);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    generatedVoiceUrls.current.delete(messageId);
    setGeneratedVoices(current => { const next = { ...current }; delete next[messageId]; return next; });
    if (active?.phase === 'generating') void fetch(`${active.endpoint}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: active.requestId }) }).catch(() => {});
  };

  /**
   * 대화 사이클을 돌린다.
   *  - `text`를 주면 플레이어 발언을 넣고 참가자(또는 이름이 불린 캐릭터)가 말을 시작한다.
   *  - 이후 다음 화자와 종료 시점은 캐릭터들이 답변 끝의 신호로 직접 정한다.
   */
  const runTurn = async (plan?: string[], text?: string): Promise<string[]> => {
    if (!data || !slice || streaming) return [];
    const activeParticipants = participants.length ? participants : mainCharacter ? [mainCharacter] : [];
    if (activeParticipants.length === 0) return [];
    let userTurn: ChatMessage | undefined;
    if (text) {
      userTurn = { id: `user-${Date.now()}`, speaker: { type: 'player', id: profile.name }, content: [{ type: 'text', text }, ...pendingImages], timestamp: new Date().toISOString() };
      setPendingImages([]);
      setThreadMessages(current => [...current, { id: userTurn!.id, speaker: '나', nodes: userTurn!.content, createdAt: userTurn!.timestamp, edited: false, reactions: {} }]);
      await persistTurn(userTurn);
    }
    if (!provider.endpoint) { setThreadMessages(current => [...current, { id: `system-${Date.now()}`, speaker: 'SYSTEM', nodes: parseChatMarkdown(locale === 'ko' ? 'Provider에 연결되지 않았습니다. 설정에서 Endpoint를 입력해 주세요.' : 'No Provider connected. Set an Endpoint in settings.'), createdAt: new Date().toISOString(), edited: false, reactions: {} }]); return []; }
    let secret = provider.apiKey;
    if (!secret) secret = (await loadApiKey()).secret;
    const client = new OpenAICompatibleProvider(provider.endpoint, secret || undefined, isDesktopRuntime() ? undefined : '/api/provider/chat/completions');
    stopRef.current = false;
    abortRef.current = new AbortController();
    setStreaming(true);
    let activeBubbleId: string | undefined;
    const cycleBubbleIds: string[] = [];
    const voiceIdByTurnId = new Map<string, string>();
    const voiceStylesByResponse = new Map<string, string[]>();
    const voiceStartedForResponse = new Set<string>();
    try {
      const messageStyles = await loadMessageStyles(data, activeParticipants);
      const result = await runConversationCycle({
        language,
        contextStrategy,
        provider: client,
        data,
        characters: activeParticipants,
        slice,
        player: profile,
        model: provider.model || 'default',
        history: turnHistory.current,
        input: text,
        inputTurn: userTurn,
        plan,
        sampling,
        variation: provider.variation ?? true,
        systemInstructions: provider.systemInstructions,
        situation: situation.trim(),
        directorInstructions: directorNotes.trim(),
        signal: abortRef.current.signal,
        shouldStop: () => stopRef.current,
        maxSpeakersPerCycle: provider.maxCycleSpeakers ?? 8,
        messageStyles,
        voiceTranslationLanguage: voiceRuntime?.ttsEnabled && voiceRuntime.ttsLanguage !== language ? voiceRuntime.ttsLanguage : undefined,
        voiceStyleControl: Boolean(voiceRuntime?.ttsEnabled && voiceModel(voiceRuntime.ttsEngine).styleControl),
        // 말하기 시작하면 빈 말풍선을 만들고 스트리밍 조각으로 채운다(턴 넘김 신호는 화면에 나오지 않는다).
        onSpeaker: speaker => {
          activeBubbleId = `${speaker.id}-${Date.now()}`;
          cycleBubbleIds.push(activeBubbleId);
          setTypingMessageId(activeBubbleId);
          setThreadMessages(current => [...current, { id: activeBubbleId!, speaker: displayStudentName(speaker), nodes: [], createdAt: new Date().toISOString(), edited: false, reactions: {} }]);
        },
        onVoiceTranslation: (speaker, text) => {
          const responseId = activeBubbleId;
          if (!voiceRuntime?.ttsEnabled || !responseId) return;
          const voiceText = sanitizeVoiceText(text);
          voiceStartedForResponse.add(responseId);
          const ttsCharacter = characters.find(character => character.id === speaker.id);
          const deliveryStyle = voiceStylesByResponse.get(responseId)?.join('; ');
          if (ttsCharacter) void generateVoice(ttsCharacter, responseId, voiceText, abortRef.current?.signal, deliveryStyle);
        },
        onVoiceStyles: (_speaker, styles) => { if (activeBubbleId) voiceStylesByResponse.set(activeBubbleId, styles); },
        onBubbles: async (speaker, bubbles) => {
          const responseId = activeBubbleId;
          const voiceStyles = responseId ? voiceStylesByResponse.get(responseId) ?? [] : [];
          const ttsCharacter = characters.find(character => character.id === speaker.id);
          if (voiceRuntime?.ttsEnabled && voiceRuntime.ttsLanguage === language && responseId && !voiceStartedForResponse.has(responseId) && ttsCharacter) {
            voiceStartedForResponse.add(responseId);
            for (const [bubbleIndex, voiceTurn] of bubbles.entries()) {
              const directVoiceText = sanitizeVoiceText(voiceTurn.content.map(node => node.text ?? '').join(''));
              if (directVoiceText) void generateVoice(ttsCharacter, voiceTurn.id, directVoiceText, abortRef.current?.signal, voiceStyles[bubbleIndex]);
            }
          }
          for (const [index, turn] of bubbles.entries()) {
            // Commit each completed bubble independently so it can carry its own voice.
            const placeholderId = activeBubbleId;
            const voiceId = voiceRuntime?.ttsEnabled && voiceRuntime.ttsLanguage === language ? turn.id : responseId;
            if (voiceId) voiceIdByTurnId.set(turn.id, voiceId);
            const readyMessage = {
              id: turn.id,
              voiceId,
              speaker: displayStudentName(speaker),
              nodes: parseChatMarkdown(turn.content.map(node => node.text ?? '').join('')),
              createdAt: turn.timestamp,
              edited: false,
              reactions: {},
            };
            setThreadMessages(current => [...current.filter(message => message.id !== placeholderId), readyMessage]);
            if (index === 0 && voiceRuntime?.ttsEnabled && voiceRuntime.ttsLanguage !== language && responseId && !voiceStartedForResponse.has(responseId)) {
              setGeneratedVoices(current => ({ ...current, [responseId]: { state: 'error', error: `The LLM did not return a complete [[voice-${voiceRuntime.ttsLanguage}]] translation block.` } }));
            }
            activeBubbleId = undefined;
            if (index < bubbles.length - 1) {
              const visibleText = turn.content.map(node => node.text ?? '').join('').trim();
              const characterCount = Array.from(visibleText).length;
              const pauseMs = Math.min(2_000, Math.max(500, 500 + Math.max(0, characterCount - 3) * 25));
              activeBubbleId = `${speaker.id}-typing-${Date.now()}-${index}`;
              cycleBubbleIds.push(activeBubbleId);
              setTypingMessageId(activeBubbleId);
              setThreadMessages(current => [...current, { id: activeBubbleId!, speaker: displayStudentName(speaker), nodes: [], createdAt: new Date().toISOString(), edited: false, reactions: {} }]);
              await new Promise(resolve => setTimeout(resolve, pauseMs));
            } else {
              setTypingMessageId(undefined);
            }
          }
        },
      });
      turnHistory.current = result.history;
      const spoke = result.turns.map(turn => turn.speaker.id);
      setTypingMessageId(undefined);
      lastSpeakers.current = spoke;
      for (const turn of result.turns) await persistTurn(turn);
      setThreadMessages(current => {
        const withoutPlaceholders = current.filter(message => !cycleBubbleIds.includes(message.id));
        const existingIds = new Set(withoutPlaceholders.map(message => message.id));
        const completedMessages = result.turns.map(turn => ({
          id: turn.id,
          voiceId: voiceIdByTurnId.get(turn.id),
          speaker: turn.speaker.type === 'player' ? (language === 'en' ? 'You' : '나') : displayStudentName(data.entities.get(turn.speaker.id) as Character | undefined) || turn.speaker.id,
          nodes: turn.content,
          createdAt: turn.timestamp,
          edited: false,
          reactions: {},
        })).filter(message => !existingIds.has(message.id));
        return [...withoutPlaceholders, ...completedMessages];
      });
      if (result.error) {
        if (activeBubbleId) setThreadMessages(current => current.filter(message => message.id !== activeBubbleId || message.nodes.length > 0));
        setThreadMessages(current => [...current, { id: `system-${Date.now()}`, speaker: 'SYSTEM', nodes: [{ type: 'text', text: result.error!.message }], createdAt: new Date().toISOString(), edited: false, reactions: {} }]);
      }
      // 아무도 말하지 않고 끝난 경우(캐릭터들이 "지금은 답할 때가 아니다"라고 판단)를 알려준다.
      if (result.turns.length === 0 && result.endedBy === 'silent') {
        setThreadMessages(current => [...current, { id: `system-${Date.now()}`, speaker: 'SYSTEM', nodes: parseChatMarkdown(locale === 'ko' ? '지금은 답할 학생이 없습니다. 다른 방식으로 말을 걸어보세요.' : 'No student replied. Try asking another way.'), createdAt: new Date().toISOString(), edited: false, reactions: {} }]);
      }
      return spoke;
    } catch (error) {
      setTypingMessageId(undefined);
      setThreadMessages(current => [...current, { id: `system-${Date.now()}`, speaker: 'SYSTEM', nodes: [{ type: 'text', text: error instanceof Error ? error.message : 'Provider error' }], createdAt: new Date().toISOString(), edited: false, reactions: {} }]);
      return [];
    } finally { setTypingMessageId(undefined); setStreaming(false); }
  };

  /** 사용자 메시지 전송 — 이후 진행은 캐릭터들이 신호로 결정한다. */
  const send = async () => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || streaming) return;
    setInput('');
    await runTurn(undefined, text);
  };

  const attachImage = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) { setNotice(locale === 'ko' ? '이미지는 PNG/JPEG/WebP/GIF, 5MB 이하만 첨부할 수 있습니다.' : 'Attach PNG/JPEG/WebP/GIF images up to 5 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const imageDataUrl = String(reader.result ?? '');
      if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(imageDataUrl)) { setNotice('지원하지 않는 이미지 형식입니다.'); return; }
      const node: ChatNode = { type: 'image', imageDataUrl, alt: file.name.slice(0, 120) };
      setPendingImages(current => [...current, node].slice(0, 3));
      setInput(current => current || (locale === 'ko' ? '이 사진을 보고 어떻게 생각하는지 말해 줘.' : 'What do you think about this picture?'));
    };
    reader.readAsDataURL(file);
  };
  const editVisualMessage = (id: string, text: string) => setThreadMessages(current => current.map(message => message.id === id ? { ...message, nodes: parseChatMarkdown(text), edited: true } : message));
  const reactToMessage = (id: string, emoji: string) => setThreadMessages(current => current.map(message => {
    if (message.id !== id) return message;
    const reactions = { ...message.reactions };
    reactions[emoji] = reactions[emoji] ? [] : [profile.name];
    if (!reactions[emoji].length) delete reactions[emoji];
    return { ...message, reactions };
  }));

  /** 진행 중인 사이클 중단 — 현재 발화를 끊고 지금까지의 대화를 남긴다. */
  const stopCycle = () => { stopRef.current = true; abortRef.current?.abort(); };


  const noticeText = notice;
  const startupScreen = !data ? <main className="dt-startup" aria-live="polite">
    <header className="dt-header">
      <a className="dt-brand" href="#inbox" aria-label="DanmuTalk home"><BrandMark className="dt-brand-mark" /><span>DanmuTalk</span></a>
    </header>
    <section className="dt-startup-card">
      <span className="dt-welcome-mark"><BrandMark className="dt-startup-mark" /></span>
      <span className="dt-eyebrow">DANMUTALK · LOCAL WORKSPACE</span>
      <h1>{language === 'en' ? 'Opening DanmuTalk…' : 'DanmuTalk을 여는 중…'}</h1>
      <p>{startupLoading
        ? (language === 'en' ? 'Loading your world and student list.' : '세계와 학생 목록을 불러오고 있어요.')
        : (language === 'en' ? 'Open a world package to start messaging your students.' : '세계관 패키지를 열어 학생들과 대화를 시작해 보세요.')}</p>
      <p className="dt-world-package-help">{language === 'en' ? 'You can also drag a .😭 or .zip file onto this window.' : '.😭 또는 .zip 파일을 이 창에 끌어다 놓아도 됩니다.'}</p>
      {notice && <p className="dt-startup-error" role="alert">{notice}</p>}
      <button className="dt-start-group" onClick={() => packageInput.current?.click()}><span>＋</span>{language === 'en' ? 'Open a world package' : '세계관 패키지 열기'}</button>
      <input ref={packageInput} type="file" hidden accept=".😭,.zip,application/zip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void openWorld(file); }} />
    </section>
  </main> : null;
  const changeTheme = (next: string) => { setTheme(next); localStorage.setItem('blue-archive.theme', next); };
  const changeLocale = (next: string) => { const value = next === 'en' ? 'en' : 'ko'; setLanguage(value); localStorage.setItem('blue-archive.locale', value); localStorage.setItem('blue-archive.language', value); };
  const changeSituation = (next: string) => { setSituation(next); localStorage.setItem('blue-archive.situation', next); };
  const changeDirectorNotes = (next: string) => { setDirectorNotes(next); localStorage.setItem('blue-archive.directorNotes', next); };

  return <div className={`app dt-app theme-${theme}`} style={themeStyle}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setWorldPackageDrag(true); } }}
    onDragLeave={event => { if (event.currentTarget === event.target) setWorldPackageDrag(false); }}
    onDrop={event => {
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) return;
      event.preventDefault();
      setWorldPackageDrag(false);
      const packageFile = files.find(file => /\.😭$|\.zip$/i.test(file.name));
      if (packageFile) void openWorld(packageFile);
      else setNotice(language === 'en' ? 'Drop a .😭 or .zip world package.' : '.😭 또는 .zip 세계관 패키지를 놓아 주세요.');
    }}>
    {startupScreen}
    {worldPackageDrag && <div className="world-package-drop" role="status" aria-live="polite">{language === 'en' ? 'Drop your world package to open it' : '세계관 패키지를 놓으면 열립니다'}</div>}
    {(screen === 'home' || screen === 'chat') && data && <HomeScreen data={data} characters={localizedCharacters} conversations={conversationSummaries} language={language} onLanguage={changeLocale} notice={noticeText} activeStudentId={mainCharacterId} activeConversationId={currentConversationId} onOpenConversation={requestTimelineSelection} timeSlices={data.timeSlices} sliceId={sliceId} onSliceChange={setSliceId} onCloseChat={() => setScreen('home')} onResetChat={resetChat} activeChat={screen === 'chat' && slice ? <ConversationView key={language} data={data} characters={localizedCharacters} participants={localizedParticipants.length ? localizedParticipants : mainCharacter ? [{ ...mainCharacter, name: displayStudentName(mainCharacter), summary: language === 'en' ? mainCharacter.summaryEn : mainCharacter.summary }] : []} messages={threadMessages} input={input} streaming={streaming} typingMessageId={typingMessageId} theme={theme} locale={locale} situation={situation} directorNotes={directorNotes} pendingImages={pendingImages} onTheme={changeTheme} onLocale={changeLocale} onSituation={changeSituation} onDirectorNotes={changeDirectorNotes} sliceId={sliceId} activeStudentId={mainCharacterId} onRemovePendingImage={index => setPendingImages(current => current.filter((_, item) => item !== index))} onInput={setInput} onSend={send} onAttach={attachImage} onBack={() => setScreen('home')} onProfile={() => setProfileOpen(true)} onSettings={() => setConfigOpen(true)} onStop={stopCycle} onEdit={editVisualMessage} onReact={reactToMessage} onResetChat={resetChat} onCancelVoice={cancelVoiceGeneration} ttsEnabled={voiceRuntime?.ttsEnabled ?? false} generatedVoices={generatedVoices} /> : undefined} onOpenChat={sendToStudent} onOpenGroupChat={() => { setParticipantIds([]); setSliceId(''); setPickerOpen(true); }} onOpenSettings={() => setConfigOpen(true)} onEditProfile={() => setProfileOpen(true)} onConfig={() => setConfigOpen(true)} onLoad={() => packageInput.current?.click()} onFile={file => void openWorld(file)} packageInput={packageInput} />}
    {browseCategory && data && <BrowseOverlay data={data} categoryId={browseCategory} characterId={selectedProfileCharacter} language={language} onClose={() => { setBrowseCategory(undefined); setSelectedProfileCharacter(undefined); }} />}
    {pickerOpen && data && <ChatOverlay data={data} characters={localizedCharacters} selected={participantIds} sliceId={sliceId} language={language} onOpenProfile={openCharacterProfile} onToggle={toggleParticipant} onToggleFolder={toggleFolder} onSlice={setSliceId} onStart={startChat} onClose={() => setPickerOpen(false)} />}
    {pendingConversation && data && <TimelinePromptOverlay key={pendingConversation.id} language={language} title={language === 'en' ? `Choose timeline · ${pendingConversation.participants.map(id => displayStudentName(characters.find(character => character.id === id))).join(', ')}` : `대화 시점 선택 · ${pendingConversation.participants.map(id => displayStudentName(characters.find(character => character.id === id))).join(', ')}`} value={sliceId} options={[{ value: '', label: language === 'en' ? 'Choose a timeline…' : '시점을 선택하세요…' }, { value: 'none', label: language === 'en' ? 'None' : '시점 없음' }, ...data.timeSlices.map(item => ({ value: item.id, label: language === 'en' ? item.labelEn ?? item.label : item.label }))]} onChange={setSliceId} onContinue={continueAfterTimelineSelection} onClose={() => { setPendingConversation(undefined); setSliceId(''); }} />}
    {profileOpen && <ProfileOverlay key={language} profile={profile} onChange={next => { profileCustomized.current = true; localStorage.setItem('blue-archive.profile-customized', 'true'); setProfile(next); }} language={language} onClose={() => setProfileOpen(false)} />}
    {configOpen && <ConfigOverlay key={language} config={provider} onChange={changeProviderSettings} onLoadModels={loadModels} onSaveProvider={() => void saveProvider()} onLoadProvider={() => void loadSavedProviderSettings()} onSaveKey={() => void saveKey()} onLoadKey={loadKey} onSaveVoiceSettings={config => void saveVoiceSettings(config)} onPreviewVoice={() => void generateTtsPreview()} previewVoiceBusy={ttsPreviewBusy} previewVoiceAudio={ttsPreviewAudio} previewVoiceStatus={ttsPreviewStatus} voiceSettingsSaving={voiceSettingsSaving} vramInfo={vramInfo} onRefreshVram={refreshTtsVram} language={language} situation={situation} directorNotes={directorNotes} onSituation={changeSituation} onDirectorNotes={changeDirectorNotes} onClose={() => setConfigOpen(false)} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
