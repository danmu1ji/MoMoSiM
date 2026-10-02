import React from 'react';
import type { ChatNode, Character } from '@world-player/schema';
import type { WorldData } from '@world-player/engine/desktop';
import { BannerImage } from './banner-image';
import { LazyAssetImage } from './lazy-asset';
import { ThemedSelect } from './themed-select';
import { messageText, searchMessages } from './chat-tools';
import { TranscriptExport } from './transcript-export';
import { loadBookmarks, saveBookmarks } from './message-bookmarks';
import { MAX_DRAFT_LENGTH } from './conversation-draft';

export interface ConversationMessage { id: string; speaker: string; nodes: ChatNode[]; createdAt: string; edited: boolean; reactions: Record<string, string[]> }

export function ConversationView({ data, characters, participants, messages, input, streaming, typingMessageId, theme, locale, situation, directorNotes, activeStudentId, sliceId, crossChatEnabled, onCrossChatEnabled, onTheme, onLocale, onSituation, onDirectorNotes, onInput, onSend, onAttach, onBack, onProfile, onSettings, onStop, onResetChat, onEdit, onReact, pendingImages, onRemovePendingImage, bookmarkStorageKey, onContinue }: {
  data: WorldData; characters: Character[]; participants: Character[]; messages: ConversationMessage[]; input: string; streaming: boolean; typingMessageId?: string; theme: string; locale: string; situation: string; directorNotes: string; pendingImages: ChatNode[]; activeStudentId?: string; sliceId: string; crossChatEnabled: boolean;
  onTheme: (theme: string) => void; onLocale: (locale: string) => void; onSituation: (value: string) => void; onDirectorNotes: (value: string) => void; onCrossChatEnabled: (enabled: boolean) => void; onRemovePendingImage: (index: number) => void; onInput: (text: string) => void; onSend: () => void; onAttach: (file: File) => void; onBack: () => void; onProfile: () => void; onSettings: () => void; onStop: () => void; onResetChat: () => void; onEdit: (id: string, text: string) => void; onReact: (id: string, emoji: string) => void;
  bookmarkStorageKey: string; onContinue: () => void;
}) {
  const scroll = React.useRef<HTMLDivElement>(null);
  const composer = React.useRef<HTMLTextAreaElement>(null);
  const followLatest = React.useRef(true);
  const [query, setQuery] = React.useState('');
  const deferredQuery = React.useDeferredValue(query);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [bookmarks, setBookmarks] = React.useState(() => loadBookmarks(bookmarkStorageKey));
  const [savedOnly, setSavedOnly] = React.useState(false);
  const visibleMessages = React.useMemo(() => searchMessages(savedOnly ? messages.filter(message => bookmarks.has(message.id)) : messages, deferredQuery), [messages, bookmarks, savedOnly, deferredQuery]);
  const characterBySpeaker = React.useMemo(() => new Map(characters.flatMap(character => [[character.id, character], [character.name, character]])), [characters]);
  const timeline = data.timeSlices.find(slice => slice.id === sliceId);
  const timelineLabel = locale === 'en' ? timeline?.labelEn ?? timeline?.label ?? 'None' : timeline?.label ?? '시점 없음';
  const filtering = Boolean(query.trim() || savedOnly);
  const toggleBookmark = (id: string) => {
    const next = new Set(bookmarks);
    if (next.has(id)) next.delete(id);
    else { if (next.size >= 1000) next.delete(next.values().next().value!); next.add(id); }
    saveBookmarks(bookmarkStorageKey, next);
    setBookmarks(next);
  };
  const quoteMessage = (message: ConversationMessage) => {
    const quote = messageText(message.nodes).slice(0, 2000).split('\n').map(line => `> ${line}`).join('\n');
    onInput(`> ${message.speaker}\n${quote}\n\n${input}`.slice(0, MAX_DRAFT_LENGTH));
    composer.current?.focus();
  };
  React.useEffect(() => {
    if (followLatest.current && !filtering) scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'auto' });
  }, [messages, filtering]);
  const nameList = participants.map(student => student.name).join(', ');
  return <main className={`conversation conversation-view theme-${theme}`}>
    <header className="chat-header"><button className="chat-back" onClick={onBack} aria-label={locale === 'ko' ? '대화 목록으로' : 'Back to conversations'}>‹</button><div className="chat-header-avatars">{participants.slice(0, 3).map(student => <span key={student.id}><BannerImage data={data} owner={student} kind="character" alt={student.name} /></span>)}</div><div className="chat-header-copy"><strong>{participants.length > 1 ? (locale === 'ko' ? `${participants.length}명의 그룹 채팅` : `Group chat · ${participants.length}`) : participants[0]?.name ?? (locale === 'ko' ? '새 대화' : 'New chat')}</strong><small>{nameList || (locale === 'ko' ? '학생을 선택해 대화를 시작하세요' : 'Select students to start chatting')}</small><span className="chat-timeline-label" title={locale === 'en' ? data.timeSlices.find(slice => slice.id === sliceId)?.labelEn ?? data.timeSlices.find(slice => slice.id === sliceId)?.label ?? 'None' : data.timeSlices.find(slice => slice.id === sliceId)?.label ?? '시점 없음'}>{locale === 'en' ? data.timeSlices.find(slice => slice.id === sliceId)?.labelEn ?? data.timeSlices.find(slice => slice.id === sliceId)?.label ?? 'None' : data.timeSlices.find(slice => slice.id === sliceId)?.label ?? '시점 없음'}</span></div><label className="chat-cross-chat" title={locale === 'ko' ? '켜면 최근 대화 텍스트가 설정된 모델 제공자에게 전달되어 후속 연락을 정하고, 공유 문맥과 예약은 이 기기에 최대 7일 저장됩니다. 끄면 공유 문맥과 예약 연락을 삭제합니다.' : 'When enabled, recent chat text is sent to your configured model provider to plan follow-ups. Shared context and queued messages are stored on this device for up to 7 days. Turning it off clears them.'}><input type="checkbox" aria-label={locale === 'ko' ? '다른 채팅 후속 연락을 켭니다. 최근 대화 텍스트를 모델 제공자에게 보내고 이 기기에 최대 7일 저장합니다.' : 'Enable cross-chat follow-ups. Recent chat text is sent to your model provider and stored on this device for up to 7 days.'} checked={crossChatEnabled} onChange={event => onCrossChatEnabled(event.target.checked)} /><span>{locale === 'ko' ? '다른 채팅 후속 연락' : 'Cross-chat follow-ups'}</span></label><ThemedSelect className="chat-locale-select" ariaLabel="Language / 언어" value={locale} onChange={onLocale} options={[{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }]} /><button className="chat-icon chat-reset-chat" disabled={streaming} aria-label={locale === 'ko' ? '대화 초기화' : 'Reset chat'} title={locale === 'ko' ? '대화 초기화' : 'Reset chat'} onClick={onResetChat}>↻</button><button className="chat-icon" aria-label={locale === 'ko' ? '설정' : 'Settings'} title={locale === 'ko' ? '설정' : 'Settings'} onClick={onSettings}>⚙</button></header>
    <div className="chat-toolbar"><input type="search" value={query} onChange={event => setQuery(event.target.value)} aria-label={locale === 'ko' ? '대화 메시지 검색' : 'Search conversation messages'} placeholder={locale === 'ko' ? '메시지 검색…' : 'Search messages…'} /><span role="status">{filtering ? (locale === 'ko' ? `${visibleMessages.length}개 메시지` : `${visibleMessages.length} messages`) : ''}</span><button type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly(value => !value)}>{locale === 'ko' ? '★ 저장됨' : '★ Saved'}</button><button type="button" disabled={!messages.length} onClick={() => setExportOpen(true)}>{locale === 'ko' ? '내보내기' : 'Export'}</button><button type="button" disabled={streaming || !messages.length || !participants.length} onClick={onContinue}>{locale === 'ko' ? '대화 이어가기' : 'Continue conversation'}</button></div>
    {exportOpen && <TranscriptExport world={data.world.name} timeline={timelineLabel} messages={messages} locale={locale} onClose={() => setExportOpen(false)} />}
    <div className="chat-chat" ref={scroll} onScroll={() => { const element = scroll.current; if (element) followLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
      {(situation.trim() || directorNotes.trim()) && <div className="chat-context">{situation.trim() && <span>▤ {locale === 'ko' ? '상황' : 'Scenario'}: {situation}</span>}{directorNotes.trim() && <span>✎ {locale === 'ko' ? '디렉터 지시 적용 중' : 'Director notes active'}</span>}</div>}
      <div className="chat-date"><span>{locale === 'ko' ? '오늘의 메시지' : 'TODAY'}</span></div>
      {!messages.length && <div className="chat-empty">{participants.length > 1 ? (locale === 'ko' ? '그룹 멤버들과 대화를 시작해 보세요!' : 'Start a group conversation!') : `${participants[0]?.name ?? (locale === 'ko' ? '학생' : 'student')}${locale === 'ko' ? '에게 첫 메시지를 보내 보세요.' : ' — send a first message.'}`}</div>}
      {streaming && !typingMessageId && <div className="chat-row"><span className="chat-avatar" /><div className="chat-message-stack"><div className="chat-bubble"><TypingIndicator locale={locale} onStop={onStop} /></div></div></div>}
      {filtering && !visibleMessages.length && <p className="chat-empty">{locale === 'ko' ? '일치하는 메시지가 없습니다.' : 'No matching messages.'}</p>}
      {visibleMessages.map((message, index) => {
        const mine = message.speaker === '나' || message.speaker === 'You';
        const previous = visibleMessages[index - 1];
        const grouped = previous?.speaker === message.speaker && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
        const student = characterBySpeaker.get(message.speaker);
        const waiting = streaming && message.id === typingMessageId && !message.nodes.length && !mine;
        return <div className={`chat-row${mine ? ' mine' : ''}${grouped ? ' grouped' : ''}${bookmarks.has(message.id) ? ' bookmarked' : ''}`} key={message.id}>
          {!mine && <span className="chat-avatar">{student && <BannerImage data={data} owner={student} kind="character" alt={student.name} />}</span>}
          <div className="chat-message-stack">
            {!mine && <span className="chat-name">{message.speaker}</span>}
            <div className={`chat-bubble${mine ? ' own' : ''}`}>
              {waiting ? <TypingIndicator locale={locale} onStop={onStop} /> : message.nodes.map((node, nodeIndex) => <React.Fragment key={nodeIndex}>
                {node.type === 'image' && node.imageDataUrl ? <img className="chat-photo" src={node.imageDataUrl} alt={node.alt ?? 'attached image'} /> : node.type === 'media' && node.asset ? <ImageAsset data={data} assetId={node.asset} /> : node.type === 'lineBreak' ? <br /> : node.type === 'emphasis' ? <em className="chat-narration">{node.text}</em> : node.type === 'strong' ? <strong>{node.text}</strong> : node.text}
              </React.Fragment>)}
              <span className="chat-message-tools" role="group" aria-label={locale === 'ko' ? `${message.speaker} 메시지 작업` : `${message.speaker} message actions`}>{mine && <button type="button" aria-label={locale === 'ko' ? '메시지 수정' : 'Edit message'} title={locale === 'ko' ? '메시지 수정' : 'Edit message'} onClick={() => { const text = message.nodes.map(node => node.text ?? '').join(''); const next = window.prompt(locale === 'ko' ? '메시지를 수정합니다 (화면 연출)' : 'Edit message (visual simulation)', text); if (next !== null) onEdit(message.id, next); }}>✎</button>}<button type="button" aria-label={locale === 'ko' ? '💢 반응 추가' : 'Add 💢 reaction'} title={locale === 'ko' ? '반응 추가' : 'Add reaction'} onClick={() => onReact(message.id, '💢')}>☻</button><button type="button" disabled={streaming || !message.nodes.length} aria-label={locale === 'ko' ? '이 메시지에 답장' : 'Reply to this message'} onClick={() => quoteMessage(message)}>↩</button><button type="button" disabled={!message.nodes.length} aria-pressed={bookmarks.has(message.id)} aria-label={locale === 'ko' ? '메시지 북마크' : 'Bookmark message'} onClick={() => toggleBookmark(message.id)}>{bookmarks.has(message.id) ? '★' : '☆'}</button></span>
            </div>
            <div className="chat-meta">{new Date(message.createdAt).toLocaleTimeString(locale === 'ko' ? 'ko-KR' : 'en-US', { hour: '2-digit', minute: '2-digit' })}{message.edited ? (locale === 'ko' ? ' · 수정됨' : ' · edited') : ''}</div>
            {Object.entries(message.reactions).map(([emoji, users]) => <button type="button" className="chat-reaction" key={emoji} aria-label={locale === 'ko' ? `${emoji} 반응 ${users.length}개` : `${emoji} reaction, ${users.length}`} onClick={() => onReact(message.id, emoji)}>{emoji} {users.length}</button>)}
          </div>
        </div>;
      })}
    </div>
    {pendingImages.length > 0 && <div className="chat-pending-images">{pendingImages.map((image, index) => <span key={index}><img src={image.imageDataUrl} alt={image.alt ?? (locale === 'ko' ? '첨부한 사진' : 'attached photo')} /><button type="button" aria-label={locale === 'ko' ? '첨부한 사진 삭제' : 'Remove attached image'} onClick={() => onRemovePendingImage(index)}>×</button></span>)}</div>}
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); followLatest.current = true; onSend(); }}><label className="chat-attach" title={locale === 'ko' ? '사진을 첨부해 질문하기' : 'Attach a photo'}>＋<input disabled={streaming} aria-label={locale === 'ko' ? '사진 첨부' : 'Attach image'} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onAttach(file); }} /></label><textarea ref={composer} rows={2} maxLength={MAX_DRAFT_LENGTH} value={input} onChange={event => onInput(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && !window.matchMedia('(pointer: coarse)').matches) {
        event.preventDefault(); if (!streaming) { followLatest.current = true; onSend(); }
      }
    }} placeholder={locale === 'ko' ? '메시지 입력 · Shift+Enter로 줄 바꿈' : 'Write a message · Shift+Enter for a new line'} aria-label={locale === 'ko' ? '메시지 입력' : 'Message'} /><button className="chat-send" type="submit" disabled={streaming || (!input.trim() && !pendingImages.length)}>{locale === 'ko' ? '전송' : 'Send'}</button></form>
  </main>;
}
function TypingIndicator({ locale, onStop }: { locale: string; onStop: () => void }) {
  return <span className="chat-typing-inline" role="status" aria-label={locale === 'ko' ? '입력 중' : 'Typing'}><span className="chat-typing-dots" aria-hidden="true"><i /><i /><i /></span><button type="button" onClick={onStop}>{locale === 'ko' ? '중지' : 'Stop'}</button></span>;
}
function ImageAsset({ data, assetId }: { data: WorldData; assetId: string }) { const asset = data.media.get(assetId); return asset ? <LazyAssetImage data={data} assetId={assetId} alt={asset.description} className="chat-photo" /> : null; }
