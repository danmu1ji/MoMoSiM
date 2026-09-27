import { describe, expect, it } from 'vitest';
import { createPackageSource, loadWorld } from './index';
describe('😭 package',()=>{it('loads the checked-in archive',async()=>{const data=await loadWorld(await createPackageSource(decodeURIComponent(new URL('../../../worlds/examples/echo-world.😭',import.meta.url).pathname))); expect(data.world.id).toBe('echo-world'); expect(data.media.has('aria-profile')).toBe(true);});});
