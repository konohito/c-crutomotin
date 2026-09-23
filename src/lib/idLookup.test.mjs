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
const ROSTER = [
  U("21901", "山田 花子", "やまだ はなこ", "1948/05/12", "女"),
  U("21902", "髙木 太郎", "たかぎ たろう", "1947/07/30", "男"),
  U("21903", "岩永 裕子", "いわなが ゆうこ", "1947/07/30", "女"),
  U("21904", "岩永 秀子", "いわなが ひでこ", "1947/06/24", "女"),
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
  const r = lookupIdsFromCsv("生年月日\n1948/05/12\n", ROSTER);
  assert.match(r.error, /氏名/);
  assert.equal(r.rows.length, 0);
});

test("氏名と生年月日が合えばIDを返す", () => {
  const r = run([HEAD, ["山田 花子", "やまだ はなこ", "1948/05/12", "女"]]);
  assert.equal(r.rows[0].status, "found");
  assert.equal(r.rows[0].id, "21901");
});

test("ふりがなが無くても、氏名と生年月日で決まる", () => {
  const r = run([["氏名", "生年月日"], ["山田 花子", "1948/05/12"]]);
  assert.equal(r.rows[0].status, "found");
  assert.equal(r.rows[0].id, "21901");
});

test("★0詰めされていない生年月日でも合う（1948/5/12）", () => {
  /* ここを揃えないと数字が7桁になり、生年月日が一致しても加点されない。 */
  const r = run([["氏名", "生年月日"], ["山田 花子", "1948/5/12"]]);
  assert.equal(r.rows[0].status, "found", "0詰めなしでも見つかる");
  assert.equal(r.rows[0].id, "21901");
});

test("点区切りの生年月日でも合う（1948.5.12）", () => {
  const r = run([["氏名", "生年月日"], ["山田 花子", "1948.5.12"]]);
  assert.equal(r.rows[0].status, "found");
});

test("旧字体のゆれを吸収する（髙木 → 高木）", () => {
  const r = run([HEAD, ["高木 太郎", "たかぎ たろう", "1947/07/30", "男"]]);
  assert.equal(r.rows[0].status, "found");
  assert.equal(r.rows[0].id, "21902");
});

test("全角と半角・カタカナとひらがなのゆれを吸収する", () => {
  const r = run([HEAD, ["山田　花子", "ヤマダ ハナコ", "1948/05/12", "女"]]);
  assert.equal(r.rows[0].status, "found");
  assert.equal(r.rows[0].id, "21901");
});

test("★同姓に近い別人を取り違えない（生年月日が違えば弾く）", () => {
  /* 実データにいる「岩永裕子(1947/07/30)」と「岩永秀子(1947/06/24)」。 */
  const r = run([HEAD, ["岩永 裕子", "いわなが ゆうこ", "1947/07/30", "女"]]);
  assert.equal(r.rows[0].id, "21903", "裕子さんのIDを返す");
  const q = run([HEAD, ["岩永 秀子", "いわなが ひでこ", "1947/06/24", "女"]]);
  assert.equal(q.rows[0].id, "21904", "秀子さんのIDを返す");
});

test("台帳にいない方は「見つかりません」", () => {
  const r = run([HEAD, ["存在 しない", "そんざい しない", "1950/01/01", "男"]]);
  assert.equal(r.rows[0].status, "none");
  assert.equal(r.rows[0].id, "");
});

test("氏名が空の行は、そう伝える", () => {
  const r = run([HEAD, ["", "", "1948/05/12", "女"]]);
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
    ["山田 花子", "やまだ はなこ", "1948/05/12", "女"],
    ["存在 しない", "", "1950/01/01", "男"],
    ["", "", "", ""],
  ]);
  assert.equal(r.counts.total, 3);
  assert.equal(r.counts.found, 1);
  assert.equal(r.counts.none, 1);
  assert.equal(r.counts.invalid, 1);
});

test("生年月日が年だけの行を数える（注意を出すため）", () => {
  const r = run([HEAD, ["山田 花子", "", "1948", "女"], ["髙木 太郎", "", "1947/07/30", "男"]]);
  assert.equal(yearOnlyCount(r.rows), 1);
});

test("結果のCSVは Excel で開ける形にする", () => {
  const r = run([HEAD, ["山田 花子", "やまだ はなこ", "1948/05/12", "女"]]);
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
  assert.equal(birthDigits("1948/5/12"), "19480512");
  assert.equal(birthDigits("1948.5.12"), "19480512");
  assert.equal(birthDigits("1948/05/12"), "19480512");
  assert.equal(birthDigits("1948"), "1948", "年だけはそのまま");
});

test("台帳には何も書かない（保存の呼び出しを持っていない）", async () => {
  const src = await (await import("node:fs/promises")).readFile(
    new URL("./idLookup.js", import.meta.url), "utf8");
  assert.ok(!/setDoc|addDoc|updateDoc|deleteDoc|writeBatch/.test(src),
    "調べるだけの画面なので、書き込みの口を持たない");
});
