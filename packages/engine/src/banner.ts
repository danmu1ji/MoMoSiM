import type { Entity } from '@world-player/schema';
import type { WorldData } from './core.js';
import { assetUrl } from './core.js';

export type BannerKind = 'world' | 'category' | 'character';

const GREY = '#808080';
const BLACK = '#000000';
const WHITE = '#ffffff';

function hash(value: string): number { let result = 0; for (const char of value) result = (result * 31 + char.codePointAt(0)!) % 100000; return result; }
function escapeXml(value: string): string { return value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!); }

/**
 * Deterministic monochrome banner used when a package ships no banner for an entity.
 * Only #000000 / #808080 / #ffffff are used so the pre-world palette rule holds everywhere.
 */
export function placeholderBanner(label: string, kind: BannerKind = 'category', width = 640, height = 213): string {
  const seed = hash(`${kind}:${label}`);
  const shapes = Array.from({ length: 5 }, (_, index) => {
    const x = (seed * (index + 3)) % width;
    const r = 18 + ((seed >> (index + 1)) % 52);
    const fill = index % 3 === 0 ? WHITE : index % 3 === 1 ? GREY : BLACK;
    return `<circle cx="${x}" cy="${(seed * (index + 7)) % height}" r="${r}" fill="${fill}" opacity="${index % 2 === 0 ? 0.35 : 0.18}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeXml(label)}">`
    + `<rect width="${width}" height="${height}" fill="${BLACK}"/>`
    + `<rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="none" stroke="${GREY}" stroke-width="2"/>`
    + shapes
    + `<text x="50%" y="54%" text-anchor="middle" font-family="Manrope, sans-serif" font-size="${Math.round(height / 5)}" fill="${WHITE}" opacity="0.92">${escapeXml(label || kind)}</text>`
    + `<text x="50%" y="76%" text-anchor="middle" font-family="monospace" font-size="${Math.round(height / 12)}" fill="${GREY}">${kind.toUpperCase()} · PLACEHOLDER</text>`
    + '</svg>';
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Banner for a world or entity: the packaged media asset when present, otherwise a placeholder. */
export function resolveBanner(data: WorldData | undefined, owner: { banner?: string; name: string } | undefined, kind: BannerKind): { url: string; placeholder: boolean } {
  const bannerId = owner?.banner;
  if (data && bannerId) { const url = assetUrl(data, bannerId); if (url) return { url, placeholder: false }; }
  return { url: placeholderBanner(owner?.name ?? kind, kind), placeholder: true };
}

/**
 * 배너 자산 id(지연 로딩용). 실제 이미지 바이트는 표시될 때 읽는다.
 * 패키지에 자산이 없으면 undefined → 호출부가 플레이스홀더를 그린다.
 */
export function bannerAssetId(data: WorldData | undefined, owner: { banner?: string } | undefined): string | undefined {
  const bannerId = owner?.banner;
  if (!data || !bannerId) return undefined;
  const asset = data.media.get(bannerId);
  return asset && data.assetFiles.has(asset.file) ? bannerId : undefined;
}

/** True when the owner declares a banner that the package does not actually ship. */
export function danglingBanner(data: WorldData, owner: { banner?: string }): string | undefined {
  return owner.banner && !data.media.has(owner.banner) ? owner.banner : undefined;
}

export function hasBanner(entities: Iterable<Entity>): boolean { return [...entities].some(entity => Boolean(entity.banner)); }
