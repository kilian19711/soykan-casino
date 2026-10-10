// Eigene Seite für Daily Quests und Erfolge. Nicht in der Navigation – erreichbar über das Quest-Icon in der Kopfleiste.
import { useSearchParams } from 'react-router-dom';
import { AchievementGrid, QuestList } from './Quests';

export function QuestsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'erfolge' ? 'achievements' : 'quests';
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1>{tab === 'quests' ? 'Daily Quests' : 'Erfolge'}</h1>
          <p>{tab === 'quests' ? 'Jeden Tag 3 neue Aufgaben mit Belohnung.' : 'Jeder neue Erfolg bringt 100 Credits.'}</p>
        </div>
      </div>
      <div className="segmented" role="tablist" aria-label="Quests und Erfolge" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button type="button" role="tab" className="chip" aria-selected={tab === 'quests'} aria-pressed={tab === 'quests'} onClick={() => setParams({}, { replace: true })}>
          Daily Quests
        </button>
        <button type="button" role="tab" className="chip" aria-selected={tab === 'achievements'} aria-pressed={tab === 'achievements'} onClick={() => setParams({ tab: 'erfolge' }, { replace: true })}>
          Erfolge
        </button>
      </div>
      <section className="card">{tab === 'quests' ? <QuestList /> : <AchievementGrid />}</section>
    </div>
  );
}
