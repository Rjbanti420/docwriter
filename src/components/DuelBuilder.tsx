import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { createEntityWithConflictPrompt } from '../nameConflict';
import DuelCard from './DuelCard';
import { parseFields } from '../entityMedia';
import { getDeath } from '../entityRelations';
import type { Duel, Entity, Type } from '../types';
import {
  MAX_ABILITIES,
  MAX_FIGHTERS_PER_SIDE,
  MAX_TERRAIN,
  addFighter,
  buildDuelPayload,
  emptyBuilderState,
  itemSharedOnSide,
  itemUsedByOtherSide,
  missingForDuel,
  pickTerrain,
  pruneBuilder,
  readableServerError,
  removeFighter,
  resolveOutcome,
  setCustomTerrain,
  setTerrainMode,
  toggleAbility,
  toggleItem,
  withRandomTerrain,
} from '../duelbuilder';
import type { BuilderState, DuelSideKey, SkillAnswer, WinnerAnswer } from '../duelbuilder';

interface AbilityView {
  id: string;
  name: string;
}

interface ItemView {
  id: number;
  name: string;
  rank: string;
  role: string;
  owners: number[];
}

interface CharacterView {
  id: number;
  name: string;
  dead: boolean;
  abilities: AbilityView[];
  items: ItemView[];
}

const ROLE_LABELS: Record<string, string> = {
  offense: 'Offense',
  defense: 'Defense',
  both: 'Both',
  none: 'None',
};

function readAbilities(raw: string): AbilityView[] {
  const list = parseFields(raw).abilities;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const ability = entry as Record<string, unknown>;
    const id = typeof ability.id === 'string' || typeof ability.id === 'number' ? String(ability.id) : '';
    const name = typeof ability.name === 'string' ? ability.name.trim() : '';
    return id && name ? [{ id, name }] : [];
  });
}

/**
 * The duel route accepts ownership from `fields.owners` only. EntityPanel also
 * folds the older single `owner` key; using it here would offer an Item the
 * server then refuses, so the builder stays on the route's rule.
 */
function readOwnerIds(raw: string): number[] {
  const list = parseFields(raw).owners;
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(Number).filter((id) => Number.isFinite(id)))];
}

function readRole(value: unknown): string {
  return typeof value === 'string' ? ROLE_LABELS[value] ?? 'Both' : 'Both';
}

function CharacterPicker({
  side,
  characters,
  selectedIds,
  onPick,
  onCreate,
  onCancel,
}: {
  side: DuelSideKey;
  characters: CharacterView[];
  selectedIds: Set<number>;
  onPick: (id: number) => void;
  onCreate: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const available = characters.filter((character) => !selectedIds.has(character.id));
  const query = filter.trim().toLowerCase();
  const shown = query
    ? available.filter((character) => character.name.toLowerCase().includes(query))
    : available;

  async function submitNew() {
    if (busy) return;
    const name = newName.trim();
    if (!name) {
      setError('Enter a name first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onCreate(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="duel-picker">
      <div className="duel-picker__head">
        <span className="duel-side__label">Add to Side {side}</span>
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <input
        className="dw-ie__input"
        value={filter}
        onChange={(ev) => setFilter(ev.target.value)}
        placeholder="Filter characters…"
        aria-label="Filter characters"
        autoFocus
      />
      <div className="dw-ie__dropdown duel-picker__list" role="listbox" aria-label={`Characters for side ${side}`}>
        {shown.map((character) => (
          <button
            type="button"
            className="dw-ie__option"
            role="option"
            aria-selected={false}
            key={character.id}
            onClick={() => onPick(character.id)}
          >
            <span className="dw-ie__name">{character.name}</span>
            {character.dead && (
              <span className="duel-dead" title="Dead" aria-label="dead">
                †
              </span>
            )}
          </button>
        ))}
        {shown.length === 0 && (
          <div className="dw-ie__empty">
            {available.length === 0 ? 'Everyone is already in the duel.' : 'No characters match that filter.'}
          </div>
        )}
      </div>
      {newOpen ? (
        <form
          className="duel-picker__new"
          onSubmit={(ev) => {
            ev.preventDefault();
            submitNew();
          }}
        >
          <input
            className="dw-ie__input"
            value={newName}
            onChange={(ev) => setNewName(ev.target.value)}
            placeholder="New character name"
            aria-label="New character name"
            autoFocus
          />
          <button type="submit" className="btn-secondary" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setNewOpen(false);
              setNewName('');
              setError('');
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="dw-ie__link" onClick={() => setNewOpen(true)}>
          New character…
        </button>
      )}
      {error && (
        <span className="dw-ie__hint" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function OutcomeDialog({
  step,
  namesA,
  namesB,
  onWinner,
  onSkill,
  onCancel,
}: {
  step: 'winner' | 'skill';
  namesA: string;
  namesB: string;
  onWinner: (answer: WinnerAnswer) => void;
  onSkill: (answer: SkillAnswer) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const title =
    step === 'winner' ? 'Do you want one side to win?' : 'Who is more skilled with their abilities and items?';

  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
        </div>
        <div className="modal-body">
          <p className="plan-note">
            {step === 'winner'
              ? 'The chosen side is guaranteed to win. The fight still plays out as a real contest.'
              : 'The skilled side fights at its best; the other fights like an ordinary user.'}
          </p>
          <div className="duel-choices">
            {step === 'winner' ? (
              <>
                <button className="btn-secondary duel-choice" onClick={() => onWinner('A')}>
                  {namesA} wins
                </button>
                <button className="btn-secondary duel-choice" onClick={() => onWinner('B')}>
                  {namesB} wins
                </button>
                <button className="btn-secondary duel-choice" onClick={() => onWinner('none')}>
                  No, leave it to chance
                </button>
              </>
            ) : (
              <>
                <button className="btn-secondary duel-choice" onClick={() => onSkill('A')}>
                  {namesA}
                </button>
                <button className="btn-secondary duel-choice" onClick={() => onSkill('B')}>
                  {namesB}
                </button>
                <button className="btn-secondary duel-choice" onClick={() => onSkill('neither')}>
                  Neither
                </button>
              </>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function DuelBuilder({
  entities,
  types,
  onOpenEntity,
  onChanged,
  onDirtyChange,
  onBack,
}: {
  entities: Entity[];
  types: Type[];
  onOpenEntity: (id: number) => void;
  onChanged: () => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onBack: () => void;
}) {
  // A freshly created Character is not in `entities` until App refreshes. Keep
  // the server-confirmed row locally so the seat renders immediately; the real
  // row wins as soon as it arrives.
  const [created, setCreated] = useState<Entity[]>([]);
  const [picker, setPicker] = useState<{ side: DuelSideKey } | null>(null);
  const [dialog, setDialog] = useState<'winner' | 'skill' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<Duel | null>(null);
  const [generated, setGenerated] = useState(false);
  const submitLock = useRef(false);
  const characterType = types.find((type) => type.name === 'Character');

  const allEntities = useMemo(() => {
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    for (const entity of created) if (!byId.has(entity.id)) byId.set(entity.id, entity);
    return [...byId.values()];
  }, [entities, created]);

  useEffect(() => {
    setCreated((previous) => {
      const next = previous.filter((entity) => !entities.some((row) => row.id === entity.id));
      return next.length === previous.length ? previous : next;
    });
  }, [entities]);

  const items = useMemo(
    () =>
      allEntities
        .filter((entity) => entity.type_name === 'Item')
        .map((entity) => {
          const fields = parseFields(entity.fields);
          const rank = typeof fields.rank === 'string' && fields.rank.trim() ? fields.rank : 'Unranked';
          return {
            id: entity.id,
            name: entity.name,
            rank,
            role: readRole(fields.role),
            owners: readOwnerIds(entity.fields),
          };
        }),
    [allEntities]
  );

  const characters = useMemo(
    () =>
      allEntities
        .filter((entity) => entity.type_name === 'Character')
        .map((entity) => ({
          id: entity.id,
          name: entity.name,
          dead: getDeath(entity.fields) !== null,
          abilities: readAbilities(entity.fields),
          items: items.filter((item) => item.owners.includes(entity.id)),
        })),
    [allEntities, items]
  );

  const characterById = useMemo(() => new Map(characters.map((character) => [character.id, character])), [
    characters,
  ]);
  const locationNames = allEntities
    .filter((entity) => entity.type_name === 'Location')
    .map((entity) => entity.name);

  const [state, setState] = useState<BuilderState>(() => emptyBuilderState(pickTerrain(locationNames)));
  // A saved setup stays quiet until something actually changes. A state edit
  // (including a loadout pruned by an entity change) re-arms the confirmation;
  // Change setup alone does not.
  const lastState = useRef(state);
  useEffect(() => {
    if (lastState.current === state) return;
    lastState.current = state;
    if (generated) setGenerated(false);
  }, [state, generated]);
  const selectedIds = new Set([...state.sides.A, ...state.sides.B].map((fighter) => fighter.characterId));

  const inventories = useMemo(
    () =>
      characters.map((character) => ({
        id: character.id,
        abilityIds: character.abilities.map((ability) => ability.id),
        itemIds: character.items.map((item) => item.id),
      })),
    [characters]
  );

  useEffect(() => {
    setState((previous) => pruneBuilder(previous, inventories));
  }, [inventories]);

  const hasFighters = state.sides.A.length + state.sides.B.length > 0;
  const dirty = hasFighters && !generated;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  function leave() {
    if (dirty && !confirm('Leave the duel builder? Nothing is saved.')) return;
    onBack();
  }

  function pickFighter(side: DuelSideKey, id: number) {
    setState((previous) => {
      try {
        return addFighter(previous, side, id);
      } catch {
        return previous;
      }
    });
    setPicker(null);
  }

  async function createCharacter(side: DuelSideKey, name: string) {
    if (!characterType) throw new Error('The Character type is missing.');
    const createdEntity = await createEntityWithConflictPrompt({ name, typeId: characterType.id });
    if (!createdEntity) return;
    const id = createdEntity.id;
    if (!Number.isFinite(id)) throw new Error('The server did not return a character id.');
    let character: Entity;
    if (createdEntity.existing) {
      character = (await api.entity(id)).entity;
      if (character.type_id !== characterType.id) {
        alert('That name belongs to a different kind of card.');
        return;
      }
      if (selectedIds.has(id)) {
        alert('That character is already in this duel.');
        return;
      }
    } else {
      character = {
        id,
        name,
        type_id: characterType.id,
        summary: '',
        fields: '{}',
        tracking: 'off',
        gap_threshold: null,
        type_name: 'Character',
        type_icon: characterType.icon,
        type_color: characterType.color,
      };
      setCreated((previous) => [...previous, character]);
    }
    setState((previous) => addFighter(previous, side, id));
    setPicker(null);
    onChanged();
  }

  const missing = missingForDuel(state);
  const namesFor = (side: DuelSideKey) =>
    state.sides[side]
      .map((fighter) => characterById.get(fighter.characterId)?.name)
      .filter((name): name is string => Boolean(name))
      .join(' + ') || 'this side';

  function newDuel() {
    setResult(null);
    setGenerated(false);
    setSubmitting(false);
    setSubmitError('');
    setDialog(null);
    setPicker(null);
    setState(emptyBuilderState(pickTerrain(locationNames)));
  }

  function changeSetup() {
    setResult(null);
    setSubmitError('');
    setDialog(null);
  }

  async function submitDuel(choice: { chosenWinner: DuelSideKey | null; skilledSide: DuelSideKey | null }) {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      const duel = await api.createDuel(buildDuelPayload({ ...state, ...choice }));
      setResult(duel);
      setGenerated(true);
    } catch (error) {
      const itemNames = new Map(items.map((item) => [item.id, item.name]));
      const abilityNames = new Map<string, string>();
      for (const character of characters) {
        for (const ability of character.abilities) abilityNames.set(ability.id, ability.name);
      }
      setSubmitError(readableServerError(error, { items: itemNames, abilities: abilityNames }));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function pickWinner(answer: WinnerAnswer) {
    if (answer === 'none') {
      setDialog('skill');
      return;
    }
    setDialog(null);
    submitDuel(resolveOutcome(answer));
  }

  function pickSkill(answer: SkillAnswer) {
    setDialog(null);
    submitDuel(resolveOutcome('none', answer));
  }

  function openGenerate() {
    if (missing.length > 0 || submitting || dialog) return;
    setSubmitError('');
    setDialog('winner');
  }

  if (result) {
    return (
      <div className="duel-builder duel-result">
        <div className="duel-builder__head">
          <div>
            <h2 className="duel-builder__title">Duel saved</h2>
            <p className="plan-note">This account is stored. Nothing here will be recomputed.</p>
          </div>
        </div>
        <DuelCard duel={result} narrativeOpen />
        <div className="duel-result__actions">
          <button className="btn-secondary" onClick={newDuel}>
            New duel
          </button>
          <button className="btn-secondary" onClick={changeSetup}>
            Change setup
          </button>
          <button className="btn-primary" onClick={onBack}>
            Back to Duels
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="duel-builder">
      <div className="duel-builder__head">
        <button className="btn-secondary" onClick={leave} title="Back to saved duels">
          ← Back
        </button>
        <div>
          <h2 className="duel-builder__title">New duel</h2>
          <p className="plan-note">
            Choose the fighters, then tick their abilities and items. Nothing is chosen for you.
          </p>
        </div>
      </div>

      <section className="card duel-builder__section" aria-labelledby="duel-opponents">
        <div className="duel-builder__section-head">
          <div>
            <h3 id="duel-opponents" className="plan-title">
              Opponents
            </h3>
            <p className="plan-note">One to three fighters a side. Dead characters are marked †.</p>
          </div>
          <span className="progress">
            {state.sides.A.length + state.sides.B.length} / {MAX_FIGHTERS_PER_SIDE * 2} chosen
          </span>
        </div>

        <div className="duel-builder__sides">
          {(['A', 'B'] as const).map((side) => (
            <div className="duel-builder__side" key={side}>
              <div className="duel-builder__side-head">
                <span className="duel-side__label">Side {side}</span>
                <span className="progress">
                  {state.sides[side].length} / {MAX_FIGHTERS_PER_SIDE}
                </span>
              </div>
              {state.sides[side].map((fighter) => {
                const character = characterById.get(fighter.characterId);
                if (!character) return null;
                return (
                  <div className="duel-builder__fighter" key={fighter.characterId}>
                    <span className="duel-builder__fighter-name">
                      {character.name}
                      {character.dead && (
                        <span className="duel-dead" title="Dead" aria-label="dead">
                          {' '}
                          †
                        </span>
                      )}
                    </span>
                    <button className="dw-ie__link" onClick={() => onOpenEntity(character.id)}>
                      Open
                    </button>
                    <button
                      className="ghost"
                      onClick={() => setState((previous) => removeFighter(previous, side, character.id))}
                      title="Remove"
                      aria-label={`Remove ${character.name}`}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              {state.sides[side].length < MAX_FIGHTERS_PER_SIDE &&
                (picker?.side === side ? (
                  <CharacterPicker
                    side={side}
                    characters={characters}
                    selectedIds={selectedIds}
                    onPick={(id) => pickFighter(side, id)}
                    onCreate={(name) => createCharacter(side, name)}
                    onCancel={() => setPicker(null)}
                  />
                ) : (
                  <button className="btn-secondary" onClick={() => setPicker({ side })}>
                    ＋ Add fighter
                  </button>
                ))}
              {state.sides[side].length >= MAX_FIGHTERS_PER_SIDE && (
                <span className="dw-ie__hint">Side {side} is full.</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card duel-builder__section" aria-labelledby="duel-loadout">
        <div className="duel-builder__section-head">
          <div>
            <h3 id="duel-loadout" className="plan-title">
              Loadout
            </h3>
            <p className="plan-note">Up to three abilities count. An Item can be shared on one side, never across sides.</p>
          </div>
        </div>

        {!hasFighters ? (
          <div className="dw-empty">Add fighters above to choose their abilities and items.</div>
        ) : (
          <div className="duel-builder__loadouts">
            {(['A', 'B'] as const).flatMap((side) =>
              state.sides[side].map((fighter) => {
                const character = characterById.get(fighter.characterId);
                if (!character) return null;
                const atAbilityCap = fighter.abilityIds.length >= MAX_ABILITIES;
                return (
                  <div className="duel-builder__loadout" key={`${side}-${fighter.characterId}`}>
                    <div className="duel-builder__loadout-head">
                      <span className="duel-side__label">Side {side}</span>
                      <strong>{character.name}</strong>
                      {character.dead && (
                        <span className="duel-dead" title="Dead" aria-label="dead">
                          †
                        </span>
                      )}
                      <div style={{ flex: 1 }} />
                      <button className="dw-ie__link" onClick={() => onOpenEntity(character.id)}>
                        Open
                      </button>
                    </div>

                    {character.abilities.length === 0 && character.items.length === 0 ? (
                      <div className="duel-builder__empty">
                        No abilities or items yet.{' '}
                        <button className="dw-ie__link" onClick={() => onOpenEntity(character.id)}>
                          Edit abilities &amp; items
                        </button>
                      </div>
                    ) : (
                      <div className="duel-builder__loadout-cols">
                        <div className="field">
                          <label>Abilities</label>
                          {character.abilities.length === 0 ? (
                            <div className="duel-builder__empty">
                              No abilities yet.{' '}
                              <button className="dw-ie__link" onClick={() => onOpenEntity(character.id)}>
                                Edit abilities &amp; items
                              </button>
                            </div>
                          ) : (
                            <div className="duel-builder__checks">
                              {character.abilities.map((ability) => {
                                const checked = fighter.abilityIds.includes(ability.id);
                                const disabled = !checked && atAbilityCap;
                                return (
                                  <label
                                    className={`duel-check${disabled ? ' is-blocked' : ''}`}
                                    key={ability.id}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={disabled}
                                      onChange={() =>
                                        setState((previous) =>
                                          toggleAbility(previous, side, character.id, ability.id)
                                        )
                                      }
                                    />
                                    <span className="duel-check__name">{ability.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {atAbilityCap && <span className="dw-ie__hint">Up to 3 abilities count.</span>}
                        </div>

                        <div className="field">
                          <label>Items</label>
                          {character.items.length === 0 ? (
                            <div className="duel-builder__empty">
                              No items yet.{' '}
                              <button className="dw-ie__link" onClick={() => onOpenEntity(character.id)}>
                                Edit abilities &amp; items
                              </button>
                            </div>
                          ) : (
                            <div className="duel-builder__checks">
                              {character.items.map((item) => {
                                const checked = fighter.itemIds.includes(item.id);
                                const blocked = itemUsedByOtherSide(state, side, item.id);
                                const shared = itemSharedOnSide(state, side, item.id, character.id);
                                return (
                                  <label
                                    className={`duel-check${blocked ? ' is-blocked' : ''}`}
                                    key={item.id}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={blocked}
                                      onChange={() =>
                                        setState((previous) => toggleItem(previous, side, character.id, item.id))
                                      }
                                    />
                                    <span className="duel-check__text">
                                      <span className="duel-check__name">{item.name}</span>
                                      <span className="duel-check__meta">
                                        {item.rank} · {item.role}
                                      </span>
                                    </span>
                                    {blocked ? (
                                      <span className="duel-check__note">Used by the other side</span>
                                    ) : shared ? (
                                      <span className="duel-check__note">shared</span>
                                    ) : null}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>

      <section className="card duel-builder__section" aria-labelledby="duel-terrain">
        <div className="duel-builder__section-head">
          <div>
            <h3 id="duel-terrain" className="plan-title">
              Terrain
            </h3>
            <p className="plan-note">One shared setting for the whole duel. It is flavour, not odds.</p>
          </div>
        </div>
        <div className="field" style={{ maxWidth: 560 }}>
          <div className="segmented" role="group" aria-label="Terrain source">
            <button
              type="button"
              className={state.terrain.mode === 'random' ? 'active' : ''}
              aria-pressed={state.terrain.mode === 'random'}
              onClick={() => setState((previous) => withRandomTerrain(previous, locationNames))}
            >
              Random
            </button>
            <button
              type="button"
              className={state.terrain.mode === 'custom' ? 'active' : ''}
              aria-pressed={state.terrain.mode === 'custom'}
              onClick={() => setState((previous) => setTerrainMode(previous, 'custom'))}
            >
              Custom
            </button>
          </div>
          {state.terrain.mode === 'random' ? (
            <div className="duel-builder__terrain">
              <span>{state.terrain.randomName}</span>
              <button
                className="btn-secondary"
                onClick={() => setState((previous) => withRandomTerrain(previous, locationNames))}
              >
                Re-roll
              </button>
            </div>
          ) : (
            <>
              <input
                className="dw-ie__input"
                value={state.terrain.custom}
                maxLength={MAX_TERRAIN}
                onChange={(ev) => setState((previous) => setCustomTerrain(previous, ev.target.value))}
                placeholder="Describe the ground (optional)"
                aria-label="Terrain description"
              />
              <span className="duel-builder__counter">
                {state.terrain.custom.length}/{MAX_TERRAIN}
              </span>
              {!state.terrain.custom.trim() && (
                <span className="dw-ie__hint">Blank means no terrain.</span>
              )}
            </>
          )}
        </div>
      </section>

      {submitError && (
        <div className="lookalike" role="alert">
          {submitError}
        </div>
      )}

      <div className="duel-builder__foot">
        <div className="duel-builder__missing" role="status">
          {missing.length > 0 ? missing.join(' · ') : 'Both sides are ready.'}
        </div>
        <button className="btn-primary" disabled={missing.length > 0 || submitting} onClick={openGenerate}>
          {submitting ? 'Generating…' : 'Generate duel'}
        </button>
      </div>

      {dialog && (
        <OutcomeDialog
          step={dialog}
          namesA={namesFor('A')}
          namesB={namesFor('B')}
          onWinner={pickWinner}
          onSkill={pickSkill}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
