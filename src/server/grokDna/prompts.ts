/** Prompt templates grafted from Grok CLI DNA (no sandbox / worktree). */

export function planModeSystemAddendum(planFilePath: string): string {
  return [
    "## PLAN MODE (Grok DNA — active)",
    "You are in structured plan mode (inspired by Grok Build CLI plan mode).",
    "Rules:",
    "1. Explore and design an implementation approach BEFORE changing product code.",
    "2. You may ONLY write/edit the plan file:",
    `   ${planFilePath}`,
    "3. Do NOT edit any other files. If you need code changes, list them in the plan and wait for approval.",
    "4. Use clarifying questions when the approach is ambiguous.",
    "5. When the plan is ready, summarize options and ask the user to approve before leaving plan mode.",
    "6. Keep the plan concrete: files, steps, risks, tests.",
  ].join("\n");
}

export function verifyPromptAddendum(): string {
  return [
    "## VERIFY LOOP (Grok DNA — like `grok --check`)",
    "After your implementation (or if nothing to implement, after analysis):",
    "1. Run the project's relevant checks (typecheck/tests/build/lint) when available.",
    "2. Fix failures you introduced, then re-run until green or blocked.",
    "3. End with a short verification report: commands run, exit status, residual risk.",
    "Do not claim success without evidence from tool output.",
  ].join("\n");
}

export function memoryContextBlock(notes: Array<{ text: string; tags: string[] }>): string {
  if (notes.length === 0) return "";
  const lines = notes.slice(0, 40).map((n, i) => {
    const tag = n.tags.length ? ` [${n.tags.join(", ")}]` : "";
    return `${i + 1}. ${n.text}${tag}`;
  });
  return [
    "## CROSS-SESSION MEMORY (Grok DNA)",
    "Recall these operator-saved notes when relevant. Do not invent memories.",
    ...lines,
  ].join("\n");
}

export function skillInjectBlock(name: string, content: string): string {
  return [
    `## SKILL: ${name} (Grok DNA skill bridge)`,
    "Follow this skill when the task matches. Prefer its procedure over improvising.",
    "```markdown",
    content.slice(0, 12000),
    "```",
  ].join("\n");
}

export function bestOfNBranchPrompt(index: number, total: number, userTask: string): string {
  return [
    `## BEST-OF-N BRANCH ${index}/${total} (Grok DNA)`,
    "You are one independent candidate solving the same task.",
    "Produce a complete, self-contained solution. Do not assume other branches exist.",
    "Be decisive; pick one coherent approach and execute it well.",
    "",
    "### Task",
    userTask,
  ].join("\n");
}

export function pickBestPrompt(candidates: Array<{ id: string; label: string; summary: string }>): string {
  const body = candidates
    .map((c, i) => `### Candidate ${i + 1}: ${c.label} (session ${c.id})\n${c.summary}`)
    .join("\n\n");
  return [
    "## PICK THE BEST (Grok DNA best-of-N judge)",
    "Compare the candidate approaches below. Choose ONE winner.",
    "Return: winner id, why, and what to keep/merge from losers.",
    "",
    body,
  ].join("\n");
}

export function permissionModeHint(mode: string): string {
  return [
    `## PERMISSION MODE: ${mode} (Grok DNA)`,
    mode === "plan"
      ? "Prefer plan-first behavior; avoid irreversible actions until the user confirms."
      : mode === "bypassPermissions" || mode === "auto"
        ? "Operator chose a high-automation mode — still avoid destructive mass deletes without stating risk."
        : "Ask before risky edits or network side effects when ambiguous.",
  ].join("\n");
}
