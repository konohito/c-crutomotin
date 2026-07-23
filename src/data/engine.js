/* Cruto Motion — 介護予防・体力測定 データエンジン
   実データ(R7 参加者名簿_記録用紙)のスキーマに準拠:
   参加者ID(会場コード2桁+連番) / 氏名(漢字・かな) / 生年月日 / 性別 / 電話 / 診察日 / 介護度
   ５ｍ通常・最大歩行(秒) / 開眼片足立ち右・左(秒,上限60) / 握力右・左(kg,0.5刻み) / TUG(秒) / 身長 / 体重 / BMI */

import { makeDummyKcl } from './kihon.js';

// ---- seeded RNG -----------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = mulberry32(20250911);
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const gauss = () => {
  let u = 0, v = 0;
  while (u === 0) u = R();
  while (v === 0) v = R();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
const r05 = (v) => Math.round(v * 2) / 2;

// ---- master ---------------------------------------------------------------
export const REGIONS = ['北部圏域', '中央圏域', '南部圏域'];
export const MUNIS = [
  { id: 'sakuragawa', name: '桜川市', region: '北部圏域', count: 96, tel: '096-237', venues: [[10, '桜川市民体育館'], [11, '第一地区公民館'], [13, '津森地区公民館']] },
  { id: 'aoba',       name: '青葉町', region: '北部圏域', count: 46, tel: '096-282', venues: [[14, '青葉町保健センター'], [15, '飯野地区公民館']] },
  { id: 'takase',     name: '高瀬市', region: '中央圏域', count: 88, tel: '096-368', venues: [[20, '高瀬市総合福祉会館'], [21, '広安交流センター'], [23, '福田地区公民館']] },
  { id: 'wakaba',     name: '若葉町', region: '中央圏域', count: 52, tel: '096-234', venues: [[24, '若葉町公民館'], [25, '田原体育館']] },
  { id: 'misato',     name: '美里町', region: '南部圏域', count: 70, tel: '0964-46', venues: [[30, '美里町いきいきセンター'], [31, '砥用林業総合センター']] },
  { id: 'nadahama',   name: '灘浜村', region: '南部圏域', count: 48, tel: '0964-52', venues: [[34, '灘浜村漁民会館'], [35, '浜岡老人福祉センター']] },
];
export const YEARS = [2020, 2021, 2022, 2023, 2024, 2025];
export const CUR = 2025; // 令和7年度
export const ERA = { 2020: '令和2', 2021: '令和3', 2022: '令和4', 2023: '令和5', 2024: '令和6', 2025: '令和7' };

// 記録用紙の列(測定項目)
export const COLS = [
  { id: 'walk5',    label: '５ｍ通常歩行', short: '5m通常',   unit: '秒', dec: 1, better: 'low' },
  { id: 'walk5max', label: '５ｍ最大歩行', short: '5m最大',   unit: '秒', dec: 1, better: 'low' },
  { id: 'balR',   label: '開眼片足立ち 右', short: '片足立ち右', unit: '秒',  dec: 1, better: 'high' },
  { id: 'balL',   label: '開眼片足立ち 左', short: '片足立ち左', unit: '秒',  dec: 1, better: 'high' },
  { id: 'gripR',  label: '握力 右',        short: '握力右',   unit: 'kg',  dec: 1, better: 'high' },
  { id: 'gripL',  label: '握力 左',        short: '握力左',   unit: 'kg',  dec: 1, better: 'high' },
  { id: 'tug',    label: 'TUG',           short: 'TUG',     unit: '秒',  dec: 1, better: 'low' },
  { id: 'height', label: '身長',           short: '身長',    unit: 'cm',  dec: 1, better: 'none' },
  { id: 'weight', label: '体重',           short: '体重',    unit: 'kg',  dec: 1, better: 'none' },
];
// 評価軸(5段階スコア → レーダー)
export const AXES = [
  { id: 'walk',     label: '歩行速度', desc: '５ｍ通常歩行' },
  { id: 'balance',  label: 'バランス', desc: '開眼片足立ち(良い方)' },
  { id: 'grip',     label: '筋力',    desc: '握力(良い方)' },
  { id: 'mobility', label: '複合動作', desc: 'TUG' },
  { id: 'body',     label: '体格',    desc: 'BMI 適正度' },
];
const TH = {
  walk:  { M: [1.4, 1.0, 0.85, 0.7], F: [1.5, 1.1, 0.9, 0.75] },  // low better
  balance: { M: [3, 10, 25, 50], F: [3, 8, 20, 45] },              // high better
  grip:  { M: [26, 30, 34, 38], F: [16, 19, 22, 25] },             // high better
  mobility: { M: [12, 9, 7.5, 6], F: [13, 9.5, 8, 6.5] },          // low better
};
function score4(t, v, low) {
  if (low) return v <= t[3] ? 5 : v <= t[2] ? 4 : v <= t[1] ? 3 : v <= t[0] ? 2 : 1;
  return v >= t[3] ? 5 : v >= t[2] ? 4 : v >= t[1] ? 3 : v >= t[0] ? 2 : 1;
}
function bmiScore(bmi) {
  const d = Math.abs(bmi - 22);
  return d <= 1.5 ? 5 : d <= 3 ? 4 : d <= 4.5 ? 3 : d <= 6.5 ? 2 : 1;
}
export function axesOf(sex, v) {
  const bal = Math.max(v.balR, v.balL);
  const grip = Math.max(v.gripR, v.gripL);
  return {
    walk: score4(TH.walk[sex], v.walk5, true),
    balance: score4(TH.balance[sex], bal, false),
    grip: score4(TH.grip[sex], grip, false),
    mobility: score4(TH.mobility[sex], v.tug, true),
    body: bmiScore(v.bmi),
  };
}
export const fmt = (v, dec) => (v === null || v === undefined || v === '' ? '—' : dec === 0 ? String(Math.round(v)) : Number(v).toFixed(dec));

// ---- names ------------------------------------------------------------------
const SEI = [['佐藤','サトウ'],['鈴木','スズキ'],['高橋','タカハシ'],['田中','タナカ'],['伊藤','イトウ'],['渡邉','ワタナベ'],['山本','ヤマモト'],['中村','ナカムラ'],['小林','コバヤシ'],['加藤','カトウ'],['吉田','ヨシダ'],['山田','ヤマダ'],['佐々木','ササキ'],['山口','ヤマグチ'],['松本','マツモト'],['井上','イノウエ'],['木村','キムラ'],['林','ハヤシ'],['斎藤','サイトウ'],['清水','シミズ'],['山崎','ヤマザキ'],['森','モリ'],['池田','イケダ'],['橋本','ハシモト'],['阿部','アベ'],['石川','イシカワ'],['石井','イシイ'],['長谷川','ハセガワ'],['後藤','ゴトウ'],['坂本','サカモト'],['遠藤','エンドウ'],['青木','アオキ'],['藤井','フジイ'],['西村','ニシムラ'],['福田','フクダ'],['太田','オオタ'],['三浦','ミウラ'],['岡本','オカモト'],['松田','マツダ'],['中嶋','ナカシマ'],['金子','カネコ'],['藤原','フジワラ'],['村上','ムラカミ'],['近藤','コンドウ'],['石田','イシダ'],['原田','ハラダ'],['小川','オガワ'],['竹永','タケナガ'],['甲斐','カイ'],['土持','ツチモチ']];
const MEI_M = [['茂','シゲル'],['勇','イサム'],['清','キヨシ'],['博','ヒロシ'],['勝','マサル'],['実','ミノル'],['弘','ヒロム'],['武','タケシ'],['正','タダシ'],['豊','ユタカ'],['昇','ノボル'],['進','ススム'],['隆','タカシ'],['明','アキラ'],['健一','ケンイチ'],['幸雄','ユキオ'],['正雄','マサオ'],['和夫','カズオ'],['信夫','ノブオ'],['秀夫','ヒデオ'],['光男','ミツオ'],['義雄','ヨシオ'],['辰雄','タツオ'],['英治','エイジ'],['文夫','フミオ'],['守雄','モリオ']];
const MEI_F = [['花子','ハナコ'],['幸子','サチコ'],['和子','カズコ'],['節子','セツコ'],['文子','フミコ'],['美代子','ミヨコ'],['春子','ハルコ'],['静子','シズコ'],['久子','ヒサコ'],['悦子','エツコ'],['君子','キミコ'],['千代子','チヨコ'],['澄子','スミコ'],['登美子','トミコ'],['芳子','ヨシコ'],['貞子','サダコ'],['敏子','トシコ'],['栄子','エイコ'],['照子','テルコ'],['トミ子','トミコ'],['キヨ','キヨ'],['ハル','ハル'],['ヨシ子','ヨシコ'],['フサコ','フサコ'],['まり子','マリコ'],['るい子','ルイコ'],['小百合','サユリ'],['千鶴','チヅル'],['律子','リツコ'],['洋子','ヨウコ'],['典子','ノリコ'],['孝子','タカコ'],['廣子','ヒロコ'],['マツ子','マツコ'],['テルミ','テルミ'],['ミチヨ','ミチヨ']];

// ---- スタッフマスタ ------------------------------------------------------------
export const STAFF = [
  { id: 'st01', name: '相馬 直樹', role: '事務局' },
  { id: 'st02', name: '村田 千夏', role: '保健師' },
  { id: 'st03', name: '小野寺 学', role: '理学療法士' },
  { id: 'st04', name: '木下 陽菜', role: '看護師' },
  { id: 'st05', name: '古賀 誠一', role: '作業療法士' },
  { id: 'st06', name: '平田 美咲', role: '看護師' },
  { id: 'st07', name: '荒木 大輔', role: '健康運動指導士' },
  { id: 'st08', name: '内村 玲子', role: '保健師' },
  { id: 'st09', name: '柴田 康平', role: '理学療法士' },
  { id: 'st10', name: '五十嵐 桃', role: '管理栄養士' },
];

// ---- 測定会日程(9〜11月) -------------------------------------------------------
export const DATES = {}; // DATES[venueCode][year] = 'YYYY/MM/DD'
MUNIS.forEach((m) => {
  m.venues.forEach(([code], vi) => {
    DATES[code] = {};
    YEARS.forEach(y => {
      const mo = 9 + ((vi + code) % 3);
      DATES[code][y] = y + '/' + String(mo).padStart(2, '0') + '/' + String(4 + Math.floor(R() * 22)).padStart(2, '0');
    });
  });
});
DATES[10][2025] = '2025/09/24';
DATES[14][2025] = '2025/09/25';
export const TODAY = '2025/09/24';

// ---- 生成パラメータ -------------------------------------------------------------
const GEN = {
  walk5:  { M: [0.78, 0.022, 0.28], F: [0.84, 0.024, 0.3], lo: 0.5, hi: 2.6 },
  bal:    { M: [34, -2.0, 21], F: [30, -1.9, 20], lo: 0, hi: 60 },
  grip:   { M: [32, -0.42, 5], F: [23, -0.3, 3.8], lo: 8, hi: 50 },
  tug:    { M: [6.6, 0.17, 2.1], F: [7.0, 0.19, 2.2], lo: 2.8, hi: 26 },
  height: { M: 164, F: 148.5, sd: 6 },
  weight: { M: [62, 8], F: [50, 7] },
};

// ---- users --------------------------------------------------------------------
export const users = [];
const usedNames = new Set();
MUNIS.forEach(m => {
  const perVenue = {};
  m.venues.forEach(([code]) => { perVenue[code] = 0; });
  for (let k = 0; k < m.count; k++) {
    const venue = m.venues[k % m.venues.length];
    const code = venue[0];
    perVenue[code]++;
    const pid = String(code * 1000 + perVenue[code]).padStart(5, '0');
    const sex = R() < 0.78 ? 'F' : 'M';
    let name = '', kana = '';
    for (let tries = 0; tries < 50; tries++) {
      const s = pick(SEI), g = sex === 'M' ? pick(MEI_M) : pick(MEI_F);
      name = s[0] + g[0]; kana = s[1] + ' ' + g[1];
      if (!usedNames.has(name)) break;
    }
    usedNames.add(name);
    const age25 = 62 + Math.floor(R() * R() * 30 + R() * 10); // 62〜98, 中心70後半
    const birth = CUR - age25;
    const bm = 1 + Math.floor(R() * 12);
    const bd = 1 + Math.floor(R() * 28);
    const theta = clamp(gauss() * 0.9, -2.1, 2.1);
    const slope = gauss() * 0.5 - 0.15;
    const joined = pick([2020, 2020, 2020, 2020, 2021, 2021, 2022, 2022, 2023, 2023, 2024, 2025]);
    const phone = R() < 0.25 ? '090-' + (1000 + Math.floor(R() * 9000)) + '-' + (1000 + Math.floor(R() * 9000)) : m.tel + '-' + String(1000 + Math.floor(R() * 3000));
    const heightBase = r1((sex === 'M' ? GEN.height.M : GEN.height.F) + gauss() * GEN.height.sd - (age25 - 75) * 0.12);
    const weightBase = r1(GEN.weight[sex][0] + gauss() * GEN.weight[sex][1]);
    const NOTES = ['膝痛あり（立ち上がりは椅子使用）', '高血圧で服薬中', '補聴器使用・声かけは正面から', '杖歩行（T字杖）', '送迎利用（社協バス）', '転倒歴あり（令和6年冬）', '腰痛のため前屈は無理をしない', 'ペースメーカー装着'];
    // 介護度: 介護予防事業の参加者層(自立中心・一部要支援/要介護1)。年齢と体力傾向から決定
    const careScore = (age25 - 74) * 0.05 - theta * 0.55;
    const careLevel = careScore >= 1.35 ? '要介護1' : careScore >= 0.95 ? '要支援2' : careScore >= 0.5 ? '要支援1' : '自立';
    const u = {
      id: pid, name, kana, sex, sexLabel: sex === 'M' ? '男' : '女', birth, careLevel,
      birthDate: birth + '/' + bm + '/' + bd, age: age25,
      muni: m.id, muniName: m.name, region: m.region,
      venueCode: code, venueName: venue[1], phone, joined, theta, meas: {},
      note: R() < 0.3 ? pick(NOTES) : '',
    };
    YEARS.forEach(y => {
      if (y < joined) return;
      if (y < CUR && R() < 0.09) return;   // 欠測年
      if (y === CUR && R() < 0.28) return; // 令和7年度は取り込み進行中
      const age = y - birth;
      const drift = (y2, p, sign) => sign * theta * p[2] * 0.82 + sign * slope * (y2 - joined) * p[2] * 0.12 + gauss() * p[2] * 0.15;
      const gW = GEN.walk5[sex];
      const walk5 = r1(clamp(gW[0] + gW[1] * (age - 75) - drift(y, gW, 1), GEN.walk5.lo, GEN.walk5.hi));
      // 最大歩行は通常歩行より速い。体力(theta)が高いほど速度の余力が大きい
      const walk5max = r1(clamp(walk5 * clamp(0.85 - theta * 0.02, 0.72, 0.92), 0.4, GEN.walk5.hi));
      const gB = GEN.bal[sex];
      const balR = r1(clamp(gB[0] + gB[1] * (age - 75) + drift(y, gB, 1), 0, 60));
      const balL = r1(clamp(balR + gauss() * 5, 0, 60));
      const gG = GEN.grip[sex];
      const gripR = r05(clamp(gG[0] + gG[1] * (age - 75) + drift(y, gG, 1), GEN.grip.lo, GEN.grip.hi));
      const gripL = r05(clamp(gripR + gauss() * 1.6, GEN.grip.lo, GEN.grip.hi));
      const gT = GEN.tug[sex];
      const tug = r1(clamp(gT[0] + gT[1] * (age - 75) - drift(y, gT, 1), GEN.tug.lo, GEN.tug.hi));
      const height = r1(heightBase - (y === CUR ? 0 : (CUR - y) * 0.1));
      const weight = r1(weightBase + gauss() * 1.2);
      const bmi = r1(weight / Math.pow(height / 100, 2));
      const values = { walk5, walk5max, balR, balL, gripR, gripL, tug, height, weight, bmi };
      const ax = axesOf(sex, values);
      const total = Math.round(((ax.walk + ax.balance + ax.grip + ax.mobility + ax.body) / 25) * 100);
      u.meas[y] = { values, axes: ax, total, date: DATES[code][y] };
    });
    users.push(u);
  }
});
// 新規参加者(令和7年度途中登録・未測定)
const newJoiners = users.filter(u => u.joined === CUR);
newJoiners.slice(0, Math.floor(newJoiners.length * 0.4)).forEach(u => { delete u.meas[CUR]; u.isNew = true; });

// ---- OCR 取り込みバッチ(桜川市 令和7年度 未取込分) --------------------------------
const pool = users.filter(u => u.muni === 'sakuragawa' && !u.meas[CUR] && u.joined <= CUR && !u.isNew);
const others = users.filter(u => u.muni !== 'sakuragawa' && !u.meas[CUR] && u.joined <= CUR && !u.isNew);
const batchUsers = pool.concat(others).slice(0, 48);
function genValues(u, y) {
  const age = y - u.birth;
  const gW = GEN.walk5[u.sex], gB = GEN.bal[u.sex], gG = GEN.grip[u.sex], gT = GEN.tug[u.sex];
  const d = (p, sign) => sign * u.theta * p[2] * 0.82 + gauss() * p[2] * 0.17;
  const walk5 = r1(clamp(gW[0] + gW[1] * (age - 75) - d(gW, 1), GEN.walk5.lo, GEN.walk5.hi));
  const walk5max = r1(clamp(walk5 * clamp(0.85 - u.theta * 0.02, 0.72, 0.92), 0.4, GEN.walk5.hi));
  const balR = r1(clamp(gB[0] + gB[1] * (age - 75) + d(gB, 1), 0, 60));
  const balL = r1(clamp(balR + gauss() * 5, 0, 60));
  const gripR = r05(clamp(gG[0] + gG[1] * (age - 75) + d(gG, 1), GEN.grip.lo, GEN.grip.hi));
  const gripL = r05(clamp(gripR + gauss() * 1.6, GEN.grip.lo, GEN.grip.hi));
  const tug = r1(clamp(gT[0] + gT[1] * (age - 75) - d(gT, 1), GEN.tug.lo, GEN.tug.hi));
  const height = r1((u.sex === 'M' ? GEN.height.M : GEN.height.F) + gauss() * GEN.height.sd - (age - 75) * 0.12);
  const weight = r1(GEN.weight[u.sex][0] + gauss() * GEN.weight[u.sex][1]);
  return { walk5, walk5max, balR, balL, gripR, gripL, tug, height, weight, bmi: r1(weight / Math.pow(height / 100, 2)) };
}
// 記録用紙の掲載順(様式 R7-02)
export const SHEET_COLS = ['height', 'weight', 'gripR', 'gripL', 'walk5', 'walk5max', 'tug', 'balR', 'balL'];
export const sheets = batchUsers.map((u, i) => {
  const values = genValues(u, CUR);
  const fields = {};
  SHEET_COLS.forEach(cid => {
    const col = COLS.find(c => c.id === cid);
    fields[cid] = { value: values[cid], raw: fmt(values[cid], col.dec), conf: 86 + Math.floor(R() * 14) };
  });
  return { no: i + 1, userId: u.id, ocrName: u.name, ocrKana: u.kana, nameConf: 91 + Math.floor(R() * 9), fields, flags: [] };
});
function flag(no, f) { if (sheets[no - 1]) sheets[no - 1].flags.push(f); }
if (sheets[3]) {
  const u = users.find(x => x.id === sheets[3].userId);
  sheets[3].ocrName = u.name.length > 2 ? u.name.slice(0, -1) + '?' : u.name;
  sheets[3].nameConf = 57;
  flag(4, { type: 'name', message: '氏名の照合結果が一致しません。台帳から本人を選択してください。' });
}
if (sheets[8]) {
  const v = sheets[8].fields.gripR.value;
  sheets[8].fields.gripR.conf = 41;
  sheets[8].fields.gripR.raw = String(fmt(v, 1)).replace(/\d(?=\.)/, '?');
  flag(9, { type: 'digit', field: 'gripR', message: '数字の読み取り信頼度が低い項目があります。', candidates: [fmt(v, 1), fmt(v - 6, 1)] });
}
if (sheets[12]) {
  const u = users.find(x => x.id === sheets[12].userId);
  const last = u && u.meas[2024] ? u.meas[2024].values.tug : 6.8;
  sheets[12].fields.tug.value = r1(last * 10);
  sheets[12].fields.tug.raw = fmt(last * 10, 0);
  sheets[12].fields.tug.conf = 93;
  flag(13, { type: 'range', field: 'tug', message: '前回値から大きく乖離しています。小数点の読み落としの可能性があります。', suggest: fmt(last, 1) });
}
if (sheets[16]) {
  const v = sheets[16].fields.gripL.value;
  sheets[16].fields.gripL.conf = 52;
  sheets[16].fields.gripL.raw = String(Math.floor(v)) + '?';
  flag(17, { type: 'digit', field: 'gripL', message: '数字の読み取り信頼度が低い項目があります。', candidates: [fmt(v, 1), fmt(v + 1, 1)] });
}
if (sheets[20]) {
  sheets[20].fields.balL.raw = '';
  sheets[20].fields.balL.conf = 0;
  flag(21, { type: 'blank', field: 'balL', message: '記入が検出できませんでした。欠測とするか、値を入力してください。' });
}
export const batchMeta = { muni: 'sakuragawa', muniName: '桜川市', venue: '桜川市民体育館', date: '2025/09/24', year: CUR };

// ---- 登録(コミット) --------------------------------------------------------------
export function commitSheet(sheet, finalValues) {
  const u = users.find(x => x.id === sheet.userId);
  if (!u) return;
  const v = {};
  SHEET_COLS.forEach(cid => {
    const raw = finalValues[cid];
    v[cid] = (raw === null || raw === undefined || raw === '') ? null : Math.round(parseFloat(raw) * 10) / 10;
  });
  if (v.balR === null && v.balL !== null) v.balR = v.balL;
  if (v.balL === null && v.balR !== null) v.balL = v.balR;
  if (v.gripR === null && v.gripL !== null) v.gripR = v.gripL;
  if (v.gripL === null && v.gripR !== null) v.gripL = v.gripR;
  v.bmi = (v.height && v.weight) ? r1(v.weight / Math.pow(v.height / 100, 2)) : null;
  const ax = axesOf(u.sex, v);
  const total = Math.round(((ax.walk + ax.balance + ax.grip + ax.mobility + ax.body) / 25) * 100);
  u.meas[CUR] = { values: v, axes: ax, total, date: batchMeta.date };
  ensureKcl(u, CUR, batchMeta.date);
  delete u.isNew;
}

// 測定を登録した年に問診回答が未登録なら、ダミーの問診回答も併せて作成する
// (OCR 本登録・CSV 取り込みなど、一括生成後に測定が増える経路すべてから呼ぶ)
export function ensureKcl(u, y, date) {
  if (!u.kcl) u.kcl = {};
  if (!u.kcl[y]) u.kcl[y] = makeDummyKcl(R, gauss, y - u.birth, u.theta, date);
}

// 新規利用者の参加者 ID 採番。会場コード×1000 + 901〜 の空き番号を返す(既存 ID と衝突しない)
export function newUserId(code) {
  let seq = users.filter(u => u.venueCode === code).length + 901;
  let id = String(code * 1000 + seq).padStart(5, '0');
  while (users.some(u => u.id === id)) { seq++; id = String(code * 1000 + seq).padStart(5, '0'); }
  return id;
}

// ---- 集計 -------------------------------------------------------------------------
export function agg(filterFn, year) {
  const rows = users.filter(u => filterFn(u) && u.meas[year]);
  const out = { count: rows.length, total: 0, axes: {}, cols: {} };
  AXES.forEach(a => { out.axes[a.id] = 0; });
  COLS.forEach(c => { out.cols[c.id] = { sum: 0, n: 0 }; });
  let tSum = 0;
  rows.forEach(u => {
    const m = u.meas[year];
    tSum += m.total;
    AXES.forEach(a => { out.axes[a.id] += m.axes[a.id]; });
    COLS.forEach(c => {
      const v = m.values[c.id];
      if (v !== null && v !== undefined) { out.cols[c.id].sum += v; out.cols[c.id].n++; }
    });
  });
  if (rows.length) {
    out.total = Math.round((tSum / rows.length) * 10) / 10;
    AXES.forEach(a => { out.axes[a.id] = Math.round((out.axes[a.id] / rows.length) * 100) / 100; });
  }
  COLS.forEach(c => {
    const o = out.cols[c.id];
    out.cols[c.id] = o.n ? Math.round((o.sum / o.n) * 10) / 10 : null;
  });
  return out;
}

// ---- InBody(体組成) データ ---------------------------------------------------
// 測定年の約 75% に InBody 測定があるものとして生成する（LookinBody CSV 取り込み相当）
users.forEach(u => {
  u.inbody = {};
  YEARS.forEach(y => {
    const m = u.meas[y];
    if (!m || R() < 0.25) return;
    const age = y - u.birth;
    const v = m.values;
    const smm = r1(clamp((u.sex === 'M' ? v.weight * 0.42 : v.weight * 0.34) + gauss() * 1.6 - (age - 75) * 0.06, 10, 40));
    const fatPct = r1(clamp((u.sex === 'M' ? 23 : 30) + gauss() * 5 + ((v.bmi || 22) - 22) * 1.1, 8, 45));
    const smi = r1(clamp((u.sex === 'M' ? 7.3 : 6.0) + gauss() * 0.7 - (age - 75) * 0.025 + u.theta * 0.25, 4.2, 9.5));
    const score = Math.round(clamp(72 + u.theta * 6 + gauss() * 5 - (age - 75) * 0.25, 45, 95));
    u.inbody[y] = { weight: v.weight, smm, fatPct, smi, score, date: m.date };
  });
});

// ---- 基本チェックリスト（問診票）ダミー回答 ------------------------------------
// 測定がある年に問診回答があるものとして、年齢・体力傾向(theta)に相関する回答を生成する。
users.forEach(u => {
  u.kcl = {};
  YEARS.forEach(y => {
    const m = u.meas[y];
    if (!m) return;
    u.kcl[y] = makeDummyKcl(R, gauss, y - u.birth, u.theta, m.date);
  });
});

// ---- 実データ差し込みフック --------------------------------------------------
// Firestore 等から読み込んだ利用者で、シードの users を丸ごと置き換える。
// 既存画面は D.users / D.MUNIS を読むだけなので、中身を差し替えれば実データ表示になる。
export function setUsers(list) {
  users.length = 0;
  list.forEach(u => users.push(u));
}
// 実データの市町村（例: 嘉島町）で、市町村・圏域の選択肢を置き換える。
// シードの市町村を残さないことで、フィルタに空の架空市町村が並ぶのを防ぐ。
export function replaceMunis(list) {
  MUNIS.length = 0;
  list.forEach(m => MUNIS.push(m));
  const regions = [...new Set(list.map(m => m.region).filter(Boolean))];
  REGIONS.length = 0;
  regions.forEach(r => REGIONS.push(r));
}

const D = { REGIONS, MUNIS, YEARS, CUR, ERA, TODAY, COLS, AXES, SHEET_COLS, STAFF, users, sheets, batchMeta, DATES, fmt, agg, commitSheet, axesOf, ensureKcl, newUserId, setUsers, replaceMunis };
export default D;
