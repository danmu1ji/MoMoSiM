import type { ChatNode, MediaAsset } from '@world-player/schema';
import type { WorldData } from './core.js';

export interface ResolvedMedia { node: ChatNode; asset: MediaAsset }
export function resolveMedia(data: WorldData, nodes: ChatNode[], state?: string, situation?: string): (ChatNode | ResolvedMedia)[] {
  return nodes.map(node => {
    if (node.type !== 'media' && node.type !== 'audio') return node;
    const asset = node.asset ? data.media.get(node.asset) : undefined;
    if (!asset || (asset.validStates?.length && (!state || !asset.validStates.includes(state))) || (asset.validSituations?.length && (!situation || !asset.validSituations.includes(situation)))) return { type: 'text', text: `[unavailable ${node.type}: ${node.asset ?? 'missing'}]` };
    return { node, asset };
  });
}
