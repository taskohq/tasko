import pg from "pg";
import { randomUUID } from "node:crypto";

const tko_connectionString = process.env.TASKO_POSTGRES_URL;
const tko_ownerAuthSubject = process.env.OWNER_OPEN_ID;
const tko_tenantSlug = process.env.TASKO_SINGLE_TENANT_SLUG ?? "tasko-demo";
if (!tko_connectionString || !tko_ownerAuthSubject) {
  throw new Error("TASKO_POSTGRES_URL and OWNER_OPEN_ID are required for the Tasko seed workspace.");
}

const tko_pool = new pg.Pool({ connectionString: tko_connectionString });
const tko_client = await tko_pool.connect();
try {
  await tko_client.query("begin");
  const tko_tenantResult = await tko_client.query(
    `insert into tenants (id, slug, name, status, deployment_profile)
     values ($1, $2, 'Tasko Demo Workspace', 'active', $3)
     on conflict (slug) do update set name = excluded.name
     returning id`,
    [randomUUID(), tko_tenantSlug, process.env.DEPLOYMENT_PROFILE === "saas" ? "saas" : "single_tenant"],
  );
  const tko_seedMembers = [
    [tko_ownerAuthSubject, "owner", "Demo Owner"],
    [`demo-admin:${tko_tenantSlug}`, "admin", "Demo Admin"],
    [`demo-member:${tko_tenantSlug}`, "member", "Demo Member"],
    [`demo-guest:${tko_tenantSlug}`, "guest", "Demo Guest"],
    [process.env.TASKO_WORKER_SERVICE_SUBJECT ?? "service:tasko-worker", "service_account", "Tasko Worker"],
  ];
  for (const [tko_authSubject, tko_role, tko_displayName] of tko_seedMembers) {
    const tko_userResult = await tko_client.query(
      `insert into users (id, auth_subject, status)
       values ($1, $2, 'active')
       on conflict (auth_subject) do update set status = 'active'
       returning id`,
      [randomUUID(), tko_authSubject],
    );
    await tko_client.query(
      `insert into tenant_members (id, tenant_id, user_id, role, status, display_name)
       values ($1, $2, $3, $4, 'active', $5)
       on conflict (tenant_id, user_id) do update set role = excluded.role, status = 'active', display_name = excluded.display_name`,
      [randomUUID(), tko_tenantResult.rows[0].id, tko_userResult.rows[0].id, tko_role, tko_displayName],
    );
  }
  const tko_tenantId = tko_tenantResult.rows[0].id;
  const tko_ownerMember = await tko_client.query(
    `select tm.id from tenant_members tm join users u on u.id = tm.user_id where tm.tenant_id = $1 and u.auth_subject = $2`,
    [tko_tenantId, tko_ownerAuthSubject],
  );
  const tko_existingProject = await tko_client.query(`select id from projects where tenant_id = $1 and key = 'TASKO'`, [tko_tenantId]);
  if (!tko_existingProject.rowCount) {
    const tko_spaceId = randomUUID();
    const tko_workflowId = randomUUID();
    const tko_projectId = randomUUID();
    await tko_client.query(`insert into spaces (id, tenant_id, name, slug, visibility) values ($1, $2, 'Product', 'product', 'internal')`, [tko_spaceId, tko_tenantId]);
    await tko_client.query(`insert into workflows (id, tenant_id, name) values ($1, $2, 'Tasko Work Alpha workflow')`, [tko_workflowId, tko_tenantId]);
    const tko_statusIds = [randomUUID(), randomUUID(), randomUUID()];
    for (const [tko_index, tko_status] of [["To do", "todo", "status.todo"], ["In progress", "in_progress", "status.progress"], ["Done", "done", "status.done"]].entries()) {
      await tko_client.query(`insert into workflow_statuses (id, tenant_id, workflow_id, name, category, color_token, sort_order) values ($1,$2,$3,$4,$5,$6,$7)`, [tko_statusIds[tko_index], tko_tenantId, tko_workflowId, ...tko_status, (tko_index + 1) * 100]);
    }
    const tko_taskTypeId = randomUUID();
    await tko_client.query(`insert into projects (id, tenant_id, space_id, key, name, description, owner_member_id, visibility, methodology, workflow_id, sequence_counter) values ($1,$2,$3,'TASKO','Tasko Work Alpha','M1 demo workspace',$4,'internal','scrum',$5,3)`, [tko_projectId, tko_tenantId, tko_spaceId, tko_ownerMember.rows[0].id, tko_workflowId]);
    await tko_client.query(`insert into work_types (id, tenant_id, project_id, name, category, icon) values ($1,$2,$3,'Task','task','check-square')`, [tko_taskTypeId, tko_tenantId, tko_projectId]);
    const tko_itemIds = [randomUUID(), randomUUID(), randomUUID()];
    const tko_items = [["Define sprint objective", "high", tko_statusIds[0]], ["Ship project board", "urgent", tko_statusIds[1]], ["Confirm tenant isolation tests", "high", tko_statusIds[2]]];
    for (const [tko_index, [tko_title, tko_priority, tko_statusId]] of tko_items.entries()) {
      await tko_client.query(`insert into work_items (id, tenant_id, project_id, sequence_no, work_type_id, workflow_id, status_id, title, priority, reporter_member_id, rank, completed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $12 = 'done' then now() else null end)`, [tko_itemIds[tko_index], tko_tenantId, tko_projectId, tko_index + 1, tko_taskTypeId, tko_workflowId, tko_statusId, tko_title, tko_priority, tko_ownerMember.rows[0].id, `m${tko_index}`, tko_index === 2 ? "done" : ""]);
    }
    const tko_sprintId = randomUUID();
    await tko_client.query(`insert into sprints (id, tenant_id, project_id, name, goal, state) values ($1,$2,$3,'Sprint 1','Establish the Work Alpha operating loop','active')`, [tko_sprintId, tko_tenantId, tko_projectId]);
    for (const tko_itemId of tko_itemIds) await tko_client.query(`insert into sprint_items (tenant_id, sprint_id, work_item_id) values ($1,$2,$3)`, [tko_tenantId, tko_sprintId, tko_itemId]);
    await tko_client.query(`update work_items set sprint_id = $1 where tenant_id = $2 and id = any($3::uuid[])`, [tko_sprintId, tko_tenantId, tko_itemIds]);
  }
  const tko_pilotMembers = await tko_client.query(
    `select tm.id, u.auth_subject from tenant_members tm join users u on u.id = tm.user_id
     where tm.tenant_id = $1 and u.auth_subject = any($2::text[]) and tm.status = 'active'`,
    [tko_tenantId, [tko_ownerAuthSubject, `demo-admin:${tko_tenantSlug}`, `demo-member:${tko_tenantSlug}`]],
  );
  const tko_productChannel = await tko_client.query(
    `insert into channels (id, tenant_id, kind, name, topic, visibility, last_sequence)
     values ($1, $2, 'public', 'product', 'Tasko Collaboration Alpha controlled pilot', 'internal', 2)
     on conflict (tenant_id, name) do update set topic = excluded.topic
     returning id`,
    [randomUUID(), tko_tenantId],
  );
  const tko_channelId = tko_productChannel.rows[0].id;
  for (const tko_member of tko_pilotMembers.rows) {
    await tko_client.query(
      `insert into channel_members (tenant_id, channel_id, member_id, last_read_seq)
       values ($1, $2, $3, case when $4 = $5 then 2 else 0 end)
       on conflict (channel_id, member_id) do nothing`,
      [tko_tenantId, tko_channelId, tko_member.id, tko_member.auth_subject, tko_ownerAuthSubject],
    );
  }
  const tko_ownerMemberId = tko_ownerMember.rows[0].id;
  const tko_chatMessages = [
    ["00000000-0000-4000-8000-000000000001", 1, "Welcome to the Tasko product channel. This pilot connects daily discussion to Work Alpha."],
    ["00000000-0000-4000-8000-000000000002", 2, "Please use replies for focused decisions and link the resulting message to the matching work item."],
  ];
  for (const [tko_clientMessageId, tko_sequence, tko_text] of tko_chatMessages) {
    await tko_client.query(
      `insert into messages (id, tenant_id, channel_id, sequence, client_message_id, author_member_id, body, plain_text)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       on conflict (channel_id, client_message_id) do nothing`,
      [randomUUID(), tko_tenantId, tko_channelId, tko_sequence, tko_clientMessageId, tko_ownerMemberId, JSON.stringify({ type: "text", text: tko_text }), tko_text],
    );
  }
  await tko_client.query("commit");
  console.log(`Tasko seed workspace is ready: ${tko_tenantSlug}`);
} catch (tko_error) {
  await tko_client.query("rollback");
  throw tko_error;
} finally {
  tko_client.release();
  await tko_pool.end();
}
