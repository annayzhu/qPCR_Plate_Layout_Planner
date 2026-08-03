import fs from "node:fs/promises";
import path from "node:path";

const projectDir = process.cwd();
const sourceDir = path.resolve(
  projectDir,
  "../outputs/019fc855-486c-75f1-8121-d867efd17fa0/qPCR_20260803",
);
const sourcePath = path.join(sourceDir, "analysis.json");
const routeDir = path.join(projectDir, "app/results-20260803");
const downloadDir = path.join(projectDir, "public/results-20260803");

const analysis = JSON.parse(await fs.readFile(sourcePath, "utf8"));

const slim = {
  experiment: analysis.experiment,
  generatedAt: analysis.generatedAt,
  counts: analysis.counts,
  thresholds: analysis.thresholds,
  limitations: analysis.limitations,
  manualNotes: analysis.manualNotes,
  changedWells: analysis.changedWells,
  assaySummaries: analysis.assaySummaries,
  referenceStability: analysis.referenceStability,
  column10Effects: analysis.column10Effects,
  replicateGroups: analysis.replicateGroups,
  relativeExpression: analysis.relativeExpression,
  correctedWells: analysis.correctedWells.map((well) => ({
    well: well.well,
    row: well.row,
    column: well.column,
    sample: well.sample,
    assay: well.assay,
    replicate: well.replicate,
    cp: well.cp,
    tm1: well.tm1,
    tm2: well.tm2,
    meltGroup: well.meltGroup,
    meltScore: well.meltScore,
    meltResolution: well.meltResolution,
    layoutChanged: well.layoutChanged,
    originalSample: well.originalSample,
    manualNote: well.manualNote,
  })),
};

await fs.mkdir(routeDir, { recursive: true });
await fs.mkdir(downloadDir, { recursive: true });
await fs.writeFile(
  path.join(routeDir, "analysis-data.json"),
  `${JSON.stringify(slim)}\n`,
  "utf8",
);

const downloads = [
  "qPCR_20260803_corrected_analysis.xlsx",
  "corrected_well_data.csv",
  "replicate_qc.csv",
  "relative_expression.csv",
];
for (const file of downloads) {
  await fs.copyFile(path.join(sourceDir, file), path.join(downloadDir, file));
}

console.log(
  JSON.stringify({
    activeWells: slim.counts.activeWells,
    replicateGroups: slim.counts.replicateGroups,
    routeData: path.join(routeDir, "analysis-data.json"),
    downloads: downloads.length,
  }),
);
