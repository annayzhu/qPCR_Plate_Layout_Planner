import assert from "node:assert/strict";
import test from "node:test";
import { buildPlateWorkbook, type ExportContext } from "../lib/exportExcel";
import { planPlateLayout } from "../lib/platePlanner";

test("plate workbook exports bilingual reaction totals and scoped requirement sheets", async () => {
  const layout = planPlateLayout({
    plateType: 96,
    samples: Array.from({ length: 8 }, (_, index) => `S${index + 1}`),
    targetGenes: ["G1", "G2", "G3"],
    referenceGenes: ["R1"],
    replicates: 3,
  });
  const plate = layout.plates[0];
  const context: ExportContext = {
    plateType: 96,
    replicates: 3,
    samples: Array.from({ length: 8 }, (_, index) => `S${index + 1}`),
    targetGenes: ["G1", "G2", "G3"],
    referenceGenes: ["R1"],
    strategyLabel: "按样本分块 / Sample-major",
    generatedAt: "2026-07-31 12:00:00",
    validationStatus: "Valid",
    splitSamples: 0,
    repeatedReferenceBlocks: 0,
    repeatedReferenceWells: 0,
    reactionSystem: {
      cdnaPerWellUl: 1,
      primerPairPerWellUl: 0.8,
      masterMixPerWellUl: 5,
      totalPerWellUl: 10,
      overagePercent: 10,
    },
  };

  const { XLSX, workbook } = await buildPlateWorkbook(
    { ...plate, confirmed: true },
    context,
  );

  assert.deepEqual(workbook.SheetNames, [
    "Plate_Map",
    "Well_Detail",
    "Design_Summary",
    "Reaction_Setup",
    "Total_Requirements",
    "Gene_Requirements",
    "Sample_cDNA",
  ]);
  assert.equal(workbook.Sheets.Total_Requirements.A4.v, "反应预混液 / Master mix");
  assert.equal(workbook.Sheets.Total_Requirements.B4.v, 480);
  assert.equal(workbook.Sheets.Total_Requirements.C4.v, 528);
  assert.equal(workbook.Sheets.Gene_Requirements.A1.v, "范围 / Scope");
  assert.equal(workbook.Sheets.Sample_cDNA.A1.v, "范围 / Scope");

  const serialized = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  const roundTripped = XLSX.read(serialized, { type: "buffer" });
  assert.ok(roundTripped.SheetNames.includes("Total_Requirements"));
});
