/* 生年月日が入っていない方をアラートに出す（2026-09-24 ユーザー要望
   「生年月日が入っていない人はアラートが立つようにしてください」）。

   なぜ要るか: 生年月日が無いと、同じ氏名の別の方と見分けられない。
   2026-09-24 に38名を取り込んだとき、8名が生年月日なしだった。
   このままだと、あとから同じ人が二重に登録されても機械では気づけない。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditUsers, KIND_LABEL } from './audit.js'

const u = (o) => ({ id: 'U1', name: '山田太郎', venueName: '上島', series: [], inbody: {}, ...o })
const kinds = (users) => auditUsers(users).filter(f => f.kind === 'noBirth')

test('生年月日が空ならアラートが出る', () => {
  const f = kinds([u({ birthDate: '' })])
  assert.equal(f.length, 1)
  assert.equal(f[0].level, 'warn')
  assert.equal(f[0].userId, 'U1')
  assert.match(f[0].message, /生年月日が入っていません/)
  assert.match(f[0].message, /二重登録/)   // なぜ困るかを書いている
})

test('未指定・空白だけでも出る', () => {
  assert.equal(kinds([u({})]).length, 1, '項目そのものが無い')
  assert.equal(kinds([u({ birthDate: null })]).length, 1, 'null')
  assert.equal(kinds([u({ birthDate: '   ' })]).length, 1, '空白だけ')
})

test('入っていれば出ない', () => {
  assert.equal(kinds([u({ birthDate: '1948/07/04' })]).length, 0)
})

test('台帳から外した方（archived）は出ない', () => {
  assert.equal(kinds([u({ birthDate: '', archived: true })]).length, 0)
})

test('氏名が無い行では出ない（そもそも台帳に出ない行）', () => {
  assert.equal(kinds([u({ birthDate: '', name: '' })]).length, 0)
})

test('人数ぶん出る', () => {
  const f = kinds([u({ id: 'A', birthDate: '' }), u({ id: 'B', birthDate: '' }), u({ id: 'C', birthDate: '1950/01/01' })])
  assert.equal(f.length, 2)
  assert.deepEqual(f.map(x => x.userId).sort(), ['A', 'B'])
})

test('最後に測定した日を添える（どの人か探しやすいように）', () => {
  const f = kinds([u({ birthDate: '', series: [{ date: '2024/10/21', values: {} }, { date: '2025/11/05', values: {} }] })])
  assert.equal(f[0].date, '2025/11/05')
})

test('点検の一覧に名前が出る', () => {
  assert.equal(KIND_LABEL.noBirth, '生年月日が入っていない')
})

test('他の点検を壊していない', () => {
  /* 身長が前回から大きく変わっている、はこれまでどおり出る。 */
  const f = auditUsers([u({
    birthDate: '1950/01/01',
    series: [{ date: '2024/10/21', values: { height: 150, weight: 50 } },
             { date: '2025/11/05', values: { height: 170, weight: 50 } }],
  })])
  assert.ok(f.some(x => x.kind === 'heightJump'), '身長の点検は生きている')
  assert.ok(!f.some(x => x.kind === 'noBirth'), '生年月日が入っていれば出ない')
})
