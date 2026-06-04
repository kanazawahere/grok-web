import { describe, expect, it } from "vitest";
import type { AppState } from "../appState";
import { initialAppState } from "../appState";
import type { WorkspaceActivity, WorkspaceActivityResponse } from "../api";
import { ActivityController } from "./activityController";

function activity(cwd: string, patch: Partial<WorkspaceActivity> = {}): WorkspaceActivity {
  return { cwd, hasSessionActivity: true, hasTerminalActivity: false, updatedAt: "now", ...patch };
}

function snapshot(...workspaces: WorkspaceActivity[]): WorkspaceActivityResponse {
  return { workspaces, generatedAt: "now" };
}

describe("ActivityController", () => {
  it("stores workspace activity under the requested machine", async () => {
    let state: AppState = { ...initialAppState(), selectedMachine: { id: "remote", name: "Remote", kind: "remote", createdAt: "now", updatedAt: "now" } };
    const controller = new ActivityController(() => state, (patch) => { state = { ...state, ...patch }; }, {
      api: { workspaceActivity: (machineId) => Promise.resolve(machineId === "remote" ? snapshot(activity("/remote")) : snapshot(activity("/local"))) },
    });

    await controller.refresh("remote");
    await controller.refresh("local");

    expect(state.workspaceActivities).toEqual({ "/remote": activity("/remote") });
    expect(state.machineActivities).toEqual({
      remote: { "/remote": activity("/remote") },
      local: { "/local": activity("/local") },
    });
  });

  it("applies live activity updates to the owning machine only", () => {
    let state: AppState = { ...initialAppState(), selectedMachine: { id: "local", name: "Local", kind: "local", createdAt: "now", updatedAt: "now" } };
    const controller = new ActivityController(() => state, (patch) => { state = { ...state, ...patch }; });

    controller.applyWorkspaceActivity(activity("/remote"), "remote");
    controller.applyWorkspaceActivity(activity("/local"), "local");

    expect(state.workspaceActivities).toEqual({ "/local": activity("/local") });
    expect(state.machineActivities["remote"]).toEqual({ "/remote": activity("/remote") });
    expect(state.machineActivities["local"]).toEqual({ "/local": activity("/local") });
  });
});
