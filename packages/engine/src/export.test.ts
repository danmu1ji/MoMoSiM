import { describe, expect, it } from 'vitest';
import { createMemorySource, exportWorldPackageAsync, loadWorld } from './index';
import { unzipSync, strFromU8 } from 'fflate';
describe('world package export',()=>{it('writes a ZIP package with core files',async()=>{const d=await loadWorld(createMemorySource({'manifest.yaml':'schemaVersion: 1\nid: w\nname: W\nversion: 1\nentry: world.yaml','world.yaml':'id: w\nname: W\nversion: 1\nsummary: demo','index/entities.yaml':'entities: []','timeline/time-slices.yaml':'timeSlices: []','timeline/states.yaml':'states: []','assets/media.yaml':'media: []'})); const archive=unzipSync(await exportWorldPackageAsync(d)); expect(strFromU8(archive['manifest.yaml'])).toContain('schemaVersion'); expect(archive['world.yaml']).toBeDefined();});});
