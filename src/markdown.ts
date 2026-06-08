import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

export interface MarkdownPrintDocument {
  title: string;
  bodyHtml: string;
  styles: string;
}

const renderer = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: true,
});

const printStyles = `
  body {
    margin: 0;
    background: #ffffff;
  }

  .markdown-print-document {
    margin: 48px auto;
    max-width: 820px;
    color: #202d30;
    font-family: "Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Meiryo", sans-serif;
    line-height: 1.7;
  }

  .markdown-print-document h1,
  .markdown-print-document h2,
  .markdown-print-document h3,
  .markdown-print-document h4,
  .markdown-print-document h5,
  .markdown-print-document h6 {
    color: #12364f;
    line-height: 1.25;
  }

  .markdown-print-document h1 {
    border-bottom: 1px solid #d9e2e4;
    padding-bottom: 0.2em;
  }

  .markdown-print-document code,
  .markdown-print-document pre {
    font-family: "Cascadia Mono", "Consolas", monospace;
  }

  .markdown-print-document pre {
    padding: 16px;
    overflow: auto;
    border: 1px solid #d9d4ca;
    border-radius: 8px;
    background: #f1f4f2;
  }

  .markdown-print-document blockquote {
    margin-left: 0;
    padding-left: 1em;
    border-left: 3px solid #8fb3b5;
    color: #4a5e62;
  }

  .markdown-print-document table {
    width: auto;
    max-width: 100%;
    border-collapse: collapse;
  }

  .markdown-print-document th,
  .markdown-print-document td {
    border: 1px solid #d6ddd9;
    padding: 7px 10px;
    text-align: left;
  }

  .markdown-print-document th {
    background: #edf3f2;
  }

  .markdown-print-document a {
    color: #0a5da8;
  }

  .markdown-print-document img {
    max-width: 100%;
  }

  @page {
    margin: 18mm;
  }

  @media print {
    .markdown-print-document {
      margin: 0;
      max-width: none;
    }
  }
`;

function sanitizeWithDomPurify(html: string) {
  const purifier = DOMPurify as typeof DOMPurify & {
    sanitize?: typeof DOMPurify.sanitize;
  };

  if (typeof purifier.sanitize !== "function") {
    return html;
  }

  return purifier.sanitize(html, {
    USE_PROFILES: {
      html: true,
    },
  });
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function markdownToSafeHtml(markdown: string) {
  return sanitizeWithDomPurify(renderer.render(markdown));
}

export function markdownPrintDocument(markdown: string, title: string) {
  return {
    title,
    bodyHtml: markdownToSafeHtml(markdown),
    styles: printStyles,
  };
}

export function markdownPrintDocumentHtml(document: MarkdownPrintDocument) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(document.title)}</title>
    <style>${document.styles}</style>
  </head>
  <body>
    <main class="markdown-print-document">${document.bodyHtml}</main>
  </body>
</html>`;
}
