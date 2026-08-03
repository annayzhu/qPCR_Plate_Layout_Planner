"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Calculator,
  Droplets,
  Info,
} from "lucide-react";
import {
  calculateEightStripGeneMixRequirements,
  calculateReactionRequirements,
  type GeneMixPreparationMode,
  type ReactionSystemInput,
} from "@/lib/reactionCalculator";
import type {
  GeneType,
  PlanResult,
} from "@/lib/platePlanner";

type Language = "zh" | "en";

interface ReactionSample {
  name: string;
  kind?: "sample" | "blank";
}

interface ReactionCalculatorProps {
  layout: PlanResult;
  samples: Array<string | ReactionSample>;
  genes: Array<{ name: string; role: GeneType }>;
  value: ReactionSystemInput;
  onChange: (value: ReactionSystemInput) => void;
  language?: Language;
  blankSampleNames?: string[];
}

interface NumericFieldProps {
  label: string;
  value: number;
  min: number;
  max?: number;
  step: number;
  onCommit: (value: number) => void;
}

type NumericReactionSystemKey = {
  [Key in keyof ReactionSystemInput]: ReactionSystemInput[Key] extends number
    ? Key
    : never;
}[keyof ReactionSystemInput];

const COPY = {
  zh: {
    ariaLabel: "反应体系与用量计算",
    title: "反应体系与用量",
    wells: (count: number) => `${count} 孔`,
    cdnaInput: "每孔 cDNA · µL",
    forwardPrimerInput: "每孔上游引物 · µL",
    reversePrimerInput: "每孔下游引物 · µL",
    primerStockInput: "引物液浓度（实际移取）· µM",
    primerFinalPreview: "每条引物终浓度",
    masterMixInput: "每孔反应预混液 · µL",
    totalInput: "每孔反应总体积 · µL",
    overageInput: "配液余量 · %",
    splitNote: (overage: number) =>
      `上、下游引物体积分别填写；建议准备量已包含 ${overage}% 移液余量。`,
    primerStockNote:
      "当前假设上、下游引物液浓度相同。请填写实际移入反应孔的浓度；若先将 100 µM 原始储备液稀释为 10 µM 工作液，应填写 10 µM。",
    geneMixMode: "384 孔基因反应混合液",
    geneMixSingle: "单管准备",
    geneMixEightStrip: "A–H 八连排分装",
    geneMixEightStripMeta: "选择单管或按通道实际孔数分装",
    eightStripDetails: (count: number) =>
      `八连排 gene mix 分装（${count}）`,
    plate: "孔板",
    transferCycles: "排枪加液次数",
    mixTotal: "混合液合计",
    channelVolume: (channel: string) => `${channel} 管 · µL`,
    eightStripFootnote:
      "A–H 每管均为同一基因的反应混合液（预混液 + 上/下游引物 + 基础用水，不含 cDNA）；体积已含配液余量。A–H 通道先对应 A/C/E/G/I/K/M/O，再对应 B/D/F/H/J/L/N/P。Blank 的 cDNA 替代水需另行加入，不应混入共用 gene mix。",
    blankNote: "Blank 孔不加入 cDNA，以等体积 RNase-free ddH₂O 补足。",
    perWellTitle: "每孔反应体系",
    component: "组分",
    perWellVolume: "µL / 孔",
    finalConcentration: "终浓度 · nM",
    total: "总体积",
    reagentLabels: {
      masterMix: "SYBR Green 反应预混液",
      forwardPrimer: "上游引物",
      reversePrimer: "下游引物",
      cdna: "cDNA 模板",
      water: "RNase-free ddH₂O",
    },
    totalsTitle: "反应用量总览",
    masterMixTotal: "需准备的预混液总量",
    forwardPrimerTotal: "需准备的上游引物",
    reversePrimerTotal: "需准备的下游引物",
    cdnaTotal: "需准备的 cDNA 合计",
    waterTotal: "需准备的水合计",
    theoreticalTotal: "理论反应总体积",
    preparedTotal: "含余量准备体积",
    geneDetails: (count: number) => `各基因配液（${count}）`,
    gene: "基因",
    wellsHeader: "孔数",
    forwardPrimer: "上游引物",
    reversePrimer: "下游引物",
    masterMix: "预混液",
    water: "水",
    assayMix: "配液*",
    assayFootnote:
      "* 各基因的推荐配液量不含后加的 cDNA，已包含配液余量；Blank 孔以等体积水替代 cDNA。",
    sampleDetails: (count: number) => `各样本 cDNA（${count}）`,
    sample: "样本",
    theoreticalCdna: "理论 cDNA · µL",
    preparedCdna: "建议准备 · µL",
    replacementWater: "Blank 补水 · µL",
    blank: "空白",
    routineCheck: "常规核查",
    primerCheck: (stock: string, forward: string, reverse: string) =>
      `上、下游引物液浓度均为 ${stock} µM；按各自输入体积计算，当前终浓度分别为 ${forward} nM 和 ${reverse} nM。是否适用仍需结合试剂说明书和引物优化结果判断。`,
    cdnaBoundary:
      "未输入 cDNA 浓度和逆转录稀释倍数，因此不能换算原始 RNA 或组织样本量。",
    defaults:
      "初始值为 10 µL 体系、5 µL 预混液、10 µM 引物液、上下游引物各 0.2 µL（每条终浓度 200 nM）、cDNA 1 µL 和 12% 余量；其他体系请参考试剂说明书。请另行预留 NTC、no-RT 等控制孔，并核查单一熔解峰、扩增效率及内参稳定性；控制孔未自动计入当前用量。",
    sources: "来源核查：",
    reference: "内参",
  },
  en: {
    ariaLabel: "Reaction setup and reagent requirements",
    title: "Reaction setup & requirements",
    wells: (count: number) => `${count} wells`,
    cdnaInput: "cDNA per well · µL",
    forwardPrimerInput: "Forward primer per well · µL",
    reversePrimerInput: "Reverse primer per well · µL",
    primerStockInput: "Primer solution used · µM",
    primerFinalPreview: "Final concentration per primer",
    masterMixInput: "Master mix per well · µL",
    totalInput: "Total volume per well · µL",
    overageInput: "Pipetting overage · %",
    splitNote: (overage: number) =>
      `Forward and reverse primer volumes are entered separately. Preparation amounts include ${overage}% pipetting overage.`,
    primerStockNote:
      "The forward and reverse primer solutions are assumed to have the same concentration. Enter the concentration actually pipetted into the reaction; if a 100 µM master stock is first diluted to 10 µM, enter 10 µM.",
    geneMixMode: "384-well assay-mix preparation",
    geneMixSingle: "Single-tube preparation",
    geneMixEightStrip: "A–H 8-tube strip aliquots",
    geneMixEightStripMeta: "Choose one tube or aliquot by actual channel wells",
    eightStripDetails: (count: number) =>
      `8-channel gene-mix aliquots (${count})`,
    plate: "Plate",
    transferCycles: "Multichannel dispenses",
    mixTotal: "Assay-mix total",
    channelVolume: (channel: string) => `Tube ${channel} · µL`,
    eightStripFootnote:
      "Each A–H tube contains the same gene-specific assay mix (master mix + forward/reverse primers + base water, excluding cDNA), with pipetting overage included. Channels A–H first map to A/C/E/G/I/K/M/O, then to B/D/F/H/J/L/N/P. Add cDNA-replacement water for Blank wells separately; do not include it in the shared gene mix.",
    blankNote:
      "Blank wells receive no cDNA; the same volume is replaced with RNase-free water.",
    perWellTitle: "Per-well reaction",
    component: "Component",
    perWellVolume: "µL / well",
    finalConcentration: "Final concentration · nM",
    total: "Total volume",
    reagentLabels: {
      masterMix: "SYBR Green master mix",
      forwardPrimer: "Forward primer",
      reversePrimer: "Reverse primer",
      cdna: "cDNA template",
      water: "RNase-free water",
    },
    totalsTitle: "Total requirements",
    masterMixTotal: "Master mix to prepare",
    forwardPrimerTotal: "Forward primer to prepare",
    reversePrimerTotal: "Reverse primer to prepare",
    cdnaTotal: "cDNA to prepare",
    waterTotal: "Water to prepare",
    theoreticalTotal: "Theoretical reaction volume",
    preparedTotal: "Volume to prepare with overage",
    geneDetails: (count: number) => `Mix by assay (${count})`,
    gene: "Assay",
    wellsHeader: "Wells",
    forwardPrimer: "Forward primer",
    reversePrimer: "Reverse primer",
    masterMix: "Master mix",
    water: "Water",
    assayMix: "Assay mix*",
    assayFootnote:
      "* Recommended assay-mix volumes exclude cDNA added separately and include pipetting overage. For Blank wells, water replaces the cDNA volume.",
    sampleDetails: (count: number) => `cDNA by sample (${count})`,
    sample: "Sample",
    theoreticalCdna: "Required cDNA · µL",
    preparedCdna: "Prepare · µL",
    replacementWater: "Blank water · µL",
    blank: "Blank",
    routineCheck: "Routine check",
    primerCheck: (stock: string, forward: string, reverse: string) =>
      `Both primer solutions are ${stock} µM. Using their separately entered volumes, the current forward and reverse final concentrations are ${forward} nM and ${reverse} nM. Confirm suitability against the reagent instructions and assay optimization.`,
    cdnaBoundary:
      "cDNA concentration and reverse-transcription dilution factor were not entered, so the result cannot be converted to the amount of starting RNA or tissue.",
    defaults:
      "Defaults are a 10 µL reaction, 5 µL master mix, 10 µM primer solutions, 0.2 µL each forward and reverse primer (200 nM final each), 1 µL cDNA, and 12% overage. For other reaction setups, consult the reagent instructions. Reserve NTC and no-RT control wells separately, and verify a single melt peak, amplification efficiency, and reference-gene stability; control wells are not included automatically.",
    sources: "Sources checked:",
    reference: "Reference",
  },
} as const;

function formatVolume(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0.00";
  if (Math.abs(value) < 0.01) return value.toFixed(3);
  return value.toFixed(2);
}

function formatConcentrationNm(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatEditableNumber(value: number) {
  return Number.isFinite(value) ? String(value) : "";
}

function localizeMessage(message: string, language: Language) {
  const separatorIndex = message.lastIndexOf(" / ");
  if (separatorIndex === -1) return message;

  const labelCopies = [
    [
      "上游引物体积 / forward-primer volume",
      "上游引物体积",
      "Forward-primer volume",
    ],
    [
      "下游引物体积 / reverse-primer volume",
      "下游引物体积",
      "Reverse-primer volume",
    ],
    [
      "引物液浓度 / primer stock concentration",
      "引物液浓度",
      "Primer solution concentration",
    ],
    ["反应预混液 / master mix", "反应预混液", "Master-mix volume"],
    ["反应总体积 / total reaction volume", "反应总体积", "Total reaction volume"],
    ["配液余量 / pipetting overage", "配液余量", "Pipetting overage"],
    ["cDNA", "cDNA", "cDNA volume"],
  ] as const;
  const chineseMessage = message.slice(0, separatorIndex);
  const englishMessage = message.slice(separatorIndex + 3);
  const matchedLabel = labelCopies.find(([source]) =>
    chineseMessage.startsWith(source),
  );

  if (language === "zh") {
    if (!matchedLabel) return chineseMessage;
    return chineseMessage.replace(matchedLabel[0], matchedLabel[1]);
  }

  if (matchedLabel && englishMessage.startsWith("Must be")) {
    return `${matchedLabel[2]} ${englishMessage.charAt(0).toLowerCase()}${englishMessage.slice(1)}`;
  }
  return englishMessage;
}

function NumericField({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: NumericFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shownValue = draft ?? formatEditableNumber(value);

  function commit(rawValue: string) {
    const trimmed = rawValue.trim();
    if (trimmed === "") {
      setDraft(null);
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(null);
      return;
    }

    const normalized = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, parsed));
    onCommit(normalized);
    setDraft(null);
  }

  return (
    <label className="field reaction-numeric-field">
      <span className="field-label">{label}</span>
      <input
        className="input numeric-input reaction-numeric-input"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={shownValue}
        onFocus={() => setDraft(formatEditableNumber(value))}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function ReactionCalculator({
  layout,
  samples,
  genes,
  value,
  onChange,
  language = "zh",
  blankSampleNames = [],
}: ReactionCalculatorProps) {
  const copy = COPY[language];
  const normalizedSamples = samples.map((sample) =>
    typeof sample === "string"
      ? { name: sample, kind: "sample" as const }
      : sample,
  );
  const sampleNames = normalizedSamples.map((sample) => sample.name);
  const blankNames = Array.from(
    new Set([
      ...blankSampleNames,
      ...normalizedSamples
        .filter((sample) => sample.kind === "blank")
        .map((sample) => sample.name),
    ]),
  );
  const blankNameSet = new Set(blankNames);
  const calculation = calculateReactionRequirements(
    layout,
    value,
    sampleNames,
    genes,
    blankNames,
  );
  const isInterleaved384 =
    layout.loadingPattern === "interleaved-8-channel" &&
    layout.plates.some((plate) => plate.rows === 16);
  const eightStripRequirements = calculateEightStripGeneMixRequirements(
    layout.plates,
    layout.loadingPattern,
    value,
    blankNames,
  );
  const dynamicWarnings = calculation.warnings;

  function update(
    key: NumericReactionSystemKey,
    nextValue: number,
  ) {
    onChange({ ...value, [key]: nextValue });
  }

  function updateGeneMixMode(nextMode: GeneMixPreparationMode) {
    onChange({ ...value, geneMixPreparationMode: nextMode });
  }

  return (
    <aside
      className="reaction-calculator"
      aria-label={copy.ariaLabel}
    >
      <div className="reaction-heading">
        <h2 className="reaction-heading-title">
          <Calculator size={16} aria-hidden="true" />
          {copy.title}
        </h2>
        <span className="reaction-well-count">
          {copy.wells(calculation.totalWells)}
        </span>
      </div>

      <div className="reaction-input-primary">
        <NumericField
          label={copy.cdnaInput}
          min={0}
          step={0.1}
          value={value.cdnaPerWellUl}
          onCommit={(nextValue) => update("cdnaPerWellUl", nextValue)}
        />
        <NumericField
          label={copy.masterMixInput}
          min={0}
          step={0.1}
          value={value.masterMixPerWellUl}
          onCommit={(nextValue) => update("masterMixPerWellUl", nextValue)}
        />
        <NumericField
          label={copy.forwardPrimerInput}
          min={0}
          step={0.1}
          value={value.forwardPrimerPerWellUl}
          onCommit={(nextValue) =>
            update("forwardPrimerPerWellUl", nextValue)
          }
        />
        <NumericField
          label={copy.reversePrimerInput}
          min={0}
          step={0.1}
          value={value.reversePrimerPerWellUl}
          onCommit={(nextValue) =>
            update("reversePrimerPerWellUl", nextValue)
          }
        />
      </div>

      <div className="reaction-input-secondary">
        <NumericField
          label={copy.totalInput}
          min={0.1}
          step={0.1}
          value={value.totalPerWellUl}
          onCommit={(nextValue) => update("totalPerWellUl", nextValue)}
        />
        <NumericField
          label={copy.overageInput}
          min={0}
          max={50}
          step={1}
          value={value.overagePercent}
          onCommit={(nextValue) => update("overagePercent", nextValue)}
        />
        <div className="reaction-primer-setting">
          <NumericField
            label={copy.primerStockInput}
            min={0.1}
            step={0.1}
            value={value.primerStockConcentrationUm}
            onCommit={(nextValue) =>
              update("primerStockConcentrationUm", nextValue)
            }
          />
          <div className="primer-final-preview" aria-live="polite">
            <span>{copy.primerFinalPreview}</span>
            <div className="primer-final-values">
              <strong>
                <span>F</span>
                {formatConcentrationNm(
                  calculation.forwardPrimerFinalConcentrationNm,
                )}{" "}
                nM
              </strong>
              <strong>
                <span>R</span>
                {formatConcentrationNm(
                  calculation.reversePrimerFinalConcentrationNm,
                )}{" "}
                nM
              </strong>
            </div>
          </div>
        </div>
      </div>

      {isInterleaved384 && (
        <div className="gene-mix-mode">
          <div className="gene-mix-mode-heading">
            <span>{copy.geneMixMode}</span>
            <small>{copy.geneMixEightStripMeta}</small>
          </div>
          <div className="gene-mix-mode-options" role="radiogroup">
            {(
              [
                ["single-tube", copy.geneMixSingle],
                ["eight-strip", copy.geneMixEightStrip],
              ] as const
            ).map(([mode, label]) => (
              <button
                className={
                  value.geneMixPreparationMode === mode ? "selected" : ""
                }
                key={mode}
                type="button"
                role="radio"
                aria-checked={value.geneMixPreparationMode === mode}
                onClick={() => updateGeneMixMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="reaction-note">
        <Info size={14} aria-hidden="true" />
        <span>
          {copy.splitNote(value.overagePercent)}
          <br />
          {copy.primerStockNote}
          {blankNames.length > 0 && (
            <>
              <br />
              {copy.blankNote}
            </>
          )}
        </span>
      </div>

      {(calculation.errors.length > 0 || dynamicWarnings.length > 0) && (
        <div className="reaction-alert-stack" aria-live="polite">
          {calculation.errors.map((message) => (
            <div
              className="notice notice-error compact-notice"
              key={message}
            >
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{localizeMessage(message, language)}</span>
            </div>
          ))}
          {dynamicWarnings.map((message) => (
            <div
              className="notice notice-warning compact-notice"
              key={message}
            >
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{localizeMessage(message, language)}</span>
            </div>
          ))}
        </div>
      )}

      <section className="reaction-section">
        <div className="reaction-section-title">
          <h3>{copy.perWellTitle}</h3>
          <strong className={calculation.valid ? "" : "danger-text"}>
            {formatVolume(value.totalPerWellUl)} µL
          </strong>
        </div>
        <div className="reaction-table-wrap">
          <table className="reaction-table">
            <thead>
              <tr>
                <th>{copy.component}</th>
                <th>{copy.perWellVolume}</th>
                <th>{copy.finalConcentration}</th>
              </tr>
            </thead>
            <tbody>
              {calculation.perWellRows.map((row) => (
                <tr key={row.key}>
                  <td>{copy.reagentLabels[row.key]}</td>
                  <td>{formatVolume(row.volumeUl)}</td>
                  <td>
                    {row.key === "forwardPrimer"
                      ? formatConcentrationNm(
                          calculation.forwardPrimerFinalConcentrationNm,
                        )
                      : row.key === "reversePrimer"
                        ? formatConcentrationNm(
                            calculation.reversePrimerFinalConcentrationNm,
                          )
                        : "—"}
                  </td>
                </tr>
              ))}
              <tr className="total-row">
                <td>{copy.total}</td>
                <td>{formatVolume(value.totalPerWellUl)}</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {calculation.valid && (
        <>
          <section className="reaction-section">
            <h3>{copy.totalsTitle}</h3>
            <div className="reagent-summary-grid">
              <div>
                <span>{copy.masterMixTotal}</span>
                <strong>
                  {formatVolume(calculation.totals.masterMixUl)} µL
                </strong>
              </div>
              <div>
                <span>{copy.forwardPrimerTotal}</span>
                <strong>
                  {formatVolume(calculation.totals.forwardPrimerUl)} µL
                </strong>
              </div>
              <div>
                <span>{copy.reversePrimerTotal}</span>
                <strong>
                  {formatVolume(calculation.totals.reversePrimerUl)} µL
                </strong>
              </div>
              <div>
                <span>{copy.cdnaTotal}</span>
                <strong>{formatVolume(calculation.totals.cdnaUl)} µL</strong>
              </div>
              <div>
                <span>{copy.waterTotal}</span>
                <strong>{formatVolume(calculation.totals.waterUl)} µL</strong>
              </div>
            </div>
            <p className="reaction-total-line">
              {copy.theoreticalTotal}:{" "}
              <strong>
                {formatVolume(calculation.totals.theoreticalReactionUl)} µL
              </strong>
              <br />
              {copy.preparedTotal}:{" "}
              <strong>
                {formatVolume(calculation.totals.recommendedReactionUl)} µL
              </strong>
            </p>
          </section>

          <details className="reaction-details" open>
            <summary>
              {copy.geneDetails(calculation.geneRequirements.length)}
            </summary>
            <div className="reaction-table-wrap">
              <table className="reaction-table requirement-table">
                <thead>
                  <tr>
                    <th>{copy.gene}</th>
                    <th>{copy.wellsHeader}</th>
                    <th>{copy.forwardPrimer}</th>
                    <th>{copy.reversePrimer}</th>
                    <th>{copy.masterMix}</th>
                    <th>{copy.water}</th>
                    <th>{copy.assayMix}</th>
                  </tr>
                </thead>
                <tbody>
                  {calculation.geneRequirements.map((requirement) => (
                    <tr key={requirement.gene}>
                      <td>
                        {requirement.gene}
                        {requirement.geneType === "reference" && (
                          <span className="reaction-reference-tag">
                            {copy.reference}
                          </span>
                        )}
                      </td>
                      <td>{requirement.wellCount}</td>
                      <td>{formatVolume(requirement.forwardPrimerUl)}</td>
                      <td>{formatVolume(requirement.reversePrimerUl)}</td>
                      <td>{formatVolume(requirement.masterMixUl)}</td>
                      <td>{formatVolume(requirement.waterUl)}</td>
                      <td>{formatVolume(requirement.mixExcludingCdnaUl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="reaction-table-footnote">
              {copy.assayFootnote}
            </p>
          </details>

          {eightStripRequirements.length > 0 && (
            <details className="reaction-details" open>
              <summary>
                {copy.eightStripDetails(eightStripRequirements.length)}
              </summary>
              <div className="reaction-table-wrap">
                <table className="reaction-table requirement-table eight-strip-table">
                  <thead>
                    <tr>
                      <th>{copy.plate}</th>
                      <th>{copy.gene}</th>
                      <th>{copy.transferCycles}</th>
                      {Array.from({ length: 8 }, (_, index) =>
                        String.fromCharCode(65 + index),
                      ).map((channel) => (
                        <th key={channel}>{copy.channelVolume(channel)}</th>
                      ))}
                      <th>{copy.mixTotal}</th>
                      <th>{copy.replacementWater}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eightStripRequirements.map((requirement) => (
                      <tr
                        key={`${requirement.plateNumber}-${requirement.gene}`}
                      >
                        <td>{requirement.plateName}</td>
                        <td>
                          {requirement.gene}
                          {requirement.geneType === "reference" && (
                            <span className="reaction-reference-tag">
                              {copy.reference}
                            </span>
                          )}
                        </td>
                        <td>{requirement.transferCycles}</td>
                        {requirement.channels.map((channel) => (
                          <td
                            key={channel.channel}
                            title={`${channel.destinationRows} · P1 ${channel.pass1WellCount} + P2 ${channel.pass2WellCount}`}
                          >
                            {channel.wellCount > 0
                              ? formatVolume(channel.assayMixUl)
                              : "—"}
                          </td>
                        ))}
                        <td>{formatVolume(requirement.totalAssayMixUl)}</td>
                        <td>
                          {formatVolume(
                            requirement.blankReplacementWaterUl,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="reaction-table-footnote">
                {copy.eightStripFootnote}
              </p>
            </details>
          )}

          <details className="reaction-details">
            <summary>
              {copy.sampleDetails(calculation.sampleRequirements.length)}
            </summary>
            <div className="reaction-table-wrap">
              <table className="reaction-table reaction-sample-table">
                <thead>
                  <tr>
                    <th>{copy.sample}</th>
                    <th>{copy.wellsHeader}</th>
                    <th>{copy.theoreticalCdna}</th>
                    <th>{copy.preparedCdna}</th>
                    <th>{copy.replacementWater}</th>
                  </tr>
                </thead>
                <tbody>
                  {calculation.sampleRequirements.map((requirement) => {
                    const isBlank =
                      requirement.isBlank ||
                      blankNameSet.has(requirement.sample);
                    return (
                      <tr
                        className={isBlank ? "reaction-blank-row" : undefined}
                        key={requirement.sample}
                      >
                        <td>
                          {requirement.sample}
                          {isBlank && (
                            <span className="reaction-blank-tag">
                              {copy.blank}
                            </span>
                          )}
                        </td>
                        <td>{requirement.wellCount}</td>
                        <td>
                          {formatVolume(
                            isBlank ? 0 : requirement.theoreticalCdnaUl,
                          )}
                        </td>
                        <td>
                          {formatVolume(
                            isBlank ? 0 : requirement.recommendedCdnaUl,
                          )}
                        </td>
                        <td>
                          {formatVolume(
                            isBlank
                              ? requirement.replacementWaterUl
                              : 0,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <div className="reaction-qc">
        <Droplets size={15} aria-hidden="true" />
        <div>
          <strong>{copy.routineCheck}</strong>
          <p>
            {copy.primerCheck(
              formatEditableNumber(value.primerStockConcentrationUm),
              formatConcentrationNm(
                calculation.forwardPrimerFinalConcentrationNm,
              ),
              formatConcentrationNm(
                calculation.reversePrimerFinalConcentrationNm,
              ),
            )}
          </p>
          <p>{copy.cdnaBoundary}</p>
          <p>{copy.defaults}</p>
          <p>
            {copy.sources}{" "}
            <a
              href="https://www.thermofisher.com/TFS-Assets/LSG/manuals/MAN0013511_PowerUp_mastermix_UG.pdf"
              target="_blank"
              rel="noreferrer"
            >
              Thermo Fisher PowerUp
            </a>{" "}
            ·{" "}
            <a
              href="https://www.bio-rad.com/webroot/web/pdf/lsr/literature/10041157.pdf"
              target="_blank"
              rel="noreferrer"
            >
              Bio-Rad iTaq
            </a>
          </p>
        </div>
      </div>
    </aside>
  );
}
