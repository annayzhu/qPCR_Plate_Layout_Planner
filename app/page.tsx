import type { Metadata } from "next";
import { QpcrPlanner } from "./QpcrPlanner";

export const metadata: Metadata = {
  title: {
    absolute: "RT-qPCR(SYBR Green)板布局规划工具",
  },
  description:
    "为 96 孔与 384 孔 RT-qPCR（SYBR Green）实验生成可编辑板布局，核算反应体系和试剂用量，并导出 Excel。",
};

export default function Home() {
  return <QpcrPlanner />;
}
