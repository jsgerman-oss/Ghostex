import type {
  GxserverPresentationDelta,
  GxserverProjectId,
  GxserverSessionId,
} from "../../protocol/index.js";

export interface GxserverPresentationCoalescerDecision {
  coalescedCount: number;
  delta: GxserverPresentationDelta;
  key: string;
  reason: string;
}

export interface GxserverPresentationCoalescerOptions {
  delayMs?: number;
  setTimeout?: typeof setTimeout;
}

const DEFAULT_PRESENTATION_DELTA_DELAY_MS = 250;

export class GxserverPresentationDeltaCoalescer {
  readonly #delayMs: number;
  readonly #pending = new Map<string, PendingPresentationDelta>();
  readonly #setTimeout: typeof setTimeout;

  constructor(options: GxserverPresentationCoalescerOptions = {}) {
    this.#delayMs = options.delayMs ?? DEFAULT_PRESENTATION_DELTA_DELAY_MS;
    this.#setTimeout = options.setTimeout ?? setTimeout;
  }

  schedule(
    key: { projectId: GxserverProjectId; sessionId: GxserverSessionId },
    reason: string,
    delta: GxserverPresentationDelta,
    flush: (decision: GxserverPresentationCoalescerDecision) => void,
  ): void {
    const keyText = `${key.projectId}:${key.sessionId}`;
    const existing = this.#pending.get(keyText);
    if (existing) {
      existing.coalescedCount += 1;
      existing.delta = delta;
      existing.reason = reason;
      return;
    }
    const pending: PendingPresentationDelta = {
      coalescedCount: 0,
      delta,
      reason,
    };
    this.#pending.set(keyText, pending);
    /*
    CDXC:GxserverPresentationEvents 2026-06-01-15:08:
    Routine title/status/lifecycle churn is coalesced per session before clients see it. This keeps spinner-like terminal title changes from becoming a WebSocket/log storm while still flushing the newest projected row within the 250ms presentation cadence.
    */
    this.#setTimeout(() => {
      const latest = this.#pending.get(keyText);
      if (!latest) {
        return;
      }
      this.#pending.delete(keyText);
      flush({
        coalescedCount: latest.coalescedCount,
        delta: latest.delta,
        key: keyText,
        reason: latest.reason,
      });
    }, this.#delayMs).unref?.();
  }
}

interface PendingPresentationDelta {
  coalescedCount: number;
  delta: GxserverPresentationDelta;
  reason: string;
}
