-- 1. Create the inventory table
CREATE TABLE IF NOT EXISTS public.turath_masr_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    sku TEXT UNIQUE NOT NULL,
    available INTEGER DEFAULT 0,
    withdrawn INTEGER DEFAULT 0,
    min_stock INTEGER DEFAULT 10,
    price NUMERIC DEFAULT 0,
    category TEXT,
    images TEXT[],
    colors TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Enable Row Level Security (optional but recommended)
ALTER TABLE public.turath_masr_inventory ENABLE ROW LEVEL SECURITY;

-- 3. Create Policy (Allow authenticated users to read/write)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'turath_masr_inventory' 
        AND policyname = 'Allow all actions for authenticated users on inventory'
    ) THEN
        CREATE POLICY "Allow all actions for authenticated users on inventory"
        ON public.turath_masr_inventory
        FOR ALL TO authenticated
        USING (true);
    END IF;
END $$;

-- 4. Insert initial mock data
INSERT INTO public.turath_masr_inventory (name, sku, available, withdrawn, min_stock, price, category, colors)
VALUES 
  ('حامل مصحف بني', 'HMB-001', 45, 120, 20, 300, 'حوامل', ARRAY['بني']),
  ('حامل مصحف أسود', 'HMA-002', 8, 92, 20, 300, 'حوامل', ARRAY['أسود']),
  ('حامل مصحف أبيض', 'HMW-003', 32, 68, 20, 300, 'حوامل', ARRAY['أبيض']),
  ('حامل مصحف ذهبي', 'HMG-004', 5, 75, 20, 350, 'حوامل', ARRAY['ذهبي']),
  ('كشاف', 'KSH-005', 67, 133, 30, 150, 'إكسسوارات', ARRAY[]::TEXT[]),
  ('كرسي', 'KRS-006', 18, 42, 10, 500, 'أثاث', ARRAY[]::TEXT[]),
  ('مصحف', 'MSH-007', 95, 205, 50, 200, 'كتب', ARRAY[]::TEXT[]),
  ('كعبة', 'KAB-008', 3, 47, 10, 450, 'ديكور', ARRAY[]::TEXT[])
ON CONFLICT (sku) DO NOTHING;
