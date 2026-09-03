/* 実データ（Firestore）の読み込み → エンジンの利用者配列に差し込む継ぎ目。
   VITE_FIREBASE_CONFIG があり、認証済みで、Firestore に users がある場合のみ実データを使う。
   未設定・データ無しなら false を返し、従来のシードデモのまま。
   個人情報を含むため、実データはログイン内（認証後）でのみ読み込む。 */
import D, { axesOf, setUsers, replaceMunis } from '../data/engine.js'
import { dbEnabled, getFs } from './db.js'

export const realDataEnabled = () => dbEnabled()

// 測定値（欠測を左右で補完）→ 5領域スコアと総合スコアを算出
function scoreOf(sex, v) {
  const vv = {
    walk5: v.walk5 ?? null, walk5max: v.walk5max ?? null,
    balR: v.balR ?? v.balL ?? null, balL: v.balL ?? v.balR ?? null,
    gripR: v.gripR ?? v.gripL ?? null, gripL: v.gripL ?? v.gripR ?? null,
    tug: v.tug ?? null, height: v.height ?? null, weight: v.weight ?? null,
    bmi: v.bmi ?? ((v.height && v.weight) ? Math.round((v.weight / Math.pow(v.height / 100, 2)) * 10) / 10 : null),
  }
  let axes, total
  try {
    axes = axesOf(sex, vv)
    total = Math.round(((axes.walk + axes.balance + axes.grip + axes.mobility + axes.body) / 25) * 100)
  } catch {
    axes = { walk: 1, balance: 1, grip: 1, mobility: 1, body: 1 }; total = 0
  }
  return { values: vv, axes, total }
}

// Firestore の user ドキュメント + 測定群 → エンジン形式の利用者オブジェクト
// (電子手帳のポータル読み込み(techo.js)からも使う)
export function toEngineUser(u, measList) {
  const meas = {}, inbody = {}, kcl = {}
  for (const m of measList) {
    // 評価年の修正で別年度に移した元ドキュメント。監査のため残すが表示・集計には使わない
    if (m.voided) continue
    // InBody(体組成): ETL(etl-inbody.py)が突合して測定に付与した inbody を読む。旧 inbodySmi も後方互換。
    if (m.inbody) {
      const ib = m.inbody
      inbody[m.year] = {
        smm: ib.smm ?? null, smi: ib.smi ?? null, fatPct: ib.fatPct ?? null,
        score: ib.score ?? null, weight: ib.weight ?? (m.values ? m.values.weight : null) ?? null,
        date: ib.testDate || m.date || null,
      }
    } else if (m.inbodySmi != null) {
      inbody[m.year] = { smi: m.inbodySmi, smm: null, fatPct: null, score: null }
    }
    // InBody 単独の記録（その年の体力測定が台帳に無い。例: 令和5年度）は
    // 参加履歴・スコアには入れず、InBody 欄にのみ表示する。
    // 問診票の実回答(kclAnswers)。kihon.js の kclScore が読む raw 形式に変換する
    if (m.kclAnswers) kcl[m.year] = { raw: { ...((kcl[m.year] || {}).raw || {}), ...m.kclAnswers }, date: m.date || null }
    if (m.inbodyOnly) continue
    const s = scoreOf(u.sex, m.values || {})
    meas[m.year] = { ...s, date: m.date || null, review: !!m.review }
  }
  const years = Object.keys(meas).map(Number)
  return {
    id: u.id, name: u.name || '', kana: u.kana || '',
    sex: u.sex || 'F', sexLabel: u.sex === 'M' ? '男' : '女',
    birth: u.birth || null, birthDate: u.birthDate || '',
    age: u.birth ? (D.CUR - u.birth) : (u.age || null),
    muni: u.muni || 'kashima', muniName: u.muniName || '嘉島町', region: u.region || '嘉島町圏域',
    venueCode: u.venueCode || 900, venueName: u.ward || u.venueName || '',
    phone: u.phone || '', careLevel: u.careLevel || '',
    joined: years.length ? Math.min(...years) : D.CUR, theta: 0,
    note: u.note || '', flags: u.flags || [], walkIn: !!u.walkIn,
    portal: u.portal || null, // 電子手帳アカウント { loginId, issuedAt }
    meas, inbody, kcl,
  }
}

// ---- 編集（Phase③）: メモリ即時反映 + Firestore 保存 --------------------------
// 利用者の基本情報を更新（氏名・かな・性別・生年月日・市町村/行政区・介護度・電話）
export async function saveUserFields(id, patch) {
  const u = D.users.find(x => x.id === id)
  if (u) {
    Object.assign(u, patch)
    if (patch.sex) u.sexLabel = patch.sex === 'M' ? '男' : '女'
    if (patch.birthDate !== undefined) {
      const y = parseInt(String(patch.birthDate).slice(0, 4), 10)
      if (y) { u.birth = y; u.age = D.CUR - y }
    }
    // 市町村は名前で登録・編集する（新しい市町村名を打てば自動で選択肢に増える）。
    if (patch.muniName !== undefined) u.muni = patch.muniName
  }
  if (dbEnabled()) {
    const { fs, db } = await getFs()
    const doc = {}
    for (const k of ['name', 'kana', 'sex', 'birthDate', 'careLevel', 'phone']) {
      if (patch[k] !== undefined) doc[k] = patch[k]
    }
    if (patch.muniName !== undefined) { doc.muniName = patch.muniName; doc.muni = patch.muniName }
    if (patch.venueName !== undefined) doc.ward = patch.venueName
    if (u && u.birth != null) doc.birth = u.birth
    await fs.setDoc(fs.doc(db, 'users', id), doc, { merge: true })
  }
}

// 新規利用者を Firestore に保存（メモリへの追加は呼び出し側で実施済み）。
// venueName＝行政区。muni はメモリの id と一致させる（再読込後もフィルタが揃うように）。
export async function createUserDoc(u) {
  if (!dbEnabled()) return
  const { fs, db } = await getFs()
  const doc = {
    name: u.name || '', kana: u.kana || '', sex: u.sex || 'F',
    birth: u.birth ?? null, birthDate: u.birthDate || '',
    muni: u.muni || '', muniName: u.muniName || '', region: u.region || '',
    ward: u.venueName || '', venueCode: u.venueCode ?? null,
    phone: u.phone || '', careLevel: u.careLevel || '',
    walkIn: !!u.walkIn, // 当日受付の仮登録(正式登録で false に。true の間は台帳一覧に出さない)
  }
  await fs.setDoc(fs.doc(db, 'users', u.id), doc, { merge: true })
}

// 年度の測定値を更新（5領域・総合スコアを再計算 + Firestore 保存）
// date(評価日)を渡すと合わせて保存する(undefined なら触らない。'' は未記入=null 扱い)
export async function saveMeasurement(id, year, values, date) {
  const u = D.users.find(x => x.id === id)
  const s = scoreOf(u ? u.sex : 'F', values)
  const d = date === undefined ? undefined : (String(date).trim() || null)
  if (u) {
    const prev = u.meas[year] || {}
    u.meas[year] = { ...prev, values: s.values, axes: s.axes, total: s.total }
    if (d !== undefined) u.meas[year].date = d
    if (!u.meas[year].date) u.meas[year].date = null
    // 評価日は測定ドキュメント共通のため、同年の問診カードの表示日も揃える
    if (d !== undefined && u.kcl && u.kcl[year]) u.kcl[year].date = d
  }
  if (dbEnabled()) {
    const { fs, db } = await getFs()
    const doc = { userId: id, year: Number(year), values: s.values }
    if (d !== undefined) doc.date = d
    await fs.setDoc(fs.doc(db, 'measurements', `${id}_${year}`), doc, { merge: true })
  }
  return s
}

// 評価年の修正: 記録(測定値・問診回答・InBody・評価日)を別の年度へ移す。
// Firestore は削除不可(監査性)のため、元の年度のドキュメントには voided フラグを立てて
// 読み込み時に飛ばす。移動先に既にデータがある場合はエラー(上書き事故防止)。
export async function moveMeasurementYear(id, fromY, toY) {
  const u = D.users.find(x => x.id === id)
  if (u && (u.meas[toY] || (u.kcl && u.kcl[toY]) || (u.inbody && u.inbody[toY]))) {
    throw new Error(`移動先の年度に既にデータがあります。先に移動先(${toY}年度)のデータを確認してください`)
  }
  if (dbEnabled()) {
    const { fs, db } = await getFs()
    const oldRef = fs.doc(db, 'measurements', `${id}_${fromY}`)
    const snap = await fs.getDoc(oldRef)
    const data = snap.exists() ? snap.data() : {}
    delete data.voided
    // 移動先は丸ごと置き換え(過去に voided にした残骸があっても消える)
    await fs.setDoc(fs.doc(db, 'measurements', `${id}_${toY}`), { ...data, userId: id, year: Number(toY) })
    await fs.setDoc(oldRef, { userId: id, year: Number(fromY), voided: true }, { merge: true })
  }
  if (u) {
    if (u.meas[fromY]) { u.meas[toY] = u.meas[fromY]; delete u.meas[fromY] }
    if (u.kcl && u.kcl[fromY]) { u.kcl[toY] = u.kcl[fromY]; delete u.kcl[fromY] }
    if (u.inbody && u.inbody[fromY]) { u.inbody[toY] = u.inbody[fromY]; delete u.inbody[fromY] }
    const ys = Object.keys(u.meas).map(Number)
    if (ys.length) u.joined = Math.min(...ys)
  }
}

// 年度の基本チェックリスト回答を保存（はい/いいえのみ残し、丸ごと置き換える）
// 誤読の訂正で「未回答」に戻した設問がきちんと消えるように、
// setDoc(merge) のキー単位マージではなく updateDoc でマップごと置き換える。
// date(評価日)を渡すと合わせて保存する(undefined なら触らない。'' は未記入=null 扱い)
export async function saveKclAnswers(id, year, answers, date) {
  const clean = {}
  Object.entries(answers || {}).forEach(([k, v]) => { if (v === 'yes' || v === 'no') clean[k] = v })
  const d = date === undefined ? undefined : (String(date).trim() || null)
  const u = D.users.find(x => x.id === id)
  if (u) {
    u.kcl = u.kcl || {}
    const prevDate = (u.kcl[year] || {}).date || null
    u.kcl[year] = { raw: clean, date: d !== undefined ? d : prevDate }
    // 評価日は測定ドキュメント共通のため、同年の測定側の表示日も揃える
    if (d !== undefined && u.meas[year]) u.meas[year].date = d
  }
  if (dbEnabled()) {
    const { fs, db } = await getFs()
    const ref = fs.doc(db, 'measurements', `${id}_${year}`)
    // セキュリティルールが userId/year を要求するため、先に merge で確保しておく
    const base = { userId: id, year: Number(year) }
    if (d !== undefined) base.date = d
    await fs.setDoc(ref, base, { merge: true })
    await fs.updateDoc(ref, { kclAnswers: clean })
  }
  return clean
}

// Firestore から全利用者・全測定を読み込み、エンジンへ適用する。
// 戻り値: { loaded: 実データを適用したか, denied: 権限なし(未承認の職員) }
export async function loadRealData() {
  if (!dbEnabled()) return { loaded: false }
  try {
    const { fs, db } = await getFs()
    const usnap = await fs.getDocs(fs.collection(db, 'users'))
    // 本番(Firebase 設定あり)では、データが無くてもシード(ダミー)を表示しない。空の台帳にする。
    if (usnap.empty) { setUsers([]); return { loaded: true, empty: true } }
    const msnap = await fs.getDocs(fs.collection(db, 'measurements'))
    const byUser = {}
    msnap.forEach(d => { const m = d.data(); (byUser[m.userId] ||= []).push(m) })
    const list = usnap.docs.map(d => toEngineUser({ id: d.id, ...d.data() }, byUser[d.id] || []))
      .filter(u => u.name)
    // 市町村と行政区を選択肢に登録(複数市町村に対応: 嘉島町 + 熊本市各区 など)。
    // 利用者数の多い市町村を先頭にする(当日受付などの既定値が従来どおり嘉島町になるように)
    const muniIds = [...new Set(list.map(u => u.muni).filter(Boolean))]
      .sort((a, b) => list.filter(u => u.muni === b).length - list.filter(u => u.muni === a).length)
    let vc = 900
    const munis = muniIds.map((id) => {
      const us = list.filter(u => u.muni === id)
      const wards = [...new Set(us.map(u => u.venueName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
      return { id, name: us[0].muniName || String(id), region: us[0].region || '', tel: '', venues: wards.map(w => [vc++, w]) }
    })
    replaceMunis(munis.length ? munis : [{ id: 'kashima', name: '嘉島町', region: '嘉島町圏域', tel: '', venues: [] }])
    setUsers(list)
    return { loaded: true }
  } catch (e) {
    if (e && e.code === 'permission-denied') return { loaded: false, denied: true }
    console.error('loadRealData failed:', e)
    return { loaded: false }
  }
}
