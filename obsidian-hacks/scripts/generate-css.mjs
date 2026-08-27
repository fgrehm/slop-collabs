import { mkdir, readFile, writeFile } from "node:fs/promises";

const baseCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const icons = JSON.parse(await readFile(new URL("../task-icons.json", import.meta.url)));
const escapeCss = (value) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const rules = Object.entries(icons)
  .map(([task, emoji]) => {
    const selector = `li:has(> input[data-task="${escapeCss(task)}"])::before`;
    return `${selector} { content: "${escapeCss(emoji)}"; }`;
  })
  .join("\n");

const css = `${baseCss.trimEnd()}

/* Generated task-icon mappings. Edit task-icons.json instead. */
${rules}
`;

await mkdir(new URL("../dist", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/styles.css", import.meta.url), css);
