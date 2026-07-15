# US Stock Guide RAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable MVP for a Chinese US-stock beginner guide site with task-based series pages, article detail pages, and a right-side RAG assistant entry.

**Architecture:** Use a Next.js App Router application with content stored as local Markdown and metadata generated from an ingest script. The first implementation can run with local content and a mock RAG response, then add Supabase pgvector and model calls behind a stable `/api/chat` contract.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, local Markdown content, `gray-matter`, `remark`, `lucide-react`, Supabase Postgres pgvector, OpenAI-compatible embeddings/chat API.

---

## Scope Check

This spec covers one MVP with four connected surfaces: homepage, series pages, post detail pages, and the assistant drawer. The RAG backend is included as a thin vertical slice: stable API contract first, real vector retrieval second. Do not add auth, payments, dashboards, user accounts, or learning-state persistence in this implementation pass.

## File Structure

Create the app in the workspace root.

- `package.json`: scripts and dependencies.
- `next.config.ts`: Next.js config, Markdown image handling via local public assets.
- `tsconfig.json`: TypeScript config.
- `tailwind.config.ts`: Tailwind theme tokens.
- `postcss.config.mjs`: Tailwind PostCSS setup.
- `app/layout.tsx`: root layout and metadata.
- `app/globals.css`: base styles, dotted background, typography.
- `app/page.tsx`: homepage composition.
- `app/series/[slug]/page.tsx`: series page route.
- `app/posts/[slug]/page.tsx`: post detail route.
- `app/api/chat/route.ts`: assistant API route.
- `components/home/HomeHero.tsx`: title section.
- `components/home/TaskCards.tsx`: three task cards that link to series pages.
- `components/home/BeginnerGuides.tsx`: two beginner cards that link to post pages.
- `components/agent/AgentLauncher.tsx`: floating assistant button.
- `components/agent/AgentDrawer.tsx`: right drawer chat UI.
- `components/agent/ChatMessageList.tsx`: message renderer.
- `components/agent/SourceCitations.tsx`: source citation chips.
- `components/series/SeriesHeader.tsx`: series title/progress.
- `components/series/SeriesPostList.tsx`: ordered post list.
- `components/posts/PostLayout.tsx`: post page shell with left series nav and right TOC.
- `components/posts/PostToc.tsx`: heading-based table of contents.
- `lib/content/types.ts`: content data types.
- `lib/content/registry.ts`: generated content registry.
- `lib/content/loaders.ts`: functions to load series and posts.
- `lib/rag/types.ts`: chat API request/response types.
- `lib/rag/mock.ts`: deterministic mock answers for local demos.
- `scripts/ingest-content.mjs`: copy Markdown/assets from desktop folders into project content.
- `content/posts/*.md`: normalized article Markdown.
- `public/content-assets/**`: copied article images.

## Content Mapping

Series:

- `hk-banks`: 香港境外银行
  - `why-hk-bank-account`
  - `za-bank-account-opening`
- `us-brokers`: 美股券商
  - `us-broker-guide`
  - `ibkr-account`
- `fund-transfer`: 出入金/资金流转
  - `wise-account`
  - `hk-card-spending-in-mainland`

Homepage cards:

- Task cards:
  - 我要开港卡 -> `/series/hk-banks`
  - 我要炒美股 -> `/series/us-brokers`
  - 我要出入金 -> `/series/fund-transfer`
- Beginner guides:
  - 大陆用户开通港卡必读指南 -> `/posts/why-hk-bank-account`
  - 大陆用户美股券商 101 指南 -> `/posts/us-broker-guide`

---

### Task 1: Scaffold The Next.js App

**Files:**
- Create: `package.json`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `tailwind.config.ts`
- Create: `postcss.config.mjs`
- Create: `app/layout.tsx`
- Create: `app/globals.css`
- Create: `app/page.tsx`

- [ ] **Step 1: Create the project files**

Create the files listed above with a minimal App Router setup.

`package.json`:

```json
{
  "name": "us-stock-guide-rag",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "ingest:content": "node scripts/ingest-content.mjs"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "gray-matter": "^4.0.3",
    "lucide-react": "^0.468.0",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "remark": "^15.0.1",
    "remark-html": "^16.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^15.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.6.0"
  }
}
```

`app/page.tsx`:

```tsx
export default function HomePage() {
  return <main>美股 & 港卡投资一站式导航</main>;
}
```

- [ ] **Step 2: Install dependencies**

Run: `pnpm install`

Expected: dependencies install and `pnpm-lock.yaml` is created.

- [ ] **Step 3: Verify the scaffold**

Run: `pnpm build`

Expected: build succeeds and the homepage route is generated.

---

### Task 2: Ingest Markdown Tutorials And Assets

**Files:**
- Create: `scripts/ingest-content.mjs`
- Create: `content/posts/why-hk-bank-account.md`
- Create: `content/posts/za-bank-account-opening.md`
- Create: `content/posts/us-broker-guide.md`
- Create: `content/posts/ibkr-account.md`
- Create: `content/posts/wise-account.md`
- Create: `content/posts/hk-card-spending-in-mainland.md`
- Create: `public/content-assets/**`

- [ ] **Step 1: Write the ingest script**

`scripts/ingest-content.mjs` should copy the six Markdown files from:

```text
/Users/fengyihang/Desktop/未命名文件夹/港卡
/Users/fengyihang/Desktop/未命名文件夹/美股券商
/Users/fengyihang/Desktop/未命名文件夹/出入金
```

Normalize each Markdown file by prepending frontmatter:

```yaml
---
slug: "why-hk-bank-account"
seriesSlug: "hk-banks"
title: "大陆用户开通港卡必读指南：翻越金融长城，为什么必须人手一个香港银行账户？"
description: "解释大陆用户为什么需要香港银行账户，以及港卡能解决哪些资产配置和资金流转问题。"
readMinutes: 23
tags: ["香港银行", "境外银行", "金融长城", "港卡指南"]
featured: true
---
```

Use these slug mappings:

```js
const mappings = [
  { slug: "why-hk-bank-account", seriesSlug: "hk-banks", source: "/Users/fengyihang/Desktop/未命名文件夹/港卡/大陆用户开通港卡必读指南：翻越金融长城，为什么必须人手一个香港银行账户？.md" },
  { slug: "za-bank-account-opening", seriesSlug: "hk-banks", source: "/Users/fengyihang/Desktop/未命名文件夹/港卡/众安银行开户教程：大陆用户线上从 0 到 1 开户/众安银行开户教程：大陆用户线上从 0 到 1 开户.md", assetDir: "/Users/fengyihang/Desktop/未命名文件夹/港卡/众安银行开户教程：大陆用户线上从 0 到 1 开户/图片和附件" },
  { slug: "us-broker-guide", seriesSlug: "us-brokers", source: "/Users/fengyihang/Desktop/未命名文件夹/美股券商/大陆用户美股券商 101 指南：各大美股投资方式选哪个？为什么使用美股券商？用哪个美股券商？.md" },
  { slug: "ibkr-account", seriesSlug: "us-brokers", source: "/Users/fengyihang/Desktop/未命名文件夹/美股券商/盈透券商大陆用户从 0 到 1 线上保姆级开户攻略｜Interactive Brokers｜IBKR｜免除 CRS/盈透券商大陆用户从 0 到 1 线上保姆级开户攻略｜Interactive Brokers｜IBKR｜免除 CRS.md", assetDir: "/Users/fengyihang/Desktop/未命名文件夹/美股券商/盈透券商大陆用户从 0 到 1 线上保姆级开户攻略｜Interactive Brokers｜IBKR｜免除 CRS/图片和附件" },
  { slug: "wise-account", seriesSlug: "fund-transfer", source: "/Users/fengyihang/Desktop/未命名文件夹/出入金/Wise 多币种钱包从 0 到 1 开户_入金_出金教程：轻松玩转 Wise/Wise 多币种钱包从 0 到 1 开户_入金_出金教程：轻松玩转 Wise.md", assetDir: "/Users/fengyihang/Desktop/未命名文件夹/出入金/Wise 多币种钱包从 0 到 1 开户_入金_出金教程：轻松玩转 Wise/图片和附件" },
  { slug: "hk-card-spending-in-mainland", seriesSlug: "fund-transfer", source: "/Users/fengyihang/Desktop/未命名文件夹/出入金/港卡的钱怎么在内地花？9 大港币消费方式全解析/港卡的钱怎么在内地花？9 大港币消费方式全解析.md", assetDir: "/Users/fengyihang/Desktop/未命名文件夹/出入金/港卡的钱怎么在内地花？9 大港币消费方式全解析/图片和附件" }
];
```

Rewrite Markdown image links from `图片和附件/file.png` to `/content-assets/<slug>/file.png`.

- [ ] **Step 2: Run content ingest**

Run: `pnpm ingest:content`

Expected:

- Six Markdown files exist under `content/posts`.
- Image folders exist for `za-bank-account-opening`, `ibkr-account`, `wise-account`, and `hk-card-spending-in-mainland`.
- Markdown image URLs begin with `/content-assets/`.

---

### Task 3: Build Content Loaders

**Files:**
- Create: `lib/content/types.ts`
- Create: `lib/content/registry.ts`
- Create: `lib/content/loaders.ts`

- [ ] **Step 1: Define content types**

`lib/content/types.ts`:

```ts
export type SeriesSlug = "hk-banks" | "us-brokers" | "fund-transfer";

export type Series = {
  slug: SeriesSlug;
  icon: string;
  title: string;
  description: string;
  postSlugs: string[];
};

export type PostMeta = {
  slug: string;
  seriesSlug: SeriesSlug;
  title: string;
  description: string;
  readMinutes: number;
  tags: string[];
  featured: boolean;
};

export type Post = PostMeta & {
  html: string;
  headings: { id: string; text: string; level: number }[];
};
```

- [ ] **Step 2: Define the series registry**

`lib/content/registry.ts`:

```ts
import type { Series } from "./types";

export const seriesRegistry: Series[] = [
  {
    slug: "hk-banks",
    icon: "🏦",
    title: "香港境外银行",
    description: "香港及境外银行开户教程与问题解答",
    postSlugs: ["why-hk-bank-account", "za-bank-account-opening"]
  },
  {
    slug: "us-brokers",
    icon: "📈",
    title: "美股券商",
    description: "美股券商开户、入金和基础投资方式教程",
    postSlugs: ["us-broker-guide", "ibkr-account"]
  },
  {
    slug: "fund-transfer",
    icon: "💱",
    title: "出入金/资金流转",
    description: "港币、美元、USDT 出入金和资金流转教程",
    postSlugs: ["wise-account", "hk-card-spending-in-mainland"]
  }
];
```

- [ ] **Step 3: Implement loaders**

`lib/content/loaders.ts` should:

- Read Markdown files from `content/posts`.
- Parse frontmatter with `gray-matter`.
- Convert Markdown to HTML with `remark` and `remark-html`.
- Extract headings from Markdown lines beginning with `##` or `###`.
- Return `getAllSeries()`, `getSeries(slug)`, `getAllPosts()`, `getPost(slug)`.

- [ ] **Step 4: Verify loaders through build**

Run: `pnpm build`

Expected: TypeScript compiles and content loader imports do not fail.

---

### Task 4: Implement Homepage

**Files:**
- Modify: `app/page.tsx`
- Create: `components/home/HomeHero.tsx`
- Create: `components/home/TaskCards.tsx`
- Create: `components/home/BeginnerGuides.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Build homepage components**

`TaskCards` must render exactly three links:

- `我要开港卡` -> `/series/hk-banks`
- `我要炒美股` -> `/series/us-brokers`
- `我要出入金` -> `/series/fund-transfer`

`BeginnerGuides` must render exactly two links:

- `大陆用户开通港卡必读指南` -> `/posts/why-hk-bank-account`
- `大陆用户美股券商 101 指南` -> `/posts/us-broker-guide`

- [ ] **Step 2: Compose homepage**

`app/page.tsx` should render:

```tsx
import { BeginnerGuides } from "@/components/home/BeginnerGuides";
import { HomeHero } from "@/components/home/HomeHero";
import { TaskCards } from "@/components/home/TaskCards";
import { AgentLauncher } from "@/components/agent/AgentLauncher";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-dot-grid">
      <HomeHero />
      <TaskCards />
      <BeginnerGuides />
      <AgentLauncher />
    </main>
  );
}
```

- [ ] **Step 3: Verify homepage links**

Run: `pnpm dev`

Expected:

- Homepage loads.
- Three task cards are visible.
- Two beginner guide cards are visible.
- Card links point to the required series/post paths.

---

### Task 5: Implement Series Pages

**Files:**
- Create: `app/series/[slug]/page.tsx`
- Create: `components/series/SeriesHeader.tsx`
- Create: `components/series/SeriesPostList.tsx`

- [ ] **Step 1: Build dynamic route**

`app/series/[slug]/page.tsx` must:

- Load the series by slug.
- Return `notFound()` when slug is unknown.
- Render `SeriesHeader`.
- Render `SeriesPostList`.
- Include `AgentLauncher`.

- [ ] **Step 2: Build series header**

`SeriesHeader` displays:

- icon
- title
- description
- `0/<postCount> 篇已学习`
- 0% progress bar

- [ ] **Step 3: Build post list**

Each row displays:

- order number
- “置顶” pill for the first row
- title
- read minutes
- tag chips
- link to `/posts/<slug>`

- [ ] **Step 4: Verify route behavior**

Run: `pnpm dev`

Open:

- `/series/hk-banks`
- `/series/us-brokers`
- `/series/fund-transfer`

Expected: each page shows the correct title and two posts.

---

### Task 6: Implement Post Detail Pages

**Files:**
- Create: `app/posts/[slug]/page.tsx`
- Create: `components/posts/PostLayout.tsx`
- Create: `components/posts/PostToc.tsx`

- [ ] **Step 1: Build dynamic post route**

`app/posts/[slug]/page.tsx` must:

- Load the post by slug.
- Return `notFound()` when slug is unknown.
- Load sibling posts from the same series.
- Render `PostLayout`.
- Include `AgentLauncher` with current post context.

- [ ] **Step 2: Build post layout**

`PostLayout` must render:

- left series list with current post highlighted
- center article card with title, read minutes, tags, and rendered HTML
- right table of contents
- disclaimer block: `本内容仅供科普参考，不构成投资、税务或法律建议。`

- [ ] **Step 3: Verify image rendering**

Open:

- `/posts/za-bank-account-opening`
- `/posts/ibkr-account`
- `/posts/wise-account`
- `/posts/hk-card-spending-in-mainland`

Expected: article images render from `/content-assets/...`.

---

### Task 7: Implement Assistant Drawer With Mock RAG

**Files:**
- Create: `components/agent/AgentLauncher.tsx`
- Create: `components/agent/AgentDrawer.tsx`
- Create: `components/agent/ChatMessageList.tsx`
- Create: `components/agent/SourceCitations.tsx`
- Create: `lib/rag/types.ts`
- Create: `lib/rag/mock.ts`
- Create: `app/api/chat/route.ts`

- [ ] **Step 1: Define chat types**

`lib/rag/types.ts`:

```ts
export type ChatRequest = {
  message: string;
  pageContext?: {
    type: "home" | "series" | "post";
    slug?: string;
  };
};

export type ChatSource = {
  title: string;
  section: string;
  url: string;
};

export type ChatResponse = {
  answer: string;
  warnings: string[];
  sources: ChatSource[];
  relatedArticles: { title: string; url: string }[];
};
```

- [ ] **Step 2: Create deterministic mock answers**

`lib/rag/mock.ts` should return:

- a港卡 answer for messages containing `港卡` or `境外银行`
- a券商 answer for messages containing `券商`, `IBKR`, or `盈透`
- a出入金 answer for messages containing `入金`, `出金`, `Wise`, or `资金`
- a safety refusal for messages containing `推荐`, `买哪只`, `股票`, or `明天`

The safety refusal answer must include:

```text
我不能给出具体买卖建议，但可以帮你理解投资工具、风险和学习路径。
```

- [ ] **Step 3: Implement API route**

`app/api/chat/route.ts` returns `ChatResponse` from the mock helper.

- [ ] **Step 4: Implement drawer UI**

The drawer must include:

- title: `美股入门助手`
- subtitle: `基于站内教程和美股指南回答`
- four quick questions
- message list
- input placeholder: `描述你的情况，比如：我没有港卡，想买第一只 ETF`
- fixed disclaimer

- [ ] **Step 5: Verify assistant behavior**

Run: `pnpm dev`

Expected:

- Floating button appears in bottom right.
- Click opens a right-side drawer.
- Quick question sends a message.
- Response displays answer, warnings, citations, and related articles.

---

### Task 8: Add Real RAG Backend Contract

**Files:**
- Create: `supabase/schema.sql`
- Create: `lib/rag/retrieve.ts`
- Modify: `app/api/chat/route.ts`
- Create: `.env.example`

- [ ] **Step 1: Define database schema**

`supabase/schema.sql`:

```sql
create extension if not exists vector;

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_slug text not null,
  title text not null,
  section_title text not null,
  chunk_text text not null,
  url text not null,
  embedding vector(1536),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_embedding_idx
on knowledge_chunks
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);
```

- [ ] **Step 2: Add environment template**

`.env.example`:

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
```

- [ ] **Step 3: Implement retrieval helper**

`lib/rag/retrieve.ts` exports `retrieveRelevantChunks(query: string)` and returns an empty array when env vars are missing. This keeps local demos working with mock responses.

- [ ] **Step 4: Wire API route with fallback**

`app/api/chat/route.ts` should:

- use mock response when env vars are missing
- use retrieval + model call when env vars exist
- always return the same `ChatResponse` shape

- [ ] **Step 5: Verify graceful fallback**

Run without env vars: `pnpm dev`

Expected: assistant still works with mock responses.

---

### Task 9: Visual And Flow Verification

**Files:**
- Modify only files required to fix verified defects.

- [ ] **Step 1: Build verification checklist**

Verify these routes manually in browser:

- `/`
- `/series/hk-banks`
- `/series/us-brokers`
- `/series/fund-transfer`
- `/posts/why-hk-bank-account`
- `/posts/us-broker-guide`
- `/posts/za-bank-account-opening`
- `/posts/ibkr-account`
- `/posts/wise-account`
- `/posts/hk-card-spending-in-mainland`

- [ ] **Step 2: Verify navigation semantics**

Expected:

- Homepage task cards go to series pages.
- Homepage beginner cards go to post pages.
- Series rows go to post pages.
- Post left navigation switches between sibling posts.

- [ ] **Step 3: Verify safety question**

Ask: `你能推荐我现在买哪只股票吗？`

Expected:

- assistant refuses specific investment advice
- assistant offers education-oriented alternatives
- disclaimer remains visible

- [ ] **Step 4: Run final build**

Run: `pnpm build`

Expected: build completes with no TypeScript errors.

---

## Self-Review

Spec coverage:

- Homepage cards and different navigation semantics are covered in Tasks 4 and 9.
- Series pages are covered in Task 5.
- Post detail pages and Markdown images are covered in Tasks 2 and 6.
- Assistant drawer is covered in Task 7.
- RAG API contract and Supabase path are covered in Task 8.
- Safety boundary is covered in Tasks 7 and 9.

Placeholder scan:

- No placeholder markers or deferred implementation steps are present.
- Real slugs, file paths, routes, and visible copy are specified.

Type consistency:

- `SeriesSlug`, `Series`, `PostMeta`, `Post`, `ChatRequest`, and `ChatResponse` are introduced before use.
- Route slugs match the content mapping.

## Execution Notes

The current workspace is not a Git repository. If commit checkpoints are required, initialize Git before Task 1 with:

```bash
git init
```

Then commit after each task with messages like:

```bash
git add .
git commit -m "feat: scaffold guide app"
```
