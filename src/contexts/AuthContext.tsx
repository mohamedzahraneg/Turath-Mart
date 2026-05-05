'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { createClient, resetSupabaseClient } from '@/lib/supabase/client';
import { clearAppStorage } from '@/lib/auth/storage';
import {
  canAccessPath,
  getDefaultRouteForPermissions,
  getPermissionsForRoleId,
} from '@/lib/permissions/permissions';

// Re-export for backward compatibility — many call-sites import these directly
// from '@/contexts/AuthContext'. The actual implementations live in
// src/lib/permissions/permissions.ts.
export { getDefaultRouteForPermissions, getPermissionsForRoleId };

// Singleton Supabase client - avoids creating new connections on every call
let _supabaseClient: ReturnType<typeof createClient> | null = null;
function getSupabaseClient() {
  if (!_supabaseClient) {
    _supabaseClient = createClient();
  }
  return _supabaseClient;
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
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoading(false);
      setRoleLoading(false);
      return;
    }

    // Get initial session
    supabase.auth
      .getSession()
      .then(({ data: { session: s } }: { data: { session: Session | null } }) => {
        setSession(s);
        setUser(s?.user ?? null);
        setLoading(false);
      });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, s: Session | null) => {
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
        const supabase = getSupabaseClient();
        if (!supabase) {
          setRoleLoading(false);
          return;
        }

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
          let effectivePerms = perms;
          if (effectivePerms.length === 0) {
            // Try to get permissions from turath_roles table in Supabase
            try {
              const { data: roleData } = await supabase
                .from('turath_roles')
                .select('permissions')
                .eq('id', roleId)
                .single();
              if (
                roleData &&
                Array.isArray(roleData.permissions) &&
                roleData.permissions.length > 0
              ) {
                effectivePerms = roleData.permissions;
              }
            } catch {}
          }
          // Final fallback to hardcoded DEFAULT_ROLES
          if (effectivePerms.length === 0) {
            effectivePerms = getPermissionsForRoleId(roleId);
          }
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
  // hasAccess - check if user can access a specific route.
  // Delegates to canAccessPath() in src/lib/permissions for the actual matching
  // logic; this wrapper just adds the loading-state and admin-bypass shortcuts.
  // ═══════════════════════════════════════════════════════════════════════════════
  const hasAccess = (path: string): boolean => {
    if (loading) return true;
    if (!user) return false;
    if (roleLoading) return true;
    if (currentRoleId === 'r1') return true; // admin bypass
    if (!currentRoleId) return false;
    return canAccessPath(path, currentRoleId, customPermissions);
  };

  // ═══════════════════════════════════════════════════════════════════════════════
  // signUp - create new user
  // ═══════════════════════════════════════════════════════════════════════════════
  const signUp = async (email: string, password: string, metadata = {}) => {
    const supabase = getSupabaseClient();
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
    const supabase = getSupabaseClient();
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
        const supabase = getSupabaseClient();
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

    // 3. Sign out from Supabase first (clears its own auth cookies/storage)
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        await supabase.auth.signOut();
        resetSupabaseClient(); // Reset singleton after sign out
      }
    } catch (e) {
      console.error('Supabase signOut error:', e);
    }

    // 4. Clear ONLY app-owned localStorage keys (not the entire localStorage).
    // Supabase keys are handled by supabase.auth.signOut() above.
    clearAppStorage();
  };

  const getCurrentUser = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user;
  };

  const isEmailVerified = () => user?.email_confirmed_at !== null;

  const getUserProfile = async () => {
    if (!user) return null;
    const supabase = getSupabaseClient();
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
