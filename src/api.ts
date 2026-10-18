async function req<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} ${body}`);
  }
  return res.json();
}

// Hand a text file to the platform, the way that platform expects it. Electron
// gets a real Save dialog through the preload bridge (electron/preload.cjs); a
// browser gets the File System Access picker; anything older gets a plain
// download. Returns false when the writer cancels the dialog.
async function saveTextFile(name: string, text: string): Promise<boolean> {
  const bridge = (
    window as unknown as {
      docwriter?: { saveTextFile?: (n: string, t: string) => Promise<{ saved: boolean }> };
    }
  ).docwriter;
  if (bridge?.saveTextFile) return !!(await bridge.saveTextFile(name, text)).saved;

  const picker = (
    window as unknown as {
      showSaveFilePicker?: (
        o: unknown
      ) => Promise<{ createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }>;
    }
  ).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return true;
    } catch (e) {
      // Cancelling is a decision, not an error; anything else falls through to a download.
      if ((e as { name?: string })?.name === 'AbortError') return false;
    }
  }

  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export const api = {
  projects: () => req('/projects'),

  types: () => req('/types'),
  powerLevels: () => req('/power-levels'),
  addPowerLevel: (name: string, color: string) =>
    req('/power-levels', { method: 'POST', body: JSON.stringify({ name, color }) }),
  updatePowerLevel: (id: number, patch: { name?: string; color?: string }) =>
    req(`/power-levels/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deletePowerLevel: (id: number) => req(`/power-levels/${id}`, { method: 'DELETE' }),
  chapters: () => req('/chapters'),
  chapter: (id: number) => req(`/chapters/${id}`),
  addChapter: (body: { number?: string; title?: string; text: string }) =>
    req('/chapters', { method: 'POST', body: JSON.stringify(body) }),
  updateChapter: (id: number, body: Record<string, unknown>) =>
    req(`/chapters/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteChapter: (id: number, renumber: boolean) =>
    req(`/chapters/${id}?renumber=${renumber ? 1 : 0}`, { method: 'DELETE' }),
  review: () => req('/review'),
  resolve: (id: number, body: Record<string, unknown>) =>
    req(`/candidates/${id}/resolve`, { method: 'POST', body: JSON.stringify(body) }),
  resolveMany: (ids: number[], action: string) =>
    req('/candidates/resolve', { method: 'POST', body: JSON.stringify({ ids, action }) }),

  guns: () => req('/guns'),
  gun: (id: number) => req(`/guns/${id}`),
  addGun: (body: Record<string, unknown>) =>
    req('/guns', { method: 'POST', body: JSON.stringify(body) }),
  updateGun: (id: number, body: Record<string, unknown>) =>
    req(`/guns/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGun: (id: number) => req(`/guns/${id}`, { method: 'DELETE' }),
  decideGun: (id: number, body: Record<string, unknown>) =>
    req(`/guns/${id}/decide`, { method: 'POST', body: JSON.stringify(body) }),
  fireGun: (id: number) => req(`/guns/${id}/fire`, { method: 'POST' }),
  reopenGun: (id: number) => req(`/guns/${id}/reopen`, { method: 'POST' }),

  questions: () => req('/questions'),
  addQuestion: (body: Record<string, unknown>) =>
    req('/questions', { method: 'POST', body: JSON.stringify(body) }),
  updateQuestion: (id: number, body: Record<string, unknown>) =>
    req(`/questions/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteQuestion: (id: number) => req(`/questions/${id}`, { method: 'DELETE' }),
  scanQuestions: (chapterIds: number[]) =>
    req('/questions/scan', { method: 'POST', body: JSON.stringify({ chapterIds }) }),
  questionCandidates: (status = 'pending') => req(`/questions/candidates?status=${status}`),
  resolveQuestionCandidate: (id: number, body: Record<string, unknown>) =>
    req(`/questions/candidates/${id}/resolve`, { method: 'POST', body: JSON.stringify(body) }),
  entities: () => req('/entities'),
  createEntity: (body: Record<string, unknown>) =>
    req('/entities', { method: 'POST', body: JSON.stringify(body) }),
  entity: (id: number) => req(`/entities/${id}`),
  updateEntity: (id: number, body: Record<string, unknown>) =>
    req(`/entities/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteEntity: (id: number) => req(`/entities/${id}`, { method: 'DELETE' }),
  trashEntities: (ids: number[]) =>
    req('/entities/trash', { method: 'POST', body: JSON.stringify({ ids }) }),
  addAlias: (id: number, alias: string) =>
    req(`/entities/${id}/aliases`, { method: 'POST', body: JSON.stringify({ alias }) }),
  removeAlias: (id: number, aliasId: number) => req(`/entities/${id}/aliases/${aliasId}`, { method: 'DELETE' }),
  // A absorbs B: everything B has moves onto A, B's card goes to Trash.
  mergeEntity: (id: number, absorbedId: number) =>
    req(`/entities/${id}/merge`, { method: 'POST', body: JSON.stringify({ absorbedId }) }),
  setAlertState: (id: number, state: string) =>
    req(`/alerts/${id}/state`, { method: 'POST', body: JSON.stringify({ state }) }),
  ignored: () => req('/ignored'),
  unignore: (id: number) => req(`/ignored/${id}`, { method: 'DELETE' }),
  trash: () => req('/trash'),
  restore: (id: number) => req(`/entities/${id}/restore`, { method: 'POST' }),
  // The export reminder's frequency and dates, kept in the book.
  meta: () => req('/meta'),
  setMeta: (patch: Record<string, string>) =>
    req('/meta', { method: 'PUT', body: JSON.stringify(patch) }),
  // The whole book as one Markdown file. Resolves true once it is on disk, false
  // when the writer cancelled the save dialog.
  exportMarkdown: async () => {
    const res = await fetch('/api/export');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
    const saved = await saveTextFile(filename || 'docwriter-export.md', await res.text());
    // Writing the file is the one event that satisfies the reminder, so the date
    // is stamped here rather than by each caller. "Today" comes from the server,
    // which is the same machine, so the two sides cannot disagree on the date.
    if (saved) {
      const { today } = await req<{ today: string }>('/meta');
      await req('/meta', { method: 'PUT', body: JSON.stringify({ last_export_at: today }) });
    }
    return saved;
  },
  // The backup is a whole SQLite file, not JSON, so it bypasses req() and saves
  // the bytes straight to disk.
  backup: async () => {
    const res = await fetch('/api/backup');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = 'docwriter-backup.db';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};
