import { invoke } from '@tauri-apps/api/core';

/**
 * 자격증명·설정 저장소 — 웹 서버 모드에서도 저장·불러오기가 되게 한다.
 *
 * 저장하는 것:
 *  - **API 키**(secret): 절대 화면에 되비추지 않고 그대로 보관만 한다.
 *  - **Provider 설정**: 엔드포인트 · 모델 · temperature · 최대 응답 길이 · 캐릭터별 편차 · 사이클 상한.
 *
 * 우선순위:
 *  1) 로컬 서버 API(`/api/credentials`, tools/serve.mjs) — 파일(0600)에 함께 저장. 서버 모드에서 권장.
 *  2) 브라우저 localStorage — 서버 없이 정적 호스팅(vite preview 등)으로 열었을 때의 폴백.
 *
 * Tauri(데스크톱)에서는 API 키만 OS 키체인(`credential_*`)에 넣고, 설정은 로컬 저장소에 둔다.
 */

const LOCAL_KEY = 'world-player.api-key';
const LOCAL_SETTINGS_KEY = 'world-player.provider';
const API = '/api/credentials';

/** 저장하는 Provider 설정(비밀이 아니므로 그대로 보관한다). */
export interface ProviderSettings {
  endpoint?: string;
  model?: string;
  systemInstructions?: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  contextWindowOverride?: number;
  variation?: boolean;
  maxCycleSpeakers?: number;
  translationProvider?: 'm2m100' | 'hy-mt2' | 'azure-free' | 'deepl';
  translationRegion?: string;
  deeplPlan?: 'free' | 'pro';
}

const SETTINGS_KEYS: (keyof ProviderSettings)[] = ['endpoint', 'model', 'systemInstructions', 'temperature', 'maxTokens', 'contextWindow', 'contextWindowOverride', 'variation', 'maxCycleSpeakers', 'translationProvider', 'translationRegion', 'deeplPlan'];

/** 넘어온 값에서 저장할 설정만 추린다(모르는 키·undefined 제거). */
export function pickSettings(value: Record<string, unknown> | undefined): ProviderSettings {
  const picked: ProviderSettings = {};
  for (const key of SETTINGS_KEYS) {
    const item = value?.[key];
    if (item === undefined) continue;
    if (key === 'endpoint' || key === 'model' || key === 'systemInstructions' || key === 'translationRegion') { if (typeof item === 'string') picked[key] = item; continue; }
    if (key === 'translationProvider' && ['m2m100', 'hy-mt2', 'azure-free', 'deepl'].includes(String(item))) { picked.translationProvider = item as ProviderSettings['translationProvider']; continue; }
    if (key === 'deeplPlan' && ['free', 'pro'].includes(String(item))) { picked.deeplPlan = item as ProviderSettings['deeplPlan']; continue; }
    if (key === 'temperature' || key === 'maxTokens' || key === 'contextWindow' || key === 'contextWindowOverride' || key === 'maxCycleSpeakers') { if (typeof item === 'number' && Number.isFinite(item)) picked[key] = item; continue; }
    if (key === 'variation' && typeof item === 'boolean') picked.variation = item;
  }
  return picked;
}

export type CredentialBackend = 'server' | 'browser' | 'desktop' | 'none';
let providerSettingsSaveQueue: Promise<void> = Promise.resolve();
let lastProviderSettingsSavedAt = 0;

/** Tauri 데스크톱 런타임인지 판별. */
export function isDesktopRuntime(): boolean {
  return isTauriRuntime() && import.meta.env.VITE_APP_TARGET !== 'android';
}

/** Tauri runtime shared by desktop and Android builds. */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function serverReachable(): Promise<boolean> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    if (!response.ok) return false;
    const payload = (await response.json()) as { ok?: boolean };
    return Boolean(payload.ok);
  } catch {
    return false;
  }
}

/** 키 저장. 저장된 백엔드를 돌려준다. */
function credentialKey(account: string): string { return account === 'default' ? LOCAL_KEY : `${LOCAL_KEY}.${account}`; }

export async function saveApiKey(secret: string, account = 'default'): Promise<CredentialBackend> {
  if (isDesktopRuntime()) {
    await invoke('credential_set', { service: 'world-player', account, secret });
    return 'desktop';
  }
  if (await serverReachable()) {
    const response = await fetch(API, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(account === 'default' ? { secret } : { secret, account }),
    });
    if (response.ok) return 'server';
  }
  try {
    window.localStorage.setItem(credentialKey(account), secret);
    return 'browser';
  } catch {
    return 'none';
  }
}

/** 키 불러오기(없으면 빈 문자열). */
export async function loadApiKey(account = 'default'): Promise<{ secret: string; backend: CredentialBackend }> {
  if (isDesktopRuntime()) {
    try {
      const stored = await invoke<string | null>('credential_get', { service: 'world-player', account });
      if (stored) return { secret: stored, backend: 'desktop' };
    } catch {
      /* 폴백으로 진행 */
    }
  }
  if (await serverReachable()) {
    try {
      const response = await fetch(account === 'default' ? API : `${API}?account=${encodeURIComponent(account)}`, { cache: 'no-store' });
      if (response.ok) {
        const payload = (await response.json()) as { secret?: string };
        if (payload.secret) return { secret: payload.secret, backend: 'server' };
      }
    } catch {
      /* 폴백으로 진행 */
    }
  }
  try {
    const stored = window.localStorage.getItem(credentialKey(account));
    if (stored) return { secret: stored, backend: 'browser' };
  } catch {
    /* 무시 */
  }
  return { secret: '', backend: 'none' };
}

/** Provider 설정 저장 — 서버 파일 우선, 없으면 브라우저 저장소. */
export function saveProviderSettings(settings: ProviderSettings): Promise<CredentialBackend> {
  const operation = providerSettingsSaveQueue.then(() => saveProviderSettingsInOrder(settings));
  providerSettingsSaveQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function saveProviderSettingsInOrder(settings: ProviderSettings): Promise<CredentialBackend> {
  const picked = pickSettings(settings as Record<string, unknown>);
  const savedAt = Math.max(Date.now(), lastProviderSettingsSavedAt + 1);
  lastProviderSettingsSavedAt = savedAt;
  if (isDesktopRuntime()) return writeLocalSettings(picked, savedAt) ? 'desktop' : 'none';
  // Commit locally before the network request so an app close or stale server cannot
  // discard the values the user just entered.
  const localSaved = writeLocalSettings(picked, savedAt);
  if (await serverReachable()) {
    try {
      const response = await fetch(API, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ settings: picked, settingsUpdatedAt: savedAt }),
      });
      if (response.ok) {
        const readback = await fetch(API, { cache: 'no-store' });
        if (readback.ok) {
          const payload = (await readback.json()) as { settings?: Record<string, unknown> };
          const persisted = pickSettings(payload.settings);
          if (Object.entries(picked).every(([key, value]) => persisted[key as keyof ProviderSettings] === value)) return 'server';
        }
      }
    } catch {
      /* 폴백으로 진행 */
    }
  }
  return localSaved ? 'browser' : 'none';
}

function writeLocalSettings(settings: ProviderSettings, savedAt = Date.now()): boolean {
  try {
    window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify({ ...settings, _settingsUpdatedAt: savedAt }));
    return true;
  } catch {
    return false;
  }
}

function readLocalSettings(): { settings?: ProviderSettings; updatedAt: number } {
  try {
    const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    const picked = pickSettings(parsed);
    return { settings: Object.keys(picked).length ? picked : undefined, updatedAt: typeof parsed?._settingsUpdatedAt === 'number' ? parsed._settingsUpdatedAt : 0 };
  } catch {
    return { updatedAt: 0 };
  }
}

/** Provider 설정 불러오기(없으면 undefined). 값이 있으면 어디서 읽었는지도 함께 돌려준다. */
export async function loadProviderSettings(): Promise<{ settings?: ProviderSettings; backend: CredentialBackend }> {
  const local = readLocalSettings();
  if (isDesktopRuntime()) return local.settings ? { settings: local.settings, backend: 'desktop' } : { backend: 'none' };
  if (await serverReachable()) {
    try {
      const response = await fetch(API, { cache: 'no-store' });
      if (response.ok) {
        const payload = (await response.json()) as { settings?: Record<string, unknown>; settingsUpdatedAt?: number };
        const serverSettings = pickSettings(payload.settings);
        const serverUpdatedAt = typeof payload.settingsUpdatedAt === 'number' ? payload.settingsUpdatedAt : 0;
        if (Object.keys(serverSettings).length && (!local.settings || serverUpdatedAt >= local.updatedAt)) {
          // The server is authoritative on timestamp ties. A prior partial local save must not
          // hide the server's merged provider settings from the explicit Load action. Keep
          // locally saved keys that a stale server version may have dropped from its response.
          const merged = { ...local.settings, ...serverSettings };
          writeLocalSettings(merged, serverUpdatedAt || Date.now());
          return { settings: merged, backend: 'server' };
        }
      }
    } catch {
      /* 폴백으로 진행 */
    }
  }
  return local.settings ? { settings: local.settings, backend: 'browser' } : { backend: 'none' };
}

/** 설정만 지운다(키는 남긴다). */
export async function clearProviderSettings(): Promise<void> {
  try {
    window.localStorage.removeItem(LOCAL_SETTINGS_KEY);
  } catch {
    /* 무시 */
  }
  if (await serverReachable()) {
    await fetch(`${API}?scope=settings`, { method: 'DELETE' }).catch(() => {});
  }
}

/** 키 삭제(모든 백엔드에서). */
export async function clearApiKey(): Promise<void> {
  try {
    window.localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* 무시 */
  }
  if (await serverReachable()) {
    await fetch(API, { method: 'DELETE' }).catch(() => {});
  }
}

/** 사람이 읽을 백엔드 이름. */
export function backendLabel(backend: CredentialBackend): string {
  switch (backend) {
    case 'server': return '로컬 서버 파일(0600)';
    case 'browser': return '브라우저 저장소(서버 저장 확인 안 됨)';
    case 'desktop': return 'OS 키체인(데스크톱)';
    default: return '저장되지 않음';
  }
}
