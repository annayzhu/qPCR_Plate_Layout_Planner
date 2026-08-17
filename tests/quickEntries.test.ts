import assert from "node:assert/strict";
import test from "node:test";
import {
  generateNumberedEntries,
  MAX_QUICK_ENTRY_COUNT,
  parseQuickEntryCount,
} from "../lib/quickEntries";

test("generates sequential sample and target assay names", () => {
  assert.deepEqual(generateNumberedEntries("S", 4), ["S1", "S2", "S3", "S4"]);
  assert.deepEqual(generateNumberedEntries("T", 3), ["T1", "T2", "T3"]);
});

test("accepts only bounded positive integer quick-entry counts", () => {
  assert.equal(parseQuickEntryCount(" 12 "), 12);
  assert.equal(parseQuickEntryCount("0"), null);
  assert.equal(parseQuickEntryCount("1.5"), null);
  assert.equal(parseQuickEntryCount(String(MAX_QUICK_ENTRY_COUNT + 1)), null);
  assert.deepEqual(generateNumberedEntries("S", MAX_QUICK_ENTRY_COUNT + 1), []);
});
