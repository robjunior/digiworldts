import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Attribute } from '@digiworld/shared/digimon';

import { AvatarPicker, type AvatarPickChoice } from '../components/account/AvatarPicker';
import { useAuth } from '../hooks/useAuth';
import { useLocale, useT } from '../hooks/useLocale';
import { getRoster, type RosterView } from '../lib/api';
import { getPlayerCareer, getPvpHistory, type PlayerCareer, type PvpMatchSummary } from '../lib/api-player';
import { fmtRelative } from '../lib/format';
import { setLocale, type Locale } from '../lib/locale';
import '../styles/extensions-account.css';

const LOCALE_CHOICES: readonly { readonly id: Locale; readonly label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'pt', label: 'PT' },
];

const ATTR_TO_EL: Readonly<Record<Attribute, string>> = {
  Virus: 'fire',
  Data: 'water',
  Vaccine: 'plant',
  Free: 'wind',
  Variable: 'electricity',
  Unknown: 'wind',
  NoData: 'wind',
};

const DISCORD_PATH_D =
  'M20 4.4A19 19 0 0 0 15.4 3l-.3.5a14 14 0 0 1 4 1.3 13 13 0 0 0-11-.1 13 13 0 0 1 4-1.3L11.9 3A19 19 0 0 0 7.3 4.4C4.6 8.4 3.9 12.3 4.2 16.1a19 19 0 0 0 5.8 2.9l.5-1a12 12 0 0 1-1.8-.9l.4-.3a9 9 0 0 0 8 0l.4.3c-.6.4-1.2.7-1.8.9l.5 1a19 19 0 0 0 5.8-2.9c.4-4.5-.7-8.4-2.8-11.7ZM9.5 14c-.9 0-1.6-.8-1.6-1.9S8.6 10.3 9.5 10.3s1.6.9 1.6 1.9S10.4 14 9.5 14Zm5 0c-.9 0-1.6-.8-1.6-1.9s.7-1.8 1.6-1.8 1.6.9 1.6 1.9S15.4 14 14.5 14Z';

const RING_CIRC = 207;

function elementFor(mon: RosterView): string {
  const attribute = mon.template?.attribute;
  if (!attribute) return 'fire';
  return ATTR_TO_EL[attribute] ?? 'fire';
}

function partyOnly(roster: readonly RosterView[]): RosterView[] {
  return roster
    .filter((m) => m.status === 'party' && typeof m.slot === 'number')
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
}

type CareerTile = {
  readonly n: string;
  readonly nSuffix?: string;
  readonly label: string;
  readonly detail: string;
  readonly iconPath: string;
};

function buildCareerTiles(career: PlayerCareer, t: (k: string, params?: Record<string, string | number>) => string): CareerTile[] {
  const b = career.battles;
  const digivolutions = career.digivolutions;
  const dex = career.dexRegistered;
  const hours = career.timeTrainedHours;

  return [
    {
      n: b.wins.toLocaleString('en-US'),
      label: t('account.tile.battles_won'),
      detail: t('account.tile.battles_won.detail', { winRate: b.winRatePct, losses: b.losses }),
      iconPath: 'M14 3l-2 5h4l-4 8 2-5h-4l4-8z',
    },
    {
      n: digivolutions.toLocaleString('en-US'),
      label: t('account.tile.digivolutions'),
      detail: t('account.tile.digivolutions.detail'),
      iconPath: 'M12 3l7 4v6c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z',
    },
    {
      n: dex.toLocaleString('en-US'),
      label: t('account.tile.dex_registered'),
      detail: t('account.tile.dex_registered.detail'),
      iconPath: 'M4 5h16v14H4z M8 5v14',
    },
    {
      n: hours.toLocaleString('en-US'),
      nSuffix: 'h',
      label: t('account.tile.time_trained'),
      detail: t('account.tile.time_trained.detail'),
      iconPath: 'M12 4a8 8 0 100 16 8 8 0 000-16z M12 7v5l3 2',
    },
  ];
}

function outcomeLabelFor(match: PvpMatchSummary, t: (k: string) => string): string {
  if (match.isDraw) return t('account.pvp.draw');
  return match.win ? t('account.pvp.victory') : t('account.pvp.defeat');
}

function outcomeBadge(match: PvpMatchSummary): string {
  if (match.isDraw) return '=';
  return match.win ? 'W' : 'L';
}

function matchStateClass(match: PvpMatchSummary): string {
  if (match.isDraw) return 'draw';
  return match.win ? 'win' : 'loss';
}

export function Account(): JSX.Element {
  const t = useT();
  const locale = useLocale();
  const { user } = useAuth();
  const [avatarChoice, setAvatarChoice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [discordLinked, setDiscordLinked] = useState<boolean>(false);

  const authed = user !== null;
  const careerQuery = useQuery({
    queryKey: ['player-career'] as const,
    queryFn: getPlayerCareer,
    enabled: authed,
    staleTime: 30_000,
  });
  const pvpQuery = useQuery({
    queryKey: ['pvp-history', 20] as const,
    queryFn: () => getPvpHistory(20),
    enabled: authed,
    staleTime: 30_000,
  });
  const rosterQuery = useQuery({
    queryKey: ['roster'] as const,
    queryFn: getRoster,
    enabled: authed,
    staleTime: 15_000,
  });

  const party = useMemo(() => partyOnly(rosterQuery.data?.roster ?? []), [rosterQuery.data]);
  const partyMax = 3;

  const initialLetter = (user?.displayName?.[0] ?? user?.username?.[0] ?? '—').toUpperCase();

  const pickerChoices = useMemo<AvatarPickChoice[]>(() => {
    const list: AvatarPickChoice[] = [
      { value: null, label: t('account.avatar.initial') },
    ];
    for (const mon of party) {
      if (!mon.template) continue;
      list.push({
        value: mon.template.id,
        label: mon.template.name,
        catalogId: mon.template.id,
        element: elementFor(mon),
      });
    }
    return list;
  }, [party, t]);

  const chosenMonRow = useMemo<RosterView | null>(() => {
    if (avatarChoice === null) return null;
    return party.find((m) => m.template?.id === avatarChoice) ?? null;
  }, [party, avatarChoice]);

  if (!user) {
    return <div className="account-page" />;
  }

  const career = careerQuery.data;
  const pvp = pvpQuery.data?.matches ?? [];

  const level = career?.tamer.level ?? 1;
  const xpBase = career?.tamer.xpFloor ?? 0;
  const xpNow = career?.tamer.xp ?? 0;
  const xpTop = career?.tamer.xpNext ?? 0;
  const xpDenom = Math.max(1, xpTop - xpBase);
  const xpProgress = Math.max(0, xpNow - xpBase);
  const xpPct = Math.min(100, Math.round((xpProgress / xpDenom) * 100));

  const rankNow = career?.tamer.mmr ?? user.mmr;
  const rankHi = career?.tamer.mmrHigh ?? user.mmr;
  const tier = career?.tamer.tier ?? 'I';
  const wins = career?.battles.wins ?? 0;
  const hours = career?.timeTrainedHours ?? 0;

  const ringPct = rankHi > 0 ? Math.min(1, rankNow / rankHi) : 0;
  const ringOffset = Math.round(RING_CIRC * (1 - ringPct));

  const tiles = career ? buildCareerTiles(career, t) : [];

  const handleAndId = `@${user.username} · ${t('account.header.digivice_id', { id: user.id.slice(-6).toUpperCase() })}`;

  return (
    <div className="account-page">
      <header className="acc-topbar" aria-label={t('account.topbar.aria')}>
        <div className="acc-brand">
          <span className="bk">{t('account.brand.kicker')}</span>
          <span className="bt">{t('account.brand.title')}</span>
        </div>
        <div className="acc-conn">
          <button className="acc-iconbtn" type="button" aria-label={t('account.conn.search')} title={t('account.conn.search')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </button>
          <button className="acc-iconbtn" type="button" aria-label={t('account.conn.add_friend')} title={t('account.conn.add_friend')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            className={`acc-dcard${discordLinked ? ' linked' : ''}`}
            aria-pressed={discordLinked}
            aria-label={discordLinked ? t('account.discord.connected') : t('account.discord.connect')}
            onClick={() => setDiscordLinked((v) => !v)}
            title={t('account.discord.coming_soon')}
          >
            <span className="dic">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d={DISCORD_PATH_D} />
              </svg>
            </span>
            <span className="dtx">
              <span className="dk">{discordLinked ? t('account.discord.connected_kick') : t('account.discord.connect_kick')}</span>
              <span className="dv">
                {discordLinked ? user.username : t('account.discord.connect')}
                {discordLinked ? <span className="dot" /> : null}
              </span>
            </span>
          </button>
        </div>
      </header>

      <section className="acc-hero" aria-label={t('account.hero.aria')}>
        <button
          type="button"
          className="acc-avatar"
          onClick={() => setPickerOpen(true)}
          aria-haspopup="dialog"
          aria-label={t('account.avatar.change')}
        >
          {chosenMonRow ? (
            <img
              src={`/assets/digimon/${chosenMonRow.catalogId}/dot.gif`}
              alt=""
              onError={(ev) => {
                ev.currentTarget.style.visibility = 'hidden';
              }}
            />
          ) : (
            <span className="acc-avatar-init">{initialLetter}</span>
          )}
          <span className="lvbadge">{level}</span>
          <span className="chg">{t('account.avatar.change_hint')}</span>
        </button>

        <div className="acc-hid">
          <div className="kick">{t('account.hero.kicker')}</div>
          <h1>
            <span>{user.displayName}</span>
          </h1>
          <div className="handle">{handleAndId}</div>
          <div className="acc-xpwrap">
            <div className="acc-xpbar"><i style={{ width: `${xpPct}%` }} /></div>
            <div className="acc-xptxt">
              <b>{xpProgress.toLocaleString('en-US')}</b>
              {' / '}
              <span>{xpDenom.toLocaleString('en-US')}</span>
              {' '}
              {t('account.xp.to_next')}
            </div>
          </div>
        </div>

        <div className="acc-rank" aria-label={t('account.rank.aria')}>
          <div className="rk stack">
            <div>
              <div className="rn">
                {rankNow.toLocaleString('en-US')}
                <sup>RNK</sup>
              </div>
              <div className="rl">{t('account.rank.current')}</div>
            </div>
            <div>
              <div className="rn">
                {rankHi.toLocaleString('en-US')}
                <sup>PK</sup>
              </div>
              <div className="rl">{t('account.rank.peak')}</div>
            </div>
          </div>
          <div className="acc-ring" aria-hidden="true">
            <svg viewBox="0 0 76 76">
              <circle cx="38" cy="38" r="33" fill="none" stroke="var(--hair)" strokeWidth={5} />
              <circle
                cx="38"
                cy="38"
                r="33"
                fill="none"
                stroke="var(--signal)"
                strokeWidth={5}
                strokeDasharray={String(RING_CIRC)}
                strokeDashoffset={String(ringOffset)}
                transform="rotate(-90 38 38)"
              />
            </svg>
            <span className="rt">{tier}</span>
          </div>
          <div className="rk stack">
            <div>
              <div className="rn">{wins.toLocaleString('en-US')}</div>
              <div className="rl">{t('account.rank.pvp_wins')}</div>
            </div>
            <div>
              <div className="rn">
                {hours.toLocaleString('en-US')}
                <sup>H</sup>
              </div>
              <div className="rl">{t('account.rank.time_played')}</div>
            </div>
          </div>
          </div>
        </section>

      <div className="acc-body">
        <section className="acc-col" aria-label={t('account.career.aria')}>
          <div className="acc-colhead">
            <h2>{t('account.career.title')}</h2>
            <span className="line" />
            <span className="pick">
              {career?.activeSeason ? career.activeSeason.name : t('account.career.lifetime')}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </div>

          <div className="acc-tiles">
            {tiles.map((tile) => (
              <div className="acc-tile" key={tile.label}>
                <div className="th">
                  <span className="ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path d={tile.iconPath} />
                    </svg>
                  </span>
                  <span className="l">{tile.label}</span>
                </div>
                <div className="tv">
                  <div className="n">
                    {tile.n}
                    {tile.nSuffix ? <em>{tile.nSuffix}</em> : null}
                  </div>
                  <div className="d">{tile.detail}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="acc-pstrip" aria-label={t('account.party.aria')}>
            <div className="pk">{t('account.party.title', { current: party.length, max: partyMax })}</div>
            <div className="prow">
              {party.length === 0 ? (
                <div className="acc-empty" style={{ flex: 1 }}>{t('account.party.empty')}</div>
              ) : (
                party.map((mon) => (
                  <div className="acc-pmon" data-el={elementFor(mon)} key={mon.id}>
                    <span className="mug">
                      <img
                        src={`/assets/digimon/${mon.catalogId}/dot.gif`}
                        alt=""
                        onError={(ev) => {
                          ev.currentTarget.style.visibility = 'hidden';
                        }}
                      />
                    </span>
                    <div className="txt">
                      <div className="nm">{mon.nickname}</div>
                      <div className="lv">Lv {mon.level} · {mon.template?.stage ?? '—'}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="acc-prefs" aria-label={t('account.prefs.aria')}>
            <div className="pk">{t('account.prefs.title')}</div>
            <div className="acc-pref-row">
              <div className="acc-pref-txt">
                <div className="acc-pref-k">{t('account.prefs.language')}</div>
                <div className="acc-pref-hint">{t('account.prefs.language_hint')}</div>
              </div>
              <div className="acc-lang" role="group" aria-label={t('account.prefs.language')}>
                {LOCALE_CHOICES.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    className={`acc-lang-btn${locale === choice.id ? ' is-active' : ''}`}
                    aria-pressed={locale === choice.id}
                    onClick={() => setLocale(choice.id)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="acc-col" aria-label={t('account.pvp.aria')}>
          <div className="acc-colhead">
            <h2>{t('account.pvp.title')}</h2>
            <span className="hint">
              {t('account.pvp.summary', {
                count: pvp.length,
                wins: pvp.filter((m) => m.win).length,
                losses: pvp.filter((m) => !m.win && !m.isDraw).length,
              })}
            </span>
            <span className="line" />
          </div>

          <div className="acc-pvp">
            {pvp.length === 0 ? (
              <div className="acc-empty">{t('account.pvp.empty')}</div>
            ) : (
              pvp.map((match) => (
                <div className={`acc-match ${matchStateClass(match)}`} key={match.id}>
                  <div className="rbadge">{outcomeBadge(match)}</div>
                  <div className="bout">
                    <div className="side you">
                      <div className="ti">
                        <span className="tico">
                          {chosenMonRow ? (
                            <img
                              src={`/assets/digimon/${chosenMonRow.catalogId}/dot.gif`}
                              alt=""
                              onError={(ev) => {
                                ev.currentTarget.style.visibility = 'hidden';
                              }}
                            />
                          ) : (
                            initialLetter
                          )}
                        </span>
                        <span className="tn"><b>{user.displayName}</b></span>
                      </div>
                    </div>
                    <span className="vs">VS</span>
                    <div className="side foe">
                      <div className="ti">
                        <span className="tico">{(match.opponent.displayName[0] ?? '?').toUpperCase()}</span>
                        <span className="tn">{match.opponent.displayName}</span>
                      </div>
                    </div>
                  </div>
                  <div className="rt">
                    <div className="res">{outcomeLabelFor(match, t)}</div>
                    <div className="meta">
                      {t('account.pvp.rounds', { n: match.rounds })}
                      {' · '}
                      {fmtRelative(match.endedAt)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <AvatarPicker
        open={pickerOpen}
        title={t('account.picker.title')}
        eyebrow={t('account.picker.eyebrow')}
        subtitle={t('account.picker.subtitle')}
        closeLabel={t('account.picker.close')}
        choices={pickerChoices}
        selected={avatarChoice}
        initialLetter={initialLetter}
        onSelect={(v) => {
          setAvatarChoice(v);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
