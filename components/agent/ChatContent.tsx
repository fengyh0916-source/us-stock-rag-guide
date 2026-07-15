import { parseAnswerBlocks } from "@/lib/rag/format-answer";

type ChatContentProps = {
  content: string;
  streaming?: boolean;
  isUser?: boolean;
};

export default function ChatContent({ content, streaming = false, isUser = false }: ChatContentProps) {
  if (isUser) {
    return <p className="whitespace-pre-wrap break-words">{content}</p>;
  }

  const blocks = parseAnswerBlocks(content);

  if (blocks.length === 0) {
    return (
      <p className="whitespace-pre-wrap break-words text-slate-500">
        {streaming ? "正在生成回答" : ""}
        {streaming ? <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-sky-500 align-middle" /> : null}
      </p>
    );
  }

  return (
    <div className="space-y-2.5 text-[13.5px] leading-6 text-slate-700 sm:text-sm sm:leading-7">
      {blocks.map((block, index) => {
        if (block.type === "section") {
          return (
            <h3
              className="pt-1 text-[13.5px] font-semibold tracking-wide text-slate-900 first:pt-0"
              key={`section-${index}`}
            >
              {block.text}
            </h3>
          );
        }

        if (block.type === "paragraph") {
          return (
            <p className="whitespace-pre-wrap break-words text-slate-700" key={`p-${index}`}>
              {block.text}
            </p>
          );
        }

        if (block.type === "numbered") {
          return (
            <ol className="space-y-2" key={`ol-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li className="flex gap-2.5" key={`ol-${index}-${itemIndex}`}>
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-50 text-[11px] font-semibold text-sky-700">
                    {itemIndex + 1}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-slate-700">{item}</span>
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === "bullets") {
          return (
            <ul className="space-y-1.5" key={`ul-${index}`}>
              {block.items.map((item, itemIndex) => (
                <li className="flex gap-2.5" key={`ul-${index}-${itemIndex}`}>
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                  <span className="min-w-0 flex-1 break-words text-slate-700">{item}</span>
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p
            className="rounded-lg border border-amber-100 bg-amber-50/80 px-2.5 py-2 text-xs leading-5 text-amber-900/80"
            key={`disclaimer-${index}`}
          >
            {block.text}
          </p>
        );
      })}
      {streaming ? (
        <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-sky-500 align-middle" aria-hidden="true" />
      ) : null}
    </div>
  );
}
