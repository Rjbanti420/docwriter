import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { Duel } from '../types';
import DuelCard from './DuelCard';

/** Saved duels, newest first. Everything on the card comes from the stored snapshot. */
export default function DuelList({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [duels, setDuels] = useState<Duel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await api.duels();
      setDuels(list);
      onCountChange?.(list.length);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoaded(true);
    }
  }, [onCountChange]);

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
    return (
      <div className="empty-state">
        No duels yet. Any fight you run will be saved here with the account of how it went.
      </div>
    );
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
