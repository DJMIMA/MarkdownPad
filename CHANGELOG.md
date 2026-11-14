# 変更履歴

このプロジェクトの主な変更をここに記録します。

書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョン番号は [Semantic Versioning](https://semver.org/lang/ja/) に
従います。

## [Unreleased]

## [0.3.0] - 2026-11-14

Linux 向けの機能を加えたリリースです。配布する Windows 版の動作は
0.2.0 から変わりません。

### 追加

- Linux でも「開く」「名前を付けて保存」のファイルダイアログが使える
  ようになった（GTK のダイアログ。デスクトップポータルがあればその
  ダイアログ）。
- Linux でも「設定」からファイルの関連付けを登録・解除できるように
  なった。`~/.local/share/applications` にデスクトップエントリを置き、
  利用者の `mimeapps.list` で `.md` / `.markdown` の既定のアプリにする。

## [0.2.0] - 2026-11-06

### 追加

- 「ファイル」メニューに「設定」（`Ctrl+,`）を追加した。設定画面から
  `.md` / `.markdown` ファイルの関連付けを登録・解除できる。登録は
  現在のユーザーだけに行い、管理者権限は要らない。既定のアプリは
  Windows の仕様上アプリから変更できないため、登録後に Windows の
  「既定のアプリ」設定の MarkdownPad のページを開く。

## [0.1.1] - 2026-11-01

アプリの動作は 0.1.0 から変わりません。ライセンスを定め、説明書きを
利用者向けに整えたリリースです。

### 追加

- MIT ライセンスで公開した。配布する zip に `LICENSE.txt` を入れる。
- 組み込んでいる npm パッケージと Rust クレートのライセンス文を
  まとめた `THIRD-PARTY-NOTICES.txt` を zip に入れる。0.1.0 の zip には
  入っていなかった。

### 変更

- README を利用者向けに書き直した。インストールの手順、`.md` ファイルの
  関連付け、更新とアンインストール、使い方、キーボードショートカットを
  載せている。
- ビルドやリリースなど開発者向けの説明を `docs/development.md` に移した。

## [0.1.0] - 2026-11-01

最初の正式リリースです。Windows 向けに、インストーラーなしで直接起動
できる実行ファイルを zip で配布します。

### 追加

- 単体の Markdown ファイルを開く、編集する、保存する、名前を付けて保存する。
- タブ表示、新しいタブ、新しいウインドウ。
- Obsidian 風のライブプレビュー編集。カーソルのある行と、編集中の表・
  コードブロック・罫線だけ Markdown ソースを表示する。
- CommonMark + GitHub Flavored Markdown の表示（見出し、強調、引用、
  リスト、タスクリスト、リンク、画像、コード、表、取り消し線）。
- リストの `Enter` / `Shift+Enter` / `Tab` / `Shift+Tab` 操作。
- 検索と置換。
- 拡大・縮小・既定値に戻す、右端で折り返す、ステータスバーの切り替え。
- 編集できないリーディングモード（`Ctrl+E`）。
- ライト / ダークのテーマと、トップバーの切り替えボタン。
- 印刷。
- UTF-8（BOM の有無）、UTF-16、Shift_JIS と改行コード（LF / CRLF）の
  読み込みと、開いたときの形式での保存。
- ほかのアプリによる変更を検出し、上書き前に確認する。
- 異常終了したときだけ、前回の未保存の内容を復元するか確認する。
- 単一インスタンスでの起動。2 つ目の起動で渡されたファイルは、最後に
  使っていたウインドウの新しいタブで開く。
- アプリのアイコン。

[Unreleased]: https://github.com/DJMIMA/MarkdownPad/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/DJMIMA/MarkdownPad/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/DJMIMA/MarkdownPad/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/DJMIMA/MarkdownPad/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/DJMIMA/MarkdownPad/releases/tag/v0.1.0
