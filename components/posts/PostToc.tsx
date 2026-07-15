import type { Heading } from "@/lib/content/types";

type PostTocProps = {
  headings: Heading[];
};

function headingHref(heading: Heading): string {
  return `#user-content-${heading.id}`;
}

export default function PostToc({ headings }: PostTocProps) {
  if (headings.length === 0) {
    return (
      <p className="rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
        暂无目录
      </p>
    );
  }

  return (
    <nav aria-label="文章目录">
      <ol className="flex flex-col gap-1">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              className={[
                "block rounded-[8px] px-3 py-2 text-sm leading-5 text-slate-600 transition duration-200 hover:bg-sky-50 hover:text-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500",
                heading.level === 3 ? "ml-4 border-l border-slate-200 pl-4" : "font-semibold",
              ].join(" ")}
              href={headingHref(heading)}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
