-- Order Audit Logs Migration
-- Tracks all changes made to orders with user info and timestamps

CREATE TABLE IF NOT EXISTS public.order_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT NOT NULL,
  order_num TEXT NOT NULL,
  action TEXT NOT NULL,
  field_changed TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  changed_by_role TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_audit_logs_order_id ON public.order_audit_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_order_audit_logs_order_num ON public.order_audit_logs(order_num);
CREATE INDEX IF NOT EXISTS idx_order_audit_logs_created_at ON public.order_audit_logs(created_at DESC);

ALTER TABLE public.order_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open_access_audit_logs" ON public.order_audit_logs;
CREATE POLICY "open_access_audit_logs"
ON public.order_audit_logs
FOR ALL
TO public
USING (true)
WITH CHECK (true);
