/**
 * Turn model output into clean plain text for chat UI.
 * Removes Markdown markers while preserving readable structure.
 */
export function stripMarkdownSymbols(text: string): string {
  if (!text) {
    return "";
  }

  let cleaned = text.replace(/\r\n/g, "\n");

  // Fenced code blocks → plain text
  cleaned = cleaned.replace(/```[\w]*\n?([\s\S]*?)```/g, "$1");

  // Headings: ## Title → Title
  cleaned = cleaned.replace(/^\s{0,3}#{1,6}\s+/gm, "");

  // Bold / italic markers
  cleaned = cleaned.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, "$1");
  cleaned = cleaned.replace(/__(.+?)__/g, "$1");
  cleaned = cleaned.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "$1");
  cleaned = cleaned.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, "$1");

  // Inline code
  cleaned = cleaned.replace(/`([^`]+)`/g, "$1");

  // Links [label](url) → label
  cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

  // Images ![alt](url) → alt
  cleaned = cleaned.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1");

  // Blockquotes
  cleaned = cleaned.replace(/^\s{0,3}>\s?/gm, "");

  // Horizontal rules
  cleaned = cleaned.replace(/^\s*([-*_]){3,}\s*$/gm, "");

  // Unordered list markers: - item / * item → · item
  cleaned = cleaned.replace(/^\s*[-*+]\s+/gm, "· ");

  // Collapse excess blank lines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}

export type AnswerBlock =
  | { type: "section"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "numbered"; items: string[] }
  | { type: "bullets"; items: string[] }
  | { type: "disclaimer"; text: string };

const SECTION_RE = /^(?:[一二三四五六七八九十]+[、．.]|[（(]?[A-Za-z][)）]\s*|第[一二三四五六七八九十\d]+[步章节部分])/u;
const NUMBERED_RE = /^(\d+)[\.、．)]\s+(.+)$/u;
const BULLET_RE = /^[·•●○]\s*(.+)$/u;
const DISCLAIMER_RE = /仅供科普|不构成投资|法律建议|税务或法律/;

export function parseAnswerBlocks(text: string): AnswerBlock[] {
  const cleaned = stripMarkdownSymbols(text);
  if (!cleaned) {
    return [];
  }

  const lines = cleaned.split("\n");
  const blocks: AnswerBlock[] = [];
  let paragraphLines: string[] = [];
  let numbered: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const joined = paragraphLines.join("\n").trim();
    paragraphLines = [];
    if (!joined) {
      return;
    }
    if (DISCLAIMER_RE.test(joined)) {
      blocks.push({ type: "disclaimer", text: joined });
    } else {
      blocks.push({ type: "paragraph", text: joined });
    }
  };

  const flushNumbered = () => {
    if (numbered.length > 0) {
      blocks.push({ type: "numbered", items: [...numbered] });
      numbered = [];
    }
  };

  const flushBullets = () => {
    if (bullets.length > 0) {
      blocks.push({ type: "bullets", items: [...bullets] });
      bullets = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushNumbered();
      flushBullets();
      flushParagraph();
      continue;
    }

    if (DISCLAIMER_RE.test(line) && line.length < 80) {
      flushNumbered();
      flushBullets();
      flushParagraph();
      blocks.push({ type: "disclaimer", text: line });
      continue;
    }

    const numberedMatch = line.match(NUMBERED_RE);
    if (numberedMatch) {
      flushBullets();
      flushParagraph();
      numbered.push(numberedMatch[2].trim());
      continue;
    }

    const bulletMatch = line.match(BULLET_RE);
    if (bulletMatch) {
      flushNumbered();
      flushParagraph();
      bullets.push(bulletMatch[1].trim());
      continue;
    }

    // Short section-like titles
    if (
      (SECTION_RE.test(line) || /[:：]$/.test(line)) &&
      line.length <= 28 &&
      !line.includes("。")
    ) {
      flushNumbered();
      flushBullets();
      flushParagraph();
      blocks.push({ type: "section", text: line.replace(/[:：]$/, "") });
      continue;
    }

    flushNumbered();
    flushBullets();
    paragraphLines.push(line);
  }

  flushNumbered();
  flushBullets();
  flushParagraph();

  return blocks;
}
