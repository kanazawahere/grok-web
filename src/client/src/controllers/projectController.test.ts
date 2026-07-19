import { describe, expect, it } from "vitest";
import { projectForDefaultPath, shouldSelectDefaultProject } from "./projectController";

describe("projectForDefaultPath", () => {
  const projects = [
    { id: "one", name: "One", path: "/repo/one", createdAt: "now" },
    { id: "cc", name: "Central Command", path: "/home/tin/Central_Command", createdAt: "now" },
  ];

  it("selects the exact configured default project", () => {
    expect(projectForDefaultPath(projects, "/home/tin/Central_Command")).toEqual(projects[1]);
  });

  it("does not guess when the setting is absent or does not match", () => {
    expect(projectForDefaultPath(projects, undefined)).toBeUndefined();
    expect(projectForDefaultPath(projects, "/elsewhere")).toBeUndefined();
  });

  it("selects only for a genuinely fresh route, including the empty-string route form", () => {
    expect(shouldSelectDefaultProject(undefined, undefined, "/home/tin/Central_Command")).toBe(true);
    expect(shouldSelectDefaultProject("", undefined, "/home/tin/Central_Command")).toBe(true);
    expect(shouldSelectDefaultProject("explicit", undefined, "/home/tin/Central_Command")).toBe(false);
    expect(shouldSelectDefaultProject("", projects[0], "/home/tin/Central_Command")).toBe(false);
    expect(shouldSelectDefaultProject("", undefined, undefined)).toBe(false);
  });
});
