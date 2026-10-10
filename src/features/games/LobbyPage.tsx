import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGameConfigs, useGameConfig, GameUnavailable } from './shared';
import { ACTIVE_GAMES, CATEGORY_LABELS, GAME_TAGLINES, GameArt } from './catalog';
import { ErrorState, PageLoading } from '../../components/ui';
import type { GameConfig } from '../../types';
import { DuelBanner, DuelsButton } from '../social/SocialPage';

type GameComp = React.ComponentType<{ config: GameConfig }>;
/** Mehrere Spiele aus einem Modul als einzelne Lazy-Komponenten */
function named(loader: () => Promise<Record<string, unknown>>, map: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(map).map(([key, exp]) => [key, lazy(() => loader().then((m) => ({ default: m[exp] as GameComp })))]),
  );
}

const GAME_COMPONENTS: Record<string, React.LazyExoticComponent<React.ComponentType<{ config: GameConfig }>>> = {
  roulette: lazy(() => import('./games/RouletteGame')),
  blackjack: lazy(() => import('./games/BlackjackGame')),
  crash: lazy(() => import('./games/CrashGame')),
  plinko: lazy(() => import('./games/PlinkoGame')),
  mines: lazy(() => import('./games/MinesGame')),
  dice: lazy(() => import('./games/DiceGame')),
  limbo: lazy(() => import('./games/LimboGame')),
  slots: lazy(() => import('./games/SlotsGame')),
  ...named(() => import('./games/WheelGames'), {
    coinflip: 'Coinflip', wheel: 'Wheel', color_wheel: 'ColorWheel', bonus_wheel: 'BonusWheel',
    goal_multiplier: 'GoalMultiplier', rocket_multiplier: 'RocketMultiplier', safe_cracker: 'SafeCracker', drop_ball: 'DropBall',
  }),
  ...named(() => import('./games/CardGames'), {
    baccarat: 'Baccarat', dragon_tiger: 'DragonTiger', andar_bahar: 'AndarBahar', card_duel: 'CardDuel', hilo: 'HiLo', video_poker: 'VideoPoker',
  }),
  ...named(() => import('./games/LotteryGames'), {
    keno: 'Keno', number_draw: 'NumberDraw', digital_lottery: 'DigitalLottery', bingo: 'Bingo', scratch_card: 'ScratchCard',
  }),
  ...named(() => import('./games/SlotGames'), {
    classic_slots: 'ClassicSlots', fruit_slots: 'FruitSlots', neon_slots: 'NeonSlots', cluster_slots: 'ClusterSlots',
    lucky_seven: 'LuckySeven',
  }),
  ...named(() => import('./games/StickyDiamonds'), { shisha_diamonds: 'ShishaDiamonds' }),
  ...named(() => import('./games/DiceGames'), { sicbo: 'SicBo', poker_dice: 'PokerDice', dice_duel: 'DiceDuel' }),
  ...named(() => import('./games/GridGames'), { towers: 'Towers', gem_hunt: 'GemHunt', treasure_grid: 'TreasureGrid' }),
  ...named(() => import('./games/NewGames'), {
    horse_race: 'HorseRace', shell_game: 'ShellGame', diamonds: 'Diamonds', pump: 'Pump', jackpot_slot: 'JackpotSlot',
  }),
};

export function isPlayable(c: GameConfig) {
  return c.enabled && c.config.implemented === true && c.game_key in GAME_COMPONENTS;
}

export function GameTile({ game }: { game: GameConfig }) {
  const playable = isPlayable(game);
  const inner = (
    <>
      <div className="art">
        <GameArt gameKey={game.game_key} />
      </div>
      <div className="meta">
        <strong className="truncate">{game.display_name}</strong>
        {playable ? (
          <span className="small subtle truncate">{GAME_TAGLINES[game.game_key] ?? CATEGORY_LABELS[game.config.category ?? ''] ?? ''}</span>
        ) : (
          <span className="badge badge-warn">{game.config.implemented ? 'Deaktiviert' : 'In Entwicklung'}</span>
        )}
      </div>
    </>
  );
  if (!playable) {
    return (
      <div className="game-tile disabled" aria-disabled="true" title={`${game.display_name} – noch nicht spielbar`}>
        {inner}
      </div>
    );
  }
  return (
    <Link to={`/casino/${game.game_key}`} className="game-tile" aria-label={`${game.display_name} spielen`}>
      {inner}
    </Link>
  );
}

export function LobbyPage() {
  const { configs, error, reload } = useGameConfigs();
  const [filter, setFilter] = useState<string>('all');
  const [showDev, setShowDev] = useState(true);
  const [query, setQuery] = useState('');

  const { playable, upcoming, categories } = useMemo(() => {
    const list = configs ?? [];
    const play = list
      .filter(isPlayable)
      .sort((a, b) => ACTIVE_GAMES.indexOf(a.game_key as never) - ACTIVE_GAMES.indexOf(b.game_key as never));
    const up = list.filter((g) => !isPlayable(g));
    const cats = Array.from(new Set(list.map((g) => g.config.category ?? 'other')));
    return { playable: play, upcoming: up, categories: cats };
  }, [configs]);

  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!configs) return <PageLoading />;

  const q = query.trim().toLowerCase();
  const byFilter = (g: GameConfig) =>
    (filter === 'all' || g.config.category === filter) &&
    (!q || g.display_name.toLowerCase().includes(q) || (GAME_TAGLINES[g.game_key] ?? '').toLowerCase().includes(q));

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Casino-Lobby</h1>
          <p>
            {playable.length} spielbare Spiele · {upcoming.length} in Entwicklung
          </p>
        </div>
        <DuelsButton />
      </div>
      <div className="lobby-search">
        <span aria-hidden="true">🔍</span>
        <input
          type="search"
          className="input"
          placeholder="Spiel suchen …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Spiel suchen"
          enterKeyHint="search"
        />
        {query && (
          <button type="button" className="link-btn small" onClick={() => setQuery('')}>
            Löschen
          </button>
        )}
      </div>
      <div className="chip-group" role="group" aria-label="Kategorie filtern">
        <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Alle
        </button>
        {categories.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={filter === c} onClick={() => setFilter(c)}>
            {CATEGORY_LABELS[c] ?? c}
          </button>
        ))}
      </div>

      <section className="stack">
        <h2>Jetzt spielen</h2>
        <div className="game-grid">
          {playable.filter(byFilter).map((g) => (
            <GameTile key={g.game_key} game={g} />
          ))}
        </div>
        {!playable.filter(byFilter).length && <p className="subtle small">{q ? `Kein Spiel zu „${query.trim()}“ gefunden.` : 'In dieser Kategorie ist aktuell kein Spiel aktiv.'}</p>}
      </section>

      <section className="stack">
        <div className="row-between">
          <h2>Demnächst</h2>
          <label className="checkbox small">
            <input type="checkbox" checked={showDev} onChange={(e) => setShowDev(e.target.checked)} /> Anzeigen
          </label>
        </div>
        {showDev && (
          <>
            <p className="small subtle">
              Diese Spiele sind in Entwicklung und noch nicht spielbar. Nur vollständig getestete Spiele werden aktiviert.
            </p>
            <div className="game-grid">
              {upcoming.filter(byFilter).map((g) => (
                <GameTile key={g.game_key} game={g} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export function GamePage() {
  const { gameKey = '' } = useParams();
  const { config, error, loading, reload } = useGameConfig(gameKey);
  if (loading) return <PageLoading />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} />;
  if (!config) return <GameUnavailable title="Spiel nicht gefunden" reason="Dieses Spiel existiert nicht." />;
  if (!isPlayable(config)) {
    return (
      <GameUnavailable
        title={config.display_name}
        reason={config.config.implemented ? 'Dieses Spiel ist derzeit deaktiviert.' : 'Dieses Spiel ist noch in Entwicklung und nicht spielbar.'}
      />
    );
  }
  const Comp = GAME_COMPONENTS[gameKey];
  return (
    <Suspense fallback={<PageLoading />}>
      <DuelBanner gameKey={gameKey} />
      <Comp config={config} />
    </Suspense>
  );
}
