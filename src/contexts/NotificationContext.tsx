'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { isAuthRoute } from '@/lib/auth/routes';

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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 20D-Fix1 — Notifications cache.
//
// Every page mount used to fire two Supabase queries (the count badge +
// the recent notifications list). At ~1s/round-trip from EG, that's a
// 2-second tax on every signed-in page. Realtime subscriptions still
// keep state fresh; the cache only short-circuits the *initial* fetch
// when we just had it a moment ago (e.g., a hard refresh, a tab swap,
// or a Strict-Mode double-mount in dev).
//
// Strategy:
//  • Module-scope memory cache for instant hits.
//  • sessionStorage backup so the cache survives hard refresh + new
//    tab. Keyed by user.id so multi-account switches invalidate.
//  • TTL: 60 seconds. The cache only suppresses re-fetches; realtime
//    inserts/updates still flow into state via the existing
//    postgres_changes subscriptions, so visible freshness is unchanged.
//  • Invalidated on logout (user → null).
// ─────────────────────────────────────────────────────────────────────────────

const NOTIF_CACHE_KEY = 'tm.notif.v1';
const NOTIF_CACHE_TTL_MS = 60 * 1000;

type NotifCacheEntry = {
  userId: string;
  notifications: Notification[];
  unreadCount: number;
  newOrdersCount: number;
  expiresAt: number;
};

let _notifMemCache: NotifCacheEntry | null = null;

function readNotifCache(userId: string): NotifCacheEntry | null {
  const now = Date.now();
  if (_notifMemCache && _notifMemCache.userId === userId && _notifMemCache.expiresAt > now) {
    return _notifMemCache;
  }
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(NOTIF_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NotifCacheEntry;
    if (parsed.userId !== userId || parsed.expiresAt <= now) {
      window.sessionStorage.removeItem(NOTIF_CACHE_KEY);
      return null;
    }
    _notifMemCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeNotifCache(entry: NotifCacheEntry) {
  _notifMemCache = entry;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(NOTIF_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore quota / private mode
  }
}

function clearNotifCache() {
  _notifMemCache = null;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(NOTIF_CACHE_KEY);
  } catch {
    // ignore
  }
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

  // Phase 20D-Fix1: also gate on the auth route so a transient
  // stale-session `user` on /sign-up-login-screen doesn't fire
  // notifications/count queries while signOut is mid-flight.
  const pathname = usePathname();
  const onAuthRoute = isAuthRoute(pathname || '');

  const supabase = createClient();

  // Phase 20D-Fix1: each fetcher writes the cache with the value it
  // just computed and pulls the other field from the existing cache
  // entry (if any) — avoiding the React async-state pitfall.
  const fetchNewOrdersCount = useCallback(async () => {
    try {
      const { count, error } = await supabase
        .from('turath_masr_orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new');

      if (!error) {
        const newCount = count || 0;
        setNewOrdersCount(newCount);
        if (user) {
          const existing =
            _notifMemCache && _notifMemCache.userId === user.id ? _notifMemCache : null;
          writeNotifCache({
            userId: user.id,
            notifications: existing?.notifications ?? [],
            unreadCount: existing?.unreadCount ?? 0,
            newOrdersCount: newCount,
            expiresAt: Date.now() + NOTIF_CACHE_TTL_MS,
          });
        }
      }
    } catch (err) {
      console.error('Error fetching new orders count:', err);
    }
  }, [supabase, user]);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('turath_masr_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!error && data) {
        const notifs = data as Notification[];
        const unread = notifs.filter((n) => !n.is_read).length;
        setNotifications(notifs);
        setUnreadCount(unread);
        if (user) {
          const existing =
            _notifMemCache && _notifMemCache.userId === user.id ? _notifMemCache : null;
          writeNotifCache({
            userId: user.id,
            notifications: notifs,
            unreadCount: unread,
            newOrdersCount: existing?.newOrdersCount ?? 0,
            expiresAt: Date.now() + NOTIF_CACHE_TTL_MS,
          });
        }
      }
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, user]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchNotifications(), fetchNewOrdersCount()]);
  }, [fetchNotifications, fetchNewOrdersCount]);

  useEffect(() => {
    // Phase 18: skip fetches and realtime when there's no user. Reset
    // state so a fresh login doesn't render stale counts from a
    // previous session, and so the loading flag goes false (otherwise
    // a logged-out shell can show a permanent loading spinner).
    //
    // Phase 20D-Fix1: also drop the cache when user goes null so the
    // next signed-in account starts clean.
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setNewOrdersCount(0);
      setLoading(false);
      clearNotifCache();
      return;
    }

    // Phase 20D-Fix1: skip on the login route. Even if `user` flips
    // truthy briefly during a logout-in-progress, the page is about to
    // be replaced by middleware redirect — no point firing queries or
    // opening realtime channels for it.
    if (onAuthRoute) return;

    // Phase 20D-Fix1: serve from cache if same user.id and not expired.
    // We still subscribe to realtime below so any insert/update/delete
    // arriving via postgres_changes flows into state and refreshes the
    // cache on top.
    const cached = readNotifCache(user.id);
    if (cached) {
      setNotifications(cached.notifications);
      setUnreadCount(cached.unreadCount);
      setNewOrdersCount(cached.newOrdersCount);
      setLoading(false);
    } else {
      refresh();
    }

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
  }, [user, onAuthRoute, supabase, refresh, fetchNotifications, fetchNewOrdersCount]);

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
