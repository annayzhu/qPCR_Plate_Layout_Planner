import assert from "node:assert/strict";
import test from "node:test";
import {
  assignSelectedWells,
  rectangularWellIds,
  translateSelectedWells,
} from "../lib/manualLayout";
import { planPlateLayout } from "../lib/platePlanner";

function examplePlate() {
  return planPlateLayout({
    plateType: 96,
    samples: ["S1"],
    targetGenes: ["G1"],
    referenceGenes: ["R1"],
    replicates: 3,
  }).plates[0];
}

test("Shift-style rectangular selection returns a complete well range", () => {
  const plate = examplePlate();
  assert.deepEqual(rectangularWellIds(plate, "A1", "B2"), [
    "A1",
    "A2",
    "B1",
    "B2",
  ]);
});

test("editing one selected well does not update its replicate neighbours", () => {
  const plate = examplePlate();
  const originalGene =
    plate.wells.find((well) => well.wellId === "A2")?.gene ?? "R1";
  const replacementGene = originalGene === "G1" ? "R1" : "G1";
  const edited = assignSelectedWells(plate, ["A2"], {
    sample: "S1",
    gene: replacementGene,
    geneType: replacementGene === "R1" ? "reference" : "target",
  });

  assert.equal(
    edited.wells.find((well) => well.wellId === "A1")?.gene,
    originalGene,
  );
  assert.equal(
    edited.wells.find((well) => well.wellId === "A2")?.gene,
    replacementGene,
  );
  assert.equal(
    edited.wells.find((well) => well.wellId === "A3")?.gene,
    originalGene,
  );
  assert.equal(
    edited.wells.find((well) => well.wellId === "A2")?.source,
    "manual",
  );
});

test("selected wells move together and preserve their relative positions", () => {
  const plate = examplePlate();
  const moved = translateSelectedWells(plate, ["A1", "A2", "A3"], "C1");
  assert.equal(moved.ok, true);
  if (!moved.ok) return;

  assert.deepEqual(moved.movedWellIds, ["C1", "C2", "C3"]);
  for (const wellId of ["A1", "A2", "A3"]) {
    assert.equal(
      moved.plate.wells.find((well) => well.wellId === wellId)?.sample,
      null,
    );
  }
  assert.deepEqual(
    ["C1", "C2", "C3"].map(
      (wellId) =>
        moved.plate.wells.find((well) => well.wellId === wellId)
          ?.replicateIndex,
    ),
    [1, 2, 3],
  );
});

test("non-contiguous selections keep their gaps and collisions are reported", () => {
  const plate = examplePlate();
  const moved = translateSelectedWells(plate, ["A1", "A3"], "C1");
  assert.equal(moved.ok, true);
  if (moved.ok) {
    assert.deepEqual(moved.movedWellIds, ["C1", "C3"]);
    assert.equal(
      moved.plate.wells.find((well) => well.wellId === "C2")?.sample,
      null,
    );
  }

  const collision = translateSelectedWells(plate, ["A1", "A2", "A3"], "B1");
  assert.deepEqual(collision, {
    ok: false,
    reason: "collision",
    collisionWellIds: ["B1", "B2", "B3"],
  });
});
