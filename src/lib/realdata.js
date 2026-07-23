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
function toEngineUser(u, measList) {
  const meas = {}, inbody = {}
  for (const m of measList) {
    const s = scoreOf(u.sex, m.values || {})
    meas[m.year] = { ...s, date: m.date || null, review: !!m.review }
    if (m.inbodySmi != null) inbody[m.year] = { smi: m.inbodySmi, smm: null, fatPct: null, score: null }
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
    note: u.note || '', flags: u.flags || [],
    meas, inbody, kcl: {},
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

// 年度の測定値を更新（5領域・総合スコアを再計算 + Firestore 保存）
export async function saveMeasurement(id, year, values) {
  const u = D.users.find(x => x.id === id)
  const s = scoreOf(u ? u.sex : 'F', values)
  if (u) {
    const prev = u.meas[year] || {}
    u.meas[year] = { ...prev, values: s.values, axes: s.axes, total: s.total }
    if (!u.meas[year].date) u.meas[year].date = null
  }
  if (dbEnabled()) {
    const { fs, db } = await getFs()
    await fs.setDoc(fs.doc(db, 'measurements', `${id}_${year}`),
      { userId: id, year: Number(year), values: s.values }, { merge: true })
  }
  return s
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
    // 市町村（嘉島町）と行政区を選択肢に登録
    const wards = [...new Set(list.map(u => u.venueName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
    const muniId = list[0]?.muni || 'kashima'
    const muniName = list[0]?.muniName || '嘉島町'
    const region = list[0]?.region || '嘉島町圏域'
    replaceMunis([{ id: muniId, name: muniName, region, tel: '', venues: wards.map((w, i) => [900 + i, w]) }])
    setUsers(list)
    return { loaded: true }
  } catch (e) {
    if (e && e.code === 'permission-denied') return { loaded: false, denied: true }
    console.error('loadRealData failed:', e)
    return { loaded: false }
  }
}
