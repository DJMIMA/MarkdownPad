interface StatusBarProps {
  path: string | null;
  dirty: boolean;
  line: number;
  column: number;
  characters: number;
  words: number;
  wordWrap: boolean;
}

export function StatusBar({
  path,
  dirty,
  line,
  column,
  characters,
  words,
  wordWrap,
}: StatusBarProps) {
  return (
    <footer className="status-bar">
      <span>{path ?? "未保存の Markdown"}</span>
      <span>
        行 {line}, 列 {column}
      </span>
      <span>{characters} 文字</span>
      <span>{words} 語</span>
      <span>{dirty ? "未保存" : "保存済み"}</span>
      <span>{wordWrap ? "折り返し" : "折り返しなし"}</span>
    </footer>
  );
}
