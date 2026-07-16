// SPDX-License-Identifier: AGPL-3.0-or-later
import { execSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  statSync,
  readFileSync,
} from "fs";
import { join, dirname, relative, extname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

const zipPath = join(projectRoot, "ref", "test.zip");
const outputDir = join(projectRoot, ".tests-local");
const extractedDir = join(outputDir, "extracted");

function getSha256(filePath) {
  const fileBuffer = readFileSync(filePath);
  const hashSum = createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

function findPmxFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      findPmxFiles(filePath, fileList);
    } else if (extname(file).toLowerCase() === ".pmx") {
      fileList.push(filePath);
    }
  }
  return fileList;
}

function countTextures(dir) {
  let count = 0;
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      count += countTextures(filePath);
    } else {
      const ext = extname(file).toLowerCase();
      if ([".png", ".jpg", ".jpeg", ".tga", ".dds", ".bmp"].includes(ext)) {
        count++;
      }
    }
  }
  return count;
}

console.log("--- Preparing Test Fixtures ---");

if (!existsSync(zipPath)) {
  console.warn(`Warning: ${zipPath} was not found.`);
  console.warn(
    "Synthetic testing will still be active, but compatibility corpus is skipped.",
  );
  process.exit(0);
}

// Ensure output dirs exist
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}
if (!existsSync(extractedDir)) {
  mkdirSync(extractedDir, { recursive: true });
}

console.log("Extracting ref/test.zip...");
try {
  execSync(`python3 scripts/extract_zip.py`, { stdio: "inherit" });
  console.log("Extraction complete.");
} catch (error) {
  console.error("Failed to extract ref/test.zip:", error);
  process.exit(1);
}

// Find all PMX files in extracted folder
const pmxFiles = findPmxFiles(extractedDir);
console.log(`Discovered ${pmxFiles.length} PMX model(s).`);

const manifestEntries = [];

for (const pmxPath of pmxFiles) {
  const relPmxPath = relative(projectRoot, pmxPath);
  const assetRoot = relative(projectRoot, dirname(pmxPath));
  const sha = getSha256(pmxPath);
  const texCount = countTextures(dirname(pmxPath));
  const modelId = relative(extractedDir, pmxPath)
    .replace(/\\/g, "/")
    .replace(".pmx", "");

  manifestEntries.push({
    id: modelId,
    pmxPath: relPmxPath,
    assetRoot,
    pmxSha256: sha,
    textureCount: texCount,
    expectedToParse: true,
    notes: [`Auto-discovered from test.zip`],
  });
}

const manifestPath = join(outputDir, "fixture-manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifestEntries, null, 2), "utf-8");
console.log(`Saved manifest to: ${manifestPath}`);
console.log("Fixtures successfully prepared!");
