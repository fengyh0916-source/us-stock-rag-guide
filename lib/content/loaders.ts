import { promises as fs } from "node:fs";
import path from "node:path";

import matter from "gray-matter";
import type {
  Heading as MdastHeading,
  Image,
  Link,
  PhrasingContent,
  Root,
  RootContent,
  Text,
} from "mdast";
import { remark } from "remark";
import html from "remark-html";

import { seriesRegistry } from "./registry";
import type { Heading, Post, PostMeta, Series, SeriesSlug } from "./types";

const postsDirectory = path.join(process.cwd(), "content", "posts");
const seriesSlugs = new Set<SeriesSlug>(seriesRegistry.map((series) => series.slug));

export function getAllSeries(): Series[] {
  return seriesRegistry;
}

export function getSeries(slug: string): Series | undefined {
  return seriesRegistry.find((series) => series.slug === slug);
}

export async function getAllPosts(): Promise<PostMeta[]> {
  const posts = await Promise.all(
    (await getPostSlugs()).map(async (slug) => {
      const post = await readPostFile(slug);
      return post.meta;
    }),
  );

  return sortPostsByRegistry(posts);
}

export async function getPost(slug: string): Promise<Post | undefined> {
  if (!isSafeSlug(slug)) {
    return undefined;
  }

  try {
    const postFile = await readPostFile(slug);
    const rendered = await renderMarkdown(postFile.content);

    return {
      ...postFile.meta,
      html: rendered.html,
      headings: rendered.headings,
    };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }
}

export async function getPostsForSeries(seriesSlug: SeriesSlug): Promise<PostMeta[]> {
  const posts = await getAllPosts();
  const series = getSeries(seriesSlug);

  if (!series) {
    return [];
  }

  return series.postSlugs
    .map((postSlug) => posts.find((post) => post.slug === postSlug))
    .filter((post): post is PostMeta => Boolean(post));
}

async function getPostSlugs(): Promise<string[]> {
  const entries = await fs.readdir(postsDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""))
    .filter(isSafeSlug)
    .sort();
}

async function readPostFile(slug: string): Promise<{ meta: PostMeta; content: string }> {
  const filePath = path.join(postsDirectory, `${slug}.md`);
  const fileContents = await fs.readFile(filePath, "utf8");
  const parsed = matter(fileContents);

  return {
    meta: parsePostMeta(parsed.data, filePath, slug),
    // Title is shown by PostLayout from frontmatter; drop leading H1 to avoid duplicates.
    content: stripLeadingMarkdownH1(parsed.content),
  };
}

function stripLeadingMarkdownH1(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]+\n+/, "");
}

function parsePostMeta(data: Record<string, unknown>, filePath: string, fileSlug: string): PostMeta {
  const slug = requireSlug(data.slug, filePath, fileSlug);

  return {
    slug,
    seriesSlug: requireSeriesSlug(data.seriesSlug, filePath),
    title: requireString(data.title, "title", filePath),
    description: requireString(data.description, "description", filePath),
    readMinutes: requirePositiveNumber(data.readMinutes, "readMinutes", filePath),
    tags: requireStringArray(data.tags, "tags", filePath),
    featured: requireBoolean(data.featured, "featured", filePath),
  };
}

function requireSlug(value: unknown, filePath: string, fileSlug: string): string {
  const slug = requireString(value, "slug", filePath);

  if (!isSafeSlug(slug)) {
    throw new Error(`Invalid frontmatter in ${filePath}: "slug" must be URL-safe.`);
  }

  if (slug !== fileSlug) {
    throw new Error(`Invalid frontmatter in ${filePath}: "slug" must match filename "${fileSlug}".`);
  }

  return slug;
}

function requireString(value: unknown, fieldName: string, filePath: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  throw new Error(`Invalid frontmatter in ${filePath}: "${fieldName}" must be a non-empty string.`);
}

function requireSeriesSlug(value: unknown, filePath: string): SeriesSlug {
  const seriesSlug = requireString(value, "seriesSlug", filePath);

  if (seriesSlugs.has(seriesSlug as SeriesSlug)) {
    return seriesSlug as SeriesSlug;
  }

  throw new Error(
    `Invalid frontmatter in ${filePath}: "seriesSlug" must be one of ${Array.from(seriesSlugs).join(", ")}.`,
  );
}

function requirePositiveNumber(value: unknown, fieldName: string, filePath: string): number {
  const numberValue = typeof value === "number" ? value : Number(value);

  if (Number.isFinite(numberValue) && numberValue > 0) {
    return numberValue;
  }

  throw new Error(`Invalid frontmatter in ${filePath}: "${fieldName}" must be a positive number.`);
}

function requireStringArray(value: unknown, fieldName: string, filePath: string): string[] {
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    return value.map((item) => item.trim());
  }

  throw new Error(`Invalid frontmatter in ${filePath}: "${fieldName}" must be an array of strings.`);
}

function requireBoolean(value: unknown, fieldName: string, filePath: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Invalid frontmatter in ${filePath}: "${fieldName}" must be a boolean.`);
}

async function renderMarkdown(markdown: string): Promise<{ html: string; headings: Heading[] }> {
  const headings: Heading[] = [];

  const processedContent = await remark()
    .use(() => (tree: Root) => {
      collectHeadingsAndAssignIds(tree, headings);
    })
    .use(html)
    .process(markdown);

  return {
    html: processedContent.toString(),
    headings,
  };
}

function collectHeadingsAndAssignIds(tree: Root, headings: Heading[]): void {
  const usedIds = new Map<string, number>();

  visitRootContent(tree.children, (node) => {
    if (node.type === "heading" && (node.depth === 2 || node.depth === 3)) {
      const text = headingText(node);
      const id = uniqueHeadingId(slugifyHeading(text), usedIds);
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          id,
        },
      };

      headings.push({
        id,
        text,
        level: node.depth,
      });
    }
  });
}

function visitRootContent(nodes: RootContent[], visitor: (node: RootContent) => void): void {
  for (const node of nodes) {
    visitor(node);

    if ("children" in node && Array.isArray(node.children)) {
      visitRootContent(node.children as RootContent[], visitor);
    }
  }
}

function headingText(heading: MdastHeading): string {
  return textFromPhrasingContent(heading.children).replace(/\s+/g, " ").trim();
}

function textFromPhrasingContent(nodes: PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if (isTextNode(node)) {
        return node.value;
      }

      if (isImageNode(node)) {
        return node.alt ?? "";
      }

      if (isLinkNode(node)) {
        return textFromPhrasingContent(node.children);
      }

      if ("children" in node && Array.isArray(node.children)) {
        return textFromPhrasingContent(node.children as PhrasingContent[]);
      }

      return "";
    })
    .join("");
}

function isTextNode(node: PhrasingContent): node is Text {
  return node.type === "text" || node.type === "inlineCode";
}

function isImageNode(node: PhrasingContent): node is Image {
  return node.type === "image";
}

function isLinkNode(node: PhrasingContent): node is Link {
  return node.type === "link";
}

function slugifyHeading(text: string): string {
  const slug = text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return encodeURIComponent(slug || "section");
}

function uniqueHeadingId(baseId: string, usedIds: Map<string, number>): string {
  const count = usedIds.get(baseId) ?? 0;
  usedIds.set(baseId, count + 1);

  return count === 0 ? baseId : `${baseId}-${count + 1}`;
}

function sortPostsByRegistry(posts: PostMeta[]): PostMeta[] {
  const orderedSlugs = seriesRegistry.flatMap((series) => series.postSlugs);

  return [...posts].sort((first, second) => {
    const firstIndex = orderedSlugs.indexOf(first.slug);
    const secondIndex = orderedSlugs.indexOf(second.slug);

    if (firstIndex !== -1 || secondIndex !== -1) {
      return (firstIndex === -1 ? Number.MAX_SAFE_INTEGER : firstIndex) -
        (secondIndex === -1 ? Number.MAX_SAFE_INTEGER : secondIndex);
    }

    return first.slug.localeCompare(second.slug);
  });
}

function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
