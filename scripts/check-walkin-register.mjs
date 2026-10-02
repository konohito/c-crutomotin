/* 当日受付の「この内容で仮登録」が押せる場所にあること（2026-10-02 現場報告）。
 *
 * 【何が起きたか】
 *   本部で問診票を取り込んだのに、出力したら問診票が入っていなかった。
 *   原因は保存の失敗ではなく「登録ボタンを押していなかった」こと。
 *     村崎「登録押し漏れ？」「登録ボタンが見切れてスクロールで押せないのもあるかもです」
 *     「再アップ済みですが、登録ボタンみあたらず、、」
 *   問診票は質問が多く、開いたフォームが縦に長くなるため、最下部にあった
 *   「この内容で仮登録」が画面の外に出ていた。
 *
 * 【ここで縛ること】
 *   ・ボタンの並びが画面下に貼り付く（position: sticky, bottom: 0）
 *   ・開いたフォームの先頭に「まだ登録されていない」と出る
 *   ・ボタンのそばに「押すまで保存されません」と出る
 *   ・貼り付く帯が他の要素の下に隠れない（zIndex がある）
 *
 * 実行: node scripts/check-walkin-register.mjs */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(root, "src/screens/WalkIn.jsx"), "utf8");
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log("  FAIL " + m)); };

/* コメントを外した本文で判定する（経緯の説明に当たる誤判定を避ける） */
const code = SRC.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

console.log("== 登録ボタンが押せる場所にある ==");
/* ★ラベルの文字で探すと、案内文（「下の『この内容で仮登録』を押してください」）に
   当たってしまう。ボタンの処理（commitEntry）を目印にする（この検査を書くときに踏んだ）。 */
const i = code.indexOf("onClick={() => commitEntry(e)}");
ok(i > 0, "「この内容で仮登録」のボタンがある");
ok(code.slice(i, i + 200).includes("この内容で仮登録") || code.slice(Math.max(0, i - 200), i).includes("この内容で仮登録"),
  "そのボタンのラベルが「この内容で仮登録」である");
/* ボタンを包む div に sticky/bottom:0 が付いていること（ボタンの直前 600 文字を見る） */
const before = code.slice(Math.max(0, i - 600), i);
ok(/position: 'sticky'/.test(before), "ボタンの帯が画面下に貼り付く指定になっている（sticky）");
ok(/bottom: 0/.test(before), "bottom: 0 が付いている");
ok(/zIndex: *[1-9]/.test(before), "zIndex があり他の要素に隠れない");
ok(/borderTop:/.test(before), "帯として見分けられる区切り線がある");
ok(/background: 'var\(--bg-surface\)'/.test(before), "帯の背景が塗られている（下の文字が透けない）");

console.log("== 押し忘れが起きないようにしてある ==");
ok(/まだ登録されていません/.test(code), "開いたフォームの先頭に「まだ登録されていません」と出る");
ok(/押すまでは保存されず/.test(code) || /押すまで保存されません/.test(code), "押すまで保存されないと書いてある");
/* ボタンのすぐ横にも短い注意を出す（上の案内を読み飛ばしても気づけるように） */
const after = code.slice(i, i + 400);
ok(/押すまで保存されません/.test(after), "ボタンのそばにも注意書きがある");

console.log("== 既存の動きを壊していない ==");
ok(/onClick=\{\(\) => commitEntry\(e\)\}/.test(code), "押したときの処理（commitEntry）は変えていない");
ok(/disabled=\{busy === e\.id\}/.test(code), "二重押しの防止が残っている");
ok(/onClick=\{\(\) => setOpenId\(''\)\}/.test(code), "「閉じる」が残っている");

console.log(`\ncheck-walkin-register: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
