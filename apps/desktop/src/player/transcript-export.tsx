import React from 'react';
import { transcriptFilename, transcriptText, type TranscriptMessage } from './chat-tools';

export function TranscriptExport({ world, timeline, messages, locale, onClose }: {
  world: string; timeline: string; messages: TranscriptMessage[]; locale: string; onClose: () => void;
}) {
  const english = locale === 'en';
  const [status, setStatus] = React.useState('');
  const text = React.useMemo(() => transcriptText(world, timeline, messages), [world, timeline, messages]);
  const preview = React.useRef<HTMLTextAreaElement>(null);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const previousFocus = React.useRef(document.activeElement);
  React.useEffect(() => {
    dialog.current?.showModal();
    preview.current?.focus();
    return () => { dialog.current?.close(); if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus(); };
  }, []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setStatus(english ? 'Transcript copied.' : '대화 기록을 복사했습니다.'); }
    catch { preview.current?.focus(); preview.current?.select(); setStatus(english ? 'Text selected. Use your device’s Copy command.' : '텍스트를 선택했습니다. 기기의 복사 기능을 사용하세요.'); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = transcriptFilename(world);
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <dialog ref={dialog} className="chat-export" aria-label={english ? 'Export conversation' : '대화 내보내기'} onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, textarea'));
      const edge = event.shiftKey ? controls[0] : controls.at(-1);
      if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus(); }
    }
  }}>
    <strong>{english ? 'Export conversation' : '대화 내보내기'}</strong>
    <p>{english ? 'Full transcript, including visual edits. Images appear as descriptions. Copy works on mobile, too.' : '화면에서 수정한 내용이 포함된 전체 대화입니다. 이미지는 설명으로 표시합니다. 모바일에서도 복사할 수 있습니다.'}</p>
    <textarea ref={preview} readOnly value={text} aria-label={english ? 'Transcript preview' : '대화 기록 미리보기'} />
    <div className="chat-tool-actions"><button type="button" onClick={() => void copy()}>{english ? 'Copy' : '복사'}</button>{import.meta.env.VITE_APP_TARGET !== 'android' && <button type="button" onClick={download}>{english ? 'Download .txt' : '.txt 다운로드'}</button>}<button type="button" onClick={onClose}>{english ? 'Close' : '닫기'}</button></div>
    <span role="status">{status}</span>
  </dialog>;
}
