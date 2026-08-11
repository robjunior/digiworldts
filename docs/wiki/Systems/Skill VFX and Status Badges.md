---
tags:
  - digiworld/system
  - digiworld/frontend
aliases:
  - VFX
  - Skill Effects
  - Status Badges
  - Buff Badges
created: 2026-08-11
updated: 2026-08-11
grounded-in:
  - scene3d/src/scene.ts
  - scene3d/src/skill-vfx-resolver.ts
  - backend/src/battle/dsl-runtime.ts
  - frontend/src/components/combat3d/Combat3DBody.tsx
  - frontend/src/components/combat3d/BuffBadgesLayer.tsx
  - frontend/src/components/combat3d/AilmentBadgesLayer.tsx
  - shared/src/battle.ts
verified-at-commit: c917d6a
---

# Skill VFX and Status Badges

How a skill's visual effect is chosen, carried to the client, and drawn — and
how a unit's ailments, buffs and debuffs are shown on top of it.

Balance work on the skills themselves lives in [[Skill Archetypes]]. The battle
engine that emits these events is [[Combat]].

## The pipeline

```
admin picks a preset ──▶ skills_catalog.vfx_preset_id
                              │
                    pool.ts maps to skill.vfxPresetId
                              │
            executeDSL threads it as SkillRef ──▶ every action event
                              │
                 Combat3DBody reads event.vfxPresetId
                              │
              SceneManager.playEffect(element, source, target, { vfxPresetId })
                              │
              preset runner  ◀── resolves? ──▶  per-element runner (fallback)
```

Presets themselves are **not** in the database. They live in
`data/scenes/skill-vfx-presets.json`, edited through `AdminSkillVfxEditor`, with
CRUD at `/api/skill-vfx-presets`. Skills reference one by opaque id
(`svfx_<26 chars>`), stored in `skills_catalog.vfx_preset_id`.

> [!important] Everything except the middle already existed
> The column, the client support, and the preset-vs-element fallback shipped
> long before this work. What was missing was the DSL carrying the id: it
> threaded a bare `skillName: string`, so `vfxPresetId` appeared **zero times**
> in `dsl-runtime.ts` and all 1264 catalog skills silently fell back to their
> element runner no matter what an admin selected. Fixed in `2b7c3d9` by
> replacing that parameter with a `SkillRef { name, vfxPresetId? }`.

Scheduled actions need the id as **data**, not a closure: `ScheduledAction` is
serialised into the cluster's `battle:snap:{matchId}` snapshot between actions,
so it is a field on the shared type and is rebuilt into a `SkillRef` when the
entry fires.

## Where effects are drawn

`playEffect` anchors on each sprite's extents rather than its centre
(`90d3fde`). `worldPosition` is the middle of the billboard, so anchoring there
made a projectile leave the attacker's midriff and land in the receiver's —
reading as passing through rather than being thrown at.

| | offset |
| --- | --- |
| origin | 0.18 of sprite height above centre, 0.45 of width toward the receiver |
| impact | 0.08 of height above the receiver's centre |
| no known source | falls from `UNSOURCED_DROP_HEIGHT` overhead |

Fractions of each sprite's own size, so they scale with the art. The forward
vector is flattened to XZ before normalising — raising the emitter must not tilt
the direction it fires in.

Multi-target needs nothing special: the DSL emits **one event per receiving
unit**, each naming its own target, so the client plays one attacker→receiver
effect per hit.

## Which events play an effect

Enemy-side events are queued and drained one at a time, `ATTACK_PROPAGATION_MS`
(700ms) apart. The local player's own actions bypass the queue entirely via
`extractPlayerVfx`, which has never had a damage gate.

Two rules govern playback, both learned the hard way:

1. **Misses stay silent.** `playEffect`'s impact callback fires `playHit` and
   flashes the target, so drawing an effect on a miss reads as a landed hit.
2. **One effect per cast.** A single skill can emit several events — a
   `deal_damage` plus an `apply_status` on the same target. Queue entries carry
   an explicit `playVfx` flag; the first event of a given actor/target/skill
   wins it, the rest still spawn floaters.

> [!warning] The damage gate silenced every support and debuff skill
> Until `6bbf475` playback required `damage > 0`. `apply_status`, `modify_stat`,
> `apply_buff`, `cleanse` and `dispel` all report `damage: 0`, and `heal`
> reports a negative — so a preset selected for a heal was inert. This was
> invisible from the admin side: the selector saved fine and simply never
> produced anything.

## Status badges

Two sibling layers, deliberately separate, because the data lives in two places:

| layer | reads | anchored |
| --- | --- | --- |
| `AilmentBadgesLayer` | `unit.ailments` (14 kinds) | `pos.y - 24`, grows down |
| `BuffBadgesLayer` | `unit.activeBuffs` (16 kinds) | below the ailment stack |

> [!danger] Debuffs are not ailments
> `atk_down`, `def_down`, `spd_down`, `int_down`, `accuracy_down` and
> `evasion_down` are `activeBuffs`, not `ailments`. Anyone looking only at
> `ailments` will conclude nothing has been debuffed.

`EnemyUnitView` carried `ailments` but not `activeBuffs`, so badges would have
worked for your own team and shown nothing on the enemy you had just debuffed.
`serializeForSide` now sends it. This is not a redaction regression — buff state
is visible in fiction, and the real redactions (EN, skills, atk/def/spd) are
unchanged and asserted as such in `test:dsl-runtime`.

### Two defects only a screenshot could find

The badge work was verified with a Playwright harness rendering the real markup
against the real stylesheet. It found what reasoning had not:

**Colour does not reach most icons.** `🛡 💨 🔮 🎯 🌀` are colour emoji — the
font paints them, so the `color` set by `.c3d-buff--up` / `--down` never lands.
Five of the six up/down pairs rendered pixel-identical apart from a 2px border
stripe. Only `⚔` behaved as documented, being a text glyph. Fixed in `c917d6a`
with a `▲`/`▼` marker, which is a text glyph and therefore survives colour being
absent entirely — verified against a fully desaturated render.

**A fixed vertical offset collided.** `.c3d-ailment-group` is
`flex-direction: column` anchored at -24, so it grows *downward*: two ailments
reach +15, three reach +36. Buffs sat at a fixed +6, inside the stack from two
ailments onward — exactly when both rows matter. The offset is now derived from
the unit's ailment count (`f2030cc`), holding 6px clearance at any depth.

> [!tip] The arrow only goes on kinds that have a counterpart
> A plain `endsWith('_up')` also matches `crit_up`, which has no `crit_down`.
> The first attempt put a gold-red arrow on it that read as a downgrade. The
> marker is derived from `BUFF_KINDS` so it stays correct if a counterpart is
> ever added.

## Open items

> [!question] Decisions, not defects — these need a human call
> - **AoE is staggered, not simultaneous.** Three targets means three effects
>   700ms apart, ~2.1s total. Reasonable for a chain attack; wrong if a single
>   blast was intended. The change would be to the `Combat3DBody` queue, not the
>   renderer.
> - **`Synapse Lock` has `chance: 1.0`.** A guaranteed status with no roll
>   offers no counterplay. It balances out, so it was left alone rather than
>   used as a balance lever — worth revisiting on its own terms.
> - **`shield_absorb` uses `🧿`**, a nazar amulet. It is distinct from `def_up`'s
>   `🛡`, which is the point, but "protection charm" is an odd read for a shield.

> [!todo] Unverified
> - **Badges have never been seen over moving sprites.** The harness validates
>   the badge; it does not validate the scene. Whether the screen-space anchor
>   tracks the camera cleanly, and whether the icons stay legible against bright
>   arena backgrounds, needs a real match.
> - **The admin has no `combat3d`**, so its copy of `extensions-combat3d.css` is
>   dead styling. Harmless, but it will drift from the frontend's copy.

## Related

- [[Combat]] — the engine that emits these events
- [[Skill Archetypes]] — skill design and the open balance work
- [[Skills catalog]] — `skills_catalog` schema and the pool queries
- [[Scenes]] — arena scene settings the renderer consumes
