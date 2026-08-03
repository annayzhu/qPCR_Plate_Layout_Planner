"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Download,
  FlaskConical,
  Grid3X3,
  Microscope,
  ShieldAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import rawData from "./analysis-data.json";
import styles from "./results.module.css";

type Status = "PASS" | "REVIEW" | "FAIL";

type ReplicateGroup = {
  sample: string;
  assay: string;
  wells: string[];
  detected: number;
  meanCp: number;
  cpSd: number;
  cpRange: number;
  meanTm: number;
  tmRange: number;
  meltGroups: string[];
  meanMeltScore: number;
  status: Status;
  issues: string[];
};

type RelativeExpression = {
  sample: string;
  assay: string;
  meanTargetCt: number;
  meanGapdhCt: number;
  meanTbpCt: number;
  meanRefCt: number;
  deltaCt: number;
  ddCtVsNcFam: number;
  relativeVsNcFam: number;
  apparentKnockdownVsNcFam: number;
  ddCtVsMock: number;
  relativeVsMock: number;
};

type CorrectedWell = {
  well: string;
  row: string;
  column: number;
  sample: string;
  assay: string;
  replicate: number;
  cp: number;
  tm1: number;
  tm2: number | null;
  meltGroup: string;
  meltScore: number;
  meltResolution: number;
  layoutChanged: boolean;
  originalSample: string;
  manualNote: string;
};

type AnalysisData = {
  experiment: string;
  generatedAt: string;
  counts: {
    exportedWells: number;
    activeWells: number;
    detectedCp: number;
    detectedTm: number;
    layoutChangedWells: number;
    replicateGroups: number;
    passGroups: number;
    reviewGroups: number;
    failGroups: number;
  };
  thresholds: {
    cpSdPass: number;
    cpSdFail: number;
    tmRangePass: number;
    expectedReplicates: number;
  };
  limitations: string[];
  manualNotes: { well: string; column: number; note: string }[];
  changedWells: {
    well: string;
    oldSample: string;
    newSample: string;
  }[];
  assaySummaries: {
    assay: string;
    wells: number;
    detected: number;
    cpMean: number;
    cpMedian: number;
    tmMean: number;
    tmMedian: number;
    tmMin: number;
    tmMax: number;
    meltGroupCounts: Record<string, number>;
  }[];
  referenceStability: {
    assay: string;
    sampleMeanCt: number;
    betweenSampleSd: number;
    min: number;
    max: number;
    range: number;
  }[];
  column10Effects: {
    sample: string;
    well: string;
    cp: number;
    otherReplicateMeanCp: number;
    deltaCp: number;
  }[];
  replicateGroups: ReplicateGroup[];
  relativeExpression: RelativeExpression[];
  correctedWells: CorrectedWell[];
};

const data = rawData as AnalysisData;
const rowNames = "ABCDEFGHIJKLMNOP".split("");
const columnNames = Array.from({ length: 24 }, (_, index) => index + 1);

const statusLabel: Record<Status, string> = {
  PASS: "通过",
  REVIEW: "复核",
  FAIL: "失败",
};

const statusDescription: Record<Status, string> = {
  PASS: "复孔与熔解筛查未见主要异常",
  REVIEW: "包含人工加样备注或轻度离散",
  FAIL: "复孔离散、峰型或聚类未通过筛查",
};

function formatNumber(value: number | null | undefined, digits = 2) {
  return value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : value.toFixed(digits);
}

function formatPercent(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || Number.isNaN(value)
    ? "—"
    : `${(value * 100).toFixed(digits)}%`;
}

function statusClass(status: Status) {
  if (status === "PASS") return styles.pass;
  if (status === "REVIEW") return styles.review;
  return styles.fail;
}

function assayShortName(assay: string) {
  return assay.replace("ZNF436", "ZNF");
}

function ResultBadge({ status }: { status: Status }) {
  return (
    <span className={`${styles.badge} ${statusClass(status)}`}>
      <span className={styles.badgeDot} />
      {statusLabel[status]}
    </span>
  );
}

export function QpcrResults() {
  const [selectedWell, setSelectedWell] = useState("A14");
  const [sampleFilter, setSampleFilter] = useState("全部样本");
  const [assayFilter, setAssayFilter] = useState("全部 Assay");
  const [statusFilter, setStatusFilter] = useState("全部状态");

  const groupByKey = useMemo(
    () =>
      new Map(
        data.replicateGroups.map((group) => [
          `${group.sample}|||${group.assay}`,
          group,
        ]),
      ),
    [],
  );
  const wellById = useMemo(
    () => new Map(data.correctedWells.map((well) => [well.well, well])),
    [],
  );
  const selected = wellById.get(selectedWell);
  const selectedGroup = selected
    ? groupByKey.get(`${selected.sample}|||${selected.assay}`)
    : undefined;

  const samples = useMemo(
    () => [...new Set(data.replicateGroups.map((group) => group.sample))],
    [],
  );
  const assays = useMemo(
    () => [...new Set(data.replicateGroups.map((group) => group.assay))],
    [],
  );

  const filteredGroups = useMemo(
    () =>
      data.replicateGroups.filter(
        (group) =>
          (sampleFilter === "全部样本" || group.sample === sampleFilter) &&
          (assayFilter === "全部 Assay" || group.assay === assayFilter) &&
          (statusFilter === "全部状态" || group.status === statusFilter),
      ),
    [sampleFilter, assayFilter, statusFilter],
  );

  const expressionByKey = useMemo(
    () =>
      new Map(
        data.relativeExpression.map((row) => [
          `${row.sample}|||${row.assay}`,
          row,
        ]),
      ),
    [],
  );

  const fbnCandidates = ["siFBN2-1", "siFBN2-2", "siFBN2-3", "siFBN2-4"].map(
    (sample) => ({
      sample,
      assay1: expressionByKey.get(`${sample}|||FBN2-1`),
      assay2: expressionByKey.get(`${sample}|||FBN2-2`),
      qc1: groupByKey.get(`${sample}|||FBN2-1`),
      qc2: groupByKey.get(`${sample}|||FBN2-2`),
    }),
  );

  const znfCandidates = [
    "siZNF436-1",
    "siZNF436-2",
    "siZNF436-3",
    "siZNF436-4",
  ].map((sample) => ({
    sample,
    assay1: expressionByKey.get(`${sample}|||ZNF436-1`),
    assay2: expressionByKey.get(`${sample}|||ZNF436-2`),
    qc1: groupByKey.get(`${sample}|||ZNF436-1`),
    qc2: groupByKey.get(`${sample}|||ZNF436-2`),
  }));

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a className={styles.backLink} href="/">
          <ArrowLeft size={16} aria-hidden="true" />
          返回排板工具
        </a>
        <div className={styles.topbarMeta}>
          <span className={styles.topbarDot} />
          结果已按修正 Plate_Map 重映射
        </div>
        <a
          className={styles.downloadButton}
          href="/results-20260803/qPCR_20260803_corrected_analysis.xlsx"
          download
        >
          <Download size={16} aria-hidden="true" />
          下载完整结果
        </a>
      </header>

      <div className={styles.content}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>
            <FlaskConical size={15} aria-hidden="true" />
            Roche LightCycler 480 · 384-well · 2026-08-03
          </div>
          <div className={styles.heroGrid}>
            <div>
              <h1>这次 qPCR，哪些结果能用？</h1>
              <p className={styles.heroLead}>
                已把 Cp、Tm、熔解聚类和你修正后的板布局逐孔合并。这里优先回答
                “能否用于敲低判定”，并把人工错位、可疑重复加样和异常峰型单独标出。
              </p>
            </div>
            <div className={styles.heroVerdict}>
              <div className={styles.verdictIcon}>
                <Microscope size={22} aria-hidden="true" />
              </div>
              <div>
                <span>本次结论等级</span>
                <strong>筛选性结果 · 尚未达到正式表型放行</strong>
                <p>仅技术复孔，且无 NTC / no-RT / 标准曲线。</p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.metricGrid} aria-label="实验概览">
          <article className={styles.metricCard}>
            <span>有效反应孔</span>
            <strong>{data.counts.detectedCp}/{data.counts.activeWells}</strong>
            <p>Cp 与 Tm 均检出</p>
          </article>
          <article className={`${styles.metricCard} ${styles.metricAccent}`}>
            <span>板图重映射</span>
            <strong>{data.counts.layoutChangedWells}</strong>
            <p>第 14 列样本循环错位</p>
          </article>
          <article className={`${styles.metricCard} ${styles.metricWarning}`}>
            <span>需人工复核</span>
            <strong>{data.counts.reviewGroups}</strong>
            <p>含第 10/14 列备注</p>
          </article>
          <article className={`${styles.metricCard} ${styles.metricDanger}`}>
            <span>QC 失败组</span>
            <strong>{data.counts.failGroups}</strong>
            <p>复孔或熔解异常</p>
          </article>
        </section>

        <section className={styles.section} id="conclusion">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.sectionKicker}>01 · 先看结论</span>
              <h2>敲低判定与下一步</h2>
            </div>
            <span className={styles.scopePill}>归一化：GAPDH + TBP 平均 Ct</span>
          </div>

          <div className={styles.conclusionGrid}>
            <article className={`${styles.conclusionCard} ${styles.conclusionPositive}`}>
              <div className={styles.conclusionTitle}>
                <CheckCircle2 size={19} aria-hidden="true" />
                <div>
                  <span>FBN2</span>
                  <h3>siFBN2-2 最可信；-3 / -4 需用干净引物复核</h3>
                </div>
              </div>
              <p>
                siFBN2-2 的两套引物均显示约 83–87% 的描述性降低；siFBN2-3、-4
                在 FBN2-1 上显示约 89–91% 降低，但 FBN2-2 出现低 Tm、第二峰或聚类异常。
              </p>
              <div className={styles.inlineCallout}>
                <strong>建议：</strong> 保留 siFBN2-2 作为首选；-3 / -4
                用同一 cDNA 重跑 FBN2-1 与经验证的新引物，再进入独立转染重复。
              </div>
            </article>

            <article className={`${styles.conclusionCard} ${styles.conclusionCaution}`}>
              <div className={styles.conclusionTitle}>
                <ShieldAlert size={19} aria-hidden="true" />
                <div>
                  <span>ZNF436</span>
                  <h3>两套引物方向相反，本次不能判定敲低成功</h3>
                </div>
              </div>
              <p>
                ZNF436-1 显示约 69–87% 降低，但多个组熔解 Tm / 聚类异常；ZNF436-2
                反而显示约 1.9–3.2 倍升高。该冲突大于技术误差，不能挑选其中一套作结论。
              </p>
              <div className={styles.inlineCallout}>
                <strong>建议：</strong> 先确认两套引物的单一产物、扩增效率与目标转录本；必要时跑胶或测序，再重做 ΔΔCt。
              </div>
            </article>
          </div>

          <div className={styles.candidateGrid}>
            {fbnCandidates.map((item) => {
              const strong = item.sample !== "siFBN2-1";
              const secondClean = item.qc2?.status !== "FAIL";
              return (
                <article className={styles.candidateCard} key={item.sample}>
                  <div className={styles.candidateHeader}>
                    <strong>{item.sample}</strong>
                    <span className={strong ? styles.candidateGood : styles.candidateWeak}>
                      {strong ? (secondClean ? "支持" : "单引物支持") : "不支持"}
                    </span>
                  </div>
                  <div className={styles.assayBars}>
                    <ExpressionBar
                      label="FBN2-1"
                      value={item.assay1?.relativeVsNcFam}
                      status={item.qc1?.status ?? "FAIL"}
                    />
                    <ExpressionBar
                      label="FBN2-2"
                      value={item.assay2?.relativeVsNcFam}
                      status={item.qc2?.status ?? "FAIL"}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.section} id="plate-map">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.sectionKicker}>02 · 逐孔核对</span>
              <h2>修正后的 384 孔板</h2>
            </div>
            <div className={styles.legend}>
              {(["PASS", "REVIEW", "FAIL"] as Status[]).map((status) => (
                <span key={status}>
                  <i className={statusClass(status)} />
                  {statusLabel[status]}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.plateWorkspace}>
            <div className={styles.plateScroll}>
              <div className={styles.plateGrid}>
                <div className={styles.cornerCell} />
                {columnNames.map((column) => (
                  <div className={styles.columnLabel} key={column}>{column}</div>
                ))}
                {rowNames.flatMap((row) => [
                  <div className={styles.rowLabel} key={`${row}-label`}>{row}</div>,
                  ...columnNames.map((column) => {
                    const wellId = `${row}${column}`;
                    const well = wellById.get(wellId);
                    const group = well
                      ? groupByKey.get(`${well.sample}|||${well.assay}`)
                      : undefined;
                    return well ? (
                      <button
                        type="button"
                        key={wellId}
                        className={`${styles.wellCell} ${group ? statusClass(group.status) : ""} ${well.layoutChanged ? styles.remapped : ""} ${selectedWell === wellId ? styles.selected : ""}`}
                        onClick={() => setSelectedWell(wellId)}
                        aria-label={`${wellId} ${well.sample} ${well.assay} ${statusLabel[group?.status ?? "FAIL"]}`}
                        title={`${wellId} · ${well.sample} · ${well.assay} R${well.replicate}`}
                      >
                        <span>{assayShortName(well.assay)}</span>
                        <small>{formatNumber(well.cp)}</small>
                      </button>
                    ) : (
                      <div className={styles.emptyWell} key={wellId} />
                    );
                  }),
                ])}
              </div>
            </div>

            <aside className={styles.wellInspector}>
              {selected && selectedGroup ? (
                <>
                  <div className={styles.inspectorHeader}>
                    <div>
                      <span>选中孔位</span>
                      <h3>{selected.well}</h3>
                    </div>
                    <ResultBadge status={selectedGroup.status} />
                  </div>
                  <dl className={styles.inspectorData}>
                    <div><dt>样本</dt><dd>{selected.sample}</dd></div>
                    <div><dt>Assay</dt><dd>{selected.assay} · R{selected.replicate}/4</dd></div>
                    <div><dt>Cp</dt><dd>{formatNumber(selected.cp)}</dd></div>
                    <div><dt>Tm1</dt><dd>{formatNumber(selected.tm1)} °C</dd></div>
                    <div><dt>熔解聚类</dt><dd>{selected.meltGroup} · Score {formatNumber(selected.meltScore)}</dd></div>
                    <div><dt>复孔 SD</dt><dd>{formatNumber(selectedGroup.cpSd)}</dd></div>
                  </dl>
                  {selected.layoutChanged && (
                    <div className={styles.remapNotice}>
                      <AlertTriangle size={16} aria-hidden="true" />
                      <span>
                        原行内样本为 <strong>{selected.originalSample}</strong>；已按第 14
                        列错位记录重映射为 <strong>{selected.sample}</strong>。
                      </span>
                    </div>
                  )}
                  {selected.manualNote && (
                    <div className={styles.manualNotice}>{selected.manualNote}</div>
                  )}
                  <div className={styles.groupSummary}>
                    <span>同组孔位</span>
                    <strong>{selectedGroup.wells.join(" · ")}</strong>
                    <p>{selectedGroup.issues.length ? selectedGroup.issues.join("；") : statusDescription[selectedGroup.status]}</p>
                  </div>
                </>
              ) : (
                <div className={styles.inspectorEmpty}>
                  <Grid3X3 size={26} aria-hidden="true" />
                  点击有颜色的孔查看详情
                </div>
              )}
            </aside>
          </div>
        </section>

        <section className={styles.section} id="qc-table">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.sectionKicker}>03 · 技术质量</span>
              <h2>复孔组 QC</h2>
            </div>
            <span className={styles.scopePill}>
              Cp SD ≤ {data.thresholds.cpSdPass.toFixed(2)} 为 PASS；&gt; {data.thresholds.cpSdFail.toFixed(2)} 为 FAIL
            </span>
          </div>

          <div className={styles.filterRow}>
            <FilterSelect value={sampleFilter} onChange={setSampleFilter} options={["全部样本", ...samples]} />
            <FilterSelect value={assayFilter} onChange={setAssayFilter} options={["全部 Assay", ...assays]} />
            <FilterSelect value={statusFilter} onChange={setStatusFilter} options={["全部状态", "PASS", "REVIEW", "FAIL"]} />
            <span className={styles.filterCount}>显示 {filteredGroups.length} / {data.counts.replicateGroups} 组</span>
          </div>

          <div className={styles.tableScroll}>
            <table className={styles.qcTable}>
              <thead>
                <tr>
                  <th>样本</th>
                  <th>Assay</th>
                  <th>孔位</th>
                  <th>Mean Cp</th>
                  <th>Cp SD</th>
                  <th>Mean Tm</th>
                  <th>Tm range</th>
                  <th>状态</th>
                  <th>问题</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map((group) => (
                  <tr key={`${group.sample}-${group.assay}`}>
                    <td><strong>{group.sample}</strong></td>
                    <td>{group.assay}</td>
                    <td className={styles.mono}>{group.wells.join(" · ")}</td>
                    <td>{formatNumber(group.meanCp)}</td>
                    <td>{formatNumber(group.cpSd)}</td>
                    <td>{formatNumber(group.meanTm)} °C</td>
                    <td>{formatNumber(group.tmRange)} °C</td>
                    <td><ResultBadge status={group.status} /></td>
                    <td>{group.issues.length ? group.issues.join("；") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.section} id="znf-discordance">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.sectionKicker}>04 · 关键矛盾</span>
              <h2>ZNF436 两套引物为何不能合并判读</h2>
            </div>
          </div>
          <div className={styles.discordanceGrid}>
            {znfCandidates.map((item) => (
              <article className={styles.discordanceCard} key={item.sample}>
                <div className={styles.discordanceHeader}>
                  <strong>{item.sample}</strong>
                  <span>方向冲突</span>
                </div>
                <div className={styles.discordancePair}>
                  <div>
                    <span>ZNF436-1</span>
                    <strong>{formatPercent(item.assay1?.relativeVsNcFam)}</strong>
                    <ResultBadge status={item.qc1?.status ?? "FAIL"} />
                  </div>
                  <div className={styles.vs}>vs</div>
                  <div>
                    <span>ZNF436-2</span>
                    <strong>{formatPercent(item.assay2?.relativeVsNcFam)}</strong>
                    <ResultBadge status={item.qc2?.status ?? "FAIL"} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.section} id="melt">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.sectionKicker}>05 · 熔解与人工备注</span>
              <h2>异常来自哪里</h2>
            </div>
          </div>
          <div className={styles.detailGrid}>
            <article className={styles.detailCard}>
              <div className={styles.detailTitle}>
                <AlertTriangle size={18} aria-hidden="true" />
                <div>
                  <span>第 10 列</span>
                  <h3>“可能加了两遍 cDNA”并非整列一致</h3>
                </div>
              </div>
              <p>
                8/10 个第 10 列孔与同组其余复孔的 Cp 差在 ±0.12 内；B10 与 D10
                分别低 0.63、0.89 个循环。数据更像第二次上样的两个样本受影响，但这只是由 Cp 模式得到的推断。
              </p>
              <div className={styles.deltaList}>
                {data.column10Effects.map((item) => (
                  <div key={item.well} className={Math.abs(item.deltaCp) > 0.5 ? styles.deltaAlert : ""}>
                    <span>{item.well} · {item.sample}</span>
                    <strong>{item.deltaCp > 0 ? "+" : ""}{formatNumber(item.deltaCp)} Ct</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className={styles.detailCard}>
              <div className={styles.detailTitle}>
                <CircleHelp size={18} aria-hidden="true" />
                <div>
                  <span>Assay 熔解概览</span>
                  <h3>FBN2-2 与 ZNF436 是主要风险来源</h3>
                </div>
              </div>
              <div className={styles.assaySummaryList}>
                {data.assaySummaries.map((assay) => (
                  <div key={assay.assay}>
                    <div>
                      <strong>{assay.assay}</strong>
                      <span>Tm median {formatNumber(assay.tmMedian)} °C</span>
                    </div>
                    <p>
                      {Object.entries(assay.meltGroupCounts)
                        .map(([group, count]) => `${group}: ${count}`)
                        .join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className={styles.methodSection}>
          <div>
            <span className={styles.sectionKicker}>判读边界</span>
            <h2>这份报告能说什么，不能说什么</h2>
          </div>
          <div className={styles.methodGrid}>
            {data.limitations.map((item) => (
              <div key={item}>
                <span />
                <p>{item}</p>
              </div>
            ))}
          </div>
          <div className={styles.downloadRow}>
            <a href="/results-20260803/corrected_well_data.csv" download>逐孔数据 CSV</a>
            <a href="/results-20260803/replicate_qc.csv" download>复孔 QC CSV</a>
            <a href="/results-20260803/relative_expression.csv" download>相对表达 CSV</a>
          </div>
        </section>
      </div>
    </main>
  );
}

function ExpressionBar({
  label,
  value,
  status,
}: {
  label: string;
  value: number | undefined;
  status: Status;
}) {
  const width = Math.max(3, Math.min(100, (value ?? 0) * 100));
  return (
    <div className={styles.expressionRow}>
      <div>
        <span>{label}</span>
        <strong>{formatPercent(value)}</strong>
      </div>
      <div className={styles.expressionTrack}>
        <i style={{ width: `${width}%` }} className={statusClass(status)} />
        <b style={{ left: "100%" }} aria-hidden="true" />
      </div>
      <small>vs NC-FAM · <em>{statusLabel[status]}</em></small>
    </div>
  );
}

function FilterSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.selectWrap}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
  );
}
