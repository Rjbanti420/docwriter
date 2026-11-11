import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Duel } from '../types';
import DuelCard from './DuelCard';

/** Saved duels, newest first. Everything on the card comes from the stored snapshot. */
export default function DuelList() {
  const [duels, setDuels] = useState<Duel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setDuels(await api.duels());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(duel: Duel) {
    if (!confirm(`Delete "${duel.title}"? The saved account goes with it.`)) return;
    try {
      await api.deleteDuel(duel.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!loaded) {
    return (
      <p className="progress" style={{ marginTop: 0 }}>
        Loading duels…
      </p>
    );
  }
  if (error && duels.length === 0) {
    return <div className="dw-empty">Couldn’t load duels: {error}</div>;
  }
  if (duels.length === 0) {
    return <div className="dw-empty">No duels yet. Saved fights will appear here.</div>;
  }

  return (
    <>
      {error && (
        <div className="lookalike" role="status">
          {error}
        </div>
      )}
      <div className="list">
        {duels.map((duel) => (
          <DuelCard key={duel.id} duel={duel} onDelete={() => remove(duel)} />
        ))}
      </div>
    </>
  );
}
