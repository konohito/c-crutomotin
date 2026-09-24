/* 測定日の書き方を1つに揃える処理（compactDate）。

   2026-09-24 ユーザー報告:
     「PDF一括印刷 測定日をプルダウンで選択するも反映されず、
       『測定日を選んでください』のままになる」

   原因: プルダウンの選択肢は区切りの無い 8 桁（20260907）を値に持っているのに、
         compactDate が区切りのある書き方しか受け付けず空を返していた。
         → 選んだ直後に選択が空へ戻る（保存もされない）。
   ここでは「8 桁も受ける」ことと、画面の配線が噛み合っていることを固定する。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compactDate, normDate, measKey } from './realdata.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('区切りの無い8桁をそのまま受ける（これが直したところ）', () => {
  assert.equal(compactDate('20260907'), '20260907')
  assert.equal(compactDate(' 20260907 '), '20260907')
})

test('これまでどおりの書き方も受ける', () => {
  assert.equal(compactDate('2026/09/07'), '20260907')
  assert.equal(compactDate('2026/9/7'), '20260907')
  assert.equal(compactDate('2026-09-07'), '20260907')
  assert.equal(compactDate('2026年9月7日'), '20260907')
})

test('日付でないものは空のまま（何でも通さない）', () => {
  assert.equal(compactDate(''), '')
  assert.equal(compactDate(null), '')
  assert.equal(compactDate(undefined), '')
  assert.equal(compactDate('202609'), '')      // 6桁
  assert.equal(compactDate('2026090'), '')     // 7桁
  assert.equal(compactDate('202609071'), '')   // 9桁
  assert.equal(compactDate('あ'), '')
})

test('同じ日は同じ値になる（数え違いが起きない）', () => {
  const forms = ['20260907', '2026/09/07', '2026/9/7', '2026-9-07']
  const got = new Set(forms.map(compactDate))
  assert.equal(got.size, 1, '書き方が違っても1つに揃う')
})

test('他の処理に横やりを入れていない', () => {
  assert.equal(normDate('2026/9/7'), '2026/09/07')
  assert.equal(measKey('U001', '2026/9/7', 2026), 'U001_20260907')
  // 8桁を受けるようになったので、測定キーも年度ではなく日付で作れる
  assert.equal(measKey('U001', '20260907', 2026), 'U001_20260907')
})

test('PDF一括印刷の測定日プルダウンが噛み合っている', () => {
  const src = fs.readFileSync(path.join(here, '..', 'screens', 'PdfExport.jsx'), 'utf8')
  // 選択肢の値は compactDate で作った 8 桁（d.key）
  assert.match(src, /const k = compactDate\(r\.date\)/)
  assert.match(src, /opt\(d\.key, d\.date/)
  // 選んだ値を読み戻すときも同じ処理を通す（ここが空を返すと選べない）
  assert.match(src, /value=\{compactDate\(state\.pdfDate \|\| ''\) \|\| ''\}/)
  assert.match(src, /set\(\{ pdfDate: e\.target\.value \}\)/)
  // 対象者の抽出も同じ 8 桁で突き合わせている
  assert.match(src, /compactDate\(x\.date\) === pdfDateKey/)
})
