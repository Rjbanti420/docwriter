// The desktop bridge from electron/preload.cjs. In a plain browser none of it
// exists, so the flows that need a native dialog check for it and say so rather
// than failing halfway.

export type DesktopBridge = {
  saveTextFile: (name: string, text: string) => Promise<{ saved: boolean; filePath?: string }>;
  chooseBook: () => Promise<string | null>;
  chooseNewBook: () => Promise<string | null>;
  openBookAt: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  getKeys: () => Promise<Record<string, string>>;
  setKey: (
    id: string,
    accelerator: string
  ) => Promise<{ ok: boolean; keys?: Record<string, string>; error?: string }>;
  resetKeys: () => Promise<{ ok: boolean; keys: Record<string, string> }>;
};

export function desktop(): DesktopBridge | null {
  return (window as unknown as { docwriter?: DesktopBridge }).docwriter ?? null;
}

/** The native pickers. Resolves the chosen .db path, or null when cancelled. */
export async function pickBook(kind: 'open' | 'new'): Promise<string | null> {
  const bridge = desktop();
  if (!bridge) return null;
  return kind === 'open' ? bridge.chooseBook() : bridge.chooseNewBook();
}

/**
 * Restarts into that book. Resolves an error sentence, or null on success —
 * a success never returns, because the window is already gone.
 */
export async function openBookAt(filePath: string): Promise<string | null> {
  const bridge = desktop();
  if (!bridge) return 'Books can only be opened in the desktop app.';
  const result = await bridge.openBookAt(filePath);
  return result.ok ? null : result.error ?? 'Could not open that book.';
}
