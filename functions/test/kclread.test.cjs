'use strict'
/* 問診票(様式 R7-03)マークシート読み取りの回帰テスト。
   合成画像・合成 Document AI レスポンスの作り方は kclharness.cjs(共通部品)を参照。
   乱数で条件を総当たりするストレステストは kclread.stress.cjs。 */
const assert = require('assert')
const jpeg = require('jpeg-js')
const { readKcl } = require('../src/kclread')
const { exifOrientation, orientMap } = require('../src/exif')
const LAYOUT = require('../src/kcllayout')
const H = require('./kclharness.cjs')

// ---- 実行 --------------------------------------------------------------------
let failed = 0
function run(label, opts = {}) {
  const { tiltDeg = 0, orient = 1, exifOn = true, fmt = 'jpeg', blank = false, side = 'front', persp = 0,
    imgVariant = 'seal', expectVia = 'markers', expectSrc = null } = opts
  const cfg = H.SIDES[side], lay = H.layout(cfg, imgVariant)
  const xf = H.makeXf((tiltDeg * Math.PI) / 180, persp, (opts.paperW || 900) / H.PAGE_W)
  const display = H.makeImage(xf, cfg, lay, { ...opts, imgVariant, blank })
  const buf = H.encodeShot(display, { orient, exifOn, fmt })
  const res = readKcl(H.makeDoc(xf, cfg, lay, opts), buf, fmt === 'png' ? 'image/png' : 'image/jpeg')
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
  if (expectVia === 'rows') {
    /* rows 経路は「怪しい行は読まない」設計なので、誤読ゼロ + 読取率で判定する */
    const wrong = cfg.rows.filter(r => {
      const got = res.answers[r.key]
      return (got === 'yes' || got === 'no') && got !== want(r)
    }).map(r => `No.${r.key}: 期待 ${want(r)} / 実際 ${res.answers[r.key]}`)
    const read = cfg.rows.filter(r => res.answers[r.key] === want(r)).length
    if (wrong.length) {
      console.error(`✗ ${label}: ${wrong.length} 問を誤読\n  ` + wrong.join('\n  '))
      failed++
      return
    }
    if (read < Math.ceil(cfg.rows.length * 0.75)) {
      console.error(`✗ ${label}: 読取が ${read}/${cfg.rows.length} 問(75% 未満)`)
      failed++
      return
    }
    console.log(`✓ ${label}: 誤読なし・${read}/${cfg.rows.length} 問読み取り`)
    return
  }
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
  const cfg = H.SIDES[opts.side || 'front'], lay = H.layout(cfg)
  const xf = H.makeXf(((opts.tiltDeg || 0) * Math.PI) / 180, opts.persp || 0)
  const display = H.makeImage(xf, cfg, lay, opts)
  const buf = H.encodeShot(display, {})
  const res = readKcl(H.makeDoc(xf, cfg, lay, opts), buf, 'image/jpeg')
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
      const want = (side === 'front' ? H.FRONT_ROWS : H.BACK_ROWS).map(r => String(r.key))
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
  assert.strictEqual(exifOrientation(H.withExifOrientation(plain, 6)), 6, 'Orientation 6 を読めること')
  assert.strictEqual(exifOrientation(H.withExifOrientation(plain, 8)), 8, 'Orientation 8 を読めること')
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
// 用紙の反り(行と文字が一緒に、用紙内の場所によって違う量だけずれる。四隅は動かない)
run('用紙の反り(中央 18px 浮き)', { curlAmp: 18 })
run('用紙の反り(中央 -16px)+ 傾き 3 度', { curlAmp: -16, tiltDeg: 3 })
run('うら面 + 用紙の反り 18px', { side: 'back', curlAmp: 18 })
run('うら面 + 反り 16px + 遠近 6%', { side: 'back', curlAmp: 16, persp: 0.06 })
// 机が用紙と同じくらい明るい(明るさで用紙を切り出せない → 文字範囲から探す)
run('明るい木目の机', { deskLum: 205 })
// 用紙が写真に小さめに写った場合(マーカーも小さくなる)
run('用紙が小さめ(写真幅の 55%)', { paperW: 660 })
run('用紙が小さめ + 明るい机', { paperW: 660, deskLum: 205 })
run('用紙が小さめ + 白い机 + 傾き 3 度', { paperW: 660, deskLum: 228, tiltDeg: 3, expectSrc: 'text' })
// OCR が用紙の外(机の木目)を文字と誤認しても文字範囲の推定が壊れないこと
run('白い机 + 用紙の外に誤認識の文字', { deskLum: 228, stray: true, expectSrc: 'text' })
run('用紙と同化した白い机', { deskLum: 228, expectSrc: 'text' })
run('白い机 + 机の上の黒い角(にせマーカー)', { deskLum: 228, distractors: true, expectSrc: 'text' })
run('白い机 + うら面', { deskLum: 228, side: 'back', expectSrc: 'text' })
run('白い机 + 印字様式 + 傾き 2 度', { deskLum: 228, imgVariant: 'print', tiltDeg: 2, expectSrc: 'text' })
// 写真の向き: EXIF が無い・失われた・180 度逆さでも、向きの総当たり + 設問文字の検算で復元する
run('90 度回転保存 + EXIF なし', { orient: 6, exifOn: false })
run('反対向きの 90 度回転保存 + EXIF なし', { orient: 8, exifOn: false })
run('上下逆さ(180 度) + EXIF なし', { orient: 3, exifOn: false })
run('上下逆さ + EXIF あり', { orient: 3 })
run('うら面 + 90 度回転 + EXIF なし + 傾き 2 度', { side: 'back', orient: 6, exifOn: false, tiltDeg: 2 })
// PNG(スクリーンショット等。EXIF を持てない形式)
run('PNG 形式', { fmt: 'png' })
run('PNG 形式 + 90 度回転保存', { fmt: 'png', orient: 6 })
// 撮影品質の劣化
run('ぼけた写真(ぼかし 2 回)', { blurN: 2 })
run('片側に影 + 傾き 2 度', { shadow: 'side', tiltDeg: 2 })
run('周辺減光 + ノイズ', { shadow: 'vignette', noise: 5 })
run('薄い塗り(うすいペン)', { inkLum: 120 })
run('薄い塗り + 片側に影', { inkLum: 120, shadow: 'side' })
// 鉛筆(グレー)の塗り。紙の 62% 基準には届かないため、楕円ごとの外周紙面基準で読む
run('鉛筆の塗り(グレー150)', { inkLum: 150 })
run('鉛筆 + 片側に影', { inkLum: 150, shadow: 'side' })
run('うら面 + 鉛筆', { side: 'back', inkLum: 150 })
// 腕のくっきりした影(基準の白を楕円ごとに取るので、影の中でも読める)
run('腕のくっきりした影', { armShadow: true, rng: H.mulberry32(4242) })
run('腕の影 + 鉛筆', { armShadow: true, inkLum: 150, rng: H.mulberry32(777) })
run('腕の影 + 白紙', { armShadow: true, blank: true, rng: H.mulberry32(31) })
run('木目の机(筋・節あり)', { grain: true, knots: true, deskLum: 190 })
run('用紙に小さな染み', { strayInk: true })
// OCR が一部の設問行を読み落としても、残りの行だけで正しく読めること
{
  const cfg = H.SIDES.front, lay = H.layout(cfg, 'seal')
  const xf = H.makeXf(0, 0, 900 / H.PAGE_W)
  const dropKeys = new Set(['3', '9'])
  const display = H.makeImage(xf, cfg, lay, {})
  const buf = H.encodeShot(display, {})
  const res = readKcl(H.makeDoc(xf, cfg, lay, { dropKeys }), buf, 'image/jpeg')
  const wrong = cfg.rows.filter(r => !dropKeys.has(String(r.key)) && res.answers[r.key] !== cfg.expect[r.key])
  if (!res.readable || wrong.length || Object.keys(res.answers).some(k => dropKeys.has(k))) {
    console.error(`✗ OCR の行読み落とし(2 問): 残り 11 問が正しく読めること (readable=${res.readable})`)
    failed++
  } else {
    console.log('✓ OCR の行読み落とし(2 問): 読み落とした設問は未回答扱い・残り 11 問は正しく読み取り')
  }
}
// 四隅マーカーが写っていない(用紙が切れた)写真は、設問行の右の楕円ペアを
// 直接探す第 2 経路(rows)で読める
run('マーカーなし(切れた写真)', { noMarkers: true, expectVia: 'rows' })
run('マーカーなし + 傾き 2 度', { noMarkers: true, tiltDeg: 2, expectVia: 'rows' })
run('マーカーなし + 明るい机 + 傾き -3 度', { noMarkers: true, deskLum: 205, tiltDeg: -3, expectVia: 'rows' })
run('マーカーなし + うら面', { noMarkers: true, side: 'back', expectVia: 'rows' })
run('マーカーなし + 白紙', { noMarkers: true, blank: true, expectVia: 'rows' })
run('マーカーなし + 反り 14px', { noMarkers: true, curlAmp: 14, expectVia: 'rows' })
// 設問の文字がまったく読めない写真は、誤答を出さず読み取り不可にする
{
  const cfg = H.SIDES.front, lay = H.layout(cfg, 'seal')
  const xf = H.makeXf(0, 0, 900 / H.PAGE_W)
  const dropKeys = new Set(cfg.rows.map(r => String(r.key)))
  const display = H.makeImage(xf, cfg, lay, {})
  const buf = H.encodeShot(display, {})
  const res = readKcl(H.makeDoc(xf, cfg, lay, { dropKeys }), buf, 'image/jpeg')
  if (res.readable || Object.keys(res.answers || {}).length) {
    console.error('✗ 設問の文字が読めない写真: 読み取り不可になるべきなのに回答を返した')
    failed++
  } else {
    console.log(`✓ 設問の文字が読めない写真: 誤答を出さず読み取り不可（${res.reason}）`)
  }
}

if (failed) { console.error(`\n${failed} 件失敗`); process.exit(1) }
console.log('\nkclread: すべて成功')
