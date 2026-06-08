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
- 自動リンク。

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
- 右端で折り返す
- ステータスバー

「右端で折り返す」と「ステータスバー」はトグルメニューです。

## テーマ（外観）

ライトテーマとダークテーマに対応します。

- 初回起動時は OS の配色設定（`prefers-color-scheme`）に追従する。
- タブ右側のトグルボタンでライト / ダークを切り替えられる。切り替えると
  その選択を `localStorage` に保存し、次回以降も維持する。
- テーマは復元スナップショットとは独立した端末ごとの設定として扱う。
- エディタ本体とアプリ枠（タブ、ステータスバー、ダイアログ、検索パネル）の
  両方が同じテーマトークンで配色される。
- 印刷ページは用紙に合わせて常にライト表示を維持する。

メニュー仕様を小さく保つ方針は維持し、テーマ切り替えだけを低ノイズな
トップバーのアイコンボタンとして追加しています。

## 保存と復元

MarkdownPad は手動保存を基本にします。

- 元ファイルは、ユーザーが「保存」または「名前を付けて保存」を選んだ
  ときだけ変更する。
- 復元スナップショットはアプリのデータ領域に保存する。
- 復元用ファイルをユーザーの Markdown ファイル横には作らない。
- 通常終了時は復元スナップショットを破棄し、次回起動で前回セッションを
  自動復元しない。
- 起動時に復元スナップショットが残っている場合だけ、前回アプリが異常終了
  したものとして「前回アプリが異常終了しています。復元しますか？」の確認
  ダイアログを表示する。
- 復元を選んだ場合は、開いていたタブ、未保存変更、カーソル位置、
  スクロール位置、ズーム、折り返し、ステータスバー表示を復元する。

これにより、普段はメモ帳のように素早く開きながら、異常終了時の未保存
内容だけを救済できる設計にします。

## 技術スタック

予定している技術スタックは次のとおりです。

- Tauri v2: デスクトップアプリ基盤。
- React: フロントエンド UI。
- TypeScript: アプリケーションコード。
- Vite: フロントエンド開発とビルド。
- CodeMirror 6: エディタ基盤。
- `@lezer/markdown` + GFM 拡張: エディタ内 Markdown 解析。
- `markdown-it` または互換レンダラー: 印刷や完全レンダリング用途。

## 開発前提

このリポジトリは現在、仕様ドキュメントと Tauri v2 + React + TypeScript +
Vite の初期 scaffold を含みます。

予定している Tauri アプリを Windows で開発するには、次が必要です。

- Node.js と npm。
- Rust と Cargo。
- Microsoft C++ Build Tools の Desktop development with C++ ワークロード。
- Microsoft Edge WebView2 Runtime。多くの現代的な Windows 環境では既に
  インストール済みです。

初期確認時点のローカル環境では Node.js と npm は利用可能で、Rust/Cargo は
後から導入されました。導入後、フロントエンドの production build と
Tauri/Rust 側の `cargo check` は通過しています。

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

Rust/Tauri 側だけを確認します。

```powershell
cd src-tauri
cargo check
```

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

Tauri 側は、ネイティブメニュー、ファイルダイアログ、ファイル操作、
印刷ブリッジ、復元データ保存を担当します。

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
- 右端で折り返す、ズーム、ステータスバーのトグル。

状態ロジックやレンダリング補助は unit test を優先し、アプリシェルが
できた後にエディタ操作を integration/browser/Tauri テストで確認します。

## ロードマップ

1. 完了: Tauri v2 + React + TypeScript + Vite のアプリを scaffold する。
2. 進行中: CodeMirror 6 と Markdown 解析を統合する。
3. ネイティブメニューを定義し、メニューイベントをフロントエンドへ渡す。
4. タブ状態と手動の開く/保存フローを実装する。
5. カーソル行ソース表示を含むライブプレビュー装飾を実装する。
6. アプリ内復元スナップショットと異常終了時の復元確認を実装する。
7. 検索、置換、ズーム、折り返し、ステータスバー、印刷ブリッジを追加する。
8. ファイル安全性、復元、ライブプレビュー挙動を中心にテストを追加する。
