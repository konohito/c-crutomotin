#!/usr/bin/env node
/* 同じ測定が「年度キー」と「評価日キー」の 2 通に分かれてしまったものを 1 通にまとめる。

   なぜ起きたか:
     取り込みの本登録(commitRecognition)が measurements/{利用者ID}_{年度} に書き、
     直後に呼ばれる saveMeasurement が measurements/{利用者ID}_{評価日} に書いていた。
     同じ 1 回の測定が 2 通できて、測定回数・請求の人数・前後比較がずれる。
     アプリ側は評価日キーに揃えて直したが、すでにできてしまった分をここで片付ける。

   まとめ方（情報を落とさない）:
     年度キー側にしか無い項目（問診回答・source・batchId など）を評価日キー側へ写し、
     年度キー側は削除せずアーカイブ（voided + mergedInto）する。
     評価日キー側にすでに値がある項目は上書きしない。

   使い方:
     node scripts/merge-duplicate-measurement-docs.mjs
     GOOGLE_CLOUD_PROJECT=cruto-motion node scripts/merge-duplicate-measurement-docs.mjs --write */
import admin from 'firebase-admin'

const WRITE = process.argv.includes('--write')
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'demo-cruto'
admin.initializeApp({ projectId })
const db = admin.firestore()

const compact = (d) => {
  const m = String(d || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  return m ? m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0') : ''
}
const isEmpty = (v) => v === undefined || v === null || v === '' ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) ||
  (Array.isArray(v) && v.length === 0)

async function main() {
  console.log(`[dup] project=${projectId} ${WRITE ? '★書き込みます' : '下見のみ(書き込みません)'}`)
  const snap = await db.collection('measurements').get()
  const live = snap.docs.filter(d => !d.data().voided)
  const byUser = {}
  live.forEach(d => { (byUser[d.data().userId] ||= []).push(d) })

  const pairs = []
  for (const docs of Object.values(byUser)) {
    for (const y of docs.filter(d => /^\d+_\d{4}$/.test(d.id))) {
      const c = compact(y.data().date)
      if (!c) continue                                  // 評価日が無い年度キーは相方がいないので触らない
      const mate = docs.find(d => d.id === `${y.data().userId}_${c}`)
      if (mate) pairs.push({ year: y, date: mate })
    }
  }
  console.log(`[dup] 有効な測定 ${live.length} 件 / 同じ測定が 2 通に分かれている組: ${pairs.length} 組`)

  const plan = []
  for (const p of pairs) {
    const yd = p.year.data(), dd = p.date.data()
    const carry = {}
    for (const [k, v] of Object.entries(yd)) {
      if (k === 'voided' || k === 'mergedInto') continue
      if (isEmpty(v)) continue
      if (!isEmpty(dd[k])) continue                     // 評価日キー側に値があれば触らない
      carry[k] = v
    }
    plan.push({ ...p, carry })
    console.log(`   ${p.year.id} → ${p.date.id}  日付=${dd.date}  引き継ぐ項目: ${Object.keys(carry).join(', ') || '(なし)'}`)
  }
  if (!WRITE) { console.log('[dup] 下見のみ。実行するには --write を付けてください'); return }
  if (!plan.length) return

  let ok = 0
  for (const p of plan) {
    if (Object.keys(p.carry).length) {
      await db.collection('measurements').doc(p.date.id).set(p.carry, { merge: true })
      // 引き継げたことを読み直して確かめる
      const back = (await db.collection('measurements').doc(p.date.id).get()).data()
      const miss = Object.keys(p.carry).filter(k => isEmpty(back[k]))
      if (miss.length) {
        console.error(`[dup] ★中断: ${p.date.id} に ${miss.join(', ')} が入っていません。年度キーは残したままです`)
        process.exit(1)
      }
    }
    await db.collection('measurements').doc(p.year.id)
      .set({ voided: true, mergedInto: p.date.id, mergedAt: new Date().toISOString() }, { merge: true })
    ok++
    console.log(`   済 ${p.year.id} をアーカイブし、${p.date.id} に 1 本化しました`)
  }
  console.log(`[dup] 完了: ${ok} 組`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
