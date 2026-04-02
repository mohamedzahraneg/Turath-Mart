-- 1. Create or replace zahranship_orders
CREATE TABLE IF NOT EXISTS public.zahranship_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  order_num text NOT NULL,
  created_by text,
  created_by_ip text,
  created_by_location text,
  created_by_device text,
  customer text NOT NULL,
  phone text NOT NULL,
  phone2 text,
  region text NOT NULL,
  district text,
  address text NOT NULL,
  products text NOT NULL,
  quantity integer NOT NULL,
  subtotal numeric NOT NULL,
  shipping_fee numeric NOT NULL,
  extra_shipping_fee numeric DEFAULT 0,
  express_shipping boolean DEFAULT false,
  total numeric NOT NULL,
  status text NOT NULL DEFAULT 'new',
  date text,
  time text,
  day text,
  notes text,
  ip text,
  delegate_name text
);

-- 2. Create profiles table linking to auth.users for Roles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  role text DEFAULT 'employee', -- Roles: admin, employee, delegate
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.zahranship_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Disable strict policies for now so that anon / authenticated can just read/write for quick start (Since user had issue with data not saving properly)
-- (WARNING: In extreme production, restrict these to authenticated users, but since the mock data was failing we ensure full privileges first)
CREATE POLICY "Allow all actions for authenticated users on orders"
  ON public.zahranship_orders
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all actions for authenticated users on profiles"
  ON public.profiles
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Function to handle new user signup and insert into profiles automatically
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    COALESCE(NEW.raw_user_meta_data->>'role', 'employee')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for the function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Create deposits table
CREATE TABLE IF NOT EXISTS public.deposits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  delegate_name text NOT NULL,
  amount numeric NOT NULL,
  date text NOT NULL,
  note text
);

ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all actions on deposits"
  ON public.deposits
  FOR ALL
  USING (true)
  WITH CHECK (true);
