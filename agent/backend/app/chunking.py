"""PDF 解析与按章节切块。"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional

import fitz  # pymupdf


CHAPTER_RE = re.compile(
    r"^(?:第\s*(\d+)\s*章|美股指南[（(]([一二三四五六七八九十]+)[）)]|"
    r"(\d{4}/\d{2}/\d{2})\s*更新)"
)
SECTION_RE = re.compile(r"^(\d+\.\d+)\s+(.+)$")
# 目录页、页眉等噪音
NOISE_RE = re.compile(
    r"^(中国人投资美股指南|目录|第\s*\d+\s*页|\d+\s*$|"
    r"美股指南[（(].*[）)].{0,8}$)"
)


@dataclass
class Chunk:
    id: str
    text: str
    chapter: str
    section: str
    page_start: int
    page_end: int
    tags: List[str]
    url: str = ""
    source: str = "pdf"  # pdf | post

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Chunk":
        return cls(
            id=d["id"],
            text=d["text"],
            chapter=d.get("chapter") or "",
            section=d.get("section") or "",
            page_start=int(d.get("page_start") or 0),
            page_end=int(d.get("page_end") or 0),
            tags=list(d.get("tags") or []),
            url=str(d.get("url") or ""),
            source=str(d.get("source") or "pdf"),
        )


def _normalize_line(line: str) -> str:
    line = line.replace("\u3000", " ").strip()
    line = re.sub(r"\s+", " ", line)
    return line


def _guess_tags(chapter: str, section: str, text: str) -> List[str]:
    blob = f"{chapter} {section} {text}"
    rules = [
        (r"CRS|FATCA|税务|报税|税号|ITIN", "税务"),
        (r"开户|银行账户|券商账户", "开户"),
        (r"香港|港卡|汇丰|东亚", "港卡"),
        (r"券商|IB|盈透|Firstrade|嘉信|Schwab|BIT", "券商"),
        (r"入金|汇款|电汇", "入金"),
        (r"出金|汇回|消费", "出金"),
        (r"加密|CARF|USDT|比特币", "加密"),
        (r"合规|风险|QDII", "合规"),
        (r"导读|总结|阅读建议", "导读"),
        (r"更新|政策", "加更"),
    ]
    tags = []
    for pat, tag in rules:
        if re.search(pat, blob, re.I):
            tags.append(tag)
    return tags or ["综合"]


def extract_pages(pdf_path: str) -> List[dict]:
    doc = fitz.open(pdf_path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text("text")
        pages.append({"page": i + 1, "text": text})
    doc.close()
    return pages


def split_into_chunks(pdf_path: str, max_chars: int = 900, overlap: int = 80) -> List[Chunk]:
    pages = extract_pages(pdf_path)
    # 合并为带页码的行流
    lines: List[tuple[int, str]] = []
    for p in pages:
        for raw in p["text"].splitlines():
            line = _normalize_line(raw)
            if not line or NOISE_RE.match(line):
                continue
            # 过滤明显的目录点线
            if re.search(r"\.{4,}", line) and re.search(r"\d+$", line):
                continue
            lines.append((p["page"], line))

    current_chapter = "导读"
    current_section = "概述"
    buffers: List[dict] = []
    buf_lines: List[str] = []
    buf_pages: List[int] = []

    def flush():
        nonlocal buf_lines, buf_pages
        if not buf_lines:
            return
        text = "\n".join(buf_lines).strip()
        if len(text) < 40:
            buf_lines, buf_pages = [], []
            return
        buffers.append(
            {
                "chapter": current_chapter,
                "section": current_section,
                "text": text,
                "page_start": min(buf_pages),
                "page_end": max(buf_pages),
            }
        )
        buf_lines, buf_pages = [], []

    for page, line in lines:
        # 章标题
        if CHAPTER_RE.search(line) or line.startswith("第") and "章" in line[:6]:
            flush()
            current_chapter = line[:40]
            current_section = "概述"
            continue
        if line.startswith("美股指南"):
            flush()
            current_chapter = line[:40]
            current_section = "概述"
            continue
        if re.match(r"^\d{4}/\d{2}/\d{2}", line):
            flush()
            current_chapter = line[:50]
            current_section = "加更"
            continue

        m = SECTION_RE.match(line)
        if m:
            flush()
            current_section = f"{m.group(1)} {m.group(2)}"[:60]
            continue

        buf_lines.append(line)
        buf_pages.append(page)
        # 过长则按句号软切
        if sum(len(x) for x in buf_lines) >= max_chars:
            flush()

    flush()

    # 二次切分超长块 + 生成 Chunk
    chunks: List[Chunk] = []
    idx = 0
    for b in buffers:
        text = b["text"]
        if len(text) <= max_chars * 1.3:
            parts = [text]
        else:
            parts = _hard_split(text, max_chars, overlap)

        for part in parts:
            idx += 1
            tags = _guess_tags(b["chapter"], b["section"], part)
            chunks.append(
                Chunk(
                    id=f"c{idx:04d}",
                    text=part,
                    chapter=b["chapter"],
                    section=b["section"],
                    page_start=b["page_start"],
                    page_end=b["page_end"],
                    tags=tags,
                    url="",
                    source="pdf",
                )
            )
    return chunks


def _parse_frontmatter(raw: str) -> tuple[dict, str]:
    """Minimal YAML-like frontmatter: key: "value" / key: number / key: [a, b]."""
    if not raw.startswith("---"):
        return {}, raw
    parts = raw.split("---", 2)
    if len(parts) < 3:
        return {}, raw
    meta: dict = {}
    for line in parts[1].splitlines():
        line = line.strip()
        if not line or ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        val = val.strip()
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            items = []
            for piece in inner.split(","):
                piece = piece.strip().strip('"').strip("'")
                if piece:
                    items.append(piece)
            meta[key] = items
        elif (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            meta[key] = _unescape_html(val[1:-1])
        else:
            meta[key] = _unescape_html(val)
    return meta, parts[2]


def _unescape_html(s: str) -> str:
    return (
        s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )


def _split_markdown_sections(body: str) -> List[tuple[str, str]]:
    """Return list of (section_title, section_text)."""
    lines = body.splitlines()
    sections: List[tuple[str, List[str]]] = []
    current = "正文"
    buf: List[str] = []

    def flush():
        nonlocal buf
        text = "\n".join(buf).strip()
        if text:
            sections.append((current, text))
        buf = []

    for line in lines:
        m = re.match(r"^(#{2,3})\s+(.+)$", line.strip())
        if m:
            flush()
            current = m.group(2).strip()[:80]
            continue
        # skip images-only noise lines partially
        buf.append(line)
    flush()
    return [(t, b) for t, b in sections]


def split_posts_into_chunks(
    posts_dir: str,
    start_idx: int = 1,
    max_chars: int = 900,
    overlap: int = 80,
) -> List[Chunk]:
    """Chunk site Markdown tutorials under content/posts."""
    root = Path(posts_dir)
    if not root.is_dir():
        return []

    chunks: List[Chunk] = []
    idx = start_idx - 1

    for path in sorted(root.glob("*.md")):
        raw = path.read_text(encoding="utf-8")
        meta, body = _parse_frontmatter(raw)
        slug = str(meta.get("slug") or path.stem)
        title = str(meta.get("title") or slug)
        series = str(meta.get("seriesSlug") or "")
        tags_meta = meta.get("tags") if isinstance(meta.get("tags"), list) else []
        url = f"/posts/{slug}"

        # strip leading H1 if any
        body = re.sub(r"^\s*#\s+[^\n]+\n+", "", body)
        # drop image markdown for retrieval text (keep alt lightly)
        body_for_index = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", body)
        body_for_index = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", body_for_index)

        sections = _split_markdown_sections(body_for_index)
        if not sections:
            sections = [("正文", body_for_index.strip())]

        for section_title, section_text in sections:
            text = section_text.strip()
            if len(text) < 40:
                continue
            parts = (
                [text]
                if len(text) <= max_chars * 1.3
                else _hard_split(text, max_chars, overlap)
            )
            for part in parts:
                idx += 1
                tags = _guess_tags(title, section_title, part)
                for t in tags_meta:
                    if t and t not in tags:
                        tags.append(str(t))
                if series and series not in tags:
                    tags.append(series)
                if "站内教程" not in tags:
                    tags.append("站内教程")
                chunks.append(
                    Chunk(
                        id=f"p{idx:04d}",
                        text=part,
                        chapter=title[:80],
                        section=section_title[:80],
                        page_start=0,
                        page_end=0,
                        tags=tags,
                        url=url,
                        source="post",
                    )
                )

    return chunks


def _hard_split(text: str, max_chars: int, overlap: int) -> List[str]:
    # 优先按中文句号切
    sentences = re.split(r"(?<=[。！？；\n])", text)
    parts: List[str] = []
    cur = ""
    for s in sentences:
        if not s:
            continue
        if len(cur) + len(s) <= max_chars:
            cur += s
        else:
            if cur:
                parts.append(cur.strip())
            if len(s) > max_chars:
                for i in range(0, len(s), max_chars - overlap):
                    parts.append(s[i : i + max_chars].strip())
                cur = ""
            else:
                # 重叠
                cur = (cur[-overlap:] if cur else "") + s
    if cur.strip():
        parts.append(cur.strip())
    return [p for p in parts if len(p) >= 40]
