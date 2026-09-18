/* 利用者・測定の削除。

   なぜ「控えを取ってから消す」のか:
   2026/09/16 に、台帳の誤記で持ち主が分からなくなった測定を「特定不明」と判断して削除したが、
   その後で山下芳代様のものだと判明し、控えから復元することになった。
   現場が「特定不明」と判断した時点では本当に分からなくても、あとから分かることがある。
   そのため、画面からの削除は必ず次の順で行う:

     ① 消えるもの一式を deletedRecords に書き出す（＝控え）
     ② 控えが書けたことを確かめる
     ③ 本体を消す
     ④ 誰がいつ何件消したかを deletionLogs に残す（中身は書かない）

   ①が失敗したら②で止まり、本体は消えない。控えを取らずに消す経路は作らない。

   控えの置き場（deletedRecords）は、Firestore ルールで職員からも読めないようにしてある。
   画面には出ないので「消したのに残っている」ようには見えない。
   戻すときは Admin SDK（管理者の作業）で行う。手順は docs/削除と復元.md を参照。 */
import D from '../data/engine.js'
import { dbEnabled, getFs } from './db.js'

const nowIso = () => new Date().toISOString()
const rid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/* その測定が「過去の年度」か。過去の年度は行政への提出が済んでいる可能性があるため、
   消す前に必ず知らせる。提出済みかどうかを持つ項目はデータに無いので、
   「今年度より前かどうか」で判断し、断定はせず確認をお願いする形にする。 */
export const isPastYear = (year) => Number(year) < Number(D.CUR)

/* 消すとどうなるかを、消す前に数える（読み取りだけ。何も書き換えない）。
   戻り値: { ok, userId, name, ward, measurements:[{key,date,year,total}], years:[],
             pastYears:[], techo, portalCount, walkinCount, warnings:[] } */
export async function planUserDeletion(userId) {
  const u = D.users.find(x => x.id === userId)
  const plan = {
    ok: !!u, userId, name: u ? u.name : '', ward: u ? u.venueName : '', muniName: u ? u.muniName : '',
    measurements: [], years: [], pastYears: [], techo: false, portalCount: 0, walkinCount: 0, warnings: [],
  }
  if (!u) { plan.warnings.push('この利用者は台帳に見つかりません'); return plan }
  for (const r of (u.series || [])) {
    plan.measurements.push({ key: r.key, date: r.date || `${r.year}年度`, year: r.year, total: r.total })
  }
  plan.years = [...new Set(plan.measurements.map(m => Number(m.year)))].sort()
  plan.pastYears = plan.years.filter(isPastYear)
  if (plan.pastYears.length) {
    plan.warnings.push(`${plan.pastYears.map(y => (D.ERA[y] || D.eraLabel(y)) + '年度').join('・')}の集計に入っています。`
      + '提出が済んでいる場合は、提出先への訂正のご連絡が必要です')
  }
  if (!dbEnabled()) return plan
  // 電子手帳・ポータル・当日受付の紐づけも巻き込む。数だけ先に出す
  const { fs, db } = await getFs()
  try {
    const t = await fs.getDoc(fs.doc(db, 'techo', userId))
    plan.techo = t.exists()
  } catch { /* 読めなければ無いものとして扱う */ }
  try {
    const ps = await fs.getDocs(fs.query(fs.collection(db, 'portalUsers'), fs.where('userId', '==', userId)))
    plan.portalCount = ps.size
  } catch { /* 同上 */ }
  try {
    const ws = await fs.getDocs(fs.query(fs.collection(db, 'walkins'), fs.where('userId', '==', userId)))
    plan.walkinCount = ws.size
  } catch { /* 同上 */ }
  if (plan.portalCount) plan.warnings.push('電子手帳のログインも使えなくなります')
  if (plan.walkinCount) plan.warnings.push(`当日受付の用紙 ${plan.walkinCount} 枚は、取り込み待ちに戻ります（用紙は消えません）`)
  return plan
}

// 測定 1 件を消すとどうなるか
export function planMeasurementDeletion(userId, key) {
  const u = D.users.find(x => x.id === userId)
  const r = u && (u.series || []).find(x => x.key === key)
  const plan = { ok: !!r, userId, name: u ? u.name : '', key, warnings: [] }
  if (!r) { plan.warnings.push('この測定は見つかりません'); return plan }
  plan.date = r.date || `${r.year}年度`
  plan.year = r.year
  plan.total = r.total
  plan.last = (u.series || []).length === 1
  if (isPastYear(r.year)) {
    plan.warnings.push(`${D.ERA[r.year] || D.eraLabel(r.year)}年度の集計に入っています。`
      + '提出が済んでいる場合は、提出先への訂正のご連絡が必要です')
  }
  if (plan.last) plan.warnings.push('この方の測定はこれが最後の 1 件です（利用者は台帳に残ります）')
  return plan
}

/* 控えを書く。書けなかったら例外を投げる＝呼び出し側は本体を消さない。 */
async function writeBackup(fs, db, payload) {
  const id = `${payload.kind}-${payload.userId}-${rid()}`
  await fs.setDoc(fs.doc(db, 'deletedRecords', id), { ...payload, backupId: id, savedAt: fs.serverTimestamp() })
  return id
}

// 誰がいつ何件消したか（中身は書かない）
async function writeLog(fs, db, entry) {
  const id = `${Date.now()}-${rid()}`
  await fs.setDoc(fs.doc(db, 'deletionLogs', id), { ...entry, at: nowIso(), loggedAt: fs.serverTimestamp() })
  return id
}

/* 利用者 1 名を、ぶら下がるもの一式と一緒に消す。
   by / byName は操作した職員。reason は現場が入れた理由（任意）。 */
export async function deleteUser(userId, { by, byName, reason } = {}) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です')
  const plan = await planUserDeletion(userId)
  if (!plan.ok) throw new Error('この利用者は台帳に見つかりません')
  const { fs, db } = await getFs()

  // ① 消えるもの一式を読み集める
  const userSnap = await fs.getDoc(fs.doc(db, 'users', userId))
  if (!userSnap.exists()) throw new Error('利用者の記録が見つかりません')
  const measSnap = await fs.getDocs(fs.query(fs.collection(db, 'measurements'), fs.where('userId', '==', userId)))
  const measurements = measSnap.docs.map(s => ({ _id: s.id, ...s.data() }))
  const techoSnap = await fs.getDoc(fs.doc(db, 'techo', userId))
  let techoLogs = []
  if (techoSnap.exists()) {
    try {
      const ls = await fs.getDocs(fs.collection(db, 'techo', userId, 'logs'))
      techoLogs = ls.docs.map(s => ({ _id: s.id, ...s.data() }))
    } catch { /* 読めなければ空 */ }
  }
  const portalSnap = await fs.getDocs(fs.query(fs.collection(db, 'portalUsers'), fs.where('userId', '==', userId)))
  const walkinSnap = await fs.getDocs(fs.query(fs.collection(db, 'walkins'), fs.where('userId', '==', userId)))

  // ② 控えを書く（ここで失敗したら本体は消さない）
  const backupId = await writeBackup(fs, db, {
    kind: 'user', at: nowIso(), by: by || null, byName: byName || null, reason: reason || null,
    userId, userName: plan.name, ward: plan.ward, muniName: plan.muniName,
    user: { _id: userSnap.id, ...userSnap.data() },
    measurements,
    techo: techoSnap.exists() ? { _id: techoSnap.id, ...techoSnap.data() } : null,
    techoLogs,
    portalUsers: portalSnap.docs.map(s => ({ _id: s.id, ...s.data() })),
    walkins: walkinSnap.docs.map(s => ({ _id: s.id, ...s.data() })),
  })

  // ③ 本体を消す
  for (const s of measSnap.docs) await fs.deleteDoc(fs.doc(db, 'measurements', s.id))
  for (const s of techoLogs) await fs.deleteDoc(fs.doc(db, 'techo', userId, 'logs', s._id))
  if (techoSnap.exists()) await fs.deleteDoc(fs.doc(db, 'techo', userId))
  for (const s of portalSnap.docs) await fs.deleteDoc(fs.doc(db, 'portalUsers', s.id))
  // 当日受付の用紙は消さない。紐づけだけ外して取り込み待ちに戻す（用紙を失わないため）
  for (const s of walkinSnap.docs) {
    await fs.setDoc(fs.doc(db, 'walkins', s.id), { userId: null, userName: null, walkinStatus: 'pending' }, { merge: true })
  }
  await fs.deleteDoc(fs.doc(db, 'users', userId))

  // ④ 記録を残す（中身は書かない）
  await writeLog(fs, db, {
    kind: 'user', by: by || null, byName: byName || null, reason: reason || null,
    userId, userName: plan.name, ward: plan.ward, muniName: plan.muniName,
    measurementCount: measurements.length,
    years: plan.years, pastYears: plan.pastYears,
    walkinDetached: walkinSnap.size, backupId,
  })

  // メモリの台帳からも外す
  D.setUsers(D.users.filter(x => x.id !== userId))
  return { backupId, measurementCount: measurements.length, walkinDetached: walkinSnap.size }
}

/* 測定 1 件だけを消す（利用者は残す） */
export async function deleteMeasurement(userId, key, { by, byName, reason } = {}) {
  if (!dbEnabled()) throw new Error('Firebase 未設定です')
  const plan = planMeasurementDeletion(userId, key)
  if (!plan.ok) throw new Error('この測定は見つかりません')
  const { fs, db } = await getFs()

  const snap = await fs.getDoc(fs.doc(db, 'measurements', key))
  if (!snap.exists()) throw new Error('測定の記録が見つかりません')
  const data = { _id: snap.id, ...snap.data() }

  const backupId = await writeBackup(fs, db, {
    kind: 'measurement', at: nowIso(), by: by || null, byName: byName || null, reason: reason || null,
    userId, userName: plan.name, measurements: [data],
  })

  await fs.deleteDoc(fs.doc(db, 'measurements', key))
  // 電子手帳の索引からも外す
  try {
    await fs.setDoc(fs.doc(db, 'users', userId), { measKeys: fs.arrayRemove(key) }, { merge: true })
  } catch (e) { console.warn('measKeys の更新に失敗:', e && e.message) }

  await writeLog(fs, db, {
    kind: 'measurement', by: by || null, byName: byName || null, reason: reason || null,
    userId, userName: plan.name, measurementKey: key, date: plan.date, year: plan.year,
    pastYear: isPastYear(plan.year), backupId,
  })

  // メモリからも外す
  const u = D.users.find(x => x.id === userId)
  if (u) {
    u.series = (u.series || []).filter(r => r.key !== key)
    u.meas = {}
    for (const r of u.series) {
      const cur = u.meas[r.year]
      if (!cur || String(r.date || r.year) >= String(cur.date || cur.year)) u.meas[r.year] = r
    }
  }
  return { backupId }
}

/* まとめて消す。1 件失敗しても残りは続ける（全員やり直しにしない）。
   戻り値: { done:[{userId,name,...}], failed:[{userId,name,error}] } */
export async function deleteUsersBulk(userIds, opts = {}) {
  const done = [], failed = []
  for (const id of userIds) {
    const name = (D.users.find(x => x.id === id) || {}).name || ''
    try {
      const r = await deleteUser(id, opts)
      done.push({ userId: id, name, ...r })
    } catch (e) {
      failed.push({ userId: id, name, error: (e && e.message) || String(e) })
    }
  }
  return { done, failed }
}
