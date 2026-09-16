/* 測定値の妥当性チェック（入力ミスの根治）。

   なぜ必要か:
   体重 591kg(BMI 281)・身長 51.6cm・握力 222kg といった、明らかに人体ではあり得ない値が
   実データに入っていた。いずれも「59.1 を 591」「53.0 を 530」のような桁の打ち間違い、
   あるいは読み取り(OCR)の小数点落ちが原因。保存の時点で止めるのが唯一の根本対策になる。

   2 段階にしてある:
   - error … 人体としてあり得ない。保存を止める（職員が確認して直すか、明示的に上書きする）
   - warn  … あり得るが桁を間違えた可能性が高い。保存はできるが注意を出す

   しきい値の根拠はそれぞれの行に書いてある。迷ったら「止めない(warn)」側に倒している。
   現場の測定会を止めないことが最優先で、止めるのは「直さないと確実に誤りである値」だけ。 */

// [error下限, error上限, warn下限, warn上限]。null は「その向きの制限なし」
export const RANGES = {
  height: {
    label: '身長', unit: 'cm', err: [100, 220], warn: [130, 185],
    why: '成人の身長。100cm 未満・220cm 超は測定値として成立しない（実データの 51.6cm・66.2cm はこれで止まる）',
  },
  weight: {
    label: '体重', unit: 'kg', err: [20, 200], warn: [30, 120],
    why: '20kg 未満は成人として成立せず、200kg 超は本事業の対象者では起こり得ない（591kg・530kg はこれで止まる）',
  },
  bmi: {
    label: 'BMI', unit: '', err: [10, 60], warn: [15, 35],
    why: 'BMI 10 未満・60 超は生存域の外。身長か体重の桁ミスがあると必ずここに出る',
  },
  gripR: {
    label: '握力 右', unit: 'kg', err: [0, 70], warn: [1, 50],
    why: '握力の世界記録級が約 90kg。65 歳以上の地域在住高齢者で 70kg 超は起こり得ない（222kg はこれで止まる）。0kg は未測定の取り違えを疑う',
  },
  gripL: {
    label: '握力 左', unit: 'kg', err: [0, 70], warn: [1, 50],
    why: '握力の世界記録級が約 90kg。65 歳以上の地域在住高齢者で 70kg 超は起こり得ない（222kg はこれで止まる）。0kg は未測定の取り違えを疑う',
  },
  walk5: {
    label: '５ｍ通常歩行', unit: '秒', err: [0.5, 120], warn: [2, 30],
    why: '5m を 0 秒では歩けない（0 秒は未測定の可能性）。120 秒超（毎秒 4cm）は歩行として成立しない',
  },
  walk5max: {
    label: '５ｍ最大歩行', unit: '秒', err: [0.5, 120], warn: [1.5, 30],
    why: '5m を 0 秒では歩けない（0 秒は未測定の可能性）。120 秒超（毎秒 4cm）は歩行として成立しない',
  },
  tug: {
    label: 'TUG', unit: '秒', err: [1, 300], warn: [4, 40],
    why: '3m の立ち上がり歩行。0 秒はあり得ない（0 秒は未測定の可能性）。4 秒未満は健常若年者でも難しく、桁・単位の取り違えを疑う',
  },
  balR: {
    label: '開眼片足立ち 右', unit: '秒', err: [0, 300], warn: [null, 120],
    why: '測定は通常 60 秒または 120 秒で打ち切る。それを大きく超える値は記入ミスを疑う',
  },
  balL: {
    label: '開眼片足立ち 左', unit: '秒', err: [0, 300], warn: [null, 120],
    why: '測定は通常 60 秒または 120 秒で打ち切る。それを大きく超える値は記入ミスを疑う',
  },
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (v === '' || v == null ? null : (isFinite(parseFloat(v)) ? parseFloat(v) : null)))
const fmtRange = (lo, hi) => (lo == null ? `${hi} 以下` : hi == null ? `${lo} 以上` : `${lo}〜${hi}`)

/* 桁を 1 つ間違えた可能性のある直し方を提案する（591 → 59.1 など）。
   提案は表示するだけで、勝手に直すことはしない。 */
function suggest(v, r) {
  const [lo, hi] = r.err
  for (const f of [10, 100, 0.1]) {
    const c = Math.round((v / f) * 100) / 100
    if ((lo == null || c >= lo) && (hi == null || c <= hi)) return c
  }
  return null
}

/* 測定値 1 件を点検して、見つかった問題の配列を返す。
   戻り値: [{ field, label, value, level:'error'|'warn', message, suggest }] */
export function checkValues(values) {
  const out = []
  if (!values) return out
  for (const [field, r] of Object.entries(RANGES)) {
    const v = num(values[field])
    if (v === null) continue // 未測定（空欄）は点検しない
    const [elo, ehi] = r.err
    const [wlo, whi] = r.warn
    const u = r.unit ? ` ${r.unit}` : ''
    if ((elo != null && v < elo) || (ehi != null && v > ehi)) {
      const s = suggest(v, r)
      out.push({
        field, label: r.label, value: v, level: 'error', suggest: s,
        message: `${r.label} ${v}${u} は人体としてあり得ない値です（${fmtRange(elo, ehi)}${u} の範囲で入力してください）`
          + (s != null ? `。${s}${u} の打ち間違いではありませんか？` : ''),
      })
    } else if ((wlo != null && v < wlo) || (whi != null && v > whi)) {
      out.push({
        field, label: r.label, value: v, level: 'warn', suggest: null,
        message: `${r.label} ${v}${u} は通常の範囲（${fmtRange(wlo, whi)}${u}）から外れています。用紙の値をもう一度お確かめください`,
      })
    }
  }
  // 身長・体重と BMI の食い違い（どれか 1 つだけ直して整合が崩れた場合に出る）
  const h = num(values.height), w = num(values.weight), b = num(values.bmi)
  if (h && w && b && h >= 50) {
    const calc = w / Math.pow(h / 100, 2)
    if (Math.abs(calc - b) > 1) {
      out.push({
        field: 'bmi', label: 'BMI', value: b, level: 'warn', suggest: Math.round(calc * 10) / 10,
        message: `BMI ${b} は身長・体重から計算した ${Math.round(calc * 10) / 10} と合いません`,
      })
    }
  }
  return out
}

export const errorsOf = (values) => checkValues(values).filter(x => x.level === 'error')
export const warningsOf = (values) => checkValues(values).filter(x => x.level === 'warn')

/* 保存の直前に呼ぶ。あり得ない値があれば例外を投げて保存を止める。
   force=true（職員が「この値のまま保存」を選んだとき）は素通しする。 */
export function assertSavable(values, { force = false } = {}) {
  if (force) return []
  const errs = errorsOf(values)
  if (errs.length) {
    const e = new Error(errs.map(x => x.message).join(' / '))
    e.name = 'ValueRangeError'
    e.issues = errs
    throw e
  }
  return []
}
