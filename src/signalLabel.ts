const LABELS: Record<string, string> = {
  frequent: 'appears often',
  'mid-sentence': 'mid-sentence',
  dialogue: 'in dialogue',
  'multi-word': 'multi-word',
  'common-word': 'common word',
  weak: 'weak guess',
};

const KIND_LABELS: Record<string, string> = {
  location: 'place word',
  organisation: 'organisation word',
  country: 'country word',
  item: 'item word',
  character: 'character word',
};

/** The scanner's signal codes, said in words a novelist can read. */
export function signalLabel(signal: string): string {
  if (signal.startsWith('keyword:')) {
    return KIND_LABELS[signal.slice(8)] ?? 'type word';
  }
  return LABELS[signal] ?? signal;
}
