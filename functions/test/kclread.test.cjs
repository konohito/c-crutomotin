'use strict'
/* 問診票(様式 R7-03)マークシート読み取りの回帰テスト。
   実際の撮影写真と同じ構成(用紙が写真の一部に写り込み・説明文に「（はい・いいえ）」が含まれる・
   設問が 2 行に折り返す)の合成画像と Document AI レスポンスを作り、
   塗りつぶした通りの回答が読み取れることを検証する。 */
const assert = require('assert')
const jpeg = require('jpeg-js')
const { readKcl } = require('../src/kclread')

// ---- 用紙の設計値(SheetMaker.jsx と一致) ------------------------------------
const PAGE_W = 794, PAGE_H = 1123
const COL_YES = 640, COL_NO = 714   // 回答欄の中心 x(間隔 74px)
const OVAL_W = 15, OVAL_H = 21
// 写真: 1200×1600 の中に用紙(幅 900)が写っている想定(縦横比は保つ)
const IMG_W = 1200, IMG_H = 1600
const OFF_X = 100, OFF_Y = 60, SCALE = 900 / PAGE_W

const px = (x) => OFF_X + x * SCALE
const py = (y) => OFF_Y + y * SCALE
const nx = (x) => px(x) / IMG_W
const ny = (y) => py(y) / IMG_H

// おもて面の設問(印刷順)。wrap=true は 2 行に折り返す設問。
const ROWS = [
  { key: 1, text: 'バスや電車で１人で外出していますか' },
  { key: 2, text: '日用品の買い物をしていますか' },
  { key: 3, text: '預貯金の出し入れをしていますか' },
  { key: 4, text: '友人の家を訪ねていますか' },
  { key: 5, text: '家族や友人の相談にのっていますか' },
  { key: 6, text: '階段を手すりや壁をつたわらずに昇っていますか' },
  { key: 7, text: '椅子に座った状態から何もつかまらずに立ち上がっ|ていますか', wrap: true },
  { key: 8, text: '１５分位続けて歩いていますか' },
  { key: 9, text: 'この１年間に転んだことがありますか' },
  { key: 10, text: '転倒に対する不安は大きいですか' },
  { key: 11, text: '６ヶ月間で２〜３kg以上の体重減少がありました|か', wrap: true },
  { key: 13, text: '半年前に比べて固いものが食べにくくなりましたか' },
  { key: 14, text: 'お茶や汁物等でむせることがありますか' },
]
// 写真 1 枚目と同じ回答(はい/いいえ)
const EXPECT = {
  1: 'no', 2: 'yes', 3: 'yes', 4: 'no', 5: 'no', 6: 'yes', 7: 'yes',
  8: 'no', 9: 'yes', 10: 'yes', 11: 'no', 13: 'no', 14: 'yes',
}

const ROW_Y0 = 560, ROW_PITCH = 40, LINE_H = 22

// ---- 合成画像(白い用紙に楕円を塗る) -----------------------------------------
function makeImage() {
  const data = Buffer.alloc(IMG_W * IMG_H * 4)
  for (let y = 0; y < IMG_H; y++) {
    for (let x = 0; x < IMG_W; x++) {
      const i = (y * IMG_W + x) * 4
      const onSheet = x >= OFF_X && x < OFF_X + PAGE_W * SCALE && y >= OFF_Y && y < OFF_Y + PAGE_H * SCALE
      // 用紙は白(照明ムラを少し付ける)、外は机(暗い)
      const v = onSheet ? 236 - Math.round((y / IMG_H) * 18) : 120
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }
  const fill = (cxPage, cyPage) => {
    const cx = px(cxPage), cy = py(cyPage)
    const rx = (OVAL_W / 2) * SCALE, ry = (OVAL_H / 2) * SCALE
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        if (d > 1 || x < 0 || y < 0 || x >= IMG_W || y >= IMG_H) continue
        const i = (y * IMG_W + x) * 4
        data[i] = 38; data[i + 1] = 34; data[i + 2] = 30
      }
    }
  }
  ROWS.forEach((r, idx) => {
    const cy = ROW_Y0 + idx * ROW_PITCH
    fill(EXPECT[r.key] === 'yes' ? COL_YES : COL_NO, cy)
  })
  return jpeg.encode({ data, width: IMG_W, height: IMG_H }, 92).data
}

// ---- 合成 Document AI レスポンス ---------------------------------------------
function makeDoc() {
  let text = ''
  const tokens = [], lines = [], paragraphs = []
  const poly = (x0, y0, x1, y1) => ({
    normalizedVertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  })
  // 文字列を document.text に足し、その範囲を指す layout を返す
  const put = (s, box) => {
    const start = text.length
    text += s
    return { layout: { textAnchor: { textSegments: [{ startIndex: start, endIndex: text.length }] }, boundingPoly: poly(...box) } }
  }
  const box = (x0Page, y0Page, x1Page, y1Page) => [nx(x0Page), ny(y0Page), nx(x1Page), ny(y1Page)]

  // 見出し・説明文(様式番号と、説明文中の「（はい・いいえ）」)
  lines.push(put('様式 R7-03 令和7年度 からだデータ測定会 問診票', box(60, 100, 620, 130)))
  lines.push(put('あてはまる方（はい・いいえ）を、濃いペンで黒くぬりつぶしてください。', box(90, 250, 700, 274)))
  // ↑ この行の中の「はい」「いいえ」も OCR ではトークンとして出る(用紙の左寄り)
  tokens.push(put('はい', box(270, 252, 305, 272)))
  tokens.push(put('いいえ', box(325, 252, 375, 272)))
  lines.push(put('【基本チェックリスト】', box(60, 500, 260, 524)))
  // 回答欄の列見出し(用紙の右端。これが本来のアンカー)
  tokens.push(put('はい', box(COL_YES - 22, 496, COL_YES + 22, 522)))
  tokens.push(put('いいえ', box(COL_NO - 28, 496, COL_NO + 28, 522)))
  lines.push(put('記入例 「はい」と答えるとき', box(80, 526, 300, 548)))

  ROWS.forEach((r, idx) => {
    const cy = ROW_Y0 + idx * ROW_PITCH
    const parts = r.text.split('|')
    if (parts.length === 1) {
      lines.push(put(parts[0], box(80, cy - LINE_H / 2, 600, cy + LINE_H / 2)))
      paragraphs.push(put(parts[0], box(80, cy - LINE_H / 2, 600, cy + LINE_H / 2)))
    } else {
      // 2 行に折り返す設問: 行は 2 本、段落は両方をまとめた 1 つ
      const y1 = cy - LINE_H * 0.62, y2 = cy + LINE_H * 0.62
      lines.push(put(parts[0], box(80, y1 - LINE_H / 2, 600, y1 + LINE_H / 2)))
      lines.push(put(parts[1], box(80, y2 - LINE_H / 2, 300, y2 + LINE_H / 2)))
      paragraphs.push(put(parts.join(''), box(80, y1 - LINE_H / 2, 600, y2 + LINE_H / 2)))
    }
  })

  return {
    text,
    // 画像入力のとき Document AI の dimension は画像の画素数を返す
    pages: [{
      dimension: { width: IMG_W, height: IMG_H },
      tokens, lines, paragraphs,
    }],
  }
}

// ---- 実行 --------------------------------------------------------------------
const image = makeImage()
const doc = makeDoc()
const res = readKcl(doc, image, 'image/jpeg')

assert.strictEqual(res.isKcl, true, '問診票として判定されること')
assert.strictEqual(res.side, 'front', 'おもて面と判定されること')
assert.strictEqual(res.readable, true, '画像から読み取れること')

const wrong = []
for (const r of ROWS) {
  if (res.answers[r.key] !== EXPECT[r.key]) wrong.push(`No.${r.key}: 期待 ${EXPECT[r.key]} / 実際 ${res.answers[r.key]}`)
}
if (wrong.length) {
  console.error(`✗ ${wrong.length}/${ROWS.length} 問を誤読:\n  ` + wrong.join('\n  '))
  process.exit(1)
}
console.log(`✓ kclread: おもて面 ${ROWS.length} 問すべて正しく読み取り`)
