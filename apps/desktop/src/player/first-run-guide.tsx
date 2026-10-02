import React from 'react';

export const WORLD_PACKAGE_RELEASES = 'https://github.com/danmu1ji/danmutalk/releases';

type GuideStep = {
  title: string;
  description: string;
  control: string;
  icon: string;
};

export function FirstRunGuide({ language, step, onStep, onClose, onOpenReleases, onOpenPackage }: {
  language: string;
  step: number;
  onStep: (step: number) => void;
  onClose: () => void;
  onOpenReleases: () => void;
  onOpenPackage: () => void;
}) {
  const english = language === 'en';
  const dialogRef = React.useRef<HTMLElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const dialog = dialogRef.current;
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) { event.preventDefault(); titleRef.current?.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);
  React.useEffect(() => { titleRef.current?.focus(); }, [step]);
  const steps: GuideStep[] = english ? [
    { title: 'Welcome to DanmuTalk', description: 'First, download a world package. Open the GitHub Releases page and download a world file ending in .😭 or .zip.', control: 'GitHub Releases · World packages', icon: '↓' },
    { title: 'Open your world', description: 'After the download finishes, choose Open a world package on this screen and select the file you downloaded. A world provides the characters you can chat with.', control: 'Open a world package', icon: '＋' },
    { title: 'Choose someone to chat with', description: 'Once a world is open, find a character in the student list on the left and select their name to open a conversation.', control: 'Student list · Select a name', icon: '♙' },
    { title: 'Connect a model in Settings', description: 'Open Settings from the gear button in the top bar, enter your provider endpoint and API key, then check the connection and load models. DanmuTalk selects an available model for you. You need a model connection to get replies.', control: 'Top bar · ⚙ Settings', icon: '⚙' },
    { title: 'Send your first message', description: 'Type into the message box at the bottom of the conversation and press Enter or the send button. Your conversation is saved on this device.', control: 'Message box · Send', icon: '➤' },
    { title: 'Start a group conversation', description: 'Choose New group chat in the left sidebar (the + button), select the characters you want, then start the conversation.', control: 'Left sidebar · + New group chat', icon: '＋' },
  ] : [
    { title: 'DanmuTalk에 오신 것을 환영해요', description: '먼저 세계관 패키지를 다운로드하세요. GitHub 릴리스 페이지에서 .😭 또는 .zip 파일을 받으면 됩니다.', control: 'GitHub 릴리스 · 세계관 패키지', icon: '↓' },
    { title: '세계관 열기', description: '다운로드가 끝나면 이 화면에서 세계관 패키지 열기를 누르고 받은 파일을 선택하세요. 세계관을 열면 대화할 캐릭터가 표시됩니다.', control: '세계관 패키지 열기', icon: '＋' },
    { title: '대화할 학생 선택하기', description: '세계관을 연 뒤 왼쪽 학생 목록에서 캐릭터 이름을 선택하면 대화가 열립니다.', control: '학생 목록 · 이름 선택', icon: '♙' },
    { title: '설정에서 모델 연결하기', description: '상단의 톱니바퀴 설정에서 Provider 엔드포인트와 API 키를 입력한 뒤 연결 확인 및 모델 불러오기를 누르세요. DanmuTalk가 사용할 수 있는 모델을 골라 줍니다. 답변을 받으려면 모델 연결이 필요합니다.', control: '상단 메뉴 · ⚙ 설정', icon: '⚙' },
    { title: '첫 메시지 보내기', description: '대화 화면 아래쪽 입력란에 메시지를 쓰고 Enter 또는 보내기 버튼을 누르세요. 대화는 이 기기에 저장됩니다.', control: '메시지 입력란 · 보내기', icon: '➤' },
    { title: '그룹 대화 시작하기', description: '왼쪽 사이드바에서 그룹 채팅 시작 (+)을 누르고 캐릭터를 선택한 다음 대화를 시작하세요.', control: '왼쪽 사이드바 · + 그룹 채팅 시작', icon: '＋' },
  ];
  const current = steps[step];
  return <div className="dt-guide-backdrop" role="presentation">
    <section ref={dialogRef} className="dt-guide" role="dialog" aria-modal="true" aria-labelledby="dt-guide-title">
      <button className="dt-guide-close" type="button" onClick={onClose} aria-label={english ? 'Close tutorial' : '안내 닫기'}>×</button>
      <span className="dt-guide-mark" aria-hidden="true">{current.icon}</span>
      <p className="dt-guide-count">{english ? `FIRST LAUNCH GUIDE · ${step + 1} OF ${steps.length}` : `첫 실행 안내 · ${step + 1} / ${steps.length}`}</p>
      <h2 ref={titleRef} id="dt-guide-title" tabIndex={-1}>{current.title}</h2>
      <p className="dt-guide-description">{current.description}</p>
      <div className="dt-guide-control"><span>{english ? 'LOOK FOR' : '화면에서 찾기'}</span><strong>{current.control}</strong></div>
      {step === 0 && <button className="dt-guide-release" type="button" onClick={onOpenReleases}>{english ? 'Open GitHub Releases' : 'GitHub 릴리스 열기'} <span aria-hidden="true">↗</span></button>}
      {step === 1 && <button className="dt-guide-release" type="button" onClick={onOpenPackage}>{english ? 'Choose downloaded world' : '다운로드한 세계관 선택'} <span aria-hidden="true">＋</span></button>}
      <div className="dt-guide-footer">
        <button className="dt-guide-skip" type="button" onClick={onClose}>{english ? 'Close guide' : '안내 닫기'}</button>
        <div className="dt-guide-dots" aria-label={english ? `Step ${step + 1} of ${steps.length}` : `${steps.length}단계 중 ${step + 1}단계`}>
          {steps.map((item, index) => <span key={item.title} className={index === step ? 'active' : ''} />)}
        </div>
        {step > 0 && <button className="dt-guide-back" type="button" onClick={() => onStep(step - 1)}>{english ? 'Back' : '이전'}</button>}
        <button className="dt-guide-next" type="button" onClick={() => step === steps.length - 1 ? onClose() : onStep(step + 1)}>{step === steps.length - 1 ? (english ? 'Finish' : '완료') : (english ? 'Next' : '다음')}</button>
      </div>
    </section>
  </div>;
}
