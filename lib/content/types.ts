export type SeriesSlug = "hk-banks" | "us-brokers" | "fund-transfer";

export type Series = {
  slug: SeriesSlug;
  icon: string;
  title: string;
  description: string;
  postSlugs: string[];
};

export type Heading = {
  id: string;
  text: string;
  level: number;
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
  headings: Heading[];
};
