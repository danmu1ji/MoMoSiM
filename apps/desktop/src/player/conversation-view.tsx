import React from 'react';
import type { ChatNode, Character } from '@world-player/schema';
import type { WorldData } from '@world-player/engine/desktop';
import { BannerImage } from './banner-image';
import { LazyAssetImage } from './lazy-asset';
import { ThemedSelect } from './themed-select';

export interface ConversationMessage { id: string; speaker: string; nodes: ChatNode[]; createdAt: string; edited: boolean; reactions: Record<string, string[]> }

export function ConversationView({ data, characters, participants, messages, input, streaming, typingMessageId, theme, locale, situation, directorNotes, activeStudentId, sliceId, onTheme, onLocale, onSituation, onDirectorNotes, onInput, onSend, onAttach, onBack, onProfile, onSettings, onStop, onResetChat, onEdit, onReact, pendingImages, onRemovePendingImage }: {
  data: WorldData; characters: Character[]; participants: Character[]; messages: ConversationMessage[]; input: string; streaming: boolean; typingMessageId?: string; theme: string; locale: string; situation: string; directorNotes: string; pendingImages: ChatNode[]; activeStudentId?: string; sliceId: string;
  onTheme: (theme: string) => void; onLocale: (locale: string) => void; onSituation: (value: string) => void; onDirectorNotes: (value: string) => void; onRemovePendingImage: (index: number) => void; onInput: (text: string) => void; onSend: () => void; onAttach: (file: File) => void; onBack: () => void; onProfile: () => void; onSettings: () => void; onStop: () => void; onResetChat: () => void; onEdit: (id: string, text: string) => void; onReact: (id: string, emoji: string) => void;
}) {
  const scroll = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'auto' }); }, [messages.length, messages.at(-1)?.nodes.length]);
  const nameList = participants.map(student => student.name).join(', ');
  return <main className={`conversation theme-${theme}`}>
    <header className="chat-header"><button className="chat-back" onClick={onBack} aria-label={locale === 'ko' ? '대화 목록으로' : 'Back to conversations'}>‹</button><div className="chat-header-avatars">{participants.slice(0, 3).map(student => <span key={student.id}><BannerImage data={data} owner={student} kind="character" alt={student.name} /></span>)}</div><div className="chat-header-copy"><strong>{participants.length > 1 ? (locale === 'ko' ? `${participants.length}명의 그룹 채팅` : `Group chat · ${participants.length}`) : participants[0]?.name ?? (locale === 'ko' ? '새 대화' : 'New chat')}</strong><small>{nameList || (locale === 'ko' ? '학생을 선택해 대화를 시작하세요' : 'Select students to start chatting')}</small><span className="chat-timeline-label" title={locale === 'en' ? data.timeSlices.find(slice => slice.id === sliceId)?.labelEn ?? data.timeSlices.find(slice => slice.id === sliceId)?.label ?? 'None' : data.timeSlices.find(slice => slice.id === sliceId)?.label ?? '시점 없음'}>{locale === 'en' ? data.timeSlices.find(slice => slice.id === sliceId)?.labelEn ?? data.timeSlices.find(slice => slice.id === sliceId)?.label ?? 'None' : data.timeSlices.find(slice => slice.id === sliceId)?.label ?? '시점 없음'}</span></div><ThemedSelect className="chat-locale-select" ariaLabel="Language / 언어" value={locale} onChange={onLocale} options={[{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }]} /><button className="chat-icon chat-reset-chat" disabled={streaming} aria-label={locale === 'ko' ? '대화 초기화' : 'Reset chat'} title={locale === 'ko' ? '대화 초기화' : 'Reset chat'} onClick={onResetChat}>↻</button><button className="chat-icon" aria-label={locale === 'ko' ? '설정' : 'Settings'} title={locale === 'ko' ? '설정' : 'Settings'} onClick={onSettings}>⚙</button></header>
    <div className="chat-chat" ref={scroll}>
      {(situation.trim() || directorNotes.trim()) && <div className="chat-context">{situation.trim() && <span>▤ {locale === 'ko' ? '상황' : 'Scenario'}: {situation}</span>}{directorNotes.trim() && <span>✎ {locale === 'ko' ? '디렉터 지시 적용 중' : 'Director notes active'}</span>}</div>}
      <div className="chat-date"><span>{locale === 'ko' ? '오늘의 메시지' : 'TODAY'}</span></div>
      {!messages.length && <div className="chat-empty">{participants.length > 1 ? (locale === 'ko' ? '그룹 멤버들과 대화를 시작해 보세요!' : 'Start a group conversation!') : `${participants[0]?.name ?? (locale === 'ko' ? '학생' : 'student')}${locale === 'ko' ? '에게 첫 메시지를 보내 보세요.' : ' — send a first message.'}`}</div>}
      {streaming && !typingMessageId && <div className="chat-row"><span className="chat-avatar" /><div className="chat-message-stack"><div className="chat-bubble"><TypingIndicator locale={locale} onStop={onStop} /></div></div></div>}
      {messages.map((message, index) => {
        const mine = message.speaker === '나' || message.speaker === 'You';
        const previous = messages[index - 1];
        const grouped = previous?.speaker === message.speaker && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
        const student = characters.find(character => character.name === message.speaker || character.id === message.speaker);
        const waiting = streaming && message.id === typingMessageId && !message.nodes.length && !mine;
        return <div className={`chat-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}`} key={message.id}>
          {!mine && <span className="chat-avatar">{student && <BannerImage data={data} owner={student} kind="character" alt={student.name} />}</span>}
          <div className="chat-message-stack">
            {!mine && <span className="chat-name">{message.speaker}</span>}
            <div className={`chat-bubble${mine ? ' own' : ''}`}>
              {waiting ? <TypingIndicator locale={locale} onStop={onStop} /> : message.nodes.map((node, nodeIndex) => <React.Fragment key={nodeIndex}>
                {node.type === 'image' && node.imageDataUrl ? <img className="chat-photo" src={node.imageDataUrl} alt={node.alt ?? 'attached image'} /> : node.type === 'media' && node.asset ? <ImageAsset data={data} assetId={node.asset} /> : node.type === 'lineBreak' ? <br /> : node.type === 'emphasis' ? <em className="chat-narration">{node.text}</em> : node.type === 'strong' ? <strong>{node.text}</strong> : node.text}
              </React.Fragment>)}
              <span className="chat-message-tools">{mine && <button aria-label="Edit message" onClick={() => { const text = message.nodes.map(node => node.text ?? '').join(''); const next = window.prompt(locale === 'ko' ? '메시지를 수정합니다 (화면 연출)' : 'Edit message (visual simulation)', text); if (next !== null) onEdit(message.id, next); }}>✎</button>}<button aria-label="Add reaction" onClick={() => onReact(message.id, '💢')}>☻</button></span>
            </div>
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
