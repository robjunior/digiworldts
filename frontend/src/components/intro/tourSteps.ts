export type IntroTourStep = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly targetHref?: string; // matches an <a href="..."> in the app nav; undefined = centered modal
};

export const INTRO_TOUR_STEPS: readonly IntroTourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to DigiWorld',
    body: 'Your starter team of three Digimon is ready. DigiWorld is a real-time 3v3 game — you fight wild Digimon in the world to level up and collect species, then queue in the Lobby for PvP against other Tamers. This tour covers each menu in about a minute. You can skip anytime.',
  },
  {
    id: 'world',
    targetHref: '/world',
    title: 'World — where you fight and collect',
    body: 'Explore biomes (Forest, Volcano, Glacier, Cliff, and more) to encounter wild Digimon. Each biome has its own spawn table and difficulty; winning grants XP, DigiCredits, and rare species drops. Progressing through the World is the main source of new Digimon and materials.',
  },
  {
    id: 'roster',
    targetHref: '/roster',
    title: 'Roster — your Digimon collection',
    body: 'Everything you own lives here: nickname them, inspect stats, evolve them once they hit the level requirement of the next stage, and swap your party of 3 between fights. Each Digimon has an element (fire, water, ice, plant, electricity, wind, earth, steel, dark, light, null) that grants advantage/disadvantage in combat.',
  },
  {
    id: 'digdex',
    targetHref: '/digdex',
    title: 'Digdex — species you have met',
    body: 'A living index of every Digimon species you have encountered or defeated. Filling the Digdex is a long-term goal — most rare species require you to defeat a specific number in the wild before they unlock as capturable, and some only spawn in specific biomes. Track your completion percent here.',
  },
  {
    id: 'lobby',
    targetHref: '/lobby',
    title: 'Lobby — chat, presence and PvP',
    body: 'See who else is online, chat globally, and queue up for real-time 3v3 PvP battles. Matchmaking uses your MMR (starts at 1000) and finds an opponent near your rating. Wins push MMR up, losses drop it — win streaks give bonus DigiCredits.',
  },
  {
    id: 'shop',
    targetHref: '/shop',
    title: 'Shop, City and beyond',
    body: 'Shop sells consumables (heal pots, XP multipliers, stat buffs) for DigiCredits earned in combat. Items applied via the Shop are consumed at the start of the next battle for that Digimon. The City submenu holds Farm (passive resource production), Factory (crafting), Nursery (hatch eggs into new Digimon), and Adventure (long-form quest mode).',
  },
  {
    id: 'final',
    title: 'You are ready, Tamer',
    body: 'Head to World for your first wild Digimon fight, or Lobby to queue up for PvP once you have a level. Every menu you just saw is one click away in the top nav. Have fun.',
  },
] as const;

export const INTRO_TOUR_ACTIVE_KEY = 'digiworld.intro-tour-active';
export const INTRO_TOUR_STEP_KEY = 'digiworld.intro-tour-step';
export const INTRO_TOUR_DONE_KEY = 'digiworld.intro-tour-completed';

