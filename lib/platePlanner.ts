export type PlateType = 96 | 384;
export type GeneType = "target" | "reference";
export type LayoutSource = "auto" | "manual";
export type LayoutStrategy = "sample-major" | "gene-major" | "hybrid";
export type LayoutPreset = Exclude<LayoutStrategy, "hybrid">;

export interface PlanOptions {
  strategy?: LayoutPreset;
}

export interface PlanInput {
  plateType: PlateType;
  samples: string[];
  targetGenes: string[];
  referenceGenes: string[];
  replicates: number;
}

export interface PlannerWell {
  wellId: string;
  row: number;
  column: number;
  sample: string | null;
  gene: string | null;
  geneType: GeneType | null;
  replicateIndex: number | null;
  source: LayoutSource;
}

export interface PlannerPlate {
  id: string;
  plateNumber: number;
  name: string;
  rows: number;
  columns: number;
  sampleNames: string[];
  wells: PlannerWell[];
}

export interface PlanMetrics {
  plateCount: number;
  usedWells: number;
  emptyWells: number;
  utilization: number;
  sampleSwitches: number;
  primerSwitches: number;
  structuralEmptyWells: number;
  rowTailWells: number;
  samplesPerPlate: number;
  samplePlateAppearances: number;
  splitSamples: number;
  repeatedReferenceBlocks: number;
  repeatedReferenceWells: number;
  genePlateOccurrences: number;
}

export interface PlanResult {
  plates: PlannerPlate[];
  strategy: LayoutStrategy;
  metrics: PlanMetrics;
  reason: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  plateNumber?: number;
  wellIds?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

interface AssayBlock {
  sample: string;
  gene: string;
  geneType: GeneType;
}

interface TargetPair {
  sample: string;
  gene: string;
}

interface PackedPlate {
  samples: Map<string, Set<string>>;
}

interface LayoutCandidate {
  strategy: LayoutStrategy;
  packedPlates: PackedPlate[];
  plateSequences: AssayBlock[][];
  plateCount: number;
  samplePlateAppearances: number;
  splitSamples: number;
  repeatedReferenceBlocks: number;
  genePlateOccurrences: number;
  sampleSwitches: number;
  primerSwitches: number;
  stableRank: number;
}

export class PlatePlannerError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PlatePlannerError";
    this.code = code;
  }
}

export function getPlateDimensions(plateType: PlateType) {
  if (plateType === 96) return { rows: 8, columns: 12 };
  if (plateType === 384) return { rows: 16, columns: 24 };
  throw new PlatePlannerError(
    "E_PLATE_TYPE",
    "仅支持 96 孔板或 384 孔板。 / Only 96- and 384-well plates are supported.",
  );
}

export function formatWellId(row: number, column: number) {
  let rowNumber = row + 1;
  let rowLabel = "";
  while (rowNumber > 0) {
    const remainder = (rowNumber - 1) % 26;
    rowLabel = String.fromCharCode(65 + remainder) + rowLabel;
    rowNumber = Math.floor((rowNumber - 1) / 26);
  }
  return `${rowLabel}${column + 1}`;
}

export function defaultPlateName(plateNumber: number) {
  return `Plate ${String(plateNumber).padStart(2, "0")}`;
}

function normalized(values: string[], label: "sample" | "gene") {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const value of cleaned) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) {
      throw new PlatePlannerError(
        `E_DUPLICATE_${label.toUpperCase()}`,
        `${label === "sample" ? "样本 / Sample" : "基因 / Assay"}名称“${value}”重复，请先合并或重命名。 / The name is duplicated; merge or rename it first.`,
      );
    }
    seen.add(key);
  }
  return cleaned;
}

function validateInput(input: PlanInput) {
  const dimensions = getPlateDimensions(input.plateType);
  const samples = normalized(input.samples, "sample");
  const targetGenes = normalized(input.targetGenes, "gene");
  const referenceGenes = normalized(input.referenceGenes, "gene");

  if (samples.length === 0) {
    throw new PlatePlannerError(
      "E_NO_SAMPLE",
      "请至少添加 1 个样本。 / Add at least one sample.",
    );
  }
  if (targetGenes.length === 0) {
    throw new PlatePlannerError(
      "E_NO_TARGET",
      "请至少添加 1 个目的基因。 / Add at least one target assay.",
    );
  }
  if (referenceGenes.length === 0) {
    throw new PlatePlannerError(
      "E_NO_REFERENCE",
      "请至少将 1 个基因标记为内参基因。 / Mark at least one assay as a reference.",
    );
  }
  if (!Number.isInteger(input.replicates) || input.replicates < 1) {
    throw new PlatePlannerError(
      "E_REPLICATE_COUNT",
      "技术复孔数必须是正整数。 / Technical replicate count must be a positive integer.",
    );
  }
  if (input.replicates > dimensions.columns) {
    throw new PlatePlannerError(
      "E_REPLICATE_WIDER_THAN_ROW",
      `${input.plateType} 孔板每行只有 ${dimensions.columns} 孔，无法横向连续放置 ${input.replicates} 个复孔。 / A ${input.plateType}-well plate has ${dimensions.columns} columns per row, so ${input.replicates} contiguous replicates will not fit.`,
    );
  }

  const targetKeys = new Set(
    targetGenes.map((gene) => gene.toLocaleLowerCase()),
  );
  const roleConflict = referenceGenes.find((gene) =>
    targetKeys.has(gene.toLocaleLowerCase()),
  );
  if (roleConflict) {
    throw new PlatePlannerError(
      "E_GENE_ROLE_CONFLICT",
      `基因“${roleConflict}”不能同时作为目的基因和内参基因。 / An assay cannot be both target and reference.`,
    );
  }

  const blocksPerRow = Math.floor(dimensions.columns / input.replicates);
  const blockCapacity = dimensions.rows * blocksPerRow;
  if (referenceGenes.length + 1 > blockCapacity) {
    throw new PlatePlannerError(
      "E_REFERENCE_BUNDLE_TOO_LARGE",
      `每次安排一个目的基因时，都必须同时容纳 ${referenceGenes.length} 个内参复孔组；当前孔板最多容纳 ${blockCapacity} 个横向复孔组，无法形成有效的同板配对。 / The plate cannot hold one target block together with all ${referenceGenes.length} reference blocks for the same sample.`,
    );
  }

  return {
    ...input,
    samples,
    targetGenes,
    referenceGenes,
    dimensions,
    blocksPerRow,
    blockCapacity,
  };
}

function emptyPackedPlate(): PackedPlate {
  return { samples: new Map<string, Set<string>>() };
}

function packedLoad(plate: PackedPlate, referenceCount: number) {
  let targetBlocks = 0;
  for (const targets of plate.samples.values()) {
    targetBlocks += targets.size;
  }
  return targetBlocks + plate.samples.size * referenceCount;
}

function addTargetPair(plate: PackedPlate, pair: TargetPair) {
  const targets = plate.samples.get(pair.sample) ?? new Set<string>();
  targets.add(pair.gene);
  plate.samples.set(pair.sample, targets);
}

function packOrderedPairs(
  pairs: TargetPair[],
  blockCapacity: number,
  referenceCount: number,
): PackedPlate[] {
  const plates: PackedPlate[] = [];

  for (const pair of pairs) {
    let bestIndex = -1;
    let bestLoad = -1;

    for (let index = 0; index < plates.length; index += 1) {
      const plate = plates[index];
      const existingTargets = plate.samples.get(pair.sample);
      if (!existingTargets || existingTargets.has(pair.gene)) continue;
      const load = packedLoad(plate, referenceCount);
      if (load + 1 <= blockCapacity && load > bestLoad) {
        bestIndex = index;
        bestLoad = load;
      }
    }

    if (bestIndex < 0) {
      for (let index = 0; index < plates.length; index += 1) {
        const plate = plates[index];
        if (plate.samples.has(pair.sample)) continue;
        const load = packedLoad(plate, referenceCount);
        const cost = referenceCount + 1;
        if (load + cost <= blockCapacity && load > bestLoad) {
          bestIndex = index;
          bestLoad = load;
        }
      }
    }

    if (bestIndex < 0) {
      plates.push(emptyPackedPlate());
      bestIndex = plates.length - 1;
    }
    addTargetPair(plates[bestIndex], pair);
  }

  return plates;
}

function packWholeSamples(
  samples: string[],
  targetGenes: string[],
  blockCapacity: number,
  referenceCount: number,
): PackedPlate[] {
  const fullBundleSize = targetGenes.length + referenceCount;
  if (fullBundleSize > blockCapacity) {
    return packOrderedPairs(
      samples.flatMap((sample) =>
        targetGenes.map((gene) => ({ sample, gene })),
      ),
      blockCapacity,
      referenceCount,
    );
  }

  const plates: PackedPlate[] = [];
  for (const sample of samples) {
    let bestIndex = -1;
    let bestLoad = -1;
    for (let index = 0; index < plates.length; index += 1) {
      const load = packedLoad(plates[index], referenceCount);
      if (load + fullBundleSize <= blockCapacity && load > bestLoad) {
        bestIndex = index;
        bestLoad = load;
      }
    }
    if (bestIndex < 0) {
      plates.push(emptyPackedPlate());
      bestIndex = plates.length - 1;
    }
    plates[bestIndex].samples.set(sample, new Set(targetGenes));
  }
  return plates;
}

function packIntoPlateLimit(
  samples: string[],
  targetGenes: string[],
  plateLimit: number,
  blockCapacity: number,
  referenceCount: number,
): PackedPlate[] | null {
  const plates = Array.from(
    { length: plateLimit },
    () => emptyPackedPlate(),
  );

  for (const sample of samples) {
    const wholePlate = plates
      .map((plate, index) => ({
        index,
        load: packedLoad(plate, referenceCount),
      }))
      .filter(
        ({ index, load }) =>
          !plates[index].samples.has(sample) &&
          load + referenceCount + targetGenes.length <= blockCapacity,
      )
      .sort(
        (left, right) =>
          right.load - left.load || left.index - right.index,
      )[0];

    if (wholePlate) {
      plates[wholePlate.index].samples.set(
        sample,
        new Set(targetGenes),
      );
      continue;
    }

    const options = plates
      .map((plate, index) => {
        const load = packedLoad(plate, referenceCount);
        const availableTargets =
          blockCapacity - load - referenceCount;
        const targetUnion = new Set<string>();
        for (const targets of plate.samples.values()) {
          targets.forEach((gene) => targetUnion.add(gene));
        }
        return { index, availableTargets, targetUnion };
      })
      .filter((option) => option.availableTargets > 0)
      .sort(
        (left, right) =>
          right.availableTargets - left.availableTargets ||
          right.targetUnion.size - left.targetUnion.size ||
          left.index - right.index,
      );

    const selected: typeof options = [];
    let available = 0;
    for (const option of options) {
      selected.push(option);
      available += option.availableTargets;
      if (available >= targetGenes.length) break;
    }
    if (available < targetGenes.length) return null;

    const remainingGenes = new Set(targetGenes);
    selected.forEach((option, optionIndex) => {
      const remainingPlateCount = selected.length - optionIndex - 1;
      const count = Math.min(
        option.availableTargets,
        remainingGenes.size - remainingPlateCount,
      );
      const orderedGenes = Array.from(remainingGenes).sort(
        (left, right) =>
          Number(option.targetUnion.has(right)) -
            Number(option.targetUnion.has(left)) ||
          targetGenes.indexOf(left) - targetGenes.indexOf(right),
      );
      const chosen = orderedGenes.slice(0, count);
      plates[option.index].samples.set(sample, new Set(chosen));
      chosen.forEach((gene) => remainingGenes.delete(gene));
    });
    if (remainingGenes.size > 0) return null;
  }

  return plates.filter((plate) => plate.samples.size > 0);
}

function sampleMajorPairs(samples: string[], genes: string[]) {
  return samples.flatMap((sample) =>
    genes.map((gene) => ({ sample, gene })),
  );
}

function geneMajorPairs(samples: string[], genes: string[]) {
  return genes.flatMap((gene, geneIndex) => {
    const orderedSamples =
      geneIndex % 2 === 0 ? samples : samples.slice().reverse();
    return orderedSamples.map((sample) => ({ sample, gene }));
  });
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size));
  }
  return result;
}

function blockPairs(
  samples: string[],
  genes: string[],
  sampleChunkSize: number,
  geneChunkSize: number,
  orientation: "sample" | "gene",
) {
  const sampleChunks = chunks(samples, sampleChunkSize);
  const geneChunks = chunks(genes, geneChunkSize);
  const pairs: TargetPair[] = [];

  if (orientation === "sample") {
    sampleChunks.forEach((sampleChunk, sampleChunkIndex) => {
      geneChunks.forEach((geneChunk, geneChunkIndex) => {
        const orderedSamples =
          geneChunkIndex % 2 === 0
            ? sampleChunk
            : sampleChunk.slice().reverse();
        const orderedGenes =
          sampleChunkIndex % 2 === 0
            ? geneChunk
            : geneChunk.slice().reverse();
        orderedSamples.forEach((sample) => {
          orderedGenes.forEach((gene) => pairs.push({ sample, gene }));
        });
      });
    });
  } else {
    geneChunks.forEach((geneChunk, geneChunkIndex) => {
      sampleChunks.forEach((sampleChunk, sampleChunkIndex) => {
        const orderedGenes =
          sampleChunkIndex % 2 === 0
            ? geneChunk
            : geneChunk.slice().reverse();
        const orderedSamples =
          geneChunkIndex % 2 === 0
            ? sampleChunk
            : sampleChunk.slice().reverse();
        orderedGenes.forEach((gene) => {
          orderedSamples.forEach((sample) => pairs.push({ sample, gene }));
        });
      });
    });
  }

  return pairs;
}

function candidateChunkSizes(length: number) {
  const raw = [
    1,
    2,
    3,
    4,
    Math.ceil(length / 2),
    Math.ceil(length / 3),
    length,
  ];
  return Array.from(
    new Set(raw.filter((value) => value >= 1 && value <= length)),
  ).sort((left, right) => left - right);
}

function packingSignature(plates: PackedPlate[]) {
  return plates
    .map((plate) =>
      Array.from(plate.samples.entries())
        .map(
          ([sample, targets]) =>
            `${sample}:${Array.from(targets).sort().join(",")}`,
        )
        .sort()
        .join("|"),
    )
    .sort()
    .join("||");
}

function generatePackings(
  samples: string[],
  targetGenes: string[],
  blockCapacity: number,
  referenceCount: number,
) {
  const candidates: PackedPlate[][] = [];
  const signatures = new Set<string>();
  const add = (plates: PackedPlate[]) => {
    const signature = packingSignature(plates);
    if (!signatures.has(signature)) {
      signatures.add(signature);
      candidates.push(plates);
    }
  };

  add(
    packWholeSamples(
      samples,
      targetGenes,
      blockCapacity,
      referenceCount,
    ),
  );
  add(
    packOrderedPairs(
      sampleMajorPairs(samples, targetGenes),
      blockCapacity,
      referenceCount,
    ),
  );
  add(
    packOrderedPairs(
      geneMajorPairs(samples, targetGenes),
      blockCapacity,
      referenceCount,
    ),
  );

  const sampleSizes = candidateChunkSizes(samples.length);
  const geneSizes = candidateChunkSizes(targetGenes.length);
  for (const sampleSize of sampleSizes) {
    for (const geneSize of geneSizes) {
      add(
        packOrderedPairs(
          blockPairs(
            samples,
            targetGenes,
            sampleSize,
            geneSize,
            "sample",
          ),
          blockCapacity,
          referenceCount,
        ),
      );
      add(
        packOrderedPairs(
          blockPairs(
            samples,
            targetGenes,
            sampleSize,
            geneSize,
            "gene",
          ),
          blockCapacity,
          referenceCount,
        ),
      );
    }
  }

  const currentMinimum = Math.min(
    ...candidates.map((plates) => plates.length),
  );
  const minimumAppearancesPerSample = Math.ceil(
    targetGenes.length / (blockCapacity - referenceCount),
  );
  const loadLowerBound = Math.ceil(
    (samples.length *
      (targetGenes.length +
        referenceCount * minimumAppearancesPerSample)) /
      blockCapacity,
  );
  const plateLowerBound = Math.max(
    minimumAppearancesPerSample,
    loadLowerBound,
  );
  const sampleOrders: string[][] = [
    samples,
    samples.slice().reverse(),
  ];
  const rotationCount = Math.min(samples.length, 12);
  for (let index = 1; index < rotationCount; index += 1) {
    const offset = Math.floor((index * samples.length) / rotationCount);
    sampleOrders.push([
      ...samples.slice(offset),
      ...samples.slice(0, offset),
    ]);
  }
  const geneOrders = [targetGenes, targetGenes.slice().reverse()];
  for (
    let plateLimit = plateLowerBound;
    plateLimit <= currentMinimum;
    plateLimit += 1
  ) {
    for (const sampleOrder of sampleOrders) {
      for (const orderedGenes of geneOrders) {
        const packing = packIntoPlateLimit(
          sampleOrder,
          orderedGenes,
          plateLimit,
          blockCapacity,
          referenceCount,
        );
        if (packing) add(packing);
      }
    }
  }
  return candidates;
}

function sampleOrderForPlate(
  plate: PackedPlate,
  inputSamples: string[],
) {
  return inputSamples.filter((sample) => plate.samples.has(sample));
}

function geneOrder(
  targetGenes: string[],
  referenceGenes: string[],
) {
  return [
    ...referenceGenes.map((gene) => ({
      gene,
      geneType: "reference" as const,
    })),
    ...targetGenes.map((gene) => ({
      gene,
      geneType: "target" as const,
    })),
  ];
}

function hasAssay(
  plate: PackedPlate,
  sample: string,
  gene: string,
  geneType: GeneType,
) {
  if (!plate.samples.has(sample)) return false;
  if (geneType === "reference") return true;
  return plate.samples.get(sample)?.has(gene) ?? false;
}

function sampleMajorSequence(
  plate: PackedPlate,
  samples: string[],
  genes: ReturnType<typeof geneOrder>,
) {
  const sequence: AssayBlock[] = [];
  const plateSamples = sampleOrderForPlate(plate, samples);
  plateSamples.forEach((sample) => {
    genes.forEach(({ gene, geneType }) => {
      if (hasAssay(plate, sample, gene, geneType)) {
        sequence.push({ sample, gene, geneType });
      }
    });
  });
  return sequence;
}

function geneMajorSequence(
  plate: PackedPlate,
  samples: string[],
  genes: ReturnType<typeof geneOrder>,
) {
  const sequence: AssayBlock[] = [];
  const plateSamples = sampleOrderForPlate(plate, samples);
  genes.forEach(({ gene, geneType }) => {
    plateSamples.forEach((sample) => {
      if (hasAssay(plate, sample, gene, geneType)) {
        sequence.push({ sample, gene, geneType });
      }
    });
  });
  return sequence;
}

function hybridSequence(
  plate: PackedPlate,
  samples: string[],
  genes: ReturnType<typeof geneOrder>,
) {
  const plateSamples = sampleOrderForPlate(plate, samples);
  if (plateSamples.length <= 1) {
    return sampleMajorSequence(plate, samples, genes);
  }
  const sampleChunks = chunks(
    plateSamples,
    Math.max(1, Math.ceil(plateSamples.length / 2)),
  );
  const sequence: AssayBlock[] = [];
  sampleChunks.forEach((sampleChunk, chunkIndex) => {
    const orderedGenes =
      chunkIndex % 2 === 0 ? genes : genes.slice().reverse();
    orderedGenes.forEach(({ gene, geneType }, geneIndex) => {
      const orderedSamples =
        geneIndex % 2 === 0 ? sampleChunk : sampleChunk.slice().reverse();
      orderedSamples.forEach((sample) => {
        if (hasAssay(plate, sample, gene, geneType)) {
          sequence.push({ sample, gene, geneType });
        }
      });
    });
  });
  return sequence;
}

function countSwitches(plateSequences: AssayBlock[][]) {
  let sampleSwitches = 0;
  let primerSwitches = 0;
  for (const sequence of plateSequences) {
    for (let index = 1; index < sequence.length; index += 1) {
      if (sequence[index].sample !== sequence[index - 1].sample) {
        sampleSwitches += 1;
      }
      if (sequence[index].gene !== sequence[index - 1].gene) {
        primerSwitches += 1;
      }
    }
  }
  return { sampleSwitches, primerSwitches };
}

function allocationMetrics(
  plates: PackedPlate[],
  samples: string[],
  targetGenes: string[],
  referenceCount: number,
) {
  const appearances = new Map(samples.map((sample) => [sample, 0]));
  let genePlateOccurrences = 0;

  for (const plate of plates) {
    const targetUnion = new Set<string>();
    for (const [sample, targets] of plate.samples) {
      appearances.set(sample, (appearances.get(sample) ?? 0) + 1);
      targets.forEach((gene) => targetUnion.add(gene));
    }
    genePlateOccurrences +=
      targetUnion.size + (plate.samples.size > 0 ? referenceCount : 0);
  }

  const samplePlateAppearances = Array.from(appearances.values()).reduce(
    (sum, count) => sum + count,
    0,
  );
  const splitSamples = Array.from(appearances.values()).filter(
    (count) => count > 1,
  ).length;
  return {
    plateCount: plates.length,
    samplePlateAppearances,
    splitSamples,
    repeatedReferenceBlocks:
      (samplePlateAppearances - samples.length) * referenceCount,
    genePlateOccurrences,
    targetBlocks: samples.length * targetGenes.length,
  };
}

function buildCandidate(
  packedPlates: PackedPlate[],
  strategy: LayoutStrategy,
  samples: string[],
  targetGenes: string[],
  referenceGenes: string[],
): LayoutCandidate {
  const genes = geneOrder(targetGenes, referenceGenes);
  const builder =
    strategy === "sample-major"
      ? sampleMajorSequence
      : strategy === "gene-major"
        ? geneMajorSequence
        : hybridSequence;
  const plateSequences = packedPlates.map((plate) =>
    builder(plate, samples, genes),
  );
  const allocation = allocationMetrics(
    packedPlates,
    samples,
    targetGenes,
    referenceGenes.length,
  );
  const switches = countSwitches(plateSequences);
  return {
    strategy,
    packedPlates,
    plateSequences,
    ...allocation,
    ...switches,
    stableRank:
      strategy === "sample-major" ? 0 : strategy === "hybrid" ? 1 : 2,
  };
}

function candidateScore(candidate: LayoutCandidate) {
  return [
    candidate.plateCount,
    candidate.samplePlateAppearances,
    candidate.genePlateOccurrences,
    candidate.stableRank,
    candidate.primerSwitches,
    candidate.sampleSwitches,
  ];
}

function compareScores(left: number[], right: number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function emptyWells(rows: number, columns: number): PlannerWell[] {
  const wells: PlannerWell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      wells.push({
        wellId: formatWellId(row, column),
        row,
        column,
        sample: null,
        gene: null,
        geneType: null,
        replicateIndex: null,
        source: "auto",
      });
    }
  }
  return wells;
}

function materializePlate(
  sequence: AssayBlock[],
  packedPlate: PackedPlate,
  plateNumber: number,
  rows: number,
  columns: number,
  replicates: number,
  inputSamples: string[],
): PlannerPlate {
  const wells = emptyWells(rows, columns);
  const wellIndex = new Map(wells.map((well, index) => [well.wellId, index]));

  sequence.forEach((block, blockIndex) => {
    const row = blockIndex % rows;
    const blockColumn = Math.floor(blockIndex / rows);
    const startColumn = blockColumn * replicates;
    for (
      let replicateIndex = 0;
      replicateIndex < replicates;
      replicateIndex += 1
    ) {
      const column = startColumn + replicateIndex;
      const wellId = formatWellId(row, column);
      const index = wellIndex.get(wellId);
      if (index === undefined) {
        throw new PlatePlannerError(
          "E_INTERNAL_OVERFLOW",
          "排板计算发生越界，请检查输入。 / Plate calculation exceeded the available grid; check the inputs.",
        );
      }
      wells[index] = {
        wellId,
        row,
        column,
        sample: block.sample,
        gene: block.gene,
        geneType: block.geneType,
        replicateIndex: replicateIndex + 1,
        source: "auto",
      };
    }
  });

  return {
    id: `plate-${plateNumber}`,
    plateNumber,
    name: defaultPlateName(plateNumber),
    rows,
    columns,
    sampleNames: sampleOrderForPlate(packedPlate, inputSamples),
    wells,
  };
}

export function planPlateLayout(
  rawInput: PlanInput,
  options: PlanOptions = {},
): PlanResult {
  const input = validateInput(rawInput);
  const packings = generatePackings(
    input.samples,
    input.targetGenes,
    input.blockCapacity,
    input.referenceGenes.length,
  );
  const strategies: LayoutStrategy[] = options.strategy
    ? [options.strategy]
    : ["sample-major", "gene-major", "hybrid"];
  const candidates = packings.flatMap((packing) =>
    strategies.map((strategy) =>
      buildCandidate(
        packing,
        strategy,
        input.samples,
        input.targetGenes,
        input.referenceGenes,
      ),
    ),
  );
  candidates.sort((left, right) =>
    compareScores(candidateScore(left), candidateScore(right)),
  );
  const best = candidates[0];

  const plates = best.plateSequences.map((sequence, index) =>
    materializePlate(
      sequence,
      best.packedPlates[index],
      index + 1,
      input.dimensions.rows,
      input.dimensions.columns,
      input.replicates,
      input.samples,
    ),
  );
  const usedBlocks =
    input.samples.length * input.targetGenes.length +
    best.samplePlateAppearances * input.referenceGenes.length;
  const usedWells = usedBlocks * input.replicates;
  const totalWells =
    plates.length * input.dimensions.rows * input.dimensions.columns;
  const rowTailWells =
    plates.length *
    input.dimensions.rows *
    (input.dimensions.columns -
      input.blocksPerRow * input.replicates);
  const strategyName =
    best.strategy === "sample-major"
      ? "按样本排列 / By sample"
      : best.strategy === "gene-major"
        ? "按基因排列 / By assay"
        : "混合分块 / Hybrid";
  const repeatExplanation =
    best.repeatedReferenceBlocks > 0
      ? `为把实验压缩到 ${plates.length} 块板，有 ${best.splitSamples} 个样本跨板；其内参已在涉及的每块板重新安排，共增加 ${best.repeatedReferenceBlocks} 个内参复孔组（${best.repeatedReferenceBlocks * input.replicates} 孔）。 / ${best.splitSamples} sample(s) span plates; all references are rerun on each involved plate, adding ${best.repeatedReferenceBlocks * input.replicates} reference wells.`
      : "所有样本均可在单板内完成，没有产生跨板内参重做。 / Every sample fits on one plate; no reference reruns are added.";

  return {
    plates,
    strategy: best.strategy,
    metrics: {
      plateCount: plates.length,
      usedWells,
      emptyWells: totalWells - usedWells,
      utilization: totalWells === 0 ? 0 : usedWells / totalWells,
      sampleSwitches: best.sampleSwitches,
      primerSwitches: best.primerSwitches,
      structuralEmptyWells: totalWells - usedWells,
      rowTailWells,
      samplesPerPlate:
        plates.length === 0
          ? 0
          : Math.max(...plates.map((plate) => plate.sampleNames.length)),
      samplePlateAppearances: best.samplePlateAppearances,
      splitSamples: best.splitSamples,
      repeatedReferenceBlocks: best.repeatedReferenceBlocks,
      repeatedReferenceWells:
        best.repeatedReferenceBlocks * input.replicates,
      genePlateOccurrences: best.genePlateOccurrences,
    },
    reason: options.strategy
      ? `已按用户选择生成${strategyName}布局；孔板分配仍优先减少板数与跨板内参重做。${repeatExplanation} / The selected ${strategyName} layout was generated while plate allocation continued to minimize plate count and reference reruns.`
      : `系统在已生成的可行候选中，依次比较板数、跨板内参重做、引物跨板批次和板内切换。推荐${strategyName}：${repeatExplanation} / Feasible candidates are ranked by plate count, reference reruns, assay batches, and within-plate switches.`,
  };
}

export function refreshPlanDerivedData(
  result: PlanResult,
  rawInput: PlanInput,
): PlanResult {
  const input = validateInput(rawInput);
  const targetSet = new Set(input.targetGenes);
  const sampleAppearances = new Map(
    input.samples.map((sample) => [sample, 0]),
  );
  let usedWells = 0;
  let sampleSwitches = 0;
  let primerSwitches = 0;
  let genePlateOccurrences = 0;
  let manualWells = 0;

  const plates = result.plates.map((plate) => {
    const occupied = plate.wells
      .filter((well) => well.sample && well.gene)
      .slice()
      .sort(
        (left, right) =>
          Math.floor(left.column / input.replicates) -
            Math.floor(right.column / input.replicates) ||
          left.row - right.row ||
          left.column - right.column,
      );
    usedWells += occupied.length;
    manualWells += plate.wells.filter(
      (well) => well.source === "manual",
    ).length;

    for (let index = 1; index < occupied.length; index += 1) {
      if (occupied[index].sample !== occupied[index - 1].sample) {
        sampleSwitches += 1;
      }
      if (occupied[index].gene !== occupied[index - 1].gene) {
        primerSwitches += 1;
      }
    }

    const genesOnPlate = new Set(
      occupied.flatMap((well) => (well.gene ? [well.gene] : [])),
    );
    genePlateOccurrences += genesOnPlate.size;

    const targetSamples = new Set(
      occupied.flatMap((well) =>
        well.sample && well.gene && targetSet.has(well.gene)
          ? [well.sample]
          : [],
      ),
    );
    targetSamples.forEach((sample) =>
      sampleAppearances.set(
        sample,
        (sampleAppearances.get(sample) ?? 0) + 1,
      ),
    );

    const assignedSamples = new Set(
      occupied.flatMap((well) => (well.sample ? [well.sample] : [])),
    );
    return {
      ...plate,
      name: plate.name?.trim() || defaultPlateName(plate.plateNumber),
      sampleNames: input.samples.filter((sample) =>
        assignedSamples.has(sample),
      ),
    };
  });

  const appearanceCounts = Array.from(sampleAppearances.values());
  const samplePlateAppearances = appearanceCounts.reduce(
    (sum, count) => sum + count,
    0,
  );
  const splitSamples = appearanceCounts.filter((count) => count > 1).length;
  const repeatedReferenceBlocks =
    appearanceCounts.reduce(
      (sum, count) => sum + Math.max(0, count - 1),
      0,
    ) * input.referenceGenes.length;
  const totalWells =
    plates.length * input.dimensions.rows * input.dimensions.columns;
  const rowTailWells =
    plates.length *
    input.dimensions.rows *
    (input.dimensions.columns -
      input.blocksPerRow * input.replicates);
  const repeatedReferenceWells =
    repeatedReferenceBlocks * input.replicates;

  return {
    ...result,
    plates,
    metrics: {
      ...result.metrics,
      plateCount: plates.length,
      usedWells,
      emptyWells: totalWells - usedWells,
      utilization: totalWells === 0 ? 0 : usedWells / totalWells,
      sampleSwitches,
      primerSwitches,
      structuralEmptyWells: totalWells - usedWells,
      rowTailWells,
      samplesPerPlate:
        plates.length === 0
          ? 0
          : Math.max(...plates.map((plate) => plate.sampleNames.length)),
      samplePlateAppearances,
      splitSamples,
      repeatedReferenceBlocks,
      repeatedReferenceWells,
      genePlateOccurrences,
    },
    reason:
      manualWells === 0
        ? result.reason
        : `当前含 ${manualWells} 个手动调整孔，摘要已按现有孔位重算。${splitSamples > 0 ? `${splitSamples} 个样本跨板，预计需额外重做 ${repeatedReferenceBlocks} 个内参复孔组（${repeatedReferenceWells} 孔）。` : "当前没有样本跨板。"}请以即时校验结果作为确认依据。 / Summary recalculated from ${manualWells} manually edited wells; use the live validation result before confirmation.`,
  };
}

function groupKey(sample: string, gene: string) {
  return `${sample}\u0000${gene}`;
}

export function validateLayout(
  result: PlanResult,
  rawInput: PlanInput,
): ValidationResult {
  let input: ReturnType<typeof validateInput>;
  try {
    input = validateInput(rawInput);
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          code:
            error instanceof PlatePlannerError
              ? error.code
              : "E_INVALID_INPUT",
          message:
            error instanceof Error
              ? error.message
              : "实验设置无效。 / Invalid experiment setup.",
        },
      ],
    };
  }

  const errors: ValidationIssue[] = [];
  const seenPlateNames = new Set<string>();
  for (const plate of result.plates) {
    const plateName =
      plate.name?.trim() || defaultPlateName(plate.plateNumber);
    const normalizedPlateName = plateName.toLocaleLowerCase();
    if (seenPlateNames.has(normalizedPlateName)) {
      errors.push({
        code: "E_DUPLICATE_PLATE_NAME",
        plateNumber: plate.plateNumber,
        message: `孔板名称“${plateName}”重复。 / Plate name “${plateName}” is duplicated.`,
      });
    }
    seenPlateNames.add(normalizedPlateName);
  }
  const globalTargetGroups = new Map<
    string,
    Array<{ well: PlannerWell; plateNumber: number }>
  >();
  const knownSamples = new Set(input.samples);
  const targetSet = new Set(input.targetGenes);
  const referenceSet = new Set(input.referenceGenes);

  result.plates.forEach((plate) => {
    const plateGroups = new Map<string, PlannerWell[]>();
    for (const well of plate.wells) {
      if (!well.sample && !well.gene) continue;
      if (!well.sample || !well.gene) {
        errors.push({
          code: "E_PARTIAL_WELL_ASSIGNMENT",
          plateNumber: plate.plateNumber,
          wellIds: [well.wellId],
          message: `Plate ${String(plate.plateNumber).padStart(2, "0")}：${well.wellId} 的样本或基因信息不完整。 / Sample or assay assignment is incomplete.`,
        });
        continue;
      }
      if (!knownSamples.has(well.sample)) {
        errors.push({
          code: "E_UNKNOWN_SAMPLE",
          plateNumber: plate.plateNumber,
          wellIds: [well.wellId],
          message: `${well.wellId} 使用了未登记样本 ${well.sample}。 / The well uses an unregistered sample.`,
        });
      }
      if (!targetSet.has(well.gene) && !referenceSet.has(well.gene)) {
        errors.push({
          code: "E_UNKNOWN_GENE",
          plateNumber: plate.plateNumber,
          wellIds: [well.wellId],
          message: `${well.wellId} 使用了未登记基因 ${well.gene}。 / The well uses an unregistered assay.`,
        });
      } else {
        const expectedGeneType: GeneType = targetSet.has(well.gene)
          ? "target"
          : "reference";
        if (well.geneType !== expectedGeneType) {
          errors.push({
            code: "E_GENE_TYPE_MISMATCH",
            plateNumber: plate.plateNumber,
            wellIds: [well.wellId],
            message: `Plate ${String(plate.plateNumber).padStart(2, "0")}：${well.wellId} 的基因 ${well.gene} 应标记为${expectedGeneType === "reference" ? "内参" : "目的"}基因。 / The assay role does not match the experiment setup.`,
          });
        }
      }
      const key = groupKey(well.sample, well.gene);
      const local = plateGroups.get(key) ?? [];
      local.push(well);
      plateGroups.set(key, local);
      if (targetSet.has(well.gene)) {
        const global = globalTargetGroups.get(key) ?? [];
        global.push({ well, plateNumber: plate.plateNumber });
        globalTargetGroups.set(key, global);
      }
    }

    for (const [key, wells] of plateGroups) {
      const [sample, gene] = key.split("\u0000");
      const sorted = wells
        .slice()
        .sort((left, right) => left.column - right.column);
      const sameRow = sorted.every((well) => well.row === sorted[0].row);
      const continuous = sorted.every(
        (well, index) =>
          index === 0 || well.column === sorted[index - 1].column + 1,
      );
      const replicateOrder = sorted.every(
        (well, index) => well.replicateIndex === index + 1,
      );
      if (
        wells.length !== input.replicates ||
        !sameRow ||
        !continuous ||
        !replicateOrder
      ) {
        errors.push({
          code: "E_REPLICATE_BLOCK_BROKEN",
          plateNumber: plate.plateNumber,
          wellIds: wells.map((well) => well.wellId),
          message: `Plate ${String(plate.plateNumber).padStart(2, "0")}：${sample} × ${gene} 的 ${input.replicates} 个复孔必须在同一行从左向右连续。 / Replicates must be contiguous from left to right in one row.`,
        });
      }
    }

    const targetSamples = new Set(
      Array.from(plateGroups.keys())
        .filter((key) => targetSet.has(key.split("\u0000")[1]))
        .map((key) => key.split("\u0000")[0]),
    );
    const referenceSamples = new Set(
      Array.from(plateGroups.keys())
        .filter((key) => referenceSet.has(key.split("\u0000")[1]))
        .map((key) => key.split("\u0000")[0]),
    );

    for (const sample of targetSamples) {
      for (const referenceGene of input.referenceGenes) {
        const wells = plateGroups.get(groupKey(sample, referenceGene)) ?? [];
        if (wells.length !== input.replicates) {
          errors.push({
            code: "E_REFERENCE_COHERENCE",
            plateNumber: plate.plateNumber,
            message: `Plate ${String(plate.plateNumber).padStart(2, "0")}：样本 ${sample} 在本板有目的基因，但缺少完整内参 ${referenceGene}；跨板时内参必须在每块板重新做。 / This sample has a target on the plate but lacks a complete ${referenceGene} block; all references must be rerun on every involved plate.`,
          });
        }
      }
    }

    for (const sample of referenceSamples) {
      if (!targetSamples.has(sample)) {
        errors.push({
          code: "E_ORPHAN_REFERENCE",
          plateNumber: plate.plateNumber,
          message: `Plate ${String(plate.plateNumber).padStart(2, "0")}：样本 ${sample} 只有内参、没有目的基因检测，请确认是否为多余孔。 / This sample has references but no target assay on the plate.`,
        });
      }
    }
  });

  for (const sample of input.samples) {
    for (const gene of input.targetGenes) {
      const assignments =
        globalTargetGroups.get(groupKey(sample, gene)) ?? [];
      if (assignments.length !== input.replicates) {
        const affectedPlateNumbers = Array.from(
          new Set(assignments.map((assignment) => assignment.plateNumber)),
        );
        const plateNumbers =
          affectedPlateNumbers.length > 0
            ? affectedPlateNumbers
            : [undefined];
        for (const plateNumber of plateNumbers) {
          const wells =
            plateNumber === undefined
              ? []
              : assignments
                  .filter(
                    (assignment) =>
                      assignment.plateNumber === plateNumber,
                  )
                  .map((assignment) => assignment.well);
          errors.push({
            code:
              assignments.length === 0
                ? "E_REQUIRED_ASSAY_MISSING"
                : "E_REQUIRED_ASSAY_DUPLICATED",
            plateNumber,
            wellIds: wells.map((well) => well.wellId),
            message:
              assignments.length === 0
                ? `缺少 ${sample} × ${gene} 的目的基因检测孔。 / Required target wells are missing.`
                : `${sample} × ${gene} 共出现 ${assignments.length} 孔，应为 ${input.replicates} 孔。 / Found ${assignments.length} wells; expected ${input.replicates}.`,
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
