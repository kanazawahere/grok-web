import { describe, expect, it } from "vitest";
import type { PiPackageInfo } from "../../api";
import { canUpdateAllPiPackages, isPiPackageOperationPending, normalizePiPackageSource, piPackageFilteredLabel, piPackageMutationFollowUpMessage, piPackageScopeLabel, piPackageSourceValidationMessage, piPackageUpdateDisabledReason, updateAllPiPackagesDisabledReason } from "./piPackageSettings";

const userPackage: PiPackageInfo = { source: "npm:@acme/tools", scope: "user", filtered: false, installedPath: "/home/test/.pi/packages/tools" };
const projectPackage: PiPackageInfo = { source: "../project-tools", scope: "project", filtered: true };

describe("Pi package settings helpers", () => {
  it("normalizes and validates install sources without adding location choices", () => {
    expect(normalizePiPackageSource("  npm:@acme/tools  ")).toBe("npm:@acme/tools");
    expect(piPackageSourceValidationMessage("  npm:@acme/tools  ")).toBeUndefined();
    expect(piPackageSourceValidationMessage("   ")).toContain("Pi package source accepted by Pi");
  });

  it("formats package metadata with Pi package terminology", () => {
    expect(piPackageScopeLabel(userPackage)).toBe("User scope");
    expect(piPackageScopeLabel(projectPackage)).toBe("Project scope");
    expect(piPackageFilteredLabel(userPackage)).toBe("Available in this PI WEB process");
    expect(piPackageFilteredLabel(projectPackage)).toBe("Filtered by current Pi package settings");
  });

  it("allows updates for user-scope packages and explains project-scope limits", () => {
    expect(piPackageUpdateDisabledReason(userPackage)).toBeUndefined();
    expect(piPackageUpdateDisabledReason(projectPackage)).toContain("user-scope Pi packages");
    expect(canUpdateAllPiPackages([userPackage])).toBe(true);
    expect(canUpdateAllPiPackages([userPackage, projectPackage])).toBe(false);
    expect(updateAllPiPackagesDisabledReason([])).toBe("No Pi packages are configured yet.");
    expect(updateAllPiPackagesDisabledReason([userPackage, projectPackage])).toContain("project-scope Pi packages");
  });

  it("matches pending operations by action and source", () => {
    expect(isPiPackageOperationPending({ kind: "remove", source: "npm:@acme/tools" }, "remove", "npm:@acme/tools")).toBe(true);
    expect(isPiPackageOperationPending({ kind: "remove", source: "npm:@acme/tools" }, "remove", "npm:@acme/other")).toBe(false);
    expect(isPiPackageOperationPending({ kind: "update-all" }, "update-all")).toBe(true);
  });

  it("describes the browser and session reload follow-up without requiring sessiond restarts", () => {
    const message = piPackageMutationFollowUpMessage("install");

    expect(message).toContain("Reload the browser page");
    expect(message).toContain("Reload existing Pi sessions");
    expect(message).not.toContain("session daemon");
    expect(message).not.toContain("sessiond");
  });
});
