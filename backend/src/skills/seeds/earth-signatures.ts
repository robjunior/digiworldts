import type { SkillSeed } from './types.js';
import { makeSkillFactory } from './types.js';

const e = makeSkillFactory('earth', 'earth-sig');

export const EARTH_SIGNATURES: SkillSeed[] = [
  // ---- Drimogemon (skb-373, Champion) ----
  e({
    idSuffix: 'skb373-1',
    name: 'Drill Spin',
    name_pt: 'Giro Broca',
    description: 'Spins its drill nose through one enemy, boring past poor earth matchups with mineral-crushing force.',
    description_pt: 'Gira a broca do nariz através de um inimigo, perfurando afinidades ruins com força capaz de esmagar minerais.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-373',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 58, scale: 'atk', factor: 1.45 }, element: 'earth', ignore_defense: true }]
  }),
  e({
    idSuffix: 'skb373-2',
    name: 'Screw Claw',
    name_pt: 'Garra Parafuso',
    description: 'Rushes forward and rakes the foe with spiraling claws that tear open their guard.',
    description_pt: 'Avança e rasga o inimigo com garras espiraladas que abrem sua guarda.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-373',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 49, scale: 'atk', factor: 1.3 }, element: 'earth' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -10, turns: 3 }
    ]
  }),
  // ---- Groundramon (skb-211, Ultimate) ----
  e({
    idSuffix: 'skb211-1',
    name: 'Scrapless Claw',
    name_pt: 'Garra Sem Sucata',
    description: 'Rips into one target with rugged dragon claws, leaving a lingering injury in the wound.',
    description_pt: 'Dilacera um alvo com garras dracônicas rústicas, deixando uma lesão persistente na ferida.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-211',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 62, scale: 'atk', factor: 1.45 }, element: 'earth' },
      { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.5, turns: 3 }
    ]
  }),
  e({
    idSuffix: 'skb211-2',
    name: 'Ground Shredder',
    name_pt: 'Retalhador do Solo',
    description: 'Burrows under the battlefield and erupts beneath the enemy line in a tearing quake of claws and stone.',
    description_pt: 'Cava sob o campo de batalha e irrompe sob a linha inimiga em um tremor de garras e pedra.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-211',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 44, scale: 'atk', factor: 1.35 }, element: 'earth' }]
  }),
  // ---- Meteormon (skb-756, Ultimate) ----
  e({
    idSuffix: 'skb756-1',
    name: 'Galactic Flare',
    name_pt: 'Clarão Galáctico',
    description: 'Breaks apart into meteor fragments that rain repeatedly across every enemy.',
    description_pt: 'Fragmenta-se em meteoros que chovem repetidamente sobre todos os inimigos.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-756',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 52, scale: 'def', factor: 1.5 }, element: 'earth' }]
  }),
  e({
    idSuffix: 'skb756-2',
    name: 'Meteor Core',
    name_pt: 'Núcleo Meteórico',
    description: 'Compacts its stony body into a dense core, shielding itself before crashing into a foe.',
    description_pt: 'Compacta seu corpo rochoso em um núcleo denso, protegendo-se antes de colidir contra um inimigo.',
    stage: 'Ultimate',
    slot_role: 'buff_support',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-756',
    actions: [
      { kind: 'apply_buff', target: 'self', buff: 'shield_absorb', amount: 95, turns: 2 },
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 48, scale: 'def', factor: 1.25 }, element: 'earth' }
    ]
  }),
  // ---- Titamon (skb-440, Mega) ----
  e({
    idSuffix: 'skb440-1',
    name: 'Soul Core Attack',
    name_pt: 'Ataque do Núcleo da Alma',
    description: 'Drives its massive blade into one enemy, letting the soul core punch through bad affinity.',
    description_pt: 'Crava sua lâmina gigantesca em um inimigo, fazendo o núcleo da alma atravessar afinidades ruins.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-440',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 102, scale: 'atk', factor: 2.1 }, element: 'earth', ignore_defense: true }]
  }),
  e({
    idSuffix: 'skb440-2',
    name: 'Phantom Blade',
    name_pt: 'Lâmina Fantasma',
    description: 'Cuts through a humanoid foe with a ghostly blade that can leave the target badly injured.',
    description_pt: 'Corta um inimigo humanoide com uma lâmina espectral que pode deixá-lo gravemente ferido.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-440',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 88, scale: 'atk', factor: 1.9 }, element: 'earth' },
      { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.5, turns: 3 }
    ]
  }),
  // ---- Pandamon (skb-41, Ultimate) ----
  e({
    idSuffix: 'skb41-1',
    name: 'Animal Nail',
    name_pt: 'Garra Animal',
    description: 'Slashes with desperate beast claws, striking harder as fallen allies raise its fighting spirit.',
    description_pt: 'Golpeia com garras bestiais desesperadas, atacando com mais força conforme aliados caídos elevam seu espírito.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-41',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 66, scale: 'atk', factor: 1.55 }, element: 'earth' }]
  }),
  e({
    idSuffix: 'skb41-2',
    name: 'Shoudan',
    name_pt: 'Shoudan',
    description: 'Commits its full power to a heavy hand strike that dents armor and knocks the foe off balance.',
    description_pt: 'Concentra toda a sua força em um golpe de mão pesado que amassa armaduras e desequilibra o alvo.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-41',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 58, scale: 'atk', factor: 1.45 }, element: 'earth' },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  // ---- SkullBaluchimon (skb-239, Ultimate) ----
  e({
    idSuffix: 'skb239-1',
    name: 'Grave Bone',
    name_pt: 'Osso Sepulcral',
    description: 'Impales a target with fossilized bone, cracking its resistance to earth for follow-up blows.',
    description_pt: 'Empala um alvo com osso fossilizado, rachando sua resistência à terra para golpes seguintes.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-239',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 64, scale: 'atk', factor: 1.45 }, element: 'earth' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -25, turns: 3 }
    ]
  }),
  e({
    idSuffix: 'skb239-2',
    name: 'Ossuary Quake',
    name_pt: 'Terremoto Ossuário',
    description: 'Raises a field of buried bones in a low quake that batters the enemy formation.',
    description_pt: 'Ergue um campo de ossos enterrados em um tremor baixo que castiga a formação inimiga.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-239',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 43, scale: 'atk', factor: 1.3 }, element: 'earth' }]
  }),
  // ---- Triceramon (skb-33, Ultimate) ----
  e({
    idSuffix: 'skb33-1',
    name: 'Tri-Horn Attack',
    name_pt: 'Ataque Tri-Chifre',
    description: 'Charges with three horns lowered, aiming a brutal earth-shaking impact at one enemy.',
    description_pt: 'Investe com os três chifres abaixados, mirando um impacto brutal que faz a terra tremer contra um inimigo.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-33',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 78, scale: 'atk', factor: 1.75 }, element: 'earth' }]
  }),
  e({
    idSuffix: 'skb33-2',
    name: 'Ceratopsian Charge',
    name_pt: 'Carga Ceratopsiana',
    description: 'Stamps forward like an armored dinosaur, shoving the target later in the turn order.',
    description_pt: 'Avança como um dinossauro blindado, empurrando o alvo para mais tarde na ordem de turnos.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-33',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 58, scale: 'atk', factor: 1.45 }, element: 'earth' },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  // ---- ShineGreymon (skb-94, Mega) ----
  e({
    idSuffix: 'skb94-1',
    name: 'GeoGrey Sword',
    name_pt: 'Espada GeoGrey',
    description: 'Swings the GeoGrey Sword in a decisive slash that also raises its attack power.',
    description_pt: 'Brande a Espada GeoGrey em um corte decisivo que também aumenta seu poder de ataque.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 34,
    signature: true,
    owner_template_id: 'skb-94',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 94, scale: 'atk', factor: 2.0 }, element: 'earth' },
      { kind: 'modify_stat', target: 'self', stat: 'atk', delta: 20, turns: 3 }
    ]
  }),
  e({
    idSuffix: 'skb94-2',
    name: 'Glorious Burst',
    name_pt: 'Explosão Gloriosa',
    description: 'Releases a glorious burst of light across all enemies, searing evil targets in the blast.',
    description_pt: 'Libera uma explosão gloriosa de luz sobre todos os inimigos, queimando alvos malignos no clarão.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-94',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 58, scale: 'atk', factor: 1.65 }, element: 'light' }]
  }),
  // ---- Starmon (skb-14, Champion) ----
  e({
    idSuffix: 'skb14-1',
    name: 'Meteor Shower',
    name_pt: 'Chuva de Meteoros',
    description: 'Calls down a shower of small meteors that pepper every enemy with rocky impacts.',
    description_pt: 'Invoca uma chuva de pequenos meteoros que atinge todos os inimigos com impactos rochosos.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-14',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 36, scale: 'atk', factor: 1.25 }, element: 'earth' }]
  }),
  e({
    idSuffix: 'skb14-2',
    name: 'Mind Scan',
    name_pt: 'Varredura Mental',
    description: 'Uses telepathy to dazzle the opponent, scrambling their focus before the next exchange.',
    description_pt: 'Usa telepatia para deslumbrar o oponente, confundindo seu foco antes da próxima troca.',
    stage: 'Champion',
    slot_role: 'utility',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-14',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 36, scale: 'int', factor: 1.15 }, element: 'light' },
      { kind: 'apply_status', target: 'primary_target', status: 'confusion', chance: 0.35, turns: 2 }
    ]
  }),
  // ---- Minotarumon (skb-17, Champion) ----
  e({
    idSuffix: 'skb17-1',
    name: 'Darkside Quake',
    name_pt: 'Terremoto do Lado Sombrio',
    description: 'Slams the ground with dark power, sending a mineral-breaking quake through all enemies.',
    description_pt: 'Golpeia o chão com poder sombrio, enviando um tremor quebra-minerais por todos os inimigos.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-17',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 35, scale: 'atk', factor: 1.2 }, element: 'earth' }]
  }),
  e({
    idSuffix: 'skb17-2',
    name: 'Labrys Quake',
    name_pt: 'Tremor do Labrys',
    description: 'Hooks its axe into the earth and heaves, staggering the front line with a horned shockwave.',
    description_pt: 'Crava o machado na terra e puxa, cambaleando a linha de frente com uma onda de choque chifruda.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-17',
    actions: [
      { kind: 'deal_damage', target: 'enemy_front', amount: { base: 34, scale: 'atk', factor: 1.1 }, element: 'earth' },
      { kind: 'shift_initiative', target: 'enemy_front', delta: 1 }
    ]
  }),
  // ---- Leomon (skb-72, Champion) ----
  e({
    idSuffix: 'skb72-1',
    name: 'Fist of the Beast King',
    name_pt: 'Punho do Rei das Feras',
    description: 'Launches the lion king’s spirit from its fist, striking one enemy with heroic force.',
    description_pt: 'Lança o espírito do rei leão de seu punho, atingindo um inimigo com força heroica.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-72',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 60, scale: 'atk', factor: 1.55 }, element: 'earth' }]
  }),
  e({
    idSuffix: 'skb72-2',
    name: 'Hasaigeri',
    name_pt: 'Hasaigeri',
    description: 'Spins into a roundhouse kick that clips the foe and pushes their next action back.',
    description_pt: 'Gira em um chute circular que acerta o inimigo e atrasa sua próxima ação.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-72',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 45, scale: 'atk', factor: 1.25 }, element: 'earth' },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  // ---- Nefertimon (skb-147, Rookie) ----
  e({
    idSuffix: 'skb147-1',
    name: 'Rosetta Stone',
    name_pt: 'Pedra de Roseta',
    description: 'Hurls a mystic stone tablet at one enemy, confusing them with ancient inscriptions.',
    description_pt: 'Arremessa uma tabuleta mística de pedra contra um inimigo, confundindo-o com inscrições antigas.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 10,
    signature: true,
    owner_template_id: 'skb-147',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 39, scale: 'int', factor: 1.3 }, element: 'earth' },
      { kind: 'apply_status', target: 'primary_target', status: 'confusion', chance: 0.5, turns: 2 }
    ]
  }),
  e({
    idSuffix: 'skb147-2',
    name: 'Sanctuary Bind (Nefertimon)',
    name_pt: 'Laço do Santuário',
    description: 'Combines sacred light into a binding ring that ensnares one enemy without crushing the whole field.',
    description_pt: 'Combina luz sagrada em um anel vinculante que prende um inimigo sem esmagar o campo inteiro.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-147',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 30, scale: 'int', factor: 1.1 }, element: 'light' },
      { kind: 'apply_status', target: 'primary_target', status: 'root', chance: 0.45, turns: 1 }
    ]
  }),
  // ---- GreatGrizzlymon (skb-491, Ultimate) ----
  e({
    idSuffix: 'skb491-1',
    name: 'Spirited Claws',
    name_pt: 'Garras Espirituosas',
    description: 'Rends a single foe with bear claws filled with stubborn fighting spirit.',
    description_pt: 'Rasga um inimigo com garras de urso carregadas de espírito combativo teimoso.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-491',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 74, scale: 'atk', factor: 1.7 }, element: 'earth' }]
  }),
  e({
    idSuffix: 'skb491-2',
    name: 'Grizzly Maul',
    name_pt: 'Dilaceração Grizzly',
    description: 'Rears up and mauls the target with a crushing bear hug that saps their strength.',
    description_pt: 'Ergue-se e dilacera o alvo com um abraço de urso esmagador que drena sua força.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-491',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 58, scale: 'atk', factor: 1.45 }, element: 'earth' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'atk', delta: -18, turns: 3 }
    ]
  }),
  // ---- Gotsumon (skb-595, Rookie) ----
  e({
    idSuffix: 'skb595-1',
    name: 'Rock Fist',
    name_pt: 'Punho de Pedra',
    description: 'Throws rocky punches across the enemy side, pelting the whole formation with stone fists.',
    description_pt: 'Dispara socos rochosos pelo lado inimigo, alvejado a formação inteira com punhos de pedra.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-595',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 25, scale: 'atk', factor: 0.95 }, element: 'earth' }]
  }),
  e({
    idSuffix: 'skb595-2',
    name: 'Hardest Punch',
    name_pt: 'Soco Duríssimo',
    description: 'Punches with its rock fist at maximum hardness, cracking one foe’s defense.',
    description_pt: 'Soca com seu punho de pedra na dureza máxima, rachando a defesa de um inimigo.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-595',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 40, scale: 'atk', factor: 1.35 }, element: 'earth' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -12, turns: 3 }
    ]
  }),
  // ---- Armadillomon (skb-707, Rookie) ----
  e({
    idSuffix: 'skb707-1',
    name: 'Diamond Shell',
    name_pt: 'Casco Diamante',
    description: 'Slams one enemy with its diamond-hard shell, lowering their defense for follow-up hits.',
    description_pt: 'Atinge um inimigo com seu casco duro como diamante, reduzindo sua defesa para golpes seguintes.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-707',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 35, scale: 'def', factor: 1.25 }, element: 'earth' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -20, turns: 3 }
    ]
  }),
  e({
    idSuffix: 'skb707-2',
    name: 'Rigid Block',
    name_pt: 'Bloqueio Rígido',
    description: 'Curls into a ball to repel attacks, gaining a small personal shield and bracing its defense.',
    description_pt: 'Enrola-se em uma bola para repelir ataques, recebendo um pequeno escudo pessoal e firmando a defesa.',
    stage: 'Rookie',
    slot_role: 'buff_support',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-707',
    actions: [
      { kind: 'apply_buff', target: 'self', buff: 'shield_absorb', amount: 55, turns: 2 },
      { kind: 'modify_stat', target: 'self', stat: 'def', delta: 12, turns: 3 }
    ]
  }),
  // ---- Ankylomon (skb-711, Champion) ----
  e({
    idSuffix: 'skb711-1',
    name: 'Tail Hammer',
    name_pt: 'Martelo de Cauda',
    description: 'Swings its spiked tail like a hammer, striking one enemy hard enough to confuse them.',
    description_pt: 'Balança a cauda espinhosa como um martelo, atingindo um inimigo com força suficiente para confundi-lo.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-711',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 50, scale: 'atk', factor: 1.35 }, element: 'earth' },
      { kind: 'apply_status', target: 'primary_target', status: 'confusion', chance: 0.25, turns: 2 }
    ]
  }),
  e({
    idSuffix: 'skb711-2',
    name: 'Rhythmical Knock',
    name_pt: 'Batida Rítmica',
    description: 'Slams its forefeet rhythmically, launching pillars of earth that crash into the foe.',
    description_pt: 'Bate as patas dianteiras ritmicamente, lançando pilares de terra que colidem contra o inimigo.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    energyCost: 15,
    signature: true,
    owner_template_id: 'skb-711',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 60, scale: 'atk', factor: 1.55 }, element: 'earth' }]
  }),
  // ---- Leopardmon LM (skb-743, Mega) ----
  e({
    idSuffix: 'skb743-1',
    name: 'Vulcan Crusher (Leopardmon LM)',
    name_pt: 'Esmagador Vulcano',
    description: 'Crushes one enemy with a swift Vulcan strike, acting best before the target can move.',
    description_pt: 'Esmaga um inimigo com um golpe vulcânico veloz, funcionando melhor antes que o alvo possa agir.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 33,
    signature: true,
    owner_template_id: 'skb-743',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 92, scale: 'spd', factor: 2.0 }, element: 'earth' },
      { kind: 'shift_initiative', target: 'self', delta: -1 }
    ]
  }),
  e({
    idSuffix: 'skb743-2',
    name: 'Eroberung',
    name_pt: 'Eroberung',
    description: 'Conquers the enemy line with a lightning-fast rush that batters machine targets.',
    description_pt: 'Conquista a linha inimiga com uma investida elétrica veloz que castiga alvos mecânicos.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-743',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 56, scale: 'spd', factor: 1.65 }, element: 'electricity' }]
  }),
  // ---- MudFrigimon (skb-759, Champion) ----
  e({
    idSuffix: 'skb759-1',
    name: 'Great Weight',
    name_pt: 'Grande Peso',
    description: 'Drops its muddy body weight onto the battlefield, flattening every enemy with earth force.',
    description_pt: 'Derruba o peso de seu corpo lamacento no campo, achatando todos os inimigos com força terrestre.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-759',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 35, scale: 'def', factor: 1.2 }, element: 'earth' }]
  }),
  e({
    idSuffix: 'skb759-2',
    name: 'Mud Coat',
    name_pt: 'Casaco de Lama',
    description: 'Coats itself in packed mud, boosting its attack while a thin shell absorbs the next blows.',
    description_pt: 'Reveste-se de lama compacta, aumentando seu ataque enquanto uma casca fina absorve os próximos golpes.',
    stage: 'Champion',
    slot_role: 'buff_support',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-759',
    actions: [
      { kind: 'modify_stat', target: 'self', stat: 'atk', delta: 18, turns: 3 },
      { kind: 'apply_buff', target: 'self', buff: 'shield_absorb', amount: 70, turns: 2 }
    ]
  })
];
