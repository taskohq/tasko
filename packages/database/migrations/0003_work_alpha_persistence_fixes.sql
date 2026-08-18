-- Align the physical schema with the Work Alpha contracts and query paths.
alter table work_items add column if not exists sprint_id uuid references sprints(id);
create index if not exists work_items_tenant_sprint_idx on work_items (tenant_id, sprint_id);

alter table saved_views add column if not exists project_id uuid references projects(id);
create index if not exists saved_views_tenant_project_idx on saved_views (tenant_id, project_id, owner_member_id);
