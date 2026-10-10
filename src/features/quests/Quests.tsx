// Daily Quests und Erfolge: Listen mit Fortschritt (Profil), Pop-up bei geschaffter Quest, Dashboard-Knopf.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Achievement, type DailyQuest } from '../../lib/api';
import { useAppData } from '../../app/AppData';
import { formatCredits, relativeTime } from '../../lib/format';
import { toAppError } from '../../lib/errors';
import { haptic, playTone } from '../../lib/misc';
import { Button } from '../../components/Button';
import { useToast } from '../../components/Toast';
import { Countdown } from '../../components/ui';
import { IconTarget, IconX } from '../../components/Icons';
import './quests.css';

const TIER_LABEL: Record<string, string> = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };

export function ProgressBar({ value, max, done }: { value: number; max: number; done?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={`q-bar ${done ? 'done' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Hook: Quests laden, beim Öffnen als gesehen markieren, Belohnung abholen. */
export function useDailyQuests(markSeen: boolean) {
  const { notificationsVersion, applyServerBalance, refreshDashboard } = useAppData();
  const [data, setData] = useState<{ resets_at: string; quests: DailyQuest[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api.getMyQuests();
      setData(r);
      setError(null);
      if (markSeen && r.quests.some((q) => !q.seen)) {
        await api.markQuestsSeen();
        void refreshDashboard();
      }
    } catch (e) {
      setError(toAppError(e).message);
    }
  }, [markSeen, refreshDashboard]);
  useEffect(() => {
    void load();
  }, [load, notificationsVersion]);
  const claim = useCallback(
    async (id: string) => {
      const r = await api.claimQuest(id);
      applyServerBalance(r.balance);
      playTone('win');
      haptic(20);
      await load();
      void refreshDashboard();
      return r;
    },
    [applyServerBalance, load, refreshDashboard],
  );
  return { data, error, reload: load, claim };
}

function formatProgress(q: DailyQuest) {
  if (q.metric === 'mult' || q.metric === 'bonus') return q.completed_at ? 'geschafft' : 'offen';
  return `${formatCredits(q.progress)} / ${formatCredits(q.target)}`;
}

export function QuestList() {
  const toast = useToast();
  const { data, error, reload, claim } = useDailyQuests(true);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <p className="small danger">{error}</p>;
  if (!data) return <div className="skeleton" style={{ height: 180 }} />;
  const done = data.quests.filter((q) => q.claimed_at).length;
  return (
    <div className="stack">
      <div className="row-between wrap small subtle">
        <span>
          {done} von {data.quests.length} abgeschlossen
        </span>
        <span>
          Neue Quests in <Countdown target={data.resets_at} onDone={() => void reload()} className="gold" />
        </span>
      </div>
      <ul className="q-list">
        {data.quests.map((q) => {
          const ready = !!q.completed_at && !q.claimed_at;
          return (
            <li key={q.id} className={`q-item tier-${q.tier} ${q.claimed_at ? 'claimed' : ''} ${ready ? 'ready' : ''}`}>
              <div className="q-head">
                <span className={`q-tier tier-${q.tier}`}>{TIER_LABEL[q.tier] ?? q.tier}</span>
                <span className="q-reward mono">+{formatCredits(q.reward)}</span>
              </div>
              <strong className="q-title">{q.title}</strong>
              <ProgressBar value={Number(q.progress)} max={Number(q.target)} done={!!q.completed_at} />
              <div className="row-between">
                <span className="small muted mono">{formatProgress(q)}</span>
                {q.claimed_at ? (
                  <span className="badge badge-success">Abgeholt</span>
                ) : ready ? (
                  <Button
                    size="sm"
                    variant="gold"
                    loading={busy === q.id}
                    onClick={async () => {
                      setBusy(q.id);
                      try {
                        await claim(q.id);
                        toast.win('Belohnung abgeholt', `+${formatCredits(q.reward)} Credits`);
                      } catch (e) {
                        toast.error('Nicht abgeholt', toAppError(e).message);
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Abholen
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="small muted">Jeden Tag um Mitternacht gibt es 3 neue Quests. Nicht abgeholte Belohnungen verfallen dann.</p>
    </div>
  );
}

export function AchievementGrid({ userId }: { userId?: string }) {
  const [list, setList] = useState<Achievement[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    api.getAchievements(userId).then(setList).catch(() => setList([]));
  }, [userId]);
  if (!list) return <div className="skeleton" style={{ height: 160 }} />;
  const unlocked = list.filter((a) => a.unlocked_at);
  const open = list
    .filter((a) => !a.unlocked_at)
    .sort((a, b) => progressShare(b) - progressShare(a));
  const visibleOpen = showAll ? open : open.slice(0, 6);
  return (
    <div className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <div className="row-between small subtle">
          <span>
            {unlocked.length} von {list.length} Erfolgen
          </span>
          <span>+100 Credits je neuem Erfolg</span>
        </div>
        <ProgressBar value={unlocked.length} max={list.length} />
      </div>
      {open.length > 0 && (
        <>
          <h3 className="label">Als Nächstes</h3>
          <div className="grid-2">
            {visibleOpen.map((a) => (
              <AchievementCard key={a.key} a={a} />
            ))}
          </div>
          {open.length > 6 && (
            <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Weniger anzeigen' : `Alle ${open.length} offenen Erfolge anzeigen`}
            </Button>
          )}
        </>
      )}
      {unlocked.length > 0 && (
        <>
          <h3 className="label">Freigeschaltet</h3>
          <div className="grid-2">
            {unlocked.map((a) => (
              <AchievementCard key={a.key} a={a} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function progressShare(a: Achievement) {
  if (a.metric === 'event') return -1;
  return Number(a.progress) / Math.max(1, Number(a.target));
}

function AchievementCard({ a }: { a: Achievement }) {
  const unlocked = !!a.unlocked_at;
  const isEvent = a.metric === 'event';
  return (
    <div className={`card-flat ach ${unlocked ? 'unlocked' : ''}`} title={a.description}>
      <span className="ach-icon" aria-hidden="true">
        {a.icon}
      </span>
      <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
        <div className="row-between" style={{ gap: 6 }}>
          <strong className="small truncate">{a.title}</strong>
          {unlocked && a.reward > 0 && <span className="small gold mono">+{a.reward}</span>}
        </div>
        <div className="small muted">{unlocked ? `freigeschaltet ${relativeTime(a.unlocked_at!)}` : a.description}</div>
        {!unlocked && !isEvent && (
          <>
            <ProgressBar value={Number(a.progress)} max={Number(a.target)} />
            <span className="small muted mono">
              {formatCredits(Number(a.progress))} / {formatCredits(Number(a.target))}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** Kleiner Knopf im Dashboard: leuchtet rot, solange neue Quests ungesehen sind. */
export function QuestButton() {
  const { dashboard } = useAppData();
  const unseen = dashboard?.quests?.unseen ?? false;
  const claimable = dashboard?.quests?.claimable ?? 0;
  return (
    <Link
      to="/quests"
      className={`icon-btn quest-btn ${unseen ? 'glow' : ''}`}
      aria-label={`Daily Quests${unseen ? ', neue Quests verfügbar' : ''}${claimable ? `, ${claimable} Belohnung abholbar` : ''}`}
      title="Daily Quests"
    >
      <IconTarget />
      {claimable > 0 && <span className="dot gold-dot">{claimable}</span>}
    </Link>
  );
}

const POPUP_MS = 5000;

/** Pop-up, wenn eine Quest geschafft wurde. Schließt nach 5 s, außer man interagiert. */
export function QuestPopup() {
  const { questEvent, clearQuestEvent, applyServerBalance, refreshDashboard } = useAppData();
  const toast = useToast();
  const [hold, setHold] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setHold(false);
    if (!questEvent) return;
    playTone('win');
    haptic(30);
  }, [questEvent]);
  useEffect(() => {
    if (!questEvent || hold) return;
    const t = window.setTimeout(clearQuestEvent, POPUP_MS);
    return () => window.clearTimeout(t);
  }, [questEvent, hold, clearQuestEvent]);
  if (!questEvent) return null;
  return (
    <div
      className="quest-popup"
      role="status"
      aria-live="polite"
      onPointerDown={() => setHold(true)}
      onFocus={() => setHold(true)}
      key={questEvent.id}
    >
      <button type="button" className="quest-popup-close" aria-label="Schließen" onClick={clearQuestEvent}>
        <IconX size={16} />
      </button>
      <div className="row" style={{ gap: 12 }}>
        <span className="quest-popup-icon" aria-hidden="true">
          <IconTarget size={26} />
        </span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="label gold">Quest geschafft!</div>
          <strong className="small">{questEvent.title}</strong>
          <div className="quest-popup-amount mono">+{formatCredits(questEvent.amount)} Credits</div>
        </div>
      </div>
      <Button
        variant="gold"
        block
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api.claimQuest(questEvent.questId);
            applyServerBalance(r.balance);
            toast.win('Belohnung abgeholt', `+${formatCredits(r.amount)} Credits`);
            void refreshDashboard();
            clearQuestEvent();
          } catch (e) {
            toast.error('Nicht abgeholt', toAppError(e).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        +{formatCredits(questEvent.amount)} Credits abholen
      </Button>
      {!hold && <span className="quest-popup-timer" style={{ animationDuration: `${POPUP_MS}ms` }} />}
    </div>
  );
}
