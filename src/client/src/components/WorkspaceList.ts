import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Workspace } from "../api";
import type { WorkspaceLabelItem } from "../plugins/types";
import { activateSelectableRow, activateSelectableRowFromKeyboard } from "./selectableRow";
import { listStyles } from "./shared";
import { renderWorkspaceLabelItems } from "./workspaceLabel";

@customElement("workspace-list")
export class WorkspaceList extends LitElement {
  @property({ attribute: false }) workspaces: Workspace[] = [];
  @property({ attribute: false }) selected?: Workspace;
  @property({ attribute: false }) workspaceLabelItems: (workspace: Workspace) => WorkspaceLabelItem[] = () => [];
  @property({ attribute: false }) onSelect?: (workspace: Workspace) => void;

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("selected") || changed.has("workspaces")) this.scrollSelectedIntoView();
  }

  override render() {
    return html`
      <section>
        <h2>Workspaces</h2>
        ${this.workspaces.map((workspace) => {
          const label = `${workspace.label}${workspace.isMain ? " · main" : ""}`;
          return html`
            <div
              class=${`action-row workspace-row ${this.selected?.id === workspace.id ? "selected" : ""}`}
              tabindex="0"
              title=${workspace.path}
              @click=${(event: MouseEvent) => { activateSelectableRow(event, () => this.onSelect?.(workspace)); }}
              @keydown=${(event: KeyboardEvent) => { activateSelectableRowFromKeyboard(event, () => this.onSelect?.(workspace)); }}
            >
              <div class="action-main">
                <span class="workspace-label">
                  <span class="workspace-label-base">${label}</span>
                  ${renderWorkspaceLabelItems(this.workspaceLabelItems(workspace))}
                </span>
                <small>${workspace.path}</small>
              </div>
            </div>
          `;
        })}
      </section>
    `;
  }

  private scrollSelectedIntoView(): void {
    this.renderRoot.querySelector<HTMLElement>(".action-row.selected")?.scrollIntoView({ block: "nearest" });
  }

  static override styles = listStyles;
}
