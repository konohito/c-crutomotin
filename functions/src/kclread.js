'use strict'
/* 基本チェックリスト問診票(様式 R7-03 / R7-03W)のマークシート読み取り。
   1. OCR の文字から、この写真がどちらの面(おもて/うら)かを判断する
   2. 写真から用紙と四隅の位置合わせマーカーを見つけ、用紙座標に引き直す(sheetgeom)
   3. 位置合わせを OCR の設問行の位置と突き合わせて検算し、行方向のずれを補正する
   4. 各設問の回答欄は、印刷された楕円の輪郭を近傍から探し当ててから塗りの濃さで判定する
   採点(判定基準)はフロントの kihon.js が担う(公式基準: 1-20 で 10 項目以上 等)。

   マーカーだけを信じると、明るい机で誤った黒塊を拾ったときや用紙が反っているときに
   「位置合わせは通るが全問の窓が行間に落ちる」壊れ方をする(全問未回答 + まれに隣の行を誤読)。
   設問の文字は必ず回答欄と同じ行にあるので、OCR の行位置との突き合わせが検算になる。 */
const { anchorText, norm } = require('./mapping')
const { exifOrientation, orientMap } = require('./exif')
const { paperMappings } = require('./sheetgeom')
const LAYOUT = require('./kcllayout')
const jpeg = require('jpeg-js')

// 印刷順の設問プレフィックス。key は公式 No(12=BMI は用紙に無い) / ex1・ex2(運動習慣)
const QS = [
  [1, 'バスや電車で1人で外出'], [2, '日用品の買い物'], [3, '預貯金の出し入れ'], [4, '友人の家を訪ねて'], [5, '家族や友人の相談'],
  [6, '階段を手すりや壁をつたわらず'], [7, '椅子に座った状態から何もつかまらず'], [8, '15分位続けて歩いて'], [9, 'この1年間に転んだ'], [10, '転倒に対する不安'],
  [11, '6ヶ月間で2'], [13, '半年前に比べて固いもの'], [14, 'お茶や汁物等でむせる'], [15, '口の渇きが気になり'], [16, '週に1回以上は外出'],
  [17, '昨年と比べて外出の回数'], [18, '周りの人から'], [19, '自分で電話番号を調べて'], [20, '今日が何月何日かわからない'],
  [21, '毎日の生活に充実感がない'], [22, 'これまで楽しんでやれていた'], [23, '以前は楽にできていたこと'], [24, '自分が役に立つ人間だと思えない'], [25, 'わけもなく疲れたような感じ'],
  ['ex1', '週1回程度の定期的な運動'], ['ex2', 'ストレッチや筋トレ'],
]
/* プレフィックスは「印刷時に 1 行の中に収まる範囲」で切ること。
   用紙は幅で折り返すため、行をまたぐ長さにすると どの行にも含まれず設問が見つからない。
   例: ex2 は「…ストレッチや筋トレなどの運動を / 週1回以上は…」で折り返すため、
   以前の '…運動を週1回' では一致せず、運動習慣②が常に読み取れなかった。 */

function positioned(document, kind) {
  const out = []
  for (const page of (document.pages || [])) {
    for (const it of (page[kind] || [])) {
      const layout = it.layout || {}
      const text = anchorText(document, layout.textAnchor)
      const vs = (layout.boundingPoly && (layout.boundingPoly.normalizedVertices || layout.boundingPoly.vertices)) || []
      if (!text || !vs.length) continue
      const xs = vs.map(v => v.x || 0), ys = vs.map(v => v.y || 0)
      out.push({
        text,
        x: xs.reduce((a, b) => a + b, 0) / xs.length,
        y: ys.reduce((a, b) => a + b, 0) / ys.length,
        left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys),
      })
    }
  }
  return out
}

// 行の座標を表示向きの画素に直す(Document AI は通常 0〜1 の正規化座標で返す)
function lineToPx(l, W, H) {
  const nrm = l.right <= 2 && l.bottom <= 2
  return {
    cx: l.x * (nrm ? W : 1), cy: l.y * (nrm ? H : 1),
    x0: l.left * (nrm ? W : 1), x1: l.right * (nrm ? W : 1),
    y0: l.top * (nrm ? H : 1), y1: l.bottom * (nrm ? H : 1),
  }
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/* 四隅マーカー + OCR 行位置を基準にした読み取り。
   回答欄の座標(kcllayout)は seal 様式のものを基準に使い、様式ごとの行位置の違い
   (3 様式とも全行が同じ量だけ上下しているだけ)や印刷のずれは、OCR の設問行から
   求めた行方向の補正量 δ で吸収する。そのうえで、印刷された楕円の輪郭を
   近傍から探し当てて(スナップ)、用紙の反りなどの局所的なずれも吸収する。 */
function readMarks(img, om, side, keys, rowPos, allPos, maps) {
  const table = LAYOUT.variants.seal[side]
  const W = om.W, H = om.H, rw = img.width, data = img.data

  const lumAt = (fx, fy) => {
    const xi = fx <= 0 ? 0 : fx >= W - 1 ? W - 1 : Math.round(fx)
    const yi = fy <= 0 ? 0 : fy >= H - 1 ? H - 1 : Math.round(fy)
    const [rx, ry] = om.at(xi, yi)
    const i = ((ry * rw) + rx) * 4
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  const wanted = keys.map(k => String(k))
  for (const map of maps) {
    /* --- 検算: 位置合わせを設問の文字行と突き合わせる --------------------------
       各設問の行の中心 y(OCR)を用紙座標に引き直し、座標表の行 y との差を取る。
       正しい位置合わせなら、差は全行でほぼ同じ小さな値(様式差 ±2% + 印刷ずれ)になる。
       誤った黒塊をマーカーにしていた場合は差がバラバラ・巨大になるので候補を捨てる。
       2 行に折り返す設問は 1 行目の文字が回答欄より少し上に出る(-1% 程度)が許容内。 */
    /* 各設問の行中心を用紙座標に引き直す。2 行に折り返した設問は 1 行目だけだと
       中心が回答欄より上に出るため、続きの行(すぐ下・左端がほぼ同じ・短い・
       別の設問ではない)を探して 2 行の中点を行中心にする。これで全設問の行位置が
       用紙の反り(行ごとに違うずれ)にも正確に追従する。判定は用紙座標で行うので
       写真の傾き・遠近には影響されない。 */
    const toPaper = (b) => {
      const [, py] = map.inv(b.cx, b.cy)
      const [lx] = map.inv(b.x0, b.cy)
      const [rx] = map.inv(b.x1, b.cy)
      return { py, lx, rx }
    }
    const paperAll = allPos.map(b => ({ ...toPaper(b), isQ: b.isQ }))
    const rowPaperY = (pos) => {
      const b = toPaper(pos)
      let cont = null
      for (const c of paperAll) {
        if (c.isQ) continue
        const dy = c.py - b.py
        if (dy < 0.015 || dy > 0.031) continue              // 続きの行は約 2.4% 下(次の設問行 3.3% は入らない)
        if (Math.abs(c.lx - b.lx) > 0.06) continue          // 左端がほぼ同じ(中央寄せの注記を除外)
        if (c.rx > b.lx + (b.rx - b.lx) * 0.75) continue    // 続きの行は短い(読み損ねた隣の設問行を除外)
        if (!cont || Math.abs(dy - 0.0243) < Math.abs(cont.py - b.py - 0.0243)) cont = c
      }
      return cont ? (b.py + cont.py) / 2 : b.py
    }
    const dByKey = {}
    const ds = []
    for (const k of wanted) {
      const cell = table[k], pos = rowPos[k]
      if (!cell || !pos) continue
      const d = rowPaperY(pos) - cell.yes[1]
      dByKey[k] = d
      ds.push(d)
    }
    if (!ds.length) continue
    const delta = median(ds)
    const nGood = ds.filter(d => Math.abs(d - delta) <= 0.015).length
    if (Math.abs(delta) > 0.05 || nGood < Math.ceil(ds.length * 0.6)) continue

    /* 楕円の内側だけを見る窓。長方形だと四隅が印刷された枠線にかかり、
       未回答でも濃度が出てしまうため、窓自体を楕円形にして枠線の内側だけを見る。
       縮尺は行ごとに「はい・いいえ の中心間の写真上の距離」から求める
       (遠近が強い写真では上辺と下辺で縮尺が違うため、マーカー間からの一律換算では膨らむ)。 */
    const scan = (px, py, thr, bw, bh) => {
      let s = 0, n = 0, dark = 0
      const x0 = Math.max(0, Math.round(px - bw / 2)), x1 = Math.min(W - 1, Math.round(px + bw / 2))
      const y0 = Math.max(0, Math.round(py - bh / 2)), y1 = Math.min(H - 1, Math.round(py + bh / 2))
      const st = Math.max(1, Math.round((x1 - x0) / 14) || 1)
      for (let y = y0; y <= y1; y += st) {
        for (let x = x0; x <= x1; x += st) {
          if (((x - px) / (bw / 2)) ** 2 + ((y - py) / (bh / 2)) ** 2 > 1) continue
          const lum = lumAt(x, y)
          s += lum; n++
          if (lum < thr) dark++
        }
      }
      return { mean: n ? s / n : 255, frac: n ? dark / n : 0 }
    }

    /* 印刷された楕円の輪郭の暗さ(枠線は塗っていなくても黒い)。
       楕円 2 つぶんの輪郭が最も暗くなる位置を近傍から探し、窓をそこへ合わせる。 */
    const rx0 = LAYOUT.oval.w / 2, ry0 = LAYOUT.oval.h / 2
    const ringLum = (cx, cy) => {
      let s = 0
      for (let a = 0; a < 16; a++) {
        const t = (a / 16) * 2 * Math.PI
        const p = map.at(cx + rx0 * 0.9 * Math.cos(t), cy + ry0 * 0.9 * Math.sin(t))
        s += lumAt(p[0], p[1])
      }
      return s / 16
    }
    const refLum = (cx, cy) => {   // 楕円 2 列の中間 = 紙面(基準の白)。行ごとに取るので影・照明ムラに強い
      let s = 0
      for (const [ox, oy] of [[0, 0], [-0.012, 0], [0.012, 0], [0, -0.004], [0, 0.004]]) {
        const p = map.at(cx + ox, cy + oy)
        s += lumAt(p[0], p[1])
      }
      return s / 5
    }
    /* 近い候補を優先する距離ペナルティ付きで探す。探索の上限(±0.0154)は
       隣の行(0.033 間隔)の楕円に窓が届かない範囲に抑えてあるので、
       広げても「隣の行を読む」誤りにはならない(届かなければ未回答に落ちるだけ)。 */
    const snap = (cell, y0) => {
      const midX = (cell.yes[0] + cell.no[0]) / 2
      let best = { s: -1, dx: 0, dy: 0, score: -Infinity }
      for (let dy = -0.0154; dy <= 0.0155; dy += 0.0022) {
        for (let dx = -0.0107; dx <= 0.0108; dx += 0.0027) {
          const ref = refLum(midX + dx, y0 + dy)
          const s = (ref - ringLum(cell.yes[0] + dx, y0 + dy)) + (ref - ringLum(cell.no[0] + dx, y0 + dy))
          const score = s - (Math.abs(dy) + Math.abs(dx)) * 1500
          if (score > best.score) best = { s, dx, dy, score }
        }
      }
      // 輪郭が見つからない(強いボケ等)ときは補正なしの位置に戻す
      return best.s >= 20 ? best : { s: best.s, dx: 0, dy: 0 }
    }

    const answers = {}
    const perQ = {}
    for (const k of wanted) {
      const cell = table[k]
      if (!cell) continue
      /* 行の y: その設問自身の文字行の差 dByKey を優先する(文字と回答欄は同じ行に
         あるため、用紙の反りで行ごとにずれが違っても正確に追従できる)。
         折り返し設問も 2 行の中点を使っているので偏りは無い。全体の δ から大きく
         外れた値だけは行の取り違えとみなして δ に落とす(その先はスナップが拾う)。 */
      const dk = dByKey[k]
      const yk = cell.yes[1] + (dk != null && Math.abs(dk - delta) <= 0.025 ? dk : delta)
      const { s: ringS, dx, dy } = snap(cell, yk)
      const py = map.at(cell.yes[0] + dx, yk + dy)
      const pn = map.at(cell.no[0] + dx, yk + dy)
      const pm = map.at((cell.yes[0] + cell.no[0]) / 2 + dx, yk + dy)
      // この行の縮尺(写真px / 版面比)。列間の距離から求めるので行ごとの遠近に追従する
      const pxPerUnit = Math.hypot(pn[0] - py[0], pn[1] - py[1]) / (cell.no[0] - cell.yes[0])
      const bw = LAYOUT.oval.w * 0.72 * pxPerUnit
      // y は「版面の高さに対する比率」なので、版面の縦横比で幅基準の縮尺に換算する
      const bh = LAYOUT.oval.h * 0.72 * (pxPerUnit / LAYOUT.aspect)
      const paper = scan(pm[0], pm[1], -1, bw, bh).mean
      const thr = Math.min(paper * 0.62, paper - 28)
      const fY = scan(py[0], py[1], thr, bw, bh).frac
      const fN = scan(pn[0], pn[1], thr, bw, bh).frac
      let fy = fY >= 0.30, fn = fN >= 0.30
      if (!fy && !fn) {
        if (fY >= 0.12 && fY > fN * 3) fy = true
        else if (fN >= 0.12 && fN > fY * 3) fn = true
      }
      answers[k] = fy && fn ? 'multi' : fy ? 'yes' : fn ? 'no' : null
      perQ[k] = {
        fy: Math.round(fY * 100) / 100, fn: Math.round(fN * 100) / 100,
        dy: Math.round((yk + dy - cell.yes[1]) * 1e4) / 1e4, ring: Math.round(ringS),
      }
    }
    return {
      answers,
      debug: { src: map.src, delta: Math.round(delta * 1e4) / 1e4, rows: ds.length, perQ },
    }
  }
  return null
}

// document(OCR) + 画像バイト列 → { isKcl, side, answers:{key:'yes'|'no'|'multi'|null}, readable }
function readKcl(document, imageBuffer, mimeType) {
  const nt = norm(document.text || '')
  const isKcl = nt.includes('r703') || nt.includes('基本チェックリスト')
  if (!isKcl) return { isKcl: false }
  const lines = positioned(document, 'lines')

  // どの設問がこの面にあるか(＝おもて/うら)と、各設問の行の位置(検算と補正に使う)
  const keys = []
  const rowLine = {}
  for (const [key, prefix] of QS) {
    const np = norm(prefix)
    const ln = lines.find(l => norm(l.text).includes(np))
    if (ln) { keys.push(key); rowLine[String(key)] = ln }
  }
  const side = keys.some(k => typeof k === 'number' && k <= 11) ? 'front' : (keys.length ? 'back' : null)
  const unreadable = (reason) => ({ isKcl: true, side, answers: {}, readable: false, reason })
  if (!keys.length) return unreadable('設問の文字を読み取れませんでした（用紙全体がはっきり写るように撮り直してください）')

  // 画像復号(JPEG のみ。失敗時は要確認のまま返す)
  let img = null
  try {
    if (imageBuffer && (!mimeType || /jpe?g/i.test(String(mimeType)))) {
      img = jpeg.decode(imageBuffer, { maxMemoryUsageInMB: 400, formatAsRGBA: true })
    }
  } catch { img = null }
  if (!img) return unreadable(`画像を読み込めませんでした(${mimeType || '不明な形式'}。JPEG で撮影・保存してください)`)

  // スマホ写真は EXIF に「表示時に何度回すか」を持つ。Document AI は回転を補正した
  // 向きで座標を返すため、生画素をそのまま参照すると座標系がずれる。表示向きに引き直す。
  const orient = exifOrientation(imageBuffer)
  const om = orientMap(orient, img.width, img.height)
  const W = om.W, H = om.H

  // それでも縦横が入れ替わっている場合(EXIF 以外の要因で補正が入った等)は、
  // 誤った値を出さずに要確認へ回す。
  const dim = ((document.pages || [])[0] || {}).dimension
  if (dim && dim.width && dim.height) {
    const rDoc = dim.width / dim.height, rImg = W / H
    if (Math.abs(rDoc - rImg) / rDoc > 0.08 && Math.abs(1 / rDoc - rImg) * rDoc < 0.08) {
      return unreadable('画像の向きが認識結果と一致しませんでした(撮影時の回転情報)')
    }
  }

  /* 設問行と全行の位置を表示向きの画素に直す(折り返し設問の続き行の特定は、
     傾いた写真だと画素座標では行の高さが正しく取れないため、位置合わせ後に
     用紙座標へ引き直してから readMarks 内で行う)。 */
  const qLines = new Set(Object.values(rowLine))
  const rowPos = {}
  for (const [k, ln] of Object.entries(rowLine)) rowPos[k] = lineToPx(ln, W, H)
  const allPos = lines.map(l => ({ ...lineToPx(l, W, H), isQ: qLines.has(l) }))
  /* 文字が写っている範囲(明るい机での用紙検出のヒント)。OCR はまれに用紙の外
     (机の木目や影)を文字と誤認するため、各辺とも端の数件を除いた値を使う */
  const tokens = positioned(document, 'tokens')
  const boxes = lines.concat(tokens).map(l => lineToPx(l, W, H))
  let hint = null
  if (boxes.length) {
    const pick = (vals, hiSide) => {
      const s = [...vals].sort((a, b) => a - b)
      const k = s.length >= 8 ? Math.max(1, Math.min(3, Math.floor(s.length * 0.03))) : 0
      return hiSide ? s[s.length - 1 - k] : s[k]
    }
    hint = {
      x0: pick(boxes.map(b => b.x0)), y0: pick(boxes.map(b => b.y0)),
      x1: pick(boxes.map(b => b.x1), true), y1: pick(boxes.map(b => b.y1), true),
    }
  }

  /* --- 本命の経路: 四隅マーカーから用紙座標に引き直して回答欄を直接見る ---
     マーカー候補は複数の探し方(明るさ / OCR 文字範囲)から集め、
     OCR の設問行の位置と突き合わせて検算に通ったものだけを使う。 */
  const maps = paperMappings(img, om, LAYOUT, hint)
  if (maps.length) {
    const marks = readMarks(img, om, side, keys, rowPos, allPos, maps)
    if (marks) return { isKcl: true, side, answers: marks.answers, readable: true, orient, via: 'markers', debug: marks.debug }
    return unreadable('マーカーは検出できましたが、位置合わせが設問の文字位置と合いませんでした（用紙を平らに置き、真上から全体が入るように撮り直してください）')
  }

  /* 四隅マーカーが見つからないときは、無理に推定せず要確認へ回す。
     文字位置からの推定は遠近のゆがみで「はい・いいえ」が入れ替わることがあり、
     誤った回答が登録される方が、読めないより危険なため。 */
  return unreadable('用紙の四隅にある黒い位置合わせマーカーを検出できませんでした（用紙全体が入るように、真上から撮り直してください）')
}

module.exports = { readKcl, QS }
