"use client";

import {
  AlertTriangle,
  Beaker,
  Check,
  Download,
  FileSpreadsheet,
  FlaskConical,
  Info,
  Layers3,
  Minus,
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
  type ReactionSystemInput,
} from "@/lib/reactionCalculator";
import {
  formatWellId,
  getPlateDimensions,
  planPlateLayout,
  refreshPlanDerivedData,
  validateLayout,
  type GeneType,
  type PlanInput,
  type PlannerPlate,
  type PlannerWell,
  type PlanResult,
  type PlateType,
  type ValidationIssue,
} from "@/lib/platePlanner";
import { ReactionCalculator } from "@/app/ReactionCalculator";

type GeneRole = "target" | "reference";

interface GeneEntry {
  id: string;
  name: string;
  role: GeneRole;
}

interface EditorState {
  plateIndex: number;
  row: number;
  startColumn: number;
  mode: "assay" | "empty";
  sample: string;
  gene: string;
}

interface ToastState {
  tone: "success" | "error" | "neutral";
  message: string;
}

interface StoredPlannerState {
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
  reactionSystem?: ReactionSystemInput;
}

const STORAGE_KEY = "qpcr-plate-planner:v1";
const DEFAULT_REACTION_SYSTEM: ReactionSystemInput = {
  cdnaPerWellUl: 1,
  primerPairPerWellUl: 0.8,
  masterMixPerWellUl: 5,
  totalPerWellUl: 10,
  overagePercent: 10,
};

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

function parseExcelNames(value: string) {
  return value
    .split(/\t|\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizedKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function experimentSignature(
  plateType: PlateType,
  samples: string[],
  genes: GeneEntry[],
  replicates: number,
) {
  return JSON.stringify({
    plateType,
    samples,
    genes: genes.map(({ name, role }) => ({ name, role })),
    replicates,
  });
}

function strategyLabel(strategy: PlanResult["strategy"]) {
  if (strategy === "sample-major")
    return "按样本分块 / Sample-major";
  if (strategy === "gene-major")
    return "按基因分块 / Assay-major";
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

function blockLabel(
  row: number,
  startColumn: number,
  replicates: number,
) {
  return `${formatWellId(row, startColumn)}–${formatWellId(
    row,
    startColumn + replicates - 1,
  )}`;
}

function shortLabel(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function plateStatus(
  confirmed: boolean,
  invalid: boolean,
  stale: boolean,
) {
  if (stale)
    return { label: "设置已变更 / Stale", className: "invalid" };
  if (invalid)
    return { label: "需修复 / Fix", className: "invalid" };
  if (confirmed)
    return { label: "已确认 / Confirmed", className: "confirmed" };
  return { label: "草稿 / Draft", className: "" };
}

export function QpcrPlanner() {
  const [plateType, setPlateType] = useState<PlateType>(96);
  const [samples, setSamples] = useState<string[]>([]);
  const [genes, setGenes] = useState<GeneEntry[]>([]);
  const [replicates, setReplicates] = useState(3);
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
  const [toast, setToast] = useState<ToastState | null>(null);
  const [savedAt, setSavedAt] = useState("");
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [reactionSystem, setReactionSystem] =
    useState<ReactionSystemInput>(DEFAULT_REACTION_SYSTEM);

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
      samples,
      targetGenes,
      referenceGenes,
      replicates,
    }),
    [plateType, referenceGenes, replicates, samples, targetGenes],
  );

  const currentSignature = useMemo(
    () => experimentSignature(plateType, samples, genes, replicates),
    [genes, plateType, replicates, samples],
  );
  const settingsStale = Boolean(layout && layoutSignature !== currentSignature);
  const reactionWells = samples.length * genes.length * replicates;
  const effectiveBlocks =
    dimensions.rows * Math.floor(dimensions.columns / Math.max(1, replicates));
  const sampleFullRunWells = genes.length * replicates;

  const inputIssues = useMemo(() => {
    const issues: string[] = [];
    if (samples.length === 0)
      issues.push("请至少添加 1 个样本 / Add at least one sample");
    if (targetGenes.length === 0)
      issues.push("请至少添加 1 个目的基因 / Add at least one target assay");
    if (referenceGenes.length === 0)
      issues.push(
        "请至少将 1 个基因标记为内参 / Mark at least one assay as a reference",
      );
    if (!Number.isInteger(replicates) || replicates < 1)
      issues.push(
        "复孔数必须是正整数 / Replicate count must be a positive integer",
      );
    if (replicates > dimensions.columns)
      issues.push(
        `复孔数不能超过单行 ${dimensions.columns} 孔 / Replicates cannot exceed ${dimensions.columns} columns`,
      );
    if (referenceGenes.length + 1 > effectiveBlocks)
      issues.push(
        "全部内参加至少 1 个目的基因的同板配对无法放入当前孔板 / One target plus all references cannot fit on this plate",
      );
    return issues;
  }, [
    dimensions.columns,
    effectiveBlocks,
    referenceGenes.length,
    replicates,
    samples.length,
    targetGenes.length,
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
        samples,
        genes.map((gene) => ({
          name: gene.name,
          role: gene.role,
        })),
      ),
    [genes, layout, reactionSystem, samples],
  );

  const activePlate = layout?.plates[activePlateIndex] ?? null;
  const activePlateConfirmed = activePlate
    ? Boolean(confirmed[String(activePlate.plateNumber)])
    : false;
  const allConfirmed = Boolean(
    layout &&
      audit.valid &&
      reactionCalculation.valid &&
      !settingsStale &&
      layout.plates.every((plate) => confirmed[String(plate.plateNumber)]),
  );

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as StoredPlannerState;
          if (parsed.version === 1) {
            setPlateType(parsed.plateType);
            setSamples(parsed.samples);
            setGenes(parsed.genes);
            setReplicates(parsed.replicates);
            setLayout(parsed.layout);
            setAutomaticLayout(parsed.automaticLayout);
            setLayoutSignature(parsed.layoutSignature);
            setGeneratedAt(parsed.generatedAt);
            setConfirmed(parsed.confirmed);
            setReactionSystem(
              parsed.reactionSystem ?? DEFAULT_REACTION_SYSTEM,
            );
            setSavedAt("已恢复 / Restored");
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

  function addSamples(values: string[]) {
    const existing = new Set(samples.map(normalizedKey));
    const additions: string[] = [];
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
      additions.push(value);
    }
    if (additions.length > 0) {
      setSamples((current) => [...current, ...additions]);
      markChanged();
    }
    if (duplicates.length > 0) {
      setToast({
        tone: "error",
        message: `已跳过 ${duplicates.length} 个重复样本 / Skipped ${duplicates.length} duplicate sample(s): ${duplicates
          .slice(0, 3)
          .join("、")}${duplicates.length > 3 ? "…" : ""}`,
      });
    } else if (additions.length > 0) {
      setToast({
        tone: "success",
        message: `已添加 ${additions.length} 个样本。 / Added ${additions.length} sample(s).`,
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
        message: `已跳过 ${duplicates.length} 个重复基因 / Skipped ${duplicates.length} duplicate assay(s): ${duplicates
          .slice(0, 3)
          .join("、")}${duplicates.length > 3 ? "…" : ""}`,
      });
    } else if (additions.length > 0) {
      setToast({
        tone: "success",
        message: `已添加 ${additions.length} 个基因；新导入项默认为目的基因。 / Added ${additions.length} assay(s); imported assays default to target.`,
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
    const exampleSamples = Array.from(
      { length: 8 },
      (_, index) => `Sample_${String(index + 1).padStart(2, "0")}`,
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
    setLayout(null);
    setAutomaticLayout(null);
    setConfirmed({});
    setActivePlateIndex(0);
    markChanged();
    setToast({
      tone: "neutral",
      message:
        "已载入 8 个样本、3 个目的基因和 1 个内参的示例。 / Loaded an example with 8 samples, 3 targets, and 1 reference.",
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
        "重新生成将覆盖当前的手动修改，是否继续？ / Regenerating will overwrite manual edits. Continue?",
      )
    ) {
      return;
    }
    try {
      const next = planPlateLayout(planInput);
      const now = new Date().toLocaleString("zh-CN", { hour12: false });
      setLayout(next);
      setAutomaticLayout(clonePlan(next));
      setLayoutSignature(currentSignature);
      setGeneratedAt(now);
      setConfirmed({});
      setUndoStack([]);
      setRedoStack([]);
      setActivePlateIndex(0);
      markChanged();
      setToast({
        tone: "success",
        message: `已生成 ${next.plates.length} 块 ${plateType} 孔板；凡含该样本目的基因的板均已重做全部内参。 / Generated ${next.plates.length} plate(s); all references are rerun on every plate containing that sample's targets.`,
      });
    } catch (error) {
      setToast({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "无法生成布局。 / Unable to generate a layout.",
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
      version: 1,
      plateType,
      samples,
      genes,
      replicates,
      layout,
      automaticLayout,
      layoutSignature,
      generatedAt,
      confirmed,
      reactionSystem,
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      const time = new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      setSavedAt(`已保存 / Saved ${time}`);
      setDirty(false);
      setToast({
        tone: "success",
        message:
          "方案已保存在本机浏览器。 / Plan saved in this local browser.",
      });
    } catch {
      setToast({
        tone: "error",
        message:
          "保存失败。请检查浏览器是否允许本地存储。 / Save failed; check whether local browser storage is allowed.",
      });
    }
  }

  function openEditor(
    plateIndex: number,
    plate: PlannerPlate,
    well: PlannerWell,
  ) {
    if (confirmed[String(plate.plateNumber)] || settingsStale) return;
    const startColumn =
      Math.floor(well.column / replicates) * replicates;
    if (startColumn + replicates > plate.columns) return;
    const block = plate.wells.filter(
      (candidate) =>
        candidate.row === well.row &&
        candidate.column >= startColumn &&
        candidate.column < startColumn + replicates,
    );
    const occupied = block.find((candidate) => candidate.sample && candidate.gene);
    setEditor({
      plateIndex,
      row: well.row,
      startColumn,
      mode: occupied ? "assay" : "empty",
      sample: occupied?.sample ?? samples[0] ?? "",
      gene: occupied?.gene ?? genes[0]?.name ?? "",
    });
  }

  function applyManualEdit() {
    if (!layout || !editor) return;
    if (editor.mode === "assay" && (!editor.sample || !editor.gene)) {
      setToast({
        tone: "error",
        message: "请选择样本和基因。 / Select a sample and an assay.",
      });
      return;
    }
    const next = clonePlan(layout);
    const plate = next.plates[editor.plateIndex];
    const selectedGene = genes.find((gene) => gene.name === editor.gene);
    for (let offset = 0; offset < replicates; offset += 1) {
      const column = editor.startColumn + offset;
      const index = plate.wells.findIndex(
        (well) => well.row === editor.row && well.column === column,
      );
      if (index < 0) continue;
      plate.wells[index] = {
        wellId: formatWellId(editor.row, column),
        row: editor.row,
        column,
        sample: editor.mode === "assay" ? editor.sample : null,
        gene: editor.mode === "assay" ? editor.gene : null,
        geneType:
          editor.mode === "assay"
            ? ((selectedGene?.role ?? "target") as GeneType)
            : null,
        replicateIndex: editor.mode === "assay" ? offset + 1 : null,
        source: "manual",
      };
    }
    commitLayout(next, plate.plateNumber);
    setEditor(null);
    setToast({
      tone: "neutral",
      message: `${blockLabel(
        editor.row,
        editor.startColumn,
        replicates,
      )} 已按整组复孔更新；请查看下方即时校验。 / The full replicate block was updated; review live validation below.`,
    });
  }

  function restoreActivePlate() {
    if (!layout || !automaticLayout || !activePlate) return;
    const source = automaticLayout.plates.find(
      (plate) => plate.plateNumber === activePlate.plateNumber,
    );
    if (!source) return;
    const next = clonePlan(layout);
    next.plates[activePlateIndex] = clonePlan(source);
    commitLayout(next, activePlate.plateNumber);
    setToast({
      tone: "success",
      message: `Plate ${String(activePlate.plateNumber).padStart(2, "0")} 已恢复为自动布局。 / Automatic layout restored.`,
    });
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
        message:
          "实验设置已变更，请重新生成布局。 / Experiment settings changed; regenerate the layout.",
      });
      return;
    }
    const plateIssues = issuesForPlate(activePlate);
    if (plateIssues.length > 0) {
      setToast({
        tone: "error",
        message:
          plateIssues[0]?.message ??
          "当前孔板未通过检查。 / This plate did not pass validation.",
      });
      return;
    }
    setConfirmed((current) => ({ ...current, [key]: true }));
    markChanged();
    setToast({
      tone: "success",
      message: `Plate ${String(activePlate.plateNumber).padStart(2, "0")} 已通过检查并锁定。 / Plate validated and locked.`,
    });
  }

  function exportablePlate(plate: PlannerPlate): ExportablePlate {
    return {
      plateNumber: plate.plateNumber,
      rows: plate.rows,
      columns: plate.columns,
      wells: plate.wells,
      confirmed: Boolean(confirmed[String(plate.plateNumber)]),
    };
  }

  function exportContext(validationStatus?: "Valid" | "Invalid"): ExportContext {
    return {
      plateType,
      replicates,
      samples,
      targetGenes,
      referenceGenes,
      strategyLabel: layout ? strategyLabel(layout.strategy) : "",
      generatedAt,
      validationStatus:
        validationStatus ??
        (audit.valid && !settingsStale ? "Valid" : "Invalid"),
      splitSamples: layout?.metrics.splitSamples ?? 0,
      repeatedReferenceBlocks:
        layout?.metrics.repeatedReferenceBlocks ?? 0,
      repeatedReferenceWells:
        layout?.metrics.repeatedReferenceWells ?? 0,
      reactionSystem,
    };
  }

  async function downloadActivePlate() {
    const plateValid = activePlate
      ? !settingsStale && issuesForPlate(activePlate).length === 0
      : false;
    if (
      !activePlate ||
      !activePlateConfirmed ||
      !plateValid ||
      !reactionCalculation.valid
    ) {
      setToast({
        tone: "error",
        message:
          reactionCalculation.errors[0] ??
          "请先完成校验并确认本板，再导出 Excel。 / Validate and confirm this plate before exporting.",
      });
      return;
    }
    try {
      await exportPlateExcel(
        exportablePlate(activePlate),
        exportContext("Valid"),
      );
      setToast({
        tone: "success",
        message: `Plate ${String(activePlate.plateNumber).padStart(2, "0")} Excel 已生成。 / Excel generated.`,
      });
    } catch {
      setToast({
        tone: "error",
        message:
          "Excel 生成失败；当前方案仍已保留，请稍后重试。 / Excel generation failed; the plan remains saved.",
      });
    }
  }

  async function downloadAllPlates() {
    if (!layout || !allConfirmed) {
      setToast({
        tone: "error",
        message:
          "请先确认全部孔板，再批量导出。 / Confirm every plate before batch export.",
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
        message: `已打包 ${layout.plates.length} 个独立 Excel 和总览表。 / Packaged ${layout.plates.length} plate workbooks plus an overview.`,
      });
    } catch {
      setToast({
        tone: "error",
        message:
          "批量导出失败；当前方案仍已保留，请稍后重试。 / Batch export failed; the plan remains saved.",
      });
    }
  }

  function issuesForPlate(plate: PlannerPlate) {
    return audit.errors.filter(
      (issue) =>
        issue.plateNumber === undefined ||
        issue.plateNumber === plate.plateNumber,
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

  const activeIssues = activePlate ? issuesForPlate(activePlate) : [];
  const activeInvalid = settingsStale || activeIssues.length > 0;
  const currentStatus = plateStatus(
    activePlateConfirmed,
    activeInvalid,
    settingsStale,
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <FlaskConical size={20} strokeWidth={1.8} />
          </div>
          <div className="brand-copy">
            <p className="brand-title">
              RT-qPCR(SYBR Green)版布局规划工具
            </p>
            <p className="brand-subtitle">
              Plate Layout Planner · Local-first
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`save-status ${dirty ? "unsaved" : ""}`}>
            {dirty
              ? "有未保存更改 / Unsaved"
              : savedAt ||
                (hydrated ? "本地就绪 / Local ready" : "载入中 / Loading")}
          </span>
          <button
            className="icon-button desktop-only"
            type="button"
            onClick={undoLayout}
            disabled={undoStack.length === 0}
            aria-label="撤销手动编辑 / Undo manual edit"
            title="撤销 / Undo（⌘/Ctrl + Z）"
          >
            <Undo2 size={16} />
          </button>
          <button
            className="icon-button desktop-only"
            type="button"
            onClick={redoLayout}
            disabled={redoStack.length === 0}
            aria-label="恢复手动编辑 / Redo manual edit"
            title="恢复 / Redo（⇧ + ⌘/Ctrl + Z）"
          >
            <Redo2 size={16} />
          </button>
          <button className="button" type="button" onClick={savePlanner}>
            <Save size={15} />
            <span>保存 / Save</span>
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={downloadAllPlates}
            disabled={!allConfirmed}
            title={
              allConfirmed
                ? "导出全部孔板 / Export all plates"
                : "完成校验并确认全部孔板后可批量导出 / Validate and confirm all plates first"
            }
          >
            <Download size={15} />
            <span>
              全部导出 / Export all
              {layout ? `（${layout.plates.length}）` : ""}
            </span>
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="实验设置 / Experiment setup">
          <section className="panel">
            <div className="panel-heading">
              <div className="heading-with-index">
                <span className="section-index">01</span>
                <div>
                  <h2 className="panel-title">选择孔板 / Plate format</h2>
                  <p className="panel-description">
                    本次上机板型 / Select plate type
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
                      setPlateType(type);
                      if (replicates > size.columns) setReplicates(size.columns);
                      markChanged();
                    }}
                    aria-pressed={plateType === type}
                  >
                    <span>
                      <span className="plate-choice-name">
                        {type} 孔板 / {type}-well
                      </span>
                      <span className="plate-choice-meta">
                        {size.rows} 行 / rows × {size.columns} 列 / columns
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
                  <h2 className="panel-title">添加样本 / Samples</h2>
                  <p className="panel-description">
                    逐个输入或从 Excel 粘贴 / Add or paste
                  </p>
                </div>
              </div>
              {samples.length > 0 && (
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => {
                    setSamples([]);
                    markChanged();
                  }}
                >
                  清空 / Clear
                </button>
              )}
            </div>
            <div className="entry-stack">
              <form className="entry-row" onSubmit={submitSample}>
                <input
                  className="input"
                  value={sampleInput}
                  onChange={(event) => setSampleInput(event.target.value)}
                  placeholder="如 / e.g. Tumor_01"
                  aria-label="样本名称 / Sample name"
                />
                <button
                  className="icon-button"
                  type="submit"
                  aria-label="添加样本 / Add sample"
                  disabled={!sampleInput.trim()}
                >
                  <Plus size={16} />
                </button>
              </form>
              <details className="batch-disclosure">
                <summary>
                  <span>从 Excel 批量粘贴 / Paste from Excel</span>
                  <FileSpreadsheet size={14} />
                </summary>
                <div className="batch-content">
                  <textarea
                    className="batch-box"
                    value={samplePaste}
                    onChange={(event) => setSamplePaste(event.target.value)}
                    placeholder={
                      "复制一列或多列样本名称 / Copy one or more columns\n粘贴到这里 / Paste here"
                    }
                    aria-label="批量粘贴样本 / Paste samples in bulk"
                  />
                  <button
                    className="button button-soft"
                    type="button"
                    disabled={parseExcelNames(samplePaste).length === 0}
                    onClick={() => {
                      addSamples(parseExcelNames(samplePaste));
                      setSamplePaste("");
                    }}
                  >
                    导入 / Import{" "}
                    {parseExcelNames(samplePaste).length || ""} 个名称 / names
                  </button>
                </div>
              </details>
              {samples.length > 0 ? (
                <div
                  className="chip-list"
                  aria-label="已添加样本 / Added samples"
                >
                  {samples.map((sample) => (
                    <span className="chip" key={sample} title={sample}>
                      <span className="chip-label">{sample}</span>
                      <button
                        className="chip-remove"
                        type="button"
                        onClick={() => {
                          setSamples((current) =>
                            current.filter((item) => item !== sample),
                          );
                          markChanged();
                        }}
                        aria-label={`删除样本 / Remove sample ${sample}`}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="microcopy">
                  尚未添加样本 / No samples added.
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
                    添加检测基因 / Assays
                  </h2>
                  <p className="panel-description">
                    切换目的/内参 / Toggle target/reference
                  </p>
                </div>
              </div>
              {genes.length > 0 && (
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => {
                    setGenes([]);
                    markChanged();
                  }}
                >
                  清空 / Clear
                </button>
              )}
            </div>
            <div className="entry-stack">
              <form className="entry-row" onSubmit={submitGene}>
                <input
                  className="input"
                  value={geneInput}
                  onChange={(event) => setGeneInput(event.target.value)}
                  placeholder="如 / e.g. GAPDH"
                  aria-label="基因名称 / Assay name"
                />
                <button
                  className="icon-button"
                  type="submit"
                  aria-label="添加基因 / Add assay"
                  disabled={!geneInput.trim()}
                >
                  <Plus size={16} />
                </button>
              </form>
              <details className="batch-disclosure">
                <summary>
                  <span>从 Excel 批量粘贴 / Paste from Excel</span>
                  <FileSpreadsheet size={14} />
                </summary>
                <div className="batch-content">
                  <textarea
                    className="batch-box"
                    value={genePaste}
                    onChange={(event) => setGenePaste(event.target.value)}
                    placeholder={
                      "复制一列或多列基因名称 / Copy one or more columns\n粘贴到这里 / Paste here"
                    }
                    aria-label="批量粘贴基因 / Paste assays in bulk"
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
                    导入 / Import{" "}
                    {parseExcelNames(genePaste).length || ""} 个名称 / names
                  </button>
                </div>
              </details>
              {genes.length > 0 ? (
                <div
                  className="gene-list"
                  aria-label="已添加基因 / Added assays"
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
                          aria-label={`将 / Change ${gene.name} to ${
                            gene.role === "target" ? "内参" : "目的"
                          }基因 / ${gene.role === "target" ? "reference" : "target"}`}
                        >
                          {gene.role === "reference"
                            ? "内参 / Reference"
                            : "目的 / Target"}
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
                          aria-label={`删除基因 / Remove assay ${gene.name}`}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="microcopy">
                  尚未添加检测基因 / No assays added.
                </p>
              )}
              {referenceGenes.length === 0 && (
                <div className="notice notice-warning">
                  <AlertTriangle size={15} />
                  <span>
                    尚未设置内参；请至少将 1 个基因标记为“内参”，数量不限。 /
                    No reference assay selected; mark at least one assay as a
                    reference. Multiple references are supported.
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
                    技术复孔 / Technical replicates
                  </h2>
                  <p className="panel-description">
                    横向连续且不跨行 / Left-to-right, no row wrap
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
                  aria-label="减少复孔数 / Decrease replicates"
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
                  aria-label="技术复孔数 / Technical replicate count"
                />
                <button
                  type="button"
                  onClick={() => {
                    setReplicates((value) =>
                      Math.min(dimensions.columns, value + 1),
                    );
                    markChanged();
                  }}
                  aria-label="增加复孔数 / Increase replicates"
                >
                  <Plus size={14} />
                </button>
              </div>
              <span className="microcopy">
                例如 / e.g. 3 replicates: A1–A3；下一组从 A4 开始
              </span>
            </div>
            <div className="setup-summary">
              <strong>
                {samples.length} 样本 / samples × {genes.length} 基因 /
                assays × {replicates || 0} 复孔 / replicates
              </strong>
              <span>
                基础反应孔 {reactionWells} 个（未计跨板内参重做）·
                单样本若全部基因同板需 {sampleFullRunWells} 孔 ·{" "}
                {referenceGenes.length} 个内参 / Base wells {reactionWells}
                (before cross-plate reference reruns) · {sampleFullRunWells}
                wells if all assays for one sample share a plate ·{" "}
                {referenceGenes.length} reference assay(s)
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
              生成推荐布局 / Generate layout
            </button>
          </section>
        </aside>

        <main className="main-area">
          <section className="hero-strip" aria-labelledby="planner-title">
            <div>
              <p className="eyebrow">
                <ShieldCheck size={13} />
                qPCR 规则感知排板 / qPCR-aware layout engine
              </p>
              <h1 className="hero-title" id="planner-title">
                {layout
                  ? `已生成 ${layout.plates.length} 块可核对实验板 / ${layout.plates.length} review-ready plates.`
                  : "把 RT-qPCR 排板变成可核对的实验设计 / A review-ready plate plan."}
              </h1>
              <p className="hero-copy">
                优先减少板数；任何含某样本目的基因的孔板，都必须包含该样本的全部内参；技术复孔横向连续。 /
                Minimize plates first; every plate containing a sample&apos;s
                target assay(s) must also contain all references for that
                sample; keep replicates contiguous left-to-right.
              </p>
            </div>
            <div className="summary-grid" aria-label="布局摘要">
              <div className="metric">
                <span className="metric-label">
                  预计孔板 / Plates
                </span>
                <strong className="metric-value">
                  {layout ? layout.metrics.plateCount : "—"}
                </strong>
                <span className="metric-detail">
                  {layout ? `${plateType}-well` : "等待输入 / Waiting"}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">
                  反应孔 / Reactions
                </span>
                <strong className="metric-value">
                  {layout ? layout.metrics.usedWells : reactionWells || "—"}
                </strong>
                <span className="metric-detail">
                  {layout
                    ? `含跨板重做内参 ${layout.metrics.repeatedReferenceWells} 孔 / ${layout.metrics.repeatedReferenceWells} rerun reference wells`
                    : "生成后计入跨板重做内参 / Reruns added after planning"}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">
                  利用率 / Utilization
                </span>
                <strong className="metric-value">
                  {layout
                    ? `${(layout.metrics.utilization * 100).toFixed(1)}%`
                    : "—"}
                </strong>
                <span className="metric-detail">
                  {layout
                    ? `${layout.metrics.emptyWells} 个空孔 / empty wells`
                    : "—"}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">
                  推荐策略 / Strategy
                </span>
                <strong className="metric-value" style={{ fontSize: 17 }}>
                  {layout ? strategyLabel(layout.strategy) : "—"}
                </strong>
                <span className="metric-detail">
                  {layout
                    ? `样本切换 ${layout.metrics.sampleSwitches} · 引物切换 ${layout.metrics.primerSwitches} / sample · assay switches`
                    : "比较三种板内顺序 / Comparing three orders"}
                </span>
              </div>
              {layout && <p className="rationale">{layout.reason}</p>}
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
                <h2>先添加样本和检测基因 / Add samples and assays</h2>
                <p>
                  系统会计算孔板数、比较板内操作顺序，并生成可点击编辑的布局。 /
                  The planner compares layouts and creates editable plates.
                </p>
                <button
                  className="button button-soft"
                  type="button"
                  onClick={loadExample}
                  style={{ marginTop: 18 }}
                >
                  <Beaker size={15} />
                  载入示例 / Load example
                </button>
              </div>
            </section>
          ) : (
            <>
              {settingsStale && (
                <div className="notice notice-error" style={{ marginBottom: 12 }}>
                  <AlertTriangle size={16} />
                  <span>
                    实验设置已在生成后发生改变。当前布局仍保留用于对照，但必须重新生成后才能确认和导出。 /
                    Settings changed after generation; regenerate before
                    confirmation or export.
                  </span>
                </div>
              )}

              <nav className="plate-nav" aria-label="孔板列表 / Plate list">
                {layout.plates.map((plate, index) => {
                  const issues = issuesForPlate(plate);
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
                      onClick={() => setActivePlateIndex(index)}
                      aria-current={activePlateIndex === index ? "page" : undefined}
                    >
                      <span>
                        <span className="plate-tab-title">
                          Plate {String(plate.plateNumber).padStart(2, "0")}
                        </span>
                        <span className="plate-tab-meta">
                          {plate.sampleNames.length} 样本 / samples ·{" "}
                          {
                            plate.wells.filter((well) => well.sample && well.gene)
                              .length
                          }{" "}
                          孔 / wells
                        </span>
                      </span>
                      <span
                        className={`plate-tab-state ${
                          settingsStale || issues.length > 0
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
                      <div className="entry-row">
                        <h2 className="plate-title">
                          Plate {String(activePlate.plateNumber).padStart(2, "0")}
                        </h2>
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
                        {plateType}-well · 已使用 / Used{" "}
                        {
                          activePlate.wells.filter(
                            (well) => well.sample && well.gene,
                          ).length
                        }{" "}
                        / {plateType} · {activePlate.sampleNames.join("、")}
                      </p>
                    </div>
                    <div className="plate-actions">
                      <button
                        className="icon-button"
                        type="button"
                        onClick={undoLayout}
                        disabled={undoStack.length === 0}
                        title="撤销 / Undo"
                        aria-label="撤销 / Undo"
                      >
                        <Undo2 size={15} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={redoLayout}
                        disabled={redoStack.length === 0}
                        title="恢复 / Redo"
                        aria-label="恢复 / Redo"
                      >
                        <Redo2 size={15} />
                      </button>
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
                        恢复 / Restore
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
                          ? "解除确认 / Unlock"
                          : "确认本板 / Confirm"}
                      </button>
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={downloadActivePlate}
                        disabled={
                          !activePlateConfirmed ||
                          activeIssues.length > 0 ||
                          !reactionCalculation.valid ||
                          settingsStale
                        }
                      >
                        <Download size={14} />
                        导出 / Export Excel
                      </button>
                    </div>
                  </div>

                  <div className="plate-context">
                    <div
                      className="legend"
                      aria-label="颜色图例 / Color legend"
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
                                ? " · 内参 / Reference"
                                : ""}
                            </span>
                          </span>
                        );
                      })}
                      <span className="legend-item">
                        <span className="legend-dot manual" />
                        <span>手动修改 / Manual</span>
                      </span>
                    </div>
                      <span className="plate-hint">
                      点击孔位编辑整组 {replicates} 复孔 / Click a well to edit
                      its full replicate block
                    </span>
                  </div>

                  <div className="plate-scroll">
                    <div
                      className={`plate-grid ${
                        plateType === 384 ? "plate-384" : ""
                      }`}
                      style={
                        {
                          "--plate-columns": activePlate.columns,
                        } as CSSProperties
                      }
                      role="grid"
                      aria-label={`Plate ${activePlate.plateNumber} 孔板布局 / plate layout`}
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
                            className="row-header"
                            role="rowheader"
                          >
                            {formatWellId(row, 0).replace(/\d+$/, "")}
                          </span>
                          {activePlate.wells
                            .filter((well) => well.row === row)
                            .sort((left, right) => left.column - right.column)
                            .map((well) => {
                              const usableColumns =
                                Math.floor(activePlate.columns / replicates) *
                                replicates;
                              const reserved = well.column >= usableColumns;
                              const empty = !well.sample || !well.gene;
                              const manual = well.source === "manual";
                              const wellClass = [
                                "well",
                                well.geneType === "reference"
                                  ? "well-reference"
                                  : "",
                                empty ? "well-empty" : "",
                                reserved ? "well-unused" : "",
                                manual ? "well-manual" : "",
                              ]
                                .filter(Boolean)
                                .join(" ");
                              const description = reserved
                                ? `${well.wellId}，行尾保留孔，当前复孔数下不可作为起始块 / reserved row-tail well`
                                : empty
                                  ? `${well.wellId}，空孔${
                                      manual ? "，手动修改" : ""
                                    } / empty well${manual ? ", manually edited" : ""}`
                                  : `${well.wellId}，样本 ${well.sample}，基因 ${
                                      well.gene
                                    }，${
                                      well.geneType === "reference"
                                        ? "内参基因"
                                        : "目的基因"
                                    }，第 ${well.replicateIndex} 个复孔${
                                      manual ? "，手动修改" : ""
                                    } / sample ${well.sample}, assay ${well.gene}, ${
                                      well.geneType === "reference"
                                        ? "reference"
                                        : "target"
                                    }, replicate ${well.replicateIndex}${
                                      manual ? ", manually edited" : ""
                                    }`;
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
                                  disabled={
                                    reserved ||
                                    activePlateConfirmed ||
                                    settingsStale
                                  }
                                  onClick={() =>
                                    openEditor(
                                      activePlateIndex,
                                      activePlate,
                                      well,
                                    )
                                  }
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
                                          plateType === 384 ? 4 : 7,
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
                      activeInvalid ? "invalid" : ""
                    }`}
                    role="status"
                  >
                    {activeInvalid ? (
                      <AlertTriangle size={15} />
                    ) : (
                      <Check size={15} />
                    )}
                    <div>
                      {settingsStale ? (
                        <strong>
                          实验设置已变更，请重新生成布局。 / Settings changed;
                          regenerate the layout.
                        </strong>
                      ) : activeIssues.length > 0 ? (
                        <>
                          <strong>
                            本板有 {activeIssues.length} 项需要修复，确认与导出已暂停。 /
                            {activeIssues.length} issue(s) must be fixed before
                            confirmation or export.
                          </strong>
                          <ul className="validation-list">
                            {activeIssues.slice(0, 3).map((issue, index) => (
                              <li key={`${issue.code}-${index}`}>
                                {issue.message}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <strong>
                          每板内参完整，跨板样本已重做全部内参，复孔横向连续。 /
                          References complete on every plate; replicates are
                          contiguous.
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
                  <strong>方法边界 / Method boundary</strong>
                  排板在可行候选中比较板数、跨板内参重做、引物批次和板内切换；反应用量按实际占用孔计算。本工具不自动添加
                  NTC、no-RT、阳性模板或板间校准样本，请按试剂说明书与本地 SOP
                  核对。 / Feasible layouts are ranked by plate count,
                  reference reruns, assay batching, and within-plate switches.
                  Reagent totals use occupied wells. NTC, no-RT, positive
                  template controls, and inter-plate calibrators are not added
                  automatically.
                </div>
              </div>
            </>
          )}

          <div className="footer-note">
            <span>
              仅供科研使用（RUO）· Research use only · 请核对本地 SOP
            </span>
            <span>
              浏览器本地处理 / Local browser processing · 不上传样本名称 /
              Sample names are not uploaded
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
                  编辑复孔组 / Edit replicate block{" "}
                  {blockLabel(editor.row, editor.startColumn, replicates)}
                </h2>
                <p className="modal-description">
                  修改应用到本组 {replicates} 个横向连续孔，并标记为手动编辑。 /
                  Changes apply to the full contiguous block.
                </p>
              </div>
              <button
                className="icon-button modal-close"
                type="button"
                onClick={() => setEditor(null)}
                aria-label="关闭编辑 / Close editor"
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-form">
              <div className="field">
                <span className="field-label">
                  孔位状态 / Well status
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
                    检测孔 / Assay
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
                    空孔 / Empty
                  </button>
                </div>
              </div>
              {editor.mode === "assay" && (
                <>
                  <label className="field">
                    <span className="field-label">样本 / Sample</span>
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
                        <option value={sample} key={sample}>
                          {sample}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">基因 / Assay</span>
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
                            ? "内参 / Reference"
                            : "目的 / Target"}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <div className="notice">
                <Layers3 size={15} />
                  <span>
                  手动修改可以保存为草稿。若造成跨板样本缺少内参、反应重复或遗漏，系统会暂停确认与导出，直到修复。 /
                  Manual edits can be saved as a draft; confirmation and
                  export pause until missing references, duplicates, or
                  omissions are fixed.
                  </span>
              </div>
            </div>
            <div className="modal-actions">
              {editor.mode === "empty" && (
                <button
                  className="button button-danger"
                  type="button"
                  onClick={applyManualEdit}
                >
                  <Trash2 size={14} />
                  清空整组 / Clear block
                </button>
              )}
              <button
                className="button button-quiet"
                type="button"
                onClick={() => setEditor(null)}
              >
                取消 / Cancel
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={applyManualEdit}
              >
                应用修改 / Apply
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
