'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

// ─── Permission → Route mapping ────────────────────────────────────────────────
const PERMISSION_ROUTE_MAP: Record<string, string[]> = {
  view_dashboard: ['/dashboard'],
  view_orders: ['/orders-management'],
  create_orders: ['/orders-management'],
  edit_orders: ['/orders-management'],
  delete_orders: ['/orders-management'],
  orders_manage: ['/orders-management'],
  update_status: ['/orders-management'],
  view_shipping: ['/shipping'],
  manage_shipping: ['/shipping'],
  assign_courier: ['/shipping'],
  view_delegates: ['/shipping'],
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

// ─── Default role definitions (source of truth for role → permissions mapping) ─
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

export function getPermissionsForRoleId(roleId: string): string[] {
  if (!roleId) return [];
  const role = DEFAULT_ROLES.find((r) => r.id === roleId);
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

// ─── Auth Context Interface ────────────────────────────────────────────────────
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

// ─── Auth Provider ─────────────────────────────────────────────────────────────
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [currentRoleId, setCurrentRoleId] = useState<string | null>(null);
  const [customPermissions, setCustomPermissions] = useState<string[] | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 1: Listen to Supabase auth state changes (login/logout)
  // ═══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setLoading(false);
      setRoleLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (!s?.user) {
        // User logged out - reset ALL role state immediately
        setCurrentRole(null);
        setCurrentRoleId(null);
        setCustomPermissions(null);
        setRoleLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════════
  // STEP 2: When user changes, fetch their role from Supabase profiles
  // This is the ONLY place where role/permissions are determined
  // NO localStorage is used for roles/permissions
  // ═══════════════════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!user) {
      setRoleLoading(false);
      return;
    }

    const syncProfile = async () => {
      setRoleLoading(true);
      try {
        const supabase = createClient();
        if (!supabase) { setRoleLoading(false); return; }

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('role_id, role_name, permissions, full_name')
          .eq('id', user.id)
          .single();

        if (!error && profile) {
          const roleId = profile.role_id || 'r6';
          const roleName = profile.role_name || 'خدمة عملاء';

          setCurrentRoleId(roleId);
          setCurrentRole(roleName);

          // Use custom permissions from Supabase if they exist,
          // otherwise fall back to default role permissions
          const perms = Array.isArray(profile.permissions) ? profile.permissions : [];
          const effectivePerms = perms.length > 0 ? perms : getPermissionsForRoleId(roleId);
          setCustomPermissions(effectivePerms.length > 0 ? effectivePerms : null);
        } else {
          // No profile found - use defaults
          setCurrentRoleId('r6');
          setCurrentRole('خدمة عملاء');
          setCustomPermissions(getPermissionsForRoleId('r6'));
        }
      } catch (err) {
        console.error('Error syncing profile:', err);
        setCurrentRoleId('r6');
        setCurrentRole('خدمة عملاء');
        setCustomPermissions(getPermissionsForRoleId('r6'));
      } finally {
        setRoleLoading(false);
      }
    };

    syncProfile();
  }, [user]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // hasAccess - check if user can access a specific route
  // ═══════════════════════════════════════════════════════════════════════════════
  const hasAccess = (path: string): boolean => {
    if (loading) return true;
    if (!user) return false;
    if (roleLoading) return true;
    if (currentRoleId === 'r1') return true;
    if (!currentRoleId) return false;
    const allowedRoutes = getAllowedRoutes(currentRoleId, customPermissions);
    return allowedRoutes.some(
      (route) => path === route || path.startsWith(route + '/') || path.startsWith(route + '?')
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // signUp - create new user
  // ═══════════════════════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // signIn - login user
  // ═══════════════════════════════════════════════════════════════════════════════
  const signIn = async (email: string, password: string) => {
    const supabase = createClient();
    if (!supabase) throw new Error('Supabase not available');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // signOut - COMPLETE cleanup: React state + localStorage + Supabase
  // ═══════════════════════════════════════════════════════════════════════════════
  const signOut = async () => {
    // 1. Log the session end
    try {
      if (user) {
        const supabase = createClient();
        if (supabase) {
          await supabase.from('turath_masr_sessions').insert({
            user_email: user.email || '—',
            user_name: user.user_metadata?.full_name || '—',
            role_id: currentRoleId || '—',
            role_name: currentRole || '—',
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

    // 2. IMMEDIATELY reset ALL React state
    setUser(null);
    setSession(null);
    setCurrentRole(null);
    setCurrentRoleId(null);
    setCustomPermissions(null);

    // 3. Clear ALL localStorage to prevent ANY stale data
    if (typeof window !== 'undefined') {
      try {
        localStorage.clear();
      } catch {}
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
