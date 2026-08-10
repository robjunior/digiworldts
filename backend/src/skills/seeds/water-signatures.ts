import { makeSkillFactory, type SkillSeed } from './types.js';

const w = makeSkillFactory('water', 'water-sig');

export const WATER_SIGNATURES: SkillSeed[] = [
  // ---- Lunamon (skb-2, Rookie) ----
  w({
    idSuffix: 'skb2-1',
    name: 'Tearing Shot',
    name_pt: 'Disparo Dilacerante',
    description: 'Fires a sharp pulse of lunar water magic into a single foe.',
    description_pt: 'Dispara um pulso afiado de magia lunar aquática contra um inimigo.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-2',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'int', factor: 1.2 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb2-2',
    name: 'Lop-ear Ripple',
    name_pt: 'Onda de Orelhas Caídas',
    description: 'Twirls its ears to swallow the target in a vortex of moonlit bubbles.',
    description_pt: 'Gira as orelhas para engolir o alvo em um vórtice de bolhas ao luar.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 10,
    signature: true,
    owner_template_id: 'skb-2',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 40, scale: 'int', factor: 1.35 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'root', chance: 0.35, turns: 1 }
    ]
  }),
  // ---- Lekismon (skb-3, Champion) ----
  w({
    idSuffix: 'skb3-1',
    name: 'Moon Night Bomb',
    name_pt: 'Bomba da Noite Lunar',
    description: 'Drops a water-magic lunar bomb that can lull the enemy to sleep.',
    description_pt: 'Lança uma bomba lunar de magia aquática que pode fazer o inimigo dormir.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-3',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 42, scale: 'int', factor: 1.3 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'sleep', chance: 0.3, turns: 1 }
    ]
  }),
  w({
    idSuffix: 'skb3-2',
    name: 'Lunar Foam Snare',
    name_pt: 'Laço de Espuma Lunar',
    description: 'Spins crescent foam around the foe, slowing their legs and pushing their next move back.',
    description_pt: 'Gira espuma crescente ao redor do inimigo, atrasando suas pernas e empurrando sua próxima ação.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-3',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'spd', factor: 1.2 }, element: 'water' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'spd', delta: -15, turns: 3 },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  // ---- Gomamon (skb-343, Rookie) ----
  w({
    idSuffix: 'skb343-1',
    name: 'Marching Fishes',
    name_pt: 'Peixes Marchantes',
    description: 'Summons a school of small fish to slam into one enemy in formation.',
    description_pt: 'Invoca um cardume de pequenos peixes para atingir um inimigo em formação.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-343',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 38, scale: 'atk', factor: 1.3 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb343-2',
    name: 'Sharp Edge',
    name_pt: 'Gume Afiado',
    description: 'Leaps into the air and repeatedly slices the enemy with wind-cutting claws.',
    description_pt: 'Salta no ar e corta o inimigo repetidamente com garras que rasgam o vento.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-343',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 35, scale: 'atk', factor: 1.3 }, element: 'wind' }]
  }),
  // ---- Gawappamon (skb-51, Champion) ----
  w({
    idSuffix: 'skb51-1',
    name: 'DJ Shooter',
    name_pt: 'Atirador DJ',
    description: 'Fires a beat-driven water shot from its disc weapon into a single target.',
    description_pt: 'Dispara um tiro de água ritmado de sua arma de disco contra um alvo.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-51',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'atk', factor: 1.5 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb51-2',
    name: 'Kappa Deck Splash',
    name_pt: 'Splash do Deck Kappa',
    description: 'Scratches a DJ rhythm across its dish, splashing enemies and throwing off their timing.',
    description_pt: 'Arranha um ritmo de DJ em seu prato, encharcando inimigos e bagunçando seu tempo.',
    stage: 'Champion',
    slot_role: 'utility',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-51',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 28, scale: 'atk', factor: 1.1 }, element: 'water' },
      { kind: 'shift_initiative', target: 'enemy_all', delta: 1 }
    ]
  }),
  // ---- Brachiomon (skb-724, Ultimate) ----
  w({
    idSuffix: 'skb724-1',
    name: 'Brachio Bubble',
    name_pt: 'Bolha Braquio',
    description: 'Blows huge ancient bubbles that burst across the enemy formation.',
    description_pt: 'Sopra bolhas antigas gigantes que estouram sobre a formação inimiga.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-724',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 48, scale: 'atk', factor: 1.4 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb724-2',
    name: 'Lagoon Tail Sweep',
    name_pt: 'Varredura de Cauda da Lagoa',
    description: 'Sweeps its plesiosaur tail through the lagoon, knocking the enemy line off balance.',
    description_pt: 'Varre a lagoa com sua cauda de plesiossauro, desequilibrando a linha inimiga.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-724',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 40, scale: 'atk', factor: 1.2 }, element: 'water' },
      { kind: 'apply_status', target: 'enemy_all', status: 'root', chance: 0.3, turns: 1 }
    ]
  }),
  // ---- Dragomon (skb-129, Ultimate) ----
  w({
    idSuffix: 'skb129-1',
    name: 'Forbidden Trident',
    name_pt: 'Tridente Proibido',
    description: 'Impales one enemy with a forbidden trident and converts the impact into recovered energy.',
    description_pt: 'Empala um inimigo com um tridente proibido e converte o impacto em energia recuperada.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-129',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 70, scale: 'atk', factor: 1.6 }, element: 'water' },
      { kind: 'restore_en', target: 'self', amount: 10 }
    ]
  }),
  w({
    idSuffix: 'skb129-2',
    name: 'Abyssal Tithe',
    name_pt: 'Dízimo Abissal',
    description: 'Demands tribute from the abyss, draining a foe through cursed seawater.',
    description_pt: 'Exige tributo do abismo, drenando um inimigo por água marinha amaldiçoada.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-129',
    actions: [{ kind: 'drain', target: 'primary_target', damage: { base: 58, scale: 'int', factor: 1.4 }, heal_pct: 0.25, element: 'water' }]
  }),
  // ---- JumboGamemon (skb-98, Mega) ----
  w({
    idSuffix: 'skb98-1',
    name: 'Megaton Hydro Laser',
    name_pt: 'Laser Hidro Megaton',
    description: 'Fires a heavy hydro laser from its cannons, punching through poor matchups with raw pressure.',
    description_pt: 'Dispara um laser hidro pesado de seus canhões, superando desvantagens por pura pressão.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 33,
    signature: true,
    owner_template_id: 'skb-98',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 92, scale: 'atk', factor: 2.0 }, element: 'water', ignore_defense: true }]
  }),
  w({
    idSuffix: 'skb98-2',
    name: 'Jumbo Crater',
    name_pt: 'Cratera Jumbo',
    description: 'Stomps the battlefield hard enough to blast every enemy with crater debris.',
    description_pt: 'Pisa no campo de batalha com força suficiente para lançar detritos de cratera em todos os inimigos.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-98',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 58, scale: 'atk', factor: 1.7 }, element: 'null' }]
  }),
  // ---- Neptunemon (skb-75, Mega) ----
  w({
    idSuffix: 'skb75-1',
    name: 'Vortex Penetration',
    name_pt: 'Penetração do Vórtice',
    description: 'Drives the King’s Bite through one enemy with an unavoidable piercing vortex.',
    description_pt: 'Crava a Mordida do Rei em um inimigo com um vórtice perfurante inevitável.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-75',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 96, scale: 'atk', factor: 2.1 }, element: 'water', ignore_defense: true }]
  }),
  w({
    idSuffix: 'skb75-2',
    name: 'Wave of Depth',
    name_pt: 'Onda das Profundezas',
    description: 'Rolls a deep-sea wave over all enemies, crushing their resistance to water.',
    description_pt: 'Lança uma onda das profundezas sobre todos os inimigos, esmagando sua resistência à água.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-75',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 54, scale: 'atk', factor: 1.5 }, element: 'water' },
      { kind: 'modify_stat', target: 'enemy_all', stat: 'def', delta: -25, turns: 3 }
    ]
  }),
  // ---- Scorpiomon (skb-605, Ultimate) ----
  w({
    idSuffix: 'skb605-1',
    name: 'Stinger Surprise',
    name_pt: 'Surpresa do Ferrão',
    description: 'Strikes twice with hidden aquatic stingers, cursing already-disoriented prey.',
    description_pt: 'Ataca duas vezes com ferrões aquáticos ocultos, amaldiçoando presas já desorientadas.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-605',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'atk', factor: 1.3 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'curse', chance: 0.25, turns: 2 }
    ]
  }),
  w({
    idSuffix: 'skb605-2',
    name: 'Reef Venom Barb',
    name_pt: 'Farpa Venenosa do Recife',
    description: 'Injects reef venom through a barbed claw, poisoning the target beneath the tide.',
    description_pt: 'Injeta veneno de recife por uma garra farpada, envenenando o alvo sob a maré.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-605',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 52, scale: 'atk', factor: 1.3 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'poison', chance: 0.55, turns: 3 }
    ]
  }),
  // ---- Shaujinmon (skb-76, Ultimate) ----
  w({
    idSuffix: 'skb76-1',
    name: 'Kouyoujou: Hydro Descent',
    name_pt: 'Kouyoujou: Descida Hidro',
    description: 'Calls a sorcerous water descent that crashes down across all enemies.',
    description_pt: 'Invoca uma descida aquática de feitiçaria que desaba sobre todos os inimigos.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-76',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 50, scale: 'int', factor: 1.45 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb76-2',
    name: 'Sanzou River Seal',
    name_pt: 'Selo do Rio Sanzou',
    description: 'Plants a monk’s water seal on the enemy team, binding their movement with sacred current.',
    description_pt: 'Marca a equipe inimiga com um selo aquático de monge, prendendo seus movimentos com corrente sagrada.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-76',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 34, scale: 'int', factor: 1.2 }, element: 'water' },
      { kind: 'apply_status', target: 'enemy_all', status: 'root', chance: 0.35, turns: 1 }
    ]
  }),
  // ---- Whamon (skb-21, Ultimate) ----
  w({
    idSuffix: 'skb21-1',
    name: 'Tidal Wave',
    name_pt: 'Maremoto',
    description: 'Raises a massive tide that batters all enemies and erodes their defenses.',
    description_pt: 'Ergue uma maré gigantesca que golpeia todos os inimigos e desgasta suas defesas.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-21',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 45, scale: 'int', factor: 1.4 }, element: 'water' },
      { kind: 'modify_stat', target: 'enemy_all', stat: 'def', delta: -20, turns: 3 }
    ]
  }),
  w({
    idSuffix: 'skb21-2',
    name: 'Whale Song Current',
    name_pt: 'Corrente do Canto da Baleia',
    description: 'Sings through the sea to steady one wounded ally and pull danger away from them.',
    description_pt: 'Canta através do mar para estabilizar um aliado ferido e afastar o perigo dele.',
    stage: 'Ultimate',
    slot_role: 'utility',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-21',
    actions: [
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 120, scale: 'int', factor: 1.4 } },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'damage_reduction', amount: 20, turns: 2 }
    ]
  }),
  // ---- Leviamon (skb-37, Mega) ----
  w({
    idSuffix: 'skb37-1',
    name: 'Biting Crush',
    name_pt: 'Mordida Esmagadora',
    description: 'Clamps down with demonic jaws, crushing one enemy through sheer force.',
    description_pt: 'Fecha mandíbulas demoníacas, esmagando um inimigo com força bruta.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-37',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 105, scale: 'atk', factor: 2.2 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb37-2',
    name: 'Tail Strike',
    name_pt: 'Golpe de Cauda',
    description: 'Sweeps its colossal tail across all enemies, cursing prey whose defenses have already cracked.',
    description_pt: 'Varre todos os inimigos com sua cauda colossal, amaldiçoando presas cujas defesas já cederam.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-37',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 55, scale: 'atk', factor: 1.6 }, element: 'water' },
      { kind: 'apply_status', target: 'enemy_all', status: 'curse', chance: 0.2, turns: 2 }
    ]
  }),
  // ---- Kamemon (skb-52, Rookie) ----
  w({
    idSuffix: 'skb52-1',
    name: 'Pointer Arrow',
    name_pt: 'Flecha Indicadora',
    description: 'Launches an accurate water arrow from its pointer arm at one enemy.',
    description_pt: 'Lança uma flecha aquática precisa de seu braço indicador contra um inimigo.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-52',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'atk', factor: 1.25 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb52-2',
    name: 'Koura Guard',
    name_pt: 'Guarda de Casco',
    description: 'Tucks into its shell and rebounds attacks with a sturdy turtle guard.',
    description_pt: 'Recolhe-se no casco e rebate ataques com uma guarda resistente de tartaruga.',
    stage: 'Rookie',
    slot_role: 'buff_support',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-52',
    actions: [
      { kind: 'apply_buff', target: 'self', buff: 'shield_absorb', amount: 55, turns: 2 },
      { kind: 'apply_buff', target: 'self', buff: 'def_up', amount: 15, turns: 3 }
    ]
  }),
  // ---- Volcanomon (skb-59, Ultimate) ----
  w({
    idSuffix: 'skb59-1',
    name: 'Volcano Bass Drop',
    name_pt: 'Grave Vulcânico',
    description: 'Drops a volcanic bass note through its speakers, blasting the enemy line with boiling surf.',
    description_pt: 'Solta uma nota grave vulcânica pelos alto-falantes, explodindo a linha inimiga com arrebentação fervente.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-59',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 48, scale: 'atk', factor: 1.45 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb59-2',
    name: 'Boiling Reef Breaker',
    name_pt: 'Quebra-Recife Fervente',
    description: 'Channels geothermal seawater into a close-range breaker that burns and weakens one foe.',
    description_pt: 'Canaliza água marinha geotérmica em uma arrebentação próxima que queima e enfraquece um inimigo.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-59',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 56, scale: 'atk', factor: 1.35 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'burn', chance: 0.35, turns: 2 },
      { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.35, turns: 2 }
    ]
  }),
  // ---- Crabmon (skb-103, Rookie) ----
  w({
    idSuffix: 'skb103-1',
    name: 'Scissors Execution',
    name_pt: 'Execução Tesoura',
    description: 'Snaps its claws shut on a confused foe, carrying a cursed execution risk.',
    description_pt: 'Fecha suas garras sobre um inimigo confuso, trazendo risco de execução amaldiçoada.',
    stage: 'Rookie',
    slot_role: 'sustain_dot',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-103',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'atk', factor: 1.2 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'curse', chance: 0.25, turns: 2 }
    ]
  }),
  w({
    idSuffix: 'skb103-2',
    name: 'Bubble Claw Trap',
    name_pt: 'Armadilha de Garra e Bolha',
    description: 'Pins the target between foaming bubbles and crab claws, stopping their escape.',
    description_pt: 'Prende o alvo entre bolhas espumantes e garras de caranguejo, impedindo sua fuga.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-103',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 28, scale: 'atk', factor: 1.1 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'root', chance: 0.45, turns: 1 }
    ]
  }),
  // ---- Coelamon (skb-130, Champion) ----
  w({
    idSuffix: 'skb130-1',
    name: 'Fossil Bite',
    name_pt: 'Mordida Fóssil',
    description: 'Bites with ancient fish jaws, cursing prey already thrown into confusion.',
    description_pt: 'Morde com mandíbulas de peixe antigo, amaldiçoando presas já confusas.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-130',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 48, scale: 'atk', factor: 1.35 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'curse', chance: 0.25, turns: 2 }
    ]
  }),
  w({
    idSuffix: 'skb130-2',
    name: 'Destructive Spear',
    name_pt: 'Lança Destrutiva',
    description: 'Fires a spear of compressed water that pierces straight through one enemy.',
    description_pt: 'Dispara uma lança de água comprimida que perfura diretamente um inimigo.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-130',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 60, scale: 'atk', factor: 1.6 }, element: 'water', ignore_defense: true }]
  }),
  // ---- Submarimon (skb-145, Rookie) ----
  w({
    idSuffix: 'skb145-1',
    name: 'Oxygen Homing',
    name_pt: 'Míssil de Oxigênio Teleguiado',
    description: 'Launches homing oxygen torpedoes that splash across all enemies.',
    description_pt: 'Lança torpedos de oxigênio teleguiados que explodem sobre todos os inimigos.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 10,
    signature: true,
    owner_template_id: 'skb-145',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 24, scale: 'atk', factor: 1.0 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb145-2',
    name: 'Aqua Vulcan',
    name_pt: 'Vulcan Aquático',
    description: 'Rakes the target with rapid-fire water bullets from its armored hull.',
    description_pt: 'Metralha o alvo com disparos rápidos de água de seu casco blindado.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-145',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 35, scale: 'atk', factor: 1.25 }, element: 'water' }]
  }),
  // ---- Lanamon (skb-162, Rookie) ----
  w({
    idSuffix: 'skb162-1',
    name: 'Rain Stream (Lanamon)',
    name_pt: 'Corrente de Chuva',
    description: 'Commands a focused rain stream of water magic into one foe.',
    description_pt: 'Comanda uma corrente de chuva concentrada de magia aquática contra um inimigo.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 10,
    signature: true,
    owner_template_id: 'skb-162',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 40, scale: 'int', factor: 1.4 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb162-2',
    name: 'Titanic Charge (Lanamon)',
    name_pt: 'Investida Titânica',
    description: 'Surges forward with a titanic body check that knocks the enemy off tempo.',
    description_pt: 'Avança com uma investida titânica que tira o inimigo do ritmo.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-162',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'atk', factor: 1.2 }, element: 'null' },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  // ---- Sirenmon (skb-232, Ultimate) ----
  w({
    idSuffix: 'skb232-1',
    name: 'Symphony No. 3',
    name_pt: 'Sinfonia Nº 3',
    description: 'Performs a cutting wind symphony that focuses all force into one target.',
    description_pt: 'Executa uma sinfonia cortante de vento que concentra toda a força em um alvo.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-232',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 72, scale: 'int', factor: 1.6 }, element: 'wind' }]
  }),
  w({
    idSuffix: 'skb232-2',
    name: 'Siren Undertow Aria',
    name_pt: 'Ária da Ressaca da Sereia',
    description: 'Sings an undertow aria that pulls enemies into drowsy currents.',
    description_pt: 'Canta uma ária de ressaca que puxa inimigos para correntes sonolentas.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-232',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 34, scale: 'int', factor: 1.15 }, element: 'water' },
      { kind: 'apply_status', target: 'enemy_all', status: 'sleep', chance: 0.35, turns: 1 }
    ]
  }),
  // ---- Koromon (skb-322, In-Training) ----
  w({
    idSuffix: 'skb322-1',
    name: 'Bubbles',
    name_pt: 'Bolhas',
    description: 'Spits a small cluster of bubbles into one enemy.',
    description_pt: 'Cospe um pequeno grupo de bolhas contra um inimigo.',
    stage: 'In-Training',
    slot_role: 'primary_attack',
    energyCost: 5,
    signature: true,
    owner_template_id: 'skb-322',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 22, scale: 'atk', factor: 0.8 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb322-2',
    name: 'Poyoyon Tackle',
    name_pt: 'Investida Poyoyon',
    description: 'Softly bounces its whole body into the opponent with surprising force.',
    description_pt: 'Quica suavemente com o corpo inteiro contra o oponente com força surpreendente.',
    stage: 'In-Training',
    slot_role: 'identity_finisher',
    energyCost: 6,
    signature: true,
    owner_template_id: 'skb-322',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 27, scale: 'atk', factor: 0.95 }, element: 'null' }]
  }),
  // ---- Shellmon (skb-368, Champion) ----
  w({
    idSuffix: 'skb368-1',
    name: 'Hydro Blaster',
    name_pt: 'Explosão Hidro',
    description: 'Blasts one foe with water magic, hitting harder after Shellmon raises its guard.',
    description_pt: 'Explode magia aquática contra um inimigo, batendo mais forte após Shellmon erguer sua guarda.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-368',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 50, scale: 'int', factor: 1.45 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb368-2',
    name: 'Spin Shelter',
    name_pt: 'Abrigo Giratório',
    description: 'Tucks into its shell and spins in a zig-zag path, shielding itself before impact.',
    description_pt: 'Recolhe-se no casco e gira em zigue-zague, protegendo-se antes do impacto.',
    stage: 'Champion',
    slot_role: 'buff_support',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-368',
    actions: [
      { kind: 'apply_buff', target: 'self', buff: 'evasion_up', amount: 25, turns: 3 },
      { kind: 'apply_buff', target: 'self', buff: 'shield_absorb', amount: 85, turns: 2 },
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 30, scale: 'def', factor: 1.0 }, element: 'water' }
    ]
  }),
  // ---- Motimon (skb-388, In-Training) ----
  w({
    idSuffix: 'skb388-1',
    name: 'Elastic Bubbles',
    name_pt: 'Bolhas Elásticas',
    description: 'Spits elastic bubbles that bounce into one enemy.',
    description_pt: 'Cospe bolhas elásticas que quicam contra um inimigo.',
    stage: 'In-Training',
    slot_role: 'primary_attack',
    energyCost: 5,
    signature: true,
    owner_template_id: 'skb-388',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 22, scale: 'atk', factor: 0.8 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb388-2',
    name: 'Shinshukusei no Awa',
    name_pt: 'Bolhas de Elasticidade',
    description: 'Launches stretchy bubbles that cling to the opponent and slow their movement.',
    description_pt: 'Lança bolhas flexíveis que grudam no oponente e reduzem seu movimento.',
    stage: 'In-Training',
    slot_role: 'control',
    energyCost: 6,
    signature: true,
    owner_template_id: 'skb-388',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 18, scale: 'atk', factor: 0.75 }, element: 'water' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'spd', delta: -10, turns: 2 }
    ]
  }),
  // ---- Gekomon (skb-399, Champion) ----
  w({
    idSuffix: 'skb399-1',
    name: 'Symphony Crusher',
    name_pt: 'Esmagador Sinfônico',
    description: 'Crushes a sleepy target with a focused blast of amphibian water magic.',
    description_pt: 'Esmaga um alvo sonolento com uma rajada concentrada de magia aquática anfíbia.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-399',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 52, scale: 'int', factor: 1.45 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'sleep', chance: 0.2, turns: 1 }
    ]
  }),
  w({
    idSuffix: 'skb399-2',
    name: 'Noisy Echo',
    name_pt: 'Eco Barulhento',
    description: 'Inhales deeply and blasts enemies with a mouth-born echo that ruins their focus.',
    description_pt: 'Inspira fundo e explode inimigos com um eco da boca que arruína sua concentração.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-399',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 28, scale: 'int', factor: 1.1 }, element: 'fire' },
      { kind: 'apply_status', target: 'enemy_all', status: 'confusion', chance: 0.3, turns: 2 }
    ]
  }),
  // ---- Tsunomon (skb-438, In-Training) ----
  w({
    idSuffix: 'skb438-1',
    name: 'Acid Bubbles (Tsunomon)',
    name_pt: 'Bolhas Ácidas',
    description: 'Spits acidic bubbles that sting one enemy and leave a weakening burn.',
    description_pt: 'Cospe bolhas ácidas que ardem em um inimigo e deixam uma fraqueza corrosiva.',
    stage: 'In-Training',
    slot_role: 'sustain_dot',
    energyCost: 6,
    signature: true,
    owner_template_id: 'skb-438',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 19, scale: 'atk', factor: 0.75 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.35, turns: 2 }
    ]
  }),
  w({
    idSuffix: 'skb438-2',
    name: 'Tackle (Tsunomon)',
    name_pt: 'Investida',
    description: 'Charges with its single horn, tackling the opponent with all its might.',
    description_pt: 'Avança com seu único chifre, investindo contra o oponente com toda a força.',
    stage: 'In-Training',
    slot_role: 'identity_finisher',
    energyCost: 6,
    signature: true,
    owner_template_id: 'skb-438',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 28, scale: 'atk', factor: 1.0 }, element: 'null' }]
  }),
  // ---- Yokomon (skb-510, In-Training) ----
  w({
    idSuffix: 'skb510-1',
    name: 'Soap Flower',
    name_pt: 'Flor de Sabão',
    description: 'Blows a soapy flower bubble that pops against one enemy.',
    description_pt: 'Sopra uma bolha de flor ensaboada que estoura contra um inimigo.',
    stage: 'In-Training',
    slot_role: 'primary_attack',
    energyCost: 5,
    signature: true,
    owner_template_id: 'skb-510',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 22, scale: 'atk', factor: 0.8 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb510-2',
    name: 'Petal Foam Drift',
    name_pt: 'Deriva de Espuma de Pétalas',
    description: 'Floats healing petal foam around the most injured ally, washing away one ailment.',
    description_pt: 'Faz espuma de pétalas flutuar ao redor do aliado mais ferido, lavando uma aflição.',
    stage: 'In-Training',
    slot_role: 'utility',
    energyCost: 6,
    signature: true,
    owner_template_id: 'skb-510',
    actions: [
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 35, scale: 'int', factor: 0.6 } },
      { kind: 'cleanse', target: 'caster_ally_lowest_hp' }
    ]
  }),
  // ---- Otamamon (skb-582, Rookie) ----
  w({
    idSuffix: 'skb582-1',
    name: 'Lullaby Bubble',
    name_pt: 'Bolha de Ninar',
    description: 'Sings through a floating bubble that bursts into sleep-inducing water magic.',
    description_pt: 'Canta através de uma bolha flutuante que explode em magia aquática sonífera.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-582',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 28, scale: 'int', factor: 1.1 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'sleep', chance: 0.3, turns: 1 }
    ]
  }),
  w({
    idSuffix: 'skb582-2',
    name: 'Water Jet (Otamamon)',
    name_pt: "Jato d'Água",
    description: 'Shoots a clean stream of water from its mouth with tadpole precision.',
    description_pt: 'Dispara uma corrente limpa de água de sua boca com precisão de girino.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-582',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 36, scale: 'int', factor: 1.25 }, element: 'water' }]
  }),
  // ---- Syakomon (skb-709, Rookie) ----
  w({
    idSuffix: 'skb709-1',
    name: 'Black Pearl Blast',
    name_pt: 'Explosão da Pérola Negra',
    description: 'Fires a dark pearl shot that bursts into sharp fragments across all enemies.',
    description_pt: 'Dispara uma pérola negra que explode em fragmentos afiados sobre todos os inimigos.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 10,
    signature: true,
    owner_template_id: 'skb-709',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 24, scale: 'atk', factor: 1.0 }, element: 'water' }]
  }),
  w({
    idSuffix: 'skb709-2',
    name: 'Water Shot (Syakomon)',
    name_pt: 'Tiro de Água',
    description: 'Snaps its shell open and shoots a compact bead of water into one foe.',
    description_pt: 'Abre sua concha de repente e dispara uma gota compacta de água contra um inimigo.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-709',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 35, scale: 'atk', factor: 1.2 }, element: 'water' }]
  }),
  // ---- Dianamon (skb-733, Mega) ----
  w({
    idSuffix: 'skb733-1',
    name: 'Goodnight Moon',
    name_pt: 'Boa Noite Lua',
    description: 'Emits moonlight from the Goodnight Sisters to lure all enemies into sleep.',
    description_pt: 'Emite luar das Goodnight Sisters para atrair todos os inimigos ao sono.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 32,
    signature: true,
    owner_template_id: 'skb-733',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 46, scale: 'int', factor: 1.5 }, element: 'water' },
      { kind: 'apply_status', target: 'enemy_all', status: 'sleep', chance: 0.45, turns: 1 }
    ]
  }),
  w({
    idSuffix: 'skb733-2',
    name: 'Arrow of Artemis',
    name_pt: 'Flecha de Ártemis',
    description: 'Shoots an icy lunar arrow that punishes sleeping prey with precise force.',
    description_pt: 'Dispara uma flecha lunar gelada que pune presas adormecidas com força precisa.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-733',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 88, scale: 'int', factor: 2.0 }, element: 'ice' },
      { kind: 'apply_status', target: 'primary_target', status: 'freeze', chance: 0.25, turns: 1 }
    ]
  }),
  // ---- Bacchusmon DM (skb-767, Mega) ----
  w({
    idSuffix: 'skb767-1',
    name: 'Reversal of the Dead',
    name_pt: 'Reversão dos Mortos',
    description: 'Reverses deathly water through all enemies, then leaves the user drowsy from the ritual.',
    description_pt: 'Reverte água mortuária por todos os inimigos e deixa o usuário sonolento pelo ritual.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-767',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 72, scale: 'atk', factor: 1.8 }, element: 'water' },
      { kind: 'apply_status', target: 'self', status: 'sleep', chance: 1.0, turns: 1 }
    ]
  }),
  w({
    idSuffix: 'skb767-2',
    name: 'Hangover Undertow',
    name_pt: 'Ressaca da Bebedeira',
    description: 'Spills a divine undertow of wine-dark water that confuses enemies and delays their response.',
    description_pt: 'Derrama uma ressaca divina de água cor de vinho que confunde inimigos e atrasa sua resposta.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-767',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 48, scale: 'int', factor: 1.45 }, element: 'water' },
      { kind: 'apply_status', target: 'enemy_all', status: 'confusion', chance: 0.4, turns: 2 },
      { kind: 'shift_initiative', target: 'enemy_all', delta: 1 }
    ]
  }),
];
