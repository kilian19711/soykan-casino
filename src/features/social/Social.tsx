// Live-Feed (große Gewinne) und Wochen-Rückblick. Erfolge: features/quests/Quests.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatCredits, formatMultiplier, formatPlaytime, formatWeekKey, relativeTime } from '../../lib/format';
import { useAppData } from '../../app/AppData';
import { useGameConfigs } from '../games/shared';
import { Avatar, EmptyState } from '../../components/ui';
import { Button } from '../../components/Button';

/** Live-Feed großer Gewinne – nur sichtbar, wenn der Benutzer es eingeschaltet hat. */
export function BigWinsFeed() {
  const { leaderboardVersion } = useAppData();
  const { configs } = useGameConfigs();
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.getBigWins>> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const load = useCallback(() => {
    api.getBigWins().then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(load, items ? 1500 : 0);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderboardVersion, load]);
  const name = (k: string) => configs?.find((c) => c.game_key === k)?.display_name ?? k;
  if (!items) return <div className="skeleton" style={{ height: 100 }} />;
  if (!items.length) return <EmptyState title="Noch keine großen Gewinne heute" text="Ab 5× und +200 Credits erscheinen Gewinne hier." />;
  return (
    <ul className="list">
      {items.map((w) => (
        <li key={w.round_id} className="list-item" style={{ animation: 'slideDown .25s ease both' }}>
          <Avatar name={w.display_name} seed={w.avatar_seed} size={30} />
          <div className="grow">
            <div className="small">
              <strong>{w.display_name}</strong> hat bei <Link to={`/casino/${w.game_key}`}>{name(w.game_key)}</Link> {formatMultiplier(Number(w.multiplier))} getroffen
            </div>
            <div className="small muted">{relativeTime(w.completed_at)}</div>
          </div>
          <span className="mono gold">+{formatCredits(w.profit)}</span>
        </li>
      ))}
    </ul>
  );
}

interface Recap {
  week_key: string;
  rounds: number;
  wagered: number;
  biggest_win?: { display_name: string; game_key: string; profit: number; multiplier: number } | null;
  biggest_multiplier?: { display_name: string; game_key: string; multiplier: number } | null;
  biggest_loss?: { display_name: string; game_key: string; loss: number } | null;
  top_game?: { game_key: string; rounds: number } | null;
  most_rounds?: { display_name: string; rounds: number } | null;
  best_week?: { display_name: string; profit: number } | null;
  longest_playtime?: { display_name: string; seconds: number } | null;
}

export function WeekRecap() {
  const { configs } = useGameConfigs();
  const [offset, setOffset] = useState(0);
  const [recap, setRecap] = useState<Recap | null>(null);
  useEffect(() => {
    setRecap(null);
    api.getWeekRecap(offset).then((r) => setRecap(r as unknown as Recap)).catch(() => setRecap(null));
  }, [offset]);
  const name = (k?: string) => (k ? (configs?.find((c) => c.game_key === k)?.display_name ?? k) : '–');
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="card-flat">
      <div className="label">{label}</div>
      <div className="small" style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
  return (
    <div className="stack">
      <div className="row-between">
        <span className="small subtle">{recap ? formatWeekKey(recap.week_key) : '…'}</span>
        <div className="row">
          <Button size="sm" variant="ghost" onClick={() => setOffset((o) => Math.min(52, o + 1))} aria-label="Vorherige Woche">←</Button>
          <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 1))} aria-label="Nächste Woche">→</Button>
        </div>
      </div>
      {!recap ? (
        <div className="skeleton" style={{ height: 140 }} />
      ) : !recap.rounds ? (
        <EmptyState title="In dieser Woche wurde noch nicht gespielt" />
      ) : (
        <div className="grid-2">
          <Row label="Runden / Einsätze">
            <span className="mono">{formatCredits(recap.rounds)}</span> Runden · <span className="mono">{formatCredits(recap.wagered)}</span> Credits
          </Row>
          {recap.biggest_win && (
            <Row label="Größter Gewinn">
              <strong>{recap.biggest_win.display_name}</strong> · <span className="mono gold">+{formatCredits(recap.biggest_win.profit)}</span> ({name(recap.biggest_win.game_key)})
            </Row>
          )}
          {recap.biggest_multiplier && (
            <Row label="Höchster Multiplikator">
              <strong>{recap.biggest_multiplier.display_name}</strong> · <span className="mono">{formatMultiplier(Number(recap.biggest_multiplier.multiplier))}</span> ({name(recap.biggest_multiplier.game_key)})
            </Row>
          )}
          {recap.biggest_loss && recap.biggest_loss.loss > 0 && (
            <Row label="Größter Verlust">
              <strong>{recap.biggest_loss.display_name}</strong> · <span className="mono">−{formatCredits(recap.biggest_loss.loss)}</span> ({name(recap.biggest_loss.game_key)})
            </Row>
          )}
          {recap.top_game && (
            <Row label="Beliebtestes Spiel">
              {name(recap.top_game.game_key)} · <span className="mono">{recap.top_game.rounds}</span> Runden
            </Row>
          )}
          {recap.best_week && (
            <Row label="Gewinner der Woche">
              <strong>{recap.best_week.display_name}</strong> · <span className="mono">{recap.best_week.profit >= 0 ? '+' : '−'}{formatCredits(Math.abs(recap.best_week.profit))}</span>
            </Row>
          )}
          {recap.most_rounds && (
            <Row label="Fleißigster Spieler">
              <strong>{recap.most_rounds.display_name}</strong> · <span className="mono">{recap.most_rounds.rounds}</span> Runden
            </Row>
          )}
          {recap.longest_playtime && (
            <Row label="Längste Spielzeit">
              <strong>{recap.longest_playtime.display_name}</strong> · <span className="mono">{formatPlaytime(recap.longest_playtime.seconds)}</span>
            </Row>
          )}
        </div>
      )}
    </div>
  );
}
