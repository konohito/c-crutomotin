/* 読み込み方の食い違いを見つける（2026-09-23 の本番デプロイ失敗を受けて追加）。

   何が起きたか:
     新しい画面で `import Icon from '../ui/icons.jsx'` と書いた。
     icons.jsx には既定の書き出し（export default）が無く、`{ Icon }` が正しい書き方だった。
     手元の検査（check:undefined・単体テスト）はどれも通り、
     **本番のビルドだけが落ちた**。しかもワークフローの一覧では緑に見えていた。

   ここでは次の2つを見る。
     1) 既定の書き出しが無いファイルを、既定で読み込んでいないか
     2) 書き出されていない名前を、名前付きで読み込んでいないか

   画像などコード以外のファイル（.png / .svg / .css）は、束ね役が既定の書き出しを
   足してくれるので対象外にする。 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");
const CODE = /\.(jsx?|mjs|cjs|ts|tsx)$/;

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (CODE.test(f)) files.push(p);
  }
})(SRC);

/** そのファイルが外へ出している名前を集める（ざっくりで十分・見落とすより誤検知を避ける）。 */
function exportsOf(src) {
  const names = new Set();
  let hasDefault = /export\s+default/.test(src);
  let hasStar = /export\s*\*/.test(src);
  const re1 = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g;
  let m;
  while ((m = re1.exec(src))) names.add(m[1]);
  const re2 = /export\s*\{([^}]*)\}/g;
  while ((m = re2.exec(src))) {
    m[1].split(",").forEach((part) => {
      const t = part.trim();
      if (!t) return;
      const as = /\bas\s+([A-Za-z0-9_$]+)\s*$/.exec(t);
      names.add(as ? as[1] : t.replace(/^type\s+/, "").trim());
    });
  }
  return { names, hasDefault, hasStar };
}

const problems = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const re = /import\s+([^'"]+?)\s+from\s+['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const clause = m[1].trim();
    const rel = m[2];
    /* 相対の読み込み先を解く。拡張子が無いものは .js / .jsx を試す。 */
    let target = resolve(dirname(f), rel);
    if (!existsSync(target)) {
      const cand = [".js", ".jsx", ".mjs", "/index.js", "/index.jsx"].map((e) => target + e).find(existsSync);
      if (!cand) continue;                 // 見つからないものはここでは扱わない
      target = cand;
    }
    if (!CODE.test(extname(target))) continue;   // 画像・CSS は束ね役が面倒を見る
    const ex = exportsOf(readFileSync(target, "utf8"));

    const defName = /^([A-Za-z0-9_$]+)\s*(?:,|$)/.exec(clause);
    if (defName && !clause.startsWith("{") && !clause.startsWith("*")) {
      if (!ex.hasDefault) {
        problems.push({ f, rel, kind: "既定の書き出しが無いのに、既定で読み込んでいる",
          detail: `import ${defName[1]} from "${rel}" → import { … } from "${rel}" ではありませんか` });
      }
    }
    const named = /\{([^}]*)\}/.exec(clause);
    if (named && !ex.hasStar) {
      named[1].split(",").forEach((part) => {
        const t = part.trim();
        if (!t) return;
        const as = /^([A-Za-z0-9_$]+)\s+as\s+/.exec(t);
        const name = as ? as[1] : t;
        if (!name || name === "default") return;
        if (!ex.names.has(name)) {
          problems.push({ f, rel, kind: "書き出されていない名前を読み込んでいる",
            detail: `${name} が "${rel}" に見当たりません` });
        }
      });
    }
  }
}

if (problems.length) {
  console.log("");
  console.log("読み込み方の食い違いが見つかりました（このままだと本番のビルドが落ちます）:");
  problems.forEach((p) => {
    console.log(`  ✗ ${p.f.replace(root + "/", "")}`);
    console.log(`     ${p.kind}`);
    console.log(`     ${p.detail}`);
  });
  console.log("");
  process.exit(1);
}
console.log("");
console.log(`読み込み方の食い違いはありません（${files.length} ファイル）`);
