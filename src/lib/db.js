/* Firestore / Storage の継ぎ目（フェーズ2：非同期 OCR 取り込みパイプライン）。
   VITE_FIREBASE_CONFIG(JSON) が設定されていれば実 Firebase を使い、無ければ dbEnabled()=false で
   従来のシードデモを使う（GitHub Pages のデモは無変更）。firebase SDK は動的 import で読み込むため、
   未設定時はバンドル本体に含まれない。 */
import D from '../data/engine.js'

let CONFIG = null
try { CONFIG = import.meta.env.VITE_FIREBASE_CONFIG ? JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG) : null } catch { CONFIG = null }
export const dbEnabled = () => !!CONFIG

const SHEET_COLS = ['walk5', 'balR', 'balL', 'gripR', 'gripL', 'tug', 'height', 'weight']

// firebase SDK を 1 回だけ初期化して使い回す
let _app, _sdk
async function sdk() {
  if (_sdk) return _sdk
  const [{ initializeApp }, firestore, storage, auth] = await Promise.all([
    import('firebase/app'),
    import('firebase/firestore'),
    import('firebase/storage'),
    import('firebase/auth'),
  ])
  _app = initializeApp(CONFIG)
  _sdk = {
    firestore, storage, auth,
    db: firestore.getFirestore(_app), bucket: storage.getStorage(_app), authInst: auth.getAuth(_app),
  }
  return _sdk
}

// ============ 職員ログイン（Firebase Auth） ============
// セキュリティルールが request.auth を必須にしているため、Firebase 設定時は必ずログインを通す。

// 認証状態を購読する。cb(user|null) を呼び、解除関数を返す。
export async function watchAuth(cb) {
  if (!dbEnabled()) { cb(null); return () => {} }
  const { auth, authInst } = await sdk()
  return auth.onAuthStateChanged(authInst, cb)
}

export async function signIn(email, password) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です（VITE_FIREBASE_CONFIG）')
  const { auth, authInst } = await sdk()
  const cred = await auth.signInWithEmailAndPassword(authInst, email, password)
  return cred.user
}

export async function signOutStaff() {
  if (!dbEnabled()) return
  const { auth, authInst } = await sdk()
  await auth.signOut(authInst)
}

// 現在ログイン中の職員の ID トークン（未ログインなら ''）。OCR エンドポイント呼び出しに添付する。
export async function getIdToken() {
  if (!dbEnabled()) return ''
  const { authInst } = await sdk()
  return authInst.currentUser ? authInst.currentUser.getIdToken() : ''
}

// 記録用紙画像を Storage へアップロード → バックエンドの onSheetImageUpload が発火する
export async function uploadSheetImage(file, { batchId, no }) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です（VITE_FIREBASE_CONFIG）')
  const { storage, bucket } = await sdk()
  const path = `sheets/${batchId}/${no != null ? no + '-' : ''}${Date.now()}-${file.name || 'sheet.jpg'}`
  const r = storage.ref(bucket, path)
  await storage.uploadBytes(r, file, { contentType: file.type || 'image/jpeg' })
  return path
}

// 読み取りキュー(recognitions)をリアルタイム購読する。unsubscribe 関数を返す。
export async function watchRecognitions(batchId, cb) {
  if (!dbEnabled()) return () => {}
  const { firestore, db } = await sdk()
  const q = firestore.query(
    firestore.collection(db, 'batches', batchId, 'recognitions'),
    firestore.orderBy('no', 'asc'),
  )
  return firestore.onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

// 記録用紙の値 → measurement ドキュメント（engine.commitSheet と同じ算出。純粋）
export function buildMeasurementDoc(user, finalValues, meta = {}) {
  const v = {}
  SHEET_COLS.forEach(cid => {
    const x = finalValues[cid]
    v[cid] = (x === null || x === undefined || x === '') ? null : Math.round(parseFloat(x) * 10) / 10
  })
  if (v.balR === null && v.balL !== null) v.balR = v.balL
  if (v.balL === null && v.balR !== null) v.balL = v.balR
  if (v.gripR === null && v.gripL !== null) v.gripR = v.gripL
  if (v.gripL === null && v.gripR !== null) v.gripL = v.gripR
  v.bmi = (v.height && v.weight) ? Math.round((v.weight / Math.pow(v.height / 100, 2)) * 10) / 10 : null
  const ax = D.axesOf(user.sex, v)
  const total = Math.round(((ax.walk + ax.balance + ax.grip + ax.mobility + ax.body) / 25) * 100)
  return {
    userId: user.id, year: meta.year || D.CUR, venueCode: user.venueCode,
    date: meta.date || D.TODAY, values: v, axes: ax, total,
    source: 'ocr', batchId: meta.batchId || '', recognitionId: meta.recognitionId || '',
  }
}

// 本登録: measurement を書き込み、recognition を committed に更新する
export async function commitRecognition({ batchId, recognitionId, user, finalValues, meta }) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です')
  const { firestore, db } = await sdk()
  const measurement = buildMeasurementDoc(user, finalValues, { ...meta, batchId, recognitionId })
  const mid = `${user.id}_${measurement.year}`
  const batch = firestore.writeBatch(db)
  batch.set(firestore.doc(db, 'measurements', mid), { ...measurement, committedAt: firestore.serverTimestamp() })
  batch.update(firestore.doc(db, 'batches', batchId, 'recognitions', recognitionId), {
    status: 'committed', matchedUserId: user.id, reviewedAt: firestore.serverTimestamp(),
  })
  await batch.commit()
  return mid
}
