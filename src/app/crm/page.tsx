'use client';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import AppLayout from '@/components/AppLayout';
import {
  Users,
  Search,
  Star,
  TrendingUp,
  ShoppingBag,
  AlertCircle,
  Eye,
  Plus,
  X,
  Phone,
  Hash,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Crown,
  Award,
  User,
  Filter,
  Download,
  Send,
  Headphones,
  Loader2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Order {
  id: string;
  order_num: string;
  customer: string;
  phone: string;
  total: number;
  status: string;
  created_at: string;
  products: string;
}

interface Complaint {
  id: string;
  customer_phone: string;
  subject: string;
  status: 'open' | 'resolved' | 'pending';
  notes: string;
  created_at: string;
}

interface ChatMessage {
  id: string;
  customer_phone: string;
  sender: 'support' | 'customer';
  message: string;
  created_at: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: string;
  tier: 'vip' | 'gold' | 'silver' | 'regular';
  orders: any[];
  complaints: Complaint[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COMPLAINT_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  open: { label: 'مفتوحة', cls: 'bg-red-100 text-red-700 border-red-200' },
  pending: { label: 'قيد المعالجة', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  resolved: { label: 'محلولة', cls: 'bg-green-100 text-green-700 border-green-200' },
};

const TIER_CONFIG: Record<
  string,
  { label: string; cls: string; icon: React.ReactNode; color: string }
> = {
  vip: {
    label: 'VIP',
    cls: 'bg-purple-100 text-purple-700 border-purple-200',
    icon: <Crown size={12} />,
    color: 'purple',
  },
  gold: {
    label: 'ذهبي',
    cls: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    icon: <Star size={12} />,
    color: 'yellow',
  },
  silver: {
    label: 'فضي',
    cls: 'bg-slate-100 text-slate-600 border-slate-200',
    icon: <Award size={12} />,
    color: 'slate',
  },
  regular: {
    label: 'عادي',
    cls: 'bg-gray-100 text-gray-600 border-gray-200',
    icon: <User size={12} />,
    color: 'gray',
  },
};

// ─── Support Chat Panel ───────────────────────────────────────────────────────

function SupportChatPanel({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const fetchMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from('zahranship_crm_chat')
      .select('*')
      .eq('customer_phone', customer.phone)
      .order('created_at', { ascending: true });

    if (!error && data) setMessages(data);
    setLoading(false);
  }, [customer.phone, supabase]);

  useEffect(() => {
    fetchMessages();
    const sub = supabase
      .channel(`chat-${customer.phone}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'zahranship_crm_chat',
          filter: `customer_phone=eq.${customer.phone}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as ChatMessage]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [customer.phone, fetchMessages, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const msg = input.trim();
    setInput('');
    const { error } = await supabase
      .from('zahranship_crm_chat')
      .insert({ customer_phone: customer.phone, sender: 'support', message: msg });

    if (error) console.error(error);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[70] flex items-end justify-center sm:items-center p-0 sm:p-4 backdrop-blur-sm"
      dir="rtl"
    >
      <div className="bg-white w-full sm:max-w-md sm:rounded-3xl flex flex-col shadow-2xl h-[85vh] max-h-[700px] overflow-hidden border border-white/20">
        <div className="flex items-center gap-4 px-6 py-5 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-lg">
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-md">
            <Headphones size={24} />
          </div>
          <div className="flex-1">
            <p className="font-bold text-lg leading-tight">مركز الدعم الفني</p>
            <p className="text-[11px] opacity-80 font-medium">
              {customer.name} • {customer.phone}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/50">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="animate-spin text-emerald-500" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-2 opacity-50">
              <MessageSquare size={48} strokeWidth={1} />
              <p className="text-xs font-bold uppercase tracking-widest">لا توجد رسائل سابقة</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === 'support' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm shadow-sm ${msg.sender === 'customer' ? 'bg-white border border-emerald-100 text-gray-800' : 'bg-emerald-600 text-white'}`}
                >
                  <p className="leading-relaxed">{msg.message}</p>
                  <p
                    className={`text-[9px] mt-1.5 flex items-center gap-1 ${msg.sender === 'customer' ? 'text-gray-400' : 'text-emerald-100'}`}
                  >
                    {new Date(msg.created_at).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t bg-white">
          <div className="flex items-center gap-3 bg-gray-50 border rounded-2xl p-1 focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500 transition-all">
            <input
              className="flex-1 bg-transparent px-4 py-2 text-sm outline-none font-medium"
              placeholder="اكتب ردك هنا..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            />
            <button
              onClick={sendMessage}
              className="w-10 h-10 bg-emerald-600 text-white rounded-xl flex items-center justify-center hover:bg-emerald-700 shadow-md shadow-emerald-200 transition-all active:scale-95"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Complaint Modal ──────────────────────────────────────────────────────────

function ComplaintModal({
  customer,
  onClose,
  onRefresh,
}: {
  customer: Customer;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'open' | 'resolved' | 'pending'>('open');
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleSave = async () => {
    if (!subject) return;
    setLoading(true);
    const { error } = await supabase
      .from('zahranship_crm_complaints')
      .insert({ customer_phone: customer.phone, subject, notes, status });

    if (!error) {
      onRefresh();
      onClose();
    }
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm"
      dir="rtl"
    >
      <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-white/20">
        <div className="px-6 py-5 bg-gradient-to-r from-orange-600 to-orange-500 text-white flex justify-between items-center shadow-lg">
          <div>
            <h2 className="text-lg font-bold">تسجيل شكوى جديدة</h2>
            <p className="text-[11px] opacity-80 font-medium">{customer.name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
            <X size={24} />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-1">
              موضوع البلاغ
            </label>
            <input
              className="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all bg-gray-50"
              placeholder="مثلاً: تأخير في التوصيل، تلف في المنتج..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-1">
              تفاصيل الشكوى
            </label>
            <textarea
              className="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all bg-gray-50 h-32 resize-none"
              placeholder="اكتب تفاصيل ما حدث..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-1">
                حالة التذكرة
              </label>
              <select
                className="w-full border rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all bg-gray-50 font-bold"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
              >
                <option value="open">مفتوحة (عاجلة)</option>
                <option value="pending">قيد المتابعة</option>
                <option value="resolved">تم الحل</option>
              </select>
            </div>
            <div className="flex items-end text-[10px] text-gray-400 font-medium leading-tight pb-3">
              سيتم إشعار مدير النظام فور حفظ هذه الشكوى في قاعدة البيانات.
            </div>
          </div>
          <button
            disabled={loading || !subject}
            onClick={handleSave}
            className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-bold transition-all shadow-lg shadow-orange-200 active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : 'فتح تذكرة دعم الآن'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CRMPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('الكل');

  const [complaintCustomer, setComplaintCustomer] = useState<Customer | null>(null);
  const [chatCustomer, setChatCustomer] = useState<Customer | null>(null);

  const fetchCRMData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();

      // 1. Fetch Orders to build customer profiles
      const { data: oData } = await supabase
        .from('zahranship_orders')
        .select('*')
        .order('created_at', { ascending: false });

      // 2. Fetch all Complaints
      const { data: cData } = await supabase
        .from('zahranship_crm_complaints')
        .select('*')
        .order('created_at', { ascending: false });

      if (oData) {
        const map = new Map<string, Customer>();
        oData.forEach((order) => {
          const key = order.phone;
          if (!map.has(key)) {
            map.set(key, {
              id: key,
              name: order.customer,
              phone: order.phone,
              totalOrders: 0,
              totalSpent: 0,
              lastOrderDate: order.created_at,
              tier: 'regular',
              orders: [],
              complaints: [],
            });
          }
          const c = map.get(key)!;
          c.orders.push({
            id: order.id,
            order_num: order.order_num,
            total: order.total,
            status: order.status,
            date: new Date(order.created_at).toLocaleDateString('en-GB'),
          });
          c.totalOrders += 1;
          c.totalSpent += Number(order.total || 0);
          if (new Date(order.created_at) > new Date(c.lastOrderDate))
            c.lastOrderDate = order.created_at;
        });

        const custArray = Array.from(map.values());
        custArray.forEach((c) => {
          // Calc Tier
          if (c.totalOrders >= 10 || c.totalSpent >= 5000) c.tier = 'vip';
          else if (c.totalOrders >= 5 || c.totalSpent >= 2000) c.tier = 'gold';
          else if (c.totalOrders >= 2 || c.totalSpent >= 500) c.tier = 'silver';

          // Link Complaints
          if (cData) c.complaints = cData.filter((comp) => comp.customer_phone === c.phone);
        });

        setCustomers(custArray.sort((a, b) => b.totalSpent - a.totalSpent));
        if (cData) setComplaints(cData);
      }
    } catch (err) {
      console.error('CRM Fetch Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCRMData();
  }, [fetchCRMData]);

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      const matchSearch = !search || c.name.includes(search) || c.phone.includes(search);
      const matchTier = tierFilter === 'الكل' || c.tier === tierFilter;
      const matchComplaint = tierFilter === 'HAS_COMPLAINT' ? c.complaints.length > 0 : true;
      return matchSearch && matchTier && matchComplaint;
    });
  }, [customers, search, tierFilter]);

  if (loading) {
    return (
      <AppLayout currentPath="/crm">
        <div className="flex flex-col items-center justify-center py-40 gap-4">
          <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-bold text-gray-400 uppercase tracking-[0.2em] animate-pulse">
            جاري دمج البيانات الحية لقاعدة العملاء
          </p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout currentPath="/crm">
      <div className="space-y-8 fade-in pb-20 pt-2">
        {/* Header Summary */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">
              إدارة علاقات العملاء <span className="text-emerald-500">CRM</span>
            </h1>
            <p className="text-sm text-gray-500 mt-1 uppercase tracking-wider font-bold">
              نظام مركزي لتتبع نشاط العملاء وشكاوى الدعم الفني
            </p>
          </div>
          <div className="flex gap-4">
            <div className="bg-white border rounded-3xl px-6 py-3 flex items-center gap-4 shadow-sm">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Users size={20} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">العملاء النشطين</p>
                <p className="text-xl font-bold text-gray-900 font-mono tracking-tighter">
                  {customers.length}
                </p>
              </div>
            </div>
            <div className="bg-white border rounded-3xl px-6 py-3 flex items-center gap-4 shadow-sm">
              <div className="w-10 h-10 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center">
                <AlertCircle size={20} />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase">تذاكر الدعم</p>
                <p className="text-xl font-bold text-gray-900 font-mono tracking-tighter">
                  {complaints.filter((c) => c.status !== 'resolved').length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-100 p-6 rounded-[2rem] shadow-sm flex flex-wrap items-center gap-4 transition-all hover:shadow-md">
          <div className="relative flex-1 min-w-[300px]">
            <Search size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full border-2 border-gray-50 rounded-2xl pr-12 pl-4 py-3.5 text-sm outline-none focus:border-emerald-500/50 bg-gray-50 focus:bg-white transition-all font-medium"
              placeholder="ابحث بالاسم، رقم الهاتف، أو كود التتبع..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <select
              className="border-2 border-gray-50 rounded-2xl px-6 py-3.5 text-sm outline-none bg-gray-50 font-bold text-gray-600 focus:border-emerald-500/50"
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
            >
              <option value="الكل">كل الفئات</option>
              <option value="vip">VIP</option>
              <option value="gold">ذهبي</option>
              <option value="silver">فضي</option>
              <option value="regular">عادي</option>
              <option value="HAS_COMPLAINT">أصحاب الشكاوى</option>
            </select>
            <button className="bg-gray-900 text-white px-6 py-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 hover:bg-gray-800 transition-all">
              <Download size={16} /> تصدير
            </button>
          </div>
        </div>

        {/* Customer Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filtered.map((c) => {
            const tier = TIER_CONFIG[c.tier];
            const openComps = c.complaints.filter((x) => x.status !== 'resolved');
            return (
              <div
                key={c.phone}
                className="bg-white border-2 border-gray-50 rounded-[2.5rem] p-6 hover:shadow-2xl hover:border-emerald-500/10 transition-all group relative overflow-hidden flex flex-col h-full"
              >
                {/* Status Indicator */}
                <div
                  className={`absolute top-0 right-0 w-2 h-full ${
                    tier.color === 'purple'
                      ? 'bg-purple-500'
                      : tier.color === 'yellow'
                        ? 'bg-yellow-500'
                        : tier.color === 'slate'
                          ? 'bg-slate-400'
                          : 'bg-gray-200'
                  }`}
                />

                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-3xl bg-gray-50 border border-gray-100 flex items-center justify-center text-2xl font-black text-gray-300 group-hover:scale-110 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-all duration-500">
                      {c.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 line-clamp-1 group-hover:text-emerald-600 transition-colors uppercase tracking-tight">
                        {c.name}
                      </h3>
                      <p className="text-[11px] text-gray-400 font-mono tracking-wider">
                        {c.phone}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-gray-50/50 rounded-2xl p-3 text-center border border-gray-100/50 group-hover:bg-white transition-colors">
                    <p className="text-sm font-black text-gray-900 font-mono">{c.totalOrders}</p>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                      طلبات
                    </p>
                  </div>
                  <div className="bg-gray-50/50 rounded-2xl p-3 text-center border border-gray-100/50 group-hover:bg-white transition-colors">
                    <p className="text-sm font-black text-emerald-600 font-mono">
                      {c.totalSpent.toLocaleString('en-US')}
                    </p>
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                      جنيه
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-50">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[9px] px-3 py-1 rounded-full font-black border ${tier.cls} uppercase`}
                    >
                      {tier.label}
                    </span>
                    {openComps.length > 0 && (
                      <div className="w-5 h-5 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-[10px] font-bold border border-red-200 animate-bounce">
                        {openComps.length}
                      </div>
                    )}
                  </div>
                  <p className="text-[9px] text-gray-400 font-bold">
                    {new Date(c.lastOrderDate).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-2 mt-5 pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100 translate-y-4 group-hover:translate-y-0 transition-all duration-500">
                  <button
                    onClick={() => setChatCustomer(c)}
                    className="flex-1 bg-emerald-600 text-white rounded-2xl py-3 text-[10px] font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all"
                  >
                    <Headphones size={14} /> دعم مباشر
                  </button>
                  <button
                    onClick={() => setComplaintCustomer(c)}
                    className="flex-1 border-2 border-gray-100 text-orange-600 rounded-2xl py-3 text-[10px] font-bold flex items-center justify-center gap-2 hover:bg-orange-50 hover:border-orange-100 transition-all"
                  >
                    <MessageSquare size={14} /> شكوى
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="py-40 text-center flex flex-col items-center gap-4 opacity-30">
            <Search size={64} strokeWidth={1} />
            <p className="text-lg font-bold italic">
              لا توجد بيانات مطابقة لمعايير البحث في قاعدة العملاء...
            </p>
          </div>
        )}
      </div>

      {complaintCustomer && (
        <ComplaintModal
          customer={complaintCustomer}
          onClose={() => setComplaintCustomer(null)}
          onRefresh={fetchCRMData}
        />
      )}
      {chatCustomer && (
        <SupportChatPanel customer={chatCustomer} onClose={() => setChatCustomer(null)} />
      )}
    </AppLayout>
  );
}
