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
- 手動保存を基本としたアプリ内復元スナップショット。
- 前回のタブ、未保存内容、カーソル位置、スクロール位置、表示設定の復元。

## ライブプレビュー編集

既定の編集モードはライブプレビューです。

- 編集中も Markdown を整形表示する。
- カーソルのある行では、`#`、`-`、`*`、リンク構文、コード記号などの
  Markdown ソースを表示する。
- カーソル外の行は Markdown として整形表示したままにする。
- 表、画像、フェンス付きコードブロックなどは、カーソルが内部にある間、
  ブロック全体をソース表示に戻してレイアウトの揺れを抑える。

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

## 保存と復元

MarkdownPad は手動保存を基本にします。

- 元ファイルは、ユーザーが「保存」または「名前を付けて保存」を選んだ
  ときだけ変更する。
- 復元スナップショットはアプリのデータ領域に保存する。
- 復元用ファイルをユーザーの Markdown ファイル横には作らない。
- 起動時には、開いていたタブ、未保存変更、カーソル位置、スクロール位置、
  ズーム、折り返し、ステータスバー表示を復元する。

これにより、クラッシュ復元を持ちながら、元ファイルを意図せずバック
グラウンドで書き換えない設計にします。

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
- 復元スナップショットの書き込みと起動時復元。
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
6. アプリ内復元スナップショットとセッション復元を実装する。
7. 検索、置換、ズーム、折り返し、ステータスバー、印刷ブリッジを追加する。
8. ファイル安全性、復元、ライブプレビュー挙動を中心にテストを追加する。
