import "server-only";

import { createClient } from "@supabase/supabase-js";

export type KnowledgeChunk = {
  id: string;
  sourceType: string;
  sourceSlug: string;
  title: string;
  sectionTitle: string;
  chunkText: string;
  url: string;
  updatedAt: string;
};

type KnowledgeChunkRow = {
  id: string;
  source_type: string;
  source_slug: string;
  title: string;
  section_title: string;
  chunk_text: string;
  url: string;
  updated_at: string;
};

function hasRequiredEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.OPENAI_API_KEY
  );
}

function toKnowledgeChunk(row: KnowledgeChunkRow): KnowledgeChunk {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceSlug: row.source_slug,
    title: row.title,
    sectionTitle: row.section_title,
    chunkText: row.chunk_text,
    url: row.url,
    updatedAt: row.updated_at
  };
}

export async function retrieveRelevantChunks(query: string): Promise<KnowledgeChunk[]> {
  const normalizedQuery = query.trim();

  if (!normalizedQuery || !hasRequiredEnv()) {
    return [];
  }

  try {
    // Embedding generation is intentionally not wired yet, so this calls a
    // parameterized SQL retrieval contract around the future vector path.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );

    const { data, error } = await supabase.rpc("match_knowledge_chunks", {
      query_text: normalizedQuery,
      match_count: 5
    });

    if (error || !Array.isArray(data)) {
      return [];
    }

    return (data as KnowledgeChunkRow[]).map(toKnowledgeChunk);
  } catch {
    return [];
  }
}
