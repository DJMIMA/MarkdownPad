import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const renderer = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

export function markdownToSafeHtml(markdown: string) {
  return DOMPurify.sanitize(renderer.render(markdown), {
    USE_PROFILES: {
      html: true,
    },
  });
}

export function markdownPrintDocument(markdown: string, title: string) {
  const safeTitle = DOMPurify.sanitize(title);
  const safeBody = markdownToSafeHtml(markdown);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${safeTitle}</title>
    <style>
      body {
        margin: 48px auto;
        max-width: 820px;
        color: #202d30;
        font-family: "Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Meiryo", sans-serif;
        line-height: 1.7;
      }
      h1, h2, h3, h4, h5, h6 {
        color: #12364f;
        line-height: 1.25;
      }
      h1 {
        border-bottom: 1px solid #d9e2e4;
        padding-bottom: 0.2em;
      }
      code, pre {
        font-family: "Cascadia Mono", "Consolas", monospace;
      }
      pre {
        padding: 16px;
        overflow: auto;
        border: 1px solid #d9d4ca;
        border-radius: 8px;
        background: #f1f4f2;
      }
      blockquote {
        margin-left: 0;
        padding-left: 1em;
        border-left: 3px solid #8fb3b5;
        color: #4a5e62;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid #d6ddd9;
        padding: 7px 10px;
        text-align: left;
      }
      th {
        background: #edf3f2;
      }
      img {
        max-width: 100%;
      }
    </style>
  </head>
  <body>${safeBody}</body>
</html>`;
}
