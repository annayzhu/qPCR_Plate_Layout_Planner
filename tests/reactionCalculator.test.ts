import assert from "node:assert/strict";
import test from "node:test";
import { planPlateLayout } from "../lib/platePlanner";
import { calculateReactionRequirements } from "../lib/reactionCalculator";

test("calculates a conventional 10 µL per-well SYBR Green system", () => {
  const layout = planPlateLayout({
    plateType: 96,
    samples: ["S1", "S2"],
    targetGenes: ["G1", "G2"],
    referenceGenes: ["R1"],
    replicates: 3,
  });
  const result = calculateReactionRequirements(
    layout,
    {
      totalPerWellUl: 10,
      masterMixPerWellUl: 5,
      primerPairPerWellUl: 0.8,
      cdnaPerWellUl: 1,
      overagePercent: 10,
    },
    ["S1", "S2"],
    [
      { name: "G1", role: "target" },
      { name: "G2", role: "target" },
      { name: "R1", role: "reference" },
    ],
  );

  assert.equal(result.valid, true);
  assert.equal(result.totalWells, 18);
  assert.equal(result.waterPerWellUl, 3.2);
  assert.deepEqual(
    result.perWellRows.map((row) => row.volumeUl),
    [5, 0.4, 0.4, 1, 3.2],
  );
  assert.equal(result.sampleRequirements[0].wellCount, 9);
  assert.ok(
    Math.abs(result.sampleRequirements[0].recommendedCdnaUl - 9.9) <
      1e-9,
  );
  assert.equal(result.geneRequirements[0].wellCount, 6);
});

test("counts reference reruns from the actual cross-plate layout", () => {
  const targets = Array.from(
    { length: 32 },
    (_, index) => `G${index + 1}`,
  );
  const layout = planPlateLayout({
    plateType: 96,
    samples: ["S1"],
    targetGenes: targets,
    referenceGenes: ["R1"],
    replicates: 3,
  });
  const result = calculateReactionRequirements(
    layout,
    {
      totalPerWellUl: 10,
      masterMixPerWellUl: 5,
      primerPairPerWellUl: 0.8,
      cdnaPerWellUl: 1,
      overagePercent: 10,
    },
    ["S1"],
    [
      ...targets.map((name) => ({ name, role: "target" as const })),
      { name: "R1", role: "reference" },
    ],
  );

  assert.equal(layout.plates.length, 2);
  assert.equal(result.totalWells, 102);
  assert.equal(
    result.geneRequirements.find((item) => item.gene === "R1")?.wellCount,
    6,
  );
  assert.equal(result.sampleRequirements[0].theoreticalCdnaUl, 102);
  assert.ok(
    Math.abs(result.sampleRequirements[0].recommendedCdnaUl - 112.2) <
      1e-9,
  );
});

test("rejects a reaction system whose components exceed the total volume", () => {
  const layout = planPlateLayout({
    plateType: 96,
    samples: ["S1"],
    targetGenes: ["G1"],
    referenceGenes: ["R1"],
    replicates: 3,
  });
  const result = calculateReactionRequirements(
    layout,
    {
      totalPerWellUl: 10,
      masterMixPerWellUl: 5,
      primerPairPerWellUl: 0.8,
      cdnaPerWellUl: 4.3,
      overagePercent: 10,
    },
    ["S1"],
    [
      { name: "G1", role: "target" },
      { name: "R1", role: "reference" },
    ],
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("超过")));
});
