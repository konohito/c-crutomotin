/* 職員アカウント管理（アプリ内）。全職員が同じ権限で、他の職員を追加・解除できる。
   - 一覧/解除: Firestore の staff コレクション（ルールで承認職員のみ読み書き可）
   - 追加: 副 Firebase アプリで新規ユーザーを作成（現在のログインを保持したまま）→ staff 文書を作成
   最初の 1 人だけは CLI(grant-staff.mjs)で承認する。以降はこの画面から増やせる。 */
import { dbEnabled, firebaseConfig, getFs } from './db.js'

export const staffAdminEnabled = () => dbEnabled()

// 承認済み職員の一覧
export async function listStaff() {
  const { fs, db } = await getFs()
  const snap = await fs.getDocs(fs.collection(db, 'staff'))
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')))
}

// ログイン中の職員自身のプロフィール（氏名など）を取得。未承認・未設定なら null。
export async function getStaffProfile(uid) {
  if (!dbEnabled() || !uid) return null
  try {
    const { fs, db } = await getFs()
    const snap = await fs.getDoc(fs.doc(db, 'staff', uid))
    return snap.exists() ? { uid, ...snap.data() } : null
  } catch { return null }
}

// 職員の表示名を更新（全職員が同権限で編集可）。
export async function updateStaffName(uid, name) {
  const { fs, db } = await getFs()
  await fs.setDoc(fs.doc(db, 'staff', uid), { name: name || '' }, { merge: true })
}

const AUTH_ERR = {
  'auth/email-already-in-use': 'このメールアドレスは既に登録されています。',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
  'auth/weak-password': 'パスワードは6文字以上にしてください。',
}

// 職員を追加（アカウント作成＋承認）。ログイン中の職員のセッションは維持される。
export async function addStaff({ email, password, name }) {
  const cfg = firebaseConfig()
  if (!cfg) throw new Error('Firebase 未設定です')
  const { initializeApp, deleteApp } = await import('firebase/app')
  const authMod = await import('firebase/auth')
  // 副アプリでユーザー作成（主アプリのログインを奪わないため）
  const sec = initializeApp(cfg, 'staff-admin-' + Date.now())
  const secAuth = authMod.getAuth(sec)
  const emu = import.meta.env.VITE_AUTH_EMULATOR_URL
  if (emu) { try { authMod.connectAuthEmulator(secAuth, emu, { disableWarnings: true }) } catch { /* noop */ } }
  let uid
  try {
    const cred = await authMod.createUserWithEmailAndPassword(secAuth, email.trim(), password)
    uid = cred.user.uid
    await authMod.signOut(secAuth)
  } catch (e) {
    await deleteApp(sec).catch(() => {})
    throw new Error(AUTH_ERR[e && e.code] || (e && e.message) || 'アカウント作成に失敗しました')
  }
  await deleteApp(sec).catch(() => {})
  // 承認（staff 文書を作成）— 主アプリ（ログイン中の職員）が書き込む
  const { fs, db } = await getFs()
  await fs.setDoc(fs.doc(db, 'staff', uid), { email: email.trim(), name: name || '', addedAt: fs.serverTimestamp() })
  return { uid, email: email.trim(), name: name || '' }
}

// 職員の権限を解除（staff 文書を削除）。アカウント自体は残るが、データは見られなくなる。
export async function revokeStaff(uid) {
  const { fs, db } = await getFs()
  await fs.deleteDoc(fs.doc(db, 'staff', uid))
}
