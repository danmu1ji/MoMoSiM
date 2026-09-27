import { describe, expect, it } from 'vitest';
import { resolveMedia } from './media';
describe('media resolver',()=>{it('rejects unknown assets instead of emitting an unchecked directive',()=>{const data={media:new Map(),manifest:{schemaVersion:'1',id:'w',name:'w',version:'1',entry:'world.yaml'}} as never; expect(resolveMedia(data,[{type:'media',asset:'missing'}])[0]).toEqual({type:'text',text:'[unavailable media: missing]'});});});
