import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadExternalPlugins } from "./external";

beforeEach(() => {
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("external plugin manifests", () => {
  it("fetches the default manifest through the application base", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadExternalPlugins()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith("https://pi.example.test/pi-web-plugins/manifest.json", { cache: "no-store" });
  });
});
