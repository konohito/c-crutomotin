/* 配信できる Node の版を使っているか（★2026-11-08 新設）
 *
 * ★何が起きていたか
 *   2026-11-05 から **本番の配信がずっと失敗していた**（Deploy production: 2回連続 failure）。
 *   原因はコードではなく、Node の版：
 *     Error: Runtime Node.js 20 was decommissioned on 2026-10-31.
 *            To deploy you must first upgrade your runtime version.
 *   検査（check.yml）は全部通り、GitHub Pages の配信も成功していたので、
 *   **本番だけが静かに止まっていた**。3日気づかなかった。
 *
 * ★この検査が守ること
 *   1) 提供終了した版を書いていないこと（期限が来たら必ず落ちる）
 *   2) 書いてある場所どうしが食い違っていないこと
 *      （firebase.json の runtime ／ functions/package.json の engines ／
 *        ワークフローの node-version。1つだけ上げても配信は直らない）
 *
 * ★期限の表は Google が決める。新しい版が終了したら END_OF_LIFE に足す。
 *   https://cloud.google.com/functions/docs/runtime-support
 *
 * 実行: node scripts/check-node-runtime.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* 提供が終わった版（実際に配信が拒否される版）。版 → 終了日 */
const END_OF_LIFE = {
  "14": "2024-01-30",
  "16": "2025-01-30",
  "18": "2025-10-31",
  "20": "2026-10-31",   // ★ここで本番が止まった
};

console.log("== 書いてある版を集める ==");
const found = [];   // { where, version }

/* 1) firebase.json の runtime */
{
  const p = path.join(ROOT, "firebase.json");
  const s = fs.readFileSync(p, "utf8");
  const m = /"runtime"\s*:\s*"nodejs(\d+)"/.exec(s);
  ok(!!m, "★firebase.json に runtime が無い（配信時に既定へ倒れ、何が使われるか分からない）");
  if (m) found.push({ where: "firebase.json の runtime", version: m[1] });
}

/* 2) functions/package.json の engines */
{
  const p = path.join(ROOT, "functions/package.json");
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const v = String((j.engines || {}).node || "").replace(/[^\d]/g, "");
  ok(!!v, "★functions/package.json に engines.node が無い");
  if (v) found.push({ where: "functions/package.json の engines.node", version: v });
}

/* 3) ワークフローの node-version（配信を実行する側） */
{
  const dir = path.join(ROOT, ".github/workflows");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".yml"))) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of s.matchAll(/node-version:\s*["']?(\d+)/g)) {
      found.push({ where: `.github/workflows/${f} の node-version`, version: m[1] });
    }
  }
  ok(found.length >= 3, "★ワークフローの node-version が見つからない");
}

console.log("== 提供が終わった版を使っていないか ==");
{
  for (const f of found) {
    const end = END_OF_LIFE[f.version];
    ok(!end,
      `★Node ${f.version} は ${end} に提供終了しています（${f.where}）。\n` +
      "      この版のままだと **本番の配信が必ず失敗します**（検査は通るので気づけません）。");
  }
}

console.log("== 書いてある場所どうしが食い違っていないか ==");
{
  const versions = Array.from(new Set(found.map((f) => f.version)));
  ok(versions.length === 1,
    "★Node の版が場所によって違います（1つだけ上げても配信は直りません）：\n" +
    found.map((f) => `        Node ${f.version}  ${f.where}`).join("\n"));
}

console.log(fail
  ? `\ncheck-node-runtime: ${pass} ok, ${fail} failed`
  : `\ncheck-node-runtime: ${pass} ok, 0 failed（Node ${found[0] && found[0].version}）`);
process.exit(fail ? 1 : 0);
