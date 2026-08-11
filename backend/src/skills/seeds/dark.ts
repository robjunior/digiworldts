import { makeSkillFactory, type SkillSeed } from './types.js';

const d = makeSkillFactory('dark', 'dark');

export const DARK_SKILLS: SkillSeed[] = [
  // ---- Assassin ----
  d({
    idSuffix: 'assassin-r-1',
    name: 'Night Shank',
    name_pt: 'Estocada Noturna',
    description: 'A swift strike in the dark, targeting a single enemy.',
    description_pt: 'Um golpe rápido no escuro, mirando um único inimigo.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 7,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 18, scale: 'atk', factor: 1.07 }, element: 'dark' }
    ]
  }),
  d({
    idSuffix: 'assassin-r-2',
    name: 'Silent Step',
    name_pt: 'Passo Silencioso',
    description: 'Boosts own speed and critical hit chance.',
    description_pt: 'Aumenta a própria velocidade e chance de acerto crítico.',
    stage: 'Rookie',
    slot_role: 'buff_support',
    energyCost: 8,
    actions: [
      { kind: 'apply_buff', target: 'self', buff: 'spd_up', amount: 20, turns: 2 },
      { kind: 'apply_buff', target: 'self', buff: 'crit_up', amount: 15, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'assassin-r-3',
    name: 'Throat Slit',
    name_pt: 'Corte na Garganta',
    description: 'A vicious cut that deals more damage if the target is injured.',
    description_pt: 'Um corte cruel que causa mais dano se o alvo estiver ferido.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 10,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 22, scale: 'atk', factor: 0.89 }, element: 'dark' },
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 40 },
        then: [
          { kind: 'deal_damage', target: 'primary_target', amount: { base: 18, scale: 'atk', factor: 0.72 }, element: 'dark' }
        ]
      }
    ]
  }),
  d({
    idSuffix: 'assassin-c-1',
    name: 'Midnight Piercer',
    name_pt: 'Perfurador da Meia-Noite',
    description: 'A deeply penetrating strike that heavily damages one foe.',
    description_pt: 'Um golpe profundamente penetrante que fere gravemente um inimigo.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    upgrade_of: 'sk-dark-assassin-r-1',
    energyCost: 12,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 42, scale: 'atk', factor: 1.47 }, element: 'dark' }
    ]
  }),
  d({
    idSuffix: 'assassin-c-2',
    name: 'Shadow Meld',
    name_pt: 'Fusão Sombria',
    description: 'Melds into the shadows, increasing evasion and attack.',
    description_pt: 'Funde-se às sombras, aumentando evasão e ataque.',
    stage: 'Champion',
    slot_role: 'buff_support',
    upgrade_of: 'sk-dark-assassin-r-2',
    energyCost: 13,
    actions: [
      { kind: 'apply_buff', target: 'self', buff: 'evasion_up', amount: 25, turns: 2 },
      { kind: 'apply_buff', target: 'self', buff: 'atk_up', amount: 20, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'assassin-c-3',
    name: 'Fatal Ambush',
    name_pt: 'Emboscada Fatal',
    description: 'Strikes suddenly from stealth, delaying the targets next turn slightly.',
    description_pt: 'Ataca repentinamente da furtividade, atrasando levemente o próximo turno do alvo.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    upgrade_of: 'sk-dark-assassin-r-3',
    energyCost: 15,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'atk', factor: 1.83 }, element: 'dark' },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  d({
    idSuffix: 'assassin-u-1',
    name: 'Eclipse Dagger',
    name_pt: 'Adaga do Eclipse',
    description: 'Throws a dark blade that cuts through defenses of the front line.',
    description_pt: 'Arremessa uma lâmina sombria que corta as defesas da linha de frente.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    upgrade_of: 'sk-dark-assassin-c-1',
    energyCost: 15,
    actions: [
      { kind: 'deal_damage', target: 'enemy_front', amount: { base: 112, scale: 'atk', factor: 3.16 }, element: 'dark', ignore_defense: true }
    ]
  }),
  d({
    idSuffix: 'assassin-u-2',
    name: 'Unseen Terror',
    name_pt: 'Terror Invisível',
    description: 'Frightens the enemy front line, dealing damage and slightly knocking them back in turn order.',
    description_pt: 'Assusta a linha de frente inimiga, causando dano e empurrando-os levemente para trás.',
    stage: 'Ultimate',
    slot_role: 'utility',
    upgrade_of: 'sk-dark-assassin-c-2',
    energyCost: 16,
    actions: [
      { kind: 'deal_damage', target: 'enemy_front', amount: { base: 100, scale: 'atk', factor: 2.71 }, element: 'dark' },
      { kind: 'shift_initiative', target: 'enemy_front', delta: 1 }
    ]
  }),
  d({
    idSuffix: 'assassin-u-3',
    name: 'Guillotine Drop',
    name_pt: 'Queda da Guilhotina',
    description: 'An execution move. If the target is injured, it takes massive extra damage.',
    description_pt: 'Um movimento de execução. Se o alvo estiver ferido, recebe dano extra massivo.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    upgrade_of: 'sk-dark-assassin-c-3',
    energyCost: 20,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 135, scale: 'atk', factor: 3.38 }, element: 'dark' },
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 50 },
        then: [
          { kind: 'deal_damage', target: 'primary_target', amount: { base: 90, scale: 'atk', factor: 2.26 }, element: 'dark' }
        ]
      }
    ]
  }),
  d({
    idSuffix: 'assassin-m-1',
    name: 'Void Ripper',
    name_pt: 'Estripador do Vazio',
    description: 'Tears the fabric of space to assassinate a target.',
    description_pt: 'Rasga o tecido do espaço para assassinar um alvo.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    upgrade_of: 'sk-dark-assassin-u-1',
    energyCost: 24,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 50, scale: 'atk', factor: 1.15 }, element: 'dark', ignore_defense: true },
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 60 },
        then: [
          { kind: 'deal_damage', target: 'primary_target', amount: { base: 28, scale: 'atk', factor: 0.72 }, element: 'dark' }
        ]
      }
    ]
  }),
  d({
    idSuffix: 'assassin-m-2',
    name: 'Time Assassination',
    name_pt: 'Assassinato Temporal',
    description: 'Strikes from the future, delaying the target and dealing huge damage.',
    description_pt: 'Ataca do futuro, atrasando o alvo e causando dano enorme.',
    stage: 'Mega',
    slot_role: 'control',
    upgrade_of: 'sk-dark-assassin-u-2',
    energyCost: 28,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 47, scale: 'atk', factor: 0.99 }, element: 'dark' },
      { kind: 'shift_initiative', target: 'primary_target', delta: 2 }
    ]
  }),
  d({
    idSuffix: 'assassin-m-3',
    name: 'Reapers Toll',
    name_pt: 'Pedágio do Ceifador',
    description: 'The ultimate execution. Guarantees massive damage to a single enemy, bypassing defenses entirely.',
    description_pt: 'A execução final. Garante dano massivo a um único inimigo, ignorando completamente as defesas.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    upgrade_of: 'sk-dark-assassin-u-3',
    tier_2: true,
    cooldown: 2,
    energyCost: 35,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 80, scale: 'atk', factor: 1.78 }, element: 'dark', ignore_defense: true }
    ]
  }),

  // ---- Debuffer ----
  d({
    idSuffix: 'debuff-r-1',
    name: 'Gloom Hex',
    name_pt: 'Feitiço da Penumbra',
    description: 'A weak curse that lowers enemy speed.',
    description_pt: 'Uma maldição fraca que diminui a velocidade inimiga.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 8,
    actions: [
      { kind: 'modify_stat', target: 'enemy_random', stat: 'spd', delta: -10, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'debuff-r-2',
    name: 'Erosive Aura',
    name_pt: 'Aura Erosiva',
    description: 'Radiates an aura that lowers the defense of the front line.',
    description_pt: 'Irradia uma aura que reduz a defesa da linha de frente.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 9,
    actions: [
      { kind: 'modify_stat', target: 'enemy_front', stat: 'def', delta: -15, turns: 3 }
    ]
  }),
  d({
    idSuffix: 'debuff-r-3',
    name: 'Dimming Light',
    name_pt: 'Luz Ofuscante',
    description: 'A dark burst that hits a random enemy and has a chance to curse them.',
    description_pt: 'Uma explosão sombria que atinge um inimigo aleatório e tem chance de amaldiçoá-lo.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 7,
    actions: [
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 18, scale: 'int', factor: 0.89 }, element: 'dark' },
      { kind: 'apply_status', target: 'enemy_random', status: 'curse', chance: 0.5, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'debuff-c-1',
    name: 'Abyssal Shackles',
    name_pt: 'Grilhões Abissais',
    description: 'Binds the enemy front line in damaging shadows, lowering their speed and cursing them.',
    description_pt: 'Prende a linha de frente inimiga em sombras danosas, reduzindo sua velocidade e amaldiçoando-os.',
    stage: 'Champion',
    slot_role: 'control',
    upgrade_of: 'sk-dark-debuff-r-1',
    energyCost: 13,
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 42, scale: 'int', factor: 1.65 }, element: 'dark' },
      { kind: 'modify_stat', target: 'enemy_front', stat: 'spd', delta: -15, turns: 3 },
      { kind: 'apply_status', target: 'enemy_front', status: 'curse', chance: 0.5, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'debuff-c-2',
    name: 'Spell Breaker',
    name_pt: 'Quebrador de Feitiços',
    description: 'Dispels buffs from a target and deals moderate damage.',
    description_pt: 'Remove buffs de um alvo e causa dano moderado.',
    stage: 'Champion',
    slot_role: 'utility',
    upgrade_of: 'sk-dark-debuff-r-2',
    energyCost: 14,
    actions: [
      { kind: 'dispel', target: 'primary_target' },
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 46, scale: 'int', factor: 1.47 }, element: 'dark' }
    ]
  }),
  d({
    idSuffix: 'debuff-c-3',
    name: 'Suffocating Veil',
    name_pt: 'Véu Sufocante',
    description: 'A heavy dark veil lowers the attack and intelligence of all enemies.',
    description_pt: 'Um véu sombrio pesado reduz o ataque e a inteligência de todos os inimigos.',
    stage: 'Champion',
    slot_role: 'utility',
    upgrade_of: 'sk-dark-debuff-r-3',
    energyCost: 15,
    actions: [
      { kind: 'modify_stat', target: 'enemy_all', stat: 'atk', delta: -15, turns: 2 },
      { kind: 'modify_stat', target: 'enemy_all', stat: 'int', delta: -15, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'debuff-u-1',
    name: 'Total Eclipse',
    name_pt: 'Eclipse Total',
    description: 'Plunges the battlefield into darkness, damaging and cursing the enemy team.',
    description_pt: 'Mergulha o campo de batalha na escuridão, danificando e amaldiçoando a equipe inimiga.',
    stage: 'Ultimate',
    slot_role: 'control',
    upgrade_of: 'sk-dark-debuff-c-1',
    energyCost: 18,
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 146, scale: 'int', factor: 3.61 }, element: 'dark' },
      { kind: 'apply_status', target: 'enemy_all', status: 'weaken', chance: 0.8, turns: 3 }
    ]
  }),
  d({
    idSuffix: 'debuff-u-2',
    name: 'Sensory Deprivation',
    name_pt: 'Privação Sensorial',
    description: 'Strips the target of their senses, potentially silencing them and lowering their intelligence.',
    description_pt: 'Despoja o alvo de seus sentidos, silenciando-os potencialmente e diminuindo sua inteligência.',
    stage: 'Ultimate',
    slot_role: 'utility',
    upgrade_of: 'sk-dark-debuff-c-2',
    energyCost: 16,
    actions: [
      { kind: 'apply_status', target: 'primary_target', status: 'silence', chance: 0.3, turns: 2 },
      { kind: 'modify_stat', target: 'primary_target', stat: 'int', delta: -15, turns: 3 }
    ]
  }),
  d({
    idSuffix: 'debuff-u-3',
    name: 'Purge Hope',
    name_pt: 'Expurgar a Esperança',
    description: 'Dispels the enemy front line and crushes their defenses if they are cursed.',
    description_pt: 'Remove buffs da linha de frente inimiga e esmaga suas defesas se estiverem amaldiçoados.',
    stage: 'Ultimate',
    slot_role: 'utility',
    upgrade_of: 'sk-dark-debuff-c-3',
    energyCost: 20,
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 90, scale: 'int', factor: 2.26 }, element: 'dark' },
      { kind: 'dispel', target: 'enemy_front' },
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'curse' },
        then: [
          { kind: 'modify_stat', target: 'enemy_front', stat: 'def', delta: -40, turns: 3 }
        ]
      }
    ]
  }),
  d({
    idSuffix: 'debuff-m-1',
    name: 'Event Horizon',
    name_pt: 'Horizonte de Eventos',
    description: 'The absolute end of light. Deals massive damage, blinds, curses, and shatters enemy defenses.',
    description_pt: 'O fim absoluto da luz. Causa dano massivo, cega, amaldiçoa e estilhaça as defesas inimigas.',
    stage: 'Mega',
    slot_role: 'control',
    upgrade_of: 'sk-dark-debuff-u-1',
    tier_2: true,
    cooldown: 2,
    energyCost: 35,
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 50, scale: 'int', factor: 1.15 }, element: 'dark' },
      { kind: 'apply_status', target: 'enemy_all', status: 'blind', chance: 0.4, turns: 2 },
      { kind: 'apply_status', target: 'enemy_all', status: 'curse', chance: 0.8, turns: 3 },
      { kind: 'modify_stat', target: 'enemy_all', stat: 'def', delta: -50, turns: 3 }
    ]
  }),
  d({
    idSuffix: 'debuff-m-2',
    name: 'Absolute Despair',
    name_pt: 'Desespero Absoluto',
    description: 'Dispels all enemies and inflicts widespread corruption.',
    description_pt: 'Remove buffs de todos os inimigos e inflige corrupção generalizada.',
    stage: 'Mega',
    slot_role: 'utility',
    upgrade_of: 'sk-dark-debuff-u-2',
    energyCost: 28,
    actions: [
      { kind: 'dispel', target: 'enemy_all' },
      { kind: 'apply_status', target: 'enemy_all', status: 'corruption', chance: 0.6, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'debuff-m-3',
    name: 'Void Stare',
    name_pt: 'Olhar do Vazio',
    description: 'Stares into the targets soul, dealing heavy damage and applying long-lasting curses.',
    description_pt: 'Encara a alma do alvo, causando dano pesado e aplicando maldições duradouras.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-dark-debuff-u-3',
    energyCost: 26,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'int', factor: 1.25 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'curse', chance: 1.0, turns: 4 },
      { kind: 'apply_status', target: 'primary_target', status: 'corruption', chance: 0.7, turns: 3 }
    ]
  }),

  // ---- Drain ----
  d({
    idSuffix: 'drain-r-1',
    name: 'Soul Sip',
    name_pt: 'Gole de Alma',
    description: 'Sips a small amount of life from an enemy.',
    description_pt: 'Toma um pequeno gole de vida de um inimigo.',
    stage: 'Rookie',
    slot_role: 'sustain_dot',
    energyCost: 8,
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 22, scale: 'int', factor: 0.89 }, heal_pct: 0.1, element: 'dark' }
    ]
  }),
  d({
    idSuffix: 'drain-r-2',
    name: 'Vampiric Bite',
    name_pt: 'Mordida Vampírica',
    description: 'Bites the target for physical damage, restoring a little energy.',
    description_pt: 'Morde o alvo para dano físico, restaurando um pouco de energia.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 9,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 28, scale: 'atk', factor: 0.99 }, element: 'dark' },
      { kind: 'restore_en', target: 'self', amount: 2 }
    ]
  }),
  d({
    idSuffix: 'drain-r-3',
    name: 'Vitality Theft',
    name_pt: 'Roubo de Vitalidade',
    description: 'Steals life from the front line enemies to heal the user.',
    description_pt: 'Rouba vida dos inimigos da linha de frente para curar o usuário.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 10,
    actions: [
      { kind: 'drain', target: 'enemy_front', damage: { base: 14, scale: 'int', factor: 0.72 }, heal_pct: 0.1, element: 'dark' }
    ]
  }),
  d({
    idSuffix: 'drain-c-1',
    name: 'Essence Drain',
    name_pt: 'Dreno de Essência',
    description: 'Draws out the life essence of an enemy, healing the caster.',
    description_pt: 'Extrai a essência de vida de um inimigo, curando o lançador.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-dark-drain-r-1',
    energyCost: 14,
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 55, scale: 'int', factor: 1.65 }, heal_pct: 0.05, element: 'dark' }
    ]
  }),
  d({
    idSuffix: 'drain-c-2',
    name: 'Blood Hex',
    name_pt: 'Feitiço de Sangue',
    description: 'Curses the target and drains a portion of their health.',
    description_pt: 'Amaldiçoa o alvo e drena uma porção de sua saúde.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    upgrade_of: 'sk-dark-drain-r-2',
    energyCost: 13,
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 50, scale: 'int', factor: 1.47 }, heal_pct: 0.05, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'curse', chance: 0.6, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'drain-c-3',
    name: 'Parasitic Link',
    name_pt: 'Elo Parasitário',
    description: 'Links to a random enemy, draining health and restoring energy to the caster.',
    description_pt: 'Conecta-se a um inimigo aleatório, drenando saúde e restaurando energia para o lançador.',
    stage: 'Champion',
    slot_role: 'utility',
    upgrade_of: 'sk-dark-drain-r-3',
    energyCost: 15,
    actions: [
      { kind: 'drain', target: 'enemy_random', damage: { base: 46, scale: 'int', factor: 1.29 }, heal_pct: 0.05, element: 'dark' },
      { kind: 'restore_en', target: 'self', amount: 4 }
    ]
  }),
  d({
    idSuffix: 'drain-u-1',
    name: 'Life Syphon',
    name_pt: 'Sifão de Vida',
    description: 'A powerful vortex that syphons life from all enemies.',
    description_pt: 'Um vórtice poderoso que suga vida de todos os inimigos.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-dark-drain-c-1',
    energyCost: 18,
    actions: [
      { kind: 'drain', target: 'enemy_all', damage: { base: 90, scale: 'int', factor: 2.48 }, heal_pct: 0.05, element: 'dark' }
    ]
  }),
  d({
    idSuffix: 'drain-u-2',
    name: 'Devour Spirit',
    name_pt: 'Devorar Espírito',
    description: 'Bites into the targets spirit. Drains much more if the target is healthy.',
    description_pt: 'Morde o espírito do alvo. Drena muito mais se o alvo estiver saudável.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    upgrade_of: 'sk-dark-drain-c-2',
    energyCost: 19,
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 135, scale: 'int', factor: 3.16 }, heal_pct: 0.05, element: 'dark' },
      {
        kind: 'conditional',
        if: { kind: 'hp_above_pct', pct: 60 },
        then: [
          { kind: 'drain', target: 'primary_target', damage: { base: 90, scale: 'int', factor: 2.26 }, heal_pct: 0.05, element: 'dark' }
        ]
      }
    ]
  }),
  d({
    idSuffix: 'drain-u-3',
    name: 'Crimson Feast',
    name_pt: 'Banquete Carmesim',
    description: 'Drains energy and life from enemies, boosting the casters attack.',
    description_pt: 'Drena energia e vida dos inimigos, aumentando o ataque do lançador.',
    stage: 'Ultimate',
    slot_role: 'buff_support',
    upgrade_of: 'sk-dark-drain-c-3',
    energyCost: 20,
    actions: [
      { kind: 'drain', target: 'enemy_random', damage: { base: 112, scale: 'int', factor: 2.83 }, heal_pct: 0.05, element: 'dark' },
      { kind: 'apply_buff', target: 'self', buff: 'atk_up', amount: 30, turns: 3 }
    ]
  }),
  d({
    idSuffix: 'drain-m-1',
    name: 'Soul Devourer',
    name_pt: 'Devorador de Almas',
    description: 'The ultimate drain. Ravages all enemies, stealing their life force completely if they are healthy.',
    description_pt: 'O dreno supremo. Devasta todos os inimigos, roubando sua força vital completamente se estiverem saudáveis.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-dark-drain-u-1',
    tier_2: true,
    cooldown: 2,
    energyCost: 35,
    actions: [
      { kind: 'drain', target: 'enemy_all', damage: { base: 36, scale: 'int', factor: 0.89 }, heal_pct: 0.05, element: 'dark' },
      {
        kind: 'conditional',
        if: { kind: 'hp_above_pct', pct: 50 },
        then: [
          { kind: 'drain', target: 'enemy_all', damage: { base: 17, scale: 'int', factor: 0.5 }, heal_pct: 0.05, element: 'dark' }
        ]
      }
    ]
  }),
  d({
    idSuffix: 'drain-m-2',
    name: 'Blood Moon',
    name_pt: 'Lua de Sangue',
    description: 'Summons a crimson moon that massively damages a single target, converting it entirely to health.',
    description_pt: 'Invoca uma lua carmesim que causa dano massivo a um único alvo, convertendo-o inteiramente em saúde.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    upgrade_of: 'sk-dark-drain-u-2',
    energyCost: 30,
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 64, scale: 'int', factor: 1.51 }, heal_pct: 0.1, element: 'dark' }
    ]
  }),
  d({
    idSuffix: 'drain-m-3',
    name: 'Eternal Thirst',
    name_pt: 'Sede Eterna',
    description: 'Drains all enemies, dramatically boosting the casters speed and intelligence.',
    description_pt: 'Drena todos os inimigos, aumentando drasticamente a velocidade e a inteligência do lançador.',
    stage: 'Mega',
    slot_role: 'buff_support',
    upgrade_of: 'sk-dark-drain-u-3',
    energyCost: 32,
    actions: [
      { kind: 'drain', target: 'enemy_all', damage: { base: 28, scale: 'int', factor: 0.72 }, heal_pct: 0.05, element: 'dark' },
      { kind: 'apply_buff', target: 'self', buff: 'spd_up', amount: 40, turns: 3 },
      { kind: 'apply_buff', target: 'self', buff: 'int_up', amount: 40, turns: 3 }
    ]
  })
];
