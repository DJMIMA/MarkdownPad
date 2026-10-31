# MarkdownPad

MarkdownPad は、単体の Markdown ファイルを軽く開き、美しく読みながら
編集するためのデスクトップアプリです。メモ帳のようなシンプルさを保ちつつ、
Markdown 表示は Obsidian のように読みやすくすることを目指します。

## 作成動機

このプロジェクトは、次の隙間を埋めるために始めます。

- Obsidian は Markdown の表示に優れていますが、Vault 管理を前提にした
  ノートアプリであり、単体の Markdown ファイルを開いたり編集したりする
  用途には向きにくい。
- VS Code は高機能ですが、Markdown を見るだけ・少し直すだけの用途には
  重量級すぎる。
- メモ帳は軽くて単純ですが、Markdown 表示が美しくなく、一部文法への対応
  も十分ではない。

MarkdownPad はその中間にある道具です。高速起動、シンプルなメニュー、
タブ表示、美しい Markdown 表示、Vault 管理なしの直接ファイル編集を重視します。

## プロダクト目標

- 単体の `.md` / `.markdown` ファイルを快適に開いて編集できる。
- 既定モードを Obsidian 風のライブプレビューにする。
- ユーザーが編集している場所だけ Markdown ソースを表示する。
- アプリを軽く、静かに、ファイル中心に保つ。
- 初期バージョンでは、プラグイン、Vault、IDE、プロジェクト管理機能を
  持ち込まない。

## 初期機能

- Windows 優先のネイティブデスクトップアプリ。
- タブ表示。
- 新しいタブと新しいウインドウ。
- 開く、保存、名前を付けて保存。
- 印刷メニュー。
- 切り取り、コピー、貼り付け、検索、置換、全てを選択。
- 拡大、縮小、既定値に戻す。
- 右端で折り返すトグル。
- ステータスバートグル。
- 編集できないリーディングモード（`Ctrl+E`）。
- ライト / ダーク / システム追従のテーマと、ワンクリックの切り替え。
- 手動保存を基本とした異常終了時のアプリ内復元スナップショット。
- 強制終了などの後だけ、前回状態を復元するか確認するクラッシュ復元。

## ライブプレビュー編集

既定の編集モードはライブプレビューです。

- 編集中も Markdown を整形表示する。
- カーソルのある行では、`#`、`-`、`*`、リンク構文、コード記号などの
  Markdown ソースを表示する。
- カーソル外の行は Markdown として整形表示したままにする。
- 表、画像、フェンス付きコードブロックなどは、カーソルが内部にある間、
  ブロック全体をソース表示に戻してレイアウトの揺れを抑える。
- カーソル外の表は、本文幅いっぱいではなくセル内文字列に応じた自然な幅で
  表示する。表示領域より広い表だけ横スクロールで読む。
- 箇条書きと番号付きリストでは、`Enter` は次のリスト項目を作る。空の
  リスト項目で `Enter` を押すとリスト構文を消してプレーン行へ抜ける。
  リスト項目内の継続段落は `Shift+Enter` の明示操作でのみ作り、先頭を
  1行目の本文開始位置に揃える。

ただし、エディタとしての信頼性を優先します。IME 入力、選択、Undo/Redo、
カーソル移動、キーボードショートカットを壊してまで装飾を優先しません。

## Markdown 対応

初期対応方言は CommonMark + GitHub Flavored Markdown です。

MVP では次の対応を予定します。

- 見出し。
- 段落と改行。
- 強調と太字。
- 引用。
- 番号付きリストと箇条書き。
- タスクリスト。
- リンクと画像。
- インラインコードとフェンス付きコードブロック。
- 表。
- 取り消し線。
- 明示的なリンク。裸 URL は通常の文字列として扱い、クリック可能リンクに
  しない。

wikilink、埋め込み、callout、プラグイン由来の拡張など、Obsidian 固有の
文法は初期バージョンの対象外です。

## メニュー仕様

アプリメニューは意図的に小さく保ちます。

### ファイル

- 新しいタブ
- 新しいウインドウ
- 開く
- 保存
- 名前を付けて保存
- 印刷
- タブを閉じる
- ウィンドウを閉じる
- 終了

### 編集

- 切り取り
- コピー
- 貼り付け
- 検索
- 置換
- 全てを選択

### 表示

- ズーム
  - 拡大
  - 縮小
  - 既定値に戻す
- リーディングモード（`Ctrl+E`）
- 右端で折り返す
- ステータスバー

「リーディングモード」「右端で折り返す」「ステータスバー」はトグルメニュー
です。

## リーディングモード

「表示」メニューの「リーディングモード」（`Ctrl+E`、Obsidian と同じ
ショートカット）で、編集できない読むためのモードに切り替えます。

- 文書全体を整形表示したままにする。表、コードブロック、罫線、見出しなどを
  クリックしても Markdown ソース表示に戻らないため、読んでいる途中で表示が
  崩れない。
- 文字の入力、削除、貼り付け、置換、Undo など、本文を変える操作は一切
  受け付けない。
- 文字列の選択とコピー、検索（`Ctrl+F`）、明示的なリンクのクリックは使える。
  置換（`Ctrl+H`）は何もしない。
- 矢印キー、PageUp / PageDown、Space、Home / End はカーソル移動ではなく
  スクロールになる。
- もう一度 `Ctrl+E`（またはメニュー）で通常のライブプレビュー編集に戻る。
- タブごとの表示状態で、タブを切り替えるとモードもそのタブのものに
  切り替わる。新しいタブや新しく開いたファイルは編集モードで始まる。
  復元スナップショットには含めない。

## テーマ（外観）

ライトテーマとダークテーマに対応します。

- 初回起動時は OS の配色設定（`prefers-color-scheme`）に追従する。
- タブ右側のトグルボタンでライト / ダークを切り替えられる。切り替えると
  その選択を `localStorage` に保存し、次回以降も維持する。
- テーマは復元スナップショットとは独立した端末ごとの設定として扱う。
- エディタ本体とアプリ枠（タブ、ステータスバー、ダイアログ、検索パネル）の
  両方が同じテーマトークンで配色される。
- 印刷ページは用紙に合わせて常にライト表示を維持する。

画面デザインは Obsidian の既定テーマを理想形とします。

- 行番号（ガター）は表示しない。カーソル行の背景ハイライトもしない。
- エディタはカード枠で囲まず、ウィンドウいっぱいに表示する。アクティブな
  タブは本文と地続きにし、未保存のタブは閉じるボタンの位置に丸印を出す。
- 本文はウィンドウ全体の幅を使う。行幅を狭いカラムに制限しない。
  「右端で折り返す」がオンのときはウィンドウの右端で折り返し、オフのときは
  幅を制限せず横スクロールにする。
- ライトは白背景、ダークは色みのない灰色（`#1e1e1e`）。色は落ち着いた青
  1 色だけをアクセントにし、リンク、チェック済みタスク、引用線、フォーカス
  に使う。見出しは本文と同じ色で、大きさと太さだけで階層を示す。
- 箇条書きと番号付きリストはぶら下げインデントで、折り返した行や継続行が
  1 行目の本文開始位置にそろう。入れ子は親項目の本文開始位置から始まる。
- タスク項目は箇条書きの点を出さずチェックボックスだけを表示し、完了した
  項目は淡色の取り消し線で示す。
- カーソル行で表示する Markdown 記号（`#`、`**`、`-`、`>` など）は淡色に
  して、読み書きの邪魔をしない。

メニュー仕様を小さく保つ方針は維持し、テーマ切り替えだけを低ノイズな
トップバーのアイコンボタンとして追加しています。

## 保存と復元

MarkdownPad は手動保存を基本にします。

- 元ファイルは、ユーザーが「保存」または「名前を付けて保存」を選んだ
  ときだけ変更する。
- 保存は同じフォルダの一時ファイルに書いてから置き換える方式で行い、
  書き込み途中の異常終了や容量不足で元ファイルが壊れないようにする。
- 開いた後にほかのアプリでファイルが変更されていた場合は、上書きする前に
  「上書き保存 / 再読み込み（編集を破棄） / キャンセル」を確認する。
- 文字コードは UTF-8（BOM の有無）、UTF-16（BOM 付き）、Shift_JIS を
  読み込める。改行コード（LF / CRLF）とあわせて、保存時は開いたときの
  形式に戻す。現在の形式はステータスバーに表示する。元の文字コードで
  表せない文字を保存するときは、UTF-8 で保存するか確認する。
- 保存や読み込みに失敗したときは、その理由をダイアログで知らせる。
- 復元スナップショットはアプリのデータ領域に、ウインドウごとのファイル
  として保存する。復元用ファイルをユーザーの Markdown ファイル横には
  作らない。
- 通常終了時は復元スナップショットを破棄し、次回起動で前回セッションを
  自動復元しない。
- 起動時に未保存の変更を含む復元スナップショットが残っている場合だけ、
  前回アプリが異常終了したものとして「前回アプリが異常終了しています。
  復元しますか？」の確認ダイアログを表示する。複数のウインドウの分は
  まとめて 1 つのウインドウに復元する。未保存の変更がないスナップショット
  は、確認せずに破棄する。
- 復元を選んだ場合は、開いていたタブ、未保存変更、カーソル位置、
  スクロール位置、ズーム、折り返し、ステータスバー表示を復元する。
  保存済みだったタブはディスクから読み直す。
- 確認ダイアログに答える前にウインドウを閉じた場合は、スナップショットを
  残し、次回起動時にもう一度確認する。
- アプリは単一インスタンスで動く。起動中に Markdown ファイルをダブル
  クリックすると、別のウインドウを立ち上げずに、最後に使っていた
  ウインドウの新しいタブで開く。すでに開いているファイルなら、その
  タブへ切り替える。開けなかったファイルは理由を表示する。

これにより、普段はメモ帳のように素早く開きながら、異常終了時の未保存
内容だけを救済できる設計にします。

## 技術スタック

技術スタックは次のとおりです。

- Tauri v2: デスクトップアプリ基盤。
- React: フロントエンド UI。
- TypeScript: アプリケーションコード。
- Vite: フロントエンド開発とビルド。
- CodeMirror 6: エディタ基盤。
- `@lezer/markdown` + GFM 拡張: エディタ内 Markdown 解析。
- `markdown-it` または互換レンダラー: 印刷や完全レンダリング用途。

## 開発前提

Tauri v2 + React + TypeScript + Vite のアプリを Windows で開発するには、
次が必要です。

- Node.js 26 以上と npm。
- Rust と Cargo。
- Microsoft C++ Build Tools の Desktop development with C++ ワークロード。
- Microsoft Edge WebView2 Runtime。多くの現代的な Windows 環境では既に
  インストール済みです。

## 開発コマンド

依存関係が入っていない環境では、まず次を実行します。

```powershell
npm install
```

フロントエンドだけを起動します。

```powershell
npm run dev
```

フロントエンドの production build を確認します。

```powershell
npm run build
```

Tauri デスクトップアプリとして起動します。

```powershell
npm run tauri dev
```

ブラウザ検査（`tests/playwright/` の 5 種類）をまとめて実行します。
Vite dev server が起動していなければ自動で起動し、終了後に停止します。
Google Chrome がインストールされている必要があります。

```powershell
npm run test:e2e
```

Rust/Tauri 側だけを確認します。

```powershell
cd src-tauri
cargo check
```

Linux（クラウドのコンテナなど）で `cargo check` を実行するには、Tauri が
使う GTK / WebKitGTK の開発パッケージが必要です。Ubuntu 24.04 では次の
とおりです。

```bash
sudo apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libxdo-dev libssl-dev pkg-config build-essential
```

`src-tauri/icons/` のアイコンは `icon.ico` を元に `npx tauri icon` で
生成しています。Linux ビルドは `icon.png` を使います。

## CI

GitHub Actions（`.github/workflows/ci.yml`）で、`main` への push と
pull request ごとに次を実行します。

- Frontend（Ubuntu）: `npm test` の unit test と、`npm run build` による
  型チェックと production build。
- Browser checks（Ubuntu）: Vite dev server を起動し、
  `tests/playwright/` のブラウザ検査をランナー同梱の Google Chrome
  で実行する。Tauri 固有の流れ（復元、保存時の競合、文字コード）は
  `tauri-mock.mjs` で IPC を模して検査する。スクリーンショットは
  Actions の artifact に保存する。Google Chrome がない環境では、環境変数
  `MARKDOWNPAD_CHROMIUM` に Chromium の実行ファイルを指定して実行できる。
- Tauri（Windows）: フロントエンドを build した後、`src-tauri` で
  `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test` を実行する。
  
## 依存関係の更新

`.github/dependabot.yml` で、npm（リポジトリ直下）と Cargo（`src-tauri`）
の依存関係を毎週月曜に確認します。minor / patch 更新はエコシステムごとに
1 つの PR へまとめ、major 更新は個別 PR として確認します。

脆弱性アラートとセキュリティ更新 PR は、GitHub のリポジトリ設定
（Settings > Code security）で Dependabot alerts と Dependabot security
updates を有効にして使います。ローカルでは `npm audit` で同じ脆弱性
データベースを確認できます。

## ネイティブアプリのビルド

Windows で直接起動できる release exe を作るには、リポジトリ直下で次を
実行します。

```powershell
npm run tauri -- build
```

このコマンドは Tauri の `beforeBuildCommand` により、先に
`npm run build` を実行してから Rust/Tauri 側の release build を行います。

生成物は次に作成されます。

```powershell
src-tauri\target\release\markdownpad.exe
```

`cargo clean` などで `src-tauri\target` 配下が消えた場合も、同じ
`npm run tauri -- build` をもう一度実行すれば再生成できます。

現在の Tauri 設定では `bundle.active` が `false` のため、インストーラー
ではなく直接起動用の exe が生成されます。インストーラーを作る場合は、
別途 bundle 設定を有効にします。

参考:

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri window menu](https://v2.tauri.app/learn/window-menu/)
- [Tauri dialog plugin](https://v2.tauri.app/plugin/dialog/)
- [Tauri file system plugin](https://v2.tauri.app/plugin/file-system/)
- [CodeMirror documentation](https://codemirror.net/docs/)
- [@lezer/markdown](https://github.com/lezer-parser/markdown)
- [Vite guide](https://vite.dev/guide/)
- [markdown-it](https://github.com/markdown-it/markdown-it)

## 実装メモ

エディタの中核状態は、文書タブ、エディタ設定、復元スナップショットとして
明示的に扱います。

```ts
export interface DocumentTab {
  id: string;
  title: string;
  path: string | null;
  content: string;
  dirty: boolean;
  cursor: {
    anchor: number;
    head: number;
  };
  scroll: {
    x: number;
    y: number;
  };
  isUntitled: boolean;
  // ディスク上の形式。省略時（古いスナップショット）は UTF-8 / LF。
  encoding?: "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "shift_jis";
  lineEnding?: "lf" | "crlf";
  // 開いた・保存した時点の更新日時とサイズ。外部変更の検出に使う。
  diskStamp?: { modifiedMs: number; size: number } | null;
}

export interface EditorSettings {
  zoom: number;
  wordWrap: boolean;
  showStatusBar: boolean;
}

export interface RecoverySnapshot {
  version: number;
  updatedAt: string;
  activeTabId: string | null;
  tabs: DocumentTab[];
  settings: EditorSettings;
}
```

Tauri 側は、ネイティブメニュー、ファイルダイアログ、ファイル操作
（文字コードと改行コードの変換、外部変更の検出、一時ファイル経由の
書き込み）、印刷ブリッジ、復元データ保存、単一インスタンスの維持（2 つ目の
起動から渡されたファイルを既存ウインドウへ転送する処理）を担当します。
フロントエンドが読み書きできるのは、ダイアログや起動引数で渡されたファイル
と、復元したセッションで開いていたファイルだけです。

フロントエンド側は、タブ状態、dirty 状態、CodeMirror 状態、ライブ
プレビュー装飾、検索/置換、表示設定を担当します。

## テスト計画

MVP では次を確認します。

- メニュー構造とメニューイベントのルーティング。
- 新しいタブ、開く、保存、名前を付けて保存、タブを閉じる、未保存確認。
- 保存前に元ファイルを変更しない手動保存モデル。
- 復元スナップショットの書き込み、正常終了時の破棄、異常終了後の復元確認。
- 見出し、リスト、強調、リンク、表、タスクリスト、コードブロックの
  ライブプレビュー表示。
- カーソル行または編集中ブロックでのソース表示。
- 検索と置換。
- 右端で折り返す、ズーム、ステータスバー、リーディングモードのトグル。

状態ロジックやレンダリング補助は unit test を優先し、アプリシェルが
できた後にエディタ操作を integration/browser/Tauri テストで確認します。

## ロードマップ

1. 完了: Tauri v2 + React + TypeScript + Vite のアプリを scaffold する。
2. 完了: CodeMirror 6 と Markdown 解析を統合する。
3. 完了: ネイティブメニューを定義し、メニューイベントをフロントエンドへ渡す。
4. 完了: タブ状態と手動の開く/保存フローを実装する。
5. 完了: カーソル行ソース表示を含むライブプレビュー装飾を実装する。
6. 完了: アプリ内復元スナップショットと異常終了時の復元確認を実装する。
7. 完了: 検索、置換、ズーム、折り返し、ステータスバー、印刷ブリッジを追加する。
8. 進行中: ファイル安全性、復元、ライブプレビュー挙動を中心にテストを追加する。
