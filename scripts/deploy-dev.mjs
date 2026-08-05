import { copyFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const vault = process.env.OBSIDIAN_VAULT;

if (!vault) {
  console.error("OBSIDIAN_VAULT must point to the target Obsidian vault.");
  console.error("Example: OBSIDIAN_VAULT=\"$HOME/path/to/your/vault\" npm run deploy:dev");
  process.exit(1);
}

const sourceRoot = resolve(import.meta.dirname, "..");
const destination = join(resolve(vault), ".obsidian", "plugins", "unified-outliner");
const artifacts = ["manifest.json", "main.js", "styles.css"];

try {
  const config = await stat(join(resolve(vault), ".obsidian"));
  if (!config.isDirectory()) throw new Error(".obsidian is not a directory");
} catch {
  console.error(`No Obsidian configuration directory found in: ${resolve(vault)}`);
  process.exit(1);
}

await mkdir(destination, { recursive: true });
for (const artifact of artifacts) {
  await copyFile(join(sourceRoot, artifact), join(destination, artifact));
}

console.log(`Deployed ${artifacts.join(", ")} to ${destination}`);
