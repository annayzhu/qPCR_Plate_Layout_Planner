import assert from "node:assert/strict";
import test from "node:test";
import { planPlateLayout } from "../lib/platePlanner";
import {
  calculateEightStripGeneMixRequirements,
  calculateReactionRequirements,
  normalizeReactionSystemInput,
  primerFinalConcentrationNm,
} from "../lib/reactionCalculator";

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
      forwardPrimerPerWellUl: 0.4,
      reversePrimerPerWellUl: 0.4,
      primerStockConcentrationUm: 10,
      cdnaPerWellUl: 1,
      overagePercent: 10,
      geneMixPreparationMode: "eight-strip",
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
  assert.equal(result.forwardPrimerFinalConcentrationNm, 400);
  assert.equal(result.reversePrimerFinalConcentrationNm, 400);
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
      forwardPrimerPerWellUl: 0.4,
      reversePrimerPerWellUl: 0.4,
      primerStockConcentrationUm: 10,
      cdnaPerWellUl: 1,
      overagePercent: 10,
      geneMixPreparationMode: "eight-strip",
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

test("replaces cDNA with water for Blank wells while preserving assay counts", () => {
  const layout = planPlateLayout({
    plateType: 96,
    samples: ["S1", "Blank 1"],
    targetGenes: ["G1", "G2"],
    referenceGenes: ["R1"],
    replicates: 3,
  });
  const result = calculateReactionRequirements(
    layout,
    {
      totalPerWellUl: 10,
      masterMixPerWellUl: 5,
      forwardPrimerPerWellUl: 0.4,
      reversePrimerPerWellUl: 0.4,
      primerStockConcentrationUm: 10,
      cdnaPerWellUl: 1,
      overagePercent: 10,
      geneMixPreparationMode: "eight-strip",
    },
    ["S1", "Blank 1"],
    [
      { name: "G1", role: "target" },
      { name: "G2", role: "target" },
      { name: "R1", role: "reference" },
    ],
    ["Blank 1"],
  );

  assert.equal(result.valid, true);
  assert.equal(result.totalWells, 18);
  assert.equal(result.blankWellCount, 9);
  assert.equal(result.sampleRequirements[0].recommendedCdnaUl, 9.9);
  assert.deepEqual(result.sampleRequirements[1], {
    sample: "Blank 1",
    wellCount: 9,
    isBlank: true,
    theoreticalCdnaUl: 0,
    recommendedCdnaUl: 0,
    replacementWaterUl: 9.9,
  });
  assert.ok(Math.abs(result.totals.cdnaUl - 9.9) < 1e-9);
  assert.ok(Math.abs(result.totals.waterUl - 73.26) < 1e-9);

  for (const requirement of result.geneRequirements) {
    assert.equal(requirement.wellCount, 6);
    assert.equal(requirement.blankWellCount, 3);
    assert.ok(Math.abs(requirement.waterUl - 24.42) < 1e-9);
  }
  assert.equal(
    result.warnings.some((warning) =>
      warning.includes("引物储备液浓度"),
    ),
    false,
  );
  assert.equal(
    result.warnings.some((warning) => warning.includes("cDNA 浓度")),
    false,
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
      forwardPrimerPerWellUl: 0.4,
      reversePrimerPerWellUl: 0.4,
      primerStockConcentrationUm: 10,
      cdnaPerWellUl: 4.3,
      overagePercent: 10,
      geneMixPreparationMode: "eight-strip",
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

test("calculates primer final concentration independently of overage and well count", () => {
  assert.equal(primerFinalConcentrationNm(10, 0.5, 20), 250);
  assert.equal(primerFinalConcentrationNm(5, 0.6, 20), 150);
});

test("calculates asymmetric forward and reverse primer inputs independently", () => {
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
      forwardPrimerPerWellUl: 0.3,
      reversePrimerPerWellUl: 0.5,
      primerStockConcentrationUm: 10,
      cdnaPerWellUl: 1,
      overagePercent: 10,
      geneMixPreparationMode: "eight-strip",
    },
    ["S1"],
    [
      { name: "G1", role: "target" },
      { name: "R1", role: "reference" },
    ],
  );

  assert.equal(result.valid, true);
  assert.equal(result.waterPerWellUl, 3.2);
  assert.equal(result.forwardPrimerFinalConcentrationNm, 300);
  assert.equal(result.reversePrimerFinalConcentrationNm, 500);
  assert.ok(Math.abs(result.totals.forwardPrimerUl - 1.98) < 1e-9);
  assert.ok(Math.abs(result.totals.reversePrimerUl - 3.3) < 1e-9);
});

test("rejects a zero primer solution concentration", () => {
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
      forwardPrimerPerWellUl: 0.4,
      reversePrimerPerWellUl: 0.4,
      primerStockConcentrationUm: 0,
      cdnaPerWellUl: 1,
      overagePercent: 10,
      geneMixPreparationMode: "eight-strip",
    },
    ["S1"],
    [
      { name: "G1", role: "target" },
      { name: "R1", role: "reference" },
    ],
  );

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("引物液浓度")));
});

test("fills the 10 µM default when restoring a legacy reaction setup", () => {
  const restored = normalizeReactionSystemInput({
    totalPerWellUl: 20,
    primerPairPerWellUl: 1,
  });
  assert.equal(restored.totalPerWellUl, 20);
  assert.equal(restored.forwardPrimerPerWellUl, 0.5);
  assert.equal(restored.reversePrimerPerWellUl, 0.5);
  assert.equal(restored.primerStockConcentrationUm, 10);
  assert.equal(restored.geneMixPreparationMode, "eight-strip");

  const explicit = normalizeReactionSystemInput({
    primerPairPerWellUl: 1,
    forwardPrimerPerWellUl: 0.3,
    reversePrimerPerWellUl: 0.5,
    primerStockConcentrationUm: 20,
    geneMixPreparationMode: "single-tube",
  });
  assert.equal(explicit.forwardPrimerPerWellUl, 0.3);
  assert.equal(explicit.reversePrimerPerWellUl, 0.5);
  assert.equal(explicit.primerStockConcentrationUm, 20);
  assert.equal(explicit.geneMixPreparationMode, "single-tube");
});

test("calculates 384-well A–H assay-mix aliquots from physical interleaved rows", () => {
  const samples = Array.from({ length: 10 }, (_, index) => `S${index + 1}`);
  const layout = planPlateLayout(
    {
      plateType: 384,
      samples,
      targetGenes: ["G1"],
      referenceGenes: ["R1"],
      replicates: 3,
    },
    {
      strategy: "gene-major",
      loadingPattern: "interleaved-8-channel",
    },
  );
  const input = normalizeReactionSystemInput({
    geneMixPreparationMode: "eight-strip",
  });
  const requirements = calculateEightStripGeneMixRequirements(
    layout.plates,
    layout.loadingPattern,
    input,
    ["S10"],
  );
  const target = requirements.find((requirement) => requirement.gene === "G1");

  assert.ok(target);
  assert.equal(target.transferCycles, 6);
  assert.equal(target.channels[0].destinationRows, "A/B");
  assert.equal(target.channels[0].pass1WellCount, 3);
  assert.equal(target.channels[0].pass2WellCount, 3);
  assert.equal(target.channels[0].wellCount, 6);
  assert.ok(Math.abs(target.channels[0].assayMixUl - 59.4) < 1e-9);
  assert.equal(target.channels[1].blankWellCount, 3);
  assert.ok(
    Math.abs(target.channels[1].blankReplacementWaterUl - 3.3) < 1e-9,
  );
  assert.equal(target.channels[2].wellCount, 3);
  assert.ok(Math.abs(target.channels[2].assayMixUl - 29.7) < 1e-9);
  assert.ok(Math.abs(target.totalAssayMixUl - 297) < 1e-9);
});

test("does not create eight-strip aliquots in single-tube mode", () => {
  const layout = planPlateLayout({
    plateType: 384,
    samples: ["S1"],
    targetGenes: ["G1"],
    referenceGenes: ["R1"],
    replicates: 3,
  });
  const input = normalizeReactionSystemInput({
    geneMixPreparationMode: "single-tube",
  });

  assert.deepEqual(
    calculateEightStripGeneMixRequirements(
      layout.plates,
      layout.loadingPattern,
      input,
    ),
    [],
  );
});
