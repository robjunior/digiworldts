---
tags:
  - digiworld/system
  - digiworld/reference
aliases:
  - Skill Catalog Reference
  - Skill Tables
created: 2026-08-10
updated: 2026-08-10
grounded-in:
  - backend/src/skills/seeds/
  - backend/data/catalog/digimons.xml
verified-at-commit: 75c267a
---

# Skill Catalog Reference

Generated tables for every skill in the catalog. This is the **data**; the design
rationale, balance history and open decisions live in [[Skill Archetypes]].

> [!info] How this note is maintained
> These tables are generated from the seed files under
> `backend/src/skills/seeds/`, not hand-written. Regenerate rather than edit —
> hand transcription has already introduced errors twice in this project's
> history (a `tier_2` marker and an authored-vs-sourced attribution), both
> caught only by re-deriving from source.

The catalog holds **1264 skills**: 396 element-pool skills (11 elements × 36)
and 868 signatures (2 per each of the 434 Digimon in the catalog).

---

## Element pools — 396 skills

Every element runs the same grid: 3 archetypes × 4 stages × 3 skills. `null` is
the exception, using 4 archetypes at 9 skills each.

⭐ marks a `tier_2` skill — the strongest of its archetype at Mega. Ten elements
carry three; `null` carries four, one per archetype.

### fire — Berserker / Burst / DoT

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-fire-berserk-r-1` | Cinder Knuckle | Punho de Cinza | Rookie | Berserker | `primary_attack` | 8 |
| `sk-fire-berserk-r-2` | Scorched Nerve | Nervo Chamuscado | Rookie | Berserker | `buff_support` | 7 |
| `sk-fire-berserk-r-3` | Ashbite Rush | Avanço Mordecinza | Rookie | Berserker | `identity_finisher` | 10 |
| `sk-fire-burst-r-1` | Spark Mortar | Morteiro de Faísca | Rookie | Burst | `primary_attack` | 9 |
| `sk-fire-burst-r-2` | Flashpan Pop | Estouro de Frigideira | Rookie | Burst | `control` | 8 |
| `sk-fire-burst-r-3` | Flare Grenade | Granada de Clarão | Rookie | Burst | `utility` | 10 |
| `sk-fire-dot-r-1` | Ember Brand | Marca de Brasa | Rookie | DoT | `sustain_dot` | 7 |
| `sk-fire-dot-r-2` | Smoke Bellows | Foles de Fumaça | Rookie | DoT | `control` | 8 |
| `sk-fire-dot-r-3` | Coalseed Spread | Dispersão de Semente-Carvão | Rookie | DoT | `utility` | 9 |
| `sk-fire-berserk-c-1` | Charcoal Hook | Gancho de Carvão | Champion | Berserker | `primary_attack` | 14 |
| `sk-fire-berserk-c-2` | Boilvein Surge | Surto de Veia Fervente | Champion | Berserker | `buff_support` | 13 |
| `sk-fire-berserk-c-3` | Coalbrand Rush | Avanço Marca-Carvão | Champion | Berserker | `identity_finisher` | 16 |
| `sk-fire-burst-c-1` | Salamander Mortar | Morteiro de Salamandra | Champion | Burst | `primary_attack` | 15 |
| `sk-fire-burst-c-2` | Blastglass Pop | Estouro de Vidro-Explosivo | Champion | Burst | `control` | 13 |
| `sk-fire-burst-c-3` | Bombardier Flare | Clarão Bombardeiro | Champion | Burst | `utility` | 16 |
| `sk-fire-dot-c-1` | Searing Brand | Marca Cauterizante | Champion | DoT | `sustain_dot` | 12 |
| `sk-fire-dot-c-2` | Charfog Bellows | Foles de Névoa-Carvão | Champion | DoT | `control` | 13 |
| `sk-fire-dot-c-3` | Cinderseed Spread | Dispersão de Semente-Cinza | Champion | DoT | `utility` | 15 |
| `sk-fire-berserk-u-1` | Hellcoal Uppercut | Uppercut de Carvão Infernal | Ultimate | Berserker | `primary_attack` | 20 |
| `sk-fire-berserk-u-2` | Rupture Furnace | Fornalha de Ruptura | Ultimate | Berserker | `buff_support` | 18 |
| `sk-fire-berserk-u-3` | Pyreheart Rampage | Fúria Coração-Pira | Ultimate | Berserker | `identity_finisher` | 24 |
| `sk-fire-burst-u-1` | Phoenix Mortar | Morteiro da Fênix | Ultimate | Burst | `primary_attack` | 22 |
| `sk-fire-burst-u-2` | Sunbreak Pop | Estouro Quebra-Sol | Ultimate | Burst | `control` | 18 |
| `sk-fire-burst-u-3` | Comet Kiln | Forno de Cometa | Ultimate | Burst | `utility` | 24 |
| `sk-fire-dot-u-1` | Wildfire Brand | Marca de Incêndio Vivo | Ultimate | DoT | `sustain_dot` | 16 |
| `sk-fire-dot-u-2` | Pyroclast Bellows | Foles Piroclásticos | Ultimate | DoT | `control` | 18 |
| `sk-fire-dot-u-3` | Blazeseed Bloom | Floração de Semente-Chama | Ultimate | DoT | `utility` | 20 |
| `sk-fire-berserk-m-1` | Volcanic Haymaker | Direto Vulcânico | Mega | Berserker | `primary_attack` | 30 |
| `sk-fire-berserk-m-2` | Bloodmagma Ascension | Ascensão Sangue-Magma | Mega | Berserker | `buff_support` | 26 |
| `sk-fire-berserk-m-3` | Ragnarok Heartbeat ⭐ | Batimento de Ragnarök | Mega | Berserker | `identity_finisher` | 38 |
| `sk-fire-burst-m-1` | Starforge Mortar | Morteiro da Forja Estelar | Mega | Burst | `primary_attack` | 34 |
| `sk-fire-burst-m-2` | Corona Detonator | Detonador de Coroa | Mega | Burst | `control` | 28 |
| `sk-fire-burst-m-3` | Aphelion Bombardment ⭐ | Bombardeio do Afélio | Mega | Burst | `utility` | 40 |
| `sk-fire-dot-m-1` | Sunscar Brand | Marca Cicatriz-Solar | Mega | DoT | `sustain_dot` | 24 |
| `sk-fire-dot-m-2` | Eclipse Bellows | Foles do Eclipse | Mega | DoT | `control` | 28 |
| `sk-fire-dot-m-3` | Worldpyre Bloom ⭐ | Floração da Pira-Mundo | Mega | DoT | `utility` | 36 |

### water — Controller / Displacer / Sustain

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-water-control-r-1` | Rime Bubble | Bolha de Geada | Rookie | Controller | `control` | 8 |
| `sk-water-control-r-2` | Silt Snare | Laço de Lodo | Rookie | Controller | `utility` | 9 |
| `sk-water-control-r-3` | Mirror Spray | Borrifo Espelhado | Rookie | Controller | `identity_finisher` | 10 |
| `sk-water-displace-r-1` | Undertow Jab | Estocada de Ressaca | Rookie | Displacer | `primary_attack` | 8 |
| `sk-water-displace-r-2` | Foam Break | Quebra-Espuma | Rookie | Displacer | `control` | 7 |
| `sk-water-displace-r-3` | Backwash Feint | Finta de Refluxo | Rookie | Displacer | `utility` | 9 |
| `sk-water-sustain-r-1` | Tidepatch | Remendo da Maré | Rookie | Sustain | `sustain_dot` | 6 |
| `sk-water-sustain-r-2` | Clearwater Guard | Guarda de Água Clara | Rookie | Sustain | `buff_support` | 8 |
| `sk-water-sustain-r-3` | Brackish Counter | Contra-Ataque Salobro | Rookie | Sustain | `primary_attack` | 9 |
| `sk-water-control-c-1` | Glacial Bubble | Bolha Glacial | Champion | Controller | `control` | 13 |
| `sk-water-control-c-2` | Quagmire Snare | Laço de Brejo | Champion | Controller | `utility` | 14 |
| `sk-water-control-c-3` | Hall of Ripples | Salão de Ondulações | Champion | Controller | `identity_finisher` | 16 |
| `sk-water-displace-c-1` | Riptide Spear | Lança de Correnteza | Champion | Displacer | `primary_attack` | 14 |
| `sk-water-displace-c-2` | Breaker Foam | Espuma Rompente | Champion | Displacer | `control` | 12 |
| `sk-water-displace-c-3` | Eddy Step | Passo do Remanso | Champion | Displacer | `utility` | 15 |
| `sk-water-sustain-c-1` | Surgeon Tide | Maré Cirurgiã | Champion | Sustain | `sustain_dot` | 12 |
| `sk-water-sustain-c-2` | Blueglass Ward | Proteção de Vidro Azul | Champion | Sustain | `buff_support` | 13 |
| `sk-water-sustain-c-3` | Saltline Reprisal | Revide da Linha Salgada | Champion | Sustain | `primary_attack` | 15 |
| `sk-water-control-u-1` | Cryo Sphere | Esfera Crio | Ultimate | Controller | `control` | 17 |
| `sk-water-control-u-2` | Boglock Snare | Laço Trava-Brejo | Ultimate | Controller | `utility` | 19 |
| `sk-water-control-u-3` | Labyrinth Current | Corrente Labiríntica | Ultimate | Controller | `identity_finisher` | 23 |
| `sk-water-displace-u-1` | Riptide Lance | Lança da Maré Viva | Ultimate | Displacer | `primary_attack` | 18 |
| `sk-water-displace-u-2` | Reefbreaker Foam | Espuma Quebra-Recife | Ultimate | Displacer | `control` | 16 |
| `sk-water-displace-u-3` | Gyre Stride | Passada do Giro | Ultimate | Displacer | `utility` | 22 |
| `sk-water-sustain-u-1` | Lifeboat Tide | Maré Bote-Salva-Vidas | Ultimate | Sustain | `sustain_dot` | 16 |
| `sk-water-sustain-u-2` | Seaglass Bastion | Bastião de Vidro-Marinho | Ultimate | Sustain | `buff_support` | 18 |
| `sk-water-sustain-u-3` | Brineblade Reprisal | Revide da Lâmina Salina | Ultimate | Sustain | `primary_attack` | 20 |
| `sk-water-control-m-1` | Absolute Zero Sphere | Esfera de Zero Absoluto | Mega | Controller | `control` | 24 |
| `sk-water-control-m-2` | Abyssal Quagmire | Brejo Abissal | Mega | Controller | `utility` | 28 |
| `sk-water-control-m-3` | Leviathan Maze ⭐ | Labirinto do Leviatã | Mega | Controller | `identity_finisher` | 34 |
| `sk-water-displace-m-1` | Maelstrom Harpoon | Arpão do Maelström | Mega | Displacer | `primary_attack` | 26 |
| `sk-water-displace-m-2` | Tidebreaker Verdict | Veredito Quebra-Maré | Mega | Displacer | `control` | 24 |
| `sk-water-displace-m-3` | Worldcurrent Overrun ⭐ | Atropelo da Corrente-Mundo | Mega | Displacer | `utility` | 36 |
| `sk-water-sustain-m-1` | Mercy Tide | Maré da Misericórdia | Mega | Sustain | `sustain_dot` | 22 |
| `sk-water-sustain-m-2` | Pearl Bastion | Bastião de Pérola | Mega | Sustain | `buff_support` | 25 |
| `sk-water-sustain-m-3` | Abyssal Reprisal ⭐ | Revide Abissal | Mega | Sustain | `primary_attack` | 32 |

### plant — DoT / Healer / Zone Control

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-plant-dot-r-1` | Toxic Seed | Semente Tóxica | Rookie | DoT | `sustain_dot` | 7 |
| `sk-plant-dot-r-2` | Thorny Whip | Chicote Espinhoso | Rookie | DoT | `primary_attack` | 9 |
| `sk-plant-dot-r-3` | Creeping Mold | Mofo Rastejante | Rookie | DoT | `utility` | 10 |
| `sk-plant-heal-r-1` | Healing Nectar | Néctar Curativo | Rookie | Healer | `buff_support` | 8 |
| `sk-plant-heal-r-2` | Leaf Shield | Escudo de Folhas | Rookie | Healer | `utility` | 9 |
| `sk-plant-heal-r-3` | Purifying Dew | Orvalho Purificador | Rookie | Healer | `identity_finisher` | 7 |
| `sk-plant-zone-r-1` | Tangleweed | Erva-Emaranhada | Rookie | Zone Control | `control` | 8 |
| `sk-plant-zone-r-2` | Spore Cloud | Nuvem de Esporos | Rookie | Zone Control | `control` | 7 |
| `sk-plant-zone-r-3` | Snapping Trap | Armadilha Mordedora | Rookie | Zone Control | `primary_attack` | 9 |
| `sk-plant-dot-c-1` | Venomous Bloom | Floração Venenosa | Champion | DoT | `sustain_dot` | 12 |
| `sk-plant-dot-c-2` | Acid Sap | Seiva Ácida | Champion | DoT | `primary_attack` | 12 |
| `sk-plant-dot-c-3` | Fungal Spores | Esporos Fúngicos | Champion | DoT | `utility` | 11 |
| `sk-plant-heal-c-1` | Rejuvenating Pollen | Pólen Rejuvenescedor | Champion | Healer | `buff_support` | 12 |
| `sk-plant-heal-c-2` | Photosynthesis | Fotossíntese | Champion | Healer | `utility` | 12 |
| `sk-plant-heal-c-3` | Bark Armor | Armadura de Casca | Champion | Healer | `identity_finisher` | 13 |
| `sk-plant-zone-c-1` | Restricting Vines | Vinhas Restritivas | Champion | Zone Control | `utility` | 12 |
| `sk-plant-zone-c-2` | Paralyzing Stench | Odor Paralisante | Champion | Zone Control | `control` | 12 |
| `sk-plant-zone-c-3` | Flytrap Jaws | Mandíbulas de Dioneia | Champion | Zone Control | `control` | 13 |
| `sk-plant-dot-u-1` | Lethal Blossom | Pétala Letal | Ultimate | DoT | `identity_finisher` | 12 |
| `sk-plant-dot-u-2` | Corrosive Vine | Vinha Corrosiva | Ultimate | DoT | `sustain_dot` | 12 |
| `sk-plant-dot-u-3` | Rotting Roots | Raízes Apodrecidas | Ultimate | DoT | `primary_attack` | 13 |
| `sk-plant-heal-u-1` | Tree of Life | Árvore da Vida | Ultimate | Healer | `buff_support` | 13 |
| `sk-plant-heal-u-2` | Natures Blessing | Bênção da Natureza | Ultimate | Healer | `utility` | 12 |
| `sk-plant-heal-u-3` | Sylvan Ward | Guarda Silvestre | Ultimate | Healer | `identity_finisher` | 17 |
| `sk-plant-zone-u-1` | Forest Prison | Prisão Florestal | Ultimate | Zone Control | `utility` | 13 |
| `sk-plant-zone-u-2` | Petrifying Gaze | Olhar Petrificante | Ultimate | Zone Control | `control` | 12 |
| `sk-plant-zone-u-3` | Bramble Maze | Labirinto de Sarças | Ultimate | Zone Control | `control` | 17 |
| `sk-plant-dot-m-1` | World Eaters Flower ⭐ | Flor Devoradora de Mundos | Mega | DoT | `identity_finisher` | 35 |
| `sk-plant-dot-m-2` | Bio-Toxin Drain | Dreno Biotóxico | Mega | DoT | `sustain_dot` | 28 |
| `sk-plant-dot-m-3` | Natures Decay | Decadência da Natureza | Mega | DoT | `primary_attack` | 38 |
| `sk-plant-heal-m-1` | Yggdrasils Embrace ⭐ | Abraço de Yggdrasil | Mega | Healer | `buff_support` | 35 |
| `sk-plant-heal-m-2` | Forest Sanctuary | Santuário Florestal | Mega | Healer | `utility` | 25 |
| `sk-plant-heal-m-3` | Miracle Harvest | Colheita Milagrosa | Mega | Healer | `identity_finisher` | 40 |
| `sk-plant-zone-m-1` | Jungles Grasp ⭐ | Aperto da Selva | Mega | Zone Control | `control` | 32 |
| `sk-plant-zone-m-2` | Eternal Slumber | Sono Eterno | Mega | Zone Control | `control` | 28 |
| `sk-plant-zone-m-3` | Ecosystem Lockdown | Bloqueio do Ecossistema | Mega | Zone Control | `control` | 38 |

### ice — Controller / Lockdown / Debuffer

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-ice-control-r-1` | Frost Pin | Alfinete de Geada | Rookie | Controller | `control` | 8 |
| `sk-ice-control-r-2` | Hoarfrost Tripwire | Fio de Geada | Rookie | Controller | `utility` | 9 |
| `sk-ice-control-r-3` | Whiteout Needle | Agulha do Clarão Branco | Rookie | Controller | `identity_finisher` | 10 |
| `sk-ice-debuff-r-1` | Cold Bite | Mordida Fria | Rookie | Debuffer | `primary_attack` | 9 |
| `sk-ice-debuff-r-2` | Brittle Mark | Marca Quebradiça | Rookie | Debuffer | `sustain_dot` | 7 |
| `sk-ice-debuff-r-3` | Shiver Shear | Corte Tremulante | Rookie | Debuffer | `utility` | 8 |
| `sk-ice-lock-r-1` | Sleet Drag | Arrasto de Granizo | Rookie | Lockdown | `primary_attack` | 8 |
| `sk-ice-lock-r-2` | Numbing Hex | Maldição Dormente | Rookie | Lockdown | `control` | 9 |
| `sk-ice-lock-r-3` | Queue Frostbite | Geladura da Fila | Rookie | Lockdown | `buff_support` | 8 |
| `sk-ice-control-c-1` | Cryo Pin | Alfinete Crio | Champion | Controller | `control` | 13 |
| `sk-ice-control-c-2` | Rime Tripwire | Fio de Rima | Champion | Controller | `utility` | 14 |
| `sk-ice-control-c-3` | Snowblind Lance | Lança Cega-Neve | Champion | Controller | `identity_finisher` | 16 |
| `sk-ice-debuff-c-1` | Razor Cold Bite | Mordida Fria Afiada | Champion | Debuffer | `primary_attack` | 15 |
| `sk-ice-debuff-c-2` | Fracture Mark | Marca de Fratura | Champion | Debuffer | `sustain_dot` | 12 |
| `sk-ice-debuff-c-3` | Icicle Sever | Cisão de Estalactite | Champion | Debuffer | `utility` | 14 |
| `sk-ice-lock-c-1` | Hail Drag | Arrasto de Saraiva | Champion | Lockdown | `primary_attack` | 14 |
| `sk-ice-lock-c-2` | Nerve Chill | Calafrio Nervoso | Champion | Lockdown | `control` | 15 |
| `sk-ice-lock-c-3` | Turnbreak Frost | Geada Quebra-Turno | Champion | Lockdown | `buff_support` | 13 |
| `sk-ice-control-u-1` | Permafrost Pin | Alfinete de Permafrost | Ultimate | Controller | `control` | 18 |
| `sk-ice-control-u-2` | Boreal Tripwire | Fio Boreal | Ultimate | Controller | `utility` | 20 |
| `sk-ice-control-u-3` | Horizon Whiteout | Clarão Branco do Horizonte | Ultimate | Controller | `identity_finisher` | 24 |
| `sk-ice-debuff-u-1` | Rending Cold Bite | Mordida Fria Dilacerante | Ultimate | Debuffer | `primary_attack` | 22 |
| `sk-ice-debuff-u-2` | Hemlock Frost Mark | Marca de Geada-Cicuta | Ultimate | Debuffer | `sustain_dot` | 18 |
| `sk-ice-debuff-u-3` | Glacier Sever | Cisão da Geleira | Ultimate | Debuffer | `utility` | 20 |
| `sk-ice-lock-u-1` | Avalanche Drag | Arrasto de Avalanche | Ultimate | Lockdown | `primary_attack` | 20 |
| `sk-ice-lock-u-2` | Synapse Frost | Geada da Sinapse | Ultimate | Lockdown | `control` | 21 |
| `sk-ice-lock-u-3` | Chrono Rime | Rima Cronal | Ultimate | Lockdown | `buff_support` | 18 |
| `sk-ice-control-m-1` | Stillpoint Spike ⭐ | Estaca do Ponto Imóvel | Mega | Controller | `control` | 30 |
| `sk-ice-control-m-2` | Aurora Tripwire | Fio da Aurora | Mega | Controller | `utility` | 28 |
| `sk-ice-control-m-3` | Polar Mirage | Miragem Polar | Mega | Controller | `identity_finisher` | 34 |
| `sk-ice-debuff-m-1` | Wendigo Cold Bite ⭐ | Mordida Fria de Wendigo | Mega | Debuffer | `primary_attack` | 36 |
| `sk-ice-debuff-m-2` | Nullwinter Mark | Marca do Inverno Nulo | Mega | Debuffer | `sustain_dot` | 24 |
| `sk-ice-debuff-m-3` | Worldglass Sever | Cisão do Vidro-Mundo | Mega | Debuffer | `utility` | 30 |
| `sk-ice-lock-m-1` | Glacier Dragoon ⭐ | Dragão Glacial | Mega | Lockdown | `primary_attack` | 32 |
| `sk-ice-lock-m-2` | Absolute Nerve Lock | Trava Nervosa Absoluta | Mega | Lockdown | `control` | 36 |
| `sk-ice-lock-m-3` | Epoch Rime | Rima de Época | Mega | Lockdown | `buff_support` | 26 |

### electricity — Combo / Chain / Stun

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-elec-chain-r-1` | Arcing Zap | Zap em Arco | Rookie | Chain | `primary_attack` | 8 |
| `sk-elec-chain-r-2` | Chain Volt | Volt em Cadeia | Rookie | Chain | `identity_finisher` | 10 |
| `sk-elec-chain-r-3` | Static Cling | Aderência Estática | Rookie | Chain | `sustain_dot` | 7 |
| `sk-elec-combo-r-1` | Flash Strike | Golpe Relâmpago | Rookie | Combo | `primary_attack` | 9 |
| `sk-elec-combo-r-2` | Spark Step | Passo de Faísca | Rookie | Combo | `utility` | 8 |
| `sk-elec-combo-r-3` | Volt Charge | Carga de Volts | Rookie | Combo | `buff_support` | 8 |
| `sk-elec-stun-r-1` | Taser Grip | Agarre de Taser | Rookie | Stun | `control` | 8 |
| `sk-elec-stun-r-2` | Static Guard | Guarda Estática | Rookie | Stun | `buff_support` | 7 |
| `sk-elec-stun-r-3` | Stun Gun | Arma de Choque | Rookie | Stun | `utility` | 8 |
| `sk-elec-chain-c-1` | Branching Spark | Faísca Ramificada | Champion | Chain | `primary_attack` | 13 |
| `sk-elec-chain-c-2` | Energy Relay | Revezamento de Energia | Champion | Chain | `buff_support` | 12 |
| `sk-elec-chain-c-3` | Tesla Field | Campo de Tesla | Champion | Chain | `sustain_dot` | 12 |
| `sk-elec-combo-c-1` | Lightning Dash | Investida Relâmpago | Champion | Combo | `primary_attack` | 14 |
| `sk-elec-combo-c-2` | Volt Switch | Troca de Voltagem | Champion | Combo | `utility` | 12 |
| `sk-elec-combo-c-3` | Kinetic Finish | Finalizador Cinético | Champion | Combo | `identity_finisher` | 15 |
| `sk-elec-stun-c-1` | Volt Clamp | Grampo de Volts | Champion | Stun | `control` | 13 |
| `sk-elec-stun-c-2` | Paralyzing Wire | Fio Paralisante | Champion | Stun | `sustain_dot` | 12 |
| `sk-elec-stun-c-3` | Nerve Shock | Choque Nervoso | Champion | Stun | `utility` | 12 |
| `sk-elec-chain-u-1` | Grid Surge | Surto na Rede | Ultimate | Chain | `primary_attack` | 20 |
| `sk-elec-chain-u-2` | Conductive Web | Teia Condutora | Ultimate | Chain | `sustain_dot` | 18 |
| `sk-elec-chain-u-3` | Chain Stagger | Retardo em Cadeia | Ultimate | Chain | `control` | 18 |
| `sk-elec-combo-u-1` | Plasma Assault | Assalto de Plasma | Ultimate | Combo | `identity_finisher` | 22 |
| `sk-elec-combo-u-2` | Speed Force | Força de Velocidade | Ultimate | Combo | `utility` | 18 |
| `sk-elec-combo-u-3` | Circuit Overclock | Sobrecarga de Circuito | Ultimate | Combo | `buff_support` | 18 |
| `sk-elec-stun-u-1` | Voltage Prison | Prisão de Voltagem | Ultimate | Stun | `control` | 20 |
| `sk-elec-stun-u-2` | Electrocution | Eletrocussão | Ultimate | Stun | `primary_attack` | 20 |
| `sk-elec-stun-u-3` | Faraday Cage | Gaiola de Faraday | Ultimate | Stun | `buff_support` | 18 |
| `sk-elec-chain-m-1` | Neural Network ⭐ | Rede Neural | Mega | Chain | `primary_attack` | 36 |
| `sk-elec-chain-m-2` | Infinite Conductivity | Condutividade Infinita | Mega | Chain | `sustain_dot` | 28 |
| `sk-elec-chain-m-3` | Energy Harvest | Colheita de Energia | Mega | Chain | `utility` | 30 |
| `sk-elec-combo-m-1` | Tachyon Execution ⭐ | Execução de Táquions | Mega | Combo | `identity_finisher` | 35 |
| `sk-elec-combo-m-2` | Quantum Leap | Salto Quântico | Mega | Combo | `utility` | 38 |
| `sk-elec-combo-m-3` | Lightning Reflexes | Reflexos de Relâmpago | Mega | Combo | `buff_support` | 25 |
| `sk-elec-stun-m-1` | Synapse Lock ⭐ | Bloqueio de Sinapse | Mega | Stun | `control` | 35 |
| `sk-elec-stun-m-2` | Ampere Bastion | Bastião de Ampère | Mega | Stun | `buff_support` | 28 |
| `sk-elec-stun-m-3` | System Blackout | Apagão do Sistema | Mega | Stun | `sustain_dot` | 32 |

### earth — Tank / Guardian / Terrain Control

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-earth-guard-r-1` | Clay Rescue | Resgate de Argila | Rookie | Guardian | `sustain_dot` | 6 |
| `sk-earth-guard-r-2` | Burrow Cover | Cobertura de Toca | Rookie | Guardian | `utility` | 8 |
| `sk-earth-guard-r-3` | Mudbrick Escort | Escolta de Adobe | Rookie | Guardian | `primary_attack` | 9 |
| `sk-earth-tank-r-1` | Granite Jab | Jab de Granito | Rookie | Tank | `primary_attack` | 8 |
| `sk-earth-tank-r-2` | Pebble Guard | Guarda de Seixos | Rookie | Tank | `buff_support` | 7 |
| `sk-earth-tank-r-3` | Stoneback Rebuttal | Resposta Costapedra | Rookie | Tank | `identity_finisher` | 10 |
| `sk-earth-terrain-r-1` | Dustroot Snare | Laço de Raiz Poeirenta | Rookie | Terrain Control | `control` | 8 |
| `sk-earth-terrain-r-2` | Ridge Delay | Atraso da Crista | Rookie | Terrain Control | `sustain_dot` | 7 |
| `sk-earth-terrain-r-3` | Grit Maze | Labirinto de Cascalho | Rookie | Terrain Control | `utility` | 10 |
| `sk-earth-guard-c-1` | Loam Rescue | Resgate de Terra Fofa | Champion | Guardian | `sustain_dot` | 12 |
| `sk-earth-guard-c-2` | Trench Cover | Cobertura de Trincheira | Champion | Guardian | `utility` | 13 |
| `sk-earth-guard-c-3` | Bulwark Escort | Escolta do Baluarte | Champion | Guardian | `primary_attack` | 15 |
| `sk-earth-tank-c-1` | Basalt Knuckle | Nó de Basalto | Champion | Tank | `primary_attack` | 14 |
| `sk-earth-tank-c-2` | Slate Guard | Guarda de Ardósia | Champion | Tank | `buff_support` | 13 |
| `sk-earth-tank-c-3` | Rampart Rebuttal | Resposta da Muralha | Champion | Tank | `identity_finisher` | 16 |
| `sk-earth-terrain-c-1` | Marlroot Snare | Laço de Marga | Champion | Terrain Control | `control` | 13 |
| `sk-earth-terrain-c-2` | Escarpment Delay | Atraso da Escarpa | Champion | Terrain Control | `sustain_dot` | 12 |
| `sk-earth-terrain-c-3` | Quarry Maze | Labirinto da Pedreira | Champion | Terrain Control | `utility` | 16 |
| `sk-earth-guard-u-1` | Bedrock Rescue | Resgate de Rocha-Mãe | Ultimate | Guardian | `sustain_dot` | 16 |
| `sk-earth-guard-u-2` | Redoubt Cover | Cobertura do Reduto | Ultimate | Guardian | `utility` | 18 |
| `sk-earth-guard-u-3` | Citadel Escort | Escolta da Cidadela | Ultimate | Guardian | `primary_attack` | 20 |
| `sk-earth-tank-u-1` | Obsidian Haymaker | Direto de Obsidiana | Ultimate | Tank | `primary_attack` | 20 |
| `sk-earth-tank-u-2` | Obelisk Guard | Guarda do Obelisco | Ultimate | Tank | `buff_support` | 18 |
| `sk-earth-tank-u-3` | Titan Rebuttal | Resposta Titânica | Ultimate | Tank | `identity_finisher` | 24 |
| `sk-earth-terrain-u-1` | Plateau Snare | Laço do Planalto | Ultimate | Terrain Control | `control` | 18 |
| `sk-earth-terrain-u-2` | Faultline Delay | Atraso da Falha | Ultimate | Terrain Control | `sustain_dot` | 17 |
| `sk-earth-terrain-u-3` | Canyon Maze | Labirinto do Cânion | Ultimate | Terrain Control | `utility` | 22 |
| `sk-earth-guard-m-1` | Keystone Rescue | Resgate da Pedra-Chave | Mega | Guardian | `sustain_dot` | 22 |
| `sk-earth-guard-m-2` | Sanctum Cover ⭐ | Cobertura do Santuário | Mega | Guardian | `utility` | 30 |
| `sk-earth-guard-m-3` | Earthwarden Escort | Escolta do Guardião da Terra | Mega | Guardian | `primary_attack` | 32 |
| `sk-earth-tank-m-1` | Mantlebreaker Fist ⭐ | Punho Quebra-Manto | Mega | Tank | `primary_attack` | 32 |
| `sk-earth-tank-m-2` | Continental Guard | Guarda Continental | Mega | Tank | `buff_support` | 26 |
| `sk-earth-tank-m-3` | Worldplate Rebuttal | Resposta da Placa-Mundo | Mega | Tank | `identity_finisher` | 38 |
| `sk-earth-terrain-m-1` | Tectonic Snare | Laço Tectônico | Mega | Terrain Control | `control` | 28 |
| `sk-earth-terrain-m-2` | Continental Drift | Deriva Continental | Mega | Terrain Control | `sustain_dot` | 24 |
| `sk-earth-terrain-m-3` | Labyrinth of Strata ⭐ | Labirinto dos Estratos | Mega | Terrain Control | `identity_finisher` | 36 |

### steel — Tank / Counter / Fortress

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-steel-counter-r-1` | Spark Parry | Aparo de Faísca | Rookie | Counter | `primary_attack` | 8 |
| `sk-steel-counter-r-2` | Latch Breaker | Quebra-Trava | Rookie | Counter | `utility` | 9 |
| `sk-steel-counter-r-3` | Reactive Burr | Rebarba Reativa | Rookie | Counter | `sustain_dot` | 7 |
| `sk-steel-fortress-r-1` | Panel Cover | Cobertura de Painel | Rookie | Fortress | `buff_support` | 8 |
| `sk-steel-fortress-r-2` | Gate Clamp | Grampo do Portão | Rookie | Fortress | `control` | 8 |
| `sk-steel-fortress-r-3` | Watchtower Shot | Disparo da Torre de Vigia | Rookie | Fortress | `identity_finisher` | 10 |
| `sk-steel-tank-r-1` | Rivet Jab | Jab de Rebite | Rookie | Tank | `primary_attack` | 8 |
| `sk-steel-tank-r-2` | Tinplate Brace | Apoio de Folha-de-Flandres | Rookie | Tank | `buff_support` | 7 |
| `sk-steel-tank-r-3` | Buckler Reprisal | Revide do Broquel | Rookie | Tank | `identity_finisher` | 10 |
| `sk-steel-counter-c-1` | Riposte Gear | Engrenagem de Riposta | Champion | Counter | `primary_attack` | 14 |
| `sk-steel-counter-c-2` | Torque Breaker | Quebra-Torque | Champion | Counter | `utility` | 13 |
| `sk-steel-counter-c-3` | Punishing Burr | Rebarba Punitiva | Champion | Counter | `sustain_dot` | 12 |
| `sk-steel-fortress-c-1` | Palisade Cover | Cobertura de Paliçada | Champion | Fortress | `buff_support` | 13 |
| `sk-steel-fortress-c-2` | Portcullis Clamp | Grampo da Grade Levadiça | Champion | Fortress | `control` | 14 |
| `sk-steel-fortress-c-3` | Citadel Shot | Disparo da Cidadela | Champion | Fortress | `identity_finisher` | 16 |
| `sk-steel-tank-c-1` | Alloy Knuckle | Nó de Liga Metálica | Champion | Tank | `primary_attack` | 14 |
| `sk-steel-tank-c-2` | Chainmail Brace | Apoio de Cota de Malha | Champion | Tank | `buff_support` | 13 |
| `sk-steel-tank-c-3` | Bulwark Reprisal | Revide do Baluarte | Champion | Tank | `identity_finisher` | 16 |
| `sk-steel-counter-u-1` | Retaliation Engine | Motor de Retaliação | Ultimate | Counter | `primary_attack` | 20 |
| `sk-steel-counter-u-2` | Maglock Breaker | Quebra-Trava Magnética | Ultimate | Counter | `utility` | 18 |
| `sk-steel-counter-u-3` | Corrosion Reversal | Reversão Corrosiva | Ultimate | Counter | `sustain_dot` | 17 |
| `sk-steel-fortress-u-1` | Alloy Redoubt | Reduto de Liga Metálica | Ultimate | Fortress | `buff_support` | 18 |
| `sk-steel-fortress-u-2` | Vault Clamp | Grampo da Abóbada | Ultimate | Fortress | `control` | 20 |
| `sk-steel-fortress-u-3` | Bastion Cannon | Canhão do Bastião | Ultimate | Fortress | `identity_finisher` | 22 |
| `sk-steel-tank-u-1` | Carbide Haymaker | Direto de Carbeto | Ultimate | Tank | `primary_attack` | 20 |
| `sk-steel-tank-u-2` | Plasteel Brace | Apoio de Plastaço | Ultimate | Tank | `buff_support` | 18 |
| `sk-steel-tank-u-3` | Dreadnought Reprisal | Revide do Couraçado | Ultimate | Tank | `identity_finisher` | 24 |
| `sk-steel-counter-m-1` | Nemesis Engine ⭐ | Motor Nêmesis | Mega | Counter | `primary_attack` | 35 |
| `sk-steel-counter-m-2` | Worldkey Breaker | Quebra-Chave do Mundo | Mega | Counter | `utility` | 30 |
| `sk-steel-counter-m-3` | Karmic Corrosion | Corrosão Cármica | Mega | Counter | `sustain_dot` | 28 |
| `sk-steel-fortress-m-1` | Aegis Cover ⭐ | Cobertura Égide | Mega | Fortress | `buff_support` | 30 |
| `sk-steel-fortress-m-2` | Ironclad Clamp | Grampo Couraçado | Mega | Fortress | `control` | 28 |
| `sk-steel-fortress-m-3` | Worldwall Cannon | Canhão da Muralha-Mundo | Mega | Fortress | `identity_finisher` | 36 |
| `sk-steel-tank-m-1` | Titanium Crusher ⭐ | Esmagador de Titânio | Mega | Tank | `primary_attack` | 32 |
| `sk-steel-tank-m-2` | Orichalcum Brace | Apoio de Oricalco | Mega | Tank | `buff_support` | 26 |
| `sk-steel-tank-m-3` | Worldforge Reprisal | Revide da Forja-Mundo | Mega | Tank | `identity_finisher` | 38 |

### wind — Skirmisher / Speedster / Evasion

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-wind-evade-r-1` | Dustveil Puff | Sopro de Véu de Pó | Rookie | Evasion | `control` | 8 |
| `sk-wind-evade-r-2` | Featherstep Guard | Guarda Passo-de-Pena | Rookie | Evasion | `buff_support` | 7 |
| `sk-wind-evade-r-3` | Blurred Sidestep | Esquiva Borrada | Rookie | Evasion | `utility` | 9 |
| `sk-wind-skirm-r-1` | Slipstream Cut | Corte no Vácuo | Rookie | Skirmisher | `primary_attack` | 10 |
| `sk-wind-skirm-r-2` | Tailwind Nick | Talho de Vento a Favor | Rookie | Skirmisher | `sustain_dot` | 6 |
| `sk-wind-skirm-r-3` | Crosswind Feint | Finta de Vento Cruzado | Rookie | Skirmisher | `control` | 6 |
| `sk-wind-speed-r-1` | Quickstep Jab | Jab do Passo Rápido | Rookie | Speedster | `primary_attack` | 10 |
| `sk-wind-speed-r-2` | Fleet Draft | Esteira Ligeira | Rookie | Speedster | `buff_support` | 6 |
| `sk-wind-speed-r-3` | First-Breeze Lunge | Investida da Primeira Brisa | Rookie | Speedster | `identity_finisher` | 10 |
| `sk-wind-evade-c-1` | Sandblind Puff | Sopro Cega-Areia | Champion | Evasion | `control` | 13 |
| `sk-wind-evade-c-2` | Kitewing Guard | Guarda Asa-de-Pipa | Champion | Evasion | `buff_support` | 12 |
| `sk-wind-evade-c-3` | Mirage Sidestep | Esquiva de Miragem | Champion | Evasion | `utility` | 15 |
| `sk-wind-skirm-c-1` | Draftline Slash | Talho da Linha de Arrasto | Champion | Skirmisher | `primary_attack` | 16 |
| `sk-wind-skirm-c-2` | Leeward Harrier | Fustigador de Sotavento | Champion | Skirmisher | `sustain_dot` | 12 |
| `sk-wind-skirm-c-3` | Sidegust Rake | Raspão de Rajada Lateral | Champion | Skirmisher | `control` | 12 |
| `sk-wind-speed-c-1` | Rapidsprint Jab | Jab da Corrida Rápida | Champion | Speedster | `primary_attack` | 16 |
| `sk-wind-speed-c-2` | Squall Relay | Revezamento de Borrasca | Champion | Speedster | `buff_support` | 12 |
| `sk-wind-speed-c-3` | Headwind Overtake | Ultrapassagem no Vento Contra | Champion | Speedster | `identity_finisher` | 16 |
| `sk-wind-evade-u-1` | Blindside Veil | Véu do Flanco Cego | Ultimate | Evasion | `control` | 14 |
| `sk-wind-evade-u-2` | Gossamer Guard | Guarda de Gaze Aérea | Ultimate | Evasion | `buff_support` | 17 |
| `sk-wind-evade-u-3` | Afterimage Sidestep | Esquiva de Pós-Imagem | Ultimate | Evasion | `utility` | 14 |
| `sk-wind-skirm-u-1` | Jetstream Carve | Entalhe da Corrente de Jato | Ultimate | Skirmisher | `primary_attack` | 24 |
| `sk-wind-skirm-u-2` | Backdraft Harpoon | Arpão de Contracorrente | Ultimate | Skirmisher | `sustain_dot` | 14 |
| `sk-wind-skirm-u-3` | Knife-Wind Pincer | Pinça de Vento-Faca | Ultimate | Skirmisher | `control` | 14 |
| `sk-wind-speed-u-1` | Velocity Lance | Lança de Velocidade | Ultimate | Speedster | `primary_attack` | 24 |
| `sk-wind-speed-u-2` | Tempest Relay | Revezamento da Tempestade | Ultimate | Speedster | `buff_support` | 16 |
| `sk-wind-speed-u-3` | Cyclone Overtake | Ultrapassagem Ciclônica | Ultimate | Speedster | `identity_finisher` | 24 |
| `sk-wind-evade-m-1` | Phantom Veil Cut | Corte do Véu Fantasma | Mega | Evasion | `control` | 26 |
| `sk-wind-evade-m-2` | Zephyrglass Guard | Guarda de Vidro-Zéfiro | Mega | Evasion | `buff_support` | 24 |
| `sk-wind-evade-m-3` | Vanishing Horizon Step ⭐ | Passo do Horizonte Sumido | Mega | Evasion | `utility` | 32 |
| `sk-wind-skirm-m-1` | Stratosphere Skewer | Espeto da Estratosfera | Mega | Skirmisher | `primary_attack` | 26 |
| `sk-wind-skirm-m-2` | Horizon Harrier | Fustigador do Horizonte | Mega | Skirmisher | `sustain_dot` | 22 |
| `sk-wind-skirm-m-3` | Apex Gale Pincer ⭐ | Pinça do Vendaval Ápice | Mega | Skirmisher | `control` | 34 |
| `sk-wind-speed-m-1` | Supersonic Lance | Lança Supersônica | Mega | Speedster | `primary_attack` | 28 |
| `sk-wind-speed-m-2` | Jetstream Relay | Revezamento da Corrente de Jato | Mega | Speedster | `buff_support` | 24 |
| `sk-wind-speed-m-3` | Machline Overtake ⭐ | Ultrapassagem da Linha Mach | Mega | Speedster | `identity_finisher` | 36 |

### light — Healer / Buffer / Purifier

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-light-buff-r-1` | Radiant Wall | Parede Radiante | Rookie | Buffer | `buff_support` | 8 |
| `sk-light-buff-r-2` | Luminous Strike | Golpe Luminoso | Rookie | Buffer | `primary_attack` | 8 |
| `sk-light-buff-r-3` | Dazzling Flash | Clarão Ofuscante | Rookie | Buffer | `control` | 9 |
| `sk-light-heal-r-1` | Mending Light | Luz Reparadora | Rookie | Healer | `sustain_dot` | 6 |
| `sk-light-heal-r-2` | Soft Glow | Brilho Suave | Rookie | Healer | `buff_support` | 8 |
| `sk-light-heal-r-3` | Rescue Beacon | Farol de Resgate | Rookie | Healer | `utility` | 7 |
| `sk-light-purify-r-1` | Cleansing Beam | Feixe Purificador | Rookie | Purifier | `primary_attack` | 9 |
| `sk-light-purify-r-2` | Holy Wash | Banho Sagrado | Rookie | Purifier | `utility` | 8 |
| `sk-light-purify-r-3` | Sun Smite | Golpe do Sol | Rookie | Purifier | `identity_finisher` | 10 |
| `sk-light-buff-c-1` | Shining Barrier | Barreira Brilhante | Champion | Buffer | `buff_support` | 14 |
| `sk-light-buff-c-2` | Brilliant Strike | Golpe Brilhante | Champion | Buffer | `primary_attack` | 14 |
| `sk-light-buff-c-3` | Blinding Flash | Clarão Cegante | Champion | Buffer | `control` | 15 |
| `sk-light-heal-c-1` | Restoring Light | Luz Restauradora | Champion | Healer | `sustain_dot` | 12 |
| `sk-light-heal-c-2` | Warm Radiance | Radiância Quente | Champion | Healer | `buff_support` | 14 |
| `sk-light-heal-c-3` | Savior's Beacon | Farol do Salvador | Champion | Healer | `utility` | 13 |
| `sk-light-purify-c-1` | Expelling Beam | Feixe Expulsor | Champion | Purifier | `primary_attack` | 15 |
| `sk-light-purify-c-2` | Sacred Wash | Banho Divino | Champion | Purifier | `utility` | 13 |
| `sk-light-purify-c-3` | Solar Smite | Golpe Solar | Champion | Purifier | `identity_finisher` | 16 |
| `sk-light-buff-u-1` | Aegis of Light | Égide de Luz | Ultimate | Buffer | `buff_support` | 22 |
| `sk-light-buff-u-2` | Glorious Strike | Golpe Glorioso | Ultimate | Buffer | `primary_attack` | 22 |
| `sk-light-buff-u-3` | Searing Flash | Clarão Cauterizante | Ultimate | Buffer | `control` | 20 |
| `sk-light-heal-u-1` | Renewing Light | Luz Renovadora | Ultimate | Healer | `sustain_dot` | 18 |
| `sk-light-heal-u-2` | Heavenly Radiance | Radiância Celestial | Ultimate | Healer | `buff_support` | 20 |
| `sk-light-heal-u-3` | Guardian's Beacon | Farol do Guardião | Ultimate | Healer | `utility` | 18 |
| `sk-light-purify-u-1` | Banishing Beam | Feixe Banidor | Ultimate | Purifier | `primary_attack` | 24 |
| `sk-light-purify-u-2` | Divine Wash | Banho Celestial | Ultimate | Purifier | `utility` | 20 |
| `sk-light-purify-u-3` | Astral Smite | Golpe Astral | Ultimate | Purifier | `identity_finisher` | 24 |
| `sk-light-buff-m-1` | Bastion of Light ⭐ | Bastião de Luz | Mega | Buffer | `buff_support` | 34 |
| `sk-light-buff-m-2` | Transcendent Strike | Golpe Transcendente | Mega | Buffer | `primary_attack` | 32 |
| `sk-light-buff-m-3` | Supernova Flash | Clarão de Supernova | Mega | Buffer | `control` | 28 |
| `sk-light-heal-m-1` | Eternal Light | Luz Eterna | Mega | Healer | `sustain_dot` | 28 |
| `sk-light-heal-m-2` | Sovereign Radiance | Radiância Soberana | Mega | Healer | `buff_support` | 30 |
| `sk-light-heal-m-3` | Seraph's Beacon ⭐ | Farol do Serafim | Mega | Healer | `utility` | 32 |
| `sk-light-purify-m-1` | Eradicating Beam | Feixe Erradicador | Mega | Purifier | `primary_attack` | 36 |
| `sk-light-purify-m-2` | Ultimate Wash | Banho Definitivo | Mega | Purifier | `utility` | 30 |
| `sk-light-purify-m-3` | Genesis Smite ⭐ | Golpe da Gênese | Mega | Purifier | `identity_finisher` | 40 |

### dark — Assassin / Debuffer / Drain

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-dark-assassin-r-1` | Night Shank | Estocada Noturna | Rookie | Assassin | `primary_attack` | 7 |
| `sk-dark-assassin-r-2` | Silent Step | Passo Silencioso | Rookie | Assassin | `buff_support` | 8 |
| `sk-dark-assassin-r-3` | Throat Slit | Corte na Garganta | Rookie | Assassin | `identity_finisher` | 10 |
| `sk-dark-debuff-r-1` | Gloom Hex | Feitiço da Penumbra | Rookie | Debuffer | `control` | 8 |
| `sk-dark-debuff-r-2` | Erosive Aura | Aura Erosiva | Rookie | Debuffer | `utility` | 9 |
| `sk-dark-debuff-r-3` | Dimming Light | Luz Ofuscante | Rookie | Debuffer | `primary_attack` | 7 |
| `sk-dark-drain-r-1` | Soul Sip | Gole de Alma | Rookie | Drain | `sustain_dot` | 8 |
| `sk-dark-drain-r-2` | Vampiric Bite | Mordida Vampírica | Rookie | Drain | `primary_attack` | 9 |
| `sk-dark-drain-r-3` | Vitality Theft | Roubo de Vitalidade | Rookie | Drain | `utility` | 10 |
| `sk-dark-assassin-c-1` | Midnight Piercer | Perfurador da Meia-Noite | Champion | Assassin | `primary_attack` | 12 |
| `sk-dark-assassin-c-2` | Shadow Meld | Fusão Sombria | Champion | Assassin | `buff_support` | 13 |
| `sk-dark-assassin-c-3` | Fatal Ambush | Emboscada Fatal | Champion | Assassin | `identity_finisher` | 15 |
| `sk-dark-debuff-c-1` | Abyssal Shackles | Grilhões Abissais | Champion | Debuffer | `control` | 13 |
| `sk-dark-debuff-c-2` | Spell Breaker | Quebrador de Feitiços | Champion | Debuffer | `utility` | 14 |
| `sk-dark-debuff-c-3` | Suffocating Veil | Véu Sufocante | Champion | Debuffer | `utility` | 15 |
| `sk-dark-drain-c-1` | Essence Drain | Dreno de Essência | Champion | Drain | `sustain_dot` | 14 |
| `sk-dark-drain-c-2` | Blood Hex | Feitiço de Sangue | Champion | Drain | `primary_attack` | 13 |
| `sk-dark-drain-c-3` | Parasitic Link | Elo Parasitário | Champion | Drain | `utility` | 15 |
| `sk-dark-assassin-u-1` | Eclipse Dagger | Adaga do Eclipse | Ultimate | Assassin | `primary_attack` | 15 |
| `sk-dark-assassin-u-2` | Unseen Terror | Terror Invisível | Ultimate | Assassin | `utility` | 16 |
| `sk-dark-assassin-u-3` | Guillotine Drop | Queda da Guilhotina | Ultimate | Assassin | `identity_finisher` | 20 |
| `sk-dark-debuff-u-1` | Total Eclipse | Eclipse Total | Ultimate | Debuffer | `control` | 18 |
| `sk-dark-debuff-u-2` | Sensory Deprivation | Privação Sensorial | Ultimate | Debuffer | `utility` | 16 |
| `sk-dark-debuff-u-3` | Purge Hope | Expurgar a Esperança | Ultimate | Debuffer | `utility` | 20 |
| `sk-dark-drain-u-1` | Life Syphon | Sifão de Vida | Ultimate | Drain | `sustain_dot` | 18 |
| `sk-dark-drain-u-2` | Devour Spirit | Devorar Espírito | Ultimate | Drain | `primary_attack` | 19 |
| `sk-dark-drain-u-3` | Crimson Feast | Banquete Carmesim | Ultimate | Drain | `buff_support` | 20 |
| `sk-dark-assassin-m-1` | Void Ripper | Estripador do Vazio | Mega | Assassin | `primary_attack` | 24 |
| `sk-dark-assassin-m-2` | Time Assassination | Assassinato Temporal | Mega | Assassin | `control` | 28 |
| `sk-dark-assassin-m-3` | Reapers Toll ⭐ | Pedágio do Ceifador | Mega | Assassin | `identity_finisher` | 35 |
| `sk-dark-debuff-m-1` | Event Horizon ⭐ | Horizonte de Eventos | Mega | Debuffer | `control` | 35 |
| `sk-dark-debuff-m-2` | Absolute Despair | Desespero Absoluto | Mega | Debuffer | `utility` | 28 |
| `sk-dark-debuff-m-3` | Void Stare | Olhar do Vazio | Mega | Debuffer | `sustain_dot` | 26 |
| `sk-dark-drain-m-1` | Soul Devourer ⭐ | Devorador de Almas | Mega | Drain | `sustain_dot` | 35 |
| `sk-dark-drain-m-2` | Blood Moon | Lua de Sangue | Mega | Drain | `identity_finisher` | 30 |
| `sk-dark-drain-m-3` | Eternal Thirst | Sede Eterna | Mega | Drain | `buff_support` | 32 |

### null — Adaptive / Trickster / Wildcard / Disruptor

| id | Name | Nome (pt-BR) | Stage | Archetype | `slot_role` | EN |
| -- | ---- | ------------ | ----- | --------- | ----------- | -- |
| `sk-null-adapt-r-1` | Blank Read | Leitura em Branco | Rookie | Adaptive | `primary_attack` | 8 |
| `sk-null-adapt-r-2` | Mutable Guard | Guarda Mutável | Rookie | Adaptive | `buff_support` | 7 |
| `sk-null-adapt-r-3` | Error Correction | Correção de Erro | Rookie | Adaptive | `utility` | 7 |
| `sk-null-disrupt-r-1` | Quiet Tax | Taxa Silenciosa | Rookie | Disruptor | `control` | 8 |
| `sk-null-disrupt-r-2` | Reserve Glitch | Falha de Reserva | Rookie | Disruptor | `buff_support` | 7 |
| `sk-null-trick-r-1` | False Tell | Pista Falsa | Rookie | Trickster | `control` | 8 |
| `sk-null-trick-r-2` | Borrowed Jab | Estocada Emprestada | Rookie | Trickster | `primary_attack` | 9 |
| `sk-null-wild-r-1` | Lucky Static | Estática Sortuda | Rookie | Wildcard | `sustain_dot` | 8 |
| `sk-null-wild-r-2` | Coinflip Null | Nulo Cara ou Coroa | Rookie | Wildcard | `identity_finisher` | 10 |
| `sk-null-adapt-c-1` | Context Pierce | Perfuração de Contexto | Champion | Adaptive | `primary_attack` | 13 |
| `sk-null-adapt-c-2` | Null Recalibration | Recalibração Nula | Champion | Adaptive | `buff_support` | 14 |
| `sk-null-disrupt-c-1` | Permission Denied | Permissão Negada | Champion | Disruptor | `control` | 14 |
| `sk-null-disrupt-c-2` | Turn Ledger | Livro de Turnos | Champion | Disruptor | `buff_support` | 13 |
| `sk-null-trick-c-1` | Mirror Lie | Mentira Espelhada | Champion | Trickster | `control` | 13 |
| `sk-null-trick-c-2` | Pocket Theft | Furto de Bolso | Champion | Trickster | `primary_attack` | 14 |
| `sk-null-trick-c-3` | Stage Swap | Troca de Palco | Champion | Trickster | `utility` | 12 |
| `sk-null-wild-c-1` | Roulette Scar | Cicatriz de Roleta | Champion | Wildcard | `sustain_dot` | 13 |
| `sk-null-wild-c-2` | Loaded Outcome | Resultado Viciado | Champion | Wildcard | `identity_finisher` | 16 |
| `sk-null-adapt-u-1` | Situation Blade | Lâmina Situacional | Ultimate | Adaptive | `primary_attack` | 18 |
| `sk-null-adapt-u-2` | Board Reset | Reinício do Tabuleiro | Ultimate | Adaptive | `utility` | 17 |
| `sk-null-disrupt-u-1` | Rule Lock | Trava de Regra | Ultimate | Disruptor | `control` | 20 |
| `sk-null-disrupt-u-2` | Null Battery | Bateria Nula | Ultimate | Disruptor | `buff_support` | 18 |
| `sk-null-trick-u-1` | Contradiction Hex | Feitiço de Contradição | Ultimate | Trickster | `control` | 18 |
| `sk-null-trick-u-2` | Unmake Costume | Desfazer Fantasia | Ultimate | Trickster | `utility` | 17 |
| `sk-null-wild-u-1` | Chaos Dividend | Dividendo do Caos | Ultimate | Wildcard | `sustain_dot` | 18 |
| `sk-null-wild-u-2` | Paradox Prize | Prêmio Paradoxal | Ultimate | Wildcard | `identity_finisher` | 22 |
| `sk-null-wild-u-3` | Stray Singularity | Singularidade Errante | Ultimate | Wildcard | `primary_attack` | 20 |
| `sk-null-adapt-m-1` | Perfect Counterform | Contraforma Perfeita | Mega | Adaptive | `primary_attack` | 28 |
| `sk-null-adapt-m-2` | Answer Engine ⭐ | Motor de Respostas | Mega | Adaptive | `buff_support` | 30 |
| `sk-null-disrupt-m-1` | Protocol Erasure | Apagamento de Protocolo | Mega | Disruptor | `control` | 30 |
| `sk-null-disrupt-m-2` | Turn Bankruptcy | Falência de Turnos | Mega | Disruptor | `primary_attack` | 32 |
| `sk-null-disrupt-m-3` | Law of Nothing ⭐ | Lei do Nada | Mega | Disruptor | `identity_finisher` | 38 |
| `sk-null-trick-m-1` | Grand Misdirection | Grande Despiste | Mega | Trickster | `control` | 28 |
| `sk-null-trick-m-2` | Crownless Rewrite ⭐ | Reescrita Sem Coroa | Mega | Trickster | `utility` | 32 |
| `sk-null-wild-m-1` | Improbable Storm | Tempestade Improvável | Mega | Wildcard | `sustain_dot` | 28 |
| `sk-null-wild-m-2` | Zero Jackpot ⭐ | Prêmio Zero | Mega | Wildcard | `identity_finisher` | 36 |
---

## Signatures — 868 skills

A signature is a Digimon's own famous attack rather than a shared element-pool
skill. It carries `signature: true` plus an `owner_template_id`, so
`SQL_SELECT_POOL_BY_ELEMENT` in `pool.ts` filters it out of the learnable pool
and only `getSignatureSkillsForTemplate()` serves it.

Names come from the wikimon technique lists embedded in
`backend/data/catalog/digimons.xml`. Where the source offered only generic
move-pool filler (`Overdrive`, `Rampage`, tiered ` I`/` II`/` III` entries), an
original attack was authored to fit the species instead.

Where an English name collides with another skill — `skills_catalog.name` is
UNIQUE and the source material genuinely reuses attack names across Digimon —
the English name carries the owner in parentheses. `name_pt` stays clean,
because that is the field the UI renders.

### fire — 190 signatures across 95 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Agumon | `skb-50` | Rookie | Pepper Breath | Cross Fight |
| Agumon (Black) | `skb-143` | Rookie | Spitfire Blast | Spitfire |
| Agunimon | `skb-676` | Rookie | Fire Darts | Crimson Knuckle |
| Aldamon | `skb-669` | Rookie | Atomic Inferno | Alda Solar Axe |
| Biyomon | `skb-307` | Rookie | Spiral Twister | Dash Tsuibami |
| BurningGreymon | `skb-679` | Rookie | Corona Blaster (BurningGreymon) | Pyro Punch (BurningGreymon) |
| Chuumon | `skb-20` | Rookie | Cheese Bomb | Gashigashi |
| Coronamon | `skb-136` | Rookie | Corona Flame | Holy Shoot (Coronamon) |
| Dracomon | `skb-208` | Rookie | Baby Breath | G Shurunen |
| EmperorGreymon | `skb-677` | Rookie | Firedrake Strike | Pyro Dragons |
| Flamedramon | `skb-716` | Rookie | Flaming Fist | Flame Shot |
| Gabumon | `skb-151` | Rookie | Blue Blaster | Tsuno Kougeki |
| Goblimon | `skb-111` | Rookie | Goblin Strike | Living Shield |
| Guilmon | `skb-90` | Rookie | Rock Breaker | Fireball |
| Kotemon | `skb-219` | Rookie | Hothead | Ryūsei-giri |
| Shoutmon | `skb-682` | Rookie | Rock Soul | Rowdy Rocker |
| Bakemon | `skb-13` | Champion | Nightmare Wave | Poison Breath |
| Birdramon | `skb-308` | Champion | Meteor Wing | Mach Glide |
| Blimpmon | `skb-463` | Champion | Zeppelin Explosion | Helium Bomb |
| Coredramon (Blue) | `skb-218` | Champion | Blue Flare Breath | Strike Bomber |
| Coredramon (Green) | `skb-209` | Champion | Green Flare Breath | G Shurunen-II |
| Cyclonemon | `skb-452` | Champion | Hyper Heat | Cyclone Heat Claw |
| Firamon | `skb-137` | Champion | Flame Dive | Fira Bomb |
| Garurumon | `skb-12` | Champion | Fox Fire | Garuru Thrust |
| GeoGreymon | `skb-54` | Champion | Mega Burst | Horn Impulse |
| Geremon | `skb-729` | Champion | Polka-dots | Unchi (Geremon) |
| Golemon | `skb-5` | Champion | Guardian Bomb | Powerful Punch |
| Greymon | `skb-326` | Champion | Mega Flame | Tail Whip (Greymon) |
| Greymon (Blue) | `skb-712` | Champion | Bit Fire | Fire Horn |
| Growlmon | `skb-78` | Champion | Exhaust Flame | Dino Kick |
| Guardromon | `skb-341` | Champion | Homing Laser | Destruction Grenade (Guardromon) |
| Guardromon (Gold) | `skb-760` | Champion | Destruction Grenade (Guardromon (Gold)) | Golden Grenade Salvo |
| Kiwimon | `skb-610` | Champion | Pummel Peck | Blast Shot |
| Kyubimon | `skb-395` | Champion | Fox Tail Inferno | Koenryū |
| Meramon | `skb-10` | Champion | Burning Fist | Heat Wave (Meramon) |
| Monochromon | `skb-369` | Champion | Volcanic Strike | Tomahawk Slash |
| Nanimon | `skb-375` | Champion | Unchi Kougeki | Oyaji Punch |
| Numemon | `skb-70` | Champion | Choukyori Unchi Nage | Renzoku Unchi Nage |
| Octomon | `skb-240` | Champion | Pēnmò | Mòshuǐ Píngzhàng |
| PlatinumSukamon | `skb-752` | Champion | Trance Mesmer | Metallic Guard |
| Raremon | `skb-590` | Champion | Rotten Tackle | Metal Gas |
| ShellNumemon | `skb-455` | Champion | Jukusei Unchi | Tai Atari (ShellNumemon) |
| Strikedramon | `skb-16` | Champion | Fang Strike | Strike Fang Ignition |
| Sukamon | `skb-313` | Champion | Unchi Paradise | Kuuchuu Unchi Paradise |
| Tankmon | `skb-621` | Champion | Hyper Cannon | Napalm Tread |
| Tyrannomon | `skb-363` | Champion | Fire Breath | Wild Buster |
| Veedramon | `skb-397` | Champion | V-Nova Blast | Cutter Shoot |
| BigMamemon | `skb-28` | Ultimate | Big Smiley Bomber | Smiley Fuse |
| Butenmon | `skb-575` | Ultimate | Sunburst Dance | Crow Sun Talon |
| CatchMamemon | `skb-44` | Ultimate | Catcher Bomb | Magnet Mitt Crush |
| Datamon | `skb-576` | Ultimate | Digital Bomb | Error Flame Trap |
| Etemon | `skb-311` | Ultimate | Monkick | Dark Musical |
| Flaremon | `skb-138` | Ultimate | Crimson Wave of the Beast King | Solar Lion Knuckle |
| Garbagemon | `skb-380` | Ultimate | Dirty Saucer | Trash Furnace |
| Garudamon | `skb-309` | Ultimate | Shadow Wing | Phoenix Talon |
| Gigadramon | `skb-402` | Ultimate | Eradication Gears | Giga Heat Gear |
| HippoGryphonmon | `skb-82` | Ultimate | Heat Wave (HippoGryphonmon) | Thermal Pinion |
| Kimeramon | `skb-229` | Ultimate | Heat Viper | Composite Flame Claw |
| Mamemon | `skb-412` | Ultimate | Smiley Bomb | Buster Dive |
| Megadramon | `skb-301` | Ultimate | Eradication Attack | Dread Wing Napalm |
| MetalGreymon | `skb-302` | Ultimate | Giga Destroyer | Metal Arm |
| Mistymon | `skb-602` | Ultimate | Blast Fire | Runic Flame Guard |
| Mummymon | `skb-226` | Ultimate | Necro Powder Shot | Sarcophagus Flare |
| OmniShoutmon | `skb-683` | Ultimate | Hard Rock Soul | Flame Cannon |
| Phantomon | `skb-584` | Ultimate | Diabolic Star | Reaper Lantern |
| Piximon | `skb-410` | Ultimate | Pit Bomb | Pic Trick |
| RizeGreymon | `skb-71` | Ultimate | Trident Revolver | Rising Revolver Flare |
| SkullGreymon | `skb-404` | Ultimate | Oblivion Bird | Bonefire Missile |
| SkullMeramon | `skb-406` | Ultimate | Heavy Metal Fire | Molten Chain Knuckle |
| Tankdramon | `skb-770` | Ultimate | Striver Cannon | Siege Barrel Ignition |
| WarGrowlmon | `skb-134` | Ultimate | Atomic Blaster | Atomic Knuckle |
| Wingdramon | `skb-210` | Ultimate | Blaze Sonic Breath | Sonic Ember Dive |
| Apollomon | `skb-173` | Mega | Sol Blaster | Phoebus Blow |
| Chronomon DM | `skb-46` | Mega | Holy Flare (Chronomon DM) | Chrono Devolution |
| Chronomon HM | `skb-45` | Mega | Holy Flare (Chronomon HM) | Chronos Crop |
| Creepymon | `skb-38` | Mega | Flame Inferno | Hammer Knuckle |
| Dynasmon | `skb-738` | Mega | Wyvern's Breath | Dragon Collider |
| Ebemon | `skb-451` | Mega | Planet Destroyer | Orbital Logic Burn |
| Gaiomon | `skb-744` | Mega | Will-O'-Wisp Slash | Phosphorus Fire Attack |
| Gankoomon | `skb-688` | Mega | Quake! Blast! Fire! Father! | End Waltz |
| Kentaurosmon | `skb-86` | Mega | Bifrost | Odin's Breath |
| KingEtemon | `skb-127` | Mega | Royal Gold Mic | Banana Peel Bonfire |
| MaloMyotismon | `skb-233` | Mega | Pandemonium Flame | Crimson Mist |
| Marsmon | `skb-174` | Mega | Corona Sanctions | Endless Surge |
| MedievalGallantmon | `skb-603` | Mega | Rage of Wyvern | Final Crest |
| MegaGargomon | `skb-741` | Mega | Burst Shot | Giant Missile |
| Megidramon | `skb-47` | Mega | Megiddo Flame | Hell Howling |
| MetalEtemon | `skb-312` | Mega | Heavy Monkick | Mega Punch |
| PileVolcanomon | `skb-60` | Mega | Volcanic Driver | Diamond Fist |
| PlatinumNumemon | `skb-69` | Mega | Sugoku Iya de Dekkai Shita | Platinum Burp |
| Puppetmon | `skb-428` | Mega | Puppet Pummel | Wood Cross |
| Slayerdramon | `skb-213` | Mega | Tenryu Slash | Shoryu Slash |
| TyrantKabuterimon | `skb-128` | Mega | Shine of Bee | Tyrant Horn Tinder |
| WarGreymon | `skb-27` | Mega | Terra Force | Great Tornado |
| Poyomon | `skb-320` | Baby | Acid Bubbles (Poyomon) | Awa (Poyomon) |

### steel — 104 signatures across 52 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Dorimon | `skb-466` | In-Training | Metal Drop | Iron Pebble Pounce |
| Digmon | `skb-144` | Rookie | Gold Rush | Drill Tunnel Break |
| Dorumon | `skb-112` | Rookie | Metal Cannon | Metal Shoot |
| Falcomon | `skb-705` | Rookie | Ninja Blade | Hidden Kunai Ambush |
| Hyokomon | `skb-573` | Rookie | Downward Cleave | Chick Blade Flurry |
| KendoGarurumon | `skb-681` | Rookie | Speed Star (KendoGarurumon) | Militant Angriff |
| MagnaGarurumon | `skb-678` | Rookie | Machinegun Destroyer | Starburst Railguns |
| Ryudamon | `skb-190` | Rookie | Iai Blade | Tera Burst |
| Shurimon | `skb-142` | Rookie | Double Stars | Nouten Saka Otoshi |
| Zubamon | `skb-697` | Rookie | Twenty Dive | Twenty Edge Guard |
| Buraimon | `skb-574` | Champion | Dual Swallow Reversal | Twin Tsubame Cut |
| Dinohyumon | `skb-474` | Champion | Lizard Dance | Dino Slash (Dinohyumon) |
| Dorugamon | `skb-396` | Champion | Power Metal | Chrome Fang Rush |
| Gargomon | `skb-710` | Champion | Dumdum Uppercut | Arm Cannon Barrage |
| Ginryumon | `skb-191` | Champion | Metal Armor Blade | Silver Scale Guard |
| Musyamon | `skb-220` | Champion | Kirisute Gomen | Shiratori-maru |
| Peckmon | `skb-702` | Champion | Kunai Wing | Burning Spiral |
| Raptordramon | `skb-25` | Champion | Ambush Crunch | Dino Slash (Raptordramon) |
| Reppamon | `skb-77` | Champion | Rolling Tackle | Kuda-Gitsune Fang |
| Turuiemon | `skb-102` | Champion | Gauntlet Claw | Iron Rabbit Rush |
| ZubaEagermon | `skb-698` | Champion | Vantheon | Focus Strike (ZubaEagermon) |
| Aegiochusmon: Blue | `skb-187` | Ultimate | Powered Ignition | Penetra-Laser |
| Divermon | `skb-606` | Ultimate | Strike Fishing | Anchor Net |
| DoruGreymon | `skb-407` | Ultimate | Metal Meteor | Chrome Wing Crash |
| Duramon | `skb-699` | Ultimate | Blinded | Gold Edge Rend |
| Grademon | `skb-26` | Ultimate | Cross Blade | Golden Blade Oath |
| Hisyaryumon | `skb-192` | Ultimate | Legendary Dragon Blade | Dragon Scale Break |
| Knightmon | `skb-718` | Ultimate | Berserk Sword | Checkmate Break |
| LoaderLeomon | `skb-479` | Ultimate | Bowling Storm | Loader Jaw Press |
| Locomon | `skb-198` | Ultimate | Wheel Grinder | Rail Cannon Burst |
| MasterBlimpmon | `skb-465` | Ultimate | Daredevil Break | Bomb Bay Crash |
| MetalGreymon (Blue) | `skb-327` | Ultimate | Trident Arm | Blue Giga Blaster |
| Orochimon | `skb-149` | Ultimate | Ame no Murakumo | Spirytus Breath |
| Sharkmon | `skb-907` | Ultimate | All-Out Bombardment | Torpedo Jaw Raid |
| AvengeKidmon | `skb-617` | Mega | Destruction Trigger | Misery Bullet Rain |
| Beelzemon | `skb-35` | Mega | Double Impact | Darkness Claw |
| Boltmon | `skb-431` | Mega | Tomahawk Stinger | Frankenstein Crush |
| Breakdramon | `skb-214` | Mega | Destroyed Rush | Infinity Bowling |
| Callismon | `skb-492` | Mega | Rodeo Bullet | Deep Forest |
| Craniamon | `skb-734` | Mega | Waltz's End | Claíomh Solais |
| Dorugoramon | `skb-19` | Mega | Brave Metal | DORU-Din |
| Durandamon | `skb-700` | Mega | Zwei Glänze | Thron Messer |
| Eaglemon | `skb-197` | Mega | Kaiser Phoenix | Mystic Break |
| Gundramon | `skb-194` | Mega | Gewalt Schwärmer | Der Blitz |
| MagnaKidmon | `skb-616` | Mega | Happy Bullet Showering | Bind Red Trigger |
| Minervamon | `skb-747` | Mega | Strike Roll | Madness Merry-Go-Round |
| Pukumon | `skb-196` | Mega | Needle Squall | Toxic Spine Burst |
| SlashAngemon | `skb-614` | Mega | Golden Ripper | Blade of the True |
| Vulcanusmon | `skb-178` | Mega | Appropriate Works | Pinpoint Weapon Works |
| Zanbamon | `skb-225` | Mega | Vorpal Blade | Mystic Flame |
| Choromon | `skb-241` | Baby | Jamming Powder | Focus Strike (Choromon) |
| Dodomon | `skb-316` | Baby | Little Iron Beads | Focus Strike (Dodomon) |

### dark — 94 signatures across 47 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Pagumon | `skb-567` | In-Training | Poison Bubbles | San no Awa (Pagumon) |
| Tsumemon | `skb-631` | In-Training | Nail Scratch | Clinging Malware |
| DemiDevimon | `skb-97` | Rookie | Demi Darts | PicoDevi Claw |
| Dracmon | `skb-457` | Rookie | Eye of Nightmares | Bat Moon Ruse |
| Hagurumon | `skb-9` | Rookie | Cog Crusher | Haguru Attack |
| Keramon | `skb-626` | Rookie | Crazy Giggle | Dark Crusher |
| Tapirmon | `skb-231` | Rookie | Nightmare Syndrome (Tapirmon) | Virus Delete |
| BlackGatomon | `skb-43` | Champion | Lightning Paw (BlackGatomon) | Cat's Eye |
| Devimon | `skb-93` | Champion | Death Claw | Deadly Nail |
| Kurisarimon | `skb-630` | Champion | Data Crusher | Chrysalid Ambush |
| Ogremon | `skb-394` | Champion | Pummel Whack | Strong Maul |
| Sangloupmon | `skb-30` | Champion | Sticker Blade | Drain Slash (Sangloupmon) |
| Snimon | `skb-597` | Champion | Shadow Sickle | Shadow Slash |
| Aegiochusmon: Dark | `skb-185` | Ultimate | Triangler | Plasmadness |
| Astamon | `skb-237` | Ultimate | Mad Dog Fire (Astamon) | Maverick Requiem |
| Cerberusmon | `skb-223` | Ultimate | Mad Dog Fire (Cerberusmon) | Inferno Divide (Cerberusmon) |
| Cerberusmon WM | `skb-224` | Ultimate | Inferno Divide (Cerberusmon WM) | Mad Dog Fire (Cerberusmon WM) |
| DarkSuperStarmon | `skb-217` | Ultimate | Dark Explosion | Black Star Blackout |
| Digitamamon | `skb-374` | Ultimate | Nightmare Syndrome (Digitamamon) | Swing Egg |
| Enbarrmon | `skb-920` | Ultimate | Dead Angle Horn | Night Mare Trample |
| Infermon | `skb-627` | Ultimate | Spider Shooter | Virus Skater |
| LadyDevimon | `skb-107` | Ultimate | Darkness Wave | Darkness Spear |
| Lucemon CM | `skb-39` | Ultimate | Dead or Alive | Paradise Lost |
| Matadormon | `skb-31` | Ultimate | Earth-Shattering Stomp | Thousand Arrow |
| Myotismon | `skb-85` | Ultimate | Night Raid | Cloud Minion |
| SkullSatamon | `skb-6` | Ultimate | Nail Bone | Bone Nail Crucifix |
| Taomon | `skb-405` | Ultimate | Talisman of Light | Trinity Burst |
| Vademon | `skb-411` | Ultimate | Unidentified Flying Kiss | Mutilate |
| WaruSeadramon | `skb-133` | Ultimate | Darkstrom | Variable Wave |
| Barbamon | `skb-36` | Mega | Pandemonium Lost | Jigoku no Kaen |
| BeelStarmon | `skb-195` | Mega | Fly Bullet | Hurricane Screw Shot |
| BlackWarGreymon | `skb-175` | Mega | Dark Terra Force | Black Tornado |
| ChaosGallantmon | `skb-150` | Mega | Demonic Disaster | Judecca Prison |
| Cherubimon (Black) | `skb-774` | Mega | Lightning Spear (Cherubimon Black) | Heaven's Judgment (Cherubimon Black) |
| Darkdramon | `skb-771` | Mega | Dark Roar | Gigastick Lance |
| Diaboromon | `skb-632` | Mega | Catastrophe Cannon | Tentacle Bug |
| Imperialdramon DM | `skb-732` | Mega | Mega Death | Positron Laser (Imperialdramon DM) |
| Junomon | `skb-170` | Mega | Needle Hive | Hera Vengeance |
| Junomon HM | `skb-171` | Mega | Welcome Demise | Chain Lash |
| Kuzuhamon | `skb-754` | Mega | Taizoukai Mandala | Illuminator |
| Lilithmon | `skb-34` | Mega | Phantom Pain | Darkness Love |
| LordKnightmon | `skb-703` | Mega | Spiral Masquerade | Fist of Athena |
| Millenniummon | `skb-230` | Mega | Time Unlimited | Millennium Eclipse |
| Pharaohmon | `skb-227` | Mega | Necromist | Sarcophagus Seal |
| Plutomon | `skb-180` | Mega | Hell's Gate | Haggard Cluster |
| ZombiePlutomon | `skb-912` | Mega | Hell Slicer | Marionette Abomination |
| Kuramon | `skb-629` | Baby | Glare Eye | Blood Eye |

### null — 90 signatures across 45 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Kapurimon | `skb-242` | In-Training | Howling Hertz | Metal Pup Ping |
| Nyaromon | `skb-515` | In-Training | Fox Tail | Kitten Hex Purr |
| Tanemon | `skb-512` | In-Training | Awa (Tanemon) | San no Awa (Tanemon) |
| Tokomon | `skb-325` | In-Training | Bite | San no Awa (Tokomon) |
| Wanyamon | `skb-321` | In-Training | Smile Fang | San no Awa (Wanyamon) |
| Bearmon | `skb-234` | Rookie | Bear Fist | Beast Attack (Bearmon) |
| Calmaramon | `skb-163` | Rookie | Titanic Charge (Calmaramon) | Rain Stream (Calmaramon) |
| FunBeemon | `skb-42` | Rookie | Gear Stinger | Honeycomb Static |
| Gazimon | `skb-569` | Rookie | Electric Stun Blast | Gazimon Claw |
| Gizamon | `skb-594` | Rookie | Spiral Edge | Water Cure |
| Huckmon | `skb-687` | Rookie | Fifth Rush | Baby Flame (Huckmon) |
| Impmon | `skb-81` | Rookie | Summon | Dash Night of Fire |
| Monodramon | `skb-458` | Rookie | Knuckle Beater | Zutsuki Kougeki (Monodramon) |
| Muchomon | `skb-623` | Rookie | Tropical Beak | Mugen Binta |
| Penmon | `skb-622` | Rookie | Super Slap | Ice Prism |
| Shamamon | `skb-577` | Rookie | Shama Hammer | Mad Twist |
| ToyAgumon | `skb-708` | Rookie | Plastic Blaze | Fancy Star |
| Veemon | `skb-114` | Rookie | Veemon Headbutt | Hopping Kick |
| BaoHuckmon | `skb-115` | Champion | Fif Cross | Scale Brand |
| Clockmon | `skb-398` | Champion | Chrono Breaker | Gearhand Thunder |
| Deltamon | `skb-228` | Champion | Triple Forces | Triplex Maw Clamp |
| Ikkakumon | `skb-344` | Champion | Harpoon Torpedo | Horn Attack |
| Tuskmon | `skb-598` | Champion | Slamming Tusk | Horned Landslide |
| Vegiemon | `skb-314` | Champion | Super Stinky Jet | Amai Toiki |
| BlackKingNumemon | `skb-753` | Ultimate | Dark Pupil | Sewer Crown Gloom |
| Cyberdramon | `skb-719` | Ultimate | Desolation Claw | Cyber Talon Rupture |
| Mammothmon | `skb-588` | Ultimate | Tusk Strikes | Permafrost Trample |
| Paildramon | `skb-408` | Ultimate | Death Parade Blaster | Twin Barrel Lock |
| SaviorHuckmon | `skb-116` | Ultimate | Trident Saber | Savior Cross Guard |
| ShogunGekomon | `skb-376` | Ultimate | Musical Fist | Tonosama Jump |
| WereGarurumon | `skb-140` | Ultimate | Wolf Claw | Foxfire |
| Wisemon | `skb-726` | Ultimate | Pandora Dialogue | Archive of Bad Dreams |
| AncientWisemon | `skb-338` | Mega | Laplace's Demon | Elder Sign |
| Bacchusmon | `skb-179` | Mega | Cook of the Abyss | Party of the Heavens |
| Belphemon SM | `skb-439` | Mega | Eternal Nightmare | Lampranthus |
| Jesmon | `skb-749` | Mega | Judgment of the Blade | Un Pour Tous |
| Justimon | `skb-737` | Mega | Justice Kick | Accel Arm Verdict |
| Mastemon | `skb-748` | Mega | Chaos Degradation | Holy Desire |
| Plesiomon | `skb-450` | Mega | Sorrow Blue | Plesiomon Tail |
| PrinceMamemon | `skb-429` | Mega | Smile Warhead | Royal Coin Salute |
| SkullMammothmon | `skb-461` | Mega | Spiral Bone | Grave Tusk Shadow |
| VenomMyotismon | `skb-600` | Mega | Venom Infusion | Inferno |
| Botamon | `skb-317` | Baby | Awa (Botamon) | San no Awa (Botamon) |
| Pabumon | `skb-387` | Baby | Nenchakusei no Awa | Awa (Pabumon) |
| Punimon | `skb-437` | Baby | San no Awa (Punimon) | Awa (Punimon) |

### light — 74 signatures across 37 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Beowolfmon | `skb-670` | Rookie | Zweihänder | Lobo Light Rend |
| Lobomon | `skb-680` | Rookie | Zwei Sieger (Lobomon) | Licht Sieger β |
| Lucemon | `skb-390` | Rookie | Grand Cross | Lucent Pride |
| MagnaGarurumon (Detached) | `skb-675` | Rookie | Starlight Velocity | Garuru Radiant Salvo |
| Magnamon | `skb-382` | Rookie | Shining Gold Solar Storm | Plasma Shot |
| Pegasusmon | `skb-146` | Rookie | Silver Blaze | Shooting Star |
| Salamon | `skb-361` | Rookie | Puppy Howl | Happy Paw |
| Solarmon | `skb-728` | Rookie | Shiny Ring | Shiny Attack |
| Angemon | `skb-87` | Champion | Heaven's Knuckle | Angel Slam |
| Deputymon | `skb-456` | Champion | Justice Bullet | Deputy Starlight Round |
| Gatomon | `skb-92` | Champion | Lightning Paw (Gatomon) | Neko Kick |
| GoldNumemon | `skb-113` | Champion | Goldonara | Golden Sludge Gleam |
| Unimon | `skb-548` | Champion | Holy Shot | Spread Neigh |
| Aegiochusmon: Holy | `skb-186` | Ultimate | Lightning Shower | Aegiomon no Inori |
| Angewomon | `skb-148` | Ultimate | Celestial Arrow | Holy Kick |
| Chirinmon | `skb-84` | Ultimate | Wind Cutter Sword | Kaishin no Hadou |
| MagnaAngemon | `skb-101` | Ultimate | Heaven's Gate | Holy Disinfection |
| Shakkoumon | `skb-723` | Ultimate | Disaster Blaster | Sakimitama |
| SuperStarmon | `skb-79` | Ultimate | Haley Storm | Super Upper |
| Alphamon | `skb-416` | Mega | Blade of the Dragon King | Soul Digitalization |
| BanchoLeomon | `skb-49` | Mega | Flashy Boss Punch | Lion Slash |
| Cherubimon (Good) | `skb-735` | Mega | Heaven's Judgment (Cherubimon Good) | Lightning Spear (Cherubimon Good) |
| ClavisAngemon | `skb-613` | Mega | The Key | Gatekeeper Seal |
| Gallantmon | `skb-126` | Mega | Lightning Joust | Shield of the Just |
| Goldramon | `skb-48` | Mega | God Flame | Gaebang: Sin-ui Him |
| Imperialdramon FM | `skb-419` | Mega | Giga Death | Positron Laser (Imperialdramon FM) |
| Leopardmon | `skb-739` | Mega | Extinction Wave (Leopardmon) | Black Aura Blast |
| Lotosmon | `skb-742` | Mega | Seven's Fantasia | Lotus Mercy Veil |
| Magnadramon | `skb-453` | Mega | Fire Tornado | Hermit Fog |
| MetalSeadramon | `skb-434` | Mega | River of Power | Dragon River Benediction |
| MirageGaogamon | `skb-95` | Mega | Full Moon Blaster | Double Crescent Mirage |
| Ophanimon | `skb-421` | Mega | EDEN's Javelin | Sefirot Crystal |
| Phoenixmon | `skb-310` | Mega | Starlight Explosion | Mach Wing |
| Sakuyamon | `skb-425` | Mega | Amethyst Mandala | Izuna |
| Seraphimon | `skb-315` | Mega | Strike of the Seven Stars | Testament |
| UlforceVeedramon | `skb-417` | Mega | The Ray of Victory | Victory Sword |
| Varodurumon | `skb-117` | Mega | Aurora Undulation | Aurora Feather Guard |

### plant — 72 signatures across 36 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Floramon | `skb-611` | Rookie | Rain of Pollen | Poison Ivy (Floramon) |
| Kudamon | `skb-53` | Rookie | Holy Cartridge | Scroll Wrap |
| Lalamon | `skb-56` | Rookie | Seed Blast | Nuts Gun |
| Mushroomon | `skb-607` | Rookie | Fungus Crusher | Hakai no Kinoko Bakudan |
| Palmon | `skb-348` | Rookie | Root Stretch | Poison Ivy (Palmon) |
| Renamon | `skb-391` | Rookie | Diamond Storm | Tōhakken |
| Wormmon | `skb-392` | Rookie | Sticky Net | Silk Thread Attack |
| Dobermon | `skb-222` | Champion | Grau Lärm | Schwarz Strahl |
| Dokugumon | `skb-592` | Champion | Venom Blast | Poison Sting |
| Flymon | `skb-586` | Champion | Brown Stingers | Toxic Needle |
| Grizzlymon | `skb-235` | Champion | Crescent Dawn | Maul Attack |
| Kuwagamon | `skb-367` | Champion | Scissor Claw | Trap Scissors |
| Stingmon | `skb-91` | Champion | Spiking Strike | Moon Shooter |
| Sunflowmon | `skb-58` | Champion | Sunshine Beam | Sunshine Gun |
| Togemon | `skb-349` | Champion | Needle Spray (Togemon) | Coconuts Punch |
| Woodmon | `skb-393` | Champion | Branch Drain | Drain Buster |
| Aegiochusmon: Green | `skb-188` | Ultimate | Bramble Bite | Plant Zone Cradle |
| Arukenimon | `skb-199` | Ultimate | Spider Thread | Widow Web |
| Cherrymon | `skb-379` | Ultimate | Cherry Bomb | Energy Absorption (Cherrymon) |
| Deramon | `skb-378` | Ultimate | Royal Nuts | Bird Song |
| Dinobeemon | `skb-23` | Ultimate | Hell Masquerade | Savage Dance |
| ExTyrannomon | `skb-1` | Ultimate | Stuffed Crush | Zipper Snag |
| JewelBeemon | `skb-484` | Ultimate | Spike Buster | Emerald Spear |
| Lilamon | `skb-73` | Ultimate | Lila Shower | Lovely Cologne |
| Lillymon | `skb-359` | Ultimate | Flower Cannon | Fairy Vine |
| MegaKabuterimon | `skb-305` | Ultimate | Horn Buster | Horn Cannon |
| Monzaemon | `skb-61` | Ultimate | Silence Hug | Love Song |
| Okuwamon | `skb-401` | Ultimate | Double Scissor Claw | Scissor Storm |
| Pumpkinmon | `skb-596` | Ultimate | Trick or Treat | Surprise |
| Ceresmon | `skb-176` | Mega | Island Freefall (Ceresmon) | Famis (Ceresmon) |
| Ceresmon Medium | `skb-189` | Mega | Famis (Ceresmon Medium) | Island Freefall (Ceresmon Medium) |
| GranKuwagamon | `skb-423` | Mega | Dimension Scissor | Kuáng Zhǎn Zhìcái |
| Jupitermon | `skb-168` | Mega | Wide Plasment | Thunder Verdict |
| MarineAngemon | `skb-24` | Mega | Extra Smile | Ocean Love |
| Rosemon | `skb-57` | Mega | Thorn Whip | Forbidden Temptation |
| Venusmon | `skb-172` | Mega | Peace Fantasia | LOVE YOU |

### electricity — 62 signatures across 31 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Betamon | `skb-389` | Rookie | Electric Shock | Water Tower |
| Elecmon | `skb-564` | Rookie | Sparkling Thunder | Thunder Knife |
| Kokuwamon | `skb-609` | Rookie | Mini Scissor Claw | Elect-Elect |
| Lighdramon | `skb-139` | Rookie | Lightning Blade | Thunderbolt |
| Rapidmon (Armor) | `skb-751` | Rookie | Golden Triangle (Rapidmon Armor) | Miracle Circuit |
| Tentomon | `skb-303` | Rookie | Super Shocker | Katai Tsume |
| Aegiomon | `skb-183` | Champion | Stun Beat Blow | Storm Hoof |
| Centarumon | `skb-372` | Champion | Hunting Cannon | Energy Ray |
| Kabuterimon | `skb-304` | Champion | Electro Shocker | Danger Sting |
| Mekanorimon | `skb-615` | Champion | Twinkle Beam | Pilot Spark Net |
| Waspmon | `skb-454` | Champion | Turbo Stinger | Vespa Voltage |
| Wizardmon | `skb-377` | Champion | Thunder Cloud | Terror Illusion |
| Aegiochusmon | `skb-184` | Ultimate | Bolt Break Knockdown | Lightning Pile |
| Andromon | `skb-342` | Ultimate | Spiral Sword | Gatling Missile Rensha Mode |
| CannonBeemon | `skb-727` | Ultimate | Nitro Stinger | Hive Capacitor |
| MegaSeadramon | `skb-132` | Ultimate | Lightning Javelin (MegaSeadramon) | Abyssal Thunder Coil |
| MetalMamemon | `skb-413` | Ultimate | Energy Bomb | Chrome Capacitor |
| MetalTyrannomon | `skb-364` | Ultimate | Nuclear Laser | Reactor Jaw |
| Parrotmon | `skb-414` | Ultimate | Mjölnir Thunder | Stormwing Cry |
| Rapidmon | `skb-722` | Ultimate | Golden Triangle (Rapidmon) | Gold Radar Lock |
| SkullSeadramon | `skb-908` | Ultimate | Lightning Javelin (SkullSeadramon) | Bone Current |
| Zudomon | `skb-345` | Ultimate | Vulcan's Hammer | Spark Anchor |
| Chaosdramon | `skb-422` | Mega | Hyper Infinity Cannon | Chaos Grid Barrage |
| GroundLocomon | `skb-704` | Mega | Destruction Crush | Railgun Overrun |
| HerculesKabuterimon | `skb-306` | Mega | Giga Blaster | Kyodai Hasami |
| HiAndromon | `skb-426` | Mega | Atomic Ray | Hi-Tension Barrier |
| Machinedramon | `skb-385` | Mega | Infinity Cannon | Mugen Hand |
| Ouryumon | `skb-193` | Mega | Eiseiryuojin | Golden Armor |
| Ravemon | `skb-740` | Mega | Ame no Ohabari | Spiral Raven Claw |
| RustTyrannomon | `skb-383` | Mega | Terrors Cluster | Corrosion Spark |
| TigerVespamon | `skb-745` | Mega | Mach Stinger V | Royal Volt Guard |

### water — 58 signatures across 29 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Koromon | `skb-322` | In-Training | Bubbles | Poyoyon Tackle |
| Motimon | `skb-388` | In-Training | Elastic Bubbles | Shinshukusei no Awa |
| Tsunomon | `skb-438` | In-Training | Acid Bubbles (Tsunomon) | Tackle (Tsunomon) |
| Yokomon | `skb-510` | In-Training | Soap Flower | Petal Foam Drift |
| Crabmon | `skb-103` | Rookie | Scissors Execution | Bubble Claw Trap |
| Gomamon | `skb-343` | Rookie | Marching Fishes | Sharp Edge |
| Kamemon | `skb-52` | Rookie | Pointer Arrow | Koura Guard |
| Lanamon | `skb-162` | Rookie | Rain Stream (Lanamon) | Titanic Charge (Lanamon) |
| Lunamon | `skb-2` | Rookie | Tearing Shot | Lop-ear Ripple |
| Otamamon | `skb-582` | Rookie | Lullaby Bubble | Water Jet (Otamamon) |
| Submarimon | `skb-145` | Rookie | Oxygen Homing | Aqua Vulcan |
| Syakomon | `skb-709` | Rookie | Black Pearl Blast | Water Shot (Syakomon) |
| Coelamon | `skb-130` | Champion | Fossil Bite | Destructive Spear |
| Gawappamon | `skb-51` | Champion | DJ Shooter | Kappa Deck Splash |
| Gekomon | `skb-399` | Champion | Symphony Crusher | Noisy Echo |
| Lekismon | `skb-3` | Champion | Moon Night Bomb | Lunar Foam Snare |
| Shellmon | `skb-368` | Champion | Hydro Blaster | Spin Shelter |
| Brachiomon | `skb-724` | Ultimate | Brachio Bubble | Lagoon Tail Sweep |
| Dragomon | `skb-129` | Ultimate | Forbidden Trident | Abyssal Tithe |
| Scorpiomon | `skb-605` | Ultimate | Stinger Surprise | Reef Venom Barb |
| Shaujinmon | `skb-76` | Ultimate | Kouyoujou: Hydro Descent | Sanzou River Seal |
| Sirenmon | `skb-232` | Ultimate | Symphony No. 3 | Siren Undertow Aria |
| Volcanomon | `skb-59` | Ultimate | Volcano Bass Drop | Boiling Reef Breaker |
| Whamon | `skb-21` | Ultimate | Tidal Wave | Whale Song Current |
| Bacchusmon DM | `skb-767` | Mega | Reversal of the Dead | Hangover Undertow |
| Dianamon | `skb-733` | Mega | Goodnight Moon | Arrow of Artemis |
| JumboGamemon | `skb-98` | Mega | Megaton Hydro Laser | Jumbo Crater |
| Leviamon | `skb-37` | Mega | Biting Crush | Tail Strike |
| Neptunemon | `skb-75` | Mega | Vortex Penetration | Wave of Depth |

### wind — 48 signatures across 24 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Bukamon | `skb-514` | In-Training | Air Bubbles | Shabon no Awa |
| Gaomon | `skb-55` | Rookie | Double Backhand | Gao Rush |
| Halsemon | `skb-141` | Rookie | Tempest Wing | Udjat Gaze |
| Hawkmon | `skb-706` | Rookie | Feather Slash | Loop the Hawk |
| Patamon | `skb-96` | Rookie | Air Shot | Hane Binta |
| Terriermon | `skb-701` | Rookie | Terrier Tornado | Double Typhoon |
| Airdramon | `skb-11` | Champion | Spinning Needle | Wing Cutter |
| Aquilamon | `skb-15` | Champion | Glide Horn | Mach Impulse |
| ExVeemon | `skb-365` | Champion | Vee Laser | Hearty Shatter |
| Fugamon | `skb-579` | Champion | Evil Hurricane | Bone Strike (Fugamon) |
| Gaogamon | `skb-68` | Champion | Spiral Blow (Gaogamon) | Double Claw |
| Wendigomon | `skb-100` | Champion | Howling Destroyer | Cursed Snow Howl |
| Witchmon | `skb-601` | Champion | Baluluna Gale | Broomstick Hex Gust |
| AeroVeedramon | `skb-400` | Ultimate | Dragon Impulse | V-Tempest Saber |
| Antylamon | `skb-731` | Ultimate | Bunny Blades | Data Heubsu |
| Crowmon | `skb-721` | Ultimate | Savage Emperor | Raven Tempest Talons |
| GrapLeomon | `skb-403` | Ultimate | The King of Fists | Lionheart Wind Claw |
| MachGaogamon | `skb-74` | Ultimate | Winning Knuckle | Winning Blow |
| Silphymon | `skb-720` | Ultimate | Top Gun | Twin Spirit Spiral |
| Gryphonmon | `skb-83` | Mega | Supersonic Voice | Gryphon Gale Pounce |
| Merukimon | `skb-80` | Mega | Thousand Fists | Spiritual Enchantment |
| Piedmon | `skb-427` | Mega | Trump Sword | Toy Wonderness |
| SaberLeomon | `skb-424` | Mega | Howling Crusher | Infinity Arrow |
| UltimateBrachiomon | `skb-725` | Mega | Ultimate Blast | Ultimate Quake |

### ice — 40 signatures across 20 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Gabumon (Black) | `skb-713` | Rookie | Little Horn | Black Ice |
| Lopmon | `skb-750` | Rookie | Blazing Ice | Kūchū Blazing Ice |
| SnowGoblimon | `skb-578` | Rookie | Snow Goblin Volt | Snow Gob Konbou |
| Frigimon | `skb-370` | Champion | Sub-Zero Ice Punch | Ice Punch |
| Garurumon (Black) | `skb-714` | Champion | Freeze Fang | Ice Cannon |
| Hyogamon | `skb-580` | Champion | Snow Punch | Ice Konbou |
| IceDevimon | `skb-730` | Champion | Frost Claw | Cold Blood |
| Icemon | `skb-758` | Champion | Iceball Bomb | Ice Strike |
| Mojyamon | `skb-371` | Champion | Icicle Rod | Dancing Punch |
| Seadramon | `skb-347` | Champion | Ice Blast | Chilblains |
| Sorcermon | `skb-755` | Champion | Crystal Cloud | Meteor Squall |
| BlueMeramon | `skb-177` | Ultimate | Cold Flame | Vision Bind |
| Crescemon | `skb-4` | Ultimate | Lunatic Dance | Moonlit Frost Veil |
| IceLeomon | `skb-409` | Ultimate | Fist of Ice | Jūouken |
| WereGarurumon (Black) | `skb-715` | Ultimate | Full Moon Kick | Black Moon Howl |
| GranDracmon | `skb-32` | Mega | Crystal Revolution | Eye of the Gorgon |
| MetalGarurumon | `skb-135` | Mega | Freezing Breath | Ice Wolf Claw (MetalGarurumon) |
| MetalGarurumon (Black) | `skb-182` | Mega | Ice Wolf Claw (MetalGarurumon Black) | Garuru Tomahawk |
| Valkyrimon | `skb-773` | Mega | Fenrir Sword | Aurvandil's Arrow |
| Vikemon | `skb-346` | Mega | Arctic Blizzard | Viking Axe |

### earth — 36 signatures across 18 Digimon

| Digimon | owner | Stage | Signature 1 | Signature 2 |
| ------- | ----- | ----- | ----------- | ----------- |
| Armadillomon | `skb-707` | Rookie | Diamond Shell | Rigid Block |
| Gotsumon | `skb-595` | Rookie | Rock Fist | Hardest Punch |
| Nefertimon | `skb-147` | Rookie | Rosetta Stone | Sanctuary Bind (Nefertimon) |
| Ankylomon | `skb-711` | Champion | Tail Hammer | Rhythmical Knock |
| Drimogemon | `skb-373` | Champion | Drill Spin | Screw Claw |
| Leomon | `skb-72` | Champion | Fist of the Beast King | Hasaigeri |
| Minotarumon | `skb-17` | Champion | Darkside Quake | Labrys Quake |
| MudFrigimon | `skb-759` | Champion | Great Weight | Mud Coat |
| Starmon | `skb-14` | Champion | Meteor Shower | Mind Scan |
| GreatGrizzlymon | `skb-491` | Ultimate | Spirited Claws | Grizzly Maul |
| Groundramon | `skb-211` | Ultimate | Scrapless Claw | Ground Shredder |
| Meteormon | `skb-756` | Ultimate | Galactic Flare | Meteor Core |
| Pandamon | `skb-41` | Ultimate | Animal Nail | Shoudan |
| SkullBaluchimon | `skb-239` | Ultimate | Grave Bone | Ossuary Quake |
| Triceramon | `skb-33` | Ultimate | Tri-Horn Attack | Ceratopsian Charge |
| Leopardmon LM | `skb-743` | Mega | Vulcan Crusher (Leopardmon LM) | Eroberung |
| ShineGreymon | `skb-94` | Mega | GeoGrey Sword | Glorious Burst |
| Titamon | `skb-440` | Mega | Soul Core Attack | Phantom Blade |
---

## Related

- [[Skill Archetypes]] — the design system, balance history and open decisions
- [[Skills catalog]] — the admin-editable catalog, learned-pool carry-forward, XML → DB resolver
- [[Combat]] — how skills resolve in battle
