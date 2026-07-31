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
    /<title>RT-qPCR\(SYBR Green\)板布局规划工具<\/title>/i,
  );
  assert.match(html, /RT-qPCR\(SYBR Green\)板布局规划工具/);
  assert.match(html, /选择孔板/);
  assert.match(html, /添加样本/);
  assert.match(html, /添加检测基因/);
  assert.match(html, /技术复孔/);
  assert.match(html, /生成推荐布局/);
  assert.doesNotMatch(html, /Local-first/i);
  assert.doesNotMatch(html, /codex-preview/i);
  assert.doesNotMatch(html, /react-loading-skeleton/i);
});
