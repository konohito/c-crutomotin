'use strict'
/* 問診票(様式 R7-03)マークシート読み取りの回帰テスト。
   実際の撮影写真と同じ条件(用紙が写真の一部に写り込み・説明文に「（はい・いいえ）」が含まれる・
   設問が 2 行に折り返す・手持ちで少し傾く・EXIF に回転情報が付く)の合成画像と
   Document AI レスポンスを作り、塗りつぶした通りの回答が読み取れることを検証する。

   実物との一致で特に大事な点:
   ・設問の文字は回答欄の楕円と同じ行にある(読み取りはこれを位置合わせの検算に使う)
   ・楕円の枠線は塗っていなくても印刷されている(読み取りはこれに窓を吸着させる)
   ・様式(シール/印字/当日受付)で行位置が 2% ほど違う・机の明るさは用紙と近いことがある */
const assert = require('assert')
const jpeg = require('jpeg-js')
const { readKcl } = require('../src/kclread')
const { exifOrientation, orientMap } = require('../src/exif')
const LAYOUT = require('../src/kcllayout')

// ---- 用紙の設計値(SheetMaker.jsx と一致) ------------------------------------
const PAGE_W = 794, PAGE_H = 1123
const OVAL_W = 15, OVAL_H = 21
const LINE_H = 22
// 写真: 1200×1600 の中に用紙(幅 900)が写っている想定(縦横比は保つ)
const IMG_W = 1200, IMG_H = 1600
const OFF_X = 100, OFF_Y = 60, SCALE = 900 / PAGE_W

// 設問(印刷順)。text に | があるものは 2 行に折り返す設問。
const FRONT_ROWS = [
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
const FRONT_EXPECT = {
  1: 'no', 2: 'yes', 3: 'yes', 4: 'no', 5: 'no', 6: 'yes', 7: 'yes',
  8: 'no', 9: 'yes', 10: 'yes', 11: 'no', 13: 'no', 14: 'yes',
}
// うら面。最後の 2 問は【運動習慣について】として別の見出し(はい・いいえ)の下に並ぶ
const BACK_ROWS = [
  { key: 15, text: '口の渇きが気になりますか' },
  { key: 16, text: '週に１回以上は外出していますか' },
  { key: 17, text: '昨年と比べて外出の回数が減っていますか' },
  { key: 18, text: '周りの人から「いつも同じ事を聞く」などの物忘れ|があると言われますか' },
  { key: 19, text: '自分で電話番号を調べて、電話をかけることをして|いますか' },
  { key: 20, text: '今日が何月何日かわからない時がありますか' },
  { key: 21, text: '（ここ２週間）毎日の生活に充実感がない' },
  { key: 22, text: '（ここ２週間）これまで楽しんでやれていたことが|楽しめなくなった' },
  { key: 23, text: '（ここ２週間）以前は楽にできていたことが今はお|っくうに感じられる' },
  { key: 24, text: '（ここ２週間）自分が役に立つ人間だと思えない' },
  { key: 25, text: '（ここ２週間）わけもなく疲れたような感じがする' },
  { key: 'ex1', text: '週1回程度の定期的な運動・スポーツをしています|か', section: 1 },
  { key: 'ex2', text: '自宅や自宅外で、ストレッチや筋トレなどの運動を|週1回以上は行なっていますか', section: 1 },
]
const BACK_EXPECT = {
  15: 'yes', 16: 'no', 17: 'no', 18: 'no', 19: 'yes', 20: 'yes', 21: 'no',
  22: 'no', 23: 'yes', 24: 'yes', 25: 'yes', ex1: 'yes', ex2: 'no',
}

// 面ごとの構成。うら面は【運動習慣について】の見出し(はい・いいえ)がもう 1 組ある。
const SIDES = {
  front: { side: 'front', rows: FRONT_ROWS, expect: FRONT_EXPECT, intro: true, example: true, title: '【基本チェックリスト】' },
  back: { side: 'back', rows: BACK_ROWS, expect: BACK_EXPECT, intro: false, example: false, title: '【基本チェックリスト（つづき）】' },
}
/* 各設問の行 y は座標表(kcllayout)から取る。実際の用紙では設問の文字と回答欄の
   楕円が同じ行に並ぶ(読み取りはこの一致を位置合わせの検算に使う)。 */
function layout(cfg, variant = 'seal') {
  const table = LAYOUT.variants[variant][cfg.side]
  const rowY = cfg.rows.map(r => table[String(r.key)].yes[1] * PAGE_H)
  const exampleY = table.example ? table.example.yes[1] * PAGE_H : null
  // 見出し(はい/いいえ)の y: 各セクション先頭行の少し上
  const headers = [(exampleY != null ? exampleY : rowY[0]) - 30]
  cfg.rows.forEach((r, i) => {
    if (i > 0 && (r.section || 0) !== (cfg.rows[i - 1].section || 0)) headers.push(rowY[i] - 30)
  })
  return { rowY, headers, exampleY }
}

/* 用紙座標(page) → 写真座標。実写に合わせて 射影変換(回転 + 遠近のゆがみ)で作る。
   手持ちのスマホは用紙と完全に平行にならないため、上下で幅が変わる台形のゆがみが入る。
   persp は「上端が下端より何割狭いか」の目安(0.06 = 6%)。 */
function makeXf(tilt, persp = 0) {
  const cos = Math.cos(tilt), sin = Math.sin(tilt)
  const X0 = PAGE_W / 2, Y0 = PAGE_H / 2
  const cx0 = OFF_X + X0 * SCALE, cy0 = OFF_Y + Y0 * SCALE
  // 3x3 の射影行列(u,v は用紙中心からの相対座標)
  const g = 0, h = persp / (PAGE_H / 2)   // v が小さい(上)ほど w が小さくなり拡大 → 台形
  const M = [
    [cos * SCALE, -sin * SCALE, cx0],
    [sin * SCALE, cos * SCALE, cy0],
    [g, h, 1],
  ]
  const fwd = (X, Y) => {
    const u = X - X0, v = Y - Y0
    const w = M[2][0] * u + M[2][1] * v + 1
    return [(M[0][0] * u + M[0][1] * v + M[0][2]) / w, (M[1][0] * u + M[1][1] * v + M[1][2]) / w]
  }
  // 逆変換(背景の描画に使う)。3x3 の逆行列を求めて同じ形で適用する
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const dt = det3(M)
  const co = (r, c) => {
    const rs = [0, 1, 2].filter(i => i !== r), cs = [0, 1, 2].filter(i => i !== c)
    const m = M[rs[0]][cs[0]] * M[rs[1]][cs[1]] - M[rs[0]][cs[1]] * M[rs[1]][cs[0]]
    return ((r + c) % 2 ? -m : m) / dt
  }
  const Mi = [[co(0, 0), co(1, 0), co(2, 0)], [co(0, 1), co(1, 1), co(2, 1)], [co(0, 2), co(1, 2), co(2, 2)]]
  const inv = (px, py) => {
    const w = Mi[2][0] * px + Mi[2][1] * py + Mi[2][2]
    const u = (Mi[0][0] * px + Mi[0][1] * py + Mi[0][2]) / w
    const v = (Mi[1][0] * px + Mi[1][1] * py + Mi[1][2]) / w
    return [X0 + u, Y0 + v]
  }
  return { fwd, inv }
}

// ---- 合成画像(机の上に置いた白い用紙に楕円を塗る) ---------------------------
function makeImage(xf, cfg, lay, o = {}) {
  const deskLum = o.deskLum != null ? o.deskLum : 120
  const table = LAYOUT.variants[o.imgVariant || 'seal'][cfg.side]
  const shift = o.ovalShift || 0    // 回答欄だけのずれ(用紙の反りの再現。文字は動かさない)
  const data = Buffer.alloc(IMG_W * IMG_H * 4)
  for (let y = 0; y < IMG_H; y++) {
    for (let x = 0; x < IMG_W; x++) {
      const i = (y * IMG_W + x) * 4
      const [X, Y] = xf.inv(x + 0.5, y + 0.5)
      const onSheet = X >= 0 && X < PAGE_W && Y >= 0 && Y < PAGE_H
      // 用紙は白(照明ムラを少し付ける)、外は机
      const v = onSheet ? 236 - Math.round((y / IMG_H) * 18) : deskLum
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
  // 楕円の枠線(実際の用紙には塗っていなくても印刷されている。読み取りの吸着の目印)
  const ringDraw = (cxPage, cyPage) => {
    const [cx, cy] = xf.fwd(cxPage, cyPage)
    const rx = (OVAL_W / 2) * SCALE, ry = (OVAL_H / 2) * SCALE
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const r2 = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
        if (r2 > 1 || r2 < 0.6) continue   // 枠線 2px ぶんの帯
        ink(x, y)
      }
    }
  }
  // 四隅の位置合わせマーカー(読み取りはこれを基準に用紙座標へ引き直す)
  const MK = o.noMarkers ? {} : LAYOUT.markers
  const mkHalf = (17 / 2)
  for (const k of Object.keys(MK)) {
    const cxP = MK[k][0] * PAGE_W, cyP = MK[k][1] * PAGE_H
    for (let dy = -mkHalf; dy <= mkHalf; dy += 0.5) {
      for (let dx = -mkHalf; dx <= mkHalf; dx += 0.5) {
        const [ix, iy] = xf.fwd(cxP + dx, cyP + dy)
        for (let sy = 0; sy <= 1; sy++) for (let sx = 0; sx <= 1; sx++) ink(ix + sx, iy + sy)
      }
    }
  }
  // 机の上のにせマーカー(木の節・影などの黒い角。写真の隅と用紙のそばに置く)
  if (o.distractors) {
    for (const [px, py] of [[26, 30], [IMG_W - 44, 34], [24, IMG_H - 46], [IMG_W - 46, IMG_H - 42], [60, 800]]) {
      for (let yy = 0; yy < 14; yy++) for (let xx = 0; xx < 14; xx++) ink(px + xx, py + yy)
    }
  }
  // すべての回答欄の楕円の枠線(記入例の行も含む)
  for (const r of [{ key: 'example' }].concat(cfg.rows)) {
    const cell = table[String(r.key)]
    if (!cell) continue
    ringDraw(cell.yes[0] * PAGE_W, cell.yes[1] * PAGE_H + shift)
    ringDraw(cell.no[0] * PAGE_W, cell.no[1] * PAGE_H + shift)
  }
  /* 記入例の行(設問①のすぐ上)には「はい」が塗られた見本が印刷されている。
     実際の用紙と同じ位置に置いて、設問①の判定がこれを拾わないことも検証する。 */
  const ex = table.example
  if (ex) fill(ex.yes[0] * PAGE_W, ex.yes[1] * PAGE_H + shift)
  // 回答欄は実際の用紙と同じ位置(実測レイアウト)に置く
  if (!o.blank) cfg.rows.forEach((r) => {
    const cell = table[String(r.key)]
    if (!cell) return
    const col = cfg.expect[r.key] === 'yes' ? cell.yes : cell.no
    fill(col[0] * PAGE_W, col[1] * PAGE_H + shift, o.style || 'full')
  })
  return data
}

// ---- 合成 Document AI レスポンス ---------------------------------------------
function makeDoc(xf, cfg, lay) {
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
  if (cfg.intro) {
    lines.push(put('あてはまる方（はい・いいえ）を、濃いペンで黒くぬりつぶしてください。', 90, 250, 700, 274))
    // ↑ この行の中の「はい」「いいえ」も OCR ではトークンとして出る(用紙の左寄り)
    tokens.push(put('はい', 270, 252, 305, 272))
    tokens.push(put('いいえ', 325, 252, 375, 272))
  }
  // 各セクションの見出しと、回答欄の列見出し(用紙の右端)
  const COL_YES = LAYOUT.variants.seal[cfg.side][String(cfg.rows[0].key)].yes[0] * PAGE_W
  const COL_NO = LAYOUT.variants.seal[cfg.side][String(cfg.rows[0].key)].no[0] * PAGE_W
  lay.headers.forEach((hy, si) => {
    lines.push(put(si === 0 ? cfg.title : '【運動習慣について】', 60, hy - 9, 260, hy + 15))
    tokens.push(put('はい', COL_YES - 22, hy - 13, COL_YES + 22, hy + 13))
    tokens.push(put('いいえ', COL_NO - 28, hy - 13, COL_NO + 28, hy + 13))
  })
  if (cfg.example && lay.exampleY != null) lines.push(put('記入例 「はい」と答えるとき', 80, lay.exampleY - 11, 300, lay.exampleY + 11))

  /* Document AI は連続する行をまとめて 1 つの段落として返す。設問が 1 問ずつ
     別々の段落になるとは限らず、2〜3 問がまとめられることも多い。
     ここでは記入例＋設問①、以降は 2〜3 問ずつをまとめた現実的な段落を作る。 */
  const groups = cfg.example ? [[-1, 0], [1, 2], [3, 4, 5], [6, 7], [8, 9], [10, 11], [12]]
    : [[0, 1], [2, 3], [4, 5, 6], [7, 8], [9, 10], [11, 12]]
  const span = { top: {}, bottom: {}, left: {}, right: {} }
  cfg.rows.forEach((r, idx) => {
    const cy = lay.rowY[idx]
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
  // おもて面の下端の案内(実物にもある。文字範囲から用紙を探す手がかりが下にも伸びる)
  if (cfg.side === 'front') lines.push(put('うら面につづきます', 300, 1042, 494, 1064))
  for (const g of groups) {
    const tops = g.map(i => (i < 0 ? lay.exampleY - 11 : span.top[i]))
    const bots = g.map(i => (i < 0 ? lay.exampleY + 11 : span.bottom[i]))
    const txt = g.map(i => (i < 0 ? '記入例 「はい」と答えるとき' : cfg.rows[i].text.split('|').join(''))).join('')
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
function run(label, opts = {}) {
  const { tiltDeg = 0, orient = 1, blank = false, side = 'front', persp = 0,
    imgVariant = 'seal', expectVia = 'markers', expectSrc = null } = opts
  const cfg = SIDES[side], lay = layout(cfg, imgVariant)
  const xf = makeXf((tiltDeg * Math.PI) / 180, persp)
  const display = makeImage(xf, cfg, lay, { ...opts, imgVariant, blank })
  let buf
  if (orient === 6) {
    const st = toStoredOrient6(display)
    buf = withExifOrientation(jpeg.encode({ data: st.data, width: st.width, height: st.height }, 92).data, 6)
  } else {
    buf = jpeg.encode({ data: display, width: IMG_W, height: IMG_H }, 92).data
  }
  const res = readKcl(makeDoc(xf, cfg, lay), buf, 'image/jpeg')
  assert.strictEqual(res.isKcl, true, `${label}: 問診票として判定されること`)
  assert.strictEqual(res.side, side, `${label}: ${side === 'front' ? 'おもて' : 'うら'}面と判定されること`)
  if (!res.readable) {
    console.error(`✗ ${label}: 読み取り不可 (${res.reason})`)
    failed++
    return
  }
  // 期待した経路で読めていることも確かめる
  const via = res.via || 'anchor'
  if (via !== expectVia) {
    console.error(`✗ ${label}: 読み取り経路が ${via}(期待 ${expectVia})`)
    failed++
    return
  }
  if (expectSrc && (!res.debug || res.debug.src !== expectSrc)) {
    console.error(`✗ ${label}: マーカーの検出方法が ${res.debug && res.debug.src}(期待 ${expectSrc})`)
    failed++
    return
  }
  const want = (r) => (blank ? null : cfg.expect[r.key])
  const wrong = cfg.rows.filter(r => res.answers[r.key] !== want(r))
    .map(r => `No.${r.key}: 期待 ${want(r)} / 実際 ${res.answers[r.key]}`)
  if (wrong.length) {
    console.error(`✗ ${label}: ${wrong.length}/${cfg.rows.length} 問を誤読\n  ` + wrong.join('\n  '))
    failed++
    return
  }
  console.log(`✓ ${label}: ${cfg.rows.length} 問すべて正しく読み取り`)
}

/* 読み取り不可になるべきケース(誤った回答を出さないこと自体を検証する) */
function runUnreadable(label, opts = {}) {
  const cfg = SIDES[opts.side || 'front'], lay = layout(cfg)
  const xf = makeXf(((opts.tiltDeg || 0) * Math.PI) / 180, opts.persp || 0)
  const display = makeImage(xf, cfg, lay, opts)
  const buf = jpeg.encode({ data: display, width: IMG_W, height: IMG_H }, 92).data
  const res = readKcl(makeDoc(xf, cfg, lay), buf, 'image/jpeg')
  if (res.readable || Object.keys(res.answers || {}).length) {
    console.error(`✗ ${label}: 読み取り不可になるべきなのに回答を返した`)
    failed++
    return
  }
  console.log(`✓ ${label}: 誤答を出さず読み取り不可（${res.reason}）`)
}

/* 座標表(kcllayout.js)が用紙の設問構成と食い違っていないかの検算。
   用紙のレイアウトを変えたのに measure-kcl-layout.mjs を流し忘れると
   読み取り位置が全部ずれるため、テストで気づけるようにしておく。 */
{
  for (const [name, v] of Object.entries(LAYOUT.variants)) {
    for (const side of ['front', 'back']) {
      const want = (side === 'front' ? FRONT_ROWS : BACK_ROWS).map(r => String(r.key))
      const have = Object.keys(v[side]).filter(k => k !== 'example')
      assert.deepStrictEqual(have.sort(), want.slice().sort(),
        `${name}/${side}: 座標表の設問が用紙と一致しません（npm run build のあと measure-kcl-layout.mjs を実行してください）`)
      for (const k of want) {
        const c = v[side][k]
        assert.ok(c.no[0] > c.yes[0], `${name}/${side}/${k}: いいえ列は はい列より右にあるはず`)
        assert.ok(c.yes[1] > 0.1 && c.yes[1] < 0.98, `${name}/${side}/${k}: 回答欄の位置が版面の外`)
      }
    }
  }
  // 3 様式は「全行が同じ量だけ上下しているだけ」であること(読み取りはこの前提で
  // seal の座標表 + 行方向の補正 δ だけを使う)
  for (const name of ['print', 'walkin']) {
    for (const side of ['front', 'back']) {
      const a = LAYOUT.variants.seal[side], b = LAYOUT.variants[name][side]
      const keys = Object.keys(a)
      const d0 = b[keys[0]].yes[1] - a[keys[0]].yes[1]
      for (const k of keys) {
        assert.ok(Math.abs((b[k].yes[1] - a[k].yes[1]) - d0) < 0.002,
          `${name}/${side}/${k}: 様式差が一様な上下ずれではありません(読み取りの前提が崩れています)`)
        assert.ok(Math.abs(b[k].yes[0] - a[k].yes[0]) < 0.002,
          `${name}/${side}/${k}: 様式間で回答列の x がずれています`)
      }
    }
  }
  console.log(`✓ kcllayout: 3 様式 × 2 面の座標表が用紙の設問構成と一致(様式差は一様な上下ずれのみ)`)
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
// 実写に多い「手持ちで少し傾き + 台形のゆがみ」
run('遠近のゆがみ 6%', { persp: 0.06 })
run('遠近のゆがみ 6% + 傾き 2 度', { persp: 0.06, tiltDeg: 2 })
run('遠近のゆがみ -8% + 傾き -2 度', { persp: -0.08, tiltDeg: -2 })
run('うら面 + 遠近のゆがみ 6% + 傾き 2 度', { side: 'back', persp: 0.06, tiltDeg: 2 })
// うら面(【運動習慣について】の見出しがもう 1 組ある)
run('うら面', { side: 'back' })
run('うら面 + 傾き 2.5 度', { side: 'back', tiltDeg: 2.5 })
run('うら面 + 傾き -3 度', { side: 'back', tiltDeg: -3 })
run('うら面 + EXIF 回転あり', { side: 'back', orient: 6 })
run('うら面 + 中心がずれた塗り', { side: 'back', style: 'offset' })
run('うら面 白紙', { side: 'back', blank: true })
// 強い遠近のゆがみ
run('遠近のゆがみ 12% + 傾き 4 度', { persp: 0.12, tiltDeg: 4 })
run('うら面 + 遠近のゆがみ -12% + 傾き -4 度', { side: 'back', persp: -0.12, tiltDeg: -4 })
// 様式の違い(印字/当日受付は行位置が 2% ほど違う。OCR 行位置の補正 δ で吸収する)
run('印字様式(行位置が下に 2%)', { imgVariant: 'print' })
run('印字様式 + 傾き 3 度 + 遠近 6%', { imgVariant: 'print', tiltDeg: 3, persp: 0.06 })
run('うら面 + 印字様式', { side: 'back', imgVariant: 'print' })
run('当日受付様式(行位置が上に 0.6%)', { imgVariant: 'walkin' })
// 回答欄だけが文字とずれた用紙(反り・局所的な印刷ずれの再現。楕円への吸着で読む)
run('回答欄だけ 10px 下にずれ(反り相当)', { ovalShift: 10 })
run('回答欄だけ 10px 上にずれ + 傾き 2 度', { ovalShift: -10, tiltDeg: 2 })
run('うら面 + 回答欄だけ 8px 下にずれ', { side: 'back', ovalShift: 8 })
run('回答欄だけ 14px 下にずれ(強い反り)', { ovalShift: 14 })
run('回答欄だけ 14px 上にずれ', { ovalShift: -14 })
// 机が用紙と同じくらい明るい(明るさで用紙を切り出せない → 文字範囲から探す)
run('明るい木目の机', { deskLum: 205 })
run('用紙と同化した白い机', { deskLum: 228, expectSrc: 'text' })
run('白い机 + 机の上の黒い角(にせマーカー)', { deskLum: 228, distractors: true, expectSrc: 'text' })
run('白い机 + うら面', { deskLum: 228, side: 'back', expectSrc: 'text' })
run('白い机 + 印字様式 + 傾き 2 度', { deskLum: 228, imgVariant: 'print', tiltDeg: 2, expectSrc: 'text' })
// 四隅マーカーが写っていない(用紙が切れた)ときは、誤答を出さず読み取り不可にする
runUnreadable('マーカーなし(切れた写真)', { noMarkers: true })
runUnreadable('マーカーなし + 傾き 2 度', { noMarkers: true, tiltDeg: 2 })

if (failed) { console.error(`\n${failed} 件失敗`); process.exit(1) }
console.log('\nkclread: すべて成功')
