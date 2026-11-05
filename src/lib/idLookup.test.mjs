/* 氏名＋生年月日のCSVから台帳のIDを調べる（2026-09-23 ユーザー依頼）。

   「名前と生年月日のCSVをアップロードしたら、その人達のアプリ内でのIDが一括で
     検索結果として跳ね返ってくるようなシステムを追加してほしい」

   ★本番の台帳429名で自己照合したところ、428名が正しく見つかり、取り違えは0件だった。
     残り1名はふりがなも生年月日も無い方で、氏名だけでは決められない（＝人に選んでもらうのが正しい）。
   ★台帳には何も書かない。調べて返すだけ。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupIdsFromCsv, pickColumns, resultCsv, yearOnlyCount } from "./idLookup.js";
import { birthDigits } from "./merge.js";

const U = (id, name, kana, birthDate, sex) => ({ id, name, kana, birthDate, sex });
/* ★架空の台帳。実在の氏名・生年月日は置かない（検査ファイルが名簿になってしまう）。
     ここで再現したい形だけを残してある:
       - 旧字体のゆれがある姓（髙木/高木）
       - 同じ姓で名が違う 2 名（21903 / 21904）
       - 生年月日が同じ別人（21902 と 21903） */
const ROSTER = [
  U("21901", "山田 花子", "やまだ はなこ", "1950/01/02", "女"),
  U("21902", "髙木 太郎", "たかぎ たろう", "1949/03/04", "男"),
  U("21903", "介護 春子", "かいご はるこ", "1949/03/04", "女"),
  U("21904", "介護 秋子", "かいご あきこ", "1949/11/05", "女"),
];
const csv = (rows) => rows.map((r) => r.join(",")).join("\n");
const run = (rows) => lookupIdsFromCsv(csv(rows), ROSTER);
const HEAD = ["氏名", "ふりがな", "生年月日", "性別"];

test("見出しの列を、順番に関係なく見つける", () => {
  const c = pickColumns(["性別", "生年月日", "氏名", "ふりがな"]);
  assert.equal(c.name, 2);
  assert.equal(c.birth, 1);
  assert.equal(c.kana, 3);
  assert.equal(c.sex, 0);
});

test("見出しの書き方が違っても拾う", () => {
  const c = pickColumns(["名前", "フリガナ", "生年月日"]);
  assert.equal(c.name, 0);
  assert.equal(c.kana, 1);
});

test("氏名の列が無ければ、何もせず理由を返す", () => {
  const r = lookupIdsFromCsv("生年月日\n1950/01/02\n", ROSTER);
  assert.match(r.error, /氏名/);
  assert.equal(r.rows.length, 0);
});

test("氏名と生年月日が合えばIDを返す", () => {
  const r = run([HEAD, ["山田 花子", "やまだ はなこ", "1950/01/02", "女"]]);
  assert.equal(r.rows[0].status, "found");
  assert.equal(r.rows[0].id, "21901");
});

test("ふりがなが無くても、氏名と生年月日で決まる", () => {
  const r = run([["氏名", "生年月日"], ["山田 花子", "1950/01/02"]]);
  assert.equal(r.rows[0].status, "found");
  assert.equal(r.rows[0].id, "21901");
});

test("★0詰めされていない生年月日でも合う（1950/1/2）", () => {
  /* ここを揃えないと数字が7桁になり、生年月日が一致しても加点されない。 */
  const r = run([["氏名", "生年月日"], ["山田 花子", "1950/1/2"]]);
  assert.equal(r.rows[0].status, "found", "0詰めなしでも見つかる");
  assert.equal(r.rows[0].id, "21901");
});

test("点区切りの生年月日でも合う（1950.1.2）", () => {
  const r = run([["氏名", "生年月日"], ["山田 花子", "1950.1.2"]]);
  assert.equal(r.rows[0].status, "found");
});

test("旧字体のゆれを吸収する（髙木 → 高木）", () => {
  /* ★ふりがなを入れない。入れるとふりがなだけで決まってしまい、
       旧字体の対応表（merge.js の KANJI_VAR）が効いているかを確かめられない。 */
  const r = run([["氏名", "生年月日"], ["高木 太郎", "1949/03/04"]]);
  assert.equal(r.rows[0].status, "found", "字体が違っても氏名が一致したとみなす");
  assert.equal(r.rows[0].id, "21902");
  assert.ok(r.rows[0].note.includes("氏名が一致"), "「似ている」ではなく「一致」で決まること");
});

test("全角と半角・カタカナとひらがなのゆれを吸収する", () => {
  const r = run([HEAD, ["山田　花子", "ヤマダ ハナコ", "1950/01/02", "女"]]);
  assert.equal(r.rows[0].status, "found");
  assert.equal(r.rows[0].id, "21901");
});

test("★同姓に近い別人を取り違えない（生年月日が違えば弾く）", () => {
  /* 本番の台帳にも、同じ姓で名だけが違う方が並んでいる。
     生年月日が合う側だけを返し、もう一方と取り違えないこと。 */
  const r = run([HEAD, ["介護 春子", "かいご はるこ", "1949/03/04", "女"]]);
  assert.equal(r.rows[0].id, "21903", "生年月日が合う側のIDを返す");
  const q = run([HEAD, ["介護 秋子", "かいご あきこ", "1949/11/05", "女"]]);
  assert.equal(q.rows[0].id, "21904", "もう一方も取り違えない");
  /* ★ここが本番。氏名はぴったり合うのに生年月日だけ食い違う行は、
       勝手に決めてはいけない（ふりがなを入れると、ふりがなだけで決まってしまうので入れない）。 */
  const x = run([["氏名", "生年月日"], ["介護 春子", "1949/11/05"]]);
  assert.notEqual(x.rows[0].status, "found", "生年月日が違う行をIDに結びつけない");
  assert.equal(x.rows[0].id, "", "IDを返さない");
});

test("台帳にいない方は「見つかりません」", () => {
  const r = run([HEAD, ["存在 しない", "そんざい しない", "1950/01/01", "男"]]);
  assert.equal(r.rows[0].status, "none");
  assert.equal(r.rows[0].id, "");
});

test("氏名が空の行は、そう伝える", () => {
  const r = run([HEAD, ["", "", "1950/01/02", "女"]]);
  assert.equal(r.rows[0].status, "invalid");
});

test("決められないときはIDを返さない（勝手に決めない）", () => {
  /* 氏名だけで生年月日もふりがなも無い＝手がかりが足りない。 */
  const roster = [U("1", "佐藤 一郎", "", "", ""), U("2", "佐藤 一郎", "", "", "")];
  const r = lookupIdsFromCsv("氏名\n佐藤 一郎\n", roster);
  assert.notEqual(r.rows[0].status, "found", "1人に決めてしまわない");
  assert.equal(r.rows[0].id, "", "IDを返さない");
});

test("件数をまとめて返す", () => {
  const r = run([HEAD,
    ["山田 花子", "やまだ はなこ", "1950/01/02", "女"],
    ["存在 しない", "", "1950/01/01", "男"],
    ["", "", "", ""],
  ]);
  assert.equal(r.counts.total, 3);
  assert.equal(r.counts.found, 1);
  assert.equal(r.counts.none, 1);
  assert.equal(r.counts.invalid, 1);
});

test("生年月日が年だけの行を数える（注意を出すため）", () => {
  const r = run([HEAD, ["山田 花子", "", "1950", "女"], ["髙木 太郎", "", "1949/03/04", "男"]]);
  assert.equal(yearOnlyCount(r.rows), 1);
});

test("結果のCSVは Excel で開ける形にする", () => {
  const r = run([HEAD, ["山田 花子", "やまだ はなこ", "1950/01/02", "女"]]);
  const out = resultCsv(r.rows);
  assert.ok(out.startsWith("﻿"), "BOM付き（Excelで文字化けしない）");
  assert.ok(out.includes("\r\n"), "改行はCRLF");
  assert.match(out, /21901/, "IDが入っている");
  assert.match(out, /見つかりました/, "結果が日本語で入っている");
});

test("カンマや引用符を含む氏名でも壊れない", () => {
  const out = resultCsv([{ no: 1, name: 'テスト, "花子"', kana: "", birthDate: "", sex: "", id: "1", status: "found", note: "" }]);
  assert.match(out, /"テスト, ""花子"""/, "囲んで、引用符は2つにする");
});

test("空のファイルでも落ちない", () => {
  const r = lookupIdsFromCsv("", ROSTER);
  assert.ok(r.error);
  assert.equal(r.rows.length, 0);
});

test("生年月日の0詰めは merge 側で揃えている（重複チェックにも効く）", () => {
  assert.equal(birthDigits("1950/1/2"), "19500102");
  assert.equal(birthDigits("1950.1.2"), "19500102");
  assert.equal(birthDigits("1950/01/02"), "19500102");
  assert.equal(birthDigits("1950"), "1950", "年だけはそのまま");
});

test("台帳には何も書かない（保存の呼び出しを持っていない）", async () => {
  const src = await (await import("node:fs/promises")).readFile(
    new URL("./idLookup.js", import.meta.url), "utf8");
  assert.ok(!/setDoc|addDoc|updateDoc|deleteDoc|writeBatch/.test(src),
    "調べるだけの画面なので、書き込みの口を持たない");
});
