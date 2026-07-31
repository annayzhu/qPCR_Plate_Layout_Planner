import type {
  GeneType,
  PlanResult,
} from "./platePlanner";

export interface ReactionSystemInput {
  cdnaPerWellUl: number;
  primerPairPerWellUl: number;
  masterMixPerWellUl: number;
  totalPerWellUl: number;
  overagePercent: number;
}

export interface PerWellReactionRow {
  key: "masterMix" | "forwardPrimer" | "reversePrimer" | "cdna" | "water";
  volumeUl: number;
}

export interface GeneReactionRequirement {
  gene: string;
  geneType: GeneType;
  wellCount: number;
  blankWellCount: number;
  forwardPrimerUl: number;
  reversePrimerUl: number;
  primerPairUl: number;
  masterMixUl: number;
  waterUl: number;
  mixExcludingCdnaUl: number;
  reactionVolumeUl: number;
}

export interface SampleCdnaRequirement {
  sample: string;
  wellCount: number;
  isBlank: boolean;
  theoreticalCdnaUl: number;
  recommendedCdnaUl: number;
  replacementWaterUl: number;
}

export interface ReactionCalculation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  preparationFactor: number;
  waterPerWellUl: number;
  perWellRows: PerWellReactionRow[];
  totalWells: number;
  blankWellCount: number;
  geneRequirements: GeneReactionRequirement[];
  sampleRequirements: SampleCdnaRequirement[];
  totals: {
    theoreticalReactionUl: number;
    recommendedReactionUl: number;
    masterMixUl: number;
    forwardPrimerUl: number;
    reversePrimerUl: number;
    primerPairUl: number;
    cdnaUl: number;
    waterUl: number;
  };
}

const EPSILON = 1e-9;

function isNonNegativeFinite(value: number) {
  return Number.isFinite(value) && value >= 0;
}

export function calculateReactionRequirements(
  layout: PlanResult | null,
  input: ReactionSystemInput,
  sampleOrder: string[],
  geneOrder: Array<{ name: string; role: GeneType }>,
  blankSampleNames: string[] = [],
): ReactionCalculation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalizedBlankNames = new Set(
    blankSampleNames.map((sample) => sample.trim().toLocaleLowerCase()),
  );
  const isBlankSample = (sample: string) =>
    normalizedBlankNames.has(sample.trim().toLocaleLowerCase());
  const namedInputs: Array<[string, number]> = [
    ["cDNA", input.cdnaPerWellUl],
    ["引物总体积 / primer-pair volume", input.primerPairPerWellUl],
    ["反应预混液 / master mix", input.masterMixPerWellUl],
    ["反应总体积 / total reaction volume", input.totalPerWellUl],
    ["配液余量 / pipetting overage", input.overagePercent],
  ];
  for (const [label, value] of namedInputs) {
    if (!isNonNegativeFinite(value)) {
      errors.push(
        `${label} 必须是大于或等于 0 的有限数值。 / Must be a finite value ≥ 0.`,
      );
    }
  }
  if (input.totalPerWellUl <= 0) {
    errors.push(
      "每孔反应总体积必须大于 0 µL。 / Total reaction volume per well must be > 0 µL.",
    );
  }
  if (input.masterMixPerWellUl <= 0) {
    errors.push(
      "每孔反应预混液体积必须大于 0 µL。 / Master mix volume per well must be > 0 µL.",
    );
  }
  if (input.primerPairPerWellUl <= 0) {
    errors.push(
      "每孔上、下游引物总体积必须大于 0 µL。 / Combined forward and reverse primer volume must be > 0 µL.",
    );
  }
  if (input.overagePercent > 50) {
    warnings.push(
      "配液余量超过 50%，请确认是否符合本地 SOP。 / Overage exceeds 50%; check the local SOP.",
    );
  }

  const forwardPrimerPerWellUl = input.primerPairPerWellUl / 2;
  const reversePrimerPerWellUl = input.primerPairPerWellUl / 2;
  const waterPerWellUl =
    input.totalPerWellUl -
    input.masterMixPerWellUl -
    input.primerPairPerWellUl -
    input.cdnaPerWellUl;
  if (waterPerWellUl < -EPSILON) {
    errors.push(
      `各组分合计超过反应总体积 ${Math.abs(waterPerWellUl).toFixed(2)} µL，无法用水补足。 / Components exceed the total volume by ${Math.abs(waterPerWellUl).toFixed(2)} µL.`,
    );
  }
  if (
    input.totalPerWellUl > 0 &&
    Math.abs(input.masterMixPerWellUl - input.totalPerWellUl / 2) >
      Math.max(0.05, input.totalPerWellUl * 0.02)
  ) {
    warnings.push(
      "若使用 2× SYBR Green 预混液，通常按 1× 终浓度加入，即体积约为反应总体积的一半；请以具体试剂说明书为准。 / A 2× SYBR Green mix is commonly used at 1× final concentration (about half the reaction volume); follow the product IFU.",
    );
  }
  if (
    input.primerPairPerWellUl > 0 &&
    Math.min(forwardPrimerPerWellUl, reversePrimerPerWellUl) < 0.2
  ) {
    warnings.push(
      "单支引物移液体积低于 0.2 µL；请确认移液器量程，必要时先配制等摩尔引物工作液。 / Each primer is below 0.2 µL; check pipette capability or prepare an equimolar working mix.",
    );
  }
  if (input.totalPerWellUl > 0 && input.totalPerWellUl < 10) {
    warnings.push(
      "当前反应总体积低于 10 µL；请确认试剂盒和仪器是否验证过该微量体系。 / Total volume is below 10 µL; confirm that the kit and instrument support this scale.",
    );
  }
  if (
    input.cdnaPerWellUl === 0 &&
    sampleOrder.some((sample) => !isBlankSample(sample))
  ) {
    warnings.push(
      "当前 cDNA 体积为 0 µL；这只适用于 NTC 等无模板反应，不适用于样本检测孔。 / Zero cDNA is appropriate for no-template controls, not sample assay wells.",
    );
  }

  const preparationFactor = 1 + input.overagePercent / 100;
  const occupiedWells =
    layout?.plates.flatMap((plate) =>
      plate.wells.filter((well) => well.sample && well.gene),
    ) ?? [];
  const totalWells = occupiedWells.length;
  const blankWellCount = occupiedWells.filter(
    (well) => well.sample && isBlankSample(well.sample),
  ).length;
  if (layout && totalWells === 0) {
    errors.push(
      "当前布局没有实际反应孔，无法计算试剂用量。 / No occupied reaction wells are available for reagent calculation.",
    );
  }

  const sampleCounts = new Map(sampleOrder.map((sample) => [sample, 0]));
  const geneCounts = new Map(
    geneOrder.map((gene) => [
      gene.name,
      { count: 0, blankCount: 0, geneType: gene.role },
    ]),
  );
  for (const well of occupiedWells) {
    if (well.sample) {
      sampleCounts.set(well.sample, (sampleCounts.get(well.sample) ?? 0) + 1);
    }
    if (well.gene) {
      const current = geneCounts.get(well.gene) ?? {
        count: 0,
        blankCount: 0,
        geneType: well.geneType ?? "target",
      };
      current.count += 1;
      if (well.sample && isBlankSample(well.sample)) {
        current.blankCount += 1;
      }
      geneCounts.set(well.gene, current);
    }
  }

  const geneRequirements = geneOrder
    .map(({ name, role }) => {
      const wellCount = geneCounts.get(name)?.count ?? 0;
      const blankWellCount = geneCounts.get(name)?.blankCount ?? 0;
      const factor = wellCount * preparationFactor;
      const replacementWaterUl =
        blankWellCount * preparationFactor * input.cdnaPerWellUl;
      const waterUl =
        factor * Math.max(0, waterPerWellUl) + replacementWaterUl;
      return {
        gene: name,
        geneType: role,
        wellCount,
        blankWellCount,
        forwardPrimerUl: factor * forwardPrimerPerWellUl,
        reversePrimerUl: factor * reversePrimerPerWellUl,
        primerPairUl: factor * input.primerPairPerWellUl,
        masterMixUl: factor * input.masterMixPerWellUl,
        waterUl,
        mixExcludingCdnaUl:
          factor *
          (input.masterMixPerWellUl +
            input.primerPairPerWellUl +
            Math.max(0, waterPerWellUl)) +
          replacementWaterUl,
        reactionVolumeUl: factor * input.totalPerWellUl,
      };
    })
    .filter((requirement) => requirement.wellCount > 0);

  const sampleRequirements = sampleOrder
    .map((sample) => {
      const wellCount = sampleCounts.get(sample) ?? 0;
      const isBlank = isBlankSample(sample);
      const theoreticalCdnaUl = isBlank
        ? 0
        : wellCount * input.cdnaPerWellUl;
      return {
        sample,
        wellCount,
        isBlank,
        theoreticalCdnaUl,
        recommendedCdnaUl: theoreticalCdnaUl * preparationFactor,
        replacementWaterUl: isBlank
          ? wellCount * input.cdnaPerWellUl * preparationFactor
          : 0,
      };
    })
    .filter((requirement) => requirement.wellCount > 0);

  const factor = totalWells * preparationFactor;
  const nonBlankWellCount = totalWells - blankWellCount;
  const replacementWaterUl =
    blankWellCount * preparationFactor * input.cdnaPerWellUl;
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    preparationFactor,
    waterPerWellUl: Math.max(0, waterPerWellUl),
    perWellRows: [
      { key: "masterMix", volumeUl: input.masterMixPerWellUl },
      { key: "forwardPrimer", volumeUl: forwardPrimerPerWellUl },
      { key: "reversePrimer", volumeUl: reversePrimerPerWellUl },
      { key: "cdna", volumeUl: input.cdnaPerWellUl },
      { key: "water", volumeUl: Math.max(0, waterPerWellUl) },
    ],
    totalWells,
    blankWellCount,
    geneRequirements,
    sampleRequirements,
    totals: {
      theoreticalReactionUl: totalWells * input.totalPerWellUl,
      recommendedReactionUl: factor * input.totalPerWellUl,
      masterMixUl: factor * input.masterMixPerWellUl,
      forwardPrimerUl: factor * forwardPrimerPerWellUl,
      reversePrimerUl: factor * reversePrimerPerWellUl,
      primerPairUl: factor * input.primerPairPerWellUl,
      cdnaUl:
        nonBlankWellCount * preparationFactor * input.cdnaPerWellUl,
      waterUl:
        factor * Math.max(0, waterPerWellUl) + replacementWaterUl,
    },
  };
}
