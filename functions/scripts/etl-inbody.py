#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""InBody(LookinBody Excel)データを台帳の測定に突合して Firestore へ取り込む ETL。

InBody の書き出しには氏名・参加者IDが無いため、以下のキーで記録用紙側の測定に突合する:
    測定年(テスト日の年) + 性別 + 身長(±HEIGHT_TOL) + 体重(±WEIGHT_TOL)
複数候補があるときは 地区(行政区) → 年齢 → 身長体重の近さ の順で一意化する。

突合できた測定ドキュメント measurements/* に `inbody` を merge 保存する:
    inbody = { smm, smi, fatPct, score, height, weight, ibId, district, testDate, source }

ファイルは Google Drive フォルダから自動取得する（ローカルに置く手間なし）。
Drive も Firestore も、利用者のローカルの ADC 認証で読み書きする。

  # 1) ADC に Drive 読み取りスコープを付けて認証（1回だけ）
  gcloud auth application-default login \
      --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/drive.readonly

  # 2) 依存パッケージ
  pip install google-api-python-client google-auth google-cloud-firestore openpyxl

  # 3) ドライラン（Drive から取得 → 突合、書き込みなし）
  python etl-inbody.py --project cruto-motion

  # 4) 問題なければ書き込み
  python etl-inbody.py --project cruto-motion --commit

Drive を使わずローカルの xlsx で回したい場合は  --dir ./inbody  を指定する。
ドライランは Firestore を一切書き換えない。まず突合率を確認してから --commit すること。
"""
import argparse
import csv
import glob
import io
import os
import re
import sys
import tempfile

# InBody データが入っている Drive フォルダ
DEFAULT_FOLDER_ID = '111fACqvpnuz3mn2Et10ru28zTFf5NB8R'
SCOPES = ['https://www.googleapis.com/auth/cloud-platform',
          'https://www.googleapis.com/auth/drive.readonly']

HEIGHT_TOL = 2.0   # cm
WEIGHT_TOL = 1.5   # kg

XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
# テスト用の見本データ行（機器の動作確認）は取り込まない
SKIP_IDS = {'cruto1', 'otamesi', '0000000888', '00001'}
SKIP_NAMES = {'otamesi', 'test', 'テスト', 'サンプル'}


def _norm_header(cell):
    return re.sub(r'^\s*\d+\.\s*', '', str(cell or '')).strip()


def find_cols(header):
    """ヘッダー行(番号付き)から、列名キーワードで各項目の列位置を特定する。
       LookinBody の書式ごとに列番号が違う（旧: 6.体重/27.骨格筋量、新: 15.体重/36.骨格筋量）ため
       番号ではなく名前で拾う。"""
    cols = {}
    for ci, cell in enumerate(header):
        h = _norm_header(cell)
        hl = h.lower()
        def put(k):
            cols.setdefault(k, ci)
        if hl == 'name' or h in ('氏名', '名前'):
            put('name')
        elif hl == 'id':
            put('id')
        elif ('height' in hl or '身長' in h) and 'limit' not in hl and 'range' not in hl and '標準' not in h:
            put('height')
        elif 'gender' in hl or '性別' in h:
            put('gender')
        elif hl == 'age' or h == '年齢':
            put('age')
        elif 'test date' in hl or '測定日' in h:
            put('testDate')
        elif hl == 'weight' or h == '体重':
            put('weight')
        elif ('skeletal muscle mass' in hl or '骨格筋量' in h) and 'limit' not in hl and 'range' not in hl and '/wt' not in hl:
            put('smm')
        elif 'skeletal muscle index' in hl or '骨格筋指数' in h or hl == 'smi':
            put('smi')
        elif ('percent body fat' in hl or '体脂肪率' in h or hl == 'pbf') and 'limit' not in hl and 'range' not in hl:
            put('fatPct')
        elif 'inbody score' in hl or 'inbody 点数' in h or h == '点数':
            put('score')
    return cols


def to_float(v):
    if v is None:
        return None
    try:
        s = str(v).strip().replace(',', '')
        if s in ('', '-'):
            return None
        return float(s)
    except (ValueError, TypeError):
        return None


def parse_year_date(raw):
    """'2023.09.11 15:06:10' -> (2023, '2023/09/11')"""
    m = re.search(r'(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})', str(raw or ''))
    if not m:
        return None, None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return y, f'{y}/{mo:02d}/{d:02d}'


# ---- Drive 取得 -------------------------------------------------------------
def fetch_from_drive(folder_id, creds):
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    drive = build('drive', 'v3', credentials=creds, cache_discovery=False)
    res = drive.files().list(
        q=f"'{folder_id}' in parents and trashed=false",
        fields='files(id,name,mimeType,shortcutDetails)', pageSize=1000).execute()
    tmp = tempfile.mkdtemp(prefix='inbody_')
    paths = []
    for f in res.get('files', []):
        fid, name, mime = f['id'], f['name'], f['mimeType']
        if mime == 'application/vnd.google-apps.shortcut':
            sd = f.get('shortcutDetails') or {}
            fid = sd.get('targetId') or fid
            mime = sd.get('targetMimeType') or XLSX_MIME
        if 'spreadsheet' not in mime and not name.lower().endswith('.xlsx'):
            continue
        if not name.lower().endswith('.xlsx'):
            name += '.xlsx'
        req = (drive.files().export_media(fileId=fid, mimeType=XLSX_MIME)
               if mime == 'application/vnd.google-apps.spreadsheet'
               else drive.files().get_media(fileId=fid))
        buf = io.BytesIO()
        dl = MediaIoBaseDownload(buf, req)
        done = False
        while not done:
            _, done = dl.next_chunk()
        path = os.path.join(tmp, re.sub(r'[\\/]', '_', name))
        with open(path, 'wb') as fp:
            fp.write(buf.getvalue())
        paths.append(path)
    return paths


# ---- xlsx / csv 解析 --------------------------------------------------------
def _has_numbered_header(rows):
    for row in rows[:10]:
        if sum(1 for c in row if re.match(r'^\s*\d+\.', str(c or ''))) >= 8:
            return True
    return False


def read_rows(path):
    """xlsx でも csv でも行(list of list)を返す。xlsx は番号ヘッダーのあるシートを選ぶ。"""
    if path.lower().endswith('.csv'):
        import csv as _csv
        with open(path, newline='', encoding='utf-8-sig') as fp:
            return [list(r) for r in _csv.reader(fp)]
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    best = []
    for ws in wb.worksheets:
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        if _has_numbered_header(rows):
            wb.close()
            return rows
        if len(rows) > len(best):
            best = rows
    wb.close()
    return best


def parse_rows(rows):
    """番号付きヘッダー行を探し、列名キーワードで列位置を特定してデータ行を取り出す。
       旧書式(令和4/5: 地区+機械ID)と新書式(2024/2025: 氏名+台帳ID)の両方に対応。"""
    header_i, cols = -1, {}
    for i, row in enumerate(rows[:10]):
        n_numbered = sum(1 for c in row if re.match(r'^\s*\d+\.', str(c or '')))
        if n_numbered >= 8:
            c = find_cols(row)
            # 必須列が揃うヘッダーのみ採用（血圧など別表のヘッダーを除外）
            if all(k in c for k in ('height', 'weight', 'testDate')):
                header_i, cols = i, c
                break
    if header_i < 0:
        return []

    # 旧書式は "1. ID" の左隣の無名列が地区(行政区)
    district_col = None
    if 'name' not in cols and cols.get('id', 0) > 0:
        district_col = cols['id'] - 1

    out = []
    for row in rows[header_i + 1:]:
        def val(k):
            ci = cols.get(k)
            return row[ci] if (ci is not None and ci < len(row)) else None
        idv = str(val('id') or '').strip()
        name = re.sub(r'[\s　]+', '', str(val('name') or '').strip())
        if not idv and not name:
            continue
        if re.match(r'^\s*\d+\.', idv):  # 2段目(日本語)ヘッダー行
            continue
        # 機器テスト用の見本行は除外
        if idv in SKIP_IDS or name.lower() in SKIP_NAMES:
            continue
        h, w = to_float(val('height')), to_float(val('weight'))
        if h is None or w is None:
            continue
        year, date = parse_year_date(val('testDate'))
        if not year:
            continue
        district = ''
        if district_col is not None and district_col < len(row) and row[district_col]:
            district = str(row[district_col]).strip()
        # 台帳の参加者ID形式(5桁数字)なら rosterId として直接突合に使う
        digits = re.sub(r'\D', '', idv)
        roster_id = digits.zfill(5) if idv and 4 <= len(digits) <= 5 and not idv.startswith('<') else None
        out.append({
            'ibId': idv, 'rosterId': roster_id, 'name': name, 'district': district,
            'sex': (str(val('gender') or '').strip().upper()[:1] or ''),
            'age': to_float(val('age')), 'height': h, 'weight': w,
            'year': year, 'testDate': date,
            'smm': to_float(val('smm')), 'smi': to_float(val('smi')),
            'fatPct': to_float(val('fatPct')), 'score': to_float(val('score')),
        })
    return out


# ---- Firestore --------------------------------------------------------------
def load_firestore(db):
    users = {}
    for d in db.collection('users').stream():
        u = d.to_dict()
        users[d.id] = {'sex': (u.get('sex') or 'F'),
                       'ward': (u.get('ward') or u.get('venueName') or ''),
                       'birth': u.get('birth'),
                       'name': re.sub(r'[\s　]+', '', str(u.get('name') or ''))}
    meas_by_year = {}
    for d in db.collection('measurements').stream():
        m = d.to_dict()
        uid, year = m.get('userId'), m.get('year')
        if uid is None or year is None:
            continue
        vals = m.get('values') or {}
        meas_by_year.setdefault(int(year), []).append({
            'ref': d.reference, 'userId': uid, 'date': m.get('date'),
            'height': to_float(vals.get('height')), 'weight': to_float(vals.get('weight')),
        })
    return users, meas_by_year


def match(ib, users, meas_by_year, name_index):
    year_meas = meas_by_year.get(ib['year'], [])
    # 1) 台帳ID直結（2024/2025 書式は InBody 側に参加者IDがある）
    if ib.get('rosterId') and ib['rosterId'] in users:
        bym = [m for m in year_meas if m['userId'] == ib['rosterId']]
        if len(bym) == 1:
            return bym[0], 'id'
    # 2) 氏名一致（空白除去済み）。同姓同名がいなければ確定
    if ib.get('name') and name_index.get(ib['name']) and len(name_index[ib['name']]) == 1:
        uid = name_index[ib['name']][0]
        bym = [m for m in year_meas if m['userId'] == uid]
        if len(bym) == 1:
            return bym[0], 'name'
    # 3) 身体属性（旧書式: 性別+身長+体重）
    cands = []
    for m in year_meas:
        u = users.get(m['userId'])
        if not u or m['height'] is None or m['weight'] is None:
            continue
        if ib['sex'] and u['sex'] and u['sex'] != ib['sex']:
            continue
        if abs(m['height'] - ib['height']) <= HEIGHT_TOL and abs(m['weight'] - ib['weight']) <= WEIGHT_TOL:
            cands.append(m)
    if not cands:
        return None, 'none'
    if len(cands) == 1:
        return cands[0], 'unique'
    # 測定日が一致すれば最優先で確定
    if ib['testDate']:
        byd = [m for m in cands if m.get('date') == ib['testDate']]
        if len(byd) == 1:
            return byd[0], 'date'
        if byd:
            cands = byd
    if ib['district']:
        bw = [m for m in cands if users[m['userId']]['ward'] == ib['district']]
        if len(bw) == 1:
            return bw[0], 'district'
        if bw:
            cands = bw
    if ib['age']:
        bya = [m for m in cands if users[m['userId']]['birth'] and abs((ib['year'] - users[m['userId']]['birth']) - ib['age']) <= 1]
        if len(bya) == 1:
            return bya[0], 'age'
        if bya:
            cands = bya
    if len(cands) == 1:
        return cands[0], 'narrowed'
    cands.sort(key=lambda m: abs(m['height'] - ib['height']) + abs(m['weight'] - ib['weight']))
    return cands[0], 'ambiguous'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--project', default='cruto-motion')
    ap.add_argument('--folder', default=DEFAULT_FOLDER_ID, help='InBody の Drive フォルダ ID')
    ap.add_argument('--dir', help='Drive を使わずローカルの xlsx フォルダから読む')
    ap.add_argument('--commit', action='store_true', help='実際に Firestore へ書き込む')
    args = ap.parse_args()

    import google.auth
    from google.cloud import firestore
    creds, _ = google.auth.default(scopes=SCOPES)

    if args.dir:
        files = sorted(glob.glob(os.path.join(args.dir, '*.xlsx')) + glob.glob(os.path.join(args.dir, '*.csv')))
        # ETL 出力の未突合CSVは取り込まない
        files = [f for f in files if not f.endswith('inbody-unmatched.csv')]
        print(f'ローカル {len(files)} ファイルを読み込みます')
    else:
        print(f'Drive フォルダ {args.folder} から取得中…')
        files = fetch_from_drive(args.folder, creds)
    if not files:
        print('InBody ファイルが見つかりませんでした')
        sys.exit(1)

    rows = []
    for f in files:
        try:
            r = parse_rows(read_rows(f))
        except Exception as e:  # noqa: BLE001
            print(f'  {os.path.basename(f)}: 読み込み失敗（{e}）— スキップ')
            continue
        print(f'  {os.path.basename(f)}: {len(r)} 行')
        rows += r
    # 同じ測定が xlsx/csv 重複で入るのを除く。同一人物でも年度が違えば別測定なので年を含める。
    seen, uniq = set(), []
    for ib in rows:
        key = (f"{ib['ibId']}|{ib['year']}" if ib['ibId']
               else f"{ib['year']}|{ib['district']}|{round(ib['height'])}|{round(ib['weight'])}|{ib['sex']}")
        if key in seen:
            continue
        seen.add(key)
        uniq.append(ib)
    rows = uniq
    print(f'InBody 合計 {len(rows)} 行（重複除去後）')

    db = firestore.Client(project=args.project, credentials=creds)
    users, meas_by_year = load_firestore(db)
    print(f'台帳: 利用者 {len(users)} 名 / 測定 {sum(len(v) for v in meas_by_year.values())} 件')
    # 氏名（空白除去）→ userId 一覧。同姓同名は一意にならないため一覧で持つ
    name_index = {}
    for uid, u in users.items():
        if u['name']:
            name_index.setdefault(u['name'], []).append(uid)

    # 年度別 availability（InBody行 / 台帳測定 / うち身長体重あり）— 突合率の当たりをつける
    from collections import Counter
    ib_year = Counter(ib['year'] for ib in rows)
    print('\n年度別  InBody行 / 台帳測定 / うち身長体重あり:')
    for y in sorted(set(list(ib_year.keys()) + list(meas_by_year.keys()))):
        mm = meas_by_year.get(y, [])
        hw = sum(1 for m in mm if m['height'] is not None and m['weight'] is not None)
        print(f'  {y}: {ib_year.get(y, 0)} / {len(mm)} / {hw}')

    stats = {'id': 0, 'name': 0, 'unique': 0, 'date': 0, 'district': 0, 'age': 0, 'narrowed': 0, 'ambiguous': 0, 'none': 0}
    no_meas = 0  # ID/氏名で本人特定できたが、その年の測定ドキュメントが無い
    unmatched, writes = [], 0
    batch, n_in_batch = db.batch(), 0
    for ib in rows:
        m, how = match(ib, users, meas_by_year, name_index)
        stats[how] += 1
        if how == 'none':
            known = (ib.get('rosterId') in users) or (ib.get('name') and len(name_index.get(ib['name'], [])) == 1)
            if known:
                no_meas += 1
        if m and how != 'ambiguous':
            payload = {'inbody': {k: ib[k] for k in ('smm', 'smi', 'fatPct', 'score', 'height', 'weight', 'ibId', 'district', 'testDate')}}
            payload['inbody']['source'] = 'lookinbody'
            if args.commit:
                batch.set(m['ref'], payload, merge=True)
                n_in_batch += 1
                writes += 1
                if n_in_batch >= 400:
                    batch.commit(); batch, n_in_batch = db.batch(), 0
        else:
            unmatched.append(ib)
    if args.commit and n_in_batch:
        batch.commit()

    matched = stats['id'] + stats['name'] + stats['unique'] + stats['date'] + stats['district'] + stats['age'] + stats['narrowed']
    print('\n=== 突合結果 ===')
    print(f'  台帳IDで確定: {stats["id"]}')
    print(f'  氏名で確定  : {stats["name"]}')
    print(f'  一意        : {stats["unique"]}')
    print(f'  測定日で確定: {stats["date"]}')
    print(f'  地区で確定  : {stats["district"]}')
    print(f'  年齢で確定  : {stats["age"]}')
    print(f'  絞込で確定  : {stats["narrowed"]}')
    print(f'  曖昧(保留)  : {stats["ambiguous"]}')
    print(f'  未一致      : {stats["none"]}（うち 本人特定済だが該当年の測定なし {no_meas}）')
    print(f'  → 突合 {matched} / {len(rows)} 件' + (f'（{writes} 件書き込み）' if args.commit else '（ドライラン・未書込）'))

    if unmatched:
        out = os.path.join(args.dir or '.', 'inbody-unmatched.csv')
        with open(out, 'w', newline='', encoding='utf-8-sig') as fp:
            w = csv.writer(fp)
            w.writerow(['ibId', 'rosterId', 'name', 'district', 'sex', 'age', 'height', 'weight', 'year', 'testDate'])
            for ib in unmatched:
                w.writerow([ib['ibId'], ib.get('rosterId') or '', ib.get('name') or '', ib['district'],
                            ib['sex'], ib['age'], ib['height'], ib['weight'], ib['year'], ib['testDate']])
        print(f'  未突合/曖昧 {len(unmatched)} 行 → {out}')
    if not args.commit:
        print('\n※ ドライランです。結果を確認し、問題なければ --commit を付けて再実行してください。')


if __name__ == '__main__':
    main()
