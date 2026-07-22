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
    body: 'Your starter team is ready. Let me show you around — you can skip anytime.',
  },
  {
    id: 'world',
    targetHref: '/world',
    title: 'World',
    body: 'Explore biomes and encounter wild Digimon. This is where PvE battles happen.',
  },
  {
    id: 'roster',
    targetHref: '/roster',
    title: 'Roster',
    body: 'View, nickname, evolve, and swap your party of 3 Digimon here.',
  },
  {
    id: 'digdex',
    targetHref: '/digdex',
    title: 'Digdex',
    body: 'Track every species you have encountered or captured across the world.',
  },
  {
    id: 'lobby',
    targetHref: '/lobby',
    title: 'Lobby',
    body: 'Presence, chat, and matchmaking for 3v3 real-time PvP battles.',
  },
  {
    id: 'shop',
    targetHref: '/shop',
    title: 'Shop & Items',
    body: 'Buy consumables with DigiCredits. Apply items to your Digimon for combat buffs.',
  },
  {
    id: 'final',
    title: 'You are ready',
    body: 'Have fun. You can revisit any of these anytime from the top nav.',
  },
] as const;

export const INTRO_TOUR_ACTIVE_KEY = 'digiworld.intro-tour-active';
export const INTRO_TOUR_STEP_KEY = 'digiworld.intro-tour-step';
export const INTRO_TOUR_DONE_KEY = 'digiworld.intro-tour-completed';
