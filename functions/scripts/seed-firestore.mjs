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
    }, { merge: true })
    users++; if (++n >= 400) await flush()

    for (const [year, m] of Object.entries(u.meas || {})) {
      const values = {}
      for (const k of MEAS_FIELDS) values[k] = (m[k] === undefined ? null : m[k])
      batch.set(db.collection('measurements').doc(`${u.id}_${year}`), {
        userId: String(u.id), year: Number(year), date: m.date || null,
        values, inbodySmi: (u.inbody && u.inbody[year] && u.inbody[year].smi != null) ? u.inbody[year].smi : null,
        review: !!m.review, source: m.source || '',
      }, { merge: true })
      meas++; if (++n >= 400) await flush()
    }
  }
  if (n > 0) await batch.commit()
  console.log(`[seed] 完了: users=${users} measurements=${meas}`)
}
main().catch(e => { console.error(e); process.exit(1) })
