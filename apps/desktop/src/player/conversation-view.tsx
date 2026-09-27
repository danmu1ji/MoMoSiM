import React from 'react';
import type { ChatNode, Character } from '@world-player/schema';
import type { WorldData } from '@world-player/engine/desktop';
import { BannerImage } from './banner-image';
import { LazyAssetImage, LazyAudio } from './lazy-asset';
import { ThemedSelect } from './themed-select';

export interface ConversationMessage { id: string; voiceId?: string; speaker: string; nodes: ChatNode[]; createdAt: string; edited: boolean; reactions: Record<string, string[]> }

export function ConversationView({ data, characters, participants, messages, input, streaming, typingMessageId, theme, locale, situation, directorNotes, activeStudentId, sliceId, onTheme, onLocale, onSituation, onDirectorNotes, onInput, onSend, onAttach, onBack, onProfile, onSettings, onStop, onResetChat, onCancelVoice, onEdit, onReact, pendingImages, onRemovePendingImage, ttsEnabled = false, generatedVoices = {} }: {
  data: WorldData; characters: Character[]; participants: Character[]; messages: ConversationMessage[]; input: string; streaming: boolean; typingMessageId?: string; theme: string; locale: string; situation: string; directorNotes: string; pendingImages: ChatNode[]; activeStudentId?: string; sliceId: string;
  ttsEnabled?: boolean; generatedVoices?: Record<string, { state: 'queued' | 'loading' | 'ready' | 'error'; stage?: string; generatedTokens?: number; textCharacters?: number; elapsedMs?: number; startedAt?: number; truncated?: boolean; url?: string; text?: string; error?: string }>;
  onTheme: (theme: string) => void; onLocale: (locale: string) => void; onSituation: (value: string) => void; onDirectorNotes: (value: string) => void; onRemovePendingImage: (index: number) => void; onInput: (text: string) => void; onSend: () => void; onAttach: (file: File) => void; onBack: () => void; onProfile: () => void; onSettings: () => void; onStop: () => void; onResetChat: () => void; onCancelVoice: (messageId: string) => void; onEdit: (id: string, text: string) => void; onReact: (id: string, emoji: string) => void;
}) {
  const scroll = React.useRef<HTMLDivElement>(null);
  const voiceWork = Object.values(generatedVoices).filter(voice => voice.state === 'queued' || voice.state === 'loading');
  const queuedVoices = voiceWork.filter(voice => voice.state === 'queued').length;
  const activeVoices = voiceWork.length - queuedVoices;
  React.useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'auto' }); }, [messages.length, messages.at(-1)?.nodes.length]);
  const nameList = participants.map(student => student.name).join(', ');
  return <main className={`conversation theme-${theme}`}>
    <header className="chat-header"><button className="chat-back" onClick={onBack} aria-label={locale === 'ko' ? '대화 목록으로' : 'Back to conversations'}>‹</button><div className="chat-header-avatars">{participants.slice(0, 3).map(student => <span key={student.id}><BannerImage data={data} owner={student} kind="character" alt={student.name} /></span>)}</div><div className="chat-header-copy"><strong>{participants.length > 1 ? (locale === 'ko' ? `${participants.length}명의 그룹 채팅` : `Group chat · ${participants.length}`) : participants[0]?.name ?? (locale === 'ko' ? '새 대화' : 'New chat')}</strong><small>{nameList || (locale === 'ko' ? '학생을 선택해 대화를 시작하세요' : 'Select students to start chatting')}</small><span className="chat-timeline-label" title={locale === 'en' ? data.timeSlices.find(slice => slice.id === sliceId)?.labelEn ?? data.timeSlices.find(slice => slice.id === sliceId)?.label ?? 'None' : data.timeSlices.find(slice => slice.id === sliceId)?.label ?? '시점 없음'}>{locale === 'en' ? data.timeSlices.find(slice => slice.id === sliceId)?.labelEn ?? data.timeSlices.find(slice => slice.id === sliceId)?.label ?? 'None' : data.timeSlices.find(slice => slice.id === sliceId)?.label ?? '시점 없음'}</span></div><ThemedSelect className="chat-locale-select" ariaLabel="Language / 언어" value={locale} onChange={onLocale} options={[{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }]} /><button className="chat-icon chat-reset-chat" disabled={streaming} aria-label={locale === 'ko' ? '대화 초기화' : 'Reset chat'} title={locale === 'ko' ? '대화 초기화' : 'Reset chat'} onClick={onResetChat}>↻</button><button className="chat-icon" aria-label={locale === 'ko' ? '설정' : 'Settings'} title={locale === 'ko' ? '설정' : 'Settings'} onClick={onSettings}>⚙</button></header>
    <div className="chat-chat" ref={scroll}>
      {(situation.trim() || directorNotes.trim()) && <div className="chat-context">{situation.trim() && <span>▤ {locale === 'ko' ? '상황' : 'Scenario'}: {situation}</span>}{directorNotes.trim() && <span>✎ {locale === 'ko' ? '디렉터 지시 적용 중' : 'Director notes active'}</span>}</div>}
      {ttsEnabled && voiceWork.length > 0 && <div className="chat-voice-queue" role="status" aria-live="polite">{locale === 'ko' ? `음성 생성 ${activeVoices ? `${activeVoices}개 처리 중` : '대기 중'}${queuedVoices ? ` · ${queuedVoices}개 대기` : ''}` : `Voice generation · ${activeVoices ? `${activeVoices} processing` : 'waiting'}${queuedVoices ? ` · ${queuedVoices} queued` : ''}`}</div>}
      <div className="chat-date"><span>{locale === 'ko' ? '오늘의 메시지' : 'TODAY'}</span></div>
      {!messages.length && <div className="chat-empty">{participants.length > 1 ? (locale === 'ko' ? '그룹 멤버들과 대화를 시작해 보세요!' : 'Start a group conversation!') : `${participants[0]?.name ?? (locale === 'ko' ? '학생' : 'student')}${locale === 'ko' ? '에게 첫 메시지를 보내 보세요.' : ' — send a first message.'}`}</div>}
      {streaming && !typingMessageId && <div className="chat-row"><span className="chat-avatar" /><div className="chat-message-stack"><div className="chat-bubble"><TypingIndicator locale={locale} onStop={onStop} /></div></div></div>}
      {messages.map((message, index) => {
        const mine = message.speaker === '나' || message.speaker === 'You';
        const previous = messages[index - 1];
        const grouped = previous?.speaker === message.speaker && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
        const student = characters.find(character => character.name === message.speaker || character.id === message.speaker);
        const voiceId = message.voiceId ?? message.id;
        const voiceContinuesBelow = Boolean(message.voiceId && messages[index + 1]?.voiceId === message.voiceId);
        const waiting = streaming && message.id === typingMessageId && !message.nodes.length && !mine;
        return <div className={`chat-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`} key={message.id}>
          {!mine && <span className="chat-avatar">{student && <BannerImage data={data} owner={student} kind="character" alt={student.name} />}</span>}
          <div className="chat-message-stack">
            {!mine && <span className="chat-name">{message.speaker}</span>}
            <div className={`chat-bubble${mine ? ' own' : ''}`}>
              {waiting ? <TypingIndicator locale={locale} onStop={onStop} /> : message.nodes.map((node, nodeIndex) => <React.Fragment key={nodeIndex}>
                {node.type === 'image' && node.imageDataUrl ? <img className="chat-photo" src={node.imageDataUrl} alt={node.alt ?? 'attached image'} /> : node.type === 'media' && node.asset ? <ImageAsset data={data} assetId={node.asset} /> : node.type === 'audio' && node.asset ? (ttsEnabled ? null : <LazyAudio data={data} assetId={node.asset} />) : node.type === 'lineBreak' ? <br /> : node.type === 'emphasis' ? <em className="chat-narration">{node.text}</em> : node.type === 'strong' ? <strong>{node.text}</strong> : node.text}
              </React.Fragment>)}
              <span className="chat-message-tools">{mine && <button aria-label="Edit message" onClick={() => { const text = message.nodes.map(node => node.text ?? '').join(''); const next = window.prompt(locale === 'ko' ? '메시지를 수정합니다 (화면 연출)' : 'Edit message (visual simulation)', text); if (next !== null) onEdit(message.id, next); }}>✎</button>}<button aria-label="Add reaction" onClick={() => onReact(message.id, '💢')}>☻</button></span>
            </div>
            {!mine && !voiceContinuesBelow && ttsEnabled && generatedVoices[voiceId] && <GeneratedVoice voice={generatedVoices[voiceId]} locale={locale} onCancel={() => onCancelVoice(voiceId)} />}
            <div className="chat-meta">{new Date(message.createdAt).toLocaleTimeString(locale === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}{message.edited ? (locale === 'ko' ? ' · 수정됨' : ' · edited') : ''}</div>
            {Object.entries(message.reactions).map(([emoji, users]) => <button className="chat-reaction" key={emoji} onClick={() => onReact(message.id, emoji)}>{emoji} {users.length}</button>)}
          </div>
        </div>;
      })}
    </div>
    {pendingImages.length > 0 && <div className="chat-pending-images">{pendingImages.map((image, index) => <span key={index}><img src={image.imageDataUrl} alt={image.alt ?? 'attached photo'} /><button type="button" aria-label="Remove attached image" onClick={() => onRemovePendingImage(index)}>×</button></span>)}</div>}
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); onSend(); }}><label className="chat-attach" title={locale === 'ko' ? '사진을 첨부해 질문하기' : 'Attach a photo'}>＋<input aria-label={locale === 'ko' ? '사진 첨부' : 'Attach image'} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onAttach(file); }} /></label><input value={input} onChange={event => onInput(event.target.value)} placeholder={locale === 'ko' ? '메시지를 입력하세요' : 'Write a message…'} aria-label={locale === 'ko' ? '메시지 입력' : 'Message'} /><button className="chat-send" type="submit" disabled={streaming}>{locale === 'ko' ? '전송' : 'Send'}</button></form>
  </main>;
}
function TypingIndicator({ locale, onStop }: { locale: string; onStop: () => void }) {
  return <span className="chat-typing-inline" role="status" aria-label={locale === 'ko' ? '입력 중' : 'Typing'}><span className="chat-typing-dots" aria-hidden="true"><i /><i /><i /></span><button type="button" onClick={onStop}>{locale === 'ko' ? '중지' : 'Stop'}</button></span>;
}
function ImageAsset({ data, assetId }: { data: WorldData; assetId: string }) { const asset = data.media.get(assetId); return asset ? <LazyAssetImage data={data} assetId={assetId} alt={asset.description} className="chat-photo" /> : null; }
function GeneratedVoice({ voice, locale, onCancel }: { voice: { state: 'queued' | 'loading' | 'ready' | 'error'; stage?: string; generatedTokens?: number; textCharacters?: number; elapsedMs?: number; startedAt?: number; truncated?: boolean; url?: string; text?: string; error?: string }; locale: string; onCancel: () => void }) {
  if (voice.state === 'ready' && voice.url) return <>{voice.truncated && <small className="chat-voice-status error">{locale === 'ko' ? '음성 길이 안전 한도에 도달했습니다. 음성 문장을 확인해 주세요.' : 'Speech reached its safety limit. Check the voice text.'}</small>}<GeneratedAudioPlayer src={voice.url} transcript={voice.text} locale={locale} /></>;
  if (voice.state === 'queued' || voice.state === 'loading') {
    const elapsed = Math.max(0, Math.floor((voice.elapsedMs ?? (voice.startedAt ? Date.now() - voice.startedAt : 0)) / 1000));
    const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
    const stageLabel = voice.stage === 'preparing_reference'
      ? (locale === 'ko' ? '참조 음성 준비 중' : 'Preparing voice reference')
      : voice.stage === 'synthesis'
        ? (locale === 'ko' ? '음성 합성 중' : 'Synthesizing speech')
        : voice.stage === 'decoding'
          ? (locale === 'ko' ? '음성 파형 생성 중' : 'Decoding audio')
          : voice.state === 'queued'
            ? (locale === 'ko' ? '음성 생성 대기 중' : 'Voice queued')
            : (locale === 'ko' ? '음성 생성 요청 중' : 'Starting voice generation');
    const detailParts = [
      voice.generatedTokens ? `${locale === 'ko' ? '음성 토큰' : 'speech tokens'} ${voice.generatedTokens}` : undefined,
      voice.textCharacters ? `${voice.textCharacters} ${locale === 'ko' ? '자' : 'chars'}` : undefined,
      clock,
    ].filter(Boolean);
    const detail = detailParts.join(' · ');
    return <small className="chat-voice-status generating"><span title={voice.text}>{stageLabel} · {detail}</span><button type="button" className="chat-voice-cancel" title={locale === 'ko' ? '음성 생성 취소' : 'Cancel voice generation'} aria-label={locale === 'ko' ? '음성 생성 취소' : 'Cancel voice generation'} onClick={onCancel}>×</button></small>;
  }
  return <small className="chat-voice-status error" title={voice.error}>{locale === 'ko' ? '음성을 생성하지 못했습니다' : 'Voice generation failed'}</small>;
}
export function GeneratedAudioPlayer({ src, transcript, locale }: { src: string; transcript?: string; locale: string }) {
  const audio = React.useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const format = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const toggle = () => {
    const player = audio.current;
    if (!player) return;
    if (player.paused) void player.play().catch(() => setPlaying(false));
    else player.pause();
  };
  return <div className="chat-generated-player" role="group" aria-label={locale === 'ko' ? 'AI 생성 음성' : 'AI-generated voice'} title={transcript ? `${locale === 'ko' ? '음성 문장' : 'Voice text'}: ${transcript}` : undefined}>
    <audio ref={audio} preload="metadata" src={src} onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    <span className="chat-audio-ai-label">{locale === 'ko' ? 'AI 음성' : 'AI voice'}</span>
    <button type="button" className="chat-audio-play" aria-label={playing ? (locale === 'ko' ? '일시 정지' : 'Pause') : (locale === 'ko' ? '재생' : 'Play')} onClick={toggle}>{playing ? 'Ⅱ' : '▶'}</button>
    <span className="chat-audio-current">{format(time)}</span>
    <input type="range" className="chat-audio-progress" min="0" max={Math.max(duration, 0.01)} step="0.01" value={Math.min(time, duration || 0)} aria-label={locale === 'ko' ? '재생 위치' : 'Playback position'} onChange={event => { const next = Number(event.target.value); setTime(next); if (audio.current) audio.current.currentTime = next; }} />
    <span className="chat-audio-duration">{format(duration)}</span>
  </div>;
}
