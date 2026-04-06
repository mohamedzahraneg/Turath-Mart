'use client';

import React from 'react';
import Link from 'next/link';
import {
  Bell,
  Check,
  Trash2,
  Package,
  RefreshCw,
  AlertTriangle,
  MessageSquare,
  X,
  ExternalLink,
} from 'lucide-react';
import { useNotifications, Notification } from '@/contexts/NotificationContext';

interface Props {
  onClose: () => void;
}

const NOTIF_ICON_MAP: Record<string, any> = {
  new_order: { icon: <Package className="text-blue-600" size={18} />, bg: 'bg-blue-100' },
  status_change: { icon: <RefreshCw className="text-purple-600" size={18} />, bg: 'bg-purple-100' },
  inventory_alert: {
    icon: <AlertTriangle className="text-amber-600" size={18} />,
    bg: 'bg-amber-100',
  },
  whatsapp_sent: {
    icon: <MessageSquare className="text-green-600" size={18} />,
    bg: 'bg-green-100',
  },
};

function formatRelativeTime(iso: string) {
  const now = new Date();
  const then = new Date(iso);
  const diffInSecs = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (diffInSecs < 60) return 'الآن';
  if (diffInSecs < 3600) return `منذ ${Math.floor(diffInSecs / 60)} دقيقة`;
  if (diffInSecs < 86400) return `منذ ${Math.floor(diffInSecs / 3600)} ساعة`;
  return then.toLocaleDateString('en-US', { day: '2-digit', month: '2-digit' });
}

export default function NotificationDropdown({ onClose }: Props) {
  const { notifications, markAsRead, markAllAsRead, clearAll, loading, unreadCount } =
    useNotifications();

  return (
    <div
      className="absolute bottom-full mb-2 right-0 w-[320px] bg-white rounded-3xl shadow-modal border border-[hsl(var(--border))] flex flex-col overflow-hidden fade-in-up z-[100]"
      dir="rtl"
    >
      {/* Header */}
      <div className="p-4 border-b border-[hsl(var(--border))] flex items-center justify-between bg-[hsl(var(--muted))]/30">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-bold">الإشعارات</h3>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="p-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] transition-colors"
              title="تحديد الكل كمقروء"
            >
              <Check size={16} />
            </button>
          )}
          <button
            onClick={clearAll}
            className="p-1.5 text-[hsl(var(--muted-foreground))] hover:text-red-500 transition-colors"
            title="مسح الكل"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-[hsl(var(--muted-foreground))] hover:bg-gray-100 rounded-lg transition-colors ms-1"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto max-h-[400px] scrollbar-thin">
        {loading ? (
          <div className="p-10 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-[hsl(var(--primary))] border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-xs text-[hsl(var(--muted-foreground))] font-semibold">
              جاري تحميل الإشعارات...
            </p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-12 h-12 bg-[hsl(var(--muted))] rounded-2xl flex items-center justify-center mx-auto">
              <Bell size={24} className="text-[hsl(var(--muted-foreground))] opacity-50" />
            </div>
            <p className="text-xs text-[hsl(var(--muted-foreground))] font-semibold">
              لا توجد إشعارات حتى الآن
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[hsl(var(--border))]">
            {notifications.map((notif) => {
              const cfg = NOTIF_ICON_MAP[notif.type] || {
                icon: <Bell className="text-gray-600" size={18} />,
                bg: 'bg-gray-100',
              };
              return (
                <div
                  key={notif.id}
                  className={`p-4 hover:bg-[hsl(var(--muted))]/30 transition-colors relative group ${!notif.is_read ? 'bg-[hsl(var(--primary))]/5' : ''}`}
                  onClick={() => !notif.is_read && markAsRead(notif.id)}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}
                    >
                      {cfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p
                          className={`text-xs font-bold truncate ${!notif.is_read ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]'}`}
                        >
                          {notif.title}
                        </p>
                        <span className="text-[10px] text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                          {formatRelativeTime(notif.created_at)}
                        </span>
                      </div>
                      <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed line-clamp-2">
                        {notif.message}
                      </p>
                      {notif.order_num && (
                        <Link
                          href="/orders-management"
                          className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-[hsl(var(--primary))] hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                          }}
                        >
                          <ExternalLink size={10} />
                          عرض الأوردر {notif.order_num}
                        </Link>
                      )}
                    </div>
                    {!notif.is_read && (
                      <div className="w-2 h-2 rounded-full bg-[hsl(var(--primary))] mt-1.5" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-[hsl(var(--border))] text-center bg-[hsl(var(--muted))]/10">
        <Link
          href="/settings"
          onClick={onClose}
          className="text-xs font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] transition-colors"
        >
          إعدادات الإشعارات
        </Link>
      </div>
    </div>
  );
}
