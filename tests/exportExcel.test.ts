import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlateWorkbook,
  overviewWorkbookFilename,
  plateWorkbookFilename,
  type ExportContext,
} from "../lib/exportExcel";
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
    { ...plate, name: "Main run / 主实验", confirmed: true },
    context,
  );

  assert.deepEqual(workbook.SheetNames, [
    "Plate_Map",
    "Well_Detail",
    "Gene_Requirements",
    "Sample_cDNA",
    "Total_Requirements",
    "Design_Summary",
    "Reaction_Setup",
  ]);
  assert.equal(workbook.Sheets.Total_Requirements.A4.v, "反应预混液 / Master mix");
  assert.equal(workbook.Sheets.Total_Requirements.B4.v, 480);
  assert.equal(workbook.Sheets.Total_Requirements.C4.v, 528);
  assert.equal(workbook.Sheets.Gene_Requirements.A1.v, "范围 / Scope");
  assert.equal(workbook.Sheets.Sample_cDNA.A1.v, "范围 / Scope");
  assert.equal(workbook.Sheets.Well_Detail.A1.v, "孔板名称 / Plate name");
  assert.equal(workbook.Sheets.Well_Detail.B1.v, "孔板编号 / Plate number");
  assert.match(workbook.Sheets.Plate_Map.A1.v, /Main run \/ 主实验 \(Plate 01\)/);

  const summaryRows = XLSX.utils.sheet_to_json<Array<string | number>>(
    workbook.Sheets.Design_Summary,
    { header: 1 },
  );
  assert.ok(
    summaryRows.some(
      (row) =>
        row[0] === "特别说明 / Special note" &&
        String(row[1]).includes("Controls are not added automatically"),
    ),
  );

  const serialized = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  const roundTripped = XLSX.read(serialized, { type: "buffer" });
  assert.deepEqual(roundTripped.SheetNames, workbook.SheetNames);
});

test("Blank wells use zero cDNA and replace template volume with water", async () => {
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
    blankSamples: ["S1"],
    targetGenes: ["G1", "G2", "G3"],
    referenceGenes: ["R1"],
    strategyLabel: "按样本分块 / Sample-major",
    generatedAt: "2026-07-31 12:00:00",
    validationStatus: "Advisory",
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
    { ...plate, name: "Blank check", confirmed: true },
    context,
  );
  const totalRows = XLSX.utils.sheet_to_json<Array<string | number>>(
    workbook.Sheets.Total_Requirements,
    { header: 1 },
  );
  const cdnaRow = totalRows.find(
    (row) => row[0] === "cDNA 模板 / cDNA template",
  );
  const waterRow = totalRows.find(
    (row) => row[0] === "无核酸酶水 / Nuclease-free water",
  );
  assert.deepEqual(cdnaRow, ["cDNA 模板 / cDNA template", 84, 92.4]);
  assert.deepEqual(waterRow, [
    "无核酸酶水 / Nuclease-free water",
    319.2,
    351.12,
  ]);

  const sampleRows = XLSX.utils.sheet_to_json<Record<string, string | number>>(
    workbook.Sheets.Sample_cDNA,
  );
  const blankRow = sampleRows.find((row) => row["样本 / Sample"] === "S1");
  assert.equal(blankRow?.["样本类型 / Sample type"], "空白 / Blank");
  assert.equal(blankRow?.["理论 cDNA / Required cDNA (µL)"], 0);
  assert.equal(blankRow?.["建议准备 cDNA / Prepare cDNA (µL)"], 0);
  assert.equal(
    blankRow?.["理论替代补水 / Required replacement water (µL)"],
    12,
  );
  assert.equal(
    blankRow?.["建议替代补水 / Prepare replacement water (µL)"],
    13.2,
  );
});

test("single and batch plate filenames share the dated safe naming helper", () => {
  const plate = {
    plateNumber: 3,
    name: 'Day 1 / Run:*?"<>|',
    rows: 8,
    columns: 12,
    wells: [],
    confirmed: true,
  };
  const exportDate = new Date(2026, 6, 31, 13, 15, 41);
  assert.equal(
    plateWorkbookFilename(plate, { plateType: 96 }, exportDate),
    "qPCR_Plate_03_Day_1_Run_96well_20260731.xlsx",
  );
  assert.equal(
    overviewWorkbookFilename(exportDate),
    "qPCR_All_Plates_Overview_20260731.xlsx",
  );
});
