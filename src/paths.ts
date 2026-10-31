// Small path helpers for resolving image references in a document. Paths
// come from the Rust side as Windows paths (C:\notes\a.md, \\server\share\a.md)
// or, on other systems, POSIX paths.

export function isAbsolutePath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || /^[\\/]/.test(path);
}

export function directoryOf(path: string) {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index >= 0 ? path.slice(0, index) : "";
}

/**
 * Joins a document's directory and a relative reference such as
 * "images/a.png" or "../shared/b.png", using the directory's separator.
 */
export function joinPath(directory: string, relative: string) {
  const separator = directory.includes("\\") ? "\\" : "/";
  const prefix = /^(\\\\|\/\/)/.test(directory)
    ? directory.slice(0, 2)
    : /^[\\/]/.test(directory)
      ? directory[0]
      : "";
  const segments = directory.slice(prefix.length).split(/[\\/]+/).filter(Boolean);
  const root = segments.length > 0 && /^[a-zA-Z]:$/.test(segments[0]) ? 1 : 0;

  for (const part of relative.split(/[\\/]+/)) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (segments.length > root) {
        segments.pop();
      }

      continue;
    }

    segments.push(part);
  }

  return prefix + segments.join(separator);
}

/** file:///C:/a%20b.png -> C:\a b.png ; file:///home/a.png -> /home/a.png */
export function fileUrlToPath(url: string) {
  const parsed = new URL(url);
  const pathname = decodeURIComponent(parsed.pathname);

  if (parsed.host) {
    return `\\\\${parsed.host}${pathname.replace(/\//g, "\\")}`;
  }

  return /^\/[a-zA-Z]:/.test(pathname)
    ? pathname.slice(1).replace(/\//g, "\\")
    : pathname;
}

export function decodePathReference(reference: string) {
  try {
    return decodeURI(reference);
  } catch {
    return reference;
  }
}

/**
 * Turns an image reference from a document into a URL the webview can load.
 * Web and data URLs are used as they are. Inside Tauri (`toFileUrl` given),
 * relative paths are resolved against the document's folder, and absolute
 * paths and file: URLs are served through the asset protocol. Anything else
 * (other schemes, or a relative path in a never-saved document) shows no
 * image. Without Tauri only what the web server can serve is shown.
 */
export function resolveImageReference(
  source: string,
  documentPath: string | null,
  toFileUrl: ((path: string) => string) | null,
): string | null {
  const reference = source.trim();

  if (!reference) {
    return null;
  }

  if (/^(https?:|data:image\/)/i.test(reference)) {
    return reference;
  }

  const hasScheme =
    /^[a-z][a-z0-9+.-]*:/i.test(reference) && !/^[a-z]:[\\/]/i.test(reference);

  if (!toFileUrl) {
    return hasScheme ? null : reference;
  }

  let path: string | null = null;

  if (/^file:/i.test(reference)) {
    try {
      path = fileUrlToPath(reference);
    } catch {
      return null;
    }
  } else if (hasScheme) {
    return null;
  } else {
    const decoded = decodePathReference(reference);

    if (isAbsolutePath(decoded)) {
      path = decoded;
    } else if (documentPath) {
      path = joinPath(directoryOf(documentPath), decoded);
    }
  }

  return path ? toFileUrl(path) : null;
}
