import { makeSkillFactory, type SkillSeed } from './types.js';

const e = makeSkillFactory('electricity', 'elec-sig');

export const ELECTRICITY_SIGNATURES: SkillSeed[] = [
  // ---- Tentomon (skb-303, Rookie) ----
  e({
    idSuffix: 'skb303-1',
    name: 'Super Shocker',
    name_pt: 'Super Choque',
    description: 'Releases a focused burst of static electricity from its antennae into one foe.',
    description_pt: 'Libera uma descarga concentrada de eletricidade estática de suas antenas contra um inimigo.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-303',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 32, scale: 'int', factor: 1.2 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb303-2',
    name: 'Katai Tsume',
    name_pt: 'Garra Dura',
    description: 'Rakes the target with hardened insect claws after bracing its shell.',
    description_pt: 'Arranha o alvo com garras de inseto endurecidas depois de firmar sua carapaça.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-303',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 35, scale: 'atk', factor: 1.3 }, element: 'plant' }]
  }),
  // ---- Kabuterimon (skb-304, Champion) ----
  e({
    idSuffix: 'skb304-1',
    name: 'Electro Shocker',
    name_pt: 'Choque Elétrico',
    description: 'Fires a horn-born electric blast that can leave the enemy stunned.',
    description_pt: 'Dispara uma rajada elétrica do chifre que pode deixar o inimigo atordoado.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-304',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 42, scale: 'int', factor: 1.3 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.5, turns: 1 }
    ]
  }),
  e({
    idSuffix: 'skb304-2',
    name: 'Danger Sting',
    name_pt: 'Ferrão Perigoso',
    description: 'Seizes an enemy with its insect limbs and electrocutes them at close range.',
    description_pt: 'Agarra um inimigo com seus membros de inseto e o eletrocuta de perto.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-304',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'atk', factor: 1.5 }, element: 'electricity' }]
  }),
  // ---- Waspmon (skb-454, Champion) ----
  e({
    idSuffix: 'skb454-1',
    name: 'Turbo Stinger',
    name_pt: 'Ferrão Turbo',
    description: 'Accelerates into a rapid series of electrified stinger strikes against one target.',
    description_pt: 'Acelera em uma sequência rápida de ferroadas eletrificadas contra um alvo.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-454',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'spd', factor: 1.8 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb454-2',
    name: 'Vespa Voltage',
    name_pt: 'Voltagem Vespa',
    description: 'Injects a humming charge through its needle, shocking the target and slowing their reflexes.',
    description_pt: 'Injeta uma carga vibrante por sua agulha, dando choque no alvo e reduzindo seus reflexos.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-454',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 36, scale: 'atk', factor: 1.2 }, element: 'electricity' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'spd', delta: -15, turns: 3 },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  // ---- GroundLocomon (skb-704, Mega) ----
  e({
    idSuffix: 'skb704-1',
    name: 'Destruction Crush',
    name_pt: 'Esmagamento Destrutivo',
    description: 'Runs down the enemy formation with a thunderous locomotive crash.',
    description_pt: 'Atropela a formação inimiga com uma colisão ferroviária trovejante.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-704',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 62, scale: 'atk', factor: 1.8 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb704-2',
    name: 'Railgun Overrun',
    name_pt: 'Atropelo de Railgun',
    description: 'Charges its rails with current, blasting every enemy and pushing their turns back.',
    description_pt: 'Carrega seus trilhos com corrente, explode todos os inimigos e atrasa seus turnos.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-704',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 48, scale: 'int', factor: 1.5 }, element: 'electricity' },
      { kind: 'shift_initiative', target: 'enemy_all', delta: 1 }
    ]
  }),
  // ---- CannonBeemon (skb-727, Ultimate) ----
  e({
    idSuffix: 'skb727-1',
    name: 'Nitro Stinger',
    name_pt: 'Ferrão Nitro',
    description: 'Launches a high-output stinger shell that may paralyze the pierced target.',
    description_pt: 'Lança um projétil de ferrão de alta potência que pode paralisar o alvo perfurado.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-727',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 66, scale: 'atk', factor: 1.5 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.3, turns: 1 }
    ]
  }),
  e({
    idSuffix: 'skb727-2',
    name: 'Hive Capacitor',
    name_pt: 'Capacitor da Colmeia',
    description: 'Stores voltage in its cannon pods, shielding allies before the swarm fires again.',
    description_pt: 'Armazena voltagem em seus canhões, protegendo aliados antes de a colmeia disparar novamente.',
    stage: 'Ultimate',
    slot_role: 'buff_support',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-727',
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'shield_absorb', amount: 150, turns: 2 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'accuracy_up', amount: 15, turns: 3 }
    ]
  }),
  // ---- MegaSeadramon (skb-132, Ultimate) ----
  e({
    idSuffix: 'skb132-1',
    name: 'Lightning Javelin (MegaSeadramon)',
    name_pt: 'Dardo Relâmpago',
    description: 'Spears a target with lightning conducted through its serpentine horn.',
    description_pt: 'Transpassa um alvo com relâmpago conduzido por seu chifre serpentino.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-132',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 72, scale: 'int', factor: 1.6 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb132-2',
    name: 'Abyssal Thunder Coil',
    name_pt: 'Espiral Trovejante Abissal',
    description: 'Wraps the foe in deep-sea current, shocking them while dragging their speed down.',
    description_pt: 'Envolve o inimigo em corrente das profundezas, dando choque enquanto reduz sua velocidade.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-132',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'int', factor: 1.3 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'root', chance: 0.45, turns: 1 }
    ]
  }),
  // ---- MetalMamemon (skb-413, Ultimate) ----
  e({
    idSuffix: 'skb413-1',
    name: 'Energy Bomb',
    name_pt: 'Bomba de Energia',
    description: 'Hurls a compact sphere of stored electrical energy that detonates on impact.',
    description_pt: 'Arremessa uma esfera compacta de energia elétrica armazenada que detona no impacto.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-413',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 72, scale: 'atk', factor: 1.6 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb413-2',
    name: 'Chrome Capacitor',
    name_pt: 'Capacitor Cromado',
    description: 'Converts kinetic recoil into a chrome charge that restores energy to its allies.',
    description_pt: 'Converte o recuo cinético em uma carga cromada que restaura energia dos aliados.',
    stage: 'Ultimate',
    slot_role: 'utility',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-413',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 42, scale: 'atk', factor: 1.1 }, element: 'steel' },
      { kind: 'restore_en', target: 'caster_ally_all', amount: 10 }
    ]
  }),
  // ---- MetalTyrannomon (skb-364, Ultimate) ----
  e({
    idSuffix: 'skb364-1',
    name: 'Nuclear Laser',
    name_pt: 'Laser Nuclear',
    description: 'Fires a reactor-fed beam from its cybernetic body, burning through armor.',
    description_pt: 'Dispara um raio alimentado por reator de seu corpo cibernético, atravessando armaduras.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-364',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 68, scale: 'atk', factor: 1.5 }, element: 'electricity', ignore_defense: true }]
  }),
  e({
    idSuffix: 'skb364-2',
    name: 'Reactor Jaw',
    name_pt: 'Mandíbula Reatora',
    description: 'Bites down with a charged mechanical jaw that weakens the target structure.',
    description_pt: 'Morde com uma mandíbula mecânica carregada que enfraquece a estrutura do alvo.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-364',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'atk', factor: 1.3 }, element: 'steel' },
      { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.55, turns: 3 }
    ]
  }),
  // ---- Chaosdramon (skb-422, Mega) ----
  e({
    idSuffix: 'skb422-1',
    name: 'Hyper Infinity Cannon',
    name_pt: 'Canhão Hiper Infinito',
    description: 'Unleashes both cannons in a sweeping electrical bombardment across the enemy line.',
    description_pt: 'Dispara ambos os canhões em um bombardeio elétrico que varre a linha inimiga.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-422',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 72, scale: 'atk', factor: 1.8 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb422-2',
    name: 'Chaos Grid Barrage',
    name_pt: 'Barragem da Rede Caótica',
    description: 'Floods the battlefield with targeting noise, damaging enemies and ruining their aim.',
    description_pt: 'Inunda o campo com ruído de mira, ferindo inimigos e arruinando sua precisão.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-422',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 48, scale: 'int', factor: 1.5 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_all', status: 'blind', chance: 0.45, turns: 2 }
    ]
  }),
  // ---- HerculesKabuterimon (skb-306, Mega) ----
  e({
    idSuffix: 'skb306-1',
    name: 'Giga Blaster',
    name_pt: 'Giga Explosão',
    description: 'Concentrates tremendous electrical power in its horn and may immobilize the target.',
    description_pt: 'Concentra tremenda energia elétrica em seu chifre e pode imobilizar o alvo.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-306',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 88, scale: 'int', factor: 2.0 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'root', chance: 0.5, turns: 1 }
    ]
  }),
  e({
    idSuffix: 'skb306-2',
    name: 'Kyodai Hasami',
    name_pt: 'Pinças Gigantes',
    description: 'Crushes the enemy between the giant pincers on its armored head.',
    description_pt: 'Esmaga o inimigo entre as pinças gigantes de sua cabeça blindada.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 27,
    signature: true,
    owner_template_id: 'skb-306',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 92, scale: 'atk', factor: 2.0 }, element: 'plant' }]
  }),
  // ---- HiAndromon (skb-426, Mega) ----
  e({
    idSuffix: 'skb426-1',
    name: 'Atomic Ray',
    name_pt: 'Raio Atômico',
    description: 'Projects an atomic beam from its mechanical core with precise destructive force.',
    description_pt: 'Projeta um raio atômico de seu núcleo mecânico com força destrutiva precisa.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 33,
    signature: true,
    owner_template_id: 'skb-426',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 92, scale: 'atk', factor: 2.0 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb426-2',
    name: 'Hi-Tension Barrier',
    name_pt: 'Barreira de Alta Tensão',
    description: 'Raises a high-voltage defense grid around the party, absorbing incoming blows.',
    description_pt: 'Ergue uma grade defensiva de alta voltagem ao redor do grupo, absorvendo golpes.',
    stage: 'Mega',
    slot_role: 'buff_support',
    energyCost: 28,
    signature: true,
    owner_template_id: 'skb-426',
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'shield_absorb', amount: 250, turns: 2 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'def_up', amount: 35, turns: 3 }
    ]
  }),
  // ---- Machinedramon (skb-385, Mega) ----
  e({
    idSuffix: 'skb385-1',
    name: 'Infinity Cannon',
    name_pt: 'Canhão Infinito',
    description: 'Fires its twin back cannons in a devastating mechanized salvo.',
    description_pt: 'Dispara os canhões duplos de suas costas em uma salva mecanizada devastadora.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-385',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 80, scale: 'atk', factor: 2.2 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb385-2',
    name: 'Mugen Hand',
    name_pt: 'Mão Mugen',
    description: 'Crushes and stabs with its right arm before releasing a close-range energy blast.',
    description_pt: 'Esmaga e perfura com o braço direito antes de liberar uma rajada de energia à queima-roupa.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 28,
    signature: true,
    owner_template_id: 'skb-385',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 86, scale: 'atk', factor: 1.9 }, element: 'fire' }]
  }),
  // ---- Ouryumon (skb-193, Mega) ----
  e({
    idSuffix: 'skb193-1',
    name: 'Eiseiryuojin',
    name_pt: 'Lâmina Rei Dragão Eisei',
    description: 'Cuts the target with a regal dragon blade charged by golden lightning.',
    description_pt: 'Corta o alvo com uma lâmina régia de dragão carregada por relâmpago dourado.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-193',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 88, scale: 'atk', factor: 2.0 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb193-2',
    name: 'Golden Armor',
    name_pt: 'Armadura Dourada',
    description: 'Slams enemies with a shining armored sweep of royal metal.',
    description_pt: 'Atinge inimigos com uma varredura brilhante de metal real blindado.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 28,
    signature: true,
    owner_template_id: 'skb-193',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 64, scale: 'atk', factor: 1.7 }, element: 'steel' }]
  }),
  // ---- Ravemon (skb-740, Mega) ----
  e({
    idSuffix: 'skb740-1',
    name: 'Ame no Ohabari',
    name_pt: 'Ame no Ohabari',
    description: 'Sweeps the field with a sacred storm blade that can pin enemies in place.',
    description_pt: 'Varre o campo com uma lâmina sagrada de tempestade que pode prender inimigos no lugar.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 32,
    signature: true,
    owner_template_id: 'skb-740',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 58, scale: 'int', factor: 1.6 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_all', status: 'root', chance: 0.15, turns: 1 }
    ]
  }),
  e({
    idSuffix: 'skb740-2',
    name: 'Spiral Raven Claw',
    name_pt: 'Garra Espiral do Corvo',
    description: 'Dives through one foe with a spiraling storm of raven-like claw strikes.',
    description_pt: 'Mergulha através de um inimigo com uma tempestade espiral de golpes de garra corvina.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 27,
    signature: true,
    owner_template_id: 'skb-740',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 70, scale: 'spd', factor: 2.1 }, element: 'wind' }]
  }),
  // ---- RustTyrannomon (skb-383, Mega) ----
  e({
    idSuffix: 'skb383-1',
    name: 'Terrors Cluster',
    name_pt: 'Agrupamento do Terror',
    description: 'Launches a dreadful cluster shot that may immobilize the target in fear.',
    description_pt: 'Lança um disparo aterrador em aglomerado que pode imobilizar o alvo pelo medo.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-383',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 86, scale: 'atk', factor: 1.9 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'root', chance: 0.25, turns: 1 }
    ]
  }),
  e({
    idSuffix: 'skb383-2',
    name: 'Corrosion Spark',
    name_pt: 'Faísca de Corrosão',
    description: 'Discharges rusty current through its metal frame, weakening enemy armor over time.',
    description_pt: 'Descarrega corrente enferrujada por sua estrutura metálica, enfraquecendo a armadura inimiga.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-383',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 45, scale: 'atk', factor: 1.4 }, element: 'electricity' },
      { kind: 'modify_stat', target: 'enemy_all', stat: 'def', delta: -30, turns: 4 }
    ]
  }),
  // ---- TigerVespamon (skb-745, Mega) ----
  e({
    idSuffix: 'skb745-1',
    name: 'Mach Stinger V',
    name_pt: 'Ferrão Mach V',
    description: 'Strikes at mach speed with repeated royal stinger thrusts.',
    description_pt: 'Ataca em velocidade mach com repetidas estocadas de ferrão real.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-745',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 60, scale: 'spd', factor: 2.4 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb745-2',
    name: 'Royal Volt Guard',
    name_pt: 'Guarda Volt Real',
    description: 'Forms a royal electric guard that sharpens the whole team before the next charge.',
    description_pt: 'Forma uma guarda elétrica real que fortalece toda a equipe antes da próxima investida.',
    stage: 'Mega',
    slot_role: 'buff_support',
    energyCost: 28,
    signature: true,
    owner_template_id: 'skb-745',
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'spd_up', amount: 35, turns: 3 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'crit_up', amount: 20, turns: 3 }
    ]
  }),
  // ---- Parrotmon (skb-414, Ultimate) ----
  e({
    idSuffix: 'skb414-1',
    name: 'Mjölnir Thunder',
    name_pt: 'Trovão Mjölnir',
    description: 'Calls down a hammering bolt of thunder from its giant wings.',
    description_pt: 'Invoca um raio martelante de trovão a partir de suas asas gigantes.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-414',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 72, scale: 'int', factor: 1.6 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb414-2',
    name: 'Stormwing Cry',
    name_pt: 'Grito de Asa Tempestuosa',
    description: 'Screeches through charged storm feathers, rattling enemies and delaying their response.',
    description_pt: 'Grita por penas tempestuosas carregadas, abalando inimigos e atrasando sua resposta.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-414',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 38, scale: 'int', factor: 1.2 }, element: 'wind' },
      { kind: 'shift_initiative', target: 'enemy_all', delta: 1 }
    ]
  }),
  // ---- Zudomon (skb-345, Ultimate) ----
  e({
    idSuffix: 'skb345-1',
    name: "Vulcan's Hammer",
    name_pt: 'Martelo de Vulcano',
    description: 'Smashes one enemy with its electrified chrome digizoid hammer.',
    description_pt: 'Esmaga um inimigo com seu martelo eletrificado de chrome digizoid.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-345',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 74, scale: 'atk', factor: 1.6 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb345-2',
    name: 'Spark Anchor',
    name_pt: 'Âncora de Faísca',
    description: 'Hooks the foe with a charged anchor swing that fixes them in place.',
    description_pt: 'Prende o inimigo com um golpe de âncora carregada que o fixa no lugar.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-345',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'atk', factor: 1.3 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'root', chance: 0.5, turns: 1 }
    ]
  }),
  // ---- SkullSeadramon (skb-908, Ultimate) ----
  e({
    idSuffix: 'skb908-1',
    name: 'Lightning Javelin (SkullSeadramon)',
    name_pt: 'Dardo Relâmpago',
    description: 'Impales the enemy with a deathly electric lance from its skeletal horn.',
    description_pt: 'Empala o inimigo com uma lança elétrica mortal de seu chifre esquelético.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-908',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 72, scale: 'int', factor: 1.6 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb908-2',
    name: 'Bone Current',
    name_pt: 'Corrente Óssea',
    description: 'Sends necrotic current through the target, cursing them with lingering voltage.',
    description_pt: 'Envia corrente necrótica pelo alvo, amaldiçoando-o com voltagem persistente.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-908',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 54, scale: 'int', factor: 1.3 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'curse', chance: 0.45, turns: 2 }
    ]
  }),
  // ---- Lighdramon (skb-139, Rookie) ----
  e({
    idSuffix: 'skb139-1',
    name: 'Lightning Blade',
    name_pt: 'Lâmina Relâmpago',
    description: 'Cuts the target with an armor-forged blade wrapped in lightning.',
    description_pt: 'Corta o alvo com uma lâmina forjada pela armadura e envolta em relâmpago.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 10,
    signature: true,
    owner_template_id: 'skb-139',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 40, scale: 'atk', factor: 1.4 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb139-2',
    name: 'Thunderbolt',
    name_pt: 'Raio de Trovão',
    description: 'Fires bullets of electricity from its mouth in a quick armored burst.',
    description_pt: 'Dispara projéteis de eletricidade de sua boca em uma rajada blindada rápida.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-139',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 35, scale: 'int', factor: 1.3 }, element: 'electricity' }]
  }),
  // ---- Aegiomon (skb-183, Champion) ----
  e({
    idSuffix: 'skb183-1',
    name: 'Stun Beat Blow',
    name_pt: 'Golpe de Batida Atordoante',
    description: 'Strikes with a rhythmic electric blow that can stun the opponent.',
    description_pt: 'Golpeia com uma batida elétrica rítmica que pode atordoar o oponente.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-183',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 44, scale: 'atk', factor: 1.3 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.2, turns: 1 }
    ]
  }),
  e({
    idSuffix: 'skb183-2',
    name: 'Storm Hoof',
    name_pt: 'Casco da Tempestade',
    description: 'Drives a charged hoof into the ground, sending a shock through the front line.',
    description_pt: 'Crava um casco carregado no solo, enviando um choque pela linha de frente.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-183',
    actions: [{ kind: 'deal_damage', target: 'enemy_front', amount: { base: 52, scale: 'atk', factor: 1.4 }, element: 'electricity' }]
  }),
  // ---- Aegiochusmon (skb-184, Ultimate) ----
  e({
    idSuffix: 'skb184-1',
    name: 'Bolt Break Knockdown',
    name_pt: 'Derrubada Rompe-Raio',
    description: 'Breaks through one enemy with a crushing bolt that may stun them.',
    description_pt: 'Rompe a defesa de um inimigo com um raio esmagador que pode atordoá-lo.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-184',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 58, scale: 'atk', factor: 1.6 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.3, turns: 1 }
    ]
  }),
  e({
    idSuffix: 'skb184-2',
    name: 'Lightning Pile',
    name_pt: 'Estaca Relâmpago',
    description: 'Pins the target with a concentrated lightning pile that leaves their defenses exposed.',
    description_pt: 'Prende o alvo com uma estaca de relâmpago concentrado que deixa suas defesas expostas.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-184',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 64, scale: 'atk', factor: 1.4 }, element: 'electricity' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -20, turns: 3 }
    ]
  }),
  // ---- Andromon (skb-342, Ultimate) ----
  e({
    idSuffix: 'skb342-1',
    name: 'Spiral Sword',
    name_pt: 'Espada Espiral',
    description: 'Drives its spinning blade into the target with machine precision.',
    description_pt: 'Crava sua lâmina giratória no alvo com precisão mecânica.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-342',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 68, scale: 'atk', factor: 1.5 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb342-2',
    name: 'Gatling Missile Rensha Mode',
    name_pt: 'Modo Rajada de Mísseis Gatling',
    description: 'Fires Gatling missiles at extreme speed across the enemy formation.',
    description_pt: 'Dispara mísseis Gatling em velocidade extrema pela formação inimiga.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-342',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 55, scale: 'atk', factor: 1.4 }, element: 'plant' }]
  }),
  // ---- Centarumon (skb-372, Champion) ----
  e({
    idSuffix: 'skb372-1',
    name: 'Hunting Cannon',
    name_pt: 'Canhão de Caça',
    description: 'Shoots a hunting cannon blast that forces the target to miss their next move.',
    description_pt: 'Dispara um tiro de canhão de caça que força o alvo a perder seu próximo movimento.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-372',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 58, scale: 'atk', factor: 1.5 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'root', chance: 1.0, turns: 1 }
    ]
  }),
  e({
    idSuffix: 'skb372-2',
    name: 'Energy Ray',
    name_pt: 'Raio de Energia',
    description: 'Channels a straight energy beam from its arm cannon into a single foe.',
    description_pt: 'Canaliza um raio de energia direto de seu canhão de braço contra um inimigo.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-372',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 50, scale: 'int', factor: 1.4 }, element: 'water' }]
  }),
  // ---- Wizardmon (skb-377, Champion) ----
  e({
    idSuffix: 'skb377-1',
    name: 'Thunder Cloud',
    name_pt: 'Nuvem de Trovão',
    description: 'Summons a storm cloud over the target and strikes them with magical lightning.',
    description_pt: 'Invoca uma nuvem de tempestade sobre o alvo e o atinge com relâmpago mágico.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-377',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'int', factor: 1.5 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb377-2',
    name: 'Terror Illusion',
    name_pt: 'Ilusão de Terror',
    description: 'Creates a frightening illusion that unsettles the enemy and weakens their resolve.',
    description_pt: 'Cria uma ilusão assustadora que abala o inimigo e enfraquece sua determinação.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-377',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'int', factor: 1.0 }, element: 'water' },
      { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.6, turns: 3 }
    ]
  }),
  // ---- Betamon (skb-389, Rookie) ----
  e({
    idSuffix: 'skb389-1',
    name: 'Electric Shock',
    name_pt: 'Choque Elétrico',
    description: 'Discharges amphibian electricity across all enemies at once.',
    description_pt: 'Descarrega eletricidade anfíbia contra todos os inimigos de uma vez.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 10,
    signature: true,
    owner_template_id: 'skb-389',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 22, scale: 'int', factor: 0.9 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb389-2',
    name: 'Water Tower',
    name_pt: 'Torre de Água',
    description: 'Causes a geyser of water to erupt under the foe and knock them off balance.',
    description_pt: 'Faz um gêiser de água surgir sob o inimigo e tirá-lo do equilíbrio.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-389',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'int', factor: 1.2 }, element: 'water' }]
  }),
  // ---- Elecmon (skb-564, Rookie) ----
  e({
    idSuffix: 'skb564-1',
    name: 'Sparkling Thunder',
    name_pt: 'Trovão Cintilante',
    description: 'Shakes out sparkling thunder from its fur, possibly stunning the target.',
    description_pt: 'Sacode trovão cintilante de sua pelagem, possivelmente atordoando o alvo.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-564',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 28, scale: 'atk', factor: 1.1 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.2, turns: 1 }
    ]
  }),
  e({
    idSuffix: 'skb564-2',
    name: 'Thunder Knife',
    name_pt: 'Faca de Trovão',
    description: 'Sends a barrage of small electric blades slicing into one foe.',
    description_pt: 'Envia uma barragem de pequenas lâminas elétricas cortando um inimigo.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-564',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'atk', factor: 1.3 }, element: 'electricity' }]
  }),
  // ---- Kokuwamon (skb-609, Rookie) ----
  e({
    idSuffix: 'skb609-1',
    name: 'Mini Scissor Claw',
    name_pt: 'Mini Garra Tesoura',
    description: 'Snaps its small metal pincers into the target with a charged bite.',
    description_pt: 'Fecha suas pequenas pinças metálicas no alvo com uma mordida carregada.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-609',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'atk', factor: 1.3 }, element: 'electricity' }]
  }),
  e({
    idSuffix: 'skb609-2',
    name: 'Elect-Elect',
    name_pt: 'Elect-Elect',
    description: 'Drops a compact bolt of lightning directly onto the enemy.',
    description_pt: 'Derruba um raio compacto diretamente sobre o inimigo.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-609',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 32, scale: 'int', factor: 1.2 }, element: 'electricity' }]
  }),
  // ---- Mekanorimon (skb-615, Champion) ----
  e({
    idSuffix: 'skb615-1',
    name: 'Twinkle Beam',
    name_pt: 'Raio Cintilante',
    description: 'Fires a bright mechanical beam with a high chance to stun the target.',
    description_pt: 'Dispara um raio mecânico brilhante com alta chance de atordoar o alvo.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-615',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 40, scale: 'atk', factor: 1.2 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.6, turns: 1 }
    ]
  }),
  e({
    idSuffix: 'skb615-2',
    name: 'Pilot Spark Net',
    name_pt: 'Rede de Faísca do Piloto',
    description: 'Projects a pilot-guided electric net that catches the front enemy in place.',
    description_pt: 'Projeta uma rede elétrica guiada pelo piloto que prende o inimigo da frente.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-615',
    actions: [
      { kind: 'deal_damage', target: 'enemy_front', amount: { base: 36, scale: 'int', factor: 1.1 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_front', status: 'root', chance: 0.5, turns: 1 }
    ]
  }),
  // ---- Rapidmon (skb-722, Ultimate) ----
  e({
    idSuffix: 'skb722-1',
    name: 'Golden Triangle (Rapidmon)',
    name_pt: 'Triângulo Dourado',
    description: 'Forms a golden triangle of electric light that can injure the target.',
    description_pt: 'Forma um triângulo dourado de luz elétrica que pode ferir o alvo.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-722',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 64, scale: 'int', factor: 1.5 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.5, turns: 2 }
    ]
  }),
  e({
    idSuffix: 'skb722-2',
    name: 'Gold Radar Lock',
    name_pt: 'Trava de Radar Dourado',
    description: 'Locks its sensors onto the enemy team, improving allied accuracy before the next volley.',
    description_pt: 'Fixa seus sensores na equipe inimiga, melhorando a precisão aliada antes da próxima rajada.',
    stage: 'Ultimate',
    slot_role: 'utility',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-722',
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'accuracy_up', amount: 25, turns: 3 },
      { kind: 'shift_initiative', target: 'self', delta: -1 }
    ]
  }),
  // ---- Rapidmon (Armor) (skb-751, Rookie) ----
  e({
    idSuffix: 'skb751-1',
    name: 'Golden Triangle (Rapidmon Armor)',
    name_pt: 'Triângulo Dourado',
    description: 'Releases a miracle-armored triangle of light that shocks and weakens the target.',
    description_pt: 'Libera um triângulo de luz de armadura milagrosa que choca e enfraquece o alvo.',
    stage: 'Rookie',
    slot_role: 'sustain_dot',
    energyCost: 10,
    signature: true,
    owner_template_id: 'skb-751',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 36, scale: 'int', factor: 1.3 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.5, turns: 2 }
    ]
  }),
  e({
    idSuffix: 'skb751-2',
    name: 'Miracle Circuit',
    name_pt: 'Circuito Milagroso',
    description: 'Surges through the Digimental circuitry, advancing itself with a burst of holy speed.',
    description_pt: 'Avança pelos circuitos do Digimental, acelerando a si mesmo com uma explosão sagrada.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-751',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 26, scale: 'spd', factor: 1.0 }, element: 'light' },
      { kind: 'shift_initiative', target: 'self', delta: -2 }
    ]
  }),
];
