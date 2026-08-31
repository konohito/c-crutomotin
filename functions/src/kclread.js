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
const { PNG } = require('pngjs')

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
function readMarks(img, om, side, keys, rowPos, allPos, colTok, maps) {
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
  const r4 = (v) => Math.round(v * 1e4) / 1e4
  const tried = []   // 検算した候補の記録(却下理由込み。読取不可時の原因調査用)
  /* --- 候補の検算と選択: 位置合わせを設問の文字行と突き合わせる ----------------
     各設問の行の中心 y(OCR)を用紙座標に引き直し、座標表の行 y との差 dk を取る。
     正しい位置合わせなら dk は全行でほぼ同じ小さな値(様式差 ±2% + 反り)になる。
     誤った黒塊をマーカーにした候補は差がバラバラ・巨大になる。候補は「先に見つかった
     もの」ではなく、差のばらつき(MAD)が最も小さいものを採る(歪んだ候補が
     ぎりぎり検算を通って、正しい候補より先に採用されるのを防ぐ)。

     2 行に折り返した設問は 1 行目だけだと中心が回答欄より上に出るため、続きの行
     (すぐ下・左端がほぼ同じ・短い・別の設問ではない)を探して 2 行の中点を行中心に
     する。判定は用紙座標で行うので写真の傾き・遠近には影響されない。 */
  const evalMap = (map) => {
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
    if (!ds.length) { tried.push({ src: map.src, gate: 'rows' }); return null }
    const delta = median(ds)
    const devs = ds.map(d => Math.abs(d - delta))
    const mad = median(devs)
    const nGood = devs.filter(d => d <= 0.018).length
    const rec = { src: map.src, delta: r4(delta), mad: r4(mad) }
    /* 回答列の見出し(はい/いいえ)の x・y でも検算する。設問行の y だけでは
       「右側(回答欄)だけずれた写像」を見抜けないため(文字は左・回答欄は右にあり、
       左だけ合っていて右が 1 行/1 列ずれた写像が通ってしまう)。
       x は必ず「はい→はい列 / いいえ→いいえ列」の文言対応で見る。近い方の列と比べる
       方式だと、ちょうど 1 列ぶん(9%)ずれた写像で「はい」見出しが「いいえ」列に
       一致してしまい、全問の はい・いいえ が入れ替わる最悪の誤読を見逃す。
       期待位置は用紙の実測値(kcllayout.heads。measure-kcl-layout.mjs が生成)を使う。 */
    const anyCell = table[wanted.find(k => table[k])]
    const heads = ((LAYOUT.variants.seal.heads || {})[side]) || []
    let xe = null, ye = null
    if (anyCell) {
      const xErrs = [], yErrs = []
      const expYes = heads.length ? heads[0].yes[0] : anyCell.yes[0]
      const expNo = heads.length ? heads[0].no[0] : anyCell.no[0]
      const expYs = heads.map(h => h.yes[1] + delta)
      for (const t of colTok) {
        const [px, py] = map.inv(t.cx, t.cy)
        if (px < 0.6 || px > 1.1) continue   // 用紙左側の説明文中の「はい・いいえ」は対象外
        xErrs.push(Math.abs(px - (t.isYes ? expYes : expNo)))
        if (expYs.length) yErrs.push(Math.min(...expYs.map(e => Math.abs(py - e))))
      }
      xe = xErrs.length ? r4(median(xErrs)) : null
      ye = yErrs.length ? r4(median(yErrs)) : null
      if (xe != null) rec.xe = xe
      if (ye != null) rec.ye = ye
    }
    if (process.env.KCL_DEBUG) {
      console.error('[map]', JSON.stringify(rec), 'mk', JSON.stringify(map.markers, (k, v) => typeof v === 'number' ? Math.round(v) : v))
    }
    if (Math.abs(delta) > 0.05 || nGood < Math.ceil(ds.length * 0.6)) { rec.gate = 'rows'; tried.push(rec); return null }
    if (xe != null && xe > 0.015) { rec.gate = 'colX'; tried.push(rec); return null }
    if (ye != null && ye > 0.014) { rec.gate = 'colY'; tried.push(rec); return null }
    tried.push(rec)   // gate なし = 検算合格
    // 行の残差 + 見出しアンカーの誤差を合わせた総合スコア(小さいほど良い)で候補を選ぶ
    return { map, dByKey, delta, mad, score: mad + (xe || 0) + (ye || 0) }
  }
  let best = null
  for (const m of maps) {
    const ev = evalMap(m)
    if (ev && (!best || ev.score < best.score)) best = ev
  }
  {
    if (!best) return { ok: false, tried }
    const { map, dByKey, delta } = best

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

    /* 行の y: その設問自身の文字行の差 dByKey を常に使う(文字と回答欄は同じ行に
       あるため、写像が多少ゆがんでいても inv→at を通ることで行方向のずれが
       打ち消され、正しい行に窓が乗る)。折り返し設問も 2 行の中点を使っているので
       偏りは無い。文字行が読めなかった設問だけ、上下の近い設問の補正を距離で
       内挿する(全体 δ より局所的に正確。ゆがんだ写像でも隣の行の値なら近い)。 */
    const keysWithD = wanted.filter(k => table[k] && dByKey[k] != null)
    const yFor = (cell) => {
      let lo = null, hi = null
      for (const j of keysWithD) {
        const yj = table[j].yes[1]
        if (yj <= cell.yes[1]) { if (!lo || yj > table[lo].yes[1]) lo = j }
        else if (!hi || yj < table[hi].yes[1]) hi = j
      }
      if (lo && hi) {
        const y0 = table[lo].yes[1], y1 = table[hi].yes[1]
        const t = y1 > y0 ? (cell.yes[1] - y0) / (y1 - y0) : 0
        return cell.yes[1] + dByKey[lo] * (1 - t) + dByKey[hi] * t
      }
      const j = lo || hi
      return cell.yes[1] + (j ? dByKey[j] : delta)
    }
    const answers = {}
    const perQ = {}
    for (const k of wanted) {
      const cell = table[k]
      if (!cell) continue
      const dk = dByKey[k]
      const yk = dk != null ? cell.yes[1] + dk : yFor(cell)
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
      /* 塗りの判定は片側 30% 以上のみ。以前あった「12% でも反対側の 3 倍なら採用」の
         救済則は、窓が枠線をかすった時に白紙でも誤読する事故のもとだった。
         楕円窓 + 輪郭への吸着後は、小さな塗り・薄い塗りでも本物なら 30% を大きく
         超えるため、救済は不要になっている。 */
      const fy = fY >= 0.30, fn = fN >= 0.30
      answers[k] = fy && fn ? 'multi' : fy ? 'yes' : fn ? 'no' : null
      perQ[k] = {
        fy: Math.round(fY * 100) / 100, fn: Math.round(fN * 100) / 100,
        dy: Math.round((yk + dy - cell.yes[1]) * 1e4) / 1e4, ring: Math.round(ringS),
      }
    }
    return {
      ok: true,
      answers,
      debug: {
        src: map.src, delta: r4(delta), mad: r4(best.mad),
        rows: Object.keys(dByKey).length, perQ,
      },
    }
  }
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
  const unreadable = (reason, debug) => ({ isKcl: true, side, answers: {}, readable: false, reason, debug: debug || null })
  if (!keys.length) return unreadable('設問の文字を読み取れませんでした（用紙全体がはっきり写るように撮り直してください）')

  // 画像復号。形式はファイルの中身(magic bytes)で判別する(拡張子・MIME は当てにならない)
  let img = null
  try {
    if (imageBuffer && imageBuffer.length > 8) {
      if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8) {
        img = jpeg.decode(imageBuffer, { maxMemoryUsageInMB: 400, formatAsRGBA: true })
      } else if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50) {
        const p = PNG.sync.read(imageBuffer)
        img = { width: p.width, height: p.height, data: p.data }
      }
    }
  } catch { img = null }
  if (!img) return unreadable(`画像を読み込めませんでした(${mimeType || '不明な形式'}。JPEG か PNG で撮影・保存してください)`)

  /* スマホ写真は EXIF に「表示時に何度回すか」を持つ。Document AI は回転を補正した
     向きで座標を返すため、生画素をそのまま参照すると座標系がずれる。
     EXIF が無い・誤っている・180 度逆さのまま等の写真もあるため、向きは決め打ちせず
     候補(EXIF の向きを最優先に全回転)を順に試し、設問文字との検算に通った向きを採る。
     Document AI の座標系と縦横比が合わない候補はあらかじめ除く。 */
  const orient = exifOrientation(imageBuffer)
  const dim = ((document.pages || [])[0] || {}).dimension
  const omCands = []
  for (const o of [orient, 1, 6, 8, 3]) {
    if (omCands.some(c => c.o === o)) continue
    const om = orientMap(o, img.width, img.height)
    if (dim && dim.width && dim.height) {
      const rDoc = dim.width / dim.height
      if (Math.abs(rDoc - om.W / om.H) / rDoc > 0.08) continue
    }
    omCands.push({ o, om })
  }
  if (!omCands.length) return unreadable('画像の向きが認識結果と一致しませんでした(撮影時の回転情報)')

  const tokens = positioned(document, 'tokens')
  const qLines = new Set(Object.values(rowLine))
  let sawMaps = false
  const allTried = []   // 検算に落ちた候補の記録(読取不可時に原因を示すため保存する)
  for (const { o, om } of omCands) {
    const W = om.W, H = om.H
    /* 設問行と全行の位置を表示向きの画素に直す(折り返し設問の続き行の特定は、
       傾いた写真だと画素座標では行の高さが正しく取れないため、位置合わせ後に
       用紙座標へ引き直してから readMarks 内で行う)。 */
    const rowPos = {}
    for (const [k, ln] of Object.entries(rowLine)) rowPos[k] = lineToPx(ln, W, H)
    const allPos = lines.map(l => ({ ...lineToPx(l, W, H), isQ: qLines.has(l) }))
    // 回答列の見出しトークン(はい/いいえ)。写像の列方向(x)の検算に使う
    const colTok = tokens.filter(t => { const n = norm(t.text); return n === 'はい' || n === 'いいえ' })
      .map(t => ({ ...lineToPx(t, W, H), isYes: norm(t.text) === 'はい' }))
    /* 文字が写っている範囲(明るい机での用紙検出のヒント)。OCR はまれに用紙の外
       (机の木目や影)を文字と誤認するため、各辺とも端の数件を除いた値を使う */
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
    if (!maps.length) continue
    sawMaps = true
    const marks = readMarks(img, om, side, keys, rowPos, allPos, colTok, maps)
    if (marks.ok) return { isKcl: true, side, answers: marks.answers, readable: true, orient: o, via: 'markers', debug: marks.debug }
    for (const t of marks.tried) allTried.push({ o, ...t })
  }

  /* どの向きでも成立しなかったときは、無理に推定せず要確認へ回す。
     位置の推定を誤ると「はい・いいえ」が入れ替わることがあり、
     誤った回答が登録される方が、読めないより危険なため。
     どの検算にどの値で落ちたかは debug.tried に残す(現地での原因調査用)。 */
  return unreadable(sawMaps
    ? 'マーカーは検出できましたが、位置合わせが設問の文字位置と合いませんでした（用紙を平らに置き、真上から全体が入るように撮り直してください）'
    : '用紙の四隅にある黒い位置合わせマーカーを検出できませんでした（用紙全体が入るように、真上から撮り直してください）',
  allTried.length ? { tried: allTried.slice(0, 12) } : null)
}

module.exports = { readKcl, QS }
