'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Package,
  MapPin,
  User,
  Phone,
  Clock,
  CheckCircle,
  Truck,
  Warehouse,
  ClipboardList,
  XCircle,
  RotateCcw,
  RefreshCw,
  MessageCircle,
  Navigation,
  Star,
  Shield,
  Send,
  ChevronDown,
  AlertCircle,
  Headphones,
  X,
  Download,
  FileText,
  Award,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

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
  subtotal?: number;
  shippingFee?: number;
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

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; border: string; description: string }
> = {
  new: {
    label: 'تم استلام الطلب',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    description: 'تم تسجيل طلبك بنجاح وهو قيد المراجعة',
  },
  preparing: {
    label: 'جاري التجهيز',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    description: 'يتم الآن تجهيز طلبك وتغليفه بعناية',
  },
  warehouse: {
    label: 'في المستودع',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    description: 'طلبك جاهز في المستودع وينتظر المندوب',
  },
  shipping: {
    label: 'في الطريق إليك',
    color: 'text-[hsl(211,67%,28%)]',
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    description: 'المندوب في الطريق لتوصيل طلبك الآن',
  },
  delivered: {
    label: 'تم التسليم',
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-200',
    description: 'تم تسليم طلبك بنجاح. شكراً لثقتك بنا!',
  },
  cancelled: {
    label: 'ملغي',
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    description: 'تم إلغاء هذا الطلب',
  },
  returned: {
    label: 'مرتجع',
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    description: 'تم إرجاع هذا الطلب',
  },
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
    subtotal: 580,
    shippingFee: 70,
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
    subtotal: 820,
    shippingFee: 70,
    status: 'delivered',
    date: '27/03/2026',
    time: '09:15:33',
    delegate: 'علي محمود',
    delegatePhone: '01098765432',
    delegateRating: 4.8,
  },
};

const MOCK_STATUS_HISTORY: Record<
  string,
  { status: string; label: string; time: string; date: string; note: string }[]
> = {
  'ZSH-2026-0047': [
    {
      status: 'new',
      label: 'تم استلام الطلب',
      time: '09:32',
      date: '27/03/2026',
      note: 'تم تسجيل طلبك بنجاح',
    },
    {
      status: 'preparing',
      label: 'جاري التجهيز',
      time: '11:15',
      date: '27/03/2026',
      note: 'يتم تجهيز وتغليف طلبك',
    },
    {
      status: 'warehouse',
      label: 'في المستودع',
      time: '12:40',
      date: '27/03/2026',
      note: 'الطلب جاهز في المستودع',
    },
    {
      status: 'shipping',
      label: 'في الطريق إليك',
      time: '13:40',
      date: '27/03/2026',
      note: 'المندوب في الطريق لتوصيل طلبك',
    },
  ],
  'ZSH-2026-0046': [
    {
      status: 'new',
      label: 'تم استلام الطلب',
      time: '09:15',
      date: '27/03/2026',
      note: 'تم تسجيل طلبك بنجاح',
    },
    {
      status: 'preparing',
      label: 'جاري التجهيز',
      time: '10:30',
      date: '27/03/2026',
      note: 'يتم تجهيز وتغليف طلبك',
    },
    {
      status: 'warehouse',
      label: 'في المستودع',
      time: '11:45',
      date: '27/03/2026',
      note: 'الطلب جاهز في المستودع',
    },
    {
      status: 'shipping',
      label: 'في الطريق إليك',
      time: '12:20',
      date: '27/03/2026',
      note: 'المندوب في الطريق',
    },
    {
      status: 'delivered',
      label: 'تم التسليم',
      time: '14:05',
      date: '27/03/2026',
      note: 'تم تسليم الطلب بنجاح',
    },
  ],
};

// Fallback: all orders from orders management (mock + any that may not be in localStorage)
const ORDERS_MANAGEMENT_MOCK: TrackingOrder[] = [
  {
    orderNum: 'ZSH-2026-0047',
    customer: 'أحمد محمود السيد',
    phone: '01012345678',
    region: 'القاهرة',
    district: 'مدينة نصر',
    address: 'شارع عباس العقاد، عمارة 5 شقة 12',
    products: 'حامل مصحف بني x 2',
    quantity: 2,
    total: 650,
    subtotal: 600,
    shippingFee: 50,
    status: 'shipping',
    date: '27/03/2026',
    time: '09:32:14',
    notes: 'العميل يريد التسليم في الصباح',
    delegate: 'علي محمود',
    delegatePhone: '01098765432',
    delegateRating: 4.8,
  },
  {
    orderNum: 'ZSH-2026-0046',
    customer: 'فاطمة علي حسن',
    phone: '01123456789',
    region: 'الجيزة',
    district: 'الدقي',
    address: 'شارع التحرير، برج المنار ط3',
    products: 'كعبة x 1 + مصحف x 2',
    quantity: 3,
    total: 890,
    subtotal: 840,
    shippingFee: 50,
    status: 'delivered',
    date: '27/03/2026',
    time: '09:15:33',
    delegate: 'علي محمود',
    delegatePhone: '01098765432',
    delegateRating: 4.8,
  },
  {
    orderNum: 'ZSH-2026-0045',
    customer: 'محمد عبد الرحمن',
    phone: '01234567890',
    region: 'القليوبية',
    district: 'شبرا الخيمة',
    address: 'شارع النيل، مبنى رقم 14',
    products: 'حامل مصحف ذهبي x 1',
    quantity: 1,
    total: 380,
    subtotal: 330,
    shippingFee: 50,
    status: 'new',
    date: '27/03/2026',
    time: '08:55:07',
    delegate: 'خالد سعيد',
  },
  {
    orderNum: 'ZSH-2026-0044',
    customer: 'سارة إبراهيم خليل',
    phone: '01056789012',
    region: 'القاهرة',
    district: 'المعادي',
    address: 'شارع 9، فيلا 23',
    products: 'كشاف x 3',
    quantity: 3,
    total: 530,
    subtotal: 450,
    shippingFee: 50,
    status: 'preparing',
    date: '27/03/2026',
    time: '08:40:51',
    delegate: 'علي محمود',
  },
  {
    orderNum: 'ZSH-2026-0043',
    customer: 'عمر حامد الشريف',
    phone: '01198765432',
    region: 'الجيزة',
    district: 'فيصل',
    address: 'شارع البحر الأعظم، عمارة 7',
    products: 'حامل مصحف أسود x 1 + كشاف x 1',
    quantity: 2,
    total: 570,
    subtotal: 470,
    shippingFee: 100,
    status: 'warehouse',
    date: '26/03/2026',
    time: '16:20:44',
    delegate: 'خالد سعيد',
  },
  {
    orderNum: 'ZSH-2026-0042',
    customer: 'نور الدين مصطفى',
    phone: '01067891234',
    region: 'القاهرة',
    district: 'هليوبوليس (مصر الجديدة)',
    address: 'شارع النزهة، شقة 45',
    products: 'كرسي x 2',
    quantity: 2,
    total: 1200,
    subtotal: 1150,
    shippingFee: 50,
    status: 'returned',
    date: '26/03/2026',
    time: '15:50:19',
    notes: 'العميل رفض الاستلام',
    delegate: 'علي محمود',
  },
  {
    orderNum: 'ZSH-2026-0041',
    customer: 'هدى رمضان أحمد',
    phone: '01145678901',
    region: 'القليوبية',
    district: 'قليوب',
    address: 'شارع السكة الحديد، عمارة 2',
    products: 'مصحف x 5',
    quantity: 5,
    total: 750,
    subtotal: 700,
    shippingFee: 50,
    status: 'cancelled',
    date: '26/03/2026',
    time: '14:30:02',
    notes: 'إلغاء بطلب العميل',
    delegate: 'خالد سعيد',
  },
  {
    orderNum: 'ZSH-2026-0040',
    customer: 'خالد عبد العزيز',
    phone: '01012223344',
    region: 'القاهرة',
    district: 'مصر الجديدة',
    address: 'شارع الثورة، عمارة 10',
    products: 'حامل مصحف أبيض x 2 + مصحف x 1',
    quantity: 3,
    total: 810,
    subtotal: 760,
    shippingFee: 50,
    status: 'delivered',
    date: '25/03/2026',
    time: '11:20:38',
    delegate: 'علي محمود',
  },
  {
    orderNum: 'ZSH-2026-0039',
    customer: 'ريم حسام الدين',
    phone: '01534567890',
    region: 'الجيزة',
    district: 'إمبابة',
    address: 'شارع طه حسين، رقم 33',
    products: 'كعبة x 1',
    quantity: 1,
    total: 500,
    subtotal: 450,
    shippingFee: 50,
    status: 'shipping',
    date: '25/03/2026',
    time: '10:05:55',
    delegate: 'خالد سعيد',
  },
  {
    orderNum: 'ZSH-2026-0038',
    customer: 'طارق سعيد منصور',
    phone: '01267891234',
    region: 'القليوبية',
    district: 'الخانكة',
    address: 'شارع المحطة، مبنى 5',
    products: 'حامل مصحف صدف x 1 + كشاف x 1',
    quantity: 2,
    total: 610,
    subtotal: 560,
    shippingFee: 50,
    status: 'preparing',
    date: '25/03/2026',
    time: '09:45:11',
    delegate: 'علي محمود',
  },
];

// ─── Chat Panel (UPDATED - Separate delegate and support chats) ───────────────

interface ChatPanelProps {
  type: 'delegate' | 'support';
  order: TrackingOrder;
  onClose: () => void;
}

function ChatPanel({ type, order, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(true);

  // Load messages from Supabase - FILTERED by chat_type
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('turath_masr_crm_chat')
          .select('*')
          .eq('customer_phone', order.phone)
          .eq('chat_type', type)
          .order('created_at', { ascending: true });
        if (data && data.length > 0) {
          setMessages(data.map((m: any) => ({
            id: m.id || `msg-${m.created_at}`,
            sender: m.sender === 'customer' ? 'customer' : type === 'delegate' ? 'delegate' : 'support',
            text: m.message,
            time: (() => {
              const d = new Date(m.created_at);
              const days = ['\u0627\u0644\u0623\u062d\u062f','\u0627\u0644\u0627\u062b\u0646\u064a\u0646','\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621','\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621','\u0627\u0644\u062e\u0645\u064a\u0633','\u0627\u0644\u062c\u0645\u0639\u0629','\u0627\u0644\u0633\u0628\u062a'];
              return `${d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})} - ${days[d.getDay()]} ${d.toLocaleDateString('en-GB')}`;
            })(),
          })));
        }
      } catch (err) {
        console.error('Error loading chat:', err);
      }
      setLoadingChat(false);
    };
    loadMessages();

    // Subscribe to realtime updates - FILTERED by chat_type
    const supabase = createClient();
    const channel = supabase
      .channel(`chat-track-${type}-${order.phone}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'turath_masr_crm_chat',
        filter: `customer_phone=eq.${order.phone}`,
      }, (payload: any) => {
        const m = payload.new;
        // Only show messages for this chat type
        if (m.chat_type && m.chat_type !== type) return;
        setMessages((prev) => {
          if (prev.some(p => p.id === m.id)) return prev;
          return [...prev, {
            id: m.id || `msg-${m.created_at}`,
            sender: m.sender === 'customer' ? 'customer' : type === 'delegate' ? 'delegate' : 'support',
            text: m.message,
            time: (() => {
              const d = new Date(m.created_at);
              const days = ['\u0627\u0644\u0623\u062d\u062f','\u0627\u0644\u0627\u062b\u0646\u064a\u0646','\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621','\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621','\u0627\u0644\u062e\u0645\u064a\u0633','\u0627\u0644\u062c\u0645\u0639\u0629','\u0627\u0644\u0633\u0628\u062a'];
              return `${d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})} - ${days[d.getDay()]} ${d.toLocaleDateString('en-GB')}`;
            })(),
          }];
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [order.phone, type]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const initialMessages: ChatMessage[] =
    type === 'delegate'
      ? [
          {
            id: 'init-1',
            sender: 'delegate',
            text: `مرحباً ${order.customer}، أنا ${order.delegate || 'المندوب'} وسأقوم بتوصيل طلبك. هل لديك أي استفسار؟`,
            time: order.time || '09:00',
          },
        ]
      : [
          {
            id: 'init-1',
            sender: 'support',
            text: `مرحباً ${order.customer}، كيف يمكنني مساعدتك بخصوص الطلب رقم ${order.orderNum}؟`,
            time: '09:00',
          },
        ];

  const displayMessages = messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const now = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'customer',
      text: input.trim(),
      time: now,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInput('');
    // Save to Supabase with chat_type
    try {
      const supabase = createClient();
      await supabase.from('turath_masr_crm_chat').insert({
        customer_phone: order.phone,
        sender: 'customer',
        message: input.trim(),
        chat_type: type,
      });
    } catch (err) {
      console.error('Error saving chat message:', err);
    }
  };

  const title = type === 'delegate' ? `محادثة مع ${order.delegate || 'المندوب'}` : 'خدمة العملاء';
  const avatarBg = type === 'delegate' ? 'bg-[hsl(211,67%,28%)]' : 'bg-emerald-600';
  const avatarLetter = type === 'delegate' ? order.delegate?.charAt(0) || 'م' : 'خ';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4"
      dir="rtl"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-white w-full sm:max-w-md sm:rounded-2xl flex flex-col shadow-2xl"
        style={{ height: '85vh', maxHeight: '600px' }}
      >
        <div
          className={`flex items-center gap-3 px-4 py-3 ${type === 'delegate' ? 'bg-[hsl(211,67%,28%)]' : 'bg-emerald-600'} sm:rounded-t-2xl`}
        >
          <div
            className={`w-10 h-10 rounded-full ${avatarBg} border-2 border-white/30 flex items-center justify-center text-white font-bold text-lg flex-shrink-0`}
          >
            {avatarLetter}
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">{title}</p>
            <p className="text-white/70 text-xs flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              متصل الآن
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X size={18} className="text-white" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
          {displayMessages.map((msg) => {
            const isCustomer = msg.sender === 'customer';
            return (
              <div key={msg.id} className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 ${isCustomer ? 'bg-white border border-gray-200 text-gray-800' : type === 'delegate' ? 'bg-[hsl(211,67%,28%)] text-white' : 'bg-emerald-600 text-white'}`}
                >
                  <p className="text-sm leading-relaxed">{msg.text}</p>
                  <p
                    className={`text-[10px] mt-1 ${isCustomer ? 'text-gray-400' : 'text-white/60'} text-left`}
                  >
                    {msg.time}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <div className="p-3 border-t border-gray-100 bg-white sm:rounded-b-2xl">
          <div className="flex items-center gap-2">
            <input
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              placeholder="اكتب رسالتك..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
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
    // Load existing chat from Supabase
    const loadChat = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('turath_masr_crm_chat')
          .select('*')
          .eq('customer_phone', order.phone)
          .order('created_at', { ascending: true });
        if (data && data.length > 0) {
          setChatMessages(data.map((m: any) => ({
            id: m.id || `msg-${m.created_at}`,
            sender: m.sender as 'customer' | 'support',
            text: m.message,
            time: (() => {
              const d = new Date(m.created_at);
              const days = ['\u0627\u0644\u0623\u062d\u062f','\u0627\u0644\u0627\u062b\u0646\u064a\u0646','\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621','\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621','\u0627\u0644\u062e\u0645\u064a\u0633','\u0627\u0644\u062c\u0645\u0639\u0629','\u0627\u0644\u0633\u0628\u062a'];
              return `${d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})} - ${days[d.getDay()]} ${d.toLocaleDateString('en-GB')}`;
            })(),
          })));
        }
      } catch {}
    };
    loadChat();

    // Subscribe to realtime
    const supabase = createClient();
    const channel = supabase
      .channel(`complaint-chat-${order.phone}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'turath_masr_crm_chat',
        filter: `customer_phone=eq.${order.phone}`,
      }, (payload: any) => {
        const m = payload.new;
        setChatMessages((prev) => {
          if (prev.some(p => p.id === m.id)) return prev;
          return [...prev, {
            id: m.id || `msg-${m.created_at}`,
            sender: m.sender as 'customer' | 'support',
            text: m.message,
            time: (() => {
              const d = new Date(m.created_at);
              const days = ['\u0627\u0644\u0623\u062d\u062f','\u0627\u0644\u0627\u062b\u0646\u064a\u0646','\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621','\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621','\u0627\u0644\u062e\u0645\u064a\u0633','\u0627\u0644\u062c\u0645\u0639\u0629','\u0627\u0644\u0633\u0628\u062a'];
              return `${d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})} - ${days[d.getDay()]} ${d.toLocaleDateString('en-GB')}`;
            })(),
          }];
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [order.phone]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const submitComplaint = async () => {
    if (!reason) return;
    try {
      const supabase = createClient();
      // Save complaint to Supabase
      const { data: complaintData } = await supabase.from('turath_masr_crm_complaints').insert({
        customer_phone: order.phone,
        subject: reason,
        status: 'open',
        notes: details || null,
        created_by: order.customer || 'عميل',
      }).select().single();

      // Create notification for the team
      await supabase.from('turath_masr_notifications').insert({
        type: 'complaint',
        title: 'شكوى جديدة',
        message: `شكوى من ${order.customer} بخصوص "${reason}" - طلب رقم ${order.orderNum}`,
        order_id: order.orderNum,
        order_num: order.orderNum,
        created_by: order.customer || 'عميل',
      });

      // Also save first chat message to Supabase
      await supabase.from('turath_masr_crm_chat').insert({
        customer_phone: order.phone,
        sender: 'customer',
        message: `شكوى: ${reason}${details ? ' - ' + details : ''} (طلب رقم ${order.orderNum})`,
      });
    } catch (err) {
      console.error('Error saving complaint:', err);
    }

    const initNow = new Date();
    const initDays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const initTimeStr = initNow.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const initDateStr = `${initDays[initNow.getDay()]} ${initNow.toLocaleDateString('en-GB')}`;
    const initMsg: ChatMessage = {
      id: 'init-1',
      sender: 'support',
      text: `تم استلام شكواك بخصوص "${reason}" للطلب رقم ${order.orderNum}. سيتواصل معك أحد ممثلي خدمة العملاء في أقرب وقت. هل تريد إضافة تفاصيل أخرى؟`,
      time: `${initTimeStr} - ${initDateStr}`,
    };
    const msgs = [initMsg];
    setChatMessages(msgs);
    localStorage.setItem(storageKey, JSON.stringify(msgs));
    setSubmitted(true);
    setStep('chat');
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const now = new Date();
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const dateStr = `${days[now.getDay()]} ${now.toLocaleDateString('en-GB')}`;
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'customer',
      text: chatInput.trim(),
      time: `${timeStr} - ${dateStr}`,
    };
    setChatMessages((prev) => [...prev, newMsg]);
    setChatInput('');

    // Save to Supabase
    try {
      const supabase = createClient();
      await supabase.from('turath_masr_crm_chat').insert({
        customer_phone: order.phone,
        sender: 'customer',
        message: chatInput.trim(),
      });
    } catch (err) {
      console.error('Error saving chat message:', err);
    }

    // Replies will come from support via CRM (realtime)
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4"
      dir="rtl"
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative bg-white w-full sm:max-w-md sm:rounded-2xl flex flex-col shadow-2xl"
        style={{ height: step === 'chat' ? '85vh' : 'auto', maxHeight: '600px' }}
      >
        <div className="flex items-center gap-3 px-4 py-3 bg-red-600 sm:rounded-t-2xl">
          <div className="w-10 h-10 rounded-full bg-red-700 border-2 border-white/30 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={20} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="text-white font-bold text-sm">
              {step === 'form' ? 'تقديم شكوى' : 'خدمة العملاء — شكوى'}
            </p>
            <p className="text-white/70 text-xs">{order.orderNum}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X size={18} className="text-white" />
          </button>
        </div>

        {step === 'form' ? (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">سبب الشكوى *</label>
              <div className="grid grid-cols-1 gap-2">
                {COMPLAINT_REASONS.map((r) => (
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
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                تفاصيل إضافية (اختياري)
              </label>
              <textarea
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                placeholder="اكتب تفاصيل الشكوى هنا..."
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
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
            {submitted && (
              <div className="mx-4 mt-3 bg-green-50 border border-green-200 rounded-xl px-3 py-2 flex items-center gap-2">
                <CheckCircle size={14} className="text-green-600 flex-shrink-0" />
                <p className="text-xs text-green-700 font-medium">
                  تم تسجيل شكواك بنجاح — يمكنك الآن التحدث مع خدمة العملاء
                </p>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
              {chatMessages.map((msg) => {
                const isCustomer = msg.sender === 'customer';
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 ${isCustomer ? 'bg-white border border-gray-200 text-gray-800' : 'bg-red-600 text-white'}`}
                    >
                      <p className="text-sm leading-relaxed">{msg.text}</p>
                      <p
                        className={`text-[10px] mt-1 ${isCustomer ? 'text-gray-400' : 'text-white/60'} text-left`}
                      >
                        {msg.time}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <div className="p-3 border-t border-gray-100 bg-white sm:rounded-b-2xl">
              <div className="flex items-center gap-2">
                <input
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                  placeholder="اكتب رسالتك..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
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
    const interval = setInterval(() => setPulse((p) => !p), 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full h-48 rounded-2xl overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 border border-[hsl(var(--border))]">
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#94a3b8" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
      <svg
        className="absolute inset-0 w-full h-full opacity-30 pointer-events-none"
        viewBox="0 0 400 200"
      >
        <path d="M 0 100 Q 100 80 200 100 T 400 100" stroke="#64748b" strokeWidth="4" fill="none" />
        <path d="M 200 0 Q 210 100 200 200" stroke="#64748b" strokeWidth="3" fill="none" />
        <path d="M 0 50 Q 150 60 300 40 T 400 60" stroke="#94a3b8" strokeWidth="2" fill="none" />
        <path d="M 50 200 Q 80 120 100 0" stroke="#94a3b8" strokeWidth="2" fill="none" />
        <path d="M 300 200 Q 320 130 350 0" stroke="#94a3b8" strokeWidth="2" fill="none" />
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
          <div
            className={`w-10 h-10 bg-[hsl(211,67%,28%)] rounded-full flex items-center justify-center shadow-xl border-3 border-white transition-transform duration-500 ${pulse ? 'scale-110' : 'scale-100'}`}
          >
            <Truck size={16} className="text-white" />
          </div>
          <div
            className={`absolute w-14 h-14 rounded-full border-2 border-[hsl(211,67%,28%)] opacity-40 transition-all duration-1000 ${pulse ? 'scale-150 opacity-0' : 'scale-100 opacity-40'}`}
          />
          <div className="mt-1 bg-[hsl(211,67%,28%)] text-xs font-semibold text-white px-2 py-0.5 rounded-full shadow">
            {delegate || 'المندوب'}
          </div>
        </div>
      )}
      {isActive && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 200">
          <path
            d="M 133 67 Q 200 80 267 133"
            stroke="hsl(211,67%,28%)"
            strokeWidth="3"
            fill="none"
            strokeDasharray="8,4"
            opacity="0.6"
          />
        </svg>
      )}
      {!isActive && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100/80 backdrop-blur-sm pointer-events-none">
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
          <span
            className={`w-1.5 h-1.5 rounded-full bg-white ${pulse ? 'opacity-100' : 'opacity-40'} transition-opacity duration-500`}
          />
          مباشر
        </div>
      )}
    </div>
  );
}

function StatusTimeline({
  history,
  currentStatus,
}: {
  history: { status: string; label: string; time: string; date: string; note: string }[];
  currentStatus: string;
}) {
  const isCancelled = currentStatus === 'cancelled';
  const isReturned = currentStatus === 'returned';

  const steps: StatusStep[] = STATUS_FLOW.map((key, idx) => {
    const historyItem = history.find((h) => h.status === key);
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
      timestamp: history[history.length - 1]
        ? `${history[history.length - 1].time} — ${history[history.length - 1].date}`
        : undefined,
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
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300 flex-shrink-0 ${
                  step.active
                    ? 'bg-[hsl(211,67%,28%)] border-[hsl(211,67%,28%)] text-white shadow-lg scale-110'
                    : step.completed
                      ? 'bg-green-500 border-green-500 text-white'
                      : 'bg-white border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
                }`}
              >
                {step.icon}
              </div>
              {!isLast && (
                <div
                  className={`w-0.5 flex-1 my-1 min-h-[2rem] transition-colors duration-300 ${
                    step.completed ? 'bg-green-400' : 'bg-[hsl(var(--border))]'
                  }`}
                />
              )}
            </div>
            <div className={`pb-5 flex-1 ${isLast ? 'pb-0' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`font-semibold text-sm ${
                    step.active
                      ? 'text-[hsl(211,67%,28%)]'
                      : step.completed
                        ? 'text-[hsl(var(--foreground))]'
                        : 'text-[hsl(var(--muted-foreground))]'
                  }`}
                >
                  {step.label}
                </span>
                {step.active && (
                  <span className="text-xs bg-[hsl(211,67%,28%)] text-white px-2 py-0.5 rounded-full font-medium">
                    الحالة الحالية
                  </span>
                )}
              </div>
              {step.timestamp && (
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 flex items-center gap-1">
                  <Clock size={10} />
                  {step.timestamp}
                </p>
              )}
              {step.description && (
                <p className="text-xs text-[hsl(var(--foreground))]/70 mt-1 bg-[hsl(var(--muted))]/30 px-2 py-1 rounded-lg inline-block">
                  {step.description}
                </p>
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
    case 'new':
      return <ClipboardList size={16} />;
    case 'preparing':
      return <Package size={16} />;
    case 'warehouse':
      return <Warehouse size={16} />;
    case 'shipping':
      return <Truck size={16} />;
    case 'delivered':
      return <CheckCircle size={16} />;
    case 'cancelled':
      return <XCircle size={16} />;
    case 'returned':
      return <RotateCcw size={16} />;
    default:
      return <Package size={16} />;
  }
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
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

// ─── Invoice PDF Generator ────────────────────────────────────────────────────
function generateInvoiceHTML(order: TrackingOrder): string {
  const trackingLink = `${typeof window !== 'undefined' ? window.location.origin : 'https://turath_masr.com'}/track/${order.orderNum}`;
  const subtotal = order.subtotal ?? order.total;
  const shippingFee = order.shippingFee ?? 0;

  const productRows =
    order.lines && order.lines.length > 0
      ? order.lines
          .map((line) => {
            const hasImg =
              line.image &&
              (line.image.startsWith('data:') ||
                line.image.startsWith('http') ||
                line.image.startsWith('/'));
            const imgHtml = hasImg
              ? `<img src="${line.image}" alt="${line.label}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" />`
              : `<span style="font-size:24px;">${line.emoji || '📦'}</span>`;
            const noteHtml = line.note
              ? `<br/><span style="font-size:11px;color:#d97706;font-style:italic;">ملاحظة: ${line.note}</span>`
              : '';
            const colorHtml = line.color ? ` (${line.color})` : '';
            const flashHtml = line.includeFlashlight ? ' + كشاف' : '';
            return `<tr>
          <td style="display:flex;align-items:center;gap:10px;padding:10px 12px;">
            ${imgHtml}
            <div><strong>${line.label}${colorHtml}${flashHtml}</strong>${noteHtml}</div>
          </td>
          <td>${line.quantity}</td>
          <td>${line.unitPrice.toLocaleString('en-US')} ج.م</td>
          <td>${line.total.toLocaleString('en-US')} ج.م</td>
        </tr>`;
          })
          .join('')
      : `<tr><td>${order.products}</td><td>${order.quantity}</td><td>—</td><td>${subtotal.toLocaleString('en-US')} ج.م</td></tr>`;

  const warrantyRow =
    order.warranty && order.warranty !== 'بدون ضمان'
      ? `<tr class="warranty-row"><td colspan="3">فترة الضمان</td><td>—</td><td>${order.warranty}</td></tr>`
      : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>فاتورة - ${order.orderNum}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; background: #fff; color: #1a1a1a; }
    .invoice-wrap { max-width: 700px; margin: 0 auto; padding: 20px; }
    .inv-header { background: #1e3a5f; color: white; padding: 24px; text-align: center; border-radius: 12px 12px 0 0; }
    .inv-header h1 { font-size: 26px; font-weight: 800; }
    .inv-header p { font-size: 13px; opacity: 0.8; margin-top: 4px; }
    .inv-body { border: 2px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 24px; }
    .inv-meta { display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 16px; }
    .inv-meta div p:first-child { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
    .inv-meta div p:last-child { font-weight: 700; font-size: 14px; }
    .section-title { font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .customer-info { margin-bottom: 16px; }
    .customer-info p { font-size: 14px; margin-bottom: 4px; }
    .customer-info .name { font-size: 18px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #f3f4f6; padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 700; color: #374151; }
    td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; vertical-align: middle; }
    .total-row { background: #eff6ff; }
    .total-row td { font-weight: 700; font-size: 16px; color: #1e3a5f; }
    .warranty-row { background: #f0fdf4; }
    .warranty-row td { color: #166534; font-weight: 600; }
    .tracking-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px; margin-bottom: 16px; }
    .tracking-box p { font-size: 12px; color: #1e40af; }
    .tracking-box a { font-size: 13px; color: #1d4ed8; font-weight: 700; word-break: break-all; }
    .footer { text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="invoice-wrap">
    <div class="inv-header">
      <h1>Turath Masr</h1>
      <p>فاتورة ضريبية مبسطة</p>
    </div>
    <div class="inv-body">
      <div class="inv-meta">
        <div><p>رقم الفاتورة</p><p>${order.orderNum}</p></div>
        <div><p>تاريخ الإصدار</p><p>${order.date}</p></div>
        <div><p>الوقت</p><p>${order.time}</p></div>
      </div>
      <div class="customer-info">
        <p class="section-title">بيانات العميل</p>
        <p class="name">${order.customer}</p>
        <p>${order.phone}</p>
        <p>${order.region}${order.district ? ' - ' + order.district : ''} — ${order.address}</p>
      </div>
      <div class="tracking-box">
        <p>رابط تتبع الشحنة:</p>
        <a href="${trackingLink}">${trackingLink}</a>
      </div>
      <p class="section-title">المنتجات</p>
      <table>
        <thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
        <tbody>
          ${productRows}
          ${shippingFee > 0 ? `<tr><td>تكلفة الشحن</td><td>—</td><td>—</td><td>${shippingFee.toLocaleString('en-US')} ج.م</td></tr>` : ''}
          ${warrantyRow}
          <tr class="total-row"><td colspan="3"><strong>الإجمالي الكلي</strong></td><td><strong>${order.total.toLocaleString('en-US')} ج.م</strong></td></tr>
        </tbody>
      </table>
      ${order.notes ? `<p style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;font-size:13px;"><strong>ملاحظات:</strong> ${order.notes}</p>` : ''}
      <div class="footer">شكرا لثقتك في Turath Masr — للاستفسار: info@turath_masr.com</div>
    </div>
  </div>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;
}

// ─── Warranty Certificate Generator ──────────────────────────────────────────
function generateWarrantyCertHTML(order: TrackingOrder): string {
  const productNames =
    order.lines && order.lines.length > 0
      ? order.lines
          .map((l) => `${l.label}${l.color ? ` (${l.color})` : ''} × ${l.quantity}`)
          .join('، ')
      : order.products;

  const issueDate = order.date;
  const warrantyPeriod = order.warranty || '6 أشهر';

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>شهادة ضمان - ${order.orderNum}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; background: #f8f9fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .cert-wrap { max-width: 680px; width: 100%; background: white; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.15); }
    .cert-header { background: linear-gradient(135deg, #1e3a5f 0%, #2d5a8e 50%, #1e3a5f 100%); padding: 40px 32px; text-align: center; position: relative; }
    .cert-header::before { content: ''; position: absolute; inset: 0; background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M30 3 L35 20 L53 20 L39 31 L44 48 L30 38 L16 48 L21 31 L7 20 L25 20z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"); }
    .cert-badge { width: 80px; height: 80px; background: rgba(255,255,255,0.15); border: 3px solid rgba(255,255,255,0.4); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 36px; }
    .cert-header h1 { color: white; font-size: 28px; font-weight: 800; letter-spacing: 1px; }
    .cert-header p { color: rgba(255,255,255,0.75); font-size: 14px; margin-top: 6px; }
    .cert-body { padding: 36px 32px; }
    .cert-title { text-align: center; margin-bottom: 28px; }
    .cert-title h2 { font-size: 22px; font-weight: 700; color: #1e3a5f; }
    .cert-title p { color: #6b7280; font-size: 14px; margin-top: 4px; }
    .cert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .cert-field { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; }
    .cert-field label { font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; display: block; margin-bottom: 4px; }
    .cert-field span { font-size: 15px; font-weight: 700; color: #1e293b; }
    .warranty-highlight { background: linear-gradient(135deg, #f0fdf4, #dcfce7); border: 2px solid #86efac; border-radius: 16px; padding: 20px; text-align: center; margin-bottom: 24px; }
    .warranty-highlight .period { font-size: 36px; font-weight: 900; color: #166534; }
    .warranty-highlight .label { font-size: 14px; color: #15803d; margin-top: 4px; }
    .products-box { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .products-box h3 { font-size: 13px; font-weight: 700; color: #1e40af; margin-bottom: 8px; }
    .products-box p { font-size: 14px; color: #1e3a5f; line-height: 1.6; }
    .cert-footer { background: #f8fafc; border-top: 2px dashed #e2e8f0; padding: 20px 32px; text-align: center; }
    .cert-footer p { font-size: 12px; color: #94a3b8; line-height: 1.6; }
    .cert-footer strong { color: #1e3a5f; }
    .seal { display: inline-flex; align-items: center; gap: 8px; background: #1e3a5f; color: white; padding: 8px 20px; border-radius: 50px; font-size: 13px; font-weight: 700; margin-top: 12px; }
    @media print { body { background: white; padding: 0; } .cert-wrap { box-shadow: none; border-radius: 0; } }
  </style>
</head>
<body>
  <div class="cert-wrap">
    <div class="cert-header">
      <div class="cert-badge">🛡️</div>
      <h1>Turath Masr</h1>
      <p>شركة زهران للشحن والتوصيل</p>
    </div>
    <div class="cert-body">
      <div class="cert-title">
        <h2>شهادة ضمان المنتج</h2>
        <p>هذه الشهادة تُثبت حق العميل في الضمان الرسمي</p>
      </div>
      <div class="warranty-highlight">
        <div class="period">${warrantyPeriod}</div>
        <div class="label">مدة الضمان المعتمدة</div>
      </div>
      <div class="cert-grid">
        <div class="cert-field">
          <label>رقم الطلب</label>
          <span>${order.orderNum}</span>
        </div>
        <div class="cert-field">
          <label>تاريخ الإصدار</label>
          <span>${issueDate}</span>
        </div>
        <div class="cert-field">
          <label>اسم العميل</label>
          <span>${order.customer}</span>
        </div>
        <div class="cert-field">
          <label>رقم الهاتف</label>
          <span>${order.phone}</span>
        </div>
      </div>
      <div class="products-box">
        <h3>المنتجات المشمولة بالضمان</h3>
        <p>${productNames}</p>
      </div>
    </div>
    <div class="cert-footer">
      <p>يشمل الضمان عيوب الصناعة والمواد فقط. لا يشمل الكسر أو سوء الاستخدام.</p>
      <p>للتواصل بخصوص الضمان: <strong>info@turath_masr.com</strong></p>
      <div class="seal">✅ شهادة ضمان رسمية معتمدة</div>
    </div>
  </div>
  <script>window.onload = function(){ window.print(); }<\/script>
</body>
</html>`;
}

export default function TrackingPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = React.use(params);
  const [order, setOrder] = useState<TrackingOrder | null>(null);
  const [history, setHistory] = useState<
    { status: string; label: string; time: string; date: string; note: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [activeChat, setActiveChat] = useState<'delegate' | 'support' | null>(null);
  const [showComplaint, setShowComplaint] = useState(false);
  const [liveUpdateFlash, setLiveUpdateFlash] = useState(false);

  const loadOrder = useCallback(
    (silent = false) => {
      if (!silent) setRefreshing(true);
      setTimeout(
        async () => {
          let found: TrackingOrder | null = null;
          let foundHistory: {
            status: string;
            label: string;
            time: string;
            date: string;
            note: string;
          }[] = [];
          try {
            const stored = JSON.parse(localStorage.getItem('turath_masr_orders') || '[]');
            const match = stored.find(
              (o: TrackingOrder & { orderNum: string }) => o.orderNum === orderId
            );
            if (match) {
              found = match as TrackingOrder;
              // Build history from audit logs if available
              try {
                const allAudit = JSON.parse(localStorage.getItem('turath_masr_audit_logs') || '{}');
                const orderAudit = allAudit[match.id] || [];
                if (orderAudit.length > 0) {
                  const statusChanges = orderAudit
                    .filter(
                      (e: {
                        action: string;
                        newStatus?: string;
                        status?: string;
                        timestamp: string;
                        note?: string;
                      }) => e.action === 'status_change' || e.newStatus
                    )
                    .map(
                      (e: {
                        action: string;
                        newStatus?: string;
                        status?: string;
                        timestamp: string;
                        note?: string;
                      }) => {
                        const ts = new Date(e.timestamp);
                        const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                        const time = ts.toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false,
                        });
                        const date = `${days[ts.getDay()]} ${ts.toLocaleDateString('en-GB')}`;
                        const statusKey = e.newStatus || e.status || 'new';
                        return {
                          status: statusKey,
                          label: STATUS_CONFIG[statusKey]?.label || statusKey,
                          time,
                          date,
                          note: e.note || STATUS_CONFIG[statusKey]?.description || '',
                        };
                      }
                    );
                  if (statusChanges.length > 0) foundHistory = statusChanges;
                }
              } catch {}
            }
          } catch {}

          // Always try Supabase for the most up-to-date data
          if (true) {
            try {
              const supabase = createClient();
              const { data } = await supabase
                .from('turath_masr_orders')
                .select('*')
                .eq('order_num', orderId)
                .single();
              if (data) {
                found = {
                  orderNum: data.order_num,
                  customer: data.customer,
                  phone: data.phone,
                  phone2: data.phone2 || undefined,
                  region: data.region,
                  district: data.district || undefined,
                  address: data.address,
                  products: data.products,
                  quantity: data.quantity,
                  total: data.total,
                  subtotal: data.subtotal,
                  shippingFee: data.shipping_fee,
                  status: data.status,
                  date: data.date,
                  time: data.time,
                  notes: data.notes || undefined,
                  warranty: data.warranty || undefined,
                  delegate: data.delegate_name || undefined,
                  lines: data.lines || undefined,
                } as TrackingOrder;
                // Fetch audit logs from Supabase for this order
                try {
                  const { data: auditData } = await supabase
                    .from('turath_masr_audit_logs')
                    .select('*')
                    .eq('order_num', orderId)
                    .order('created_at', { ascending: true });
                  if (auditData && auditData.length > 0) {
                    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
                    foundHistory = auditData
                      .filter((e: any) => e.action === 'status_change' || e.new_value || e.action === 'order_created')
                      .map((e: any) => {
                        const ts = new Date(e.created_at);
                        const time = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                        const date = ts.toLocaleDateString('en-GB');
                        const dayName = days[ts.getDay()];
                        const statusKey = e.new_value || e.action || 'new';
                        return {
                          status: statusKey,
                          label: STATUS_CONFIG[statusKey]?.label || statusKey,
                          time,
                          date: `${dayName} ${date}`,
                          note: e.note || STATUS_CONFIG[statusKey]?.description || '',
                        };
                      });
                  }
                } catch {}
              }
            } catch {
              // Supabase query failed, order not found
            }
          }

          if (found) {
            setOrder((prev) => {
              if (prev && prev.status !== found!.status) {
                setLiveUpdateFlash(true);
                setTimeout(() => setLiveUpdateFlash(false), 3000);
              }
              return found;
            });
            setHistory(foundHistory);
            setNotFound(false);
          } else {
            setNotFound(true);
          }
          setLoading(false);
          setRefreshing(false);
          setLastUpdated(new Date());
        },
        silent ? 0 : 600
      );
    },
    [orderId]
  );

  useEffect(() => {
    loadOrder();
    // Auto-refresh every 10 seconds for near real-time tracking
    const interval = setInterval(() => loadOrder(true), 10000);

    // Listen for instant updates from orders management
    const handleOrdersUpdate = () => loadOrder(true);
    const handleAuditUpdate = () => loadOrder(true);
    window.addEventListener('turath_masr_orders_updated', handleOrdersUpdate);
    window.addEventListener('turath_masr_audit_updated', handleAuditUpdate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('turath_masr_orders_updated', handleOrdersUpdate);
      window.removeEventListener('turath_masr_audit_updated', handleAuditUpdate);
    };
  }, [loadOrder]);

  const handleContactDelegate = () => {
    if (order?.delegatePhone) {
      window.open(`tel:${order.delegatePhone}`, '_self');
    }
  };

  const handleWhatsAppDelegate = () => {
    if (order?.delegatePhone) {
      const msg = encodeURIComponent(
        `مرحباً، أنا ${order?.customer}، أتواصل بخصوص الطلب رقم ${order?.orderNum}`
      );
      window.open(`https://wa.me/2${order.delegatePhone}?text=${msg}`, '_blank');
    }
  };

  const handleDownloadInvoice = () => {
    if (!order) return;
    const win = window.open('', '_blank', 'width=800,height=700');
    if (!win) {
      alert('يرجى السماح بالنوافذ المنبثقة');
      return;
    }
    win.document.write(generateInvoiceHTML(order));
    win.document.close();
  };

  const handleDownloadWarranty = () => {
    if (!order) return;
    const win = window.open('', '_blank', 'width=800,height=700');
    if (!win) {
      alert('يرجى السماح بالنوافذ المنبثقة');
      return;
    }
    win.document.write(generateWarrantyCertHTML(order));
    win.document.close();
  };

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        dir="rtl"
        style={{
          background:
            'linear-gradient(135deg, hsl(25,55%,15%) 0%, hsl(25,50%,25%) 50%, hsl(35,60%,30%) 100%)',
        }}
      >
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern
                id="islamic-bg-load"
                x="0"
                y="0"
                width="80"
                height="80"
                patternUnits="userSpaceOnUse"
              >
                <polygon
                  points="40,5 47,28 70,28 52,43 59,66 40,52 21,66 28,43 10,28 33,28"
                  fill="none"
                  stroke="white"
                  strokeWidth="1.5"
                />
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
      <div
        className="min-h-screen flex items-center justify-center p-4 relative"
        dir="rtl"
        style={{
          background:
            'linear-gradient(135deg, hsl(25,55%,15%) 0%, hsl(25,50%,25%) 50%, hsl(35,60%,30%) 100%)',
        }}
      >
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern
                id="islamic-bg-nf"
                x="0"
                y="0"
                width="80"
                height="80"
                patternUnits="userSpaceOnUse"
              >
                <polygon
                  points="40,5 47,28 70,28 52,43 59,66 40,52 21,66 28,43 10,28 33,28"
                  fill="none"
                  stroke="white"
                  strokeWidth="1.5"
                />
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
          <p className="text-xs text-amber-200/70">
            تأكد من صحة رقم الطلب أو تواصل مع خدمة العملاء
          </p>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const statusConfig = STATUS_CONFIG[order.status] || STATUS_CONFIG['new'];
  const isShipping = order.status === 'shipping';
  const isDelivered = order.status === 'delivered';
  const hasWarranty = order.warranty && order.warranty !== 'بدون ضمان';

  return (
    <div className="min-h-screen relative" dir="rtl">
      {/* Islamic background */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          background:
            'linear-gradient(160deg, hsl(25,55%,12%) 0%, hsl(28,50%,20%) 40%, hsl(35,55%,25%) 70%, hsl(25,45%,18%) 100%)',
        }}
      >
        <div className="absolute inset-0 opacity-[0.07]">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern
                id="islamic-main"
                x="0"
                y="0"
                width="100"
                height="100"
                patternUnits="userSpaceOnUse"
              >
                <polygon
                  points="50,6 58,34 86,34 64,52 72,80 50,63 28,80 28,52 14,34 42,34"
                  fill="none"
                  stroke="white"
                  strokeWidth="1.5"
                />
                <polygon
                  points="50,18 55,34 72,34 59,44 64,60 50,51 36,60 41,44 28,34 45,34"
                  fill="none"
                  stroke="white"
                  strokeWidth="0.8"
                  opacity="0.6"
                />
                <circle cx="50" cy="50" r="3" fill="white" opacity="0.4" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#islamic-main)" />
          </svg>
        </div>
        <div
          className="absolute inset-0 opacity-30"
          style={{
            background:
              'radial-gradient(ellipse at 30% 20%, hsl(35,70%,35%) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, hsl(25,60%,25%) 0%, transparent 60%)',
          }}
        />
      </div>

      {/* Live update flash banner */}
      {liveUpdateFlash && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-green-500 text-white text-center py-2 text-sm font-bold animate-pulse">
          🔄 تم تحديث حالة الشحنة لحظياً!
        </div>
      )}

      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.3) 100%)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <div className="max-w-lg mx-auto px-4 py-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: '1px solid rgba(255,255,255,0.2)',
                }}
              >
                <Truck size={20} className="text-amber-300" />
              </div>
              <div>
                <h1 className="font-bold text-lg leading-tight text-white">تراث مصر</h1>
                <p className="text-amber-300 text-xs">Turath Masr — تتبع شحنتك</p>
              </div>
            </div>
            <button
              onClick={() => loadOrder()}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-amber-200 text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.2)',
              }}
            >
              <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              تحديث
            </button>
          </div>

          <div
            className="rounded-2xl p-4"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            <p className="text-amber-300 text-xs mb-1">رقم الطلب</p>
            <p className="font-mono font-bold text-xl tracking-wide text-white">{order.orderNum}</p>
            <p className="text-amber-200/70 text-xs mt-1">
              {order.date} — {order.time}
            </p>
          </div>
        </div>
      </div>

      {/* Current Status Banner */}
      <div className="max-w-lg mx-auto px-4 mt-4">
        <div
          className={`${statusConfig.bg} ${statusConfig.border} border rounded-2xl p-4 shadow-sm`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center ${statusConfig.bg} border ${statusConfig.border}`}
            >
              {getStepIcon(order.status)}
            </div>
            <div className="flex-1">
              <p className="text-xs text-[hsl(var(--muted-foreground))] mb-0.5">الحالة الحالية</p>
              <p className={`font-bold text-lg ${statusConfig.color}`}>{statusConfig.label}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {statusConfig.description}
              </p>
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
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                الوقت المتوقع للتسليم:
              </span>
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
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                  مندوب توصيل معتمد
                </p>
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
              <User
                size={13}
                className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0"
              />
              <div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">العميل</p>
                <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                  {order.customer}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin
                size={13}
                className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0"
              />
              <div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">عنوان التسليم</p>
                <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                  {order.address}
                </p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {order.district ? `${order.district}، ` : ''}
                  {order.region}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Package
                size={13}
                className="text-[hsl(var(--muted-foreground))] mt-0.5 flex-shrink-0"
              />
              <div className="flex-1">
                <p className="text-xs text-[hsl(var(--muted-foreground))] mb-1.5">المنتجات</p>
                {order.lines && order.lines.length > 0 ? (
                  <div className="space-y-2">
                    {order.lines.map((line, idx) => {
                      const hasImg =
                        line.image &&
                        (line.image.startsWith('data:') ||
                          line.image.startsWith('http') ||
                          line.image.startsWith('/'));
                      return (
                        <div
                          key={`track-line-${idx}`}
                          className="flex items-center gap-3 bg-[hsl(var(--muted))]/30 rounded-xl p-2.5 border border-[hsl(var(--border))]"
                        >
                          <div className="w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-white border border-[hsl(var(--border))] flex items-center justify-center">
                            {hasImg ? (
                              <img
                                src={line.image!}
                                alt={line.label}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-xl">{line.emoji || '📦'}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[hsl(var(--foreground))] leading-tight">
                              {line.label}
                              {line.color ? ` — ${line.color}` : ''}
                              {line.includeFlashlight ? ' + كشاف' : ''}
                            </p>
                            {line.note && (
                              <p className="text-xs text-amber-600 italic mt-0.5">
                                ملاحظة: {line.note}
                              </p>
                            )}
                            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                              {line.quantity} × {line.unitPrice.toLocaleString('en-US')} ج.م
                            </p>
                          </div>
                          <div className="text-left flex-shrink-0">
                            <p className="text-sm font-bold font-mono text-[hsl(211,67%,28%)]">
                              {line.total.toLocaleString('en-US')} ج.م
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    {order.products}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-[hsl(var(--border))]">
              <span className="text-sm text-[hsl(var(--muted-foreground))]">إجمالي الطلب</span>
              <span className="font-bold text-[hsl(211,67%,28%)] text-base">
                {order.total.toLocaleString('en-US')} ج.م
              </span>
            </div>
          </div>
        </div>

        {/* Download Actions — Invoice & Warranty */}
        <div className="bg-white rounded-2xl border border-[hsl(var(--border))] shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <Download size={16} className="text-[hsl(211,67%,28%)]" />
            <h2 className="font-bold text-sm text-[hsl(var(--foreground))]">تحميل المستندات</h2>
          </div>
          <div className="space-y-2.5">
            {/* Invoice Download - always available */}
            <button
              onClick={handleDownloadInvoice}
              className="w-full flex items-center gap-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl px-4 py-3 transition-colors"
            >
              <div className="w-10 h-10 bg-[hsl(211,67%,28%)] rounded-xl flex items-center justify-center flex-shrink-0">
                <FileText size={18} className="text-white" />
              </div>
              <div className="text-right flex-1">
                <p className="text-sm font-bold text-[hsl(211,67%,28%)]">تحميل الفاتورة PDF</p>
                <p className="text-xs text-blue-600">فاتورة ضريبية مبسطة بتفاصيل الطلب</p>
              </div>
              <Download size={16} className="text-blue-500 flex-shrink-0" />
            </button>

            {/* Warranty Certificate - only on delivery */}
            {isDelivered && hasWarranty ? (
              <button
                onClick={handleDownloadWarranty}
                className="w-full flex items-center gap-3 bg-green-50 hover:bg-green-100 border border-green-200 rounded-xl px-4 py-3 transition-colors"
              >
                <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Award size={18} className="text-white" />
                </div>
                <div className="text-right flex-1">
                  <p className="text-sm font-bold text-green-800">تحميل شهادة الضمان</p>
                  <p className="text-xs text-green-600">ضمان {order.warranty} — متاح بعد التسليم</p>
                </div>
                <Download size={16} className="text-green-500 flex-shrink-0" />
              </button>
            ) : hasWarranty && !isDelivered ? (
              <div className="w-full flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 opacity-60 cursor-not-allowed">
                <div className="w-10 h-10 bg-gray-400 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Shield size={18} className="text-white" />
                </div>
                <div className="text-right flex-1">
                  <p className="text-sm font-bold text-gray-600">شهادة الضمان</p>
                  <p className="text-xs text-gray-500">
                    ستتوفر بعد تسليم الطلب — ضمان {order.warranty}
                  </p>
                </div>
                <Clock size={16} className="text-gray-400 flex-shrink-0" />
              </div>
            ) : null}
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

        {/* Warranty info badge */}
        {hasWarranty && (
          <div
            className={`border rounded-2xl p-4 flex items-center gap-3 ${isDelivered ? 'bg-green-50 border-green-200' : 'bg-green-50/60 border-green-200/60'}`}
          >
            <Shield size={20} className="text-green-600 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-green-800">ضمان المنتج</p>
              <p className="text-xs text-green-600">
                {order.warranty}
                {isDelivered ? ' — يمكنك تحميل الشهادة أعلاه' : ' — يبدأ من تاريخ التسليم'}
              </p>
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
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block" />
            <p className="text-xs text-amber-200/70">
              آخر تحديث:{' '}
              {lastUpdated.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
              })}
            </p>
          </div>
          <p className="text-xs text-amber-200/50">يتحدث تلقائياً كل 10 ثوانٍ</p>
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
