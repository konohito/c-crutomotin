'use strict'
/* 写真 1 枚を読み取って recognition ドキュメントの中身にするところ。
 * **読み取りの engine をどちらにするかを決めるのは、このファイルの 1 か所だけ。**
 *
 * ★なぜ 2 つあるか（2026-11-10 ユーザー確定）
 *   保存しているデータはすべて東京だが、文字認識だけは Document AI に出していて、
 *   そこには**日本リージョンが無い**ため、読み取りの瞬間だけ米国へ出ていた。
 *   Gemini（Vertex AI）は東京で呼べるので、そちらへ寄せれば国外へ出る経路が無くなる。
 *   ただし作りが大きく違う（下）ので、環境変数 1 つで戻せる形にしてある。
 *
 * ★2 つの engine は「返ってくるものの形」が根本的に違う
 *   docai …… 文字と**座標**が返る。測定値は「ラベル行の帯で最も右にある数字クラスタ」を
 *             座標から拾い（mapping.js の spatialFallback）、問診票のマークは四隅マーカー
 *             から用紙座標に引き直して塗りの濃さを測る（kclread.js）。
 *   gemini … 文章（JSON）が返る。座標は無い。**どのマスの数字か**をモデル自身が判断して
 *             値そのものを返すので、幾何ロジックは使わない（使えない）。
 *
 * ★gemini のときに必ず守ること
 *   ・読めなかったことを 0 や空と取り違えない。読めなければ null（欠測）にして人へ回す。
 *   ・Gemini は項目ごとの確信度を返さない。返さないものを「確信度が高い」と見なさない。
 *     → needsReview を必ず立て、職員の確認を通す（visionread.js の VISION_CONF も参照）。
 *   ・呼び出しが失敗したら、空の結果を作らずに例外を投げる。
 *     呼び出し側（index.js）が status:'error' で記録し、職員が撮り直せるようにする。
 */
const cfg = require('./config')
const { mapDocumentToSheet } = require('./mapping')
const { buildRecognitionFromSheet } = require('./recognition')
const { readKcl } = require('./kclread')
const {
  readSheetVision, mergeKcl, kclFromVision, sheetFromVision, visionUnavailableReason,
} = require('./visionread')

/** 使ってよい engine。増やすならここ。 */
const ENGINES = Object.freeze(['docai', 'gemini'])
/** 既定。★精度の裏取りが済むまで従来どおり docai（理由は docs/OCR-BACKEND.md）。 */
/* ★2026-11-10 ユーザー確定「切り替えてください」
     既定を docai → gemini にした。狙いは**国外へ出る経路を無くす**こと。
     Document AI は米国でしか動かない（日本リージョンが無い）が、
     Gemini は東京（asia-northeast1）で呼べる。
     これで「保存も処理もすべて東京」と言い切れる。

   ★実測した読み取りの精度（記録用紙・実際の写真60枚・職員が登録した値を正解に）
       docai  … 222/525 = 42.3%（取り違え 51.7%）
       gemini … 489/530 = 92.3%（取り違え 4.3%）
     本番全件を見ると、Document AI の**フォームパーサは測定値を1件も取れておらず**、
     読めた2,191件は100%が座標フォールバック由来だった。

   ★戻したいときは環境変数 OCR_ENGINE=docai を設定するだけ（コードは触らない）。 */
const DEFAULT_ENGINE = 'gemini'
/** 環境変数の名前。 */
const ENGINE_ENV = 'OCR_ENGINE'

/** 値から engine を決める純粋な判定（記録には残さない）。 */
function pickEngine(raw) {
  if (raw === undefined || raw === null) return { engine: DEFAULT_ENGINE, requested: null, rejected: null }
  const name = String(raw).trim().toLowerCase()
  if (ENGINES.includes(name)) return { engine: name, requested: name, rejected: null }
  return {
    engine: DEFAULT_ENGINE,
    requested: name,
    rejected: { requested: name, reason: `使える値は ${ENGINES.join(' / ')} だけ` },
  }
}

/** 弾いたときに残す文。 */
function rejectionMessage(rejected) {
  return `[ocr-engine] ${ENGINE_ENV} に指定された "${rejected.requested}" は使えないため、`
    + `既定の "${DEFAULT_ENGINE}" で動かします（理由: ${rejected.reason}）。設定を直してください。`
}

/** 環境変数から engine を決める。弾いたときは必ず記録に残す。 */
function resolveEngine(env, log) {
  const source = env || process.env
  const picked = pickEngine(source[ENGINE_ENV])
  if (picked.rejected) (log || console.error)(rejectionMessage(picked.rejected))
  return picked.engine
}

/* ---- Document AI 経路（従来どおり。動きを変えない） ------------------------ */
/* processDocument は @google-cloud/documentai を読み込むので、gemini だけで運用する
   ときに読み込みたくない。使うときだけ require する（コールドスタートも軽くなる）。 */
async function recognizeByDocai({ content, gcsUri, mimeType, meta, sheetOnly }) {
  const { processDocument } = require('./documentai')
  const document = await processDocument({ content, gcsUri, mimeType })
  const sheet = mapDocumentToSheet(document)
  /* 単票読み取り(HTTPS の recognizeSheet)は測定値の表だけを返す。
     ★ここで止めないと、以前は Storage トリガにしか無かった処理
       （readKcl の画素展開 400MB と Gemini の呼び出し 1 回）が
       単票読み取りにも付いてしまう。HTTPS 関数は 512MiB / 60 秒しか無く、
       しかも結果の rec は使われずに捨てられる（＝課金と OOM が増えるだけ）。 */
  if (sheetOnly) return { sheet, rec: null, engine: 'docai' }
  const rec = buildRecognitionFromSheet(sheet, meta)
  rec.ocrEngine = 'docai'

  // 問診票(様式 R7-03/R7-03W)はマークシート読み取りを付与し、必ず職員確認を通す
  try {
    const kcl = readKcl(document, content, mimeType || 'image/jpeg')
    if (kcl.isKcl) {
      // debug は原因調査用(位置合わせの補正量・設問ごとの濃度)。画面には出さない
      rec.kcl = { side: kcl.side || null, answers: kcl.answers || {}, readable: !!kcl.readable, reason: kcl.reason || null, via: kcl.via || null, debug: kcl.debug || null }
      rec.needsReview = true
      // シール/手書きの ID にはラベル語が無いことがある → 単独の 5 桁数字を ID として拾う
      if (!rec.ocrId) {
        const m5 = String(document.text || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).match(/(?:^|[^0-9])(\d{5})(?![0-9])/)
        if (m5) rec.ocrId = m5[1]
      }
    }
  } catch (err2) { console.error('kclread error:', (meta && meta.storagePath) || '', err2) }

  /* ビジョン AI(Gemini)でも写真を読み、結果を統合する。
     - 問診票: 幾何ロジックの読みと統合(読めなかった設問の補完 + 正反対の主張は要確認へ)
     - ID・氏名: OCR で取れなかったときの補完(照合で名前が出ないケースの救済)
     - 文字認識ごと失敗した問診票の写真: ビジョン AI 単独で読む
     呼び出しに失敗しても従来の結果のまま進む(ログにだけ残す)。 */
  try {
    const vis = await readSheetVision(content, mimeType || 'image/jpeg')
    if (vis) {
      if (!rec.ocrId && vis.id) rec.ocrId = vis.id
      if (!rec.ocrName && vis.name) rec.ocrName = vis.name
      if (!rec.ocrKana && vis.kana) rec.ocrKana = vis.kana
      if (rec.kcl && vis.type === 'kcl') {
        rec.kcl = mergeKcl(rec.kcl, vis)
      } else if (!rec.kcl && vis.type === 'kcl') {
        const kv = kclFromVision(vis)
        if (kv) {
          rec.kcl = kv
          rec.needsReview = true
        }
      }
      if (rec.kcl && rec.kcl.debug) rec.kcl.debug.visionModel = vis.model || null
    }
  } catch (err3) {
    console.error('visionread error:', (meta && meta.storagePath) || '', err3.message || err3)
    // 失敗理由を読み取り診断に表示し、現地で原因(権限・API 無効など)を切り分けられるようにする
    if (rec.kcl) {
      rec.kcl.debug = { ...(rec.kcl.debug || {}), visionError: String(err3.message || err3).slice(0, 300) }
    }
  }
  return { sheet, rec, engine: 'docai' }
}

/* ---- Gemini だけの経路（東京のみ。国外へ出ない） --------------------------- */
async function recognizeByGemini({ content, gcsUri, mimeType, meta, sheetOnly }) {
  if (!content || !content.length) {
    /* gs:// の指定は Document AI 側の機能だったので、こちらでは画像そのものを受ける。
       アプリは常に画像を送っている（src/lib/ocr.js）ので実際には通らない道。 */
    throw new Error(gcsUri
      ? 'Gemini の読み取りでは gs:// 指定に対応していません（画像を直接送ってください）'
      : '画像を受け取れませんでした')
  }
  const why = visionUnavailableReason(content)
  if (why) throw new Error(`Gemini で読み取れません: ${why}`)

  const vis = await readSheetVision(content, mimeType || 'image/jpeg')
  // ここに来て null は想定外（上で理由を潰してある）。空の結果を作らずに断る。
  if (!vis) throw new Error('Gemini の読み取り結果を受け取れませんでした')

  const sheet = sheetFromVision(vis)
  // 単票読み取りは測定値の表だけを返す（モデルの呼び出しは 1 回で済んでいる）
  if (sheetOnly) return { sheet, rec: null, engine: 'gemini' }
  const rec = buildRecognitionFromSheet(sheet, meta)
  rec.ocrEngine = 'gemini'
  /* ★確信度を返さないモデルの読みなので、必ず人が見る。
     しきい値（OCR_REVIEW_THRESHOLD）をどう動かしても、ここは立ったままにする。 */
  rec.needsReview = true

  if (vis.type === 'kcl') {
    const kv = kclFromVision(vis)
    if (kv) {
      rec.kcl = { ...kv, debug: { ...(kv.debug || {}), engine: 'gemini', visionModel: vis.model || null } }
    } else {
      /* 問診票と分かっているのに回答を組み立てられなかった（面が分からない等）。
         黙って記録用紙として通すと、問診票が測定値 0 件の用紙として並ぶので、
         問診票であることと読めなかったことを残す。 */
      rec.kcl = {
        side: vis.side || null, answers: {}, readable: false,
        reason: '問診票と判別できましたが、おもて/うらの面が分からず回答を読み取れませんでした（用紙全体が入るように撮り直してください）',
        via: 'vision', debug: { engine: 'gemini', visionModel: vis.model || null },
      }
    }
  }
  return { sheet, rec, engine: 'gemini' }
}

/**
 * 写真 1 枚 → { sheet, rec, engine }。engine の切り替えはここだけ。
 * @param {{content?: Buffer, gcsUri?: string, mimeType?: string, meta?: object}} input
 * @param {{engine?: string, sheetOnly?: boolean}} [opts]
 *   engine …… テストから直接指定するため（本番では環境変数で決める）
 *   sheetOnly … 測定値の表だけを返す（単票読み取り。問診票の読み取りと統合を行わない）
 */
async function recognizeSheetImage(input, opts = {}) {
  let engine
  if (opts.engine) {
    /* テストからの直接指定。黙って既定へ倒すとテスト側の取り違えに気づけないので断る。 */
    const picked = pickEngine(opts.engine)
    if (picked.rejected) throw new Error(rejectionMessage(picked.rejected))
    engine = picked.engine
  } else {
    engine = resolveEngine()
  }
  const args = {
    content: input.content,
    gcsUri: input.gcsUri,
    mimeType: input.mimeType,
    meta: { threshold: cfg.reviewThreshold, ...(input.meta || {}) },
    sheetOnly: !!opts.sheetOnly,
  }
  return engine === 'gemini' ? recognizeByGemini(args) : recognizeByDocai(args)
}

module.exports = {
  ENGINES, DEFAULT_ENGINE, ENGINE_ENV,
  pickEngine, resolveEngine, rejectionMessage, recognizeSheetImage,
}
