import type { JSX, ReactNode } from 'react';

/**
 * Per-screen tutorial content. Each `Tutorial` shows automatically the first
 * time a player enters the matching route and can be re-triggered from a help
 * menu later.
 *
 * Content is intentionally content-only — visuals are React nodes so we can
 * inline `<ResourceIcon>`s or short SVG diagrams (see the Battle tutorial
 * `Compatibility` page).
 */

export type TutorialCategory = 'Battle' | 'Town' | 'World' | 'Party' | 'Lobby' | 'Market';

export type TutorialPage = {
  readonly title: string;
  readonly body: ReactNode;
  readonly visual?: ReactNode;
};

export type Tutorial = {
  readonly id: string;
  readonly category: TutorialCategory;
  readonly pages: readonly TutorialPage[];
};

const kw = (text: string): JSX.Element => <span className="tut-kw">{text}</span>;

const CompatibilityDiagram = (): JSX.Element => (
  <svg viewBox="0 0 260 160" className="tut-diagram" role="img" aria-label="Attribute compatibility">
    <defs>
      <marker id="tut-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
      </marker>
    </defs>
    <g fontFamily="var(--font)" fontSize="10" fontWeight="700" letterSpacing="0.14em" fill="var(--ink)">
      <g transform="translate(30 30)">
        <rect width="60" height="60" rx="3" fill="none" stroke="var(--el-water)" strokeWidth="1.8" />
        <text x="30" y="34" textAnchor="middle" fill="var(--el-water)">VAC</text>
      </g>
      <g transform="translate(170 30)">
        <rect width="60" height="60" rx="3" fill="none" stroke="var(--signal)" strokeWidth="1.8" />
        <text x="30" y="34" textAnchor="middle" fill="var(--signal)">VIR</text>
      </g>
      <g transform="translate(100 100)">
        <rect width="60" height="60" rx="3" fill="none" stroke="var(--el-plant)" strokeWidth="1.8" />
        <text x="30" y="34" textAnchor="middle" fill="var(--el-plant)">DAT</text>
      </g>
      <path d="M 96 60 L 168 60" stroke="var(--signal)" strokeWidth="2" fill="none" markerEnd="url(#tut-arrow)" />
      <path d="M 200 96 L 158 128" stroke="var(--el-plant)" strokeWidth="2" fill="none" markerEnd="url(#tut-arrow)" />
      <path d="M 100 128 L 62 96" stroke="var(--el-water)" strokeWidth="2" fill="none" markerEnd="url(#tut-arrow)" />
    </g>
  </svg>
);

const LOBBY_TUTORIAL: Tutorial = {
  id: 'route:/lobby',
  category: 'Lobby',
  pages: [
    {
      title: 'Welcome to the Lobby',
      body: (
        <>
          The Lobby is where Tamers gather. Chat in {kw('global')} or private {kw('rooms')}, see who's
          online, and queue for real-time {kw('3v3 PvP')} against another Tamer.
        </>
      ),
    },
    {
      title: 'Matchmaking',
      body: (
        <>
          Press {kw('Queue')} to enter matchmaking. You are paired against opponents near your
          {' '}
          {kw('MMR')} (starts at 1000). Wins push MMR up, losses drop it. Win streaks pay bonus
          {' '}
          {kw('DigiCredits')}.
        </>
      ),
    },
  ],
};

const ROSTER_TUTORIAL: Tutorial = {
  id: 'route:/roster',
  category: 'Party',
  pages: [
    {
      title: 'Your Roster',
      body: (
        <>
          Every Digimon you own lives here. {kw('Nickname')} them, {kw('inspect stats')}, and evolve
          them when they reach the next stage requirement.
        </>
      ),
    },
    {
      title: 'Party of Three',
      body: (
        <>
          Assign three Digimon to your {kw('party')} — that trio fights every battle. Party mons
          cannot train or list on the Market until you rotate them out.
        </>
      ),
    },
  ],
};

const WORLD_TUTORIAL: Tutorial = {
  id: 'route:/world',
  category: 'World',
  pages: [
    {
      title: 'The DigiWorld',
      body: (
        <>
          The globe holds every explorable region. Each biome has its own {kw('spawn table')},
          {' '}
          {kw('element bias')}, and difficulty. Drag to rotate; scroll to zoom.
        </>
      ),
    },
    {
      title: 'Enter a Dungeon',
      body: (
        <>
          Click a lit node to select it, then {kw('Enter Dungeon')} on the side rail. Beating a
          dungeon unlocks new species for your Digdex.
        </>
      ),
    },
    {
      title: 'Quests',
      body: (
        <>
          Switch to the {kw('Quests')} tab to see active tasks. Accept a quest and its objectives
          become trackable during battle and world exploration.
        </>
      ),
    },
  ],
};

const COMBAT_TUTORIAL: Tutorial = {
  id: 'route:/combat',
  category: 'Battle',
  pages: [
    {
      title: 'Battle Basics',
      body: (
        <>
          Battles alternate turns. Pick a Digimon plus one action: {kw('Fight')} (basic attack, no
          EN cost), {kw('Skill')} (spends EN, hits harder), {kw('Guard')} (halves incoming damage
          next turn), or {kw('Flee')}.
        </>
      ),
    },
    {
      title: 'Compatibility & Damage',
      body: (
        <>
          Damage depends on {kw('Attribute compatibility')} (the rock-paper-scissors of {kw('Vaccine > Virus > Data')})
          {' '}
          plus {kw('Elemental Resistances')} and the attacker's {kw('level')}. Landing a matchup
          multiplies damage; hitting a resist cuts it.
        </>
      ),
      visual: <CompatibilityDiagram />,
    },
    {
      title: 'Ailments',
      body: (
        <>
          Skills can inflict {kw('burn')}, {kw('poison')}, {kw('freeze')}, {kw('stun')}, {kw('sleep')},
          and more. Ailments tick each round and expire; freeze / stun / sleep skip the target's turn.
        </>
      ),
    },
    {
      title: 'Rewards',
      body: (
        <>
          Winning grants {kw('XP')}, {kw('DigiCredits')}, and species progress. KO'd Digimon return
          to your roster to recover for 30 minutes before they can adventure again.
        </>
      ),
    },
  ],
};

const DUNGEON_TUTORIAL: Tutorial = {
  id: 'route:/dungeon',
  category: 'World',
  pages: [
    {
      title: 'Dungeon Exploration',
      body: (
        <>
          Move with {kw('WASD')} or {kw('arrow keys')}, or click an adjacent tile. Red {kw('E')}
          {' '}
          tiles are static encounters; gold {kw('I')} tiles are pickups.
        </>
      ),
    },
    {
      title: 'Doors & Warps',
      body: (
        <>
          {kw('Locked doors')} need a matching key from the Shop. {kw('Warps')} teleport you to a
          linked dungeon. Random encounters roll while you walk — travel prepared.
        </>
      ),
    },
    {
      title: 'Clearing',
      body: (
        <>
          Defeat every encounter to unlock {kw('Complete Dungeon')} in the run rail. Completing
          banks bonus loot and marks the dungeon done for the day.
        </>
      ),
    },
  ],
};

const FARM_TUTORIAL: Tutorial = {
  id: 'route:/farm',
  category: 'Town',
  pages: [
    {
      title: 'Passive Production',
      body: (
        <>
          Your four buildings produce {kw('Meat')}, {kw('Bits')}, and {kw('Data')} while you're
          away. Rate scales with level; storage fills to a cap and then pauses until you collect.
        </>
      ),
    },
    {
      title: 'Upgrade with Bits',
      body: (
        <>
          Spend {kw('Bits')} to upgrade a building. Each level adds {kw('+25% rate')} and
          {' '}
          {kw('+20% cap')}. The next upgrade costs 60% more, so plan which building to prioritize.
        </>
      ),
    },
  ],
};

const FACTORY_TUTORIAL: Tutorial = {
  id: 'route:/factory',
  category: 'Town',
  pages: [
    {
      title: 'Factories',
      body: (
        <>
          Factories turn Farm resources into {kw('items')}. Buy a factory type, then queue recipes
          — each recipe consumes Meat / Bits / Data and costs {kw('craft time')}.
        </>
      ),
    },
    {
      title: 'Queue & Auto',
      body: (
        <>
          Each factory has an 8h queue cap. Queue multiple recipes to run overnight; upgrade the
          factory level to increase {kw('craft speed')}.
        </>
      ),
    },
  ],
};

const ADVENTURE_TUTORIAL: Tutorial = {
  id: 'route:/adventure',
  category: 'Town',
  pages: [
    {
      title: 'Expeditions',
      body: (
        <>
          Send three resting Digimon on a long expedition (1–8h). While away they fight random
          encounters and bank loot + XP — you collect it all when they return.
        </>
      ),
    },
    {
      title: 'Provisions',
      body: (
        <>
          Every expedition burns {kw('Provisions')} — craft them in the Factory Pantry. Longer
          runs need more provisions but return more loot per hour.
        </>
      ),
    },
  ],
};

const NURSERY_TUTORIAL: Tutorial = {
  id: 'route:/nursery',
  category: 'Town',
  pages: [
    {
      title: 'The Nursery',
      body: (
        <>
          Care for {kw('Digitama')} (eggs). {kw('Pet')} them and {kw('feed')} them to raise mood —
          higher mood means a stronger hatch.
        </>
      ),
    },
    {
      title: 'Hatch Path',
      body: (
        <>
          Collect {kw('Species Data')} from world battles until an entry reaches 100%. Then
          {' '}
          {kw('hatch')} that species directly, or spend it on a {kw('Mix Hatch')} for a random roll.
        </>
      ),
    },
  ],
};

const TRAINING_TUTORIAL: Tutorial = {
  id: 'route:/training',
  category: 'Town',
  pages: [
    {
      title: 'Stat Training',
      body: (
        <>
          Bench a Digimon at a training station to boost {kw('HP')}, {kw('EN')}, {kw('ATK')},
          {' '}
          {kw('DEF')}, or {kw('SPD')} without leveling. Sessions run in real-time; longer runs
          give more stats but cost mood.
        </>
      ),
    },
  ],
};

const SHOP_TUTORIAL: Tutorial = {
  id: 'route:/shop',
  category: 'Town',
  pages: [
    {
      title: 'The Item Shop',
      body: (
        <>
          Buy consumables with {kw('DigiCredits')} earned in combat. Healing potions, EN restoratives,
          {' '}
          {kw('XP multipliers')}, and stat buffs stack in your Inventory.
        </>
      ),
    },
  ],
};

const ITEMS_TUTORIAL: Tutorial = {
  id: 'route:/items',
  category: 'Party',
  pages: [
    {
      title: 'Inventory',
      body: (
        <>
          Apply items to a Digimon here. {kw('HP/EN buffs')} attach to the target and consume on
          the next battle. {kw('XP multipliers')} attach to your account for the next win.
        </>
      ),
    },
  ],
};

const MARKET_TUTORIAL: Tutorial = {
  id: 'route:/market',
  category: 'Market',
  pages: [
    {
      title: 'Player Market',
      body: (
        <>
          Buy Digimon listed by other Tamers or list your own. Party mons, training mons, and
          downed mons cannot be listed — rotate them out first.
        </>
      ),
    },
    {
      title: 'Pricing',
      body: (
        <>
          Sort by {kw('Newest')}, {kw('Price')}, or {kw('Level')} to hunt bargains. Listings never
          expire — cancel anytime to reclaim.
        </>
      ),
    },
  ],
};

const DIGDEX_TUTORIAL: Tutorial = {
  id: 'route:/digdex',
  category: 'World',
  pages: [
    {
      title: 'Field Guide',
      body: (
        <>
          The Digdex tracks every species you have {kw('met')} or defeated. Filter by stage or
          element, or search by name. Completing entries feeds Nursery hatches.
        </>
      ),
    },
  ],
};

export const TUTORIALS: Readonly<Record<string, Tutorial>> = {
  '/lobby': LOBBY_TUTORIAL,
  '/roster': ROSTER_TUTORIAL,
  '/world': WORLD_TUTORIAL,
  '/combat': COMBAT_TUTORIAL,
  '/dungeon': DUNGEON_TUTORIAL,
  '/farm': FARM_TUTORIAL,
  '/factory': FACTORY_TUTORIAL,
  '/adventure': ADVENTURE_TUTORIAL,
  '/nursery': NURSERY_TUTORIAL,
  '/training': TRAINING_TUTORIAL,
  '/shop': SHOP_TUTORIAL,
  '/items': ITEMS_TUTORIAL,
  '/market': MARKET_TUTORIAL,
  '/digdex': DIGDEX_TUTORIAL,
};

/**
 * Resolve a pathname to a tutorial. Returns null for admin, onboarding, and
 * public routes where a tutorial would be intrusive.
 */
export function tutorialForPath(pathname: string): Tutorial | null {
  if (pathname.startsWith('/admin')) return null;
  if (pathname === '/login' || pathname === '/reset' || pathname === '/intro' || pathname === '/') return null;
  if (pathname === '/spectate') return null;
  if (pathname.startsWith('/dungeon/')) return TUTORIALS['/dungeon'] ?? null;
  return TUTORIALS[pathname] ?? null;
}
