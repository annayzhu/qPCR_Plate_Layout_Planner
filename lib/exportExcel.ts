"use client";

import type { ReactionSystemInput } from "./reactionCalculator";

export type GeneType = "target" | "reference";
export type LayoutSource = "auto" | "manual";

export interface ExportableWell {
  wellId: string;
  row: number;
  column: number;
  sample: string | null;
  gene: string | null;
  geneType: GeneType | null;
  replicateIndex: number | null;
  source: LayoutSource;
}

export interface ExportablePlate {
  plateNumber: number;
  rows: number;
  columns: number;
  wells: ExportableWell[];
  confirmed: boolean;
}

export interface ExportContext {
  plateType: 96 | 384;
  replicates: number;
  samples: string[];
  targetGenes: string[];
  referenceGenes: string[];
  strategyLabel: string;
  generatedAt: string;
  validationStatus: string;
  splitSamples: number;
  repeatedReferenceBlocks: number;
  repeatedReferenceWells: number;
  reactionSystem: ReactionSystemInput;
}

const TARGET_FILLS = [
  "DDE8F2",
  "DCEBE8",
  "E4E2EF",
  "DCE7F0",
  "E1E9E3",
  "E3E5EC",
];

const thinBorder = {
  style: "thin",
  color: { rgb: "D8D7D0" },
};

function safeDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function safeFilePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

function rowLabel(index: number) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function targetFill(gene: string, context: ExportContext) {
  const index = Math.max(0, context.targetGenes.indexOf(gene));
  return TARGET_FILLS[index % TARGET_FILLS.length];
}

function wellFill(well: ExportableWell, context: ExportContext) {
  if (!well.gene || !well.geneType) return "F7F6F2";
  if (well.geneType === "reference") return "F3DFC4";
  return targetFill(well.gene, context);
}

function roundedVolume(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function appendReactionSheets(
  XLSX: typeof import("xlsx-js-style"),
  workbook: import("xlsx-js-style").WorkBook,
  plates: ExportablePlate[],
  context: ExportContext,
  scope: string,
) {
  const occupied = plates.flatMap((plate) =>
    plate.wells.filter((well) => well.sample && well.gene),
  );
  const factor = 1 + context.reactionSystem.overagePercent / 100;
  const forwardPerWell = context.reactionSystem.primerPairPerWellUl / 2;
  const reversePerWell = context.reactionSystem.primerPairPerWellUl / 2;
  const waterPerWell = Math.max(
    0,
    context.reactionSystem.totalPerWellUl -
      context.reactionSystem.masterMixPerWellUl -
      context.reactionSystem.primerPairPerWellUl -
      context.reactionSystem.cdnaPerWellUl,
  );
  const perWellRows = [
    ["范围 / Scope", scope],
    ["组分 / Component", "每孔体积 / µL per well"],
    [
      "SYBR Green 反应预混液 / Master mix",
      context.reactionSystem.masterMixPerWellUl,
    ],
    ["上游引物 / Forward primer", forwardPerWell],
    ["下游引物 / Reverse primer", reversePerWell],
    ["cDNA 模板 / cDNA template", context.reactionSystem.cdnaPerWellUl],
    ["RNase-free ddH2O / Nuclease-free water", waterPerWell],
    ["总体积 / Total volume", context.reactionSystem.totalPerWellUl],
    ["实际反应孔 / Occupied wells", occupied.length],
    ["配液余量 / Pipetting overage", `${context.reactionSystem.overagePercent}%`],
    [
      "前提 / Assumption",
      "上、下游引物按等体积分配；未输入引物与 cDNA 浓度，不能核查终浓度或换算原始 RNA 量。 / Forward and reverse primers are split 1:1 by volume. Stock concentration and cDNA concentration are not entered.",
    ],
  ];
  const reactionSheet = XLSX.utils.aoa_to_sheet(perWellRows);
  reactionSheet["!cols"] = [{ wch: 48 }, { wch: 88 }];

  const recommendedReactions = occupied.length * factor;
  const totalRows = [
    ["范围 / Scope", scope, ""],
    [
      "项目 / Requirement",
      "理论需要 / Required (µL)",
      `建议准备 / Prepare +${context.reactionSystem.overagePercent}% (µL)`,
    ],
    [
      "反应总体积 / Total reaction volume",
      roundedVolume(occupied.length * context.reactionSystem.totalPerWellUl),
      roundedVolume(
        recommendedReactions * context.reactionSystem.totalPerWellUl,
      ),
    ],
    [
      "反应预混液 / Master mix",
      roundedVolume(
        occupied.length * context.reactionSystem.masterMixPerWellUl,
      ),
      roundedVolume(
        recommendedReactions * context.reactionSystem.masterMixPerWellUl,
      ),
    ],
    [
      "上游引物 / Forward primer",
      roundedVolume(occupied.length * forwardPerWell),
      roundedVolume(recommendedReactions * forwardPerWell),
    ],
    [
      "下游引物 / Reverse primer",
      roundedVolume(occupied.length * reversePerWell),
      roundedVolume(recommendedReactions * reversePerWell),
    ],
    [
      "cDNA 模板 / cDNA template",
      roundedVolume(
        occupied.length * context.reactionSystem.cdnaPerWellUl,
      ),
      roundedVolume(
        recommendedReactions * context.reactionSystem.cdnaPerWellUl,
      ),
    ],
    [
      "无核酸酶水 / Nuclease-free water",
      roundedVolume(occupied.length * waterPerWell),
      roundedVolume(recommendedReactions * waterPerWell),
    ],
  ];
  const totalSheet = XLSX.utils.aoa_to_sheet(totalRows);
  totalSheet["!cols"] = [{ wch: 48 }, { wch: 28 }, { wch: 32 }];

  const geneCounts = new Map<
    string,
    { count: number; geneType: string }
  >();
  const sampleCounts = new Map<string, number>();
  for (const well of occupied) {
    if (well.gene) {
      const current = geneCounts.get(well.gene) ?? {
        count: 0,
        geneType:
          well.geneType === "reference" ? "Reference" : "Target",
      };
      current.count += 1;
      geneCounts.set(well.gene, current);
    }
    if (well.sample) {
      sampleCounts.set(
        well.sample,
        (sampleCounts.get(well.sample) ?? 0) + 1,
      );
    }
  }
  const geneRows = Array.from(geneCounts.entries()).map(
    ([gene, item]) => {
      const prepareReactions = item.count * factor;
      return {
        "范围 / Scope": scope,
        "基因 / Assay": gene,
        "类型 / Type":
          item.geneType === "Reference"
            ? "内参 / Reference"
            : "目的 / Target",
        "孔数 / Well count": item.count,
        "上游引物 / Forward primer (µL)": roundedVolume(
          prepareReactions * forwardPerWell,
        ),
        "下游引物 / Reverse primer (µL)": roundedVolume(
          prepareReactions * reversePerWell,
        ),
        "引物合计 / Primer pair (µL)": roundedVolume(
          prepareReactions *
            context.reactionSystem.primerPairPerWellUl,
        ),
        "预混液 / Master mix (µL)": roundedVolume(
          prepareReactions *
            context.reactionSystem.masterMixPerWellUl,
        ),
        "用水 / Water (µL)": roundedVolume(
          prepareReactions * waterPerWell,
        ),
        "配液不含cDNA / Mix excluding cDNA (µL)": roundedVolume(
          prepareReactions *
            (context.reactionSystem.masterMixPerWellUl +
              context.reactionSystem.primerPairPerWellUl +
              waterPerWell),
        ),
        "完整反应体积 / Reaction total (µL)": roundedVolume(
          prepareReactions * context.reactionSystem.totalPerWellUl,
        ),
      };
    },
  );
  const geneSheet = XLSX.utils.json_to_sheet(geneRows);
  geneSheet["!cols"] = [
    { wch: 24 },
    { wch: 22 },
    { wch: 14 },
    { wch: 12 },
    ...Array.from({ length: 7 }, () => ({ wch: 22 })),
  ];

  const sampleRows = Array.from(sampleCounts.entries()).map(
    ([sample, wellCount]) => {
      const theoretical =
        wellCount * context.reactionSystem.cdnaPerWellUl;
      return {
        "范围 / Scope": scope,
        "样本 / Sample": sample,
        "孔数 / Well count": wellCount,
        "理论 cDNA / Required cDNA (µL)": roundedVolume(theoretical),
        "建议准备 cDNA / Prepare cDNA (µL)": roundedVolume(
          theoretical * factor,
        ),
      };
    },
  );
  const sampleSheet = XLSX.utils.json_to_sheet(sampleRows);
  sampleSheet["!cols"] = [
    { wch: 24 },
    { wch: 28 },
    { wch: 14 },
    { wch: 24 },
    { wch: 22 },
  ];

  XLSX.utils.book_append_sheet(workbook, reactionSheet, "Reaction_Setup");
  XLSX.utils.book_append_sheet(workbook, totalSheet, "Total_Requirements");
  XLSX.utils.book_append_sheet(workbook, geneSheet, "Gene_Requirements");
  XLSX.utils.book_append_sheet(workbook, sampleSheet, "Sample_cDNA");
}

function triggerDownload(content: BlobPart, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function buildPlateWorkbook(
  plate: ExportablePlate,
  context: ExportContext,
) {
  const XLSX = (await import("xlsx-js-style")).default;
  const workbook = XLSX.utils.book_new();
  const wellMap = new Map(plate.wells.map((well) => [well.wellId, well]));
  const occupiedWells = plate.wells.filter(
    (well) => well.sample && well.gene,
  );
  const samplesOnPlate = Array.from(
    new Set(
      occupiedWells.flatMap((well) => (well.sample ? [well.sample] : [])),
    ),
  );
  const targetsOnPlate = Array.from(
    new Set(
      occupiedWells.flatMap((well) =>
        well.geneType === "target" && well.gene ? [well.gene] : [],
      ),
    ),
  );
  const referencesOnPlate = Array.from(
    new Set(
      occupiedWells.flatMap((well) =>
        well.geneType === "reference" && well.gene ? [well.gene] : [],
      ),
    ),
  );
  const targetWells = occupiedWells.filter(
    (well) => well.geneType === "target",
  ).length;
  const referenceWells = occupiedWells.filter(
    (well) => well.geneType === "reference",
  ).length;
  const manualWells = plate.wells.filter(
    (well) => well.source === "manual",
  ).length;

  const mapRows: Array<Array<string | number>> = [
    [
      `qPCR Plate ${String(plate.plateNumber).padStart(2, "0")} · ${context.plateType} 孔板`,
    ],
    ["", ...Array.from({ length: plate.columns }, (_, index) => index + 1)],
  ];

  for (let row = 0; row < plate.rows; row += 1) {
    const rowValues: Array<string | number> = [rowLabel(row)];
    for (let column = 0; column < plate.columns; column += 1) {
      const wellId = `${rowLabel(row)}${column + 1}`;
      const well = wellMap.get(wellId);
      rowValues.push(
        well?.sample && well.gene
          ? `${well.sample}\n${well.gene}\nR${well.replicateIndex}/${context.replicates}`
          : "",
      );
    }
    mapRows.push(rowValues);
  }

  const mapSheet = XLSX.utils.aoa_to_sheet(mapRows);
  mapSheet["!merges"] = [
    {
      s: { r: 0, c: 0 },
      e: { r: 0, c: plate.columns },
    },
  ];
  mapSheet["!cols"] = [
    { wch: 5 },
    ...Array.from({ length: plate.columns }, () => ({
      wch: context.plateType === 384 ? 11 : 15,
    })),
  ];
  mapSheet["!rows"] = [
    { hpt: 30 },
    { hpt: 22 },
    ...Array.from({ length: plate.rows }, () => ({
      hpt: context.plateType === 384 ? 32 : 45,
    })),
  ];

  const titleCell = mapSheet.A1;
  if (titleCell) {
    titleCell.s = {
      font: { bold: true, color: { rgb: "FFFFFF" }, sz: 15 },
      fill: { fgColor: { rgb: "3D4A63" } },
      alignment: { horizontal: "left", vertical: "center" },
    };
  }

  for (let column = 0; column <= plate.columns; column += 1) {
    const address = XLSX.utils.encode_cell({ r: 1, c: column });
    const cell = mapSheet[address];
    if (cell) {
      cell.s = {
        font: { bold: true, color: { rgb: "5E5D57" } },
        fill: { fgColor: { rgb: "F0EFEA" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          top: thinBorder,
          bottom: thinBorder,
          left: thinBorder,
          right: thinBorder,
        },
      };
    }
  }

  for (let row = 0; row < plate.rows; row += 1) {
    const rowHeader = mapSheet[
      XLSX.utils.encode_cell({ r: row + 2, c: 0 })
    ];
    if (rowHeader) {
      rowHeader.s = {
        font: { bold: true, color: { rgb: "5E5D57" } },
        fill: { fgColor: { rgb: "F0EFEA" } },
        alignment: { horizontal: "center", vertical: "center" },
        border: {
          top: thinBorder,
          bottom: thinBorder,
          left: thinBorder,
          right: thinBorder,
        },
      };
    }

    for (let column = 0; column < plate.columns; column += 1) {
      const wellId = `${rowLabel(row)}${column + 1}`;
      const well = wellMap.get(wellId) ?? {
        wellId,
        row,
        column,
        sample: null,
        gene: null,
        geneType: null,
        replicateIndex: null,
        source: "auto" as const,
      };
      const address = XLSX.utils.encode_cell({
        r: row + 2,
        c: column + 1,
      });
      const cell = mapSheet[address] ?? { t: "s", v: "" };
      mapSheet[address] = cell;
      cell.s = {
        font: {
          color: { rgb: well.geneType === "reference" ? "754A1D" : "29465E" },
          sz: context.plateType === 384 ? 8 : 9,
        },
        fill: { fgColor: { rgb: wellFill(well, context) } },
        alignment: {
          horizontal: "center",
          vertical: "center",
          wrapText: true,
        },
        border: {
          top:
            well.source === "manual"
              ? { style: "medium", color: { rgb: "6D5BD0" } }
              : thinBorder,
          bottom:
            well.source === "manual"
              ? { style: "medium", color: { rgb: "6D5BD0" } }
              : thinBorder,
          left:
            well.source === "manual"
              ? { style: "medium", color: { rgb: "6D5BD0" } }
              : thinBorder,
          right:
            well.source === "manual"
              ? { style: "medium", color: { rgb: "6D5BD0" } }
              : thinBorder,
        },
      };
    }
  }

  const detailRows = plate.wells
    .slice()
    .sort((a, b) => a.row - b.row || a.column - b.column)
    .map((well) => ({
      "孔板 / Plate": `Plate ${String(plate.plateNumber).padStart(2, "0")}`,
      "孔位 / Well": well.wellId,
      "行 / Row": rowLabel(well.row),
      "列 / Column": well.column + 1,
      "样本 / Sample": well.sample ?? "",
      "基因 / Assay": well.gene ?? "",
      "类型 / Assay type":
        well.geneType === "reference"
          ? "内参 / Reference"
          : well.geneType === "target"
            ? "目的 / Target"
            : "",
      "复孔序号 / Replicate": well.replicateIndex ?? "",
      "布局来源 / Layout source":
        well.source === "manual" ? "手动 / Manual" : "自动 / Auto",
      "校验状态 / Validation": context.validationStatus,
    }));
  const detailSheet = XLSX.utils.json_to_sheet(detailRows);
  detailSheet["!autofilter"] = {
    ref: `A1:J${Math.max(2, detailRows.length + 1)}`,
  };
  detailSheet["!cols"] = [
    { wch: 12 },
    { wch: 8 },
    { wch: 7 },
    { wch: 9 },
    { wch: 24 },
    { wch: 18 },
    { wch: 14 },
    { wch: 16 },
    { wch: 15 },
    { wch: 18 },
  ];

  const summaryRows = [
    ["字段 / Field", "值 / Value"],
    ["孔板 / Plate", `Plate ${String(plate.plateNumber).padStart(2, "0")}`],
    ["孔板规格 / Plate format", `${context.plateType} 孔 / wells`],
    ["技术复孔 / Technical replicates", context.replicates],
    ["实验总样本数 / Total samples", context.samples.length],
    ["实验目的基因数 / Target assays", context.targetGenes.length],
    ["实验内参基因数 / Reference assays", context.referenceGenes.length],
    ["实验目的基因 / Target assay names", context.targetGenes.join(", ")],
    [
      "实验内参基因 / Reference assay names",
      context.referenceGenes.join(", "),
    ],
    ["本板样本数 / Samples on plate", samplesOnPlate.length],
    ["本板样本 / Sample names on plate", samplesOnPlate.join(", ")],
    ["本板目的基因 / Targets on plate", targetsOnPlate.join(", ")],
    [
      "本板内参基因 / References on plate",
      referencesOnPlate.join(", "),
    ],
    ["本板目的基因孔 / Target wells", targetWells],
    ["本板内参孔 / Reference wells", referenceWells],
    ["本板手动修改孔 / Manual wells", manualWells],
    ["跨板样本数 / Split samples", context.splitSamples],
    [
      "重复内参复孔组 / Rerun reference blocks",
      context.repeatedReferenceBlocks,
    ],
    ["重复内参孔 / Rerun reference wells", context.repeatedReferenceWells],
    ["排布策略 / Layout strategy", context.strategyLabel],
    [
      "复孔方向 / Replicate direction",
      "从左向右连续，不跨行 / Contiguous left-to-right, no row wrap",
    ],
    [
      "跨板规则 / Cross-plate rule",
      "样本的目的基因可跨板；任何含该样本目的基因的板，都必须重新安排该样本全部内参。 / Targets may span plates; every plate containing that sample's targets must include all references for that sample.",
    ],
    [
      "确认状态 / Confirmation",
      plate.confirmed ? "已确认 / Confirmed" : "草稿 / Draft",
    ],
    ["校验状态 / Validation", context.validationStatus],
    ["生成时间 / Generated at", context.generatedAt],
    [
      "方法边界 / Method boundary",
      "本布局不自动添加 NTC、no-RT 或阳性模板控制；请另行核查熔解曲线、扩增效率和内参稳定性，并遵循本地 SOP。 / Controls are not added automatically; verify melt profiles, assay efficiency, reference stability, and the local SOP.",
    ],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 22 }, { wch: 88 }];

  XLSX.utils.book_append_sheet(workbook, mapSheet, "Plate_Map");
  XLSX.utils.book_append_sheet(workbook, detailSheet, "Well_Detail");
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Design_Summary");
  appendReactionSheets(
    XLSX,
    workbook,
    [plate],
    context,
    `Plate ${String(plate.plateNumber).padStart(2, "0")}`,
  );
  return { XLSX, workbook };
}

export async function exportPlateExcel(
  plate: ExportablePlate,
  context: ExportContext,
) {
  const { XLSX, workbook } = await buildPlateWorkbook(plate, context);
  const data = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
  });
  const filename = `qPCR_Plate_${String(plate.plateNumber).padStart(2, "0")}_${context.plateType}well_${safeDateStamp()}.xlsx`;
  triggerDownload(
    data,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    safeFilePart(filename),
  );
}

export async function exportAllPlateExcels(
  plates: ExportablePlate[],
  context: ExportContext,
) {
  const [JSZipModule, XLSXModule] = await Promise.all([
    import("jszip"),
    import("xlsx-js-style"),
  ]);
  const JSZip = JSZipModule.default;
  const XLSX = XLSXModule.default;
  const zip = new JSZip();

  for (const plate of plates) {
    const { workbook } = await buildPlateWorkbook(plate, context);
    const data = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
      compression: true,
    });
    zip.file(
      `qPCR_Plate_${String(plate.plateNumber).padStart(2, "0")}_${context.plateType}well.xlsx`,
      data,
    );
  }

  const overviewRows = plates.map((plate) => {
    const occupied = plate.wells.filter(
      (well) => well.sample && well.gene,
    );
    const used = occupied.length;
    const samplesOnPlate = new Set(
      occupied.flatMap((well) => (well.sample ? [well.sample] : [])),
    );
    return {
      "孔板 / Plate": `Plate ${String(plate.plateNumber).padStart(2, "0")}`,
      "本板样本数 / Samples on plate": samplesOnPlate.size,
      "已用孔 / Used wells": used,
      "目的基因孔 / Target wells": occupied.filter(
        (well) => well.geneType === "target",
      ).length,
      "内参孔 / Reference wells": occupied.filter(
        (well) => well.geneType === "reference",
      ).length,
      "手动孔 / Manual wells": plate.wells.filter(
        (well) => well.source === "manual",
      ).length,
      "空孔 / Empty wells": plate.rows * plate.columns - used,
      "利用率 / Utilization": used / (plate.rows * plate.columns),
      "已确认 / Confirmed": plate.confirmed ? "是 / Yes" : "否 / No",
      "校验状态 / Validation": context.validationStatus,
      "跨板样本 / Split samples": context.splitSamples,
      "重复内参复孔组 / Rerun reference blocks":
        context.repeatedReferenceBlocks,
      "重复内参孔 / Rerun reference wells":
        context.repeatedReferenceWells,
    };
  });
  const overviewBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    overviewBook,
    XLSX.utils.json_to_sheet(overviewRows),
    "Plate_Overview",
  );
  appendReactionSheets(
    XLSX,
    overviewBook,
    plates,
    context,
    "All plates / 全部孔板",
  );
  const overviewData = XLSX.write(overviewBook, {
    bookType: "xlsx",
    type: "array",
    compression: true,
  });
  zip.file("qPCR_All_Plates_Overview.xlsx", overviewData);

  const archive = await zip.generateAsync({ type: "blob" });
  triggerDownload(
    archive,
    "application/zip",
    `qPCR_plate_layout_${safeDateStamp()}.zip`,
  );
}
