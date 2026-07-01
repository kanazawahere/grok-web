import { describe, expect, it, vi } from "vitest";
import type { PiPackageInfo } from "../shared/apiTypes.js";
import { DefaultPiPackageService, type PiPackageManagerPort } from "./piPackageService.js";

function fakeManager(packages: PiPackageInfo[] = []) {
  const listConfiguredPackages = vi.fn<PiPackageManagerPort["listConfiguredPackages"]>(() => packages);
  const installAndPersist = vi.fn<PiPackageManagerPort["installAndPersist"]>(() => Promise.resolve());
  const removeAndPersist = vi.fn<PiPackageManagerPort["removeAndPersist"]>(() => Promise.resolve(true));
  const update = vi.fn<PiPackageManagerPort["update"]>(() => Promise.resolve());
  const manager: PiPackageManagerPort = { listConfiguredPackages, installAndPersist, removeAndPersist, update };
  return { manager, listConfiguredPackages, installAndPersist, removeAndPersist, update };
}

describe("DefaultPiPackageService", () => {
  it("lists configured Pi packages with source, scope, filtered status, and installed path", async () => {
    const fake = fakeManager([
      { source: "npm:@acme/user-tools", scope: "user", filtered: false, installedPath: "/home/test/.pi/packages/user-tools" },
      { source: "../project-tools", scope: "project", filtered: true },
    ]);
    const service = new DefaultPiPackageService(fake.manager);

    await expect(service.list()).resolves.toEqual({
      packages: [
        { source: "npm:@acme/user-tools", scope: "user", filtered: false, installedPath: "/home/test/.pi/packages/user-tools" },
        { source: "../project-tools", scope: "project", filtered: true },
      ],
    });
  });

  it("installs through the default Pi package-manager behavior without a local option", async () => {
    const fake = fakeManager([{ source: "npm:@acme/tools", scope: "user", filtered: false }]);
    const service = new DefaultPiPackageService(fake.manager);

    const response = await service.install("npm:@acme/tools");

    expect(fake.installAndPersist).toHaveBeenCalledWith("npm:@acme/tools");
    expect(response).toEqual({ action: "install", source: "npm:@acme/tools", packages: [{ source: "npm:@acme/tools", scope: "user", filtered: false }] });
  });

  it("removes user packages by default and project packages only when the known scope is supplied", async () => {
    const fake = fakeManager();
    const service = new DefaultPiPackageService(fake.manager);

    await service.remove("npm:@acme/user-tools");
    await service.remove("../project-tools", "project");

    expect(fake.removeAndPersist).toHaveBeenNthCalledWith(1, "npm:@acme/user-tools");
    expect(fake.removeAndPersist).toHaveBeenNthCalledWith(2, "../project-tools", { local: true });
  });

  it("updates all configured packages or a single source", async () => {
    const fake = fakeManager();
    const service = new DefaultPiPackageService(fake.manager);

    await service.update();
    await service.update("npm:@acme/tools");

    expect(fake.update).toHaveBeenNthCalledWith(1);
    expect(fake.update).toHaveBeenNthCalledWith(2, "npm:@acme/tools");
  });
});
