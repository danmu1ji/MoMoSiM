import React from 'react';
import { bannerAssetId, placeholderBanner, type BannerKind, type WorldData } from '@world-player/engine/desktop';
import { LazyAssetImage } from './lazy-asset';

/** Banner image with the packaged asset when present, a monochrome placeholder otherwise. */
export function BannerImage({ data, owner, kind, className, alt }: { data?: WorldData; owner?: { banner?: string; name: string }; kind: BannerKind; className?: string; alt?: string }) {
  // 자산이 있으면 화면에 보일 때만 읽고, 없으면 플레이스홀더를 즉시 그린다.
  const assetId = React.useMemo(() => bannerAssetId(data, owner), [data, owner?.banner]);
  const placeholder = React.useMemo(() => placeholderBanner(owner?.name ?? kind, kind), [owner?.name, kind]);
  return (
    <LazyAssetImage
      data={data as never}
      assetId={assetId}
      alt={alt ?? owner?.name ?? kind}
      className={className}
      placeholder={placeholder}
    />
  );
}
