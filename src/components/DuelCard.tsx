import type { Duel } from '../types';
import { dateLabel, fighterAbilityLine, fighterBreakdownLine, outcomeNotes, sideTotalLine } from '../duelcard';

/**
 * One stored duel. Shared by the saved list and the result screen so both show
 * exactly the same snapshot; only the delete action and the initial narrative
 * state differ.
 */
export default function DuelCard({
  duel,
  onDelete,
  narrativeOpen = false,
}: {
  duel: Duel;
  onDelete?: () => void;
  narrativeOpen?: boolean;
}) {
  const { sides, outcome } = duel;
  const breakdown = outcome.breakdown;
  const notes = outcomeNotes(outcome, sides);

  return (
    <div className="dw-card duel-card">
      <div>
        <div className="plan-title">{duel.title}</div>
        <div className="plan-meta">
          <span>Created {dateLabel(duel.created_at)}</span>
          {sides.terrain && <span>Terrain: {sides.terrain}</span>}
        </div>
      </div>

      <div className="duel-sides">
        {(['A', 'B'] as const).map((side) => (
          <div key={side} className={`duel-side${outcome.winnerSide === side ? ' is-winner' : ''}`}>
            <div className="duel-side__head">
              <span className="duel-side__label">Side {side}</span>
              {outcome.winnerSide === side && <span className="status-chip duel-winner">Winner</span>}
            </div>
            {(sides[side] ?? []).map((fighter, index) => {
              const abilities = fighterAbilityLine(fighter);
              return (
                <div className="duel-fighter" key={`${fighter.characterId}-${index}`}>
                  <span>{fighter.name}</span>
                  {fighter.dead && (
                    <span className="duel-dead" title="Dead" aria-label="dead">
                      {' '}
                      †
                    </span>
                  )}
                  {(fighter.items ?? []).length > 0 && (
                    <span className="duel-gear">
                      {' '}
                      · {(fighter.items ?? []).map((item) => item.name).join(', ')}
                    </span>
                  )}
                  {abilities && <div className="duel-fighter__abilities">Abilities: {abilities}</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {notes.length > 0 && (
        <div className="duel-notes">
          {notes.map((note) => (
            <div key={note} className="duel-note">
              {note}
            </div>
          ))}
        </div>
      )}

      <div className="duel-scoreboard">
        {(['A', 'B'] as const).map((side) => (
          <div key={side} className="duel-score">
            {(breakdown?.[side]?.fighters ?? []).map((fighter, index) => (
              <div className="duel-score__fighter" key={`${fighter.name}-${index}`}>
                {fighterBreakdownLine(fighter)}
              </div>
            ))}
            <div className="duel-score__side">
              Side {side}
              {breakdown?.[side]
                ? `: ${sideTotalLine(breakdown[side])}`
                : `: score ${outcome.scores?.[side] ?? 0}`}
            </div>
          </div>
        ))}
      </div>

      <details className="duel-narrative" open={narrativeOpen || undefined}>
        <summary>Read the account</summary>
        <p>{duel.narrative}</p>
      </details>

      {onDelete && (
        <div className="actions">
          <div style={{ flex: 1 }} />
          <button className="btn-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
