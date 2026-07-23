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

// Firestore から全利用者・全測定を読み込み、エンジンへ適用する。読み込めたら true。
export async function loadRealData() {
  if (!dbEnabled()) return false
  try {
    const { fs, db } = await getFs()
    const usnap = await fs.getDocs(fs.collection(db, 'users'))
    if (usnap.empty) return false
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
    return true
  } catch (e) {
    console.error('loadRealData failed:', e)
    return false
  }
}
