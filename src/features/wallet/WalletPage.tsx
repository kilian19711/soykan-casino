import { useCallback, useEffect, useState } from 'react';
import { GiftButton } from '../social/SocialPage';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../auth/AuthProvider';
import { useAppData } from '../../app/AppData';
import { formatCredits, formatDateTime, formatSigned } from '../../lib/format';
import { toAppError } from '../../lib/errors';
import { Button } from '../../components/Button';
import { Credits, EmptyState, ErrorState, PageLoading } from '../../components/ui';
import { IconWallet } from '../../components/Icons';
import type { LedgerEntry } from '../../types';

export const ENTRY_LABELS: Record<string, string> = {
  weekly_bonus: 'Tagesbonus',
  game_bet: 'Spieleinsatz',
  game_payout: 'Spielgewinn',
  admin_credit: 'Admin-Gutschrift',
  admin_debit: 'Admin-Korrektur',
  credit_request: 'Credit-Anfrage genehmigt',
  achievement_reward: 'Erfolg',
  quest_reward: 'Daily Quest',
  gift_sent: 'Geschenk gesendet',
  gift_received: 'Geschenk erhalten',
  duel_stake: 'Duell-Einsatz',
  duel_payout: 'Duell gewonnen',
  duel_refund: 'Duell erstattet',
  prediction_reward: 'Kasten-Tipp',
};

const FILTERS: [string, string, string[] | null][] = [
  ['all', 'Alle', null],
  ['games', 'Spiele', ['game_bet', 'game_payout']],
  ['bonus', 'Bonus & Belohnungen', ['weekly_bonus', 'achievement_reward', 'quest_reward', 'prediction_reward']],
  ['social', 'Duelle & Geschenke', ['gift_sent', 'gift_received', 'duel_stake', 'duel_payout', 'duel_refund']],
  ['admin', 'Admin & Anfragen', ['admin_credit', 'admin_debit', 'credit_request']],
];

const PAGE = 40;

export function LedgerTable({ entries, showUser }: { entries: LedgerEntry[]; showUser?: (id: string) => string }) {
  return (
    <div className="table-wrap">
      <table className="table responsive">
        <thead>
          <tr>
            <th>Zeitpunkt</th>
            {showUser && <th>Benutzer</th>}
            <th>Art</th>
            <th>Grund</th>
            <th className="num">Betrag</th>
            <th className="num">Saldo danach</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td data-label="Zeitpunkt" className="small">
                {formatDateTime(e.created_at)}
              </td>
              {showUser && <td data-label="Benutzer">{showUser(e.user_id)}</td>}
              <td data-label="Art">{ENTRY_LABELS[e.entry_type] ?? e.entry_type}</td>
              <td data-label="Grund" className="small subtle" style={{ overflowWrap: 'anywhere' }}>
                {e.reason}
              </td>
              <td data-label="Betrag" className={`num ${e.amount > 0 ? 'success' : ''}`}>
                {formatSigned(e.amount)}
              </td>
              <td data-label="Saldo danach" className="num">
                {formatCredits(e.balance_after)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WalletPage() {
  const { session } = useAuth();
  const { balance, ledgerVersion } = useAppData();
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const uid = session?.user.id;

  const load = useCallback(async () => {
    if (!uid) return;
    try {
      const list = await api.getLedger(uid, PAGE, 0);
      setEntries(list);
      setHasMore(list.length === PAGE);
      setError(null);
    } catch (e) {
      setError(toAppError(e).message);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load, ledgerVersion]);

  const more = async () => {
    if (!uid || !entries) return;
    setLoadingMore(true);
    try {
      const list = await api.getLedger(uid, PAGE, entries.length);
      setEntries([...entries, ...list]);
      setHasMore(list.length === PAGE);
    } finally {
      setLoadingMore(false);
    }
  };

  const types = FILTERS.find((f) => f[0] === filter)?.[2];
  const shown = entries?.filter((e) => !types || types.includes(e.entry_type)) ?? [];
  const totals = (entries ?? []).reduce(
    (acc, e) => {
      if (e.amount > 0) acc.in += e.amount;
      else acc.out += -e.amount;
      return acc;
    },
    { in: 0, out: 0 },
  );

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Wallet & Transaktionen</h1>
          <p>Dein Kontostand und alle Bewegungen – Einsätze, Gewinne, Boni und Geschenke.</p>
        </div>
        <Link to="/anfragen" className="btn btn-primary">
          Credits anfragen
        </Link>
      </div>
      <div className="grid-3">
        <div className="card card-gold">
          <div className="label">Aktueller Kontostand</div>
          <div className="row-between" style={{ gap: 10, alignItems: 'center' }}>
            <div className="stat-value xl gold" style={{ whiteSpace: 'nowrap', minWidth: 0, fontSize: 'clamp(26px, 8vw, 40px)' }}>
              <Credits value={balance} />
            </div>
            <GiftButton />
          </div>
        </div>
        <div className="card">
          <div className="label">Eingänge</div>
          <div className="stat-value success">+{formatCredits(totals.in)}</div>
        </div>
        <div className="card">
          <div className="label">Ausgänge</div>
          <div className="stat-value subtle">−{formatCredits(totals.out)}</div>
        </div>
      </div>
      <div className="chip-group" role="group" aria-label="Filter">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      {error && <ErrorState message={error} onRetry={() => void load()} />}
      {!entries && !error && <PageLoading />}
      {entries &&
        (shown.length ? (
          <LedgerTable entries={shown} />
        ) : (
          <div className="card">
            <EmptyState icon={<IconWallet size={30} />} title="Keine Transaktionen" text="Hier erscheinen Bonus, Einsätze, Gewinne und Geschenke." />
          </div>
        ))}
      {hasMore && (
        <Button onClick={() => void more()} loading={loadingMore}>
          Mehr laden
        </Button>
      )}
    </div>
  );
}
