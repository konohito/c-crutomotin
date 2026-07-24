/* Firebase Auth の継ぎ目（職員ログイン）。
   VITE_FIREBASE_CONFIG がある時のみ有効。未設定（GitHub Pages の公開デモ）では
   authEnabled()=false となり、ログインは一切要求されない（デモは無変更）。
   firebase/auth は動的 import なので、未設定時はバンドル本体に含まれない。 */
import { dbEnabled, firebaseApp } from './db.js'

export const authEnabled = () => dbEnabled()

let _auth, _mod
async function getAuth() {
  const app = await firebaseApp()
  if (!_mod) _mod = await import('firebase/auth')
  if (!_auth) {
    _auth = _mod.getAuth(app)
    // ローカル検証用: VITE_AUTH_EMULATOR_URL があれば Auth エミュレータに接続する
    // (本番/公開デモでは未設定なので実 Firebase Auth を使う)
    const emu = import.meta.env.VITE_AUTH_EMULATOR_URL
    if (emu) { try { _mod.connectAuthEmulator(_auth, emu, { disableWarnings: true }) } catch { /* 二重接続は無視 */ } }
  }
  return { m: _mod, auth: _auth }
}

// 認証状態を購読する。cb({ user, ready }) を呼ぶ。unsubscribe(Promise) を返す。
export async function watchAuth(cb) {
  if (!authEnabled()) { cb({ user: null, ready: true }); return () => {} }
  const { m, auth } = await getAuth()
  return m.onAuthStateChanged(auth, (user) => cb({ user, ready: true }))
}

// Firebase の認証エラーコード → 職員向けの日本語メッセージ
const MSG = {
  'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
  'auth/user-disabled': 'このアカウントは無効化されています。',
  'auth/user-not-found': 'メールアドレスまたはパスワードが違います。',
  'auth/wrong-password': 'メールアドレスまたはパスワードが違います。',
  'auth/invalid-credential': 'メールアドレスまたはパスワードが違います。',
  'auth/too-many-requests': '試行回数が多すぎます。しばらくしてからお試しください。',
  'auth/network-request-failed': 'ネットワークに接続できませんでした。',
}
export function authErrorMessage(err) {
  const code = err && err.code
  return MSG[code] || (err && err.message) || 'ログインに失敗しました。'
}

export async function signIn(email, password) {
  const { m, auth } = await getAuth()
  await m.signInWithEmailAndPassword(auth, email.trim(), password)
}

export async function signOutUser() {
  const { m, auth } = await getAuth()
  await m.signOut(auth)
}

// パスワード変更（本人）。Firebase は直近ログインを要求するため、現在のパスワードで再認証してから更新する。
export async function changePassword(currentPassword, newPassword) {
  const { m, auth } = await getAuth()
  const user = auth.currentUser
  if (!user || !user.email) throw new Error('ログイン状態を確認できませんでした。')
  const cred = m.EmailAuthProvider.credential(user.email, currentPassword)
  try {
    await m.reauthenticateWithCredential(user, cred)
  } catch (e) {
    throw new Error(MSG[e && e.code] || '現在のパスワードが違います。')
  }
  try {
    await m.updatePassword(user, newPassword)
  } catch (e) {
    if (e && e.code === 'auth/weak-password') throw new Error('新しいパスワードは6文字以上にしてください。')
    throw new Error(authErrorMessage(e))
  }
}
