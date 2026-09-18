'use strict'
/* ビジョン AI(Gemini)の読み(visionread の戻り値)を、記録用紙スキーマへ変換する純粋ロジック。
   mapDocumentToSheet(Document AI 版)と同じ形を返すため、後段(recognition / 画面)は
   どちらのエンジンで読んだかを意識しなくてよい。

   Document AI 版との違い:
   - Gemini は信頼度(confidence)を返さない。代わりに「妥当範囲に収まったか」で
     信頼度を作る。範囲外の値は採用せず(台帳にあり得ない値を入れない)、
     生の読みだけ残して職員の判断に回す。
   - 記録用紙は全件職員確認を通す前提(index.js で needsReview を立てる)。
     ここで付ける信頼度は「どの項目が特に怪しいか」を画面で目立たせるためのもの。 */
const { SHEET_COLS, VALUE_RANGE, zenToHan } = require('./mapping')

/* 妥当範囲に収まった読み。Gemini 自身の確からしさではないため、
   しきい値(既定 80)は超えるが 100 にはしない。 */
const CONF_OK = 90
// 読めたが数として不自然。要確認しきい値を必ず下回らせ、画面で目立たせる。
const CONF_DOUBT = 40

/* 1 項目の読み → { value, raw, conf, state }
   state: 'ok' | 'out-of-range' | 'unclear' | 'blank'
   - null        … 記入枠が空欄(測定していない)
   - "unclear"   … 自信を持って読めなかった
   - "163.2"     … 読み取れた値 */
function parseVisionValue(raw, cid) {
  if (raw == null) return { value: null, raw: '', conf: 0, state: 'blank' }
  const s = zenToHan(String(raw)).trim()
  if (!s || /^unclear$/i.test(s)) return { value: null, raw: s, conf: 0, state: 'unclear' }
  const m = s.match(/-?\d+(?:\.\d+)?/)
  const v = m ? parseFloat(m[0]) : NaN
  if (!Number.isFinite(v)) return { value: null, raw: s, conf: 0, state: 'unclear' }
  const range = VALUE_RANGE[cid]
  /* 範囲外は採用しない。小数点の位置を取り違えると桁が 10 倍ずれる(体重 50.4 → 504)ため、
     「読めたが範囲外」は誤読とみなして値を空にし、生の読みだけ職員に見せる。 */
  if (range && (v < range[0] || v > range[1])) {
    return { value: null, raw: s, conf: CONF_DOUBT, state: 'out-of-range' }
  }
  return { value: v, raw: s, conf: CONF_OK, state: 'ok' }
}

// 様式番号(R7-02W / R7-03W)なら飛び込み用紙。parseVisionJson が大文字・記号無しに寄せている。
function isWalkInForm(form) {
  const f = String(form || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return f.includes('R702W') || f.includes('R703W')
}

// vis → { ocrName, ocrKana, ocrId, nameConf, fields:{cid:{value,raw,conf}}, walkIn, debug }
function sheetFromVision(vis) {
  const fields = {}
  const states = {}
  SHEET_COLS.forEach(cid => { fields[cid] = { value: null, raw: '', conf: 0 } })

  const values = (vis && vis.values && typeof vis.values === 'object') ? vis.values : {}
  for (const cid of SHEET_COLS) {
    // 項目自体が応答に無い = そもそも読めていない(空欄と区別する)
    if (!(cid in values)) { states[cid] = 'missing'; continue }
    const p = parseVisionValue(values[cid], cid)
    fields[cid] = { value: p.value, raw: p.raw, conf: p.conf }
    states[cid] = p.state
  }

  const ocrName = (vis && vis.name) || ''
  return {
    ocrName,
    ocrKana: (vis && vis.kana) || '',
    ocrId: String((vis && vis.id) || '').replace(/\D/g, ''),
    nameConf: ocrName ? CONF_OK : 0,
    fields,
    walkIn: isWalkInForm(vis && vis.form),
    debug: {
      source: 'vision',
      model: (vis && vis.model) || null,
      type: (vis && vis.type) || null,
      form: (vis && vis.form) || null,
      states,
    },
  }
}

module.exports = { sheetFromVision, parseVisionValue, isWalkInForm, CONF_OK, CONF_DOUBT }
