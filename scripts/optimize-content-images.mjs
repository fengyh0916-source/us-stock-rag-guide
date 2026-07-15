import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const contentDir = path.join(root, "content");
const publicDir = path.join(root, "public");
const imagePattern = /\/content-assets\/[^)\]"'<>\s]+\.(?:png|jpe?g)/gi;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(fullPath) : [fullPath];
    }),
  );
  return files.flat();
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

function deployUrl(sourceUrl) {
  const extension = path.extname(sourceUrl).slice(1).toLowerCase();
  return sourceUrl.replace(/\.(?:png|jpe?g)$/i, `-${extension}.webp`);
}

const contentFiles = (await walk(contentDir)).filter((filename) => filename.endsWith(".md"));
const replacements = new Map();

for (const filename of contentFiles) {
  const markdown = await readFile(filename, "utf8");
  for (const match of markdown.matchAll(imagePattern)) {
    const sourceUrl = match[0];
    replacements.set(sourceUrl, deployUrl(sourceUrl));
  }
}

let originalBytes = 0;
let deployedBytes = 0;
let converted = 0;
const missing = [];
const entries = [...replacements].sort(([a], [b]) => a.localeCompare(b));
let cursor = 0;

async function convertNext() {
  while (cursor < entries.length) {
    const [sourceUrl, outputUrl] = entries[cursor];
    cursor += 1;
    const sourcePath = path.join(publicDir, sourceUrl.replace(/^\//, ""));
    const outputPath = path.join(publicDir, outputUrl.replace(/^\//, ""));

    if (!(await exists(sourcePath))) {
      missing.push(sourceUrl);
      continue;
    }

    const sourceInfo = await stat(sourcePath);
    originalBytes += sourceInfo.size;
    await mkdir(path.dirname(outputPath), { recursive: true });

    const outputExists = await exists(outputPath);
    const existingOutputInfo = outputExists ? await stat(outputPath) : null;
    if (!existingOutputInfo || existingOutputInfo.mtimeMs < sourceInfo.mtimeMs) {
      await sharp(sourcePath)
        .rotate()
        .resize({
          width: 1800,
          height: 1800,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 84, effort: 4, smartSubsample: true })
        .toFile(outputPath);
    }

    const outputInfo = await stat(outputPath);
    deployedBytes += outputInfo.size;
    converted += 1;
  }
}

await Promise.all(Array.from({ length: 4 }, () => convertNext()));

for (const filename of contentFiles) {
  const before = await readFile(filename, "utf8");
  const after = before.replace(imagePattern, (sourceUrl) => replacements.get(sourceUrl) || sourceUrl);
  if (after !== before) {
    await writeFile(filename, after, "utf8");
  }
}

if (missing.length > 0) {
  console.error(`缺少 ${missing.length} 个被文章引用的原始图片：`);
  for (const filename of missing) console.error(`- ${filename}`);
  process.exitCode = 1;
}

const ratio = originalBytes > 0 ? (deployedBytes / originalBytes) * 100 : 0;
console.log(
  `已生成 ${converted} 张部署图片：${(originalBytes / 1024 / 1024).toFixed(1)} MB → ${(deployedBytes / 1024 / 1024).toFixed(1)} MB（${ratio.toFixed(1)}%）`,
);
