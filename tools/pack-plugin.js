import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, basename, relative } from "node:path";

const pluginDir = process.argv[2];
if (!pluginDir) {
  console.error("Usage: bun tools/pack-plugin.js <plugin-directory>");
  process.exit(1);
}

if (!existsSync(pluginDir)) {
  console.error(`Directory not found: ${pluginDir}`);
  process.exit(1);
}

const manifestPath = join(pluginDir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("manifest.json not found in plugin directory");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const requiredFields = ["id", "name", "version", "entry"];
for (const field of requiredFields) {
  if (!manifest[field]) {
    console.error(`Missing required manifest field: ${field}`);
    process.exit(1);
  }
}

if (!existsSync(join(pluginDir, manifest.entry))) {
  console.error(`Entry script not found: ${manifest.entry}`);
  process.exit(1);
}

const { default: JSZip } = await import("jszip");
const zip = new JSZip();

const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  "Thumbs.db",
]);

function addFile(relPath) {
  const fullPath = join(pluginDir, relPath);
  if (!existsSync(fullPath)) {
    console.warn(`Warning: declared file not found, skipping: ${relPath}`);
    return;
  }
  const stat = statSync(fullPath);
  const content = readFileSync(fullPath);
  if (content.length > 131072) {
    console.error(`File exceeds 128 KB limit: ${relPath} (${content.length} bytes)`);
    process.exit(1);
  }
  zip.file(relPath, content, { date: stat.mtime });
}

function scanAndAdd(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name) || entry.name.endsWith(".mxp") || entry.name.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanAndAdd(full);
    } else if (entry.isFile()) {
      const rel = relative(pluginDir, full);
      addFile(rel);
    }
  }
}

scanAndAdd(pluginDir);

const zipBuffer = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
});

const outName = `${basename(pluginDir)}-${manifest.version}.mxp`;
const outPath = join(dirname(pluginDir), outName);
writeFileSync(outPath, zipBuffer);

console.log(`\nPacked: ${outPath}`);
console.log(`Size:   ${(zipBuffer.length / 1024).toFixed(1)} KB`);
console.log(`\nPlugin ID: ${manifest.id}`);
console.log(`Deep link: max://get-plugin?id=${manifest.id}`);
