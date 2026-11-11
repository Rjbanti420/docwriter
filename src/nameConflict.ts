import { api, ApiError } from './api';

export type ConflictChoice = { useExisting: true } | { name: string } | null;

// A create or accept can be refused with 409 plus the live card that already
// answers to that spelling. This is the one place the writer decides what to do.
export function askNameConflict(name: string, existingId: number): ConflictChoice {
  if (!Number.isFinite(existingId)) return null;
  if (confirm(`"${name}" already belongs to an existing card. Use that card instead?`)) {
    return { useExisting: true };
  }
  const next = prompt('Enter a different name for the new card:', `${name} (2)`);
  const trimmed = next?.trim();
  return trimmed ? { name: trimmed } : null;
}

// Create a card, resolving a duplicate name with the writer instead of failing.
// Returns null when the writer cancels, and `existing: true` when they chose the
// card that already owned the name.
export async function createEntityWithConflictPrompt(
  body: Record<string, unknown>
): Promise<{ id: number; existing: boolean } | null> {
  let payload = { ...body };
  for (;;) {
    try {
      const created = await api.createEntity(payload);
      return { id: Number(created.id), existing: false };
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      const existingId = Number((error.body as { entityId?: number } | null)?.entityId);
      const choice = askNameConflict(String(payload.name ?? ''), existingId);
      if (!choice) return null;
      if ('useExisting' in choice) return { id: existingId, existing: true };
      payload = { ...payload, name: choice.name };
    }
  }
}
