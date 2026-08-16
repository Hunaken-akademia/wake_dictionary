# WAKE辞典 v1.5 フロントエンド

404を解消し、Viteで実際のトップページを表示するためのフロントです。

## 追加
- トップページ
- 選手名 / 登録番号検索
- 選手詳細
- 逆引き検索
- ランキング
- モバイル対応
- Vercel設定
- GitHub Actions上で `dist` までビルド

## 重要
このパッチで `/` の画面本体は作られます。
ただし、Vercelの通常GitHubデプロイ時にも `public/data` が存在しないと画面内データは読めません。

現在のGitHub Actionsは生成したJSONをrunner内だけに作っており、リポジトリへ保存していません。
そこでv1.5はActions内で最新JSONを生成してからフロントもビルドし、`dist` をartifact保存します。

毎晩の最新JSON込みでVercelへ自動反映するには次段階でVercel CLIデプロイをActionsに接続するのが推奨です。
公開repoへ `public/data` をcommitする方式は、有料辞典を想定すると非推奨です。
