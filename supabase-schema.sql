-- ============================================================
-- BAGEL BOWL — Complete Supabase SQL Schema
-- Paste this entire file into Supabase SQL Editor and click Run
-- ============================================================

-- 1. ATTENDEES
create table if not exists attendees (
  id              bigint generated always as identity primary key,
  name            text not null,
  partner_name    text,
  device_id       text unique not null,
  role            text not null default 'competitor',
  -- roles: competitor | judge | floater | wildcard
  has_cheese      boolean default true,
  own_cheese_id   bigint,
  cheese_1        bigint,   -- assigned to taste
  cheese_2        bigint,   -- assigned to taste
  checked_in_at   timestamptz default now()
);

-- 2. CHEESES
create table if not exists cheeses (
  id               bigint generated always as identity primary key,
  name             text not null,
  brought_by       bigint references attendees(id),
  partner_name     text,
  active           boolean default false,
  round            int default 1,
  assignment_count int default 0,
  eliminated_round int,
  notes            text,   -- e.g. 'DUPLICATE'
  created_at       timestamptz default now()
);

-- Add foreign key from attendees to cheeses (after both tables exist)
alter table attendees
  add constraint fk_own_cheese
  foreign key (own_cheese_id) references cheeses(id) on delete set null;

-- 3. RATINGS
create table if not exists ratings (
  id           bigint generated always as identity primary key,
  attendee_id  bigint references attendees(id) not null,
  cheese_id    bigint references cheeses(id) not null,
  dt_er_score  int check (dt_er_score between 1 and 10),
  retire       boolean default false,
  vc_score     int check (vc_score between 1 and 10),
  roast        text,
  submitted_at timestamptz default now(),
  unique(attendee_id, cheese_id)   -- prevents double voting
);

-- 4. BRACKET MATCHES
create table if not exists bracket_matches (
  id              bigint generated always as identity primary key,
  round           int not null,
  cheese_a        bigint references cheeses(id),
  cheese_b        bigint references cheeses(id),
  score_a         numeric(5,2),
  score_b         numeric(5,2),
  winner_id       bigint references cheeses(id),
  rating_count_a  int default 0,
  rating_count_b  int default 0,
  created_at      timestamptz default now()
);

-- 5. PHOTOS
create table if not exists photos (
  id            bigint generated always as identity primary key,
  uploaded_by   bigint references attendees(id),
  url           text not null,
  path          text not null,
  uploaded_at   timestamptz default now()
);

-- ============================================================
-- RPC FUNCTION: increment assignment count atomically
-- This prevents race conditions when two people check in at once
-- ============================================================
create or replace function increment_assignment(cheese_id bigint)
returns void
language sql
as $$
  update cheeses
  set assignment_count = assignment_count + 1
  where id = cheese_id;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table attendees enable row level security;
alter table cheeses enable row level security;
alter table ratings enable row level security;
alter table bracket_matches enable row level security;
alter table photos enable row level security;

-- Attendees: anyone can insert (check-in), anyone can read
create policy "attendees_insert" on attendees for insert with check (true);
create policy "attendees_select" on attendees for select using (true);
create policy "attendees_update" on attendees for update using (true);

-- Cheeses: anyone can insert (register a cheese), anyone can read, host can update
create policy "cheeses_insert" on cheeses for insert with check (true);
create policy "cheeses_select" on cheeses for select using (true);
create policy "cheeses_update" on cheeses for update using (true);

-- Ratings: anyone can insert, anyone can read (for leaderboard)
create policy "ratings_insert" on ratings for insert with check (true);
create policy "ratings_select" on ratings for select using (true);

-- Bracket: anyone can read, insert (host only in practice)
create policy "bracket_select" on bracket_matches for select using (true);
create policy "bracket_insert" on bracket_matches for insert with check (true);

-- Photos: anyone can insert, anyone can read
create policy "photos_insert" on photos for insert with check (true);
create policy "photos_select" on photos for select using (true);

-- ============================================================
-- STORAGE BUCKET for party photos
-- Run this separately in Supabase Storage if SQL doesn't work:
-- Storage → New Bucket → name: party-photos → Public: ON
-- ============================================================
insert into storage.buckets (id, name, public)
values ('party-photos', 'party-photos', true)
on conflict (id) do nothing;

-- Allow anyone to upload to party-photos
create policy "party_photos_upload"
on storage.objects for insert
with check (bucket_id = 'party-photos');

-- Allow anyone to view party photos
create policy "party_photos_read"
on storage.objects for select
using (bucket_id = 'party-photos');

-- ============================================================
-- INDEXES for performance (60 cheeses is tiny, but good practice)
-- ============================================================
create index if not exists idx_cheeses_active_round on cheeses(active, round);
create index if not exists idx_ratings_cheese_id on ratings(cheese_id);
create index if not exists idx_ratings_attendee_id on ratings(attendee_id);
create index if not exists idx_attendees_device_id on attendees(device_id);
