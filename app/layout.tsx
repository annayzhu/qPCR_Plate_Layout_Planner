import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "qPCR 板布局规划工具",
  description:
    "96/384 孔 qPCR 板布局、反应体系核算与 Excel 导出工具。",
  openGraph: {
    title: "qPCR 板布局规划工具 / qPCR Plate Layout Planner",
    description:
      "Editable plate layouts, reaction setup, and reagent requirements for 96- and 384-well qPCR experiments.",
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
  themeColor: "#f6f6f9",
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
