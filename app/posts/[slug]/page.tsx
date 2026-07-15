import { notFound } from "next/navigation";

import AgentLauncher from "@/components/agent/AgentLauncher";
import PostLayout from "@/components/posts/PostLayout";
import { getAllPosts, getPost, getPostsForSeries, getSeries } from "@/lib/content/loaders";

type PostPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export async function generateStaticParams() {
  const posts = await getAllPosts();

  return posts.map((post) => ({
    slug: post.slug,
  }));
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) {
    notFound();
  }

  const series = getSeries(post.seriesSlug);

  if (!series) {
    notFound();
  }

  const siblingPosts = await getPostsForSeries(series.slug);

  return (
    <main className="bg-dot-grid min-h-screen overflow-x-hidden px-3 pb-28 pt-4 text-slate-950 sm:px-6 sm:pb-32 sm:pt-6 lg:px-8">
      <PostLayout post={post} series={series} siblingPosts={siblingPosts} />
      <AgentLauncher pageContext={{ type: "post", slug: post.slug }} />
    </main>
  );
}
