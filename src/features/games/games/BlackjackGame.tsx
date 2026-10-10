import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { newIdempotencyKey } from '../../../lib/misc';
import { formatCredits } from '../../../lib/format';
import { useAppData } from '../../../app/AppData';
import { Button } from '../../../components/Button';
import { useHotkey } from '../../../hooks/useHotkey';
import { BetControls, GameFrame, RecentRounds, limitsOf, useBet, useRoundRunner } from '../shared';
import { bjTotal, canSplit, cardLabel, validateBet } from '../logic';
import type { GameConfig, RoundResponse } from '../../../types';

interface Hand {
  cards: number[];
  bet: number;
  status: 'playing' | 'stood' | 'bust';
  doubled: boolean;
  split?: boolean;
  outcome?: 'win' | 'lose' | 'push' | 'bust' | 'blackjack' | 'dealer_blackjack';
  payout?: number;
  total?: number;
}
interface BjResult {
  phase: 'player' | 'settled';
  active_hand: number;
  actions: number;
  hands: Hand[];
  dealer: { cards: number[]; hidden: boolean; total?: number };
}

const OUTCOME_LABEL: Record<string, string> = {
  win: 'Gewonnen',
  lose: 'Verloren',
  push: 'Push',
  bust: 'Überkauft',
  blackjack: 'Blackjack!',
  dealer_blackjack: 'Dealer hat Blackjack',
};

function PlayingCard({ card, hidden, index }: { card?: number; hidden?: boolean; index: number }) {
  const style: React.CSSProperties = {
    width: 'clamp(54px, 14vw, 76px)',
    aspectRatio: '5 / 7',
    borderRadius: 9,
    marginLeft: index === 0 ? 0 : -22,
    boxShadow: '0 6px 16px rgba(0,0,0,.45)',
    animation: `cardIn .32s ease ${index * 0.06}s both`,
    flex: 'none',
  };
  if (hidden || card === undefined) {
    return (
      <div
        aria-label="Verdeckte Karte"
        role="img"
        style={{
          ...style,
          background: 'repeating-linear-gradient(45deg,#4c1d95 0 6px,#5b21b6 6px 12px)',
          border: '3px solid #f3c969',
        }}
      />
    );
  }
  const c = cardLabel(card);
  return (
    <div
      role="img"
      aria-label={`${c.rank} ${c.suit}`}
      style={{
        ...style,
        background: '#f8fafc',
        color: c.red ? '#b91c1c' : '#111827',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '5px 7px',
        fontWeight: 800,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <span style={{ fontSize: 15, lineHeight: 1 }}>
        {c.rank}
        <br />
        {c.suit}
      </span>
      <span style={{ fontSize: 26, alignSelf: 'center', lineHeight: 1 }}>{c.suit}</span>
      <span style={{ fontSize: 12, alignSelf: 'flex-end', transform: 'rotate(180deg)', lineHeight: 1 }}>{c.rank}</span>
    </div>
  );
}

function HandView({ title, cards, hiddenSecond, total, highlight, badge }: { title: string; cards: number[]; hiddenSecond?: boolean; total?: string; highlight?: boolean; badge?: React.ReactNode }) {
  return (
    <div
      className="stack"
      style={{
        gap: 8,
        padding: 10,
        borderRadius: 14,
        border: highlight ? '1.5px solid var(--gold-bright)' : '1px solid transparent',
        background: highlight ? 'rgba(243,201,105,.06)' : 'transparent',
      }}
    >
      <div className="row" style={{ gap: 8 }}>
        <span className="label">{title}</span>
        {total && <span className="badge mono">{total}</span>}
        {badge}
      </div>
      <div style={{ display: 'flex', minHeight: 100 }}>
        {cards.map((c, i) => (
          <PlayingCard key={`${i}-${c}`} card={c} index={i} />
        ))}
        {hiddenSecond && <PlayingCard hidden index={cards.length} />}
      </div>
    </div>
  );
}

export default function BlackjackGame({ config }: { config: GameConfig }) {
  const limits = limitsOf(config);
  const [bet, setBet] = useBet(limits);
  const [round, setRound] = useState<RoundResponse<BjResult> | null>(null);
  const runner = useRoundRunner('blackjack', config.display_name);
  const { balance } = useAppData();

  useEffect(() => {
    api
      .getActiveRound<BjResult>('blackjack')
      .then((r) => r && setRound(r))
      .catch(() => undefined);
  }, []);

  const res = round?.result;
  const active = round?.status === 'active' && res?.phase === 'player';
  const hand = active && res ? res.hands[res.active_hand] : null;
  const betError = validateBet(bet, limits, balance);
  const handBet = hand?.bet ?? 0;
  const canDouble = !!hand && hand.cards.length === 2 && (balance ?? 0) >= handBet;
  const canSplitNow = !!hand && !!res && canSplit(hand.cards, res.hands.length) && (balance ?? 0) >= handBet;

  const handleSettled = (r: RoundResponse<BjResult>) => {
    const outcomes = r.result.hands.map((h) => OUTCOME_LABEL[h.outcome ?? ''] ?? '');
    const dealerTotal = r.result.dealer.total;
    const desc = `${outcomes.join(' / ')} · Dealer ${dealerTotal ?? ''}`;
    runner.announce(r, desc, r.payout_amount > 0 ? r.payout_amount / r.bet_amount : null);
  };

  const start = async () => {
    if (betError || active) return;
    runner.clearOutcome();
    const r = await runner.run(() => api.blackjackStart(bet, newIdempotencyKey('bj')));
    if (!r) return;
    const typed = r as RoundResponse<BjResult>;
    setRound(typed);
    if (typed.status === 'settled') window.setTimeout(() => handleSettled(typed), 700);
  };

  const act = async (action: 'hit' | 'stand' | 'double' | 'split') => {
    if (!round || !active || !res) return;
    const r = await runner.run(() => api.blackjackAction(round.round_id, action, res.actions));
    if (!r) return;
    const typed = r as RoundResponse<BjResult>;
    setRound(typed);
    if (typed.status === 'settled') window.setTimeout(() => handleSettled(typed), 600);
  };

  useHotkey(['h', 'H'], () => void act('hit'), active && !runner.busy);
  useHotkey(['s', 'S'], () => void act('stand'), active && !runner.busy);
  useHotkey(['d', 'D'], () => canDouble && void act('double'), active && !runner.busy);
  useHotkey(['p', 'P'], () => canSplitNow && void act('split'), active && !runner.busy);
  useHotkey(['Enter'], () => void start(), !active && !runner.busy);

  const dealerCards = res?.dealer.cards ?? [];
  const dealerTotal = res ? (res.dealer.hidden ? bjTotal(dealerCards).total : (res.dealer.total ?? bjTotal(dealerCards).total)) : null;

  return (
    <>
      <GameFrame
        title={config.display_name}
        subtitle="Komm näher an 21 als der Dealer, ohne dich zu überkaufen."
        runner={runner}
        onPlayAgain={() => void start()}
        rules={
          <>
            <p>
              Gespielt wird mit 6 Decks, die vor jeder Runde neu gemischt werden. Kartenwerte: 2–10 nach Zahl, Bube/Dame/König
              = 10, Ass = 1 oder 11.
            </p>
            <ul>
              <li><strong>Hit (H):</strong> eine weitere Karte.</li>
              <li><strong>Stand (S):</strong> keine weitere Karte.</li>
              <li><strong>Double Down (D):</strong> Einsatz verdoppeln, genau eine Karte, danach automatisch Stand.</li>
              <li><strong>Split (P):</strong> bei zwei Karten gleichen Werts in zwei Hände teilen (einmal pro Runde). Geteilte Asse erhalten je eine Karte.</li>
            </ul>
            <p>Der Dealer zieht bis 16 und steht auf allen 17 („Stand auf 17").</p>
            <p>Blackjack (Ass + 10er mit den ersten zwei Karten) zahlt 3:2. Normaler Gewinn 1:1. Gleichstand (Push) = Einsatz zurück. Nach einem Split zählt 21 nicht als Blackjack.</p>
          </>
        }
        controls={
          <>
            <BetControls value={bet} onChange={setBet} limits={limits} disabled={active || runner.busy} />
            {active ? (
              <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <Button variant="primary" onClick={() => void act('hit')} disabled={runner.busy}>
                  Hit
                </Button>
                <Button variant="gold" onClick={() => void act('stand')} disabled={runner.busy}>
                  Stand
                </Button>
                <Button onClick={() => void act('double')} disabled={runner.busy || !canDouble} title={!canDouble ? 'Nur mit 2 Karten und ausreichend Guthaben' : undefined}>
                  Double
                </Button>
                <Button onClick={() => void act('split')} disabled={runner.busy || !canSplitNow} title={!canSplitNow ? 'Nur bei zwei gleichwertigen Karten' : undefined}>
                  Split
                </Button>
              </div>
            ) : (
              <Button variant="primary" size="lg" block loading={runner.busy} disabled={!!betError} onClick={() => void start()}>
                Karten austeilen
              </Button>
            )}
            {active && res && (
              <p className="small muted">
                Einsatz in dieser Runde: {formatCredits(round?.bet_amount)} Credits · Tastatur: H / S / D / P
              </p>
            )}
          </>
        }
        stage={
          <div
            className="stack-lg"
            style={{
              minHeight: 340,
              padding: 10,
              borderRadius: 14,
              background: 'radial-gradient(ellipse at 50% 0%, rgba(22,101,52,.55), rgba(5,46,22,.25) 70%)',
            }}
          >
            {!res ? (
              <div className="center subtle" style={{ padding: '80px 0' }}>
                Setze deinen Einsatz und teile die Karten aus.
              </div>
            ) : (
              <>
                <HandView
                  title="Dealer"
                  cards={dealerCards}
                  hiddenSecond={res.dealer.hidden}
                  total={dealerTotal !== null ? (res.dealer.hidden ? `${dealerTotal} + ?` : String(dealerTotal)) : undefined}
                />
                <div className={res.hands.length > 1 ? 'grid-2' : ''}>
                  {res.hands.map((h, i) => {
                    const t = bjTotal(h.cards);
                    return (
                      <HandView
                        key={i}
                        title={res.hands.length > 1 ? `Hand ${i + 1}` : 'Deine Hand'}
                        cards={h.cards}
                        total={`${t.soft && t.total < 21 ? `${t.total - 10}/` : ''}${t.total}`}
                        highlight={active && res.active_hand === i}
                        badge={
                          <>
                            <span className="badge">{formatCredits(h.bet)} Credits</span>
                            {h.outcome && (
                              <span className={`badge ${h.payout && h.payout > h.bet ? 'badge-gold' : h.outcome === 'push' ? '' : 'badge-danger'}`}>
                                {OUTCOME_LABEL[h.outcome]}
                              </span>
                            )}
                            {!h.outcome && h.status === 'bust' && <span className="badge badge-danger">Überkauft</span>}
                          </>
                        }
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>
        }
        recent={
          <RecentRounds
            rounds={runner.recent}
            label={(r) => (r.payout_amount > r.bet_amount ? `+${formatCredits(r.profit_amount)}` : r.payout_amount === r.bet_amount ? 'Push' : `−${formatCredits(r.bet_amount)}`)}
          />
        }
      />
    </>
  );
}
