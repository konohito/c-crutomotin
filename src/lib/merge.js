/* 同一人物が複数の利用者として登録されてしまったときの「統合」。

   なぜ起きるか（実データで確認した構造的な原因）:
   - 参加者 ID は「地区コード(先頭2桁) + 連番」で採番する（engine.newUserId）。
     地区が違えば必然的に別 ID になる＝同じ方でも地区をまたぐと別人として登録されうる。
   - 当日受付の仮登録は、その日の受付分としか同姓同名チェックをしていなかった。
   - 当日受付の市町村が常にマスタ先頭（利用者数の一番多い市町村）に固定されていた。
     行政区は熊本市のものを選んでいるのに市町村だけ嘉島町になる、という食い違いが起きる。

   統合の方針（元に戻せることを最優先）:
   1. 測定ドキュメントは「移動」も「削除」もしない。userId 項目だけ付け替える。
      （読み込み(loadRealData)は userId 項目でグループ化しているため、これだけで履歴が 1 本に繋がる。
        ドキュメント ID は変えないので、付け替え前の姿がそのまま残り、戻すのも userId を書き戻すだけ）
   2. 付け替えた件数を数えて、残す側で全件確認できてからでないとアーカイブしない。
   3. 消す側は物理削除しない（Firestore ルールでも users の delete は禁止）。
      archived / mergedInto を立てて台帳から外すだけ。
   4. 地区は捨てない。消す側の地区を残す側の districtHistory に「どの測定日がその地区だったか」
      付きで持たせる。行政提出の CSV はこの履歴を見て、測定当時の地区で出力する。
   5. 誰がいつ何をしたかを merges/{mergeId} に残す。これが「元に戻す」の台帳も兼ねる。 */

import D from '../data/engine.js'
import { dbEnabled, getFs } from './db.js'
import { compactDate } from './realdata.js'

// ---- 氏名の正規化 -------------------------------------------------------------
// 全角半角(NFKC) → カタカナをひらがなへ → 空白・記号を落とす。
// 「ｱﾍﾞ ﾖｼｺ」「アベヨシコ」「あべ よし子」を同じものとして比べるため。
export const normJa = (s) => String(s || '')
  .normalize('NFKC')
  .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
  .replace(/[\s・,.、。･]/g, '')
  .toLowerCase()

// 旧字体・異体字のゆれ（髙木/高木 など）。氏名照合でだけ使う（保存する氏名は変えない）
const KANJI_VAR = { 髙: '高', 﨑: '崎', 嵜: '崎', 桒: '桑', 邊: '辺', 邉: '辺', 齋: '斎', 齊: '斉', 澤: '沢', 惠: '恵', 眞: '真', 德: '徳', 濵: '浜', 瀨: '瀬', 嶋: '島', 曻: '昇', 內: '内' }
export const normName = (s) => normJa(s).split('').map(c => KANJI_VAR[c] || c).join('')

// 生年月日の数字だけ（1948/07/30 → 19480730、1948 → 1948）
export const birthDigits = (s) => String(s || '').replace(/\D/g, '')

// ---- 重複候補の検出 -----------------------------------------------------------
// 地区・市町村をまたいで台帳全体を突き合わせる（地区で分かれている重複を見つけるのが目的）。
function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (!m || !n) return Math.max(m, n)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}
const sim = (a, b) => (a && b ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0)

/* 2 人の近さを判定する。戻り値 { score, reasons[], level } 。
   level: 'same'(ほぼ確実に同一人物) / 'likely'(要確認) / null(候補ではない) */
export function similarity(a, b) {
  const an = normName(a.name), bn = normName(b.name)
  const ak = normName(a.kana), bk = normName(b.kana)
  const ab = birthDigits(a.birthDate), bb = birthDigits(b.birthDate)
  const sn = sim(an, bn), sk = sim(ak, bk)
  const reasons = []
  let score = 0
  if (an && an === bn) { score += 4; reasons.push('氏名が一致') }
  else if (sn >= 0.6) { score += 2; reasons.push('氏名が似ている') }
  if (ak && ak === bk) { score += 4; reasons.push('ふりがなが一致') }
  else if (sk >= 0.75) { score += 2; reasons.push('ふりがなが似ている') }
  /* 生年月日。両方とも年月日まで分かっていて食い違うなら、氏名が似ていても別人と見る
     （実データに「岩永裕子(1947/07/30)」と「岩永秀子(1947/06/24)」のような別人がいる）。
     生年しか分からない方もいるため、その場合は弱い手がかりとして扱う。 */
  const full = ab.length >= 8 && bb.length >= 8
  if (ab && bb && ab === bb) {
    score += full ? 3 : 1
    reasons.push(full ? '生年月日が一致' : '生年が一致')
  } else if (full) { score -= 4; reasons.push('生年月日が違う（別人の可能性が高い）') }
  else if (ab && bb && ab.slice(0, 4) === bb.slice(0, 4)) { score += 1; reasons.push('生年が一致') }
  else if (ab && bb) { score -= 2; reasons.push('生年が違う') }
  if (a.sex && b.sex && a.sex !== b.sex) { score -= 4; reasons.push('性別が違う') }
  const level = score >= 8 ? 'same' : score >= 5 ? 'likely' : null
  if (a.venueName !== b.venueName) reasons.push('地区が違う')
  else if (a.muniName !== b.muniName) reasons.push('市町村が違う')
  return { score, reasons, level }
}

/* 台帳全体から重複候補のペアを洗い出す。強い順に並べて返す。 */
export function duplicatePairs(users = D.users) {
  const list = users.filter(u => u && u.name && !u.archived)
  const out = []
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const r = similarity(list[i], list[j])
      if (!r.level) continue
      // 測定件数の多い方を「残す側」の既定にする
      const [keep, lose] = measCount(list[i]) >= measCount(list[j]) ? [list[i], list[j]] : [list[j], list[i]]
      out.push({ id: keep.id + '+' + lose.id, keep, lose, ...r })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

export const measCount = (u) => ((u && u.series) || []).length

/* 登録・仮登録の前に押す重複チェック。地区・市町村をまたいで台帳全体を見る。
   戻り値は近い順の利用者配列（0 件なら重複なし）。 */
export function findExisting({ name, kana, birthDate, sex }, users = D.users) {
  const probe = { name, kana, birthDate, sex, venueName: '', muniName: '' }
  return users
    .filter(u => u && u.name && !u.archived)
    .map(u => ({ u, r: similarity(probe, u) }))
    .filter(x => x.r.level)
    .sort((a, b) => b.r.score - a.r.score)
    .map(x => ({ user: x.u, ...x.r }))
}

// ---- 地区（行政区）の履歴 ------------------------------------------------------
// 利用者ドキュメントの districtHistory に入れる 1 件分。
// dates には「その地区で測った測定日(YYYY/MM/DD)」を入れる。行政提出 CSV はこれを見る。
export const districtRecord = (u, dates, meta = {}) => ({
  ward: u.venueName || u.ward || '',
  muni: u.muni || '', muniName: u.muniName || '', region: u.region || '',
  venueCode: u.venueCode ?? null,
  dates: (dates || []).filter(Boolean),
  ...meta,
})

/* その測定を行った当時の地区を返す（履歴に無ければ現在の地区）。
   行政提出 CSV / 結果票はこれを使う＝統合しても提出先から見た地区は変わらない。

   履歴のうち「測定日(dates)が入っているもの」だけが提出に効く。
   dates が空の履歴は「同じ地区の呼び方が変わっただけ（改称）」の記録で、
   画面に旧称を出すためだけに持つ（提出は新しい地区名で出す＝実体は同じ地区なので）。 */
export function districtOf(u, m) {
  const cur = { ward: u.venueName || '', muni: u.muni || '', muniName: u.muniName || '', region: u.region || '', venueCode: u.venueCode ?? null }
  const hist = u && u.districtHistory
  if (!hist || !hist.length || !m || !m.date) return cur
  const d = compactDate(m.date)
  if (!d) return cur
  const hit = hist.find(h => (h.dates || []).some(x => compactDate(x) === d))
  return hit ? { ward: hit.ward || '', muni: hit.muni || '', muniName: hit.muniName || '', region: hit.region || '', venueCode: hit.venueCode ?? null } : cur
}

// ---- 統合の下見（純粋・画面表示用） ---------------------------------------------
const PROFILE_FIELDS = [
  ['name', '氏名'], ['kana', 'ふりがな'], ['sexLabel', '性別'], ['birthDate', '生年月日'],
  ['phone', '電話'], ['careLevel', '要介護度'], ['muniName', '市町村'], ['venueName', '行政区'],
]
const FILLABLE = ['kana', 'birthDate', 'birth', 'phone', 'careLevel', 'extId', 'note']

const latestDateOf = (u) => ((u && u.series) || []).reduce((a, r) => {
  const d = compactDate(r.date)
  return d > a ? d : a
}, '')

/* 統合したらどうなるかを、書き込まずに計算する。画面の「差分確認」と検証スクリプトの両方で使う。 */
export function mergePlan(keepId, loseId, users = D.users) {
  const keep = users.find(u => u.id === keepId)
  const lose = users.find(u => u.id === loseId)
  if (!keep || !lose) return null
  // 片方にしか無い情報（残す側が空なら埋める）
  const fill = {}
  for (const k of FILLABLE) {
    const kv = keep[k], lv = lose[k]
    const empty = kv === undefined || kv === null || kv === '' || kv === '—'
    const has = !(lv === undefined || lv === null || lv === '' || lv === '—')
    if (empty && has) fill[k] = lv
  }
  // 項目ごとの差分（どちらを消しても情報が欠けないかを職員が見るための表）
  const diff = PROFILE_FIELDS.map(([k, label]) => ({ key: k, label, keep: keep[k] ?? '', lose: lose[k] ?? '' }))
    .filter(r => String(r.keep) !== String(r.lose))
  // 地区: 測定日が新しい側を「現在の所属」にし、もう一方を履歴へ回す
  const keepLast = latestDateOf(keep), loseLast = latestDateOf(lose)
  const loseIsNewer = !!loseLast && loseLast > keepLast
  const keepDates = (keep.series || []).map(r => r.date).filter(Boolean)
  const loseDates = (lose.series || []).map(r => r.date).filter(Boolean)
  const nextCurrent = loseIsNewer
    ? { ward: lose.venueName || '', muni: lose.muni, muniName: lose.muniName, region: lose.region, venueCode: lose.venueCode }
    : { ward: keep.venueName || '', muni: keep.muni, muniName: keep.muniName, region: keep.region, venueCode: keep.venueCode }
  // 同じ評価日が両方にある場合は履歴に入れない（どちらの地区か決められないため、現在の地区で出す）
  const onlyKeep = keepDates.filter(d => !loseDates.includes(d))
  const onlyLose = loseDates.filter(d => !keepDates.includes(d))
  const historyAdd = loseIsNewer
    ? [districtRecord(keep, onlyKeep, { fromUserId: keep.id, source: 'merge' })]
    : [districtRecord(lose, onlyLose, { fromUserId: lose.id, source: 'merge' })]
  // 統合後の測定履歴（時系列）
  const timeline = [...(keep.series || []).map(r => ({ ...r, from: keep.id })), ...(lose.series || []).map(r => ({ ...r, from: lose.id }))]
    .sort((a, b) => (compactDate(a.date) || `${a.year}0000`).localeCompare(compactDate(b.date) || `${b.year}0000`))
  return {
    keep, lose, fill, diff, timeline, historyAdd, nextCurrent, loseIsNewer,
    keepMeas: measCount(keep), loseMeas: measCount(lose), totalMeas: measCount(keep) + measCount(lose),
  }
}

// ---- 実行 ---------------------------------------------------------------------
const nowIso = () => new Date().toISOString()
const mergeId = (keepId, loseId) => `${keepId}_${loseId}_${Date.now()}`

/* 統合を実行する。
   順番が命: ①測定の付け替え → ②件数の確認 → ③残す側の更新 → ④アーカイブ → ⑤記録。
   ②で 1 件でも残っていたら中断し、アーカイブしない（消す側に測定が取り残されるのを防ぐ）。 */
export async function mergeUsers({ keepId, loseId, by = '' }) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です（公開デモでは統合できません）')
  if (keepId === loseId) throw new Error('同じ利用者は統合できません')
  const plan = mergePlan(keepId, loseId)
  if (!plan) throw new Error('利用者が見つかりません')
  const { fs, db } = await getFs()

  // ① 消す側に紐づく測定ドキュメントを全部拾う（voided も含める。監査のため取り残さない）
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'measurements'), fs.where('userId', '==', loseId)))
  const moved = []
  for (const docSnap of snap.docs) {
    const m = docSnap.data()
    const patch = { userId: keepId, mergedFrom: loseId, mergedAt: nowIso() }
    // 測定値が無い（問診票だけ）のドキュメントは、スコア 0 の測定として推移グラフに出てしまうため
    // 「体力測定なし」の印を付ける。問診回答は従来どおり読まれる。元に戻すときはこの印を外す。
    const noValues = !m.values || Object.values(m.values).every(v => v === null || v === undefined)
    const addInbodyOnly = noValues && !m.inbodyOnly
    if (addInbodyOnly) patch.inbodyOnly = true
    await fs.updateDoc(fs.doc(db, 'measurements', docSnap.id), patch)
    moved.push({ docId: docSnap.id, year: m.year ?? null, date: m.date || null, voided: !!m.voided, addedInbodyOnly: addInbodyOnly })
  }

  // ② 付け替えの確認。消す側に測定が 1 件でも残っていたら、ここで止める
  const after = await fs.getDocs(fs.query(fs.collection(db, 'measurements'), fs.where('userId', '==', loseId)))
  if (!after.empty) {
    throw new Error(`測定の付け替えが完了していません（${after.size} 件が ${loseId} に残っています）。統合を中断しました`)
  }

  // ③ 残す側を更新（空欄の補完 / 地区の履歴 / 測定キーの索引）
  const keepDoc = {}
  Object.assign(keepDoc, plan.fill)
  const prevDistrict = districtRecord(plan.keep, [], { fromUserId: plan.keep.id })
  if (plan.loseIsNewer) {
    keepDoc.ward = plan.nextCurrent.ward
    keepDoc.muni = plan.nextCurrent.muni
    keepDoc.muniName = plan.nextCurrent.muniName
    keepDoc.region = plan.nextCurrent.region
    if (plan.nextCurrent.venueCode != null) keepDoc.venueCode = plan.nextCurrent.venueCode
  }
  const history = [...((plan.keep.districtHistory) || []), ...plan.historyAdd.map(h => ({ ...h, at: nowIso(), by }))]
  keepDoc.districtHistory = history
  // 電子手帳（本人ログイン）は文書 ID 指定でしか測定を読めないため、索引も引き継ぐ
  if (moved.length) keepDoc.measKeys = fs.arrayUnion(...moved.map(x => x.docId))
  await fs.setDoc(fs.doc(db, 'users', keepId), keepDoc, { merge: true })

  // ④ 消す側をアーカイブ（削除はしない）
  const id = mergeId(keepId, loseId)
  await fs.setDoc(fs.doc(db, 'users', loseId), {
    archived: true, archivedAt: nowIso(), archivedBy: by, mergedInto: keepId, mergeId: id,
  }, { merge: true })

  // ⑤ 操作ログ（＝元に戻すための台帳）
  const log = {
    mergeId: id, keepId, loseId,
    keepName: plan.keep.name, loseName: plan.lose.name,
    keepDistrict: `${plan.keep.muniName} / ${plan.keep.venueName || '—'}`,
    loseDistrict: `${plan.lose.muniName} / ${plan.lose.venueName || '—'}`,
    movedCount: moved.length, moved,
    filled: plan.fill,
    historyAdded: plan.historyAdd.length,
    prevKeepDistrict: prevDistrict,
    prevKeepHistory: (plan.keep.districtHistory) || [],
    districtSwitched: !!plan.loseIsNewer,
    by, at: nowIso(), status: 'merged',
  }
  await fs.setDoc(fs.doc(db, 'merges', id), log)

  // メモリ側も揃える（画面の再読込を待たずに反映する）
  applyMergeInMemory(plan, moved, history, by)
  return log
}

function applyMergeInMemory(plan, moved, history, by) {
  const { keep, lose } = plan
  Object.assign(keep, plan.fill)
  if (plan.loseIsNewer) {
    keep.venueName = plan.nextCurrent.ward
    keep.muni = plan.nextCurrent.muni
    keep.muniName = plan.nextCurrent.muniName
    keep.region = plan.nextCurrent.region
    if (plan.nextCurrent.venueCode != null) keep.venueCode = plan.nextCurrent.venueCode
  }
  keep.districtHistory = history
  const movedIds = new Set(moved.filter(x => x.addedInbodyOnly).map(x => x.docId))
  keep.series = [...(keep.series || []), ...(lose.series || []).filter(r => !movedIds.has(r.key))]
    .sort((a, b) => (compactDate(a.date) || `${a.year}0000`).localeCompare(compactDate(b.date) || `${b.year}0000`))
  keep.meas = {}
  for (const r of keep.series) {
    const cur = keep.meas[r.year]
    if (!cur || (compactDate(r.date) || `${r.year}0000`) >= (compactDate(cur.date) || `${cur.year}0000`)) keep.meas[r.year] = r
  }
  for (const y of Object.keys(lose.kcl || {})) {
    keep.kcl = keep.kcl || {}
    keep.kcl[y] = { raw: { ...((keep.kcl[y] || {}).raw || {}), ...((lose.kcl[y] || {}).raw || {}) }, date: (keep.kcl[y] || {}).date || (lose.kcl[y] || {}).date || null }
  }
  for (const y of Object.keys(lose.inbody || {})) {
    keep.inbody = keep.inbody || {}
    if (!keep.inbody[y]) keep.inbody[y] = lose.inbody[y]
  }
  const ys = Object.keys(keep.meas).map(Number)
  if (ys.length) keep.joined = Math.min(...ys)
  lose.archived = true
  lose.mergedInto = keep.id
  lose.archivedBy = by
  const i = D.users.indexOf(lose)
  if (i >= 0) D.users.splice(i, 1)
}

/* 統合を元に戻す。測定の userId を書き戻し、アーカイブを解除する。 */
export async function undoMerge(log) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です')
  if (!log || log.status !== 'merged') throw new Error('この統合はすでに取り消されています')
  const { fs, db } = await getFs()
  for (const m of (log.moved || [])) {
    const patch = { userId: log.loseId, mergedFrom: null, mergedAt: null }
    if (m.addedInbodyOnly) patch.inbodyOnly = null
    await fs.updateDoc(fs.doc(db, 'measurements', m.docId), patch)
  }
  const keepPatch = { districtHistory: log.prevKeepHistory || [] }
  // 補完した項目は元に戻す（統合で入った値だけを消す）
  for (const k of Object.keys(log.filled || {})) keepPatch[k] = null
  if (log.districtSwitched && log.prevKeepDistrict) {
    keepPatch.ward = log.prevKeepDistrict.ward || ''
    keepPatch.muni = log.prevKeepDistrict.muni || ''
    keepPatch.muniName = log.prevKeepDistrict.muniName || ''
    keepPatch.region = log.prevKeepDistrict.region || ''
    if (log.prevKeepDistrict.venueCode != null) keepPatch.venueCode = log.prevKeepDistrict.venueCode
  }
  await fs.setDoc(fs.doc(db, 'users', log.keepId), keepPatch, { merge: true })
  await fs.setDoc(fs.doc(db, 'users', log.loseId), {
    archived: false, mergedInto: null, mergeId: null, archivedAt: null, archivedBy: null,
  }, { merge: true })
  await fs.setDoc(fs.doc(db, 'merges', log.mergeId), { status: 'undone', undoneAt: nowIso() }, { merge: true })
}

// ---- 地区（行政区）の統合・改称 -------------------------------------------------
/* 人の重複とは別に、「同じ地区が 2 つの名前で並んでいる」ことがある。
   例: 長嶺（C型） と 長嶺南8町内。呼び方が変わっただけで実体は同じ地区。
   放っておくと台帳・提出・用紙作成の絞り込みが 2 つに割れる。 */

/* 地区ごとの内訳（人数・市町村・測定年度）。地区の整理の材料。 */
export function wardSummary(users = D.users) {
  const g = {}
  for (const u of users) {
    const w = u.venueName || ''
    if (!w) continue
    const e = (g[w] ||= { ward: w, users: [], munis: {}, meas: 0 })
    e.users.push(u)
    e.munis[u.muniName || '（未設定）'] = (e.munis[u.muniName || '（未設定）'] || 0) + 1
    e.meas += measCount(u)
  }
  return Object.values(g).sort((a, b) => a.ward.localeCompare(b.ward, 'ja'))
}

// 地区名から「呼び方の飾り」を落とした基名。（C型）・町内・会・サロン等の違いを無視して比べる
const wardBase = (s) => normJa(s)
  .replace(/[（(].*?[)）]/g, '')
  .replace(/[0-9０-９]+/g, '')
  .replace(/町内|いきいきさろん|いきいきたいそうくらぶ|くらぶ|さろん|かい|みなみ|きた|ひがし|にし/g, '')

/* 地区の「おかしいところ」を洗い出す。
   kind:'rename'  … 名前が似ている地区が 2 つある（改称・分割の可能性）
   kind:'muni'    … 1 つの地区に複数の市町村が混ざっている／市町村が他の地区とずれている */
export function wardIssues(users = D.users) {
  const sum = wardSummary(users)
  const out = []
  const byBase = {}
  for (const s of sum) {
    const b = wardBase(s.ward)
    if (!b) continue
    ;(byBase[b] ||= []).push(s)
  }
  for (const [b, list] of Object.entries(byBase)) {
    if (list.length > 1) out.push({ kind: 'rename', base: b, wards: list })
  }
  for (const s of sum) {
    if (Object.keys(s.munis).length > 1) out.push({ kind: 'muni', ward: s.ward, munis: s.munis, wards: [s] })
  }
  return out
}

/* 地区の統合・改称を実行する。
   fromWards の利用者の地区名を toWard に揃える（必要なら市町村も揃える）。
   mode:
     'rename' … 呼び方が変わっただけ。過去の測定も新しい地区名で提出する（旧称は履歴に残すだけ）
     'moved'  … 別の地区へ移った。過去の測定は前の地区のまま提出する（履歴に測定日つきで残す）
   利用者も測定も削除しない。記録（merges, kind:'ward'）からいつでも元に戻せる。 */
export async function applyWardChange({ fromWards, toWard, muniName, muni, region, mode = 'rename', by = '' }) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です（公開デモでは実行できません）')
  const targets = D.users.filter(u => (fromWards || []).includes(u.venueName || ''))
  if (!targets.length) throw new Error('対象の利用者がいません')
  const { fs, db } = await getFs()
  const id = `ward_${Date.now()}`
  const changes = []
  for (const u of targets) {
    const prev = {
      ward: u.venueName || '', muni: u.muni || '', muniName: u.muniName || '',
      region: u.region || '', historyLen: (u.districtHistory || []).length,
    }
    const doc = {}
    const nextWard = toWard
    const nextMuniName = muniName || u.muniName
    const nextMuni = muni || (muniName ? muniName : u.muni)
    const nextRegion = region || u.region
    const changed = prev.ward !== nextWard || prev.muniName !== nextMuniName || prev.region !== nextRegion
    if (!changed) continue
    // 履歴。改称（rename）は測定日を入れない＝提出は新しい地区名で出る。
    // 移動（moved）は測定日を入れる＝その測定は前の地区で提出される。
    const dates = mode === 'moved' ? (u.series || []).map(r => r.date).filter(Boolean) : []
    const hist = [...(u.districtHistory || []), {
      ward: prev.ward, muni: prev.muni, muniName: prev.muniName, region: prev.region,
      venueCode: u.venueCode ?? null, dates, fromUserId: u.id,
      source: mode === 'moved' ? 'ward-move' : 'ward-rename', at: nowIso(), by,
    }]
    doc.ward = nextWard
    doc.muniName = nextMuniName
    doc.muni = nextMuni
    doc.region = nextRegion
    doc.districtHistory = hist
    await fs.setDoc(fs.doc(db, 'users', u.id), doc, { merge: true })
    // メモリも揃える
    u.venueName = nextWard; u.muniName = nextMuniName; u.muni = nextMuni; u.region = nextRegion
    u.districtHistory = hist
    changes.push({ userId: u.id, name: u.name, prev, next: { ward: nextWard, muni: nextMuni, muniName: nextMuniName, region: nextRegion } })
  }
  const log = {
    mergeId: id, kind: 'ward', mode, fromWards, toWard,
    muniName: muniName || '', region: region || '',
    changedCount: changes.length, changes, by, at: nowIso(), status: 'merged',
    keepName: toWard, loseName: (fromWards || []).join('・'),
    keepId: '-', loseId: '-', movedCount: 0,
  }
  await fs.setDoc(fs.doc(db, 'merges', id), log)
  return log
}

/* 地区の統合・改称を元に戻す。 */
export async function undoWardChange(log) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です')
  if (!log || log.status !== 'merged') throw new Error('この操作はすでに取り消されています')
  const { fs, db } = await getFs()
  for (const c of (log.changes || [])) {
    const snap = await fs.getDoc(fs.doc(db, 'users', c.userId))
    const hist = ((snap.exists() ? snap.data().districtHistory : []) || []).slice(0, c.prev.historyLen)
    await fs.setDoc(fs.doc(db, 'users', c.userId), {
      ward: c.prev.ward, muni: c.prev.muni, muniName: c.prev.muniName, region: c.prev.region,
      districtHistory: hist,
    }, { merge: true })
    const u = D.users.find(x => x.id === c.userId)
    if (u) { u.venueName = c.prev.ward; u.muni = c.prev.muni; u.muniName = c.prev.muniName; u.region = c.prev.region; u.districtHistory = hist }
  }
  await fs.setDoc(fs.doc(db, 'merges', log.mergeId), { status: 'undone', undoneAt: nowIso() }, { merge: true })
}

// ---- 測定の事業区分（自治体依頼 / 短期集中予防C型） -------------------------------
/* 「C型かどうか」は地区名の「（C型）」で見分けていたが、地区名は団体の改称でまとめるため、
   その前に測定側へ印を移しておく必要がある（印を移さずに地区名を変えると情報が消える）。
   利用者ではなく測定に持たせるのは、同じ方が自治体依頼と C型 の両方を受けうるため。 */
export async function setMeasurementProgram({ userIds, program = 'cType', by = '', note = '' }) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です')
  const { fs, db } = await getFs()
  const id = `program_${Date.now()}`
  const changes = []
  for (const uid of (userIds || [])) {
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'measurements'), fs.where('userId', '==', uid)))
    for (const docSnap of snap.docs) {
      const prev = docSnap.data().program || ''
      if (prev === program) continue
      await fs.updateDoc(fs.doc(db, 'measurements', docSnap.id), { program })
      changes.push({ docId: docSnap.id, userId: uid, prev })
    }
    const u = D.users.find(x => x.id === uid)
    if (u) { (u.series || []).forEach(r => { r.program = program }); u.cType = program === 'cType' }
  }
  const log = {
    mergeId: id, kind: 'program', program, userIds, note,
    changedCount: changes.length, changes, by, at: nowIso(), status: 'merged',
    keepName: program === 'cType' ? '短期集中予防サービス（C型）' : '自治体依頼',
    loseName: `${(userIds || []).length} 名`, keepId: '-', loseId: '-', movedCount: changes.length,
  }
  await fs.setDoc(fs.doc(db, 'merges', id), log)
  return log
}

export async function undoMeasurementProgram(log) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です')
  if (!log || log.status !== 'merged') throw new Error('この操作はすでに取り消されています')
  const { fs, db } = await getFs()
  for (const c of (log.changes || [])) {
    await fs.updateDoc(fs.doc(db, 'measurements', c.docId), { program: c.prev || null })
  }
  await fs.setDoc(fs.doc(db, 'merges', log.mergeId), { status: 'undone', undoneAt: nowIso() }, { merge: true })
}

/* 統合の記録を新しい順に読む（統合画面の履歴表示・元に戻す用） */
export async function loadMergeLog(limit = 50) {
  if (!dbEnabled()) return []
  const { fs, db } = await getFs()
  const snap = await fs.getDocs(fs.query(fs.collection(db, 'merges'), fs.orderBy('at', 'desc'), fs.limit(limit)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}
