'use client';
export const dynamic = 'force-dynamic';
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
  CheckCircle2,
  Bell,
  Sparkles,
  Clock,
  ArrowRight
} from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Order {
  id: string;
  order_num: string;
  customer: string;
  phone: string;
  total: number;
  status: string;
  created_at: string;
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

interface ComplaintLog {
  id: string;
  complaint_id: string;
  noted_by_name: string;
  note: string;
  old_status: string;
  new_status: string;
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
      .from('turath_masr_crm_chat')
      .select('*')
      .eq('customer_phone', customer.phone)
      .order('created_at', { ascending: true });

    if (!error && data) setMessages(data as ChatMessage[]);
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
          table: 'turath_masr_crm_chat',
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
      .from('turath_masr_crm_chat')
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
                  <p className="leading-relaxed font-medium">{msg.message}</p>
                  <p
                    className={`text-[9px] mt-1.5 flex items-center gap-1 ${msg.sender === 'customer' ? 'text-gray-400 font-bold' : 'text-emerald-100 font-bold'}`}
                  >
                    {new Date(msg.created_at).toLocaleTimeString('ar-EG', {
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
              className="flex-1 bg-transparent px-4 py-2 text-sm outline-none font-bold"
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

// ─── Complaint Details & Logs Modal ──────────────────────────────────────────

function ComplaintDetailsModal({
  complaint,
  customer,
  onClose,
  onRefresh,
}: {
  complaint: Complaint;
  customer: Customer;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [logs, setLogs] = useState<ComplaintLog[]>([]);
  const [newNote, setNewNote] = useState('');
  const [newStatus, setNewStatus] = useState<string>(complaint.status);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const { user } = useAuth();
  const supabase = createClient();

  const fetchLogs = useCallback(async () => {
    const { data, error } = await supabase
      .from('turath_masr_crm_complaint_logs')
      .select('*')
      .eq('complaint_id', complaint.id)
      .order('created_at', { ascending: false });

    if (!error && data) setLogs(data as ComplaintLog[]);
    setLoading(false);
  }, [complaint.id, supabase]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    setSubmitting(true);
    
    // Attempt to get user name from metadata or email
    const notedByName = user?.user_metadata?.full_name || user?.email || 'موظف خدمة العملاء';

    // 1. Insert Log
    const { error: logErr } = await supabase
      .from('turath_masr_crm_complaint_logs')
      .insert({
        complaint_id: complaint.id,
        noted_by_name: notedByName,
        note: newNote,
        old_status: complaint.status,
        new_status: newStatus,
      });

    if (logErr) {
      toast.error('فشل في حفظ الملاحظة');
      setSubmitting(false);
      return;
    }

    // 2. Update Complaint Status if changed
    if (newStatus !== complaint.status) {
      await supabase
        .from('turath_masr_crm_complaints')
        .update({ status: newStatus })
        .eq('id', complaint.id);
    }

    // 3. Notify Customer (Record in notifications table)
    await supabase.from('turath_masr_notifications').insert({
      type: 'complaint_update',
      title: 'تحديث بخصوص شكواك',
      message: `تم الرد على شكواك: "${newNote.substring(0, 40)}..." - الحالة الآن: ${COMPLAINT_STATUS_MAP[newStatus]?.label}`,
      phone: customer.phone,
      is_read: false
    });

    toast.success('تم تسجيل الرد وإخطار العميل بنجاح');
    setNewNote('');
    fetchLogs();
    onRefresh();
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[75] flex items-center justify-center p-4 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl border border-white/20 flex flex-col max-h-[90vh]">
        <div className="px-8 py-6 bg-gray-900 text-white flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black">تفاصيل الشكوى والردود</h2>
            <p className="text-[11px] opacity-60 font-bold uppercase tracking-widest mt-1">
              العميل: {customer.name} | الحالة الحالية: {COMPLAINT_STATUS_MAP[complaint.status]?.label}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-gray-50/30">
          {/* Main Complaint Info */}
          <div className="bg-white border rounded-3xl p-6 shadow-sm ring-1 ring-black/5">
             <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
                   <AlertCircle size={20} />
                </div>
                <h3 className="font-black text-gray-900">{complaint.subject}</h3>
             </div>
             <p className="text-sm text-gray-600 leading-relaxed font-medium bg-gray-50/50 p-4 rounded-2xl border-2 border-dashed border-gray-100">{complaint.notes}</p>
             <p className="text-[10px] text-gray-400 mt-4 font-bold flex items-center gap-1 uppercase tracking-widest">
               <Clock size={12} /> تاريخ الفتح: {new Date(complaint.created_at).toLocaleString('ar-EG')}
             </p>
          </div>

          {/* Timeline of Logs */}
          <div className="space-y-6">
             <div className="flex items-center justify-between px-2">
                <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2">
                  <MessageSquare size={14} /> سجل المتابعة والملاحظات
                </h4>
                <div className="h-px flex-1 bg-gray-100 mx-4" />
             </div>
             
             <div className="space-y-4">
                {loading ? (
                  <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-emerald-500" /></div>
                ) : logs.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-3xl border-2 border-dashed border-gray-100">
                    <p className="text-gray-400 text-xs italic font-bold">لا يوجد ردود سابقة على هذه الشكوى حتى الآن.</p>
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="relative pr-8 border-r-2 border-emerald-100 pb-6 last:pb-0">
                       <div className="absolute top-1 -right-1.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-sm" />
                       <div className="bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
                          <div className="flex items-center justify-between mb-3">
                             <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                   <User size={12} />
                                </div>
                                <p className="text-xs font-black text-gray-900">{log.noted_by_name}</p>
                             </div>
                             <span className="text-[10px] text-gray-400 font-bold bg-gray-50 px-2 py-0.5 rounded-lg">
                               {new Date(log.created_at).toLocaleString('ar-EG', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                             </span>
                          </div>
                          <p className="text-sm text-gray-600 leading-relaxed font-bold">{log.note}</p>
                          {log.old_status !== log.new_status && (
                             <div className="mt-4 pt-4 border-t border-gray-50 flex items-center gap-3">
                                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">تحديث الحالة:</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] line-through text-gray-300 font-bold">{COMPLAINT_STATUS_MAP[log.old_status]?.label}</span>
                                  <ArrowRight size={10} className="text-gray-300" />
                                  <span className={`text-[10px] font-black px-3 py-1 rounded-xl border-2 ${COMPLAINT_STATUS_MAP[log.new_status]?.cls}`}>
                                    {COMPLAINT_STATUS_MAP[log.new_status]?.label}
                                  </span>
                                </div>
                             </div>
                          )}
                       </div>
                    </div>
                  ))
                )}
             </div>
          </div>
        </div>

        {/* Reply Section */}
        <div className="p-8 border-t bg-white space-y-6">
           <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex-1 space-y-2">
                 <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">إضافة رد رسمي / ملاحظة داخلية</label>
                 <textarea 
                   className="w-full h-24 bg-gray-50 border-2 border-gray-50 rounded-2xl px-5 py-4 text-sm font-bold focus:border-emerald-500/30 focus:bg-white outline-none transition-all resize-none"
                   placeholder="اكتب ماذا حدث في المتابعة..."
                   value={newNote}
                   onChange={(e) => setNewNote(e.target.value)}
                 />
              </div>
              <div className="sm:w-56 space-y-2">
                 <label className="text-[10px] font-black text-emerald-600 uppercase tracking-widest px-1">الحالة الجديدة</label>
                 <select 
                   className="w-full h-14 bg-emerald-50 border-2 border-emerald-100 rounded-2xl px-5 py-2 text-sm font-black text-emerald-900 outline-none cursor-pointer hover:bg-emerald-100 transition-colors"
                   value={newStatus}
                   onChange={(e) => setNewStatus(e.target.value)}
                 >
                   <option value="open">مواصلة الفتح (Open)</option>
                   <option value="pending">قيد المعالجة (Pending)</option>
                   <option value="resolved">تم الحل نهائياً (Resolved)</option>
                 </select>
                 <p className="text-[9px] text-gray-400 font-bold px-1">سيصل إشعار فوري للعميل بالتحديث.</p>
              </div>
           </div>
           <button 
             disabled={submitting || !newNote.trim()}
             onClick={handleAddNote}
             className="w-full h-16 bg-emerald-600 text-white rounded-[1.5rem] font-black text-sm flex items-center justify-center gap-3 hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 active:scale-95 disabled:opacity-50"
           >
             {submitting ? <Loader2 className="animate-spin" size={20} /> : <Send size={20} />}
             حفظ الرد وتحديث سجل العميل
           </button>
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
      .from('turath_masr_crm_complaints')
      .insert({ customer_phone: customer.phone, subject, notes, status });

    if (!error) {
      toast.success('تم فتح تذكرة دعم جديدة');
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
      <div className="bg-white rounded-[2.5rem] w-full max-w-lg overflow-hidden shadow-2xl border border-white/20">
        <div className="px-8 py-7 bg-gradient-to-r from-orange-600 to-orange-500 text-white flex justify-between items-center shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-full bg-white/10 -skew-x-[45deg] translate-x-12" />
          <div className="relative z-10">
            <h2 className="text-xl font-black">فتح تذكرة دعم للعميل</h2>
            <p className="text-[11px] opacity-80 font-bold uppercase tracking-widest mt-1">{customer.name} | {customer.phone}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-xl transition-colors relative z-10">
            <X size={24} />
          </button>
        </div>
        <div className="p-8 space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">
              موضوع البلاغ
            </label>
            <input
              className="w-full border-2 border-gray-50 rounded-2xl px-5 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500/10 focus:border-orange-500 transition-all bg-gray-50"
              placeholder="مثلاً: تأخير في التوصيل، تلف في المنتج..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">
              تفاصيـل الشكوى
            </label>
            <textarea
              className="w-full border-2 border-gray-50 rounded-2xl px-5 py-4 text-sm font-medium outline-none focus:ring-2 focus:ring-orange-500/10 focus:border-orange-500 transition-all bg-gray-50 h-32 resize-none leading-relaxed"
              placeholder="اكتب تفاصيل ما حدث..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">
                حالة التذكرة
              </label>
              <select
                className="w-full border-2 border-gray-50 rounded-2xl px-5 py-4 text-sm outline-none focus:ring-2 focus:ring-orange-500/10 focus:border-orange-500 transition-all bg-gray-50 font-black cursor-pointer shadow-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
              >
                <option value="open">مفتوحة (عاجلة)</option>
                <option value="pending">قيد المتابعة</option>
                <option value="resolved">تم الحل</option>
              </select>
            </div>
            <div className="flex items-end text-[10px] text-gray-400 font-bold leading-tight pb-4">
              سيتم تسجيل التذكرة وربطها ببروفايل العميل والبدا بالتنبيهات.
            </div>
          </div>
          <button
            disabled={loading || !subject}
            onClick={handleSave}
            className="w-full py-5 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-sm transition-all shadow-xl shadow-orange-100 active:scale-95 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-3"
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : <AlertCircle size={20} />}
            تأكيــد فتح التذكرة
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CRMPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [, setComplaints] = useState<Complaint[]>([]); // complaints internal use
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('الكل');

  const [complaintCustomer, setComplaintCustomer] = useState<Customer | null>(null);
  const [chatCustomer, setChatCustomer] = useState<Customer | null>(null);
  const [selectedComplaint, setSelectedComplaint] = useState<{ complaint: Complaint; customer: Customer } | null>(null);

  const fetchCRMData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: oData } = await supabase.from('turath_masr_orders').select('*').order('created_at', { ascending: false });
      const { data: cData } = await supabase.from('turath_masr_crm_complaints').select('*').order('created_at', { ascending: false });
      const { data: metaData } = await supabase.from('turath_masr_customers').select('*');

      if (oData) {
        const map = new Map<string, Customer>();
        
        // Initial map from metadata (if table exists)
        if (metaData) {
          metaData.forEach(m => {
            map.set(m.phone, {
              id: m.phone,
              name: m.full_name || '',
              phone: m.phone,
              totalOrders: m.total_orders || 0,
              totalSpent: Number(m.total_spent) || 0,
              lastOrderDate: m.updated_at || '',
              tier: (m.segment as any) || 'regular',
              orders: [],
              complaints: [],
            });
          });
        }

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
          
          // Only increment if not already using metadata totals (or just recalculate for fresh data)
          // For now, let's recalculate from orders to ensure real-time accuracy, 
          // while keeping the 'tier' and 'name' from metadata.
          if (!metaData?.find(m => m.phone === key)) {
            c.totalOrders += 1;
            c.totalSpent += Number(order.total || 0);
          }
          
          if (new Date(order.created_at) > new Date(c.lastOrderDate)) c.lastOrderDate = order.created_at;
        });

        const custArray = Array.from(map.values());
        custArray.forEach((c) => {
          // If no manual tier in metadata, auto-calculate
          const hasMeta = metaData?.find(m => m.phone === c.phone);
          if (!hasMeta) {
            if (c.totalOrders >= 10 || c.totalSpent >= 5000) c.tier = 'vip';
            else if (c.totalOrders >= 5 || c.totalSpent >= 2000) c.tier = 'gold';
            else if (c.totalOrders >= 2 || c.totalSpent >= 500) c.tier = 'silver';
          }

          if (cData) c.complaints = cData.filter((comp) => comp.customer_phone === c.phone) as Complaint[];
        });

        setCustomers(custArray.sort((a, b) => b.totalSpent - a.totalSpent));
        if (cData) setComplaints(cData as Complaint[]);
      }
    } catch (err) {
      console.error('CRM Fetch Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCRMData();
    const supabase = createClient();
    const statusChannel = supabase
      .channel('complaint-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'turath_masr_crm_complaints' }, () => fetchCRMData())
      .subscribe();

    return () => { supabase.removeChannel(statusChannel); };
  }, [fetchCRMData]);

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      const matchSearch = !search || c.name.includes(search) || c.phone.includes(search);
      const matchTier = tierFilter === 'الكل' || c.tier === tierFilter;
      const matchComplaint = tierFilter === 'HAS_COMPLAINT' ? c.complaints.length > 0 : true;
      return matchSearch && matchTier && matchComplaint;
    });
  }, [customers, search, tierFilter]);

  const statsByTier = useMemo(() => {
    return {
      vip: customers.filter(c => c.tier === 'vip').length,
      gold: customers.filter(c => c.tier === 'gold').length,
      silver: customers.filter(c => c.tier === 'silver').length,
      regular: customers.filter(c => c.tier === 'regular').length,
    };
  }, [customers]);

  if (loading) {
    return (
      <AppLayout currentPath="/crm">
        <div className="flex flex-col items-center justify-center py-40 gap-4">
          <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-bold text-gray-400 uppercase tracking-[0.2em] animate-pulse">جاري سحب بيانات العملاء والشكاوى</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout currentPath="/crm">
      <Toaster position="top-center" dir="rtl" />
      <div className="space-y-8 fade-in pb-20 pt-2" dir="rtl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
          <div className="relative">
            <h1 className="text-4xl font-black text-gray-900 tracking-tight flex items-center gap-3">
              إدارة علاقات <span className="bg-gradient-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent">العملاء</span>
              <div className="bg-emerald-50 text-emerald-600 p-1.5 rounded-xl border border-emerald-100 flex items-center gap-1 text-[10px] uppercase font-black">
                <Sparkles size={12} className="animate-pulse" /> Live
              </div>
            </h1>
            <p className="text-sm text-gray-500 mt-2 font-bold max-w-md leading-relaxed">
              تحليل شامل للسلوك الشرائي، حل الشكاوى، وواجهة ذكية لخدمة كبار العملاء.
            </p>
          </div>
          
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 lg:pb-0">
            {Object.entries(statsByTier).map(([t, count]) => {
              const cfg = TIER_CONFIG[t];
              return (
                <div 
                  key={t}
                  className={`flex flex-col items-start px-6 py-4 rounded-[1.5rem] border bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg cursor-pointer ${tierFilter === t ? 'ring-2 ring-emerald-500/30 border-emerald-500/50' : 'border-gray-50'}`}
                  onClick={() => setTierFilter(tierFilter === t ? 'الكل' : t)}
                >
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${cfg.cls} border-0`}>
                    {cfg.icon}
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{cfg.label}</p>
                  <p className="text-xl font-black text-gray-900 font-mono tracking-tighter">{count}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-4">
          <div className="relative flex-1 group">
            <div className="absolute inset-y-0 right-5 flex items-center pointer-events-none group-focus-within:text-emerald-500 transition-colors">
              <Search size={20} className="text-gray-300" />
            </div>
            <input 
              type="text"
              placeholder="ابحث عن العميل بالاسم أو رقم الموبايل..."
              className="w-full h-16 pr-14 pl-6 bg-white border-2 border-gray-50 rounded-[2rem] text-sm font-bold shadow-sm focus:outline-none focus:border-emerald-500/30 transition-all text-right"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button className="h-16 px-8 bg-gray-900 text-white rounded-[2rem] text-sm font-black flex items-center gap-2 hover:bg-gray-800 transition-all shadow-lg active:scale-95">
              <Filter size={18} /> تصفية الشكاوى
            </button>
            <button className="h-16 w-16 bg-emerald-50 text-emerald-600 rounded-[2rem] flex items-center justify-center hover:bg-emerald-100 transition-all border border-emerald-100 shadow-sm">
              <Download size={22} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {filtered.map((c) => {
            const tier = TIER_CONFIG[c.tier];
            const openComps = c.complaints.filter((x) => x.status !== 'resolved');
            const latestComplaint = openComps[0];

            return (
              <div
                key={c.phone}
                className="group relative bg-white border-2 border-gray-50 rounded-[2.5rem] p-7 flex flex-col transition-all duration-500 hover:shadow-2xl hover:border-emerald-500/20 hover:-translate-y-2 overflow-hidden"
              >
                <div className={`absolute -top-12 -right-12 w-32 h-32 blur-3xl opacity-0 group-hover:opacity-10 transition-opacity duration-1000 ${tier.color === 'purple' ? 'bg-purple-600' : tier.color === 'yellow' ? 'bg-yellow-500' : 'bg-emerald-500'}`} />
                
                <div className="flex items-start justify-between mb-8 relative">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-[1.75rem] bg-gray-50 border border-gray-100 flex items-center justify-center text-4xl font-black group-hover:scale-110 transition-transform duration-500">
                        {c.name.charAt(0)}
                      </div>
                      <div className={`absolute -bottom-1 -right-1 w-7 h-7 rounded-full border-2 border-white flex items-center justify-center shadow-lg ${tier.cls}`}>
                        {tier.icon}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-black text-gray-900 group-hover:text-emerald-600 transition-colors tracking-tight text-lg leading-tight uppercase">
                        {c.name}
                      </h3>
                      <div className="flex items-center gap-1.5 mt-1">
                         <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                         <span className="text-[10px] font-bold text-gray-400 font-mono tracking-widest">{c.phone}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8 relative">
                  <div className="bg-gray-50/50 rounded-3xl p-4 transition-all group-hover:bg-emerald-50/30 border border-transparent group-hover:border-emerald-100/50">
                    <div className="flex items-center gap-1.5 mb-1 opacity-50">
                      <ShoppingBag size={12} className="text-gray-400" />
                      <p className="text-[9px] font-black uppercase tracking-widest">الطلبات</p>
                    </div>
                    <p className="text-xl font-black text-gray-900 font-mono">{c.totalOrders}</p>
                  </div>
                  <div className="bg-gray-50/50 rounded-3xl p-4 transition-all group-hover:bg-emerald-50/30 border border-transparent group-hover:border-emerald-100/50">
                    <div className="flex items-center gap-1.5 mb-1 opacity-50">
                      <TrendingUp size={12} className="text-emerald-500" />
                      <p className="text-[9px] font-black uppercase tracking-widest">الإنفاق</p>
                    </div>
                    <p className="text-xl font-black text-gray-900 font-mono tracking-tighter">
                      {c.totalSpent.toLocaleString('en-US')}
                      <span className="text-[10px] mr-1 text-emerald-500">ج.م</span>
                    </p>
                  </div>
                </div>

                <div className="mt-auto relative">
                  {openComps.length > 0 ? (
                    <div 
                      onClick={() => setSelectedComplaint({ complaint: latestComplaint, customer: c })}
                      className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3 flex items-center justify-between mb-4 animate-pulse cursor-pointer hover:bg-red-100 transition-colors shadow-sm"
                    >
                      <div className="flex items-center gap-2 text-red-600">
                        <AlertCircle size={14} />
                        <span className="text-[10px] font-black uppercase tracking-widest">{openComps.length} شكاوى مفتوحة</span>
                      </div>
                      <div className="bg-red-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">رد الآن</div>
                    </div>
                  ) : (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 flex items-center gap-2 text-emerald-600 mb-4 h-12">
                      <CheckCircle2 size={14} />
                      <span className="text-[10px] font-black uppercase tracking-widest">سجل العميل سليم</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500">
                    <button 
                      onClick={() => setChatCustomer(c)}
                      className="flex-1 h-12 bg-gray-900 text-white rounded-2xl flex items-center justify-center gap-2 hover:bg-emerald-600 transition-all shadow-xl active:scale-95"
                    >
                      <MessageSquare size={16} />
                      <span className="text-[11px] font-black">شات</span>
                    </button>
                    <button 
                      onClick={() => setComplaintCustomer(c)}
                      className="flex-1 h-12 bg-white border-2 border-gray-100 text-gray-900 rounded-2xl flex items-center justify-center gap-2 hover:border-gray-900 transition-all shadow-sm active:scale-95"
                    >
                      <Plus size={16} />
                      <span className="text-[11px] font-black">شكوى</span>
                    </button>
                    <button 
                      className="w-12 h-12 bg-white border-2 border-gray-100 text-gray-400 rounded-2xl flex items-center justify-center hover:border-emerald-500 hover:text-emerald-500 transition-all group/btn"
                      onClick={() => window.location.href=`/crm/customer/${c.phone}`}
                    >
                      <Eye size={20} className="group-hover/btn:scale-110 transition-transform"/>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {complaintCustomer && (
        <ComplaintModal
          customer={complaintCustomer}
          onClose={() => setComplaintCustomer(null)}
          onRefresh={fetchCRMData}
        />
      )}
      {selectedComplaint && (
        <ComplaintDetailsModal 
          customer={selectedComplaint.customer}
          complaint={selectedComplaint.complaint}
          onClose={() => setSelectedComplaint(null)}
          onRefresh={fetchCRMData}
        />
      )}
      {chatCustomer && (
        <SupportChatPanel customer={chatCustomer} onClose={() => setChatCustomer(null)} />
      )}
    </AppLayout>
  );
}
