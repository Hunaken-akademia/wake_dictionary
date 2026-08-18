# WAKE辞典 Google申請・承認 β版

既存の購入者用パスワード認証を残したまま、管理者本人だけで次の流れを確認するためのβ版です。

1. Googleログイン
2. WAKE辞典の利用申請
3. 管理者による承認
4. 承認済みGoogleアカウントで辞典を閲覧

WAKE本体の `paid_users` は参照・更新しません。辞典専用テーブルに完全分離しています。

## 初回設定（各1回）

### 1. Supabase

Supabase SQL Editorで `sql/12_dictionary_google_access_beta.sql` を実行します。

Authentication → URL Configuration の Redirect URLs に次を追加します。

```text
https://wake-dictionary.vercel.app/?dictionary_oauth=1
```

### 2. Vercel

wake-dictionaryプロジェクトのProduction環境変数に追加します。

```text
WAKE_DICTIONARY_ADMIN_EMAILS=（管理者のGoogleメールアドレス）
```

既存の `SUPABASE_URL` と `SUPABASE_SERVICE_KEY` もProductionで利用できることを確認してください。サービスキーはブラウザへ返しません。

環境変数を変更した後は、GitHub Actionsの `Build and Deploy WAKE Dictionary` を再実行します。

## 動作確認

1. 辞典のパスワード画面で「Googleで申請・承認を試す」
2. 管理者Googleアカウントでログイン
3. 「このアカウントで申請する」
4. 「自分の申請を承認する」
5. 「辞典を開く」

承認期限はβ版では2027年12月31日（日本時間）です。管理者メール以外はβ申請APIが403を返すため、既存利用者の画面・権限には影響しません。
