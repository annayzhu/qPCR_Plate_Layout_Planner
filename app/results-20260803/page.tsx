import type { Metadata } from "next";
import { QpcrResults } from "./QpcrResults";

export const metadata: Metadata = {
  title: {
    absolute: "2026-08-03 qPCR 结果复核",
  },
  description:
    "基于修正后的 384 孔板布局，整合 Roche LightCycler 480 Cp、Tm 与熔解聚类结果。",
};

export default function ResultsPage() {
  return <QpcrResults />;
}
