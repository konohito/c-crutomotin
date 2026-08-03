# 基本チェックリスト過去データの取り込み(2025年度集計用シート → Firestore)
#
# Google スプレッドシートの「2025年度集計用」タブを CSV でダウンロードし、
# 各行の「基本チェックリスト1〜25」(該当=1 / 非該当=0 / 空欄=未回答) を
# measurements/{ID}_{年度} の kclAnswers にマージ保存する。
# アプリ(realdata.js)が kclAnswers → u.kcl[年度].raw に変換し、
# 公式判定基準(kihon.js の kclScore)でそのまま集計される。
#
# 使い方(etl-inbody.py と同じ要領):
#   1. シートをファイル > ダウンロード > CSV で保存(1 行目がヘッダー行になるように)
#   2. GOOGLE_APPLICATION_CREDENTIALS にサービスアカウント鍵を設定
#   3. python3 etl-kcl.py 2025年度集計用.csv --year 2025 [--dry-run]
#
# 変換規則: シートは「該当したら 1」の点数形式。設問ごとに どちらの回答で
# 1 点になるか(pointOn)が決まっているため、1 → pointOn の回答 / 0 → 逆の回答、
# 空欄 → 未回答(保存しない)。No.12(BMI) は測定値からの自動判定のため保存しない。
import argparse, csv, os, sys

# kihon.js の KCL_QUESTIONS と一致させること
POINT_ON = {
    1: 'no', 2: 'no', 3: 'no', 4: 'no', 5: 'no',
    6: 'no', 7: 'no', 8: 'no', 9: 'yes', 10: 'yes',
    11: 'yes', 13: 'yes', 14: 'yes', 15: 'yes',
    16: 'no', 17: 'yes', 18: 'yes', 19: 'no', 20: 'yes',
    21: 'yes', 22: 'yes', 23: 'yes', 24: 'yes', 25: 'yes',
}
FLIP = {'yes': 'no', 'no': 'yes'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('csv_path')
    ap.add_argument('--year', type=int, default=2025)
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    rows = []
    with open(args.csv_path, newline='', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        header = None
        for r in reader:
            # ヘッダー行を自動検出(ID と 基本チェックリスト1 を含む行)
            if header is None:
                if 'ID' in r and any('基本チェックリスト1' == c.strip() for c in r):
                    header = [c.strip() for c in r]
                continue
            rows.append(dict(zip(header, r)))
    if not rows:
        sys.exit('ヘッダー行(ID / 基本チェックリスト1〜)が見つかりません')

    docs = {}
    for row in rows:
        uid = (row.get('ID') or '').strip()
        if not uid or not uid.isdigit():
            continue
        answers = {}
        for no, point_on in POINT_ON.items():
            v = (row.get(f'基本チェックリスト{no}') or '').strip()
            if v in ('0', '1'):
                answers[str(no)] = point_on if v == '1' else FLIP[point_on]
        if answers:
            docs[uid] = answers

    print(f'{len(docs)} 名分の基本チェックリスト回答を検出({args.year} 年度)')
    if args.dry_run:
        for uid, a in list(docs.items())[:5]:
            print(' ', uid, a)
        return

    import firebase_admin
    from firebase_admin import credentials, firestore
    cred = credentials.Certificate(os.environ['GOOGLE_APPLICATION_CREDENTIALS'])
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    n = 0
    for uid, answers in docs.items():
        db.collection('measurements').document(f'{uid}_{args.year}').set(
            {'userId': uid, 'year': args.year, 'kclAnswers': answers}, merge=True)
        n += 1
        if n % 50 == 0:
            print(f'  {n}/{len(docs)}')
    print(f'完了: {n} 件を measurements にマージ保存しました')


if __name__ == '__main__':
    main()
