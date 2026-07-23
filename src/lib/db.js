/* Firestore / Storage の継ぎ目（フェーズ2：非同期 OCR 取り込みパイプライン）。
   VITE_FIREBASE_CONFIG(JSON) が設定されていれば実 Firebase を使い、無ければ dbEnabled()=false で
   従来のシードデモを使う（GitHub Pages のデモは無変更）。firebase SDK は動的 import で読み込むため、
   未設定時はバンドル本体に含まれない。 */
import D from '../data/engine.js'

let CONFIG = null
try { CONFIG = import.meta.env.VITE_FIREBASE_CONFIG ? JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG) : null } catch { CONFIG = null }
export const dbEnabled = () => !!CONFIG
export const firebaseConfig = () => CONFIG

const SHEET_COLS = ['height', 'weight', 'gripR', 'gripL', 'walk5', 'walk5max', 'tug', 'balR', 'balL']

// firebase アプリを 1 回だけ初期化して使い回す（Firestore/Storage と Auth で共有する）
let _app, _sdk
export async function firebaseApp() {
  if (_app) return _app
  const { initializeApp, getApps } = await import('firebase/app')
  _app = getApps().length ? getApps()[0] : initializeApp(CONFIG)
  return _app
}
// Firestore を 1 回だけ用意（VITE_FIRESTORE_EMULATOR があればエミュレータに接続）。
// realdata.js と共有し、接続の二重呼び出しを避ける。
let _fs, _fsdb
export async function getFs() {
  if (_fsdb) return { fs: _fs, db: _fsdb }
  const app = await firebaseApp()
  _fs = await import('firebase/firestore')
  _fsdb = _fs.getFirestore(app)
  const emu = import.meta.env.VITE_FIRESTORE_EMULATOR
  if (emu) { const [h, p] = emu.split(':'); try { _fs.connectFirestoreEmulator(_fsdb, h, +p || 8080) } catch { /* 接続済みは無視 */ } }
  return { fs: _fs, db: _fsdb }
}
async function sdk() {
  if (_sdk) return _sdk
  const [{ fs, db }, app, storage] = await Promise.all([getFs(), firebaseApp(), import('firebase/storage')])
  _sdk = { firestore: fs, storage, db, bucket: storage.getStorage(app) }
  return _sdk
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
