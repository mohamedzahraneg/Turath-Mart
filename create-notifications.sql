-- 1. Create notifications table
CREATE TABLE IF NOT EXISTS public.zahranship_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type TEXT NOT NULL, -- 'new_order', 'status_change', 'inventory_alert', 'whatsapp_sent'
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    order_id TEXT, -- References zahranship_orders.id
    order_num TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_by TEXT, -- Optional: User name who triggered this
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Add RLS (Row Level Security)
ALTER TABLE public.zahranship_notifications ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read and update (read status) notifications
CREATE POLICY "Allow authenticated users to read all notifications"
    ON public.zahranship_notifications
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated users to update own notifications read status"
    ON public.zahranship_notifications
    FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated users to insert notifications"
    ON public.zahranship_notifications
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- 3. Enable Real-time
-- Check if publication already exists, if so add table, if not create publication
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE zahranship_notifications;
    ELSE
        CREATE PUBLICATION supabase_realtime FOR TABLE zahranship_notifications;
    END IF;
END $$;
