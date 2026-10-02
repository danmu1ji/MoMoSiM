import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRemoteZipSource, createZipSource, fromStoredTurns, loadWorldDocuments, resolveState, runConversationCycle, toStoredTurn,
  estimatePromptTokens, releaseAssetUrls, type SamplingOptions,
} from '@world-player/engine/desktop';
import { DEFAULT_CONTEXT_WINDOW_TOKENS, OpenAICompatibleProvider, preferredOrFirstModel, type ModelInfo } from '@world-player/provider';
import type { Character, ChatMessage, ChatNode, PlayerProfile, TimeSlice } from '@world-player/schema';
import type { WorldData, WorldSource } from '@world-player/engine/desktop';
import { parseChatMarkdown } from '@world-player/markdown';
import { invoke } from '@tauri-apps/api/core';
import { HomeScreen } from './player/home';
import { BrandMark } from './player/brand-mark';
import { ConversationView, type ConversationMessage } from './player/conversation-view';
import { backendLabel, isDesktopRuntime, isTauriRuntime, loadApiKey, loadProviderSettings, saveApiKey, saveProviderSettings } from './player/credential-store';
import { clearConversation, listConversations, loadConversation, loadConversationContextMode, removeConversationTurn, saveConversationContextMode, saveConversationTurn, type ConversationContextMode, type ConversationSummary } from './player/conversation-store';
import { clearConversationMemory, compactConversation, completeConversationMemoryReset, conversationMemoryGeneration, historyAfterCompaction, loadConversationMemory } from './player/conversation-memory';
import { clearCrossChatConversation, completeFollowUpJob, crossChatConsentGeneration, crossChatEnabled as readCrossChatEnabled, hasFollowUpJob, planCrossChatFollowUps, retryFollowUpJob, saveSharedContext, setCrossChatEnabled as persistCrossChatEnabled, takeDueFollowUpJobs, type SharedContext } from './player/cross-chat';
import { conversationIdFor, participantsForConversationId, worldScopedChatId } from './player/conversation-id';
import { draftKey, saveDraft, useConversationDraft } from './player/conversation-draft';
import { bookmarkKey, saveBookmarks } from './player/message-bookmarks';
import { createWorldLoader } from './player/world-loader';
import { createMessageStyleLoader } from './player/message-styles';
import type { ProviderConfig } from './player/overlays';
import { NativeOpenAICompatibleProvider } from './player/native-provider';
import { FirstRunGuide, WORLD_PACKAGE_RELEASES } from './player/first-run-guide';
import './styles.css';
import { openUrl } from '@tauri-apps/plugin-opener';

type Screen = 'home' | 'chat';
const IS_ANDROID_BUILD = import.meta.env.VITE_APP_TARGET === 'android';
const ANDROID_WORLD_RELEASE_URL = 'https://github.com/danmu1ji/danmutalk/releases/latest';
const NO_TIMELINE_SLICE: TimeSlice = { id: 'none', label: '시점 없음', labelEn: 'None', position: Number.NaN };
type AvailableWorld = { name: string; url: string };
const BrowseOverlay = React.lazy(() => import('./player/browse-overlay').then(module => ({ default: module.BrowseOverlay })));
const ChatOverlay = React.lazy(() => import('./player/chat-overlay').then(module => ({ default: module.ChatOverlay })));
const ConfigOverlay = React.lazy(() => import('./player/overlays').then(module => ({ default: module.ConfigOverlay })));
const ProfileOverlay = React.lazy(() => import('./player/overlays').then(module => ({ default: module.ProfileOverlay })));
const TimelinePromptOverlay = React.lazy(() => import('./player/overlays').then(module => ({ default: module.TimelinePromptOverlay })));

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [language, setLanguage] = useState<'ko' | 'en'>(() => localStorage.getItem('blue-archive.language') === 'en' || localStorage.getItem('blue-archive.locale') === 'en' ? 'en' : 'ko');
  const [data, setData] = useState<WorldData>();
  const [notice, setNotice] = useState<string>();
  const [worldPackageDrag, setWorldPackageDrag] = useState(false);
  const [startupLoading, setStartupLoading] = useState(true);
  const [tutorialOpen, setTutorialOpen] = useState(() => !IS_ANDROID_BUILD && localStorage.getItem('danmutalk.first-run-guide-complete') !== 'true');
  const [tutorialStep, setTutorialStep] = useState(0);
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
  const [crossChat, setCrossChat] = useState(readCrossChatEnabled);
  const turnBusy = useRef(false);
  useEffect(() => { if (data) return () => releaseAssetUrls(data); }, [data]);
  const [typingMessageId, setTypingMessageId] = useState<string>();
  const [pendingImages, setPendingImages] = useState<ChatNode[]>([]);
  const [theme, setTheme] = useState(() => localStorage.getItem('blue-archive.theme') ?? 'blue');
  const locale = language;
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const [situation, setSituation] = useState(() => localStorage.getItem('blue-archive.situation') ?? '');
  const [directorNotes, setDirectorNotes] = useState(() => localStorage.getItem('blue-archive.directorNotes') ?? '');
  const packageInput = useRef<HTMLInputElement>(null);
  const closeTutorial = () => {
    localStorage.setItem('danmutalk.first-run-guide-complete', 'true');
    setTutorialOpen(false);
  };
  const showTutorial = () => { setTutorialStep(0); setTutorialOpen(true); };
  const openReleases = () => {
    if (isTauriRuntime()) void openUrl(WORLD_PACKAGE_RELEASES);
    else window.open(WORLD_PACKAGE_RELEASES, '_blank', 'noopener,noreferrer');
  };

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
      const contextWindowOverride = saved.contextWindowOverride && saved.contextWindowOverride >= 1024 ? saved.contextWindowOverride : undefined;
      return { ...saved, endpoint: saved.endpoint ?? '', model: saved.model ?? '', systemInstructions: saved.systemInstructions ?? '', apiKey: '', models: [], temperature: saved.temperature ?? 1, maxTokens: saved.maxTokens && saved.maxTokens > 0 ? saved.maxTokens : 32768, contextWindow: contextWindowOverride ?? DEFAULT_CONTEXT_WINDOW_TOKENS, contextWindowOverride, variation: saved.variation ?? true, maxCycleSpeakers: saved.maxCycleSpeakers ?? 8 };
    } catch {
      return { endpoint: '', model: '', systemInstructions: '', apiKey: '', models: [], temperature: 1, maxTokens: 32768, contextWindow: DEFAULT_CONTEXT_WINDOW_TOKENS, variation: true, maxCycleSpeakers: 8 };
    }
  });
  const [loadingModels, setLoadingModels] = useState(false);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [contextStrategy, setContextStrategy] = useState<ConversationContextMode>('full');
  const [mainCharacterId, setMainCharacterId] = useState<string>();
  const [sliceId, setSliceId] = useState('');
  const [input, setInput] = useConversationDraft(draftKey(data?.world.id ?? '', currentConversationId));
  const [streaming, setStreaming] = useState(false);

  const characters = useMemo(() => [...(data?.entities.values() ?? [])].filter(entity => entity.type === 'character') as Character[], [data]);
  const displayStudentName = (character: Character | undefined) => character ? (language === 'en' ? character.nameEn ?? character.id.replace(/^character:/, '').replace(/(^|-)([a-z])/g, (_m, p1, p2) => `${p1}${p2.toUpperCase()}`) : character.name) : '';
  const localizedCharacters = useMemo(() => characters.map(character => ({ ...character, name: displayStudentName(character), summary: language === 'en' ? character.summaryEn : character.summary })), [characters, language]);
  const slice = data && sliceId ? (sliceId === 'none' ? NO_TIMELINE_SLICE : data.timeSlices.find(candidate => candidate.id === sliceId)) : undefined;
  const mainCharacter = characters.find(character => character.id === mainCharacterId) ?? characters[0];
  const participants = useMemo(() => characters.filter(character => participantIds.includes(character.id)), [characters, participantIds]);
  const localizedParticipants = useMemo(() => participants.map(character => ({ ...character, name: displayStudentName(character), summary: language === 'en' ? character.summaryEn : character.summary })), [participants, language]);
  const activeStateId = data && mainCharacter && slice ? resolveState(mainCharacter, data.states, slice, undefined, data.timeSlices)?.id : undefined;
  const turnHistory = useRef<ChatMessage[]>([]);
  const historyMemoryGeneration = useRef('0');
  const visibleConversation = useRef({ world: data?.world.id, id: currentConversationId, screen });
  visibleConversation.current = { world: data?.world.id, id: currentConversationId, screen };

  // Pending messages are durable in app-local storage and are processed only while the app is open.
  const processingFollowUps = useRef(false);
  useEffect(() => {
    if (!crossChat || !data || !provider.endpoint || streaming) return undefined;
    const processDueJobsUnlocked = async () => {
      if (processingFollowUps.current) return;
      const due = takeDueFollowUpJobs(Date.now(), data.world.id);
      if (!due.length) return;
      processingFollowUps.current = true;
      try {
        let secret = provider.apiKey;
        if (!secret) secret = (await loadApiKey()).secret;
        const client = isTauriRuntime()
          ? new NativeOpenAICompatibleProvider(provider.endpoint, secret || undefined)
          : new OpenAICompatibleProvider(provider.endpoint, secret || undefined, isTauriRuntime() ? undefined : '/api/provider/chat/completions');
        for (const job of due) {
          try {
            if (!crossChat || job.world !== data.world.id || job.consentGeneration !== crossChatConsentGeneration()) { completeFollowUpJob(job.id); continue; }
            const character = characters.find(candidate => candidate.id === job.targetCharacterId);
            if (!character) { completeFollowUpJob(job.id); continue; }
            const existingTarget = (await listConversations(data.world.id)).find(conversation => {
              const ids = participantsForConversationId(conversation.id);
              return ids.length === 1 && ids[0] === character.id;
            });
            const conversationId = existingTarget?.id ?? worldScopedChatId(data.world.id, character.id);
            const past = fromStoredTurns(await loadConversation(conversationId));
            const jobTurnId = `cross-chat-${job.id}`;
            if (past.some(turn => turn.id === jobTurnId)) { completeFollowUpJob(job.id); continue; }
            const recent = past.slice(-12).map(turn => `${turn.speaker.type === 'player' ? profile.name : turn.speaker.id}: ${turn.content.map(node => node.type === 'image' ? '[image]' : node.text ?? '').join('')}`).join('\n').slice(-3500);
            const shared = job.context;
            let messageText = '';
            const request = {
              model: provider.model || 'default',
              system: `You are ${displayStudentName(character)} in the supplied fictional world. Write one natural, brief chat message to the user as a delayed follow-up. Never mention that a timer or background task exists. Do not invent facts. Use ${language === 'en' ? 'English' : 'Korean'}. No control markers or JSON.\n\n${character.summary ?? ''}\n\nShared context:\nWorld: ${shared.worldName || shared.world}\nTimeline: ${shared.timeSliceLabel || shared.timeSlice || 'unknown'}\nUser location: ${shared.location || 'unknown'}\nUser activity: ${shared.activity || 'unknown'}\nRecent event: ${shared.recentText}\n\nReason to check in: ${job.intent}\n\nRecent conversation with this character:\n${recent || '(no prior conversation)'}`,
              messages: [{ role: 'user' as const, content: language === 'en' ? 'Send your follow-up now.' : '지금 후속 메시지를 보내.' }],
              sampling: { temperature: Math.min(0.8, provider.temperature ?? 0.7), maxTokens: Math.min(240, provider.maxTokens || 240) },
              signal: AbortSignal.timeout(90_000),
            };
            for await (const event of client.createStream(request)) {
              if (event.type === 'text' && typeof event.text === 'string' && messageText.length < 6000) messageText += event.text.slice(0, 6000 - messageText.length);
              if (event.type === 'error') throw event.error;
            }
            messageText = messageText.trim().slice(0, 3000);
            if (!messageText) { completeFollowUpJob(job.id); continue; }
            const turn: ChatMessage = { id: jobTurnId, speaker: { type: 'character', id: character.id }, content: parseChatMarkdown(messageText), timestamp: new Date().toISOString() };
            let saved = false;
            await withConversationLock(conversationId, async () => {
              if (!readCrossChatEnabled() || job.consentGeneration !== crossChatConsentGeneration() || !hasFollowUpJob(job.id) || conversationMemoryGeneration(data.world.id, conversationId).startsWith('resetting:')) {
                completeFollowUpJob(job.id);
                return;
              }
              await saveConversationTurn({ id: conversationId, world: data.world.id, timeSlice: existingTarget?.timeSlice || job.context.timeSlice || 'none', player: profile.name, updatedAt: turn.timestamp, message: toStoredTurn(conversationId, turn) });
              if (!readCrossChatEnabled() || job.consentGeneration !== crossChatConsentGeneration() || !hasFollowUpJob(job.id)) {
                await removeConversationTurn(conversationId, jobTurnId);
                completeFollowUpJob(job.id);
                return;
              }
              completeFollowUpJob(job.id);
              saved = true;
            });
            if (!saved) continue;
            void listConversations(data.world.id).then(rows => { if (visibleConversation.current.world === data.world.id) setConversationSummaries(rows); }).catch(() => undefined);
            if (visibleConversation.current.world === data.world.id && visibleConversation.current.id === conversationId && visibleConversation.current.screen === 'chat' && !turnBusy.current) {
              const refreshed = fromStoredTurns(await loadConversation(conversationId));
              if (visibleConversation.current.world !== data.world.id || visibleConversation.current.id !== conversationId || visibleConversation.current.screen !== 'chat' || turnBusy.current) continue;
              turnHistory.current = refreshed;
              setThreadMessages(refreshed.map(item => ({ id: item.id, speaker: item.speaker.type === 'player' ? (language === 'en' ? 'You' : '나') : displayStudentName(characters.find(candidate => candidate.id === item.speaker.id)) || item.speaker.id, nodes: item.content, createdAt: item.timestamp, edited: false, reactions: {} })));
            }
          } catch { retryFollowUpJob(job.id); }
        }
      } catch {
        for (const job of due) retryFollowUpJob(job.id);
      } finally { processingFollowUps.current = false; }
    };
    const processDueJobs = async () => {
      if (!navigator.locks?.request) return;
      await navigator.locks.request('world-player-cross-chat-worker', { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (lock) await processDueJobsUnlocked();
      });
    };
    if (!navigator.locks?.request) {
      setNotice(language === 'en' ? 'Cross-chat follow-ups need Web Locks support in this browser. Scheduled messages are paused.' : '이 브라우저에서 교차 대화 후속 메시지를 사용하려면 Web Locks 지원이 필요합니다. 예약된 메시지는 일시 중지되었습니다.');
      return;
    }
    const timer = window.setInterval(() => { void processDueJobs(); }, 15_000);
    void processDueJobs();
    return () => window.clearInterval(timer);
  }, [crossChat, data, provider.endpoint, provider.apiKey, provider.model, provider.temperature, provider.maxTokens, streaming, characters, profile.name, language, currentConversationId, screen]);

  // World theme colours are only applied after a world is loaded; before that the palette is monochrome.
  const themeStyle = data?.world.theme?.colors ? { '--world-primary': data.world.theme.colors.primary, '--world-secondary': data.world.theme.colors.secondary, '--world-accent': data.world.theme.colors.accent } as React.CSSProperties : undefined;

  const localeBaseSource = useRef<WorldSource | undefined>(undefined);
  const packageRequest = useRef(0);
  const loadCachedPackageForLanguage = useMemo(() => createWorldLoader(import.meta.env.BASE_URL), []);

  const applyLoaded = (loaded: WorldData) => {
    setNotice(undefined);
    setData(loaded);
    // 기본 선택 없음 — 대화 상대는 사용자가 직접 고른다.
    setMainCharacterId(undefined);
    setParticipantIds([]);
    setCurrentConversationId('ba-inbox');
    setPendingImages([]);
    setPendingConversation(undefined);
    conversationRequest.current += 1;
    setSliceId('');
    setThreadMessages([]);
    turnHistory.current = [];
    historyMemoryGeneration.current = '0';
    setBrowseCategory(undefined);
    setPickerOpen(false);
  };

  const openWorldUrl = async (url: string) => {
    if (turnBusy.current) { setNotice(language === 'en' ? 'Stop the current reply before opening a package.' : '패키지를 열기 전에 진행 중인 응답을 중지하세요.'); return; }
    setStartupLoading(true);
    const request = ++packageRequest.current;
    setNotice(undefined);
    try {
      const source = await createRemoteZipSource(url);
      const loaded = await loadCachedPackageForLanguage(source, language);
      if (request !== packageRequest.current) return;
      localeBaseSource.current = source;
      applyLoaded(loaded);
      setScreen('home');
    } catch (error) {
      if (request !== packageRequest.current) return;
      setNotice(`${language === 'en' ? 'Could not load world package' : '세계관 패키지를 열 수 없습니다'}: ${error instanceof Error ? error.message : 'invalid package'}`);
    } finally {
      if (request === packageRequest.current) setStartupLoading(false);
    }
  };

  // Optional deep link remains useful for local preview; normal startup shows packages in worlds/.
  React.useEffect(() => {
    const startupWorld = IS_ANDROID_BUILD ? null : new URLSearchParams(window.location.search).get('world');
    let cancelled = false;
    void (async () => {
      try {
        if (startupWorld) {
          localeBaseSource.current = await createRemoteZipSource(startupWorld);
          const loaded = await loadCachedPackageForLanguage(localeBaseSource.current, language);
          if (cancelled) return;
          applyLoaded(loaded);
          setScreen('home');
        } else if (!IS_ANDROID_BUILD && !isTauriRuntime()) {
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
    if (turnBusy.current) { setNotice(language === 'en' ? 'Stop the current reply before opening a package.' : '패키지를 열기 전에 진행 중인 응답을 중지하세요.'); return; }
    setNotice(undefined);
    setStartupLoading(true);
    const request = ++packageRequest.current;
    try {
      const source = createZipSource(new Uint8Array(await file.arrayBuffer()));
      const loaded = await loadCachedPackageForLanguage(source, language);
      if (request !== packageRequest.current) return;
      localeBaseSource.current = source;
      applyLoaded(loaded);
      setScreen('home');
    } catch (error) {
      if (request !== packageRequest.current) return;
      setNotice(`${language === 'en' ? 'Could not load the English package' : '세계관 패키지를 열 수 없습니다'}: ${error instanceof Error ? error.message : 'invalid package'}`);
    } finally { if (request === packageRequest.current) setStartupLoading(false); }
  };

  // API keys use the configured secure store; non-secret provider settings use the settings store.
  const providerSettingsSnapshot = (config: ProviderConfig) => ({ endpoint: config.endpoint, model: config.model, systemInstructions: config.systemInstructions ?? '', temperature: config.temperature, maxTokens: config.maxTokens, contextWindowOverride: config.contextWindowOverride, variation: config.variation, maxCycleSpeakers: config.maxCycleSpeakers });
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
    setProvider(current => ({ ...current, ...settings, maxTokens: settings.maxTokens && settings.maxTokens > 0 ? settings.maxTokens : 32768, contextWindow: settings.contextWindowOverride && settings.contextWindowOverride >= 1024 ? settings.contextWindowOverride : DEFAULT_CONTEXT_WINDOW_TOKENS, status: language === 'en' ? `Saved endpoint and model loaded — ${backendLabel(backend)}` : `저장된 엔드포인트와 모델을 불러왔습니다 — ${backendLabel(backend)}` }));
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
    setLoadingModels(true);
    try {
      // Saving a key clears it from the form and stores it in the OS keychain/server/browser store.
      // Reuse that saved credential here just as chat generation does.
      const secret = provider.apiKey || (await loadApiKey()).secret;
      let models: ModelInfo[];
      if (isTauriRuntime()) {
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
      models = models.filter(model => typeof model?.id === 'string' && model.id.trim().length > 0);
      setProvider(current => {
        const selected = preferredOrFirstModel(current.model, models);
        const changed = Boolean(selected && selected.id !== current.model);
        const status = models.length === 0
          ? (language === 'en' ? `Connected, but the endpoint returned no models. The current model “${current.model || 'server default'}” could not be verified. Check that this endpoint exposes /models, or confirm the exact model ID with your provider.` : `연결은 되었지만 모델 목록이 비어 있습니다. 현재 모델 “${current.model || '서버 기본값'}”을 확인할 수 없습니다. 엔드포인트의 /models 제공 여부를 확인하거나 Provider에서 정확한 모델 ID를 확인해 주세요.`)
          : changed
            ? (language === 'en' ? `Loaded ${models.length} models. Selected ${selected!.id} because the previous model was not listed by this endpoint.` : `모델 ${models.length}개를 불러왔습니다. 기존 모델이 이 엔드포인트에 없어 ${selected!.id}(으)로 선택했습니다.`)
            : (language === 'en' ? `Loaded ${models.length} models. ${selected ? `Selected ${selected.id}.` : ''}` : `모델 ${models.length}개를 불러왔습니다. ${selected ? `${selected.id} 모델을 선택했습니다.` : ''}`);
        return { ...current, models, model: selected?.id ?? current.model, contextWindow: current.contextWindowOverride ?? selected?.contextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS, status };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error';
      const endpoint = provider.endpoint.trim();
      const connectionFailure = /fetch failed|failed to fetch|could not reach|connection refused|timed out|error sending request|failed to connect|networkerror/i.test(message);
      const status = !endpoint
        ? (language === 'en' ? 'Enter your provider endpoint, then run the connection check again.' : 'Provider 엔드포인트를 입력한 뒤 연결 확인을 다시 눌러 주세요.')
        : connectionFailure
          ? (language === 'en' ? `Could not reach ${endpoint}. Start the provider, verify its address and /v1 base path, then run the connection check again. For a local provider, start its server first.` : `${endpoint}에 연결할 수 없습니다. Provider 서버를 실행하고 주소와 /v1 경로를 확인한 뒤 연결 확인을 다시 눌러 주세요. 로컬 Provider라면 먼저 서버를 시작해야 합니다.`)
          : /401|403|unauthorized|forbidden/i.test(message)
            ? (language === 'en' ? `The provider rejected the request for ${endpoint}. Check the API key, then retry.` : `${endpoint}에서 요청을 거부했습니다. API 키를 확인한 뒤 다시 시도해 주세요.`)
            : /404|not found/i.test(message)
              ? (language === 'en' ? `The model list was not found at ${endpoint}. Enter the API base URL that serves /models (usually ending in /v1), then retry.` : `${endpoint}에서 모델 목록을 찾지 못했습니다. /models를 제공하는 API 기본 주소(대개 /v1로 끝남)를 입력한 뒤 다시 시도해 주세요.`)
              : (language === 'en' ? `Model discovery failed for ${endpoint}: ${message}. Check the endpoint and API key, then retry.` : `${endpoint}에서 모델을 불러오지 못했습니다: ${message}. 엔드포인트와 API 키를 확인한 뒤 다시 시도해 주세요.`);
      setProvider(current => ({ ...current, models: [], status }));
    } finally {
      setLoadingModels(false);
    }
  };

  const activeConversationId = conversationIdFor(data?.world.id ?? '', participantIds.length ? participantIds : mainCharacterId ? [mainCharacterId] : []);
  const refreshConversations = async (worldId = data?.world.id) => {
    if (!worldId) return;
    try { setConversationSummaries(await listConversations(worldId)); } catch { setConversationSummaries([]); }
  };
  useEffect(() => { void refreshConversations(); }, [data?.world.id]);
  const withConversationLock = async <T,>(conversationId: string, operation: () => Promise<T>): Promise<T> => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request(`world-player-conversation:${conversationId}`, operation);
    return operation();
  };
  const persistTurn = async (turn: ChatMessage, conversationId = currentConversationId === 'ba-inbox' ? activeConversationId : currentConversationId, expectedGeneration?: string) => {
    if (!data || !slice) return;
    try {
      await withConversationLock(conversationId, async () => {
        if (expectedGeneration !== undefined && (conversationMemoryGeneration(data.world.id, conversationId) !== expectedGeneration || expectedGeneration.startsWith('resetting:'))) return;
        await saveConversationTurn({ id: conversationId, world: data.world.id, timeSlice: slice.id, player: profile.name, updatedAt: new Date().toISOString(), message: toStoredTurn(conversationId, turn) });
      });
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
    if (turnBusy.current) { setNotice(language === 'en' ? 'Stop the current reply before switching conversations.' : '대화를 바꾸기 전에 진행 중인 응답을 중지하세요.'); return; }
    if (!ids.length) return;
    const requestId = ++conversationRequest.current;
    setParticipantIds(ids);
    setMainCharacterId(ids[0]);
    setCurrentConversationId(conversationId);
    setPendingImages([]);
    setContextStrategy(loadConversationContextMode(conversationId, ids.length));
    try {
      let generation = conversationMemoryGeneration(data?.world.id ?? '', conversationId);
      let turns = fromStoredTurns(await loadConversation(conversationId));
      const latestGeneration = conversationMemoryGeneration(data?.world.id ?? '', conversationId);
      if (latestGeneration !== generation) {
        generation = latestGeneration;
        turns = fromStoredTurns(await loadConversation(conversationId));
      }
      if (requestId !== conversationRequest.current) return;
      turnHistory.current = turns;
      historyMemoryGeneration.current = generation;
      lastSpeakers.current = [];
      const restored = turns.map(message => ({ speaker: message.speaker.type === 'player' ? (language === 'en' ? 'You' : '나') : displayStudentName(data?.entities.get(message.speaker.id) as Character | undefined) || message.speaker.id, nodes: message.content }));
      setThreadMessages(restored.map((message, index) => ({ id: turns[index]?.id ?? `restored-${index}`, speaker: message.speaker, nodes: message.nodes, createdAt: turns[index]?.timestamp ?? new Date().toISOString(), edited: false, reactions: {} })));
      setPickerOpen(false);
      setScreen('chat');
    } catch {
      if (requestId !== conversationRequest.current) return;
      turnHistory.current = []; historyMemoryGeneration.current = conversationMemoryGeneration(data?.world.id ?? '', conversationId); setThreadMessages([]); setPickerOpen(false); setScreen('chat');
    }
  };
  const conversationRequest = useRef(0);
  const startChat = (mode: ConversationContextMode) => {
    if (participantIds.length === 0 || !sliceId) return;
    const ids = [...participantIds].sort();
    const conversationId = conversationIdFor(data?.world.id ?? '', ids);
    saveConversationContextMode(conversationId, mode);
    setContextStrategy(mode);
    void openConversation(conversationId, ids);
  };

  const requestTimelineSelection = async (id: string, participants: string[], forceSelection = false) => {
    if (turnBusy.current) { setNotice(language === 'en' ? 'Stop the current reply before switching conversations.' : '대화를 바꾸기 전에 진행 중인 응답을 중지하세요.'); return; }
    const normalizeId = (value: string) => value.replace(/^character:/, '');
    const wanted = participants.map(normalizeId).sort();
    const hasSameParticipants = (conversationId: string) => {
      const stored = participantsForConversationId(conversationId).map(normalizeId).sort();
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
    void requestTimelineSelection(conversationIdFor(data?.world.id ?? '', [characterId]), [characterId]);
  };

  const resetChat = async () => {
    if (turnBusy.current) return;
    const participants = [...participantIds].sort();
    if (!participants.length) return;
    const accepted = window.confirm(language === 'en' ? 'Delete this conversation and all of its messages?' : '이 대화와 모든 메시지를 삭제할까요?');
    if (!accepted) return;
    const id = currentConversationId;
    let resetGeneration: string | undefined;
    let resetFailure: 'generation' | 'delete' | 'finalize' | undefined;
    try {
      await withConversationLock(id, async () => {
        if (data) {
          try { resetGeneration = await clearConversationMemory(data.world.id, id); }
          catch { resetFailure = 'generation'; throw new Error('reset-generation-failed'); }
        }
        try { await clearConversation(id); }
        catch {
          if (data && resetGeneration) {
            try { await completeConversationMemoryReset(data.world.id, id, resetGeneration); } catch { /* Keep compaction disabled if reset finalization fails. */ }
            historyMemoryGeneration.current = conversationMemoryGeneration(data.world.id, id);
          }
          resetFailure = 'delete';
          throw new Error('conversation-delete-failed');
        }
        saveDraft(draftKey(data?.world.id ?? '', id), '');
        saveBookmarks(bookmarkKey(data?.world.id ?? '', id), new Set());
        setInput('');
        clearCrossChatConversation(id, data?.world.id);
        if (data && resetGeneration) {
          try {
            await completeConversationMemoryReset(data.world.id, id, resetGeneration);
            historyMemoryGeneration.current = conversationMemoryGeneration(data.world.id, id);
          } catch {
            historyMemoryGeneration.current = `resetting:${resetGeneration}`;
            resetFailure = 'finalize';
            throw new Error('reset-finalize-failed');
          }
        }
      });
    } catch {
      if (resetFailure === 'generation') setNotice(language === 'en' ? 'Chat reset was stopped because local storage could not safely invalidate its memory.' : '로컬 저장소 오류로 대화 기억을 안전하게 무효화하지 못해 초기화를 중단했습니다.');
      else if (resetFailure === 'finalize') setNotice(language === 'en' ? 'Chat reset, but local storage could not finalize memory cleanup. Compaction is paused for this chat.' : '대화는 초기화했지만 로컬 저장소에서 기억 초기화를 마치지 못해 이 대화의 자동 압축을 멈췄습니다.');
      else setNotice(language === 'en' ? 'Could not delete this conversation.' : '대화를 삭제하지 못했습니다.');
      return;
    }
    setThreadMessages([]);
    turnHistory.current = [];
    lastSpeakers.current = [];
    await refreshConversations(data?.world.id);
    requestTimelineSelection(id, participants, true);
  };

  /** 진행 중인 대화의 원본 기록(화자 id 포함). 화면용 messages와 달리 이름이 아니라 id를 유지한다. */
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
      const loadedProvider = { ...provider, ...settings, maxTokens: settings.maxTokens && settings.maxTokens > 0 ? settings.maxTokens : 32768, contextWindow: settings.contextWindowOverride && settings.contextWindowOverride >= 1024 ? settings.contextWindowOverride : DEFAULT_CONTEXT_WINDOW_TOKENS };
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
  }, [settingsLoaded, provider.endpoint, provider.model, provider.systemInstructions, provider.temperature, provider.maxTokens, provider.contextWindow, provider.contextWindowOverride, provider.variation, provider.maxCycleSpeakers]);

  /** 진행 중인 사이클 제어(멈추기 버튼 + 요청 중단). */
  const stopRef = useRef(false);
    const abortRef = useRef<AbortController | undefined>(undefined);
  const loadMessageStyles = useMemo(() => createMessageStyleLoader(import.meta.env.BASE_URL), []);

  /**
   * 대화 사이클을 돌린다.
   *  - `text`를 주면 플레이어 발언을 넣고 참가자(또는 이름이 불린 캐릭터)가 말을 시작한다.
   *  - 이후 다음 화자와 종료 시점은 캐릭터들이 답변 끝의 신호로 직접 정한다.
   */
  const executeTurn = async (plan?: string[], text?: string): Promise<string[]> => {
    if (!data || !slice) return [];
    const activeParticipants = participants.length ? participants : mainCharacter ? [mainCharacter] : [];
    if (activeParticipants.length === 0) return [];
    if (!provider.endpoint) {
      setNotice(language === 'en' ? 'Set a provider endpoint in Settings before chatting.' : '대화하기 전에 설정에서 Provider 엔드포인트를 입력하세요.');
      return [];
    }
    const conversationId = currentConversationId === 'ba-inbox' ? activeConversationId : currentConversationId;
    const compactionGeneration = conversationMemoryGeneration(data.world.id, conversationId);
    if (compactionGeneration.startsWith('resetting:') || compactionGeneration !== historyMemoryGeneration.current) {
      if (!compactionGeneration.startsWith('resetting:')) {
        const latest = fromStoredTurns(await loadConversation(conversationId).catch(() => []));
        if (conversationMemoryGeneration(data.world.id, conversationId) === compactionGeneration) {
          turnHistory.current = latest;
          historyMemoryGeneration.current = compactionGeneration;
          setThreadMessages(latest.map(turn => ({ id: turn.id, speaker: turn.speaker.type === 'player' ? (language === 'en' ? 'You' : '나') : displayStudentName(characters.find(character => character.id === turn.speaker.id)) || turn.speaker.id, nodes: turn.content, createdAt: turn.timestamp, edited: false, reactions: {} })));
        }
      }
      setNotice(language === 'en' ? 'This conversation was reset in another window. Its latest history has been reloaded; send your message again.' : '다른 창에서 대화가 초기화되었습니다. 최신 기록을 다시 불러왔습니다. 메시지를 다시 보내 주세요.');
      return [];
    }
    const memory = loadConversationMemory(data.world.id, conversationId);
    const compactedHistory = historyAfterCompaction(turnHistory.current, memory);
    const memoryInstructions = memory?.summary ? `Long-term conversation memory (preserve these facts):\n${memory.summary}` : '';
    let userTurn: ChatMessage | undefined;
    if (text !== undefined && (text || pendingImages.length)) {
      userTurn = { id: `user-${crypto.randomUUID()}`, speaker: { type: 'player', id: profile.name }, content: [...(text ? parseChatMarkdown(text) : []), ...pendingImages], timestamp: new Date().toISOString() };
      setInput('');
      setPendingImages([]);
      setThreadMessages(current => [...current, { id: userTurn!.id, speaker: language === 'en' ? 'You' : '나', nodes: userTurn!.content, createdAt: userTurn!.timestamp, edited: false, reactions: {} }]);
      await persistTurn(userTurn, conversationId, compactionGeneration);
      if (conversationMemoryGeneration(data.world.id, conversationId) !== compactionGeneration) {
        setNotice(language === 'en' ? 'This conversation was reset while your turn was starting. Send your message again.' : '턴을 시작하는 동안 대화가 초기화되었습니다. 메시지를 다시 보내 주세요.');
        return [];
      }
    }
    let secret = provider.apiKey;
    if (!secret) secret = (await loadApiKey()).secret;
    const client = isTauriRuntime()
      ? new NativeOpenAICompatibleProvider(provider.endpoint, secret || undefined)
      : new OpenAICompatibleProvider(provider.endpoint, secret || undefined, isTauriRuntime() ? undefined : '/api/provider/chat/completions');
    if (stopRef.current) return [];
    let activeBubbleId: string | undefined;
    const cycleBubbleIds: string[] = [];
    let estimatedPromptTokens = 0;
    try {
      const messageStyles = await loadMessageStyles(data, activeParticipants, language);
      const result = await runConversationCycle({
        language,
        contextStrategy,
        provider: client,
        data,
        characters: activeParticipants,
        slice,
        player: profile,
        model: provider.model || 'default',
        history: compactedHistory,
        input: text,
        inputTurn: userTurn,
        plan,
        sampling,
        variation: provider.variation ?? true,
        systemInstructions: provider.systemInstructions,
        situation: [situation.trim(), memoryInstructions].filter(Boolean).join('\n\n'),
        directorInstructions: directorNotes.trim(),
        signal: abortRef.current?.signal,
        shouldStop: () => stopRef.current,
        maxSpeakersPerCycle: provider.maxCycleSpeakers ?? 8,
        messageStyles,
        onPromptUsage: estimate => { estimatedPromptTokens = Math.max(estimatedPromptTokens, estimate); },
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
      const lastResponse = result.turns.at(-1)?.content.map(node => node.text ?? '').join('') ?? '';
      const estimatedResponseTokens = estimatePromptTokens('', [{ role: 'assistant', content: lastResponse }]);
      estimatedPromptTokens += estimatedResponseTokens;
      turnHistory.current = result.history;
      const spoke = result.turns.map(turn => turn.speaker.id);
      setTypingMessageId(undefined);
      lastSpeakers.current = spoke;
      if (conversationMemoryGeneration(data.world.id, conversationId) !== compactionGeneration) {
        const latest = fromStoredTurns(await loadConversation(conversationId).catch(() => []));
        turnHistory.current = latest;
        historyMemoryGeneration.current = conversationMemoryGeneration(data.world.id, conversationId);
        setThreadMessages(latest.map(turn => ({ id: turn.id, speaker: turn.speaker.type === 'player' ? (language === 'en' ? 'You' : '나') : displayStudentName(characters.find(character => character.id === turn.speaker.id)) || turn.speaker.id, nodes: turn.content, createdAt: turn.timestamp, edited: false, reactions: {} })));
        setNotice(language === 'en' ? 'This conversation was reset while a reply was being generated. The reply was discarded.' : '응답을 생성하는 동안 대화가 초기화되어 응답을 저장하지 않았습니다.');
        return [];
      }
      for (const turn of result.turns) await persistTurn(turn, conversationId, compactionGeneration);
      await compactConversation({ worldId: data.world.id, conversationId, history: result.history, memory, provider: client, model: provider.model || 'default', language, expectedGeneration: compactionGeneration, contextWindowTokens: provider.contextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS, estimatedPromptTokens, responseReserveTokens: provider.maxTokens && provider.maxTokens > 0 ? provider.maxTokens : 4096 }).catch(() => setNotice(language === 'en' ? 'Automatic conversation compaction failed; the full transcript is still saved.' : '대화 자동 압축에 실패했습니다. 전체 대화 기록은 계속 저장되어 있습니다.'));
      if (crossChat && text?.trim()) {
        const recentText = result.history.slice(-12).map(turn => {
          const who = turn.speaker.type === 'player' ? profile.name : displayStudentName(characters.find(character => character.id === turn.speaker.id));
          return `${who || turn.speaker.id}: ${turn.content.map(node => node.type === 'image' ? '[image]' : node.text ?? '').join('')}`;
        }).join('\n').slice(-6000);
        const shared: SharedContext = {
          world: data.world.id,
          worldName: data.world.name,
          updatedAt: new Date().toISOString(),
          currentConversationId: conversationId,
          timeSlice: slice.id,
          timeSliceLabel: slice.labelEn && language === 'en' ? slice.labelEn : slice.label,
          location: situation.trim() || 'Not specified',
          activity: text.trim().slice(0, 1000),
          recentText,
        };
        saveSharedContext(shared);
        void planCrossChatFollowUps({
          provider: client, model: provider.model || 'default', context: shared,
          sourceConversationId: conversationId,
          currentParticipantIds: activeParticipants.map(character => character.id),
          characters: localizedCharacters.map(character => ({ id: character.id, name: character.name })),
        }).catch(() => undefined);
      }
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
    } finally { setTypingMessageId(undefined); }
  };

  // Claim the turn before the first storage/provider await, including image-only messages.
  const runTurn = async (plan?: string[], text?: string): Promise<string[]> => {
    if (turnBusy.current || !data || !slice) return [];
    turnBusy.current = true;
    stopRef.current = false;
    abortRef.current = new AbortController();
    setStreaming(true);
    try { return await executeTurn(plan, text); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Conversation failed.'); return []; }
    finally { turnBusy.current = false; setTypingMessageId(undefined); setStreaming(false); }
  };

  /** 사용자 메시지 전송 — 이후 진행은 캐릭터들이 신호로 결정한다. */
  const send = async () => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || turnBusy.current) return;
    await runTurn(undefined, text);
  };

  const attachImage = async (file: File) => {
    if (turnBusy.current) return;
    const requestId = conversationRequest.current;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) { setNotice(locale === 'ko' ? '이미지는 PNG/JPEG/WebP/GIF, 5MB 이하만 첨부할 수 있습니다.' : 'Attach PNG/JPEG/WebP/GIF images up to 5 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (requestId !== conversationRequest.current || turnBusy.current) return;
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
      <span className="dt-eyebrow">{IS_ANDROID_BUILD ? 'DANMUTALK · ANDROID' : 'DANMUTALK · LOCAL WORKSPACE'}</span>
      <h1>{startupLoading ? (language === 'en' ? 'Finding your worlds…' : '세계관을 찾는 중…') : (language === 'en' ? 'Choose a world to begin' : '세계관을 선택해 시작하세요')}</h1>
      <p>{startupLoading
        ? (language === 'en' ? 'Loading your world and student list.' : '세계와 학생 목록을 불러오고 있어요.')
        : (language === 'en' ? 'Open a world package to start messaging your students.' : '세계관 패키지를 열어 학생들과 대화를 시작해 보세요.')}</p>
      {IS_ANDROID_BUILD
        ? <p className="dt-world-package-help">{language === 'en' ? 'Download the world package, then return here and open the downloaded file.' : '세계관 패키지를 다운로드한 뒤 이 앱으로 돌아와 파일을 열어 주세요.'}</p>
        : <p className="dt-world-package-help">{language === 'en' ? 'You can also drag a .😭 or .zip file onto this window.' : '.😭 또는 .zip 파일을 이 창에 끌어다 놓아도 됩니다.'}</p>}
      {notice && <p className="dt-startup-error" role="alert">{notice}</p>}
      {availableWorlds.length > 0 && <section className="dt-world-list" aria-label={language === 'en' ? 'Available worlds' : '사용 가능한 세계관'}>
        <h2>{language === 'en' ? 'Worlds in your worlds folder' : 'worlds 폴더의 세계관'}</h2>
        <p>{language === 'en' ? 'Choose a package to play. Add more packages to the worlds folder to share them here.' : '플레이할 패키지를 선택하세요. worlds 폴더에 패키지를 추가하면 여기에 표시됩니다.'}</p>
        {availableWorlds.map(world => <button type="button" className="dt-world-option" key={world.name} disabled={startupLoading} onClick={() => void openWorldUrl(world.url)}><span>◈</span><strong>{world.name.replace(/\.(?:😭|zip)$/i, '')}</strong><small>{world.name.split('.').pop()?.toUpperCase()}</small></button>)}
      </section>}
      {IS_ANDROID_BUILD && <button className="dt-start-group" onClick={() => void openUrl(ANDROID_WORLD_RELEASE_URL)}><span>↓</span>{language === 'en' ? 'Download world package' : '세계관 패키지 다운로드'}</button>}
      {!IS_ANDROID_BUILD && <button className="dt-start-help" type="button" onClick={showTutorial}>{language === 'en' ? 'Show first-launch guide' : '처음 사용 안내 보기'}</button>}
      <button className="dt-start-group" onClick={() => packageInput.current?.click()}><span>＋</span>{IS_ANDROID_BUILD ? (language === 'en' ? 'Open downloaded package' : '다운로드한 패키지 열기') : (language === 'en' ? 'Open a world package' : '세계관 패키지 열기')}</button>
      <input ref={packageInput} type="file" hidden accept=".😭,.zip,application/zip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void openWorld(file); }} />
    </section>
  </main> : null;
  const changeTheme = (next: string) => { setTheme(next); localStorage.setItem('blue-archive.theme', next); };
  const changeLocale = (next: string) => { const value = next === 'en' ? 'en' : 'ko'; setLanguage(value); localStorage.setItem('blue-archive.locale', value); localStorage.setItem('blue-archive.language', value); };
  const changeSituation = (next: string) => { setSituation(next); localStorage.setItem('blue-archive.situation', next); };
  const changeDirectorNotes = (next: string) => { setDirectorNotes(next); localStorage.setItem('blue-archive.directorNotes', next); };
  const changeCrossChatEnabled = (enabled: boolean) => { persistCrossChatEnabled(enabled); setCrossChat(enabled); };

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
    {tutorialOpen && !startupLoading && <FirstRunGuide language={language} step={tutorialStep} onStep={setTutorialStep} onClose={closeTutorial} onOpenReleases={openReleases} onOpenPackage={() => packageInput.current?.click()} />}
    {worldPackageDrag && <div className="world-package-drop" role="status" aria-live="polite">{language === 'en' ? 'Drop your world package to open it' : '세계관 패키지를 놓으면 열립니다'}</div>}
    {data && <HomeScreen
      data={data} characters={localizedCharacters} conversations={conversationSummaries}
      language={language} onLanguage={changeLocale} notice={noticeText}
      activeStudentId={mainCharacterId} activeConversationId={currentConversationId}
      onOpenConversation={requestTimelineSelection} timeSlices={data.timeSlices} sliceId={sliceId}
      onSliceChange={next => { if (!turnBusy.current) setSliceId(next); }}
      onCloseChat={() => setScreen('home')} onResetChat={resetChat}
      activeChat={screen === 'chat' && slice ? <ConversationView
        key={`${data.world.id}:${currentConversationId}:${language}`}
        data={data} characters={localizedCharacters} participants={localizedParticipants}
        messages={threadMessages} input={input} streaming={streaming} typingMessageId={typingMessageId}
        theme={theme} locale={locale} situation={situation} directorNotes={directorNotes}
        pendingImages={pendingImages} crossChatEnabled={crossChat} onCrossChatEnabled={changeCrossChatEnabled}
        onTheme={changeTheme} onLocale={changeLocale} onSituation={changeSituation} onDirectorNotes={changeDirectorNotes}
        sliceId={sliceId} activeStudentId={mainCharacterId}
        bookmarkStorageKey={bookmarkKey(data.world.id, currentConversationId)}
        onContinue={() => void runTurn()}
        onRemovePendingImage={index => setPendingImages(current => current.filter((_, item) => item !== index))}
        onInput={setInput} onSend={send} onAttach={attachImage} onBack={() => setScreen('home')}
        onProfile={() => setProfileOpen(true)} onSettings={() => setConfigOpen(true)}
        onStop={stopCycle} onEdit={editVisualMessage} onReact={reactToMessage} onResetChat={resetChat}
      /> : undefined}
      onOpenChat={sendToStudent}
      onOpenGroupChat={() => { if (!turnBusy.current) { setParticipantIds([]); setSliceId(''); setPickerOpen(true); } }}
      onOpenSettings={() => setConfigOpen(true)} onEditProfile={() => setProfileOpen(true)} onConfig={() => setConfigOpen(true)}
      onLoad={() => packageInput.current?.click()} onFile={file => void openWorld(file)}
      packageInput={packageInput} onTutorial={showTutorial}
    />}
    <React.Suspense fallback={<span className="home-notice" role="status">{language === 'en' ? 'Loading…' : '불러오는 중…'}</span>}>
    {browseCategory && data && <BrowseOverlay data={data} categoryId={browseCategory} characterId={selectedProfileCharacter} language={language} onClose={() => { setBrowseCategory(undefined); setSelectedProfileCharacter(undefined); }} />}
    {pickerOpen && data && <ChatOverlay data={data} characters={localizedCharacters} selected={participantIds} sliceId={sliceId} language={language} onOpenProfile={openCharacterProfile} onToggle={toggleParticipant} onToggleFolder={toggleFolder} onSlice={setSliceId} onStart={startChat} onClose={() => setPickerOpen(false)} />}
    {pendingConversation && data && <TimelinePromptOverlay key={pendingConversation.id} language={language} title={language === 'en' ? `Choose timeline · ${pendingConversation.participants.map(id => displayStudentName(characters.find(character => character.id === id))).join(', ')}` : `대화 시점 선택 · ${pendingConversation.participants.map(id => displayStudentName(characters.find(character => character.id === id))).join(', ')}`} value={sliceId} options={[{ value: '', label: language === 'en' ? 'Choose a timeline…' : '시점을 선택하세요…' }, { value: 'none', label: language === 'en' ? 'None' : '시점 없음' }, ...data.timeSlices.map(item => ({ value: item.id, label: language === 'en' ? item.labelEn ?? item.label : item.label }))]} onChange={setSliceId} onContinue={continueAfterTimelineSelection} onClose={() => { setPendingConversation(undefined); setSliceId(''); }} />}
    {profileOpen && <ProfileOverlay key={language} profile={profile} onChange={next => { profileCustomized.current = true; localStorage.setItem('blue-archive.profile-customized', 'true'); setProfile(next); }} language={language} onClose={() => setProfileOpen(false)} />}
    {configOpen && <ConfigOverlay key={language} config={provider} onChange={changeProviderSettings} onLoadModels={loadModels} loadingModels={loadingModels} onSaveProvider={() => void saveProvider()} onLoadProvider={() => void loadSavedProviderSettings()} onSaveKey={() => void saveKey()} onLoadKey={loadKey} language={language} situation={situation} directorNotes={directorNotes} onSituation={changeSituation} onDirectorNotes={changeDirectorNotes} onClose={() => setConfigOpen(false)} />}
    </React.Suspense>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
