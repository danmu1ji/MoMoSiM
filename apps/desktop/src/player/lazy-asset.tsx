/**
 * 지연 자산 로딩 UI — 이미지/음성은 **보이거나 재생할 때** 읽는다.
 *
 * 772MB 세계관에서 모든 배너·로비·음성을 즉시 objectURL로 만들면 메모리가 폭발한다.
 * 여기서는 IntersectionObserver로 화면에 들어온 자산만 요청하고, 사라지면 URL을 해제한다.
 * (engine의 `assetUrlAsync`가 바이트 읽기 + LRU 캐시를 담당한다.)
 */
import * as React from 'react';
import { assetUrlAsync, releaseAssetUrls, type WorldData } from '@world-player/engine/desktop';

type EngineData = Parameters<typeof assetUrlAsync>[0];

/** 자산 URL을 지연 획득하는 훅. 화면 밖이면 요청하지 않는다. */
export function useAssetUrl(data: EngineData | undefined, assetId: string | undefined, enabled = true): string | undefined {
  const [url, setUrl] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    if (!data || !assetId || !enabled) {
      setUrl(undefined);
      return;
    }
    let cancelled = false;
    void assetUrlAsync(data, assetId).then(next => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [data, assetId, enabled]);
  return url;
}

/** 세계관이 바뀌면 자산 캐시를 비운다. */
export function useReleaseAssets(data: EngineData | undefined): void {
  React.useEffect(() => {
    if (!data) return undefined;
    return () => releaseAssetUrls(data);
  }, [data]);
}

/**
 * 화면에 들어올 때만 로딩하는 이미지.
 *
 * CSS 계약을 지키기 위해 **항상 `<img>` 하나만** 렌더한다(래퍼 div를 두면 기존 선택자 `.card img`
 * 같은 규칙이 깨져 이미지가 화면을 뒤덮는다). 보이기 전에는 플레이스홀더를, 보이면 실제 자산을 건다.
 */
export function LazyAssetImage({ data, assetId, alt, className, style, placeholder }: {
  data: EngineData | undefined;
  assetId: string | undefined;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}): React.ReactElement | null {
  const holder = React.useRef<HTMLImageElement | null>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const node = holder.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [assetId]);

  const url = useAssetUrl(data, assetId, visible);
  return (
    <img
      ref={holder}
      className={className}
      style={style}
      src={url ?? placeholder}
      alt={alt}
      loading="lazy"
      decoding="async"
      data-placeholder={url ? 'false' : 'true'}
    />
  );
}

/**
 * 음성. `autoPlay`면 화면에 나타나는 즉시 읽어서 재생한다(캐릭터가 음성을 고른 경우).
 * 브라우저가 자동 재생을 막으면(사용자 제스처 없음) 재생 버튼이 그대로 남아 눌러서 들을 수 있다.
 */
export function LazyAudio({ data, assetId, label = '▶', autoPlay = false }: {
  data: EngineData | undefined;
  assetId: string | undefined;
  label?: string;
  autoPlay?: boolean;
}): React.ReactElement | null {
  const [requested, setRequested] = React.useState(autoPlay);
  const [playing, setPlaying] = React.useState(false);
  const [url, setUrl] = React.useState<string | undefined>(undefined);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  const autoStarted = React.useRef(false);

  React.useEffect(() => {
    if (!requested || !data || !assetId) return undefined;
    let cancelled = false;
    void assetUrlAsync(data, assetId).then(next => {
      if (!cancelled) setUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [requested, data, assetId]);

  // 자산이 준비되면 한 번만 자동 재생을 시도한다.
  React.useEffect(() => {
    if (!autoPlay || !url || autoStarted.current) return undefined;
    const node = audio.current;
    if (!node) return undefined;
    autoStarted.current = true;
    node.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    return undefined;
  }, [autoPlay, url]);

  if (!assetId) return null;
  return (
    <>
      <button
        type="button"
        className="bubble-voice"
        onClick={() => {
          setRequested(true);
          const node = audio.current;
          if (node && url) {
            if (playing) { node.pause(); setPlaying(false); } else { void node.play(); setPlaying(true); }
          }
        }}
      >
        {playing ? '❚❚' : label}
      </button>
      {url ? (
        <audio
          ref={audio}
          src={url}
          preload="none"
          onEnded={() => setPlaying(false)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
      ) : null}
    </>
  );
}

/** 월드 전환 시 캐시 정리를 한 곳에서 처리하도록 노출. */
export function useWorldAssets(data: WorldData | undefined): void {
  useReleaseAssets(data as EngineData | undefined);
}