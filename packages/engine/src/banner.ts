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
 * Deterministic fallback art used when a package ships no banner for an entity.
 * World/category art stays monochrome; characters get a name-specific illustrated palette portrait.
 */
export function placeholderBanner(label: string, kind: BannerKind = 'category', width = 640, height = 213): string {
  const seed = hash(`${kind}:${label}`);
  if (kind === 'character') return characterPortraitPlaceholder(label, width, Math.max(width, height), seed);
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

/** A colorful, name-specific illustrated avatar for characters whose package has no portrait. */
function characterPortraitPlaceholder(label: string, width: number, height: number, seed: number): string {
  const backgrounds = ['#6a7fb5', '#4b938b', '#b66e78', '#9271ad', '#c18a54', '#557f9f', '#8e9860', '#ba6e50'];
  const hairColors = ['#273149', '#49334f', '#254449', '#653d39', '#343a52', '#56412c'];
  const skinColors = ['#f3c8a5', '#dfa982', '#f0d0ad', '#c98770'];
  const background = backgrounds[seed % backgrounds.length]!;
  const hair = hairColors[(seed >>> 3) % hairColors.length]!;
  const skin = skinColors[(seed >>> 6) % skinColors.length]!;
  const accent = backgrounds[(seed + 3) % backgrounds.length]!;
  const side = Math.max(width, height);
  const initial = [...label.trim()][0] ?? '?';
  const safeLabel = escapeXml(label || 'Character');
  const safeInitial = escapeXml(initial);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side}" height="${side}" role="img" aria-label="${safeLabel}">`
    + `<defs><linearGradient id="portrait-bg-${seed}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${background}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>`
    + `<rect width="${side}" height="${side}" fill="url(#portrait-bg-${seed})"/>`
    + `<circle cx="${side * 0.78}" cy="${side * 0.2}" r="${side * 0.28}" fill="#ffffff" opacity=".13"/>`
    + `<circle cx="${side * 0.2}" cy="${side * 0.78}" r="${side * 0.34}" fill="#172238" opacity=".16"/>`
    + `<path d="M ${side * 0.15} ${side} Q ${side * 0.18} ${side * 0.63} ${side * 0.5} ${side * 0.62} Q ${side * 0.82} ${side * 0.63} ${side * 0.85} ${side} Z" fill="${hair}"/>`
    + `<path d="M ${side * 0.35} ${side * 0.55} Q ${side * 0.5} ${side * 0.67} ${side * 0.65} ${side * 0.55} L ${side * 0.68} ${side * 0.84} Q ${side * 0.5} ${side * 0.94} ${side * 0.32} ${side * 0.84} Z" fill="${skin}"/>`
    + `<ellipse cx="${side * 0.5}" cy="${side * 0.39}" rx="${side * 0.19}" ry="${side * 0.24}" fill="${skin}"/>`
    + `<path d="M ${side * 0.3} ${side * 0.4} Q ${side * 0.28} ${side * 0.13} ${side * 0.52} ${side * 0.15} Q ${side * 0.73} ${side * 0.16} ${side * 0.7} ${side * 0.45} L ${side * 0.64} ${side * 0.33} Q ${side * 0.49} ${side * 0.43} ${side * 0.34} ${side * 0.35} Z" fill="${hair}"/>`
    + `<path d="M ${side * 0.43} ${side * 0.43} h ${side * 0.025} M ${side * 0.545} ${side * 0.43} h ${side * 0.025}" stroke="#493b3b" stroke-width="${side * 0.012}" stroke-linecap="round"/>`
    + `<path d="M ${side * 0.46} ${side * 0.51} Q ${side * 0.5} ${side * 0.535} ${side * 0.54} ${side * 0.51}" fill="none" stroke="#a45e62" stroke-width="${side * 0.012}" stroke-linecap="round"/>`
    + `<circle cx="${side * 0.82}" cy="${side * 0.81}" r="${side * 0.1}" fill="#f5e8c5" opacity=".92"/><text x="${side * 0.82}" y="${side * 0.845}" text-anchor="middle" font-family="sans-serif" font-size="${side * 0.09}" font-weight="700" fill="#30384b">${safeInitial}</text>`
    + `<text x="${side * 0.5}" y="${side * 0.97}" text-anchor="middle" font-family="sans-serif" font-size="${side * 0.065}" font-weight="700" fill="#ffffff" stroke="#263047" stroke-width="1.4" paint-order="stroke">${safeLabel}</text>`
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
