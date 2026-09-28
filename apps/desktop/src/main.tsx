import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRemoteZipSource, createZipSource, fromStoredTurns, loadWorld, loadWorldDocuments, resolveState, runConversationCycle, toStoredTurn, validateWorld, withLocaleOverlay,
  inferMessageStyle, releaseAssetUrls, type MessageStyle, type SamplingOptions,
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
import './styles.css';

type Screen = 'home' | 'chat';
const NO_TIMELINE_SLICE: TimeSlice = { id: 'none', label: '시점 없음', labelEn: 'None', position: Number.NaN };
type AvailableWorld = { name: string; url: string };

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [language, setLanguage] = useState<'ko' | 'en'>(() => localStorage.getItem('blue-archive.language') === 'en' || localStorage.getItem('blue-archive.locale') === 'en' ? 'en' : 'ko');
  const [data, setData] = useState<WorldData>();
  const [notice, setNotice] = useState<string>();
  const [worldPackageDrag, setWorldPackageDrag] = useState(false);
  const [startupLoading, setStartupLoading] = useState(true);
  const [availableWorlds, setAvailableWorlds] = useState<AvailableWorld[]>([]);
  const [browseCategory, setBrowseCategory] = useState<string>();
  const [selectedProfileCharacter, setSelectedProfileCharacter] = useState<string>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState('ba-inbox');
  const [conversationSummaries, setConversationSummaries] = useState<ConversationSummary[]>([]);
  const [pendingConversation, setPendingConversation] = useState<{ id: string; participants: string[] }>();
  const [threadMessages, setThreadMessages] = useState<ConversationMessage[]>([]);
  useEffect(() => { if (data) return () => releaseAssetUrls(data); }, [data]);
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
      return { ...saved, endpoint: saved.endpoint ?? '', model: saved.model ?? '', systemInstructions: saved.systemInstructions ?? '', apiKey: '', models: [], temperature: saved.temperature ?? 1, maxTokens: saved.maxTokens && saved.maxTokens > 0 ? saved.maxTokens : 32768, variation: saved.variation ?? true, maxCycleSpeakers: saved.maxCycleSpeakers ?? 8 };
    } catch {
      return { endpoint: '', model: '', systemInstructions: '', apiKey: '', models: [], temperature: 1, maxTokens: 32768, variation: true, maxCycleSpeakers: 8 };
    }
  });
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
    const manifest = await source.read('manifest.yaml');
    if (!/^id:\s*['"]?blue-archive['"]?\s*$/m.test(manifest)) return loadWorld(source, { language: 'en', lazyDocuments: true });
    const response = await fetch(`${import.meta.env.BASE_URL}locales/en/manifest.json`);
    if (!response.ok) return loadWorld(source, { language: 'en', lazyDocuments: true });
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

  const openWorldUrl = async (url: string) => {
    setStartupLoading(true);
    setNotice(undefined);
    try {
      localeBaseSource.current = await createRemoteZipSource(url);
      const loaded = await loadCachedPackageForLanguage(localeBaseSource.current, language);
      const errors = validateWorld(loaded).filter(issue => issue.level === 'error');
      if (errors.length) throw new Error(errors.map(issue => issue.message).join(' · '));
      applyLoaded(loaded);
      setScreen('home');
    } catch (error) {
      setNotice(`${language === 'en' ? 'Could not load world package' : '세계관 패키지를 열 수 없습니다'}: ${error instanceof Error ? error.message : 'invalid package'}`);
    } finally {
      setStartupLoading(false);
    }
  };

  // Optional deep link remains useful for local preview; normal startup shows packages in worlds/.
  React.useEffect(() => {
    const startupWorld = new URLSearchParams(window.location.search).get('world');
    let cancelled = false;
    void (async () => {
      try {
        if (startupWorld) {
          localeBaseSource.current = await createRemoteZipSource(startupWorld);
          const loaded = await loadCachedPackageForLanguage(localeBaseSource.current, language);
          if (cancelled) return;
          applyLoaded(loaded);
          setScreen('home');
        } else {
          const response = await fetch('/api/worlds', { cache: 'no-store' });
          if (!response.ok) throw new Error(`World list request failed (${response.status}).`);
          const result = await response.json() as { worlds?: AvailableWorld[] };
          if (!cancelled) setAvailableWorlds(Array.isArray(result.worlds) ? result.worlds : []);
        }
      } catch (error) {
        if (!cancelled) setNotice(`${language === 'en' ? 'Could not load the world package' : '세계관 패키지를 열지 못했습니다'}: ${error instanceof Error ? error.message : 'invalid package'} — ${language === 'en' ? 'choose a package below or open one from disk' : '아래에서 패키지를 선택하거나 파일을 직접 열어 주세요'}.`);
      } finally {
        if (!cancelled) setStartupLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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

  // API keys use the configured secure store; non-secret provider settings use the settings store.
  const providerSettingsSnapshot = (config: ProviderConfig) => ({ endpoint: config.endpoint, model: config.model, systemInstructions: config.systemInstructions ?? '', temperature: config.temperature, maxTokens: config.maxTokens, variation: config.variation, maxCycleSpeakers: config.maxCycleSpeakers });
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
      const loadedProvider = { ...provider, ...settings, maxTokens: settings.maxTokens && settings.maxTokens > 0 ? settings.maxTokens : 32768 };
      setProvider(current => ({ ...current, ...loadedProvider, status: language === 'en' ? `Saved settings loaded — ${backendLabel(backend)}` : `저장된 설정을 불러왔습니다 — ${backendLabel(backend)}` }));
    })();
    return () => { cancelled = true; };
  }, []);

  // 설정이 바뀌면 자동 저장(입력 중 매 글자마다 요청하지 않도록 잠깐 모았다가 보낸다).
  useEffect(() => {
    if (!settingsLoaded) return undefined;
    const settings = providerSettingsSnapshot(provider);
    const timer = setTimeout(() => { void saveProviderSettings(settings); }, 500);
    return () => clearTimeout(timer);
  }, [settingsLoaded, provider.endpoint, provider.model, provider.systemInstructions, provider.temperature, provider.maxTokens, provider.variation, provider.maxCycleSpeakers]);

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
        // 말하기 시작하면 빈 말풍선을 만들고 스트리밍 조각으로 채운다(턴 넘김 신호는 화면에 나오지 않는다).
        onSpeaker: speaker => {
          activeBubbleId = `${speaker.id}-${Date.now()}`;
          cycleBubbleIds.push(activeBubbleId);
          setTypingMessageId(activeBubbleId);
          setThreadMessages(current => [...current, { id: activeBubbleId!, speaker: displayStudentName(speaker), nodes: [], createdAt: new Date().toISOString(), edited: false, reactions: {} }]);
        },
        onBubbles: async (speaker, bubbles) => {
          for (const [index, turn] of bubbles.entries()) {
            // Commit each completed bubble independently so the typing indicator can pause between them.
            const placeholderId = activeBubbleId;
            const readyMessage = {
              id: turn.id,
              speaker: displayStudentName(speaker),
              nodes: parseChatMarkdown(turn.content.map(node => node.text ?? '').join('')),
              createdAt: turn.timestamp,
              edited: false,
              reactions: {},
            };
            setThreadMessages(current => [...current.filter(message => message.id !== placeholderId), readyMessage]);
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
      <h1>{startupLoading ? (language === 'en' ? 'Finding your worlds…' : '세계관을 찾는 중…') : (language === 'en' ? 'Choose a world to begin' : '세계관을 선택해 시작하세요')}</h1>
      <p>{startupLoading
        ? (language === 'en' ? 'Loading your world and student list.' : '세계와 학생 목록을 불러오고 있어요.')
        : (language === 'en' ? 'Open a world package to start messaging your students.' : '세계관 패키지를 열어 학생들과 대화를 시작해 보세요.')}</p>
      <p className="dt-world-package-help">{language === 'en' ? 'You can also drag a .😭 or .zip file onto this window.' : '.😭 또는 .zip 파일을 이 창에 끌어다 놓아도 됩니다.'}</p>
      {notice && <p className="dt-startup-error" role="alert">{notice}</p>}
      {availableWorlds.length > 0 && <section className="dt-world-list" aria-label={language === 'en' ? 'Available worlds' : '사용 가능한 세계관'}>
        <h2>{language === 'en' ? 'Worlds in your worlds folder' : 'worlds 폴더의 세계관'}</h2>
        <p>{language === 'en' ? 'Choose a package to play. Add more packages to the worlds folder to share them here.' : '플레이할 패키지를 선택하세요. worlds 폴더에 패키지를 추가하면 여기에 표시됩니다.'}</p>
        {availableWorlds.map(world => <button type="button" className="dt-world-option" key={world.name} disabled={startupLoading} onClick={() => void openWorldUrl(world.url)}><span>◈</span><strong>{world.name.replace(/\.(?:😭|zip)$/i, '')}</strong><small>{world.name.split('.').pop()?.toUpperCase()}</small></button>)}
      </section>}
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
    {(screen === 'home' || screen === 'chat') && data && <HomeScreen data={data} characters={localizedCharacters} conversations={conversationSummaries} language={language} onLanguage={changeLocale} notice={noticeText} activeStudentId={mainCharacterId} activeConversationId={currentConversationId} onOpenConversation={requestTimelineSelection} timeSlices={data.timeSlices} sliceId={sliceId} onSliceChange={setSliceId} onCloseChat={() => setScreen('home')} onResetChat={resetChat} activeChat={screen === 'chat' && slice ? <ConversationView key={language} data={data} characters={localizedCharacters} participants={localizedParticipants.length ? localizedParticipants : mainCharacter ? [{ ...mainCharacter, name: displayStudentName(mainCharacter), summary: language === 'en' ? mainCharacter.summaryEn : mainCharacter.summary }] : []} messages={threadMessages} input={input} streaming={streaming} typingMessageId={typingMessageId} theme={theme} locale={locale} situation={situation} directorNotes={directorNotes} pendingImages={pendingImages} onTheme={changeTheme} onLocale={changeLocale} onSituation={changeSituation} onDirectorNotes={changeDirectorNotes} sliceId={sliceId} activeStudentId={mainCharacterId} onRemovePendingImage={index => setPendingImages(current => current.filter((_, item) => item !== index))} onInput={setInput} onSend={send} onAttach={attachImage} onBack={() => setScreen('home')} onProfile={() => setProfileOpen(true)} onSettings={() => setConfigOpen(true)} onStop={stopCycle} onEdit={editVisualMessage} onReact={reactToMessage} onResetChat={resetChat} /> : undefined} onOpenChat={sendToStudent} onOpenGroupChat={() => { setParticipantIds([]); setSliceId(''); setPickerOpen(true); }} onOpenSettings={() => setConfigOpen(true)} onEditProfile={() => setProfileOpen(true)} onConfig={() => setConfigOpen(true)} onLoad={() => packageInput.current?.click()} onFile={file => void openWorld(file)} packageInput={packageInput} />}
    {browseCategory && data && <BrowseOverlay data={data} categoryId={browseCategory} characterId={selectedProfileCharacter} language={language} onClose={() => { setBrowseCategory(undefined); setSelectedProfileCharacter(undefined); }} />}
    {pickerOpen && data && <ChatOverlay data={data} characters={localizedCharacters} selected={participantIds} sliceId={sliceId} language={language} onOpenProfile={openCharacterProfile} onToggle={toggleParticipant} onToggleFolder={toggleFolder} onSlice={setSliceId} onStart={startChat} onClose={() => setPickerOpen(false)} />}
    {pendingConversation && data && <TimelinePromptOverlay key={pendingConversation.id} language={language} title={language === 'en' ? `Choose timeline · ${pendingConversation.participants.map(id => displayStudentName(characters.find(character => character.id === id))).join(', ')}` : `대화 시점 선택 · ${pendingConversation.participants.map(id => displayStudentName(characters.find(character => character.id === id))).join(', ')}`} value={sliceId} options={[{ value: '', label: language === 'en' ? 'Choose a timeline…' : '시점을 선택하세요…' }, { value: 'none', label: language === 'en' ? 'None' : '시점 없음' }, ...data.timeSlices.map(item => ({ value: item.id, label: language === 'en' ? item.labelEn ?? item.label : item.label }))]} onChange={setSliceId} onContinue={continueAfterTimelineSelection} onClose={() => { setPendingConversation(undefined); setSliceId(''); }} />}
    {profileOpen && <ProfileOverlay key={language} profile={profile} onChange={next => { profileCustomized.current = true; localStorage.setItem('blue-archive.profile-customized', 'true'); setProfile(next); }} language={language} onClose={() => setProfileOpen(false)} />}
    {configOpen && <ConfigOverlay key={language} config={provider} onChange={changeProviderSettings} onLoadModels={loadModels} onSaveProvider={() => void saveProvider()} onLoadProvider={() => void loadSavedProviderSettings()} onSaveKey={() => void saveKey()} onLoadKey={loadKey} language={language} situation={situation} directorNotes={directorNotes} onSituation={changeSituation} onDirectorNotes={changeDirectorNotes} onClose={() => setConfigOpen(false)} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
