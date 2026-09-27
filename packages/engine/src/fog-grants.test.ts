import { describe, expect, it } from 'vitest';
import { fogGrants } from './core';
import type { KnowledgeRule } from '@world-player/schema';

describe('fog grants for the boundary',()=>{it('forwards hidden rules so the boundary denies them, and drops foreign-slice or non-evaluable rules',()=>{const rules:KnowledgeRule[]=[{target:'location:harbor',access:'public'},{target:'location:vault',access:'hidden'},{target:'character:borin',access:'full',condition:{timeSlice:'past'}},{target:'character:aria',access:'full',condition:{timeSlice:'now'}},{target:'event:storm',access:'full',condition:{location:'harbor'}}]; const grants=fogGrants(rules,'now'); expect(grants.map(g=>g.target)).toEqual(['location:harbor','location:vault','character:aria']); expect(grants.find(g=>g.target==='location:vault')?.access).toBe('hidden'); expect(grants.every(g=>g.timeSlice==='now')).toBe(true);});});
