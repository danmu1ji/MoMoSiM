import React from 'react';
import type { Character } from '@world-player/schema';
import type { WorldData } from '@world-player/engine/desktop';
import { BannerImage } from './banner-image';
import { ThemedSelect } from './themed-select';
import { BrandMark } from './brand-mark';
import type { ConversationSummary } from './conversation-store';
import { participantsForConversationId } from './conversation-id';

/** Workspace shell; existing profile, provider, package and group actions remain accessible. */
export function HomeScreen({ notice, data, characters, conversations = [], onOpenChat, onOpenGroupChat, onOpenConversation, activeConversationId, language, onLanguage, onOpenSettings, onEditProfile, onConfig, onLoad, onFile, packageInput, activeChat, activeStudentId, onCloseChat, onResetChat, timeSlices, sliceId, onSliceChange, onTutorial }: {
  notice?: string;
  data: WorldData;
  characters: Character[];
  conversations?: ConversationSummary[];
  onOpenChat: (characterId: string) => void;
  onOpenConversation: (conversationId: string, participantIds: string[]) => void;
  activeConversationId?: string;
  language: string;
  onLanguage: (language: string) => void;
  onOpenGroupChat: () => void;
  onOpenSettings: () => void;
  onEditProfile: () => void;
  onConfig: () => void;
  onLoad: () => void;
  onFile: (file: File) => void;
  packageInput: React.RefObject<HTMLInputElement | null>;
  activeChat?: React.ReactNode;
  activeStudentId?: string;
  onCloseChat: () => void;
  onResetChat: () => void;
  timeSlices: { id: string; label: string; labelEn?: string }[];
  sliceId: string;
  onSliceChange: (sliceId: string) => void;
  onTutorial: () => void;
}) {
  const english = language === 'en';
  const [query, setQuery] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [inboxVisible, setInboxVisible] = React.useState(true);
  const displayName = (character: Character) => english ? character.nameEn ?? character.id.replace(/^character:/, '').replace(/(^|-)([a-z])/g, (_m, p1, p2) => `${p1}${p2.toUpperCase()}`) : character.name;
  const displaySummary = (character: Character) => english ? character.summaryEn ?? '' : character.summary ?? '';
  const directRecency = new Map<string, number>();
  for (const conversation of conversations) {
    const ids = participantsForConversationId(conversation.id);
    if (ids.length === 1) directRecency.set(ids[0], Math.max(directRecency.get(ids[0]) ?? 0, Date.parse(conversation.updatedAt) || 0));
  }
  const filtered = characters.filter(character => [displayName(character), character.id, displaySummary(character), character.tags.join(' ')].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => (directRecency.get(b.id) ?? 0) - (directRecency.get(a.id) ?? 0));
  const groupConversations = conversations.filter(item => participantsForConversationId(item.id).length > 1);
  return <main className="dt-home" id="inbox">
    <header className="dt-header">
      <a className="dt-brand" href="#inbox" aria-label="DanmuTalk home"><BrandMark className="dt-brand-mark" /><span>DanmuTalk</span></a>
      <details className="dt-header-menu">
        <summary className="dt-brand-help" aria-label={english ? 'More options' : '더 보기'} title={english ? 'More options' : '더 보기'}>?</summary>
        <div className="dt-tools">
          <button className="dt-tool" onClick={onEditProfile}><span className="dt-header-icon">♙</span>{english ? 'Profile' : '프로필'}</button>
          <button className="dt-tool" onClick={onLoad}><span className="dt-header-icon">＋</span>{english ? 'Open package' : '패키지 열기'}</button>
          <button className="dt-tool" onClick={onTutorial}><span className="dt-header-icon">?</span>{english ? 'First-launch guide' : '처음 사용 안내'}</button>
        </div>
      </details>
      <div className="dt-header-controls">
        <div className="dt-language-label"><span className="dt-header-icon" aria-hidden="true">文</span><ThemedSelect className="dt-language-select" ariaLabel="Language / 언어" value={language} onChange={onLanguage} options={[{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }]} /></div>
        {activeChat && <div className="dt-language-label"><span className="dt-header-icon" aria-hidden="true">◷</span><ThemedSelect className="dt-language-select dt-time-select" ariaLabel={english ? 'Time slice' : '시점'} value={sliceId} onChange={onSliceChange} options={[{ value: 'none', label: english ? 'None' : '시점 없음' }, ...timeSlices.map(slice => ({ value: slice.id, label: english ? slice.labelEn ?? slice.label : slice.label }))]} /></div>}
        <button type="button" className="dt-tool dt-llm-settings" onClick={onOpenSettings}><span className="dt-header-icon" aria-hidden="true">⚙</span>{english ? 'Settings' : '설정'}</button>
      </div>
      <div className="dt-header-actions">
        {activeChat && <button type="button" className="dt-reset-chat" onClick={onResetChat} aria-label={english ? 'Reset chat' : '대화 초기화'} title={english ? 'Reset chat' : '대화 초기화'}><span aria-hidden="true">↻</span><span>{english ? 'Reset chat' : '대화 초기화'}</span></button>}
        {activeChat && <button type="button" className="dt-window-close" onClick={onCloseChat} aria-label={english ? 'Close conversation' : '대화 닫기'}>×</button>}
      </div>
    </header>
    <div className={`dt-shell${activeChat ? ' has-chat' : ''}${activeChat && !inboxVisible ? ' inbox-hidden' : ''}`}>
      <nav className="dt-rail" aria-label={english ? 'DanmuTalk navigation' : 'DanmuTalk 탐색'}>
        <button type="button" aria-label={english ? 'Profile' : '프로필'} title={english ? 'Profile' : '프로필'} onClick={onEditProfile}><span className="dt-rail-profile" aria-hidden="true">♙</span></button>
        <button type="button" className="active" aria-label={activeChat ? (inboxVisible ? (english ? 'Hide student list' : '학생 목록 숨기기') : (english ? 'Show student list' : '학생 목록 보기')) : (english ? 'Messages' : '메시지')} aria-expanded={activeChat ? inboxVisible : undefined} title={activeChat ? (inboxVisible ? (english ? 'Hide student list' : '학생 목록 숨기기') : (english ? 'Show student list' : '학생 목록 보기')) : (english ? 'Messages' : '메시지')} onClick={() => activeChat ? setInboxVisible(value => !value) : undefined}><span className="dt-rail-chat" aria-hidden="true">•••</span></button>
      </nav>
      <aside className="dt-sidebar" aria-label={english ? 'Student conversations' : '학생 대화 목록'}>
        <div className="dt-sidebar-title"><span>{english ? 'Unread messages (0)' : '안 읽은 메시지 (0)'}</span><button type="button" className="dt-search-toggle" aria-label={english ? 'Search students' : '학생 검색'} aria-expanded={searchOpen} onClick={() => setSearchOpen(value => !value)}>⌕</button><button className="dt-new-chat" onClick={onOpenGroupChat} title={english ? 'New group chat' : '그룹 채팅'}>＋</button></div>
        {searchOpen && <label className="dt-search"><span aria-hidden="true">⌕</span><input aria-label={english ? 'Search students' : '학생 검색'} value={query} onChange={event => setQuery(event.target.value)} placeholder={english ? 'Search students' : '학생 검색'} /></label>}
        <div className="dt-list-label">{english ? `${filtered.length} STUDENTS` : `학생 ${filtered.length}명`}</div>
        <div className="dt-student-list">
          {groupConversations.length > 0 && <div className="dt-list-label dt-group-list-label">{english ? 'GROUP CONVERSATIONS' : '그룹 대화'}</div>}
          {groupConversations.map(({ id: conversationId }) => {
            const ids = participantsForConversationId(conversationId);
            const members = ids.map(id => characters.find(character => character.id === id)).filter((character): character is Character => Boolean(character));
            const title = members.map(displayName).join(', ') || ids.join(', ');
            return <button className={`dt-student-row dt-group-inbox-row${activeConversationId === conversationId ? ' active' : ''}`} key={conversationId} aria-current={activeConversationId === conversationId ? 'true' : undefined} onClick={() => onOpenConversation(conversationId, ids)}>
              <span className="dt-avatar dt-group-inbox-avatars">{members.slice(0, 2).map(character => <span key={character.id}><BannerImage data={data} owner={character} kind="character" alt="" /></span>)}</span>
              <span className="dt-student-copy"><strong>{title}</strong><small>{english ? `${ids.length} students · Group conversation` : `학생 ${ids.length}명 · 그룹 대화`}</small></span>
            </button>;
          })}
          {groupConversations.length > 0 && <div className="dt-list-label dt-contact-list-label">{english ? `${filtered.length} STUDENTS` : `학생 ${filtered.length}명`}</div>}
          {filtered.map(character => <button className={`dt-student-row${activeStudentId === character.id ? ' active' : ''}`} key={character.id} aria-current={activeStudentId === character.id ? 'true' : undefined} onClick={() => onOpenChat(character.id)}>
            <span className="dt-avatar"><BannerImage data={data} owner={character} kind="character" alt={character.name} /></span>
            <span className="dt-student-copy"><strong>{displayName(character)}</strong><small>{displaySummary(character) || (character.tags.slice(0, 2).join(' · ') || (english ? 'No reviewed English profile text yet' : '메시지를 보내 보세요'))}</small></span>
          </button>)}
          {filtered.length === 0 && <p className="dt-empty-list">{english ? 'No matching students.' : '학생을 찾을 수 없습니다.'}</p>}
        </div>
        <button className="dt-sidebar-group" onClick={onOpenGroupChat}><span>✚</span>{english ? 'New group chat' : '그룹 채팅 시작'}</button>
      </aside>
      <section className={`dt-main${activeChat ? ' has-chat' : ''}`}>
        {activeChat ?? <div className="dt-welcome">
          <span className="dt-welcome-mark">✦</span>
          <span className="dt-eyebrow">DANMUTALK · WORLD WORKSPACE</span>
          <h1>{english ? 'Welcome back, Sensei' : '어서 오세요, 선생님'}</h1>
          <p>{english ? 'Your students are waiting to hear from you.' : '학생들에게 메시지를 보내 보세요.'}</p>
          <button className="dt-start-group" onClick={onOpenGroupChat}><span>＋</span>{english ? 'Start a group conversation' : '그룹 대화 시작하기'}</button>
          <div className="dt-home-foot">{english ? 'Every student has something to tell you.' : '오늘은 어떤 이야기를 나눠 볼까요?'}</div>
        </div>}
        {notice ? <p className="home-notice">{notice}</p> : null}
      </section>
    </div>
    <input ref={packageInput} type="file" hidden accept=".😭,.zip,application/zip" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file); }} />
  </main>;
}
