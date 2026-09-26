-- Keep brief ownership cascades and monthly admin analytics indexed.
create index if not exists hunter_briefs_created_by_idx on public.hunter_briefs(created_by);
create index if not exists hunter_messages_kind_created_idx on public.hunter_messages(message_kind, created_at desc);


