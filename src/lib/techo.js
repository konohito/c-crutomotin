/* 電子手帳(介護予防手帳)のデータ層。
   - デモ(Firebase 未設定): メモリ上に保持。開いた利用者に直近の記録をシード生成して雰囲気を再現
   - 本番: Firestore techo/{userId} (目標・興味関心) + techo/{userId}/logs/{id} (体調・活動記録)
   - 利用者アカウント: 副 Firebase アプリで Auth ユーザーを作成し(職員のログインを保持したまま)、
     portalUsers/{authUid} = { userId } で本人と紐付ける。利用者は「ログインID + パスワード」で
     ログインすると、自分の手帳だけが見える(firestore.rules 参照)。 */
import D from '../data/engine.js'
import { dbEnabled, firebaseConfig, getFs } from './db.js'
import { toEngineUser } from './realdata.js'

// ログインID: u + 参加者ID(5桁)。Firebase Auth はメール形式が必要なため合成ドメインを付ける
const PORTAL_DOMAIN = 'techo.cruto-motion.app'
export const portalLoginId = (userId) => 'u' + userId
export const portalEmailOf = (input) => {
  const s = String(input || '').trim()
  if (s.includes('@')) return s
  const id = s.replace(/[^0-9a-zA-Z]/g, '')
  return (/^\d+$/.test(id) ? 'u' + id : id) + '@' + PORTAL_DOMAIN
}
// 紛らわしい文字(0/O, 1/l/I)を除いた初期パスワード
export function genPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

// 興味・関心の選択肢(印刷版の記録手帳と同じ並び)
export const INTERESTS = ['散歩・ウォーキング', '体操・ストレッチ', '園芸・畑仕事', '料理', '手芸・工作', '囲碁・将棋', 'カラオケ・音楽', '読書', '旅行', 'ボランティア', '地域のサロン', 'グラウンドゴルフ', 'おしゃべり会', '習い事']
export const MOODS = ['◎', '○', '△']

// '2025/9/24' 形式を新しい順に並べ替え(月日をゼロ埋めして比較)
const dkey = (s) => String(s || '').split('/').map(x => x.padStart(2, '0')).join('')
export const sortLogs = (logs) => [...logs].sort((a, b) => dkey(b.date).localeCompare(dkey(a.date)))

export const todayStr = () => {
  if (!dbEnabled()) return D.TODAY
  const d = new Date()
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

// ---- デモ用メモリストア ------------------------------------------------------
const mem = new Map() // userId -> { goal, interests, logs, portal }
function mul32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function seedDemo(u) {
  const R = mul32(20260806 + Number(u.id))
  const ys = Object.keys(u.meas || {}).map(Number)
  const w0 = ys.length ? u.meas[ys[ys.length - 1]].values.weight : 52
  const [ty, tm, td] = D.TODAY.split('/').map(Number)
  const logs = []
  const n = 4 + Math.floor(R() * 4)
  for (let i = 0; i < n; i++) {
    const back = i === 0 ? 0 : i * (1 + Math.floor(R() * 2))
    const dt = new Date(ty, tm - 1, td - back)
    logs.push({
      id: 'demo' + i,
      date: `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`,
      bpH: 112 + Math.floor(R() * 34), bpL: 62 + Math.floor(R() * 24),
      weight: w0 == null ? null : Math.round((w0 + (R() - 0.5) * 1.2) * 10) / 10,
      sleep: 5 + Math.floor(R() * 4), meal: R() < 0.85 ? 3 : 2, water: 4 + Math.floor(R() * 4),
      mood: MOODS[R() < 0.55 ? 0 : R() < 0.8 ? 1 : 2],
      steps: 1500 + Math.floor(R() * 45) * 100,
      place: ['通いの場', '自宅で体操', '散歩', ''][Math.floor(R() * 4)],
      memo: R() < 0.25 ? ['膝の調子が良い', '友人と長く歩けた', '少し疲れ気味', '食欲あり'][Math.floor(R() * 4)] : '',
      by: 'self',
    })
  }
  const goals = ['孫と一緒に旅行に行けるよう、足腰を丈夫に保つ', '畑仕事をこれからも続けたい', '週1回の通いの場を休まず続ける', '']
  return {
    goal: goals[Math.floor(R() * goals.length)],
    interests: INTERESTS.filter(() => R() < 0.22),
    logs, portal: u.portal || null,
  }
}
function demoOf(u) {
  if (!mem.has(u.id)) mem.set(u.id, seedDemo(u))
  return mem.get(u.id)
}

// ---- 読み書き(職員画面・利用者ポータル共用) ---------------------------------
// 手帳の内容を読み込む → { goal, interests, logs, portal }
export async function loadTecho(u) {
  if (!dbEnabled()) return { ...demoOf(u), logs: [...demoOf(u).logs] }
  const { fs, db } = await getFs()
  const snap = await fs.getDoc(fs.doc(db, 'techo', u.id))
  const prof = snap.exists() ? snap.data() : {}
  const lq = fs.query(fs.collection(db, 'techo', u.id, 'logs'), fs.orderBy('date', 'desc'), fs.limit(90))
  const lsnap = await fs.getDocs(lq)
  const logs = lsnap.docs.map(d => ({ id: d.id, ...d.data() }))
  return { goal: prof.goal || '', interests: prof.interests || [], logs, portal: u.portal || null }
}

// 目標・興味関心を保存
export async function saveTechoProfile(u, { goal, interests }) {
  if (!dbEnabled()) { Object.assign(demoOf(u), { goal, interests }); return }
  const { fs, db } = await getFs()
  await fs.setDoc(fs.doc(db, 'techo', u.id), { goal: goal || '', interests: interests || [], updatedAt: fs.serverTimestamp() }, { merge: true })
}

// 体調・活動記録を 1 件追加(新しい順の配列に入れて返す)
export async function addTechoLog(u, entry) {
  if (!dbEnabled()) {
    const e = { ...entry, id: 'm' + Date.now() }
    demoOf(u).logs.unshift(e)
    return e
  }
  const { fs, db } = await getFs()
  const ref = await fs.addDoc(fs.collection(db, 'techo', u.id, 'logs'), { ...entry, at: fs.serverTimestamp() })
  return { ...entry, id: ref.id }
}

// 記録を削除(職員のみ。誤入力の訂正用)
export async function deleteTechoLog(u, logId) {
  if (!dbEnabled()) {
    const d = demoOf(u)
    d.logs = d.logs.filter(l => l.id !== logId)
    mem.set(u.id, d)
    return
  }
  const { fs, db } = await getFs()
  await fs.deleteDoc(fs.doc(db, 'techo', u.id, 'logs', logId))
}

// ---- 利用者アカウント発行 -----------------------------------------------------
// ログインID(u+参加者ID)と初期パスワードで Firebase Auth ユーザーを作成し、本人と紐付ける。
// 戻り値 { loginId, password }。パスワードはこの時にしか表示できない(保存しない)。
export async function issuePortalAccount(u) {
  const loginId = portalLoginId(u.id)
  const password = genPassword()
  if (!dbEnabled()) {
    const portal = { loginId, issuedAt: D.TODAY }
    demoOf(u).portal = portal
    u.portal = portal
    return { loginId, password }
  }
  const cfg = firebaseConfig()
  const { initializeApp, deleteApp } = await import('firebase/app')
  const authMod = await import('firebase/auth')
  // 副アプリで作成(職員のログインを奪わないため)。staffAdmin.addStaff と同じ方式
  const sec = initializeApp(cfg, 'techo-portal-' + Date.now())
  const secAuth = authMod.getAuth(sec)
  const emu = import.meta.env.VITE_AUTH_EMULATOR_URL
  if (emu) { try { authMod.connectAuthEmulator(secAuth, emu, { disableWarnings: true }) } catch { /* noop */ } }
  let authUid
  try {
    const cred = await authMod.createUserWithEmailAndPassword(secAuth, portalEmailOf(loginId), password)
    authUid = cred.user.uid
    await authMod.signOut(secAuth)
  } catch (e) {
    await deleteApp(sec).catch(() => {})
    if (e && e.code === 'auth/email-already-in-use') throw new Error('この利用者のアカウントは発行済みです。パスワードを忘れた場合は管理者(Firebase コンソール)で再設定してください。')
    throw new Error((e && e.message) || 'アカウント作成に失敗しました')
  }
  await deleteApp(sec).catch(() => {})
  const { fs, db } = await getFs()
  await fs.setDoc(fs.doc(db, 'portalUsers', authUid), { userId: u.id, loginId, name: u.name || '', createdAt: fs.serverTimestamp() })
  const portal = { loginId, issuedAt: todayStr() }
  await fs.setDoc(fs.doc(db, 'users', u.id), { portal }, { merge: true })
  u.portal = portal
  return { loginId, password }
}

// ---- 利用者ポータル(本人ログイン後) ------------------------------------------
// 認証 uid → 本人の利用者データ(エンジン形式)を読み込む。紐付けが無ければ null。
export async function loadPortalData(authUid) {
  if (!dbEnabled() || !authUid) return null
  try {
    const { fs, db } = await getFs()
    const map = await fs.getDoc(fs.doc(db, 'portalUsers', authUid))
    if (!map.exists()) return null
    const userId = map.data().userId
    const usnap = await fs.getDoc(fs.doc(db, 'users', userId))
    if (!usnap.exists()) return null
    const mq = fs.query(fs.collection(db, 'measurements'), fs.where('userId', '==', userId))
    const msnap = await fs.getDocs(mq)
    return toEngineUser({ id: userId, ...usnap.data() }, msnap.docs.map(d => d.data()))
  } catch (e) {
    console.error('loadPortalData failed:', e)
    return null
  }
}
