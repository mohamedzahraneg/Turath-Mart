-- Orders table for Zahranship
-- This enables cross-origin order tracking (orders saved here are accessible from any domain)

CREATE TABLE IF NOT EXISTS public.zahranship_orders (
  id TEXT PRIMARY KEY,
  order_num TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL DEFAULT '',
  created_by_device TEXT,
  created_by_ip TEXT,
  created_by_location TEXT,
  customer TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone2 TEXT,
  region TEXT NOT NULL DEFAULT '',
  district TEXT,
  address TEXT NOT NULL DEFAULT '',
  products TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  shipping_fee NUMERIC NOT NULL DEFAULT 0,
  extra_shipping_fee NUMERIC DEFAULT 0,
  express_shipping BOOLEAN DEFAULT false,
  total NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  date TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  day TEXT,
  notes TEXT,
  warranty TEXT,
  delegate_name TEXT,
  lines JSONB,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_zahranship_orders_order_num ON public.zahranship_orders(order_num);
CREATE INDEX IF NOT EXISTS idx_zahranship_orders_status ON public.zahranship_orders(status);
CREATE INDEX IF NOT EXISTS idx_zahranship_orders_phone ON public.zahranship_orders(phone);

ALTER TABLE public.zahranship_orders ENABLE ROW LEVEL SECURITY;

-- Allow public read access for tracking (customers need to track without login)
DROP POLICY IF EXISTS "public_read_orders" ON public.zahranship_orders;
CREATE POLICY "public_read_orders"
ON public.zahranship_orders
FOR SELECT
TO public
USING (true);

-- Allow authenticated users to insert/update orders
DROP POLICY IF EXISTS "authenticated_manage_orders" ON public.zahranship_orders;
CREATE POLICY "authenticated_manage_orders"
ON public.zahranship_orders
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow anon to insert (for order creation without login)
DROP POLICY IF EXISTS "anon_insert_orders" ON public.zahranship_orders;
CREATE POLICY "anon_insert_orders"
ON public.zahranship_orders
FOR INSERT
TO anon
WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_zahranship_orders_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_zahranship_orders_updated_at ON public.zahranship_orders;
CREATE TRIGGER update_zahranship_orders_updated_at
  BEFORE UPDATE ON public.zahranship_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_zahranship_orders_updated_at();
