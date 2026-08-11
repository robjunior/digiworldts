import { makeSkillFactory, type SkillSeed } from './types.js';

const p = makeSkillFactory('plant', 'plant');

export const PLANT_SKILLS: SkillSeed[] = [
  // ---- DoT ----
  p({
    idSuffix: 'dot-r-1',
    name: 'Toxic Seed',
    name_pt: 'Semente Tóxica',
    description: 'Plants a toxic seed that poisons the target.',
    description_pt: 'Planta uma semente tóxica que envenena o alvo.',
    stage: 'Rookie',
    slot_role: 'sustain_dot',
    energyCost: 7,
    actions: [
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 12, scale: 'int', factor: 1.01 }, element: 'plant' },
      { kind: 'apply_status', target: 'enemy_random', status: 'poison', chance: 0.8, turns: 1 }
    ]
  }),
  p({
    idSuffix: 'dot-r-2',
    name: 'Thorny Whip',
    name_pt: 'Chicote Espinhoso',
    description: 'Strikes with thorns, dealing damage and occasionally poisoning.',
    description_pt: 'Golpeia com espinhos, causando dano e envenenando ocasionalmente.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 9,
    actions: [
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 24, scale: 'int', factor: 1.26 }, element: 'plant' },
      { kind: 'apply_status', target: 'enemy_random', status: 'poison', chance: 0.3, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'dot-r-3',
    name: 'Creeping Mold',
    name_pt: 'Mofo Rastejante',
    description: 'Covers the enemy in mold, lowering defenses and cursing them.',
    description_pt: 'Cobre o inimigo com mofo, reduzindo defesas e amaldiçoando-os.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 10,
    actions: [
      { kind: 'modify_stat', target: 'enemy_random', stat: 'def', delta: -15, turns: 3 },
      { kind: 'apply_status', target: 'enemy_random', status: 'curse', chance: 0.5, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'dot-c-1',
    name: 'Venomous Bloom',
    name_pt: 'Floração Venenosa',
    description: 'A heavily toxic flower blooms, poisoning multiple targets.',
    description_pt: 'Uma flor altamente tóxica desabrocha, envenenando múltiplos alvos.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-plant-dot-r-1',
    energyCost: 12,
    actions: [
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 52, scale: 'int', factor: 1.84 }, element: 'plant' },
      { kind: 'apply_status', target: 'enemy_random', status: 'poison', chance: 0.6, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'dot-c-2',
    name: 'Acid Sap',
    name_pt: 'Seiva Ácida',
    description: 'Splashes corrosive sap. Deals extra damage if the target is poisoned.',
    description_pt: 'Respinga seiva corrosiva. Causa dano extra se o alvo estiver envenenado.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    upgrade_of: 'sk-plant-dot-r-2',
    energyCost: 12,
    actions: [
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 61, scale: 'int', factor: 2.05 }, element: 'plant' },
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'poison' },
        then: [
          { kind: 'deal_damage', target: 'enemy_random', amount: { base: 20, scale: 'int', factor: 0.52 }, element: 'plant' }
        ]
      }
    ]
  }),
  p({
    idSuffix: 'dot-c-3',
    name: 'Fungal Spores',
    name_pt: 'Esporos Fúngicos',
    description: 'Releases dark spores that curse the enemy frontline.',
    description_pt: 'Libera esporos sombrios que amaldiçoam a linha de frente inimiga.',
    stage: 'Champion',
    slot_role: 'utility',
    upgrade_of: 'sk-plant-dot-r-3',
    energyCost: 11,
    actions: [
      { kind: 'apply_status', target: 'enemy_front', status: 'curse', chance: 0.7, turns: 3 }
    ]
  }),
  p({
    idSuffix: 'dot-u-1',
    name: 'Lethal Blossom',
    name_pt: 'Pétala Letal',
    description: 'Unleashes a deadly pollen cloud, poisoning all enemies.',
    description_pt: 'Libera uma nuvem de pólen mortal, envenenando todos os inimigos.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    upgrade_of: 'sk-plant-dot-c-1',
    energyCost: 12,
    actions: [
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 68, scale: 'int', factor: 2.05 }, element: 'plant' },
      { kind: 'apply_status', target: 'enemy_random', status: 'poison', chance: 0.5, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'dot-u-2',
    name: 'Corrosive Vine',
    name_pt: 'Vinha Corrosiva',
    description: 'A thorny vine that drains life from the target and applies poison.',
    description_pt: 'Uma vinha espinhosa que drena a vida do alvo e aplica veneno.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-plant-dot-c-2',
    energyCost: 12,
    actions: [
      { kind: 'drain', target: 'enemy_random', damage: { base: 92, scale: 'int', factor: 2.51 }, heal_pct: 0.2, element: 'plant' },
      { kind: 'apply_status', target: 'enemy_random', status: 'poison', chance: 0.4, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'dot-u-3',
    name: 'Rotting Roots',
    name_pt: 'Raízes Apodrecidas',
    description: 'Crushes enemies with decaying roots, hitting harder if they are cursed.',
    description_pt: 'Esmaga os inimigos com raízes em decomposição, atingindo mais forte se estiverem amaldiçoados.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    upgrade_of: 'sk-plant-dot-c-3',
    energyCost: 13,
    actions: [
      { kind: 'deal_damage', target: 'enemy_front', amount: { base: 80, scale: 'int', factor: 2.05 }, element: 'plant' },
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'curse' },
        then: [
          { kind: 'deal_damage', target: 'enemy_front', amount: { base: 34, scale: 'int', factor: 0.8 }, element: 'plant' }
        ]
      }
    ]
  }),
  p({
    idSuffix: 'dot-m-1',
    name: 'World Eaters Flower',
    name_pt: 'Flor Devoradora de Mundos',
    description: 'The ultimate parasitic bloom ruptures across the enemy team, converting its toxins into immediate withering damage and a brief defense break.',
    description_pt: 'A floração parasita suprema rompe sobre a equipe inimiga, convertendo toxinas em dano debilitante imediato e uma breve quebra de defesa.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    upgrade_of: 'sk-plant-dot-u-1',
    tier_2: true,
    energyCost: 35,
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 71, scale: 'int', factor: 1.75 }, element: 'plant' },
      { kind: 'apply_buff', target: 'enemy_all', buff: 'def_down', amount: 18, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'dot-m-2',
    name: 'Bio-Toxin Drain',
    name_pt: 'Dreno Biotóxico',
    description: 'Drains heavy life from the priority target, converting toxic pressure into immediate recovery instead of another slow tick.',
    description_pt: 'Drena muita vida do alvo prioritário, convertendo pressão tóxica em recuperação imediata em vez de mais um efeito gradual.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-plant-dot-u-2',
    energyCost: 28,
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 109, scale: 'int', factor: 2.16 }, heal_pct: 0.24, element: 'plant' }
    ]
  }),
  p({
    idSuffix: 'dot-m-3',
    name: 'Natures Decay',
    name_pt: 'Decadência da Natureza',
    description: 'A catastrophic strike of pure decay that hits clean targets hard, then cuts through defense if poison has already taken hold.',
    description_pt: 'Um golpe catastrófico de pura decadência que atinge alvos limpos com força e atravessa defesas se o veneno já tiver se firmado.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    upgrade_of: 'sk-plant-dot-u-3',
    cooldown: 2,
    energyCost: 38,
    actions: [
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'poison' },
        then: [
          { kind: 'deal_damage', target: 'enemy_random', amount: { base: 111, scale: 'int', factor: 2.76 }, element: 'plant', ignore_defense: true }
        ],
        else: [
          { kind: 'deal_damage', target: 'enemy_random', amount: { base: 120, scale: 'int', factor: 2.4 }, element: 'plant' }
        ]
      }
    ]
  }),

  // ---- Healer ----
  p({
    idSuffix: 'heal-r-1',
    name: 'Healing Nectar',
    name_pt: 'Néctar Curativo',
    description: 'Drops of sweet nectar that heal a single ally.',
    description_pt: 'Gotas de néctar doce que curam um único aliado.',
    stage: 'Rookie',
    slot_role: 'buff_support',
    energyCost: 8,
    actions: [
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 41, scale: 'int', factor: 0.81 } }
    ]
  }),
  p({
    idSuffix: 'heal-r-2',
    name: 'Leaf Shield',
    name_pt: 'Escudo de Folhas',
    description: 'Wraps an ally in sturdy leaves, providing a protective shield.',
    description_pt: 'Envolve um aliado em folhas robustas, fornecendo um escudo protetor.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 9,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'shield_absorb', amount: 50, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'heal-r-3',
    name: 'Purifying Dew',
    name_pt: 'Orvalho Purificador',
    description: 'Sprinkles morning dew that cleanses ailments from an ally and makes them harder to hit.',
    description_pt: 'Asperge orvalho matinal que purifica doenças de um aliado e o torna mais difícil de acertar.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 7,
    actions: [
      { kind: 'cleanse', target: 'caster_ally_lowest_hp' },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'evasion_up', amount: 30, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'heal-c-1',
    name: 'Rejuvenating Pollen',
    name_pt: 'Pólen Rejuvenescedor',
    description: 'Scatters healing pollen to restore health to the most injured ally and shake off one ailment.',
    description_pt: 'Espalha pólen curativo para restaurar a saúde do aliado mais ferido e remover uma aflição.',
    stage: 'Champion',
    slot_role: 'buff_support',
    upgrade_of: 'sk-plant-heal-r-1',
    energyCost: 12,
    actions: [
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 63, scale: 'int', factor: 1.03 } },
      { kind: 'cleanse', target: 'caster_ally_lowest_hp' }
    ]
  }),
  p({
    idSuffix: 'heal-c-2',
    name: 'Photosynthesis',
    name_pt: 'Fotossíntese',
    description: 'Absorbs sunlight to restore a meaningful surge of energy to an ally and wrap them in a small leaf shield.',
    description_pt: 'Absorve a luz do sol para restaurar uma onda significativa de energia a um aliado e envolvê-lo em um pequeno escudo de folhas.',
    stage: 'Champion',
    slot_role: 'utility',
    upgrade_of: 'sk-plant-heal-r-2',
    energyCost: 12,
    actions: [
      { kind: 'restore_en', target: 'caster_ally_lowest_hp', amount: 14 },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'shield_absorb', amount: 35, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'heal-c-3',
    name: 'Bark Armor',
    name_pt: 'Armadura de Casca',
    description: 'Hardens the skin of the frontline, granting defense and a shield.',
    description_pt: 'Endurece a pele da linha de frente, concedendo defesa e um escudo.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    upgrade_of: 'sk-plant-heal-r-3',
    energyCost: 13,
    actions: [
      { kind: 'apply_buff', target: 'self', buff: 'shield_absorb', amount: 40, turns: 2 },
      { kind: 'modify_stat', target: 'self', stat: 'def', delta: 20, turns: 3 }
    ]
  }),
  p({
    idSuffix: 'heal-u-1',
    name: 'Tree of Life',
    name_pt: 'Árvore da Vida',
    description: 'Summons an ethereal tree to heavily heal the most injured ally, with bonus healing if they are critically wounded.',
    description_pt: 'Invoca uma árvore etérea para curar fortemente o aliado mais ferido, com cura bônus se estiver gravemente ferido.',
    stage: 'Ultimate',
    slot_role: 'buff_support',
    upgrade_of: 'sk-plant-heal-c-1',
    energyCost: 13,
    actions: [
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 118, scale: 'int', factor: 1.53 } },
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 40 },
        then: [
          { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 41, scale: 'int', factor: 0.51 } }
        ]
      }
    ]
  }),
  p({
    idSuffix: 'heal-u-2',
    name: 'Natures Blessing',
    name_pt: 'Bênção da Natureza',
    description: 'A profound blessing that cleanses ailments, restores health, and sharpens evasive movement.',
    description_pt: 'Uma bênção profunda que purifica doenças, restaura saúde e afia movimentos evasivos.',
    stage: 'Ultimate',
    slot_role: 'utility',
    upgrade_of: 'sk-plant-heal-c-2',
    energyCost: 12,
    actions: [
      { kind: 'cleanse', target: 'caster_ally_lowest_hp' },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'evasion_up', amount: 30, turns: 2 },
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 94, scale: 'int', factor: 1.13 } }
    ]
  }),
  p({
    idSuffix: 'heal-u-3',
    name: 'Sylvan Ward',
    name_pt: 'Guarda Silvestre',
    description: 'Creates a dense magical forest ward around the weakest ally, pairing a serious shield with brief damage reduction.',
    description_pt: 'Cria uma guarda mágica florestal densa ao redor do aliado mais frágil, combinando um escudo sério com breve redução de dano.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    upgrade_of: 'sk-plant-heal-c-3',
    energyCost: 17,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'shield_absorb', amount: 95, turns: 2 },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'damage_reduction', amount: 15, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'heal-m-1',
    name: 'Yggdrasils Embrace',
    name_pt: 'Abraço de Yggdrasil',
    description: 'The ultimate restorative magic, revitalizing the most injured ally, cleansing them, and boosting defenses.',
    description_pt: 'A magia restauradora suprema, revitalizando o aliado mais ferido, purificando-o e aumentando defesas.',
    stage: 'Mega',
    slot_role: 'buff_support',
    upgrade_of: 'sk-plant-heal-u-1',
    tier_2: true,
    energyCost: 35,
    actions: [
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 133, scale: 'int', factor: 1.65 } },
      { kind: 'cleanse', target: 'caster_ally_lowest_hp' },
      { kind: 'modify_stat', target: 'self', stat: 'def', delta: 15, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'heal-m-2',
    name: 'Forest Sanctuary',
    name_pt: 'Santuário Florestal',
    description: 'Turns the battlefield into a sacred forest, making an ally briefly invulnerable.',
    description_pt: 'Transforma o campo de batalha em uma floresta sagrada, tornando um aliado brevemente invulnerável.',
    stage: 'Mega',
    slot_role: 'utility',
    upgrade_of: 'sk-plant-heal-u-2',
    cooldown: 3,
    energyCost: 25,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'shield_absorb', amount: 150, turns: 2 },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'evasion_up', amount: 30, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'heal-m-3',
    name: 'Miracle Harvest',
    name_pt: 'Colheita Milagrosa',
    description: 'Channels profound earth energy to heal the whole party and help the weakest ally evade the next assault.',
    description_pt: 'Canaliza profunda energia da terra para curar toda a equipe e ajudar o aliado mais frágil a evitar o próximo ataque.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    upgrade_of: 'sk-plant-heal-u-3',
    cooldown: 4,
    energyCost: 40,
    actions: [
      { kind: 'heal', target: 'caster_ally_all', amount: { base: 59, scale: 'int', factor: 0.82 } },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'evasion_up', amount: 30, turns: 2 }
    ]
  }),

  // ---- Zone Control ----
  p({
    idSuffix: 'zone-r-1',
    name: 'Tangleweed',
    name_pt: 'Erva-Emaranhada',
    description: 'Summons rapid-growing weeds to root an enemy in place.',
    description_pt: 'Invoca ervas de crescimento rápido para enraizar um inimigo no lugar.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 8,
    actions: [
      { kind: 'apply_status', target: 'enemy_random', status: 'root', chance: 0.7, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'zone-r-2',
    name: 'Spore Cloud',
    name_pt: 'Nuvem de Esporos',
    description: 'Blows a cloud of irritating spores that blind the opponent.',
    description_pt: 'Sopra uma nuvem de esporos irritantes que cegam o oponente.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 7,
    actions: [
      { kind: 'apply_status', target: 'enemy_random', status: 'blind', chance: 0.6, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'zone-r-3',
    name: 'Snapping Trap',
    name_pt: 'Armadilha Mordedora',
    description: 'A hidden plant trap snaps shut, dealing damage and slowing the target.',
    description_pt: 'Uma armadilha de planta oculta se fecha, causando dano e retardando o alvo.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 9,
    actions: [
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 31, scale: 'int', factor: 1.26 }, element: 'plant' },
      { kind: 'modify_stat', target: 'enemy_random', stat: 'spd', delta: -15, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'zone-c-1',
    name: 'Restricting Vines',
    name_pt: 'Vinhas Restritivas',
    description: 'Thick vines wrap around enemies, rooting them and ruining their speed.',
    description_pt: 'Vinhas grossas envolvem os inimigos, enraizando-os e arruinando sua velocidade.',
    stage: 'Champion',
    slot_role: 'utility',
    upgrade_of: 'sk-plant-zone-r-1',
    energyCost: 12,
    actions: [
      { kind: 'apply_status', target: 'enemy_first_two', status: 'root', chance: 0.4, turns: 1 },
      { kind: 'modify_stat', target: 'enemy_random', stat: 'spd', delta: -10, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'zone-c-2',
    name: 'Paralyzing Stench',
    name_pt: 'Odor Paralisante',
    description: 'A foul-smelling flower paralyzes foes with its overwhelming scent.',
    description_pt: 'Uma flor de cheiro forte paralisa os inimigos com seu odor avassalador.',
    stage: 'Champion',
    slot_role: 'control',
    upgrade_of: 'sk-plant-zone-r-2',
    energyCost: 12,
    actions: [
      { kind: 'apply_status', target: 'enemy_first_two', status: 'stun', chance: 0.3, turns: 1 }
    ]
  }),
  p({
    idSuffix: 'zone-c-3',
    name: 'Flytrap Jaws',
    name_pt: 'Mandíbulas de Dioneia',
    description: 'Bites down hard on a target, draining life while rooting them in place.',
    description_pt: 'Morde com força um alvo, drenando vida enquanto o enraíza no lugar.',
    stage: 'Champion',
    slot_role: 'control',
    upgrade_of: 'sk-plant-zone-r-3',
    energyCost: 13,
    actions: [
      { kind: 'drain', target: 'enemy_random', damage: { base: 71, scale: 'int', factor: 2.05 }, heal_pct: 0.2, element: 'plant' },
      { kind: 'apply_status', target: 'enemy_random', status: 'root', chance: 0.5, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'zone-u-1',
    name: 'Forest Prison',
    name_pt: 'Prisão Florestal',
    description: 'Erupts the ground into a prison of wood, crushing the enemy front while roots and dragging vines hold it in place.',
    description_pt: 'Erupção no solo formando uma prisão de madeira, esmagando a frente inimiga enquanto raízes e vinhas a mantêm presa.',
    stage: 'Ultimate',
    slot_role: 'utility',
    upgrade_of: 'sk-plant-zone-c-1',
    energyCost: 13,
    actions: [
      { kind: 'deal_damage', target: 'enemy_front', amount: { base: 66, scale: 'int', factor: 1.65 }, element: 'plant' },
      { kind: 'apply_status', target: 'enemy_front', status: 'root', chance: 0.55, turns: 2 },
      { kind: 'modify_stat', target: 'enemy_front', stat: 'spd', delta: -15, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'zone-u-2',
    name: 'Petrifying Gaze',
    name_pt: 'Olhar Petrificante',
    description: 'An eerie bloom forces enemies to stare into it, petrifying them.',
    description_pt: 'Uma floração sinistra força os inimigos a encará-la, petrificando-os.',
    stage: 'Ultimate',
    slot_role: 'control',
    upgrade_of: 'sk-plant-zone-c-2',
    energyCost: 12,
    actions: [
      { kind: 'apply_status', target: 'enemy_random', status: 'petrify', chance: 0.5, turns: 1 }
    ]
  }),
  p({
    idSuffix: 'zone-u-3',
    name: 'Bramble Maze',
    name_pt: 'Labirinto de Sarças',
    description: 'Traps enemies in a thorny maze, dealing damage and delaying their turns.',
    description_pt: 'Prende inimigos em um labirinto espinhoso, causando dano e atrasando seus turnos.',
    stage: 'Ultimate',
    slot_role: 'control',
    upgrade_of: 'sk-plant-zone-c-3',
    energyCost: 17,
    actions: [
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 113, scale: 'int', factor: 2.85 }, element: 'plant' },
      { kind: 'shift_initiative', target: 'enemy_front', delta: 2 }
    ]
  }),
  p({
    idSuffix: 'zone-m-1',
    name: 'Jungles Grasp',
    name_pt: 'Aperto da Selva',
    description: 'The apex of battlefield control. An inescapable overgrowth that locks down enemies.',
    description_pt: 'O ápice do controle de campo de batalha. Um crescimento excessivo inescapável que trava os inimigos.',
    stage: 'Mega',
    slot_role: 'control',
    upgrade_of: 'sk-plant-zone-u-1',
    tier_2: true,
    energyCost: 32,
    actions: [
      { kind: 'apply_status', target: 'enemy_all', status: 'root', chance: 0.35, turns: 2 },
      { kind: 'modify_stat', target: 'enemy_random', stat: 'spd', delta: -30, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'zone-m-2',
    name: 'Eternal Slumber',
    name_pt: 'Sono Eterno',
    description: 'Releases a mystical twilight pollen that puts enemies to sleep and saps their magic.',
    description_pt: 'Libera um pólen místico de crepúsculo que faz os inimigos dormirem e drena sua magia.',
    stage: 'Mega',
    slot_role: 'control',
    upgrade_of: 'sk-plant-zone-u-2',
    energyCost: 28,
    actions: [
      { kind: 'apply_status', target: 'enemy_all', status: 'sleep', chance: 0.3, turns: 1 },
      { kind: 'modify_stat', target: 'enemy_random', stat: 'int', delta: -20, turns: 2 }
    ]
  }),
  p({
    idSuffix: 'zone-m-3',
    name: 'Ecosystem Lockdown',
    name_pt: 'Bloqueio do Ecossistema',
    description: 'Seizes complete control of the area. Rooted foes are crushed through their defenses; others are still battered and tangled for the next lockdown.',
    description_pt: 'Toma controle total da área. Inimigos enraizados são esmagados através das defesas; os demais ainda são golpeados e emaranhados para o próximo bloqueio.',
    stage: 'Mega',
    slot_role: 'control',
    upgrade_of: 'sk-plant-zone-u-3',
    cooldown: 3,
    energyCost: 38,
    actions: [
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'root' },
        then: [
          { kind: 'deal_damage', target: 'enemy_random', amount: { base: 111, scale: 'int', factor: 2.76 }, element: 'plant', ignore_defense: true }
        ],
        else: [
          { kind: 'deal_damage', target: 'enemy_random', amount: { base: 104, scale: 'int', factor: 2.16 }, element: 'plant' },
          { kind: 'apply_status', target: 'enemy_random', status: 'root', chance: 0.55, turns: 2 }
        ]
      }
    ]
  })
];
