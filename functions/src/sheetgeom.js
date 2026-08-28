'use strict'
/* 写真の中から用紙と四隅の位置合わせマーカーを見つけ、
   用紙座標(版面比 0〜1)→ 写真画素 の射影変換(ホモグラフィ)を求める。

   OCR の文字位置から回答欄を推定する方法は、手持ち撮影の遠近のゆがみ(台形)に弱い。
   用紙には読み取り用の四隅マーカーが印刷してあるので、それを基準にすれば
   回転・台形のゆがみを含めて用紙座標に正確に引き直せる。

   用紙の探し方は 2 通り用意する:
     1. 明るい大きなかたまり(明るさで机と用紙を分ける)
     2. OCR の文字が写っている範囲(明るい机だと 1 が机ごと膨らむため)
   それぞれからマーカーを探し、候補をすべて返す。どれが正しいかは呼び出し側が
   OCR の設問行の位置との突き合わせで検算する(kclread)。 */

// 画素アクセスを面倒なく行うための小さなラッパ(表示向きの座標で読める)
function makeSampler(img, om) {
  const rw = img.width, data = img.data
  return {
    W: om.W, H: om.H,
    lum(x, y) {
      const [rx, ry] = om.at(x, y)
      const i = ((ry * rw) + rx) * 4
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    },
  }
}

// 縮小したグレースケール(検出は粗い解像度で十分。写真が大きくても速い)
function downscale(sampler, targetW) {
  const step = Math.max(1, Math.floor(sampler.W / targetW))
  const w = Math.floor(sampler.W / step), h = Math.floor(sampler.H / step)
  const g = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) g[y * w + x] = sampler.lum(x * step, y * step)
  }
  return { g, w, h, step }
}

// 連結成分のラベリング(4 近傍)。ok(値) が真の画素をひとかたまりにする
function components(g, w, h, ok, minPx) {
  const seen = new Uint8Array(w * h)
  const out = []
  const stack = []
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !ok(g[i])) continue
    let n = 0, sx = 0, sy = 0, x0 = w, x1 = 0, y0 = h, y1 = 0
    stack.push(i); seen[i] = 1
    while (stack.length) {
      const p = stack.pop()
      const px = p % w, py = (p - px) / w
      n++; sx += px; sy += py
      if (px < x0) x0 = px; if (px > x1) x1 = px
      if (py < y0) y0 = py; if (py > y1) y1 = py
      if (px > 0 && !seen[p - 1] && ok(g[p - 1])) { seen[p - 1] = 1; stack.push(p - 1) }
      if (px < w - 1 && !seen[p + 1] && ok(g[p + 1])) { seen[p + 1] = 1; stack.push(p + 1) }
      if (py > 0 && !seen[p - w] && ok(g[p - w])) { seen[p - w] = 1; stack.push(p - w) }
      if (py < h - 1 && !seen[p + w] && ok(g[p + w])) { seen[p + w] = 1; stack.push(p + w) }
    }
    if (n >= minPx) out.push({ n, cx: sx / n, cy: sy / n, x0, x1, y0, y1 })
  }
  return out
}

// 用紙(明るい大きなかたまり)の範囲を求める。
// 机が用紙と同じくらい明るい(白い机・明るい木目)と、机ごと膨らんだり見つからなかったりする。
function findPaper(sm) {
  const { g, w, h } = sm
  const sorted = Float32Array.from(g).sort()
  const hi = sorted[Math.floor(sorted.length * 0.9)]
  const lo = sorted[Math.floor(sorted.length * 0.1)]
  if (hi - lo < 25) return null                       // 明暗の差が無い(用紙が見つからない)
  const thr = lo + (hi - lo) * 0.55
  const cc = components(g, w, h, (v) => v >= thr, Math.floor(w * h * 0.05))
  if (!cc.length) return null
  const big = cc.reduce((a, b) => (b.n > a.n ? b : a))
  if (big.n < w * h * 0.12) return null               // 小さすぎる = 用紙ではない
  return big
}

/* 範囲の中から「マーカーらしい黒いかたまり」(小さくてほぼ正方形)を集める。
   ID 欄の枠線や文字を拾わないよう、大きさと形で絞る。
   expectPx を渡すとマーカーの一辺の期待値(縮小画素)として使う。省略時は
   範囲の幅が用紙の幅とみなせる場合(明るさ検出)の見積もりで代用する。 */
function darkSquares(sm, rect, expectPx) {
  const { g, w, h } = sm
  const pw = rect.x1 - rect.x0, ph = rect.y1 - rect.y0
  if (pw < 40 || ph < 40) return []
  // 範囲内の明暗からマーカー用のしきい値を決める
  let sum = 0, n = 0
  for (let y = Math.max(0, Math.floor(rect.y0)); y <= Math.min(h - 1, Math.ceil(rect.y1)); y++) {
    for (let x = Math.max(0, Math.floor(rect.x0)); x <= Math.min(w - 1, Math.ceil(rect.x1)); x++) { sum += g[y * w + x]; n++ }
  }
  const mean = n ? sum / n : 200
  const thr = mean * 0.55
  const expect = expectPx || (pw / 794) * 17   // マーカーの一辺(用紙 794px 中 17px)
  const minPx = Math.max(4, Math.round(expect * expect * 0.25))
  const cc = components(g, w, h, (v) => v <= thr, minPx)
  return cc.filter(c => {
    const cw = c.x1 - c.x0 + 1, ch = c.y1 - c.y0 + 1
    if (cw < expect * 0.4 || cw > expect * 3) return false
    if (ch < expect * 0.4 || ch > expect * 3) return false
    if (cw / ch < 0.5 || cw / ch > 2) return false     // ほぼ正方形(丸も含む)
    return c.cx >= rect.x0 && c.cx <= rect.x1 && c.cy >= rect.y0 && c.cy <= rect.y1
  })
}

/* 用紙の四隅にある黒いマーカーの中心を探す(範囲の各隅に最も近い候補を採る)。
   範囲が用紙の輪郭とほぼ一致しているとき(明るさ検出が効いたとき)に使う。 */
function findMarkersByCorner(sm, paper) {
  const pw = paper.x1 - paper.x0, ph = paper.y1 - paper.y0
  const cand = darkSquares(sm, paper)
  if (cand.length < 4) return null
  const corners = {
    tl: [paper.x0, paper.y0], tr: [paper.x1, paper.y0],
    bl: [paper.x0, paper.y1], br: [paper.x1, paper.y1],
  }
  const out = {}
  const used = new Set()
  for (const k of ['tl', 'tr', 'bl', 'br']) {
    const [ax, ay] = corners[k]
    let best = null, bestD = Infinity
    for (const c of cand) {
      if (used.has(c)) continue
      const d = Math.hypot(c.cx - ax, c.cy - ay)
      if (d > Math.hypot(pw, ph) * 0.3) continue       // 隅から遠すぎる
      if (d < bestD) { bestD = d; best = c }
    }
    if (!best) return null
    used.add(best)
    out[k] = [best.cx * sm.step, best.cy * sm.step]
  }
  return out
}

// 4 点が(順に並んだ)凸四角形か
function isConvex(p) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4]
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (!cr) continue
    const sg = cr > 0 ? 1 : -1
    if (!sign) sign = sg
    else if (sg !== sign) return false
  }
  return !!sign
}

// 点が(順に並んだ)凸四角形の内側にあるか
function insideQuad(p, q) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4]
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (!cr) continue
    const sg = cr > 0 ? 1 : -1
    if (!sign) sign = sg
    else if (sg !== sign) return false
  }
  return true
}

// 4 点対応から射影変換(3x3)を解く。src=用紙座標(0〜1)、dst=写真画素
function solveHomography(src, dst) {
  const A = [], b = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u)
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v)
  }
  // ガウスの消去法(8 元)
  const M = A.map((row, i) => row.concat([b[i]]))
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    const t = M[c]; M[c] = M[p]; M[p] = t
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= 8; k++) M[r][k] -= f * M[c][k]
    }
  }
  const hv = M.map((row, i) => row[8] / row[i])
  return [[hv[0], hv[1], hv[2]], [hv[3], hv[4], hv[5]], [hv[6], hv[7], 1]]
}

// 3x3 行列の逆行列(余因子展開)。特異なら null
function invert3(M) {
  const co = (r, c) => {
    const rs = [0, 1, 2].filter(i => i !== r), cs = [0, 1, 2].filter(i => i !== c)
    const m = M[rs[0]][cs[0]] * M[rs[1]][cs[1]] - M[rs[0]][cs[1]] * M[rs[1]][cs[0]]
    return (r + c) % 2 ? -m : m
  }
  const det = M[0][0] * co(0, 0) + M[0][1] * co(0, 1) + M[0][2] * co(0, 2)
  if (Math.abs(det) < 1e-12) return null
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r][c] = co(c, r) / det
  return out
}

/* 検出した 4 点からマッピングを組み立てる。用紙の形の検算(縦横比・凸)込み。
   戻り値 { at(x,y)->写真px, inv(px,py)->用紙座標, markers, shapeDev }。不成立なら null。 */
function buildMapping(mk, layout) {
  if (!mk) return null
  // 検出した 4 点が用紙の形になっているかを確かめる(塗りの有無に依存しない検算)。
  // 縦横比が版面と大きく違う・凸四角形でない場合は、別のものを拾っている。
  const wTop = Math.hypot(mk.tr[0] - mk.tl[0], mk.tr[1] - mk.tl[1])
  const wBot = Math.hypot(mk.br[0] - mk.bl[0], mk.br[1] - mk.bl[1])
  const hL = Math.hypot(mk.bl[0] - mk.tl[0], mk.bl[1] - mk.tl[1])
  const hR = Math.hypot(mk.br[0] - mk.tr[0], mk.br[1] - mk.tr[1])
  if (!wTop || !wBot || !hL || !hR) return null
  // 比率座標(x は幅・y は高さで割ってある)から実寸の比に直してから比べる
  const expect = ((layout.markers.tr[0] - layout.markers.tl[0]) * layout.aspect)
    / (layout.markers.bl[1] - layout.markers.tl[1])
  const got = ((wTop + wBot) / 2) / ((hL + hR) / 2)
  if (got < expect * 0.65 || got > expect * 1.55) return null    // 縦横比が合わない
  if (Math.max(wTop, wBot) / Math.min(wTop, wBot) > 1.7) return null   // 台形が極端すぎる
  if (Math.max(hL, hR) / Math.min(hL, hR) > 1.7) return null
  if (!isConvex([mk.tl, mk.tr, mk.br, mk.bl])) return null

  const order = ['tl', 'tr', 'br', 'bl']
  const H = solveHomography(order.map(k => layout.markers[k]), order.map(k => mk[k]))
  if (!H) return null
  const Hi = invert3(H)
  if (!Hi) return null
  return {
    markers: mk,
    shapeDev: Math.abs(got - expect) / expect,   // 版面の縦横比からのずれ(候補の順位付けに使う)
    at(x, y) {
      const w = H[2][0] * x + H[2][1] * y + 1
      return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w]
    },
    inv(px, py) {
      const w = Hi[2][0] * px + Hi[2][1] * py + Hi[2][2]
      return [(Hi[0][0] * px + Hi[0][1] * py + Hi[0][2]) / w, (Hi[1][0] * px + Hi[1][1] * py + Hi[1][2]) / w]
    },
  }
}

/* 探索範囲 rect から四隅の候補を集め、版面の形に合い・文字範囲をほぼ内側に含む
   四角形の組み合わせを選ぶ。expectPx はマーカーの一辺の期待値(縮小画素)。 */
function quadsFromRect(sm, rect, textRect, layout, expectPx) {
  const { step } = sm
  const cand = darkSquares(sm, rect, expectPx)
  if (cand.length < 4) return []
  // 文字範囲の中心で四象限に分け、各象限で探索範囲の隅に近い候補を数個ずつ試す
  const cx = (textRect.x0 + textRect.x1) / 2, cy = (textRect.y0 + textRect.y1) / 2
  const q = { tl: [], tr: [], bl: [], br: [] }
  for (const c of cand) q[(c.cy < cy ? 't' : 'b') + (c.cx < cx ? 'l' : 'r')].push(c)
  const corner = { tl: [rect.x0, rect.y0], tr: [rect.x1, rect.y0], bl: [rect.x0, rect.y1], br: [rect.x1, rect.y1] }
  for (const k of ['tl', 'tr', 'bl', 'br']) {
    if (!q[k].length) return []
    q[k].sort((a, b) => Math.hypot(a.cx - corner[k][0], a.cy - corner[k][1]) - Math.hypot(b.cx - corner[k][0], b.cy - corner[k][1]))
    q[k] = q[k].slice(0, 6)
  }
  /* 文字範囲の四隅(表示向き画素)。マーカーの四角形はこれを内側に含むはず。
     OCR が用紙の少し外を文字と誤認することがあるため、12% 縮めて余裕を持たせる */
  const sx = (textRect.x1 - textRect.x0) * 0.12, sy = (textRect.y1 - textRect.y0) * 0.12
  const rc = [
    [(textRect.x0 + sx) * step, (textRect.y0 + sy) * step], [(textRect.x1 - sx) * step, (textRect.y0 + sy) * step],
    [(textRect.x1 - sx) * step, (textRect.y1 - sy) * step], [(textRect.x0 + sx) * step, (textRect.y1 - sy) * step],
  ]
  const found = []
  for (const a of q.tl) for (const b of q.tr) for (const c of q.br) for (const d of q.bl) {
    const mk = {
      tl: [a.cx * step, a.cy * step], tr: [b.cx * step, b.cy * step],
      br: [c.cx * step, c.cy * step], bl: [d.cx * step, d.cy * step],
    }
    const map = buildMapping(mk, layout)
    if (!map) continue
    if (!rc.every(p => insideQuad(p, [mk.tl, mk.tr, mk.br, mk.bl]))) continue
    found.push(map)
  }
  found.sort((m1, m2) => m1.shapeDev - m2.shapeDev)   // 版面の形に近いものから
  return found.slice(0, 2)
}

/* OCR の文字範囲を手がかりにマーカーの四角形を探す。
   文字は必ず用紙の上・マーカーの内側にあるが、版面のどの範囲を占めるかは面によって
   違う(うら面は下 2 割に文字が無い)。そのため固定量の拡張では足りず、
   「広めの探索範囲から候補を集めて形で選ぶ」方式にし、それでも見つからなければ
   写真全体からも探す(用紙が写真に小さめに写っている場合の保険。誤った四角形は
   形の検算とこの後の設問行との突き合わせで弾かれる)。 */
function findMappingsByText(sm, textRect, layout) {
  const { w, h } = sm
  const rw = textRect.x1 - textRect.x0, rh = textRect.y1 - textRect.y0
  if (rw < 40 || rh < 40) return []
  // マーカーの一辺の期待値: 文字範囲は版面のおよそ 78% 幅に収まる
  const expectPx = (rw / 0.78) * (17 / 794)
  // 探索範囲: 文字範囲を大きく広げる(うら面はマーカーが文字より 3 割ほど外にある)
  const near = {
    x0: Math.max(0, textRect.x0 - rw * 0.25), x1: Math.min(w - 1, textRect.x1 + rw * 0.25),
    y0: Math.max(0, textRect.y0 - rh * 0.35), y1: Math.min(h - 1, textRect.y1 + rh * 0.35),
  }
  const found = quadsFromRect(sm, near, textRect, layout, expectPx)
  if (found.length < 2) {
    found.push(...quadsFromRect(sm, { x0: 0, y0: 0, x1: w - 1, y1: h - 1 }, textRect, layout, expectPx))
  }
  return found.slice(0, 3)
}

/* 写真 → 用紙座標の対応付けの候補を列挙する。
   hint は OCR の文字が写っている範囲(表示向き画素の {x0,y0,x1,y1}。無ければ省略可)。
   候補は src('bright'=明るさで検出 / 'text'=文字範囲で検出) 付きで返す。
   どの候補が正しいかは、呼び出し側が設問行の位置との突き合わせで選ぶこと(kclread)。 */
function paperMappings(img, om, layout, hint) {
  const sampler = makeSampler(img, om)
  const sm = downscale(sampler, 700)
  const out = []
  const add = (map, src) => {
    if (!map) return
    // 同じ 4 点なら重複させない(明るさ検出と文字範囲検出が一致した場合)
    const same = out.some(m => ['tl', 'tr', 'bl', 'br'].every(k =>
      Math.hypot(m.markers[k][0] - map.markers[k][0], m.markers[k][1] - map.markers[k][1]) < 2 * sm.step))
    if (!same) out.push({ ...map, src })
  }
  const paper = findPaper(sm)
  if (paper) add(buildMapping(findMarkersByCorner(sm, paper), layout), 'bright')
  if (hint) {
    const t = { x0: hint.x0 / sm.step, x1: hint.x1 / sm.step, y0: hint.y0 / sm.step, y1: hint.y1 / sm.step }
    for (const map of findMappingsByText(sm, t, layout)) add(map, 'text')
  }
  return out
}

// 従来互換: 最初の候補を返す(検算なしで良い用途向け)
function paperMapping(img, om, layout, hint) {
  return paperMappings(img, om, layout, hint)[0] || null
}

module.exports = { makeSampler, paperMapping, paperMappings, solveHomography }
