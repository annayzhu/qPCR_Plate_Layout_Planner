"use client";

import {
  AlertTriangle,
  Beaker,
  Check,
  Download,
  FileSpreadsheet,
  FlaskConical,
  Info,
  Languages,
  Layers3,
  Minus,
  Move,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  Fragment,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  exportAllPlateExcels,
  exportPlateExcel,
  type ExportContext,
  type ExportablePlate,
} from "@/lib/exportExcel";
import {
  calculateReactionRequirements,
  DEFAULT_REACTION_SYSTEM,
  normalizeReactionSystemInput,
  type LegacyReactionSystemInput,
  type ReactionSystemInput,
} from "@/lib/reactionCalculator";
import {
  assignSelectedWells,
  rectangularWellIds,
  translateSelectedWells,
} from "@/lib/manualLayout";
import {
  defaultPlateName,
  formatWellId,
  getPlateDimensions,
  planPlateLayout,
  refreshPlanDerivedData,
  validateLayout,
  type GeneType,
  type LayoutPreset,
  type LoadingPattern,
  type PlanInput,
  type PlannerPlate,
  type PlannerWell,
  type PlanResult,
  type PlateType,
  type ValidationIssue,
} from "@/lib/platePlanner";
import { ReactionCalculator } from "@/app/ReactionCalculator";

type GeneRole = "target" | "reference";
type SampleKind = "sample" | "blank";
type Language = "zh" | "en";

interface GeneEntry {
  id: string;
  name: string;
  role: GeneRole;
}

interface SampleEntry {
  id: string;
  name: string;
  kind: SampleKind;
}

interface EditorState {
  plateIndex: number;
  wellIds: string[];
  mode: "assay" | "empty";
  sample: string;
  gene: string;
}

interface ToastState {
  tone: "success" | "error" | "neutral";
  message: string;
}

interface StoredPlannerState {
  version: 6;
  plateType: PlateType;
  samples: SampleEntry[];
  genes: GeneEntry[];
  replicates: number;
  layoutPreset: LayoutPreset;
  loadingPattern: LoadingPattern;
  layout: PlanResult | null;
  automaticLayout: PlanResult | null;
  layoutSignature: string;
  generatedAt: string;
  confirmed: Record<string, boolean>;
  reactionSystem?: Partial<ReactionSystemInput>;
  language: Language;
}

type StoredPlannerStateV5 = Omit<
  StoredPlannerState,
  "version" | "reactionSystem"
> & {
  version: 5;
  reactionSystem?: LegacyReactionSystemInput;
};

type StoredPlannerStateV4 = Omit<
  StoredPlannerState,
  "version" | "reactionSystem"
> & {
  version: 4;
  reactionSystem?: LegacyReactionSystemInput;
};

interface StoredPlannerStateV3 {
  version: 3;
  plateType: PlateType;
  samples: SampleEntry[];
  genes: GeneEntry[];
  replicates: number;
  layoutPreset: LayoutPreset;
  layout: PlanResult | null;
  automaticLayout: PlanResult | null;
  layoutSignature: string;
  generatedAt: string;
  confirmed: Record<string, boolean>;
  reactionSystem?: LegacyReactionSystemInput;
  language: Language;
}

interface StoredPlannerStateV2 {
  version: 2;
  plateType: PlateType;
  samples: SampleEntry[];
  genes: GeneEntry[];
  replicates: number;
  layout: PlanResult | null;
  automaticLayout: PlanResult | null;
  layoutSignature: string;
  generatedAt: string;
  confirmed: Record<string, boolean>;
  reactionSystem?: LegacyReactionSystemInput;
  language: Language;
}

interface StoredPlannerStateV1 {
  version: 1;
  plateType: PlateType;
  samples: string[];
  genes: GeneEntry[];
  replicates: number;
  layout: PlanResult | null;
  automaticLayout: PlanResult | null;
  layoutSignature: string;
  generatedAt: string;
  confirmed: Record<string, boolean>;
  reactionSystem?: LegacyReactionSystemInput;
}

const STORAGE_KEY = "qpcr-plate-planner:v1";
const TARGET_PALETTE = [
  { background: "#DDE8F2", text: "#29465E" },
  { background: "#DCEBE8", text: "#26564F" },
  { background: "#E4E2EF", text: "#4C466B" },
  { background: "#DCE7F0", text: "#2C506A" },
  { background: "#E1E9E3", text: "#385542" },
  { background: "#E3E5EC", text: "#454D60" },
];

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clonePlan<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function withPlateNames(
  result: PlanResult | null,
  fallbackLoadingPattern: LoadingPattern = "sequential",
) {
  if (!result) return null;
  return {
    ...result,
    loadingPattern: result.loadingPattern ?? fallbackLoadingPattern,
    plates: result.plates.map((plate) => ({
      ...plate,
      name: plate.name?.trim() || defaultPlateName(plate.plateNumber),
    })),
  };
}

function migrateLegacySamples(samples: string[]): SampleEntry[] {
  return samples.map((name) => ({
    id: makeId("sample"),
    name,
    kind: "sample",
  }));
}

function parseExcelNames(value: string) {
  return value
    .split(/\t|\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizedKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function defaultLoadingPattern(plateType: PlateType): LoadingPattern {
  return plateType === 384 ? "interleaved-8-channel" : "sequential";
}

function experimentSignature(
  plateType: PlateType,
  samples: SampleEntry[],
  genes: GeneEntry[],
  replicates: number,
  layoutPreset: LayoutPreset,
  loadingPattern: LoadingPattern,
) {
  return JSON.stringify({
    plateType,
    samples: samples.map(({ name }) => name),
    genes: genes.map(({ name, role }) => ({ name, role })),
    replicates,
    layoutPreset,
    loadingPattern,
  });
}

function experimentSignatureV3(
  plateType: PlateType,
  samples: SampleEntry[],
  genes: GeneEntry[],
  replicates: number,
  layoutPreset: LayoutPreset,
) {
  return JSON.stringify({
    plateType,
    samples: samples.map(({ name }) => name),
    genes: genes.map(({ name, role }) => ({ name, role })),
    replicates,
    layoutPreset,
  });
}

function experimentSignatureV2(
  plateType: PlateType,
  samples: SampleEntry[],
  genes: GeneEntry[],
  replicates: number,
) {
  return JSON.stringify({
    plateType,
    samples: samples.map(({ name }) => name),
    genes: genes.map(({ name, role }) => ({ name, role })),
    replicates,
  });
}

function inferredLayoutPreset(result: PlanResult | null): LayoutPreset {
  return result?.strategy === "gene-major" ? "gene-major" : "sample-major";
}

function migrateLayoutSignature(
  storedSignature: string,
  plateType: PlateType,
  samples: SampleEntry[],
  genes: GeneEntry[],
  replicates: number,
  layoutPreset: LayoutPreset,
  loadingPattern: LoadingPattern,
) {
  if (!storedSignature) return "";
  const v2Signature = experimentSignatureV2(
    plateType,
    samples,
    genes,
    replicates,
  );
  const v3Signature = experimentSignatureV3(
    plateType,
    samples,
    genes,
    replicates,
    layoutPreset,
  );
  return storedSignature === v2Signature || storedSignature === v3Signature
    ? experimentSignature(
        plateType,
        samples,
        genes,
        replicates,
        layoutPreset,
        loadingPattern,
      )
    : storedSignature;
}

function strategyLabel(strategy: PlanResult["strategy"]) {
  if (strategy === "sample-major")
    return "按样本排列 / By sample";
  if (strategy === "gene-major")
    return "按基因排列 / By assay";
  return "混合分块 / Hybrid";
}

function targetColor(gene: string, targetGenes: string[]) {
  const index = Math.max(0, targetGenes.indexOf(gene));
  return TARGET_PALETTE[index % TARGET_PALETTE.length];
}

function wellVisual(
  well: PlannerWell,
  targetGenes: string[],
): CSSProperties {
  if (!well.gene || !well.geneType) return {};
  if (well.geneType === "reference") {
    return {
      "--well-bg": "#F3DFC4",
      "--well-ink": "#754A1D",
    } as CSSProperties;
  }
  const color = targetColor(well.gene, targetGenes);
  return {
    "--well-bg": color.background,
    "--well-ink": color.text,
  } as CSSProperties;
}

function shortLabel(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function plateStatus(
  confirmed: boolean,
  warningCount: number,
  stale: boolean,
  language: Language,
) {
  const tr = (zh: string, en: string) => (language === "zh" ? zh : en);
  if (stale)
    return { label: tr("设置已变更", "Stale"), className: "invalid" };
  if (confirmed)
    return { label: tr("已确认", "Confirmed"), className: "confirmed" };
  if (warningCount > 0)
    return { label: tr("有提醒", "Advisory"), className: "warning" };
  return { label: tr("草稿", "Draft"), className: "" };
}

export function QpcrPlanner() {
  const [plateType, setPlateType] = useState<PlateType>(96);
  const [samples, setSamples] = useState<SampleEntry[]>([]);
  const [genes, setGenes] = useState<GeneEntry[]>([]);
  const [language, setLanguage] = useState<Language>("zh");
  const [replicates, setReplicates] = useState(3);
  const [layoutPreset, setLayoutPreset] =
    useState<LayoutPreset>("sample-major");
  const [loadingPattern, setLoadingPattern] =
    useState<LoadingPattern>("sequential");
  const [sampleInput, setSampleInput] = useState("");
  const [geneInput, setGeneInput] = useState("");
  const [samplePaste, setSamplePaste] = useState("");
  const [genePaste, setGenePaste] = useState("");
  const [layout, setLayout] = useState<PlanResult | null>(null);
  const [automaticLayout, setAutomaticLayout] = useState<PlanResult | null>(
    null,
  );
  const [layoutSignature, setLayoutSignature] = useState("");
  const [generatedAt, setGeneratedAt] = useState("");
  const [activePlateIndex, setActivePlateIndex] = useState(0);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [undoStack, setUndoStack] = useState<PlanResult[]>([]);
  const [redoStack, setRedoStack] = useState<PlanResult[]>([]);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [selectedWellIds, setSelectedWellIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(
    null,
  );
  const [moveMode, setMoveMode] = useState(false);
  const [editingPlateName, setEditingPlateName] = useState(false);
  const [plateNameDraft, setPlateNameDraft] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [savedAt, setSavedAt] = useState("");
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [reactionSystem, setReactionSystem] =
    useState<ReactionSystemInput>(DEFAULT_REACTION_SYSTEM);

  const tr = useCallback(
    (zh: string, en: string) => (language === "zh" ? zh : en),
    [language],
  );
  const localizeMessage = (message: string) => {
    const divider = message.lastIndexOf(" / ");
    if (divider < 0) return message;
    return language === "zh"
      ? message.slice(0, divider)
      : message.slice(divider + 3);
  };
  const sampleNames = useMemo(
    () => samples.map((sample) => sample.name),
    [samples],
  );
  const samplePasteNames = useMemo(
    () => parseExcelNames(samplePaste),
    [samplePaste],
  );
  const blankSampleNames = useMemo(
    () =>
      samples
        .filter((sample) => sample.kind === "blank")
        .map((sample) => sample.name),
    [samples],
  );
  const blankSampleSet = useMemo(
    () => new Set(blankSampleNames),
    [blankSampleNames],
  );
  const dimensions = getPlateDimensions(plateType);
  const targetGenes = useMemo(
    () => genes.filter((gene) => gene.role === "target").map((gene) => gene.name),
    [genes],
  );
  const referenceGenes = useMemo(
    () =>
      genes
        .filter((gene) => gene.role === "reference")
        .map((gene) => gene.name),
    [genes],
  );

  const planInput: PlanInput = useMemo(
    () => ({
      plateType,
      samples: sampleNames,
      targetGenes,
      referenceGenes,
      replicates,
    }),
    [plateType, referenceGenes, replicates, sampleNames, targetGenes],
  );

  const currentSignature = useMemo(
    () =>
      experimentSignature(
        plateType,
        samples,
        genes,
        replicates,
        layoutPreset,
        loadingPattern,
      ),
    [genes, layoutPreset, loadingPattern, plateType, replicates, samples],
  );
  const settingsStale = Boolean(layout && layoutSignature !== currentSignature);
  const reactionWells = sampleNames.length * genes.length * replicates;
  const effectiveBlocks =
    dimensions.rows * Math.floor(dimensions.columns / Math.max(1, replicates));
  const sampleFullRunWells = genes.length * replicates;

  const inputIssues = useMemo(() => {
    const issues: string[] = [];
    if (sampleNames.length === 0)
      issues.push(tr("请至少添加 1 个样本", "Add at least one sample"));
    if (targetGenes.length === 0)
      issues.push(tr("请至少添加 1 个目的基因", "Add at least one target assay"));
    if (referenceGenes.length === 0)
      issues.push(
        tr(
          "请至少将 1 个基因标记为内参",
          "Mark at least one assay as a reference",
        ),
      );
    if (!Number.isInteger(replicates) || replicates < 1)
      issues.push(
        tr(
          "复孔数必须是正整数",
          "Replicate count must be a positive integer",
        ),
      );
    if (replicates > dimensions.columns)
      issues.push(
        tr(
          `复孔数不能超过单行 ${dimensions.columns} 孔`,
          `Replicates cannot exceed ${dimensions.columns} columns`,
        ),
      );
    if (referenceGenes.length + 1 > effectiveBlocks)
      issues.push(
        tr(
          "全部内参加至少 1 个目的基因的同板配对无法放入当前孔板",
          "One target plus all references cannot fit on this plate",
        ),
      );
    if (
      plateType === 384 &&
      loadingPattern === "interleaved-8-channel" &&
      layoutPreset === "gene-major" &&
      referenceGenes.length + 1 >
        Math.floor(dimensions.columns / Math.max(1, replicates))
    )
      issues.push(
        tr(
          "当前复孔数下，一个 16 行隔行上样列块组无法同时容纳全部内参和至少 1 个目的基因；请减少复孔或内参数量，或切换连续孔位上样",
          "At this replicate count, one 16-row interleaved band cannot hold all references plus one target; reduce replicates or references, or use sequential loading",
        ),
      );
    return issues;
  }, [
    dimensions.columns,
    effectiveBlocks,
    layoutPreset,
    loadingPattern,
    plateType,
    referenceGenes.length,
    replicates,
    sampleNames.length,
    targetGenes.length,
    tr,
  ]);

  const audit = useMemo(
    () =>
      layout
        ? validateLayout(layout, planInput)
        : { valid: false, errors: [] as ValidationIssue[] },
    [layout, planInput],
  );
  const reactionCalculation = useMemo(
    () =>
      calculateReactionRequirements(
        layout,
        reactionSystem,
        sampleNames,
        genes.map((gene) => ({
          name: gene.name,
          role: gene.role,
        })),
        blankSampleNames,
      ),
    [blankSampleNames, genes, layout, reactionSystem, sampleNames],
  );

  const activePlate = layout?.plates[activePlateIndex] ?? null;
  const previewLoadingPattern = layout?.loadingPattern ?? loadingPattern;
  const previewIs384 = layout
    ? layout.plates[0]?.rows === 16
    : plateType === 384;
  const activePlateConfirmed = activePlate
    ? Boolean(confirmed[String(activePlate.plateNumber)])
    : false;
  const allConfirmed = Boolean(
    layout &&
      reactionCalculation.valid &&
      !settingsStale &&
      layout.plates.every((plate) => confirmed[String(plate.plateNumber)]),
  );

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as
            | StoredPlannerState
            | StoredPlannerStateV5
            | StoredPlannerStateV4
            | StoredPlannerStateV3
            | StoredPlannerStateV2
            | StoredPlannerStateV1;
          if (parsed.version === 1) {
            const migratedSamples = migrateLegacySamples(parsed.samples);
            const migratedPreset = inferredLayoutPreset(parsed.layout);
            const migratedLoadingPattern: LoadingPattern = "sequential";
            setPlateType(parsed.plateType);
            setSamples(migratedSamples);
            setGenes(parsed.genes);
            setReplicates(parsed.replicates);
            setLayoutPreset(migratedPreset);
            setLoadingPattern(migratedLoadingPattern);
            setLayout(withPlateNames(parsed.layout, migratedLoadingPattern));
            setAutomaticLayout(
              withPlateNames(parsed.automaticLayout, migratedLoadingPattern),
            );
            setLayoutSignature(
              migrateLayoutSignature(
                parsed.layoutSignature,
                parsed.plateType,
                migratedSamples,
                parsed.genes,
                parsed.replicates,
                migratedPreset,
                migratedLoadingPattern,
              ),
            );
            setGeneratedAt(parsed.generatedAt);
            setConfirmed(parsed.confirmed);
            setReactionSystem(
              normalizeReactionSystemInput(parsed.reactionSystem),
            );
            setSavedAt("restored");
          } else if (parsed.version === 2) {
            const migratedPreset = inferredLayoutPreset(parsed.layout);
            const migratedLoadingPattern: LoadingPattern = "sequential";
            setPlateType(parsed.plateType);
            setSamples(parsed.samples);
            setGenes(parsed.genes);
            setReplicates(parsed.replicates);
            setLayoutPreset(migratedPreset);
            setLoadingPattern(migratedLoadingPattern);
            setLayout(withPlateNames(parsed.layout, migratedLoadingPattern));
            setAutomaticLayout(
              withPlateNames(parsed.automaticLayout, migratedLoadingPattern),
            );
            setLayoutSignature(
              migrateLayoutSignature(
                parsed.layoutSignature,
                parsed.plateType,
                parsed.samples,
                parsed.genes,
                parsed.replicates,
                migratedPreset,
                migratedLoadingPattern,
              ),
            );
            setGeneratedAt(parsed.generatedAt);
            setConfirmed(parsed.confirmed);
            setReactionSystem(
              normalizeReactionSystemInput(parsed.reactionSystem),
            );
            setLanguage(parsed.language ?? "zh");
            setSavedAt("restored");
          } else if (parsed.version === 3) {
            const migratedLoadingPattern: LoadingPattern = "sequential";
            setPlateType(parsed.plateType);
            setSamples(parsed.samples);
            setGenes(parsed.genes);
            setReplicates(parsed.replicates);
            setLayoutPreset(parsed.layoutPreset);
            setLoadingPattern(migratedLoadingPattern);
            setLayout(withPlateNames(parsed.layout, migratedLoadingPattern));
            setAutomaticLayout(
              withPlateNames(parsed.automaticLayout, migratedLoadingPattern),
            );
            setLayoutSignature(
              migrateLayoutSignature(
                parsed.layoutSignature,
                parsed.plateType,
                parsed.samples,
                parsed.genes,
                parsed.replicates,
                parsed.layoutPreset,
                migratedLoadingPattern,
              ),
            );
            setGeneratedAt(parsed.generatedAt);
            setConfirmed(parsed.confirmed);
            setReactionSystem(
              normalizeReactionSystemInput(parsed.reactionSystem),
            );
            setLanguage(parsed.language ?? "zh");
            setSavedAt("restored");
          } else if (
            parsed.version === 4 ||
            parsed.version === 5 ||
            parsed.version === 6
          ) {
            const restoredLoadingPattern =
              parsed.plateType === 96
                ? "sequential"
                : (parsed.loadingPattern ??
                  defaultLoadingPattern(parsed.plateType));
            setPlateType(parsed.plateType);
            setSamples(parsed.samples);
            setGenes(parsed.genes);
            setReplicates(parsed.replicates);
            setLayoutPreset(parsed.layoutPreset);
            setLoadingPattern(restoredLoadingPattern);
            setLayout(withPlateNames(parsed.layout, restoredLoadingPattern));
            setAutomaticLayout(
              withPlateNames(parsed.automaticLayout, restoredLoadingPattern),
            );
            setLayoutSignature(parsed.layoutSignature);
            setGeneratedAt(parsed.generatedAt);
            setConfirmed(parsed.confirmed);
            setReactionSystem(
              normalizeReactionSystemInput(parsed.reactionSystem),
            );
            setLanguage(parsed.language ?? "zh");
            setSavedAt("restored");
          }
        }
      } catch {
        setToast({
          tone: "error",
          message:
            "未能恢复上次保存的方案，但不会影响新建布局。 / The saved plan could not be restored; a new plan can still be created.",
        });
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3_200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  function markChanged() {
    setDirty(true);
    setSavedAt("");
  }

  function chooseLoadingPattern(nextPattern: LoadingPattern) {
    if (nextPattern === loadingPattern) return;
    setLoadingPattern(nextPattern);
    if (
      nextPattern === "interleaved-8-channel" &&
      layoutPreset !== "gene-major"
    ) {
      setLayoutPreset("gene-major");
      setToast({
        tone: "neutral",
        message: tr(
          "已推荐切换为按基因排列；仍可手动改回按样本排列。",
          "Switched to the recommended assay-major layout; you can still choose sample-major.",
        ),
      });
    }
    markChanged();
  }

  function addSamples(values: string[]) {
    const existing = new Set(
      samples.map((sample) => normalizedKey(sample.name)),
    );
    const additions: SampleEntry[] = [];
    const duplicates: string[] = [];
    for (const rawValue of values) {
      const value = rawValue.trim();
      if (!value) continue;
      const key = normalizedKey(value);
      if (existing.has(key)) {
        duplicates.push(value);
        continue;
      }
      existing.add(key);
      additions.push({
        id: makeId("sample"),
        name: value,
        kind: "sample",
      });
    }
    if (additions.length > 0) {
      setSamples((current) => [...current, ...additions]);
      markChanged();
    }
    if (duplicates.length > 0) {
      setToast({
        tone: "error",
        message: tr(
          `已跳过 ${duplicates.length} 个重复样本：${duplicates
            .slice(0, 3)
            .join("、")}${duplicates.length > 3 ? "…" : ""}`,
          `Skipped ${duplicates.length} duplicate sample(s): ${duplicates
            .slice(0, 3)
            .join(", ")}${duplicates.length > 3 ? "…" : ""}`,
        ),
      });
    } else if (additions.length > 0) {
      setToast({
        tone: "success",
        message: tr(
          `已添加 ${additions.length} 个样本。`,
          `Added ${additions.length} sample(s).`,
        ),
      });
    }
  }

  function addGenes(values: string[]) {
    const existing = new Set(genes.map((gene) => normalizedKey(gene.name)));
    const additions: GeneEntry[] = [];
    const duplicates: string[] = [];
    for (const rawValue of values) {
      const value = rawValue.trim();
      if (!value) continue;
      const key = normalizedKey(value);
      if (existing.has(key)) {
        duplicates.push(value);
        continue;
      }
      existing.add(key);
      additions.push({ id: makeId("gene"), name: value, role: "target" });
    }
    if (additions.length > 0) {
      setGenes((current) => [...current, ...additions]);
      markChanged();
    }
    if (duplicates.length > 0) {
      setToast({
        tone: "error",
        message: tr(
          `已跳过 ${duplicates.length} 个重复基因：${duplicates
            .slice(0, 3)
            .join("、")}${duplicates.length > 3 ? "…" : ""}`,
          `Skipped ${duplicates.length} duplicate assay(s): ${duplicates
            .slice(0, 3)
            .join(", ")}${duplicates.length > 3 ? "…" : ""}`,
        ),
      });
    } else if (additions.length > 0) {
      setToast({
        tone: "success",
        message: tr(
          `已添加 ${additions.length} 个基因；新导入项默认为目的基因。`,
          `Added ${additions.length} assay(s); imported assays default to target.`,
        ),
      });
    }
  }

  function submitSample(event: FormEvent) {
    event.preventDefault();
    if (!sampleInput.trim()) return;
    addSamples([sampleInput]);
    setSampleInput("");
  }

  function submitGene(event: FormEvent) {
    event.preventDefault();
    if (!geneInput.trim()) return;
    addGenes([geneInput]);
    setGeneInput("");
  }

  function loadExample() {
    const exampleSamples: SampleEntry[] = Array.from(
      { length: 8 },
      (_, index) => ({
        id: makeId("sample"),
        name: `Sample_${String(index + 1).padStart(2, "0")}`,
        kind: "sample" as const,
      }),
    );
    const exampleGenes: GeneEntry[] = [
      { id: makeId("gene"), name: "GAPDH", role: "reference" },
      { id: makeId("gene"), name: "FBN2", role: "target" },
      { id: makeId("gene"), name: "ZNF436", role: "target" },
      { id: makeId("gene"), name: "CHMP2A", role: "target" },
    ];
    setPlateType(96);
    setSamples(exampleSamples);
    setGenes(exampleGenes);
    setReplicates(3);
    setLayoutPreset("sample-major");
    setLoadingPattern("sequential");
    setLayout(null);
    setAutomaticLayout(null);
    setConfirmed({});
    setActivePlateIndex(0);
    setSelectedWellIds([]);
    setSelectionAnchorId(null);
    setMoveMode(false);
    markChanged();
    setToast({
      tone: "neutral",
      message: tr(
        "已载入 8 个样本、3 个目的基因和 1 个内参的示例。",
        "Loaded an example with 8 samples, 3 targets, and 1 reference.",
      ),
    });
  }

  function generateLayout() {
    if (inputIssues.length > 0) {
      setToast({ tone: "error", message: inputIssues[0] });
      return;
    }
    if (
      layout?.plates.some((plate) =>
        plate.wells.some((well) => well.source === "manual"),
      ) &&
      !window.confirm(
        tr(
          "重新生成将覆盖当前的手动修改，是否继续？",
          "Regenerating will overwrite manual edits. Continue?",
        ),
      )
    ) {
      return;
    }
    try {
      const next = planPlateLayout(planInput, {
        strategy: layoutPreset,
        loadingPattern,
      });
      const now = new Date().toLocaleString("zh-CN", { hour12: false });
      setLayout(next);
      setAutomaticLayout(clonePlan(next));
      setLayoutSignature(currentSignature);
      setGeneratedAt(now);
      setConfirmed({});
      setUndoStack([]);
      setRedoStack([]);
      setActivePlateIndex(0);
      setSelectedWellIds([]);
      setSelectionAnchorId(null);
      setMoveMode(false);
      markChanged();
      setToast({
        tone: "success",
        message:
          layoutPreset === "gene-major"
            ? tr(
                `已按基因排列生成 ${next.plates.length} 块 ${plateType} 孔板；每个基因内保持样本输入顺序。`,
                `Generated ${next.plates.length} ${plateType}-well plate(s) by assay; sample input order is preserved within every assay.`,
              )
            : tr(
                `已按样本排列生成 ${next.plates.length} 块 ${plateType} 孔板；目的基因跨板时会重新安排该样本的全部内参。`,
                `Generated ${next.plates.length} ${plateType}-well plate(s) by sample; all references are rerun whenever a sample's targets continue onto another plate.`,
              ),
      });
    } catch (error) {
      setToast({
        tone: "error",
        message:
          error instanceof Error
            ? localizeMessage(error.message)
            : tr("无法生成布局。", "Unable to generate a layout."),
      });
    }
  }

  function commitLayout(next: PlanResult, plateNumber?: number) {
    if (!layout) return;
    setUndoStack((stack) => [...stack.slice(-29), clonePlan(layout)]);
    setRedoStack([]);
    setLayout(refreshPlanDerivedData(next, planInput));
    if (plateNumber !== undefined) {
      setConfirmed((current) => ({
        ...current,
        [String(plateNumber)]: false,
      }));
    } else {
      setConfirmed({});
    }
    markChanged();
  }

  function undoLayout() {
    if (!layout || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((stack) => [...stack, clonePlan(layout)]);
    setUndoStack((stack) => stack.slice(0, -1));
    setLayout(clonePlan(previous));
    setConfirmed({});
    markChanged();
  }

  function redoLayout() {
    if (!layout || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((stack) => [...stack, clonePlan(layout)]);
    setRedoStack((stack) => stack.slice(0, -1));
    setLayout(clonePlan(next));
    setConfirmed({});
    markChanged();
  }

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") {
        return;
      }
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) redoLayout();
      else undoLayout();
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  });

  function savePlanner() {
    const payload: StoredPlannerState = {
      version: 6,
      plateType,
      samples,
      genes,
      replicates,
      layoutPreset,
      loadingPattern,
      layout,
      automaticLayout,
      layoutSignature,
      generatedAt,
      confirmed,
      reactionSystem,
      language,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      const time = new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      setSavedAt(time);
      setDirty(false);
      setToast({
        tone: "success",
        message: tr(
          "方案已保存在本机浏览器。",
          "Plan saved in this browser.",
        ),
      });
    } catch {
      setToast({
        tone: "error",
        message: tr(
          "保存失败。请检查浏览器是否允许本地存储。",
          "Save failed; check whether browser storage is allowed.",
        ),
      });
    }
  }

  function resetPlanner() {
    if (
      !window.confirm(
        tr(
          "这会清除当前页面内容和本机浏览器中保存的样本、基因、板布局及反应体系，且无法撤销。是否继续？",
          "This will permanently clear the current page and the samples, assays, plate layouts, and reaction setup saved in this browser. Continue?",
        ),
      )
    ) {
      return;
    }

    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      setToast({
        tone: "error",
        message: tr(
          "无法清除本机保存记录；当前内容未重置。请检查浏览器是否允许本地存储。",
          "The browser-saved plan could not be cleared, so the current page was not reset. Check whether browser storage is allowed.",
        ),
      });
      return;
    }

    setPlateType(96);
    setSamples([]);
    setGenes([]);
    setReplicates(3);
    setLayoutPreset("sample-major");
    setLoadingPattern("sequential");
    setSampleInput("");
    setGeneInput("");
    setSamplePaste("");
    setGenePaste("");
    setLayout(null);
    setAutomaticLayout(null);
    setLayoutSignature("");
    setGeneratedAt("");
    setActivePlateIndex(0);
    setConfirmed({});
    setUndoStack([]);
    setRedoStack([]);
    setEditor(null);
    setSelectedWellIds([]);
    setSelectionAnchorId(null);
    setMoveMode(false);
    setEditingPlateName(false);
    setPlateNameDraft("");
    setReactionSystem({ ...DEFAULT_REACTION_SYSTEM });
    setSavedAt("");
    setDirty(false);
    setToast({
      tone: "success",
      message: tr(
        "本机保存记录已清除，工具已恢复初始状态。",
        "The browser-saved plan was cleared and the tool was reset.",
      ),
    });
  }

  function openEditorForSelection(
    plateIndex: number,
    plate: PlannerPlate,
    wellIds = selectedWellIds,
  ) {
    if (confirmed[String(plate.plateNumber)] || settingsStale) return;
    const selected = plate.wells.filter((well) =>
      wellIds.includes(well.wellId),
    );
    if (selected.length === 0) return;
    const occupied = selected.find((well) => well.sample && well.gene);
    setEditor({
      plateIndex,
      wellIds,
      mode: occupied ? "assay" : "empty",
      sample: occupied?.sample ?? sampleNames[0] ?? "",
      gene: occupied?.gene ?? genes[0]?.name ?? "",
    });
  }

  function handleWellSelection(
    event: React.MouseEvent<HTMLButtonElement>,
    plateIndex: number,
    plate: PlannerPlate,
    well: PlannerWell,
  ) {
    if (confirmed[String(plate.plateNumber)] || settingsStale) return;
    if (moveMode) {
      moveSelectionTo(plateIndex, plate, well.wellId);
      return;
    }
    const additive = event.metaKey || event.ctrlKey;
    if (event.shiftKey && selectionAnchorId) {
      const range = rectangularWellIds(
        plate,
        selectionAnchorId,
        well.wellId,
      );
      setSelectedWellIds((current) =>
        additive ? Array.from(new Set([...current, ...range])) : range,
      );
      return;
    }
    if (additive) {
      setSelectedWellIds((current) =>
        current.includes(well.wellId)
          ? current.filter((wellId) => wellId !== well.wellId)
          : [...current, well.wellId],
      );
      setSelectionAnchorId(well.wellId);
      return;
    }
    setSelectedWellIds([well.wellId]);
    setSelectionAnchorId(well.wellId);
  }

  function applyManualEdit() {
    if (!layout || !editor) return;
    if (editor.mode === "assay" && (!editor.sample || !editor.gene)) {
      setToast({
        tone: "error",
        message: tr("请选择样本和基因。", "Select a sample and an assay."),
      });
      return;
    }
    const next = clonePlan(layout);
    const plate = next.plates[editor.plateIndex];
    const selectedGene = genes.find((gene) => gene.name === editor.gene);
    next.plates[editor.plateIndex] = assignSelectedWells(
      plate,
      editor.wellIds,
      {
        sample: editor.mode === "assay" ? editor.sample : null,
        gene: editor.mode === "assay" ? editor.gene : null,
        geneType:
          editor.mode === "assay"
            ? ((selectedGene?.role ?? "target") as GeneType)
            : null,
      },
    );
    commitLayout(next, plate.plateNumber);
    setEditor(null);
    setToast({
      tone: "neutral",
      message: tr(
        `已更新 ${editor.wellIds.length} 个所选孔；布局校验仅作为提醒。`,
        `Updated ${editor.wellIds.length} selected well(s); layout validation is advisory.`,
      ),
    });
  }

  function clearSelectedWells() {
    if (!layout || !activePlate || selectedWellIds.length === 0) return;
    const next = clonePlan(layout);
    next.plates[activePlateIndex] = assignSelectedWells(
      next.plates[activePlateIndex],
      selectedWellIds,
      { sample: null, gene: null, geneType: null },
    );
    commitLayout(next, activePlate.plateNumber);
    setToast({
      tone: "neutral",
      message: tr(
        `已清空 ${selectedWellIds.length} 个所选孔。`,
        `Cleared ${selectedWellIds.length} selected well(s).`,
      ),
    });
  }

  function moveSelectionTo(
    plateIndex: number,
    plate: PlannerPlate,
    destinationWellId: string,
  ) {
    if (!layout || selectedWellIds.length === 0) return;
    let result = translateSelectedWells(
      plate,
      selectedWellIds,
      destinationWellId,
    );
    if (result.ok === false && result.reason === "collision") {
      const confirmedOverwrite = window.confirm(
        tr(
          `目标区域已有 ${result.collisionWellIds?.length ?? 0} 个占用孔。是否覆盖？`,
          `The destination contains ${result.collisionWellIds?.length ?? 0} occupied well(s). Overwrite them?`,
        ),
      );
      if (!confirmedOverwrite) {
        setMoveMode(false);
        return;
      }
      result = translateSelectedWells(
        plate,
        selectedWellIds,
        destinationWellId,
        true,
      );
    }
    if (result.ok === false) {
      setToast({
        tone: "error",
        message:
          result.reason === "out-of-bounds"
            ? tr(
                "所选孔平移后会超出孔板边界。",
                "The translated selection would exceed the plate boundary.",
              )
            : tr(
                "所选区域没有可移动的检测孔。",
                "The selection has no occupied wells to move.",
              ),
      });
      setMoveMode(false);
      return;
    }
    const next = clonePlan(layout);
    next.plates[plateIndex] = result.plate;
    commitLayout(next, plate.plateNumber);
    setSelectedWellIds(result.movedWellIds);
    setSelectionAnchorId(result.movedWellIds[0] ?? null);
    setMoveMode(false);
    setToast({
      tone: "neutral",
      message: tr(
        `已平移 ${result.movedWellIds.length} 个孔位。`,
        `Moved ${result.movedWellIds.length} well(s).`,
      ),
    });
  }

  function restoreActivePlate() {
    if (!layout || !automaticLayout || !activePlate) return;
    const source = automaticLayout.plates.find(
      (plate) => plate.plateNumber === activePlate.plateNumber,
    );
    if (!source) return;
    const next = clonePlan(layout);
    next.plates[activePlateIndex] = {
      ...clonePlan(source),
      name: activePlate.name,
    };
    commitLayout(next, activePlate.plateNumber);
    setSelectedWellIds([]);
    setSelectionAnchorId(null);
    setMoveMode(false);
    setToast({
      tone: "success",
      message: tr(
        `${activePlate.name} 已恢复为自动布局。`,
        `${activePlate.name} was restored to the automatic layout.`,
      ),
    });
  }

  function commitPlateName() {
    if (!layout || !activePlate) return;
    const nextName = plateNameDraft.trim();
    if (!nextName) {
      setToast({
        tone: "error",
        message: tr("板名不能为空。", "Plate name cannot be empty."),
      });
      return;
    }
    const duplicate = layout.plates.some(
      (plate) =>
        plate.id !== activePlate.id &&
        normalizedKey(plate.name) === normalizedKey(nextName),
    );
    if (duplicate) {
      setToast({
        tone: "error",
        message: tr(
          `板名“${nextName}”已存在；同一次生成的板名不能重复。`,
          `Plate name “${nextName}” already exists; names must be unique within a plan.`,
        ),
      });
      return;
    }
    if (nextName !== activePlate.name) {
      const next = clonePlan(layout);
      next.plates[activePlateIndex].name = nextName;
      commitLayout(next, activePlate.plateNumber);
      setToast({
        tone: "success",
        message: tr(
          `板名已改为“${nextName}”。`,
          `Plate renamed to “${nextName}”.`,
        ),
      });
    }
    setEditingPlateName(false);
  }

  function togglePlateConfirmation() {
    if (!activePlate) return;
    const key = String(activePlate.plateNumber);
    if (confirmed[key]) {
      setConfirmed((current) => ({ ...current, [key]: false }));
      markChanged();
      return;
    }
    if (settingsStale) {
      setToast({
        tone: "error",
        message: tr(
          "实验设置已变更，请重新生成布局。",
          "Experiment settings changed; regenerate the layout.",
        ),
      });
      return;
    }
    setConfirmed((current) => ({ ...current, [key]: true }));
    markChanged();
    const advisoryCount =
      issuesForPlate(activePlate).length + globalIssues.length;
    setToast({
      tone: advisoryCount > 0 ? "neutral" : "success",
      message:
        advisoryCount > 0
          ? tr(
              `${activePlate.name} 已确认；仍有 ${advisoryCount} 项布局提醒，但不限制导出。`,
              `${activePlate.name} confirmed with ${advisoryCount} layout advisory item(s); export remains available.`,
            )
          : tr(
              `${activePlate.name} 已确认并锁定。`,
              `${activePlate.name} confirmed and locked.`,
            ),
    });
  }

  function exportablePlate(plate: PlannerPlate): ExportablePlate {
    return {
      name: plate.name,
      plateNumber: plate.plateNumber,
      rows: plate.rows,
      columns: plate.columns,
      wells: plate.wells,
      confirmed: Boolean(confirmed[String(plate.plateNumber)]),
    };
  }

  function exportContext(validationStatus?: "Valid" | "Warning" | "Invalid"): ExportContext {
    return {
      plateType,
      replicates,
      samples: sampleNames,
      blankSamples: blankSampleNames,
      targetGenes,
      referenceGenes,
      strategyLabel: layout ? strategyLabel(layout.strategy) : "",
      layoutStrategy: layout?.strategy,
      loadingPattern: layout?.loadingPattern ?? loadingPattern,
      generatedAt,
      validationStatus:
        validationStatus ??
        (settingsStale ? "Invalid" : audit.valid ? "Valid" : "Warning"),
      splitSamples: layout?.metrics.splitSamples ?? 0,
      repeatedReferenceBlocks:
        layout?.metrics.repeatedReferenceBlocks ?? 0,
      repeatedReferenceWells:
        layout?.metrics.repeatedReferenceWells ?? 0,
      reactionSystem,
    };
  }

  async function downloadActivePlate() {
    if (
      !activePlate ||
      !activePlateConfirmed ||
      settingsStale ||
      !reactionCalculation.valid
    ) {
      setToast({
        tone: "error",
        message:
          reactionCalculation.errors[0] ??
          tr(
            "请先确认本板，并确保反应体系体积有效后再导出。",
            "Confirm this plate and ensure the reaction volumes are valid before export.",
          ),
      });
      return;
    }
    try {
      await exportPlateExcel(
        exportablePlate(activePlate),
        exportContext(audit.valid ? "Valid" : "Warning"),
      );
      setToast({
        tone: "success",
        message: tr(
          `${activePlate.name} Excel 已生成。`,
          `${activePlate.name} Excel workbook generated.`,
        ),
      });
    } catch {
      setToast({
        tone: "error",
        message: tr(
          "Excel 生成失败；当前方案仍已保留，请稍后重试。",
          "Excel generation failed; the plan remains saved.",
        ),
      });
    }
  }

  async function downloadAllPlates() {
    if (!layout || !allConfirmed) {
      setToast({
        tone: "error",
        message: tr(
          "请先确认全部孔板，再批量导出。",
          "Confirm every plate before batch export.",
        ),
      });
      return;
    }
    try {
      await exportAllPlateExcels(
        layout.plates.map(exportablePlate),
        exportContext(),
      );
      setToast({
        tone: "success",
        message: tr(
          `已打包 ${layout.plates.length} 个独立 Excel 和总览表。`,
          `Packaged ${layout.plates.length} plate workbooks plus an overview.`,
        ),
      });
    } catch {
      setToast({
        tone: "error",
        message: tr(
          "批量导出失败；当前方案仍已保留，请稍后重试。",
          "Batch export failed; the plan remains saved.",
        ),
      });
    }
  }

  function issuesForPlate(plate: PlannerPlate) {
    return audit.errors.filter(
      (issue) => issue.plateNumber === plate.plateNumber,
    );
  }

  function moveWellFocus(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    plate: PlannerPlate,
    row: number,
    column: number,
  ) {
    const movement: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = movement[event.key];
    if (!delta) return;
    event.preventDefault();
    const nextRow = Math.min(Math.max(0, row + delta[0]), plate.rows - 1);
    const nextColumn = Math.min(
      Math.max(0, column + delta[1]),
      plate.columns - 1,
    );
    document
      .getElementById(
        `plate-${plate.plateNumber}-well-${nextRow}-${nextColumn}`,
      )
      ?.focus();
  }

  const globalIssues = audit.errors.filter(
    (issue) => issue.plateNumber === undefined,
  );
  const activeIssues = activePlate
    ? [...issuesForPlate(activePlate), ...globalIssues]
    : globalIssues;
  const activeInvalid = settingsStale;
  const currentStatus = plateStatus(
    activePlateConfirmed,
    activeIssues.length,
    settingsStale,
    language,
  );
  const selectedOccupiedCount = activePlate
    ? activePlate.wells.filter(
        (well) =>
          selectedWellIds.includes(well.wellId) && well.sample && well.gene,
      ).length
    : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <FlaskConical size={20} strokeWidth={1.8} />
          </div>
          <div className="brand-copy">
            <p className="brand-title">
              {tr(
                "qPCR 板布局规划工具",
                "qPCR Plate Layout Planner",
              )}
            </p>
            <p className="brand-subtitle">
              {tr(
                "96 / 384 孔 · 排板与反应用量",
                "96 / 384 wells · Layout & reaction planning",
              )}
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          <div
            className="language-switch"
            role="group"
            aria-label={tr("界面语言", "Interface language")}
          >
            <Languages size={14} aria-hidden="true" />
            <button
              type="button"
              className={language === "zh" ? "active" : ""}
              aria-pressed={language === "zh"}
              onClick={() => setLanguage("zh")}
            >
              中文
            </button>
            <button
              type="button"
              className={language === "en" ? "active" : ""}
              aria-pressed={language === "en"}
              onClick={() => setLanguage("en")}
            >
              EN
            </button>
          </div>
          <span className={`save-status ${dirty ? "unsaved" : ""}`}>
            {dirty
              ? tr("有未保存更改", "Unsaved changes")
              : savedAt === "restored"
                ? tr("已恢复", "Restored")
                : savedAt
                  ? tr(`已保存 ${savedAt}`, `Saved ${savedAt}`)
                  : hydrated
                    ? tr("本地就绪", "Ready")
                    : tr("载入中", "Loading")}
          </span>
          <button
            className="button button-clear"
            type="button"
            onClick={resetPlanner}
            disabled={!hydrated}
            title={tr(
              "清除本机保存记录并恢复初始状态",
              "Clear the browser-saved plan and restore defaults",
            )}
            aria-label={tr(
              "重置工具并清除本机保存记录",
              "Reset the tool and clear the browser-saved plan",
            )}
          >
            <RotateCcw size={15} />
            <span>{tr("重置工具", "Reset tool")}</span>
          </button>
          <button className="button" type="button" onClick={savePlanner}>
            <Save size={15} />
            <span>{tr("保存", "Save")}</span>
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={downloadAllPlates}
            disabled={!allConfirmed}
            title={
              allConfirmed
                ? tr("导出全部孔板", "Export all plates")
                : tr(
                    "确认全部孔板后可批量导出",
                    "Confirm all plates before batch export",
                  )
            }
          >
            <Download size={15} />
            <span>
              {tr("全部导出", "Export all")}
              {layout ? `（${layout.plates.length}）` : ""}
            </span>
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside
          className="sidebar"
          aria-label={tr("实验设置", "Experiment setup")}
        >
          <section className="panel">
            <div className="panel-heading">
              <div className="heading-with-index">
                <span className="section-index">01</span>
                <div>
                  <h2 className="panel-title">
                    {tr("选择孔板", "Plate format")}
                  </h2>
                  <p className="panel-description">
                    {tr("选择本次上机板型", "Select the plate type")}
                  </p>
                </div>
              </div>
            </div>
            <div className="plate-picker">
              {([96, 384] as const).map((type) => {
                const size = getPlateDimensions(type);
                return (
                  <button
                    key={type}
                    className={`plate-choice ${
                      plateType === type ? "selected" : ""
                    }`}
                    type="button"
                    onClick={() => {
                      if (type === plateType) return;
                      setPlateType(type);
                      const nextLoadingPattern = defaultLoadingPattern(type);
                      setLoadingPattern(nextLoadingPattern);
                      if (nextLoadingPattern === "interleaved-8-channel") {
                        setLayoutPreset("gene-major");
                      }
                      if (replicates > size.columns) setReplicates(size.columns);
                      markChanged();
                    }}
                    aria-pressed={plateType === type}
                  >
                    <span>
                      <span className="plate-choice-name">
                        {tr(`${type} 孔板`, `${type}-well plate`)}
                      </span>
                      <span className="plate-choice-meta">
                        {tr(
                          `${size.rows} 行 × ${size.columns} 列`,
                          `${size.rows} rows × ${size.columns} columns`,
                        )}
                      </span>
                    </span>
                    <span className="plate-mini" aria-hidden="true">
                      {Array.from({ length: 12 }).map((_, index) => (
                        <span key={index} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div className="heading-with-index">
                <span className="section-index">02</span>
                <div>
                  <h2 className="panel-title">
                    {tr("添加样本", "Samples")}
                  </h2>
                  <p className="panel-description">
                    {tr(
                      "逐个输入或从 Excel 粘贴",
                      "Add individually or paste from Excel",
                    )}
                  </p>
                </div>
              </div>
              {samples.length > 0 && (
                <button
                  className="button button-clear"
                  type="button"
                  onClick={() => {
                    setSamples([]);
                    markChanged();
                  }}
                >
                  {tr("清空", "Clear")}
                </button>
              )}
            </div>
            <div className="entry-stack">
              <form className="entry-row" onSubmit={submitSample}>
                <input
                  className="input"
                  value={sampleInput}
                  onChange={(event) => setSampleInput(event.target.value)}
                  placeholder={tr("如 Tumor_01", "e.g. Tumor_01")}
                  aria-label={tr("样本名称", "Sample name")}
                />
                <button
                  className="icon-button"
                  type="submit"
                  aria-label={tr("添加样本", "Add sample")}
                  disabled={!sampleInput.trim()}
                >
                  <Plus size={16} />
                </button>
              </form>
              <details className="batch-disclosure">
                <summary>
                  <span>
                    {tr("从 Excel 批量粘贴", "Paste from Excel")}
                  </span>
                  <FileSpreadsheet size={14} />
                </summary>
                <div className="batch-content">
                  <textarea
                    className="batch-box"
                    value={samplePaste}
                    onChange={(event) => setSamplePaste(event.target.value)}
                    placeholder={tr(
                      "复制一列或多列样本名称\n粘贴到这里",
                      "Copy one or more columns of sample names\nPaste here",
                    )}
                    aria-label={tr("批量粘贴样本", "Paste samples in bulk")}
                  />
                  <button
                    className="button button-soft"
                    type="button"
                    disabled={samplePasteNames.length === 0}
                    onClick={() => {
                      addSamples(samplePasteNames);
                      setSamplePaste("");
                    }}
                  >
                    {tr(
                      `导入 ${samplePasteNames.length} 个样本名称`,
                      `Import ${samplePasteNames.length} sample ${
                        samplePasteNames.length === 1 ? "name" : "names"
                      }`,
                    )}
                  </button>
                </div>
              </details>
              {samples.length > 0 ? (
                <div
                  className="sample-list"
                  aria-label={tr("已添加样本", "Added samples")}
                >
                  {samples.map((sample) => (
                    <div
                      className={`sample-row ${
                        sample.kind === "blank" ? "is-blank" : ""
                      }`}
                      key={sample.id}
                    >
                      <span className="sample-name" title={sample.name}>
                        {sample.name}
                      </span>
                      <div className="sample-row-actions">
                        <button
                          className={`role-toggle sample-kind-toggle ${
                            sample.kind === "blank" ? "blank" : ""
                          }`}
                          type="button"
                          onClick={() => {
                            setSamples((current) =>
                              current.map((item) =>
                                item.id === sample.id
                                  ? {
                                      ...item,
                                      kind:
                                        item.kind === "sample"
                                          ? "blank"
                                          : "sample",
                                    }
                                  : item,
                              ),
                            );
                            markChanged();
                          }}
                          aria-label={tr(
                            `将 ${sample.name} 切换为${
                              sample.kind === "sample" ? "Blank" : "样本"
                            }`,
                            `Change ${sample.name} to ${
                              sample.kind === "sample" ? "Blank" : "Sample"
                            }`,
                          )}
                        >
                          {sample.kind === "blank"
                            ? "Blank"
                            : tr("样本", "Sample")}
                        </button>
                        <button
                          className="chip-remove"
                          type="button"
                          onClick={() => {
                            setSamples((current) =>
                              current.filter((item) => item.id !== sample.id),
                            );
                            markChanged();
                          }}
                          aria-label={tr(
                            `删除样本 ${sample.name}`,
                            `Remove sample ${sample.name}`,
                          )}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="microcopy">
                  {tr("尚未添加样本", "No samples added")}
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div className="heading-with-index">
                <span className="section-index">03</span>
                <div>
                  <h2 className="panel-title">
                    {tr("添加检测基因", "Assays")}
                  </h2>
                  <p className="panel-description">
                    {tr(
                      "点击切换目的基因或内参",
                      "Toggle target or reference",
                    )}
                  </p>
                </div>
              </div>
              {genes.length > 0 && (
                <button
                  className="button button-clear"
                  type="button"
                  onClick={() => {
                    setGenes([]);
                    markChanged();
                  }}
                >
                  {tr("清空", "Clear")}
                </button>
              )}
            </div>
            <div className="entry-stack">
              <form className="entry-row" onSubmit={submitGene}>
                <input
                  className="input"
                  value={geneInput}
                  onChange={(event) => setGeneInput(event.target.value)}
                  placeholder={tr("如 GAPDH", "e.g. GAPDH")}
                  aria-label={tr("基因名称", "Assay name")}
                />
                <button
                  className="icon-button"
                  type="submit"
                  aria-label={tr("添加基因", "Add assay")}
                  disabled={!geneInput.trim()}
                >
                  <Plus size={16} />
                </button>
              </form>
              <details className="batch-disclosure">
                <summary>
                  <span>
                    {tr("从 Excel 批量粘贴", "Paste from Excel")}
                  </span>
                  <FileSpreadsheet size={14} />
                </summary>
                <div className="batch-content">
                  <textarea
                    className="batch-box"
                    value={genePaste}
                    onChange={(event) => setGenePaste(event.target.value)}
                    placeholder={tr(
                      "复制一列或多列基因名称\n粘贴到这里",
                      "Copy one or more columns of assay names\nPaste here",
                    )}
                    aria-label={tr("批量粘贴基因", "Paste assays in bulk")}
                  />
                  <button
                    className="button button-soft"
                    type="button"
                    disabled={parseExcelNames(genePaste).length === 0}
                    onClick={() => {
                      addGenes(parseExcelNames(genePaste));
                      setGenePaste("");
                    }}
                  >
                    {tr("导入", "Import")}{" "}
                    {parseExcelNames(genePaste).length || ""}{" "}
                    {tr("个名称", "names")}
                  </button>
                </div>
              </details>
              {genes.length > 0 ? (
                <div
                  className="gene-list"
                  aria-label={tr("已添加基因", "Added assays")}
                >
                  {genes.map((gene) => (
                    <div className="gene-row" key={gene.id}>
                      <span className="gene-name" title={gene.name}>
                        {gene.name}
                      </span>
                      <div className="gene-row-actions">
                        <button
                          className={`role-toggle ${
                            gene.role === "reference" ? "reference" : ""
                          }`}
                          type="button"
                          onClick={() => {
                            setGenes((current) =>
                              current.map((item) =>
                                item.id === gene.id
                                  ? {
                                      ...item,
                                      role:
                                        item.role === "target"
                                          ? "reference"
                                          : "target",
                                    }
                                  : item,
                              ),
                            );
                            markChanged();
                          }}
                          aria-label={tr(
                            `将 ${gene.name} 切换为${
                              gene.role === "target" ? "内参" : "目的基因"
                            }`,
                            `Change ${gene.name} to ${
                              gene.role === "target" ? "reference" : "target"
                            }`,
                          )}
                        >
                          {gene.role === "reference"
                            ? tr("内参", "Reference")
                            : tr("目的", "Target")}
                        </button>
                        <button
                          className="chip-remove"
                          type="button"
                          onClick={() => {
                            setGenes((current) =>
                              current.filter((item) => item.id !== gene.id),
                            );
                            markChanged();
                          }}
                          aria-label={tr(
                            `删除基因 ${gene.name}`,
                            `Remove assay ${gene.name}`,
                          )}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="microcopy">
                  {tr("尚未添加检测基因", "No assays added")}
                </p>
              )}
              {referenceGenes.length === 0 && (
                <div className="notice notice-warning">
                  <AlertTriangle size={15} />
                  <span>
                    {tr(
                      "尚未设置内参；请至少将 1 个基因标记为“内参”，数量不限。",
                      "No reference selected. Mark at least one assay as a reference; multiple references are supported.",
                    )}
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div className="heading-with-index">
                <span className="section-index">04</span>
                <div>
                  <h2 className="panel-title">
                    {tr("技术复孔", "Technical replicates")}
                  </h2>
                  <p className="panel-description">
                    {tr(
                      "同行从左到右连续",
                      "Contiguous left-to-right within a row",
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div className="replicate-control">
              <div className="stepper">
                <button
                  type="button"
                  onClick={() => {
                    setReplicates((value) => Math.max(1, value - 1));
                    markChanged();
                  }}
                  aria-label={tr("减少复孔数", "Decrease replicates")}
                >
                  <Minus size={14} />
                </button>
                <input
                  value={replicates}
                  type="number"
                  min={1}
                  max={dimensions.columns}
                  onChange={(event) => {
                    setReplicates(Number(event.target.value));
                    markChanged();
                  }}
                  aria-label={tr("技术复孔数", "Technical replicate count")}
                />
                <button
                  type="button"
                  onClick={() => {
                    setReplicates((value) =>
                      Math.min(dimensions.columns, value + 1),
                    );
                    markChanged();
                  }}
                  aria-label={tr("增加复孔数", "Increase replicates")}
                >
                  <Plus size={14} />
                </button>
              </div>
              <span className="microcopy">
                {tr(
                  "例如 3 复孔：A1–A3；下一组从 A4 开始",
                  "Example, 3 replicates: A1–A3; the next block starts at A4",
                )}
              </span>
            </div>
            <div className="layout-preset">
              <div className="layout-preset-heading">
                <span className="field-label">
                  {tr("排布方式", "Layout mode")}
                </span>
                <span className="layout-preset-direction">
                  {plateType === 384 &&
                  loadingPattern === "interleaved-8-channel"
                    ? tr("隔行纵向", "Interleaved vertical")
                    : tr("纵向优先", "Top-to-bottom first")}
                </span>
              </div>
              <div
                className="segmented layout-preset-toggle"
                role="group"
                aria-label={tr("选择排布方式", "Choose layout mode")}
              >
                <button
                  className={
                    layoutPreset === "sample-major" ? "active" : ""
                  }
                  type="button"
                  aria-pressed={layoutPreset === "sample-major"}
                  onClick={() => {
                    setLayoutPreset("sample-major");
                    markChanged();
                  }}
                >
                  {tr("按样本排列", "By sample")}
                </button>
                <button
                  className={
                    layoutPreset === "gene-major" ? "active" : ""
                  }
                  type="button"
                  aria-pressed={layoutPreset === "gene-major"}
                  onClick={() => {
                    setLayoutPreset("gene-major");
                    markChanged();
                  }}
                >
                  {tr("按基因排列", "By assay")}
                </button>
              </div>
              <p className="microcopy layout-preset-help">
                {plateType === 384 &&
                loadingPattern === "interleaved-8-channel"
                  ? layoutPreset === "sample-major"
                    ? tr(
                        "同一样本的全部基因优先相邻；检测块按两次隔行上样路径纵向填充，再向右换列。",
                        "Keep one sample's assays together; fill the two interleaved passes vertically before moving right.",
                      )
                    : tr(
                        "同一基因的全部样本优先相邻；样本按两次隔行上样路径纵向填充，再向右换列。",
                        "Keep one assay's samples together; fill the two interleaved passes vertically before moving right.",
                      )
                  : layoutPreset === "sample-major"
                  ? tr(
                      "同一样本的全部基因优先相邻；检测块从上到下，再从左到右。",
                      "Keep all assays for one sample together; fill blocks top-to-bottom, then left-to-right.",
                    )
                  : tr(
                      "同一基因的全部样本优先相邻；样本按输入顺序从上到下，再从左到右。",
                      "Keep all samples for one assay together; follow sample order top-to-bottom, then left-to-right.",
                    )}
              </p>
            </div>
            {plateType === 384 && (
              <div className="loading-pattern">
                <div className="loading-pattern-heading">
                  <span className="field-label">
                    {tr("384 孔上样方式", "384-well loading pattern")}
                  </span>
                  <span className="loading-pattern-badge">
                    {tr("物理孔位映射", "Physical mapping")}
                  </span>
                </div>
                <div
                  className="loading-pattern-options"
                  role="radiogroup"
                  aria-label={tr(
                    "选择 384 孔上样方式",
                    "Choose the 384-well loading pattern",
                  )}
                >
                  <button
                    className={`loading-pattern-option ${
                      loadingPattern === "interleaved-8-channel"
                        ? "selected"
                        : ""
                    }`}
                    type="button"
                    role="radio"
                    aria-checked={
                      loadingPattern === "interleaved-8-channel"
                    }
                    onClick={() =>
                      chooseLoadingPattern("interleaved-8-channel")
                    }
                  >
                    <span
                      className="loading-pattern-radio"
                      aria-hidden="true"
                    />
                    <span>
                      <strong>
                        {tr(
                          "八道排枪隔行上样",
                          "Interleaved 8-channel loading",
                        )}
                      </strong>
                      <small>
                        {tr(
                          "固定 9 mm · 推荐",
                          "Fixed 9 mm · Recommended",
                        )}
                      </small>
                    </span>
                  </button>
                  <button
                    className={`loading-pattern-option ${
                      loadingPattern === "sequential" ? "selected" : ""
                    }`}
                    type="button"
                    role="radio"
                    aria-checked={loadingPattern === "sequential"}
                    onClick={() => chooseLoadingPattern("sequential")}
                  >
                    <span
                      className="loading-pattern-radio"
                      aria-hidden="true"
                    />
                    <span>
                      <strong>
                        {tr(
                          "连续孔位上样",
                          "Sequential well loading",
                        )}
                      </strong>
                      <small>
                        {tr(
                          "4.5 mm / 自动化 / 单道",
                          "4.5 mm / automation / single-channel",
                        )}
                      </small>
                    </span>
                  </button>
                </div>
                {loadingPattern === "interleaved-8-channel" && (
                  <div
                    className={`loading-pattern-advisory ${
                      layoutPreset === "sample-major" ? "attention" : ""
                    }`}
                  >
                    <Info size={13} aria-hidden="true" />
                    <span>
                      {layoutPreset === "sample-major"
                        ? tr(
                            "按基因排列才会生成固定 A–H 来源板映射；当前仍可按样本生成，但来源板需人工规划。",
                            "Assay-major generates the fixed A–H source-plate map. Sample-major remains available, but its source plate must be planned manually.",
                          )
                        : tr(
                            "默认样本源板按输入顺序 A–H 向下、再到下一列；每个基因先排 A/C/E/G/I/K/M/O，再排 B/D/F/H/J/L/N/P。",
                            "The source plate follows input order down A–H, then advances one column; each assay uses A/C/E/G/I/K/M/O, then B/D/F/H/J/L/N/P.",
                          )}
                    </span>
                  </div>
                )}
              </div>
            )}
            <div className="setup-summary">
              <strong>
                {tr(
                  `${samples.length} 样本 × ${genes.length} 基因 × ${
                    replicates || 0
                  } 复孔`,
                  `${samples.length} samples × ${genes.length} assays × ${
                    replicates || 0
                  } replicates`,
                )}
              </strong>
              <span>
                {tr(
                  `基础反应孔 ${reactionWells} 个（未计跨板内参重做）· 单样本全部基因需 ${sampleFullRunWells} 孔 · ${referenceGenes.length} 个内参`,
                  `${reactionWells} base wells before cross-plate reference reruns · ${sampleFullRunWells} wells per complete sample assay set · ${referenceGenes.length} reference assay(s)`,
                )}
              </span>
            </div>
            {inputIssues.length > 0 && (
              <div className="notice notice-warning">
                <AlertTriangle size={15} />
                <span>{inputIssues[0]}</span>
              </div>
            )}
            <button
              className="button button-primary generate-button"
              type="button"
              onClick={generateLayout}
              disabled={inputIssues.length > 0}
            >
              <Sparkles size={16} />
              {layout
                ? tr("重新生成布局", "Regenerate layout")
                : tr("生成布局", "Generate layout")}
            </button>
          </section>
        </aside>

        <main className="main-area">
          <section className="hero-strip" aria-labelledby="planner-title">
            <div>
              <p className="eyebrow">
                <ShieldCheck size={13} />
                {tr("版布局预览", "Layout preview")}
              </p>
              <h1 className="hero-title" id="planner-title">
                {layout
                  ? tr(
                      `已生成 ${layout.plates.length} 块实验板`,
                      `${layout.plates.length} plate(s) generated`,
                    )
                  : tr(
                      "先设置样本、基因与复孔",
                      "Set samples, assays, and replicates",
                    )}
              </h1>
              <p className="hero-copy">
                {previewIs384 &&
                previewLoadingPattern === "interleaved-8-channel"
                  ? (layout?.strategy ?? layoutPreset) === "gene-major"
                    ? tr(
                        "按基因排列：同一基因下的样本先填充 A/C/E/G/I/K/M/O，再填充 B/D/F/H/J/L/N/P；复孔同行横向连续。样本目的基因跨板时，新板会重新安排该样本的全部内参。",
                        "By assay: samples fill A/C/E/G/I/K/M/O first, then B/D/F/H/J/L/N/P; replicates stay contiguous within a row. When a sample continues onto another plate, all references are rerun there.",
                      )
                    : tr(
                        "按样本排列：同一样本的全部基因优先成组，并按两次隔行上样路径纵向填充；复孔同行横向连续。样本目的基因跨板时，新板会重新安排该样本的全部内参。按基因排列通常更适合八道排枪直接转移。",
                        "By sample: one sample's assays stay grouped and fill the two interleaved loading passes vertically; replicates remain contiguous within a row. When a sample continues onto another plate, all references are rerun there. Assay-major is usually better for direct 8-channel transfer.",
                      )
                  : (layout?.strategy ?? layoutPreset) === "gene-major"
                  ? tr(
                      "按基因排列：同一基因下的样本按输入顺序从上到下、再从左到右；复孔同行横向连续。样本目的基因跨板时，新板会重新安排该样本的全部内参。",
                      "By assay: samples follow input order top-to-bottom, then left-to-right; replicates stay contiguous within a row. When a sample continues onto another plate, all references are rerun there.",
                    )
                  : tr(
                      "按样本排列：同一样本的全部基因优先成组，从上到下、再从左到右；复孔同行横向连续。样本目的基因跨板时，新板会重新安排该样本的全部内参。",
                      "By sample: all assays for one sample stay grouped top-to-bottom, then left-to-right; replicates remain contiguous within a row. When a sample continues onto another plate, all references are rerun there.",
                    )}
              </p>
            </div>
            <div
              className="summary-grid"
              aria-label={tr("布局摘要", "Layout summary")}
            >
              <div className="metric">
                <span className="metric-label">
                  {tr("预计孔板", "Plates")}
                </span>
                <strong className="metric-value">
                  {layout ? layout.metrics.plateCount : "—"}
                </strong>
                <span className="metric-detail">
                  {layout
                    ? tr(`${plateType} 孔板`, `${plateType}-well`)
                    : tr("等待输入", "Waiting")}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">
                  {tr("反应孔", "Reactions")}
                </span>
                <strong className="metric-value">
                  {layout ? layout.metrics.usedWells : reactionWells || "—"}
                </strong>
                <span className="metric-detail">
                  {layout
                    ? tr(
                        `含跨板重做内参 ${layout.metrics.repeatedReferenceWells} 孔`,
                        `${layout.metrics.repeatedReferenceWells} rerun reference wells included`,
                      )
                    : tr(
                        "生成后计入跨板重做内参",
                        "Reference reruns are counted after planning",
                      )}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">
                  {tr("利用率", "Utilization")}
                </span>
                <strong className="metric-value">
                  {layout
                    ? `${(layout.metrics.utilization * 100).toFixed(1)}%`
                    : "—"}
                </strong>
                <span className="metric-detail">
                  {layout
                    ? tr(
                        `${layout.metrics.emptyWells} 个空孔`,
                        `${layout.metrics.emptyWells} empty wells`,
                      )
                    : "—"}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">
                  {tr("排布方式", "Layout mode")}
                </span>
                <strong className="metric-value" style={{ fontSize: 17 }}>
                  {layout
                    ? layout.strategy === "sample-major"
                      ? tr("按样本", "Sample-major")
                      : layout.strategy === "gene-major"
                        ? tr("按基因", "Assay-major")
                        : tr("混合", "Hybrid")
                    : "—"}
                </strong>
                <span className="metric-detail">
                  {layout
                    ? tr(
                        `样本切换 ${layout.metrics.sampleSwitches} 次 · 引物切换 ${layout.metrics.primerSwitches} 次`,
                        `${layout.metrics.sampleSwitches} sample switches · ${layout.metrics.primerSwitches} assay switches`,
                      )
                    : tr("等待生成", "Waiting")}
                </span>
              </div>
              {layout && (
                <p className="rationale">
                  {layout.strategy === "gene-major"
                    ? tr(
                        "先优化板数与跨板内参重做，再按基因分组纵向填充；空余孔位保留。",
                        "Plate count and reference reruns are optimized first, then assay groups fill vertically; unused wells remain empty.",
                      )
                    : tr(
                        "先优化板数与跨板内参重做，再按样本分组纵向填充；空余孔位保留。",
                        "Plate count and reference reruns are optimized first, then sample groups fill vertically; unused wells remain empty.",
                      )}
                </p>
              )}
            </div>
          </section>

          {!layout ? (
            <section className="empty-state">
              <div className="empty-state-inner">
                <div className="ghost-plate" aria-hidden="true">
                  {Array.from({ length: 96 }).map((_, index) => (
                    <span className="ghost-well" key={index} />
                  ))}
                </div>
                <h2>{tr("先添加样本和检测基因", "Add samples and assays")}</h2>
                <p>
                  {tr(
                    "系统会计算孔板数，并生成可点选、移动和编辑的布局。",
                    "The planner calculates plate count and creates a selectable, movable, editable layout.",
                  )}
                </p>
                <button
                  className="button button-soft"
                  type="button"
                  onClick={loadExample}
                  style={{ marginTop: 18 }}
                >
                  <Beaker size={15} />
                  {tr("载入示例", "Load example")}
                </button>
              </div>
            </section>
          ) : (
            <>
              {settingsStale && (
                <div className="notice notice-error" style={{ marginBottom: 12 }}>
                  <AlertTriangle size={16} />
                  <span>
                    {tr(
                      "实验设置或排布方式已在生成后改变。当前布局仍保留用于对照，但需重新生成后才能确认和导出。",
                      "Experiment settings or layout mode changed after generation. The current layout is retained for reference; regenerate it before confirmation or export.",
                    )}
                  </span>
                </div>
              )}

              <nav
                className="plate-nav"
                aria-label={tr("孔板列表", "Plate list")}
              >
                {layout.plates.map((plate, index) => {
                  const isConfirmed = Boolean(
                    confirmed[String(plate.plateNumber)],
                  );
                  return (
                    <button
                      className={`plate-tab ${
                        activePlateIndex === index ? "active" : ""
                      }`}
                      type="button"
                      key={plate.id}
                      onClick={() => {
                        setActivePlateIndex(index);
                        setSelectedWellIds([]);
                        setSelectionAnchorId(null);
                        setMoveMode(false);
                        setEditingPlateName(false);
                      }}
                      aria-current={activePlateIndex === index ? "page" : undefined}
                    >
                      <span>
                        <span className="plate-tab-title">
                          {plate.name}
                        </span>
                        <span className="plate-tab-meta">
                          {tr(
                            `${plate.sampleNames.length} 样本`,
                            `${plate.sampleNames.length} samples`,
                          )}{" "}
                          ·{" "}
                          {
                            plate.wells.filter((well) => well.sample && well.gene)
                              .length
                          }{" "}
                          {tr("孔", "wells")}
                        </span>
                      </span>
                      <span
                        className={`plate-tab-state ${
                          settingsStale
                            ? "invalid"
                            : isConfirmed
                              ? "confirmed"
                              : ""
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </nav>

              {activePlate && (
                <div className="layout-workbench">
                  <section className="plate-card">
                  <div className="plate-card-heading">
                    <div>
                      <div className="plate-title-row">
                        {editingPlateName ? (
                          <input
                            className="plate-name-input"
                            value={plateNameDraft}
                            autoFocus
                            maxLength={80}
                            aria-label={tr("编辑板名", "Edit plate name")}
                            onChange={(event) =>
                              setPlateNameDraft(event.target.value)
                            }
                            onBlur={commitPlateName}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                commitPlateName();
                              }
                              if (event.key === "Escape") {
                                setEditingPlateName(false);
                                setPlateNameDraft(activePlate.name);
                              }
                            }}
                          />
                        ) : (
                          <button
                            className="plate-name-button"
                            type="button"
                            disabled={activePlateConfirmed}
                            onClick={() => {
                              setPlateNameDraft(activePlate.name);
                              setEditingPlateName(true);
                            }}
                            title={tr("修改板名", "Rename plate")}
                          >
                            <span className="plate-title">
                              {activePlate.name}
                            </span>
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                        )}
                        <span
                          className={`status-pill ${currentStatus.className}`}
                        >
                          {currentStatus.className === "confirmed" && (
                            <Check size={12} />
                          )}
                          {currentStatus.label}
                        </span>
                      </div>
                      <p className="plate-subtitle">
                        {tr(
                          `板号 ${String(activePlate.plateNumber).padStart(
                            2,
                            "0",
                          )} · ${plateType} 孔 · 已使用 ${
                            activePlate.wells.filter(
                              (well) => well.sample && well.gene,
                            ).length
                          } / ${plateType} · ${activePlate.sampleNames.join("、")}`,
                          `Plate ID ${String(activePlate.plateNumber).padStart(
                            2,
                            "0",
                          )} · ${plateType}-well · ${
                            activePlate.wells.filter(
                              (well) => well.sample && well.gene,
                            ).length
                          } / ${plateType} used · ${activePlate.sampleNames.join(", ")}`,
                        )}
                      </p>
                    </div>
                    <div className="plate-actions">
                      <button
                        className="button button-quiet"
                        type="button"
                        onClick={restoreActivePlate}
                        disabled={
                          activePlateConfirmed ||
                          !activePlate.wells.some(
                            (well) => well.source === "manual",
                          )
                        }
                      >
                        <RotateCcw size={14} />
                        {tr("恢复生成布局", "Restore")}
                      </button>
                      <button
                        className={`button ${
                          activePlateConfirmed ? "button-soft" : ""
                        }`}
                        type="button"
                        onClick={togglePlateConfirmation}
                      >
                        <ShieldCheck size={14} />
                        {activePlateConfirmed
                          ? tr("解除确认", "Unlock")
                          : tr("确认本板", "Confirm")}
                      </button>
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={downloadActivePlate}
                        disabled={
                          !activePlateConfirmed ||
                          !reactionCalculation.valid ||
                          settingsStale
                        }
                      >
                        <Download size={14} />
                        {tr("导出 Excel", "Export Excel")}
                      </button>
                    </div>
                  </div>

                  <div className="plate-context">
                    <div
                      className="legend"
                      aria-label={tr("颜色图例", "Color legend")}
                    >
                      {genes.map((gene) => {
                        const color =
                          gene.role === "reference"
                            ? "#F3DFC4"
                            : targetColor(gene.name, targetGenes).background;
                        return (
                          <span className="legend-item" key={gene.id}>
                            <span
                              className="legend-dot"
                              style={
                                {
                                  "--legend-color": color,
                                } as CSSProperties
                              }
                            />
                            <span>
                              {gene.name}
                              {gene.role === "reference"
                                ? tr(" · 内参", " · Reference")
                                : ""}
                            </span>
                          </span>
                        );
                      })}
                      <span className="legend-item">
                        <span className="legend-dot manual" />
                        <span>{tr("手动修改", "Manual")}</span>
                      </span>
                      {blankSampleNames.length > 0 && (
                        <span className="legend-item">
                          <span className="legend-dot blank" />
                          <span>Blank</span>
                        </span>
                      )}
                    </div>
                    <span className="plate-hint">
                      {tr(
                        "单击选择 · Shift 连选 · Ctrl/⌘ 多选 · 双击编辑",
                        "Click to select · Shift range · Ctrl/⌘ multi-select · Double-click to edit",
                      )}
                    </span>
                  </div>

                  {activePlate.rows === 16 &&
                    previewLoadingPattern === "interleaved-8-channel" && (
                      <div
                        className="loading-route-guide"
                        aria-label={tr(
                          "八道排枪隔行上样路径",
                          "Interleaved 8-channel loading route",
                        )}
                      >
                        <span className="loading-route-guide-title">
                          {tr("上样路径", "Loading route")}
                        </span>
                        <span className="loading-route-pass pass-one">
                          <b aria-hidden="true">①</b>
                          <span>
                            {tr("第 1 次", "Pass 1")} · A/C/E/G/I/K/M/O
                          </span>
                        </span>
                        <span className="loading-route-pass pass-two">
                          <b aria-hidden="true">②</b>
                          <span>
                            {tr("第 2 次", "Pass 2")} · B/D/F/H/J/L/N/P
                          </span>
                        </span>
                        <span className="loading-route-note">
                          {tr(
                            "孔板仍按真实 A–P 顺序显示",
                            "Plate remains in physical A–P order",
                          )}
                        </span>
                      </div>
                    )}

                  <div className="selection-toolbar" aria-live="polite">
                    <span>
                      {selectedWellIds.length > 0
                        ? tr(
                            `已选 ${selectedWellIds.length} 孔（其中 ${selectedOccupiedCount} 个检测孔）`,
                            `${selectedWellIds.length} selected (${selectedOccupiedCount} occupied)`,
                          )
                        : tr(
                            "选择一个或多个孔后可编辑或平移",
                            "Select one or more wells to edit or move",
                          )}
                    </span>
                    <div className="selection-actions">
                      <button
                        className="button button-quiet"
                        type="button"
                        onClick={undoLayout}
                        disabled={undoStack.length === 0}
                        title={tr(
                          "撤回手动编辑（⌘/Ctrl + Z）",
                          "Undo manual edit (⌘/Ctrl + Z)",
                        )}
                      >
                        <Undo2 size={13} />
                        {tr("撤回", "Undo")}
                      </button>
                      <button
                        className="button button-quiet"
                        type="button"
                        onClick={redoLayout}
                        disabled={redoStack.length === 0}
                        title={tr(
                          "重做手动编辑（⇧ + ⌘/Ctrl + Z）",
                          "Redo manual edit (⇧ + ⌘/Ctrl + Z)",
                        )}
                      >
                        <Redo2 size={13} />
                        {tr("重做", "Redo")}
                      </button>
                      <button
                        className="button button-quiet"
                        type="button"
                        disabled={
                          selectedWellIds.length === 0 ||
                          activePlateConfirmed ||
                          settingsStale
                        }
                        onClick={() =>
                          openEditorForSelection(
                            activePlateIndex,
                            activePlate,
                            selectedWellIds,
                          )
                        }
                      >
                        <Pencil size={13} />
                        {tr("编辑", "Edit")}
                      </button>
                      <button
                        className={`button button-quiet ${
                          moveMode ? "active" : ""
                        }`}
                        type="button"
                        disabled={
                          selectedOccupiedCount === 0 ||
                          activePlateConfirmed ||
                          settingsStale
                        }
                        onClick={() => setMoveMode((current) => !current)}
                      >
                        <Move size={13} />
                        {moveMode
                          ? tr("点选目标孔", "Choose destination")
                          : tr("平移", "Move")}
                      </button>
                      <button
                        className="button button-clear"
                        type="button"
                        disabled={
                          selectedWellIds.length === 0 ||
                          activePlateConfirmed ||
                          settingsStale
                        }
                        onClick={clearSelectedWells}
                      >
                        <Trash2 size={13} />
                        {tr("清空孔", "Clear wells")}
                      </button>
                      {selectedWellIds.length > 0 && (
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => {
                            setSelectedWellIds([]);
                            setSelectionAnchorId(null);
                            setMoveMode(false);
                          }}
                          aria-label={tr("取消选择", "Clear selection")}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="plate-scroll">
                    <div
                      className={`plate-grid ${
                        activePlate.rows === 16 ? "plate-384" : ""
                      } ${moveMode ? "move-mode" : ""}`}
                      style={
                        {
                          "--plate-columns": activePlate.columns,
                        } as CSSProperties
                      }
                      role="grid"
                      aria-label={tr(
                        `${activePlate.name} 孔板布局`,
                        `${activePlate.name} plate layout`,
                      )}
                    >
                      <span className="grid-corner" aria-hidden="true" />
                      {Array.from({ length: activePlate.columns }).map(
                        (_, column) => (
                          <span
                            className="column-header"
                            role="columnheader"
                            key={`column-${column}`}
                          >
                            {column + 1}
                          </span>
                        ),
                      )}
                      {Array.from({ length: activePlate.rows }).map((_, row) => (
                        <Fragment key={`row-${row}`}>
                          <span
                            className={`row-header ${
                              activePlate.rows === 16 &&
                              previewLoadingPattern ===
                                "interleaved-8-channel"
                                ? "with-route"
                                : ""
                            }`}
                            role="rowheader"
                          >
                            <span>
                              {formatWellId(row, 0).replace(/\d+$/, "")}
                            </span>
                            {activePlate.rows === 16 &&
                              previewLoadingPattern ===
                                "interleaved-8-channel" && (
                                <span
                                  className={`row-route-marker ${
                                    row % 2 === 0
                                      ? "pass-one"
                                      : "pass-two"
                                  }`}
                                  title={
                                    row % 2 === 0
                                      ? tr("第 1 次上样", "Pass 1")
                                      : tr("第 2 次上样", "Pass 2")
                                  }
                                  aria-label={
                                    row % 2 === 0
                                      ? tr("第 1 次上样", "Pass 1")
                                      : tr("第 2 次上样", "Pass 2")
                                  }
                                >
                                  {row % 2 === 0 ? "①" : "②"}
                                </span>
                              )}
                          </span>
                          {activePlate.wells
                            .filter((well) => well.row === row)
                            .sort((left, right) => left.column - right.column)
                            .map((well) => {
                              const empty = !well.sample || !well.gene;
                              const manual = well.source === "manual";
                              const selected = selectedWellIds.includes(
                                well.wellId,
                              );
                              const blank = Boolean(
                                well.sample && blankSampleSet.has(well.sample),
                              );
                              const wellClass = [
                                "well",
                                well.geneType === "reference"
                                  ? "well-reference"
                                  : "",
                                empty ? "well-empty" : "",
                                blank ? "well-blank" : "",
                                manual ? "well-manual" : "",
                                selected ? "well-selected" : "",
                              ]
                                .filter(Boolean)
                                .join(" ");
                              const description = empty
                                ? tr(
                                    `${well.wellId}，空孔${
                                      manual ? "，手动修改" : ""
                                    }`,
                                    `${well.wellId}, empty${
                                      manual ? ", manually edited" : ""
                                    }`,
                                  )
                                : tr(
                                    `${well.wellId}，${
                                      blank ? "Blank" : "样本"
                                    } ${well.sample}，基因 ${well.gene}，${
                                      well.geneType === "reference"
                                        ? "内参"
                                        : "目的基因"
                                    }，复孔 ${well.replicateIndex ?? "—"}${
                                      manual ? "，手动修改" : ""
                                    }`,
                                    `${well.wellId}, ${
                                      blank ? "Blank" : "sample"
                                    } ${well.sample}, assay ${well.gene}, ${
                                      well.geneType === "reference"
                                        ? "reference"
                                        : "target"
                                    }, replicate ${well.replicateIndex ?? "—"}${
                                      manual ? ", manually edited" : ""
                                    }`,
                                  );
                              return (
                                <button
                                  id={`plate-${activePlate.plateNumber}-well-${well.row}-${well.column}`}
                                  className={wellClass}
                                  style={wellVisual(well, targetGenes)}
                                  type="button"
                                  role="gridcell"
                                  key={well.wellId}
                                  title={description}
                                  aria-label={description}
                                  disabled={activePlateConfirmed || settingsStale}
                                  onClick={(event) =>
                                    handleWellSelection(
                                      event,
                                      activePlateIndex,
                                      activePlate,
                                      well,
                                    )
                                  }
                                  onDoubleClick={() => {
                                    setSelectedWellIds([well.wellId]);
                                    setSelectionAnchorId(well.wellId);
                                    openEditorForSelection(
                                      activePlateIndex,
                                      activePlate,
                                      [well.wellId],
                                    );
                                  }}
                                  onKeyDown={(event) =>
                                    moveWellFocus(
                                      event,
                                      activePlate,
                                      well.row,
                                      well.column,
                                    )
                                  }
                                >
                                  {manual && (
                                    <span
                                      className="manual-marker"
                                      aria-hidden="true"
                                    />
                                  )}
                                  {!empty && (
                                    <span>
                                      <span className="well-label">
                                        {shortLabel(
                                          well.sample ?? "",
                                          activePlate.rows === 16 ? 4 : 7,
                                        )}
                                      </span>
                                      <span className="well-sub">
                                        {shortLabel(well.gene ?? "", 7)}
                                      </span>
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                        </Fragment>
                      ))}
                    </div>
                  </div>

                  <div
                    className={`validation-bar ${
                      activeInvalid
                        ? "invalid"
                        : activeIssues.length > 0
                          ? "warning"
                          : ""
                    }`}
                    role="status"
                  >
                    {activeInvalid || activeIssues.length > 0 ? (
                      <AlertTriangle size={15} />
                    ) : (
                      <Check size={15} />
                    )}
                    <div>
                      {settingsStale ? (
                        <strong>
                          {tr(
                            "实验设置已变更，请重新生成布局。",
                            "Settings changed; regenerate the layout.",
                          )}
                        </strong>
                      ) : activeIssues.length > 0 ? (
                        <>
                          <strong>
                            {tr(
                              `当前有 ${activeIssues.length} 项布局提醒；不会限制确认、保存或导出。`,
                              `${activeIssues.length} layout advisory item(s); confirmation, saving, and export remain available.`,
                            )}
                          </strong>
                          <ul className="validation-list">
                            {activeIssues.slice(0, 3).map((issue, index) => (
                              <li key={`${issue.code}-${index}`}>
                                {localizeMessage(issue.message)}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <strong>
                          {tr(
                            "自动布局核查通过；仍请在上机前人工确认。",
                            "Automatic layout checks passed; verify the plate before the run.",
                          )}
                        </strong>
                      )}
                    </div>
                  </div>
                  </section>
                  <ReactionCalculator
                    layout={layout}
                    samples={samples}
                    genes={genes.map((gene) => ({
                      name: gene.name,
                      role: gene.role,
                    }))}
                    value={reactionSystem}
                    language={language}
                    onChange={(nextValue) => {
                      setReactionSystem(nextValue);
                      markChanged();
                    }}
                  />
                </div>
              )}

              <div className="method-note">
                <Info size={16} />
                <div>
                  <strong>{tr("特别说明", "Special note")}</strong>
                  {tr(
                    "手动调整可能打破推荐的复孔或内参结构；系统会显示提醒，但不限制保存、确认或导出。请在上机前按本地 SOP 人工核对。NTC、no-RT、阳性模板和板间校准样本不会自动添加。",
                    "Manual edits may break the recommended replicate or reference structure. The planner shows advisory messages without blocking save, confirmation, or export. Verify the final plate against the local SOP before the run. NTC, no-RT, positive-template controls, and inter-plate calibrators are not added automatically.",
                  )}
                </div>
              </div>
            </>
          )}

          <div className="footer-note">
            <span>
              {tr(
                "仅供科研使用（RUO）· 请核对本地 SOP",
                "Research use only (RUO) · Verify against the local SOP",
              )}
            </span>
            <span>
              {tr(
                "浏览器本地处理 · 不上传样本名称",
                "Processed in the browser · Sample names are not uploaded",
              )}
            </span>
          </div>
        </main>
      </div>

      {editor && layout && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setEditor(null);
          }}
        >
          <section
            className="edit-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-title"
          >
            <div className="modal-heading">
              <div>
                <h2 className="modal-title" id="edit-title">
                  {tr(
                    `编辑所选 ${editor.wellIds.length} 个孔`,
                    `Edit ${editor.wellIds.length} selected well(s)`,
                  )}
                </h2>
                <p className="modal-description">
                  {tr(
                    "只修改当前选中的孔，并用紫色轮廓标记。",
                    "Only the selected wells are changed and marked with a purple outline.",
                  )}
                </p>
              </div>
              <button
                className="icon-button modal-close"
                type="button"
                onClick={() => setEditor(null)}
                aria-label={tr("关闭编辑", "Close editor")}
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-form">
              <div className="field">
                <span className="field-label">
                  {tr("孔位状态", "Well status")}
                </span>
                <div className="segmented">
                  <button
                    className={editor.mode === "assay" ? "active" : ""}
                    type="button"
                    onClick={() =>
                      setEditor((current) =>
                        current ? { ...current, mode: "assay" } : current,
                      )
                    }
                  >
                    {tr("检测孔", "Assay")}
                  </button>
                  <button
                    className={editor.mode === "empty" ? "active" : ""}
                    type="button"
                    onClick={() =>
                      setEditor((current) =>
                        current ? { ...current, mode: "empty" } : current,
                      )
                    }
                  >
                    {tr("空孔", "Empty")}
                  </button>
                </div>
              </div>
              {editor.mode === "assay" && (
                <>
                  <label className="field">
                    <span className="field-label">
                      {tr("样本", "Sample")}
                    </span>
                    <select
                      className="select"
                      value={editor.sample}
                      onChange={(event) =>
                        setEditor((current) =>
                          current
                            ? { ...current, sample: event.target.value }
                            : current,
                        )
                      }
                    >
                      {samples.map((sample) => (
                        <option value={sample.name} key={sample.id}>
                          {sample.name}
                          {sample.kind === "blank" ? " · Blank" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">
                      {tr("基因", "Assay")}
                    </span>
                    <select
                      className="select"
                      value={editor.gene}
                      onChange={(event) =>
                        setEditor((current) =>
                          current
                            ? { ...current, gene: event.target.value }
                            : current,
                        )
                      }
                    >
                      {genes.map((gene) => (
                        <option value={gene.name} key={gene.id}>
                          {gene.name} ·{" "}
                          {gene.role === "reference"
                            ? tr("内参", "Reference")
                            : tr("目的", "Target")}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <div className="notice">
                <Layers3 size={15} />
                <span>
                  {tr(
                    "手动修改可自由保存和导出。若出现内参缺失、重复或遗漏，系统只显示提醒，请自行核对。",
                    "Manual edits can be saved and exported freely. Missing references, duplicates, or omissions are shown as advisory messages for review.",
                  )}
                </span>
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="button button-quiet"
                type="button"
                onClick={() => setEditor(null)}
              >
                {tr("取消", "Cancel")}
              </button>
              <button
                className={
                  editor.mode === "empty"
                    ? "button button-danger"
                    : "button button-primary"
                }
                type="button"
                onClick={applyManualEdit}
              >
                {editor.mode === "empty" && <Trash2 size={14} />}
                {editor.mode === "empty"
                  ? tr("清空所选孔", "Clear selected")
                  : tr("应用修改", "Apply")}
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.tone}`} role="status">
          {toast.tone === "success" ? (
            <Check size={15} />
          ) : toast.tone === "error" ? (
            <AlertTriangle size={15} />
          ) : (
            <Info size={15} />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
