export type EntityType = 'world' | 'category' | 'character' | 'location' | 'event';
export type KnowledgeLevel = 'full' | 'partial' | 'public' | 'hidden' | 'unknown';
export type MediaKind = 'profile' | 'portrait' | 'sprite' | 'background' | 'expression' | 'illustration' | 'audio';

export interface Theme { mode?: 'custom'; colors?: { primary: string; secondary: string; accent: string }; assets?: { logo?: string } }
export interface WorldManifest { schemaVersion: string; id: string; name: string; version: string; entry: string; }
export interface World { id: string; name: string; nameEn?: string; version: string; summary: string; summaryEn?: string; theme?: Theme; banner?: string; entrypoints: string[]; tags: string[]   /** 세계관 수준 지식 규칙: 모든 캐릭터가 공유하는 '무엇을 알 수 있는가'(시간창 포함). */
  knowledge?: KnowledgeRule[];
}
export interface Entity { id: string; type: EntityType; name: string; nameEn?: string; summary?: string; summaryEn?: string; markdown?: string; banner?: string; tags: string[]; relations: Relation[]; categories?: string[] }
export interface Relation { type: string; target: string }
export interface Category extends Entity { type: 'category'; parent?: string }
export interface Character extends Entity {
  type: 'character';
  personality?: MarkdownRef;
  speech?: MarkdownRef;
  knowledge?: KnowledgeRule[];
  states?: string[];
  prompt?: MarkdownRef;
  /** 대화 말풍선 상단에 넣는 사진(미디어 id). 프로필(`banner`)과 별개로 설정할 수 있다. */
  chatImage?: string;
  /** 말풍선 상단에 재생 버튼으로 넣는 기본 음성(미디어 id). 선택사항 — 없으면 음성 없이 표시된다. */
  voice?: string;
  personalityEn?: MarkdownRef;
  speechEn?: MarkdownRef;
  promptEn?: MarkdownRef;
  markdownEn?: string;
}
export interface MarkdownRef { markdown: string }
export interface KnowledgeRule { target: string; access: KnowledgeLevel; condition?: KnowledgeCondition }
/**
 * 시간창 조건 — 스토리는 **자기 장(chapter) 구간에서만** 보인다.
 *
 * 예: Vol.3 1장을 선택하면 Vol.1·Vol.2의 메인/그룹/미니/이벤트 스토리는 fog 밖(unknown)이고,
 * Vol.3 1장에 속한 스토리만 보인다. 위치는 타임라인 슬라이스의 position(정렬 가능한 숫자)이다.
 */
export interface KnowledgeCondition {
  timeSlice?: string;
  fromPosition?: number;
  untilPosition?: number;
  location?: string;
  relation?: string;
  faction?: string;
  role?: string;
  event?: string;
  visibility?: string;
}
export interface KnowledgeProjection { entity: Entity; level: KnowledgeLevel; summary?: string; document?: string }
export interface TimeSlice { id: string; label: string; labelEn?: string; position: number }
export interface CharacterState { id: string; character: string; validFrom?: string; validUntil?: string; priority: number; personality?: MarkdownRef; speech?: MarkdownRef; knowledge?: KnowledgeRule[]; appearance?: string; conditions?: { situation?: string } }
export interface MediaAsset { id: string; file: string; kind: MediaKind; description: string; tags: string[]; validStates?: string[]; validSituations?: string[] }
export interface PlayerProfile { name: string; description: string; tags: string[] }
export interface Conversation { id: string; world: string; timeSlice: string; participants: string[]; location?: string; currentEvent?: string; recentSpeakers?: string[]; player: PlayerProfile; provider?: { id: string; model: string } }
export type Speaker = { type: 'player' | 'character'; id: string };
export type ChatNode = { type: 'text' | 'emphasis' | 'strong' | 'media' | 'audio' | 'lineBreak' | 'image'; text?: string; asset?: string; imageDataUrl?: string; alt?: string };
export interface ChatMessage { id: string; speaker: Speaker; content: ChatNode[]; timestamp: string }
export interface ValidationIssue { level: 'error' | 'warning'; code: string; message: string; entity?: string }
