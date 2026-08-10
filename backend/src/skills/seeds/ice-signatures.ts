import { makeSkillFactory, type SkillSeed } from './types.js';

const i = makeSkillFactory('ice', 'ice-sig');

export const ICE_SIGNATURES: SkillSeed[] = [
  // ---- Crescemon (skb-4, Ultimate) ----
  i({
    idSuffix: 'skb4-1',
    name: 'Lunatic Dance',
    name_pt: 'Dança Lunática',
    description: 'Crescemon whirls through a single enemy with four moonlit ice cuts, landing as a precise lunar finisher.',
    description_pt: 'Crescemon rodopia através de um inimigo com quatro cortes de gelo ao luar, finalizando com precisão lunar.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-4',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 70, scale: 'int', factor: 1.6 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb4-2',
    name: 'Moonlit Frost Veil',
    name_pt: 'Véu Gélido ao Luar',
    description: 'Crescemon spins a crescent veil of frost around itself, turning moonlight into a guarded counter-stance.',
    description_pt: 'Crescemon gira um véu crescente de geada ao seu redor, transformando o luar em uma postura de contra-ataque protegida.',
    stage: 'Ultimate',
    slot_role: 'buff_support',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-4',
    actions: [
      { kind: 'apply_buff', target: 'self', buff: 'shield_absorb', amount: 170, turns: 3 },
      { kind: 'apply_buff', target: 'self', buff: 'damage_reduction', amount: 20, turns: 2 }
    ]
  }),

  // ---- Frigimon (skb-370, Champion) ----
  i({
    idSuffix: 'skb370-1',
    name: 'Sub-Zero Ice Punch',
    name_pt: 'Soco de Gelo Sub-Zero',
    description: 'Frigimon swings a sub-zero punch wide enough to batter the whole enemy line with packed snow.',
    description_pt: 'Frigimon desfere um soco sub-zero amplo o bastante para atingir toda a linha inimiga com neve compactada.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-370',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 34, scale: 'atk', factor: 1.25 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb370-2',
    name: 'Ice Punch',
    name_pt: 'Soco de Gelo',
    description: 'Frigimon packs freezing cold into one heavy fist and drives it straight into the target.',
    description_pt: 'Frigimon concentra frio congelante em um punho pesado e o crava diretamente no alvo.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-370',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 56, scale: 'atk', factor: 1.45 }, element: 'ice' }]
  }),

  // ---- Hyogamon (skb-580, Champion) ----
  i({
    idSuffix: 'skb580-1',
    name: 'Snow Punch',
    name_pt: 'Soco de Neve',
    description: 'Hyogamon crushes one foe with a snowy punch that leaves their guard brittle against the cold.',
    description_pt: 'Hyogamon esmaga um inimigo com um soco nevado que deixa sua guarda frágil contra o frio.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-580',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 46, scale: 'atk', factor: 1.35 }, element: 'ice' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -18, turns: 3 }
    ]
  }),
  i({
    idSuffix: 'skb580-2',
    name: 'Ice Konbou',
    name_pt: 'Clava de Gelo',
    description: 'Hyogamon batters the enemy with its crude club of ice, trading finesse for blunt frozen force.',
    description_pt: 'Hyogamon golpeia o inimigo com sua clava bruta de gelo, trocando finesse por força congelada direta.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-580',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 54, scale: 'atk', factor: 1.4 }, element: 'ice' }]
  }),

  // ---- IceDevimon (skb-730, Champion) ----
  i({
    idSuffix: 'skb730-1',
    name: 'Frost Claw',
    name_pt: 'Garra Gélida',
    description: 'IceDevimon rakes a target with a frozen claw and feeds on the pain as stolen vitality.',
    description_pt: 'IceDevimon rasga o alvo com uma garra congelada e se alimenta da dor como vitalidade roubada.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-730',
    actions: [{ kind: 'drain', target: 'primary_target', damage: { base: 50, scale: 'atk', factor: 1.35 }, heal_pct: 0.2, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb730-2',
    name: 'Cold Blood',
    name_pt: 'Sangue Frio',
    description: 'IceDevimon chills an ally into cold-blooded focus, sharpening their next strikes with watery malice.',
    description_pt: 'IceDevimon resfria um aliado em foco de sangue frio, afiando seus próximos golpes com malícia aquática.',
    stage: 'Champion',
    slot_role: 'buff_support',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-730',
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'atk_up', amount: 18, turns: 3 },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'int_up', amount: 18, turns: 3 }
    ]
  }),

  // ---- Mojyamon (skb-371, Champion) ----
  i({
    idSuffix: 'skb371-1',
    name: 'Icicle Rod',
    name_pt: 'Bastão de Estalactite',
    description: 'Mojyamon clubs one enemy with a rod of hard ice, cracking armor with primitive strength.',
    description_pt: 'Mojyamon acerta um inimigo com um bastão de gelo rígido, rachando armadura com força primitiva.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-371',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'atk', factor: 1.45 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb371-2',
    name: 'Dancing Punch',
    name_pt: 'Soco Dançante',
    description: 'Mojyamon dances forward in a shaggy rhythm before punching hard enough to steal the tempo.',
    description_pt: 'Mojyamon dança para a frente em um ritmo peludo antes de socar forte o bastante para roubar o tempo da luta.',
    stage: 'Champion',
    slot_role: 'utility',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-371',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 44, scale: 'atk', factor: 1.25 }, element: 'plant' },
      { kind: 'shift_initiative', target: 'self', delta: -1 }
    ]
  }),

  // ---- BlueMeramon (skb-177, Ultimate) ----
  i({
    idSuffix: 'skb177-1',
    name: 'Cold Flame',
    name_pt: 'Chama Fria',
    description: 'BlueMeramon strikes one enemy with blue fire so cold it burns like ice.',
    description_pt: 'BlueMeramon golpeia um inimigo com fogo azul tão frio que queima como gelo.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-177',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 78, scale: 'atk', factor: 1.75 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb177-2',
    name: 'Vision Bind',
    name_pt: 'Vínculo da Visão',
    description: 'BlueMeramon flashes bright blue flames across the enemy team, blinding their aim without locking them down.',
    description_pt: 'BlueMeramon espalha chamas azuis brilhantes pela equipe inimiga, cegando sua mira sem paralisá-la por completo.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-177',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 34, scale: 'int', factor: 1.1 }, element: 'fire' },
      { kind: 'apply_status', target: 'enemy_all', status: 'blind', chance: 0.45, turns: 2 }
    ]
  }),

  // ---- IceLeomon (skb-409, Ultimate) ----
  i({
    idSuffix: 'skb409-1',
    name: 'Fist of Ice',
    name_pt: 'Punho de Gelo',
    description: 'IceLeomon focuses leonine power into one frozen fist and smashes a single opponent.',
    description_pt: 'IceLeomon concentra poder leonino em um punho congelado e esmaga um único oponente.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-409',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 80, scale: 'atk', factor: 1.8 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb409-2',
    name: 'Jūouken',
    name_pt: 'Jūouken',
    description: 'IceLeomon gathers energy in its right hand and fires a lion-headed wave at the target.',
    description_pt: 'IceLeomon reúne energia na mão direita e dispara uma onda em forma de cabeça de leão contra o alvo.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-409',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 68, scale: 'atk', factor: 1.55 }, element: 'plant' }]
  }),

  // ---- GranDracmon (skb-32, Mega) ----
  i({
    idSuffix: 'skb32-1',
    name: 'Crystal Revolution',
    name_pt: 'Revolução de Cristal',
    description: 'GranDracmon floods the enemy formation with crystal ice and drinks back a portion of the damage.',
    description_pt: 'GranDracmon inunda a formação inimiga com gelo cristalino e recupera parte do dano causado.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-32',
    actions: [{ kind: 'drain', target: 'enemy_all', damage: { base: 54, scale: 'int', factor: 1.55 }, heal_pct: 0.15, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb32-2',
    name: 'Eye of the Gorgon',
    name_pt: 'Olho da Górgona',
    description: 'GranDracmon fixes one enemy with a gorgon stare, dealing ice magic and sowing chaos in their mind.',
    description_pt: 'GranDracmon encara um inimigo com o olhar da górgona, causando magia de gelo e semeando caos em sua mente.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 32,
    signature: true,
    owner_template_id: 'skb-32',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 88, scale: 'int', factor: 1.9 }, element: 'ice' },
      { kind: 'apply_status', target: 'primary_target', status: 'confusion', chance: 0.6, turns: 2 }
    ]
  }),

  // ---- MetalGarurumon (skb-135, Mega) ----
  i({
    idSuffix: 'skb135-1',
    name: 'Freezing Breath',
    name_pt: 'Sopro Congelante',
    description: 'MetalGarurumon blasts one target with freezing breath that leaves their defenses exposed to ice.',
    description_pt: 'MetalGarurumon dispara um sopro congelante em um alvo, deixando suas defesas expostas ao gelo.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-135',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 86, scale: 'atk', factor: 1.85 }, element: 'ice' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -24, turns: 3 }
    ]
  }),
  i({
    idSuffix: 'skb135-2',
    name: 'Ice Wolf Claw (MetalGarurumon)',
    name_pt: 'Garra de Lobo de Gelo',
    description: 'MetalGarurumon tears across the battlefield with three icy wolf-claw passes.',
    description_pt: 'MetalGarurumon rasga o campo de batalha com três passagens de garras lupinas de gelo.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 33,
    signature: true,
    owner_template_id: 'skb-135',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 62, scale: 'atk', factor: 1.65 }, element: 'ice' }]
  }),

  // ---- MetalGarurumon (Black) (skb-182, Mega) ----
  i({
    idSuffix: 'skb182-1',
    name: 'Ice Wolf Claw (MetalGarurumon Black)',
    name_pt: 'Garra de Lobo de Gelo',
    description: 'MetalGarurumon Black carves the enemy line with darkened ice claws in rapid succession.',
    description_pt: 'MetalGarurumon Black talha a linha inimiga com garras de gelo enegrecidas em rápida sucessão.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-182',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 58, scale: 'atk', factor: 1.6 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb182-2',
    name: 'Garuru Tomahawk',
    name_pt: 'Tomahawk Garuru',
    description: 'MetalGarurumon Black hurls a Garuru Tomahawk in a sure, armor-splitting strike.',
    description_pt: 'MetalGarurumon Black arremessa um Tomahawk Garuru em um golpe certeiro que parte armaduras.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-182',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 100, scale: 'atk', factor: 2.1 }, element: 'null', ignore_defense: true }]
  }),

  // ---- Vikemon (skb-346, Mega) ----
  i({
    idSuffix: 'skb346-1',
    name: 'Arctic Blizzard',
    name_pt: 'Nevasca Ártica',
    description: 'Vikemon sweeps an arctic blizzard across all enemies with the weight of a war fleet.',
    description_pt: 'Vikemon varre todos os inimigos com uma nevasca ártica pesada como uma frota de guerra.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-346',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 60, scale: 'atk', factor: 1.7 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb346-2',
    name: 'Viking Axe',
    name_pt: 'Machado Viking',
    description: 'Vikemon brings its Viking axe down on a single foe with steel-shattering force.',
    description_pt: 'Vikemon desce seu machado viking sobre um único inimigo com força capaz de quebrar aço.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 33,
    signature: true,
    owner_template_id: 'skb-346',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 96, scale: 'atk', factor: 2.05 }, element: 'steel' }]
  }),

  // ---- Seadramon (skb-347, Champion) ----
  i({
    idSuffix: 'skb347-1',
    name: 'Ice Blast',
    name_pt: 'Rajada de Gelo',
    description: 'Seadramon launches a concentrated blast of ice magic from the water at one enemy.',
    description_pt: 'Seadramon lança da água uma rajada concentrada de magia de gelo contra um inimigo.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-347',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 56, scale: 'int', factor: 1.45 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb347-2',
    name: 'Chilblains',
    name_pt: 'Frieiras',
    description: 'Seadramon slams the water with its long body, raising an ice wall that pins the front line.',
    description_pt: 'Seadramon golpeia a água com seu corpo alongado, erguendo uma muralha de gelo que prende a linha de frente.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-347',
    actions: [
      { kind: 'deal_damage', target: 'enemy_front', amount: { base: 32, scale: 'atk', factor: 1.05 }, element: 'water' },
      { kind: 'apply_status', target: 'enemy_front', status: 'root', chance: 0.35, turns: 1 }
    ]
  }),

  // ---- SnowGoblimon (skb-578, Rookie) ----
  i({
    idSuffix: 'skb578-1',
    name: 'Snow Goblin Volt',
    name_pt: 'Volt do Goblin da Neve',
    description: 'SnowGoblimon jolts one foe with a snow-charged strike that makes their guard brittle.',
    description_pt: 'SnowGoblimon eletrocuta um inimigo com um golpe carregado de neve que fragiliza sua guarda.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-578',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 32, scale: 'atk', factor: 1.15 }, element: 'ice' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -12, turns: 3 }
    ]
  }),
  i({
    idSuffix: 'skb578-2',
    name: 'Snow Gob Konbou',
    name_pt: 'Clava do Goblin da Neve',
    description: 'SnowGoblimon strikes repeatedly with its club, hammering the target through packed frost.',
    description_pt: 'SnowGoblimon golpeia repetidas vezes com sua clava, martelando o alvo através da geada compacta.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-578',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 36, scale: 'atk', factor: 1.25 }, element: 'ice' }]
  }),

  // ---- Gabumon (Black) (skb-713, Rookie) ----
  i({
    idSuffix: 'skb713-1',
    name: 'Little Horn',
    name_pt: 'Pequeno Chifre',
    description: 'Gabumon Black lowers its horn and rams one enemy with a short, icy charge.',
    description_pt: 'Gabumon Black abaixa o chifre e investe contra um inimigo em uma carga curta e gélida.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-713',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'atk', factor: 1.25 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb713-2',
    name: 'Black Ice',
    name_pt: 'Gelo Negro',
    description: 'Gabumon Black dashes forward and leaves jagged black icicles that can freeze the target in place.',
    description_pt: 'Gabumon Black avança deixando estalactites negras serrilhadas que podem congelar o alvo no lugar.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 10,
    signature: true,
    owner_template_id: 'skb-713',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 36, scale: 'atk', factor: 1.2 }, element: 'ice' },
      { kind: 'apply_status', target: 'primary_target', status: 'freeze', chance: 0.45, turns: 1 }
    ]
  }),

  // ---- Garurumon (Black) (skb-714, Champion) ----
  i({
    idSuffix: 'skb714-1',
    name: 'Freeze Fang',
    name_pt: 'Presa Congelante',
    description: 'Garurumon Black bites one enemy with fangs cold enough to numb their next movement.',
    description_pt: 'Garurumon Black morde um inimigo com presas frias o bastante para entorpecer seu próximo movimento.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-714',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 50, scale: 'atk', factor: 1.35 }, element: 'ice' },
      { kind: 'apply_status', target: 'primary_target', status: 'freeze', chance: 0.35, turns: 1 }
    ]
  }),
  i({
    idSuffix: 'skb714-2',
    name: 'Ice Cannon',
    name_pt: 'Canhão de Gelo',
    description: 'Garurumon Black fires dense balls of ice from its mouth into the enemy line.',
    description_pt: 'Garurumon Black dispara bolas densas de gelo de sua boca contra a linha inimiga.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-714',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 30, scale: 'int', factor: 1.15 }, element: 'ice' }]
  }),

  // ---- WereGarurumon (Black) (skb-715, Ultimate) ----
  i({
    idSuffix: 'skb715-1',
    name: 'Full Moon Kick',
    name_pt: 'Chute da Lua Cheia',
    description: 'WereGarurumon Black launches a full-moon kick into one enemy with brutal frozen momentum.',
    description_pt: 'WereGarurumon Black desfere um chute de lua cheia em um inimigo com impulso congelado brutal.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-715',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 82, scale: 'atk', factor: 1.85 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb715-2',
    name: 'Black Moon Howl',
    name_pt: 'Uivo da Lua Negra',
    description: 'WereGarurumon Black howls under a black moon, chilling the enemy front and delaying their charge.',
    description_pt: 'WereGarurumon Black uiva sob uma lua negra, resfriando a linha de frente inimiga e atrasando sua investida.',
    stage: 'Ultimate',
    slot_role: 'utility',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-715',
    actions: [
      { kind: 'deal_damage', target: 'enemy_front', amount: { base: 44, scale: 'atk', factor: 1.25 }, element: 'ice' },
      { kind: 'shift_initiative', target: 'enemy_front', delta: 2 }
    ]
  }),

  // ---- Lopmon (skb-750, Rookie) ----
  i({
    idSuffix: 'skb750-1',
    name: 'Blazing Ice',
    name_pt: 'Gelo Flamejante',
    description: 'Lopmon conjures a small burst of blazing ice magic and sends it into one target.',
    description_pt: 'Lopmon conjura uma pequena explosão de magia de gelo flamejante e a envia contra um alvo.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-750',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'int', factor: 1.25 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb750-2',
    name: 'Kūchū Blazing Ice',
    name_pt: 'Gelo Flamejante Aéreo',
    description: 'Lopmon casts Blazing Ice from midair, striking quickly before the target can reset their stance.',
    description_pt: 'Lopmon lança Gelo Flamejante do ar, atacando rápido antes que o alvo refaça sua postura.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-750',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 32, scale: 'int', factor: 1.15 }, element: 'ice' },
      { kind: 'shift_initiative', target: 'self', delta: -1 }
    ]
  }),

  // ---- Sorcermon (skb-755, Champion) ----
  i({
    idSuffix: 'skb755-1',
    name: 'Crystal Cloud',
    name_pt: 'Nuvem de Cristal',
    description: 'Sorcermon gathers a crystal cloud over one foe and drops ice magic through it.',
    description_pt: 'Sorcermon reúne uma nuvem de cristal sobre um inimigo e derrama magia de gelo através dela.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-755',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 56, scale: 'int', factor: 1.45 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb755-2',
    name: 'Meteor Squall',
    name_pt: 'Rajada de Meteoros',
    description: 'Sorcermon calls a squall of meteors through cold air, scattering plant-aspected magic over the enemy team.',
    description_pt: 'Sorcermon invoca uma rajada de meteoros pelo ar frio, espalhando magia vegetal sobre a equipe inimiga.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-755',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 34, scale: 'int', factor: 1.2 }, element: 'plant' }]
  }),

  // ---- Icemon (skb-758, Champion) ----
  i({
    idSuffix: 'skb758-1',
    name: 'Iceball Bomb',
    name_pt: 'Bomba Bola de Gelo',
    description: 'Icemon lobs bursting iceballs that explode across the enemy formation.',
    description_pt: 'Icemon arremessa bolas de gelo explosivas que estouram sobre a formação inimiga.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-758',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 30, scale: 'atk', factor: 1.15 }, element: 'ice' }]
  }),
  i({
    idSuffix: 'skb758-2',
    name: 'Ice Strike',
    name_pt: 'Golpe de Gelo',
    description: 'Icemon drives an icy fist into the foe, a simple strike made dangerous by solid frozen mass.',
    description_pt: 'Icemon crava um punho gelado no inimigo, um golpe simples tornado perigoso por massa congelada sólida.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-758',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 52, scale: 'atk', factor: 1.4 }, element: 'ice' }]
  }),

  // ---- Valkyrimon (skb-773, Mega) ----
  i({
    idSuffix: 'skb773-1',
    name: 'Fenrir Sword',
    name_pt: 'Espada Fenrir',
    description: 'Valkyrimon cuts one enemy with Fenrir Sword, leaving a weakening wound in the blade path.',
    description_pt: 'Valkyrimon corta um inimigo com a Espada Fenrir, deixando uma ferida enfraquecedora no trajeto da lâmina.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-773',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 88, scale: 'atk', factor: 1.9 }, element: 'ice' },
      { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.25, turns: 3 }
    ]
  }),
  i({
    idSuffix: 'skb773-2',
    name: "Aurvandil's Arrow",
    name_pt: 'Flecha de Aurvandil',
    description: "Valkyrimon fires Aurvandil's Arrow as an unavoidable shaft of light that pierces a single foe.",
    description_pt: 'Valkyrimon dispara a Flecha de Aurvandil como um raio de luz inevitável que perfura um único inimigo.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-773',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 96, scale: 'int', factor: 2.05 }, element: 'light', ignore_defense: true }]
  }),
];
