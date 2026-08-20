import assert from "node:assert/strict";
import test from "node:test";
import {
  createEntryHistory,
  moveEntryById,
  moveEntryByOffset,
  recordEntryState,
  redoEntryState,
  undoEntryState,
} from "../lib/entryHistory";

interface NamedEntry {
  id: string;
  name: string;
}

const sample = (id: string): NamedEntry => ({ id, name: id.toUpperCase() });

test("restores a deleted parameter row and can redo the deletion", () => {
  const initial = createEntryHistory({
    samples: [sample("s1"), sample("s2")],
    genes: [sample("g1")],
  });
  const afterDelete = recordEntryState(initial, {
    samples: [sample("s1")],
    genes: [sample("g1")],
  });

  const undone = undoEntryState(afterDelete);
  assert.deepEqual(
    undone.present.samples.map((entry) => entry.id),
    ["s1", "s2"],
  );
  assert.equal(undone.canRedo, true);

  const redone = redoEntryState(undone);
  assert.deepEqual(
    redone.present.samples.map((entry) => entry.id),
    ["s1"],
  );
});

test("a new parameter change after undo clears the redo branch", () => {
  const initial = createEntryHistory({
    samples: [sample("s1")],
    genes: [sample("g1")],
  });
  const withSecondSample = recordEntryState(initial, {
    samples: [sample("s1"), sample("s2")],
    genes: [sample("g1")],
  });
  const undone = undoEntryState(withSecondSample);
  const branched = recordEntryState(undone, {
    samples: [sample("s1")],
    genes: [sample("g1"), sample("g2")],
  });

  assert.equal(branched.canRedo, false);
  assert.deepEqual(
    branched.present.genes.map((entry) => entry.id),
    ["g1", "g2"],
  );
});

test("moves a parameter row to the requested visible position", () => {
  const entries = [sample("s1"), sample("s2"), sample("s3"), sample("s4")];

  assert.deepEqual(
    moveEntryById(entries, "s4", "s2").map((entry) => entry.id),
    ["s1", "s4", "s2", "s3"],
  );
  assert.deepEqual(
    moveEntryById(entries, "s1", "s4").map((entry) => entry.id),
    ["s2", "s3", "s4", "s1"],
  );
});

test("supports keyboard offset moves and ignores unavailable destinations", () => {
  const entries = [sample("g1"), sample("g2"), sample("g3")];

  assert.deepEqual(
    moveEntryByOffset(entries, "g2", -1).map((entry) => entry.id),
    ["g2", "g1", "g3"],
  );
  assert.deepEqual(
    moveEntryByOffset(entries, "g2", 1).map((entry) => entry.id),
    ["g1", "g3", "g2"],
  );
  assert.deepEqual(
    moveEntryByOffset(entries, "g1", -1).map((entry) => entry.id),
    ["g1", "g2", "g3"],
  );
  assert.deepEqual(
    moveEntryById(entries, "g2", "g2").map((entry) => entry.id),
    ["g1", "g2", "g3"],
  );
  assert.deepEqual(
    moveEntryById(entries, "missing", "g2").map((entry) => entry.id),
    ["g1", "g2", "g3"],
  );
});

test("caps parameter undo history at thirty meaningful changes", () => {
  let history = createEntryHistory<NamedEntry, NamedEntry>({
    samples: [],
    genes: [],
  });
  for (let index = 1; index <= 35; index += 1) {
    history = recordEntryState(history, {
      samples: Array.from({ length: index }, (_, itemIndex) =>
        sample(`s${itemIndex + 1}`),
      ),
      genes: [],
    });
  }

  assert.equal(history.past.length, 30);
  assert.equal(history.present.samples.length, 35);
});
