// Runs the app as if inside Tauri by installing a scripted stand-in for
// window.__TAURI_INTERNALS__ before the page loads. Commands answer from
// `responses` (a value, { sequence: [...] } answered in order with the last
// one repeating, or { error: "message" } to reject); every call is recorded
// in window.__tauriMock.calls. Tests can fire events with
// window.__tauriMock.emit(event, payload).
export async function installTauriMock(page, { label = "main", responses = {} } = {}) {
  await page.addInitScript(
    ({ label, responses }) => {
      const callbacks = new Map();
      const listeners = new Map();
      let nextCallbackId = 1;
      const mock = {
        calls: [],
        responses,
        emit(event, payload) {
          for (const id of listeners.get(event) ?? []) {
            callbacks.get(id)?.({ event, id, payload });
          }
        },
      };

      function answer(command) {
        const entry = mock.responses[command];

        if (entry === undefined) {
          return null;
        }

        const value =
          entry && Array.isArray(entry.sequence)
            ? entry.sequence.length > 1
              ? entry.sequence.shift()
              : entry.sequence[0]
            : entry;

        if (value && typeof value === "object" && "error" in value) {
          throw value.error;
        }

        return value === undefined ? null : structuredClone(value);
      }

      window.__tauriMock = mock;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener() {},
      };
      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label },
          currentWebview: { label, windowLabel: label },
        },
        transformCallback(callback) {
          const id = nextCallbackId++;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id) {
          callbacks.delete(id);
        },
        convertFileSrc(path, protocol = "asset") {
          return `http://${protocol}.localhost/${encodeURIComponent(path)}`;
        },
        async invoke(command, args) {
          mock.calls.push({ command, args: structuredClone(args ?? {}) });

          if (command === "plugin:event|listen") {
            const ids = listeners.get(args.event) ?? [];
            ids.push(args.handler);
            listeners.set(args.event, ids);
            return args.handler;
          }

          if (command === "plugin:event|unlisten") {
            const ids = listeners.get(args.event) ?? [];
            listeners.set(
              args.event,
              ids.filter((id) => id !== args.eventId),
            );
            return null;
          }

          if (command.startsWith("plugin:")) {
            return null;
          }

          return answer(command);
        },
      };
    },
    { label, responses },
  );
}

export function tauriCalls(page, command) {
  return page.evaluate(
    (command) =>
      window.__tauriMock.calls
        .filter((call) => call.command === command)
        .map((call) => call.args),
    command,
  );
}

export function setTauriResponse(page, command, response) {
  return page.evaluate(
    ({ command, response }) => {
      window.__tauriMock.responses[command] = response;
    },
    { command, response },
  );
}
