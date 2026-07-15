import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const postsDir = join(root, "content", "posts");
const assetsRoot = join(root, "public", "content-assets");

const posts = [
  {
    slug: "why-hk-bank-account",
    seriesSlug: "hk-banks",
    title: "大陆用户开通港卡必读指南：翻越金融长城，为什么必须人手一个香港银行账户？",
    description: "从金融隔离、全球资产配置和合法开户路径出发，解释大陆用户为什么需要香港银行账户。",
    readMinutes: 23,
    tags: ["香港银行", "境外银行", "金融长城", "港卡指南"],
    featured: true,
    sourcePath:
      "/Users/fengyihang/Desktop/未命名文件夹/港卡/大陆用户开通港卡必读指南：翻越金融长城，为什么必须人手一个香港银行账户？.md",
  },
  {
    slug: "za-bank-account-opening",
    seriesSlug: "hk-banks",
    title: "众安银行开户教程：大陆用户线上从 0 到 1 开户",
    description: "面向大陆用户的众安银行线上开户准备、流程、入金和使用注意事项。",
    readMinutes: 9,
    tags: ["众安银行", "香港虚拟银行", "香港银行"],
    featured: false,
    sourcePath:
      "/Users/fengyihang/Desktop/未命名文件夹/港卡/众安银行开户教程：大陆用户线上从 0 到 1 开户/众安银行开户教程：大陆用户线上从 0 到 1 开户.md",
    assetSource:
      "/Users/fengyihang/Desktop/未命名文件夹/港卡/众安银行开户教程：大陆用户线上从 0 到 1 开户/图片和附件",
  },
  {
    slug: "us-broker-guide",
    seriesSlug: "us-brokers",
    title: "大陆用户美股券商 101 指南：各大美股投资方式选哪个？为什么使用美股券商？用哪个美股券商？",
    description: "比较大陆用户投资美股的常见方式，说明为什么优先选择正规美股券商以及如何做选择。",
    readMinutes: 17,
    tags: ["美股券商", "美股投资", "美股 ETF"],
    featured: true,
    sourcePath:
      "/Users/fengyihang/Desktop/未命名文件夹/美股券商/大陆用户美股券商 101 指南：各大美股投资方式选哪个？为什么使用美股券商？用哪个美股券商？.md",
  },
  {
    slug: "ibkr-account",
    seriesSlug: "us-brokers",
    title: "盈透券商大陆用户从 0 到 1 线上保姆级开户攻略｜Interactive Brokers｜IBKR｜免除 CRS",
    description: "大陆用户开通 Interactive Brokers 盈透证券账户的准备清单、线上流程和常见注意事项。",
    readMinutes: 16,
    tags: ["盈透证券", "IBKR", "美股券商"],
    featured: false,
    sourcePath:
      "/Users/fengyihang/Desktop/未命名文件夹/美股券商/盈透券商大陆用户从 0 到 1 线上保姆级开户攻略｜Interactive Brokers｜IBKR｜免除 CRS/盈透券商大陆用户从 0 到 1 线上保姆级开户攻略｜Interactive Brokers｜IBKR｜免除 CRS.md",
    assetSource:
      "/Users/fengyihang/Desktop/未命名文件夹/美股券商/盈透券商大陆用户从 0 到 1 线上保姆级开户攻略｜Interactive Brokers｜IBKR｜免除 CRS/图片和附件",
  },
  {
    slug: "wise-account",
    seriesSlug: "fund-transfer",
    title: "Wise 多币种钱包从 0 到 1 开户/入金/出金教程：轻松玩转 Wise",
    description: "介绍 Wise 多币种钱包的开户流程、常见入金方式、出金到支付宝和使用注意事项。",
    readMinutes: 25,
    tags: ["Wise", "出入金", "资金流转"],
    featured: true,
    sourcePath:
      "/Users/fengyihang/Desktop/未命名文件夹/出入金/Wise 多币种钱包从 0 到 1 开户_入金_出金教程：轻松玩转 Wise/Wise 多币种钱包从 0 到 1 开户_入金_出金教程：轻松玩转 Wise.md",
    assetSource:
      "/Users/fengyihang/Desktop/未命名文件夹/出入金/Wise 多币种钱包从 0 到 1 开户_入金_出金教程：轻松玩转 Wise/图片和附件",
  },
  {
    slug: "hk-card-spending-in-mainland",
    seriesSlug: "fund-transfer",
    title: "港卡的钱怎么在内地花？9 大港币消费方式全解析",
    description: "梳理港卡绑定内地支付工具、香港钱包、云闪付、Apple Pay、ATM 和刷卡等消费方式。",
    readMinutes: 17,
    tags: ["香港银行", "港币消费", "资金流转"],
    featured: false,
    sourcePath:
      "/Users/fengyihang/Desktop/未命名文件夹/出入金/港卡的钱怎么在内地花？9 大港币消费方式全解析/港卡的钱怎么在内地花？9 大港币消费方式全解析.md",
    assetSource:
      "/Users/fengyihang/Desktop/未命名文件夹/出入金/港卡的钱怎么在内地花？9 大港币消费方式全解析/图片和附件",
  },
];

function yamlString(value) {
  return JSON.stringify(value);
}

function frontmatter(post) {
  return [
    "---",
    `slug: ${yamlString(post.slug)}`,
    `seriesSlug: ${yamlString(post.seriesSlug)}`,
    `title: ${yamlString(post.title)}`,
    `description: ${yamlString(post.description)}`,
    `readMinutes: ${post.readMinutes}`,
    `tags: [${post.tags.map(yamlString).join(", ")}]`,
    `featured: ${post.featured}`,
    "---",
    "",
  ].join("\n");
}

function rewriteMarkdown(markdown, slug) {
  return markdown
    .replace(
      /!\[([^\]]*)\]\(图片和附件\/([^)]+)\)/g,
      (_, alt, fileName) => `![${alt}](/content-assets/${slug}/${fileName})`,
    )
    .replace(
      /^(#{1,6}\s+.*?)\s*\[\\?#\]\(https:\/\/invest-nav\.com\/[^)]*\)\s*$/gm,
      (_, heading) => heading.trimEnd(),
    )
    .replace(/^#{1,6}\s*$/gm, "")
    // Title is rendered from frontmatter in PostLayout — drop duplicate leading H1.
    .replace(/^\s*#\s+[^\n]+\n+/, "")
    .replace(/\n{3,}/g, "\n\n");
}

async function copyAssets(post) {
  if (!post.assetSource) {
    return;
  }

  const target = join(assetsRoot, post.slug);
  await rm(target, { force: true, recursive: true });
  await mkdir(assetsRoot, { recursive: true });
  await cp(post.assetSource, target, { recursive: true });
}

async function ingestPost(post) {
  const source = await readFile(post.sourcePath, "utf8");
  const markdown = rewriteMarkdown(source, post.slug);
  const target = join(postsDir, `${post.slug}.md`);

  await writeFile(target, `${frontmatter(post)}${markdown.trimStart()}`, "utf8");
  await copyAssets(post);

  console.log(`ingested ${post.slug}`);
}

await mkdir(postsDir, { recursive: true });

for (const post of posts) {
  await ingestPost(post);
}
