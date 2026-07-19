import type { Attribute, BaseStats, Element, Skill, Stage, TemplateDigimon } from '@digiworld/shared/digimon';

import { apiFetch } from './api';

export type ScrapedEntry = {
  readonly skullbot_id: number;
  readonly name: string;
  readonly stage: string | null;
  readonly attribute: string | null;
  readonly portrait_url: string | null;
  readonly dot_url: string | null;
  readonly wikimon_slug: string | null;
  readonly raw_json: string | null;
  readonly scraped_at: number;
  readonly in_catalog: number;
};

export type ScrapedListQuery = {
  readonly search?: string;
  readonly stage?: string;
  readonly attribute?: string;
  readonly limit?: number;
  readonly offset?: number;
};

export type ScrapedListResponse = {
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly entries: readonly ScrapedEntry[];
};

export type CatalogResponse = {
  readonly version: string;
  readonly updatedAt: number;
  readonly digimons: readonly TemplateDigimon[];
};

export type AdminStats = {
  readonly users: number;
  readonly activeMatches: number;
  readonly catalogTemplates: number;
  readonly buildingBlueprints: number;
  readonly totalPlayerBuildings: number;
  readonly totalPlayerMons: number;
};

export type ShopItemKind = 'consumable' | 'cosmetic' | 'evolve' | 'building_placement' | 'ticket';

export type ShopItemView = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly priceCredits: number;
  readonly kind: ShopItemKind;
  readonly payload: Record<string, unknown>;
  readonly enabled: boolean;
  readonly createdAt: number;
};

export type ShopItemInput = {
  readonly name: string;
  readonly description?: string;
  readonly priceCredits: number;
  readonly kind: ShopItemKind;
  readonly payload?: Record<string, unknown>;
  readonly enabled?: boolean;
};

export type UserListEntry = {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly isAdmin: boolean;
  readonly disabled: boolean;
  readonly createdAt: number;
  readonly lastLoginAt: number | null;
  readonly credits: number;
  readonly monCount: number;
};

export type UserDetail = UserListEntry & {
  readonly updatedAt: number;
  readonly wallet: {
    readonly credits: number;
    readonly streakDay: number;
    readonly lastClaimAt: number | null;
    readonly premiumUntil: number | null;
    readonly updatedAt: number;
  } | null;
};

export type UserListResponse = {
  readonly users: readonly UserListEntry[];
  readonly total: number;
  readonly hasMore: boolean;
};

export type AdminRosterStatus = 'resting' | 'training' | 'party';

export type AdminRosterView = {
  readonly id: string;
  readonly userId: string;
  readonly ownerUsername: string | null;
  readonly catalogId: string;
  readonly catalogName: string | null;
  readonly catalogStage: string | null;
  readonly catalogPortrait: string | null;
  readonly nickname: string;
  readonly level: number;
  readonly xp: number;
  readonly statBonus: BaseStats;
  readonly mood: number;
  readonly status: AdminRosterStatus;
  readonly slot: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type RosterInput = {
  readonly nickname?: string;
  readonly level?: number;
  readonly xp?: number;
  readonly statBonus?: Partial<BaseStats>;
  readonly mood?: number;
  readonly status?: AdminRosterStatus;
  readonly slot?: number | null;
};

export type TemplateDraft = {
  readonly id: string;
  readonly name: string;
  readonly stage: Stage;
  readonly attribute: Attribute;
  readonly element: Element;
  readonly baseStats: BaseStats;
  readonly skillPool: readonly Skill[];
  readonly assets: {
    readonly portrait: string;
    readonly dot: string;
  };
  readonly sourceUrl?: string;
  readonly wikimonSlug?: string;
  readonly evolvesInto?: readonly string[];
};

export function getAdminStats(): Promise<AdminStats> {
  return apiFetch<AdminStats>('/api/admin/stats');
}

export function getCatalog(): Promise<CatalogResponse> {
  return apiFetch<CatalogResponse>('/api/catalog');
}

export function getScrapedList(query: ScrapedListQuery): Promise<ScrapedListResponse> {
  return apiFetch<ScrapedListResponse>(`/api/admin/scraped-list?${toQueryString(query)}`);
}

export function refreshScrapedList(): Promise<{ readonly entries: number }> {
  return apiFetch<{ readonly entries: number }>('/api/admin/scrape/refresh', { method: 'POST' });
}

export function addCatalogFromScraped(skullbotId: number, enrich: boolean): Promise<{ readonly template: TemplateDigimon }> {
  return apiFetch<{ readonly template: TemplateDigimon }>('/api/admin/catalog/from-scraped', { method: 'POST', body: { skullbotId, enrich } });
}

export function createCustomTemplate(template: TemplateDraft): Promise<{ readonly template: TemplateDigimon }> {
  return apiFetch<{ readonly template: TemplateDigimon }>('/api/admin/catalog/custom', { method: 'POST', body: template });
}

export function replaceTemplate(id: string, template: TemplateDraft): Promise<{ readonly template: TemplateDigimon }> {
  return apiFetch<{ readonly template: TemplateDigimon }>(`/api/admin/catalog/${encodeURIComponent(id)}`, { method: 'PUT', body: template });
}

export function deleteTemplate(id: string): Promise<{ readonly ok: true }> {
  return apiFetch<{ readonly ok: true }>(`/api/admin/catalog/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function downloadTemplateAssets(id: string): Promise<{ readonly result: Record<string, unknown> }> {
  return apiFetch<{ readonly result: Record<string, unknown> }>(`/api/admin/assets/${encodeURIComponent(id)}/download`, { method: 'POST' });
}

export function getShopItems(): Promise<{ readonly items: readonly ShopItemView[] }> {
  return apiFetch<{ readonly items: readonly ShopItemView[] }>('/api/admin/shop');
}

export function createShopItem(input: ShopItemInput): Promise<{ readonly ok: true; readonly item: ShopItemView }> {
  return apiFetch<{ readonly ok: true; readonly item: ShopItemView }>('/api/admin/shop', { method: 'POST', body: input });
}

export function updateShopItem(id: string, input: ShopItemInput): Promise<{ readonly ok: true; readonly item: ShopItemView }> {
  return apiFetch<{ readonly ok: true; readonly item: ShopItemView }>(`/api/admin/shop/${encodeURIComponent(id)}`, { method: 'PUT', body: input });
}

export function deleteShopItem(id: string): Promise<{ readonly ok: true; readonly item: { readonly id: string } }> {
  return apiFetch<{ readonly ok: true; readonly item: { readonly id: string } }>(`/api/admin/shop/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function getUsers(query: { readonly q?: string; readonly limit?: number; readonly offset?: number }): Promise<UserListResponse> {
  return apiFetch<UserListResponse>(`/api/admin/users?${toQueryString(query)}`);
}

export function updateUserFlags(id: string, flags: { readonly isAdmin?: boolean; readonly disabled?: boolean }): Promise<{ readonly ok: true; readonly user: UserDetail }> {
  return apiFetch<{ readonly ok: true; readonly user: UserDetail }>(`/api/admin/users/${encodeURIComponent(id)}/flags`, { method: 'PATCH', body: flags });
}

export function updateUserCredits(id: string, credits: number): Promise<{ readonly ok: true; readonly user: UserDetail }> {
  return apiFetch<{ readonly ok: true; readonly user: UserDetail }>(`/api/admin/users/${encodeURIComponent(id)}/credits`, { method: 'PATCH', body: { credits } });
}

export function getUserRoster(userId: string): Promise<{ readonly roster: readonly AdminRosterView[] }> {
  return apiFetch<{ readonly roster: readonly AdminRosterView[] }>(`/api/admin/users/${encodeURIComponent(userId)}/roster`);
}

export function spawnRosterMon(userId: string, input: { readonly catalogId: string; readonly nickname?: string; readonly level?: number }): Promise<{ readonly ok: true; readonly mon: AdminRosterView }> {
  return apiFetch<{ readonly ok: true; readonly mon: AdminRosterView }>(`/api/admin/users/${encodeURIComponent(userId)}/roster/spawn`, { method: 'POST', body: input });
}

export function updateRosterMon(monId: string, input: RosterInput): Promise<{ readonly ok: true; readonly mon: AdminRosterView }> {
  return apiFetch<{ readonly ok: true; readonly mon: AdminRosterView }>(`/api/admin/roster/${encodeURIComponent(monId)}`, { method: 'PATCH', body: input });
}

export function deleteRosterMon(monId: string): Promise<{ readonly ok: true; readonly mon: { readonly id: string } }> {
  return apiFetch<{ readonly ok: true; readonly mon: { readonly id: string } }>(`/api/admin/roster/${encodeURIComponent(monId)}`, { method: 'DELETE' });
}

export type SkillElement = 'fire' | 'water' | 'nature' | 'electric' | 'neutral';

export type SkillView = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly element: SkillElement;
  readonly energyCost: number;
  readonly cooldown?: number;
  readonly actions: readonly Record<string, unknown>[];
  readonly tags?: readonly string[];
  readonly animation?: string;
  readonly enabled?: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type SkillInput = {
  readonly name: string;
  readonly description?: string;
  readonly element: SkillElement;
  readonly energyCost: number;
  readonly cooldown?: number;
  readonly actions: readonly Record<string, unknown>[];
  readonly tags?: readonly string[];
  readonly animation?: string;
  readonly enabled?: boolean;
};

export function getSkills(): Promise<{ readonly skills: readonly SkillView[] }> {
  return apiFetch<{ readonly skills: readonly SkillView[] }>('/api/admin/skills');
}

export function createSkill(input: SkillInput): Promise<{ readonly ok: true; readonly skill: SkillView }> {
  return apiFetch<{ readonly ok: true; readonly skill: SkillView }>('/api/admin/skills', { method: 'POST', body: input });
}

export function updateSkill(id: string, input: SkillInput): Promise<{ readonly ok: true; readonly skill: SkillView }> {
  return apiFetch<{ readonly ok: true; readonly skill: SkillView }>(`/api/admin/skills/${encodeURIComponent(id)}`, { method: 'PUT', body: input });
}

export function deleteSkill(id: string): Promise<{ readonly ok: true; readonly id: string }> {
  return apiFetch<{ readonly ok: true; readonly id: string }>(`/api/admin/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

function toQueryString(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  return params.toString();
}
