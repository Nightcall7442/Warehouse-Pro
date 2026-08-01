import { describe, it, expect, vi, beforeEach } from "vitest";
import { sseBus } from "./sse";

/**
 * FIX: P2.3 — shutdown behaviour of the SSE bus.
 *
 * A stream nobody closes keeps the process alive until the platform SIGKILLs it,
 * so "closeAll ends every stream, even the broken ones" is the property that
 * matters here.
 */

type FakeController = {
  enqueue: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  chunks: string[];
};

function fakeController(opts: { throwOnEnqueue?: boolean; throwOnClose?: boolean } = {}): FakeController {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  return {
    chunks,
    enqueue: vi.fn((chunk: Uint8Array) => {
      if (opts.throwOnEnqueue) throw new TypeError("Controller is already closed");
      chunks.push(decoder.decode(chunk));
    }),
    close: vi.fn(() => {
      if (opts.throwOnClose) throw new TypeError("Controller is already closed");
    }),
  };
}

const subscribe = (tenantId: number, userId: number, controller: FakeController) =>
  sseBus.subscribe(tenantId, userId, controller as unknown as ReadableStreamDefaultController);

beforeEach(() => {
  // Each test starts from an empty bus — closeAll is also the reset.
  sseBus.closeAll();
});

describe("sseBus.closeAll", () => {
  it("closes every listener across every tenant and reports the count", () => {
    const a = fakeController();
    const b = fakeController();
    const c = fakeController();
    subscribe(1, 10, a);
    subscribe(1, 11, b);
    subscribe(2, 20, c);
    expect(sseBus.getStats()).toEqual({ channels: 2, totalListeners: 3 });

    expect(sseBus.closeAll()).toBe(3);

    expect(a.close).toHaveBeenCalledTimes(1);
    expect(b.close).toHaveBeenCalledTimes(1);
    expect(c.close).toHaveBeenCalledTimes(1);
    expect(sseBus.getStats()).toEqual({ channels: 0, totalListeners: 0 });
  });

  it("tells the client why, so a reconnect is an expected reconnect", () => {
    const controller = fakeController();
    subscribe(1, 10, controller);

    sseBus.closeAll();

    const sent = controller.chunks.join("");
    expect(sent).toContain("event: shutdown");
    expect(sent).toContain('"reason":"server_shutdown"');
    // SSE frames must end with a blank line or the client buffers them.
    expect(sent.endsWith("\n\n")).toBe(true);
  });

  it("accepts a custom reason", () => {
    const controller = fakeController();
    subscribe(1, 10, controller);

    sseBus.closeAll("redeploy");

    expect(controller.chunks.join("")).toContain('"reason":"redeploy"');
  });

  it("still closes a stream whose enqueue throws", () => {
    const broken = fakeController({ throwOnEnqueue: true });
    const healthy = fakeController();
    subscribe(1, 10, broken);
    subscribe(1, 11, healthy);

    expect(sseBus.closeAll()).toBe(2);
    expect(broken.close).toHaveBeenCalled();
    expect(healthy.close).toHaveBeenCalled();
  });

  it("survives a controller that is already closed", () => {
    const gone = fakeController({ throwOnEnqueue: true, throwOnClose: true });
    subscribe(1, 10, gone);

    // Counted only when the close actually succeeds.
    expect(sseBus.closeAll()).toBe(0);
    expect(sseBus.getStats().totalListeners).toBe(0);
  });

  it("is a no-op with nothing connected, and is safe to call twice", () => {
    expect(sseBus.closeAll()).toBe(0);
    expect(sseBus.closeAll()).toBe(0);
  });

  it("leaves the bus usable for a new subscriber afterwards", () => {
    subscribe(1, 10, fakeController());
    sseBus.closeAll();

    const fresh = fakeController();
    const unsubscribe = subscribe(1, 12, fresh);
    expect(sseBus.getStats().totalListeners).toBe(1);
    unsubscribe();
    expect(sseBus.getStats().totalListeners).toBe(0);
  });
});
