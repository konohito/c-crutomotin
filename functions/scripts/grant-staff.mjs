#!/usr/bin/env node
/* 職員アカウントを承認する（staff/{uid} を作成）。
   セキュリティルールは staff/{uid} が存在する職員だけに読み書きを許可するため、
   Firebase Auth でアカウントを作った後、このスクリプトで承認する。

   使い方:
     # 本番（要 ADC: gcloud auth application-default login）
     GOOGLE_CLOUD_PROJECT=cruto-motion node functions/scripts/grant-staff.mjs staff@example.jp "氏名"
     # エミュレータ
     FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
       GOOGLE_CLOUD_PROJECT=demo-cruto node functions/scripts/grant-staff.mjs test@cruto.jp テスト職員
   取り消し（承認解除）: 第2引数に --revoke を渡す。 */
import admin from 'firebase-admin'

const email = process.argv[2]
const arg3 = process.argv[3] || ''
const revoke = arg3 === '--revoke'
const name = revoke ? '' : arg3
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'demo-cruto'
if (!email) { console.error('使い方: grant-staff.mjs <email> [氏名 | --revoke]'); process.exit(1) }

admin.initializeApp({ projectId })

async function main() {
  const user = await admin.auth().getUserByEmail(email)
  const ref = admin.firestore().collection('staff').doc(user.uid)
  if (revoke) {
    await ref.delete()
    console.log(`承認を解除しました: ${email} (uid=${user.uid})`)
  } else {
    await ref.set({ email, name: name || '', addedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    console.log(`職員として承認しました: ${email}${name ? '（' + name + '）' : ''} (uid=${user.uid})`)
  }
}
main().catch(e => {
  if (e.code === 'auth/user-not-found') console.error(`アカウントが見つかりません: ${email}（先に Authentication で作成してください）`)
  else console.error(e)
  process.exit(1)
})
