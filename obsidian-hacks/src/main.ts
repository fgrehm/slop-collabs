import { Notice, Plugin } from "obsidian";

export default class HelloObsidianPlugin extends Plugin {
  async onload(): Promise<void> {
    this.addCommand({
      id: "say-hello",
      name: "Say hello",
      callback: () => new Notice("Hello from Obsidian stuff"),
    });
  }
}
