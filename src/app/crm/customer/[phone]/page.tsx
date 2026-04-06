'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppLayout from '@/components/AppLayout';
import {
  ArrowRight,
  ShoppingBag,
  AlertCircle,
  MessageSquare,
  TrendingUp,
  Calendar,
  Phone,
  MapPin,
  Target,
  Edit3,
  Save,
  Loader2,
  CheckCircle2,
  Clock,
  Briefcase,
  DollarSign,
  User,
  ShieldCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast, Toaster } from 'sonner';

// --- Types ---
interface Order {
  id: string;
  order_num: string;
  total: number;
  status: string;
  created_at: string;
  products: string;
}

interface Complaint {
  id: string;
  subject: string;
  notes: string;
  status: string;
  created_at: string;
  logs?: ComplaintLog[];
}

interface ComplaintLog {
  id: string;
  noted_by_name: string;
  note: string;
  old_status: string;
  new_status: string;
  created_at: string;
}

interface CustomerMetadata {
  phone: string;
  full_name: string;
  email: string;
  address: string;
  notes: string;
  segment: string;
}

// --- Constants ---
const STATUS_COLORS: Record<string, string> = {
  delivered: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  shipping: 'bg-blue-50 text-blue-600 border-blue-100',
  cancelled: 'bg-red-50 text-red-600 border-red-100',
  returned: 'bg-orange-50 text-orange-600 border-orange-100',
  new: 'bg-gray-50 text-gray-600 border-gray-100',
};

const SEGMENT_CLASSES: Record<string, string> = {
  vip: 'from-purple-600 to-indigo-600 text-white',
  gold: 'from-yellow-500 to-orange-500 text-white',
  silver: 'from-gray-400 to-slate-500 text-white',
  regular: 'from-gray-100 to-gray-200 text-gray-700',
};

export default function CustomerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const phone = params.phone as string;
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [metadata, setMetadata] = useState<CustomerMetadata>({
    phone,
    full_name: '',
    email: '',
    address: '',
    notes: '',
    segment: 'regular',
  });

  const supabase = createClient();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch Orders
      const { data: oData } = await supabase
        .from('turath_masr_orders')
        .select('*')
        .eq('phone', phone)
        .order('created_at', { ascending: false });
      
      if (oData) setOrders(oData);

      // 2. Fetch Complaints & Their Logs
      const { data: cData } = await supabase
        .from('turath_masr_crm_complaints')
        .select('*')
        .eq('customer_phone', phone)
        .order('created_at', { ascending: false });
      
      if (cData) {
        // Fetch logs for all these complaints
        const complaintIds = cData.map(c => c.id);
        const { data: lData } = await supabase
          .from('turath_masr_crm_complaint_logs')
          .select('*')
          .in('complaint_id', complaintIds)
          .order('created_at', { ascending: true });
        
        const complaintsWithLogs = cData.map(c => ({
          ...c,
          logs: lData?.filter(l => l.complaint_id === c.id) || []
        }));
        setComplaints(complaintsWithLogs);
      }

      // 3. Fetch Metadata
      const { data: mData } = await supabase
        .from('turath_masr_customers')
        .select('*')
        .eq('phone', phone)
        .single();
      
      if (mData) {
        setMetadata({
          phone: mData.phone,
          full_name: mData.full_name || (oData?.[0]?.customer || ''),
          email: mData.email || '',
          address: mData.address || '',
          notes: mData.notes || '',
          segment: mData.segment || 'regular',
        });
      } else if (oData?.[0]) {
        setMetadata(prev => ({ ...prev, full_name: oData[0].customer || '' }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [phone, supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveMetadata = async () => {
    setSaving(true);
    const totalSpent = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const { error } = await supabase
      .from('turath_masr_customers')
      .upsert({
        phone,
        full_name: metadata.full_name,
        email: metadata.email,
        address: metadata.address,
        notes: metadata.notes,
        segment: metadata.segment,
        total_spent: totalSpent,
        total_orders: orders.length,
        updated_at: new Date().toISOString(),
      });
    
    if (!error) {
      toast.success('تم تحديث بيانات العميل بنجاح');
    } else {
      toast.error('فشل حفظ البيانات، يرجى المحاولة لاحقاً');
    }
    setSaving(false);
  };

  const financialStats = useMemo(() => {
    const total = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const delivered = orders.filter(o => o.status === 'delivered').length;
    return {
      totalSpent: total,
      orderCount: orders.length,
      successRate: orders.length > 0 ? Math.round((delivered / orders.length) * 100) : 0,
      avgOrderValue: orders.length > 0 ? Math.round(total / orders.length) : 0,
    };
  }, [orders]);

  if (loading) {
    return (
      <AppLayout currentPath="/crm">
        <div className="flex flex-col items-center justify-center py-40 gap-4">
          <Loader2 className="animate-spin text-emerald-500" size={48} />
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">تحليل السجل المالي للعميل...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout currentPath="/crm">
      <Toaster position="top-center" dir="rtl" />
      <div className="space-y-8 fade-in pb-20 pt-2" dir="rtl">
        {/* Breadcrumb & Navigation */}
        <button 
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-400 hover:text-gray-900 transition-colors font-bold text-sm mb-4"
        >
          <ArrowRight size={18} />
          العودة للـ CRM
        </button>

        {/* Profile Card Overlay */}
        <div className="relative overflow-hidden bg-white border-2 border-gray-50 rounded-[3rem] p-8 lg:p-12 shadow-sm">
           {/* Tier Background Gradient */}
           <div className={`absolute top-0 right-0 w-full h-32 bg-gradient-to-l opacity-10 ${SEGMENT_CLASSES[metadata.segment]}`} />
           
           <div className="flex flex-col lg:flex-row gap-10 relative z-10 text-right">
              {/* Avatar & Basic Info */}
              <div className="flex flex-col items-center lg:items-start gap-6 text-center lg:text-right">
                <div className={`w-32 h-32 rounded-[2.5rem] bg-gradient-to-br flex items-center justify-center text-5xl font-black shadow-2xl shadow-emerald-200/20 text-white ${SEGMENT_CLASSES[metadata.segment]}`}>
                  {metadata.full_name.charAt(0)}
                </div>
                <div>
                  <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-2 uppercase">{metadata.full_name}</h1>
                  <div className="flex flex-wrap justify-center lg:justify-start gap-3">
                    <span className="flex items-center gap-1 text-xs font-bold text-gray-400 bg-gray-50 px-3 py-1.5 rounded-xl border">
                      <Phone size={12} /> {phone}
                    </span>
                    <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100 uppercase tracking-widest">
                      <Target size={12} /> {metadata.segment}
                    </span>
                  </div>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'إجمالي الإنفاق', value: `${financialStats.totalSpent.toLocaleString()} ج.م`, icon: <DollarSign className="text-emerald-500"/>, bg: 'bg-emerald-50/50' },
                  { label: 'عدد الطلبات', value: financialStats.orderCount, icon: <ShoppingBag className="text-blue-500"/>, bg: 'bg-blue-50/50' },
                  { label: 'نسبة النجاح', value: `${financialStats.successRate}%`, icon: <ShieldCheck className="text-purple-500"/>, bg: 'bg-purple-50/50' },
                  { label: 'متوسط الأوردر', value: `${financialStats.avgOrderValue} ج.م`, icon: <TrendingUp className="text-orange-500"/>, bg: 'bg-orange-50/50' },
                ].map((stat, i) => (
                  <div key={i} className={`${stat.bg} p-6 rounded-[2rem] border border-transparent hover:border-white hover:shadow-xl transition-all group`}>
                    <div className="w-10 h-10 rounded-2xl bg-white shadow-sm flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                      {stat.icon}
                    </div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
                    <p className="text-xl font-black text-gray-900 font-mono tracking-tighter">{stat.value}</p>
                  </div>
                ))}
              </div>
           </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
           {/* Main Activity Column */}
           <div className="lg:col-span-2 space-y-8">
              {/* Order History */}
              <div className="bg-white border-2 border-gray-50 rounded-[2.5rem] p-8 shadow-sm">
                <div className="flex items-center justify-between mb-8">
                   <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                      <ShoppingBag size={22} className="text-blue-500"/>
                      سجل الطلبات
                   </h2>
                   <span className="text-xs font-bold text-gray-400">{orders.length} أوردر مسجل</span>
                </div>
                
                <div className="space-y-4">
                  {orders.map(o => (
                    <div key={o.id} className="group bg-gray-50/30 hover:bg-white border hover:border-blue-100 hover:shadow-lg rounded-[1.5rem] p-5 transition-all flex items-center justify-between">
                       <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center font-mono font-bold text-blue-600 text-xs shadow-sm">
                            {o.order_num.split('-')[1]}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight">{o.order_num}</p>
                            <p className="text-[10px] text-gray-400 font-medium italic mt-0.5 line-clamp-1 max-w-[200px]">{o.products}</p>
                          </div>
                       </div>
                       <div className="text-left">
                          <span className={`text-[10px] font-black px-3 py-1 rounded-full border uppercase ${STATUS_COLORS[o.status] || 'bg-gray-50'}`}>
                            {o.status}
                          </span>
                          <p className="text-xs font-black text-gray-900 font-mono mt-1">{Number(o.total).toLocaleString()} ج.م</p>
                       </div>
                    </div>
                  ))}
                  {orders.length === 0 && (
                    <div className="py-10 text-center text-gray-400 font-bold text-sm italic">لا توجد طلبات سابقة لهذا العميل.</div>
                  )}
                </div>
              </div>

              {/* Complaints History */}
              <div className="bg-white border-2 border-gray-50 rounded-[2.5rem] p-8 shadow-sm">
                <div className="flex items-center justify-between mb-8">
                   <h2 className="text-xl font-black text-gray-900 flex items-center gap-3">
                      <AlertCircle size={22} className="text-orange-500"/>
                      سجل الشكاوى والدعم
                   </h2>
                   <span className="text-xs font-bold text-gray-400">{complaints.length} بلاغ</span>
                </div>

                <div className="space-y-6">
                   {complaints.map(c => (
                     <div key={c.id} className="relative pl-8 border-l-2 border-gray-50 last:border-0 pb-6">
                        <div className="absolute top-0 -left-1.5 w-3 h-3 rounded-full bg-orange-200 border-2 border-white shadow-sm" />
                        <div className="bg-gray-50/50 rounded-2xl p-5 hover:bg-orange-50/30 transition-colors">
                           <div className="flex items-center justify-between mb-2">
                             <p className="font-bold text-gray-900">{c.subject}</p>
                             <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg border ${c.status === 'resolved' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                               {c.status}
                             </span>
                           </div>
                           <p className="text-xs text-gray-500 leading-relaxed mb-4">{c.notes}</p>
                           
                           {/* Activity Logs Timeline */}
                           {c.logs && c.logs.length > 0 && (
                             <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                               <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                                 <MessageSquare size={10} /> سجل المتابعة ({c.logs.length})
                               </p>
                               {c.logs.map(log => (
                                 <div key={log.id} className="bg-white border border-gray-100 rounded-xl p-3 flex flex-col gap-1 shadow-sm">
                                    <div className="flex items-center justify-between">
                                      <p className="text-[10px] font-black text-gray-700">{log.noted_by_name}</p>
                                      <p className="text-[8px] font-bold text-gray-400">{new Date(log.created_at).toLocaleString('ar-EG', { hour:'2-digit', minute:'2-digit' })}</p>
                                    </div>
                                    <p className="text-[11px] text-gray-600 font-medium italic">"{log.note}"</p>
                                    {log.old_status !== log.new_status && (
                                      <div className="flex items-center gap-1.5 mt-1 border-t border-gray-50 pt-1">
                                        <span className="text-[8px] font-bold text-emerald-600">تغيرت الحالة: {log.old_status} → {log.new_status}</span>
                                      </div>
                                    )}
                                 </div>
                               ))}
                             </div>
                           )}

                           <p className="text-[10px] text-gray-400 font-bold flex items-center gap-1 mt-4">
                             <Clock size={10} /> تاريخ الفتح: {new Date(c.created_at).toLocaleDateString('en-GB')}
                           </p>
                        </div>
                     </div>
                   ))}
                   {complaints.length === 0 && (
                     <div className="py-10 text-center text-gray-400 font-bold text-sm italic">السجل نظيف من أي شكاوى فنية.</div>
                   )}
                </div>
              </div>
           </div>

           {/* Sidebar: Preferences & Notes */}
           <div className="space-y-8">
              <div className="bg-white border-2 border-gray-50 rounded-[2.5rem] p-8 shadow-sm h-fit sticky top-8">
                 <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-50">
                    <Edit3 size={20} className="text-emerald-500" />
                    <h3 className="font-black text-gray-900 tracking-tight">ملاحظات الإدارة</h3>
                 </div>

                 <div className="space-y-6">
                     <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">البريد الإلكتروني</label>
                        <input 
                          type="email"
                          className="w-full bg-gray-50 border-2 border-gray-50 rounded-2xl px-4 py-3.5 text-sm font-bold focus:border-emerald-500/30 outline-none transition-all"
                          placeholder="example@mail.com"
                          value={metadata.email}
                          onChange={(e) => setMetadata({...metadata, email: e.target.value})}
                        />
                     </div>

                     <div className="space-y-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">العنوان بالتفصيل</label>
                        <input 
                          type="text"
                          className="w-full bg-gray-50 border-2 border-gray-50 rounded-2xl px-4 py-3.5 text-sm font-bold focus:border-emerald-500/30 outline-none transition-all"
                          placeholder="العنوان المسكن للعميل..."
                          value={metadata.address}
                          onChange={(e) => setMetadata({...metadata, address: e.target.value})}
                        />
                     </div>

                     <div className="space-y-2">
                       <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">تصنيف العميل</label>
                       <select 
                         className="w-full bg-gray-50 border-2 border-gray-50 rounded-2xl px-4 py-3.5 text-sm font-bold focus:border-emerald-500/30 outline-none transition-all"
                         value={metadata.segment}
                         onChange={(e) => setMetadata({...metadata, segment: e.target.value})}
                       >
                         <option value="regular">عميل عادي</option>
                         <option value="silver">عميل فضي</option>
                         <option value="gold">عميل ذهبي (Gold)</option>
                         <option value="vip">عميل VIP</option>
                       </select>
                    </div>

                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">ملاحظات خاصة</label>
                       <textarea 
                         className="w-full bg-gray-50 border-2 border-gray-50 rounded-2xl px-4 py-4 text-sm font-medium focus:border-emerald-500/30 outline-none transition-all h-64 resize-none leading-relaxed"
                         placeholder="اكتب هنا انطباعك عن العميل، تفضيلاته، أو أي تنبيهات لفريق العمل..."
                         value={metadata.notes}
                         onChange={(e) => setMetadata({...metadata, notes: e.target.value})}
                       />
                    </div>

                    <button 
                      disabled={saving}
                      onClick={handleSaveMetadata}
                      className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black text-sm flex items-center justify-center gap-3 hover:bg-gray-800 transition-all shadow-xl active:scale-95 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                      حفظ تحديثات البروفايل
                    </button>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </AppLayout>
  );
}
