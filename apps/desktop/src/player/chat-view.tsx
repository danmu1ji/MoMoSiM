import React from 'react';
import type { ChatNode } from '@world-player/schema';
import type { WorldData } from '@world-player/engine/desktop';
import { presentMessage, resolveMedia } from '@world-player/engine/desktop';
import { LazyAssetImage, LazyAudio } from './lazy-asset';

export interface ChatMessageView { speaker: string; nodes: ChatNode[] }

export function ChatView({ data, title, messages, input, streaming, onChangeInput, onSend, onBack, stateId, situation, onStop }: {
  data: WorldData;
  title: string;
  messages: ChatMessageView[];
  input: string;
  streaming: boolean;
  onChangeInput: (value: string) => void;
  onSend: () => void;
  onBack: () => void;
  stateId?: string;
  situation?: string;
  /** 진행 중인 대화 사이클을 멈춘다. */
  onStop?: () => void;
}) {
  return <div className="screen">
    <header className="topbar">
      <button className="chip ghost" onClick={onBack}>← 나가기</button>
      <span>{title}</span>
      <span className="spacer" />
      {streaming ? <span className="hint">응답 생성 중…</span> : null}
    </header>
    <div className="chat-body">
      {messages.map((message, index) => {
        const mine = message.speaker === '나';
        // 말풍선 상단(사진·음성)은 캐릭터 발화에만 붙는다. 지시문 위치와 무관하게 항상 맨 위로 올린다.
        const presented = presentMessage({ data, speakerId: mine ? undefined : message.speaker, nodes: message.nodes });
        return <div className={`bubble${mine ? ' mine' : ''}`} key={`${message.speaker}-${index}`}>
          <div className="who">{message.speaker}</div>
          {!mine && (presented.image || presented.audio.length > 0) && <div className="bubble-head">
            {presented.image && <BubbleImage data={data} assetId={presented.image} state={stateId} situation={situation} />}
            {presented.audio.map(assetId => <AudioButton key={assetId} data={data} assetId={assetId} />)}
          </div>}
          <div className="bubble-text">{presented.text.map((node, nodeIndex) => <React.Fragment key={nodeIndex}>
            {node.type === 'lineBreak' ? <br /> : node.type === 'emphasis' ? <em className="chat-narration">{node.text}</em> : node.type === 'strong' ? <strong>{node.text}</strong> : node.text}
          </React.Fragment>)}</div>
        </div>;
      })}
      {messages.length === 0 && <p className="hint">메시지를 보내면 누가 답할지, 언제 끝낼지를 캐릭터들이 스스로 정합니다.</p>}
    </div>
    {streaming && <div className="continue-bar">
      <span className="hint">캐릭터들이 대화를 이어가는 중 — 다음 화자와 끝낼 시점은 캐릭터가 정합니다.</span>
      <button className="chip" onClick={onStop}>멈추기</button>
    </div>}
    <div className="composer">
      <input value={input} onChange={event => onChangeInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') onSend(); }} placeholder={streaming ? '응답 생성 중…' : '메시지를 입력하세요'} />
      <button className="primary" onClick={onSend} disabled={streaming}>전송</button>
    </div>
  </div>;
}

/** 말풍선 최상단 사진. 화면에 보일 때만 읽는다(지연 로딩). */
function BubbleImage({ data, assetId, state, situation }: { data: WorldData; assetId: string; state?: string; situation?: string }) {
  const safe = resolveMedia(data, [{ type: 'media', asset: assetId }], state, situation)[0];
  const asset = safe.asset ?? undefined;
  if (!asset) return null;
  return <LazyAssetImage data={data as never} assetId={asset} alt={data.media.get(asset)?.description ?? ''} className="bubble-image" />;
}

/** 말풍선 최상단 재생 버튼(선택). 누를 때만 음성을 읽는다. */
function AudioButton({ data, assetId }: { data: WorldData; assetId: string }) {
  const asset = data.media.get(assetId);
  if (!asset) return null;
  return <div className="bubble-voice">
    <LazyAudio data={data as never} assetId={assetId} autoPlay />
    <span className="voice-label" title={asset.description}>{asset.description}</span>
  </div>;
}

