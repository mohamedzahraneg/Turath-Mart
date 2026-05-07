'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Notification {
  id: string;
  type: 'new_order' | 'status_change' | 'inventory_alert' | 'whatsapp_sent' | string;
  title: string;
  message: string;
  order_id?: string;
  order_num?: string;
  is_read: boolean;
  created_by?: string;
  created_at: string;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  newOrdersCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Phase 18: gate all network/realtime activity on the authenticated
  // user. The previous implementation mounted realtime channels and
  // fetched notifications on EVERY page load — including
  // /sign-up-login-screen — which contributed to the stale-token
  // refresh storm: the realtime client tried to authenticate with
  // whatever JWT happened to be in the auth cookie, and on any
  // 401/expired path it would reconnect in a loop, each cycle
  // triggering supabase-js to attempt a /token?grant_type=refresh_token
  // request. Tying these effects to `user` means:
  //   - on the login page (no user) we open zero channels and make
  //     zero RLS-gated SELECTs.
  //   - on logout, the cleanup branch of the effect removes the
  //     channels before signOut clears the JWT.
  //   - after a successful sign-in, `user` flips truthy and the
  //     subscriptions/fetches start naturally.
  const { user } = useAuth();

  const supabase = createClient();

  const fetchNewOrdersCount = useCallback(async () => {
    try {
      const { count, error } = await supabase
        .from('turath_masr_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new');

      if (!error) {
        setNewOrdersCount(count || 0);
      }
    } catch (err) {
      console.error('Error fetching new orders count:', err);
    }
  }, [supabase]);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('turath_masr_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        setNotifications(data as Notification[]);
        setUnreadCount((data as Notification[]).filter((n) => !n.is_read).length);
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchNotifications(), fetchNewOrdersCount()]);
  }, [fetchNotifications, fetchNewOrdersCount]);

  useEffect(() => {
    // Phase 18: skip fetches and realtime when there's no user. Reset
    // state so a fresh login doesn't render stale counts from a
    // previous session, and so the loading flag goes false (otherwise
    // a logged-out shell can show a permanent loading spinner).
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setNewOrdersCount(0);
      setLoading(false);
      return;
    }

    refresh();

    // 1. Listen for new notifications
    const notifSubscription = supabase
      .channel('public:turath_masr_notifications')
      .on(
        'postgres_changes',
        { event: '*', table: 'turath_masr_notifications', schema: 'public' },
        () => {
          fetchNotifications();
        }
      )
      .subscribe();

    // 2. Listen for order changes (to update "new" orders count)
    const orderSubscription = supabase
      .channel('public:turath_masr_orders_badges')
      .on('postgres_changes', { event: '*', table: 'turath_masr_orders', schema: 'public' }, () => {
        fetchNewOrdersCount();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(notifSubscription);
      supabase.removeChannel(orderSubscription);
    };
  }, [user, supabase, refresh, fetchNotifications, fetchNewOrdersCount]);

  const markAsRead = async (id: string) => {
    try {
      const { error } = await supabase
        .from('turath_masr_notifications')
        .update({ is_read: true })
        .eq('id', id);

      if (!error) {
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const { error } = await supabase
        .from('turath_masr_notifications')
        .update({ is_read: true })
        .eq('is_read', false);

      if (!error) {
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('Error marking all as read:', err);
    }
  };

  const clearAll = async () => {
    try {
      const { error } = await supabase
        .from('turath_masr_notifications')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

      if (!error) {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('Error clearing notifications:', err);
    }
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        newOrdersCount,
        loading,
        markAsRead,
        markAllAsRead,
        clearAll,
        refresh,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};
