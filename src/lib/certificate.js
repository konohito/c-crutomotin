/* 短期集中予防サービス（通所型サービスC）修了の「卒業証書」。

   ねらい: 修了式でお渡しする 1 枚。ご本人が笑顔になれるよう、少しだけ遊び心を入れる。
   ただし受け取るのは地域の高齢の方で、渡すのは専門職。次のことは必ず守る。
     - 数字は実測値だけを使う。作り話や一般論で埋めない
     - からかわない。年齢・できなかったことには触れない
     - 数字が伸びなかった方にもお渡しできる文面にする（通い続けたこと自体をたたえる）
   評価は「項目ごと」。C型 では身長・体重・基本チェックリストを終了時に測らないため、
   総合スコアでの前後比較はしない（ctype.js と同じ方針）。 */
import { CTYPE_ITEMS } from './ctype.js'

/* 一番伸びた項目に贈る称号。項目はすべて体力測定の実測項目に対応している。
   praise は、その項目が良くなると暮らしの何が楽になるかを添えた一言。 */
export { CERT_LABEL }
export const TITLES = {
  grip: {
    title: 'しっかり握手賞',
    praise: '握る力が戻ってきました。びんのふたも、手すりも、お孫さんの手も、しっかり握れます。',
  },
  walk5: {
    title: 'すたすた歩き名人',
    praise: '歩く速さが上がりました。横断歩道も、あわてずに渡りきれます。',
  },
  walk5max: {
    title: 'ここぞの早足賞',
    praise: '急ぐときの足取りが軽くなりました。いざというとき、この一歩が効いてきます。',
  },
  bal: {
    title: 'ぴたりと一本足賞',
    praise: '片足で立っていられる時間が伸びました。段差をまたぐのも、靴下をはくのも楽になります。',
  },
  tug: {
    title: '立つ・歩く・まわる名人',
    praise: '立ち上がってから戻るまでの動きが、きびきびとしてきました。',
  },
}
// すべての項目が良くなった方へ
export const TITLE_ALL = {
  title: '全部まるごと花まる賞',
  praise: '測ったすべての項目が良くなりました。積み重ねが、そのまま数字になっています。',
}
// 数字が伸びなかった方へ（それでも必ずお渡しできるように）
export const TITLE_KEEP = {
  title: '皆勤の心意気賞',
  praise: '最後まで通い続けられたことが、何よりの成果です。続けられる方は、そう多くありません。',
}

/* 証書に書く項目名は、受け取る方に分かる日本語にする。
   台帳・提出用の名前（TUG・開眼片脚立位 など）は専門用語なので、証書では使わない。 */
const CERT_LABEL = {
  grip: '握る力',
  walk5: '5m を歩く速さ',
  walk5max: '5m を急いで歩く速さ',
  bal: '片足で立っていられる時間',
  tug: '立ち上がって歩いて戻る速さ',
}
/* 変化の書き方も「−0.6 秒」ではなく「0.6 秒 速くなりました」と、
   良くなったことがそのまま読める言葉にする。 */
const DELTA_WORD = {
  grip: (d) => `${d} kg 強く`,
  walk5: (d) => `${d} 秒 速く`,
  walk5max: (d) => `${d} 秒 速く`,
  bal: (d) => `${d} 秒 長く`,
  tug: (d) => `${d} 秒 速く`,
}
const fmt = (v, dec) => (v === null || v === undefined ? '—' : Number(v).toFixed(dec))
const unit = (it) => (it.unit ? it.unit : '')
// その項目が「良くなった」か（better の向きで見る）
const isBetter = (it) => it.diff !== null && it.better !== 'none'
  && ((it.better === 'high' && it.diff > 0) || (it.better === 'low' && it.diff < 0))
const isWorse = (it) => it.diff !== null && it.better !== 'none'
  && ((it.better === 'high' && it.diff < 0) || (it.better === 'low' && it.diff > 0))

// 伸び幅の大きさ。項目ごとに単位が違うので、開始時に対する割合で比べる
const growth = (it) => {
  if (!isBetter(it) || !it.start) return 0
  return Math.abs(it.diff) / Math.abs(it.start)
}

/* 1 行分（ctypeRows の 1 件）から証書の中身を組み立てる。純粋な関数。 */
export function certificateOf(row) {
  if (!row || !row.endRec) return null      // 終了時が未測定の方は発行しない
  const items = (row.items || []).filter(it => it.better !== 'none')
  const better = items.filter(isBetter)
  const worse = items.filter(isWorse)
  const measured = items.filter(it => it.diff !== null)

  // 称号を決める。全部良くなった → 花まる / 1 つでも良くなった → 一番伸びた項目 / それ以外 → 皆勤
  let badge
  let best = null
  if (better.length && better.length === measured.length && measured.length >= 3) {
    badge = TITLE_ALL
    best = better.slice().sort((a, b) => growth(b) - growth(a))[0]
  } else if (better.length) {
    best = better.slice().sort((a, b) => growth(b) - growth(a))[0]
    badge = TITLES[best.id] || TITLE_KEEP
  } else {
    badge = TITLE_KEEP
  }

  // 証書に並べる「良くなったこと」。実測値のみ
  const highlights = better
    .slice()
    .sort((a, b) => growth(b) - growth(a))
    .map(it => {
      const word = DELTA_WORD[it.id]
      const abs = fmt(Math.abs(it.diff), it.dec)
      return {
        id: it.id, label: CERT_LABEL[it.id] || it.label,
        text: `${CERT_LABEL[it.id] || it.label}　${fmt(it.start, it.dec)} ${unit(it)} → ${fmt(it.end, it.dec)} ${unit(it)}`,
        delta: word ? word(abs) : `${abs} ${unit(it)}`,
      }
    })
  // 伸びなかった方には「保てたこと」を並べる（悪化した項目は証書に載せない）
  const kept = measured.filter(it => !isBetter(it) && !isWorse(it)).map(it => ({
    id: it.id, label: CERT_LABEL[it.id] || it.label,
    text: `${CERT_LABEL[it.id] || it.label}　${fmt(it.start, it.dec)} ${unit(it)} のまま`,
    delta: '保てました',
  }))

  return {
    row, badge, best,
    highlights, kept,
    improvedN: better.length, worsenedN: worse.length, measuredN: measured.length,
    // 本文。良くなった項目があるかどうかで書き分ける
    body: better.length
      ? `あなたは${row.days ? `${row.days}日間` : 'この期間'}にわたり短期集中予防サービスに取り組まれ、体力測定で${better.length}つの項目に良い変化がみられました。その努力をたたえ、ここに「${badge.title}」を贈ります。`
      : `あなたは${row.days ? `${row.days}日間` : 'この期間'}にわたり短期集中予防サービスに最後まで取り組まれました。通い続けられたその心意気をたたえ、ここに「${badge.title}」を贈ります。`,
  }
}

/* 一覧に出す候補。C型 の方を、発行できる／できないで分ける。 */
export function certificateList(rows) {
  const ready = [], notYet = []
  for (const r of rows || []) {
    if (r.endRec) ready.push({ row: r, cert: certificateOf(r) })
    else notYet.push({ row: r, cert: null })
  }
  return { ready, notYet }
}

// 証書に書く日付（和暦）。元号の付け方は engine の eraLabel に合わせる
export const waDate = (ds, eraLabel) => {
  const m = String(ds || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  if (!m) return ''
  return `${eraLabel(+m[1])}年${+m[2]}月${+m[3]}日`
}

// 項目の並び順（証書の見た目を安定させる）
export const ITEM_ORDER = CTYPE_ITEMS.map(it => it.id)
