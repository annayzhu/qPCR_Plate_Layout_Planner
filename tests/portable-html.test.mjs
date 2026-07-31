import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const projectDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputRoot = path.join(projectDirectory, "outputs", "portable");
const folderName = "RT-qPCR_Plate_Planner_Portable";
const htmlFilename = "Open_RT-qPCR_Plate_Planner.html";
const outputDirectory = path.join(outputRoot, folderName);

function dateStamp(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
}

test("portable HTML is a self-contained classic-script document", async () => {
  const html = await readFile(
    path.join(outputDirectory, htmlFilename),
    "utf8",
  );

  assert.match(
    html,
    /<title>RT-qPCR\(SYBR Green\)板布局规划工具<\/title>/u,
  );
  assert.match(html, /<div id="qpcr-planner-root"><\/div>/u);
  assert.match(html, /<style>[\s\S]+<\/style>/u);
  assert.match(html, /<script>[\s\S]+<\/script>/u);
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/iu);
  assert.doesNotMatch(html, /<script[^>]+\btype=["']module["']/iu);
  assert.doesNotMatch(html, /<link[^>]+\bhref=/iu);
  assert.doesNotMatch(html, /@import\s+["']tailwindcss["']/iu);
  assert.ok(
    Buffer.byteLength(html) > 1_000_000,
    "bundled app and export libraries should be present",
  );
});

test("portable folder includes readable instructions and licenses", async () => {
  const [readme, version, licenses] = await Promise.all([
    readFile(path.join(outputDirectory, "README_CN_EN.txt"), "utf8"),
    readFile(path.join(outputDirectory, "VERSION.txt"), "utf8"),
    readFile(
      path.join(outputDirectory, "THIRD_PARTY_LICENSES.txt"),
      "utf8",
    ),
  ]);

  assert.equal(readme.at(0), "\uFEFF");
  assert.equal(version.at(0), "\uFEFF");
  assert.equal(licenses.at(0), "\uFEFF");
  assert.match(readme, /无需安装 Node、Python/u);
  assert.match(readme, /“重置工具”会清除本机保存记录/u);
  assert.match(version, /单文件离线 HTML/u);
  assert.match(licenses, /react@19\.2\.6/u);
  assert.match(licenses, /xlsx-js-style@1\.2\.0/u);
  assert.match(licenses, /jszip@3\.10\.1/u);
});

test("portable ZIP uses cross-platform ASCII paths", async () => {
  const zipFilename = `${folderName}_${dateStamp()}.zip`;
  const zip = await JSZip.loadAsync(
    await readFile(path.join(outputRoot, zipFilename)),
  );
  const names = Object.keys(zip.files);

  assert.deepEqual(names, [
    `${folderName}/`,
    `${folderName}/${htmlFilename}`,
    `${folderName}/README_CN_EN.txt`,
    `${folderName}/VERSION.txt`,
    `${folderName}/THIRD_PARTY_LICENSES.txt`,
  ]);
  assert.ok(names.every((name) => /^[\x20-\x7E]+$/u.test(name)));
});
