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

alter table knowledge_chunks enable row level security;

revoke all on table knowledge_chunks from public;
revoke all on table knowledge_chunks from anon;
revoke all on table knowledge_chunks from authenticated;

comment on table knowledge_chunks is
  'Server-side RAG knowledge chunks. MVP access is service-role only; no anon read policy is defined.';

create or replace function match_knowledge_chunks(query_text text, match_count int default 5)
returns table (
  id uuid,
  source_type text,
  source_slug text,
  title text,
  section_title text,
  chunk_text text,
  url text,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    knowledge_chunks.id,
    knowledge_chunks.source_type,
    knowledge_chunks.source_slug,
    knowledge_chunks.title,
    knowledge_chunks.section_title,
    knowledge_chunks.chunk_text,
    knowledge_chunks.url,
    knowledge_chunks.updated_at
  from knowledge_chunks
  where
    query_text <> ''
    and (
      knowledge_chunks.title ilike '%' || query_text || '%'
      or knowledge_chunks.section_title ilike '%' || query_text || '%'
      or knowledge_chunks.chunk_text ilike '%' || query_text || '%'
    )
  order by knowledge_chunks.updated_at desc
  limit least(greatest(match_count, 1), 20);
$$;

revoke all on function match_knowledge_chunks(text, int) from public;
revoke all on function match_knowledge_chunks(text, int) from anon;
revoke all on function match_knowledge_chunks(text, int) from authenticated;

comment on function match_knowledge_chunks(text, int) is
  'Parameterized keyword retrieval contract for server-side RAG. Called with the service role key only.';
