import { MarkdownView, Notice, Plugin } from "obsidian";

export default class HelloObsidianPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerDomEvent(document, "click", (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("a, button, input")) return;

      const heading = target.closest<HTMLHeadingElement>(
        ".markdown-preview-view h1, .markdown-preview-view h2, .markdown-preview-view h3, .markdown-preview-view h4, .markdown-preview-view h5, .markdown-preview-view h6",
      );
      const collapseIndicator = heading?.querySelector<HTMLElement>(
        ".heading-collapse-indicator",
      );
      if (collapseIndicator && !target.closest(".heading-collapse-indicator")) {
        collapseIndicator.click();
      }
    });

    this.registerDomEvent(document, "click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("a, button, input")) return;

      const task = target.closest<HTMLElement>("li[data-task]:not([data-task=\"\"])");
      const input = task?.querySelector<HTMLInputElement>("input.task-list-item-checkbox");
      if (!task || !input) return;

      event.preventDefault();
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const file = view?.file;
      if (!file) return;

      const marker = input.checked ? " " : "x";
      const taskText = task.textContent.trim();
      await this.app.vault.process(file, (contents) => {
        const lines = contents.split("\n");
        const lineNumber = lines.findIndex(
          (line) => /^\s*[-+*]\s*\[[^\]]\]/.test(line) && line.includes(taskText),
        );
        if (lineNumber < 0) return contents;
        lines[lineNumber] = lines[lineNumber].replace(
          /^(\s*[-+*]\s*\[)[^\]](\])/, `$1${marker}$2`,
        );
        return lines.join("\n");
      });
    });

    this.addCommand({
      id: "say-hello",
      name: "Say hello",
      callback: () => new Notice("Hello from Obsidian stuff"),
    });
  }
}
