import type { ChatSource } from "@/lib/rag/types";

type SourceCitationsProps = {
  sources: ChatSource[];
};

export default function SourceCitations({ sources }: SourceCitationsProps) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 space-y-2" aria-label="参考来源">
      <p className="text-xs font-medium text-slate-500">参考来源</p>
      <div className="flex flex-wrap gap-2">
        {sources.map((source, index) => {
          const label = source.section ? `${source.title} · ${source.section}` : source.title;
          const key = `${source.title}-${source.section}-${index}`;

          if (source.url) {
            return (
              <a
                className="inline-flex max-w-full items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-800 transition hover:border-sky-300 hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-sky-300"
                href={source.url}
                key={key}
                title={label}
              >
                <span className="truncate">{source.title}</span>
              </a>
            );
          }

          return (
            <span
              className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
              key={key}
              title={label}
            >
              <span className="truncate">{label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
