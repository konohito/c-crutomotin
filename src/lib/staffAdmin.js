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

/* ★2026-10-08 現場報告（齊藤さんを追加できない）
     「職員を追加」で『このメールアドレスは既に登録されています。』が出て、先へ進めない。

   ★なぜ起きるか
     「解除」は staff 文書を消すだけで、**Firebase のアカウントは残る**（画面の注記のとおり）。
     そのため、一度解除した人をもう一度承認したいとき、
     「追加」はアカウント作成から始めるので必ずここで止まり、**戻す道が無かった**。
     初めて使う方でも、ほかのCrutoのアプリで同じアドレスのアカウントが既にあれば同じことが起きる。

   ★直し方
     アカウントが既にある場合は、**そのパスワードでいちど本人確認してから承認する**。
     パスワードが合えば uid が取れるので、staff 文書を作れば承認できる。
     パスワードが違えば「パスワードが違う」と伝える（こちらで勝手に変えない。
     パスワードの変更は本人か Firebase コンソールから）。
   ★副アプリでやるのは従来どおり（ログイン中の職員のセッションを奪わないため）。 */
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
  let reused = false
  try {
    const cred = await authMod.createUserWithEmailAndPassword(secAuth, email.trim(), password)
    uid = cred.user.uid
    await authMod.signOut(secAuth)
  } catch (e) {
    if (e && e.code === 'auth/email-already-in-use') {
      /* 既にアカウントがある。入力されたパスワードで本人確認して、承認だけ行う。 */
      try {
        const cred = await authMod.signInWithEmailAndPassword(secAuth, email.trim(), password)
        uid = cred.user.uid
        reused = true
        await authMod.signOut(secAuth)
      } catch (e2) {
        await deleteApp(sec).catch(() => {})
        const wrong = e2 && (e2.code === 'auth/wrong-password' || e2.code === 'auth/invalid-credential')
        throw new Error(wrong
          ? 'このメールアドレスのアカウントは既にあります。いまの パスワードを入れてください（分からないときは Firebase コンソール → Authentication でリセットできます）。'
          : (AUTH_ERR[e2 && e2.code] || (e2 && e2.message) || 'アカウントの確認に失敗しました'))
      }
    } else {
      await deleteApp(sec).catch(() => {})
      throw new Error(AUTH_ERR[e && e.code] || (e && e.message) || 'アカウント作成に失敗しました')
    }
  }
  await deleteApp(sec).catch(() => {})
  // 承認（staff 文書を作成）— 主アプリ（ログイン中の職員）が書き込む
  const { fs, db } = await getFs()
  /* ★merge で書く。前に承認していたときの情報（氏名など）を消さないため。
     氏名を空で送ったときに、入っていた氏名が消えるのを防ぐ。 */
  const rec = { email: email.trim(), addedAt: fs.serverTimestamp() }
  if (name) rec.name = name
  else if (!reused) rec.name = ''
  await fs.setDoc(fs.doc(db, 'staff', uid), rec, { merge: true })
  return { uid, email: email.trim(), name: name || '', reused }
}

// 職員の権限を解除（staff 文書を削除）。アカウント自体は残るが、データは見られなくなる。
export async function revokeStaff(uid) {
  const { fs, db } = await getFs()
  await fs.deleteDoc(fs.doc(db, 'staff', uid))
}
