import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the qPCR plate planner shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>qPCR 板布局规划工具<\/title>/i,
  );
  assert.match(html, /qPCR 板布局规划工具/);
  assert.match(html, /96 \/ 384 孔 · 排板与反应用量/);
  assert.match(html, /选择孔板/);
  assert.match(html, /样本与对照/);
  assert.match(html, /逐行设置名称及样本类型/);
  assert.match(html, /添加一行/);
  assert.match(html, /添加检测基因/);
  assert.match(html, /逐行设置名称及目的\/内参类型/);
  assert.match(html, /技术复孔/);
  assert.match(html, /按样本排列/);
  assert.match(html, /按基因排列/);
  assert.match(html, /生成布局/);
  assert.match(html, /重置工具/);
  assert.match(html, /导入 0 个样本名称/);
  assert.match(html, /导入 0 个基因名称/);
  assert.match(html, /样本数量（1–999）/);
  assert.match(html, /基因数量（1–999）/);
  assert.match(html, /快速添加/);
  assert.doesNotMatch(html, /生成 [ST]1/);
  assert.doesNotMatch(html, /Local-first/i);
  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
});
