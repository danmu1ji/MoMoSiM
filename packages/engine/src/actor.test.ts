import { describe, expect, it } from 'vitest';
import { resolveNextSpeakers } from './core';
describe('actor resolver',()=>{it('uses mentions and recent context before stable participant fallback',()=>{const chars=[{id:'a',type:'character',name:'A',tags:[],relations:[]},{id:'b',type:'character',name:'B',tags:[],relations:[]} ] as never; expect(resolveNextSpeakers({participants:['character:a','character:b']},chars,'B')[0].id).toBe('b'); expect(resolveNextSpeakers({participants:['character:a','character:b'],recentSpeakers:['b']},chars,'hello')[0].id).toBe('b');});});
