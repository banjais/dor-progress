import { assign, createMachine } from "xstate";

import type { ProjectReport } from "./api-utils.js";

// Fix: api-utils is in the same directory

export interface ReportContext {
  report: ProjectReport | null;
  error: string | null;
}

export type ReportEvent =
  | { type: "FETCH" }
  | { type: "RESOLVE"; report: ProjectReport }
  | { type: "REJECT"; message: string }
  | { type: "RETRY" };

export const reportMachine = createMachine<ReportContext, ReportEvent>({
  id: "reportData",
  initial: "idle",
  context: {
    report: null,
    error: null,
  },
  states: {
    idle: {
      on: {
        FETCH: "loading",
      },
    },
    loading: {
      entry: assign({ report: null, error: null }), // Clear previous data/errors
      on: {
        RESOLVE: {
          target: "success",
          actions: assign({
            report: (_: ReportContext, event: ReportEvent) =>
              event.type === "RESOLVE" ? event.report : null,
            error: null,
          }),
        },
        REJECT: {
          target: "error",
          actions: assign({
            error: (_: ReportContext, event: ReportEvent) =>
              event.type === "REJECT" ? event.message : null,
            report: null,
          }),
        },
      },
    },
    success: {
      on: { FETCH: "loading" }, // Allow re-fetching from success state
    },
    error: {
      on: { RETRY: "loading", FETCH: "loading" }, // Allow retry or direct fetch from error state
    },
  },
});
