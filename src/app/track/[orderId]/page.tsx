'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Package, MapPin, User, Phone, Clock, CheckCircle, Truck, Warehouse, ClipboardList, XCircle, RotateCcw, RefreshCw, MessageCircle, Navigation, Star, Shield, Send, ChevronDown, AlertCircle, Headphones, X } from 'lucide-react';

interface TrackingOrder {
  orderNum: string;
  customer: string;
  phone: string;
  region: string;
  district?: string;
  address: string;
  products: string;
  quantity: number;
  total: number;
  status: string;
  date: string;
  time: string;
  notes?: string;
  warranty?: string;
  delegate?: string;
  delegatePhone?: string;
  delegateRating?: number;
  eta?: string;
  deliveryNotes?: string;
  lines?: {
    productType: string;
    label: string;
    image?: string | null;
    emoji?: string;
    color?: string | null;
    quantity: number;
    unitPrice: number;
    includeFlashlight?: boolean;
    flashlightPrice?: number;
    note?: string | null;
    total: number;
  }[];
}

interface StatusStep {
  key: string;
  label: string;
  icon: React.ReactNode;
  description: string;
  timestamp?: string;
  completed: boolean;
  active: boolean;
}

interface ChatMessage {
  id: string;
  sender: 'customer' | 'delegate' | 'support';
  text: string;
  time: string;
}

const STATUS_FLOW = ['new', 'preparing', 'warehouse', 'shipping', 'delivered'];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; description: string }> = {
  new: { label: 'تم استلام الطلب', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200', description: 'تم تسجيل طلبك بنجاح وهو قيد المراجعة' },
  preparing: { label: 'جاري التجهيز', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', description: 'يتم الآن تجهيز طلبك وتغليفه بعناية' },
  warehouse: { label: 'في المستودع', color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200', description: 'طلبك جاهز في المستودع وينتظر المندوب' },
  shipping: { label: 'في الطريق إليك', color: 'text-[hsl(211,67%,28%)]', bg: 'bg-blue-50', border: 'border-blue-300', description: 'المندوب في الطريق لتوصيل طلبك الآن' },
  delivered: { label: 'تم التسليم', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', description: 'تم تسليم طلبك بنجاح. شكراً لثقتك بنا!' },
  cancelled: { label: 'ملغي', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', description: 'تم إلغاء هذا الطلب' },
  returned: { label: 'مرتجع', color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200', description: 'تم إرجاع هذا الطلب' },
};

const COMPLAINT_REASONS = [
  'تأخر التوصيل',
  'المنتج تالف أو مكسور',
  'المنتج لا يطابق الوصف',
  'المندوب غير محترم',
  'خطأ في الطلب (منتج خاطئ)',
  'لم يتم التسليم',
  'مشكلة في الدفع',
  'أخرى',
];

// Mock data
const MOCK_TRACKING_DATA: Record<string, TrackingOrder> = {
  'ZSH-2026-0047': {
    orderNum: 'ZSH-2026-0047',
    customer: 'أحمد محمود السيد',
    phone: '01012345678',
    region: 'القاهرة',
    district: 'مدينة نصر',
    address: 'شارع عباس العقاد، عمارة 5 شقة 12',
    products: 'حامل مصحف بني x 2',
    quantity: 2,
    total: 650,
    status: 'shipping',
    date: '27/03/2026',
    time: '09:32:14',
    notes: 'العميل يريد التسليم في الصباح',
    warranty: '6 أشهر',
    delegate: 'علي محمود',
    delegatePhone: '01098765432',
    delegateRating: 4.8,
    eta: '2:30 م - 4:00 م',
    deliveryNotes: 'سيتصل بك المندوب قبل الوصول بـ 30 دقيقة',
  },
  'ZSH-2026-0046': {
    orderNum: 'ZSH-2026-0046',
    customer: 'فاطمة علي حسن',
    phone: '01123456789',
    region: 'الجيزة',
    district: 'الدقي',
    address: 'شارع التحرير، برج المنار ط3',
    products: 'كعبة x 1 + مصحف x 2',
    quantity: 3,
    total: 890,
    status: 'delivered',
    date: '27/03/2026',
    time: '09:15:33',
    delegate: 'علي محمود',
    delegatePhone: '01098765432',
    delegateRating: 4.8,
  },
};

const MOCK_STATUS_HISTORY: Record<string, { status: string; label: string; time: string; date: string; note: string }[]> = {
  'ZSH-2026-0047': [
    { status: 'new', label: 'تم استلام الطلب', time: '09:32', date: '27/03/2026', note: 'تم تسجيل طلبك بنجاح' },
    { status: 'preparing', label: 'جاري التجهيز', time: '11:15', date: '27/03/2026', note: 'يتم تجهيز وتغليف طلبك' },
    { status: 'warehouse', label: 'في المستودع', time: '12:40', date: '27/03/2026', note: 'الطلب جاهز في المستودع' },
    { status: 'shipping', label: 'في الطريق إليك', time: '13:40', date: '27/03/2026', note: 'المندوب في الطريق لتوصيل طلبك' },
  ],
  'ZSH-2026-0046': [
    { status: 'new', label: 'تم استلام الطلب', time: '09:15', date: '27/03/2026', note: 'تم تسجيل طلبك بنجاح' },
    { status: 'preparing', label: 'جاري التجهيز', time: '10:30', date: '27/03/2026', note: 'يتم تجهيز وتغليف طلبك' },
    { status: 'warehouse', label: 'في المستودع', time: '11:45', date: '27/03/2026', note: 'الطلب جاهز في المستودع' },
    { status: 'shipping', label: 'في الطريق إليك', time: '12:20', date: '27/03/2026', note: 'المندوب في الطريق' },
    { status: 'delivered', label: 'تم التسليم', time: '14:05', date: '27/03/2026', note: 'تم تسليم الطلب بنجاح' },
  ],
};

// ─── Chat Panel ───────────────────────────────────────────────────────────────

interface ChatPanelProps {
  type: 'delegate' | 'support';
  order: TrackingOrder;
  onClose: () => void;
}

function ChatPanel({ type, order, onClose }: ChatPanelProps) {
  const storageKey = `chat_${type}_${order.orderNum}`;
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch { return []; }
  });
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const initialMessages: ChatMessage[] = type === 'delegate'
    ? [{ id: 'init-1', sender: 'delegate', text: `مرحباً ${order.customer}، أنا ${order.delegate || 'المندوب'} وسأقوم بتوصيل طلبك. هل لديك أي استفسار؟`, time: order.time || '09:00' }]
    : [{ id: 'init-1', sender: 'support', text: `مرحباً ${order.customer}، كيف يمكنني مساعدتك بخصوص الطلب رقم ${order.orderNum}؟`, time: '09:00' }];

  const displayMessages = messages.length === 0 ? initialMessages : messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages]);

  const sendMessage = () => {
    if (!input.trim()) return;
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const newMsg: ChatMessage = { id: `msg-${Date.now()}`, sender: 'customer', text: input.trim(), time: now };
    const base = messages.length === 0 ? initialMessages : messages;
    const updated = [...base, newMsg];
    setMessages(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    setInput('');

    // Simulate reply after 1.5s
    setTimeout(() => {
      const replies = type === 'delegate'
        ? ['حسناً، سأكون عندك قريباً إن شاء الله.', 'تمام، سأتصل بك قبل الوصول.', 'فهمت، شكراً لتواصلك.']
        : ['شكراً لتواصلك، سنتابع طلبك فوراً.', 'تم استلام استفسارك وسنرد عليك في أقرب وقت.', 'نعتذر عن أي إزعاج، سنحل المشكلة.'];
      const replyText = replies[Math.floor(Math.random() * replies.length)];
      const replyTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const reply: ChatMessage = { id: `msg-${Date.now()}-r`, sender: type === 'delegate' ? 'delegate' : 'support', text: replyText, time: replyTime };
      setMessages(prev => {
        const next = [...prev, reply];
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    }, 1500);
  };

  const title = type === 'delegate' ? `محادثة مع ${order.delegate || 'المندوب'}` : 'خدمة العملاء';
  const avatarBg = type === 'delegate' ? 'bg-[hsl(211,67%,28%)]' : 'bg-emerald-600';
  const avatarLetter = type === 'delegate' ? (order.delegate?.charAt(0) || 'م') : 'خ';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-2xl flex flex-col shadow-2xl" style={{ height: '85vh', maxHeight: '600px' }}>
        {/* Header */}
        <div className={`flex items-center gap-3 px-4 py-3 ${type === 'delegate' ? 'bg-[hsl(211,67%,28%)]' : 'bg-emerald-600'} sm:rounded-t-2xl`}>
          <div className={`w-10 h-10 rounded-full ${avatarBg} border-2 border-white/30 flex items-center justify-center text-white font-bold text-lg flex-shrink-0`}>
            {avatarLetter}
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">{title}</p>
            <p className="text-white/70 text-xs flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              متصل الآن
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
          {displayMessages.map(msg => {
            const isCustomer = msg.sender === 'customer';
            return (
              <div key={msg.id} className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${isCustomer ? 'bg-white border border-gray-200 text-gray-800' : type === 'delegate' ? 'bg-[hsl(211,67%,28%)] text-white' : 'bg-emerald-600 text-white'}`}>
                  <p className="text-sm leading-relaxed">{msg.text}</p>
                  <p className={`text-[10px] mt-1 ${isCustomer ? 'text-gray-400' : 'text-white/60'} text-left`}>{msg.time}</p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-gray-100 bg-white sm:rounded-b-2xl">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              placeholder="اكتب رسالتك..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 ${input.trim() ? (type === 'delegate' ? 'bg-[hsl(211,67%,28%)] hover:bg-[hsl(211,67%,22%)]' : 'bg-emerald-600 hover:bg-emerald-700') + ' text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Complaint Modal ──────────────────────────────────────────────────────────

interface ComplaintModalProps {
  order: TrackingOrder;
  onClose: () => void;
}

function ComplaintModal({ order, onClose }: ComplaintModalProps) {
  const [step, setStep] = useState<'form' | 'chat'>('form');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const storageKey = `complaint_chat_${order.orderNum}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      setChatMessages(saved);
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const submitComplaint = () => {
    if (!reason) return;
    // Save complaint to localStorage
    try {
      const complaints = JSON.parse(localStorage.getItem('zahranship_crm_complaints') || '{}');
      const phone = order.phone;
      const existing = complaints[phone] || [];
      const newComplaint = {
        id: `comp-${Date.now()}`,
        date: new Date().toLocaleDateString('en-GB'),
        subject: reason,
        status: 'open',
        notes: details,
      };
      complaints[phone] = [newComplaint, ...existing];
      localStorage.setItem('zahranship_crm_complaints', JSON.stringify(complaints));
    } catch {}

    // Initialize support chat
    const initMsg: ChatMessage = {
      id: 'init-1',
      sender: 'support',
      text: `تم استلام شكواك بخصوص "${reason}" للطلب رقم ${order.orderNum}. سيتواصل معك أحد ممثلي خدمة العملاء في أقرب وقت. هل تريد إضافة تفاصيل أخرى؟`,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    };
    const msgs = [initMsg];
    setChatMessages(msgs);
    localStorage.setItem(storageKey, JSON.stringify(msgs));
    setSubmitted(true);
    setStep('chat');
  };

  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const newMsg: ChatMessage = { id: `msg-${Date.now()}`, sender: 'customer', text: chatInput.trim(), time: now };
    const updated = [...chatMessages, newMsg];
    setChatMessages(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    setChatInput('');

    setTimeout(() => {
      const replies = [
        'شكراً لتواصلك، سنتابع شكواك فوراً.',
        'تم تسجيل ملاحظتك وسنعمل على حلها.',
        'نعتذر عن الإزعاج، سيتواصل معك المسؤول قريباً.',
        'تم إرسال شكواك لفريق الدعم المختص.',
      ];
      const replyText = replies[Math.floor(Math.random() * replies.length)];
      const replyTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const reply: ChatMessage = { id: `msg-${Date.now()}-r`, sender: 'support', text: replyText, time: replyTime };
      setChatMessages(prev => {
        const next = [...prev, reply];
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-2xl flex flex-col shadow-2xl" style={{ height: step === 'chat' ? '85vh' : 'auto', maxHeight: '600px' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-red-600 sm:rounded-t-2xl">
          <div className="w-10 h-10 rounded-full bg-red-700 border-2 border-white/30 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">{step === 'form' ? 'تقديم شكوى' : 'خدمة العملاء — شكوى'}</p>
            <p className="text-white/70 text-xs">{order.orderNum}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>

        {step === 'form' ? (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">سبب الشكوى *</label>
              <div className="grid grid-cols-1 gap-2">
                {COMPLAINT_REASONS.map(r => (
                  <button
                    key={r}
                    onClick={() => setReason(r)}
                    className={`text-right px-4 py-2.5 rounded-xl border text-sm transition-all ${reason === r ? 'bg-red-50 border-red-400 text-red-700 font-medium' : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">تفاصيل إضافية (اختياري)</label>
              <textarea
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                placeholder="اكتب تفاصيل الشكوى هنا..."
                rows={3}
                value={details}
                onChange={e => setDetails(e.target.value)}
              />
            </div>
            <button
              onClick={submitComplaint}
              disabled={!reason}
              className={`w-full py-3 rounded-xl text-sm font-bold transition-colors ${reason ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
            >
              إرسال الشكوى والتواصل مع خدمة العملاء
            </button>
          </div>
        ) : (
          <>
            {/* Submitted banner */}
            {submitted && (
              <div className="mx-4 mt-3 bg-green-50 border border-green-200 rounded-xl px-3 py-2 flex items-center gap-2">
                <CheckCircle size={14} className="text-green-600 flex-shrink-0" />
                <p className="text-xs text-green-700 font-medium">تم تسجيل شكواك بنجاح — يمكنك الآن التحدث مع خدمة العملاء</p>
              </div>
            )}
            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {chatMessages.map(msg => {
                const isCustomer = msg.sender === 'customer';
                return (
                  <div key={msg.id} className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3 py-2 ${isCustomer ? 'bg-white border border-gray-200 text-gray-800' : 'bg-red-600 text-white'}`}>
                      <p className="text-sm leading-relaxed">{msg.text}</p>
                      <p className={`text-[10px] mt-1 ${isCustomer ? 'text-gray-400' : 'text-white/60'} text-left`}>{msg.time}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            {/* Input */}
            <div className="p-3 border-t border-gray-100 bg-white sm:rounded-b-2xl">
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  placeholder="اكتب رسالتك..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendChatMessage()}
                />
                <button
                  onClick={sendChatMessage}
                  disabled={!chatInput.trim()}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 ${chatInput.trim() ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LiveLocationMap({ status, delegate }: { status: string; delegate?: string }) {
  const isActive = status === 'shipping';
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setPulse(p => !p), 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full h-48 rounded-2xl overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 border border-[hsl(var(--border))]">
      <div className="absolute inset-0 opacity-20">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#94a3b8" strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
      <svg className="absolute inset-0 w-full h-full opacity-30" viewBox="0 0 400 200">
        <path d="M 0 100 Q 100 80 200 100 T 400 100" stroke="#64748b" strokeWidth="4" fill="none"/>
        <path d="M 200 0 Q 210 100 200 200" stroke="#64748b" strokeWidth="3" fill="none"/>
        <path d="M 0 50 Q 150 60 300 40 T 400 60" stroke="#94a3b8" strokeWidth="2" fill="none"/>
        <path d="M 50 200 Q 80 120 100 0" stroke="#94a3b8" strokeWidth="2" fill="none"/>
        <path d="M 300 200 Q 320 130 350 0" stroke="#94a3b8" strokeWidth="2" fill="none"/>
      </svg>
      <div className="absolute bottom-8 right-1/3 flex flex-col items-center">
        <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shadow-lg border-2 border-white">
          <MapPin size={14} className="text-white" />
        </div>
        <div className="mt-1 bg-white text-xs font-semibold text-green-700 px-2 py-0.5 rounded-full shadow border border-green-200">
          وجهتك
        </div>
      </div>
      {isActive && (
        <div className="absolute top-1/3 left-1/3 flex flex-col items-center">
          <div className={`w-10 h-10 bg-[hsl(211,67%,28%)] rounded-full flex items-center justify-center shadow-xl border-3 border-white transition-transform duration-500 ${pulse ? 'scale-110' : 'scale-100'}`}>
            <Truck size={16} className="text-white" />
          </div>
          <div className={`absolute w-14 h-14 rounded-full border-2 border-[hsl(211,67%,28%)] opacity-40 transition-all duration-1000 ${pulse ? 'scale-150 opacity-0' : 'scale-100 opacity-40'}`} />
          <div className="mt-1 bg-[hsl(211,67%,28%)] text-xs font-semibold text-white px-2 py-0.5 rounded-full shadow">
            {delegate || 'المندوب'}
          </div>
        </div>
      )}
      {isActive && (
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 200">
          <path d="M 133 67 Q 200 80 267 133" stroke="hsl(211,67%,28%)" strokeWidth="3" fill="none" strokeDasharray="8,4" opacity="0.6"/>
        </svg>
      )}
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100/80 backdrop-blur-sm">
          <div className="text-center">
            <Navigation size={32} className="text-slate-400 mx-auto mb-2" />
            <p className="text-sm text-slate-500 font-medium">
              {status === 'delivered' ? 'تم التسليم بنجاح' : 'الموقع الحي متاح عند بدء الشحن'}
            </p>
          </div>
        </div>
      )}
      {isActive && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-lg">
          <span className={`w-1.5 h-1.5 rounded-full bg-white ${pulse ? 'opacity-100' : 'opacity-40'} transition-opacity duration-500`} />
          مباشر
        </div>
      )}
    </div>
  );
}

function StatusTimeline({ history, currentStatus }: { history: { status: string; label: string; time: string; date: string; note: string }[]; currentStatus: string }) {
  const isCancelled = currentStatus === 'cancelled';
  const isReturned = currentStatus === 'returned';

  const steps: StatusStep[] = STATUS_FLOW.map((key, idx) => {
    const historyItem = history.find(h => h.status === key);
    const currentIdx = STATUS_FLOW.indexOf(currentStatus);
    const stepIdx = idx;

    return {
      key,
      label: STATUS_CONFIG[key]?.label || key,
      icon: getStepIcon(key),
      description: historyItem?.note || STATUS_CONFIG[key]?.description || '',
      timestamp: historyItem ? `${historyItem.time} — ${historyItem.date}` : undefined,
      completed: historyItem !== undefined || stepIdx < currentIdx,
      active: key === currentStatus,
    };
  });

  if (isCancelled || isReturned) {
    const specialStep = {
      key: currentStatus,
      label: STATUS_CONFIG[currentStatus]?.label || currentStatus,
      icon: currentStatus === 'cancelled' ? <XCircle size={16} /> : <RotateCcw size={16} />,
      description: STATUS_CONFIG[currentStatus]?.description || '',
      timestamp: history[history.length - 1] ? `${history[history.length - 1].time} — ${history[history.length - 1].date}` : undefined,
      completed: true,
      active: true,
    };
    steps.push(specialStep);
  }

  return (
    <div className="relative">
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        return (
          <div key={step.key} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300 flex-shrink-0 ${
                step.active
                  ? 'bg-[hsl(211,67%,28%)] border-[hsl(211,67%,28%)] text-white shadow-lg scale-110'
                  : step.completed
                  ? 'bg-green-500 border-green-500 text-white' :'bg-white border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
              }`}>
                {step.icon}
              </div>
              {!isLast && (
                <div className={`w-0.5 flex-1 my-1 min-h-[2rem] transition-colors duration-300 ${
                  step.completed ? 'bg-green-400' : 'bg-[hsl(var(--border))]'
                }`} />
              )}
            </div>
            <div className={`pb-5 flex-1 ${isLast ? 'pb-0' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-semibold text-sm ${
                  step.active ? 'text-[hsl(211,67%,28%)]' : step.completed ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]'
                }`}>
                  {step.label}
                </span>
                {step.active && (
                  <span className="text-xs bg-[hsl(211,67%,28%)] text-white px-2 py-0.5 rounded-full font-medium">الحالة الحالية</span>
                )}
              </div>
              {step.timestamp && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 flex items-center gap-1">
                  <Clock size={10} />
                  {step.timestamp}
                </p>
              )}
              {step.description && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{step.description}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function getStepIcon(status: string) {
  switch (status) {
    case 'new': return <ClipboardList size={16} />;
    case 'preparing': return <Package size={16} />;
    case 'warehouse': return <Warehouse size={16} />;
    case 'shipping': return <Truck size={16} />;
    case 'delivered': return <CheckCircle size={16} />;
    case 'cancelled': return <XCircle size={16} />;
    case 'returned': return <RotateCcw size={16} />;
    default: return <Package size={16} />;
  }
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          size={12}
          className={i <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}
        />
      ))}
      <span className="text-xs text-[hsl(var(--muted-foreground))] mr-1">{rating}</span>
    </div>
  );
}

export default function TrackingPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = React.use(params);
  const [order, setOrder] = useState<TrackingOrder | null>(null);
  const [history, setHistory] = useState<{ status: string; label: string; time: string; date: string; note: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [activeChat, setActiveChat] = useState<'delegate' | 'support' | null>(null);
  const [showComplaint, setShowComplaint] = useState(false);

  const loadOrder = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => {
      // First try localStorage orders
      let found: TrackingOrder | null = null;
      let foundHistory: { status: string; label: string; time: string; date: string; note: string }[] = [];
      try {
        const stored = JSON.parse(localStorage.getItem('zahranship_orders') || '[]');
        const match = stored.find((o: TrackingOrder & { orderNum: string }) => o.orderNum === orderId);
        if (match) {
          found = match as TrackingOrder;
        }
      } catch {}

      // Fallback to mock data
      if (!found) {
        found = MOCK_TRACKING_DATA[orderId] || null;
        foundHistory = MOCK_STATUS_HISTORY[orderId] || [];
      }

      if (found) {
        setOrder(found);
        setHistory(foundHistory);
        setNotFound(false);
      } else {
        setNotFound(true);
      }
      setLoading(false);
      setRefreshing(false);
      setLastUpdated(new Date());
    }, 600);
  }, [orderId]);

  useEffect(() => {
    loadOrder();
    const interval = setInterval(loadOrder, 30000);
    return () => clearInterval(interval);
  }, [loadOrder]);

  const handleContactDelegate = () => {
    if (order?.delegatePhone) {
      window.open(`tel:${order.delegatePhone}`, '_self');
    }
  };

  const handleWhatsAppDelegate = () => {
    if (order?.delegatePhone) {
      const msg = encodeURIComponent(`مرحباً، أنا ${order?.customer}، أتواصل بخصوص الطلب رقم ${order?.orderNum}`);
      window.open(`https://wa.me/2${order.delegatePhone}?text=${msg}`, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl"
        style={{ background: 'linear-gradient(135deg, hsl(25,55%,15%) 0%, hsl(25,50%,25%) 50%, hsl(35,60%,30%) 100%)' }}>
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="islamic-bg-load" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
                <polygon points="40,5 47,28 70,28 52,43 59,66 40,52 21,66 28,43 10,28 33,28" fill="none" stroke="white" strokeWidth="1.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#islamic-bg-load)" />
          </svg>
        </div>
        <div className="text-center relative z-10">
          <div className="w-16 h-16 border-4 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-amber-100 font-medium">جاري تحميل بيانات الشحنة...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 relative" dir="rtl"
        style={{ background: 'linear-gradient(135deg, hsl(25,55%,15%) 0%, hsl(25,50%,25%) 50%, hsl(35,60%,30%) 100%)' }}>
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="islamic-bg-nf" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
                <polygon points="40,5 47,28 70,28 52,43 59,66 40,52 21,66 28,43 10,28 33,28" fill="none" stroke="white" strokeWidth="1.5"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#islamic-bg-nf)" />
          </svg>
        </div>
        <div className="text-center max-w-sm relative z-10">
          <div className="w-20 h-20 bg-red-900/40 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-400/30">
            <Package size={36} className="text-red-300" />
          </div>
          <h1 className="text-xl font-bold text-white mb-2">الشحنة غير موجودة</h1>
          <p className="text-amber-200 text-sm mb-1">لم يتم العثور على شحنة برقم:</p>
          <p className="font-mono font-bold text-amber-400 text-lg mb-4">{orderId}</p>
          <p className="text-xs text-amber-200/70">تأكد من صحة رقم الطلب أو تواصل مع خدمة العملاء</p>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG['new'];
  const isShipping = order.status === 'shipping';
  const isDelivered = order.status === 'delivered';

  return (
    <div className="min-h-screen relative" dir="rtl">
      {/* Islamic background */}
      <div className="fixed inset-0 -z-10"
        style={{ background: 'linear-gradient(160deg, hsl(25,55%,12%) 0%, hsl(28,50%,20%) 40%, hsl(35,55%,25%) 70%, hsl(25,45%,18%) 100%)' }}>
        <div className="absolute inset-0 opacity-[0.07]">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="islamic-main" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
                <polygon points="50,6 58,34 86,34 64,52 72,80 50,63 28,80 28,52 14,34 42,34" fill="none" stroke="white" strokeWidth="1.5"/>
                <polygon points="50,18 55,34 72,34 59,44 64,60 50,51 36,60 41,44 28,34 45,34" fill="none" stroke="white" strokeWidth="0.8" opacity="0.6"/>
                <circle cx="50" cy="50" r="3" fill="white" opacity="0.4"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#islamic-main)" />
          </svg>
        </div>
        <div className="absolute inset-0 opacity-30"
          style={{ background: 'radial-gradient(ellipse at 30% 20%, hsl(35,70%,35%) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, hsl(25,60%,25%) 0%, transparent 60%)' }} />
      </div>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="max-w-lg mx-auto px-4 py-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)' }}>
                <Truck size={20} className="text-amber-300" />
              </div>
              <div>
                <h1 className="font-bold text-lg leading-tight text-white">تراث مارت</h1>
                <p className="text-amber-300 text-xs">Turath Mart — تتبع شحنتك</p>
              </div>
            </div>
            <button
              onClick={loadOrder}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-amber-200 text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)' }}
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              تحديث
            </button>
          </div>

          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)' }}>
            <p className="text-amber-300 text-xs mb-1">رقم الطلب</p>
            <p className="font-mono font-bold text-xl tracking-wide text-white">{order.orderNum}</p>
            <p className="text-amber-200/70 text-xs mt-1">{order.date} — {order.time}</p>
          </div>
        </div>
      </div>

      {/* Current Status Banner */}
      <div className="max-w-lg mx-auto px-4 mt-4">
        <div className={`${statusConfig.bg} ${statusConfig.border} border rounded-2xl p-4 shadow-sm`}>
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${statusConfig.bg} border ${statusConfig.border}`}>
              {getStepIcon(order.status)}
            </div>
            <div className="flex-1">
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-0.5">الحالة الحالية</p>
              <p className={`font-bold text-lg ${statusConfig.color}`}>{statusConfig.label}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{statusConfig.description}</p>
            </div>
            {isShipping && (
              <div className="flex flex-col items-center">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse mb-1" />
                <span className="text-xs text-green-600 font-medium">مباشر</span>
              </div>
            )}
          </div>
          {order.eta && isShipping && (
            <div className="mt-3 pt-3 border-t border-current/10 flex items-center gap-2">
              <Clock size={14} className={statusConfig.color} />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">الوقت المتوقع للتسليم:</span>
              <span className={`text-sm font-bold ${statusConfig.color}`}>{order.eta}</span>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">

        {/* Live Location Map */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-[hsl(211,67%,28%)]" />
              <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">الموقع الحي</h2>
            </div>
            {isShipping && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse inline-block" />
                يتحدث تلقائياً
              </span>
            )}
          </div>
          <div className="px-4 pb-4">
            <LiveLocationMap status={order.status} delegate={order.delegate} />
            {isShipping && order.deliveryNotes && (
              <div className="mt-3 flex items-start gap-2 bg-blue-50 rounded-xl p-3 border border-blue-100">
                <Navigation size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-700">{order.deliveryNotes}</p>
              </div>
            )}
          </div>
        </div>

        {/* Assigned Delegate */}
        {order.delegate && (
          <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3">
              <User size={16} className="text-[hsl(211,67%,28%)]" />
              <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">المندوب المعين</h2>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-[hsl(211,67%,28%)] to-[hsl(211,67%,40%)] rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                {order.delegate.charAt(0)}
              </div>
              <div className="flex-1">
                <p className="font-bold text-[hsl(var(--foreground))]">{order.delegate}</p>
                {order.delegateRating && <StarRating rating={order.delegateRating} />}
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">مندوب توصيل معتمد</p>
              </div>
              {order.delegatePhone && !isDelivered && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleContactDelegate}
                    className="w-9 h-9 bg-[hsl(211,67%,28%)] text-white rounded-xl flex items-center justify-center hover:bg-[hsl(211,67%,22%)] transition-colors"
                    title="اتصال"
                  >
                    <Phone size={14} />
                  </button>
                  <button
                    onClick={handleWhatsAppDelegate}
                    className="w-9 h-9 bg-green-500 text-white rounded-xl flex items-center justify-center hover:bg-green-600 transition-colors"
                    title="واتساب"
                  >
                    <MessageCircle size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Chat with delegate button */}
            {!isDelivered && order.delegate && (
              <button
                onClick={() => setActiveChat('delegate')}
                className="mt-3 w-full flex items-center justify-center gap-2 bg-[hsl(211,67%,28%)]/10 hover:bg-[hsl(211,67%,28%)]/20 text-[hsl(211,67%,28%)] border border-[hsl(211,67%,28%)]/20 rounded-xl py-2.5 text-sm font-medium transition-colors"
              >
                <MessageCircle size={16} />
                محادثة مع المندوب
              </button>
            )}
          </div>
        )}

        {/* Order Status Timeline */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList size={16} className="text-[hsl(211,67%,28%)]" />
            <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">مراحل الشحنة</h2>
          </div>
          <StatusTimeline history={history} currentStatus={order.status} />
        </div>

        {/* Order Details */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package size={16} className="text-[hsl(211,67%,28%)]" />
            <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">تفاصيل الطلب</h2>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-start gap-2">
              <User size={13} className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">العميل</p>
                <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{order.customer}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin size={13} className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">عنوان التسليم</p>
                <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{order.address}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{order.district ? `${order.district}، ` : ''}{order.region}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Package size={13} className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">المنتجات</p>
                {order.lines && order.lines.length > 0 ? (
                  <div className="space-y-2">
                    {order.lines.map((line, idx) => {
                      const hasImg = line.image && (line.image.startsWith('data:') || line.image.startsWith('http') || line.image.startsWith('/'));
                      return (
                        <div key={`track-line-${idx}`} className="flex items-center gap-3 bg-[hsl(var(--muted))]/30 rounded-xl p-2.5 border border-[hsl(var(--border))]">
                          <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-white border border-[hsl(var(--border))] flex items-center justify-center">
                            {hasImg ? (
                              <img src={line.image!} alt={line.label} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xl">{line.emoji || '📦'}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[hsl(var(--foreground))] leading-tight">
                              {line.label}{line.color ? ` — ${line.color}` : ''}{line.includeFlashlight ? ' + كشاف' : ''}
                            </p>
                            {line.note && (
                              <p className="text-xs text-amber-600 italic mt-0.5">ملاحظة: {line.note}</p>
                            )}
                            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                              {line.quantity} × {line.unitPrice.toLocaleString('en-US')} ج.م
                            </p>
                          </div>
                          <div className="text-left flex-shrink-0">
                            <p className="text-sm font-bold font-mono text-[hsl(211,67%,28%)]">{line.total.toLocaleString('en-US')} ج.م</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{order.products}</p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-[hsl(var(--border))]">
              <span className="text-sm text-[hsl(var(--muted-foreground))]">إجمالي الطلب</span>
              <span className="font-bold text-[hsl(211,67%,28%)] text-base">{order.total.toLocaleString('en-US')} ج.م</span>
            </div>
          </div>
        </div>

        {/* Delivery Notes */}
        {order.notes && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList size={14} className="text-amber-600" />
              <h2 className="font-bold text-sm text-amber-800">ملاحظات التوصيل</h2>
            </div>
            <p className="text-sm text-amber-700">{order.notes}</p>
          </div>
        )}

        {/* Warranty */}
        {order.warranty && order.warranty !== 'بدون ضمان' && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-3">
            <Shield size={20} className="text-green-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-green-800">ضمان المنتج</p>
              <p className="text-xs text-green-600">{order.warranty}</p>
            </div>
          </div>
        )}

        {/* Support & Complaint Actions */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Headphones size={16} className="text-emerald-600" />
            <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">الدعم والمساعدة</h2>
          </div>
          <button
            onClick={() => setActiveChat('support')}
            className="w-full flex items-center gap-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl px-4 py-3 transition-colors"
          >
            <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <Headphones size={16} className="text-white" />
            </div>
            <div className="text-right flex-1">
              <p className="text-sm font-bold text-emerald-800">تحدث مع خدمة العملاء</p>
              <p className="text-xs text-emerald-600">متاح 24/7 للرد على استفساراتك</p>
            </div>
            <ChevronDown size={16} className="text-emerald-500 -rotate-90" />
          </button>
          <button
            onClick={() => setShowComplaint(true)}
            className="w-full flex items-center gap-3 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl px-4 py-3 transition-colors"
          >
            <div className="w-9 h-9 bg-red-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertCircle size={16} className="text-white" />
            </div>
            <div className="text-right flex-1">
              <p className="text-sm font-bold text-red-800">تقديم شكوى</p>
              <p className="text-xs text-red-600">اختر سبب الشكوى وتواصل مع الدعم</p>
            </div>
            <ChevronDown size={16} className="text-red-500 -rotate-90" />
          </button>
        </div>

        {/* Last updated */}
        <div className="text-center pb-6">
          <p className="text-xs text-amber-200/60">
            آخر تحديث: {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
          </p>
          <p className="text-xs text-amber-200/50 mt-1">يتحدث تلقائياً كل 30 ثانية</p>
        </div>
      </div>

      {/* Chat Panels */}
      {activeChat && order && (
        <ChatPanel type={activeChat} order={order} onClose={() => setActiveChat(null)} />
      )}
      {showComplaint && order && (
        <ComplaintModal order={order} onClose={() => setShowComplaint(false)} />
      )}
    </div>
  );
}
