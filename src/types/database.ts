// ─────────────────────────────────────────────────────────────────────────────
// Supabase row shapes — minimal, manually-maintained typings used until
// proper types are generated via:
//   pnpm exec supabase gen types typescript --project-id <id> > src/types/supabase.ts
//
// TODO (Phase 8 / future): replace this file with generated types and import
// them throughout the app instead of hand-writing per-call interfaces.
// ─────────────────────────────────────────────────────────────────────────────

/** Generic Supabase row — opaque, untyped row payload. Prefer specific row
 *  types below when the column set is known at the call site. */
export type SupabaseRow = Record<string, unknown>;

export interface OrderRow {
  id: string;
  order_num: string;
  created_by?: string | null;
  created_by_user_id?: string | null;
  created_by_device?: string | null;
  customer: string;
  phone: string;
  phone2?: string | null;
  region?: string | null;
  district?: string | null;
  address?: string | null;
  products?: string | null;
  quantity?: number | null;
  subtotal?: number | null;
  shipping_fee?: number | null;
  extra_shipping_fee?: number | null;
  express_shipping?: boolean | null;
  free_shipping?: boolean | null;
  total: number | null;
  status: string | null;
  date?: string | null;
  time?: string | null;
  day?: string | null;
  notes?: string | null;
  warranty?: string | null;
  delegate_name?: string | null;
  assigned_to?: string | null;
  updated_by?: string | null;
  lines?: unknown;
  created_at?: string | null;
}

export interface ProfileRow {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role?: string | null;
  role_id?: string | null;
  role_name?: string | null;
  permissions?: string[] | null;
  created_at?: string | null;
}

export interface InventoryRow {
  id: string;
  name: string;
  sku: string;
  available: number | null;
  withdrawn: number | null;
  min_stock: number | null;
  price: number | null;
  category?: string | null;
  images?: string[] | null;
  colors?: string[] | null;
  created_at?: string | null;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  order_id?: string | null;
  order_num?: string | null;
  is_read?: boolean | null;
  created_by?: string | null;
  target_user_id?: string | null;
  target_role_id?: string | null;
  created_at?: string | null;
}

export interface ChatMessageRow {
  id: string;
  customer_phone: string;
  sender: string;
  message: string;
  created_at?: string | null;
}

export interface ComplaintRow {
  id: string;
  customer_phone: string;
  subject: string;
  status?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

export interface CustomerRow {
  id: string;
  phone: string;
  name?: string | null;
  notes?: string | null;
  segment?: string | null;
  total_orders?: number | null;
  total_spent?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Realtime postgres-changes payload. Generic over the row type. */
export interface RealtimeChangePayload<T = SupabaseRow> {
  schema: string;
  table: string;
  commit_timestamp: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: T | Record<string, never>;
  old: Partial<T> | Record<string, never>;
  errors: string[] | null;
}
