# 変更履歴

このプロジェクトの主な変更をここに記録します。

書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に、
バージョン番号は [Semantic Versioning](https://semver.org/lang/ja/) に
従います。

## [Unreleased]

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

[Unreleased]: https://github.com/DJMIMA/MarkdownPad/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DJMIMA/MarkdownPad/releases/tag/v0.1.0
