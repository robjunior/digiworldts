import { makeSkillFactory, type SkillSeed } from './types.js';

const p = makeSkillFactory('plant', 'plant-sig');

export const PLANT_SIGNATURES: SkillSeed[] = [
  // ---- ExTyrannomon (skb-1, Ultimate) ----
  p({
    idSuffix: 'skb1-1',
    name: 'Stuffed Crush',
    name_pt: 'Esmagamento de Pelúcia',
    description: 'Crushes the foe with its heavy, vegetation-stuffed body.',
    description_pt: 'Esmaga o inimigo com seu corpo pesado cheio de vegetação.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-1',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 65, scale: 'atk', factor: 1.5 }, element: 'plant' }]
  }),
  p({
    idSuffix: 'skb1-2',
    name: 'Zipper Snag',
    name_pt: 'Zíper Enganchado',
    description: 'Traps the enemy in its massive zipper, rooting them in place.',
    description_pt: 'Prende o inimigo em seu zíper gigante, enraizando-o no lugar.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-1',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 45, scale: 'atk', factor: 1.0 }, element: 'plant' }, { kind: 'apply_status', target: 'primary_target', status: 'root', chance: 0.6, turns: 1 }]
  }),
  // ---- Palmon (skb-348, Rookie) ----
  p({
    idSuffix: 'skb348-1',
    name: 'Root Stretch',
    name_pt: 'Alongamento de Raiz',
    description: 'Slashes a foe with its claws.',
    description_pt: 'Corta um inimigo com suas garras.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-348',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb348-2',
    name: 'Poison Ivy (Palmon)',
    name_pt: 'Hera Venenosa',
    description: 'Entangles the foe in toxic vines that seep poison.',
    description_pt: 'Realiza um ataque físico. 20% de chance de aplicar Veneno.',
    stage: 'Rookie',
    slot_role: 'sustain_dot',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-348',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 45, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'primary_target', status: 'poison', chance: 0.3, turns: 2 }
      ]
  }),
  // ---- Kuwagamon (skb-367, Champion) ----
  p({
    idSuffix: 'skb367-1',
    name: 'Scissor Claw',
    name_pt: 'Garra Tesoura',
    description: 'Slashes with its giant jagged pincers.',
    description_pt: 'Realiza um ataque físico avassalador.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-367',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb367-2',
    name: 'Trap Scissors',
    name_pt: 'Tesouras Armadilha',
    description: 'Counters the attack of an enemy with its giant pincers.',
    description_pt: 'Contra-ataca o ataque de um inimigo com suas pinças gigantes.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-367',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'fire' }
      ]
  }),
  // ---- Sunflowmon (skb-58, Champion) ----
  p({
    idSuffix: 'skb58-1',
    name: 'Sunshine Beam',
    name_pt: 'Raio de Sol',
    description: 'Fires a concentrated beam of solar energy that immobilizes the foe.',
    description_pt: 'Realiza um ataque mágico do tipo Planta. Fica imobilizado no próximo turno.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-58',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 105, scale: 'int', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'primary_target', status: 'root', chance: 1.0, turns: 1 }
      ]
  }),
  p({
    idSuffix: 'skb58-2',
    name: 'Sunshine Gun',
    name_pt: 'Arma de Sol',
    description: 'Fires seeds at the enemy.',
    description_pt: 'Dispara sementes contra o inimigo.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-58',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'water' }
      ]
  }),
  // ---- Togemon (skb-349, Champion) ----
  p({
    idSuffix: 'skb349-1',
    name: 'Needle Spray (Togemon)',
    name_pt: 'Chuva de Agulhas',
    description: 'Shoots a barrage of toxic needles in all directions.',
    description_pt: 'Realiza um ataque físico do tipo Planta em todos os inimigos. 25% de chance de aplicar Veneno.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-349',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 50, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'enemy_all', status: 'poison', chance: 0.3, turns: 2 }
      ]
  }),
  p({
    idSuffix: 'skb349-2',
    name: 'Coconuts Punch',
    name_pt: 'Soco de Coco',
    description: 'A powerful punch. Repeatedly slams down on the enemy with its fists.',
    description_pt: 'Um soco poderoso. Golpeia repetidamente o inimigo com os punhos.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-349',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'water' }
      ]
  }),
  // ---- Woodmon (skb-393, Champion) ----
  p({
    idSuffix: 'skb393-1',
    name: 'Branch Drain',
    name_pt: 'Dreno de Galho',
    description: 'Drains the vitality of the enemy through its gnarled branches.',
    description_pt: 'Realiza um ataque físico. Recupera HP igual a 20% do dano causado.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-393',
    actions: [
        { kind: 'drain', target: 'primary_target', damage: { base: 65, scale: 'atk', factor: 1.2 }, heal_pct: 0.2, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb393-2',
    name: 'Drain Buster',
    name_pt: 'Buster Drenante',
    description: 'Uses poisonous arms to hit the enemy.',
    description_pt: 'Usa braços venenosos para atingir o inimigo.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-393',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'fire' }
      ]
  }),
  // ---- Arukenimon (skb-199, Ultimate) ----
  p({
    idSuffix: 'skb199-1',
    name: 'Spider Thread',
    name_pt: 'Fio de Aranha',
    description: 'Fires razor-sharp spider threads with high critical precision.',
    description_pt: 'Realiza um ataque físico. Ataque focado com alta taxa de acerto crítico.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-199',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 75, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb199-2',
    name: 'Widow Web',
    name_pt: 'Teia de Viúva',
    description: 'Spins a sticky trap to lower enemy speed and root them.',
    description_pt: 'Tece uma armadilha pegajosa para reduzir a velocidade do inimigo e enraizá-lo.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-199',
    actions: [{ kind: 'modify_stat', target: 'enemy_all', stat: 'spd', delta: -15, turns: 3 }, { kind: 'apply_status', target: 'enemy_all', status: 'root', chance: 0.25, turns: 1 }]
  }),
  // ---- Cherrymon (skb-379, Ultimate) ----
  p({
    idSuffix: 'skb379-1',
    name: 'Cherry Bomb',
    name_pt: 'Bomba de Cereja',
    description: 'Hurls explosive cherry bombs across the enemy line, the pulp splattering into a lingering poison.',
    description_pt: 'Realiza um ataque físico. 30% de chance de aplicar efeito negativo.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-379',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 90, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'enemy_all', status: 'poison', chance: 0.3, turns: 3 }
      ]
  }),
  p({
    idSuffix: 'skb379-2',
    name: 'Energy Absorption (Cherrymon)',
    name_pt: 'Absorção de Energia',
    description: 'Absorbs vitality from an enemy.',
    description_pt: 'Absorve vitalidade de um inimigo.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-379',
    actions: [
        { kind: 'drain', target: 'enemy_random', damage: { base: 70, scale: 'atk', factor: 1.2 }, heal_pct: 0.2, element: 'fire' }
      ]
  }),
  // ---- Deramon (skb-378, Ultimate) ----
  p({
    idSuffix: 'skb378-1',
    name: 'Royal Nuts',
    name_pt: 'Nozes Reais',
    description: 'Fires royal nuts that shatter upon impact.',
    description_pt: 'Realiza um ataque físico. Dano aumentado contra certos alvos.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-378',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb378-2',
    name: 'Bird Song',
    name_pt: 'Canção de Pássaro',
    description: 'Sings a melody that lulls enemies to sleep.',
    description_pt: 'Canta uma melodia que faz os inimigos dormirem.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-378',
    actions: [{ kind: 'apply_status', target: 'enemy_all', status: 'sleep', chance: 0.35, turns: 1 }]
  }),
  // ---- Dinobeemon (skb-23, Ultimate) ----
  p({
    idSuffix: 'skb23-1',
    name: 'Hell Masquerade',
    name_pt: 'Baile Infernal',
    description: 'Performs a deadly dance, eviscerating foes with rapid strikes.',
    description_pt: 'Realiza um ataque físico do tipo Planta. Devasta oponentes desprevenidos.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-23',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 75, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb23-2',
    name: 'Savage Dance',
    name_pt: 'Dança Selvagem',
    description: 'A frantic aerial dance that cuts through multiple foes.',
    description_pt: 'Uma dança aérea frenética que corta múltiplos inimigos.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-23',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 45, scale: 'atk', factor: 1.3 }, element: 'plant' }]
  }),
  // ---- JewelBeemon (skb-484, Ultimate) ----
  p({
    idSuffix: 'skb484-1',
    name: 'Spike Buster',
    name_pt: 'Buster de Espinhos',
    description: 'Thrusts its spear with immense force, piercing magical protections.',
    description_pt: 'Realiza um ataque físico. Anula desvantagens temporárias.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-484',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 75, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb484-2',
    name: 'Emerald Spear',
    name_pt: 'Lança de Esmeralda',
    description: 'Pierces the enemy with a gem-like spear of hardened plant matter.',
    description_pt: 'Perfura o inimigo com uma lança semelhante a uma joia de matéria vegetal endurecida.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-484',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 85, scale: 'atk', factor: 1.7 }, element: 'plant', ignore_defense: true }]
  }),
  // ---- Lilamon (skb-73, Ultimate) ----
  p({
    idSuffix: 'skb73-1',
    name: 'Lila Shower',
    name_pt: 'Chuva de Lilás',
    description: 'Showers the enemy in a beautiful but deadly downpour of petals.',
    description_pt: 'Realiza um ataque mágico do tipo Planta.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-73',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 70, scale: 'int', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb73-2',
    name: 'Lovely Cologne',
    name_pt: 'Colônia Adorável',
    description: 'Charms the enemy with a sweet smell.',
    description_pt: 'Encanta o inimigo com um cheiro doce.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-73',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'water' }
      ]
  }),
  // ---- Lillymon (skb-359, Ultimate) ----
  p({
    idSuffix: 'skb359-1',
    name: 'Flower Cannon',
    name_pt: 'Canhão de Flor',
    description: 'Transforms its hands into a cannon and fires a paralyzing blast of energy.',
    description_pt: 'Realiza um ataque mágico do tipo Planta. 30% de chance de aplicar Atordoamento.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-359',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 80, scale: 'int', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.3, turns: 1 }
      ]
  }),
  p({
    idSuffix: 'skb359-2',
    name: 'Fairy Vine',
    name_pt: 'Videira Fada',
    description: 'Stabs the enemy with a thorny vine extended from its wrist.',
    description_pt: 'Apunhala o inimigo com uma videira espinhosa estendida de seu pulso.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-359',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  // ---- MegaKabuterimon (skb-305, Ultimate) ----
  p({
    idSuffix: 'skb305-1',
    name: 'Horn Buster',
    name_pt: 'Buster de Chifre',
    description: 'Charges with its massive horn, the impact leaving the target too rattled to keep pace.',
    description_pt: 'Investe com seu chifre imenso; o impacto deixa o alvo abalado demais para manter o ritmo.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-305',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 80, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'modify_stat', target: 'primary_target', stat: 'spd', delta: -20, turns: 3 }
      ]
  }),
  p({
    idSuffix: 'skb305-2',
    name: 'Horn Cannon',
    name_pt: 'Canhão de Chifre',
    description: 'Fires a powerful electric blast from its massive horn.',
    description_pt: 'Dispara uma poderosa explosão elétrica de seu chifre gigante.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-305',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 75, scale: 'int', factor: 1.5 }, element: 'electricity' }]
  }),
  // ---- Ceresmon (skb-176, Mega) ----
  p({
    idSuffix: 'skb176-1',
    name: 'Island Freefall (Ceresmon)',
    name_pt: 'Queda Livre da Ilha',
    description: 'Drops a massive chunk of land on the enemy, risking instant death.',
    description_pt: 'Realiza um ataque físico do tipo Planta. 10% de chance de Amaldiçoar.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-176',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 90, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'enemy_all', status: 'curse', chance: 0.1, turns: 2 }
      ]
  }),
  p({
    idSuffix: 'skb176-2',
    name: 'Famis (Ceresmon)',
    name_pt: 'Famis',
    description: 'Scatters a deadly poison mist over all enemies.',
    description_pt: 'Realiza um ataque mágico do tipo Planta. 25% de chance de aplicar Veneno Mortal.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-176',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 90, scale: 'int', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'enemy_all', status: 'poison', chance: 0.25, turns: 4 }
      ]
  }),
  // ---- GranKuwagamon (skb-423, Mega) ----
  p({
    idSuffix: 'skb423-1',
    name: 'Dimension Scissor',
    name_pt: 'Tesoura Dimensional',
    description: 'Cuts through the very fabric of space to strike the enemy.',
    description_pt: 'Realiza um ataque físico do tipo Planta. Golpe preciso.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-423',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 100, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb423-2',
    name: 'Kuáng Zhǎn Zhìcái',
    name_pt: 'Punição Cortante',
    description: 'Executes a flawless slashing sanction.',
    description_pt: 'Executa uma sanção cortante impecável.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-423',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 90, scale: 'atk', factor: 1.2 }, element: 'electricity' }
      ]
  }),
  // ---- Rosemon (skb-57, Mega) ----
  p({
    idSuffix: 'skb57-1',
    name: 'Thorn Whip',
    name_pt: 'Chicote de Espinhos',
    description: 'Lashes the enemy with an energized thorn whip, stealing their energy.',
    description_pt: 'Realiza um ataque mágico. Recupera energia com base no dano causado.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-57',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 90, scale: 'int', factor: 1.2 }, element: 'plant' },
        { kind: 'restore_en', target: 'self', amount: 15 }
      ]
  }),
  p({
    idSuffix: 'skb57-2',
    name: 'Forbidden Temptation',
    name_pt: 'Tentação Proibida',
    description: 'Releases a beautiful but destructive wave of rose energy.',
    description_pt: 'Realiza um ataque mágico do tipo Planta. Dano devastador em área.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-57',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 90, scale: 'int', factor: 1.2 }, element: 'plant' }
      ]
  }),
  // ---- Monzaemon (skb-61, Ultimate) ----
  p({
    idSuffix: 'skb61-1',
    name: 'Silence Hug',
    name_pt: 'Abraço do Silêncio',
    description: 'Grabs the foe with both paws.',
    description_pt: 'Agarra o inimigo com ambas as patas.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-61',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb61-2',
    name: 'Love Song',
    name_pt: 'Canção de Amor',
    description: 'Charms the enemy with a song filled with love.',
    description_pt: 'Encanta o inimigo com uma canção cheia de amor.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-61',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  // ---- Okuwamon (skb-401, Ultimate) ----
  p({
    idSuffix: 'skb401-1',
    name: 'Double Scissor Claw',
    name_pt: 'Dupla Garra Tesoura',
    description: 'Strikes with both massive claws simultaneously to pierce defenses.',
    description_pt: 'Realiza um ataque físico do tipo Planta.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-401',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 85, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb401-2',
    name: 'Scissor Storm',
    name_pt: 'Tempestade de Tesouras',
    description: 'Unleashes a barrage of slashing energy waves.',
    description_pt: 'Libera uma enxurrada de ondas de energia cortantes.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-401',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 55, scale: 'atk', factor: 1.3 }, element: 'plant' }]
  }),
  // ---- Pumpkinmon (skb-596, Ultimate) ----
  p({
    idSuffix: 'skb596-1',
    name: 'Trick or Treat',
    name_pt: 'Gostosuras ou Travessuras',
    description: 'Casts a spooky spell that may injure the target.',
    description_pt: 'Realiza um ataque mágico. 25% de chance de Enfraquecer.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-596',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 80, scale: 'int', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.25, turns: 2 }
      ]
  }),
  p({
    idSuffix: 'skb596-2',
    name: 'Surprise',
    name_pt: 'Surpresa',
    description: 'Headbutts the enemy with the ax in its head, surprises them with a shout, or summons an exploding pumpkin.',
    description_pt: 'Dá uma cabeçada no inimigo com o machado em sua cabeça.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-596',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'water' }
      ]
  }),
  // ---- MarineAngemon (skb-24, Mega) ----
  p({
    idSuffix: 'skb24-1',
    name: 'Extra Smile',
    name_pt: 'Sorriso Extra',
    description: 'Radiates patterns of rainbow light to damage the opponent.',
    description_pt: 'Irradia padrões de luz do arco-íris para danificar o oponente.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-24',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 90, scale: 'atk', factor: 1.2 }, element: 'light' }
      ]
  }),
  p({
    idSuffix: 'skb24-2',
    name: 'Ocean Love',
    name_pt: 'Amor do Oceano',
    description: 'Heals allies with a wave of gentle ocean water.',
    description_pt: 'Cura os aliados com uma onda de água suave do oceano.',
    stage: 'Mega',
    slot_role: 'utility',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-24',
    actions: [{ kind: 'heal', target: 'caster_ally_all', amount: { base: 80, scale: 'int', factor: 1.8 } }, { kind: 'cleanse', target: 'caster_ally_all' }]
  }),
  // ---- Venusmon (skb-172, Mega) ----
  p({
    idSuffix: 'skb172-1',
    name: 'Peace Fantasia',
    name_pt: 'Fantasia de Paz',
    description: 'Has Olive prick the opponent in the head, making it have peaceful intentions no matter what kind of ferocious personality it has.',
    description_pt: 'Faz Olive picar a cabeça do oponente, dando-lhe intenções pacíficas não importa quão feroz seja sua personalidade.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-172',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 90, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb172-2',
    name: 'LOVE YOU',
    name_pt: 'AMO VOCÊ',
    description: 'Blows a kiss that makes the opponents who receive it fall over from the shock.',
    description_pt: 'Manda um beijo que faz o oponente cair de choque.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-172',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 90, scale: 'atk', factor: 1.2 }, element: 'electricity' }
      ]
  }),
  // ---- Kudamon (skb-53, Rookie) ----
  p({
    idSuffix: 'skb53-1',
    name: 'Holy Cartridge',
    name_pt: 'Cartucho Sagrado',
    description: 'Fires a burst of holy energy from its earring.',
    description_pt: 'Dispara uma rajada de energia sagrada de seu brinco.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-53',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 40, scale: 'int', factor: 1.2 }, element: 'light' }]
  }),
  p({
    idSuffix: 'skb53-2',
    name: 'Scroll Wrap',
    name_pt: 'Pergaminho Envolvente',
    description: 'Wraps the target in a mystical scroll, sealing their movements.',
    description_pt: 'Envolve o alvo em um pergaminho místico, selando seus movimentos.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-53',
    actions: [{ kind: 'apply_status', target: 'primary_target', status: 'silence', chance: 0.5, turns: 2 }]
  }),
  // ---- Lalamon (skb-56, Rookie) ----
  p({
    idSuffix: 'skb56-1',
    name: 'Seed Blast',
    name_pt: 'Explosão de Semente',
    description: 'Fires a rapid burst of hard seeds.',
    description_pt: 'Realiza um ataque físico do tipo Planta.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-56',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 90, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb56-2',
    name: 'Nuts Gun',
    name_pt: 'Arma de Nozes',
    description: 'A more powerful version of Nuts Shoot .',
    description_pt: 'Uma versão mais poderosa do Tiro de Nozes.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-56',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'water' }
      ]
  }),
  // ---- Stingmon (skb-91, Champion) ----
  p({
    idSuffix: 'skb91-1',
    name: 'Spiking Strike',
    name_pt: 'Golpe Perfurante',
    description: 'Delivers a precise, spiking blow that hits vulnerable spots.',
    description_pt: 'Realiza um ataque físico. Eficaz contra alvos lentos.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-91',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 65, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb91-2',
    name: 'Moon Shooter',
    name_pt: 'Atirador Lunar',
    description: 'Fires the spikes on its arms.',
    description_pt: 'Dispara os espinhos de seus braços.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-91',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'electricity' }
      ]
  }),
  // ---- Jupitermon (skb-168, Mega) ----
  p({
    idSuffix: 'skb168-1',
    name: 'Wide Plasment',
    name_pt: 'Plasma Amplo',
    description: 'Unleashes a wide field of high-voltage plasma.',
    description_pt: 'Realiza um ataque físico do tipo Eletricidade.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-168',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 90, scale: 'atk', factor: 1.2 }, element: 'electricity' }
      ]
  }),
  p({
    idSuffix: 'skb168-2',
    name: 'Thunder Verdict',
    name_pt: 'Veredito do Trovão',
    description: 'Summons divine thunder to smite the wicked.',
    description_pt: 'Invoca um trovão divino para castigar os ímpios.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-168',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 65, scale: 'int', factor: 1.5 }, element: 'electricity' }, { kind: 'apply_status', target: 'enemy_all', status: 'stun', chance: 0.25, turns: 1 }]
  }),
  // ---- Aegiochusmon: Green (skb-188, Ultimate) ----
  p({
    idSuffix: 'skb188-1',
    name: 'Bramble Bite',
    name_pt: 'Mordida de Espinheiro',
    description: 'Bites with thorny jaws, absorbing the health and energy of the target.',
    description_pt: 'Realiza um ataque físico. Recupera HP e Energia.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-188',
    actions: [
        { kind: 'drain', target: 'primary_target', damage: { base: 85, scale: 'atk', factor: 1.2 }, heal_pct: 0.2, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb188-2',
    name: 'Plant Zone Cradle',
    name_pt: 'Berço da Zona Vegetal',
    description: 'Summons a mystical cradle of vegetation that lulls enemies to sleep.',
    description_pt: 'Realiza um ataque mágico. 30% de chance de aplicar Sono.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-188',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 70, scale: 'int', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'enemy_all', status: 'sleep', chance: 0.3, turns: 1 }
      ]
  }),
  // ---- Ceresmon Medium (skb-189, Mega) ----
  p({
    idSuffix: 'skb189-1',
    name: 'Famis (Ceresmon Medium)',
    name_pt: 'Famis',
    description: 'Scatters a deadly poison mist over all enemies.',
    description_pt: 'Realiza um ataque mágico do tipo Planta. 25% de chance de aplicar Veneno Mortal.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-189',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 90, scale: 'int', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'enemy_all', status: 'poison', chance: 0.25, turns: 4 }
      ]
  }),
  p({
    idSuffix: 'skb189-2',
    name: 'Island Freefall (Ceresmon Medium)',
    name_pt: 'Queda Livre da Ilha',
    description: 'Drops a massive chunk of land on the enemy, risking instant death.',
    description_pt: 'Realiza um ataque físico do tipo Planta. 10% de chance de Amaldiçoar.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 24,
    signature: true,
    owner_template_id: 'skb-189',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 90, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'enemy_all', status: 'curse', chance: 0.1, turns: 2 }
      ]
  }),
  // ---- Dobermon (skb-222, Champion) ----
  p({
    idSuffix: 'skb222-1',
    name: 'Grau Lärm',
    name_pt: 'Grau Lärm',
    description: 'Howls a cursed roar that seals the abilities of the enemy.',
    description_pt: 'Uiva um rugido amaldiçoado que sela as habilidades do inimigo.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-222',
    actions: [{ kind: 'apply_status', target: 'enemy_all', status: 'silence', chance: 0.35, turns: 2 }]
  }),
  p({
    idSuffix: 'skb222-2',
    name: 'Schwarz Strahl',
    name_pt: 'Raio Sombrio',
    description: 'Fires a dark beam that pierces through defenses.',
    description_pt: 'Dispara um raio sombrio que perfura defesas.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-222',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'int', factor: 1.4 }, element: 'dark', ignore_defense: true }]
  }),
  // ---- Grizzlymon (skb-235, Champion) ----
  p({
    idSuffix: 'skb235-1',
    name: 'Crescent Dawn',
    name_pt: 'Aurora Crescente',
    description: 'Tears into the enemy with crescent moon-shaped claws.',
    description_pt: 'Despedaça o inimigo com garras em forma de lua crescente.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-235',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 50, scale: 'atk', factor: 1.6 }, element: 'earth' }]
  }),
  p({
    idSuffix: 'skb235-2',
    name: 'Maul Attack',
    name_pt: 'Ataque de Mutilação',
    description: 'A relentless series of heavy bear strikes.',
    description_pt: 'Uma série implacável de golpes pesados de urso.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-235',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 70, scale: 'atk', factor: 1.8 }, element: 'earth' }]
  }),
  // ---- Renamon (skb-391, Rookie) ----
  p({
    idSuffix: 'skb391-1',
    name: 'Diamond Storm',
    name_pt: 'Tempestade de Diamantes',
    description: 'Summons a storm of razor-sharp diamond-hard leaves.',
    description_pt: 'Realiza um ataque mágico do tipo Planta.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-391',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 50, scale: 'int', factor: 1.2 }, element: 'plant' }
      ]
  }),
  p({
    idSuffix: 'skb391-2',
    name: 'Tōhakken',
    name_pt: 'Punho de Fogo Azul',
    description: 'Ignites its hands and feet in blue fire and attacks the enemy with them.',
    description_pt: 'Incendeia suas mãos e pés em fogo azul e ataca o inimigo com um golpe poderoso.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-391',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'fire' }
      ]
  }),
  // ---- Wormmon (skb-392, Rookie) ----
  p({
    idSuffix: 'skb392-1',
    name: 'Sticky Net',
    name_pt: 'Rede Pegajosa',
    description: 'Spits a sticky net that severely slows the target down.',
    description_pt: 'Realiza um ataque físico do tipo Planta. Reduz atributos.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-392',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 40, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'modify_stat', target: 'primary_target', stat: 'spd', delta: -40, turns: 3 }
      ]
  }),
  p({
    idSuffix: 'skb392-2',
    name: 'Silk Thread Attack',
    name_pt: 'Ataque Fio de Seda',
    description: 'Slaps the foe with a strand of silk.',
    description_pt: 'Bate no inimigo com um fio de seda.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-392',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'electricity' }
      ]
  }),
  // ---- Flymon (skb-586, Champion) ----
  p({
    idSuffix: 'skb586-1',
    name: 'Brown Stingers',
    name_pt: 'Ferrões Marrons',
    description: 'Fires toxic stingers that can paralyze the target.',
    description_pt: 'Realiza um ataque físico do tipo Planta. 10% de chance de causar Atordoamento.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-586',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 60, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.1, turns: 1 }
      ]
  }),
  p({
    idSuffix: 'skb586-2',
    name: 'Toxic Needle',
    name_pt: 'Agulha Tóxica',
    description: 'Stabs with a venomous stinger that weakens the target.',
    description_pt: 'Apunhala com um ferrão venenoso que enfraquece o alvo.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-586',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 45, scale: 'atk', factor: 1.2 }, element: 'plant' }, { kind: 'apply_status', target: 'primary_target', status: 'poison', chance: 0.7, turns: 3 }]
  }),
  // ---- Dokugumon (skb-592, Champion) ----
  p({
    idSuffix: 'skb592-1',
    name: 'Venom Blast',
    name_pt: 'Explosão de Veneno',
    description: 'Unleashes a blast of venom that is fatal to already poisoned targets.',
    description_pt: 'Realiza um ataque físico do tipo Planta. Dano bônus em alvos envenenados.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-592',
    actions: [
        { kind: 'deal_damage', target: 'primary_target', amount: { base: 60, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'conditional', if: { kind: 'has_status', status: 'poison' }, then: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 45, scale: 'atk', factor: 0.8 }, element: 'plant' }] }
      ]
  }),
  p({
    idSuffix: 'skb592-2',
    name: 'Poison Sting',
    name_pt: 'Ferroada Venenosa',
    description: 'A lethal toxic sting.',
    description_pt: 'Realiza uma ferroada tóxica letal.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-592',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'plant' }
      ]
  }),
  // ---- Mushroomon (skb-607, Rookie) ----
  p({
    idSuffix: 'skb607-1',
    name: 'Fungus Crusher',
    name_pt: 'Esmagador de Fungos',
    description: 'Crushes the enemy with toxic fungal spores.',
    description_pt: 'Realiza um ataque físico do tipo Planta em área. 30% de chance de aplicar Veneno.',
    stage: 'Rookie',
    slot_role: 'sustain_dot',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-607',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 35, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'enemy_all', status: 'poison', chance: 0.3, turns: 2 }
      ]
  }),
  p({
    idSuffix: 'skb607-2',
    name: 'Hakai no Kinoko Bakudan',
    name_pt: 'Bomba de Cogumelo Destrutiva',
    description: 'Throws explosive grenades in the shape of mushrooms.',
    description_pt: 'Lança granadas explosivas na forma de cogumelos.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-607',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'fire' }
      ]
  }),
  // ---- Floramon (skb-611, Rookie) ----
  p({
    idSuffix: 'skb611-1',
    name: 'Rain of Pollen',
    name_pt: 'Chuva de Pólen',
    description: 'Calls down a rain of hallucinogenic pollen to confuse enemies.',
    description_pt: 'Realiza um ataque mágico do tipo Planta em área. 20% de chance de aplicar Confusão.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-611',
    actions: [
        { kind: 'deal_damage', target: 'enemy_all', amount: { base: 35, scale: 'int', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'enemy_all', status: 'confusion', chance: 0.2, turns: 2 }
      ]
  }),
  p({
    idSuffix: 'skb611-2',
    name: 'Poison Ivy (Floramon)',
    name_pt: 'Hera Venenosa',
    description: 'Wraps the target in toxic ivy.',
    description_pt: 'Envolve o alvo com hera tóxica.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-611',
    actions: [
        { kind: 'deal_damage', target: 'enemy_random', amount: { base: 70, scale: 'atk', factor: 1.2 }, element: 'plant' },
        { kind: 'apply_status', target: 'enemy_random', status: 'poison', chance: 0.2, turns: 3 }
      ]
  }),
];