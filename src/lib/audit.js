/* 台帳の点検（あり得ない値・取り違えの疑いを、人が気づく前に機械が出す）。

   きっかけ:
   体重 591kg・身長 51.6cm・握力 222kg といった値や、身長が 1 年で 20.8cm 伸びている記録、
   同じ日に測定値が 1 つ残らず一致する 2 件などが、人の目で数えて初めて見つかった。
   一度見つけたものは、次からはシステムが先に出せるようにする。

   ここは「見つけて並べる」だけで、データは一切書き換えない。
   直すかどうか・どう直すかは、必ず原本（記録用紙・評価用紙）を見た職員が決める。 */
import { checkValues } from './validate.js'

// 変化量のしきい値。根拠は各行に書いてある
export const LIMITS = {
  // 成人の身長は 1 年で 5cm も変わらない（加齢による短縮は年 0.1〜0.5cm 程度）。
  // 5cm 以上の変化は、測り方の違いか、別人の値の混入を疑う
  heightJump: 5,
  /* 体重は 1 年で 15kg 以上変わることは稀。ただしこの事業は 2〜3 年ぶりの再測定が多く、
     その間の増減まで拾うと現場が見きれない量になる（実データで 36 件出た）。
     そこで「前回から 400 日以内に 15kg 以上」または「期間によらず 25kg 以上」に絞る。 */
  weightJump: 15,
  weightJumpDays: 400,
  weightJumpAlways: 25,
  // 体重は紙も InBody も「実測」なので、同じ日なら一致するはず。
  // 3kg 以上ずれるときは、どちらかが別人の記録である可能性が高い
  inbodyWeightGap: 3,
}

const nz = (v) => (typeof v === 'number' && isFinite(v) ? v : null)
const dateOf = (r) => r.date || `${r.year}年度`
// 評価日 'YYYY/M/D' どうしの日数差。どちらかが無ければ null（間隔は不明）
function daysBetween(a, b) {
  const p = (s) => {
    const m = String(s || '').match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/)
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null
  }
  const ta = p(a), tb = p(b)
  return (ta == null || tb == null) ? null : Math.round(Math.abs(tb - ta) / 86400000)
}
// 測定値どうしを比べるための指紋（すべての項目が同じなら同じ文字列になる）
const VKEYS = ['height', 'weight', 'gripR', 'gripL', 'walk5', 'walk5max', 'tug', 'balR', 'balL']
function fingerprint(values) {
  if (!values) return ''
  const parts = VKEYS.map(k => (nz(values[k]) == null ? '' : String(values[k])))
  // 中身がほとんど空の記録どうしが「一致」してしまわないよう、実測が 5 項目以上ある場合だけ指紋を作る
  return parts.filter(Boolean).length >= 5 ? parts.join('|') : ''
}

/* 台帳（engine の users 配列）を点検して、見つかったものを配列で返す。
   戻り値: [{ kind, level, userId, name, ward, date, message }] */
export function auditUsers(users) {
  const out = []
  const live = (users || []).filter(u => u && u.name && !u.archived)
  const push = (o) => out.push(o)

  for (const u of live) {
    const series = (u.series || []).slice()

    // (1) 人体としてあり得ない値・通常の範囲から外れた値
    for (const r of series) {
      for (const x of checkValues(r.values)) {
        push({
          kind: 'range', level: x.level, userId: u.id, name: u.name, ward: u.venueName,
          date: dateOf(r), message: x.message,
        })
      }
    }

    // (2) 前回からの身長・体重の大きな変化
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1].values || {}, b = series[i].values || {}
      const days = daysBetween(series[i - 1].date, series[i].date)
      for (const [k, label, lim, unit] of [
        ['height', '身長', LIMITS.heightJump, 'cm'],
        ['weight', '体重', LIMITS.weightJump, 'kg'],
      ]) {
        const va = nz(a[k]), vb = nz(b[k])
        if (va == null || vb == null || va <= 0 || vb <= 0) continue
        const diff = Math.round((vb - va) * 10) / 10
        // 体重だけは測定の間隔を見る（2〜3 年ぶりの再測定での増減まで拾わない）
        if (k === 'weight' && Math.abs(diff) < LIMITS.weightJumpAlways
          && !(days != null && days <= LIMITS.weightJumpDays)) continue
        if (Math.abs(diff) >= lim) {
          push({
            kind: k === 'height' ? 'heightJump' : 'weightJump', level: 'warn',
            userId: u.id, name: u.name, ward: u.venueName, date: dateOf(series[i]),
            message: `${label}が前回から ${diff > 0 ? '+' : ''}${diff}${unit} 変わっています`
              + `（${dateOf(series[i - 1])} ${va}${unit} → ${dateOf(series[i])} ${vb}${unit}）。`
              + (k === 'height' ? '測り方の違いか、別の方の値が混ざっていないかご確認ください' : '原本の値をご確認ください'),
          })
        }
      }
    }

    // (3) 同じ日の紙の体重と InBody の体重の食い違い（どちらも実測なので合うはず）
    for (const r of series) {
      const ib = (u.inbody || {})[r.year]
      const pw = nz((r.values || {}).weight), iw = ib && nz(ib.weight)
      if (pw == null || iw == null) continue
      const gap = Math.round((pw - iw) * 10) / 10
      if (Math.abs(gap) >= LIMITS.inbodyWeightGap) {
        push({
          kind: 'inbodyWeight', level: 'warn', userId: u.id, name: u.name, ward: u.venueName, date: dateOf(r),
          message: `記録用紙の体重 ${pw}kg と InBody の体重 ${iw}kg が ${Math.abs(gap)}kg 違います。`
            + `どちらも実測のため、別の方の測定が混ざっていないかご確認ください`,
        })
      }
    }
  }

  // (4) 同じ日に、測定値が 1 つ残らず一致する 2 件（取り違え・二重入力の疑い）
  const byPrint = new Map()
  for (const u of live) {
    for (const r of u.series || []) {
      const fp = fingerprint(r.values)
      if (!fp || !r.date) continue
      const key = `${r.date} ${fp}`
      if (!byPrint.has(key)) byPrint.set(key, [])
      byPrint.get(key).push({ u, r })
    }
  }
  for (const [, list] of byPrint) {
    if (list.length < 2) continue
    const who = list.map(x => `${x.u.name}（ID ${x.u.id}）`).join('・')
    for (const x of list) {
      push({
        kind: 'sameValues', level: 'warn', userId: x.u.id, name: x.u.name, ward: x.u.venueName, date: x.r.date,
        message: `同じ日に測定値が完全に一致する記録が ${list.length} 件あります（${who}）。`
          + `別の方の行を取り違えていないかご確認ください`,
      })
    }
  }

  const order = { error: 0, warn: 1 }
  out.sort((a, b) => (order[a.level] - order[b.level]) || String(a.userId).localeCompare(String(b.userId)) || String(a.date).localeCompare(String(b.date)))
  return out
}

export const auditSummary = (findings) => ({
  error: findings.filter(x => x.level === 'error').length,
  warn: findings.filter(x => x.level === 'warn').length,
  users: new Set(findings.map(x => x.userId)).size,
})

// 点検結果の見出し（画面のグループ表示用）
export const KIND_LABEL = {
  range: 'あり得ない値・範囲外の値',
  heightJump: '身長が前回から大きく変わっている',
  weightJump: '体重が前回から大きく変わっている',
  inbodyWeight: '記録用紙と InBody の体重が合わない',
  sameValues: '同じ日に測定値が完全に一致している',
}
