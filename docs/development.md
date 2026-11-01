# 開発ガイド

MarkdownPad をビルドし、変更を確かめ、リリースするための手順です。
製品の仕様と実装の判断基準は [AGENTS.md](../AGENTS.md) にまとめています。

## 技術スタック

| 役割 | 使うもの |
| --- | --- |
| デスクトップ基盤 | Tauri v2（Rust） |
| UI | React、TypeScript、Vite |
| エディタ | CodeMirror 6、`@lezer/markdown`（GFM 拡張） |
| 印刷用の描画 | `markdown-it`、DOMPurify |

## 必要なもの

- Node.js 26 以上と npm（バージョンは `.nvmrc`）
- Rust と Cargo
- Microsoft C++ Build Tools の「C++ によるデスクトップ開発」ワークロード
- Microsoft Edge WebView2 Runtime

詳しくは [Tauri の Prerequisites](https://v2.tauri.app/start/prerequisites/)
を参照してください。

## 起動

```powershell
npm install
npm run tauri dev
```

`npm run dev` だけを実行すると、フロントエンドを Vite の開発サーバー
（`http://127.0.0.1:1420`）でブラウザから開けます。Tauri の機能は
使えないので、ファイル操作などはブラウザ用の代替動作になります。

## 変更の確かめ方

| コマンド | 内容 |
| --- | --- |
| `npm test` | unit test |
| `npm run build` | 型検査とフロントエンドのビルド |
| `npm run test:e2e` | Playwright のブラウザ検査（`tests/playwright/`） |
| `cargo check`（`src-tauri` で実行） | Rust 側の検査 |

`npm run test:e2e` は、Vite の開発サーバーが動いていなければ起動し、
終わると止めます。既定では Google Chrome を使います。Chrome がない
環境では、環境変数 `MARKDOWNPAD_CHROMIUM` に Chromium の実行ファイルを
指定します。Tauri 固有の流れ（復元、保存時の競合、文字コード）は
`tests/playwright/tauri-mock.mjs` で IPC を模して検査します。

Linux（クラウドのコンテナなど）で `cargo check` を実行するには、GTK と
WebKitGTK の開発パッケージが必要です。Ubuntu 24.04 では次のとおりです。

```bash
sudo apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libxdo-dev libssl-dev pkg-config build-essential
```

## exe のビルド

```powershell
npm run tauri -- build
```

`beforeBuildCommand` で `npm run build` を実行してから、Rust 側を release
ビルドします。生成物は `src-tauri\target\release\markdownpad.exe` です。

配布はインストーラーなしの exe なので、`tauri.conf.json` の
`bundle.active` は `false` のままにします。`bundle.fileAssociations` は
インストーラーを作る場合のための設定で、今の配布形式では使われません。

## アイコン

元画像は `src-tauri/icons/app-icon.png`（1024×1024、背景透過）です。
アイコンを変えるときは元画像を差し替え、一時フォルダに生成してから、
既存のファイル（`icon.ico`、`icon.icns`、`icon.png`、各サイズの PNG）
だけを上書きします。Android、iOS、Microsoft Store 向けの画像は置きま
せん。画面の favicon（`public/favicon.png`）は `64x64.png` の複製です。

```powershell
npx tauri icon src-tauri/icons/app-icon.png -o $env:TEMP\markdownpad-icons
```

## CI

`.github/workflows/ci.yml` が、`main` への push と pull request ごとに
次を実行します。

- Frontend（Ubuntu）: `npm test` と `npm run build`
- Browser checks（Ubuntu）: Playwright のブラウザ検査。スクリーン
  ショットは Actions の artifact に保存する
- Tauri（Windows）: `cargo fmt --check`、`cargo clippy -- -D warnings`、
  `cargo test`

依存関係は Dependabot（`.github/dependabot.yml`）が毎週月曜に確認します。
minor / patch の更新はエコシステムごとに 1 つの PR にまとめ、major の
更新は個別の PR にします。

## リリース

バージョン番号は [Semantic Versioning](https://semver.org/lang/ja/) に
従い、変更点は [CHANGELOG.md](../CHANGELOG.md) に記録します。

1. 変更を入れるたびに、`CHANGELOG.md` の `[Unreleased]` に追記する。
2. リリースするときは、`[Unreleased]` の内容を
   `## [x.y.z] - YYYY-MM-DD` の節に移し、末尾の比較リンクを更新する。
3. バージョンを上げる。`npm version x.y.z --no-git-tag-version` で
   `package.json` と `package-lock.json` を、手で
   `src-tauri/tauri.conf.json` と `src-tauri/Cargo.toml` を書き換え、
   `src-tauri` で `cargo check` を実行して `Cargo.lock` も更新する。
   これらと `CHANGELOG.md` が食い違うと、`npm test` が失敗する。
4. `main` にマージした後、マージ後の `main` にタグを付けて push する。

```powershell
git switch main
git pull
git tag v0.1.1
git push origin v0.1.1
```

タグを push すると `.github/workflows/release.yml` が動きます。タグと
バージョンが一致することを確かめてから exe をビルドし、
`MarkdownPad-<バージョン>-windows-x64.zip` と SHA-256 のチェックサムを
GitHub Releases に公開します。リリースノートには `CHANGELOG.md` の
該当する節（`node scripts/changelog.mjs <バージョン>` の出力）を使います。
