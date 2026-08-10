import { makeSkillFactory, type SkillSeed } from './types.js';

const l = makeSkillFactory('light', 'light');

export const LIGHT_SKILLS: SkillSeed[] = [
  // ---- Healer (Direct restoration, triage, emergency saves) ----
  l({
    idSuffix: 'heal-r-1',
    name: 'Mending Light',
    name_pt: 'Luz Reparadora',
    description: 'A gentle cascade of light knits the wounds of the most injured ally, offering a steady flow of direct triage.',
    description_pt: 'Uma suave cascata de luz fecha as feridas do aliado mais machucado, oferecendo um fluxo constante de reparos diretos.',
    stage: 'Rookie',
    slot_role: 'sustain_dot',
    energyCost: 6,
    actions: [
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 40, scale: 'int', factor: 0.8 } }
    ]
  }),
  l({
    idSuffix: 'heal-r-2',
    name: 'Soft Glow',
    name_pt: 'Brilho Suave',
    description: 'A comforting aura washes over the entire party, providing a modest but widespread restorative effect.',
    description_pt: 'Uma aura reconfortante banha toda a equipe, proporcionando um efeito restaurador modesto, mas abrangente.',
    stage: 'Rookie',
    slot_role: 'buff_support',
    energyCost: 8,
    actions: [
      { kind: 'heal', target: 'caster_ally_all', amount: { base: 20, scale: 'int', factor: 0.3 } }
    ]
  }),
  l({
    idSuffix: 'heal-r-3',
    name: 'Rescue Beacon',
    name_pt: 'Farol de Resgate',
    description: 'When an ally falls near the brink of defeat, this reactive flare of light triggers an emergency burst of healing.',
    description_pt: 'Quando um aliado fica à beira da derrota, este reflexo de luz dispara uma explosão emergencial de cura.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 7,
    actions: [
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 40 },
        then: [
          { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 60, scale: 'int', factor: 1.0 } }
        ]
      }
    ]
  }),

  // ---- Buffer (Shields, damage reduction, force multiplication) ----
  l({
    idSuffix: 'buff-r-1',
    name: 'Radiant Wall',
    name_pt: 'Parede Radiante',
    description: 'Manifests a shimmering barrier of solid light around the most vulnerable ally, absorbing incoming strikes.',
    description_pt: 'Manifesta uma barreira cintilante de luz sólida ao redor do aliado mais vulnerável, absorvendo golpes inimigos.',
    stage: 'Rookie',
    slot_role: 'buff_support',
    energyCost: 8,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'shield_absorb', amount: 40, turns: 2 }
    ]
  }),
  l({
    idSuffix: 'buff-r-2',
    name: 'Luminous Strike',
    name_pt: 'Golpe Luminoso',
    description: 'Channels empowering holy energy through an offensive bash, inspiring the party to hit harder.',
    description_pt: 'Canaliza energia sagrada fortalecedora através de um impacto ofensivo, inspirando a equipe a bater mais forte.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 20, scale: 'int', factor: 1.0 }, element: 'light' },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'atk_up', amount: 10, turns: 2 }
    ]
  }),
  l({
    idSuffix: 'buff-r-3',
    name: 'Dazzling Flash',
    name_pt: 'Clarão Ofuscante',
    description: 'A sudden burst of blinding intensity disrupts the vision of the opposing forces, lowering their accuracy.',
    description_pt: 'Uma súbita explosão de intensidade ofuscante perturba a visão das forças oponentes, diminuindo sua precisão.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 9,
    actions: [
      { kind: 'apply_buff', target: 'enemy_all', buff: 'accuracy_down', amount: 15, turns: 2 }
    ]
  }),

  // ---- Purifier (Cleansing, dispel, holy damage against afflicted) ----
  l({
    idSuffix: 'purify-r-1',
    name: 'Cleansing Beam',
    name_pt: 'Feixe Purificador',
    description: 'Fires a concentrated laser of absolute purity that not only burns the target but aggressively strips away their magical boons.',
    description_pt: 'Dispara um laser concentrado de pureza absoluta que não apenas queima o alvo, mas agressivamente remove suas bênçãos mágicas.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 9,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 25, scale: 'int', factor: 1.2 }, element: 'light' },
      { kind: 'dispel', target: 'primary_target' }
    ]
  }),
  l({
    idSuffix: 'purify-r-2',
    name: 'Holy Wash',
    name_pt: 'Banho Sagrado',
    description: 'Showers a weakened ally in consecrated waters, lifting lingering curses, poisons, and detrimental effects.',
    description_pt: 'Banha um aliado enfraquecido em águas consagradas, levantando maldições, venenos e efeitos prejudiciais persistentes.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 8,
    actions: [
      { kind: 'cleanse', target: 'caster_ally_lowest_hp' }
    ]
  }),
  l({
    idSuffix: 'purify-r-3',
    name: 'Sun Smite',
    name_pt: 'Golpe do Sol',
    description: 'Calls down a miniature sun to ruthlessly smite a single foe, delivering the heavy verdict of light.',
    description_pt: 'Evoca um sol em miniatura para golpear impiedosamente um único inimigo, entregando o pesado veredito da luz.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 10,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 35, scale: 'int', factor: 1.4 }, element: 'light' }
    ]
  }),

  // ==== CHAMPION ====

  // ---- Healer ----
  l({
    idSuffix: 'heal-c-1',
    name: 'Restoring Light',
    name_pt: 'Luz Restauradora',
    description: 'An advanced cascade of holy energy that mends deep gashes and leaves a thin, lingering protective shield.',
    description_pt: 'Uma cascata avançada de energia sagrada que cura cortes profundos e deixa um fino escudo protetor persistente.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    energyCost: 12,
    upgrade_of: 'sk-light-heal-r-1',
    actions: [
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 70, scale: 'int', factor: 1.2 } },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'shield_absorb', amount: 50, turns: 2 }
    ]
  }),
  l({
    idSuffix: 'heal-c-2',
    name: 'Warm Radiance',
    name_pt: 'Radiância Quente',
    description: 'Breathes life into the entire squad, restoring health while also passively stiffening their physical defense.',
    description_pt: 'Sopra vida em todo o esquadrão, restaurando saúde enquanto também enrijece passivamente sua defesa física.',
    stage: 'Champion',
    slot_role: 'buff_support',
    energyCost: 14,
    upgrade_of: 'sk-light-heal-r-2',
    actions: [
      { kind: 'heal', target: 'caster_ally_all', amount: { base: 40, scale: 'int', factor: 0.5 } },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'def_up', amount: 15, turns: 2 }
    ]
  }),
  l({
    idSuffix: 'heal-c-3',
    name: 'Savior\'s Beacon',
    name_pt: 'Farol do Salvador',
    description: 'Only activating when a comrade is severely wounded, this beacon floods them with a massive influx of saving grace.',
    description_pt: 'Ativando-se apenas quando um camarada está gravemente ferido, este farol o inunda com um influxo massivo de graça salvadora.',
    stage: 'Champion',
    slot_role: 'utility',
    energyCost: 13,
    upgrade_of: 'sk-light-heal-r-3',
    actions: [
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 50 },
        then: [
          { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 100, scale: 'int', factor: 1.5 } }
        ]
      }
    ]
  }),

  // ---- Buffer ----
  l({
    idSuffix: 'buff-c-1',
    name: 'Shining Barrier',
    name_pt: 'Barreira Brilhante',
    description: 'Projects a wide, hard-light dome over the entire team, absorbing a moderate amount of incoming devastation.',
    description_pt: 'Projeta um amplo domo de luz sólida sobre toda a equipe, absorvendo uma quantidade moderada de devastação iminente.',
    stage: 'Champion',
    slot_role: 'buff_support',
    energyCost: 14,
    upgrade_of: 'sk-light-buff-r-1',
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'shield_absorb', amount: 60, turns: 3 }
    ]
  }),
  l({
    idSuffix: 'buff-c-2',
    name: 'Brilliant Strike',
    name_pt: 'Golpe Brilhante',
    description: 'Bashes the enemy frontline with luminescent force, sending a ripple of tactical insight and power to allies.',
    description_pt: 'Esmaga a linha de frente inimiga com força luminescente, enviando uma onda de percepção tática e poder aos aliados.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    upgrade_of: 'sk-light-buff-r-2',
    actions: [
      { kind: 'deal_damage', target: 'enemy_front', amount: { base: 30, scale: 'int', factor: 1.2 }, element: 'light' },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'int_up', amount: 15, turns: 2 }
    ]
  }),
  l({
    idSuffix: 'buff-c-3',
    name: 'Blinding Flash',
    name_pt: 'Clarão Cegante',
    description: 'Floods the battlefield with an unbearable glare, heavily blinding foes to force missed attacks and wasted turns.',
    description_pt: 'Inunda o campo de batalha com um brilho insuportável, cegando severamente os inimigos para forçar ataques perdidos e turnos desperdiçados.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 15,
    upgrade_of: 'sk-light-buff-r-3',
    actions: [
      { kind: 'apply_status', target: 'enemy_all', status: 'blind', chance: 0.6, turns: 2 }
    ]
  }),

  // ---- Purifier ----
  l({
    idSuffix: 'purify-c-1',
    name: 'Expelling Beam',
    name_pt: 'Feixe Expulsor',
    description: 'Sweeps the arena with an incinerating holy light that hurts all enemies while aggressively ripping buffs off the frontline.',
    description_pt: 'Varre a arena com uma luz sagrada incineradora que fere todos os inimigos enquanto arranca agressivamente os buffs da linha de frente.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 15,
    upgrade_of: 'sk-light-purify-r-1',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 30, scale: 'int', factor: 1.2 }, element: 'light' },
      { kind: 'dispel', target: 'enemy_front' }
    ]
  }),
  l({
    idSuffix: 'purify-c-2',
    name: 'Sacred Wash',
    name_pt: 'Banho Divino',
    description: 'Summons a rain of blessed water that scrubs ailments from every ally, keeping the party operating at peak clarity.',
    description_pt: 'Invoca uma chuva de água abençoada que esfrega as aflições de cada aliado, mantendo a equipe operando com clareza máxima.',
    stage: 'Champion',
    slot_role: 'utility',
    energyCost: 13,
    upgrade_of: 'sk-light-purify-r-2',
    actions: [
      { kind: 'cleanse', target: 'caster_ally_all' }
    ]
  }),
  l({
    idSuffix: 'purify-c-3',
    name: 'Solar Smite',
    name_pt: 'Golpe Solar',
    description: 'Crushes a single threat with the scorching weight of the sun. If the enemy is blinded, it shatters their resolve with crippling weakness.',
    description_pt: 'Esmaga uma única ameaça com o peso escaldante do sol. Se o inimigo estiver cego, estilhaça sua determinação com fraqueza incapacitante.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    energyCost: 16,
    upgrade_of: 'sk-light-purify-r-3',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 55, scale: 'int', factor: 1.6 }, element: 'light' },
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'blind' },
        then: [
          { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.5, turns: 2 }
        ]
      }
    ]
  }),

  // ==== ULTIMATE ====

  // ---- Healer ----
  l({
    idSuffix: 'heal-u-1',
    name: 'Renewing Light',
    name_pt: 'Luz Renovadora',
    description: 'An overwhelming stream of light plunges into a dying ally, mending catastrophic damage and entirely purifying their condition.',
    description_pt: 'Um fluxo avassalador de luz mergulha em um aliado moribundo, consertando danos catastróficos e purificando inteiramente sua condição.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    energyCost: 18,
    upgrade_of: 'sk-light-heal-c-1',
    actions: [
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 140, scale: 'int', factor: 1.8 } },
      { kind: 'cleanse', target: 'caster_ally_lowest_hp' }
    ]
  }),
  l({
    idSuffix: 'heal-u-2',
    name: 'Heavenly Radiance',
    name_pt: 'Radiância Celestial',
    description: 'The sky breaks open, bathing the team in warmth that recovers lost vitality and hardens their skin against incoming blows.',
    description_pt: 'O céu se abre, banhando a equipe em um calor que recupera a vitalidade perdida e endurece sua pele contra golpes iminentes.',
    stage: 'Ultimate',
    slot_role: 'buff_support',
    energyCost: 20,
    upgrade_of: 'sk-light-heal-c-2',
    actions: [
      { kind: 'heal', target: 'caster_ally_all', amount: { base: 70, scale: 'int', factor: 0.8 } },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'damage_reduction', amount: 20, turns: 2 }
    ]
  }),
  l({
    idSuffix: 'heal-u-3',
    name: 'Guardian\'s Beacon',
    name_pt: 'Farol do Guardião',
    description: 'A miraculous fail-safe that intervenes when an ally drops low, pulling them from the edge with a massive heal and a brief window of true invulnerability.',
    description_pt: 'Um mecanismo de segurança milagroso que intervém quando um aliado fica fraco, puxando-o do abismo com uma cura massiva e uma breve janela de verdadeira invulnerabilidade.',
    stage: 'Ultimate',
    slot_role: 'utility',
    energyCost: 18,
    upgrade_of: 'sk-light-heal-c-3',
    actions: [
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 50 },
        then: [
          { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 180, scale: 'int', factor: 2.2 } },
          { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'invulnerable', amount: 1, turns: 1 }
        ]
      }
    ]
  }),

  // ---- Buffer ----
  l({
    idSuffix: 'buff-u-1',
    name: 'Aegis of Light',
    name_pt: 'Égide de Luz',
    description: 'Forges a grand, thick layer of hard-light armor over the squad, providing a huge absorb pool and an overall defense boost.',
    description_pt: 'Forja uma grande e espessa camada de armadura de luz sólida sobre o esquadrão, fornecendo uma enorme reserva de absorção e um aumento geral de defesa.',
    stage: 'Ultimate',
    slot_role: 'buff_support',
    energyCost: 22,
    upgrade_of: 'sk-light-buff-c-1',
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'shield_absorb', amount: 120, turns: 3 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'def_up', amount: 25, turns: 3 }
    ]
  }),
  l({
    idSuffix: 'buff-u-2',
    name: 'Glorious Strike',
    name_pt: 'Golpe Glorioso',
    description: 'Crashes down upon all adversaries with blinding might, drastically elevating the physical and magical stopping power of allies.',
    description_pt: 'Desaba sobre todos os adversários com um poder ofuscante, elevando drasticamente o poder de parada físico e mágico dos aliados.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 22,
    upgrade_of: 'sk-light-buff-c-2',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 40, scale: 'int', factor: 1.5 }, element: 'light' },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'atk_up', amount: 25, turns: 3 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'int_up', amount: 25, turns: 3 }
    ]
  }),
  l({
    idSuffix: 'buff-u-3',
    name: 'Searing Flash',
    name_pt: 'Clarão Cauterizante',
    description: 'Flashes a paralyzing incandescence that drastically cuts enemy accuracy and scrambles their senses via confusion.',
    description_pt: 'Emite uma incandescência paralisante que corta drasticamente a precisão inimiga e embaralha seus sentidos através da confusão.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    upgrade_of: 'sk-light-buff-c-3',
    actions: [
      { kind: 'apply_buff', target: 'enemy_all', buff: 'accuracy_down', amount: 25, turns: 3 },
      { kind: 'apply_status', target: 'enemy_all', status: 'confusion', chance: 0.5, turns: 2 }
    ]
  }),

  // ---- Purifier ----
  l({
    idSuffix: 'purify-u-1',
    name: 'Banishing Beam',
    name_pt: 'Feixe Banidor',
    description: 'Erases the opposing side’s advantages, dealing heavy holy damage across the board and forcefully dispelling all enemy buffs.',
    description_pt: 'Apaga as vantagens do lado oposto, causando dano sagrado pesado em toda a linha e dissipando à força todos os buffs inimigos.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 24,
    upgrade_of: 'sk-light-purify-c-1',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 50, scale: 'int', factor: 1.8 }, element: 'light' },
      { kind: 'dispel', target: 'enemy_all' }
    ]
  }),
  l({
    idSuffix: 'purify-u-2',
    name: 'Divine Wash',
    name_pt: 'Banho Celestial',
    description: 'A relentless wave of consecrated energy scours away all party ailments and leaves a refreshing pool of healed vitality in its wake.',
    description_pt: 'Uma onda implacável de energia consagrada lava todas as aflições da equipe e deixa um rastro refrescante de vitalidade curada.',
    stage: 'Ultimate',
    slot_role: 'utility',
    energyCost: 20,
    upgrade_of: 'sk-light-purify-c-2',
    actions: [
      { kind: 'cleanse', target: 'caster_ally_all' },
      { kind: 'heal', target: 'caster_ally_all', amount: { base: 50, scale: 'int', factor: 0.5 } }
    ]
  }),
  l({
    idSuffix: 'purify-u-3',
    name: 'Astral Smite',
    name_pt: 'Golpe Astral',
    description: 'Calls upon the cosmos to obliterate a primary target. Against blinded foes, the impact echoes for a second strike and shatters their physical strength.',
    description_pt: 'Invoca o cosmos para obliterar um alvo principal. Contra inimigos cegos, o impacto ecoa para um segundo golpe e estilhaça sua força física.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 24,
    upgrade_of: 'sk-light-purify-c-3',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 85, scale: 'int', factor: 2.2 }, element: 'light' },
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'blind' },
        then: [
          { kind: 'deal_damage', target: 'primary_target', amount: { base: 40, scale: 'int', factor: 1.0 }, element: 'light' },
          { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.8, turns: 2 }
        ]
      }
    ]
  }),

  // ==== MEGA ====

  // ---- Healer ----
  l({
    idSuffix: 'heal-m-1',
    name: 'Eternal Light',
    name_pt: 'Luz Eterna',
    description: 'The pinnacle of triage. This immense restorative wave completely mends a near-death ally, cleanses their soul, and shields them with true invulnerability.',
    description_pt: 'O ápice da triagem. Esta imensa onda restauradora conserta completamente um aliado quase morto, purifica sua alma e o protege com verdadeira invulnerabilidade.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    energyCost: 28,
    upgrade_of: 'sk-light-heal-u-1',
    actions: [
      { kind: 'heal', target: 'caster_ally_lowest_hp', amount: { base: 250, scale: 'int', factor: 3.0 } },
      { kind: 'cleanse', target: 'caster_ally_lowest_hp' },
      { kind: 'apply_buff', target: 'caster_ally_lowest_hp', buff: 'invulnerable', amount: 1, turns: 1 }
    ]
  }),
  l({
    idSuffix: 'heal-m-2',
    name: 'Sovereign Radiance',
    name_pt: 'Radiância Soberana',
    description: 'An omnipresent glow blankets the entire battlefield, mending deep wounds across the party and raising a persistent, formidable damage reduction.',
    description_pt: 'Um brilho onipresente cobre todo o campo de batalha, curando feridas profundas em toda a equipe e erguendo uma persistente e formidável redução de dano.',
    stage: 'Mega',
    slot_role: 'buff_support',
    energyCost: 30,
    upgrade_of: 'sk-light-heal-u-2',
    actions: [
      { kind: 'heal', target: 'caster_ally_all', amount: { base: 120, scale: 'int', factor: 1.2 } },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'damage_reduction', amount: 30, turns: 3 }
    ]
  }),
  l({
    idSuffix: 'heal-m-3',
    name: 'Seraph\'s Beacon',
    name_pt: 'Farol do Serafim',
    description: 'When the party is pushed to half strength, this ultimate defensive flare triggers, flooding every ally with massive healing and extreme damage reduction.',
    description_pt: 'Quando a equipe é empurrada para meia força, este sinalizador defensivo final é ativado, inundando cada aliado com cura massiva e extrema redução de dano.',
    stage: 'Mega',
    slot_role: 'utility',
    energyCost: 32,
    tier_2: true,
    upgrade_of: 'sk-light-heal-u-3',
    actions: [
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 50 },
        then: [
          { kind: 'heal', target: 'caster_ally_all', amount: { base: 200, scale: 'int', factor: 2.5 } },
          { kind: 'apply_buff', target: 'caster_ally_all', buff: 'damage_reduction', amount: 40, turns: 2 }
        ]
      }
    ]
  }),

  // ---- Buffer ----
  l({
    idSuffix: 'buff-m-1',
    name: 'Bastion of Light',
    name_pt: 'Bastião de Luz',
    description: 'Erects an unbreakable fortress of holy energy, layering a colossal shield over the party and mitigating incoming physical trauma.',
    description_pt: 'Ergue uma fortaleza inquebrável de energia sagrada, colocando um escudo colossal sobre a equipe e mitigando trauma físico iminente.',
    stage: 'Mega',
    slot_role: 'buff_support',
    energyCost: 34,
    tier_2: true,
    upgrade_of: 'sk-light-buff-u-1',
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'shield_absorb', amount: 250, turns: 4 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'damage_reduction', amount: 30, turns: 4 }
    ]
  }),
  l({
    idSuffix: 'buff-m-2',
    name: 'Transcendent Strike',
    name_pt: 'Golpe Transcendente',
    description: 'A dazzling shockwave ravages the enemy lines, instantly supercharging the physical, magical, and speed capabilities of every ally to their zenith.',
    description_pt: 'Uma onda de choque ofuscante devasta as linhas inimigas, sobrecarregando instantaneamente as capacidades físicas, mágicas e de velocidade de cada aliado ao zênite.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 32,
    upgrade_of: 'sk-light-buff-u-2',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 60, scale: 'int', factor: 2.0 }, element: 'light' },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'atk_up', amount: 40, turns: 3 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'int_up', amount: 40, turns: 3 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'spd_up', amount: 40, turns: 3 }
    ]
  }),
  l({
    idSuffix: 'buff-m-3',
    name: 'Supernova Flash',
    name_pt: 'Clarão de Supernova',
    description: 'Ignites the sky, scorching the enemies’ optical sensors. This flash severely blinds foes, shatters their defense, and plummets their accuracy.',
    description_pt: 'Incedeia o céu, queimando os sensores ópticos dos inimigos. Este clarão cega severamente os oponentes, despedaça sua defesa e despenca sua precisão.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 28,
    upgrade_of: 'sk-light-buff-u-3',
    actions: [
      { kind: 'apply_status', target: 'enemy_all', status: 'blind', chance: 0.8, turns: 3 },
      { kind: 'apply_buff', target: 'enemy_all', buff: 'accuracy_down', amount: 40, turns: 3 },
      { kind: 'apply_buff', target: 'enemy_all', buff: 'def_down', amount: 30, turns: 3 }
    ]
  }),

  // ---- Purifier ----
  l({
    idSuffix: 'purify-m-1',
    name: 'Eradicating Beam',
    name_pt: 'Feixe Erradicador',
    description: 'A divine execution from above that obliterates the opposition, thoroughly stripping away all buffs and choking off their physical strength completely.',
    description_pt: 'Uma execução divina vinda de cima que oblitera a oposição, arrancando completamente todos os buffs e sufocando sua força física inteiramente.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 36,
    upgrade_of: 'sk-light-purify-u-1',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 70, scale: 'int', factor: 2.5 }, element: 'light' },
      { kind: 'dispel', target: 'enemy_all' },
      { kind: 'apply_status', target: 'enemy_all', status: 'weaken', chance: 0.6, turns: 2 }
    ]
  }),
  l({
    idSuffix: 'purify-m-2',
    name: 'Ultimate Wash',
    name_pt: 'Banho Definitivo',
    description: 'An absolute torrent of holy liquid cleanses every speck of corruption from the squad, restoring immense health and blurring their outlines for sharp evasion.',
    description_pt: 'Uma torrente absoluta de líquido sagrado limpa cada grão de corrupção do esquadrão, restaurando saúde imensa e desfocando seus contornos para uma evasão afiada.',
    stage: 'Mega',
    slot_role: 'utility',
    energyCost: 30,
    upgrade_of: 'sk-light-purify-u-2',
    actions: [
      { kind: 'cleanse', target: 'caster_ally_all' },
      { kind: 'heal', target: 'caster_ally_all', amount: { base: 100, scale: 'int', factor: 1.0 } },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'evasion_up', amount: 25, turns: 2 }
    ]
  }),
  l({
    idSuffix: 'purify-m-3',
    name: 'Genesis Smite',
    name_pt: 'Golpe da Gênese',
    description: 'Drops the unmitigated fury of creation onto a single adversary. This lethal smite dispels their protections and fuels the caster for an immediate follow-up attack.',
    description_pt: 'Despeja a fúria não mitigada da criação sobre um único adversário. Este golpe letal dissipa suas proteções e alimenta o conjurador para um ataque de acompanhamento imediato.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 40,
    tier_2: true,
    cooldown: 2,
    upgrade_of: 'sk-light-purify-u-3',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 150, scale: 'int', factor: 4.0 }, element: 'light' },
      { kind: 'dispel', target: 'primary_target' }
    ]
  })
];
