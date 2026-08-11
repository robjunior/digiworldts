import { makeSkillFactory, type SkillSeed } from './types.js';

const d = makeSkillFactory('dark', 'dark-sig');

export const DARK_SIGNATURES: SkillSeed[] = [
  // ---- Kurisarimon (skb-630, Champion) ----
  d({
    idSuffix: 'skb630-1',
    name: 'Data Crusher',
    name_pt: 'Triturador de Dados',
    description: 'Drives crystalline claws into one foe, crushing data and leaving the body rigid like corrupted glass.',
    description_pt: 'Crava garras cristalinas em um inimigo, tritura dados e deixa o corpo rígido como vidro corrompido.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-630',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 45, scale: 'atk', factor: 1.3 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'petrify', chance: 0.3, turns: 1 }
    ]
  }),
  d({
    idSuffix: 'skb630-2',
    name: 'Chrysalid Ambush',
    name_pt: 'Emboscada de Crisálida',
    description: 'Drops from its shell in a sudden bite, draining strength while the victim is pinned in dark thread.',
    description_pt: 'Cai de sua casca em uma mordida súbita, drenando força enquanto a vítima fica presa em fios sombrios.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-630',
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 40, scale: 'atk', factor: 1.2 }, heal_pct: 0.18, element: 'dark' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'spd', delta: -10, turns: 2 }
    ]
  }),
  // ---- Snimon (skb-597, Champion) ----
  d({
    idSuffix: 'skb597-1',
    name: 'Shadow Sickle',
    name_pt: 'Foice Sombria',
    description: 'Carves a sure arc with its mantis blades, cutting through the target with a dark crescent.',
    description_pt: 'Traça um arco certeiro com suas lâminas de louva-a-deus, cortando o alvo com uma meia-lua sombria.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-597',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 58, scale: 'atk', factor: 1.55 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb597-2',
    name: 'Shadow Slash',
    name_pt: 'Corte Sombrio',
    description: 'Flashes past on hooked forearms, opening a black-edged gash that drops the enemy defense.',
    description_pt: 'Passa veloz com os antebraços em gancho, abrindo um corte escuro que reduz a defesa inimiga.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 12,
    signature: true,
    owner_template_id: 'skb-597',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 44, scale: 'atk', factor: 1.25 }, element: 'dark' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -15, turns: 3 }
    ]
  }),
  // ---- Cerberusmon (skb-223, Ultimate) ----
  d({
    idSuffix: 'skb223-1',
    name: 'Mad Dog Fire (Cerberusmon)',
    name_pt: 'Fogo de Cão Raivoso',
    description: 'Its three heads rake the enemy line with dark hellfire, charring foes and crystallizing exposed wounds.',
    description_pt: 'Suas três cabeças varrem a linha inimiga com fogo infernal sombrio, chamuscando alvos e cristalizando feridas expostas.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-223',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 48, scale: 'atk', factor: 1.25 }, element: 'dark' },
      { kind: 'apply_status', target: 'enemy_all', status: 'petrify', chance: 0.2, turns: 1 }
    ]
  }),
  d({
    idSuffix: 'skb223-2',
    name: 'Inferno Divide (Cerberusmon)',
    name_pt: 'Divisão Infernal',
    description: 'Splits one target with a blazing claw lane, punching through guard with underworld heat.',
    description_pt: 'Parte um alvo com uma trilha ardente de garras, atravessando a guarda com calor do submundo.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 22,
    signature: true,
    owner_template_id: 'skb-223',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 72, scale: 'atk', factor: 1.75 }, element: 'dark', ignore_defense: true }]
  }),
  // ---- DarkSuperStarmon (skb-217, Ultimate) ----
  d({
    idSuffix: 'skb217-1',
    name: 'Dark Explosion',
    name_pt: 'Explosão Sombria',
    description: 'Detonates a cluster of black stars over the field, pelting every enemy with repeated blasts.',
    description_pt: 'Detona um aglomerado de estrelas negras sobre o campo, atingindo todos os inimigos com explosões repetidas.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 22,
    signature: true,
    owner_template_id: 'skb-217',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 54, scale: 'int', factor: 1.45 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb217-2',
    name: 'Black Star Blackout',
    name_pt: 'Apagão da Estrela Negra',
    description: 'Flares its sunglasses like dead stage lights, blinding foes while a dark nova knocks their timing back.',
    description_pt: 'Faz seus óculos brilharem como refletores mortos, cegando inimigos enquanto uma nova sombria atrasa o ritmo deles.',
    stage: 'Ultimate',
    slot_role: 'utility',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-217',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 38, scale: 'int', factor: 1.2 }, element: 'dark' },
      { kind: 'apply_status', target: 'enemy_all', status: 'blind', chance: 0.35, turns: 2 },
      { kind: 'shift_initiative', target: 'enemy_all', delta: 1 }
    ]
  }),
  // ---- Enbarrmon (skb-920, Ultimate) ----
  d({
    idSuffix: 'skb920-1',
    name: 'Dead Angle Horn',
    name_pt: 'Chifre do Ângulo Morto',
    description: 'Spears from an impossible angle with its warped horn, tearing armor loose from the victim.',
    description_pt: 'Perfura de um ângulo impossível com o chifre distorcido, arrancando a armadura da vítima.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-920',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 62, scale: 'atk', factor: 1.45 }, element: 'dark' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -10, turns: 3 }
    ]
  }),
  d({
    idSuffix: 'skb920-2',
    name: 'Night Mare Trample',
    name_pt: 'Pisoteio do Corcel Noturno',
    description: 'Gallops through a single foe in a midnight charge, stealing momentum as hooves crush the shadow.',
    description_pt: 'Galopa através de um inimigo em uma investida de meia-noite, roubando impulso enquanto os cascos esmagam a sombra.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-920',
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 56, scale: 'atk', factor: 1.35 }, heal_pct: 0.22, element: 'dark' },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  // ---- Infermon (skb-627, Ultimate) ----
  d({
    idSuffix: 'skb627-1',
    name: 'Spider Shooter',
    name_pt: 'Atirador Aranha',
    description: 'Fires four hooked shots from its spider limbs, converging on one enemy like a web of bullets.',
    description_pt: 'Dispara quatro projéteis curvos dos membros de aranha, convergindo em um inimigo como uma teia de balas.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-627',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 68, scale: 'atk', factor: 1.65 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb627-2',
    name: 'Virus Skater',
    name_pt: 'Patinador Viral',
    description: 'Breathes dark electrified gas while skating around the target, choking it and scrambling reflexes.',
    description_pt: 'Sopra gás escuro eletrificado enquanto patina ao redor do alvo, sufocando-o e embaralhando reflexos.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-627',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 52, scale: 'int', factor: 1.35 }, element: 'dark' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'spd', delta: -15, turns: 3 },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.25, turns: 1 }
    ]
  }),
  // ---- LadyDevimon (skb-107, Ultimate) ----
  d({
    idSuffix: 'skb107-1',
    name: 'Darkness Wave',
    name_pt: 'Onda de Escuridão',
    description: 'Unleashes a flock of razor-winged bats that rake every enemy in successive waves.',
    description_pt: 'Libera uma revoada de morcegos de asas cortantes que rasgam todos os inimigos em ondas sucessivas.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-107',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 48, scale: 'int', factor: 1.35 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb107-2',
    name: 'Darkness Spear',
    name_pt: 'Lança da Escuridão',
    description: 'Transforms her left arm into a burning spear and drives it through the opponent.',
    description_pt: 'Transforma o braço esquerdo em uma lança ardente e a crava através do oponente.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-107',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 64, scale: 'atk', factor: 1.55 }, element: 'fire' }]
  }),
  // ---- BeelStarmon (skb-195, Mega) ----
  d({
    idSuffix: 'skb195-1',
    name: 'Fly Bullet',
    name_pt: 'Bala Mosca',
    description: 'Lines up the Berenjena shotgun and fires a cursed bullet that never gives the marked foe room to dodge.',
    description_pt: 'Mira a escopeta Berenjena e dispara uma bala amaldiçoada que não dá espaço para o alvo marcado desviar.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-195',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 88, scale: 'atk', factor: 2.0 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb195-2',
    name: 'Hurricane Screw Shot',
    name_pt: 'Disparo Parafuso Furacão',
    description: 'Spins through the air with twin guns blazing, peppering the enemy formation with corkscrew shots.',
    description_pt: 'Gira no ar com as duas armas em chamas, crivando a formação inimiga com disparos em espiral.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 28,
    signature: true,
    owner_template_id: 'skb-195',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 58, scale: 'atk', factor: 1.55 }, element: 'dark' }]
  }),
  // ---- BlackWarGreymon (skb-175, Mega) ----
  d({
    idSuffix: 'skb175-1',
    name: 'Dark Terra Force',
    name_pt: 'Força Terra Sombria',
    description: 'Compresses black atmospheric energy into a planet-sized blast and hurls it into one enemy.',
    description_pt: 'Comprime energia atmosférica negra em uma explosão do tamanho de um planeta e a arremessa em um inimigo.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 32,
    signature: true,
    owner_template_id: 'skb-175',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 98, scale: 'int', factor: 2.1 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb175-2',
    name: 'Black Tornado',
    name_pt: 'Tornado Negro',
    description: 'Turns its armored body into a drilling vortex that bores straight through the target.',
    description_pt: 'Transforma o corpo blindado em um vórtice perfurante que atravessa diretamente o alvo.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 28,
    signature: true,
    owner_template_id: 'skb-175',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 84, scale: 'atk', factor: 1.95 }, element: 'null' }]
  }),
  // ---- ChaosGallantmon (skb-150, Mega) ----
  d({
    idSuffix: 'skb150-1',
    name: 'Demonic Disaster',
    name_pt: 'Desastre Demoníaco',
    description: 'Surges forward with shield and lance in a black combo, shaking off hindrances as it breaks the foe.',
    description_pt: 'Avança com escudo e lança em um combo negro, sacudindo impedimentos enquanto rompe o inimigo.',
    stage: 'Mega',
    slot_role: 'utility',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-150',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 84, scale: 'atk', factor: 1.9 }, element: 'dark' },
      { kind: 'cleanse', target: 'self' }
    ]
  }),
  d({
    idSuffix: 'skb150-2',
    name: 'Judecca Prison',
    name_pt: 'Prisão Judecca',
    description: 'Seals one enemy in a frozen hell of darkness, crushing it inside the prison walls.',
    description_pt: 'Sela um inimigo em um inferno gelado de trevas, esmagando-o dentro das paredes da prisão.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-150',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 96, scale: 'int', factor: 2.0 }, element: 'dark' }]
  }),
  // ---- Cherubimon (Black) (skb-774, Mega) ----
  d({
    idSuffix: 'skb774-1',
    name: 'Lightning Spear (Cherubimon Black)',
    name_pt: 'Lança Relâmpago',
    description: 'Forms a corrupted thunder lance and skewers one foe with dark holy lightning.',
    description_pt: 'Forma uma lança de trovão corrompida e empala um inimigo com relâmpago sagrado sombrio.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-774',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 92, scale: 'int', factor: 2.0 }, element: 'dark', ignore_defense: true }]
  }),
  d({
    idSuffix: 'skb774-2',
    name: "Heaven's Judgment (Cherubimon Black)",
    name_pt: 'Julgamento do Céu',
    description: 'Calls down black verdict bolts over all enemies, turning judgment into a rain of corrupted light.',
    description_pt: 'Invoca raios de veredito negro sobre todos os inimigos, transformando julgamento em chuva de luz corrompida.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-774',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 60, scale: 'int', factor: 1.55 }, element: 'dark' }]
  }),
  // ---- Darkdramon (skb-771, Mega) ----
  d({
    idSuffix: 'skb771-1',
    name: 'Dark Roar',
    name_pt: 'Rugido Sombrio',
    description: 'Releases a cannon-like roar of black energy that batters a single target with brutal force.',
    description_pt: 'Libera um rugido de energia negra como canhão que golpeia um único alvo com força brutal.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-771',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 94, scale: 'atk', factor: 2.0 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb771-2',
    name: 'Gigastick Lance',
    name_pt: 'Lança Gigastick',
    description: 'Launches its colossal lance in a straight thrust that pierces defenses and pins the enemy back.',
    description_pt: 'Dispara sua lança colossal em uma estocada reta que perfura defesas e empurra o inimigo para trás.',
    stage: 'Mega',
    slot_role: 'utility',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-771',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 88, scale: 'atk', factor: 1.9 }, element: 'null', ignore_defense: true },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  // ---- Diaboromon (skb-632, Mega) ----
  d({
    idSuffix: 'skb632-1',
    name: 'Catastrophe Cannon',
    name_pt: 'Canhão Catastrófico',
    description: 'Opens its chest and fires a catastrophic dark beam that detonates around the chosen foe.',
    description_pt: 'Abre o peito e dispara um feixe sombrio catastrófico que detona ao redor do inimigo escolhido.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-632',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 96, scale: 'int', factor: 2.0 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb632-2',
    name: 'Tentacle Bug',
    name_pt: 'Inseto Tentáculo',
    description: 'Extends elastic arms into hooked claws, dragging the target close before shredding it.',
    description_pt: 'Estende braços elásticos em garras curvas, puxando o alvo para perto antes de retalhá-lo.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 27,
    signature: true,
    owner_template_id: 'skb-632',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 82, scale: 'atk', factor: 1.85 }, element: 'null' }]
  }),
  // ---- Junomon (skb-170, Mega) ----
  d({
    idSuffix: 'skb170-1',
    name: 'Needle Hive',
    name_pt: 'Colmeia de Agulhas',
    description: 'Launches a swarm of venom needles that pierce one foe and flood the wound with deadly poison.',
    description_pt: 'Lança um enxame de agulhas venenosas que perfuram um inimigo e inundam a ferida com veneno mortal.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-170',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 78, scale: 'atk', factor: 1.75 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'poison', chance: 1.0, turns: 3 }
    ]
  }),
  d({
    idSuffix: 'skb170-2',
    name: 'Hera Vengeance',
    name_pt: 'Vingança de Hera',
    description: 'Brands the enemy with jealous thorns, siphoning vitality while the curse tightens.',
    description_pt: 'Marca o inimigo com espinhos ciumentos, sugando vitalidade enquanto a maldição aperta.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 28,
    signature: true,
    owner_template_id: 'skb-170',
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 78, scale: 'int', factor: 1.75 }, heal_pct: 0.25, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'curse', chance: 0.55, turns: 2 }
    ]
  }),
  // ---- Lilithmon (skb-34, Mega) ----
  d({
    idSuffix: 'skb34-1',
    name: 'Phantom Pain',
    name_pt: 'Dor Fantasma',
    description: 'Caresses the battlefield with a poisonous phantom wave, sickening every enemy and weakening their bodies.',
    description_pt: 'Acaricia o campo com uma onda fantasma venenosa, intoxicando todos os inimigos e enfraquecendo seus corpos.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 32,
    signature: true,
    owner_template_id: 'skb-34',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 58, scale: 'int', factor: 1.45 }, element: 'dark' },
      { kind: 'apply_status', target: 'enemy_all', status: 'poison', chance: 0.75, turns: 3 },
      { kind: 'apply_status', target: 'enemy_all', status: 'weaken', chance: 0.75, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'skb34-2',
    name: 'Darkness Love',
    name_pt: 'Amor Sombrio',
    description: 'Releases a lustful heart-shaped aura that clouds the target mind and bends it toward ruin.',
    description_pt: 'Libera uma aura lasciva em forma de coração que turva a mente do alvo e a curva para a ruína.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-34',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 78, scale: 'int', factor: 1.8 }, element: 'light' },
      { kind: 'apply_status', target: 'primary_target', status: 'charm', chance: 0.6, turns: 1 }
    ]
  }),
  // ---- Millenniummon (skb-230, Mega) ----
  d({
    idSuffix: 'skb230-1',
    name: 'Time Unlimited',
    name_pt: 'Tempo Ilimitado',
    description: 'Locks the victim inside a warped timeline, crushing it with ancient darkness until the body crystallizes.',
    description_pt: 'Prende a vítima em uma linha temporal distorcida, esmagando-a com trevas ancestrais até o corpo cristalizar.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 32,
    signature: true,
    owner_template_id: 'skb-230',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 92, scale: 'int', factor: 2.0 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'petrify', chance: 0.5, turns: 1 },
      { kind: 'shift_initiative', target: 'primary_target', delta: 2 }
    ]
  }),
  d({
    idSuffix: 'skb230-2',
    name: 'Millennium Eclipse',
    name_pt: 'Eclipse do Milênio',
    description: 'Spreads an ancient eclipse over the field, burning every enemy with entropy and sapping their speed.',
    description_pt: 'Espalha um eclipse ancestral pelo campo, queimando todos os inimigos com entropia e drenando sua velocidade.',
    stage: 'Mega',
    slot_role: 'utility',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-230',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 58, scale: 'int', factor: 1.45 }, element: 'dark' },
      { kind: 'modify_stat', target: 'enemy_all', stat: 'spd', delta: -10, turns: 3 }
    ]
  }),
  // ---- Pharaohmon (skb-227, Mega) ----
  d({
    idSuffix: 'skb227-1',
    name: 'Necromist',
    name_pt: 'Névoa Necromântica',
    description: 'Exhales tomb mist over one foe, rotting its senses until panic turns into chaos.',
    description_pt: 'Exala névoa de tumba sobre um inimigo, apodrecendo seus sentidos até o pânico virar caos.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-227',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 84, scale: 'int', factor: 1.85 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'confusion', chance: 0.6, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'skb227-2',
    name: 'Sarcophagus Seal',
    name_pt: 'Selo do Sarcófago',
    description: 'Slams a spectral coffin around the enemy, draining life as burial curses weigh down its guard.',
    description_pt: 'Fecha um caixão espectral ao redor do inimigo, drenando vida enquanto maldições funerárias pesam sua guarda.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 28,
    signature: true,
    owner_template_id: 'skb-227',
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 78, scale: 'int', factor: 1.75 }, heal_pct: 0.25, element: 'dark' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -15, turns: 3 }
    ]
  }),
  // ---- Plutomon (skb-180, Mega) ----
  d({
    idSuffix: 'skb180-1',
    name: "Hell's Gate",
    name_pt: 'Portão do Inferno',
    description: 'Opens the gate of the underworld beneath one enemy, dragging it down while its defenses collapse.',
    description_pt: 'Abre o portão do submundo sob um inimigo, arrastando-o para baixo enquanto suas defesas desabam.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-180',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 90, scale: 'atk', factor: 1.95 }, element: 'dark' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -20, turns: 3 }
    ]
  }),
  d({
    idSuffix: 'skb180-2',
    name: 'Haggard Cluster',
    name_pt: 'Enxame Exausto',
    description: 'Scatters bleak blades through the opposing side, nicking every enemy and leaving brittle crystals behind.',
    description_pt: 'Espalha lâminas sombrias pelo lado oposto, ferindo todos os inimigos e deixando cristais quebradiços para trás.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-180',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 58, scale: 'atk', factor: 1.5 }, element: 'dark' },
      { kind: 'apply_status', target: 'enemy_all', status: 'petrify', chance: 0.2, turns: 1 }
    ]
  }),
  // ---- Barbamon (skb-36, Mega) ----
  d({
    idSuffix: 'skb36-1',
    name: 'Pandemonium Lost',
    name_pt: 'Pandemônio Perdido',
    description: 'Summons a greedy demonic storm from Death Lure, swallowing the entire enemy line in darkness.',
    description_pt: 'Invoca uma tempestade demoníaca gananciosa do Death Lure, engolindo toda a linha inimiga em trevas.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 33,
    signature: true,
    owner_template_id: 'skb-36',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 68, scale: 'int', factor: 1.65 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb36-2',
    name: 'Jigoku no Kaen',
    name_pt: 'Jigoku no Kaen',
    description: 'Shoots a stream of hellfire from Death Lure, burning one foe while the flame feeds its malice.',
    description_pt: 'Dispara um fluxo de fogo infernal do Death Lure, queimando um inimigo enquanto a chama alimenta sua malícia.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 28,
    signature: true,
    owner_template_id: 'skb-36',
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 78, scale: 'int', factor: 1.75 }, heal_pct: 0.22, element: 'fire' },
      { kind: 'apply_status', target: 'primary_target', status: 'burn', chance: 0.55, turns: 2 }
    ]
  }),
  // ---- Taomon (skb-405, Ultimate) ----
  d({
    idSuffix: 'skb405-1',
    name: 'Talisman of Light',
    name_pt: 'Talismã de Luz',
    description: 'Pins a spirit talisman to the foe, bursting with dark onmyou magic that strips away protective charms.',
    description_pt: 'Prende um talismã espiritual no inimigo, explodindo com magia onmyou sombria que remove encantos protetores.',
    stage: 'Ultimate',
    slot_role: 'utility',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-405',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 66, scale: 'int', factor: 1.55 }, element: 'dark' },
      { kind: 'dispel', target: 'primary_target' }
    ]
  }),
  d({
    idSuffix: 'skb405-2',
    name: 'Trinity Burst',
    name_pt: 'Explosão Trindade',
    description: 'Combines allied sacred power into a rainbow burst that pierces through the chosen foe.',
    description_pt: 'Combina poder sagrado aliado em uma explosão arco-íris que atravessa o inimigo escolhido.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-405',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 64, scale: 'int', factor: 1.5 }, element: 'water' }]
  }),
  // ---- Vademon (skb-411, Ultimate) ----
  d({
    idSuffix: 'skb411-1',
    name: 'Unidentified Flying Kiss',
    name_pt: 'Beijo Voador Não Identificado',
    description: 'Blows an alien kiss that crashes into one target, stunning the mind and crystallizing its nerves.',
    description_pt: 'Sopra um beijo alienígena que colide com um alvo, atordoando a mente e cristalizando seus nervos.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-411',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 62, scale: 'int', factor: 1.45 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'petrify', chance: 0.3, turns: 1 }
    ]
  }),
  d({
    idSuffix: 'skb411-2',
    name: 'Mutilate',
    name_pt: 'Mutilar',
    description: 'Dances beneath multicolored spotlights before shocking the opponent with a mysterious hand beam.',
    description_pt: 'Dança sob refletores multicoloridos antes de eletrocutar o oponente com um raio misterioso da mão.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-411',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 60, scale: 'int', factor: 1.4 }, element: 'light' }]
  }),
  // ---- Imperialdramon DM (skb-732, Mega) ----
  d({
    idSuffix: 'skb732-1',
    name: 'Mega Death',
    name_pt: 'Mega Morte',
    description: 'Unleashes dragon-mode annihilation across the battlefield, washing every enemy in dark energy.',
    description_pt: 'Libera aniquilação em modo dragão pelo campo de batalha, banhando todos os inimigos em energia sombria.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 33,
    signature: true,
    owner_template_id: 'skb-732',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 66, scale: 'int', factor: 1.65 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb732-2',
    name: 'Positron Laser (Imperialdramon DM)',
    name_pt: 'Laser Positron',
    description: 'Locks on with the dragon cannon and drills one enemy with a concentrated positron beam.',
    description_pt: 'Mira com o canhão dracônico e perfura um inimigo com um feixe de pósitrons concentrado.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-732',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 88, scale: 'int', factor: 1.9 }, element: 'light' }]
  }),
  // ---- ZombiePlutomon (skb-912, Mega) ----
  d({
    idSuffix: 'skb912-1',
    name: 'Hell Slicer',
    name_pt: 'Fatiador Infernal',
    description: 'Sweeps a rotten underworld blade across all enemies, cutting through affinity and sowing chaos.',
    description_pt: 'Varre todos os inimigos com uma lâmina podre do submundo, cortando afinidade e semeando caos.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-912',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 62, scale: 'atk', factor: 1.55 }, element: 'dark', ignore_defense: true },
      { kind: 'apply_status', target: 'enemy_all', status: 'confusion', chance: 0.5, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'skb912-2',
    name: 'Marionette Abomination',
    name_pt: 'Abominação Marionete',
    description: 'Hooks one victim with corpse strings, yanking it into a crushing puppet execution.',
    description_pt: 'Prende uma vítima com cordas cadavéricas, puxando-a para uma execução esmagadora de marionete.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 32,
    signature: true,
    owner_template_id: 'skb-912',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 104, scale: 'atk', factor: 2.05 }, element: 'dark' }]
  }),
  // ---- Kuzuhamon (skb-754, Mega) ----
  d({
    idSuffix: 'skb754-1',
    name: 'Taizoukai Mandala',
    name_pt: 'Mandala Taizoukai',
    description: 'Spreads a mandala of dark sutras beneath all enemies while purifying harmful marks from allies.',
    description_pt: 'Espalha um mandala de sutras sombrios sob todos os inimigos enquanto purifica marcas nocivas dos aliados.',
    stage: 'Mega',
    slot_role: 'utility',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-754',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 56, scale: 'int', factor: 1.45 }, element: 'dark' },
      { kind: 'cleanse', target: 'caster_ally_all' }
    ]
  }),
  d({
    idSuffix: 'skb754-2',
    name: 'Illuminator',
    name_pt: 'Iluminador',
    description: 'Focuses fox-miko light into a dark beam that pierces one target with perfect ritual aim.',
    description_pt: 'Concentra luz de miko raposa em um feixe sombrio que perfura um alvo com mira ritual perfeita.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 30,
    signature: true,
    owner_template_id: 'skb-754',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 92, scale: 'int', factor: 2.0 }, element: 'dark' }]
  }),
  // ---- SkullSatamon (skb-6, Ultimate) ----
  d({
    idSuffix: 'skb6-1',
    name: 'Nail Bone',
    name_pt: 'Osso-Prego',
    description: 'Hurls cursed bone nails across the enemy side, stabbing every foe with skeletal dark magic.',
    description_pt: 'Arremessa pregos ósseos amaldiçoados pelo lado inimigo, perfurando todos os alvos com magia esquelética sombria.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-6',
    actions: [{ kind: 'deal_damage', target: 'enemy_all', amount: { base: 52, scale: 'int', factor: 1.4 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb6-2',
    name: 'Bone Nail Crucifix',
    name_pt: 'Crucifixo de Ossos-Prego',
    description: 'Pins one enemy to a spectral cross of bones, draining vigor while the curse bites deeper.',
    description_pt: 'Prende um inimigo a uma cruz espectral de ossos, drenando vigor enquanto a maldição morde mais fundo.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-6',
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 55, scale: 'int', factor: 1.35 }, heal_pct: 0.22, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'curse', chance: 0.5, turns: 2 }
    ]
  }),
  // ---- Hagurumon (skb-9, Rookie) ----
  d({
    idSuffix: 'skb9-1',
    name: 'Cog Crusher',
    name_pt: 'Triturador de Engrenagens',
    description: 'Bites down with grinding gears, crushing one target in a burst of dark machine force.',
    description_pt: 'Morde com engrenagens triturantes, esmagando um alvo em uma rajada de força mecânica sombria.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-9',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'atk', factor: 1.25 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb9-2',
    name: 'Haguru Attack',
    name_pt: 'Ataque Haguru',
    description: 'Slams its metal body into the opponent, rattling gears loose and knocking timing off balance.',
    description_pt: 'Bate o corpo metálico no oponente, soltando engrenagens e desequilibrando seu tempo de ação.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-9',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 28, scale: 'atk', factor: 1.05 }, element: 'fire' },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  // ---- Sangloupmon (skb-30, Champion) ----
  d({
    idSuffix: 'skb30-1',
    name: 'Sticker Blade',
    name_pt: 'Lâmina Adesiva',
    description: 'Flicks hidden blades from its wolf body, sticking the target with repeated dark cuts.',
    description_pt: 'Lança lâminas ocultas de seu corpo lupino, cravando cortes sombrios repetidos no alvo.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-30',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 56, scale: 'atk', factor: 1.45 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb30-2',
    name: 'Drain Slash (Sangloupmon)',
    name_pt: 'Corte Drenante',
    description: 'Slices with blood-red claws, pulling warmth from the wound back into itself.',
    description_pt: 'Corta com garras vermelho-sangue, puxando o calor da ferida de volta para si.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-30',
    actions: [{ kind: 'drain', target: 'primary_target', damage: { base: 45, scale: 'atk', factor: 1.25 }, heal_pct: 0.22, element: 'fire' }]
  }),
  // ---- Matadormon (skb-31, Ultimate) ----
  d({
    idSuffix: 'skb31-1',
    name: 'Earth-Shattering Stomp',
    name_pt: 'Pisada Estremece-Terra',
    description: 'Stomps through the duel floor with vampire grace, cracking the enemy and drinking back damage.',
    description_pt: 'Pisa no chão do duelo com graça vampírica, rachando o inimigo e bebendo de volta o dano.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-31',
    actions: [{ kind: 'drain', target: 'primary_target', damage: { base: 64, scale: 'atk', factor: 1.5 }, heal_pct: 0.2, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb31-2',
    name: 'Thousand Arrow',
    name_pt: 'Mil Flechas',
    description: 'Fires the countless rapiers hidden in its sleeves, skewering one opponent in a crimson volley.',
    description_pt: 'Dispara os inúmeros floretes escondidos nas mangas, empalando um oponente em uma saraivada carmesim.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-31',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 70, scale: 'atk', factor: 1.65 }, element: 'fire' }]
  }),
  // ---- Lucemon CM (skb-39, Ultimate) ----
  d({
    idSuffix: 'skb39-1',
    name: 'Dead or Alive',
    name_pt: 'Morto ou Vivo',
    description: 'Judges one foe with a volatile dark spell that can either wound or erupt into lethal force.',
    description_pt: 'Julga um inimigo com um feitiço sombrio volátil que pode ferir ou explodir em força letal.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 22,
    signature: true,
    owner_template_id: 'skb-39',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 62, scale: 'int', factor: 1.45 }, element: 'dark' },
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 50 },
        then: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 32, scale: 'int', factor: 0.7 }, element: 'dark' }]
      }
    ]
  }),
  d({
    idSuffix: 'skb39-2',
    name: 'Paradise Lost',
    name_pt: 'Paraíso Perdido',
    description: 'Falls from above in a ruined angel dive, breaking the target link to neutral protection.',
    description_pt: 'Cai do alto em um mergulho de anjo arruinado, rompendo o vínculo do alvo com proteção neutra.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-39',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 68, scale: 'atk', factor: 1.55 }, element: 'null' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -15, turns: 3 }
    ]
  }),
  // ---- BlackGatomon (skb-43, Champion) ----
  d({
    idSuffix: 'skb43-1',
    name: 'Lightning Paw (BlackGatomon)',
    name_pt: 'Pata Relâmpago',
    description: 'Strikes with a crackling black paw, jolting one foe into confused, staggering steps.',
    description_pt: 'Golpeia com uma pata negra crepitante, fazendo um inimigo cambalear em passos confusos.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-43',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 48, scale: 'atk', factor: 1.35 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'confusion', chance: 0.5, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'skb43-2',
    name: "Cat's Eye",
    name_pt: 'Olho de Gato',
    description: 'Hypnotizes the enemy with power from its eyes, charming the target before the claws land.',
    description_pt: 'Hipnotiza o inimigo com o poder dos olhos, encantando o alvo antes das garras acertarem.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-43',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 42, scale: 'int', factor: 1.2 }, element: 'fire' },
      { kind: 'apply_status', target: 'primary_target', status: 'charm', chance: 0.45, turns: 1 }
    ]
  }),
  // ---- Myotismon (skb-85, Ultimate) ----
  d({
    idSuffix: 'skb85-1',
    name: 'Night Raid',
    name_pt: 'Ataque Noturno',
    description: 'Sends a vampire swarm into one foe, tearing flesh and returning stolen vitality.',
    description_pt: 'Envia um enxame vampírico contra um inimigo, rasgando carne e devolvendo vitalidade roubada.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-85',
    actions: [{ kind: 'drain', target: 'primary_target', damage: { base: 68, scale: 'int', factor: 1.65 }, heal_pct: 0.3, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb85-2',
    name: 'Cloud Minion',
    name_pt: 'Lacaio de Névoa',
    description: 'Throws a spiral of dark mist that coils around the target and slows its next move.',
    description_pt: 'Arremessa uma espiral de névoa escura que envolve o alvo e retarda seu próximo movimento.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-85',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'int', factor: 1.35 }, element: 'dark' },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 }
    ]
  }),
  // ---- Devimon (skb-93, Champion) ----
  d({
    idSuffix: 'skb93-1',
    name: 'Death Claw',
    name_pt: 'Garra da Morte',
    description: 'Impales one foe with a demonic claw, drinking the pain back as stolen life.',
    description_pt: 'Empala um inimigo com uma garra demoníaca, bebendo a dor de volta como vida roubada.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    energyCost: 14,
    signature: true,
    owner_template_id: 'skb-93',
    actions: [{ kind: 'drain', target: 'primary_target', damage: { base: 50, scale: 'atk', factor: 1.4 }, heal_pct: 0.2, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb93-2',
    name: 'Deadly Nail',
    name_pt: 'Unha Mortal',
    description: 'Scratches with the nails on both hands, leaving burning cuts across the target.',
    description_pt: 'Arranha com as unhas das duas mãos, deixando cortes ardentes pelo alvo.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-93',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 52, scale: 'atk', factor: 1.4 }, element: 'fire' }]
  }),
  // ---- DemiDevimon (skb-97, Rookie) ----
  d({
    idSuffix: 'skb97-1',
    name: 'Demi Darts',
    name_pt: 'Dardos Demi',
    description: 'Flings small dark syringes over every enemy, drawing back a little vitality from each hit.',
    description_pt: 'Arremessa pequenas seringas sombrias sobre todos os inimigos, puxando um pouco de vitalidade de cada acerto.',
    stage: 'Rookie',
    slot_role: 'sustain_dot',
    energyCost: 10,
    signature: true,
    owner_template_id: 'skb-97',
    actions: [{ kind: 'drain', target: 'enemy_all', damage: { base: 22, scale: 'atk', factor: 0.75 }, heal_pct: 0.12, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb97-2',
    name: 'PicoDevi Claw',
    name_pt: 'Garra PicoDevi',
    description: 'Dives feet-first and scratches with both talons, harassing the chosen victim from above.',
    description_pt: 'Mergulha com os pés à frente e arranha com as duas garras, atormentando a vítima escolhida do alto.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-97',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 32, scale: 'atk', factor: 1.2 }, element: 'fire' }]
  }),
  // ---- WaruSeadramon (skb-133, Ultimate) ----
  d({
    idSuffix: 'skb133-1',
    name: 'Darkstrom',
    name_pt: 'Corrente Sombria',
    description: 'Whips up a black ocean current that crashes into one target with serpentine pressure.',
    description_pt: 'Ergue uma corrente oceânica negra que colide contra um alvo com pressão serpentina.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-133',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 74, scale: 'int', factor: 1.65 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb133-2',
    name: 'Variable Wave',
    name_pt: 'Onda Variável',
    description: 'Wraps an ally in a violet aura that poisons future bites and restores a little energy.',
    description_pt: 'Envolve um aliado em uma aura violeta que envenena ataques futuros e restaura um pouco de energia.',
    stage: 'Ultimate',
    slot_role: 'buff_support',
    energyCost: 18,
    signature: true,
    owner_template_id: 'skb-133',
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'atk_up', amount: 20, turns: 3 },
      { kind: 'restore_en', target: 'caster_ally_lowest_hp', amount: 8 }
    ]
  }),
  // ---- Junomon HM (skb-171, Mega) ----
  d({
    idSuffix: 'skb171-1',
    name: 'Welcome Demise',
    name_pt: 'Boas-vindas ao Fim',
    description: 'Greets one opponent with a murderous dance of rapid dark strikes from the Hysteric Mode armor.',
    description_pt: 'Recebe um oponente com uma dança assassina de golpes sombrios rápidos da armadura Hysteric Mode.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-171',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 94, scale: 'atk', factor: 2.0 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb171-2',
    name: 'Chain Lash',
    name_pt: 'Chicote de Corrente',
    description: 'Snaps a chain across the marked foe, punishing altered posture with a brutal finishing pull.',
    description_pt: 'Estala uma corrente contra o inimigo marcado, punindo a postura alterada com um puxão brutal final.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-171',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 84, scale: 'atk', factor: 1.9 }, element: 'dark' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'atk', delta: -15, turns: 3 }
    ]
  }),
  // ---- Aegiochusmon: Dark (skb-185, Ultimate) ----
  d({
    idSuffix: 'skb185-1',
    name: 'Triangler',
    name_pt: 'Triangler',
    description: 'Cuts a triangular path through one enemy with three dark blade impacts.',
    description_pt: 'Corta um caminho triangular através de um inimigo com três impactos de lâmina sombria.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-185',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 64, scale: 'atk', factor: 1.5 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb185-2',
    name: 'Plasmadness',
    name_pt: 'Plasmadness',
    description: 'Floods the target with unstable dark plasma, corroding its defenses after the hit lands.',
    description_pt: 'Inunda o alvo com plasma sombrio instável, corroendo suas defesas depois do impacto.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-185',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 62, scale: 'atk', factor: 1.45 }, element: 'dark' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -15, turns: 3 }
    ]
  }),
  // ---- Cerberusmon WM (skb-224, Ultimate) ----
  d({
    idSuffix: 'skb224-1',
    name: 'Inferno Divide (Cerberusmon WM)',
    name_pt: 'Divisão Infernal',
    description: 'Races forward in Werewolf Mode and cleaves one opponent with infernal claws.',
    description_pt: 'Avança em Werewolf Mode e fende um oponente com garras infernais.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 22,
    signature: true,
    owner_template_id: 'skb-224',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 74, scale: 'atk', factor: 1.75 }, element: 'dark', ignore_defense: true }]
  }),
  d({
    idSuffix: 'skb224-2',
    name: 'Mad Dog Fire (Cerberusmon WM)',
    name_pt: 'Fogo de Cão Raivoso',
    description: 'Spews feral black flame from close range, scorching the pack of enemies in front of it.',
    description_pt: 'Cospe chama negra feroz de perto, queimando o grupo de inimigos à sua frente.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-224',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 48, scale: 'atk', factor: 1.25 }, element: 'dark' },
      { kind: 'apply_status', target: 'enemy_all', status: 'petrify', chance: 0.2, turns: 1 }
    ]
  }),
  // ---- Tapirmon (skb-231, Rookie) ----
  d({
    idSuffix: 'skb231-1',
    name: 'Nightmare Syndrome (Tapirmon)',
    name_pt: 'Síndrome do Pesadelo',
    description: 'Sends a dream-eating pulse into one foe, bruising the mind and possibly putting it to sleep.',
    description_pt: 'Envia um pulso devorador de sonhos em um inimigo, ferindo a mente e podendo fazê-lo dormir.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-231',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 28, scale: 'int', factor: 1.05 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'sleep', chance: 0.1, turns: 1 }
    ]
  }),
  d({
    idSuffix: 'skb231-2',
    name: 'Virus Delete',
    name_pt: 'Exclusão de Vírus',
    description: 'Purges corruption with a giant syringe, stabbing the target and cleansing an ally in the same motion.',
    description_pt: 'Expurga corrupção com uma seringa gigante, perfurando o alvo e limpando um aliado no mesmo movimento.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 8,
    signature: true,
    owner_template_id: 'skb-231',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 26, scale: 'atk', factor: 1.0 }, element: 'plant' },
      { kind: 'cleanse', target: 'caster_ally_lowest_hp' }
    ]
  }),
  // ---- Astamon (skb-237, Ultimate) ----
  d({
    idSuffix: 'skb237-1',
    name: 'Mad Dog Fire (Astamon)',
    name_pt: 'Fogo de Cão Raivoso',
    description: 'Fires point-blank dark rounds in a savage burst, striking one enemy with unerring gangster precision.',
    description_pt: 'Dispara tiros sombrios à queima-roupa em uma rajada selvagem, acertando um inimigo com precisão de mafioso.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 21,
    signature: true,
    owner_template_id: 'skb-237',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 70, scale: 'atk', factor: 1.65 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb237-2',
    name: 'Maverick Requiem',
    name_pt: 'Réquiem Maverick',
    description: 'Fans the revolver in a cursed requiem, riddling the foe and dropping its attack rhythm.',
    description_pt: 'Gira o revólver em um réquiem amaldiçoado, crivando o inimigo e derrubando seu ritmo de ataque.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-237',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 58, scale: 'atk', factor: 1.35 }, element: 'dark' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'atk', delta: -15, turns: 3 }
    ]
  }),
  // ---- Digitamamon (skb-374, Ultimate) ----
  d({
    idSuffix: 'skb374-1',
    name: 'Nightmare Syndrome (Digitamamon)',
    name_pt: 'Síndrome do Pesadelo',
    description: 'Cracks open a nightmare from inside the shell, battering one foe and dragging it toward sleep.',
    description_pt: 'Racha um pesadelo de dentro da casca, golpeando um inimigo e puxando-o para o sono.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    signature: true,
    owner_template_id: 'skb-374',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 62, scale: 'atk', factor: 1.45 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'sleep', chance: 0.7, turns: 1 }
    ]
  }),
  d({
    idSuffix: 'skb374-2',
    name: 'Swing Egg',
    name_pt: 'Ovo Balançante',
    description: 'Rams the enemy with its shell while multicolored waves burst from the impact.',
    description_pt: 'Investe contra o inimigo com a casca enquanto ondas multicoloridas explodem do impacto.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 19,
    signature: true,
    owner_template_id: 'skb-374',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 66, scale: 'atk', factor: 1.55 }, element: 'light' }]
  }),
  // ---- Ogremon (skb-394, Champion) ----
  d({
    idSuffix: 'skb394-1',
    name: 'Pummel Whack',
    name_pt: 'Pancada Esmagadora',
    description: 'Clubs one enemy with a brutal ogre swing, rattling its aim for the next exchanges.',
    description_pt: 'Golpeia um inimigo com um balanço brutal de ogro, abalando sua mira nos próximos turnos.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-394',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 48, scale: 'atk', factor: 1.35 }, element: 'dark' },
      { kind: 'apply_buff', target: 'primary_target', buff: 'accuracy_down', amount: 20, turns: 3 }
    ]
  }),
  d({
    idSuffix: 'skb394-2',
    name: 'Strong Maul',
    name_pt: 'Maça Forte',
    description: 'Swings its bone club overhead and smashes the target with raw ogre strength.',
    description_pt: 'Balança a clava de osso sobre a cabeça e esmaga o alvo com força bruta de ogro.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 13,
    signature: true,
    owner_template_id: 'skb-394',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 54, scale: 'atk', factor: 1.45 }, element: 'fire' }]
  }),
  // ---- Dracmon (skb-457, Rookie) ----
  d({
    idSuffix: 'skb457-1',
    name: 'Eye of Nightmares',
    name_pt: 'Olho dos Pesadelos',
    description: 'Stares into the victim soul with a red eye, hurting the mind and sipping back a trace of HP.',
    description_pt: 'Encara a alma da vítima com um olho vermelho, ferindo a mente e bebendo de volta um traço de HP.',
    stage: 'Rookie',
    slot_role: 'sustain_dot',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-457',
    actions: [{ kind: 'drain', target: 'primary_target', damage: { base: 30, scale: 'int', factor: 1.1 }, heal_pct: 0.1, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb457-2',
    name: 'Bat Moon Ruse',
    name_pt: 'Ardil da Lua Morcego',
    description: 'Scatters into bats under a crooked moon, nicking every enemy and blinding their counterattack.',
    description_pt: 'Dispersa-se em morcegos sob uma lua torta, ferindo todos os inimigos e cegando o contra-ataque deles.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-457',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 20, scale: 'atk', factor: 0.75 }, element: 'dark' },
      { kind: 'apply_status', target: 'enemy_all', status: 'blind', chance: 0.25, turns: 2 }
    ]
  }),
  // ---- Pagumon (skb-567, In-Training) ----
  d({
    idSuffix: 'skb567-1',
    name: 'Poison Bubbles',
    name_pt: 'Bolhas Venenosas',
    description: 'Spits purple bubbles that pop on one foe and leave poison clinging to the skin.',
    description_pt: 'Cospe bolhas roxas que estouram em um inimigo e deixam veneno grudado na pele.',
    stage: 'In-Training',
    slot_role: 'sustain_dot',
    energyCost: 6,
    signature: true,
    owner_template_id: 'skb-567',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 16, scale: 'int', factor: 0.75 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'poison', chance: 0.3, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'skb567-2',
    name: 'San no Awa (Pagumon)',
    name_pt: 'Bolhas Ácidas',
    description: 'Shoots slightly acidic bubbles from its mouth, stinging the target and softening its guard.',
    description_pt: 'Dispara bolhas levemente ácidas pela boca, ardendo no alvo e amolecendo sua guarda.',
    stage: 'In-Training',
    slot_role: 'control',
    energyCost: 5,
    signature: true,
    owner_template_id: 'skb-567',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 14, scale: 'int', factor: 0.7 }, element: 'null' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'def', delta: -8, turns: 2 }
    ]
  }),
  // ---- Keramon (skb-626, Rookie) ----
  d({
    idSuffix: 'skb626-1',
    name: 'Crazy Giggle',
    name_pt: 'Risada Louca',
    description: 'Cackles in a glitching rhythm that lashes one foe with dark sound pressure.',
    description_pt: 'Gargalha em um ritmo falhado que açoita um inimigo com pressão sonora sombria.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-626',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 30, scale: 'int', factor: 1.1 }, element: 'dark' },
      { kind: 'apply_status', target: 'primary_target', status: 'confusion', chance: 0.3, turns: 2 }
    ]
  }),
  d({
    idSuffix: 'skb626-2',
    name: 'Dark Crusher',
    name_pt: 'Triturador Sombrio',
    description: 'Smashes an enemy with both oversized hands, crushing code into black fragments.',
    description_pt: 'Esmaga um inimigo com as duas mãos enormes, triturando código em fragmentos negros.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 9,
    signature: true,
    owner_template_id: 'skb-626',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'atk', factor: 1.25 }, element: 'dark' }]
  }),
  // ---- Kuramon (skb-629, Baby) ----
  d({
    idSuffix: 'skb629-1',
    name: 'Glare Eye',
    name_pt: 'Olhar Fulminante',
    description: 'Fixes its single eye on the target, burning a dark signal directly into the mind.',
    description_pt: 'Fixa seu único olho no alvo, queimando um sinal sombrio diretamente na mente.',
    stage: 'Baby',
    slot_role: 'primary_attack',
    energyCost: 5,
    signature: true,
    owner_template_id: 'skb-629',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 16, scale: 'int', factor: 0.75 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb629-2',
    name: 'Blood Eye',
    name_pt: 'Olho de Sangue',
    description: 'Flashes a blood-red stare that scrambles the enemy thoughts before a weak bite lands.',
    description_pt: 'Emite um olhar vermelho-sangue que embaralha os pensamentos inimigos antes de uma mordida fraca acertar.',
    stage: 'Baby',
    slot_role: 'control',
    energyCost: 5,
    signature: true,
    owner_template_id: 'skb-629',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 12, scale: 'int', factor: 0.6 }, element: 'null' },
      { kind: 'apply_status', target: 'primary_target', status: 'confusion', chance: 0.35, turns: 1 }
    ]
  }),
  // ---- Tsumemon (skb-631, In-Training) ----
  d({
    idSuffix: 'skb631-1',
    name: 'Nail Scratch',
    name_pt: 'Arranhão de Unha',
    description: 'Scrapes one enemy with tiny black claws, leaving a sharp infected cut.',
    description_pt: 'Raspa um inimigo com pequenas garras negras, deixando um corte agudo infectado.',
    stage: 'In-Training',
    slot_role: 'primary_attack',
    energyCost: 6,
    signature: true,
    owner_template_id: 'skb-631',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 20, scale: 'atk', factor: 0.85 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb631-2',
    name: 'Clinging Malware',
    name_pt: 'Malware Grudento',
    description: 'Clamps onto the foe like a living bug, leeching strength and slowing every attempt to shake it off.',
    description_pt: 'Agarra-se ao inimigo como um bug vivo, sugando força e retardando cada tentativa de se soltar.',
    stage: 'In-Training',
    slot_role: 'sustain_dot',
    energyCost: 6,
    signature: true,
    owner_template_id: 'skb-631',
    actions: [
      { kind: 'drain', target: 'primary_target', damage: { base: 16, scale: 'atk', factor: 0.75 }, heal_pct: 0.16, element: 'dark' },
      { kind: 'modify_stat', target: 'primary_target', stat: 'spd', delta: -8, turns: 2 }
    ]
  }),
  // ---- LordKnightmon (skb-703, Mega) ----
  d({
    idSuffix: 'skb703-1',
    name: 'Spiral Masquerade',
    name_pt: 'Mascarada Espiral',
    description: 'Pirouettes through one target with seven rose-thin thrusts, turning the duel into a cruel masquerade.',
    description_pt: 'Pirouetta através de um alvo com sete estocadas finas como rosas, transformando o duelo em uma mascarada cruel.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 31,
    signature: true,
    owner_template_id: 'skb-703',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 94, scale: 'spd', factor: 2.0 }, element: 'dark' }]
  }),
  d({
    idSuffix: 'skb703-2',
    name: 'Fist of Athena',
    name_pt: 'Punho de Atena',
    description: 'Drives a knightly burning fist into the enemy, piercing through poor compatibility with royal force.',
    description_pt: 'Crava um punho cavaleiresco flamejante no inimigo, atravessando má compatibilidade com força real.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 29,
    signature: true,
    owner_template_id: 'skb-703',
    actions: [{ kind: 'deal_damage', target: 'primary_target', amount: { base: 88, scale: 'atk', factor: 1.9 }, element: 'fire', ignore_defense: true }]
  })
];
