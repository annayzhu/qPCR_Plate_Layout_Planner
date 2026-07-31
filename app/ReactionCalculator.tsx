"use client";

import {
  AlertTriangle,
  Calculator,
  Droplets,
  Info,
} from "lucide-react";
import {
  calculateReactionRequirements,
  type ReactionSystemInput,
} from "@/lib/reactionCalculator";
import type {
  GeneType,
  PlanResult,
} from "@/lib/platePlanner";

interface ReactionCalculatorProps {
  layout: PlanResult;
  samples: string[];
  genes: Array<{ name: string; role: GeneType }>;
  value: ReactionSystemInput;
  onChange: (value: ReactionSystemInput) => void;
}

const REAGENT_LABELS = {
  masterMix: "SYBR Green 反应预混液 / Master mix",
  forwardPrimer: "上游引物 / Forward primer",
  reversePrimer: "下游引物 / Reverse primer",
  cdna: "cDNA 模板 / cDNA template",
  water: "RNase-free ddH₂O / Nuclease-free water",
} as const;

function formatVolume(value: number) {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0.00";
  if (Math.abs(value) < 0.01) return value.toFixed(3);
  return value.toFixed(2);
}

export function ReactionCalculator({
  layout,
  samples,
  genes,
  value,
  onChange,
}: ReactionCalculatorProps) {
  const calculation = calculateReactionRequirements(
    layout,
    value,
    samples,
    genes,
  );

  function update(
    key: keyof ReactionSystemInput,
    nextValue: number,
  ) {
    onChange({ ...value, [key]: nextValue });
  }

  return (
    <aside
      className="reaction-calculator"
      aria-label="反应体系与用量计算 / Reaction setup and requirements"
    >
      <div className="reaction-heading">
        <div>
          <p className="eyebrow">
            <Calculator size={13} />
            反应用量计算 / REACTION CALCULATOR
          </p>
          <h2>反应体系与用量</h2>
          <p>Reaction setup & reagent requirements</p>
        </div>
        <span className="reaction-well-count">
          {calculation.totalWells} 孔 / wells
        </span>
      </div>

      <div className="reaction-input-grid">
        <label className="field">
          <span className="field-label">cDNA / 孔 / well · µL</span>
          <input
            className="input numeric-input"
            type="number"
            min="0"
            step="0.1"
            value={value.cdnaPerWellUl}
            onChange={(event) =>
              update("cdnaPerWellUl", Number(event.target.value))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">
            上下游引物合计 / Primer pair per well · µL
          </span>
          <input
            className="input numeric-input"
            type="number"
            min="0"
            step="0.1"
            value={value.primerPairPerWellUl}
            onChange={(event) =>
              update("primerPairPerWellUl", Number(event.target.value))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">
            反应预混液 / Master mix per well · µL
          </span>
          <input
            className="input numeric-input"
            type="number"
            min="0"
            step="0.1"
            value={value.masterMixPerWellUl}
            onChange={(event) =>
              update("masterMixPerWellUl", Number(event.target.value))
            }
          />
        </label>
        <label className="field">
          <span className="field-label">
            反应总体积 / Total per well · µL
          </span>
          <input
            className="input numeric-input"
            type="number"
            min="0.1"
            step="0.1"
            value={value.totalPerWellUl}
            onChange={(event) =>
              update("totalPerWellUl", Number(event.target.value))
            }
          />
        </label>
        <label className="field reaction-overage-field">
          <span className="field-label">
            配液余量 / Pipetting overage · %
          </span>
          <input
            className="input numeric-input"
            type="number"
            min="0"
            max="50"
            step="1"
            value={value.overagePercent}
            onChange={(event) =>
              update("overagePercent", Number(event.target.value))
            }
          />
        </label>
      </div>

      <div className="reaction-note">
        <Info size={14} />
        <span>
          上、下游引物默认按等体积分配。推荐准备量含{" "}
          {value.overagePercent}% 移液余量。
          <br />
          Forward and reverse primers are split 1:1 by volume.
        </span>
      </div>

      {calculation.errors.map((message) => (
        <div className="notice notice-error compact-notice" key={message}>
          <AlertTriangle size={14} />
          <span>{message}</span>
        </div>
      ))}

      <section className="reaction-section">
        <div className="reaction-section-title">
          <h3>每孔反应体系 / Per-well reaction</h3>
          <strong className={calculation.valid ? "" : "danger-text"}>
            {formatVolume(value.totalPerWellUl)} µL
          </strong>
        </div>
        <div className="reaction-table-wrap">
          <table className="reaction-table">
            <thead>
              <tr>
                <th>组分 / Component</th>
                <th>µL / well</th>
              </tr>
            </thead>
            <tbody>
              {calculation.perWellRows.map((row) => (
                <tr key={row.key}>
                  <td>{REAGENT_LABELS[row.key]}</td>
                  <td>{formatVolume(row.volumeUl)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>总体积 / Total</td>
                <td>{formatVolume(value.totalPerWellUl)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {calculation.valid && (
        <>
          <section className="reaction-section">
            <h3>总量摘要 / Total requirements</h3>
            <div className="reagent-summary-grid">
              <div>
                <span>建议预混液 / Master mix to prepare</span>
                <strong>
                  {formatVolume(calculation.totals.masterMixUl)} µL
                </strong>
              </div>
              <div>
                <span>建议引物合计 / Primers to prepare</span>
                <strong>
                  {formatVolume(calculation.totals.primerPairUl)} µL
                </strong>
              </div>
              <div>
                <span>建议 cDNA 合计 / cDNA to prepare</span>
                <strong>{formatVolume(calculation.totals.cdnaUl)} µL</strong>
              </div>
              <div>
                <span>建议用水合计 / Water to prepare</span>
                <strong>{formatVolume(calculation.totals.waterUl)} µL</strong>
              </div>
            </div>
            <p className="reaction-total-line">
              理论反应总体积 / Theoretical total:{" "}
              <strong>
                {formatVolume(calculation.totals.theoreticalReactionUl)} µL
              </strong>
              <br />
              含余量准备 / Prepare with overage:{" "}
              <strong>
                {formatVolume(calculation.totals.recommendedReactionUl)} µL
              </strong>
            </p>
          </section>

          <details className="reaction-details" open>
            <summary>
              各基因配液 / Mix by assay ({calculation.geneRequirements.length})
            </summary>
            <div className="reaction-table-wrap">
              <table className="reaction-table requirement-table">
                <thead>
                  <tr>
                    <th>基因 / Assay</th>
                    <th>孔数 / Wells</th>
                    <th>上游 / F primer</th>
                    <th>下游 / R primer</th>
                    <th>预混液 / Mix</th>
                    <th>用水 / Water</th>
                    <th>配液* / Assay mix*</th>
                  </tr>
                </thead>
                <tbody>
                  {calculation.geneRequirements.map((requirement) => (
                    <tr key={requirement.gene}>
                      <td>
                        {requirement.gene}
                        {requirement.geneType === "reference" && (
                          <span className="reference-tag">REF</span>
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
            <p className="table-footnote">
              * 每个基因的推荐配液量，不含后加的 cDNA；已包含余量。 /
              Mix per assay excludes separately added cDNA and includes
              overage.
            </p>
          </details>

          <details className="reaction-details">
            <summary>
              各样本 cDNA / cDNA by sample (
              {calculation.sampleRequirements.length})
            </summary>
            <div className="reaction-table-wrap">
              <table className="reaction-table">
                <thead>
                  <tr>
                    <th>样本 / Sample</th>
                    <th>孔数 / Wells</th>
                    <th>理论 / Required µL</th>
                    <th>建议准备 / Prepare µL</th>
                  </tr>
                </thead>
                <tbody>
                  {calculation.sampleRequirements.map((requirement) => (
                    <tr key={requirement.sample}>
                      <td>{requirement.sample}</td>
                      <td>{requirement.wellCount}</td>
                      <td>
                        {formatVolume(requirement.theoreticalCdnaUl)}
                      </td>
                      <td>
                        {formatVolume(requirement.recommendedCdnaUl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <div className="reaction-qc">
        <Droplets size={15} />
        <div>
          <strong>常规核查 / Routine check</strong>
          {calculation.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <p>
            [本地适配 / Local example] 初始值为 10 µL 体系、5 µL
            预混液、上下游引物各 0.4 µL、cDNA 1 µL 和 10% 余量；不是任何品牌试剂的固定处方。 /
            Defaults: 10 µL total, 5 µL master mix, 0.4 µL of each primer,
            1 µL cDNA, and 10% overage. This is not a brand-specific recipe.
          </p>
          <p>
            [来源核查 / Current references]{" "}
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
