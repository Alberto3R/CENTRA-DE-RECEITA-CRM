-- ===== 001_initial_schema.sql =====
-- ============================================================
-- Idempotent migration — safe to run multiple times.
-- Uses IF NOT EXISTS for tables/indexes and DROP IF EXISTS
-- for policies/triggers (Postgres has no CREATE POLICY IF NOT EXISTS).
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  company TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own contacts" ON contacts;
CREATE POLICY "Users can manage own contacts" ON contacts FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- TAGS
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own tags" ON tags;
CREATE POLICY "Users can manage own tags" ON tags FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- CONTACT_TAGS (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON contact_tags(tag_id);

ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage contact tags" ON contact_tags;
CREATE POLICY "Users can manage contact tags" ON contact_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_tags.contact_id AND contacts.user_id = auth.uid()));

-- ============================================================
-- CUSTOM_FIELDS
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  field_options JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own custom fields" ON custom_fields;
CREATE POLICY "Users can manage own custom fields" ON custom_fields FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- CONTACT_CUSTOM_VALUES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_custom_values (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, custom_field_id)
);

ALTER TABLE contact_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage custom values" ON contact_custom_values;
CREATE POLICY "Users can manage custom values" ON contact_custom_values FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_custom_values.contact_id AND contacts.user_id = auth.uid()));

-- ============================================================
-- CONTACT_NOTES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own notes" ON contact_notes;
CREATE POLICY "Users can manage own notes" ON contact_notes FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  assigned_agent_id UUID,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations(contact_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own conversations" ON conversations;
CREATE POLICY "Users can manage own conversations" ON conversations FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'agent', 'bot')),
  sender_id UUID,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'image', 'document', 'audio', 'video', 'location', 'template')),
  content_text TEXT,
  media_url TEXT,
  template_name TEXT,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own messages" ON messages;
DROP POLICY IF EXISTS "Service role can insert messages" ON messages;
CREATE POLICY "Users can view own messages" ON messages FOR ALL
  USING (EXISTS (SELECT 1 FROM conversations WHERE conversations.id = messages.conversation_id AND conversations.user_id = auth.uid()));
CREATE POLICY "Service role can insert messages" ON messages FOR INSERT WITH CHECK (true);

-- ============================================================
-- WHATSAPP_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT,
  access_token TEXT NOT NULL,
  verify_token TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own config" ON whatsapp_config;
CREATE POLICY "Users can manage own config" ON whatsapp_config FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- MESSAGE_TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Marketing' CHECK (category IN ('Marketing', 'Utility', 'Authentication')),
  language TEXT DEFAULT 'en_US',
  header_type TEXT CHECK (header_type IN ('text', 'image', 'video', 'document')),
  header_content TEXT,
  body_text TEXT NOT NULL,
  footer_text TEXT,
  buttons JSONB,
  status TEXT DEFAULT 'Draft' CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own templates" ON message_templates;
CREATE POLICY "Users can manage own templates" ON message_templates FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- PIPELINES
-- ============================================================
CREATE TABLE IF NOT EXISTS pipelines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own pipelines" ON pipelines;
CREATE POLICY "Users can manage own pipelines" ON pipelines FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- PIPELINE_STAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage pipeline stages" ON pipeline_stages;
CREATE POLICY "Users can manage pipeline stages" ON pipeline_stages FOR ALL
  USING (EXISTS (SELECT 1 FROM pipelines WHERE pipelines.id = pipeline_stages.pipeline_id AND pipelines.user_id = auth.uid()));

-- ============================================================
-- DEALS
-- ============================================================
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  conversation_id UUID REFERENCES conversations(id),
  title TEXT NOT NULL,
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  notes TEXT,
  expected_close_date DATE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own deals" ON deals;
CREATE POLICY "Users can manage own deals" ON deals FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- BROADCASTS
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL DEFAULT 'en_US',
  template_variables JSONB,
  audience_filter JSONB,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0,
  replied_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own broadcasts" ON broadcasts;
CREATE POLICY "Users can manage own broadcasts" ON broadcasts FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- BROADCAST_RECIPIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON broadcast_recipients(broadcast_id);

ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage broadcast recipients" ON broadcast_recipients;
CREATE POLICY "Users can manage broadcast recipients" ON broadcast_recipients FOR ALL
  USING (EXISTS (SELECT 1 FROM broadcasts WHERE broadcasts.id = broadcast_recipients.broadcast_id AND broadcasts.user_id = auth.uid()));

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to tables with updated_at — drop existing triggers first to avoid conflicts
DROP TRIGGER IF EXISTS set_updated_at ON profiles;
DROP TRIGGER IF EXISTS set_updated_at ON contacts;
DROP TRIGGER IF EXISTS set_updated_at ON conversations;
DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_config;
DROP TRIGGER IF EXISTS set_updated_at ON message_templates;
DROP TRIGGER IF EXISTS set_updated_at ON deals;
DROP TRIGGER IF EXISTS set_updated_at ON broadcasts;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON broadcasts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- AUTO-CREATE PROFILE ON USER SIGNUP
-- Uses SECURITY DEFINER with owner=postgres (bypasses RLS).
-- EXCEPTION block ensures signup still succeeds even if profile
-- insert fails — profile can be created later if needed.
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- ENABLE REALTIME for key tables (idempotent via DO block)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
  END IF;
END $$;

-- ===== 002_pipelines_enhancements.sql =====
-- ============================================================
-- Pipeline enhancements:
--   * deals.assigned_to — optional FK to profiles.id
--   * deals.status — CHECK constraint ('open', 'won', 'lost')
--     (replaces the old default 'active' with spec-compliant values)
--
-- Idempotent: safe to run multiple times.
-- ============================================================

-- Add assigned_to (nullable, FK to profiles)
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_assigned_to ON deals(assigned_to);

-- Normalize status values: any existing 'active' row becomes 'open'
UPDATE deals SET status = 'open' WHERE status = 'active' OR status IS NULL;

-- Replace the old default and enforce allowed values
ALTER TABLE deals ALTER COLUMN status SET DEFAULT 'open';

-- Drop prior CHECK if any (none in 001, but be idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_status_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals DROP CONSTRAINT deals_status_check;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_status_check CHECK (status IN ('open', 'won', 'lost'));

-- ===== 003_broadcast_recipient_wamid.sql =====
-- ============================================================
-- Broadcast recipient correlation + aggregate counts
--
-- Problem this solves:
--   * broadcast_recipients had no column to correlate with Meta's
--     message id, so webhook status updates (sent/delivered/read)
--     could not be mirrored into the recipient row and the broadcast
--     aggregate counts never advanced.
--   * aggregate counts on `broadcasts` (sent/delivered/read/replied/
--     failed) were updated ad-hoc by the sender, which drifted quickly
--     once webhooks arrived out of band.
--
-- This migration:
--   1. Adds whatsapp_message_id (+ unique index) so webhooks can find
--      a recipient given Meta's message id.
--   2. Adds a composite index on (broadcast_id, status) so the
--      aggregate trigger's COUNT(*) FILTER scans are fast.
--   3. Installs an AFTER INSERT/UPDATE/DELETE trigger on
--      broadcast_recipients that re-aggregates the parent broadcasts
--      row. Keeps writer code trivial — the webhook + hook only touch
--      the recipient row; counts stay consistent automatically.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;

-- UNIQUE so webhook retries can't create duplicate correlations.
CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_recipients_wamid
  ON broadcast_recipients (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- Fast path for the aggregate trigger's COUNT(*) FILTER subqueries.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status
  ON broadcast_recipients (broadcast_id, status);

-- ============================================================
-- Aggregate trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.broadcast_recipient_aggregate_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_broadcast_counts(OLD.broadcast_id);
    RETURN OLD;
  END IF;

  -- INSERT or UPDATE — only recompute when status changed (or on fresh insert)
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.recompute_broadcast_counts(NEW.broadcast_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS broadcast_recipients_aggregate ON broadcast_recipients;
CREATE TRIGGER broadcast_recipients_aggregate
AFTER INSERT OR UPDATE OR DELETE ON broadcast_recipients
FOR EACH ROW EXECUTE FUNCTION public.broadcast_recipient_aggregate_trigger();

-- ===== 004_contact_delete_set_null.sql =====
-- ============================================================
-- Allow contact deletion without wiping history.
--
-- broadcast_recipients.contact_id and deals.contact_id were declared
-- NOT NULL REFERENCES contacts(id) with no ON DELETE action, so
-- Postgres defaults to NO ACTION. The first time a user tried to
-- delete a contact that had ever received a broadcast or been
-- attached to a deal, the delete failed with:
--
--   ERROR 23503: update or delete on table "contacts" violates
--   foreign key constraint ... on table <other>
--
-- CASCADE is the wrong fix — it would silently wipe historical
-- broadcast recipient rows (breaking audit + retroactively moving
-- broadcasts.sent_count / delivered_count / read_count etc. via the
-- aggregate trigger) and deal rows.
--
-- SET NULL is the right fix: history rows survive with a NULL
-- contact_id. The UI is already null-safe (contact?.name ?? 'Unknown',
-- contact?.phone, etc.).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ── broadcast_recipients.contact_id ────────────────────────────
ALTER TABLE broadcast_recipients
  ALTER COLUMN contact_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'broadcast_recipients_contact_id_fkey'
      AND conrelid = 'broadcast_recipients'::regclass
  ) THEN
    ALTER TABLE broadcast_recipients
      DROP CONSTRAINT broadcast_recipients_contact_id_fkey;
  END IF;
END $$;

ALTER TABLE broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
    ON DELETE SET NULL;

-- ── deals.contact_id ───────────────────────────────────────────
ALTER TABLE deals
  ALTER COLUMN contact_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_contact_id_fkey'
      AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      DROP CONSTRAINT deals_contact_id_fkey;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
    ON DELETE SET NULL;

-- ===== 005_broadcast_counts_incremental.sql =====
-- ============================================================
-- Incremental broadcast aggregate trigger.
--
-- Migration 003 installed a trigger that recomputed every counter
-- (sent/delivered/read/replied/failed) via COUNT(*) FILTER on every
-- row change. For a 10k-recipient broadcast, the send loop produces
-- 10k INSERTs + 10k UPDATEs = 20k full aggregate scans, each walking
-- the (broadcast_id, status) index. Workable at small scale, but
-- O(n²) overall.
--
-- This migration replaces that with an incremental trigger that
-- adjusts the parent broadcast's counts by ±1 based on the OLD →
-- NEW.status delta. O(1) per recipient change; no scans at all.
--
-- Semantic model (same as the lib/broadcast-status.ts "forward-only
-- ladder" in the webhook):
--   sent_count       = recipients whose status is at or past 'sent'
--   delivered_count  = ... at or past 'delivered'
--   read_count       = ... at or past 'read'
--   replied_count    = status = 'replied'
--   failed_count     = status = 'failed'
--
-- A webhook that advances a recipient pending → sent → delivered →
-- read → replied bumps every rung it crosses by 1. Going to 'failed'
-- only bumps failed_count (and can only happen from pending / sent,
-- enforced in the webhook).
--
-- Keeps the safety net: a public recompute_broadcast_counts() SQL
-- function is retained so ops can run it manually if counts ever
-- drift (e.g. after bulk DB surgery).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- Delta a single column by +1 / -1.
CREATE OR REPLACE FUNCTION public._bcast_bump(bid UUID, col TEXT, delta INT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format(
    'UPDATE broadcasts SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE id = $2',
    col, col
  ) USING delta, bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Columns this recipient's status contributes to.
CREATE OR REPLACE FUNCTION public._bcast_cols_for_status(s TEXT)
RETURNS TEXT[] AS $$
BEGIN
  -- 'pending' contributes to nothing.
  IF s = 'pending' THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'read'      THEN RETURN ARRAY['sent_count','delivered_count','read_count']; END IF;
  IF s = 'replied'   THEN RETURN ARRAY['sent_count','delivered_count','read_count','replied_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Replace the trigger body with the incremental version.
CREATE OR REPLACE FUNCTION public.broadcast_recipient_aggregate_trigger()
RETURNS TRIGGER AS $$
DECLARE
  old_cols TEXT[];
  new_cols TEXT[];
  c TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_cols := _bcast_cols_for_status(NEW.status);
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(OLD.broadcast_id, c, -1);
    END LOOP;
    RETURN OLD;
  END IF;

  -- UPDATE: only care if status changed.
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    new_cols := _bcast_cols_for_status(NEW.status);
    -- Subtract the old contributions, add the new.
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, -1);
    END LOOP;
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger itself remains the same (INSERT/UPDATE/DELETE) — just its
-- body has been replaced.

-- Safety net — rebuild counts from scratch. Retained as-is so ops can
-- run it on demand if something ever drifts. Matches the incremental
-- trigger's semantic model exactly.
CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ===== 006_automations.sql =====
-- ============================================================
-- 006_automations.sql — Automations feature
--
-- Idempotent migration — safe to run multiple times.
-- Follows the same conventions as 001_initial_schema.sql:
--   IF NOT EXISTS on tables/indexes, DROP IF EXISTS before
--   re-creating policies/triggers (Postgres has no
--   CREATE POLICY IF NOT EXISTS).
-- ============================================================

-- ============================================================
-- AUTOMATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automations_user_id ON automations(user_id);
-- Partial index tuned for the engine's hot path: find active automations
-- whose trigger_type matches the fired event. RLS then narrows by user_id.
CREATE INDEX IF NOT EXISTS idx_automations_active_trigger
  ON automations(trigger_type) WHERE is_active = TRUE;

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own automations" ON automations;
CREATE POLICY "Users can manage own automations" ON automations FOR ALL
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON automations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- AUTOMATION_STEPS
--
-- `position`       — order within parent scope (root scope or a branch).
-- `parent_step_id` — NULL for root-level steps; set to the Condition
--                    step's id for steps that live inside one of its
--                    branches.
-- `branch`         — NULL for root steps. For children of a Condition,
--                    'yes' or 'no' identifying which path.
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  parent_step_id UUID REFERENCES automation_steps(id) ON DELETE CASCADE,
  branch TEXT CHECK (branch IN ('yes', 'no')),
  step_type TEXT NOT NULL,
  step_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_steps_automation_id
  ON automation_steps(automation_id, position);
CREATE INDEX IF NOT EXISTS idx_automation_steps_parent
  ON automation_steps(parent_step_id) WHERE parent_step_id IS NOT NULL;

ALTER TABLE automation_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage steps of own automations" ON automation_steps;
CREATE POLICY "Users can manage steps of own automations" ON automation_steps FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM automations a
      WHERE a.id = automation_steps.automation_id
        AND a.user_id = auth.uid()
    )
  );

-- ============================================================
-- AUTOMATION_LOGS
--
-- user_id is denormalized for simple RLS; contact_id is nullable so
-- history survives contact deletion (mirrors migration 004's pattern
-- on broadcast_recipients / deals).
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  trigger_event TEXT NOT NULL,
  steps_executed JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_automation
  ON automation_logs(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_user ON automation_logs(user_id);

ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own automation logs" ON automation_logs;
CREATE POLICY "Users can view own automation logs" ON automation_logs FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- AUTOMATION_PENDING_EXECUTIONS
--
-- Queue row created when a running automation hits a `wait` step.
-- The cron endpoint drains rows where run_at <= now() and status =
-- 'pending', flips them to 'running', and resumes the automation
-- from `next_step_position` with the saved `context` jsonb.
--
-- Service-role only — writes never originate from the browser, and
-- the engine uses the service-role client. No user policy exposed.
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_pending_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  log_id UUID REFERENCES automation_logs(id) ON DELETE CASCADE,
  parent_step_id UUID REFERENCES automation_steps(id) ON DELETE SET NULL,
  branch TEXT CHECK (branch IN ('yes', 'no')),
  next_step_position INTEGER NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_pending_due
  ON automation_pending_executions(run_at) WHERE status = 'pending';

ALTER TABLE automation_pending_executions ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policy for authenticated users — all
-- access is server-side via the service-role key.

-- ===== 007_automations_increment_counter.sql =====
-- ============================================================
-- 007_automations_increment_counter.sql
--
-- Atomic increment of automations.execution_count + refresh of
-- last_executed_at. Called via PostgREST RPC from the engine.
--
-- Before this, the engine did a read-modify-write:
--   UPDATE automations SET execution_count = <cached + 1> WHERE id = ...
-- so two concurrent dispatches (e.g. the same automation firing for
-- two different contacts in the same second) could both read N and
-- both write N+1, permanently losing one count.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION increment_automation_execution_count(p_automation_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE automations
  SET
    execution_count = execution_count + 1,
    last_executed_at = NOW()
  WHERE id = p_automation_id;
$$;

-- Only the service role needs to call this (engine uses the
-- service-role client). Explicitly lock anon / authenticated out so
-- an authenticated user can't juice someone else's counter via RPC.
REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM anon;
REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_automation_execution_count(UUID) TO service_role;

-- ===== 008_profile_avatars_storage.sql =====
-- ============================================================
-- 008_profile_avatars_storage.sql
--
-- Creates the `avatars` Supabase Storage bucket and the RLS policies
-- that let each user manage only their own avatar file while letting
-- everyone read (so rendering <img> tags without signed URLs works).
--
-- File path convention used by the app:
--   avatars/{auth.uid()}/avatar-<timestamp>.<ext>
-- The policies rely on the first path segment matching auth.uid()::text.
--
-- Idempotent — safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  TRUE,
  2097152, -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies live on storage.objects. Drop-if-exists because Postgres
-- has no CREATE POLICY IF NOT EXISTS, and we want this migration to
-- re-run cleanly.
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
CREATE POLICY "Avatars are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ===== 009_message_actions.sql =====
-- ============================================================
-- Chat actions: reply linkage + reactions
--
-- Adds two things the chat UI now needs:
--
--   1. `messages.reply_to_message_id` — a self-FK so a message can
--      point at the message it replies to. We use the internal UUID
--      (not Meta's message_id text), because Meta IDs aren't unique
--      across phone numbers and can't be FK-constrained. The webhook
--      resolves `context.id` from Meta into our internal UUID before
--      writing. ON DELETE SET NULL — a deleted parent must not nuke
--      its replies (which today never happens, but the constraint
--      should match intent).
--
--   2. `message_reactions` table — one row per (message, actor).
--      Reactions arrive concurrently from agents (UI) and customers
--      (webhook). A row-level uniqueness constraint enforces "one
--      reaction per actor per message" without read-modify-write
--      games on a JSONB column.
--
--      `conversation_id` is denormalised purely so Supabase Realtime
--      can filter on it with a plain `eq`. Realtime can't join.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Reply linkage on messages
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID
  REFERENCES messages(id) ON DELETE SET NULL;

-- Partial index — most messages aren't replies, so skip nulls.
CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON messages(reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

-- ============================================================
-- 2. message_reactions
-- ============================================================
CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer', 'agent')),
  actor_id UUID,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, actor_type, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_conversation
  ON message_reactions(conversation_id);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON message_reactions(message_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see reactions on their conversations" ON message_reactions;
CREATE POLICY "Users see reactions on their conversations" ON message_reactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_reactions.conversation_id
      AND c.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users insert reactions on their conversations" ON message_reactions;
CREATE POLICY "Users insert reactions on their conversations" ON message_reactions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_reactions.conversation_id
      AND c.user_id = auth.uid()
  ));

-- Agents may remove their own reactions. Customer reactions are managed
-- by the webhook (service-role bypass), not the UI.
DROP POLICY IF EXISTS "Users delete their own agent reactions" ON message_reactions;
CREATE POLICY "Users delete their own agent reactions" ON message_reactions FOR DELETE
  USING (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- Agents may swap their own reaction emoji (UPDATE path is also used by
-- the upsert in /api/whatsapp/react).
DROP POLICY IF EXISTS "Users update their own agent reactions" ON message_reactions;
CREATE POLICY "Users update their own agent reactions" ON message_reactions FOR UPDATE
  USING (
    actor_type = 'agent'
    AND actor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- Realtime — let the thread subscribe filtered by conversation_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
  END IF;
END $$;

