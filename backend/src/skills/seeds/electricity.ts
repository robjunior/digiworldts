import { makeSkillFactory, type SkillSeed } from './types.js';

const e = makeSkillFactory('electricity', 'elec');

export const ELECTRICITY_SKILLS: SkillSeed[] = [
  // ===========================================================================
  // ROOKIE
  // ===========================================================================

  // Archetype: Combo
  e({
    idSuffix: 'combo-r-1',
    name: 'Flash Strike',
    name_pt: 'Golpe Relâmpago',
    description: 'A blindingly fast strike that pushes the user slightly forward in the timeline.',
    description_pt: 'Um golpe ofuscantemente rápido que impulsiona o usuário um pouco para frente na linha do tempo.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 9,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 15, scale: 'spd', factor: 1.0 }, element: 'electricity' },
      { kind: 'shift_initiative', target: 'self', delta: -1 },
    ],
  }),
  e({
    idSuffix: 'combo-r-2',
    name: 'Spark Step',
    name_pt: 'Passo de Faísca',
    description: 'A crackle of energy that boosts the user\'s speed and pushes them forward in the turn order.',
    description_pt: 'Um estalar de energia que aumenta a velocidade do usuário e o impulsiona na ordem dos turnos.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 8,
    actions: [
      { kind: 'shift_initiative', target: 'self', delta: -2 },
      { kind: 'apply_buff', target: 'self', buff: 'spd_up', amount: 10, turns: 2 },
    ],
  }),
  e({
    idSuffix: 'combo-r-3',
    name: 'Volt Charge',
    name_pt: 'Carga de Volts',
    description: 'Surges the team with electricity, increasing everyone\'s speed.',
    description_pt: 'Preenche a equipe com eletricidade, aumentando a velocidade de todos.',
    stage: 'Rookie',
    slot_role: 'buff_support',
    energyCost: 8,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'spd_up', amount: 15, turns: 3 },
    ],
  }),

  // Archetype: Chain
  e({
    idSuffix: 'chain-r-1',
    name: 'Arcing Zap',
    name_pt: 'Zap em Arco',
    description: 'A jolt of electricity that hits the front line, with a small chance to stun.',
    description_pt: 'Um choque de eletricidade que atinge a linha de frente, com uma pequena chance de atordoar.',
    stage: 'Rookie',
    slot_role: 'primary_attack',
    energyCost: 8,
    actions: [
      { kind: 'deal_damage', target: 'enemy_front', amount: { base: 11, scale: 'int', factor: 0.81 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_front', status: 'stun', chance: 0.15, turns: 1 },
    ],
  }),
  e({
    idSuffix: 'chain-r-2',
    name: 'Chain Volt',
    name_pt: 'Volt em Cadeia',
    description: 'Shoots random bolts of electricity across the battlefield.',
    description_pt: 'Dispara raios aleatórios de eletricidade pelo campo de batalha.',
    stage: 'Rookie',
    slot_role: 'identity_finisher',
    energyCost: 10,
    actions: [
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 15, scale: 'int', factor: 0.81 }, element: 'electricity' },
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 15, scale: 'int', factor: 0.81 }, element: 'electricity' },
    ],
  }),
  e({
    idSuffix: 'chain-r-3',
    name: 'Static Cling',
    name_pt: 'Aderência Estática',
    description: 'A lingering static field hits all enemies and may leave them weakened.',
    description_pt: 'Um campo estático persistente atinge todos os inimigos e pode deixá-los enfraquecidos.',
    stage: 'Rookie',
    slot_role: 'sustain_dot',
    energyCost: 7,
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 8, scale: 'int', factor: 0.52 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_all', status: 'weaken', chance: 0.4, turns: 2 },
    ],
  }),

  // Archetype: Stun
  e({
    idSuffix: 'stun-r-1',
    name: 'Taser Grip',
    name_pt: 'Agarre de Taser',
    description: 'Shocks a single target, delaying their next turn and potentially stunning them.',
    description_pt: 'Dá um choque em um único alvo, atrasando seu próximo turno e potencialmente o atordoando.',
    stage: 'Rookie',
    slot_role: 'control',
    energyCost: 8,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 9, scale: 'int', factor: 0.52 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.4, turns: 1 },
      { kind: 'shift_initiative', target: 'primary_target', delta: 1 },
    ],
  }),
  e({
    idSuffix: 'stun-r-2',
    name: 'Static Guard',
    name_pt: 'Guarda Estática',
    description: 'Erects a defensive static field that raises the party\'s defense.',
    description_pt: 'Ergue um campo estático defensivo que aumenta a defesa da equipe.',
    stage: 'Rookie',
    slot_role: 'buff_support',
    energyCost: 7,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'def_up', amount: 15, turns: 3 },
    ],
  }),
  e({
    idSuffix: 'stun-r-3',
    name: 'Stun Gun',
    name_pt: 'Arma de Choque',
    description: 'Fires a focused electric pulse with a good chance to stun the target.',
    description_pt: 'Dispara um pulso elétrico focado com uma boa chance de atordoar o alvo.',
    stage: 'Rookie',
    slot_role: 'utility',
    energyCost: 8,
    actions: [
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.5, turns: 1 },
    ],
  }),

  // ===========================================================================
  // CHAMPION
  // ===========================================================================

  // Archetype: Combo
  e({
    idSuffix: 'combo-c-1',
    name: 'Lightning Dash',
    name_pt: 'Investida Relâmpago',
    description: 'A swift dashing strike that advances the user\'s turn. Hits twice if the target is already stunned.',
    description_pt: 'Uma investida rápida que avança o turno do usuário. Atinge duas vezes se o alvo já estiver atordoado.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 14,
    upgrade_of: 'sk-elec-combo-r-1',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 33, scale: 'spd', factor: 1.41 }, element: 'electricity' },
      { kind: 'shift_initiative', target: 'self', delta: -1 },
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'stun' },
        then: [
          { kind: 'deal_damage', target: 'primary_target', amount: { base: 19, scale: 'spd', factor: 0.93 }, element: 'electricity' }
        ]
      }
    ],
  }),
  e({
    idSuffix: 'combo-c-2',
    name: 'Volt Switch',
    name_pt: 'Troca de Voltagem',
    description: 'A rapid maneuver that significantly advances the user\'s turn and boosts their evasion.',
    description_pt: 'Uma manobra rápida que avança significativamente o turno do usuário e aumenta sua evasão.',
    stage: 'Champion',
    slot_role: 'utility',
    upgrade_of: 'sk-elec-combo-r-2',
    energyCost: 12,
    actions: [
      { kind: 'shift_initiative', target: 'self', delta: -2 },
      { kind: 'apply_buff', target: 'self', buff: 'evasion_up', amount: 15, turns: 2 },
    ],
  }),
  e({
    idSuffix: 'combo-c-3',
    name: 'Kinetic Finish',
    name_pt: 'Finalizador Cinético',
    description: 'A heavy kinetic blow. If the target is weakened, the user recovers some initiative.',
    description_pt: 'Um golpe cinético pesado. Se o alvo estiver enfraquecido, o usuário recupera um pouco de iniciativa.',
    stage: 'Champion',
    slot_role: 'identity_finisher',
    upgrade_of: 'sk-elec-combo-r-3',
    energyCost: 15,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 48, scale: 'spd', factor: 1.72 }, element: 'electricity' },
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'weaken' },
        then: [
          { kind: 'shift_initiative', target: 'self', delta: -1 }
        ]
      }
    ],
  }),

  // Archetype: Chain
  e({
    idSuffix: 'chain-c-1',
    name: 'Branching Spark',
    name_pt: 'Faísca Ramificada',
    description: 'A branching electric attack that strikes the front line with a chance to stun.',
    description_pt: 'Um ataque elétrico ramificado que atinge a linha de frente com chance de atordoar.',
    stage: 'Champion',
    slot_role: 'primary_attack',
    energyCost: 13,
    upgrade_of: 'sk-elec-chain-r-1',
    actions: [
      { kind: 'deal_damage', target: 'enemy_first_two', amount: { base: 20, scale: 'int', factor: 0.93 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_first_two', status: 'stun', chance: 0.2, turns: 1 },
    ],
  }),
  e({
    idSuffix: 'chain-c-2',
    name: 'Energy Relay',
    name_pt: 'Revezamento de Energia',
    description: 'Channels raw electricity to the party, restoring energy and raising intelligence.',
    description_pt: 'Canaliza eletricidade bruta para a equipe, restaurando energia e aumentando a inteligência.',
    stage: 'Champion',
    slot_role: 'buff_support',
    upgrade_of: 'sk-elec-chain-r-2',
    energyCost: 12,
    actions: [
      { kind: 'restore_en', target: 'caster_ally_all', amount: 8 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'int_up', amount: 15, turns: 3 },
    ],
  }),
  e({
    idSuffix: 'chain-c-3',
    name: 'Tesla Field',
    name_pt: 'Campo de Tesla',
    description: 'Blankets the battlefield in a charged field, damaging and weakening all enemies.',
    description_pt: 'Cobre o campo de batalha em um campo carregado, danificando e enfraquecendo todos os inimigos.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-elec-chain-r-3',
    energyCost: 12,
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 15, scale: 'int', factor: 0.77 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_all', status: 'weaken', chance: 0.5, turns: 3 },
    ],
  }),

  // Archetype: Stun
  e({
    idSuffix: 'stun-c-1',
    name: 'Volt Clamp',
    name_pt: 'Grampo de Volts',
    description: 'Clamps the target with high voltage, pushing them back in the timeline with a solid stun chance.',
    description_pt: 'Prende o alvo com alta voltagem, empurrando-o para trás na linha do tempo com uma chance sólida de atordoar.',
    stage: 'Champion',
    slot_role: 'control',
    energyCost: 13,
    upgrade_of: 'sk-elec-stun-r-1',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 19, scale: 'int', factor: 0.77 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.5, turns: 1 },
      { kind: 'shift_initiative', target: 'primary_target', delta: 2 },
    ],
  }),
  e({
    idSuffix: 'stun-c-2',
    name: 'Paralyzing Wire',
    name_pt: 'Fio Paralisante',
    description: 'Throws electrified wires at the front line, stripping their speed and threatening to stun.',
    description_pt: 'Arremessa fios eletrificados na linha de frente, reduzindo sua velocidade e ameaçando atordoar.',
    stage: 'Champion',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-elec-stun-r-2',
    energyCost: 12,
    actions: [
      { kind: 'apply_status', target: 'enemy_first_two', status: 'stun', chance: 0.3, turns: 1 },
      { kind: 'modify_stat', target: 'enemy_first_two', stat: 'spd', delta: -15, turns: 3 },
    ],
  }),
  e({
    idSuffix: 'stun-c-3',
    name: 'Nerve Shock',
    name_pt: 'Choque Nervoso',
    description: 'Overloads the target\'s nervous system, heavily reducing their attack power and inflicting weakness.',
    description_pt: 'Sobrecarrega o sistema nervoso do alvo, reduzindo fortemente seu poder de ataque e infligindo fraqueza.',
    stage: 'Champion',
    slot_role: 'utility',
    upgrade_of: 'sk-elec-stun-r-3',
    energyCost: 12,
    actions: [
      { kind: 'apply_status', target: 'primary_target', status: 'weaken', chance: 0.8, turns: 3 },
      { kind: 'modify_stat', target: 'primary_target', stat: 'atk', delta: -20, turns: 3 },
    ],
  }),

  // ===========================================================================
  // ULTIMATE
  // ===========================================================================

  // Archetype: Combo
  e({
    idSuffix: 'combo-u-1',
    name: 'Plasma Assault',
    name_pt: 'Assalto de Plasma',
    description: 'A relentless plasma barrage that advances the user\'s turn. Grants an immediate extra turn if the target is stunned.',
    description_pt: 'Uma barragem de plasma implacável que avança o turno do usuário. Concede um turno extra imediato se o alvo estiver atordoado.',
    stage: 'Ultimate',
    slot_role: 'identity_finisher',
    energyCost: 22,
    cooldown: 2,
    upgrade_of: 'sk-elec-combo-c-1',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 31, scale: 'spd', factor: 1.07 }, element: 'electricity' },
      { kind: 'shift_initiative', target: 'self', delta: -2 },
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'stun' },
        then: [
          { kind: 'extra_turn', target: 'self' }
        ]
      }
    ],
  }),
  e({
    idSuffix: 'combo-u-2',
    name: 'Speed Force',
    name_pt: 'Força de Velocidade',
    description: 'Envelops the party in pure speed, greatly boosting their swiftness and slightly advancing their turns.',
    description_pt: 'Envolve a equipe em velocidade pura, aumentando muito sua rapidez e avançando ligeiramente seus turnos.',
    stage: 'Ultimate',
    slot_role: 'utility',
    upgrade_of: 'sk-elec-combo-c-2',
    energyCost: 18,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'spd_up', amount: 25, turns: 3 },
      { kind: 'shift_initiative', target: 'caster_ally_all', delta: -1 },
    ],
  }),
  e({
    idSuffix: 'combo-u-3',
    name: 'Circuit Overclock',
    name_pt: 'Sobrecarga de Circuito',
    description: 'Overclocks the party\'s systems, providing massive boosts to attack and critical hit rates.',
    description_pt: 'Sobrecarrega os sistemas da equipe, fornecendo aumentos massivos nas taxas de ataque e acerto crítico.',
    stage: 'Ultimate',
    slot_role: 'buff_support',
    upgrade_of: 'sk-elec-combo-c-3',
    energyCost: 18,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'atk_up', amount: 25, turns: 3 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'crit_up', amount: 20, turns: 3 },
    ],
  }),

  // Archetype: Chain
  e({
    idSuffix: 'chain-u-1',
    name: 'Grid Surge',
    name_pt: 'Surto na Rede',
    description: 'A powerful electrical surge that crashes over all enemies, carrying a moderate stun chance.',
    description_pt: 'Um poderoso surto elétrico que se abate sobre todos os inimigos, com uma chance moderada de atordoar.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    energyCost: 20,
    upgrade_of: 'sk-elec-chain-c-1',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 21, scale: 'int', factor: 0.82 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_all', status: 'stun', chance: 0.25, turns: 1 },
    ],
  }),
  e({
    idSuffix: 'chain-u-2',
    name: 'Conductive Web',
    name_pt: 'Teia Condutora',
    description: 'Weaves a conductive web over the enemy team, causing damage, weakness, and lowering their defense.',
    description_pt: 'Tece uma teia condutora sobre a equipe inimiga, causando dano, fraqueza e reduzindo sua defesa.',
    stage: 'Ultimate',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-elec-chain-c-2',
    energyCost: 18,
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 15, scale: 'int', factor: 0.6 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_all', status: 'weaken', chance: 0.6, turns: 3 },
      { kind: 'modify_stat', target: 'enemy_all', stat: 'def', delta: -20, turns: 3 },
    ],
  }),
  e({
    idSuffix: 'chain-u-3',
    name: 'Chain Stagger',
    name_pt: 'Retardo em Cadeia',
    description: 'Three erratic bolts strike randomly, with each hit carrying a chance to stun the unfortunate victim.',
    description_pt: 'Três raios erráticos atingem aleatoriamente, com cada acerto carregando uma chance de atordoar a vítima azarada.',
    stage: 'Ultimate',
    slot_role: 'control',
    upgrade_of: 'sk-elec-chain-c-3',
    energyCost: 18,
    actions: [
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 12, scale: 'int', factor: 0.47 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_random', status: 'stun', chance: 0.4, turns: 1 },
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 12, scale: 'int', factor: 0.47 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_random', status: 'stun', chance: 0.4, turns: 1 },
      { kind: 'deal_damage', target: 'enemy_random', amount: { base: 12, scale: 'int', factor: 0.47 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_random', status: 'stun', chance: 0.4, turns: 1 },
    ],
  }),

  // Archetype: Stun
  e({
    idSuffix: 'stun-u-1',
    name: 'Voltage Prison',
    name_pt: 'Prisão de Voltagem',
    description: 'Traps a single target in a cage of electricity, severely pushing them back and almost guaranteeing a stun.',
    description_pt: 'Prende um único alvo em uma jaula de eletricidade, empurrando-o severamente para trás e quase garantindo um atordoamento.',
    stage: 'Ultimate',
    slot_role: 'control',
    energyCost: 20,
    upgrade_of: 'sk-elec-stun-c-1',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 21, scale: 'int', factor: 0.7 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 0.8, turns: 1 },
      { kind: 'shift_initiative', target: 'primary_target', delta: 3 },
    ],
  }),
  e({
    idSuffix: 'stun-u-2',
    name: 'Electrocution',
    name_pt: 'Eletrocussão',
    description: 'Delivers a brutal shock. If the target is already stunned, a secondary devastating surge follows.',
    description_pt: 'Aplica um choque brutal. Se o alvo já estiver atordoado, um segundo surto devastador se segue.',
    stage: 'Ultimate',
    slot_role: 'primary_attack',
    upgrade_of: 'sk-elec-stun-c-2',
    energyCost: 20,
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 24, scale: 'int', factor: 0.89 }, element: 'electricity' },
      {
        kind: 'conditional',
        if: { kind: 'has_status', status: 'stun' },
        then: [
          { kind: 'deal_damage', target: 'primary_target', amount: { base: 24, scale: 'int', factor: 0.89 }, element: 'electricity' }
        ]
      }
    ],
  }),
  e({
    idSuffix: 'stun-u-3',
    name: 'Faraday Cage',
    name_pt: 'Gaiola de Faraday',
    description: 'Surrounds the party with a protective cage, raising defense and heavily reducing incoming damage.',
    description_pt: 'Circunda a equipe com uma gaiola protetora, aumentando a defesa e reduzindo fortemente o dano recebido.',
    stage: 'Ultimate',
    slot_role: 'buff_support',
    upgrade_of: 'sk-elec-stun-c-3',
    energyCost: 18,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'damage_reduction', amount: 30, turns: 2 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'def_up', amount: 25, turns: 3 },
    ],
  }),

  // ===========================================================================
  // MEGA
  // ===========================================================================

  // Archetype: Combo
  e({
    idSuffix: 'combo-m-1',
    name: 'Tachyon Execution',
    name_pt: 'Execução de Táquions',
    description: 'The ultimate high-speed execution. Vastly advances the user\'s timeline, and strikes twice if the target is critically injured.',
    description_pt: 'A execução suprema em alta velocidade. Avança vastamente a linha do tempo do usuário e atinge duas vezes se o alvo estiver gravemente ferido.',
    stage: 'Mega',
    slot_role: 'identity_finisher',
    energyCost: 35,
    tier_2: true,
    upgrade_of: 'sk-elec-combo-u-1',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 47, scale: 'spd', factor: 1.42 }, element: 'electricity' },
      { kind: 'shift_initiative', target: 'self', delta: -3 },
      {
        kind: 'conditional',
        if: { kind: 'hp_below_pct', pct: 50 },
        then: [
          { kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'spd', factor: 1.12 }, element: 'electricity' }
        ]
      }
    ],
  }),
  e({
    idSuffix: 'combo-m-2',
    name: 'Quantum Leap',
    name_pt: 'Salto Quântico',
    description: 'Bends time itself. The user acts again immediately, while pushing all allies significantly forward.',
    description_pt: 'Dobra o próprio tempo. O usuário age novamente de imediato, enquanto empurra todos os aliados significativamente para frente.',
    stage: 'Mega',
    slot_role: 'utility',
    upgrade_of: 'sk-elec-combo-u-2',
    energyCost: 38,
    cooldown: 3,
    actions: [
      { kind: 'shift_initiative', target: 'caster_ally_all', delta: -2 },
      { kind: 'extra_turn', target: 'self' },
    ],
  }),
  e({
    idSuffix: 'combo-m-3',
    name: 'Lightning Reflexes',
    name_pt: 'Reflexos de Relâmpago',
    description: 'Awakens superhuman reflexes across the entire team, granting massive speed and evasion.',
    description_pt: 'Desperta reflexos sobre-humanos em toda a equipe, concedendo velocidade e evasão massivas.',
    stage: 'Mega',
    slot_role: 'buff_support',
    upgrade_of: 'sk-elec-combo-u-3',
    energyCost: 25,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'evasion_up', amount: 30, turns: 3 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'spd_up', amount: 40, turns: 3 },
    ],
  }),

  // Archetype: Chain
  e({
    idSuffix: 'chain-m-1',
    name: 'Neural Network',
    name_pt: 'Rede Neural',
    description: 'A catastrophic double-wave of electricity that obliterates the entire enemy lineup and may stun survivors.',
    description_pt: 'Uma onda dupla catastrófica de eletricidade que oblitera toda a formação inimiga e pode atordoar os sobreviventes.',
    stage: 'Mega',
    slot_role: 'primary_attack',
    energyCost: 36,
    tier_2: true,
    upgrade_of: 'sk-elec-chain-u-1',
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 34, scale: 'int', factor: 1.12 }, element: 'electricity' },
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 18, scale: 'int', factor: 0.55 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_all', status: 'stun', chance: 0.3, turns: 1 },
    ],
  }),
  e({
    idSuffix: 'chain-m-2',
    name: 'Infinite Conductivity',
    name_pt: 'Condutividade Infinita',
    description: 'A never-ending shockwave that shatters enemy defenses and forces long-lasting weakness on them all.',
    description_pt: 'Uma onda de choque sem fim que despedaça as defesas inimigas e força uma fraqueza duradoura em todos.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-elec-chain-u-2',
    energyCost: 28,
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 21, scale: 'int', factor: 0.86 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_all', status: 'weaken', chance: 0.8, turns: 4 },
      { kind: 'modify_stat', target: 'enemy_all', stat: 'def', delta: -35, turns: 4 },
    ],
  }),
  e({
    idSuffix: 'chain-m-3',
    name: 'Energy Harvest',
    name_pt: 'Colheita de Energia',
    description: 'Strips electrical energy from the entire enemy team, dealing damage and restoring significant energy to all allies.',
    description_pt: 'Remove energia elétrica de toda a equipe inimiga, causando dano e restaurando energia significativa para todos os aliados.',
    stage: 'Mega',
    slot_role: 'utility',
    upgrade_of: 'sk-elec-chain-u-3',
    energyCost: 30,
    actions: [
      { kind: 'deal_damage', target: 'enemy_all', amount: { base: 18, scale: 'int', factor: 0.55 }, element: 'electricity' },
      { kind: 'restore_en', target: 'caster_ally_all', amount: 15 },
    ],
  }),

  // Archetype: Stun
  e({
    idSuffix: 'stun-m-1',
    name: 'Synapse Lock',
    name_pt: 'Bloqueio de Sinapse',
    description: 'A focused assault on the target\'s nervous system. Guarantees a stun, throws them deep into the timeline, and delays their entire team.',
    description_pt: 'Um assalto focado no sistema nervoso do alvo. Garante um atordoamento, joga-os para trás na linha do tempo e atrasa toda a equipe deles.',
    stage: 'Mega',
    slot_role: 'control',
    energyCost: 35,
    tier_2: true,
    upgrade_of: 'sk-elec-stun-u-1',
    actions: [
      { kind: 'deal_damage', target: 'primary_target', amount: { base: 34, scale: 'int', factor: 1.12 }, element: 'electricity' },
      { kind: 'apply_status', target: 'primary_target', status: 'stun', chance: 1.0, turns: 1 },
      { kind: 'shift_initiative', target: 'primary_target', delta: 4 },
      { kind: 'shift_initiative', target: 'enemy_all', delta: 1 },
    ],
  }),
  e({
    idSuffix: 'stun-m-2',
    name: 'Ampere Bastion',
    name_pt: 'Bastião de Ampère',
    description: 'Forms an impenetrable wall of amps, raising party defense and generating massive absorbing shields.',
    description_pt: 'Forma uma parede impenetrável de amperes, aumentando a defesa da equipe e gerando escudos de absorção massivos.',
    stage: 'Mega',
    slot_role: 'buff_support',
    upgrade_of: 'sk-elec-stun-u-2',
    energyCost: 28,
    actions: [
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'shield_absorb', amount: 250, turns: 2 },
      { kind: 'apply_buff', target: 'caster_ally_all', buff: 'def_up', amount: 40, turns: 3 },
    ],
  }),
  e({
    idSuffix: 'stun-m-3',
    name: 'System Blackout',
    name_pt: 'Apagão do Sistema',
    description: 'A localized EMP that damages and stuns the front line while severely crippling the attack and speed of all enemies.',
    description_pt: 'Um pulso eletromagnético localizado que danifica e atordoa a linha de frente enquanto prejudica severamente o ataque e a velocidade de todos os inimigos.',
    stage: 'Mega',
    slot_role: 'sustain_dot',
    upgrade_of: 'sk-elec-stun-u-3',
    energyCost: 32,
    actions: [
      { kind: 'deal_damage', target: 'enemy_first_two', amount: { base: 32, scale: 'int', factor: 1.01 }, element: 'electricity' },
      { kind: 'apply_status', target: 'enemy_first_two', status: 'stun', chance: 0.6, turns: 1 },
      { kind: 'modify_stat', target: 'enemy_all', stat: 'atk', delta: -30, turns: 3 },
      { kind: 'modify_stat', target: 'enemy_all', stat: 'spd', delta: -30, turns: 3 },
    ],
  }),
];
