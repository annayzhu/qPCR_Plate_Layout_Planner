import assert from "node:assert/strict";
import test from "node:test";
import {
  PlatePlannerError,
  planPlateLayout,
  validateLayout,
} from "../lib/platePlanner";

test("96-well layout avoids splitting samples when it is unnecessary", () => {
  const input = {
    plateType: 96 as const,
    samples: Array.from({ length: 10 }, (_, index) => `S${index + 1}`),
    targetGenes: ["G1", "G2", "G3"],
    referenceGenes: ["GAPDH"],
    replicates: 3,
  };
  const result = planPlateLayout(input);
  assert.equal(result.plates.length, 2);
  assert.equal(result.metrics.usedWells, 120);
  assert.equal(result.metrics.emptyWells, 72);
  assert.equal(result.metrics.splitSamples, 0);
  assert.equal(result.metrics.repeatedReferenceWells, 0);
  assert.deepEqual(result.plates[0].sampleNames, [
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
    "S6",
    "S7",
    "S8",
  ]);
  assert.equal(validateLayout(result, input).valid, true);
});

test("replicate groups run left-to-right and never wrap a row", () => {
  const input = {
    plateType: 96 as const,
    samples: ["S1", "S2"],
    targetGenes: ["G1", "G2"],
    referenceGenes: ["R1"],
    replicates: 5,
  };
  const result = planPlateLayout(input);
  for (const plate of result.plates) {
    const grouped = new Map<string, typeof plate.wells>();
    for (const well of plate.wells.filter((item) => item.sample && item.gene)) {
      const key = `${well.sample}-${well.gene}`;
      grouped.set(key, [...(grouped.get(key) ?? []), well]);
    }
    for (const wells of grouped.values()) {
      assert.equal(new Set(wells.map((well) => well.row)).size, 1);
      const columns = wells.map((well) => well.column).sort((a, b) => a - b);
      assert.deepEqual(
        columns,
        Array.from({ length: 5 }, (_, index) => columns[0] + index),
      );
    }
  }
});

test("fills a 96-well plate exactly for 8 samples, 4 genes, triplicates", () => {
  const result = planPlateLayout({
    plateType: 96,
    samples: Array.from({ length: 8 }, (_, index) => `S${index + 1}`),
    targetGenes: ["G1", "G2", "G3"],
    referenceGenes: ["R1"],
    replicates: 3,
  });
  assert.equal(result.plates.length, 1);
  assert.equal(result.metrics.usedWells, 96);
  assert.equal(result.metrics.emptyWells, 0);
});

test("supports multiple reference genes", () => {
  const input = {
    plateType: 384 as const,
    samples: ["A", "B", "C"],
    targetGenes: ["FBN2"],
    referenceGenes: ["TBP", "HPRT1", "RPLP0"],
    replicates: 2,
  };
  const result = planPlateLayout(input);
  const audit = validateLayout(result, input);
  assert.equal(audit.valid, true);
  for (const sample of input.samples) {
    for (const reference of input.referenceGenes) {
      assert.equal(
        result.plates[0].wells.filter(
          (well) => well.sample === sample && well.gene === reference,
        ).length,
        2,
      );
    }
  }
});

test("rejects a replicate group wider than one row", () => {
  assert.throws(
    () =>
      planPlateLayout({
        plateType: 96,
        samples: ["S1"],
        targetGenes: ["G1"],
        referenceGenes: ["R1"],
        replicates: 13,
      }),
    (error) =>
      error instanceof PlatePlannerError &&
      error.code === "E_REPLICATE_WIDER_THAN_ROW",
  );
});

test("splits one sample's target genes and repeats all references on the next plate", () => {
  const input = {
    plateType: 96 as const,
    samples: ["S1"],
    targetGenes: Array.from({ length: 31 }, (_, index) => `G${index + 1}`),
    referenceGenes: ["R1", "R2"],
    replicates: 3,
  };
  const result = planPlateLayout(input);
  assert.equal(result.plates.length, 2);
  assert.equal(result.metrics.splitSamples, 1);
  assert.equal(result.metrics.repeatedReferenceBlocks, 2);
  assert.equal(result.metrics.repeatedReferenceWells, 6);
  assert.equal(result.metrics.usedWells, 105);
  for (const plate of result.plates) {
    for (const reference of input.referenceGenes) {
      assert.equal(
        plate.wells.filter(
          (well) => well.sample === "S1" && well.gene === reference,
        ).length,
        input.replicates,
      );
    }
  }
  assert.equal(validateLayout(result, input).valid, true);
});

test("uses two plates by splitting a sample and rerunning its reference", () => {
  const input = {
    plateType: 96 as const,
    samples: ["S1", "S2", "S3"],
    targetGenes: Array.from({ length: 16 }, (_, index) => `G${index + 1}`),
    referenceGenes: ["R1"],
    replicates: 3,
  };
  const result = planPlateLayout(input);
  assert.equal(result.plates.length, 2);
  assert.equal(result.metrics.splitSamples, 1);
  assert.equal(result.metrics.repeatedReferenceBlocks, 1);
  assert.equal(result.metrics.usedWells, 156);

  const splitSample = input.samples.find(
    (sample) =>
      result.plates.filter((plate) =>
        plate.wells.some(
          (well) => well.sample === sample && well.geneType === "target",
        ),
      ).length === 2,
  );
  assert.ok(splitSample);
  for (const plate of result.plates) {
    if (
      plate.wells.some(
        (well) =>
          well.sample === splitSample && well.geneType === "target",
      )
    ) {
      assert.equal(
        plate.wells.filter(
          (well) => well.sample === splitSample && well.gene === "R1",
        ).length,
        input.replicates,
      );
    }
  }
  assert.equal(validateLayout(result, input).valid, true);
});

test("minimizes reference reruns within the same three-plate solution", () => {
  const input = {
    plateType: 96 as const,
    samples: ["S1", "S2", "S3", "S4"],
    targetGenes: Array.from({ length: 16 }, (_, index) => `G${index + 1}`),
    referenceGenes: ["R1", "R2"],
    replicates: 3,
  };
  const result = planPlateLayout(input);
  assert.equal(result.plates.length, 3);
  assert.equal(result.metrics.samplePlateAppearances, 5);
  assert.equal(result.metrics.splitSamples, 1);
  assert.equal(result.metrics.repeatedReferenceBlocks, 2);
  assert.equal(result.metrics.repeatedReferenceWells, 6);
  assert.equal(validateLayout(result, input).valid, true);
});

test("validation catches a missing same-plate reference block", () => {
  const input = {
    plateType: 96 as const,
    samples: ["S1"],
    targetGenes: ["G1"],
    referenceGenes: ["R1"],
    replicates: 3,
  };
  const result = planPlateLayout(input);
  result.plates[0].wells = result.plates[0].wells.map((well) =>
    well.gene === "R1"
      ? {
          ...well,
          sample: null,
          gene: null,
          geneType: null,
          replicateIndex: null,
          source: "manual" as const,
        }
      : well,
  );
  const audit = validateLayout(result, input);
  assert.equal(audit.valid, false);
  assert.ok(
    audit.errors.some((issue) => issue.code === "E_REFERENCE_COHERENCE"),
  );
});

test("validation catches a gene role mismatch", () => {
  const input = {
    plateType: 96 as const,
    samples: ["S1"],
    targetGenes: ["G1"],
    referenceGenes: ["R1"],
    replicates: 3,
  };
  const result = planPlateLayout(input);
  result.plates[0].wells = result.plates[0].wells.map((well) =>
    well.gene === "R1"
      ? { ...well, geneType: "target" as const, source: "manual" as const }
      : well,
  );
  const audit = validateLayout(result, input);
  assert.equal(audit.valid, false);
  assert.ok(
    audit.errors.some((issue) => issue.code === "E_GENE_TYPE_MISMATCH"),
  );
});

test("validation reports a completely removed target assay as a global error", () => {
  const input = {
    plateType: 96 as const,
    samples: ["S1"],
    targetGenes: ["G1", "G2"],
    referenceGenes: ["R1"],
    replicates: 3,
  };
  const result = planPlateLayout(input);
  result.plates[0].wells = result.plates[0].wells.map((well) =>
    well.sample === "S1" && well.gene === "G2"
      ? {
          ...well,
          sample: null,
          gene: null,
          geneType: null,
          replicateIndex: null,
          source: "manual" as const,
        }
      : well,
  );
  const audit = validateLayout(result, input);
  const missing = audit.errors.find(
    (issue) => issue.code === "E_REQUIRED_ASSAY_MISSING",
  );
  assert.equal(audit.valid, false);
  assert.equal(missing?.plateNumber, undefined);
});

test("layout is deterministic", () => {
  const input = {
    plateType: 96 as const,
    samples: ["S1", "S2", "S3", "S4"],
    targetGenes: ["G1", "G2"],
    referenceGenes: ["R1"],
    replicates: 3,
  };
  assert.deepEqual(planPlateLayout(input), planPlateLayout(input));
});
