# シフトヘルプ アプリ

飲食チェーンが、店舗間でシフトのヘルプ（応援）を募集・調整するための、
セルフホスト型Webアプリです。Supabase（Auth + Postgres + Edge Functions +
Realtime）の上に構築された単一HTMLファイルで、Web Push通知に対応し、
フロントエンドは任意の静的ホスティングに置けます。

- **3つの役割：** 本部（HQ）、店舗管理者、従業員。
- **基本フロー：** 店舗または従業員がヘルプ依頼を出すと、近隣・エリア内・
  より広域の対象店舗の従業員が、勤務枠の全部または一部に応募できます。
- **その他機能：** 店舗間の代理権、店舗ごとの応募範囲制限、最低応募時間、
  監査ログ、初期パスワードの強制変更、PWAプッシュ通知。

> これはコミュニティ／OSS版です。**データもシークレットも一切含みません。**
> Supabase・ホスティング・プッシュ用の鍵はご自身で用意してください（下記参照）。

## ライセンス

MIT（[LICENSE](./LICENSE) を参照）。「現状のまま」提供され、無保証です。
デプロイ・データ・法令順守はすべて利用者の責任となります。

> English version: [README.en.md](./README.en.md)

---

## 構成の概要

| 要素              | 内容                                                    |
|-------------------|---------------------------------------------------------|
| `index.html`      | フロントエンド全体（HTML + CSS + JS が1ファイル）        |
| Supabase Auth     | 本部・店舗・従業員のログイン（仮想メール＋パスワード）   |
| Supabase Postgres | テーブル＋行レベルセキュリティ＋トリガー（`schema.sql`） |
| Edge Functions    | 権限が必要な操作（ユーザー作成・削除など）               |
| Realtime          | 依頼一覧の複数端末間でのリアルタイム更新                 |
| Web Push（VAPID） | Service Worker経由の通知                                 |
| GitHub Actions    | 日次のキープアライブping＋古い依頼の自動削除             |

ログインには**仮想メールアドレス**（実在のメールではない）を使います：
`hq@shift.local`、`<コード>@store.shift.local`、`<コード>@emp.shift.local`。

---

## 必要なもの

- [Supabase](https://supabase.com) アカウント（最初は無料プランで十分）。
- `index.html` を置く静的ホスティング（Cloudflare Pages、Netlify、Vercel、
  GitHub Pages、Supabase Storage など）。**HTTPS必須**（Service Workerと
  プッシュのため）。
- Node.js（VAPID鍵を `npx` で生成するためだけに使用）。
- 任意：日次のキープアライブ／削除ジョブを使うならGitHubリポジトリ。

---

## セットアップ

### 1. データベースを作成

1. Supabaseで新規プロジェクトを作成（利用者に近いリージョンを選ぶ）。
2. **SQL Editor** を開き、[`supabase/schema.sql`](./supabase/schema.sql) の
   全内容を貼り付けて実行。これで全テーブル・インデックス・RLSポリシー・
   トリガーが作成されます。

### 2. VAPID鍵を生成（プッシュ通知用）

```bash
npx web-push generate-vapid-keys
```

**公開鍵**と**秘密鍵**の両方を控えておきます。公開鍵は `index.html` に、
両方をEdge Functionのシークレットに設定します。

### 3. Edge Functions をデプロイ

`supabase/functions/` 配下の各フォルダが1つの関数です。
[Supabase CLI](https://supabase.com/docs/guides/cli) でデプロイします：

```bash
supabase login
supabase link --project-ref <あなたのproject-ref>
supabase functions deploy create-store create-employee admin-update-password \
  delete-user update-store update-employee revoke-proxy send-notification \
  hq-recover cleanup-old-requests
```

> **⚠️ デプロイでつまずいたら：**
> - **実行場所：** `deploy` コマンドは、必ず `supabase/` フォルダの親
>   ディレクトリ（このリポジトリのルート、つまり `shift-help-app/` の中）
>   で実行してください。別の場所で実行すると
>   `Entrypoint path does not exist` や `cannot find the path` エラーに
>   なります。`ls supabase/functions`（Windowsは `dir supabase\functions`）
>   で関数フォルダが見えることを確認してから実行を。
> - **Docker：** 既定では Docker を使ってビルドするため、`Docker is not
>   running` 警告が出ることがあります。Docker を使いたくない場合は
>   コマンド末尾に `--use-api` を付けると Docker なしでデプロイできます。
>   （または Docker Desktop を起動してから実行。）

**CLIを使わず、ダッシュボードから手動でデプロイする方法**（Docker・CLI不要）:

1. ダッシュボード → **Edge Functions** → **Create a new function**。
2. 関数名（例：`create-store`）を入力。
3. `supabase/functions/create-store/index.ts` の中身をコピペ。
4. Deploy。
5. これを10関数すべてについて繰り返す。

### 4. Edge Functions のシークレットを設定

**Project Settings → Edge Functions → Secrets**（または
`supabase secrets set KEY=value`）で以下を設定します：

| シークレット                | 値・備考                                                 |
|-----------------------------|----------------------------------------------------------|
| `SUPABASE_URL`              | 通常は自動で用意される                                   |
| `SUPABASE_ANON_KEY`         | 通常は自動で用意される                                   |
| `SUPABASE_SERVICE_ROLE_KEY` | 通常は自動で用意される                                   |
| `VAPID_SUBJECT`             | `mailto:you@example.com`                                 |
| `VAPID_PUBLIC_KEY`          | 手順2で生成した公開鍵                                    |
| `VAPID_PRIVATE_KEY`         | 手順2で生成した秘密鍵                                    |
| `CRON_SECRET`               | 任意の長いランダム文字列（削除ジョブで使用）             |
| `HQ_HIDDEN_CODE`            | 本部用の緊急コード（例：`7421-9930-5582`）               |
| `HQ_DEFAULT_RECOVERY`       | 隠しコード使用後に復元される復旧コード                   |

> **重要：** `HQ_HIDDEN_CODE` は、ログインせずに本部パスワードをリセット
> できる緊急用マスターコードです。長くてユニークな値を選び、秘密に
> 保管してください。例の値は絶対に再利用しないこと。

### 5. フロントエンドを設定

`index.html` の `<script>` 冒頭を編集します：

```js
const SUPABASE_URL      = 'YOUR_SUPABASE_URL';       // https://xxxx.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';  // Settings > API > anon public
const VAPID_PUBLIC_KEY  = 'YOUR_VAPID_PUBLIC_KEY';   // 手順2の公開鍵
```

### 6. 本部（HQ）アカウントを作成

本部は唯一の管理者アカウントです。一度だけ作成します：

1. Supabaseの **Authentication → Users → Add user** で、メール
   `hq@shift.local` と任意のパスワードのユーザーを作成し、メールを
   確認済み（confirm）にします。
2. そのユーザーのUUIDをコピーします。
3. **SQL Editor** で、`hq` 行に紐付け、復旧コードを設定します：

   ```sql
   insert into public.hq (id, auth_id, code, recovery)
   values (1, '<本部ユーザーのUUID>', 'Admin', 'ABCD-EFGH-JKLM')
   on conflict (id) do update
     set auth_id = excluded.auth_id,
         code = excluded.code,
         recovery = excluded.recovery;
   ```

   - `code` は本部ログイン画面で入力する値（既定は `Admin`、大文字小文字
     を区別しない）。
   - `recovery` はパスワード復旧時に使うコード。独自の値を使ってください。

### 7. `index.html` をホスティング

`index.html` を任意のHTTPS静的ホスティングにアップロードします。
PWA・プッシュをフル機能で使うには、`sw.js`（Service Worker）と
`manifest.json` も同じ場所に置いてください。URLを開いて本部でログインします。

### 8.（任意）日次キープアライブ＋削除

無料プランでは、Supabaseはアイドル状態のプロジェクトを一時停止します。
付属のワークフローは、プロジェクトへのping（一時停止防止）と、30日以上前の
依頼の削除を行います。

**重要：自動実行は既定で無効になっています。** セットアップ前に動いて失敗
メールが届くのを防ぐため、初期状態では手動実行（Actionsタブ →「Run
workflow」）のみ可能です。

1. このリポジトリをGitHubに置きます。
2. **Settings → Secrets and variables → Actions** で以下を追加：
   `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`CRON_SECRET`（Edge Function側の
   シークレットと同じ値）。
3. Actionsタブから手動で動作確認できます（「Keep Supabase Alive」→「Run
   workflow」）。
4. 毎日の自動実行を有効にしたい場合は、シークレット設定後に
   `.github/workflows/keepalive.yml` の `schedule:` の2行のコメント（先頭の
   `#`）を外してください。

### 9. 認証のレート制限を強める（推奨）

**Authentication → Rate Limits** で「サインアップ／サインイン」を低めに
設定（例：5分あたり10回程度）すると、総当たり攻撃を遅らせられます。

---

## 初回の操作

1. 本部（`Admin` ＋ 設定したパスワード）でログイン。
2. 店舗を作成し、店舗コードと設定した初期パスワードを控える。
3. その店舗でログイン（初期パスワードの変更を求められます）。
4. 従業員を追加（固定の初期パスワードで開始し、初回ログイン時に変更を
   求められます）。
5. 各店舗の近隣・エリア内・応募範囲・代理権の設定を行う。

---

## セキュリティについて

- 権限が必要な操作はEdge Function内でのみ、service roleキーを使って実行
  されます。ブラウザがこのキーを見ることはありません。
- 行レベルセキュリティ（RLS）が、各役割の読み書き範囲を制限します。
  識別列はさらにトリガーで保護されています。
- 初期パスワードは初回ログイン時に変更が必須です。
- 監査ログが主要操作（ログイン、アカウント変更、パスワードリセット、
  代理権変更など）を記録し、本部画面からCSV出力できます。
- Supabase URLとanonキーは設計上公開されます（ブラウザが使うため）。
  データを守るのはRLSです。service roleキー・VAPID秘密鍵・`CRON_SECRET`・
  `HQ_HIDDEN_CODE` は秘密にしてください。

## スケールについて

- Supabase無料プランで小〜中規模は対応できます。最初に当たりやすい上限は
  **Realtime同時接続数**（約200）で、これはアプリをブラウザで開いている間
  だけカウントされます（プッシュ通知は対象外）。
- 大規模（数百店舗）では、プロジェクトを分割するのではなく有料プランへの
  移行を推奨します（店舗間の応援には1つの共有データベースが必要なため）。

---

## 免責事項

本ソフトウェアはMITライセンスのもと「現状のまま」提供されます。安全な
デプロイ、シークレットの保護、データのバックアップ、および利用地域の
すべての適用法令の順守は、すべて利用者の責任において行ってください。
