export interface IdentifiedEntry {
  id: string;
}

export interface EntrySnapshot<TSample, TGene> {
  samples: TSample[];
  genes: TGene[];
}

export interface EntryHistory<TSample, TGene> {
  past: EntrySnapshot<TSample, TGene>[];
  present: EntrySnapshot<TSample, TGene>;
  future: EntrySnapshot<TSample, TGene>[];
  canUndo: boolean;
  canRedo: boolean;
}

const DEFAULT_HISTORY_LIMIT = 30;

function copySnapshot<TSample, TGene>(
  snapshot: EntrySnapshot<TSample, TGene>,
): EntrySnapshot<TSample, TGene> {
  return {
    samples: [...snapshot.samples],
    genes: [...snapshot.genes],
  };
}

function withCapabilities<TSample, TGene>(
  history: Omit<EntryHistory<TSample, TGene>, "canUndo" | "canRedo">,
): EntryHistory<TSample, TGene> {
  return {
    ...history,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}

export function createEntryHistory<TSample, TGene>(
  initial: EntrySnapshot<TSample, TGene>,
): EntryHistory<TSample, TGene> {
  return withCapabilities({
    past: [],
    present: copySnapshot(initial),
    future: [],
  });
}

export function recordEntryState<TSample, TGene>(
  history: EntryHistory<TSample, TGene>,
  next: EntrySnapshot<TSample, TGene>,
): EntryHistory<TSample, TGene> {
  return withCapabilities({
    past: [...history.past, copySnapshot(history.present)].slice(
      -DEFAULT_HISTORY_LIMIT,
    ),
    present: copySnapshot(next),
    future: [],
  });
}

export function undoEntryState<TSample, TGene>(
  history: EntryHistory<TSample, TGene>,
): EntryHistory<TSample, TGene> {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return withCapabilities({
    past: history.past.slice(0, -1),
    present: copySnapshot(previous),
    future: [copySnapshot(history.present), ...history.future],
  });
}

export function redoEntryState<TSample, TGene>(
  history: EntryHistory<TSample, TGene>,
): EntryHistory<TSample, TGene> {
  const next = history.future[0];
  if (!next) return history;
  return withCapabilities({
    past: [...history.past, copySnapshot(history.present)].slice(
      -DEFAULT_HISTORY_LIMIT,
    ),
    present: copySnapshot(next),
    future: history.future.slice(1),
  });
}

export function moveEntryById<TEntry extends IdentifiedEntry>(
  entries: readonly TEntry[],
  activeId: string,
  targetId: string,
): TEntry[] {
  const sourceIndex = entries.findIndex((entry) => entry.id === activeId);
  const targetIndex = entries.findIndex((entry) => entry.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return [...entries];
  }

  const reordered = [...entries];
  const [activeEntry] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, activeEntry);
  return reordered;
}

export function moveEntryByOffset<TEntry extends IdentifiedEntry>(
  entries: readonly TEntry[],
  activeId: string,
  offset: number,
): TEntry[] {
  const sourceIndex = entries.findIndex((entry) => entry.id === activeId);
  if (sourceIndex < 0) return [...entries];
  const targetIndex = sourceIndex + Math.sign(offset);
  if (targetIndex < 0 || targetIndex >= entries.length) return [...entries];
  return moveEntryById(entries, activeId, entries[targetIndex].id);
}
