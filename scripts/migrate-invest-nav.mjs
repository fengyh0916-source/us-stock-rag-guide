/**
 * Migrate text tutorials from invest-nav.com into content/posts + public/content-assets.
 * Categories: hk-banks, us-brokers, fund-transfer
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import https from "node:https";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const postsDir = join(root, "content", "posts");
const assetsRoot = join(root, "public", "content-assets");
const registryPath = join(root, "lib", "content", "registry.ts");

const CATEGORIES = [
  {
    seriesSlug: "hk-banks",
    path: "hk-banks",
    icon: "🏦",
    title: "香港境外银行",
    description: "香港及境外银行开户教程与问题解答",
  },
  {
    seriesSlug: "us-brokers",
    path: "us-brokers",
    icon: "📈",
    title: "美股券商",
    description: "美股券商开户、入金和基础投资方式教程",
  },
  {
    seriesSlug: "fund-transfer",
    path: "fund-transfer",
    icon: "💱",
    title: "出入金/资金流转",
    description: "港币、美元、USDT 出入金和资金流转教程",
  },
];

// Prefer existing local posts when slug already present
const KEEP_LOCAL = new Set([
  "why-hk-bank-account",
  "za-bank-account-opening",
  "us-broker-guide",
  "ibkr-account",
  "wise-account",
  "hk-card-spending-in-mainland",
]);

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          fetchText(next).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("error", reject);
    req.setTimeout(60000, () => {
      req.destroy(new Error(`timeout ${url}`));
    });
  });
}

async function downloadFile(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "image/*,*/*",
        },
      },
      async (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          try {
            await downloadFile(new URL(res.headers.location, url).href, dest);
            resolve();
          } catch (e) {
            reject(e);
          }
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`download ${res.statusCode} ${url}`));
          return;
        }
        const out = createWriteStream(dest);
        try {
          await pipeline(res, out);
          resolve();
        } catch (e) {
          reject(e);
        }
      },
    );
    req.on("error", reject);
    req.setTimeout(90000, () => req.destroy(new Error(`dl timeout ${url}`)));
  });
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractListPosts(listHtml, categoryPath) {
  const re = new RegExp(
    `href="(/tutorials/${categoryPath}/text/([a-z0-9-]+)/)"`,
    "gi",
  );
  const seen = new Set();
  const posts = [];
  let m;
  while ((m = re.exec(listHtml))) {
    const href = m[1];
    const slug = m[2];
    if (seen.has(slug)) continue;
    seen.add(slug);
    posts.push({ slug, href: `https://invest-nav.com${href}` });
  }
  return posts;
}

function extractMeta(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)="${name}"[^>]+content="([^"]*)"`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]+content="([^"]*)"[^>]+(?:name|property)="${name}"`,
    "i",
  );
  const m = html.match(re) || html.match(re2);
  return m ? decodeEntities(m[1]) : "";
}

function extractTitle(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]);
  const t = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (t) return stripTags(t[1]).replace(/\s*-\s*香港.*$/, "").replace(/\s*\|\s*投资导航.*$/, "").trim();
  return "";
}

function extractArticleHtml(html) {
  // Prefer content between first h1 and donate/footer markers
  const h1i = html.search(/<h1[\s>]/i);
  if (h1i < 0) return "";
  let end = html.indexOf("打赏支持", h1i);
  if (end < 0) end = html.indexOf('id="donate"', h1i);
  if (end < 0) end = Math.min(html.length, h1i + 200000);
  // walk back to a tag boundary
  return html.slice(h1i, end);
}

function htmlToMarkdown(articleHtml) {
  let s = articleHtml;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `# ${stripTags(t)}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => {
    let title = stripTags(t).replace(/#$/, "").trim();
    return `## ${title}\n\n`;
  });
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => {
    let title = stripTags(t).replace(/#$/, "").trim();
    return `### ${title}\n\n`;
  });
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `#### ${stripTags(t)}\n\n`);
  s = s.replace(/<img[^>]*src="([^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*>/gi, (_, src, alt) => {
    return `![${alt || ""}](${src})\n\n`;
  });
  s = s.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"[^>]*>/gi, (_, alt, src) => {
    return `![${alt || ""}](${src})\n\n`;
  });
  s = s.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
    const text = stripTags(t) || href;
    return `[${text}](${href})`;
  });
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${stripTags(t)}\n`);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => {
    return (
      stripTags(t)
        .split(/\n/)
        .map((line) => `> ${line}`)
        .join("\n") + "\n\n"
    );
  });
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `${stripTags(t)}\n\n`);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<hr[^>]*>/gi, "\n\n---\n\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  // noise cleanup
  s = s.replace(/^发布时间：.*$/gm, "");
  s = s.replace(/约[\d,]+字/g, "");
  s = s.replace(/阅读时长：\d+分钟/g, "");
  s = s.replace(/收藏评论/g, "");
  s = s.replace(/^\s*#\s+[^\n]+\n+/, ""); // drop leading H1 (layout shows title)
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim() + "\n";
}

function yamlString(value) {
  return JSON.stringify(value);
}

function estimateReadMinutes(text) {
  const chars = text.replace(/\s+/g, "").length;
  return Math.max(1, Math.round(chars / 400));
}

function guessTags(title, seriesSlug) {
  const tags = new Set();
  if (seriesSlug === "hk-banks") tags.add("香港银行");
  if (seriesSlug === "us-brokers") tags.add("美股券商");
  if (seriesSlug === "fund-transfer") tags.add("出入金");
  const keywords = [
    ["众安", "众安银行"],
    ["盈透", "盈透"],
    ["IBKR", "IBKR"],
    ["嘉信", "嘉信"],
    ["长桥", "长桥"],
    ["Wise", "Wise"],
    ["USDT", "USDT"],
    ["支付宝", "香港支付宝"],
    ["微信", "微信香港钱包"],
    ["iFAST", "iFAST"],
    ["Bitget", "Bitget"],
    ["复星", "复星"],
  ];
  for (const [k, tag] of keywords) {
    if (title.includes(k)) tags.add(tag);
  }
  return [...tags].slice(0, 5);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function localizeImages(markdown, slug) {
  const assetDir = join(assetsRoot, slug);
  await mkdir(assetDir, { recursive: true });
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let m;
  const replacements = [];
  let index = 0;
  while ((m = re.exec(markdown))) {
    const alt = m[1];
    const url = m[2];
    if (!url.includes("r2.dev") && !url.includes("invest-nav") && !url.includes("pub-")) {
      // still download common CDNs
    }
    index += 1;
    const extMatch = url.match(/\.(png|jpe?g|webp|gif|svg)(?:\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase().replace("jpeg", "jpg") : "png";
    const fileName = `${String(index).padStart(2, "0")}.${ext}`;
    const dest = join(assetDir, fileName);
    const localUrl = `/content-assets/${slug}/${fileName}`;
    try {
      await downloadFile(url, dest);
      replacements.push({ from: m[0], to: `![${alt}](${localUrl})` });
      process.stdout.write(".");
    } catch (e) {
      console.warn(`\n  img fail ${url}: ${e.message}`);
      // keep remote url as fallback
    }
    await sleep(80);
  }
  let out = markdown;
  for (const r of replacements) {
    out = out.replace(r.from, r.to);
  }
  return out;
}

async function main() {
  const allBySeries = [];

  for (const cat of CATEGORIES) {
    console.log(`\n== List ${cat.path} ==`);
    const listHtml = await fetchText(`https://invest-nav.com/tutorials/${cat.path}/text/`);
    const list = extractListPosts(listHtml, cat.path);
    console.log(`found ${list.length} posts`);
    const seriesPosts = [];

    for (const item of list) {
      seriesPosts.push(item.slug);

      if (KEEP_LOCAL.has(item.slug)) {
        console.log(`skip local ${item.slug}`);
        continue;
      }

      process.stdout.write(`fetch ${item.slug} `);
      try {
        const html = await fetchText(item.href);
        const title =
          extractTitle(html) ||
          item.slug
            .split("-")
            .map((w) => w)
            .join(" ");
        const description =
          extractMeta(html, "description") ||
          extractMeta(html, "og:description") ||
          title;
        let markdown = htmlToMarkdown(extractArticleHtml(html));
        if (markdown.length < 80) {
          console.warn(`\n  warn short content ${item.slug} (${markdown.length})`);
        }
        markdown = await localizeImages(markdown, item.slug);
        const tags = guessTags(title, cat.seriesSlug);
        const readMinutes = estimateReadMinutes(markdown);
        const featured = seriesPosts.indexOf(item.slug) < 2;
        const frontmatter = [
          "---",
          `slug: ${yamlString(item.slug)}`,
          `seriesSlug: ${yamlString(cat.seriesSlug)}`,
          `title: ${yamlString(title)}`,
          `description: ${yamlString(description.slice(0, 180))}`,
          `readMinutes: ${readMinutes}`,
          `tags: [${tags.map(yamlString).join(", ")}]`,
          `featured: ${featured}`,
          "---",
          "",
          markdown,
        ].join("\n");
        await writeFile(join(postsDir, `${item.slug}.md`), frontmatter, "utf8");
        console.log(" ok");
      } catch (e) {
        console.error(` FAIL ${e.message}`);
      }
      await sleep(250);
    }

    allBySeries.push({
      slug: cat.seriesSlug,
      icon: cat.icon,
      title: cat.title,
      description: cat.description,
      postSlugs: seriesPosts,
    });
  }

  // Rewrite registry.ts from migrated order
  const registry = `import type { Series } from "./types";

export const seriesRegistry: Series[] = ${JSON.stringify(allBySeries, null, 2).replace(/"([^"]+)":/g, "$1:")};
`;
  await writeFile(registryPath, registry, "utf8");
  console.log("\nUpdated registry.ts");
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
