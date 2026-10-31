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
  // Print what the editor shows: no smart quotes, (c) -> (C) or -- -> dash.
  typographer: false,
});

type ImageResolver = (source: string) => string | null;

// GFM task list items ("- [ ] todo", "- [x] done") print as check boxes,
// like the editor shows them, instead of the literal brackets.
renderer.core.ruler.after("inline", "markdownpad-task-lists", (state) => {
  const tokens = state.tokens;

  for (let index = 2; index < tokens.length; index += 1) {
    const inline = tokens[index];

    if (
      inline.type !== "inline" ||
      tokens[index - 1].type !== "paragraph_open" ||
      tokens[index - 2].type !== "list_item_open"
    ) {
      continue;
    }

    const match = /^\[([ xX])\][ \t]+/.exec(inline.content);
    const first = inline.children?.[0];

    if (!match || !first || first.type !== "text" || !first.content.startsWith(match[0])) {
      continue;
    }

    const checked = match[1] !== " ";
    first.content = first.content.slice(match[0].length);
    const box = new state.Token("html_inline", "", 0);
    box.content = `<span class="task-box${checked ? " checked" : ""}" aria-hidden="true">${checked ? "☑" : "☐"}</span> `;
    inline.children?.unshift(box);
    tokens[index - 2].attrJoin("class", "task-list-item");
  }
});

// Image paths are resolved like in the editor (relative to the file), since
// the print window has no notion of the document's folder.
const defaultImageRule = renderer.renderer.rules.image;

renderer.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const source = token.attrGet("src");
  const resolveImage = (env as { resolveImage?: ImageResolver } | undefined)?.resolveImage;

  if (source && resolveImage) {
    const resolved = resolveImage(String(source));

    if (resolved) {
      token.attrSet("src", resolved);
    } else {
      token.attrSet("src", "");
    }
  }

  return defaultImageRule
    ? defaultImageRule(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options);
};

const printStyles = `
  body {
    margin: 0;
    background: #ffffff;
  }

  .markdown-print-document {
    margin: 48px auto;
    max-width: 760px;
    color: #222222;
    font-family: "Segoe UI Variable Text", "Segoe UI", "Yu Gothic UI",
      "Hiragino Sans", "Meiryo", system-ui, sans-serif;
    line-height: 1.6;
  }

  .markdown-print-document h1,
  .markdown-print-document h2,
  .markdown-print-document h3,
  .markdown-print-document h4,
  .markdown-print-document h5,
  .markdown-print-document h6 {
    color: #222222;
    line-height: 1.3;
  }

  .markdown-print-document h1 {
    font-size: 1.8em;
  }

  .markdown-print-document code,
  .markdown-print-document pre {
    font-family: "Cascadia Mono", "Consolas", "BIZ UDGothic", monospace;
    font-size: 0.875em;
  }

  .markdown-print-document :not(pre) > code {
    padding: 0.1em 0.25em;
    border-radius: 3px;
    background: #f2f2f2;
  }

  .markdown-print-document pre code {
    font-size: 1em;
  }

  .markdown-print-document pre {
    padding: 12px 16px;
    overflow: auto;
    border-radius: 4px;
    background: #f6f6f6;
  }

  .markdown-print-document li.task-list-item {
    list-style: none;
  }

  .markdown-print-document .task-box {
    display: inline-block;
    width: 1.2em;
    margin-left: -1.3em;
  }

  .markdown-print-document blockquote {
    margin-left: 0;
    padding-left: 1em;
    border-left: 2px solid #2f6bd0;
    color: #3d3d3d;
  }

  .markdown-print-document table {
    width: auto;
    max-width: 100%;
    border-collapse: collapse;
  }

  .markdown-print-document th,
  .markdown-print-document td {
    border: 1px solid #dedede;
    padding: 5px 12px;
    text-align: left;
  }

  .markdown-print-document th {
    background: #f6f6f6;
  }

  .markdown-print-document a {
    color: #2f6bd0;
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

    /* Paper cannot scroll: wrap long code lines and table cells instead of
       cutting them off at the page edge. */
    .markdown-print-document pre {
      overflow: visible;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .markdown-print-document th,
    .markdown-print-document td {
      overflow-wrap: anywhere;
    }

    .markdown-print-document pre,
    .markdown-print-document tr,
    .markdown-print-document img {
      break-inside: avoid;
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

export function markdownToSafeHtml(
  markdown: string,
  resolveImage?: (source: string) => string | null,
) {
  return sanitizeWithDomPurify(renderer.render(markdown, { resolveImage }));
}

export function markdownPrintDocument(
  markdown: string,
  title: string,
  resolveImage?: (source: string) => string | null,
) {
  return {
    title,
    bodyHtml: markdownToSafeHtml(markdown, resolveImage),
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
