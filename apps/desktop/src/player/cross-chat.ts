import { participantsForConversationId } from './conversation-id';

export interface SharedContext {
  world: string;
  worldName: string;
  updatedAt: string;
  currentConversationId: string;
  timeSlice: string;
  timeSliceLabel: string;
  location: string;
  activity: string;
  recentText: string;
}

export interface FollowUpJob {
  id: string;
  world: string;
  sourceConversationId: string;
  targetCharacterId: string;
  targetCharacterName: string;
  timerStartsAt: number;
  waitMinutes: number;
  dueAt: number;
  intent: string;
  context: SharedContext;
  status: 'pending' | 'sending';
  attempts: number;
  consentGeneration: number;
}

const ENABLED_KEY = 'world-player.cross-chat.enabled.v1';
const CONSENT_GENERATION_KEY = 'world-player.cross-chat.consent-generation.v1';
const CONTEXT_KEY = 'world-player.cross-chat.context.v1';
const JOBS_KEY = 'world-player.cross-chat.jobs.v1';
const MAX_JOBS = 30;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_WAIT_MINUTES = 1;
const MAX_START_MINUTES = 180;
const MAX_WAIT_MINUTES = 24 * 60;

export function crossChatEnabled(): boolean {
  try {
    loadSharedContext();
    loadFollowUpJobs();
    return localStorage.getItem(ENABLED_KEY) === 'true';
  } catch { return false; }
}

export function crossChatConsentGeneration(): number {
  try { return Number(localStorage.getItem(CONSENT_GENERATION_KEY) ?? 0) || 0; } catch { return 0; }
}

export function setCrossChatEnabled(enabled: boolean): void {
  try {
    const wasEnabled = localStorage.getItem(ENABLED_KEY) === 'true';
    if (wasEnabled !== enabled) localStorage.setItem(CONSENT_GENERATION_KEY, String(crossChatConsentGeneration() + 1));
    localStorage.setItem(ENABLED_KEY, String(enabled));
    if (!enabled) {
      localStorage.removeItem(JOBS_KEY);
      localStorage.removeItem(CONTEXT_KEY);
    }
  } catch { /* Remains disabled unless saved. */ }
}

export function saveSharedContext(context: SharedContext): void {
  try { localStorage.setItem(CONTEXT_KEY, JSON.stringify(context)); } catch { /* Shared context is optional. */ }
}

export function loadSharedContext(): SharedContext | undefined {
  try {
    const context = JSON.parse(localStorage.getItem(CONTEXT_KEY) ?? 'null') as SharedContext | null;
    if (context && Number.isFinite(Date.parse(context.updatedAt)) && Date.now() - Date.parse(context.updatedAt) <= MAX_AGE_MS && typeof context.world === 'string' && typeof context.recentText === 'string') return context;
    localStorage.removeItem(CONTEXT_KEY);
    return undefined;
  } catch { return undefined; }
}

export function loadFollowUpJobs(): FollowUpJob[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(JOBS_KEY) ?? '[]') as FollowUpJob[];
    const now = Date.now();
    const jobs = Array.isArray(parsed) ? parsed.filter(job => job && typeof job.id === 'string' && typeof job.world === 'string' && typeof job.targetCharacterId === 'string' && typeof job.targetCharacterName === 'string' && typeof job.intent === 'string' && Number.isFinite(job.timerStartsAt) && Number.isFinite(job.dueAt) && job.context && typeof job.context.recentText === 'string' && Number.isFinite(job.consentGeneration) && (job.status === 'pending' || job.status === 'sending') && now - job.timerStartsAt < MAX_AGE_MS).map(job => ({ ...job, status: 'pending' as const, attempts: Number.isFinite(job.attempts) ? job.attempts : 0 })).slice(-MAX_JOBS) : [];
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
    return jobs;
  } catch { return []; }
}

export function clearCrossChatConversation(conversationId: string, world?: string): void {
  try {
    const context = loadSharedContext();
    if (context?.currentConversationId === conversationId && (!world || context.world === world)) localStorage.removeItem(CONTEXT_KEY);
    const participantIds = new Set(participantsForConversationId(conversationId));
    localStorage.setItem(JOBS_KEY, JSON.stringify(loadFollowUpJobs().filter(job => {
      const inWorld = !world || job.world === world;
      return !(inWorld && job.sourceConversationId === conversationId) && !(inWorld && participantIds.has(job.targetCharacterId));
    })));
  } catch { /* Deletion should continue if optional follow-up cleanup fails. */ }
}

export function scheduleFollowUps(input: {
  world: string;
  sourceConversationId: string;
  context: SharedContext;
  plans: Array<{ characterId: string; characterName: string; startAfterMinutes: number; waitMinutes: number; intent: string }>;
}): void {
  const now = Date.parse(input.context.updatedAt) || Date.now();
  const existing = loadFollowUpJobs();
  const jobs = input.plans.slice(0, 3).map(plan => {
    const startAfter = Math.max(0, Math.min(MAX_START_MINUTES, Math.round(plan.startAfterMinutes || 0)));
    const waitMinutes = Math.max(MIN_WAIT_MINUTES, Math.min(MAX_WAIT_MINUTES, Math.round(plan.waitMinutes || MIN_WAIT_MINUTES)));
    const timerStartsAt = now + startAfter * 60_000;
    return {
      id: crypto.randomUUID(), world: input.world, sourceConversationId: input.sourceConversationId,
      targetCharacterId: plan.characterId, targetCharacterName: plan.characterName,
      timerStartsAt, waitMinutes, dueAt: timerStartsAt + waitMinutes * 60_000,
      intent: plan.intent.slice(0, 600), context: input.context, status: 'pending' as const, attempts: 0, consentGeneration: crossChatConsentGeneration(),
    };
  });
  try { localStorage.setItem(JOBS_KEY, JSON.stringify([...existing, ...jobs].slice(-MAX_JOBS))); } catch { /* Feature degrades without queuing. */ }
}

export function takeDueFollowUpJobs(now = Date.now(), world?: string): FollowUpJob[] {
  const jobs = loadFollowUpJobs();
  const due = jobs.filter(job => job.status === 'pending' && (!world || job.world === world) && job.timerStartsAt <= now && job.dueAt <= now);
  const dueIds = new Set(due.map(job => job.id));
  try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.map(job => dueIds.has(job.id) ? { ...job, status: 'sending' as const } : job))); } catch { return []; }
  return due;
}

export function hasFollowUpJob(id: string): boolean { return loadFollowUpJobs().some(job => job.id === id); }

export function completeFollowUpJob(id: string): void {
  try { localStorage.setItem(JOBS_KEY, JSON.stringify(loadFollowUpJobs().filter(job => job.id !== id))); } catch { /* Expiry will remove it. */ }
}

export function retryFollowUpJob(id: string): void {
  try {
    const jobs = loadFollowUpJobs();
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.flatMap(job => {
      if (job.id !== id) return [job];
      const attempts = (job.attempts ?? 0) + 1;
      return attempts > 2 ? [] : [{ ...job, status: 'pending' as const, attempts, dueAt: Date.now() + 5 * 60_000 }];
    })));
  } catch { /* Expiry will remove it. */ }
}

export async function planCrossChatFollowUps(input: {
  provider: { createStream(request: { model: string; system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; sampling?: { temperature?: number; maxTokens?: number }; signal?: AbortSignal }): AsyncIterable<{ type: string; text?: string; error?: Error }> };
  model: string;
  context: SharedContext;
  sourceConversationId: string;
  currentParticipantIds: string[];
  characters: Array<{ id: string; name: string }>;
}): Promise<void> {
  const candidates = input.characters.filter(character => !input.currentParticipantIds.includes(character.id)).slice(0, 100);
  if (!candidates.length) return;
  const system = [
    'You schedule optional delayed roleplay check-ins from other characters to the user.',
    'Choose zero to three characters only when the shared event gives them a natural reason to contact the user later. Do not send a message now.',
    'Return only JSON: {"followups":[{"characterId":"...","startAfterMinutes":0,"waitMinutes":5,"intent":"..."}]}.',
    'Choose startAfterMinutes from 0 to 180 and waitMinutes from 1 to 1440. The app applies a hard minimum wait of 1 minute and caps each event at three follow-ups.',
    'Do not include current chat participants, duplicate character ids, private speculation, or facts absent from the shared context.',
  ].join('\n');
  const user = `${followUpPromptContext(input.context)}\n\nCurrent chat: ${input.sourceConversationId}\nAvailable other characters (id | name):\n${candidates.map(character => `${character.id} | ${character.name}`).join('\n')}`;
  let raw = '';
  for await (const event of input.provider.createStream({ model: input.model, system, messages: [{ role: 'user', content: user }], sampling: { temperature: 0.2, maxTokens: 900 }, signal: AbortSignal.timeout(90_000) })) {
    if (event.type === 'text' && typeof event.text === 'string' && raw.length < 12_000) raw += event.text.slice(0, 12_000 - raw.length);
    if (event.type === 'error') throw event.error ?? new Error('Cross-chat planning failed');
  }
  const json = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const decoded = JSON.parse(json) as { followups?: Array<{ characterId?: string; startAfterMinutes?: number; waitMinutes?: number; intent?: string }> };
  const allowed = new Map(candidates.map(character => [character.id, character]));
  const seen = new Set<string>();
  const plans = (Array.isArray(decoded.followups) ? decoded.followups : []).flatMap(item => {
    const character = item.characterId ? allowed.get(item.characterId) : undefined;
    if (!character || seen.has(character.id) || !Number.isFinite(item.startAfterMinutes) || !Number.isFinite(item.waitMinutes) || typeof item.intent !== 'string') return [];
    seen.add(character.id);
    return [{ characterId: character.id, characterName: character.name, startAfterMinutes: item.startAfterMinutes!, waitMinutes: item.waitMinutes!, intent: item.intent }];
  });
  const latest = loadSharedContext();
  if (plans.length && crossChatEnabled() && latest?.updatedAt === input.context.updatedAt) {
    scheduleFollowUps({ world: input.context.world, sourceConversationId: input.sourceConversationId, context: input.context, plans });
  }
}

export function followUpPromptContext(context: SharedContext): string {
  return [
    `World: ${context.worldName || context.world}`,
    `Timeline: ${context.timeSliceLabel || context.timeSlice || 'unknown'}`,
    `User's current location: ${context.location || 'unknown'}`,
    `What the user is doing: ${context.activity || 'unknown'}`,
    `Recent shared conversation context: ${context.recentText}`,
  ].join('\n').slice(0, 7000);
}

export const crossChatLimits = { minWaitMinutes: MIN_WAIT_MINUTES, maxStartMinutes: MAX_START_MINUTES, maxWaitMinutes: MAX_WAIT_MINUTES };
