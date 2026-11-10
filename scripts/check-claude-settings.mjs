/* AI の許可の控えに、秘密が残っていないか（★2026-11-10 新設・全リポジトリ共通）
 *
 * ★なぜ要るか
 *   作業アシスタントで「今後は確認しない」を押すと、
 *   `.claude/settings.local.json` に許可が保存される。
 *   このとき**コマンドを丸ごと**保存することがあり、
 *   コマンドの中に直接書いたパスワードやトークンが**平文で残る**。
 *   2026-11 に公開リポジトリ 1,122件・秘密 1,379件の実例が報告された。
 *   しかも gitleaks や TruffleHog では 215件が見つからなかった
 *   （`mysql -p〈パスワード〉` は、道具から見るとただの単語に見えるため）。
 *
 * ★この検査が守ること
 *   1) `.claude/` が git に入っていないこと（履歴も含めて）
 *   2) `.gitignore` に書いてあること（PC ごとの設定に頼らない）
 *   3) 許可の中に秘密らしい値が無いこと
 *   4) 許可が**パターン**で書かれていること（単発のコマンド丸ごとを増やさない）
 *
 * 実行: node tools/check-claude-settings.mjs [リポジトリのパス...]
 *       指定が無ければ cruto-ws 配下の全リポジトリを見る
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/* 自分のリポジトリだけを見る（置き場所から自動で決める）。
   ワークスペース全体を見たいときは cruto-ws/tools/check-claude-settings.mjs を使う。 */
const WS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
/* ★ワークスペース直下（WS 自身）も必ず見る。
     ここに置かれた設定は、どのリポジトリにも属さないので見落としやすい。
     実際、最初に書いた検査はここを見ておらず、
     **本物のトークンを入れても素通りした**（2026-11-10 実測）。 */
const REPOS = process.argv.slice(2).length ? process.argv.slice(2) : [WS];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };

/* 本物の秘密らしい形。長い英数字の塊だけを見る（短い単語で騒がない）。 */
const SECRET = [
  /ghp_[A-Za-z0-9]{20,}/, /gho_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9]{20,}/, /AKIA[0-9A-Z]{16}/, /ya29\.[A-Za-z0-9_\-]{30,}/,
  /AIza[0-9A-Za-z_\-]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}/,          // JWT
  /(?:password|passwd|pwd)\s*[=:]\s*["']?[^\s"'$<{]{6,}/i,   // password=〈値〉（$VAR は除く）
  /-p[A-Za-z0-9!@#$%^&*]{6,}\b/,                              // mysql -p〈パスワード〉
];
/* 伏せ字・環境変数は秘密ではない */
const SAFE = /__TRACKED_VAR__|\$\{?[A-Z_][A-Z0-9_]*\}?|〈|<[A-Za-z_]+>/;

const sh = (cwd, args) => { try { return execFileSync("git", args, { cwd, encoding: "utf8" }).trim(); } catch { return ""; } };

for (const repo of REPOS) {
  const name = path.basename(repo);
  const isGit = fs.existsSync(path.join(repo, ".git"));

  /* 1) git に入っていないこと（いまも、履歴も）。git でない場所は飛ばす */
  if (isGit) {
  ok(sh(repo, ["ls-files", ".claude"]) === "",
    `★${name}: .claude/ が git に入っています（誰でも読めます）`);
  ok(sh(repo, ["log", "--all", "--oneline", "--", ".claude/settings.local.json"]) === "",
    `★${name}: .claude/settings.local.json が git の履歴に入っています（消しても残ります）`);

  /* 2) .gitignore に書いてあること */
  const gi = path.join(repo, ".gitignore");
  ok(fs.existsSync(gi) && /\.claude\/settings\.local\.json/.test(fs.readFileSync(gi, "utf8")),
    `★${name}: .gitignore に .claude/settings.local.json がありません（別のPCでは守られません）`);
  }

  /* 3) 許可の中に秘密が無いこと ＋ 4) パターンで書かれていること */
  const f = path.join(repo, ".claude/settings.local.json");
  if (!fs.existsSync(f)) continue;
  let allow = [];
  try { allow = ((JSON.parse(fs.readFileSync(f, "utf8")).permissions || {}).allow) || []; }
  catch { ok(false, `★${name}: 設定ファイルが読めません`); continue; }

  const leaked = allow.filter((x) => !SAFE.test(x) && SECRET.some((re) => re.test(x)));
  ok(leaked.length === 0,
    `★${name}: 許可の中に秘密らしい値が ${leaked.length}件あります。\n` +
    "        **消す前に、その鍵とパスワードを作り直してください。**（履歴やフォークに残るため）");

  const whole = allow.filter((x) => /^Bash\(/.test(x) && !/:\*\)$/.test(x));
  ok(whole.length === 0,
    `★${name}: 単発のコマンド丸ごとの許可が ${whole.length}件あります（秘密が紛れ込む入口）。\n` +
    "        Bash(npm run:*) のようなパターンで許可してください：\n        " +
    whole.slice(0, 5).map((x) => x.slice(0, 80)).join("\n        "));
}

console.log(fail
  ? `\ncheck-claude-settings: ${pass} ok, ${fail} failed`
  : `\ncheck-claude-settings: ${pass} ok, 0 failed`);
process.exit(fail ? 1 : 0);
