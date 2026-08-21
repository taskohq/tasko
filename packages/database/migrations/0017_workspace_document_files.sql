-- File-backed workspace documents. Bytes remain in S3-compatible storage; this table stores only tenant-scoped metadata.
alter table workspace_documents
  add column if not exists document_kind text not null default 'note' check (document_kind in ('note', 'file')),
  add column if not exists project_id uuid references projects(id) on delete set null,
  add column if not exists object_key text,
  add column if not exists filename text,
  add column if not exists content_type text,
  add column if not exists byte_size bigint check (byte_size is null or byte_size >= 0);

create index if not exists workspace_documents_tenant_project_updated_idx on workspace_documents(tenant_id, project_id, updated_at desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspace_documents_file_metadata_ck') then
    alter table workspace_documents add constraint workspace_documents_file_metadata_ck check (
      document_kind = 'note' or (object_key is not null and filename is not null and content_type is not null and byte_size is not null)
    );
  end if;
end $$;
