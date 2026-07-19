import { describe, expect, it } from "vitest";
import { projectForDefaultPath } from "./projectController";

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
});
