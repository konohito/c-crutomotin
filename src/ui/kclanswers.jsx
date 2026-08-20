import { KCL_QUESTIONS } from '../data/kihon.js'

/* 問診票(様式 R7-03/R7-03W)の設問リストと読み取り結果の表示部品。
   回答キーは公式 No(文字列 '1'〜'25'。12=BMI は用紙に無い)と ex1/ex2(運動習慣)。 */
const QS = KCL_QUESTIONS.filter(q => !q.derived)
export const KCL_EX = [
  { no: 'ex1', text: '週1回程度の定期的な運動・スポーツをしていますか' },
  { no: 'ex2', text: '自宅や自宅外で、ストレッチや筋トレなどの運動を週1回以上は行なっていますか' },
]
// 印刷レイアウトと一致: おもて面=前半 13 問 / うら面=残り 11 問 + 運動習慣 2 問
export const kclSideList = (side) => {
  const front = QS.slice(0, 13).map(q => ({ no: String(q.no), text: q.text }))
  const back = QS.slice(13).map(q => ({ no: String(q.no), text: q.text })).concat(KCL_EX.map(q => ({ no: q.no, text: q.text })))
  return side === 'front' ? front : side === 'back' ? back : front.concat(back)
}

// 読み取り結果 1 件分の見た目(はい/いいえ/未回答/二重塗り/読取不可)
export const ANS_STYLE = {
  yes: ['はい', 'var(--success-700)', 'var(--success-50)'],
  no: ['いいえ', 'var(--fg-2)', 'var(--slate-100)'],
  empty: ['未回答', 'var(--fg-3)', 'transparent'],
  multi: ['二重塗り', 'var(--warning-700)', 'var(--warning-50)'],
  unread: ['読取不可', 'var(--danger-700)', 'var(--danger-50)'],
}
export const ansKind = (answers, no) => {
  if (!answers || !(no in answers)) return 'unread'
  const v = answers[no]
  return v === 'yes' ? 'yes' : v === 'no' ? 'no' : v === 'multi' ? 'multi' : 'empty'
}

/* 読み取り結果の集計。「はい/いいえ」が取れたものだけを読めた扱いにする。
   未回答(塗りが見つからない)は、本当に無回答か読み落としかを画面では区別できないため
   読取率には含めず、職員の確認対象として数える。 */
export function kclStats(kcl) {
  const list = kclSideList(kcl && kcl.side)
  const kinds = list.map(q => ansKind(kcl && kcl.answers, q.no))
  const read = kinds.filter(k => k === 'yes' || k === 'no').length
  return {
    total: list.length,
    read,
    empty: kinds.filter(k => k === 'empty').length,
    multi: kinds.filter(k => k === 'multi').length,
    unread: kinds.filter(k => k === 'unread').length,
    rate: list.length ? Math.round((read / list.length) * 100) : 0,
  }
}

// 職員の確認なしで本登録してよいか(二重塗りが無く、ほぼ全問読めている)
export function kclAutoOk(kcl) {
  if (!kcl || !kcl.readable) return false
  const s = kclStats(kcl)
  return s.multi === 0 && s.unread === 0 && s.read >= Math.ceil(s.total * 0.85)
}

// 読み取り結果の一覧チップ(読み取り専用・当日受付カードなどで使用)
export function KclAnswerChips({ kcl }) {
  const list = kclSideList(kcl && kcl.side)
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
      {list.map(({ no }) => {
        const k = ansKind(kcl && kcl.answers, no)
        const [label, fg, bg] = ANS_STYLE[k]
        return (
          <span key={no} style={{ fontSize: 11.5, borderRadius: 6, padding: '2px 7px', color: fg, background: bg, border: k === 'empty' ? '1px solid var(--border-subtle)' : 'none' }}>
            <b className="t-num">{no.startsWith('ex') ? '運' + no.slice(2) : no}</b> {label}
          </span>
        )
      })}
    </div>
  )
}
