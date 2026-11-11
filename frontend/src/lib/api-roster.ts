import type { Attribute, Element, Skill, Stage } from '@digiworld/shared/digimon';

import { apiFetch } from './api';

export type OkResponse = {
  readonly ok: true;
};

export type SeedStarterResponse = {
  readonly seeded: number;
  readonly reason?: string;
};

export type EvolutionReason = 'no-paths' | 'level-too-low' | 'stage-cap' | 'no-mood' | 'attribute-mismatch' | 'missing-item' | 'no-item-assigned';

export type EvolutionOption = {
  readonly catalogId: string;
  readonly name: string;
  readonly stage: Stage;
  readonly portrait: string;
  /** Has the player ever seen this species? (Not "meets requirements" — that's `eligible`.) */
  readonly met: boolean;
  readonly eligible: boolean;
  readonly reason?: EvolutionReason;
  readonly requiredLevel: number;
  readonly requiredMood: number;
  readonly requiredAttribute: Attribute | null;
  readonly requiredItemId: string | null;
  readonly requiredItemName: string | null;
  readonly requiredItemQty: number;
  readonly itemQtyAvailable: number;
};

export type EvolutionGate = {
  readonly eligible: boolean;
  readonly reason?: EvolutionReason;
  readonly currentStage: Stage;
  readonly currentLevel: number;
  readonly currentMood: number;
  readonly nextStage: Stage | null;
  readonly requiredLevel: number;
  readonly requiredMood: number;
  readonly options: readonly EvolutionOption[];
};

export type EvolveResponse = {
  readonly ok: true;
  readonly monId: string;
  readonly fromCatalogId: string;
  readonly toCatalogId: string;
  readonly nickname: string;
  readonly level: number;
  readonly stage: Stage;
};

export type TrainingActiveView = {
  readonly sessionId: string;
  readonly monId: string;
  readonly monNickname: string;
  readonly monLevel: number;
  readonly monStage: Stage;
  readonly statKinds: readonly string[];
  readonly startedAt: number;
  readonly durationMs: number;
  readonly finishesAt: number;
  readonly progressPct: number;
  readonly readyToCollect: boolean;
  readonly previewGains: Partial<Record<string, number>>;
  readonly previewMoodDelta: number;
};

export type TrainingSlotView = {
  readonly buildingId: string;
  readonly kind: string;
  readonly buildingType: 'training' | 'training_premium';
  readonly supportedStatCount: number;
  readonly active: TrainingActiveView | null;
};

export type TrainingResponse = {
  readonly stations: readonly TrainingSlotView[];
};

export function seedStarterRoster(): Promise<SeedStarterResponse> {
  return apiFetch<SeedStarterResponse>('/api/roster/seed', { method: 'POST' });
}

export function setPartySlot(monId: string, slot: number): Promise<OkResponse> {
  return apiFetch<OkResponse>('/api/roster/party', { method: 'POST', body: { monId, slot } });
}

export function removeFromParty(slot: number): Promise<OkResponse> {
  return apiFetch<OkResponse>('/api/roster/party/remove', { method: 'POST', body: { slot } });
}

export function renameRosterMon(monId: string, nickname: string): Promise<OkResponse> {
  return apiFetch<OkResponse>(`/api/roster/rename/${encodeURIComponent(monId)}`, { method: 'POST', body: { nickname } });
}

export function getEvolutionGate(monId: string): Promise<EvolutionGate> {
  return apiFetch<EvolutionGate>(`/api/roster/${encodeURIComponent(monId)}/evolutions`);
}

export function evolveRosterMon(monId: string, targetCatalogId: string): Promise<EvolveResponse> {
  return apiFetch<EvolveResponse>(`/api/roster/${encodeURIComponent(monId)}/evolve`, { method: 'POST', body: { targetCatalogId } });
}

export function reviveRosterMon(monId: string): Promise<OkResponse> {
  return apiFetch<OkResponse>(`/api/roster/revive/${encodeURIComponent(monId)}`, { method: 'POST' });
}

export function getTrainingStatus(): Promise<TrainingResponse> {
  return apiFetch<TrainingResponse>('/api/training');
}

export type LearnedSkillEntry = {
  readonly key: string;
  readonly skill: Skill;
  readonly sourceTemplateId: string;
  readonly sourceTemplateName: string;
  readonly sourceStage: string;
  readonly sourceAttribute: string;
  readonly source: 'current' | 'history';
};

export type CatalogSkillMeta = {
  readonly id: string;
  readonly name: string;
  readonly name_pt: string;
  readonly description: string | null;
  readonly description_pt: string | null;
  readonly element: Element;
  readonly energyCost: number;
  readonly cooldown: number;
  readonly stage: Stage;
  readonly slot_role: string | null;
  readonly tier_2: boolean;
  readonly upgrade_of: string | null;
};

export type SignatureOption = {
  readonly id: string;
  readonly name: string;
  readonly name_pt: string;
  readonly description: string | null;
  readonly description_pt: string | null;
  readonly element: Element;
  readonly energyCost: number;
  readonly cooldown: number;
  readonly stage: Stage;
  readonly slot_role: string | null;
  readonly archetype: string | null;
  readonly archetypeValid: boolean;
};

export type MonSkillsResponse = {
  readonly monId: string;
  readonly currentCatalogId: string;
  readonly currentStage: Stage;
  readonly currentName: string;
  readonly currentElement: Element;
  readonly history: readonly string[];
  readonly learnedSkills: readonly LearnedSkillEntry[];
  readonly catalogPool: readonly CatalogSkillMeta[];
  readonly equipped: readonly string[];
  readonly groupings: {
    readonly fromCurrent: readonly string[];
    readonly fromHistory: readonly string[];
    readonly fromCatalog: readonly string[];
  };
  readonly maxEquipped: number;
  readonly signatureOptions: readonly SignatureOption[];
  readonly activeSignatureId: string | null;
};

export type SetSignatureResponse = {
  readonly ok: true;
  readonly signatureSkillId: string | null;
};

export type SetMonSkillsResponse = {
  readonly ok: true;
  readonly equipped: readonly string[];
};

export function isCatalogSkillId(id: string): boolean {
  return id.startsWith('sk-');
}

export function getMonSkills(monId: string): Promise<MonSkillsResponse> {
  return apiFetch<MonSkillsResponse>(`/api/roster/${encodeURIComponent(monId)}/skills`);
}

export function setMonSkills(monId: string, skillKeys: readonly string[]): Promise<SetMonSkillsResponse> {
  return apiFetch<SetMonSkillsResponse>(`/api/roster/${encodeURIComponent(monId)}/skills`, { method: 'PUT', body: { skillIds: skillKeys } });
}

/** Select (skillId) or clear (null) the digimon's single active signature. */
export function setMonSignature(monId: string, skillId: string | null): Promise<SetSignatureResponse> {
  return apiFetch<SetSignatureResponse>(`/api/roster/${encodeURIComponent(monId)}/signature`, { method: 'PUT', body: { skillId } });
}
