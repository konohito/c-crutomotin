/* 実データ（Firestore）の読み込み → エンジンの利用者配列に差し込む継ぎ目。
   VITE_FIREBASE_CONFIG があり、認証済みで、Firestore に users がある場合のみ実データを使う。
   未設定・データ無しなら false を返し、従来のシードデモのまま。
   個人情報を含むため、実データはログイン内（認証後）でのみ読み込む。 */
import D, { axesOf, setUsers, replaceMunis, setYears } from '../data/engine.js'
import { dbEnabled, getFs } from './db.js'
import { assertSavable, assertSmiSavable } from './validate.js'

export const realDataEnabled = () => dbEnabled()

/* 所属者未確定の測定（unassigned: true）。読み込みのたびに入れ替える。
   利用者に紐づいていないので台帳・集計・提出物には一切出ない。点検パネルの表示用。 */
const _unassigned = []
export const unassignedMeasurements = () => _unassigned.slice()

// 測定値（欠測を左右で補完）→ 5領域スコアと総合スコアを算出
function scoreOf(sex, v) {
  const vv = {
    walk5: v.walk5 ?? null, walk5max: v.walk5max ?? null,
    balR: v.balR ?? v.balL ?? null, balL: v.balL ?? v.balR ?? null,
    gripR: v.gripR ?? v.gripL ?? null, gripL: v.gripL ?? v.gripR ?? null,
    tug: v.tug ?? null, height: v.height ?? null, weight: v.weight ?? null,
    bmi: v.bmi ?? ((v.height && v.weight) ? Math.round((v.weight / Math.pow(v.height / 100, 2)) * 10) / 10 : null),
  }
  let axes, total
  try {
    axes = axesOf(sex, vv)
    total = Math.round(((axes.walk + axes.balance + axes.grip + axes.mobility + axes.body) / 25) * 100)
  } catch {
    axes = { walk: 1, balance: 1, grip: 1, mobility: 1, body: 1 }; total = 0
  }
  return { values: vv, axes, total }
}

/* 測定ドキュメント ID。
   旧: `{利用者ID}_{年度}` … 1 年度 1 件しか持てず、同じ年度に 2 回測ると
       後の測定が前の測定を上書きして消していた（熊本市の C 型・短期集中は
       開始時と終了時を約 3 か月間隔で測るため、開始時が毎回消えていた）。
   新: `{利用者ID}_{測定日}` … 測定日ごとに 1 件。同じ年度に何回でも入る。
   評価日が未記入のものだけ、従来どおり年度キーにフォールバックする。 */
// 評価日 → YYYYMMDD。「2026/09/7」のように 0 詰めされていない表記も揃える
export const compactDate = (date) => {
  const m = String(date || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  return m ? m[1] + m[2].padStart(2, '0') + m[3].padStart(2, '0') : ''
}
/* 保存する評価日は必ず 0 詰めの YYYY/MM/DD に揃える。
   「2026/09/7」のような書き方が混ざると、同じ日が別の日として数えられてしまう。 */
export const normDate = (v) => {
  const m = String(v ?? '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/)
  return m ? `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}` : null
}
export const measKey = (id, date, year) => {
  const d = compactDate(date)
  return d ? `${id}_${d}` : `${id}_${year}`
}
// 並べ替え用のキー。評価日が無いものは年度の頭に置く
const sortKeyOf = (m) => compactDate(m.date) || `${m.year}0000`

// Firestore の user ドキュメント + 測定群 → エンジン形式の利用者オブジェクト
// (電子手帳のポータル読み込み(techo.js)からも使う)
export function toEngineUser(u, measList) {
  const meas = {}, inbody = {}, kcl = {}, series = []
  for (const m of measList) {
    // 評価年の修正で別年度に移した元ドキュメント。監査のため残すが表示・集計には使わない
    if (m.voided) continue
    // InBody(体組成): ETL(etl-inbody.py)が突合して測定に付与した inbody を読む。旧 inbodySmi も後方互換。
    if (m.inbody) {
      const ib = m.inbody
      inbody[m.year] = {
        smm: ib.smm ?? null, smi: ib.smi ?? null, fatPct: ib.fatPct ?? null,
        score: ib.score ?? null, weight: ib.weight ?? (m.values ? m.values.weight : null) ?? null,
        date: ib.testDate || m.date || null,
      }
    } else if (m.inbodySmi != null) {
      inbody[m.year] = { smi: m.inbodySmi, smm: null, fatPct: null, score: null }
    }
    // InBody 単独の記録（その年の体力測定が台帳に無い。例: 令和5年度）は
    // 参加履歴・スコアには入れず、InBody 欄にのみ表示する。
    // 問診票の実回答(kclAnswers)。kihon.js の kclScore が読む raw 形式に変換する
    if (m.kclAnswers) kcl[m.year] = { raw: { ...((kcl[m.year] || {}).raw || {}), ...m.kclAnswers }, date: m.date || null }
    if (m.inbodyOnly) continue
    const s = scoreOf(u.sex, m.values || {})
    series.push({
      ...s, date: m.date || null, review: !!m.review,
      year: Number(m.year), key: m._id || measKey(u.id, m.date, m.year),
      source: m.source || '',
      /* 測定の目的。'cType' = 短期集中予防サービス（通所型サービスC）の介入前後の測定、
         'city' = 自治体依頼のエリア報告向けの測定（既定）。
         同じ方が両方を受けうるため、利用者ではなく測定の属性として持つ。 */
      program: m.program === 'cType' ? 'cType' : 'city',
      /* 台帳(熊本市の個人管理台帳)にしか無い記入項目。提出 CSV はここから出す。
         アプリ側で作文・推定しない(以前は測定者が空、コメントが自動生成文、
         補装具が備考からの推測、訓練方法が全員「集団」になっていた)。 */
      examiner: m.examiner || '', trainingType: m.trainingType || '',
      selfTraining: m.selfTraining || '', goal: m.goal || '', freeNote: m.freeNote || '',
      assistive: m.assistive || '', assistiveOther: m.assistiveOther || '',
      comment: m.comment || '',
    })
  }
  // 測定日の昇順。同じ年度に複数回あってもすべて残す（推移はこの配列を見る）
  series.sort((a, b) => (sortKeyOf(a) < sortKeyOf(b) ? -1 : sortKeyOf(a) > sortKeyOf(b) ? 1 : 0))
  // 年度キーの参照（既存画面との互換）。同じ年度に複数あるときは「その年度の最新」を代表にする
  for (const r of series) {
    const cur = meas[r.year]
    if (!cur || sortKeyOf(r) >= sortKeyOf(cur)) meas[r.year] = r
  }
  const years = Object.keys(meas).map(Number)
  return {
    id: u.id, name: u.name || '', kana: u.kana || '',
    sex: u.sex || 'F', sexLabel: u.sex === 'M' ? '男' : '女',
    birth: u.birth || null, birthDate: u.birthDate || '',
    age: u.birth ? (D.CUR - u.birth) : (u.age || null),
    muni: u.muni || 'kashima', muniName: u.muniName || '嘉島町', region: u.region || '嘉島町圏域',
    venueCode: u.venueCode || 900, venueName: u.ward || u.venueName || '',
    phone: u.phone || '', careLevel: u.careLevel || '',
    joined: years.length ? Math.min(...years) : D.CUR, theta: 0,
    note: u.note || '', flags: u.flags || [], walkIn: !!u.walkIn,
    /* 気づきメモ。利用者文書の配列項目に残す（以前は画面の中だけに置いていたため、
       「登録しました」と出ても再読み込みで消えていた）。 */
    memos: Array.isArray(u.memos) ? u.memos : [],
    portal: u.portal || null, // 電子手帳アカウント { loginId, issuedAt }
    // 統合（同一人物の名寄せ）関連。archived な方は台帳・集計・出力に出さない
    archived: !!u.archived, mergedInto: u.mergedInto || null, extId: u.extId || '',
    /* 短期集中予防サービス（C型）の対象者か。
       正は測定側の program（測定の属性）。利用者側はそこから導くだけで二重に持たない
       （別々に持つと必ず食い違うため）。C型の測定を 1 件でも持てば対象者。 */
    cType: series.some(r => r.program === 'cType'),
    // 地区（行政区）の履歴。[{ ward, muni, muniName, region, venueCode, dates:[測定日] }]
    // 行政提出 CSV / 結果票は「その測定当時の地区」をここから引く
    districtHistory: u.districtHistory || [],
    meas, inbody, kcl, series,
  }
}

// ---- 編集（Phase③）: メモリ即時反映 + Firestore 保存 --------------------------
/* 利用者の基本情報を更新（氏名・かな・性別・生年月日・市町村/行政区・介護度・電話）。
   districtChange は地区（市町村・行政区）を変えたときの扱い:
     'fix'   … 入力の誤りを直す。過去の測定もまとめて新しい地区で扱う（既定。提出 CSV は今までどおり）
     'moved' … 引っ越し・所属変更。これまでの測定は前の地区のまま出す（履歴に残す）
   誤りの訂正で勝手に履歴が増えると、提出 CSV が過去の誤った地区のまま出てしまうため既定は 'fix'。 */
export async function saveUserFields(id, patch, districtChange = 'fix') {
  const u = D.users.find(x => x.id === id)
  // 地区が変わるか（変わる場合、'moved' なら変更前の地区をこれまでの測定日つきで履歴に残す）
  let history = null
  if (u && districtChange === 'moved') {
    const wardChanged = patch.venueName !== undefined && patch.venueName !== u.venueName
    const muniChanged = patch.muniName !== undefined && patch.muniName !== u.muniName
    if (wardChanged || muniChanged) {
      const dates = (u.series || []).map(r => r.date).filter(Boolean)
      history = [...(u.districtHistory || []), {
        ward: u.venueName || '', muni: u.muni || '', muniName: u.muniName || '',
        region: u.region || '', venueCode: u.venueCode ?? null,
        dates, fromUserId: u.id, source: 'edit', at: new Date().toISOString(),
      }]
    }
  }
  if (u) {
    Object.assign(u, patch)
    if (patch.sex) u.sexLabel = patch.sex === 'M' ? '男' : '女'
    if (patch.birthDate !== undefined) {
      const y = parseInt(String(patch.birthDate).slice(0, 4), 10)
      if (y) { u.birth = y; u.age = D.CUR - y }
    }
    // 市町村は名前で登録・編集する（新しい市町村名を打てば自動で選択肢に増える）。
    if (patch.muniName !== undefined) u.muni = patch.muniName
    if (history) u.districtHistory = history
  }
  if (dbEnabled()) {
    const { fs, db } = await getFs()
    const doc = {}
    for (const k of ['name', 'kana', 'sex', 'birthDate', 'careLevel', 'phone']) {
      if (patch[k] !== undefined) doc[k] = patch[k]
    }
    if (patch.muniName !== undefined) { doc.muniName = patch.muniName; doc.muni = patch.muniName }
    if (patch.venueName !== undefined) doc.ward = patch.venueName
    if (u && u.birth != null) doc.birth = u.birth
    if (history) doc.districtHistory = history
    await fs.setDoc(fs.doc(db, 'users', id), doc, { merge: true })
  }
}

// 新規利用者を Firestore に保存（メモリへの追加は呼び出し側で実施済み）。
// venueName＝行政区。muni はメモリの id と一致させる（再読込後もフィルタが揃うように）。
export async function createUserDoc(u) {
  if (!dbEnabled()) return
  const { fs, db } = await getFs()
  const doc = {
    name: u.name || '', kana: u.kana || '', sex: u.sex || 'F',
    birth: u.birth ?? null, birthDate: u.birthDate || '',
    muni: u.muni || '', muniName: u.muniName || '', region: u.region || '',
    ward: u.venueName || '', venueCode: u.venueCode ?? null,
    phone: u.phone || '', careLevel: u.careLevel || '',
    walkIn: !!u.walkIn, // 当日受付の仮登録(正式登録で false に。true の間は台帳一覧に出さない)
  }
  await fs.setDoc(fs.doc(db, 'users', u.id), doc, { merge: true })
}

// 年度の測定値を更新（5領域・総合スコアを再計算 + Firestore 保存）
// date(評価日)を渡すと合わせて保存する(undefined なら触らない。'' は未記入=null 扱い)
// key を渡すと その測定ドキュメントを更新する（同じ年度に複数回ある場合の指定用）。
// 省略時は「その年度の最新の測定」、それも無ければ評価日から新しいドキュメントを作る。
// opts.force=true で範囲チェックを素通しする（職員が「この値のまま保存」を選んだとき）。
export async function saveMeasurement(id, year, values, date, key, opts = {}) {
  /* 人体としてあり得ない値（体重 591kg・身長 51.6cm・握力 222kg など）は、
     台帳にもメモリにも一切触れる前にここで止める。保存経路はすべてこの関数を通るため、
     ここが最後の砦になる。しきい値と根拠は src/lib/validate.js を参照。 */
  assertSavable(values, opts)
  const u = D.users.find(x => x.id === id)
  const s = scoreOf(u ? u.sex : 'F', values)
  // 評価日は 0 詰めに正規化して保存する（書式のゆれで同じ日が分かれるのを防ぐ）
  let d = date === undefined ? undefined : (normDate(date) || null)
  /* opts.create=true は「過去の測定を新しく足す」とき。既存の測定を掴まないようにする。
     これが無いと、年度だけ指定して保存したときに その年度の既存の測定を上書きしてしまう。 */
  const target = opts.create ? null
    : ((u && u.series || []).find(r => key ? r.key === key : false)
      || (key ? null : (u && u.meas[year]) || null))
  const oldKey = target ? target.key : null
  /* 新規の測定で評価日が渡されなかった場合は「今日」を入れる。
     日付が無いと年度キーのままになり、同じ年度に 2 回測ったときに
     また上書きで消えてしまうため（この不具合の再発防止）。 */
  if (!target && (d === undefined || d === null)) {
    const t = new Date()
    d = `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')}`
  }
  // 評価日を変えたら、ドキュメント ID も新しい日付のものに移す（ID と評価日を食い違わせない）
  const newKey = measKey(id, d !== undefined ? d : (target && target.date), year)
  if (u) {
    const rec = target || { values: {}, axes: null, total: 0, date: null, review: false, year: Number(year), key: newKey, source: '' }
    rec.values = s.values; rec.axes = s.axes; rec.total = s.total
    if (d !== undefined) rec.date = d
    if (!rec.date) rec.date = null
    rec.year = Number(year); rec.key = newKey
    u.series = u.series || []
    if (!target) u.series.push(rec)
    u.series.sort((a, b) => (sortKeyOf(a) < sortKeyOf(b) ? -1 : sortKeyOf(a) > sortKeyOf(b) ? 1 : 0))
    /* 年度の代表（その年度の最新）を全年度ぶん取り直す。
       評価日を変えると年度も変わるため、元の年度の代表が古い記録を指したままにならないようにする。 */
    u.meas = {}
    for (const r of u.series) {
      const cur = u.meas[r.year]
      if (!cur || sortKeyOf(r) >= sortKeyOf(cur)) u.meas[r.year] = r
    }
    const ys = Object.keys(u.meas).map(Number)
    if (ys.length) u.joined = Math.min(...ys)
    // 評価日は測定ドキュメント共通のため、同年の問診カードの表示日も揃える
    if (d !== undefined && u.kcl && u.kcl[year]) u.kcl[year].date = d
  }
  if (dbEnabled()) {
    const { fs, db } = await getFs()
    const doc = { userId: id, year: Number(year), values: s.values }
    if (d !== undefined) doc.date = d
    /* 過去の測定を足すとき、その評価日に無効化済みのドキュメントが残っていることがある
       （引っ越しや訂正のあと）。merge で書くと voided が立ったままになり、
       「追加したのに画面に出ない」状態になるため、ここで必ず有効に戻す。 */
    if (opts.create) doc.voided = false
    if (oldKey && oldKey !== newKey) {
      // 日付が変わってドキュメントが引っ越すとき。中身を引き継いでから元を無効化する
      const snap = await fs.getDoc(fs.doc(db, 'measurements', oldKey))
      const base = snap.exists() ? snap.data() : {}
      delete base.voided
      await fs.setDoc(fs.doc(db, 'measurements', newKey), { ...base, ...doc })
      await fs.setDoc(fs.doc(db, 'measurements', oldKey), { userId: id, year: Number(year), voided: true }, { merge: true })
    } else {
      await fs.setDoc(fs.doc(db, 'measurements', newKey), doc, { merge: true })
    }
    // 電子手帳（本人ログイン）は list が使えず文書 ID 指定でしか読めないため、
    // 利用者文書に測定キーの索引を持たせておく（techo.js の loadPortalData が読む）
    try {
      await fs.setDoc(fs.doc(db, 'users', id), { measKeys: fs.arrayUnion(newKey) }, { merge: true })
    } catch (e) { console.warn('measKeys index update failed:', e && e.message) }
  }
  return s
}

/* 評価年の付け替え(moveMeasurementYear)は廃止した。
   year 項目だけを書き換える作りだったため、ドキュメントのキー({利用者ID}_{測定日})と
   評価日はそのままで年度だけがずれ、「評価日は本日・年度は昨年」という食い違った記録ができた。
   その状態で評価日を直すとドキュメントごと引っ越し、本日の測定が消える事故が起きた(2026/09/17)。
   いまは年度を評価日から自動で決めるため(fiscalYearOfDate)、この関数は不要。
   過去の測定を足したいときは saveMeasurement(..., { create: true }) で新しい測定を作る。 */

// 年度の基本チェックリスト回答を保存（はい/いいえのみ残し、丸ごと置き換える）
// 誤読の訂正で「未回答」に戻した設問がきちんと消えるように、
// setDoc(merge) のキー単位マージではなく updateDoc でマップごと置き換える。
// date(評価日)を渡すと合わせて保存する(undefined なら触らない。'' は未記入=null 扱い)
export async function saveKclAnswers(id, year, answers, date) {
  const clean = {}
  Object.entries(answers || {}).forEach(([k, v]) => { if (v === 'yes' || v === 'no') clean[k] = v })
  const d = date === undefined ? undefined : (normDate(date) || null)
  const u = D.users.find(x => x.id === id)
  if (u) {
    u.kcl = u.kcl || {}
    const prevDate = (u.kcl[year] || {}).date || null
    u.kcl[year] = { raw: clean, date: d !== undefined ? d : prevDate }
    // 評価日は測定ドキュメント共通のため、同年の測定側の表示日も揃える
    if (d !== undefined && u.meas[year]) u.meas[year].date = d
  }
  if (dbEnabled()) {
    const { fs, db } = await getFs()
    // 問診票はその年度の測定と同じドキュメントに入れる（同年度に複数あるときは最新＝代表）
    const rep = u && u.meas[year]
    const ref = fs.doc(db, 'measurements', (rep && rep.key) || measKey(id, d !== undefined ? d : (rep && rep.date), year))
    // セキュリティルールが userId/year を要求するため、先に merge で確保しておく
    const base = { userId: id, year: Number(year) }
    if (d !== undefined) base.date = d
    await fs.setDoc(ref, base, { merge: true })
    await fs.updateDoc(ref, { kclAnswers: clean })
  }
  return clean
}

/* 気づきメモを 1 件追加する（利用者文書の memos 配列に足す）。
   arrayUnion で足すので、同じ方を 2 台の端末で同時に開いていても取りこぼさない。
   メモは消さない（訂正は追記で残す）＝台帳の監査性を測定値と揃える。 */
export async function addUserMemo(id, memo) {
  const entry = { date: memo.date || '', text: String(memo.text || ''), by: memo.by || '', at: new Date().toISOString() }
  if (dbEnabled()) {
    const { fs, db } = await getFs()
    await fs.setDoc(fs.doc(db, 'users', id), { memos: fs.arrayUnion(entry) }, { merge: true })
  }
  const u = D.users.find(x => x.id === id)
  if (u) { u.memos = [...(u.memos || []), entry] }
  return entry
}

/* InBody(体組成)の値を、その年度の測定ドキュメントに保存する。
   CSV の紐づけ取り込みから呼ぶ（以前は画面の中だけに入れていたため再読み込みで消えていた）。
   測定値(values)には触らない。ルールが userId/year を要求するので必ず一緒に書く。 */
export async function saveInbody(id, year, inbody, date) {
  const u = D.users.find(x => x.id === id)
  // SMI は画面に出す唯一の値なので、あり得ない値はここで止める（桁の打ち間違い対策）
  assertSmiSavable(inbody && inbody.smi, u ? u.sex : 'F')
  const rep = u && u.meas && u.meas[year]
  const d = normDate(date) || (rep && rep.date) || null
  const key = (rep && rep.key) || measKey(id, d, year)
  const clean = {}
  for (const k of ['smm', 'smi', 'fatPct', 'score', 'weight']) {
    clean[k] = (inbody && inbody[k] != null) ? inbody[k] : null
  }
  clean.testDate = d
  if (dbEnabled()) {
    const { fs, db } = await getFs()
    await fs.setDoc(fs.doc(db, 'measurements', key), {
      userId: id, year: Number(year), ...(d ? { date: d } : {}), inbody: clean,
    }, { merge: true })
  }
  if (u) { u.inbody = u.inbody || {}; u.inbody[year] = { ...clean, date: d } }
  return clean
}

// Firestore から全利用者・全測定を読み込み、エンジンへ適用する。
// 戻り値: { loaded: 実データを適用したか, denied: 権限なし(未承認の職員) }
export async function loadRealData() {
  if (!dbEnabled()) return { loaded: false }
  try {
    const { fs, db } = await getFs()
    const usnap = await fs.getDocs(fs.collection(db, 'users'))
    // 本番(Firebase 設定あり)では、データが無くてもシード(ダミー)を表示しない。空の台帳にする。
    if (usnap.empty) { setUsers([]); return { loaded: true, empty: true } }
    const msnap = await fs.getDocs(fs.collection(db, 'measurements'))
    const byUser = {}
    // ドキュメント ID（＝測定日キー）も渡す。同じ年度に複数回ある測定を区別するのに使う
    _unassigned.length = 0
    msnap.forEach(d => {
      const m = d.data()
      /* 持ち主が分からない測定（台帳の取り違えで別の方に付いていたもの）。
         利用者に紐づけずに保持し、点検パネルに出して担当者に確認してもらう。
         勝手に利用者を作らない・値は 1 項目も捨てない、という方針のための置き場。 */
      if (m.unassigned) { _unassigned.push({ ...m, _id: d.id }); return }
      ;(byUser[m.userId] ||= []).push({ ...m, _id: d.id })
    })
    // 統合でアーカイブした方は台帳から外す（削除はしていないので、統合画面から元に戻せる）
    const list = usnap.docs.map(d => toEngineUser({ id: d.id, ...d.data() }, byUser[d.id] || []))
      .filter(u => u.name && !u.archived)
    // 市町村と行政区を選択肢に登録(複数市町村に対応: 嘉島町 + 熊本市各区 など)。
    // 利用者数の多い市町村を先頭にする(当日受付などの既定値が従来どおり嘉島町になるように)
    const muniIds = [...new Set(list.map(u => u.muni).filter(Boolean))]
      .sort((a, b) => list.filter(u => u.muni === b).length - list.filter(u => u.muni === a).length)
    let vc = 900
    const munis = muniIds.map((id) => {
      const us = list.filter(u => u.muni === id)
      const wards = [...new Set(us.map(u => u.venueName).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
      return { id, name: us[0].muniName || String(id), region: us[0].region || '', tel: '', venues: wards.map(w => [vc++, w]) }
    })
    replaceMunis(munis.length ? munis : [{ id: 'kashima', name: '嘉島町', region: '嘉島町圏域', tel: '', venues: [] }])
    // 年度の選択肢を実データに合わせる（今年度＋データにある年度。固定しない）
    setYears(list.flatMap(u => (u.series || []).map(r => Number(r.year))))
    setUsers(list)
    return { loaded: true }
  } catch (e) {
    if (e && e.code === 'permission-denied') return { loaded: false, denied: true }
    /* 読み込みに失敗したときに、そのまま画面を出してはいけない。
       本番の台帳が 1 件も入っていない状態（＝見本用のダミーの名簿）のまま業務画面が開き、
       「データが消えた」ように見えるうえ、その上から登録・編集ができてしまう。
       失敗は失敗として画面に出し、やり直せるようにする。 */
    console.error('loadRealData failed:', e)
    return { loaded: false, error: (e && e.message) || String(e) }
  }
}
