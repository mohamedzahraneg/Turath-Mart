'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '../lib/supabase/client';

export type UserRole = 'manager' | 'data_entry' | 'shipping' | 'supervisor' | string;

const PERMISSION_ROUTE_MAP: Record<string, string[]> = {
  view_dashboard: ['/dashboard'],
  view_orders: ['/orders-management'],
  create_orders: ['/orders-management'],
  edit_orders: ['/orders-management'],
  delete_orders: ['/orders-management'],
  update_status: ['/orders-management'],
  orders_manage: ['/orders-management'],
  view_shipping: ['/shipping'],
  manage_shipping: ['/shipping'],
  assign_courier: ['/shipping'],
  view_inventory: ['/inventory'],
  edit_inventory: ['/inventory'],
  view_reports: ['/reports'],
  export_reports: ['/reports'],
  manage_users: ['/users', '/roles'],
  manage_roles: ['/roles'],
  view_customers: ['/crm'],
  manage_customers: ['/crm'],
  customer_support: ['/crm'],
  system_settings: ['/settings'],
};

const ALL_PERMISSIONS = Object.keys(PERMISSION_ROUTE_MAP);

const DEFAULT_ROLES: Array<{ id: string; name: string; permissions: string[] }> = [
  { id: 'r1', name: 'مدير النظام', permissions: ALL_PERMISSIONS },
  {
    id: 'r2',
    name: 'مشرف النظام',
    permissions: [
      'view_dashboard', 'view_orders', 'edit_orders', 'update_status',
      'view_shipping', 'manage_shipping', 'view_inventory', 'view_reports',
      'export_reports', 'manage_users',
    ],
  },
  {
    id: 'r3',
    name: 'مشرف شحن',
    permissions: [
      'view_dashboard', 'view_orders', 'create_orders', 'edit_orders',
      'update_status', 'view_shipping', 'manage_shipping', 'assign_courier',
      'view_inventory', 'view_reports',
    ],
  },
  { id: 'r4', name: 'مندوب شحن', permissions: ['view_orders', 'update_status', 'view_shipping'] },
  {
    id: 'r5',
    name: 'مدير خدمة عملاء',
    permissions: [
      'view_dashboard', 'view_orders', 'view_shipping', 'view_reports',
      'export_reports', 'view_customers', 'manage_customers', 'customer_support',
    ],
  },
  {
    id: 'r6',
    name: 'خدمة عملاء',
    permissions: ['view_orders', 'view_shipping', 'view_customers', 'customer_support'],
  },
];

const PERMISSION_DEFAULT_ROUTE_PRIORITY = [
  'view_dashboard', 'view_orders', 'view_shipping', 'view_reports',
  'view_inventory', 'view_customers', 'manage_users', 'system_settings',
];

export function getDefaultRouteForPermissions(permissions: string[]): string {
  if (!permissions || permissions.length === 0) return '/shipping';
  for (const perm of PERMISSION_DEFAULT_ROUTE_PRIORITY) {
    if (permissions.includes(perm)) {
      return PERMISSION_ROUTE_MAP[perm]?.[0] ?? '/shipping';
    }
  }
  return '/shipping';
}

function loadRoles(): Array<{ id: string; name: string; permissions: string[] }> {
  // SECURITY FIX: Always use DEFAULT_ROLES from code.
  // Do NOT load from localStorage - roles can be tampered with client-side.
  // Role permissions are defined server-side in DEFAULT_ROLES only.
  return DEFAULT_ROLES;
}

export function getPermissionsForRoleId(roleId: string): string[] {
  if (!roleId) return [];
  const roles = loadRoles();
  const role = roles.find((r) => r.id === roleId);
  return role?.permissions ?? [];
}

function getAllowedRoutes(roleId: string | null, customPermissions: string[] | null): string[] {
  let permissions: string[] = [];
  if (customPermissions && Array.isArray(customPermissions) && customPermissions.length > 0) {
    permissions = customPermissions;
  } else if (roleId) {
    permissions = getPermissionsForRoleId(roleId);
  }
  const routes = new Set<string>(['/track']);
  for (const perm of permissions) {
    const permRoutes = PERMISSION_ROUTE_MAP[perm] ?? [];
    permRoutes.forEach((r) => routes.add(r));
  }
  return Array.from(routes);
}

function isManagerRole(roleId: string | null, customPermissions: string[] | null): boolean {
  // ONLY r1 (مدير النظام) has full unrestricted access
  // All other roles - even if they have manage_roles or system_settings - are restricted to their allowed routes
  return roleId === 'r1';
}

interface AuthContextType {
  user: any;
  session: any;
  loading: boolean;
  roleLoading: boolean;
  currentRole: string | null;
  currentRoleId: string | null;
  customPermissions: string[] | null;
  setCurrentRole: (role: string | null) => void;
  setCurrentRoleId: (roleId: string | null) => void;
  setCustomPermissions: (perms: string[] | null) => void;
  hasAccess: (path: string) => boolean;
  signUp: (email: string, password: string, metadata?: any) => Promise<any>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
  getCurrentUser: () => Promise<any>;
  isEmailVerified: () => boolean;
  getUserProfile: () => Promise<any>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [currentRoleId, setCurrentRoleId] = useState<string | null>(null);
  const [customPermissions, setCustomPermissions] = useState<string[] | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  // 1. Load from localStorage for fast initial render
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('current_user');
        if (stored) {
          const parsed = JSON.parse(stored);
          setCurrentRole(parsed.role || null);
          setCurrentRoleId(parsed.roleId || null);
          // SAFE: always ensure permissions is array or null
          const perms = parsed.customPermissions;
          setCustomPermissions(Array.isArray(perms) ? perms : null);
        }
      } catch {
        // ignore parse errors
      }
    }
  }, []);

  // 2. Sync Supabase session
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setLoading(false);
      setRoleLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 3. Sync profile from Supabase (source of truth)
  useEffect(() => {
    const syncProfile = async () => {
      if (!user) {
        setRoleLoading(false);
        return;
      }

      try {
        const supabase = createClient();
        if (!supabase) {
          setRoleLoading(false);
          return;
        }

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (!error && profile) {
          // SAFE: always ensure permissions is array
          const rawPerms = profile.permissions;
          const perms: string[] = Array.isArray(rawPerms) ? rawPerms : [];

          // Determine role_id: use profile.role_id if exists, else map from role field
          let roleId = profile.role_id || null;
          if (!roleId) {
            if (profile.role === 'admin') roleId = 'r1';
            else if (profile.role === 'supervisor') roleId = 'r2';
            else if (profile.role === 'delegate') roleId = 'r4';
            else roleId = 'r6';
          }

          const roleName = profile.role_name || profile.role || 'موظف';

          // CRITICAL: Reset state first to clear any stale data from previous session
          setCurrentRole(null);
          setCurrentRoleId(null);
          setCustomPermissions(null);

          // Now set the correct values for THIS user
          setCurrentRole(roleName);
          setCurrentRoleId(roleId);
          // If no custom permissions in DB, use role-based permissions
          const effectivePerms = perms.length > 0 ? perms : getPermissionsForRoleId(roleId);
          setCustomPermissions(effectivePerms.length > 0 ? effectivePerms : null);

          // Overwrite localStorage with FRESH data (never merge with stale data)
          // IMPORTANT: include full_name so Sidebar can display user name
          const fullName = profile.full_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || '';
          try {
            localStorage.setItem('current_user', JSON.stringify({
              email: user?.email || '',
              name: fullName,
              role: roleName,
              roleId: roleId,
              customPermissions: effectivePerms.length > 0 ? effectivePerms : null,
            }));
          } catch {
            // ignore storage errors
          }
        }
      } catch (err) {
        console.error('Error syncing profile:', err);
      } finally {
        setRoleLoading(false);
      }
    };

    syncProfile();
  }, [user]);

  const hasAccess = (path: string): boolean => {
    // While loading auth state, allow access to prevent redirect loops
    if (loading) return true;
    // Not logged in at all
    if (!user) return false;
    // While loading role (but user exists), allow access temporarily
    if (roleLoading) return true;
    // r1 = full admin, unrestricted access
    if (currentRoleId === 'r1') return true;
    // No role assigned yet
    if (!currentRoleId) return false;
    // All other roles: check allowed routes based on their permissions
    const allowedRoutes = getAllowedRoutes(currentRoleId, customPermissions);
    return allowedRoutes.some(
      (route) => path === route || path.startsWith(route + '/') || path.startsWith(route + '?')
    );
  };

  const signUp = async (email: string, password: string, metadata = {}) => {
    const supabase = createClient();
    if (!supabase) throw new Error('Supabase not available');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: (metadata as any)?.fullName || '',
          avatar_url: (metadata as any)?.avatarUrl || '',
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) throw error;
    return data;
  };

  const signIn = async (email: string, password: string) => {
    const supabase = createClient();
    if (!supabase) throw new Error('Supabase not available');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    // 1. Log the session end
    try {
      const stored = typeof window !== 'undefined' ? localStorage.getItem('current_user') : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        const supabase = createClient();
        if (supabase) {
          await supabase.from('turath_masr_sessions').insert({
            user_email: parsed.email || '—',
            user_name: parsed.name || '—',
            role_id: parsed.roleId || '—',
            role_name: parsed.role || '—',
            action: 'logout',
            device: '—',
            ip: '—',
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      console.error('Logout session log error:', e);
    }
    // 2. IMMEDIATELY reset ALL React state to prevent stale data leaking to next login
    setUser(null);
    setSession(null);
    setCurrentRole(null);
    setCurrentRoleId(null);
    setCustomPermissions(null);
    // 3. Clear ALL session-related localStorage keys
    if (typeof window !== 'undefined') {
      const SESSION_KEYS = [
        'current_user',
        'turath_employees',
        'turath_app_users',
        'turath_masr_orders',
        'turath_masr_audit_logs',
      ];
      SESSION_KEYS.forEach((key) => {
        try { localStorage.removeItem(key); } catch {}
      });
    }
    // 4. Sign out from Supabase
    try {
      const supabase = createClient();
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (e) {
      console.error('Supabase signOut error:', e);
    }
  };

  const getCurrentUser = async () => {
    const supabase = createClient();
    if (!supabase) return null;
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  };

  const isEmailVerified = () => user?.email_confirmed_at !== null;

  const getUserProfile = async () => {
    if (!user) return null;
    const supabase = createClient();
    if (!supabase) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    return data;
  };

  const value = {
    user,
    session,
    loading,
    roleLoading,
    currentRole,
    currentRoleId,
    customPermissions,
    setCurrentRole,
    setCurrentRoleId,
    setCustomPermissions,
    hasAccess,
    signUp,
    signIn,
    signOut,
    getCurrentUser,
    isEmailVerified,
    getUserProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;
