'use client';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  Truck,
  Search,
  ChevronDown,
  ChevronUp,
  Eye,
  Edit2,
  MapPin,
  Phone,
  Package,
  DollarSign,
  User,
  CheckCircle,
  Clock,
  XCircle,
  RotateCcw,
  Warehouse,
  Star,
  MessageCircle,
  Send,
  X,
  ArrowRight,
  TrendingUp,
  Hash,
  ShoppingBag,
  FileText,
  ChevronLeft,
  // Phase 23M — change-request UI iconography.
  IdCard,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import OrderDetailModal from '../orders-management/components/OrderDetailModal';
import StatusUpdateModal from '../orders-management/components/StatusUpdateModal';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
// Phase 23M — pure helpers for the delegate profile change-request flow.
import {
  CHANGE_REQUEST_LABELS_AR,
  SENSITIVE_FIELDS,
  TRANSPORT_TYPE_TOKENS,
  buildChangePayload,
  changeRequestErrorMessage,
  diffChangeRequest,
  profileToSnapshot,
  validateChangeRequest,
  type ChangeRequestField,
  type ChangeRequestForm,
  type DelegateProfileSnapshot,
} from '@/lib/delegates/changeRequest';
import { transportLabel } from '@/lib/delegates/transportTypes';

interface Order {
  id: string;
  orderNum: string;
  createdBy: string;
  createdByIp?: string;
  createdByLocation?: string;
  createdByDevice?: string;
  customer: string;
  phone: string;
  phone2?: string;
  region: string;
  district?: string;
  address: string;
  products: string;
  quantity: number;
  subtotal: number;
  shippingFee: number;
  extraShippingFee?: number;
  expressShipping?: boolean;
  total: number;
  status: string;
  date: string;
  time: string;
  day: string;
  notes?: string;
  ip: string;
  delegateName?: string;
}

const STATUS_MAP: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  new: { label: 'جديد', cls: 'status-new', icon: <Clock size={12} /> },
  preparing: { label: 'جاري التجهيز', cls: 'status-preparing', icon: <Package size={12} /> },
  warehouse: { label: 'في المستودع', cls: 'status-warehouse', icon: <Warehouse size={12} /> },
  shipping: { label: 'جاري الشحن', cls: 'status-shipping', icon: <Truck size={12} /> },
  delivered: { label: 'تم التسليم', cls: 'status-delivered', icon: <CheckCircle size={12} /> },
  cancelled: { label: 'ملغي', cls: 'status-cancelled', icon: <XCircle size={12} /> },
  returned: { label: 'مرتجع', cls: 'status-returned', icon: <RotateCcw size={12} /> },
};

type Delegate = {
  name: string;
  phone: string;
  rating: number;
  totalDelivered: number;
  activeOrders: number;
};

type SortField = 'orderNum' | 'customer' | 'region' | 'total' | 'status' | 'date';
type SortDir = 'asc' | 'desc';

// ─── Chat Message Type ───────────────────────────────
interface ChatMessage {
  id: string;
  sender: 'customer' | 'delegate';
  text: string;
  time: string;
}

// ─── Delegate Chat Panel with Order Details ───────────────
function DelegateChatWithDetails({
  order,
  delegateName,
  onClose,
}: {
  order: Order;
  delegateName: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadMessages = async () => {
      try {
        const supabase = createClient();
        // Phase 23K: scope reads to THIS order via `order_id` (the
        // chat row's `order_id` column carries the order_num). Prior
        // behaviour pulled in messages from every other order the same
        // customer had on file. We keep the redundant phone equality —
        // the table is indexed on (customer_phone, created_at) — so the
        // pre-Phase-23K rows that exist without `order_id` STILL appear
        // here for backward compatibility, and the order_id filter
        // narrows once the column is populated. Sorting is still by
        // created_at ascending.
        const { data } = await supabase
          .from('turath_masr_crm_chat')
          .select('id, sender, message, created_at, order_id')
          .eq('customer_phone', order.phone)
          .eq('chat_type', 'delegate')
          .order('created_at', { ascending: true });
        if (data && data.length > 0) {
          // Backward-compat: any row whose `order_id` is null / matches
          // this order's order_num is shown. A row tagged with a
          // different order_id belongs to that other order — drop it.
          const scoped = data.filter((m: any) => !m.order_id || m.order_id === order.orderNum);
          setMessages(
            scoped.map((m: any) => ({
              id: m.id || `msg-${m.created_at}`,
              sender: m.sender === 'customer' ? 'customer' : 'delegate',
              text: m.message,
              time: (() => {
                const d = new Date(m.created_at);
                const days = [
                  'الأحد',
                  'الاثنين',
                  'الثلاثاء',
                  'الأربعاء',
                  'الخميس',
                  'الجمعة',
                  'السبت',
                ];
                return `${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} - ${days[d.getDay()]} ${d.toLocaleDateString('en-GB')}`;
              })(),
            }))
          );
        }
      } catch (err) {
        console.error('Error loading delegate chat:', err);
      }
      setLoading(false);
    };
    loadMessages();

    const supabase = createClient();
    // Phase 23K: Realtime channel + filter scoped to THIS order's
    // `order_id`. Two delegates with the same customer phone on
    // different orders no longer fan-out into each other's chats. The
    // server-side filter is the strict guarantee — the chat_type guard
    // remains as a defence-in-depth, and the existing dedupe by `id`
    // prevents double-renders if a re-send happens.
    const channel = supabase
      .channel(`delegate-chat-${order.orderNum}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'turath_masr_crm_chat',
          filter: `order_id=eq.${order.orderNum}`,
        },
        (payload: any) => {
          const m = payload.new;
          if (m.chat_type !== 'delegate') return;
          setMessages((prev) => {
            if (prev.some((p) => p.id === m.id)) return prev;
            return [
              ...prev,
              {
                id: m.id || `msg-${m.created_at}`,
                sender: m.sender === 'customer' ? 'customer' : 'delegate',
                text: m.message,
                time: (() => {
                  const d = new Date(m.created_at);
                  const days = [
                    'الأحد',
                    'الاثنين',
                    'الثلاثاء',
                    'الأربعاء',
                    'الخميس',
                    'الجمعة',
                    'السبت',
                  ];
                  return `${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} - ${days[d.getDay()]} ${d.toLocaleDateString('en-GB')}`;
                })(),
              },
            ];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [order.phone, order.id, order.orderNum]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const now = new Date();
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const timeStr = `${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} - ${days[now.getDay()]} ${now.toLocaleDateString('en-GB')}`;
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'delegate',
      text: input.trim(),
      time: timeStr,
    };
    setMessages((prev) => [...prev, newMsg]);
    const msgText = input.trim();
    setInput('');
    try {
      const supabase = createClient();
      // Phase 23K: stamp the order's `order_num` into `order_id` so
      // the row joins the right per-order thread on both the customer
      // and the admin sides. Sender stays 'delegate' to keep the
      // bubble role identical to before.
      await supabase.from('turath_masr_crm_chat').insert({
        customer_phone: order.phone,
        sender: 'delegate',
        message: msgText,
        chat_type: 'delegate',
        order_id: order.orderNum,
      });
    } catch (err) {
      console.error('Error sending delegate message:', err);
    }
  };

  const statusInfo = STATUS_MAP[order.status];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4"
      dir="rtl"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl flex flex-col shadow-2xl"
        style={{ height: '90vh', maxHeight: '700px' }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-[hsl(211,67%,28%)] sm:rounded-t-2xl">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white font-bold">
            {order.customer.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-bold text-sm truncate">{order.customer}</h3>
            <p className="text-white/70 text-xs">طلب #{order.orderNum}</p>
          </div>
          <button
            onClick={() => setShowDetails(!showDetails)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showDetails
                ? 'bg-white text-[hsl(211,67%,28%)]'
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
          >
            <FileText size={14} className="inline ml-1" />
            {showDetails ? 'إخفاء التفاصيل' : 'تفاصيل الطلب'}
          </button>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors mr-1"
          >
            <X size={20} />
          </button>
        </div>

        {/* Order Details Panel (Collapsible) */}
        {showDetails && (
          <div className="bg-gradient-to-b from-[hsl(211,67%,95%)] to-white border-b border-[hsl(211,67%,85%)] p-4 space-y-3 max-h-[40vh] overflow-y-auto">
            {/* Status Badge */}
            <div className="flex items-center justify-between">
              <span
                className={`badge ${statusInfo?.cls || ''} flex items-center gap-1 text-sm px-3 py-1`}
              >
                {statusInfo?.icon}
                {statusInfo?.label || order.status}
              </span>
              <span className="text-xs text-gray-500">
                {order.date} • {order.time}
              </span>
            </div>

            {/* Customer Info */}
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <h4 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1">
                <User size={12} /> بيانات العميل
              </h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-400 text-xs">الاسم:</span>
                  <p className="font-semibold">{order.customer}</p>
                </div>
                <div>
                  <span className="text-gray-400 text-xs">الهاتف:</span>
                  <p className="font-mono font-semibold" dir="ltr">
                    {order.phone}
                  </p>
                </div>
                {order.phone2 && (
                  <div>
                    <span className="text-gray-400 text-xs">هاتف 2:</span>
                    <p className="font-mono font-semibold" dir="ltr">
                      {order.phone2}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Address */}
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <h4 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1">
                <MapPin size={12} /> العنوان
              </h4>
              <p className="text-sm font-semibold">
                {order.region}
                {order.district ? ` — ${order.district}` : ''}
              </p>
              <p className="text-xs text-gray-600 mt-1">{order.address}</p>
            </div>

            {/* Products */}
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <h4 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1">
                <ShoppingBag size={12} /> المنتجات
              </h4>
              <p className="text-sm">{order.products}</p>
              <p className="text-xs text-gray-500 mt-1">الكمية: {order.quantity}</p>
            </div>

            {/* Financial */}
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <h4 className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1">
                <DollarSign size={12} /> المبالغ
              </h4>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-xs text-gray-500">المنتجات</p>
                  <p className="font-bold text-sm font-mono">
                    {order.subtotal.toLocaleString('en-US')} ج.م
                  </p>
                </div>
                <div className="bg-blue-50 rounded-lg p-2">
                  <p className="text-xs text-blue-600">الشحن</p>
                  <p className="font-bold text-sm font-mono text-blue-700">
                    {order.shippingFee} ج.م
                  </p>
                </div>
                <div className="bg-green-50 rounded-lg p-2">
                  <p className="text-xs text-green-600">الإجمالي</p>
                  <p className="font-bold text-sm font-mono text-green-700">
                    {order.total.toLocaleString('en-US')} ج.م
                  </p>
                </div>
              </div>
            </div>

            {/* Notes */}
            {order.notes && (
              <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                <h4 className="text-xs font-bold text-amber-700 mb-1">ملاحظات</h4>
                <p className="text-sm text-amber-900">{order.notes}</p>
              </div>
            )}

            {/* Quick Actions */}
            <div className="flex gap-2">
              <a
                href={`tel:${order.phone}`}
                className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                <Phone size={13} />
                اتصال بالعميل
              </a>
              <a
                href={`https://wa.me/2${order.phone}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
              >
                واتساب
              </a>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin w-6 h-6 border-2 border-[hsl(211,67%,28%)] border-t-transparent rounded-full" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <MessageCircle size={40} className="mb-2 opacity-40" />
              <p className="text-sm">لا توجد رسائل بعد</p>
              <p className="text-xs mt-1">ابدأ المحادثة مع العميل</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === 'delegate' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                    msg.sender === 'delegate'
                      ? 'bg-[hsl(211,67%,28%)] text-white rounded-br-md'
                      : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md'
                  }`}
                >
                  <p className="text-sm leading-relaxed">{msg.text}</p>
                  <p
                    className={`text-[10px] mt-1 ${
                      msg.sender === 'delegate' ? 'text-white/60' : 'text-gray-400'
                    }`}
                  >
                    {msg.time}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-gray-200 bg-white sm:rounded-b-2xl">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="اكتب رسالة للعميل..."
              className="flex-1 px-4 py-2.5 bg-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(211,67%,28%)]/30"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="w-10 h-10 flex items-center justify-center rounded-xl bg-[hsl(211,67%,28%)] text-white hover:bg-[hsl(211,67%,22%)] disabled:opacity-40 transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Shipping Page ───────────────────────────────────────
export default function ShippingPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('الكل');
  const [delegateFilter, setDelegateFilter] = useState('الكل');
  const [sortField, setSortField] = useState<SortField>('orderNum');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [statusModal, setStatusModal] = useState<{ order: Order } | null>(null);
  const [detailModal, setDetailModal] = useState<{ order: Order } | null>(null);
  const [chatOrder, setChatOrder] = useState<Order | null>(null);

  const [dbOrders, setDbOrders] = useState<Order[]>([]);
  const [delegates, setDelegates] = useState<Delegate[]>([]);
  const [loading, setLoading] = useState(true);

  // Get current user info
  const { currentRoleId } = useAuth();
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [isDelegate, setIsDelegate] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // Phase 23M — delegate profile snapshot + latest pending request.
  // Fetched once for r4 users on mount; the request modal reads off
  // these states and re-fetches after a successful submit / cancel.
  const auth = useAuth();
  const [delegateSnapshot, setDelegateSnapshot] = useState<DelegateProfileSnapshot | null>(null);
  const [pendingChangeRequest, setPendingChangeRequest] = useState<{
    id: string;
    status: string;
    requested_changes: Record<string, unknown>;
    created_at: string;
    admin_note: string | null;
  } | null>(null);
  const [changeRequestModalOpen, setChangeRequestModalOpen] = useState(false);
  const [changeRequestRefreshTick, setChangeRequestRefreshTick] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('current_user');
        if (stored) {
          const parsed = JSON.parse(stored);
          setCurrentUserName(parsed.name || '');
          // r4 = مندوب شحن
          const roleId = parsed.roleId || '';
          setIsDelegate(roleId === 'r4');
          setIsAdmin(roleId === 'r1' || roleId === 'r2' || roleId === 'r3');
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, []);

  // Phase 23M — load the delegate's profile snapshot + their latest
  // pending request. Both queries are defensive: pre-migration the
  // change-requests table doesn't exist (42P01) and the catch arm
  // falls through to a null pending request so the form can be
  // opened. The profile snapshot uses the `profiles_own_select`
  // policy that's been on prod since launch — delegate can SELECT
  // their own row.
  useEffect(() => {
    if (!isDelegate || !auth.user?.id) return;
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      // Snapshot — narrow column list, never `select('*')`.
      const { data: prof } = await supabase
        .from('profiles')
        .select(
          'phone, transport_type, national_id, vehicle_license_number, vehicle_license_starts_at, vehicle_license_expires_at, driving_license_number, driving_license_starts_at, driving_license_expires_at'
        )
        .eq('id', auth.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (prof) {
        setDelegateSnapshot(profileToSnapshot(prof as Record<string, unknown>));
      } else {
        setDelegateSnapshot(profileToSnapshot({}));
      }

      // Pending request — silently no-op on missing table / RLS deny.
      try {
        const { data: req, error } = await supabase
          .from('turath_masr_delegate_change_requests')
          .select('id, status, requested_changes, created_at, admin_note')
          .eq('delegate_profile_id', auth.user.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1);
        if (cancelled) return;
        if (!error && req && req.length > 0) {
          const r = req[0] as {
            id: string;
            status: string;
            requested_changes: Record<string, unknown>;
            created_at: string;
            admin_note: string | null;
          };
          setPendingChangeRequest(r);
        } else {
          setPendingChangeRequest(null);
        }
      } catch {
        setPendingChangeRequest(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isDelegate, auth.user?.id, changeRequestRefreshTick]);

  const fetchOrders = async () => {
    try {
      const supabase = createClient();
      // Phase 21B: explicit columns. The mapper below maps DB rows
      // into the local Order shape using only these 18 fields. The
      // previous select('*') also shipped:
      //   • `lines` jsonb (per-order full line-item snapshots —
      //     kilobytes per row, never read by this page)
      //   • tracking_token, created_by_user_id, assigned_to,
      //     updated_by, updated_at, extra_shipping_fee,
      //     express_shipping, free_shipping, created_by_device,
      //     created_by_ip, created_by_location, warranty, quantity,
      //     subtotal, day  — none consumed by the mapper or the
      //     shipping-page render path.
      // Status updates and assignment changes don't go through this
      // query (they use StatusUpdateModal which fetches its own row),
      // so narrowing here is safe. Schema verified before commit.
      const { data, error } = await supabase
        .from('turath_masr_orders')
        .select(
          'id, order_num, created_by, customer, phone, phone2, region, district, address, products, total, shipping_fee, status, date, time, notes, delegate_name, created_at'
        )
        .order('created_at', { ascending: false });

      if (!error && data) {
        const mapped: Order[] = data.map((o: any) => ({
          id: o.id,
          orderNum: o.order_num,
          createdBy: o.created_by || 'غير معروف',
          customer: o.customer,
          phone: o.phone,
          phone2: o.phone2,
          region: o.region,
          district: o.district,
          address: o.address,
          products: o.products,
          quantity: 1,
          subtotal: o.total - (o.shipping_fee || 50),
          shippingFee: o.shipping_fee || 50,
          total: o.total,
          status: o.status,
          date: o.date || o.created_at?.split('T')[0] || '',
          time: o.time || o.created_at?.split('T')[1]?.substring(0, 5) || '',
          day: '',
          notes: o.notes,
          ip: '',
          delegateName: o.delegate_name || '',
        }));
        setDbOrders(mapped);

        // compute delegates
        const delMap = new Map<string, Delegate>();
        mapped.forEach((o) => {
          if (!o.delegateName) return;
          if (!delMap.has(o.delegateName)) {
            delMap.set(o.delegateName, {
              name: o.delegateName,
              phone: '',
              rating: 5.0,
              totalDelivered: 0,
              activeOrders: 0,
            });
          }
          const d = delMap.get(o.delegateName)!;
          if (o.status === 'delivered') d.totalDelivered++;
          if (o.status === 'shipping' || o.status === 'preparing') d.activeOrders++;
        });
        setDelegates(Array.from(delMap.values()));
      }
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  // Filter orders based on role
  const myOrders = useMemo(() => {
    if (isDelegate && currentUserName) {
      return dbOrders.filter((o) => o.delegateName === currentUserName);
    }
    return dbOrders;
  }, [dbOrders, isDelegate, currentUserName]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown size={12} className="opacity-30" />;
    return sortDir === 'asc' ? (
      <ChevronUp size={12} className="text-[hsl(var(--primary))]" />
    ) : (
      <ChevronDown size={12} className="text-[hsl(var(--primary))]" />
    );
  };

  const filtered = useMemo(() => {
    const base = isDelegate ? myOrders : dbOrders;
    return base
      .filter((o) => {
        const matchSearch =
          !search ||
          o.customer.includes(search) ||
          o.orderNum.includes(search) ||
          o.phone.includes(search);
        const matchStatus = statusFilter === 'الكل' || o.status === statusFilter;
        const matchDelegate =
          isDelegate || delegateFilter === 'الكل' || o.delegateName === delegateFilter;
        return matchSearch && matchStatus && matchDelegate;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === 'orderNum') cmp = a.orderNum.localeCompare(b.orderNum);
        else if (sortField === 'customer') cmp = a.customer.localeCompare(b.customer);
        else if (sortField === 'region') cmp = a.region.localeCompare(b.region);
        else if (sortField === 'total') cmp = a.total - b.total;
        else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [search, statusFilter, delegateFilter, sortField, sortDir, dbOrders, myOrders, isDelegate]);

  // KPIs based on the relevant orders (delegate's own or all)
  const relevantOrders = isDelegate ? myOrders : dbOrders;
  const shippingOrders = relevantOrders.filter((o) => o.status === 'shipping');
  const deliveredOrders = relevantOrders.filter((o) => o.status === 'delivered');
  const newOrders = relevantOrders.filter((o) => o.status === 'new');
  const preparingOrders = relevantOrders.filter((o) => o.status === 'preparing');
  const totalShippingFees = relevantOrders.reduce((s, o) => s + o.shippingFee, 0);
  const totalRevenue = relevantOrders
    .filter((o) => ['shipping', 'delivered'].includes(o.status))
    .reduce((s, o) => s + o.total, 0);

  const statusOptions = ['الكل', ...Object.keys(STATUS_MAP)];
  const delegateOptions = ['الكل', ...delegates.map((d) => d.name)];

  return (
    <AppLayout currentPath="/shipping">
      <div className="space-y-6 fade-in" dir="rtl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
              {isDelegate ? `لوحة المندوب: ${currentUserName}` : 'إدارة الشحن'}
            </h1>
            <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
              {isDelegate
                ? `متابعة الأوردرات المعينة لك (${myOrders.length} أوردر)`
                : 'متابعة الأوردرات وتفاصيل الشحن والمناديب'}
            </p>
          </div>
          {isDelegate && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Phase 23M — delegate change-request launcher. Visible
                  only when r4 is signed in. The button is disabled
                  while a pending request exists; the pending status
                  surfaces in the inline banner just below the
                  header. */}
              <button
                type="button"
                onClick={() => setChangeRequestModalOpen(true)}
                className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-[hsl(var(--muted))]/40 text-[hsl(211,67%,28%)] border border-[hsl(211,67%,28%)]/30 rounded-xl text-xs font-semibold transition-colors"
              >
                <IdCard size={14} />
                طلب تعديل بياناتي
              </button>
              <div className="flex items-center gap-2 px-4 py-2 bg-[hsl(211,67%,28%)]/10 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-[hsl(211,67%,28%)] flex items-center justify-center text-white font-bold text-sm">
                  {currentUserName.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-bold text-[hsl(211,67%,28%)]">{currentUserName}</p>
                  <p className="text-[10px] text-[hsl(211,67%,28%)]/70">مندوب شحن</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Phase 23M — pending-request banner. Shown only to the
            delegate when they already have an outstanding request, so
            they understand why the submit form is locked. The banner
            also surfaces a cancel button so they can withdraw the
            request without an admin. */}
        {isDelegate && pendingChangeRequest && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
            <AlertCircle size={16} className="text-amber-700 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-800">طلب تعديل بياناتك قيد المراجعة</p>
              <p className="text-xs text-amber-700 mt-0.5">
                تم الإرسال:{' '}
                {new Date(pendingChangeRequest.created_at).toLocaleString('ar-EG', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setChangeRequestModalOpen(true)}
              className="px-3 py-1 text-xs font-semibold text-amber-800 hover:text-amber-900 border border-amber-300 rounded-lg bg-white"
            >
              عرض
            </button>
          </div>
        )}

        {/* KPIs - Delegate-specific or Admin */}
        <div
          className={`grid ${isDelegate ? 'grid-cols-2 xl:grid-cols-5' : 'grid-cols-2 xl:grid-cols-4'} gap-4`}
        >
          {isDelegate ? (
            <>
              {[
                {
                  label: 'إجمالي أوردراتي',
                  value: myOrders.length,
                  icon: <Package size={20} />,
                  color: 'purple',
                },
                {
                  label: 'جاري الشحن',
                  value: shippingOrders.length,
                  icon: <Truck size={20} />,
                  color: 'blue',
                },
                {
                  label: 'تم التسليم',
                  value: deliveredOrders.length,
                  icon: <CheckCircle size={20} />,
                  color: 'green',
                },
                {
                  label: 'جديد / تجهيز',
                  value: `${newOrders.length} / ${preparingOrders.length}`,
                  icon: <Clock size={20} />,
                  color: 'amber',
                },
                {
                  label: 'إجمالي القيمة',
                  value: `${totalRevenue.toLocaleString('en-US')} ج.م`,
                  icon: <TrendingUp size={20} />,
                  color: 'emerald',
                },
              ].map((card, i) => (
                <div key={i} className="kpi-card">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                      card.color === 'blue'
                        ? 'bg-blue-50 text-blue-600'
                        : card.color === 'green'
                          ? 'bg-green-50 text-green-600'
                          : card.color === 'amber'
                            ? 'bg-amber-50 text-amber-600'
                            : card.color === 'purple'
                              ? 'bg-purple-50 text-purple-600'
                              : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    {card.icon}
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{card.label}</p>
                  <p className="text-xl font-bold text-[hsl(var(--foreground))] font-mono">
                    {card.value}
                  </p>
                </div>
              ))}
            </>
          ) : (
            <>
              {[
                {
                  label: 'جاري الشحن',
                  value: shippingOrders.length,
                  icon: <Truck size={20} />,
                  color: 'blue',
                },
                {
                  label: 'تم التسليم',
                  value: deliveredOrders.length,
                  icon: <CheckCircle size={20} />,
                  color: 'green',
                },
                {
                  label: 'إجمالي رسوم الشحن',
                  value: `${totalShippingFees.toLocaleString('en-US')} ج.م`,
                  icon: <DollarSign size={20} />,
                  color: 'amber',
                },
                {
                  label: 'المناديب النشطون',
                  value: delegates.length,
                  icon: <User size={20} />,
                  color: 'purple',
                },
              ].map((card, i) => (
                <div key={i} className="kpi-card">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${
                      card.color === 'blue'
                        ? 'bg-blue-50 text-blue-600'
                        : card.color === 'green'
                          ? 'bg-green-50 text-green-600'
                          : card.color === 'amber'
                            ? 'bg-amber-50 text-amber-600'
                            : 'bg-purple-50 text-purple-600'
                    }`}
                  >
                    {card.icon}
                  </div>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1">{card.label}</p>
                  <p className="text-xl font-bold text-[hsl(var(--foreground))] font-mono">
                    {card.value}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Delegates Section - Only for Admin/Supervisor */}
        {!isDelegate && (
          <div className="card-section p-5">
            <h2 className="text-base font-bold mb-4 flex items-center gap-2">
              <User size={18} className="text-[hsl(var(--primary))]" />
              المناديب النشطون
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {delegates.map((delegate) => {
                const delegateOrders = dbOrders.filter((o) => o.delegateName === delegate.name);
                const activeCount = delegateOrders.filter((o) => o.status === 'shipping').length;
                const deliveredCount = delegateOrders.filter(
                  (o) => o.status === 'delivered'
                ).length;
                const totalValue = delegateOrders
                  .filter((o) => ['shipping', 'delivered'].includes(o.status))
                  .reduce((s, o) => s + o.total, 0);
                return (
                  <div
                    key={delegate.name}
                    className="border border-[hsl(var(--border))] rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[hsl(var(--primary))]/10 flex items-center justify-center text-[hsl(var(--primary))] font-bold">
                          {delegate.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-sm">{delegate.name}</p>
                          <p className="text-xs text-[hsl(var(--muted-foreground))]" dir="ltr">
                            {delegate.phone}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-amber-500">
                        <Star size={14} fill="currentColor" />
                        <span className="text-sm font-bold">{delegate.rating}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="bg-blue-50 rounded-lg p-2">
                        <p className="text-lg font-bold text-blue-700">{activeCount}</p>
                        <p className="text-[10px] text-blue-600">جاري الشحن</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-2">
                        <p className="text-lg font-bold text-green-700">{deliveredCount}</p>
                        <p className="text-[10px] text-green-600">تم التسليم</p>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-2">
                        <p className="text-sm font-bold text-amber-700">
                          {totalValue.toLocaleString('en-US')}
                        </p>
                        <p className="text-[10px] text-amber-600">ج.م</p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <a
                        href={`tel:${delegate.phone}`}
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
                      >
                        <Phone size={13} />
                        اتصال
                      </a>
                      <a
                        href={`https://wa.me/2${delegate.phone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
                      >
                        واتساب
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Orders Table */}
        <div className="card-section overflow-hidden">
          <div className="p-4 border-b border-[hsl(var(--border))]">
            <h2 className="text-base font-bold mb-3 flex items-center gap-2">
              <Package size={18} className="text-[hsl(var(--primary))]" />
              {isDelegate ? 'أوردراتي' : 'الأوردرات وتفاصيل الشحن'}
            </h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
                />
                <input
                  type="text"
                  placeholder="بحث بالاسم أو رقم الأوردر..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pr-9 pl-4 py-2.5 border border-[hsl(var(--border))] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
              >
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s === 'الكل' ? 'كل الحالات' : STATUS_MAP[s]?.label || s}
                  </option>
                ))}
              </select>
              {/* Only show delegate filter for admins */}
              {!isDelegate && (
                <select
                  value={delegateFilter}
                  onChange={(e) => setDelegateFilter(e.target.value)}
                  className="border border-[hsl(var(--border))] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30"
                >
                  {delegateOptions.map((d) => (
                    <option key={d} value={d}>
                      {d === 'الكل' ? 'كل المناديب' : d}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))] text-xs">
                  <th
                    className="text-right px-4 py-3 font-semibold cursor-pointer"
                    onClick={() => handleSort('orderNum')}
                  >
                    <span className="flex items-center gap-1">
                      رقم الأوردر <SortIcon field="orderNum" />
                    </span>
                  </th>
                  <th
                    className="text-right px-4 py-3 font-semibold cursor-pointer"
                    onClick={() => handleSort('customer')}
                  >
                    <span className="flex items-center gap-1">
                      العميل <SortIcon field="customer" />
                    </span>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">العنوان</th>
                  <th className="text-right px-4 py-3 font-semibold">المنتجات</th>
                  <th
                    className="text-right px-4 py-3 font-semibold cursor-pointer"
                    onClick={() => handleSort('total')}
                  >
                    <span className="flex items-center gap-1">
                      الإجمالي <SortIcon field="total" />
                    </span>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">رسوم الشحن</th>
                  {!isDelegate && <th className="text-right px-4 py-3 font-semibold">المندوب</th>}
                  <th
                    className="text-right px-4 py-3 font-semibold cursor-pointer"
                    onClick={() => handleSort('status')}
                  >
                    <span className="flex items-center gap-1">
                      الحالة <SortIcon field="status" />
                    </span>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => {
                  const statusInfo = STATUS_MAP[order.status];
                  return (
                    <tr
                      key={order.id}
                      className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-mono text-xs font-bold text-[hsl(var(--primary))]">
                            {order.orderNum}
                          </p>
                          <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                            {order.date}
                          </p>
                          {order.expressShipping && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">
                              سريع
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-xs">{order.customer}</p>
                        <p
                          className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono"
                          dir="ltr"
                        >
                          {order.phone}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-start gap-1">
                          <MapPin
                            size={11}
                            className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0"
                          />
                          <div>
                            <p className="text-xs font-semibold">
                              {order.region}
                              {order.district ? ` — ${order.district}` : ''}
                            </p>
                            <p className="text-[10px] text-[hsl(var(--muted-foreground))] line-clamp-1">
                              {order.address}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs line-clamp-2">{order.products}</p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                          الكمية: {order.quantity}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-mono font-bold text-sm text-[hsl(var(--primary))]">
                          {order.total.toLocaleString('en-US')} ج.م
                        </p>
                        <p className="text-[10px] text-[hsl(var(--muted-foreground))]">
                          منتجات: {order.subtotal.toLocaleString('en-US')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs">
                          <p className="font-mono font-semibold text-blue-700">
                            {order.shippingFee} ج.م
                          </p>
                          {order.extraShippingFee ? (
                            <p className="text-orange-600">+ {order.extraShippingFee} إضافي</p>
                          ) : null}
                          {order.expressShipping && (
                            <p className="text-amber-600 text-[10px]">شحن سريع</p>
                          )}
                        </div>
                      </td>
                      {!isDelegate && (
                        <td className="px-4 py-3">
                          {order.delegateName ? (
                            <div className="flex items-center gap-1.5">
                              <div className="w-6 h-6 rounded-full bg-[hsl(var(--primary))]/10 flex items-center justify-center text-[hsl(var(--primary))] text-[10px] font-bold flex-shrink-0">
                                {order.delegateName.charAt(0)}
                              </div>
                              <span className="text-xs font-semibold">{order.delegateName}</span>
                            </div>
                          ) : (
                            <span className="text-xs text-[hsl(var(--muted-foreground))]">
                              غير محدد
                            </span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span
                          className={`badge ${statusInfo?.cls || ''} flex items-center gap-1 w-fit`}
                        >
                          {statusInfo?.icon}
                          {statusInfo?.label || order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setDetailModal({ order })}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(var(--muted))] transition-colors"
                            title="عرض التفاصيل"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => setStatusModal({ order })}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                            title="تحديث الحالة"
                          >
                            <Edit2 size={14} />
                          </button>
                          {/* Chat button for delegate - per order */}
                          <button
                            onClick={() => setChatOrder(order)}
                            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[hsl(211,67%,28%)]/10 text-[hsl(211,67%,28%)] transition-colors"
                            title="شات مع العميل"
                          >
                            <MessageCircle size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={isDelegate ? 8 : 9}
                      className="px-4 py-8 text-center text-[hsl(var(--muted-foreground))] text-sm"
                    >
                      {isDelegate
                        ? 'لا توجد أوردرات معينة لك حالياً'
                        : 'لا توجد أوردرات تطابق البحث'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-[hsl(var(--border))] flex items-center justify-between">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              عرض {filtered.length} من {isDelegate ? myOrders.length : dbOrders.length} أوردر
            </p>
          </div>
        </div>
      </div>

      {statusModal && (
        <StatusUpdateModal
          order={statusModal.order}
          onClose={() => setStatusModal(null)}
          onUpdate={() => {
            fetchOrders();
            setStatusModal(null);
          }}
        />
      )}
      {detailModal && (
        <OrderDetailModal order={detailModal.order} onClose={() => setDetailModal(null)} />
      )}

      {/* Delegate Chat with Order Details */}
      {chatOrder && (
        <DelegateChatWithDetails
          order={chatOrder}
          delegateName={currentUserName}
          onClose={() => setChatOrder(null)}
        />
      )}

      {/* Phase 23M — delegate profile change-request modal. Only mounts
          for r4 + when delegateSnapshot has finished loading. */}
      {isDelegate && changeRequestModalOpen && delegateSnapshot && (
        <DelegateChangeRequestModal
          snapshot={delegateSnapshot}
          pendingRequest={pendingChangeRequest}
          onClose={() => setChangeRequestModalOpen(false)}
          onChanged={() => {
            setChangeRequestModalOpen(false);
            setChangeRequestRefreshTick((n) => n + 1);
          }}
        />
      )}
    </AppLayout>
  );
}

// ─── Phase 23M — Delegate Profile Change Request Modal ───────────────────
//
// Mounted from the shipping page for r4 (مندوب) only. Renders the
// editable fields (phone / transport / vehicle licence / driving
// licence / national_id), pre-fills current values from the
// `profiles` snapshot the parent already loaded, validates client-
// side, and submits via the `submit_delegate_change_request` RPC
// (SECURITY DEFINER). Cancellation goes through
// `cancel_delegate_change_request`. No direct `profiles` writes.
//
// The form is locked when there's already a pending request — the
// delegate must cancel it to file a new one. The pending state and
// the change diff are surfaced inline so the delegate sees exactly
// what's been submitted.

interface DelegateChangeRequestModalProps {
  snapshot: DelegateProfileSnapshot;
  pendingRequest: {
    id: string;
    status: string;
    requested_changes: Record<string, unknown>;
    created_at: string;
    admin_note: string | null;
  } | null;
  onClose: () => void;
  onChanged: () => void;
}

function DelegateChangeRequestModal({
  snapshot,
  pendingRequest,
  onClose,
  onChanged,
}: DelegateChangeRequestModalProps) {
  // Pre-fill the form with the current profile values so the delegate
  // can edit the field directly. Reset every time the modal mounts so
  // a previous unsaved edit doesn't leak across opens.
  const [form, setForm] = useState<ChangeRequestForm>(() => ({ ...snapshot }));
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const hasPending = !!pendingRequest;

  // Diff between snapshot and form — drives the "no changes" guard.
  const diff = useMemo(() => diffChangeRequest(snapshot, form), [snapshot, form]);
  const hasChanges = diff.length > 0;

  const update = (field: ChangeRequestField, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errorBanner) setErrorBanner(null);
    if (fieldErrors[field]) {
      const next = { ...fieldErrors };
      delete next[field];
      setFieldErrors(next);
    }
  };

  const handleSubmit = async () => {
    if (submitting || hasPending) return;
    if (!hasChanges) {
      setErrorBanner('لم تقم بتغيير أي حقل.');
      return;
    }
    const errors = validateChangeRequest(form);
    if (errors.length > 0) {
      const map: Record<string, string> = {};
      for (const e of errors) {
        map[e.field] = e.message;
      }
      setFieldErrors(map);
      setErrorBanner(errors[0].message);
      return;
    }
    const payload = buildChangePayload(snapshot, form);
    if (Object.keys(payload).length === 0) {
      setErrorBanner('لم تقم بتغيير أي حقل.');
      return;
    }

    setSubmitting(true);
    setErrorBanner(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('submit_delegate_change_request', {
        p_requested_changes: payload,
        p_note: note.trim() || null,
      });
      if (error) {
        const code = (error as { message?: string }).message || '';
        setErrorBanner(changeRequestErrorMessage(code));
        setSubmitting(false);
        return;
      }
      onChanged();
    } catch {
      setErrorBanner('تعذر الاتصال. حاول مرة أخرى.');
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!pendingRequest || submitting) return;
    if (!window.confirm('هل تريد إلغاء طلب التعديل الحالي؟')) return;
    setSubmitting(true);
    setErrorBanner(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('cancel_delegate_change_request', {
        p_request_id: pendingRequest.id,
      });
      if (error) {
        setErrorBanner(changeRequestErrorMessage((error as { message?: string }).message || ''));
        setSubmitting(false);
        return;
      }
      onChanged();
    } catch {
      setErrorBanner('تعذر الاتصال. حاول مرة أخرى.');
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4"
      dir="rtl"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="relative bg-white w-full sm:max-w-2xl sm:rounded-2xl flex flex-col shadow-2xl max-h-[95vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 bg-[hsl(211,67%,28%)] sm:rounded-t-2xl flex-shrink-0">
          <IdCard size={18} className="text-white" />
          <div className="flex-1">
            <h2 className="text-white font-bold text-base">طلب تعديل بياناتي</h2>
            <p className="text-white/70 text-xs">التعديل يُطبَّق على بياناتك بعد موافقة الإدارة.</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
            aria-label="إغلاق"
          >
            <X size={18} className="text-white" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {hasPending && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              <p className="font-semibold mb-1 flex items-center gap-1">
                <AlertCircle size={14} /> يوجد طلب قيد المراجعة
              </p>
              <p>
                لا يمكنك تقديم طلب جديد قبل أن تتم مراجعة الطلب الحالي. يمكنك إلغاءه أدناه إذا أردت
                تعديل قيم أخرى.
              </p>
            </div>
          )}
          {errorBanner && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <p>{errorBanner}</p>
            </div>
          )}

          {/* Fields grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ChangeReqField
              field="phone"
              label={CHANGE_REQUEST_LABELS_AR.phone}
              value={form.phone ?? ''}
              onChange={(v) => update('phone', v)}
              placeholder="01XXXXXXXXX"
              dir="ltr"
              fieldError={fieldErrors.phone}
              disabled={hasPending || submitting}
            />
            <ChangeReqField
              field="transport_type"
              label={CHANGE_REQUEST_LABELS_AR.transport_type}
              value={form.transport_type ?? ''}
              onChange={(v) => update('transport_type', v)}
              fieldError={fieldErrors.transport_type}
              disabled={hasPending || submitting}
              renderSelect={(v, onChange) => (
                <select
                  value={v}
                  onChange={(e) => onChange(e.target.value)}
                  className="input-field"
                  disabled={hasPending || submitting}
                >
                  <option value="">— غير محدد —</option>
                  {TRANSPORT_TYPE_TOKENS.map((token) => (
                    <option key={token} value={token}>
                      {transportLabel(token)}
                    </option>
                  ))}
                </select>
              )}
            />
            <ChangeReqField
              field="vehicle_license_number"
              label={CHANGE_REQUEST_LABELS_AR.vehicle_license_number}
              value={form.vehicle_license_number ?? ''}
              onChange={(v) => update('vehicle_license_number', v)}
              fieldError={fieldErrors.vehicle_license_number}
              disabled={hasPending || submitting}
            />
            <div /> {/* spacer for grid alignment */}
            <ChangeReqField
              field="vehicle_license_starts_at"
              label={CHANGE_REQUEST_LABELS_AR.vehicle_license_starts_at}
              type="date"
              value={form.vehicle_license_starts_at ?? ''}
              onChange={(v) => update('vehicle_license_starts_at', v)}
              fieldError={fieldErrors.vehicle_license_starts_at}
              disabled={hasPending || submitting}
            />
            <ChangeReqField
              field="vehicle_license_expires_at"
              label={CHANGE_REQUEST_LABELS_AR.vehicle_license_expires_at}
              type="date"
              value={form.vehicle_license_expires_at ?? ''}
              onChange={(v) => update('vehicle_license_expires_at', v)}
              fieldError={fieldErrors.vehicle_license_expires_at || fieldErrors.cross_vehicle}
              disabled={hasPending || submitting}
            />
            <ChangeReqField
              field="driving_license_number"
              label={CHANGE_REQUEST_LABELS_AR.driving_license_number}
              value={form.driving_license_number ?? ''}
              onChange={(v) => update('driving_license_number', v)}
              fieldError={fieldErrors.driving_license_number}
              disabled={hasPending || submitting}
            />
            <div /> {/* spacer */}
            <ChangeReqField
              field="driving_license_starts_at"
              label={CHANGE_REQUEST_LABELS_AR.driving_license_starts_at}
              type="date"
              value={form.driving_license_starts_at ?? ''}
              onChange={(v) => update('driving_license_starts_at', v)}
              fieldError={fieldErrors.driving_license_starts_at}
              disabled={hasPending || submitting}
            />
            <ChangeReqField
              field="driving_license_expires_at"
              label={CHANGE_REQUEST_LABELS_AR.driving_license_expires_at}
              type="date"
              value={form.driving_license_expires_at ?? ''}
              onChange={(v) => update('driving_license_expires_at', v)}
              fieldError={fieldErrors.driving_license_expires_at || fieldErrors.cross_driving}
              disabled={hasPending || submitting}
            />
          </div>

          {/* Sensitive field — separated visually with a warning */}
          <div className="rounded-2xl border border-red-200 bg-red-50/40 p-3">
            <p className="text-[11px] font-semibold text-red-700 flex items-center gap-1 mb-2">
              <AlertCircle size={12} /> الحقل التالي يتطلب مراجعة دقيقة من الإدارة
            </p>
            <ChangeReqField
              field="national_id"
              label={CHANGE_REQUEST_LABELS_AR.national_id}
              value={form.national_id ?? ''}
              onChange={(v) => update('national_id', v)}
              placeholder="14 رقم"
              dir="ltr"
              fieldError={fieldErrors.national_id}
              disabled={hasPending || submitting}
            />
          </div>

          {/* Note */}
          <div>
            <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 block">
              ملاحظة للإدارة (اختياري)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 1000))}
              maxLength={1000}
              rows={2}
              className="input-field resize-none"
              placeholder="اكتب أي توضيح للإدارة..."
              disabled={hasPending || submitting}
            />
            <p className="mt-1 text-[10px] text-gray-400 text-left">{note.length}/1000</p>
          </div>

          {/* Pending request summary (if any) */}
          {hasPending && pendingRequest && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
              <p className="text-xs font-bold text-amber-800">الطلب المرسل قيد المراجعة</p>
              <ul className="space-y-1">
                {Object.entries(pendingRequest.requested_changes || {}).map(([field, value]) => (
                  <li key={field} className="text-xs text-amber-900 flex justify-between gap-3">
                    <span className="font-semibold">
                      {CHANGE_REQUEST_LABELS_AR[field as ChangeRequestField] || field}
                    </span>
                    <span className="font-mono truncate" dir="ltr">
                      {String(value)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20 flex-shrink-0">
          {hasPending ? (
            <button
              type="button"
              onClick={handleCancel}
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '…' : 'إلغاء الطلب الحالي'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !hasChanges}
              className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-[hsl(211,67%,28%)] hover:bg-[hsl(211,67%,22%)] rounded-xl disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              <Send size={12} />
              {submitting ? 'جارٍ الإرسال…' : 'إرسال طلب التعديل'}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] bg-white border border-[hsl(var(--border))] rounded-xl"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangeReqField({
  field,
  label,
  value,
  onChange,
  fieldError,
  type = 'text',
  placeholder,
  dir,
  disabled,
  renderSelect,
}: {
  field: ChangeRequestField;
  label: string;
  value: string;
  onChange: (v: string) => void;
  fieldError?: string;
  type?: 'text' | 'date';
  placeholder?: string;
  dir?: 'ltr' | 'rtl';
  disabled?: boolean;
  renderSelect?: (v: string, onChange: (v: string) => void) => React.ReactNode;
}) {
  const sensitive = SENSITIVE_FIELDS.includes(field);
  return (
    <div>
      <label className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] mb-1 flex items-center gap-1">
        {sensitive && <AlertCircle size={10} className="text-red-600" />}
        {label}
      </label>
      {renderSelect ? (
        renderSelect(value, onChange)
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          dir={dir}
          disabled={disabled}
          className="input-field"
        />
      )}
      {fieldError && <p className="mt-1 text-[10px] text-red-700">{fieldError}</p>}
    </div>
  );
}
