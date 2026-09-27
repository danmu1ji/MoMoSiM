import React from 'react';
import type { Character } from '@world-player/schema';
import type { WorldData } from '@world-player/engine/desktop';
import { BannerImage } from './banner-image';
import { ThemedSelect } from './themed-select';
import { defaultContextMode, type ConversationContextMode } from './conversation-store';

export interface ChatOverlayProps {
  data: WorldData;
  characters: Character[];
  selected: string[];
  sliceId: string;
  language?: string;
  onToggle: (characterId: string) => void;
  onToggleFolder: (characterIds: string[], next: boolean) => void;
  onSlice: (sliceId: string) => void;
  onStart: (mode: ConversationContextMode) => void;
  onClose: () => void;
  onOpenProfile?: (characterId: string) => void;
}

/** Full-screen group chat picker: students only, searchable, multi-select and timeline remains adjustable. */
export function ChatOverlay({ data, characters, selected, sliceId, language = 'ko', onToggle, onToggleFolder, onSlice, onStart, onClose, onOpenProfile }: ChatOverlayProps) {
  const [query, setQuery] = React.useState('');
  const [contextConfirmOpen, setContextConfirmOpen] = React.useState(false);
  const english = language === 'en';
  const compactMode = defaultContextMode(selected.length);
  const start = (mode: ConversationContextMode) => { setContextConfirmOpen(false); onStart(mode); };
  const requestStart = () => {
    if (selected.length >= 30) setContextConfirmOpen(true);
    else start(compactMode);
  };
  const searching = query.trim().length > 0;
  const matches = React.useCallback((character: Character) => {
    if (!searching) return true;
    const needle = query.trim().toLocaleLowerCase();
    return [character.nameEn, character.name, character.id, character.summaryEn, character.summary ?? '', character.tags.join(' ')].join(' ').toLocaleLowerCase().includes(needle);
  }, [query, searching]);
  const displayName = (character: Character) => english ? character.nameEn ?? character.id.replace(/^character:/, '').replace(/(^|-)([a-z])/g, (_m, p1, p2) => `${p1}${p2.toUpperCase()}`) : character.name;
  const shown = React.useCallback((list: Character[]) => list.filter(matches), [matches]);
  const hitCount = React.useMemo(() => characters.filter(matches).length, [characters, matches]);

  return <div className="overlay dt-group-overlay" role="dialog" aria-label={english ? 'New group chat' : '그룹 채팅 만들기'}>
    <div className="window dt-group-window">
      <header className="dt-group-header"><button className="dt-back" onClick={onClose} aria-label={english ? 'Close' : '닫기'}>×</button><div className="dt-group-heading"><strong>{english ? 'New group chat' : '그룹 채팅 만들기'}</strong><small>{english ? `${selected.length} students selected` : `학생 ${selected.length}명 선택됨`}</small></div><span className="dt-grow" /><button className="dt-text-button" onClick={() => onToggleFolder(characters.map(character => character.id), selected.length !== characters.length)}>{characters.length > 0 && selected.length === characters.length ? (english ? 'Clear' : '전체 해제') : (english ? 'Select all' : '전체 선택')}</button></header>
      <div className="dt-group-tools"><label className="dt-search"><span aria-hidden="true">⌕</span><input className="dt-group-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={english ? 'Search students' : '학생 검색'} aria-label={english ? 'Search students' : '학생 검색'} /></label><span>{searching ? `${hitCount} / ` : ''}{english ? 'STUDENTS' : '학생'}</span></div>
      <div className="dt-group-students" role="group" aria-label={english ? 'Students' : '학생 목록'}>
        {shown(characters).map(character => <button type="button" className={`dt-group-student${selected.includes(character.id) ? ' selected' : ''}`} key={character.id} aria-pressed={selected.includes(character.id)} onClick={() => onToggle(character.id)} onContextMenu={event => { if (onOpenProfile) { event.preventDefault(); onOpenProfile(character.id); } }}><span className="dt-group-avatar"><BannerImage data={data} owner={character} kind="character" alt={character.name} /></span><strong>{displayName(character)}</strong></button>)}
        {searching && hitCount === 0 && <p className="dt-group-empty">{english ? 'No matching students.' : '학생을 찾을 수 없습니다.'}</p>}
      </div>
      <footer className="dt-group-footer"><label className="dt-timeline"><span>{english ? 'TIME SLICE' : '시점'}</span><ThemedSelect className="timeline-select" align="start" value={sliceId} onChange={onSlice} ariaLabel={english ? 'Time slice' : '시점'} options={[{ value: '', label: english ? 'Choose a timeline…' : '시점을 선택하세요…' }, { value: 'none', label: english ? 'None' : '시점 없음' }, ...data.timeSlices.map(slice => ({ value: slice.id, label: english ? slice.labelEn ?? slice.label : slice.label }))]} /></label><span className="dt-grow" /><button className="dt-group-start" disabled={!selected.length || !sliceId} onClick={requestStart}>{english ? `Start chat · ${selected.length}` : `대화 시작 · ${selected.length}명`}</button></footer>
    </div>
    {contextConfirmOpen && <div className="overlay dt-context-overlay" role="alertdialog" aria-modal="true" aria-labelledby="dt-context-title" onMouseDown={event => { if (event.target === event.currentTarget) setContextConfirmOpen(false); }}>
      <section className="dt-context-dialog">
        <span className="dt-context-badge">{compactMode === 'high' ? (english ? 'HIGH RISK' : '높은 위험') : (english ? 'MEDIUM RISK' : '중간 위험')}</span>
        <h2 id="dt-context-title">{english ? 'Large group context' : '대규모 그룹 문맥 안내'}</h2>
        <p>{english ? (compactMode === 'high' ? 'This 60+ student chat will compact the roster and related world notes, and trim older prompt history to relevant turns. Some details may be omitted.' : 'This 30+ student chat will select the most relevant students and world notes. Some details may be omitted.') : (compactMode === 'high' ? '학생 60명 이상 대화에는 참가자·관련 세계관 정보 선별과 오래된 대화 기록 축약이 적용됩니다. 일부 세부 정보가 빠질 수 있습니다.' : '학생 30명 이상 대화에는 관련성이 높은 참가자와 세계관 정보 선별이 적용됩니다. 일부 세부 정보가 빠질 수 있습니다.')}</p>
        <p>{english ? 'This is a group-size heuristic. If your model has a large context window (such as 1M tokens), you can keep the full context instead.' : '그룹 크기에 따른 기준입니다. 모델의 문맥 한도가 1M 토큰처럼 넉넉하다면 전체 문맥을 그대로 사용할 수 있습니다.'}</p>
        <div className="dt-context-actions"><button type="button" className="dt-context-cancel" onClick={() => setContextConfirmOpen(false)}>{english ? 'Go back' : '돌아가기'}</button><button type="button" className="dt-context-compact" onClick={() => start(compactMode)}>{english ? 'Start with compaction' : '압축하여 시작'}</button><button type="button" className="dt-context-full-button" onClick={() => start('full')}>{english ? 'Use full precision' : '전체 문맥으로 시작'}</button></div>
      </section>
    </div>}
  </div>;
}
