'use strict'
/* 問診票(様式 R7-03)マークシート読み取りの回帰テスト。
   実際の撮影写真と同じ条件(用紙が写真の一部に写り込み・説明文に「（はい・いいえ）」が含まれる・
   設問が 2 行に折り返す・手持ちで少し傾く・EXIF に回転情報が付く)の合成画像と
   Document AI レスポンスを作り、塗りつぶした通りの回答が読み取れることを検証する。 */
const assert = require('assert')
const jpeg = require('jpeg-js')
const { readKcl } = require('../src/kclread')
const { exifOrientation, orientMap } = require('../src/exif')

// ---- 用紙の設計値(SheetMaker.jsx と一致) ------------------------------------
const PAGE_W = 794, PAGE_H = 1123
const COL_YES = 640, COL_NO = 714   // 回答欄の中心 x(間隔 74px)
const OVAL_W = 15, OVAL_H = 21
// 写真: 1200×1600 の中に用紙(幅 900)が写っている想定(縦横比は保つ)
const IMG_W = 1200, IMG_H = 1600
const OFF_X = 100, OFF_Y = 60, SCALE = 900 / PAGE_W

// おもて面の設問(印刷順)。2 要素目に | があるものは 2 行に折り返す設問。
const ROWS = [
  { key: 1, text: 'バスや電車で１人で外出していますか' },
  { key: 2, text: '日用品の買い物をしていますか' },
  { key: 3, text: '預貯金の出し入れをしていますか' },
  { key: 4, text: '友人の家を訪ねていますか' },
  { key: 5, text: '家族や友人の相談にのっていますか' },
  { key: 6, text: '階段を手すりや壁をつたわらずに昇っていますか' },
  { key: 7, text: '椅子に座った状態から何もつかまらずに立ち上がっ|ていますか' },
  { key: 8, text: '１５分位続けて歩いていますか' },
  { key: 9, text: 'この１年間に転んだことがありますか' },
  { key: 10, text: '転倒に対する不安は大きいですか' },
  { key: 11, text: '６ヶ月間で２〜３kg以上の体重減少がありました|か' },
  { key: 13, text: '半年前に比べて固いものが食べにくくなりましたか' },
  { key: 14, text: 'お茶や汁物等でむせることがありますか' },
]
// 実際の記入写真と同じ回答
const EXPECT = {
  1: 'no', 2: 'yes', 3: 'yes', 4: 'no', 5: 'no', 6: 'yes', 7: 'yes',
  8: 'no', 9: 'yes', 10: 'yes', 11: 'no', 13: 'no', 14: 'yes',
}
const ROW_Y0 = 560, ROW_PITCH = 40, LINE_H = 22
const EXAMPLE_Y = 537   // 記入例の行(設問①の 23px 上。実際の用紙より詰めた厳しい条件)

// 用紙座標(page) → 写真座標。tilt(ラジアン)は手持ち撮影の傾き。
function makeXf(tilt) {
  const cos = Math.cos(tilt), sin = Math.sin(tilt)
  const X0 = PAGE_W / 2, Y0 = PAGE_H / 2
  const cx0 = OFF_X + X0 * SCALE, cy0 = OFF_Y + Y0 * SCALE
  const fwd = (X, Y) => [
    cx0 + ((X - X0) * cos - (Y - Y0) * sin) * SCALE,
    cy0 + ((X - X0) * sin + (Y - Y0) * cos) * SCALE,
  ]
  // 写真座標 → 用紙座標(背景の描画に使う逆変換)
  const inv = (px, py) => {
    const u = (px - cx0) / SCALE, v = (py - cy0) / SCALE
    return [X0 + u * cos + v * sin, Y0 - u * sin + v * cos]
  }
  return { fwd, inv }
}

// ---- 合成画像(机の上に置いた白い用紙に楕円を塗る) ---------------------------
function makeImage(xf, blank, style) {
  const data = Buffer.alloc(IMG_W * IMG_H * 4)
  for (let y = 0; y < IMG_H; y++) {
    for (let x = 0; x < IMG_W; x++) {
      const i = (y * IMG_W + x) * 4
      const [X, Y] = xf.inv(x + 0.5, y + 0.5)
      const onSheet = X >= 0 && X < PAGE_W && Y >= 0 && Y < PAGE_H
      // 用紙は白(照明ムラを少し付ける)、外は机(暗い)
      const v = onSheet ? 236 - Math.round((y / IMG_H) * 18) : 120
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }
  const ink = (x, y) => {
    if (x < 0 || y < 0 || x >= IMG_W || y >= IMG_H) return
    const i = (Math.round(y) * IMG_W + Math.round(x)) * 4
    data[i] = 38; data[i + 1] = 34; data[i + 2] = 30
  }
  /* 記入のばらつきを再現する。
     full=枠どおり / over=はみ出す / small=枠より小さい / offset=中心がずれる / line=斜線 */
  const fill = (cxPage, cyPage, style = 'full') => {
    const k = style === 'over' ? 1.35 : style === 'small' ? 0.6 : 1
    const offX = style === 'offset' ? OVAL_W * 0.3 : 0
    const offY = style === 'offset' ? OVAL_H * 0.25 : 0
    const [cx, cy] = xf.fwd(cxPage + offX, cyPage + offY)
    const rx = (OVAL_W / 2) * SCALE * k, ry = (OVAL_H / 2) * SCALE * k
    if (style === 'line') {
      // 枠を斜めに横切る太い線(「悪い例」の線だけの記入)
      const [x0, y0] = xf.fwd(cxPage - OVAL_W * 0.55, cyPage - OVAL_H * 0.55)
      const [x1, y1] = xf.fwd(cxPage + OVAL_W * 0.55, cyPage + OVAL_H * 0.55)
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2
      for (let s = 0; s <= n; s++) {
        const bx = x0 + ((x1 - x0) * s) / n, by = y0 + ((y1 - y0) * s) / n
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) ink(bx + dx, by + dy)
      }
      return
    }
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue
        ink(x, y)
      }
    }
  }
  // 記入例の行(設問①のすぐ上)には「はい」が塗られた見本が印刷されている。
  // 設問①の判定がこれを拾わないことも検証する。
  fill(COL_YES, EXAMPLE_Y)
  if (!blank) ROWS.forEach((r, idx) => fill(EXPECT[r.key] === 'yes' ? COL_YES : COL_NO, ROW_Y0 + idx * ROW_PITCH, style))
  return data
}

// ---- 合成 Document AI レスポンス ---------------------------------------------
function makeDoc(xf) {
  let text = ''
  const tokens = [], lines = [], paragraphs = []
  // 用紙上の矩形 → 写真上の四隅(傾けると平行四辺形になる。Document AI も四隅を返す)
  const put = (s, x0, y0, x1, y1) => {
    const start = text.length
    text += s
    const vs = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([X, Y]) => {
      const [px, py] = xf.fwd(X, Y)
      return { x: px / IMG_W, y: py / IMG_H }
    })
    return { layout: { textAnchor: { textSegments: [{ startIndex: start, endIndex: text.length }] }, boundingPoly: { normalizedVertices: vs } } }
  }

  lines.push(put('様式 R7-03 令和7年度 からだデータ測定会 問診票', 60, 100, 620, 130))
  lines.push(put('あてはまる方（はい・いいえ）を、濃いペンで黒くぬりつぶしてください。', 90, 250, 700, 274))
  // ↑ この行の中の「はい」「いいえ」も OCR ではトークンとして出る(用紙の左寄り)
  tokens.push(put('はい', 270, 252, 305, 272))
  tokens.push(put('いいえ', 325, 252, 375, 272))
  lines.push(put('【基本チェックリスト】', 60, 500, 260, 524))
  // 回答欄の列見出し(用紙の右端。これが本来のアンカー)
  tokens.push(put('はい', COL_YES - 22, 496, COL_YES + 22, 522))
  tokens.push(put('いいえ', COL_NO - 28, 496, COL_NO + 28, 522))
  const exLine = put('記入例 「はい」と答えるとき', 80, EXAMPLE_Y - 11, 300, EXAMPLE_Y + 11)
  lines.push(exLine)

  /* Document AI は連続する行をまとめて 1 つの段落として返す。設問が 1 問ずつ
     別々の段落になるとは限らず、2〜3 問がまとめられることも多い。
     ここでは記入例＋設問①、以降は 2〜3 問ずつをまとめた現実的な段落を作る。 */
  const groups = [[-1, 0], [1, 2], [3, 4, 5], [6, 7], [8, 9], [10, 11], [12]]
  const span = { top: {}, bottom: {}, left: {}, right: {} }
  ROWS.forEach((r, idx) => {
    const cy = ROW_Y0 + idx * ROW_PITCH
    const parts = r.text.split('|')
    if (parts.length === 1) {
      lines.push(put(parts[0], 80, cy - LINE_H / 2, 600, cy + LINE_H / 2))
      span.top[idx] = cy - LINE_H / 2; span.bottom[idx] = cy + LINE_H / 2
      span.left[idx] = 80; span.right[idx] = 600
    } else {
      // 2 行に折り返す設問: 行は上下 2 本(2 行目は短く、字下げされる)
      const y1 = cy - LINE_H * 0.62, y2 = cy + LINE_H * 0.62
      lines.push(put(parts[0], 80, y1 - LINE_H / 2, 600, y1 + LINE_H / 2))
      lines.push(put(parts[1], 96, y2 - LINE_H / 2, 300, y2 + LINE_H / 2))
      span.top[idx] = y1 - LINE_H / 2; span.bottom[idx] = y2 + LINE_H / 2
      span.left[idx] = 80; span.right[idx] = 600
    }
  })
  for (const g of groups) {
    const tops = g.map(i => (i < 0 ? EXAMPLE_Y - 11 : span.top[i]))
    const bots = g.map(i => (i < 0 ? EXAMPLE_Y + 11 : span.bottom[i]))
    const txt = g.map(i => (i < 0 ? '記入例 「はい」と答えるとき' : ROWS[i].text.split('|').join(''))).join('')
    paragraphs.push(put(txt, 80, Math.min(...tops), 600, Math.max(...bots)))
  }
  // 画像入力のとき Document AI の dimension は(回転補正後の)画素数を返す
  return { text, pages: [{ dimension: { width: IMG_W, height: IMG_H }, tokens, lines, paragraphs }] }
}

// ---- EXIF 付き JPEG の組み立て ------------------------------------------------
// 表示向きの画素 → orientation 6(右 90 度回転して表示)で保存したときの生画素
function toStoredOrient6(display) {
  const rw = IMG_H, rh = IMG_W
  const out = Buffer.alloc(rw * rh * 4)
  for (let yi = 0; yi < rh; yi++) {
    for (let xi = 0; xi < rw; xi++) {
      const xo = IMG_W - 1 - yi, yo = xi
      const src = (yo * IMG_W + xo) * 4, dst = (yi * rw + xi) * 4
      display.copy(out, dst, src, src + 4)
    }
  }
  return { data: out, width: rw, height: rh }
}
// APP1(Exif) セグメントを SOI の直後に差し込む
function withExifOrientation(jpegBuf, orient) {
  const app1 = Buffer.from([
    0xFF, 0xE1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // APP1 / len / "Exif\0\0"
    0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08,             // TIFF(ビッグエンディアン) / IFD0 offset
    0x00, 0x01,                                                  // エントリ数 1
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orient, 0x00, 0x00, // Orientation
    0x00, 0x00, 0x00, 0x00,                                      // 次の IFD なし
  ])
  return Buffer.concat([jpegBuf.slice(0, 2), app1, jpegBuf.slice(2)])
}

// ---- 実行 --------------------------------------------------------------------
let failed = 0
function run(label, { tiltDeg = 0, orient = 1, blank = false, style = 'full' } = {}) {
  const xf = makeXf((tiltDeg * Math.PI) / 180)
  const display = makeImage(xf, blank, style)
  let buf
  if (orient === 6) {
    const st = toStoredOrient6(display)
    buf = withExifOrientation(jpeg.encode({ data: st.data, width: st.width, height: st.height }, 92).data, 6)
  } else {
    buf = jpeg.encode({ data: display, width: IMG_W, height: IMG_H }, 92).data
  }
  const res = readKcl(makeDoc(xf), buf, 'image/jpeg')
  assert.strictEqual(res.isKcl, true, `${label}: 問診票として判定されること`)
  assert.strictEqual(res.side, 'front', `${label}: おもて面と判定されること`)
  if (!res.readable) {
    console.error(`✗ ${label}: 読み取り不可 (${res.reason})`)
    failed++
    return
  }
  const want = (r) => (blank ? null : EXPECT[r.key])
  const wrong = ROWS.filter(r => res.answers[r.key] !== want(r))
    .map(r => `No.${r.key}: 期待 ${want(r)} / 実際 ${res.answers[r.key]}`)
  if (wrong.length) {
    console.error(`✗ ${label}: ${wrong.length}/${ROWS.length} 問を誤読\n  ` + wrong.join('\n  '))
    failed++
    return
  }
  console.log(`✓ ${label}: ${ROWS.length} 問すべて正しく読み取り`)
}

// EXIF 解析の単体確認
{
  const plain = jpeg.encode({ data: Buffer.alloc(4 * 4 * 4, 255), width: 4, height: 4 }, 80).data
  assert.strictEqual(exifOrientation(plain), 1, 'EXIF が無ければ 1')
  assert.strictEqual(exifOrientation(withExifOrientation(plain, 6)), 6, 'Orientation 6 を読めること')
  assert.strictEqual(exifOrientation(withExifOrientation(plain, 8)), 8, 'Orientation 8 を読めること')
  const m = orientMap(6, 100, 200)   // 右 90 度 → 表示は 200×100
  assert.strictEqual(m.W, 200); assert.strictEqual(m.H, 100)
  assert.deepStrictEqual(m.at(0, 0), [0, 199], '表示左上は生画素の左下')
  console.log('✓ exif: 回転情報の解析と座標の引き直し')
}

run('傾きなし・回転情報なし')
run('手持ちの傾き 2.5 度', { tiltDeg: 2.5 })
run('手持ちの傾き -3 度', { tiltDeg: -3 })
run('手持ちの傾き 5 度', { tiltDeg: 5 })
run('EXIF 回転あり(orientation 6)', { orient: 6 })
run('EXIF 回転あり + 傾き 2 度', { orient: 6, tiltDeg: 2 })
// 記入のばらつき(はみ出す・枠より小さい・中心がずれる・斜線)
run('はみ出した塗り', { style: 'over' })
run('枠より小さい塗り', { style: 'small' })
run('中心がずれた塗り', { style: 'offset' })
run('中心がずれた塗り + 傾き 3 度', { style: 'offset', tiltDeg: 3 })
run('斜線だけの記入', { style: 'line' })
// 未記入の用紙で「記入例」の塗りを拾って誤検出しないこと
run('白紙(記入例のみ印刷)', { blank: true })
run('白紙 + 傾き 3 度', { blank: true, tiltDeg: 3 })

if (failed) { console.error(`\n${failed} 件失敗`); process.exit(1) }
console.log('\nkclread: すべて成功')
