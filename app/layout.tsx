import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "RT-qPCR(SYBR Green)版布局规划工具",
    template: "%s｜RT-qPCR Plate Layout Planner",
  },
  description:
    "本地优先的 RT-qPCR（SYBR Green）孔板布局、反应体系核算与 Excel 导出工具。",
  openGraph: {
    title: "RT-qPCR(SYBR Green)版布局规划工具",
    description:
      "Plate layout, reaction setup, and reagent requirements for 96- and 384-well RT-qPCR experiments.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f6f2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
