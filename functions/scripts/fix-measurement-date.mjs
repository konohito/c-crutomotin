#!/usr/bin/env node
/* 測定の「評価日」を直す。

   評価日は文書 ID の一部（measurements/{利用者ID}_{YYYYMMDD}）なので、
   日付を変えると文書 ID が変わる。手順を誤ると測定が消えるため、
   naminote・地区統合と同じ流儀で進める:
     ① 新しいキーで作成（中身は丸ごとコピーして日付と年度だけ入れ替え）
     ② 全項目が一致することを読み直して照合（1 つでも違えば中断）
     ③ 旧いキーは削除せずアーカイブ（voided + movedTo）
     ④ 利用者の測定キー索引に新しいキーを足す
     ⑤ 控え（変更前の中身）を JSON に書き出す

   使い方:
     node scripts/fix-measurement-date.mjs fixes.json            … 下見
     GOOGLE_CLOUD_PROJECT=cruto-motion node scripts/fix-measurement-date.mjs fixes.json --write
   fixes.json の形:
     [{ "userId": "20901", "from": "2025/09/24", "to": "2026/09/07", "why": "登録操作日が入っていた" }] */
import { readFileSync, writeFileSync } from 'node:fs'
import admin from 'firebase-admin'

const file = process.argv[2] || 'fixes.json'
const WRITE = process.argv.includes('--write')
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'demo-cruto'
const fixes = JSON.parse(readFileSync(file, 'utf8'))

admin.initializeApp({ projectId })
const db = admin.firestore()

const compact = (d) => {
  const m = String(d || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  return m ? m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0') : ''
}
// 保存する評価日は 0 詰めの YYYY/MM/DD に揃える
const normDate = (v) => {
  const m = String(v ?? '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : null
}
const fiscalYearOfDate = (ds) => {
  const m = String(ds || '').match(/(\d{4})\D+(\d{1,2})/)
  return m ? +m[1] - (+m[2] < 4 ? 1 : 0) : null
}
const norm = (v) => (v === undefined ? null : (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])])) : v))
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b))

async function main() {
  console.log(`[date] project=${projectId} ${WRITE ? '★書き込みます' : '下見のみ(書き込みません)'} 対象 ${fixes.length} 件`)
  const plan = []
  for (const f of fixes) {
    const oldId = `${f.userId}_${compact(f.from)}`
    const newId = `${f.userId}_${compact(f.to)}`
    const oldSnap = await db.collection('measurements').doc(oldId).get()
    if (!oldSnap.exists) { console.log(`   × ${oldId} が見つかりません（飛ばします）`); continue }
    const data = oldSnap.data()
    const year = fiscalYearOfDate(f.to)
    const to = normDate(f.to)
    /* 文書 ID が変わらない場合（0 詰めの書き方を直すだけ）は、評価日の項目だけ書き換える。
       文書を作り直す必要が無く、いちばん安全。 */
    if (oldId === newId) {
      if (data.date === to && Number(data.year) === year) { console.log(`   － ${oldId} はすでに正しい書き方です（変更なし）`); continue }
      plan.push({ f, oldId, newId, data, year, to, sameKey: true })
      console.log(`   ${oldId}  評価日 "${data.date}" → "${to}" / 年度 ${data.year} → ${year}（文書IDは変わりません）  ${f.why || ''}`)
      continue
    }
    const newSnap = await db.collection('measurements').doc(newId).get()
    if (newSnap.exists) { console.log(`   × ${newId} はすでにあります。衝突するので飛ばします`); continue }
    plan.push({ f, oldId, newId, data, year, to })
    console.log(`   ${oldId} → ${newId}  評価日 ${data.date} → ${to} / 年度 ${data.year} → ${year}  ${f.why || ''}`)
  }
  console.log(`[date] 移せるもの: ${plan.length} 件 / 指定 ${fixes.length} 件`)
  if (!WRITE) { console.log('[date] 下見のみ。実行するには --write を付けてください'); return }
  if (!plan.length) return

  // 控え（戻すときに使う）
  const backup = `/tmp/measurement-date-backup-${Date.now()}.json`
  writeFileSync(backup, JSON.stringify(plan.map(p => ({ oldId: p.oldId, newId: p.newId, data: p.data })), null, 1))
  console.log(`[date] 控えを書き出しました: ${backup}`)

  let ok = 0
  for (const p of plan) {
    if (p.sameKey) {
      await db.collection('measurements').doc(p.oldId).set({ date: p.to, year: p.year }, { merge: true })
      const back = (await db.collection('measurements').doc(p.oldId).get()).data()
      if (back.date !== p.to) { console.error(`[date] ★中断: ${p.oldId} の評価日が反映されていません`); process.exit(1) }
      ok++
      console.log(`   済 ${p.oldId} 評価日を "${p.to}" に揃えました`)
      continue
    }
    const next = { ...p.data, date: p.to, year: p.year, movedFrom: p.oldId, movedAt: new Date().toISOString() }
    delete next.voided
    // ① 新しいキーで作成（すでにあれば create() が失敗する＝既存を壊さない）
    await db.collection('measurements').doc(p.newId).create(next)
    // ② 照合。1 項目でも欠けたら中断
    const back = (await db.collection('measurements').doc(p.newId).get()).data()
    const skip = new Set(['date', 'year', 'movedFrom', 'movedAt', 'voided'])
    const miss = Object.keys(p.data).filter(k => !skip.has(k) && !same(p.data[k], back[k]))
    if (miss.length) {
      console.error(`[date] ★中断: ${p.newId} で項目が一致しません: ${miss.join(', ')}`)
      console.error('[date] 旧文書はそのまま残っています。控え:', backup)
      process.exit(1)
    }
    // ③ 旧いキーはアーカイブ（削除しない）
    await db.collection('measurements').doc(p.oldId)
      .set({ voided: true, movedTo: p.newId, movedAt: new Date().toISOString() }, { merge: true })
    // ④ 測定キーの索引
    await db.collection('users').doc(String(p.f.userId))
      .set({ measKeys: admin.firestore.FieldValue.arrayUnion(p.newId) }, { merge: true })
    ok++
    console.log(`   済 ${p.oldId} → ${p.newId}（全項目一致を確認）`)
  }
  console.log(`[date] 完了: ${ok} 件。戻すには控え ${backup} の内容を旧キーへ書き戻し、新キーを voided にしてください`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
