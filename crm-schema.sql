-- 1. Create CRM Complaints Table
CREATE TABLE IF NOT EXISTS public.turath_masr_crm_complaints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_phone TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT DEFAULT 'open', -- 'open', 'resolved', 'pending'
    notes TEXT,
    created_by TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create CRM Chat Table
CREATE TABLE IF NOT EXISTS public.turath_masr_crm_chat (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_phone TEXT NOT NULL,
    sender TEXT NOT NULL, -- 'support', 'customer'
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Add RLS (Row Level Security)
ALTER TABLE public.turath_masr_crm_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turath_masr_crm_chat ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read/write CRM complaints"
    ON public.turath_masr_crm_complaints
    FOR ALL TO authenticated
    USING (true);

CREATE POLICY "Allow authenticated users to read/write CRM chat"
    ON public.turath_masr_crm_chat
    FOR ALL TO authenticated
    USING (true);

-- 4. Enable Real-time
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_search_path WHERE schema_name = 'public') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
            CREATE PUBLICATION supabase_realtime FOR ALL TABLES;
        ELSE
            ALTER PUBLICATION supabase_realtime ADD TABLE turath_masr_crm_complaints;
            ALTER PUBLICATION supabase_realtime ADD TABLE turath_masr_crm_chat;
        END IF;
    END IF;
END $$;
-- 5. Create Settings Table
CREATE TABLE IF NOT EXISTS public.turath_masr_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.turath_masr_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read/write settings"
    ON public.turath_masr_settings
    FOR ALL TO authenticated
    USING (true);

-- Enable Real-time for settings
ALTER PUBLICATION supabase_realtime ADD TABLE turath_masr_settings;
