'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '../lib/supabase/client';

export type UserRole = 'manager' | 'data_entry' | 'shipping' | 'supervisor' | string;

// Permission → route mapping
const PERMISSION_ROUTE_MAP: Record<string, string[]> = {
  view_dashboard: ['/dashboard'],
  view_orders: ['/orders-management'],
  create_orders: ['/orders-management'],
  edit_orders: ['/orders-management'],
  delete_orders: ['/orders-management'],
  update_status: ['/orders-management'],
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

// All permissions list (full access)
const ALL_PERMISSIONS = Object.keys(PERMISSION_ROUTE_MAP);

// Default roles — always available as fallback when localStorage is empty
const DEFAULT_ROLES: Array<{ id: string; name: string; permissions: string[] }> = [
  { id: 'r1', name: 'مدير النظام', permissions: ALL_PERMISSIONS },
  {
    id: 'r2',
    name: 'مشرف النظام',
    permissions: [
      'view_dashboard',
      'view_orders',
      'edit_orders',
      'update_status',
      'view_shipping',
      'manage_shipping',
      'view_inventory',
      'view_reports',
      'export_reports',
      'manage_users',
    ],
  },
  {
    id: 'r3',
    name: 'مشرف شحن',
    permissions: [
      'view_dashboard',
      'view_orders',
      'create_orders',
      'edit_orders',
      'update_status',
      'view_shipping',
      'manage_shipping',
      'assign_courier',
      'view_inventory',
      'view_reports',
    ],
  },
  { id: 'r4', name: 'مندوب شحن', permissions: ['view_orders', 'update_status', 'view_shipping'] },
  {
    id: 'r5',
    name: 'مدير خدمة عملاء',
    permissions: [
      'view_dashboard',
      'view_orders',
      'view_shipping',
      'view_reports',
      'export_reports',
      'view_customers',
      'manage_customers',
      'customer_support',
    ],
  },
  {
    id: 'r6',
    name: 'خدمة عملاء',
    permissions: ['view_orders', 'view_shipping', 'view_customers', 'customer_support'],
  },
];

// Default redirect per first available permission
const PERMISSION_DEFAULT_ROUTE_PRIORITY = [
  'view_dashboard',
  'view_orders',
  'view_shipping',
  'view_reports',
  'view_inventory',
  'view_customers',
  'manage_users',
  'system_settings',
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

// Load roles from localStorage, merge with defaults
function loadRoles(): Array<{ id: string; name: string; permissions: string[] }> {
  if (typeof window === 'undefined') return DEFAULT_ROLES;
  try {
    const raw = localStorage.getItem('turath_roles');
    if (!raw) return DEFAULT_ROLES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_ROLES;
    // Merge: stored roles take priority, add defaults not in stored
    const storedIds = new Set(parsed.map((r: any) => r.id));
    const merged = [...parsed, ...DEFAULT_ROLES.filter((r) => !storedIds.has(r.id))];
    return merged;
  } catch {
    return DEFAULT_ROLES;
  }
}

// Get permissions for a roleId
export function getPermissionsForRoleId(roleId: string): string[] {
  const roles = loadRoles();
  const role = roles.find((r) => r.id === roleId);
  return role?.permissions ?? [];
}

// Get allowed routes for a roleId or custom permissions
function getAllowedRoutes(roleId: string | null, customPermissions: string[] | null): string[] {
  let permissions: string[] = [];
  
  if (customPermissions && customPermissions.length > 0) {
    permissions = customPermissions;
  } else if (roleId) {
    permissions = getPermissionsForRoleId(roleId);
  }
  const routes = new Set<string>(['/track']); // track always allowed
  for (const perm of permissions) {
    const permRoutes = PERMISSION_ROUTE_MAP[perm] ?? [];
    permRoutes.forEach((r) => routes.add(r));
  }
  return Array.from(routes);
}

function isManagerRole(roleId: string | null, customPermissions: string[] | null): boolean {
  // Only true Admins (r1) should bypass all security
  if (roleId === 'r1') return true;
  
  let permissions: string[] = [];
  if (customPermissions && customPermissions.length > 0) {
    permissions = customPermissions;
  } else if (roleId) {
    permissions = getPermissionsForRoleId(roleId);
  }
  
  return permissions.includes('manage_roles') || permissions.includes('system_settings');
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

  // 1. Initial load from localStorage (for fast UI)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('current_user');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setCurrentRole(parsed.role || null);
          setCurrentRoleId(parsed.roleId || null);
          setCustomPermissions(parsed.customPermissions || null);
        } catch {}
      }
    }
  }, []);

  // 2. Sync with Supabase Session
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) {
      setLoading(false);
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

  // 3. Sync Profile & Permissions from Supabase (Source of Truth)
  useEffect(() => {
    const syncProfile = async () => {
      if (!user) {
        setRoleLoading(false);
        return;
      }

      try {
        const supabase = createClient();
        if (!supabase) return;

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (!error && profile) {
          const perms = profile.permissions || [];
          const roleId = profile.role_id || 'r4'; // Default to shipping if none
          const roleName = profile.role_name || 'موظف';

          setCurrentRole(roleName);
          setCurrentRoleId(roleId);
          setCustomPermissions(perms);

          // Update localStorage to keep it in sync
          const stored = localStorage.getItem('current_user');
          if (stored) {
            const parsed = JSON.parse(stored);
            localStorage.setItem('current_user', JSON.stringify({
              ...parsed,
              role: roleName,
              roleId: roleId,
              customPermissions: perms
            }));
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
    // If loading, block until we know the role
    if (roleLoading) return false;
    
    // If not logged in, no access
    if (!user && !currentRoleId) return false;

    // Manager (r1 or system_settings+manage_roles) has FULL access
    if (isManagerRole(currentRoleId, customPermissions)) return true;

    // Permission-based access
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
    } catch (e) { console.error('Logout session log error:', e); }

    if (typeof window !== 'undefined') {
      localStorage.removeItem('current_user');
    }
    setCurrentRole(null);
    setCurrentRoleId(null);
    setCustomPermissions(null);
    
    const supabase = createClient();
    if (supabase) {
      await supabase.auth.signOut();
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
