/* Firestore / Storage の継ぎ目（フェーズ2：非同期 OCR 取り込みパイプライン）。
   VITE_FIREBASE_CONFIG(JSON) が設定されていれば実 Firebase を使い、無ければ dbEnabled()=false で
   従来のシードデモを使う（GitHub Pages のデモは無変更）。firebase SDK は動的 import で読み込むため、
   未設定時はバンドル本体に含まれない。 */
import D from '../data/engine.js'

let CONFIG = null
try { CONFIG = import.meta.env.VITE_FIREBASE_CONFIG ? JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG) : null } catch { CONFIG = null }
export const dbEnabled = () => !!CONFIG
export const firebaseConfig = () => CONFIG

// 会場＝行政区。実データ(本番)では「行政区」、公開デモ(シードの会場名)では「会場」と表示する。
export const wardLabel = () => (CONFIG ? '行政区' : '会場')

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
  const semu = import.meta.env.VITE_STORAGE_EMULATOR
  if (semu) { const [h, p] = semu.split(':'); try { storage.connectStorageEmulator(_sdk.bucket, h, +p || 9199) } catch { /* 接続済みは無視 */ } }
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

// 記録用紙画像の表示用 URL を取得する（確認モーダルで原本と読み取り値を見比べるため）
export async function sheetImageUrl(storagePath) {
  if (!dbEnabled() || !storagePath) return null
  const { storage, bucket } = await sdk()
  return storage.getDownloadURL(storage.ref(bucket, storagePath))
}

// 取り込みバッチ一覧（新しい順）をリアルタイム購読する。unsubscribe 関数を返す。
export async function watchBatches(cb) {
  if (!dbEnabled()) return () => {}
  const { firestore, db } = await sdk()
  const q = firestore.query(
    firestore.collection(db, 'batches'),
    firestore.orderBy('updatedAt', 'desc'),
    firestore.limit(30),
  )
  return firestore.onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

// 未処理の読み取り件数を全バッチ横断でリアルタイム購読する（ナビのバッジ用）。
// 確認待ち(recognized)と読み取り失敗(error)の両方を数える（どちらも職員の対応が必要なため）。
export async function watchPendingCount(cb) {
  if (!dbEnabled()) return () => {}
  const { firestore, db } = await sdk()
  const q = firestore.query(
    firestore.collectionGroup(db, 'recognitions'),
    firestore.where('status', 'in', ['recognized', 'error']),
  )
  return firestore.onSnapshot(q, (snap) => cb(snap.size), (e) => {
    console.warn('watchPendingCount failed:', e && e.message)
    cb(0)
  })
}

// 読み取りを却下する（誤アップロード・関係ない画像など）。監査のため文書は残し status のみ変更。
export async function rejectRecognition({ batchId, recognitionId }) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です')
  const { firestore, db } = await sdk()
  await firestore.updateDoc(firestore.doc(db, 'batches', batchId, 'recognitions', recognitionId), {
    status: 'rejected', reviewedAt: firestore.serverTimestamp(),
  })
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

// 処理済み(本登録/却下)の原本画像を Storage から削除する(ストレージ費用対策。失敗しても業務継続)
export async function deleteSheetImage(storagePath) {
  if (!dbEnabled() || !storagePath) return
  const { storage, bucket } = await sdk()
  await storage.deleteObject(storage.ref(bucket, storagePath))
}

// バッチの全件処理済みマーク(取り込み画面のプルダウンから除くため)
export async function markBatchDone(batchId) {
  if (!dbEnabled() || !batchId) return
  const { firestore, db } = await sdk()
  await firestore.updateDoc(firestore.doc(db, 'batches', batchId), { finishedAt: firestore.serverTimestamp() })
}

// 未完了バッチを一括点検し、処理し終えたものに finishedAt を付ける(プルダウンの掃除)。
// 「処理済み」= 全件が 本登録/却下/当日受付への振り分け(walkIn) のいずれか。
// エラー行が残るバッチは対応漏れが見えるよう残す。
export async function sweepFinishedBatches(batchList) {
  if (!dbEnabled()) return
  const { firestore, db } = await sdk()
  for (const b of (batchList || []).filter(x => !x.finishedAt)) {
    try {
      const snap = await firestore.getDocs(firestore.collection(db, 'batches', b.id, 'recognitions'))
      const docs = snap.docs.map(d => d.data())
      const done = docs.length > 0 && docs.every(r => r.walkIn || r.status === 'committed' || r.status === 'rejected')
      if (done) await markBatchDone(b.id)
    } catch { /* 個別の失敗は無視して次へ */ }
  }
}

// 当日受付 取り込みキュー(walkins)をリアルタイム購読する。unsubscribe 関数を返す。
export async function watchWalkins(cb) {
  if (!dbEnabled()) return () => {}
  const { firestore, db } = await sdk()
  const q = firestore.query(
    firestore.collection(db, 'walkins'),
    firestore.orderBy('recognizedAt', 'desc'),
    firestore.limit(200),
  )
  return firestore.onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  })
}

// 当日受付エントリのステータス更新(pending → committed → registered)
export async function updateWalkin(walkinId, patch) {
  if (!dbEnabled()) return
  const { firestore, db } = await sdk()
  await firestore.updateDoc(firestore.doc(db, 'walkins', walkinId), patch)
}

// 当日受付エントリを削除(誤スキャン・重複の整理用。画像の削除は呼び出し側で)
export async function deleteWalkin(walkinId) {
  if (!dbEnabled()) return
  const { firestore, db } = await sdk()
  await firestore.deleteDoc(firestore.doc(db, 'walkins', walkinId))
}

// 利用者の walkIn フラグを外す(正式登録 = 台帳に出す)
export async function clearWalkInFlag(userId) {
  if (!dbEnabled()) return
  const { firestore, db } = await sdk()
  await firestore.setDoc(firestore.doc(db, 'users', userId), { walkIn: false }, { merge: true })
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

// 問診票の本登録: measurement ドキュメントに kclAnswers をマージ保存(おもて/うら 2 枚で合流)し、
// recognition を committed に更新する。測定値は上書きしない。
export async function commitKclRecognition({ batchId, recognitionId, user, answers, year }) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です')
  const { firestore, db } = await sdk()
  const y = year || D.CUR
  const clean = {}
  Object.entries(answers || {}).forEach(([k, v]) => { if (v === 'yes' || v === 'no') clean[k] = v })
  const batch = firestore.writeBatch(db)
  batch.set(firestore.doc(db, 'measurements', `${user.id}_${y}`), { userId: user.id, year: y, kclAnswers: clean }, { merge: true })
  if (batchId && recognitionId) {
    batch.update(firestore.doc(db, 'batches', batchId, 'recognitions', recognitionId), {
      status: 'committed', matchedUserId: user.id, reviewedAt: firestore.serverTimestamp(),
    })
  }
  await batch.commit()
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
