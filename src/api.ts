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

export const api = {
  projects: () => req('/projects'),
  switchProject: (path: string) => req('/projects/switch', { method: 'POST', body: JSON.stringify({ path }) }),

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
  backup: () => req<any>('/backup', { method: 'GET' }),
  importBackup: (body:any) => req<any>('/backup/import', { method: 'POST', body: JSON.stringify(body) }),
};
