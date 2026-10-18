create table if not exists public.ux_knowledge_memory (
  id uuid primary key default gen_random_uuid(),
  raw_feedback text not null,
  model_payload jsonb not null check (jsonb_typeof(model_payload) = 'object'),
  source_type text not null default 'chatgpt_mcp',
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'archived')),
  review_note text,
  source_audit_id uuid references public.audits(id) on delete set null,
  source_finding_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  usage_count integer not null default 0 check (usage_count >= 0),
  last_used_at timestamptz
);

create index if not exists ux_knowledge_memory_status_updated_idx
  on public.ux_knowledge_memory (status, updated_at desc);

create index if not exists ux_knowledge_memory_source_audit_idx
  on public.ux_knowledge_memory (source_audit_id)
  where source_audit_id is not null;

alter table public.ux_knowledge_memory enable row level security;
revoke all on table public.ux_knowledge_memory from anon, authenticated;
grant all on table public.ux_knowledge_memory to service_role;
