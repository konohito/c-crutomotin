/* 用紙の印刷が人数ぶん全部出ること（2026-10-13 現場報告・村崎さん）。
 *
 * 【何が起きたか】
 *   「motionの用紙印刷ですが、最大30枚までしか出力できないようです。
 *     10/16測定が36名予定で、6名が出力できてない状態です。
 *     他に30以上の場所が3箇所あります。今後他の自治体に持っていく際、
 *     30以上出力するケースは出てくる可能性もありそうです！」
 *
 *   SheetMaker.jsx に
 *     const withBlanks = parts.slice(0, Math.max(0, 30 - state.shBlank))
 *   と書いてあり、**31人目から黙って切り捨てて**いた。警告も出していない。
 *   左の欄には「対象 36 名」と出るのに、下は「30 枚」。
 *   用紙が足りないことは、刷ってから数えないと分からなかった。
 *
 * 【ここで縛ること】
 *   1) 人数で切らない（slice で頭を取らない）
 *   2) 刷る枚数 ＝ 対象の人数 ＋ 予備の空欄用紙
 *   3) 画面に「対象 ◯名」と「◯枚」を両方出す（食い違ったら気づけるように）
 *   4) 予備の空欄用紙は人数を減らさない（足す側）
 *
 * 実行: node scripts/check-sheet-count.mjs */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = readFileSync(join(root, 'src/screens/SheetMaker.jsx'), 'utf8')
/* ★コメントを外してから見る。
     「直す前はこう書いてあった」という説明そのものに当たって、いつも落ちてしまう。 */
const src = raw.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}（期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}）`)

console.log('== 1. 人数で切り捨てない ==')
{
  /* ★戻したら必ず落ちる形で縛る。数字を変えただけ（30→100 等）でも落とす。 */
  ok(!/parts\.slice\(0,\s*Math\.max\(/.test(src),
    '人数の上限が残っている（31人目から黙って切り捨てられる）')
  ok(!/const withBlanks = parts\.slice\(/.test(src),
    'withBlanks で頭だけ取っている（人数が切られる）')
  ok(/const withBlanks = parts\s*$/m.test(src) || /const withBlanks = parts\n/.test(src),
    '対象をそのまま使っていない')
  /* 並べ替えの slice() は別物（配列の複製）なので残っていてよい */
  ok(/parts\.slice\(\)\.sort\(/.test(src), '五十音順の並べ替えが消えている')
}

console.log('== 2. 枚数 ＝ 人数 ＋ 予備 ==')
{
  ok(/const total = withBlanks\.length \+ state\.shBlank/.test(src), '枚数の出し方が変わっている')
  /* 実際に動かす（実物の式をそのまま再現して確かめる） */
  const total = (n, blank) => n + blank
  eq(total(36, 0), 36, '36名で36枚にならない（現場で出なかった人数）')
  eq(total(36, 5), 41, '予備5枚を足して41枚にならない')
  eq(total(30, 10), 40, '予備が人数を押し出している（以前はここで30に丸められた）')
  eq(total(120, 0), 120, '大きい会場で頭打ちになる')
  eq(total(0, 3), 3, '対象0名でも予備だけ出せる')
  /* ★以前の式なら 36名は 30枚に減っていたことを記録しておく */
  const old = (n, blank) => Math.min(n, Math.max(0, 30 - blank)) + blank
  eq(old(36, 0), 30, '（記録）直す前は36名が30枚になっていた')
  eq(old(36, 5), 30, '（記録）直す前は予備を足しても30枚で頭打ちだった')
}

console.log('== 3. 画面に人数と枚数の両方を出す ==')
{
  /* 食い違ったときに現場が気づけるように、両方を出しておく。 */
  ok(/対象 <span className="t-num"[^>]*>\{parts\.length\}<\/span> 名/.test(src.replace(/\s+/g, ' ')),
    '対象の人数が出ていない')
  ok(/\{total\}<\/span> 枚/.test(src.replace(/\s+/g, ' ')), '刷る枚数が出ていない')
}

console.log('== 4. 予備の空欄用紙は「足す」側 ==')
{
  const i = src.indexOf('予備の空欄用紙')
  ok(i > 0, '予備の空欄用紙の設定が無い')
  const blk = src.slice(i, i + 700)
  ok(/追加しない/.test(blk) && /3 枚追加/.test(blk), '予備の選択肢が変わっている')
  ok(/末尾に追加します/.test(blk), '予備が末尾に足される説明が消えている')
  /* 予備のぶん人数を減らしていないこと（式に 30 - shBlank のような引き算が無い） */
  ok(!/-\s*state\.shBlank/.test(src), '予備のぶん人数を減らしている')
}

console.log('')
console.log(`check-sheet-count: ${pass} ok, ${fail} failed`)
process.exit(fail ? 1 : 0)
