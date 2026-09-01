#!/usr/bin/env node
/* 正規化済みデータ(normalized.json) を Firestore に投入する。
   - users/{id}            … 名簿（氏名/かな/性別/生年月日/市町村/行政区/介護度/電話 等）
   - measurements/{id}_{年} … 年度ごとの測定値 + InBody SMI + 要確認フラグ
   使い方:
     # エミュレータへ（ローカル検証）
     FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GOOGLE_CLOUD_PROJECT=demo-cruto \
       node scripts/seed-firestore.mjs path/to/normalized.json
     # 本番プロジェクトへ（要 ADC: gcloud auth application-default login）
     GOOGLE_CLOUD_PROJECT=YOUR_PROJECT node scripts/seed-firestore.mjs path/to/normalized.json

   ※ normalized.json は個人情報を含むためリポジトリにはコミットしないこと。 */
import { readFileSync } from 'node:fs'
import admin from 'firebase-admin'

const file = process.argv[2] || 'normalized.json'
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'demo-cruto'
const data = JSON.parse(readFileSync(file, 'utf8'))

admin.initializeApp({ projectId })
const db = admin.firestore()

const MEAS_FIELDS = ['walk5', 'walk5max', 'balR', 'balL', 'gripR', 'gripL', 'tug', 'height', 'weight', 'bmi']

async function main() {
  console.log(`[seed] project=${projectId} file=${file} 利用者=${data.length}名`)
  let batch = db.batch(), n = 0, users = 0, meas = 0
  const flush = async () => { await batch.commit(); batch = db.batch(); n = 0 }

  for (const u of data) {
    const uref = db.collection('users').doc(String(u.id))
    batch.set(uref, {
      id: String(u.id), name: u.name || '', kana: u.kana || '', sex: u.sex || null,
      birthDate: u.birthDate || '', birth: u.birth || null,
      muni: u.muni || 'kashima', muniName: u.muniName || '嘉島町', region: u.region || '嘉島町圏域',
      ward: u.ward || '', careLevel: u.careLevel || '', phone: u.phone || '',
      flags: u.flags || [],
      ...(u.extId ? { extId: String(u.extId) } : {}),   // 取り込み元台帳での ID(熊本市など)
    }, { merge: true })
    users++; if (++n >= 400) await flush()

    // 測定と基本チェックリストのある年度をまとめて 1 通の measurements ドキュメントに
    const yearsAll = new Set([...Object.keys(u.meas || {}), ...Object.keys(u.kcl || {})])
    for (const year of yearsAll) {
      const m = (u.meas || {})[year] || {}
      const doc = {
        userId: String(u.id), year: Number(year), date: m.date || null,
        inbodySmi: (u.inbody && u.inbody[year] && u.inbody[year].smi != null) ? u.inbody[year].smi : null,
        review: !!m.review, source: m.source || '',
      }
      if ((u.meas || {})[year]) {
        const values = {}
        for (const k of MEAS_FIELDS) values[k] = (m[k] === undefined ? null : m[k])
        doc.values = values
      } else {
        doc.inbodyOnly = true   // 体力測定なし(KCL のみ)の年はスコア・参加年に数えない
      }
      // 基本チェックリストの実回答(raw: {'設問No': 'yes'|'no'})。アプリは kclAnswers を読む
      if (u.kcl && u.kcl[year]) doc.kclAnswers = u.kcl[year]
      batch.set(db.collection('measurements').doc(`${u.id}_${year}`), doc, { merge: true })
      meas++; if (++n >= 400) await flush()
    }
  }
  if (n > 0) await batch.commit()
  console.log(`[seed] 完了: users=${users} measurements=${meas}`)
}
main().catch(e => { console.error(e); process.exit(1) })
