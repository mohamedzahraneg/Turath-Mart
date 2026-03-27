'use client';
import React, { useState, useEffect, useCallback } from 'react';
import {
  Truck, CheckCircle, Clock, Package, XCircle, RotateCcw,
  Wifi, MapPin, TrendingUp, DollarSign, Users, Activity,
  ChevronDown, RefreshCw, Zap, AlertCircle
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface LiveOrder {
  id: string;
  orderNum: string;
  customer: string;
  region: string;
  products: string;
  total: number;
  status: string;
  delegateName: string;
  time: string;
  updatedAt: Date;
}

interface AgentInfo {
  name: string;
  activeOrders: number;
  deliveredOrders: number;
  totalValue: number;
  status: 'active' | 'idle';
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode; pulse?: boolean }> = {
  new: { label: 'جديد', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', icon: <Package size={12} /> },
  preparing: { label: 'جاري التجهيز', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', icon: <Clock size={12} />, pulse: true },
  warehouse: { label: 'في المستودع', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200', icon: <Package size={12} /> },
  shipping: { label: 'جاري الشحن', color: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200', icon: <Truck size={12} />, pulse: true },
  delivered: { label: 'تم التسليم', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', icon: <CheckCircle size={12} /> },
  cancelled: { label: 'ملغي', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: <XCircle size={12} /> },
  returned: { label: 'مرتجع', color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200', icon: <RotateCcw size={12} /> },
};

// Fixed map positions for up to 8 delegates (distributed across the map area)
const DELEGATE_POSITIONS = [
  { top: '30%', left: '55%' },
  { top: '60%', left: '35%' },
  { top: '25%', left: '72%' },
  { top: '55%', left: '65%' },
  { top: '40%', left: '25%' },
  { top: '70%', left: '55%' },
  { top: '20%', left: '42%' },
  { top: '75%', left: '75%' },
];

function timeAgo(date: Date | null): string {
  if (!date) return '';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `منذ ${diff} ث`;
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
  return `منذ ${Math.floor(diff / 3600)} س`;
}

export default function LiveOrdersDashboard() {
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [isLive, setIsLive] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    try {
      const supabase = createClient();
      const today = new Date();
      const todayStr = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()}`;

      const { data, error } = await supabase
        .from('zahranship_orders')
        .select('id, order_num, customer, region, products, total, status, delegate_name, time, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      if (data) {
        const mapped: LiveOrder[] = data.map((row) => ({
          id: row.id,
          orderNum: row.order_num,
          customer: row.customer,
          region: row.region,
          products: row.products,
          total: row.total,
          status: row.status,
          delegateName: row.delegate_name || 'غير محدد',
          time: row.time || '',
          updatedAt: new Date(row.created_at),
        }));
        setOrders(mapped);
      }
      setLastUpdate(new Date());
    } catch {
      // fallback: try localStorage
      try {
        const saved = JSON.parse(localStorage.getItem('zahranship_orders') || '[]');
        const mapped: LiveOrder[] = saved.map((row: any) => ({
          id: row.id,
          orderNum: row.orderNum,
          customer: row.customer,
          region: row.region,
          products: row.products,
          total: row.total,
          status: row.status,
          delegateName: row.delegateName || 'غير محدد',
          time: row.time || '',
          updatedAt: new Date(),
        }));
        setOrders(mapped);
        setLastUpdate(new Date());
      } catch {
        setOrders([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    loadOrders();
  }, [loadOrders]);

  // Auto-refresh every 30 seconds when live
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(loadOrders, 30000);
    return () => clearInterval(interval);
  }, [isLive, loadOrders]);

  // Tick every second for timeAgo display
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen for order updates from other components
  useEffect(() => {
    const handleUpdate = () => loadOrders();
    window.addEventListener('zahranship_orders_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('zahranship_orders_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [loadOrders]);

  // Computed live stats from real data
  const todayStr = (() => {
    const d = new Date();
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
  })();

  const deliveredToday = orders.filter(o => o.status === 'delivered').length;
  const shippingNow = orders.filter(o => o.status === 'shipping').length;

  // Build real agent info from orders
  const agentMap = new Map<string, AgentInfo>();
  orders.forEach(o => {
    if (!o.delegateName || o.delegateName === 'غير محدد') return;
    if (!agentMap.has(o.delegateName)) {
      agentMap.set(o.delegateName, { name: o.delegateName, activeOrders: 0, deliveredOrders: 0, totalValue: 0, status: 'idle' });
    }
    const agent = agentMap.get(o.delegateName)!;
    if (['shipping', 'preparing', 'warehouse'].includes(o.status)) {
      agent.activeOrders++;
      agent.status = 'active';
    }
    if (o.status === 'delivered') {
      agent.deliveredOrders++;
    }
    if (['shipping', 'delivered'].includes(o.status)) {
      agent.totalValue += o.total;
    }
  });
  const agentList = Array.from(agentMap.values());
  const activeAgents = agentList.filter(a => a.status === 'active').length;

  const collectionTotal = orders
    .filter(o => o.status === 'delivered')
    .reduce((sum, o) => sum + o.total, 0);
  const pendingCollection = orders
    .filter(o => ['shipping', 'warehouse', 'preparing'].includes(o.status))
    .reduce((sum, o) => sum + o.total, 0);

  // Status counts
  const statusCounts = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1;
    return acc;
  }, {});

  const collectionPercent = collectionTotal + pendingCollection > 0
    ? Math.round((collectionTotal / (collectionTotal + pendingCollection)) * 100)
    : 0;

  return (
    <div className="card-section overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))] cursor-pointer hover:bg-[hsl(var(--muted))]/20 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            <Zap size={15} className="text-[hsl(var(--primary))]" />
            <span className="text-sm font-bold text-[hsl(var(--foreground))]">لوحة المتابعة اللحظية</span>
          </div>
          {isLive && (
            <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold border border-green-200">
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-[hsl(var(--muted-foreground))]">
            آخر تحديث: {lastUpdate && mounted ? timeAgo(lastUpdate) : ''}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!isLive) { loadOrders(); }
              setIsLive(!isLive);
            }}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-semibold transition-all border ${isLive ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}
          >
            {isLive ? <Wifi size={12} /> : <RefreshCw size={12} />}
            {isLive ? 'متصل' : 'تحديث'}
          </button>
          <ChevronDown size={16} className={`text-[hsl(var(--muted-foreground))] transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </div>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-4 fade-in">

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-8 gap-3">
              <div className="w-5 h-5 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-[hsl(var(--muted-foreground))]">جاري تحميل البيانات...</span>
            </div>
          )}

          {!loading && (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Delivered Today */}
                <div className="relative bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-3 overflow-hidden">
                  <div className="absolute top-2 left-2 opacity-10">
                    <CheckCircle size={40} className="text-green-600" />
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <CheckCircle size={13} className="text-green-600" />
                    <p className="text-[11px] font-semibold text-green-700">تم التسليم</p>
                  </div>
                  <p className="text-2xl font-bold font-mono text-green-800">{deliveredToday}</p>
                  <p className="text-[10px] text-green-600 mt-0.5">اوردر مكتمل</p>
                </div>

                {/* Shipping Now */}
                <div className="relative bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-3 overflow-hidden">
                  <div className="absolute top-2 left-2 opacity-10">
                    <Truck size={40} className="text-indigo-600" />
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Truck size={13} className="text-indigo-600" />
                    <p className="text-[11px] font-semibold text-indigo-700">جاري الشحن الآن</p>
                  </div>
                  <p className="text-2xl font-bold font-mono text-indigo-800">{shippingNow}</p>
                  <p className="text-[10px] text-indigo-600 mt-0.5">اوردر في الطريق</p>
                </div>

                {/* Active Agents */}
                <div className="relative bg-gradient-to-br from-purple-50 to-violet-50 border border-purple-200 rounded-xl p-3 overflow-hidden">
                  <div className="absolute top-2 left-2 opacity-10">
                    <Users size={40} className="text-purple-600" />
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Users size={13} className="text-purple-600" />
                    <p className="text-[11px] font-semibold text-purple-700">مندوبين نشطين</p>
                  </div>
                  <p className="text-2xl font-bold font-mono text-purple-800">{activeAgents}</p>
                  <p className="text-[10px] text-purple-600 mt-0.5">من {agentList.length} مندوبين</p>
                </div>

                {/* Collection Total */}
                <div className="relative bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 rounded-xl p-3 overflow-hidden">
                  <div className="absolute top-2 left-2 opacity-10">
                    <DollarSign size={40} className="text-amber-600" />
                  </div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <DollarSign size={13} className="text-amber-600" />
                    <p className="text-[11px] font-semibold text-amber-700">إجمالي التحصيل</p>
                  </div>
                  <p className="text-xl font-bold font-mono text-amber-800">{collectionTotal.toLocaleString('en-US')}</p>
                  <p className="text-[10px] text-amber-600 mt-0.5">ج.م محصّل • {pendingCollection.toLocaleString('en-US')} ج.م متوقع</p>
                </div>
              </div>

              {/* Status Distribution Bar */}
              <div className="bg-[hsl(var(--muted))]/30 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Activity size={13} className="text-[hsl(var(--primary))]" />
                    <span className="text-xs font-bold text-[hsl(var(--foreground))]">توزيع الحالات</span>
                  </div>
                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{orders.length} أوردر إجمالي</span>
                </div>
                {orders.length === 0 ? (
                  <div className="flex items-center gap-2 py-2">
                    <AlertCircle size={14} className="text-[hsl(var(--muted-foreground))]" />
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">لا توجد أوردرات بعد</span>
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                      const count = statusCounts[key] || 0;
                      if (count === 0) return null;
                      return (
                        <div key={key} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                          {cfg.icon}
                          <span>{cfg.label}</span>
                          <span className="font-mono font-bold">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Live Order Cards */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Package size={13} className="text-[hsl(var(--primary))]" />
                    <span className="text-xs font-bold text-[hsl(var(--foreground))]">بطاقات الأوردرات اللحظية</span>
                    <span className="text-[10px] text-[hsl(var(--muted-foreground))] mr-auto">آخر {Math.min(orders.length, 10)} أوردر</span>
                  </div>
                  <div className="space-y-2 max-h-[320px] overflow-y-auto scrollbar-thin pr-1">
                    {orders.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 gap-2 bg-[hsl(var(--muted))]/20 rounded-xl border border-dashed border-[hsl(var(--border))]">
                        <Package size={28} className="text-[hsl(var(--muted-foreground))] opacity-40" />
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">لا توجد أوردرات حتى الآن</p>
                      </div>
                    ) : (
                      orders.slice(0, 10).map(order => {
                        const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG['new'];
                        return (
                          <div
                            key={order.id}
                            className={`border rounded-xl p-3 transition-all duration-300 ${cfg.bg} ${cfg.border}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-mono text-xs font-bold text-[hsl(var(--primary))]">{order.orderNum}</span>
                                </div>
                                <p className="text-xs font-semibold text-[hsl(var(--foreground))] truncate">{order.customer}</p>
                                <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate">{order.products}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                                    <MapPin size={9} className="inline ml-0.5" />{order.region}
                                  </span>
                                  {order.delegateName && order.delegateName !== 'غير محدد' && (
                                    <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                                      <Truck size={9} className="inline ml-0.5" />{order.delegateName}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1.5 shrink-0">
                                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${cfg.bg} ${cfg.border} ${cfg.color}`}>
                                  {cfg.pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                                  {cfg.icon}
                                  <span>{cfg.label}</span>
                                </div>
                                <span className="font-mono text-xs font-bold text-[hsl(var(--foreground))]">{order.total.toLocaleString('en-US')} ج.م</span>
                                <span className="text-[9px] text-[hsl(var(--muted-foreground))]">{order.time}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Active Agents Map */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin size={13} className="text-[hsl(var(--primary))]" />
                    <span className="text-xs font-bold text-[hsl(var(--foreground))]">خريطة المندوبين النشطين</span>
                  </div>
                  {/* Stylized map with agent pins */}
                  <div className="relative bg-gradient-to-br from-blue-50 via-teal-50 to-green-50 border border-[hsl(var(--border))] rounded-xl overflow-hidden" style={{ height: '200px' }}>
                    {/* Grid lines for map feel */}
                    <svg className="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
                          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#1e3a5f" strokeWidth="0.5" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#grid)" />
                    </svg>
                    {/* Road lines */}
                    <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
                      <line x1="0" y1="100" x2="400" y2="100" stroke="#1e3a5f" strokeWidth="2" strokeDasharray="8,4" />
                      <line x1="200" y1="0" x2="200" y2="200" stroke="#1e3a5f" strokeWidth="2" strokeDasharray="8,4" />
                      <line x1="0" y1="50" x2="400" y2="150" stroke="#1e3a5f" strokeWidth="1" strokeDasharray="5,5" />
                    </svg>
                    {/* Map label */}
                    <div className="absolute top-2 right-2 bg-white/80 backdrop-blur-sm rounded-lg px-2 py-1 text-[10px] font-semibold text-[hsl(var(--foreground))] border border-[hsl(var(--border))]">
                      خريطة المندوبين
                    </div>

                    {agentList.length === 0 ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <Users size={28} className="text-[hsl(var(--muted-foreground))] opacity-30" />
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">لا يوجد مندوبون نشطون</p>
                      </div>
                    ) : (
                      agentList.slice(0, 8).map((agent, i) => {
                        const pos = DELEGATE_POSITIONS[i] || { top: '50%', left: '50%' };
                        return (
                          <div
                            key={agent.name}
                            className="absolute transform -translate-x-1/2 -translate-y-1/2 group"
                            style={pos}
                          >
                            {/* Pulse ring for active agents */}
                            {agent.status === 'active' && (
                              <div className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-40 scale-150" />
                            )}
                            {/* Pin */}
                            <div className={`relative w-8 h-8 rounded-full border-2 flex items-center justify-center shadow-md cursor-pointer transition-transform hover:scale-110 ${agent.status === 'active' ? 'bg-green-500 border-green-600' : 'bg-gray-400 border-gray-500'}`}>
                              <Truck size={14} className="text-white" />
                            </div>
                            {/* Tooltip */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white border border-[hsl(var(--border))] rounded-lg px-2 py-1.5 shadow-lg text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                              <p className="font-bold text-[hsl(var(--foreground))]">{agent.name}</p>
                              <p className="text-[hsl(var(--muted-foreground))]">{agent.activeOrders} أوردر نشط</p>
                              <p className="text-[hsl(var(--muted-foreground))]">{agent.deliveredOrders} تم تسليمه</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Agent list below map */}
                  <div className="mt-2 space-y-1.5">
                    {agentList.length === 0 ? (
                      <p className="text-xs text-[hsl(var(--muted-foreground))] text-center py-2">لا توجد بيانات مندوبين</p>
                    ) : (
                      agentList.map(agent => (
                        <div key={agent.name} className="flex items-center justify-between bg-[hsl(var(--muted))]/30 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${agent.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                            <span className="text-xs font-semibold">{agent.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] text-[hsl(var(--muted-foreground))]">{agent.totalValue.toLocaleString('en-US')} ج.م</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${agent.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                              {agent.activeOrders} نشط
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700">
                              {agent.deliveredOrders} مسلّم
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Collection Progress — Real Data */}
              <div className="bg-gradient-to-r from-[hsl(var(--primary))]/5 to-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/20 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={14} className="text-[hsl(var(--primary))]" />
                    <span className="text-xs font-bold text-[hsl(var(--foreground))]">تقدم التحصيل</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-[hsl(var(--primary))]">
                    {collectionTotal.toLocaleString('en-US')} / {(collectionTotal + pendingCollection).toLocaleString('en-US')} ج.م
                  </span>
                </div>
                <div className="w-full bg-[hsl(var(--muted))] rounded-full h-2.5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[hsl(var(--primary))] to-green-500 rounded-full transition-all duration-1000"
                    style={{ width: `${collectionPercent}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-[10px] text-green-600 font-semibold">✓ محصّل: {collectionTotal.toLocaleString('en-US')} ج.م ({collectionPercent}%)</span>
                  <span className="text-[10px] text-amber-600 font-semibold">⏳ متوقع: {pendingCollection.toLocaleString('en-US')} ج.م</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
