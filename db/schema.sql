-- Duty Ledger core schema (Postgres). Jurisdiction-neutral by design:
-- authorities, rates and rules are data; only the tariff engine knows the US.
-- Every tenant table carries org_id and is protected by row-level security.

create extension if not exists pgcrypto;

create table organization (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table app_user (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  email text not null unique,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now()
);

create table importer_of_record (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  ior_number text not null,
  bond_info jsonb,
  unique (org_id, ior_number)
);

create table broker (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  name text not null,
  license_ref text
);

create table document (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  doc_type text not null check (doc_type in ('ace_report','entry_summary_7501','commercial_invoice','packing_list','bol','other')),
  source text not null,
  storage_path text not null,
  sha256 text not null,
  extraction_status text not null default 'pending' check (extraction_status in ('pending','done','failed','needs_review')),
  created_at timestamptz not null default now(),
  unique (org_id, sha256)
);

create table entry (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  ior_id uuid not null references importer_of_record(id),
  broker_id uuid references broker(id),
  entry_number text not null,
  port text,
  entry_date date not null,
  liquidation_date date,
  liquidation_status text not null default 'unliquidated' check (liquidation_status in ('unliquidated','liquidated','finally_liquidated','protested')),
  source_document_id uuid references document(id),
  unique (org_id, entry_number)
);

create table product (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  sku text not null,
  description text not null,
  supplier text,
  attributes jsonb not null default '{}',
  unique (org_id, sku)
);

create table entry_line (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  entry_id uuid not null references entry(id) on delete cascade,
  line_number int not null,
  product_id uuid references product(id),
  hts text not null,
  origin text not null,
  entered_value numeric(14,2) not null,
  quantity numeric(14,3),
  -- duty actually paid, by authority: {"MFN": 100.00, "S301": 250.00, ...}
  duty_paid jsonb not null default '{}',
  unique (entry_id, line_number)
);

create table classification (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  product_id uuid not null references product(id),
  hts text not null,
  origin text not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  status text not null default 'proposed' check (status in ('proposed','reviewed','accepted','disputed')),
  evidence jsonb not null default '[]',
  reviewed_by uuid references app_user(id),
  created_at timestamptz not null default now()
);

-- Global (not tenant-scoped) tariff content. Versioned and cited.
create table tariff_rule (
  id text primary key,
  authority text not null,
  rate numeric(8,6) not null,
  effective_from date not null,
  effective_to date,
  hts_prefixes text[] not null default '{}',
  origins text[] not null default '{}',
  citation text not null,
  rule_version text not null
);

create table finding (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  entry_id uuid not null references entry(id),
  entry_line_id uuid references entry_line(id),
  kind text not null check (kind in ('misclassification','origin','valuation','stacking','refund_eligible','other')),
  recoverable_usd numeric(14,2) not null default 0,
  at_risk_usd numeric(14,2) not null default 0,
  confidence numeric(4,3) not null,
  evidence jsonb not null default '[]',
  rule_versions text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table recovery_case (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  finding_ids uuid[] not null,
  status text not null default 'draft' check (status in ('draft','awaiting_approval','sent_to_broker','filed','recovered','closed')),
  deadline date,
  assigned_to text,
  recovered_usd numeric(14,2)
);

-- Approval gate is first class: nothing leaves the system without one.
create table approval (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organization(id),
  subject_type text not null,
  subject_id uuid not null,
  action text not null,
  requested_by uuid references app_user(id),
  approved_by uuid references app_user(id),
  approved_at timestamptz
);

-- Append-only audit trail.
create table audit_event (
  id bigint generated always as identity primary key,
  org_id uuid not null references organization(id),
  actor uuid references app_user(id),
  action text not null,
  subject_type text not null,
  subject_id uuid,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

create or replace function audit_event_immutable() returns trigger as $$
begin
  raise exception 'audit_event is append-only';
end;
$$ language plpgsql;

create trigger audit_event_no_update before update or delete on audit_event
  for each row execute function audit_event_immutable();

-- Row-level security: tenant tables only see their own org.
-- The app sets: select set_config('app.org_id', '<uuid>', true);
do $$
declare t text;
begin
  foreach t in array array[
    'app_user','importer_of_record','broker','document','entry','product',
    'entry_line','classification','finding','recovery_case','approval','audit_event'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (org_id = current_setting(''app.org_id'', true)::uuid)', t);
  end loop;
end $$;
