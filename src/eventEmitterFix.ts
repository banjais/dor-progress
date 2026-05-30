// src/eventEmitterFix.ts
// Global fix for MaxListenersExceededWarning in a TypeScript ESM project.
// This file imports the Node.js EventEmitter (or compatible polyfill) and
// increases the default maximum number of listeners from the default (10)
// to a safer higher value. Import this module as early as possible (e.g.,
// at the top of src/main.ts) so the setting applies before any listeners
// are registered.
import { EventEmitter } from "events";

// Adjust the global default for all EventEmitter instances.
EventEmitter.defaultMaxListeners = 30;

// For environments that use a polyfilled EventEmitter (e.g., events package
// bundled for the browser), also set the prototype to be safe.
if (
  (EventEmitter as any).prototype &&
  typeof (EventEmitter as any).prototype.setMaxListeners === "function"
) {
  (EventEmitter as any).prototype.setMaxListeners(30);
}
