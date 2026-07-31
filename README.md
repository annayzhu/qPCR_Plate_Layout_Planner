# RT-qPCR(SYBR Green)板布局规划工具

浏览器端中英文双语工具，用于规划 96/384 孔 RT-qPCR（SYBR Green）实验、手动校正版布局、核算反应体系与试剂需求，并导出单板 Excel 或全部孔板 ZIP。

## 核心规则 / Core rules

- 技术复孔从左向右连续排布，不跨行。
- 384 孔板默认采用固定 9 mm 八道排枪隔行上样：先
  `A/C/E/G/I/K/M/O`，再 `B/D/F/H/J/L/N/P`；也可切换为连续孔位上样。
- 隔行来源板默认按样本输入顺序从 A–H 向下放置，再移动到下一列；
  同一样本在不同基因和不同孔板中保持相同的来源行与八道样本组。
- 隔行模式推荐按基因排列，并让每个基因从新的 16 行复孔列块开始；
  孔板预览和 Excel 始终保留真实的 A–P 物理行序。
- 目的基因可以跨板；任何包含某样本目的基因的板，都必须同时包含该样本的全部内参。
- 优化候选依次比较：孔板数、跨板内参重做、基因跨板批次、板内引物切换和样本切换。
- 手动编辑支持单孔、Shift 连选和 Ctrl/⌘ 不连续多选；修改孔以独立颜色和边框标记，并重新执行全局校验，但提醒不限制保存或导出。
- 反应用量按实际占用孔计算，包括跨板重复内参和手动编辑后的孔位。

## 反应计算 / Reaction calculation

输入每孔 cDNA、上下游引物总体积、反应预混液、反应总体积及配液余量。默认按上下游引物等体积分配：

```text
Forward primer = primer-pair volume / 2
Reverse primer = primer-pair volume / 2
Water = total volume - master mix - primer-pair volume - cDNA
Prepare volume = required volume × (1 + overage%)
```

默认示例为 10 µL 体系：5 µL 预混液、0.4 µL 上游引物、0.4 µL 下游引物、1 µL cDNA、3.2 µL 无核酸酶水及 10% 配液余量。该示例不是品牌固定处方，应以具体试剂说明书和本地 SOP 为准。

## Excel 输出 / Excel output

每块孔板工作簿包含：

- `Plate_Map`
- `Well_Detail`
- `Gene_Requirements`
- `Sample_cDNA`
- `Total_Requirements`
- `Design_Summary`
- `Reaction_Setup`

`Well_Detail` 会在 384 孔八道隔行模式下记录上样批次、来源行 A–H
和八道样本组。批量导出 ZIP 还包含全部孔板总览工作簿。

## 特别说明 / Special note

本工具不自动添加 NTC、no-RT、阳性模板或板间校准样本。未输入引物储备液浓度和 cDNA 浓度时，只核算体积，不能判断引物终浓度或换算原始 RNA/组织样本量。仅供科研使用（RUO）。

## 本地运行 / Local development

依赖 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
npm run lint
npm run test:unit
npm run build
node --test tests/rendered-html.test.mjs
```

实验方案保存在当前浏览器的 `localStorage`，样本名称不会由应用主动上传。
