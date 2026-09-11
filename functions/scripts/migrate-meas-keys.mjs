#!/usr/bin/env node
/* 測定ドキュメントのキーを「年度」から「評価日」へ移行する。

   旧: measurements/{利用者ID}_{年度}     … 1 年度 1 件しか持てない
   新: measurements/{利用者ID}_{YYYYMMDD} … 評価日ごとに 1 件

   旧キーの文書に評価日があれば、同じ内容で新キーの文書を作り、
   旧文書は voided:true にする(削除はルール上も監査上もしない。アプリは voided を読み飛ばす)。
   評価日が無い文書はそのまま(新キーを作れないため)。
   併せて users/{id}.measKeys に生きている文書 ID の索引を作る
   (電子手帳の本人ログインは list が使えず、文書 ID 指定でしか測定を読めないため)。

   使い方:
     GOOGLE_CLOUD_PROJECT=cruto-motion node functions/scripts/migrate-meas-keys.mjs           # 下見(書き込まない)
     GOOGLE_CLOUD_PROJECT=cruto-motion node functions/scripts/migrate-meas-keys.mjs --apply   # 実行
*/
import admin from 'firebase-admin'

const APPLY = process.argv.includes('--apply')
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
if (!projectId) { console.error('GOOGLE_CLOUD_PROJECT を指定してください'); process.exit(1) }
admin.initializeApp({ projectId })
const db = admin.firestore()

const compact = (d) => {
  const m = String(d || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  return m ? m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0') : ''
}

async function main() {
  console.log(`[migrate] project=${projectId} mode=${APPLY ? '実行' : '下見'}`)
  const snap = await db.collection('measurements').get()
  const live = new Map()      // docId -> data（移行後に生き残る文書）
  const moves = []            // { from, to }
  const stay = []             // 年度キーのまま残す文書
  for (const d of snap.docs) {
    const m = d.data()
    if (m.voided) continue
    const c = compact(m.date)
    const isYearKey = /^\d+_\d{4}$/.test(d.id)
    if (c && isYearKey && d.id !== `${m.userId}_${c}`) moves.push({ from: d.id, to: `${m.userId}_${c}`, data: m })
    else stay.push(d.id)
    live.set(c && isYearKey ? `${m.userId}_${c}` : d.id, m)
  }
  // 移行先が既に埋まっていないか（上書き事故の確認）
  const existing = new Set(snap.docs.map(d => d.id))
  const clash = moves.filter(mv => existing.has(mv.to))
  console.log(`  対象 ${snap.size} 件 → 引っ越し ${moves.length} 件 / そのまま ${stay.length} 件 / 衝突 ${clash.length} 件`)
  if (clash.length) { console.error('  ✗ 移行先が既にあります:', clash.slice(0, 10).map(c => `${c.from}→${c.to}`)); process.exit(1) }

  // 利用者ごとの索引
  const byUser = {}
  for (const [id, m] of live) (byUser[m.userId] ||= []).push(id)
  console.log(`  measKeys 索引: ${Object.keys(byUser).length} 名`)
  const multi = Object.entries(byUser).filter(([, v]) => v.length > 1).length
  console.log(`  複数回の測定を持つ利用者: ${multi} 名`)
  if (!APPLY) {
    console.log('  例:', moves.slice(0, 5).map(mv => `${mv.from} → ${mv.to}`).join(' / '))
    console.log('  下見のみ。書き込むには --apply を付けてください')
    return
  }

  let batch = db.batch(), n = 0
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0 } }
  for (const mv of moves) {
    const { voided, ...rest } = mv.data
    batch.set(db.collection('measurements').doc(mv.to), rest, { merge: true })
    batch.set(db.collection('measurements').doc(mv.from), { userId: mv.data.userId, year: mv.data.year, voided: true }, { merge: true })
    n += 2; if (n >= 400) await flush()
  }
  await flush()
  for (const [uid, keys] of Object.entries(byUser)) {
    batch.set(db.collection('users').doc(String(uid)), { measKeys: keys }, { merge: true })
    if (++n >= 400) await flush()
  }
  await flush()
  console.log(`[migrate] 完了: 引っ越し ${moves.length} 件 / 索引 ${Object.keys(byUser).length} 名`)
}
main().catch(e => { console.error(e); process.exit(1) })
