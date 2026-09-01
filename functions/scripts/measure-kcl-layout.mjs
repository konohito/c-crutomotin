/* 問診票(様式 R7-03 / R7-03W)の回答欄の座標を実測して functions/src/kcllayout.js を生成する。

   マークシートの読み取りは、写真から四隅マーカーを見つけて用紙座標に引き直し、
   回答欄の楕円を直接見に行く。そのためには「用紙のどこに楕円があるか」の表が要るが、
   位置は CSS の折り返しに依存するため、実際に描画して測るのが唯一確実な方法。

   使い方(用紙のレイアウトを変えたら実行し直すこと):
     npm run build            # 先に dist を作る
     node functions/scripts/measure-kcl-layout.mjs

   dist を静的配信し、用紙作成画面の問診票プレビューから data 属性の位置を読む。 */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { writeFileSync } from 'node:fs'

const ROOT = resolve(new URL('../..', import.meta.url).pathname)
const DIST = join(ROOT, 'dist')
const OUT = join(ROOT, 'functions/src/kcllayout.js')
const BASE = '/c-crutomotin/'
const PORT = 8199
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }

if (!existsSync(DIST)) {
  console.error('dist がありません。先に npm run build を実行してください。')
  process.exit(1)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  let p = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : url.pathname.slice(1)
  if (!p || p.endsWith('/')) p = 'index.html'
  const file = join(DIST, p)
  try {
    const buf = await readFile(existsSync(file) ? file : join(DIST, 'index.html'))
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(buf)
  } catch { res.writeHead(404); res.end('nf') }
})
await new Promise(r => server.listen(PORT, r))

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } })
await page.goto(`http://localhost:${PORT}${BASE}`, { waitUntil: 'networkidle' })
await page.click('.nav-item:has-text("用紙作成")')

/* 印刷時の版面(210mm × 296.5mm)で測る。画面表示の 794×1123px とはわずかに違い、
   下端に近い要素ほどずれるため、印刷と同じ箱の大きさに合わせてから測定する。
   ID 欄の作りが様式ごとに違い、設問行の位置も変わるため 3 様式すべてを測る。 */
const measureOne = async () => {
  await page.waitForSelector('.pdf-page')
  await page.waitForTimeout(400)
  await page.addStyleTag({ content: '.pdf-page{width:210mm!important;height:296.5mm!important;}' })
  await page.waitForTimeout(250)
  return page.evaluate(() => {
    /* プレビューは拡大率がかかっているため、版面の幅・高さで割った比率(0〜1)で返す。
       比率であれば表示倍率や用紙サイズに依存しない。 */
    const center = (el, box) => {
      const r = el.getBoundingClientRect()
      return [
        Math.round(((r.left + r.width / 2 - box.left) / box.width) * 1e5) / 1e5,
        Math.round(((r.top + r.height / 2 - box.top) / box.height) * 1e5) / 1e5,
      ]
    }
    return [...document.querySelectorAll('.pdf-page')].slice(0, 2).map(pg => {
      const box = pg.getBoundingClientRect()
      const markers = {}
      pg.querySelectorAll('[data-mk]').forEach(el => { markers[el.dataset.mk] = center(el, box) })
      const ovals = {}
      pg.querySelectorAll('[data-kcl]').forEach(el => {
        const [key, col] = el.dataset.kcl.split(':')
        ovals[key] = ovals[key] || {}
        ovals[key][col] = center(el, box)
      })
      // 回答列の見出し(はい/いいえ)。読み取り側の位置検算アンカーに使う(セクション順)
      const heads = []
      pg.querySelectorAll('[data-kclhead="yes"]').forEach(el => heads.push({ yes: center(el, box) }))
      pg.querySelectorAll('[data-kclhead="no"]').forEach((el, i) => { if (heads[i]) heads[i].no = center(el, box) })
      const fr = pg.querySelector('[data-kcl]')?.getBoundingClientRect()
      return {
        w: Math.round(box.width * 100) / 100, h: Math.round(box.height * 100) / 100,
        oval: fr ? [Math.round((fr.width / box.width) * 1e5) / 1e5, Math.round((fr.height / box.height) * 1e5) / 1e5] : null,
        markers, ovals, heads,
      }
    })
  })
}

await page.click('text=マークシート式の問診票（様式 R7-03）')
const seal = await measureOne()
await page.click('text=用紙に印字（1名1枚）')
const print_ = await measureOne()
await page.click('text=氏名手書きのマークシート式（様式 R7-03W）')
const walkin = await measureOne()
const VARIANTS = { seal, print: print_, walkin }

await browser.close()
server.close()

const [front] = seal
for (const [name, v] of Object.entries(VARIANTS)) {
  console.log(`${name}: おもて ${Object.keys(v[0].ovals).length} 問 / うら ${Object.keys(v[1].ovals).length} 問`)
  if (JSON.stringify(v[0].markers) !== JSON.stringify(front.markers)) {
    console.warn(`注意: ${name} の四隅マーカーの位置が他と違います`)
  }
}
console.log('版面(実測px):', front.w, '×', front.h, '楕円(版面比):', front.oval)
console.log('四隅マーカー:', JSON.stringify(front.markers))

const fmt = (o, pad) => Object.entries(o).sort().map(([k, v]) => `${pad}'${k}': { yes: [${v.yes}], no: [${v.no}] },`).join('\n')
const fmtHeads = (hs) => (hs || []).map(h => `{ yes: [${h.yes}], no: [${h.no}] }`).join(', ')
const variantSrc = Object.entries(VARIANTS).map(([name, v]) => `    ${name}: {
      // 回答列の見出し(はい/いいえ)の実測位置。読み取りの位置検算アンカー
      heads: {
        front: [${fmtHeads(v[0].heads)}],
        back: [${fmtHeads(v[1].heads)}],
      },
      front: {
${fmt(v[0].ovals, '        ')}
      },
      back: {
${fmt(v[1].ovals, '        ')}
      },
    },`).join('\n')

const src = `'use strict'
/* 問診票(様式 R7-03 / R7-03W)の回答欄の座標表。
   数値はすべて「版面に対する比率」(左上が 0,0 / 右下が 1,1)。表示倍率や用紙サイズに依存しない。
   functions/scripts/measure-kcl-layout.mjs が実際の描画から生成する。手で編集しないこと。
   用紙のレイアウトを変えたら、npm run build のあとに生成し直す。

   ID 欄の作りが様式ごとに違い、設問行の位置も 2% ほど変わるため様式別に持つ:
     seal   = シール貼付欄(全員共通)
     print  = ID・氏名を印字(1 名 1 枚)
     walkin = 当日受付用(様式 R7-03W) */
module.exports = {
  // 版面の縦横比(幅 ÷ 高さ)。比率座標から実寸の比を求めるのに使う
  aspect: ${Math.round((front.w / front.h) * 1e5) / 1e5},
  // 楕円の大きさ(版面比)
  oval: { w: ${front.oval[0]}, h: ${front.oval[1]} },
  // 四隅の位置合わせマーカーの中心(写真から検出してこの座標に合わせる)
  markers: {
    tl: [${front.markers.tl}], tr: [${front.markers.tr}],
    bl: [${front.markers.bl}], br: [${front.markers.br}],
  },
  variants: {
${variantSrc}
  },
}
`
writeFileSync(OUT, src)
console.log('生成:', OUT)
