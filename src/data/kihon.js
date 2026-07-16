/* 基本チェックリスト（介護予防健診 問診票）
   出典: 厚生労働省「基本チェックリスト」様式。25 項目 + 自己評価 3 問。
   設問によって「はい / いいえ」どちらの回答で 1 点が付くかが異なる（pointOn）。
   合計点・領域別点数・事業対象者（該当）判定を算出する。
   ※ ダミーデータでの集計・推移確認用。No.12（BMI）は測定値から自動判定。 */

// pointOn: 'no' = 「いいえ」で 1 点 / 'yes' = 「はい」で 1 点 / 'bmi' = BMI 18.5 未満で 1 点（No.12・測定値から派生）
export const KCL_QUESTIONS = [
  { no: 1,  domain: 'iadl',       pointOn: 'no',  text: 'バスや電車で１人で外出していますか' },
  { no: 2,  domain: 'iadl',       pointOn: 'no',  text: '日用品の買い物をしていますか' },
  { no: 3,  domain: 'iadl',       pointOn: 'no',  text: '預貯金の出し入れをしていますか' },
  { no: 4,  domain: 'iadl',       pointOn: 'no',  text: '友人の家を訪ねていますか' },
  { no: 5,  domain: 'iadl',       pointOn: 'no',  text: '家族や友人の相談にのっていますか' },
  { no: 6,  domain: 'motor',      pointOn: 'no',  text: '階段を手すりや壁をつたわらずに昇っていますか' },
  { no: 7,  domain: 'motor',      pointOn: 'no',  text: '椅子に座った状態から何もつかまらずに立ち上がっていますか' },
  { no: 8,  domain: 'motor',      pointOn: 'no',  text: '１５分位続けて歩いていますか' },
  { no: 9,  domain: 'motor',      pointOn: 'yes', text: 'この１年間に転んだことがありますか' },
  { no: 10, domain: 'motor',      pointOn: 'yes', text: '転倒に対する不安は大きいですか' },
  { no: 11, domain: 'nutrition',  pointOn: 'yes', text: '６ヶ月間で２〜３kg以上の体重減少がありましたか' },
  { no: 12, domain: 'nutrition',  pointOn: 'bmi', text: 'ＢＭＩが18.5未満ですか（測定値から自動判定）', derived: true },
  { no: 13, domain: 'oral',       pointOn: 'yes', text: '半年前に比べて固いものが食べにくくなりましたか' },
  { no: 14, domain: 'oral',       pointOn: 'yes', text: 'お茶や汁物等でむせることがありますか' },
  { no: 15, domain: 'oral',       pointOn: 'yes', text: '口の渇きが気になりますか' },
  { no: 16, domain: 'housebound', pointOn: 'no',  text: '週に１回以上は外出していますか' },
  { no: 17, domain: 'housebound', pointOn: 'yes', text: '昨年と比べて外出の回数が減っていますか' },
  { no: 18, domain: 'cognition',  pointOn: 'yes', text: '周りの人から「いつも同じ事を聞く」などの物忘れがあると言われますか' },
  { no: 19, domain: 'cognition',  pointOn: 'no',  text: '自分で電話番号を調べて、電話をかけることをしていますか' },
  { no: 20, domain: 'cognition',  pointOn: 'yes', text: '今日が何月何日かわからない時がありますか' },
  { no: 21, domain: 'depression', pointOn: 'yes', text: '（ここ２週間）毎日の生活に充実感がない' },
  { no: 22, domain: 'depression', pointOn: 'yes', text: '（ここ２週間）これまで楽しんでやれていたことが楽しめなくなった' },
  { no: 23, domain: 'depression', pointOn: 'yes', text: '（ここ２週間）以前は楽にできていたことが今はおっくうに感じられる' },
  { no: 24, domain: 'depression', pointOn: 'yes', text: '（ここ２週間）自分が役に立つ人間だと思えない' },
  { no: 25, domain: 'depression', pointOn: 'yes', text: '（ここ２週間）わけもなく疲れたような感じがする' },
]

// 領域（機能）ごとの定義と、事業対象者に該当する基準（criterion）・結果アドバイス
export const KCL_DOMAINS = [
  { id: 'iadl',       label: '日常生活',   short: '日常',     nos: [1, 2, 3, 4, 5],     criterion: null,
    advice: '日常生活の活動量が低下している傾向があります。できることは無理のない範囲で続けましょう。' },
  { id: 'motor',      label: '運動器',     short: '運動',     nos: [6, 7, 8, 9, 10],    criterion: 3,
    advice: '筋力や体力の低下の傾向があります。自宅での運動の実施や地域のサロンなどへの参加をされてみてはいかがでしょうか。' },
  { id: 'nutrition',  label: '栄養',       short: '栄養',     nos: [11, 12],            criterion: 2,
    advice: '低栄養の傾向があります。３食バランスよく食べ、体重の変化に気をつけましょう。' },
  { id: 'oral',       label: '口腔機能',   short: '口腔',     nos: [13, 14, 15],        criterion: 2,
    advice: '口内の機能や飲み込みの機能低下の傾向があります。よく噛んで食べ、口腔体操を取り入れてみましょう。' },
  { id: 'housebound', label: '閉じこもり', short: '閉じこもり', nos: [16, 17],            criterion: 'q16',
    advice: '外出の頻度が低下の傾向にあります。ご近所への散歩や地域の健康教室などに参加してみるのはいかがでしょうか。' },
  { id: 'cognition',  label: '認知機能',   short: '認知',     nos: [18, 19, 20],        criterion: 1,
    advice: '物忘れがある傾向にあります。物忘れを予防するためには運動も大事です。家族以外の方との交流も効果的と言われています。' },
  { id: 'depression', label: 'うつ',       short: 'うつ',     nos: [21, 22, 23, 24, 25], criterion: 2,
    advice: '気分の落ち込みがある傾向になります。気分が落ち込む時などは一度地域包括支援センターなどに相談されてみてはいかがでしょうか。' },
]
export const KCL_DOMAIN_BY_ID = Object.fromEntries(KCL_DOMAINS.map(d => [d.id, d]))

// 自己評価（追加設問 ①②③）
export const KCL_SELF = {
  q1: { label: '現在のご自身の体の状態としてどう感じていますか？', options: ['とても健康', 'まあまあ健康', 'ふつう', 'あまり健康でない', '健康でない'] },
  q2: { label: 'ご自身の体の状態で気になること・心配はありますか？', options: ['ない', '膝や腰など関節の痛み', '血圧などの循環器', '食欲低下などの胃腸系', '便秘・トイレが近いなど泌尿器系'] },
  q3: { label: '自宅や自宅外で、ストレッチや筋トレなどの運動を行なっていますか？', options: ['週に2回以上', '週１回程度', '月に１〜２回程度', '全く行なっていない'] },
}

// 合計点による水準（推移チャート・色分け用）。※ 事業対象者判定とは別軸の目安。
export const KCL_LEVELS = {
  high: { label: '要注意', bg: 'var(--danger-50)',  fg: 'var(--danger-700)',  bar: 'var(--danger-500)' },
  mid:  { label: '一部低下', bg: 'var(--warning-50)', fg: 'var(--warning-700)', bar: 'var(--warning-500)' },
  low:  { label: '良好',   bg: 'var(--success-50)', fg: 'var(--success-700)', bar: 'var(--success-500)' },
}
export function kclLevel(total) {
  return total >= 8 ? 'high' : total >= 4 ? 'mid' : 'low'
}

const OVERALL_LABEL = '生活機能全般（No.1〜20 のうち10項目以上）'
export const KCL_CRITERIA_NOTE =
  '事業対象者の該当基準: ①No.1〜20の10項目以上 ②運動器3項目以上 ③栄養2項目 ④口腔2項目以上 ⑤閉じこもり(No.16該当) ⑥認知1項目以上 ⑦うつ2項目以上 — いずれか1つでも満たすと該当。'

// ダミー回答の生成（engine の一括生成 / OCR 本登録時の両方から使う）
// rand: 0-1 の乱数, gauss: 標準正規乱数を返す関数
const KCL_ANSWERABLE = KCL_QUESTIONS.filter(q => q.pointOn !== 'bmi')
const KCL_DOMAIN_W = { iadl: 0.8, motor: 1.05, nutrition: 0.62, oral: 0.92, housebound: 0.7, cognition: 0.6, depression: 0.72 }
export function makeDummyKcl(rand, gauss, age, theta, date) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
  const base = clamp(0.13 + (age - 75) * 0.011 - theta * 0.1, 0.015, 0.68)
  const raw = {}
  KCL_ANSWERABLE.forEach(q => {
    const p = clamp(base * (KCL_DOMAIN_W[q.domain] || 1) + gauss() * 0.05, 0.01, 0.95)
    const isPoint = rand() < p
    raw[q.no] = isPoint ? q.pointOn : (q.pointOn === 'yes' ? 'no' : 'yes')
  })
  const self = {
    q1: Math.round(clamp(1.3 + (age - 75) * 0.05 - theta * 0.5 + gauss() * 0.8, 0, 4)),
    q2: Math.floor(rand() * 5),
    q3: Math.round(clamp(1.4 - theta * 0.55 + (age - 75) * 0.02 + gauss() * 0.9, 0, 3)),
  }
  return { raw, self, date }
}

// 回答（raw: {no: 'yes'|'no'}）から得点・領域別・事業対象者判定を算出
export function kclScore(u, y) {
  const rec = u.kcl && u.kcl[y]
  if (!rec) return null
  const m = u.meas ? u.meas[y] : null
  const points = {}
  KCL_QUESTIONS.forEach(q => {
    if (q.pointOn === 'bmi') {
      const bmi = m && m.values ? m.values.bmi : null
      points[q.no] = (bmi !== null && bmi !== undefined && bmi < 18.5) ? 1 : 0
    } else {
      points[q.no] = rec.raw[q.no] === q.pointOn ? 1 : 0
    }
  })
  const total = Object.values(points).reduce((a, b) => a + b, 0)
  const domainCounts = {}
  KCL_DOMAINS.forEach(d => { domainCounts[d.id] = d.nos.reduce((s, n) => s + (points[n] || 0), 0) })
  let first20 = 0
  for (let n = 1; n <= 20; n++) first20 += points[n] || 0
  const reasons = []
  if (first20 >= 10) reasons.push({ id: 'overall', label: OVERALL_LABEL })
  KCL_DOMAINS.forEach(d => {
    if (d.criterion === 'q16') {
      if (points[16] === 1) reasons.push({ id: d.id, label: d.label + '（No.16 該当）' })
    } else if (typeof d.criterion === 'number' && domainCounts[d.id] >= d.criterion) {
      reasons.push({ id: d.id, label: d.label + '（' + domainCounts[d.id] + '/' + d.nos.length + ' 項目該当）' })
    }
  })
  const target = reasons.length > 0
  const hitQuestions = KCL_QUESTIONS.filter(q => points[q.no] === 1)
  return { points, total, domainCounts, reasons, target, self: rec.self, hitQuestions, date: rec.date }
}
