import React, { useEffect, useState } from 'react';
import type { PlayerProfile } from '@world-player/schema';
import type { ModelInfo } from '@world-player/provider';
import { ThemedSelect } from './themed-select';
import { GeneratedAudioPlayer } from './conversation-view';
import { VOICE_LANGUAGES, VOICE_MODELS, voiceModel, type VoiceLanguage, type VoiceModelId } from './tts-catalog';

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
  /** 캐릭터별로 temperature·반복 억제 값을 갈라 목소리를 벌린다. */
  variation?: boolean;
  /** 한 사이클에서 캐릭터가 말할 수 있는 최대 횟수(지시문이 계속 이어져도 여기서 멈춘다). */
  maxCycleSpeakers?: number;
  /** Opt-in local voice generation; disabled by default. */
  ttsEnabled?: boolean;
  ttsEndpoint?: string;
  ttsEngine?: VoiceModelId;
  ttsLanguage?: VoiceLanguage;
  ttsStyle?: string;
  ttsCloningConsent?: boolean;
  ttsStatus?: string;
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
export function ConfigOverlay({ config, onChange, onLoadModels, onSaveProvider, onLoadProvider, onSaveKey, onLoadKey, onSaveVoiceSettings, onPreviewVoice, previewVoiceBusy = false, previewVoiceAudio, previewVoiceStatus, voiceSettingsSaving = false, vramInfo, onRefreshVram, onClose, language = 'ko', situation, directorNotes, onSituation, onDirectorNotes }:  { config: ProviderConfig; onChange: (config: ProviderConfig) => void; onLoadModels: () => void; onSaveProvider: () => void; onLoadProvider: () => void; onSaveKey: () => void; onLoadKey: () => void; onSaveVoiceSettings: (config: ProviderConfig) => void; onPreviewVoice: () => void; previewVoiceBusy?: boolean; previewVoiceAudio?: string; previewVoiceStatus?: string; voiceSettingsSaving?: boolean; vramInfo?: { device?: string; totalVramMB?: number; usedVramMB?: number; availableVramMB?: number; processVramMB?: number; acceleratorBackend?: string; acceleratorAvailable?: boolean }; onRefreshVram: () => void; onClose: () => void; language?: string; situation: string; directorNotes: string; onSituation: (value: string) => void; onDirectorNotes: (value: string) => void }) {
  const [pendingVramConfig, setPendingVramConfig] = useState<{ next: ProviderConfig; previous: ProviderConfig }>();
  useEffect(() => { onRefreshVram(); const timer = window.setInterval(onRefreshVram, 2000); return () => window.clearInterval(timer); }, [onRefreshVram]);
  const en = language === 'en';
  const updateTtsConfig = (next: ProviderConfig) => onChange({ ...next, ttsStatus: undefined });
  const modelOptions = [{ value: '', label: en ? 'Server default' : '기본값' }, ...config.models.map(model => ({ value: model.id, label: model.name || model.id }))];
  if (config.model && !config.models.some(model => model.id === config.model)) modelOptions.push({ value: config.model, label: config.model });
  const ttsEngine = config.ttsEngine ?? 'voxcpm2';
  const selectedVoiceModel = voiceModel(ttsEngine);
  const ttsLanguage = config.ttsLanguage ?? 'ja';
  const ttsVram = config.ttsEnabled ? selectedVoiceModel.expectedVramMB : 0;
  const expectedVram = ttsVram;
  const totalVram = vramInfo?.totalVramMB ?? 0;
  const chartTotal = totalVram || (expectedVram > 0 ? expectedVram + 500 : 0);
  const gpuUsed = Math.max(0, Math.min(totalVram, vramInfo?.usedVramMB ?? (totalVram - (vramInfo?.availableVramMB ?? totalVram))));
  const measuredProcessVram = vramInfo?.processVramMB ?? 0;
  const hasMeasuredProcessVram = measuredProcessVram > 0;
  const ttsBar = totalVram ? Math.min(gpuUsed, measuredProcessVram) : Math.max(0, expectedVram);
  const otherUsedBar = totalVram ? Math.max(0, gpuUsed - ttsBar) : (expectedVram ? 500 : 0);
  const unusedBar = totalVram ? Math.max(0, totalVram - gpuUsed) : 0;
  const vramWidth = (value: number) => chartTotal ? `${value / chartTotal * 100}%` : '0%';
  const formatVram = (value: number) => value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${Math.round(value)} MB`;
  const vramEstimateText = config.ttsEnabled
    ? (expectedVram ? (en ? `Expected TTS GPU memory: ${(expectedVram / 1024).toFixed(1)} GB (measured peak) + 500 MB headroom` : `TTS 예상 GPU 메모리: ${(expectedVram / 1024).toFixed(1)} GB (실측 피크) + 여유 공간 500 MB`) : (en ? 'CPU inference; 0 GB GPU memory required.' : 'CPU 추론 모델로 GPU 메모리를 사용하지 않습니다.'))
    : (en ? 'Voice generation is off; no local model will load (0 GB).' : '음성 생성이 꺼져 있어 로컬 모델을 불러오지 않습니다 (0 GB).');
  const projectedFreeVram = hasMeasuredProcessVram ? (vramInfo?.availableVramMB ?? 0) : (totalVram ? totalVram - gpuUsed - expectedVram : 0);
  const vramWarning = Boolean(expectedVram && vramInfo && (!vramInfo.totalVramMB || projectedFreeVram < 500));
  const requestVoiceSettingsSave = (next: ProviderConfig) => {
    const model = voiceModel(next.ttsEngine);
    const estimated = next.ttsEnabled ? model.expectedVramMB : 0;
    const used = vramInfo?.usedVramMB ?? 0;
    const predictedFree = hasMeasuredProcessVram ? (vramInfo?.availableVramMB ?? 0) : ((vramInfo?.totalVramMB ?? 0) - used - estimated);
    const insufficient = Boolean(estimated && vramInfo && (!vramInfo.totalVramMB || predictedFree < 500));
    if (insufficient) setPendingVramConfig({ next, previous: config });
    else onSaveVoiceSettings(next);
  };
  return <OverlayShell title={en ? 'Chat settings' : '대화 설정'} onClose={onClose} language={language}>
    <p className="settings-intro">{en ? 'Choose how DanmuTalk conversations work.' : 'DanmuTalk의 연결과 대화 방식을 설정합니다.'}</p>
    <label className="field"><span>Provider Endpoint</span>
      <input className="theme-input" value={config.endpoint} onChange={event => onChange({ ...config, endpoint: event.target.value })} placeholder="https://api.example.com/v1" />
    </label>
    <div className="row">
      <button className="ghost-button" onClick={onLoadModels}>{en ? 'Load models' : '모델 불러오기'}</button>
      {config.models.length > 0 && <span className="hint">{en ? `${config.models.length} models` : `${config.models.length}개 모델`}</span>}
    </div>
    <label className="field"><span>{en ? 'Model' : '모델'}</span>
      <ThemedSelect className="settings-model-select" ariaLabel={en ? 'Model' : '모델'} searchable searchPlaceholder={en ? 'Search models' : '모델 검색'} noResultsLabel={en ? 'No models found' : '모델이 없습니다'} value={config.model} onChange={model => onChange({ ...config, model })} options={modelOptions} />
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
    <section className="chat-director-settings voice-settings">
      <h3>{en ? 'Voice generation' : '음성 생성'}</h3>
      <label className="row settings-toggle"><input className="settings-checkbox" type="checkbox" checked={config.ttsEnabled ?? false} disabled={voiceSettingsSaving} onChange={event => { const next = { ...config, ttsEnabled: event.target.checked, ttsStatus: undefined }; updateTtsConfig(next); requestVoiceSettingsSave(next); }} /><span>{en ? 'Generate voice locally' : '로컬에서 음성 생성'}</span></label>
      <label className="row settings-toggle tts-consent"><input className="settings-checkbox" type="checkbox" checked={config.ttsCloningConsent ?? false} onChange={event => { const next = { ...config, ttsCloningConsent: event.target.checked, ttsStatus: undefined }; updateTtsConfig(next); if (next.ttsEnabled) requestVoiceSettingsSave(next); }} /><span>{en ? 'I have permission to clone these reference voices and will identify generated speech as AI-made.' : '이 음성 참조를 복제할 권한이 있고, 생성된 음성을 AI 음성으로 표시하는 데 동의합니다.'}</span></label>
      <p className="hint">{ttsLanguage === language
        ? (en ? 'Voice uses the visible chat text directly because both languages match.' : '대화와 음성 언어가 같아 화면에 보이는 메시지로 바로 음성을 만듭니다.')
        : (en ? 'The chat LLM adds a hidden translation in the selected voice language. Synthesis starts as soon as it arrives; no separate translator is used.' : '대화 LLM이 선택한 음성 언어로 숨겨진 번역을 덧붙입니다. 번역이 도착하면 바로 음성을 만들며 별도 번역기는 사용하지 않습니다.')}</p>
      <label className="field"><span>{en ? 'Voice language' : '음성 언어'}</span><ThemedSelect className="settings-model-select" ariaLabel={en ? 'Voice language' : '음성 언어'} value={selectedVoiceModel.languages.includes(ttsLanguage) ? ttsLanguage : selectedVoiceModel.languages[0]} onChange={value => { const next = { ...config, ttsLanguage: value as VoiceLanguage, ttsStatus: undefined }; updateTtsConfig(next); if (next.ttsEnabled) requestVoiceSettingsSave(next); }} options={VOICE_LANGUAGES.filter(item => selectedVoiceModel.languages.includes(item.value))} /></label>
      <fieldset className="tts-model-catalog"><legend>{en ? 'Voice model catalog' : '음성 모델 목록'}</legend>{VOICE_MODELS.map(model => <button type="button" key={model.id} className={`tts-model-card${ttsEngine === model.id ? ' selected' : ''}`} aria-pressed={ttsEngine === model.id} onClick={() => { const nextLanguage = model.languages.includes(ttsLanguage) ? ttsLanguage : model.languages[0]!; const next = { ...config, ttsEngine: model.id, ttsLanguage: nextLanguage, ttsEndpoint: 'http://127.0.0.1:8177', ttsStatus: undefined }; updateTtsConfig(next); if (next.ttsEnabled) requestVoiceSettingsSave(next); }}><span className="tts-model-card-head"><b>{model.name}</b><b>{model.expectedVramMB ? (en ? `~${(model.expectedVramMB / 1024).toFixed(1)} GB peak · RTX 4060` : `~${(model.expectedVramMB / 1024).toFixed(1)} GB 피크 · RTX 4060 실측`) : (en ? 'CPU · 0 GB VRAM' : 'CPU · VRAM 0 GB')}</b></span><span>{model.license} · {model.downloadSize}{model.quantization ? ` · ${model.quantization}` : ''}</span><span>{model.features}</span><span>{model.languages.map(code => code.toUpperCase()).join(' / ')} · {model.voiceCloning ? (en ? 'voice cloning' : '음성 복제') : (en ? 'no voice cloning' : '음성 복제 미지원')} · {model.styleControl ? (en ? 'emotion/tone control' : '감정/말투 조절') : (en ? 'no emotion/tone control' : '감정/말투 조절 미지원')}</span></button>)}</fieldset>
      <p className="hint"><a href={selectedVoiceModel.licenseUrl} target="_blank" rel="noreferrer">{selectedVoiceModel.license}</a></p>
      {selectedVoiceModel.styleControl && <label className="field"><span>{en ? 'Style / emotion guidance (optional)' : '말투 / 감정 지시 (선택)'}</span><textarea className="theme-input" rows={2} maxLength={240} value={config.ttsStyle ?? ''} onChange={event => updateTtsConfig({ ...config, ttsStyle: event.target.value })} placeholder={en ? 'Optional overall guidance; the LLM will add per-message delivery notes.' : '전체 지시는 선택 사항이며 LLM이 메시지마다 말투를 정합니다.'} /></label>}
      {config.ttsEnabled && <label className="field"><span>{en ? 'Local service address' : '로컬 서비스 주소'}</span><input className="theme-input" type="url" value={config.ttsEndpoint ?? 'http://127.0.0.1:8177'} onChange={event => updateTtsConfig({ ...config, ttsEndpoint: event.target.value })} placeholder="http://127.0.0.1:8177" /></label>}
      <p className="hint">{en ? 'Live GPU status' : '실시간 GPU 상태'}: {vramInfo?.acceleratorBackend ? `${vramInfo.acceleratorBackend} · ${vramInfo.device ?? ''}` : (en ? 'Waiting for GPU status…' : 'GPU 상태 확인 중…')}{expectedVram > 0 && vramInfo?.acceleratorAvailable === false && vramInfo.acceleratorBackend ? (en ? ' · This model requires CUDA or ROCm.' : ' · 이 모델은 CUDA 또는 ROCm이 필요합니다.') : ''}</p>
      <p className="hint vram-estimate">{vramEstimateText}{totalVram ? ` · ${en ? 'used' : '사용'} ${formatVram(gpuUsed)} · ${en ? 'free' : '가용'} ${formatVram(unusedBar)}${vramInfo?.processVramMB ? ` · ${en ? 'this model process' : '모델 프로세스'} ${formatVram(ttsBar)}` : ''}` : ''}</p>
      <div className="vram-meter" role="img" aria-label={totalVram ? (en ? `Live VRAM: model process ${formatVram(ttsBar)}, other processes ${formatVram(otherUsedBar)}, free ${formatVram(unusedBar)}, total ${formatVram(totalVram)}` : `실시간 VRAM: 모델 프로세스 ${formatVram(ttsBar)}, 기타 프로세스 ${formatVram(otherUsedBar)}, 가용 ${formatVram(unusedBar)}, 전체 ${formatVram(totalVram)}`) : (config.ttsEnabled && expectedVram === 0 ? (en ? 'CPU inference model; no GPU memory used.' : 'CPU 추론 모델이며 GPU 메모리를 사용하지 않습니다.') : (en ? 'GPU total unavailable; displaying model peak estimate and 500 MB headroom.' : 'GPU 전체 용량을 알 수 없어 모델 예상치와 500 MB 여유를 표시합니다.'))}>
        <div className={`vram-meter-bar${totalVram ? '' : ' estimated'}`}>{chartTotal > 0 ? <><span className="vram-segment tts" style={{ width: vramWidth(ttsBar) }} /><span className="vram-segment headroom" style={{ width: vramWidth(otherUsedBar) }} /><span className="vram-segment unused" style={{ width: vramWidth(unusedBar) }} /></> : <span className="vram-segment unknown" style={{ width: '100%' }} />}</div>
        <div className="vram-legend">{chartTotal > 0 ? <><span><i className="tts" />{en ? 'This model process' : '이 모델 프로세스'} · {formatVram(ttsBar)}</span><span><i className="headroom" />{en ? 'Other GPU use' : '기타 GPU 사용'} · {formatVram(otherUsedBar)}</span><span><i className="unused" />{en ? 'Free' : '가용'} · {formatVram(unusedBar)}</span></> : <span>{config.ttsEnabled && expectedVram === 0 ? (en ? 'CPU-only model; no GPU memory used.' : 'CPU 전용 모델이며 GPU 메모리를 사용하지 않습니다.') : (en ? 'GPU capacity unavailable.' : 'GPU 용량 확인 불가')}</span>}</div>
      </div>
      {vramWarning && <p className="hint vram-warning">{en ? `The expected peak is about ${formatVram(expectedVram)}; under 500 MB is currently free.` : `예상 피크는 약 ${formatVram(expectedVram)}이며 현재 가용 메모리가 500 MB 미만입니다.`}</p>}
      {config.ttsEnabled && expectedVram > 0 && vramInfo?.acceleratorAvailable === false && <p className="hint vram-warning">{en ? 'The selected local voice model requires CUDA or ROCm.' : '선택한 로컬 음성 모델은 CUDA 또는 ROCm이 필요합니다.'}</p>}
      <div className="row settings-actions voice-save-row"><button className="dt-group-start" disabled={voiceSettingsSaving} onClick={() => requestVoiceSettingsSave(config)}>{voiceSettingsSaving ? (config.ttsStatus || (en ? 'Preparing voice generation…' : '음성 생성 준비 중…')) : (en ? 'Save voice settings' : '음성 설정 저장')}</button></div>
      {config.ttsStatus && <p className="hint" role="status">{config.ttsStatus}</p>}
      <div className="tts-preview-panel">
        <div className="row settings-actions"><button className="ghost-button" disabled={!config.ttsEnabled || voiceSettingsSaving || previewVoiceBusy} onClick={onPreviewVoice}>{previewVoiceBusy ? (en ? 'Generating sample…' : '샘플 생성 중…') : (en ? 'Test voice generation' : '음성 생성 테스트')}</button></div>
        <p className="hint">{en ? 'Creates a short sample directly from an included student voice reference.' : '포함된 학생 음성 참조로 짧은 샘플을 만듭니다.'}</p>
        {previewVoiceStatus && <p className="hint" role="status">{previewVoiceStatus}</p>}
        {previewVoiceAudio && <GeneratedAudioPlayer src={previewVoiceAudio} transcript={{ ja: 'こんにちは、先生。今日もよろしくお願いします。', en: 'Hello, Sensei. I hope you have a wonderful day.', ko: '안녕하세요, 선생님. 오늘도 잘 부탁드려요.' }[ttsLanguage]} locale={language} />}
      </div>
    </section>
    <div className="row settings-row">
      <label className="field settings-control"><span>{en ? 'Temperature' : 'Temperature'} <b className="field-unit">{config.temperature ?? 1}</b></span>
        <input className="settings-range" type="range" min={0.2} max={1.6} step={0.05} value={config.temperature ?? 1} onChange={event => onChange({ ...config, temperature: Number(event.target.value) })} />
      </label>
      <label className="field settings-control"><span>{en ? 'Max response tokens' : '최대 응답 길이'}</span>
        <input className="theme-input" type="number" min={0} step={128} value={config.maxTokens ?? 32768} onChange={event => onChange({ ...config, maxTokens: Number(event.target.value) })} placeholder="32768" />
      </label>
    </div>
    <label className="field settings-control"><span>{en ? 'Max student replies per turn' : '한 사이클 최대 발언 수'}</span>
      <input className="theme-input" type="number" min={1} max={20} value={config.maxCycleSpeakers ?? 8} onChange={event => onChange({ ...config, maxCycleSpeakers: Math.max(1, Math.min(20, Number(event.target.value) || 8)) })} />
    </label>
    <p className="hint">{en ? 'Students decide who speaks next and when to pause. This is the safety limit for one reply cycle.' : '학생이 다음 화자와 대화 종료 시점을 정합니다. 이 값은 한 차례 응답의 최대 발언 수입니다.'}</p>
    <label className="row settings-toggle">
      <span>{en ? 'Vary generation settings per student' : '학생마다 생성 설정에 변화를 주기'}</span>
      <input className="settings-checkbox" type="checkbox" checked={config.variation ?? true} onChange={event => onChange({ ...config, variation: event.target.checked })} />
    </label>
    <p className="hint">{en ? 'Provider settings are saved automatically.' : 'Provider 설정은 자동 저장됩니다.'}</p>
    {config.status ? <p className="hint">{config.status}</p> : null}
    <section className="chat-director-settings">
      <h3>{en ? 'Conversation' : '대화 설정'}</h3>
      <label className="field"><span>{en ? 'Scenario setting' : '상황 설정'}</span><textarea className="theme-input" value={situation} onChange={event => onSituation(event.target.value)} placeholder={en ? 'A late afternoon at Schale...' : '샬레의 늦은 오후…'} /></label>
      <label className="field"><span>{en ? 'Director instructions' : '디렉터 지시'}</span><textarea className="theme-input" value={directorNotes} onChange={event => onDirectorNotes(event.target.value)} placeholder={en ? 'Guide pacing, tone, or student behavior…' : '장면의 흐름이나 말투, 학생의 행동 방향…'} /></label>
    </section>
    {pendingVramConfig && <div className="overlay vram-confirm-overlay" role="alertdialog" aria-modal="true" aria-labelledby="vram-confirm-title" aria-describedby="vram-confirm-description"><div className="window vram-confirm-window"><h2 id="vram-confirm-title">{en ? 'Low GPU memory warning' : 'GPU 메모리 부족 경고'}</h2><p id="vram-confirm-description">{en ? `Estimated memory for ${voiceModel(pendingVramConfig.next.ttsEngine).name} is ${(voiceModel(pendingVramConfig.next.ttsEngine).expectedVramMB / 1024).toFixed(1)} GB, plus 500 MB headroom. Continuing may cause the model to fail to load or make other apps unstable.` : `${voiceModel(pendingVramConfig.next.ttsEngine).name}의 예상 메모리는 ${(voiceModel(pendingVramConfig.next.ttsEngine).expectedVramMB / 1024).toFixed(1)} GB이며, 500 MB 여유 공간이 추가로 필요합니다. 계속하면 모델 로드에 실패하거나 다른 앱이 불안정해질 수 있습니다.`}</p><div className="row settings-actions"><button className="ghost-button" onClick={() => { onChange(pendingVramConfig.previous); setPendingVramConfig(undefined); }}>{en ? 'Cancel' : '취소'}</button><button className="dt-group-start" onClick={() => { const next = pendingVramConfig.next; setPendingVramConfig(undefined); onSaveVoiceSettings(next); }}>{en ? 'Continue anyway' : '그래도 계속'}</button></div></div></div>}
  </OverlayShell>;
}
