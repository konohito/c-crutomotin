#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""InBody(LookinBody Excel)データを台帳の測定に突合して Firestore へ取り込む ETL。

InBody の書き出しには氏名・参加者IDが無いため、以下のキーで記録用紙側の測定に突合する:
    測定年(テスト日の年) + 性別 + 身長(±HEIGHT_TOL) + 体重(±WEIGHT_TOL)
複数候補があるときは 地区(行政区) → 年齢 → 身長体重の近さ の順で一意化する。

突合できた測定ドキュメント measurements/* に `inbody` を merge 保存する:
    inbody = { smm, smi, fatPct, score, weight, height, ibId, district, testDate, source }

使い方（利用者のローカルで、gcloud ADC 認証済みの状態で実行）:
    pip install google-cloud-firestore openpyxl
    gcloud auth application-default login          # 済んでいれば不要
    # Drive から4年度分の xlsx を ./inbody/ に保存してから:
    python etl-inbody.py --dir ./inbody --project cruto-motion            # ドライラン（書き込まない）
    python etl-inbody.py --dir ./inbody --project cruto-motion --commit   # 実際に書き込む

ドライランでは突合結果の件数と、未突合・曖昧だった行を inbody-unmatched.csv に出力する。
まずドライランで突合率を確認してから --commit してください。
"""
import argparse
import csv
import glob
import os
import re
import sys

HEIGHT_TOL = 2.0   # cm
WEIGHT_TOL = 1.5   # kg

# InBody ヘッダーの通し番号 → 取り出したい項目
COL = {1: 'id', 2: 'height', 3: 'gender', 4: 'age', 5: 'testDate', 6: 'weight',
       27: 'smm', 30: 'bmi', 33: 'fatPct', 46: 'score', 80: 'smi'}


def to_float(v):
    if v is None:
        return None
    try:
        s = str(v).strip().replace(',', '')
        if s == '' or s == '-':
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


def read_inbody_rows(path):
    """1つの xlsx から InBody 行を読む。番号付きヘッダー行を探して列位置を特定する。"""
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    wb.close()

    # ヘッダー行（"N. 名前" のセルが多い行）を探す
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

    district_col = 0  # 先頭列が地区(行政区)。"1. ID" の左。
    if 1 in num2col and num2col[1] > 0:
        district_col = num2col[1] - 1

    out = []
    for row in rows[header_i + 1:]:
        # ヘッダー行(英語/日本語の2段目)や空行を飛ばす
        idc = num2col.get(1)
        idv = str(row[idc]).strip() if idc is not None and idc < len(row) and row[idc] is not None else ''
        if not idv or re.match(r'^\s*\d+\.', idv) or idv in ('ID', '1. ID'):
            continue
        rec = {'district': (str(row[district_col]).strip() if district_col < len(row) and row[district_col] else '')}
        for num, key in COL.items():
            ci = num2col.get(num)
            rec[key] = row[ci] if (ci is not None and ci < len(row)) else None
        h = to_float(rec['height'])
        w = to_float(rec['weight'])
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


def load_firestore(project):
    from google.cloud import firestore
    db = firestore.Client(project=project)
    users = {}
    for d in db.collection('users').stream():
        u = d.to_dict()
        users[d.id] = {
            'sex': (u.get('sex') or 'F'),
            'ward': (u.get('ward') or u.get('venueName') or ''),
            'birth': u.get('birth'),
        }
    meas_by_year = {}
    for d in db.collection('measurements').stream():
        m = d.to_dict()
        uid = m.get('userId')
        year = m.get('year')
        vals = m.get('values') or {}
        h = to_float(vals.get('height'))
        w = to_float(vals.get('weight'))
        if uid is None or year is None:
            continue
        meas_by_year.setdefault(int(year), []).append({
            'ref': d.reference, 'userId': uid, 'height': h, 'weight': w,
            'date': m.get('date'), 'hasInbody': bool(m.get('inbody')),
        })
    return db, users, meas_by_year


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
    if len(cands) == 1:
        return cands[0], 'unique'
    if not cands:
        return None, 'none'
    # 地区で絞る
    if ib['district']:
        byd = [m for m in cands if users[m['userId']]['ward'] and users[m['userId']]['ward'] == ib['district']]
        if len(byd) == 1:
            return byd[0], 'district'
        if byd:
            cands = byd
    # 年齢で絞る
    if ib['age']:
        bya = [m for m in cands if users[m['userId']]['birth'] and abs((ib['year'] - users[m['userId']]['birth']) - ib['age']) <= 1]
        if len(bya) == 1:
            return bya[0], 'age'
        if bya:
            cands = bya
    if len(cands) == 1:
        return cands[0], 'narrowed'
    # 最も身長体重が近いもの。ただし僅差なら曖昧として保留
    cands.sort(key=lambda m: abs(m['height'] - ib['height']) + abs(m['weight'] - ib['weight']))
    return cands[0], 'ambiguous'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True, help='InBody xlsx を置いたフォルダ')
    ap.add_argument('--project', default='cruto-motion')
    ap.add_argument('--commit', action='store_true', help='実際に Firestore へ書き込む')
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.dir, '*.xlsx')))
    if not files:
        print(f'xlsx が見つかりません: {args.dir}')
        sys.exit(1)
    rows = []
    for f in files:
        r = read_inbody_rows(f)
        print(f'  {os.path.basename(f)}: {len(r)} 行')
        rows += r
    print(f'InBody 合計 {len(rows)} 行（{len(files)} ファイル）')

    db, users, meas_by_year = load_firestore(args.project)
    print(f'台帳: 利用者 {len(users)} 名 / 測定 {sum(len(v) for v in meas_by_year.values())} 件')

    stats = {'unique': 0, 'district': 0, 'age': 0, 'narrowed': 0, 'ambiguous': 0, 'none': 0}
    unmatched = []
    writes = 0
    batch, n_in_batch = db.batch(), 0
    for ib in rows:
        m, how = match(ib, users, meas_by_year)
        stats[how] += 1
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

    print('\n=== 突合結果 ===')
    print(f'  一意       : {stats["unique"]}')
    print(f'  地区で確定 : {stats["district"]}')
    print(f'  年齢で確定 : {stats["age"]}')
    print(f'  絞込で確定 : {stats["narrowed"]}')
    print(f'  曖昧(保留) : {stats["ambiguous"]}')
    print(f'  未一致     : {stats["none"]}')
    matched = stats['unique'] + stats['district'] + stats['age'] + stats['narrowed']
    print(f'  → 突合 {matched} / {len(rows)} 件' + (f'（{writes} 件書き込み）' if args.commit else '（ドライラン・未書込）'))

    if unmatched:
        out = os.path.join(args.dir, 'inbody-unmatched.csv')
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
