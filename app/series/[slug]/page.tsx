import { notFound } from "next/navigation";

import AgentLauncher from "@/components/agent/AgentLauncher";
import SeriesHeader from "@/components/series/SeriesHeader";
import SeriesPostList from "@/components/series/SeriesPostList";
import { getAllSeries, getPostsForSeries, getSeries } from "@/lib/content/loaders";

type SeriesPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return getAllSeries().map((series) => ({
    slug: series.slug,
  }));
}

export default async function SeriesPage({ params }: SeriesPageProps) {
  const { slug } = await params;
  const series = getSeries(slug);

  if (!series) {
    notFound();
  }

  const posts = await getPostsForSeries(series.slug);

  return (
    <main className="bg-dot-grid min-h-[calc(100vh-3.5rem)] overflow-x-hidden px-4 pb-28 pt-4 text-slate-950 sm:px-6 sm:pb-32 sm:pt-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 py-5 sm:gap-10 sm:py-12 lg:py-16">
        <SeriesHeader postCount={posts.length} series={series} />
        <SeriesPostList posts={posts} />
      </div>
      <AgentLauncher pageContext={{ type: "series", slug: series.slug }} />
    </main>
  );
}
