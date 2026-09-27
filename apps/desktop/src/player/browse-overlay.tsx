import React from 'react';
import type { Entity } from '@world-player/schema';
import { LazyAssetImage, LazyAudio } from './lazy-asset';
import type { WorldData } from '@world-player/engine/desktop';
import { charactersInCategory, charactersUnder, documentBody, documentNodes, loadWorldDocuments, resolveMedia, subcategoriesOf, breadcrumbFor } from '@world-player/engine/desktop';
import { BannerImage } from './banner-image';

type Level = { kind: 'subcategories' | 'characters'; categoryId: string } | { kind: 'character'; categoryId: string; characterId: string };
export type CharacterDetailTarget = { kind: 'character'; characterId: string; categoryId: string };

export interface BrowseOverlayProps {
  data: WorldData;
  categoryId?: string;
  characterId?: string;
  language?: string;
  onClose: () => void;
}

/**
 * Floating browse window: category → subcategories → characters → character detail.
 * The left pane scrolls with the mouse wheel and has a back button; the right 30% column shows the
 * banner on the top 30% and the description on the bottom 70%.
 */
export function BrowseOverlay({ data, categoryId, characterId, language = 'ko', onClose }: BrowseOverlayProps) {
  const [level, setLevel] = React.useState<Level>(() => characterId
    ? { kind: 'character', characterId, categoryId: categoryId ?? '' }
    : { kind: 'subcategories', categoryId: categoryId ?? '' });
  const all = React.useMemo(() => [...data.entities.values()], [data]);
  const current = data.entities.get(level.categoryId) ?? (level.kind === 'character' ? data.entities.get(level.characterId) : undefined);
  const subs = React.useMemo(() => subcategoriesOf(all, level.categoryId), [all, level.categoryId]);
  const direct = React.useMemo(() => charactersInCategory(all, level.categoryId) as Entity[], [all, level.categoryId]);
  const nested = React.useMemo(() => subs.flatMap(sub => (charactersInCategory(all, sub.id) as Entity[]).map(character => ({ sub, character }))), [all, subs]);
  const character = level.kind === 'character' ? data.entities.get(level.characterId) : undefined;
  const localizedName = (entity: Entity) => language === 'en' ? entity.nameEn ?? entity.id.replace(/^(character|category|event|location):/, '').replace(/(^|-)([a-z])/g, (_m, p1, p2) => `${p1}${p2.toUpperCase()}`) : entity.name;
  const localizedSummary = (entity: Entity) => language === 'en' ? entity.summaryEn ?? '' : entity.summary ?? '';
  // A category without subcategories shows its characters straight away.
  const kind: Level['kind'] = level.kind === 'subcategories' && subs.length === 0 ? 'characters' : level.kind;
  const trail = breadcrumbFor(all, level.categoryId).map(entity => localizedName(entity)).join(' / ');

  const back = () => {
    if (level.kind === 'character') setLevel({ kind: 'characters', categoryId: level.categoryId });
    else if (level.kind === 'characters' && subs.length > 0) setLevel({ kind: 'subcategories', categoryId: level.categoryId });
    else onClose();
  };

  if (!current) return null;
  const english = language === 'en';
  const characterCount = charactersUnder(all, level.categoryId).length;

  return <div className="overlay dt-settings-overlay" role="dialog" aria-label={character ? localizedName(character) : localizedName(current)}>
    <div className="window dt-settings-window">
      <div className="window-head">
        <button className="chip ghost" onClick={back}>← {english ? 'Back' : '뒤로'}</button>
        <span className="title">{character ? localizedName(character) : localizedName(current)}</span>
        <span className="spacer" />
        <span className="hint">{trail}</span>
      </div>

      {character
        ? <CharacterView data={data} character={character} language={language} />
        : <div className="window-body">
          <div className="pane left">
            <div className="pane-scroll">
              {kind === 'subcategories' ? <>
                <p className="section-label">{english ? 'Subcategories' : '하위 카테고리'}</p>
                {subs.map(sub => <button className="card" key={sub.id} onClick={() => setLevel({ kind: 'characters', categoryId: sub.id })}>
                  <BannerImage data={data} owner={sub} kind="category" />
                  <strong>{localizedName(sub)}</strong>
                  <small>{localizedSummary(sub)}</small>
                </button>)}
              </> : <>
                <p className="section-label">{english ? `STUDENTS · ${characterCount}` : `학생 · ${characterCount}명`}</p>
                {direct.map(item => <CharacterCard key={item.id} data={data} categoryId={level.categoryId} character={item} language={language} onOpen={setLevel} />)}
                {subs.map(sub => <React.Fragment key={sub.id}>
                  <p className="sub-label">{sub.name}</p>
                  {nested.filter(entry => entry.sub.id === sub.id).map(entry => <CharacterCard key={entry.character.id} data={data} categoryId={sub.id} character={entry.character} language={language} onOpen={setLevel} />)}
                </React.Fragment>)}
                {characterCount === 0 && <p className="hint">{english ? 'No students in this category yet.' : '이 카테고리에는 아직 학생이 없습니다.'}</p>}
              </>}
            </div>
          </div>
          <div className="side">
            <div className="side-banner"><BannerImage data={data} owner={current} kind="category" /></div>
            <div className="side-desc">
              <h3>{localizedName(current)}</h3>
              <p>{localizedSummary(current)}</p>
              {kind === 'characters' && <p className="hint">{english ? 'Choose a student to see their profile.' : '학생을 선택하면 프로필을 볼 수 있습니다.'}</p>}
            </div>
          </div>
        </div>}
    </div>
  </div>;
}

/** Renders a world document: text stays readable, media/audio directives become real assets. */
function DocBody({ data, text }: { data: WorldData; text: string }) {
  const nodes = React.useMemo(() => documentNodes(text), [text]);

  return <div className="doc-body">{nodes.map((node, index) => {
    if (node.type === 'lineBreak') return <br key={index} />;
    if (node.type === 'media' || node.type === 'audio') {
      const safe = resolveMedia(data, [node])[0];
      const asset = safe.asset ? data.media.get(safe.asset) : undefined;
      if (!asset) return <span className="media" key={index}>[이미지 없음: {node.asset}]</span>;
      return node.type === 'audio'
        ? <span key={index}><LazyAudio data={data as never} assetId={asset.id} /><span className="voice-label">{asset.description}</span></span>
        : <LazyAssetImage key={index} data={data as never} assetId={asset.id} alt={asset.description} className="doc-image" />;
    }
    return <pre className="doc-text" key={index}>{node.text}</pre>;
  })}</div>;
}

function CharacterCard({ data, categoryId, character, language, onOpen }: { data: WorldData; categoryId: string; character: Entity; language: string; onOpen: (level: Level) => void }) {
  const name = language === 'en' ? character.nameEn ?? character.id.replace(/^character:/, '') : character.name;
  const summary = language === 'en' ? character.summaryEn ?? '' : character.summary ?? character.id;
  return <button className="card" onClick={() => onOpen({ kind: 'character', categoryId, characterId: character.id })}>
    <BannerImage data={data} owner={character} kind="character" />
    <strong>{name}</strong>
    <small>{summary}</small>
  </button>;
}

/** Character detail: description on the left 70%, banner in the right 30%. */
function CharacterView({ data, character, language }: { data: WorldData; character: Entity; language: string }) {
  const english = language === 'en';
  const path = character.markdown ? (language === 'en' ? `locales/en/${character.markdown}` : character.markdown) : undefined;
  const [document, setDocument] = React.useState(() => documentBody(data, path));
  React.useEffect(() => {
    let cancelled = false;
    setDocument(documentBody(data, path));
    if (path && !data.loadedDocuments?.has(path)) {
      void loadWorldDocuments(data, [path]).then(() => { if (!cancelled) setDocument(documentBody(data, path)); });
    }
    return () => { cancelled = true; };
  }, [data, path]);
  const name = language === 'en' ? character.nameEn ?? character.id.replace(/^character:/, '') : character.name;
  const summary = language === 'en' ? character.summaryEn ?? '' : character.summary ?? '';
  return <div className="character-view">
    <div className="doc">
      <h2>{name}</h2>
      <p className="hint">{summary}</p>
      <DocBody data={data} text={document || (english ? 'No reviewed English text is available for this profile yet.' : '아직 설명이 없습니다.')} />
    </div>
    <div className="side">
      <div className="side-banner"><BannerImage data={data} owner={character} kind="character" /></div>
      <div className="side-desc">
        <p className="section-label">{english ? 'STUDENT' : '학생'}</p>
        <h3>{name}</h3>
        <p>{language === 'en' ? character.categories?.map(id => data.entities.get(id)?.nameEn ?? '').filter(Boolean).join(', ') : character.tags.join(', ') || '—'}</p>
      </div>
    </div>
  </div>;
}
