'use strict'
/* 問診票マークシート読み取りの乱数ストレステスト。
   撮影条件(傾き・遠近・用紙の大きさ・机・反り・向き・形式・画質・ボケ・影・ノイズ・
   塗りの濃さ・OCR の読み落とし 等)をシード付き乱数で組み合わせ、大量の合成写真で検証する。

   合否の基準(実運用の安全性の定義):
     1. 誤読ゼロ — どんな条件でも「はい・いいえ」を取り違えないこと。
        読めないときは未回答/読取不可(職員の確認へ)に倒れるのは許容する。
     2. 良条件(ふつうに撮れた写真)では読取率が高いこと。

   実行: node test/kclread.stress.cjs
     STRESS_N=400 で件数変更(既定 60。CI では既定のまま流す)
     STRESS_SEED=... でシード変更 */
const { readKcl } = require('../src/kclread')
const H = require('./kclharness.cjs')

const N = parseInt(process.env.STRESS_N || '60', 10)
const SEED = parseInt(process.env.STRESS_SEED || '20260831', 10)

// シード付き乱数(mulberry32)。同じシードなら毎回同じ条件列になる
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(SEED)
const pick = (arr) => arr[Math.floor(rnd() * arr.length)]
const uni = (a, b) => a + rnd() * (b - a)

let wrongN = 0, goodFailN = 0
let readQ = 0, totalQ = 0, readableN = 0, goodN = 0
const t0 = Date.now()

for (let i = 0; i < N; i++) {
  const p = {
    side: pick(['front', 'back']),
    imgVariant: pick(['seal', 'print', 'walkin']),
    tiltDeg: uni(-6, 6),
    persp: uni(-0.12, 0.12),
    paperW: uni(580, 1020),
    deskLum: pick([120, 150, 170, 190, 205, 228]),
    curlAmp: uni(-18, 18),
    ovalShift: uni(-8, 8),
    style: pick(['full', 'full', 'full', 'small', 'offset', 'over']),
    orient: pick([1, 1, 6, 8, 3]),
    exifOn: rnd() < 0.8,
    fmt: rnd() < 0.85 ? 'jpeg' : 'png',
    quality: pick([78, 88, 92]),
    blurN: pick([0, 0, 1, 1, 2]),
    noise: pick([0, 0, 3, 6]),
    shadow: pick([null, null, 'side', 'vignette']),
    grain: rnd() < 0.4,
    knots: rnd() < 0.3,
    strayInk: rnd() < 0.3,
    stray: rnd() < 0.2,
    blank: rnd() < 0.08,
    inkLum: (() => { const r = rnd(); return r < 0.76 ? 38 : r < 0.84 ? 120 : r < 0.92 ? 150 : 165 })(),
    armShadow: rnd() < 0.22,
    dropKeys: null,
  }
  const cfg = H.SIDES[p.side]
  if (rnd() < 0.15) {
    const ks = cfg.rows.map(r => String(r.key))
    p.dropKeys = new Set([pick(ks), pick(ks)])
  }
  const lay = H.layout(cfg, p.imgVariant)
  const xf = H.makeXf((p.tiltDeg * Math.PI) / 180, p.persp, p.paperW / H.PAGE_W)
  const display = H.makeImage(xf, cfg, lay, { ...p, rng: rnd })
  const buf = H.encodeShot(display, p)
  const res = readKcl(H.makeDoc(xf, cfg, lay, p), buf, p.fmt === 'png' ? 'image/png' : 'image/jpeg')
  // STRESS_ONLY=n: その 1 枚だけ全設問の診断を出す(乱数列は全体を回して合わせる)
  if (process.env.STRESS_ONLY) {
    if (i === +process.env.STRESS_ONLY) {
      console.log(JSON.stringify(p))
      console.log('readable', res.readable, res.reason || '', 'debug', JSON.stringify(res.debug && { src: res.debug.src, delta: res.debug.delta, mad: res.debug.mad }))
      for (const r of cfg.rows) console.log(String(r.key).padStart(3), JSON.stringify(res.debug && res.debug.perQ[String(r.key)]), '->', res.answers && res.answers[r.key], '(truth', (p.blank ? null : cfg.expect[r.key]) + ')')
      const shot = require('path').join(require('os').tmpdir(), `kcl-stress-${i}.${p.fmt === 'png' ? 'png' : 'jpg'}`)
      require('fs').writeFileSync(shot, buf)
      console.log('写真を保存:', shot)
      process.exit(0)
    }
    continue
  }

  // 1) 誤読ゼロ: 読めた答えは必ず塗りと一致すること(未回答・二重塗り・読取不可は許容)
  const wrong = []
  let read = 0, present = 0
  for (const r of cfg.rows) {
    const k = String(r.key)
    if (p.dropKeys && p.dropKeys.has(k)) continue
    present++
    const truth = p.blank ? null : cfg.expect[r.key]
    const got = res.answers ? res.answers[r.key] : undefined
    if (got === 'yes' || got === 'no') {
      if (got !== truth) wrong.push(`${k}: 塗り=${truth || 'なし'} 読み=${got}`)
      else read++
    }
  }
  readQ += read; totalQ += present
  if (res.readable) readableN++
  if (wrong.length) {
    wrongN++
    const dbg = res.debug ? ` 診断 src=${res.debug.src} δ=${res.debug.delta} mad=${res.debug.mad}` : ''
    console.error(`✗ #${i} 誤読 ${wrong.length} 問${dbg} [${JSON.stringify({ ...p, dropKeys: p.dropKeys && [...p.dropKeys] })}]\n   ${wrong.join(' / ')}`)
    if (res.debug) {
      for (const w of wrong) console.error(`   perQ ${w.split(':')[0]}: ${JSON.stringify(res.debug.perQ[w.split(':')[0]])}`)
    }
  }

  // 2) 良条件(ふつうに撮れた写真)では、読取不可にならず 85% 以上読めること
  const good = Math.abs(p.tiltDeg) <= 5 && Math.abs(p.persp) <= 0.08 && p.blurN <= 1 && p.noise <= 3 &&
    p.paperW >= 640 && Math.abs(p.curlAmp) <= 14 && Math.abs(p.ovalShift) <= 6 && p.inkLum <= 60 && !p.blank
  if (good) {
    goodN++
    if (!res.readable || read < present * 0.85) {
      goodFailN++
      console.error(`✗ #${i} 良条件なのに読取 ${read}/${present} (readable=${res.readable}${res.reason ? ' / ' + res.reason : ''}) ` +
        `[${JSON.stringify({ ...p, dropKeys: p.dropKeys && [...p.dropKeys] })}]`)
    }
  }
}

const sec = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\nkclread stress: ${N} 枚 (seed=${SEED}, ${sec}s)`)
console.log(`  読取不可にせず読めた写真: ${readableN}/${N}`)
console.log(`  設問の読取: ${readQ}/${totalQ} (${Math.round((readQ / Math.max(1, totalQ)) * 100)}%)`)
console.log(`  良条件の写真: ${goodN} 枚(読取率 85% 未満: ${goodFailN})`)
console.log(`  誤読: ${wrongN} 枚`)
if (wrongN || goodFailN) { console.error('\nストレステスト失敗'); process.exit(1) }
console.log('すべて基準内')
