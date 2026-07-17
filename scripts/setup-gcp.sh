#!/usr/bin/env bash
# =============================================================================
# Cruto motion — GCP / Firebase 本番セットアップ自動化スクリプト
#
# docs/運用者チェックリスト.md の A-1〜A-8・A-10 を対話式で一括実行します。
# あなたの PC(gcloud / firebase にログイン済みの環境)で実行してください:
#
#   bash scripts/setup-gcp.sh
#
# 何度実行しても安全(冪等)です。途中で失敗した場合も、直して再実行すれば
# 済んだステップは自動でスキップされます。
#
# 前提ツール: gcloud CLI / firebase-tools / Node.js 20 / curl / python3
#   gcloud:   https://cloud.google.com/sdk/docs/install
#   firebase: npm install -g firebase-tools
#
# 実行前に一度だけ:
#   gcloud auth login
#   firebase login
# =============================================================================
set -uo pipefail

# ---------- 表示ユーティリティ ----------
BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
step()  { printf '\n%s━━ %s%s\n' "$CYAN$BOLD" "$1" "$RESET"; }
ok()    { printf '%s✔ %s%s\n' "$GREEN" "$1" "$RESET"; }
warn()  { printf '%s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }
fail()  { printf '%s✖ %s%s\n' "$RED" "$1" "$RESET"; }
note()  { printf '%s  %s%s\n' "$DIM" "$1" "$RESET"; }
die()   { fail "$1"; exit 1; }

ask() { # ask <変数名> <質問> [既定値]
  local __var=$1 __q=$2 __def=${3:-} __ans
  if [ -n "$__def" ]; then read -r -p "$__q [$__def]: " __ans; __ans=${__ans:-$__def}
  else read -r -p "$__q: " __ans; fi
  printf -v "$__var" '%s' "$__ans"
}
confirm() { # confirm <質問> → yes なら 0
  local a; read -r -p "$1 (y/N): " a; [[ "$a" =~ ^[yY] ]]
}

# ---------- JSON / REST ユーティリティ ----------
json_get() { # 標準入力の JSON から python 式で値を取り出す(無ければ空)
  python3 -c 'import json,sys
try:
    d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if v is not None else "")
except Exception:
    pass' "$1" 2>/dev/null
}
gapi() { # gapi <METHOD> <URL> [JSON ボディ]
  local m=$1 u=$2 b=${3:-}
  local args=(-sS -X "$m" -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: ${PROJECT}")
  [ -n "$b" ] && args+=(-H "Content-Type: application/json" -d "$b")
  curl "${args[@]}" "$u"
}

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT" || die "リポジトリのルートに移動できませんでした"

printf '%s\n' "${BOLD}Cruto motion — GCP / Firebase 本番セットアップ${RESET}"
note "リポジトリ: $REPO_ROOT"

# =============================================================================
step "0/10 前提ツールの確認"
# =============================================================================
MISSING=0
for c in gcloud curl python3 node npm; do
  if command -v "$c" >/dev/null 2>&1; then ok "$c $(command -v "$c")"
  else fail "$c が見つかりません"; MISSING=1; fi
done
if command -v firebase >/dev/null 2>&1; then ok "firebase $(firebase --version 2>/dev/null | head -1)"
else fail "firebase-tools が見つかりません → npm install -g firebase-tools"; MISSING=1; fi
[ "$MISSING" = 1 ] && die "不足しているツールをインストールしてから再実行してください"

ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1)
[ -n "$ACTIVE_ACCOUNT" ] || die "gcloud が未ログインです → gcloud auth login を実行してください"
ok "gcloud ログイン済み: $ACTIVE_ACCOUNT"
firebase login:list 2>/dev/null | grep -q '@' || die "firebase-tools が未ログインです → firebase login を実行してください"
ok "firebase-tools ログイン済み"

# =============================================================================
step "1/10 GCP プロジェクト(チェックリスト A-1)"
# =============================================================================
DEFAULT_PROJECT=""
if [ -f .firebaserc ]; then
  DEFAULT_PROJECT=$(json_get 'd["projects"]["default"]' < .firebaserc)
  [ "$DEFAULT_PROJECT" = "YOUR_GCP_PROJECT_ID" ] && DEFAULT_PROJECT=""
fi
ask PROJECT "GCP プロジェクト ID" "$DEFAULT_PROJECT"
[ -n "$PROJECT" ] || die "プロジェクト ID は必須です"

if gcloud projects describe "$PROJECT" --format='value(projectId)' >/dev/null 2>&1; then
  ok "プロジェクト $PROJECT を確認しました"
else
  warn "プロジェクト $PROJECT が見つかりません(またはアクセス権がありません)"
  if confirm "新規に作成しますか?"; then
    gcloud projects create "$PROJECT" || die "プロジェクト作成に失敗しました"
    ok "プロジェクトを作成しました"
    warn "課金アカウントの紐付けはコンソールでしかできません:"
    note "https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
    confirm "課金を有効化したら y を押してください" || die "課金を有効化してから再実行してください"
  else
    die "正しいプロジェクト ID で再実行してください"
  fi
fi

BILLING=$(gcloud billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null || true)
if [ "$BILLING" = "True" ]; then ok "課金: 有効"
elif [ "$BILLING" = "False" ]; then
  fail "課金が無効です。Functions / Document AI には課金の有効化が必須です"
  note "https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT"
  confirm "課金を有効化したら y を押してください" || die "課金を有効化してから再実行してください"
else warn "課金状態を確認できませんでした(権限不足の可能性)。有効である前提で続行します"; fi
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

# =============================================================================
step "2/10 API の有効化(A-2)"
# =============================================================================
APIS=(
  documentai.googleapis.com cloudfunctions.googleapis.com cloudbuild.googleapis.com
  run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com
  artifactregistry.googleapis.com firestore.googleapis.com
  firebasestorage.googleapis.com firebase.googleapis.com
  identitytoolkit.googleapis.com cloudresourcemanager.googleapis.com
)
note "有効化: ${APIS[*]}"
gcloud services enable "${APIS[@]}" --project "$PROJECT" || die "API の有効化に失敗しました"
ok "API を有効化しました(反映まで 1〜2 分かかることがあります)"

# =============================================================================
step "3/10 Firebase をプロジェクトに追加"
# =============================================================================
if firebase projects:list 2>/dev/null | grep -q "$PROJECT"; then
  ok "Firebase は追加済みです"
else
  if firebase projects:addfirebase "$PROJECT"; then ok "Firebase を追加しました"
  else
    warn "firebase projects:addfirebase が失敗しました(既に追加済みなら問題ありません)"
    note "未追加の場合: https://console.firebase.google.com/ から $PROJECT を追加してください"
  fi
fi

# =============================================================================
step "4/10 Firestore データベースと Storage バケット"
# =============================================================================
if gcloud firestore databases describe --database='(default)' --project "$PROJECT" >/dev/null 2>&1; then
  ok "Firestore (default) は作成済みです"
else
  note "Firestore を東京リージョン(asia-northeast1)に作成します"
  gcloud firestore databases create --database='(default)' --location=asia-northeast1 \
    --type=firestore-native --project "$PROJECT" || die "Firestore の作成に失敗しました"
  ok "Firestore を作成しました"
fi

STORAGE_BUCKET=""
for b in "${PROJECT}.firebasestorage.app" "${PROJECT}.appspot.com"; do
  if gcloud storage buckets describe "gs://$b" --project "$PROJECT" >/dev/null 2>&1; then STORAGE_BUCKET="$b"; break; fi
done
if [ -n "$STORAGE_BUCKET" ]; then
  ok "既定の Storage バケット: gs://$STORAGE_BUCKET"
else
  note "Firebase Storage の既定バケットを作成します(asia-northeast1)"
  RES=$(gapi POST "https://firebasestorage.googleapis.com/v1beta/projects/${PROJECT}/defaultBucket" \
    '{"location":"asia-northeast1"}')
  BUCKET_NAME=$(printf '%s' "$RES" | json_get 'd["bucket"]["name"]')
  if [ -n "$BUCKET_NAME" ]; then
    STORAGE_BUCKET="${BUCKET_NAME##*/}"
    ok "既定バケットを作成しました: gs://$STORAGE_BUCKET"
  else
    warn "API での作成に失敗しました。Firebase コンソールで Storage を開始してください:"
    note "https://console.firebase.google.com/project/${PROJECT}/storage (「始める」を押すだけ)"
    confirm "Storage を開始したら y を押してください" || die "Storage 開始後に再実行してください"
    STORAGE_BUCKET="${PROJECT}.firebasestorage.app"
  fi
fi

# =============================================================================
step "5/10 Document AI プロセッサ(A-3)"
# =============================================================================
ask DOCAI_LOCATION "Document AI のロケーション(us / eu)" "us"
DOCAI_HOST="https://${DOCAI_LOCATION}-documentai.googleapis.com"
PROCESSOR_NAME="cruto-sheet-parser"

LIST=$(gapi GET "${DOCAI_HOST}/v1/projects/${PROJECT}/locations/${DOCAI_LOCATION}/processors")
PROCESSOR_ID=$(printf '%s' "$LIST" | json_get \
  '[p["name"].split("/")[-1] for p in d.get("processors",[]) if p.get("type")=="FORM_PARSER_PROCESSOR"][0]')
if [ -n "$PROCESSOR_ID" ]; then
  ok "既存の Form Parser プロセッサを使います: $PROCESSOR_ID"
else
  note "Form Parser プロセッサ「$PROCESSOR_NAME」を作成します"
  RES=$(gapi POST "${DOCAI_HOST}/v1/projects/${PROJECT}/locations/${DOCAI_LOCATION}/processors" \
    "{\"displayName\":\"${PROCESSOR_NAME}\",\"type\":\"FORM_PARSER_PROCESSOR\"}")
  PROCESSOR_ID=$(printf '%s' "$RES" | json_get 'd["name"].split("/")[-1]')
  if [ -n "$PROCESSOR_ID" ]; then ok "プロセッサを作成しました: $PROCESSOR_ID"
  else
    fail "プロセッサ作成に失敗しました。レスポンス:"; printf '%s\n' "$RES"
    die "コンソール(https://console.cloud.google.com/ai/document-ai?project=$PROJECT)で作成し、再実行してください"
  fi
fi

# =============================================================================
step "6/10 IAM — Functions 実行 SA に Document AI 権限(A-4)"
# =============================================================================
# Cloud Functions v2(本リポジトリ)の既定実行 SA は Compute Engine 既定 SA。
# 念のため App Engine 既定 SA(v1/旧構成)にも付与する。
for SA in "${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" "${PROJECT}@appspot.gserviceaccount.com"; do
  if gcloud projects add-iam-policy-binding "$PROJECT" \
      --member "serviceAccount:${SA}" --role roles/documentai.apiUser \
      --condition=None --quiet >/dev/null 2>&1; then
    ok "roles/documentai.apiUser → $SA"
  else
    warn "$SA への付与に失敗(存在しない SA の場合は問題ありません)"
  fi
done

# =============================================================================
step "7/10 設定ファイルの書き出し(A-5)と CORS 制限(A-10)"
# =============================================================================
ask ALLOW_ORIGIN "本番 SPA のオリジン(CORS 許可。GitHub Pages なら https://<ユーザー名>.github.io)" "https://konohito.github.io"

cat > .firebaserc <<EOF
{
  "projects": {
    "default": "$PROJECT"
  }
}
EOF
ok ".firebaserc を書き出しました(default: $PROJECT)"

ENV_FILE="functions/.env"
if [ -f "$ENV_FILE" ] && ! confirm "$ENV_FILE が既にあります。上書きしますか?"; then
  warn "既存の $ENV_FILE を維持します(DOCAI_PROCESSOR_ID=$PROCESSOR_ID を手動で確認してください)"
else
  cat > "$ENV_FILE" <<EOF
# scripts/setup-gcp.sh が生成($(date +%Y-%m-%d))。デプロイ時に Functions へ反映される。
DOCAI_PROJECT_ID=$PROJECT
DOCAI_LOCATION=$DOCAI_LOCATION
DOCAI_PROCESSOR_ID=$PROCESSOR_ID
# 職員ログイン(Firebase Auth)の ID トークン検証を必須にする
OCR_REQUIRE_AUTH=1
# CORS 許可オリジン(本番 SPA のみ)
OCR_ALLOW_ORIGIN=$ALLOW_ORIGIN
OCR_MAX_BYTES=10485760
OCR_REVIEW_THRESHOLD=80
EOF
  ok "$ENV_FILE を書き出しました"
fi

# =============================================================================
step "8/10 テスト → デプロイ(A-6)"
# =============================================================================
( cd functions && npm install ) || die "functions の npm install に失敗しました"
( cd functions && npm test ) || die "functions の単体テストが失敗しました(修正してから再実行してください)"
ok "単体テスト成功"

note "Functions / Firestore ルール・インデックス / Storage ルールをデプロイします"
firebase deploy --only functions,firestore:rules,firestore:indexes,storage --project "$PROJECT" \
  || die "デプロイに失敗しました(エラーメッセージを確認して再実行してください)"
ok "デプロイ完了"

FUNCTION_URL=$(gcloud functions describe recognizeSheet --region=asia-northeast1 --project "$PROJECT" \
  --format='value(serviceConfig.uri)' 2>/dev/null || true)
[ -n "$FUNCTION_URL" ] || FUNCTION_URL="https://asia-northeast1-${PROJECT}.cloudfunctions.net/recognizeSheet"
ok "関数 URL(A-7): $FUNCTION_URL"

# =============================================================================
step "9/10 職員ログイン — Firebase Auth(A-8)"
# =============================================================================
RES=$(gapi PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config?updateMask=signIn.email" \
  '{"signIn":{"email":{"enabled":true,"passwordRequired":true}}}')
if [ "$(printf '%s' "$RES" | json_get 'd["signIn"]["email"]["enabled"]')" = "True" ]; then
  ok "メール / パスワード ログインを有効化しました"
else
  warn "自動有効化に失敗しました。コンソールで有効化してください:"
  note "https://console.firebase.google.com/project/${PROJECT}/authentication/providers → メール/パスワード"
fi

while confirm "職員アカウントを作成しますか?(何人でも追加できます)"; do
  ask STAFF_EMAIL "職員のメールアドレス"
  read -rs -p "パスワード(8文字以上推奨・入力は表示されません): " STAFF_PW; echo
  RES=$(gapi POST "https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts" \
    "{\"email\":\"${STAFF_EMAIL}\",\"password\":\"${STAFF_PW}\"}")
  if [ -n "$(printf '%s' "$RES" | json_get 'd["localId"]')" ]; then
    ok "作成しました: $STAFF_EMAIL"
  else
    ERR=$(printf '%s' "$RES" | json_get 'd["error"]["message"]')
    case "$ERR" in
      EMAIL_EXISTS) warn "$STAFF_EMAIL は既に登録済みです" ;;
      WEAK_PASSWORD*|INVALID_PASSWORD*) warn "パスワードが弱すぎます(6文字以上)。もう一度どうぞ" ;;
      *) warn "作成に失敗しました: ${ERR:-不明なエラー}" ;;
    esac
  fi
done

# =============================================================================
step "10/10 フロント接続情報(A-9 の材料)"
# =============================================================================
APPS=$(gapi GET "https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps")
APP_ID=$(printf '%s' "$APPS" | json_get 'd.get("apps",[{}])[0].get("appId")')
if [ -z "$APP_ID" ]; then
  note "Firebase Web アプリを作成します"
  firebase apps:create WEB "cruto-motion" --project "$PROJECT" >/dev/null 2>&1
  APPS=$(gapi GET "https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps")
  APP_ID=$(printf '%s' "$APPS" | json_get 'd.get("apps",[{}])[0].get("appId")')
fi

FIREBASE_CONFIG=""
if [ -n "$APP_ID" ]; then
  CFG=$(gapi GET "https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps/${APP_ID}/config")
  FIREBASE_CONFIG=$(printf '%s' "$CFG" | python3 -c 'import json,sys
d=json.load(sys.stdin)
keys=["apiKey","authDomain","projectId","storageBucket","messagingSenderId","appId"]
print(json.dumps({k:d[k] for k in keys if k in d}, separators=(",",":")))' 2>/dev/null)
  ok "Firebase Web アプリ構成を取得しました"
else
  warn "Web アプリ構成を自動取得できませんでした。コンソールから取得してください:"
  note "https://console.firebase.google.com/project/${PROJECT}/settings/general → マイアプリ → 構成"
fi

# =============================================================================
printf '\n%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n' "$GREEN$BOLD" "$RESET"
printf '%s🎉 クラウド側のセットアップが完了しました%s\n' "$GREEN$BOLD" "$RESET"
printf '%s━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%s\n\n' "$GREEN$BOLD" "$RESET"
printf '%s残りはこの 1 手だけ(A-9: フロント接続):%s\n\n' "$BOLD" "$RESET"
printf 'GitHub リポジトリ → Settings → Secrets and variables → Actions → New repository secret で\n'
printf '以下の 2 つ(必要なら 3 つ)を登録し、Actions の「Deploy to GitHub Pages」を Run workflow:\n\n'
printf '  %sOCR_ENDPOINT%s\n    %s\n\n' "$BOLD" "$RESET" "$FUNCTION_URL"
if [ -n "$FIREBASE_CONFIG" ]; then
  printf '  %sFIREBASE_CONFIG%s\n    %s\n\n' "$BOLD" "$RESET" "$FIREBASE_CONFIG"
else
  printf '  %sFIREBASE_CONFIG%s\n    (コンソールの「マイアプリ → 構成」の値を 1 行の JSON で)\n\n' "$BOLD" "$RESET"
fi
printf '  %sOCR_API_KEY%s(任意・functions/.env に OCR_API_KEY を足した場合のみ同じ値)\n\n' "$BOLD" "$RESET"
printf 'ローカルで確認する場合は .env.local.example を .env.local にコピーして同じ値を記入。\n\n'
printf '%s動作確認:%s デプロイ後の SPA を開く → 職員ログイン画面 → ログイン →\n' "$BOLD" "$RESET"
printf '「取り込み」画面に「ライブ取り込み」が表示されれば成功です。\n\n'
printf '%s控え:%s\n' "$BOLD" "$RESET"
printf '  プロジェクト        : %s\n' "$PROJECT"
printf '  Document AI        : %s / %s\n' "$DOCAI_LOCATION" "$PROCESSOR_ID"
printf '  関数 URL           : %s\n' "$FUNCTION_URL"
printf '  Storage バケット    : gs://%s\n' "$STORAGE_BUCKET"
printf '  CORS 許可オリジン   : %s\n' "$ALLOW_ORIGIN"
