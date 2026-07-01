import type { PiPackageInfo, PiPackageMutationAction } from "../../api";

export type PiPackageOperationKind = PiPackageMutationAction | "update-all";

export interface PiPackageOperationState {
  kind: PiPackageOperationKind;
  source?: string;
}

export function normalizePiPackageSource(source: string): string {
  return source.trim();
}

export function piPackageSourceValidationMessage(source: string): string | undefined {
  if (normalizePiPackageSource(source) !== "") return undefined;
  return "Enter a Pi package source accepted by Pi, such as npm:@scope/package, a git/URL source, or a local path.";
}

export function piPackageScopeLabel(packageInfo: Pick<PiPackageInfo, "scope">): string {
  return packageInfo.scope === "project" ? "Project scope" : "User scope";
}

export function piPackageFilteredLabel(packageInfo: Pick<PiPackageInfo, "filtered">): string {
  return packageInfo.filtered ? "Filtered by current Pi package settings" : "Available in this PI WEB process";
}

export function piPackageInstalledPathLabel(packageInfo: Pick<PiPackageInfo, "installedPath">): string {
  return packageInfo.installedPath ?? "Installed path not reported by Pi";
}

export function canUpdatePiPackage(packageInfo: Pick<PiPackageInfo, "scope">): boolean {
  return packageInfo.scope === "user";
}

export function piPackageUpdateDisabledReason(packageInfo: Pick<PiPackageInfo, "scope">): string | undefined {
  if (canUpdatePiPackage(packageInfo)) return undefined;
  return "Project-scope Pi packages are listed for visibility, but PI WEB only updates user-scope Pi packages safely from this view.";
}

export function canUpdateAllPiPackages(packages: readonly Pick<PiPackageInfo, "scope">[]): boolean {
  return packages.length > 0 && packages.every(canUpdatePiPackage);
}

export function updateAllPiPackagesDisabledReason(packages: readonly Pick<PiPackageInfo, "scope">[]): string | undefined {
  if (packages.length === 0) return "No Pi packages are configured yet.";
  if (canUpdateAllPiPackages(packages)) return undefined;
  return "Update all is disabled while project-scope Pi packages are listed; update user-scope packages individually.";
}

export function isPiPackageOperationPending(operation: PiPackageOperationState | undefined, kind: PiPackageOperationKind, source?: string): boolean {
  if (operation?.kind !== kind) return false;
  return source === undefined || operation.source === source;
}

export function piPackageMutationFollowUpMessage(action: PiPackageMutationAction): string {
  const verb = action === "install" ? "installed" : action === "remove" ? "removed" : "updated";
  return `Pi package ${verb}. Reload the browser page to import newly discovered PI WEB browser plugins. Reload existing Pi sessions, or use /reload in Pi, so extensions, skills, prompt templates, and themes are rediscovered.`;
}
