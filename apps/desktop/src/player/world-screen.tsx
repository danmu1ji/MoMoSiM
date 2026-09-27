import React from 'react';
import type { Entity } from '@world-player/schema';
import type { WorldData } from '@world-player/engine/desktop';
import { categoryRoots } from '@world-player/engine/desktop';
import { BannerImage } from './banner-image';
import { LazyAssetImage } from './lazy-asset';

export interface WorldScreenProps {
  data: WorldData;
  language?: string;
  onOpenCategory: (categoryId: string) => void;
  onOpenChat: () => void;
  onEditProfile: () => void;
  onConfig: () => void;
  onSwitchWorld: () => void;
}

/** Player-facing world screen: banner + description, then the scrollable category rail, then chat. */
export function WorldScreen({ data, language = 'ko', onOpenCategory, onOpenChat, onEditProfile, onConfig, onSwitchWorld }: WorldScreenProps) {
  const english = language === 'en';
  const displayName = (entity: Entity) => english ? entity.nameEn ?? entity.id.replace(/^category:/, '').replace(/(^|-)([a-z])/g, (_m, p1, p2) => `${p1}${p2.toUpperCase()}`) : entity.name;
  const displaySummary = (entity: Entity) => english ? entity.summaryEn ?? '' : entity.summary ?? '';

  const roots = React.useMemo(() => categoryRoots([...data.entities.values()]), [data]);
  const track = React.useRef<HTMLDivElement>(null);
  const scrollRail = (direction: -1 | 1) => { const node = track.current; if (node) node.scrollBy({ left: direction * Math.max(280, node.clientWidth * 0.8), behavior: 'smooth' }); };
  const onWheel = (event: React.WheelEvent) => { const node = track.current; if (!node) return; if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) { node.scrollLeft += event.deltaY; event.preventDefault(); } };
  const characters = [...data.entities.values()].filter((entity: Entity) => entity.type === 'character').length;

  return <div className="screen">
    <header className="topbar">
      <button className="chip ghost" onClick={onSwitchWorld}>{english ? 'Back to DanmuTalk' : 'DanmuTalk으로'}</button>
      <span className="spacer" />
      <button className="chip" onClick={onEditProfile}>{english ? 'Profile' : '프로필'}</button>
      <button className="chip" onClick={onConfig}>{english ? 'Settings' : '설정'}</button>
    </header>

    <div className="world-body">
      <section className="world-head">
        <BannerImage data={data} owner={data.world} kind="world" className="world-banner" />
        <div className="world-desc">
          <h1 className="world-name">{english ? data.world.nameEn ?? 'Blue Archive' : data.world.name}</h1>
          <p className="world-summary">{english ? data.world.summaryEn ?? 'A school city of Kivotos.' : data.world.summary}</p>
        </div>
      </section>

      <section>
        <p className="section-label">{english ? 'SCHOOLS' : '학교'}</p>
        <div className="rail">
          <button className="rail-arrow" aria-label="이전 카테고리" onClick={() => scrollRail(-1)}>‹</button>
          <div className="rail-track" ref={track} onWheel={onWheel}>
            {roots.map(root => <button className="card" key={root.id} onClick={() => onOpenCategory(root.id)}>
              <BannerImage data={data} owner={root} kind="category" />
              <strong>{displayName(root)}</strong>
              <small>{displaySummary(root) || (english ? 'No official English description yet' : root.id)}</small>
            </button>)}
            {roots.length === 0 && <p className="hint">{english ? 'No schools found.' : '등록된 학원이 없습니다.'}</p>}
          </div>
          <button className="rail-arrow" aria-label="다음 카테고리" onClick={() => scrollRail(1)}>›</button>
        </div>
      </section>
    </div>

    <div className="world-foot">
      <button className="primary" onClick={onOpenChat} disabled={characters === 0}>{english ? 'New group chat' : '그룹 채팅 시작'}</button>
    </div>
  </div>;
}
