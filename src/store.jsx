import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import D from './data/engine.js'
import { csvSplit, parseBirthYear } from './lib/helpers.js'
import { dbEnabled } from './lib/db.js'

// 読み取り設定（プロトタイプの props 相当）
export const CONF_THRESHOLD = 80  // 信頼度しきい値(%)
export const BATCH_SIZE = 24      // 1 バッチの読み取り枚数

const StoreCtx = createContext(null)

const initialState = {
  screen: 'dash', q: '', navOpen: false,
  // OCR 取り込み
  imp: 'idle', impCount: 0, resolved: {}, mdNo: null, mdVals: {}, mdUser: null,
  // 台帳
  rosRegion: 'all', rosMuni: 'all', rosWard: 'all', rosStatus: 'all', rosSort: 'id', rosPage: 0,
  // 個人詳細
  detId: null, detMetric: 'total',
  // 編集（実データ）
  editUser: null, editMeas: null, editBusy: false,
  // 分析
  // 本番(単一圏域)は圏域別を出さず、行政区別を既定にする
  anaYear: 2025, anaRegion: 'all', anaWard: 'all', anaUnit: dbEnabled() ? 'ward' : 'region', anaItem: 'gripR',
  dashItem: 'gripR', exItem: 'gripR', exSex: 'all', exAge: 'all', exCohort: 'all', exFrom: 2020,
  // PDF
  pdfMode: 'single', pdfUser: null, pdfMuni: 'sakuragawa', pdfWard: 'all', pdfYear: 2025, pdfQ: '',
  incRadar: true, incTrend: true, incPrev: true, incAvg: true, incComment: true, incFrail: true, incInbody: true, incKcl: true,
  // 用紙作成（本番は測定会イベントが無いので市町村＋行政区で選ぶ）
  shMode: dbEnabled() ? 'muni' : 'event', shEvent: '', shMuni: 'sakuragawa', shWard: 'all', shBlank: 0,
  // モバイル
  mob: 'home', mShots: 0, mSent: 0,
  // カレンダー
  calY: 2025, calM: 9,
  evOpen: false, evDate: '', evKind: 'meas', evTitle: '', evVenue: '', evMuni: 'sakuragawa', evTime: '',
  customMunis: [], evNewMuni: '', evNewRegion: '', evStaff: [],
  // 本番(実データ)ではダミーのサンプル予定は出さない
  customEvents: dbEnabled() ? [] : [
    { date: '2025/09/26', kind: 'class', title: 'いきいき百歳体操 教室', venue: '第一地区公民館', time: '10:00〜11:30' },
    { date: '2025/09/30', kind: 'meet', title: '圏域連絡会議', venue: '県庁 3F 会議室', time: '14:00〜' },
  ],
  // CSV 出力
  expYear: 2025, expScope: 'all', expWard: 'all', expMeasuredOnly: true, expFrail: true, expInbody: true, expKcl: true, expFormat: 'std',
  // メモ / CSV / 新規登録
  memos: {}, memoDraft: '', csvMuni: 'sakuragawa', csvDrag: false,
  regOpen: false, regName: '', regKana: '', regBirth: '', regSex: 'F', regMuni: 'sakuragawa', regWard: '', regCare: '', regPhone: '', regError: '',
  toast: null,
  // グラフの年表示（era=令和 / west=西暦）
  yearFmt: 'era',
  // パスワード変更モーダル
  pwOpen: false,
  // データ変更カウンタ（D を直接ミューテートした際の再描画用）
  rev: 0,
}

export const EV_KINDS = {
  meas: ['測定会', 'var(--brand-100)', 'var(--brand-800)'],
  class: ['体操教室', 'var(--info-50)', 'var(--info-700)'],
  meet: ['会議・研修', 'var(--slate-100)', 'var(--slate-600)'],
  other: ['その他', 'var(--slate-100)', 'var(--slate-600)'],
}

// 会場マスタ由来の測定会イベント（不変なのでモジュールスコープで 1 回だけ構築）
const VENUE_EVENTS = (() => {
  const evs = []
  D.MUNIS.forEach(mu => mu.venues.forEach(v => {
    const code = v[0]
    const staff = [D.STAFF[(code * 2) % 10].id, D.STAFF[(code * 2 + 3) % 10].id, D.STAFF[(code + 7) % 10].id].slice(0, 2 + (code % 2))
    Object.keys(D.DATES[code]).forEach(yy => evs.push({ date: D.DATES[code][yy], kind: 'meas', venue: v[1], muni: mu.name, code, time: '受付 9:30〜', staff }))
  }))
  return evs
})()

export function StoreProvider({ children }) {
  const [state, setState] = useState(initialState)
  const timers = useRef({})

  const set = useCallback((patch) => {
    setState(s => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }))
  }, [])

  const showToast = useCallback((msg) => {
    clearTimeout(timers.current.toast)
    setState(s => ({ ...s, toast: msg }))
    timers.current.toast = setTimeout(() => setState(s => ({ ...s, toast: null })), 2800)
  }, [])

  const value = useMemo(() => ({ state, set, setState, showToast, timers }), [state, set, showToast])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  return useContext(StoreCtx)
}

// ============ 派生ヘルパー（state 依存） ============

export const batchN = () => Math.min(BATCH_SIZE, D.sheets.length)
export const sheetsAll = () => D.sheets.slice(0, batchN())

// 用紙のフラグ（脚本フラグ + 信頼度しきい値による自動フラグ）
export function flagsFor(sheet) {
  const t = CONF_THRESHOLD
  const out = sheet.flags.slice()
  const scripted = new Set(out.map(f => f.field).filter(Boolean))
  const hasNameFlag = out.some(f => f.type === 'name')
  D.SHEET_COLS.forEach(cid => {
    const f = sheet.fields[cid]
    if (!scripted.has(cid) && f.conf > 0 && f.conf < t) {
      out.push({ type: 'digit', field: cid, message: '読み取り信頼度がしきい値（' + t + '%）未満の項目があります。' })
    }
  })
  if (!hasNameFlag && sheet.nameConf < t) out.push({ type: 'name', message: '氏名の読み取り信頼度が低い用紙です。照合結果を確認してください。' })
  return out
}
export const flaggedCols = (sheet) => new Set(flagsFor(sheet).map(f => f.field).filter(Boolean))
export const needsReview = (sheet) => flagsFor(sheet).length > 0

export function pendingSheets(state) {
  if (state.imp === 'idle') return []
  const upto = state.imp === 'run' ? state.impCount : batchN()
  return sheetsAll().slice(0, upto).filter(s => needsReview(s) && !state.resolved[s.no])
}

// ============ カレンダー / イベント ============

export const allMunis = (state) => D.MUNIS.concat(state.customMunis)
export const muniByName = (state, name) => allMunis(state).find(x => x.name === name)
// 本番(実データ)では会場マスタ由来のダミー測定会イベントは出さない（イベントは未移行のため）
export const allEvents = (state) => (dbEnabled() ? [] : VENUE_EVENTS).concat(state.customEvents)
export const staffNames = (ids) => (ids || []).map(id => { const st = D.STAFF.find(x => x.id === id); return st ? st.name : null }).filter(Boolean)

// ============ メモ ============

export function memosFor(state, u) {
  if (state.memos[u.id]) return state.memos[u.id]
  if (!u.note) return []
  const last = Object.values(u.meas).slice(-1)[0]
  return [{ date: last ? last.date : '2024/10/01', text: u.note, by: '測定時記録' }]
}

// ============ OCR 取り込み操作 ============

export function openSheetVals(state, no) {
  const sheet = sheetsAll().find(x => x.no === no)
  if (!sheet) return null
  const res = state.resolved[no]
  const vals = {}
  D.SHEET_COLS.forEach(cid => {
    if (res) { vals[cid] = res.values[cid] === null ? '' : String(res.values[cid]); return }
    const fl = sheet.flags.find(f => f.field === cid)
    const f = sheet.fields[cid]
    if (fl && fl.type === 'blank') vals[cid] = ''
    else if (fl && fl.type === 'range' && fl.suggest === 'swap') vals[cid] = cid === 'height' ? String(sheet.fields.weight.value) : (cid === 'weight' ? String(sheet.fields.height.value) : D.fmt(f.value, 1))
    else if (fl && fl.type === 'range' && fl.suggest) vals[cid] = fl.suggest
    else if (fl && fl.candidates) vals[cid] = fl.candidates[0]
    else vals[cid] = f.raw === '' ? '' : String(f.value)
  })
  return { mdNo: no, mdVals: vals, mdUser: (res && res.userId) || sheet.userId }
}

// ============ CSV 取り込み ============

export function importCsvText({ text, fname, state, set, showToast }) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) { showToast('CSV にデータ行が見つかりません'); return }
  const head = csvSplit(lines[0]).map(h => h.replace(/[\s　"]/g, ''))
  const fi = (f) => head.findIndex(f)
  const iId = fi(h => /ID|ＩＤ|番号/i.test(h) && !/会場|電話|郵便|ＦＡＸ|FAX/i.test(h))
  const iName = fi(h => (h.includes('氏名') || h.includes('名前')) && !/かな|カナ|ふりがな|フリガナ/.test(h))
  const iKana = fi(h => /かな|カナ|ふりがな|フリガナ/.test(h))
  const iBirth = fi(h => h.includes('生年月日'))
  const iSex = fi(h => h.includes('性別'))
  const iTel = fi(h => h.includes('電話'))
  const iWalk = fi(h => h.includes('歩行') || /5m|５ｍ/i.test(h))
  const iBalR = fi(h => h.includes('片足') && h.includes('右'))
  const iBalL = fi(h => h.includes('片足') && h.includes('左'))
  const iGripR = fi(h => h.includes('握力') && h.includes('右'))
  const iGripL = fi(h => h.includes('握力') && h.includes('左'))
  const iTug = fi(h => /TUG|ＴＵＧ/i.test(h))
  const iHt = fi(h => h.includes('身長'))
  const iWt = fi(h => h.includes('体重'))
  if (iName < 0) { showToast('「氏名」列が見つかりません。ヘッダー行をご確認ください'); return }

  // InBody(体組成) 形式の判別: 骨格筋量・体脂肪率・SMI などの列があれば紐づけ取り込みにする
  const iSmm = fi(h => h.includes('骨格筋量'))
  const iFat = fi(h => h.includes('体脂肪'))
  const iSmi = fi(h => /SMI|ＳＭＩ|骨格筋指数/i.test(h))
  const iScore = fi(h => /InBody点数|ＩｎＢｏｄｙ|点数/i.test(h))
  if (iSmm >= 0 || iSmi >= 0 || iFat >= 0) {
    let linked = 0, unmatched = 0
    lines.slice(1).forEach(line => {
      const c = csvSplit(line)
      const val = (i) => (i >= 0 && i < c.length ? String(c[i]).trim() : '')
      const name = val(iName).replace(/[\s　]+/g, '')
      if (!name) return
      const id = val(iId).replace(/[^\d]/g, '')
      const u = (id && D.users.find(x => x.id === id)) || D.users.find(x => x.name.replace(/[\s　]/g, '') === name)
      if (!u) { unmatched++; return }
      const num = (i) => { const sv = val(i).replace(/[^\d.\-]/g, ''); if (!sv) return null; const n = parseFloat(sv); return isNaN(n) ? null : n }
      const iWtLocal = fi(h => h.includes('体重'))
      u.inbody = u.inbody || {}
      u.inbody[D.CUR] = {
        weight: num(iWtLocal) ?? (u.meas[D.CUR] ? u.meas[D.CUR].values.weight : null),
        smm: num(iSmm), fatPct: num(iFat), smi: num(iSmi), score: num(iScore),
        date: D.TODAY,
      }
      linked++
    })
    set(s => ({ rev: s.rev + 1 }))
    showToast('「' + fname + '」から InBody データ ' + linked + ' 名分を台帳に紐づけました' + (unmatched ? '（未一致 ' + unmatched + ' 件）' : ''))
    return
  }

  const mu = D.MUNIS.find(x => x.id === state.csvMuni) || D.MUNIS[0]
  let added = 0, updated = 0, measN = 0
  lines.slice(1).forEach(line => {
    const c = csvSplit(line)
    const val = (i) => (i >= 0 && i < c.length ? String(c[i]).trim() : '')
    const name = val(iName).replace(/[\s　]+/g, '')
    if (!name) return
    const id = val(iId).replace(/[^\d]/g, '')
    let u = (id && D.users.find(x => x.id === id)) || D.users.find(x => x.name.replace(/[\s　]/g, '') === name)
    const sexRaw = val(iSex)
    const sex = /女|F/i.test(sexRaw) ? 'F' : (/男|M/i.test(sexRaw) ? 'M' : 'F')
    if (!u) {
      const code = mu.venues[0][0]
      const by = parseBirthYear(val(iBirth))
      u = {
        id: id || D.newUserId(code), name, kana: val(iKana) || '', sex,
        sexLabel: sex === 'M' ? '男' : '女', birth: by, birthDate: val(iBirth) || '—', age: D.CUR - by,
        muni: mu.id, muniName: mu.name, region: mu.region, venueCode: code, venueName: mu.venues[0][1],
        phone: val(iTel), joined: D.CUR, isNew: true, theta: 0, meas: {},
      }
      D.users.push(u); added++
    } else { if (val(iTel)) u.phone = val(iTel); updated++ }
    const num = (i) => { const sv = val(i).replace(/[^\d.\-]/g, ''); if (!sv) return null; const n = parseFloat(sv); return isNaN(n) ? null : n }
    let walk5 = num(iWalk), balR = num(iBalR), balL = num(iBalL), gripR = num(iGripR), gripL = num(iGripL), tug = num(iTug), height = num(iHt), weight = num(iWt)
    if (balR === null && balL !== null) balR = balL
    if (balL === null && balR !== null) balL = balR
    if (gripR === null && gripL !== null) gripR = gripL
    if (gripL === null && gripR !== null) gripL = gripR
    if (walk5 !== null && balR !== null && gripR !== null && tug !== null) {
      const bmi = height && weight ? Math.round((weight / Math.pow(height / 100, 2)) * 10) / 10 : 22
      const v = { walk5, balR, balL, gripR, gripL, tug, height, weight, bmi }
      const ax = D.axesOf(u.sex, v)
      u.meas[D.CUR] = { values: v, axes: ax, total: Math.round(((ax.walk + ax.balance + ax.grip + ax.mobility + ax.body) / 25) * 100), date: D.TODAY }
      D.ensureKcl(u, D.CUR, D.TODAY)
      measN++
    }
  })
  set(s => ({ screen: 'ros', rosStatus: 'all', rosRegion: 'all', rosMuni: 'all', rosSort: 'id', rosPage: 0, rev: s.rev + 1 }))
  showToast('「' + fname + '」から ' + (added + updated) + ' 名を取り込みました（新規 ' + added + ' / 測定結果 ' + measN + ' 件）')
}

export function readCsvFile({ file, state, set, showToast }) {
  if (!file) return
  if (!/\.csv$|text\/csv/i.test(file.name + '|' + file.type)) { showToast('CSV ファイルを選択してください'); return }
  const fname = file.name
  const reader = new FileReader()
  reader.onload = () => {
    let text
    const buf = new Uint8Array(reader.result)
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf) }
    catch { try { text = new TextDecoder('shift-jis').decode(buf) } catch { text = new TextDecoder().decode(buf) } }
    importCsvText({ text, fname, state, set, showToast })
  }
  reader.readAsArrayBuffer(file)
}
