import { useEffect, useMemo, useRef } from "react";
import {
  closeCurrentWindow,
  discardStoredPrintDocument,
  readStoredPrintDocument,
} from "./platform";

function currentPrintDocumentId() {
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get("print");
}

function waitForImages(container: HTMLElement) {
  const pendingImages = Array.from(container.querySelectorAll("img")).filter(
    (image) => !image.complete,
  );

  if (pendingImages.length === 0) {
    return Promise.resolve();
  }

  const loaded = Promise.all(
    pendingImages.map(
      (image) =>
        new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
  const timeout = new Promise<void>((resolve) => {
    window.setTimeout(resolve, 1200);
  });

  return Promise.race([loaded, timeout]);
}

function closeAfterPrint() {
  window.setTimeout(() => {
    void closeCurrentWindow();
  }, 100);
}

export function PrintPage() {
  const documentRef = useRef<HTMLElement | null>(null);
  const printDocumentId = useMemo(() => currentPrintDocumentId(), []);
  const printDocument = useMemo(
    () =>
      printDocumentId ? readStoredPrintDocument(printDocumentId) : null,
    [printDocumentId],
  );

  useEffect(() => {
    document.body.classList.add("print-route");
    return () => document.body.classList.remove("print-route");
  }, []);

  useEffect(() => {
    if (printDocument) {
      document.title = `印刷 - ${printDocument.title}`;
    }
  }, [printDocument]);

  useEffect(() => {
    if (!printDocument || !printDocumentId) {
      return;
    }

    let canceled = false;

    const finishPrint = () => {
      discardStoredPrintDocument(printDocumentId);
      closeAfterPrint();
    };

    window.addEventListener("afterprint", finishPrint, { once: true });

    const timer = window.setTimeout(() => {
      void (async () => {
        if (document.fonts) {
          await document.fonts.ready;
        }

        if (documentRef.current) {
          await waitForImages(documentRef.current);
        }

        if (!canceled) {
          window.focus();
          window.print();
        }
      })();
    }, 150);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", finishPrint);
    };
  }, [printDocument, printDocumentId]);

  if (!printDocument) {
    return (
      <main className="print-missing">
        <h1>印刷データが見つかりません</h1>
      </main>
    );
  }

  return (
    <>
      <style>{printDocument.styles}</style>
      <main
        className="markdown-print-document"
        ref={documentRef}
        dangerouslySetInnerHTML={{
          __html: printDocument.bodyHtml,
        }}
      />
    </>
  );
}
