/* 測定日でPDFを出すとき、団体ごとに分けられるか（2026-10-08 新設）
 *
 * ★現場からの報告
 *   「同日に2グループ測定した時の、PDF出力→印刷がダブって出てくるので、
 *     分けて出力できるとすごいスムーズかと思いました」
 *   「今日が1グループのみだったので気づかんだったかもです」
 *
 * ★原因
 *   測定日で出すモードには**団体の絞り込みが1つも無かった**。
 *   市町村モードには元から絞り込みがあるのに、測定日モードは日付しか見ておらず、
 *   その日に測った全団体が1束で出ていた。1日1団体の運用では気づけなかった。
 *
 * ★ここで守ること
 *   1) 団体で絞れる（既定は「この日の全員」＝今までどおり）
 *   2) 絞り込みは**一覧の段階で1回だけ**かける
 *      （結果票と測定値を別々に絞ると添字がずれ、**別人の測定値が刷られる**）
 *   3) 団体は「その測定日のときの団体」で引く（結果票のヘッダと同じ引き方）
 *   4) 市町村モードの絞り込みとは別に持つ（互いに書き換えない）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'src/screens/PdfExport.jsx'), 'utf8')
const STORE = fs.readFileSync(path.join(ROOT, 'src/store.jsx'), 'utf8')

test('団体の絞り込みがある', () => {
  assert.match(SRC, /const dateWard = state\.pdfDateWard \|\| 'all'/,
    '団体の選択を読んでいない')
  assert.match(SRC, /dateWard === 'all' \? dateHits : dateHits\.filter\(/,
    '既定が「この日の全員」になっていない')
  assert.match(SRC, /districtOf\(h\.u, h\.m\)\.ward === dateWard/,
    'その測定日のときの団体で引いていない（結果票のヘッダと食い違う）')
})

test('結果票と測定値が同じ一覧から出る（別人の値を刷らない）', () => {
  /* ここが今回いちばん危ないところ。scope（誰のぶんを刷るか）と
     picks（どの測定値を刷るか）を別々に絞ると、添字がずれて取り違える。 */
  assert.match(SRC,
    /scope = dateHitsShown\.map\(h => h\.u\); picks = dateHitsShown\.map\(h => h\.m\)/,
    '結果票と測定値が別々の一覧から出ている（別人の値が刷られる）')
  assert.doesNotMatch(SRC, /scope = dateHits\.map\(h => h\.u\)/,
    '絞り込み前の一覧を使っている（団体で分けても全員出てしまう）')
})

test('市町村モードの絞り込みとは別のキーを持つ', () => {
  assert.match(STORE, /pdfDateWard: 'all'/, '測定日モード用のキーが無い')
  assert.match(STORE, /pdfWard: 'all'/, '市町村モード用のキーが消えている')
  /* 同じキーを使い回していないこと */
  assert.doesNotMatch(SRC, /set\(\{ pdfWard: e\.target\.value \}\)[\s\S]{0,200}pdfMode === 'date'/,
    '測定日モードで市町村モードのキーを書き換えている')
})

test('絞り込みの計算を実際に動かす', () => {
  /* 実装と同じ形をここで組み立てて動かす */
  const districtOf = (u, m) => ({ ward: m.ward })
  const hits = [
    { u: { id: 'A1' }, m: { ward: '上島', v: 1 } },
    { u: { id: 'A2' }, m: { ward: '下島', v: 2 } },
    { u: { id: 'A3' }, m: { ward: '上島', v: 3 } },
    { u: { id: 'A4' }, m: { ward: '下島', v: 4 } },
  ]
  const shownOf = (w) => (w === 'all' ? hits : hits.filter(h => districtOf(h.u, h.m).ward === w))

  const all = shownOf('all')
  assert.equal(all.length, 4, '既定で全員が出ない')

  const kami = shownOf('上島')
  assert.equal(kami.length, 2, '団体で絞れていない')
  assert.deepEqual(kami.map(h => h.u.id), ['A1', 'A3'], '別の団体の方が混ざっている')

  /* ★添字が揃うこと。ここがずれると別人の測定値が刷られる。 */
  const scope = kami.map(h => h.u)
  const picks = kami.map(h => h.m)
  assert.equal(scope.length, picks.length, '人数と測定値の数が合わない')
  scope.forEach((u, i) => {
    const want = hits.find(h => h.u.id === u.id).m.v
    assert.equal(picks[i].v, want, `${u.id} に別人の測定値が付いている`)
  })

  /* ★直す前はこうなっていた（絞り込み前の一覧から出す）＝全員が出る */
  const scopeOld = hits.map(h => h.u)
  assert.notEqual(scopeOld.length, kami.length, '直す前と同じ結果になっている（直っていない）')
})

test('団体が1つの日は見え方が変わらない', () => {
  /* 選択肢が2つ以上あるときだけ団体のプルダウンを出す。
     1団体しか測らなかった日（今日までの運用）は今までどおり。 */
  assert.match(SRC, /dateWardOpts\.length > 1 && \(/,
    '団体が1つの日にも選択肢を出している（今までの使い方が変わる）')
})

test('枚数が多いときの案内に団体が入っている', () => {
  assert.match(SRC, /市町村・測定日・団体で分けて出してください/,
    '上限に当たったときの案内に団体が入っていない')
})
