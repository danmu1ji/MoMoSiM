import React from 'react';
import type { PlayerProfile } from '@world-player/schema';
import { DEFAULT_CONTEXT_WINDOW_TOKENS, type ModelInfo } from '@world-player/provider';
import { ThemedSelect } from './themed-select';

export function OverlayShell({ title, children, onClose, language = 'ko' }: { title: string; children: React.ReactNode; onClose: () => void; language?: string }) {
  return <div className="overlay dt-settings-overlay" role="dialog" aria-label={title}>
    <div className="window dt-settings-window" style={{ width: 'min(780px, 94vw)', height: 'min(88vh, 860px)', maxHeight: '88vh' }}>
      <div className="window-head">
        <span className="title">{title}</span>
        <span className="spacer" />
        <button className="chip ghost" aria-label={language === 'ko' ? '닫기' : 'Close'} onClick={onClose}>✕</button>
      </div>
      <div className="pane-scroll">{children}</div>
    </div>
  </div>;
}

/** Player profile: only what a player needs to say who they are. */
export function ProfileOverlay({ profile, onChange, onClose, language = 'ko' }: { profile: PlayerProfile; onChange: (profile: PlayerProfile) => void; onClose: () => void; language?: string }) {
  const en = language === 'en';
  return <OverlayShell title={en ? 'Profile' : '프로필'} onClose={onClose} language={language}>
    <label className="field"><span>{en ? 'Name' : '이름'}</span>
      <input className="theme-input" value={profile.name} onChange={event => onChange({ ...profile, name: event.target.value })} placeholder={en ? 'User' : '사용자'} />
    </label>
    <label className="field"><span>{en ? 'About' : '소개'}</span>
      <textarea className="theme-input" value={profile.description} onChange={event => onChange({ ...profile, description: event.target.value })} placeholder={en ? 'A teacher at Schale' : '샬레의 선생님'} />
    </label>
  </OverlayShell>;
}

export interface ProviderConfig {
  endpoint: string;
  model: string;
  systemInstructions?: string;
  apiKey: string;
  models: ModelInfo[];
  status?: string;
  /** 생성 파라미터 — 캐릭터마다 자동으로 조금씩 다르게 준다(엔진 `samplingFor`). */
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  contextWindowOverride?: number;
  /** 캐릭터별로 temperature·반복 억제 값을 갈라 목소리를 벌린다. */
  variation?: boolean;
  /** 한 사이클에서 캐릭터가 말할 수 있는 최대 횟수(지시문이 계속 이어져도 여기서 멈춘다). */
  maxCycleSpeakers?: number;
}

export function TimelinePromptOverlay({ language = 'ko', title, value, options, onChange, onContinue, onClose }: {
  language?: string; title: string; value: string; options: { value: string; label: string }[];
  onChange: (value: string) => void; onContinue: () => void; onClose: () => void;
}) {
  const en = language === 'en';
  return <OverlayShell title={title} onClose={onClose} language={language}>
    <p className="settings-intro">{en ? 'Choose the point in the story for this conversation. You can also continue without a timeline.' : '이 대화가 진행될 시점을 선택해 주세요. 시점 없이 시작할 수도 있습니다.'}</p>
    <label className="field"><span>{en ? 'Timeline' : '시점'}</span>
      <ThemedSelect className="settings-model-select" ariaLabel={en ? 'Timeline' : '시점'} value={value} onChange={onChange} options={options} />
    </label>
    <div className="row settings-actions">
      <button className="ghost-button" onClick={onClose}>{en ? 'Cancel' : '취소'}</button>
      <button className="dt-group-start" disabled={!value} onClick={onContinue}>{en ? 'Continue' : '계속'}</button>
    </div>
  </OverlayShell>;
}

/** LLM provider config: endpoint, model list, API key. */
export function ConfigOverlay({ config, onChange, onLoadModels, loadingModels = false, onSaveProvider, onLoadProvider, onSaveKey, onLoadKey, onClose, language = 'ko', situation, directorNotes, onSituation, onDirectorNotes }:  { config: ProviderConfig; onChange: (config: ProviderConfig) => void; onLoadModels: () => void; loadingModels?: boolean; onSaveProvider: () => void; onLoadProvider: () => void; onSaveKey: () => void; onLoadKey: () => void; onClose: () => void; language?: string; situation: string; directorNotes: string; onSituation: (value: string) => void; onDirectorNotes: (value: string) => void }) {
  const en = language === 'en';
  const modelOptions = [{ value: '', label: en ? 'Server default' : '기본값' }, ...config.models.map(model => ({ value: model.id, label: model.name || model.id }))];
  if (config.model && !config.models.some(model => model.id === config.model)) modelOptions.push({ value: config.model, label: config.model });
  return <OverlayShell title={en ? 'Chat settings' : '대화 설정'} onClose={onClose} language={language}>
    <p className="settings-intro">{en ? 'Choose how DanmuTalk conversations work.' : 'DanmuTalk의 연결과 대화 방식을 설정합니다.'}</p>
    <label className="field"><span>{en ? 'Provider endpoint' : 'Provider 엔드포인트'}</span>
      <input className="theme-input" aria-label={en ? 'Provider endpoint' : 'Provider 엔드포인트'} value={config.endpoint} onChange={event => onChange({ ...config, endpoint: event.target.value })} placeholder="https://api.example.com/v1" />
    </label>
    <div className="row">
      <button className="ghost-button" onClick={onLoadModels} disabled={loadingModels}>{loadingModels ? (en ? 'Checking connection…' : '연결 확인 중…') : (en ? 'Check connection & load models' : '연결 확인 및 모델 불러오기')}</button>
      {config.models.length > 0 && <span className="hint">{en ? `${config.models.length} models` : `${config.models.length}개 모델`}</span>}
    </div>
    <label className="field"><span>{en ? 'Model' : '모델'}</span>
      <ThemedSelect className="settings-model-select" ariaLabel={en ? 'Model' : '모델'} searchable searchPlaceholder={en ? 'Search models' : '모델 검색'} noResultsLabel={en ? 'No models found' : '모델이 없습니다'} value={config.model} onChange={model => onChange({ ...config, model, contextWindow: config.contextWindowOverride ?? config.models.find(item => item.id === model)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS })} options={modelOptions} />
    </label>
    <label className="field"><span>API Key <small>{en ? '(stored in OS keychain)' : '(OS 키체인 저장)'}</small></span>
      <input className="theme-input" type="password" autoComplete="off" value={config.apiKey} onChange={event => onChange({ ...config, apiKey: event.target.value })} placeholder={en ? 'Leave blank to use your saved key' : '비우면 저장된 키를 사용합니다'} />
    </label>
    <div className="row settings-actions provider-save-row">
      <button className="ghost-button" onClick={onSaveProvider}>{en ? 'Save endpoint and model' : '엔드포인트 및 모델 저장'}</button>
      <button className="ghost-button" onClick={onLoadProvider}>{en ? 'Load saved endpoint and model' : '저장된 엔드포인트 및 모델 불러오기'}</button>
      <button className="ghost-button" onClick={onSaveKey}>{en ? 'Save API key' : 'API 키 저장'}</button>
      <button className="ghost-button" onClick={onLoadKey}>{en ? 'Load saved key' : '저장된 키 불러오기'}</button>
    </div>
    <label className="field"><span>{en ? 'System instructions' : '시스템 지시'}</span>
      <textarea className="theme-input" rows={4} maxLength={8000} value={config.systemInstructions ?? ''} onChange={event => onChange({ ...config, systemInstructions: event.target.value })} placeholder={en ? 'Add instructions for every character reply…' : '모든 캐릭터 응답에 적용할 지시를 입력하세요…'} />
    </label>
    <div className="row settings-actions"><button className="ghost-button" onClick={onSaveProvider}>{en ? 'Save system instructions' : '시스템 지시 저장'}</button></div>
    <p className="hint">{en ? 'Added to each character’s system prompt and saved automatically. Keep the world facts and required output format intact.' : '모든 캐릭터의 시스템 프롬프트에 추가되며 자동 저장됩니다. 세계관 정보와 필수 출력 형식은 유지하도록 작성하세요.'}</p>
    <div className="row settings-row">
      <label className="field settings-control"><span>{en ? 'Temperature' : 'Temperature'} <b className="field-unit">{config.temperature ?? 1}</b></span>
        <input className="settings-range" type="range" min={0.2} max={1.6} step={0.05} value={config.temperature ?? 1} onChange={event => onChange({ ...config, temperature: Number(event.target.value) })} />
      </label>
      <label className="field settings-control"><span>{en ? 'Max response tokens' : '최대 응답 길이'}</span>
        <input className="theme-input" type="number" min={0} step={128} value={config.maxTokens ?? 32768} onChange={event => onChange({ ...config, maxTokens: Number(event.target.value) })} placeholder="32768" />
      </label>
      <label className="field settings-control"><span>{en ? 'Model context window (tokens)' : '모델 문맥 창 (토큰)'}</span>
        <input className="theme-input" type="number" min={1024} step={1024} value={config.contextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS} onChange={event => { const contextWindowOverride = Math.max(1024, Number(event.target.value) || DEFAULT_CONTEXT_WINDOW_TOKENS); onChange({ ...config, contextWindow: contextWindowOverride, contextWindowOverride }); }} />
      </label>
    </div>
    <p className="hint">{en ? 'Uses the selected model’s metadata by default. Setting a value here creates an override that takes priority. Auto-compaction starts when the estimated prompt plus response allowance leaves less than 10%.' : '기본값은 선택한 모델의 메타데이터를 사용합니다. 여기서 직접 설정하면 해당 값이 우선하는 재정의가 됩니다. 응답 여유분을 포함한 추정 프롬프트가 10% 미만의 여유를 남기면 자동 압축합니다.'}</p>
    <label className="field settings-control"><span>{en ? 'Max student replies per turn' : '한 사이클 최대 발언 수'}</span>
      <input className="theme-input" type="number" min={1} max={20} value={config.maxCycleSpeakers ?? 8} onChange={event => onChange({ ...config, maxCycleSpeakers: Math.max(1, Math.min(20, Number(event.target.value) || 8)) })} />
    </label>
    <p className="hint">{en ? 'Students decide who speaks next and when to pause. This is the safety limit for one reply cycle.' : '학생이 다음 화자와 대화 종료 시점을 정합니다. 이 값은 한 차례 응답의 최대 발언 수입니다.'}</p>
    <label className="row settings-toggle">
      <span>{en ? 'Vary generation settings per student' : '학생마다 생성 설정에 변화를 주기'}</span>
      <input className="settings-checkbox" type="checkbox" checked={config.variation ?? true} onChange={event => onChange({ ...config, variation: event.target.checked })} />
    </label>
    <p className="hint">{en ? 'Provider settings are saved automatically.' : 'Provider 설정은 자동 저장됩니다.'}</p>
    {config.status ? <p className="hint" role="status" aria-live="polite">{config.status}</p> : null}
    <section className="chat-director-settings">
      <h3>{en ? 'Conversation' : '대화 설정'}</h3>
      <label className="field"><span>{en ? 'Scenario setting' : '상황 설정'}</span><textarea className="theme-input" value={situation} onChange={event => onSituation(event.target.value)} placeholder={en ? 'A late afternoon at Schale...' : '샬레의 늦은 오후…'} /></label>
      <label className="field"><span>{en ? 'Director instructions' : '디렉터 지시'}</span><textarea className="theme-input" value={directorNotes} onChange={event => onDirectorNotes(event.target.value)} placeholder={en ? 'Guide pacing, tone, or student behavior…' : '장면의 흐름이나 말투, 학생의 행동 방향…'} /></label>
    </section>
  </OverlayShell>;
}
