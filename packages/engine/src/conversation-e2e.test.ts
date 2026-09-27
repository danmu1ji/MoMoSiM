import { describe, expect, it } from 'vitest';
import { createPackageSource, loadWorld } from './index';
import { runSequentialConversation } from './orchestration';
import type { Character } from '@world-player/schema';
import type { ProviderMessage } from './dialogue';

const archivePath = decodeURIComponent(new URL('../../../worlds/examples/echo-world.😭', import.meta.url).pathname);

describe('MVP conversation contract', () => {
  it('runs two participants sequentially with Fog-limited, incremental context', async () => {
    const data = await loadWorld(await createPackageSource(archivePath));
    const characters = [...data.entities.values()].filter(entity => entity.type === 'character') as Character[];
    expect(characters.length).toBeGreaterThanOrEqual(2);

    const requests: { system: string; messages: ProviderMessage[] }[] = [];
    const provider = { createStream: async function* ({ system, messages }: { system: string; messages: ProviderMessage[] }) { requests.push({ system, messages: [...messages] }); yield { type: 'text' as const, text: `reply-${requests.length}` }; } };

    const history = await runSequentialConversation({ provider, data, characters, slice: data.timeSlices[0], player: { name: '방문자', description: '여행자', tags: [] }, input: '항구에 대해 알려줘', history: [], model: 'stub' });

    expect(requests).toHaveLength(2);
    const speakerOf = (system: string) => system.match(/You are (.+)\./)?.[1] ?? '';
    expect(speakerOf(requests[0].system)).not.toBe(speakerOf(requests[1].system));
    // 두 번째 화자의 요청에는 첫 화자의 발언이 **이름이 붙은 채** 들어가야 한다(누가 한 말인지 알아야 한다).
    expect(requests[1].messages.some(message => message.content.includes(`${speakerOf(requests[0].system)}: reply-1`))).toBe(true);
    // 그리고 그 발언은 자기 말(assistant)이 아니라 '들리는 말'(user)로 전달된다.
    expect(requests[1].messages.find(message => message.content.includes('reply-1'))?.role).toBe('user');
    // 앞선 발언이 기록에 더해져 내용이 늘어난다(역할이 같으면 한 덩어리로 합쳐지므로 길이로만 재지 않는다).
    const joined = (index: number) => requests[index].messages.map(message => message.content).join('\n');
    expect(joined(1).length).toBeGreaterThan(joined(0).length);
    // Each speaker gets its own identity and its own Fog-limited knowledge section.
    expect(requests[0].system).toContain(`You are ${characters[0].name}`);
    expect(requests[1].system).toContain(`You are ${characters[1].name}`);
    expect(history).toHaveLength(3);
    expect(history[0].speaker).toEqual({ type: 'player', id: '방문자' });
    expect(history[2].speaker).toEqual({ type: 'character', id: characters[1].id });
  });
});
