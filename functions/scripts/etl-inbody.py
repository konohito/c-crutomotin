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

# InBody ヘッダーの通し番号 → 取り出したい項目
COL = {1: 'id', 2: 'height', 3: 'gender', 4: 'age', 5: 'testDate', 6: 'weight',
       27: 'smm', 30: 'bmi', 33: 'fatPct', 46: 'score', 80: 'smi'}
XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


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
    header_i, num2col = -1, {}
    for i, row in enumerate(rows[:8]):
        m = {}
        for ci, cell in enumerate(row):
            mm = re.match(r'^\s*(\d+)\.', str(cell or ''))
            if mm:
                m[int(mm.group(1))] = ci
        if len(m) >= 8:
            header_i, num2col = i, m
            break
    if header_i < 0:
        return []

    district_col = 0
    if 1 in num2col and num2col[1] > 0:
        district_col = num2col[1] - 1

    out = []
    for row in rows[header_i + 1:]:
        idc = num2col.get(1)
        idv = str(row[idc]).strip() if idc is not None and idc < len(row) and row[idc] is not None else ''
        if not idv or re.match(r'^\s*\d+\.', idv) or idv in ('ID', '1. ID'):
            continue
        rec = {'district': (str(row[district_col]).strip() if district_col < len(row) and row[district_col] else '')}
        for num, key in COL.items():
            ci = num2col.get(num)
            rec[key] = row[ci] if (ci is not None and ci < len(row)) else None
        h, w = to_float(rec['height']), to_float(rec['weight'])
        if h is None or w is None:
            continue
        year, date = parse_year_date(rec['testDate'])
        if not year:
            continue
        out.append({
            'ibId': str(rec['id']).strip(), 'district': rec['district'],
            'sex': (str(rec['gender']).strip().upper()[:1] or ''),
            'age': to_float(rec['age']), 'height': h, 'weight': w,
            'year': year, 'testDate': date,
            'smm': to_float(rec['smm']), 'smi': to_float(rec['smi']),
            'fatPct': to_float(rec['fatPct']), 'score': to_float(rec['score']),
        })
    return out


# ---- Firestore --------------------------------------------------------------
def load_firestore(db):
    users = {}
    for d in db.collection('users').stream():
        u = d.to_dict()
        users[d.id] = {'sex': (u.get('sex') or 'F'),
                       'ward': (u.get('ward') or u.get('venueName') or ''),
                       'birth': u.get('birth')}
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


def match(ib, users, meas_by_year):
    cands = []
    for m in meas_by_year.get(ib['year'], []):
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
    # 同じ測定が xlsx/csv 重複で入るのを除く（機械ID優先、無ければ年+地区+身長+体重+性別）
    seen, uniq = set(), []
    for ib in rows:
        key = ib['ibId'] or f"{ib['year']}|{ib['district']}|{round(ib['height'])}|{round(ib['weight'])}|{ib['sex']}"
        if key in seen:
            continue
        seen.add(key)
        uniq.append(ib)
    rows = uniq
    print(f'InBody 合計 {len(rows)} 行（重複除去後）')

    db = firestore.Client(project=args.project, credentials=creds)
    users, meas_by_year = load_firestore(db)
    print(f'台帳: 利用者 {len(users)} 名 / 測定 {sum(len(v) for v in meas_by_year.values())} 件')

    # 年度別 availability（InBody行 / 台帳測定 / うち身長体重あり）— 突合率の当たりをつける
    from collections import Counter
    ib_year = Counter(ib['year'] for ib in rows)
    print('\n年度別  InBody行 / 台帳測定 / うち身長体重あり:')
    for y in sorted(set(list(ib_year.keys()) + list(meas_by_year.keys()))):
        mm = meas_by_year.get(y, [])
        hw = sum(1 for m in mm if m['height'] is not None and m['weight'] is not None)
        print(f'  {y}: {ib_year.get(y, 0)} / {len(mm)} / {hw}')

    stats = {'unique': 0, 'date': 0, 'district': 0, 'age': 0, 'narrowed': 0, 'ambiguous': 0, 'none': 0}
    none_tol = none_missing = 0  # 未一致の内訳: 許容差外 / その年の身長体重データ無し
    unmatched, writes = [], 0
    batch, n_in_batch = db.batch(), 0
    for ib in rows:
        m, how = match(ib, users, meas_by_year)
        stats[how] += 1
        if how == 'none':
            same = [x for x in meas_by_year.get(ib['year'], [])
                    if x['height'] is not None and x['weight'] is not None
                    and (not ib['sex'] or users.get(x['userId'], {}).get('sex') != ('M' if ib['sex'] == 'F' else 'F'))]
            if same:
                none_tol += 1
            else:
                none_missing += 1
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

    matched = stats['unique'] + stats['date'] + stats['district'] + stats['age'] + stats['narrowed']
    print('\n=== 突合結果 ===')
    print(f'  一意       : {stats["unique"]}')
    print(f'  測定日で確定: {stats["date"]}')
    print(f'  地区で確定 : {stats["district"]}')
    print(f'  年齢で確定 : {stats["age"]}')
    print(f'  絞込で確定 : {stats["narrowed"]}')
    print(f'  曖昧(保留) : {stats["ambiguous"]}')
    print(f'  未一致     : {stats["none"]}（うち 許容差外 {none_tol} / その年に身長体重データ無し {none_missing}）')
    print(f'  → 突合 {matched} / {len(rows)} 件' + (f'（{writes} 件書き込み）' if args.commit else '（ドライラン・未書込）'))

    if unmatched:
        out = os.path.join(args.dir or '.', 'inbody-unmatched.csv')
        with open(out, 'w', newline='', encoding='utf-8-sig') as fp:
            w = csv.writer(fp)
            w.writerow(['ibId', 'district', 'sex', 'age', 'height', 'weight', 'year', 'testDate'])
            for ib in unmatched:
                w.writerow([ib['ibId'], ib['district'], ib['sex'], ib['age'], ib['height'], ib['weight'], ib['year'], ib['testDate']])
        print(f'  未突合/曖昧 {len(unmatched)} 行 → {out}')
    if not args.commit:
        print('\n※ ドライランです。結果を確認し、問題なければ --commit を付けて再実行してください。')


if __name__ == '__main__':
    main()
