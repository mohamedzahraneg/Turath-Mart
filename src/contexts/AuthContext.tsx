'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { Session, AuthChangeEvent } from '@supabase/supabase-js';
import { createClient, resetSupabaseClient } from '@/lib/supabase/client';
import { clearAppStorage } from '@/lib/auth/storage';
import { isAuthRoute } from '@/lib/auth/routes';
import {
  canAccessPath,
  getDefaultRouteForPermissions,
  getPermissionsForRoleId,
} from '@/lib/permissions/permissions';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 20D-Fix1 — Profile/role cache.
//
// Every signed-in page used to pay a 1-2 query tax on mount + on every
// onAuthStateChange tick (token refresh ~hourly emits a TOKEN_REFRESHED
// event which flips the user object reference and re-fires syncProfile).
// At the EG → eu-central-2 latency floor (~700-1000 ms / Supabase request),
// that's ~2 seconds before any page-specific code runs.
//
// Strategy:
//  • Module-scope memory cache for instant hits across SPA navigation
//    (providers don't unmount, but the cache also survives Strict Mode
//    double-invoke in dev).
//  • sessionStorage backup so the cache survives hard refresh + new
//    tab. Keyed by user.id so multi-account switches invalidate naturally.
//  • TTL: 5 minutes. Role changes in the DB take up to 5 min to
//    propagate to the in-page state — that's an acceptable trade-off
//    for the perf win since admin role changes are rare.
//  • Invalidated explicitly on signOut and on profile-fetch error
//    (so a stale role doesn't get stuck if the API was misbehaving).
// ─────────────────────────────────────────────────────────────────────────────

const PROFILE_CACHE_KEY = 'tm.auth.profile.v1';
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;

type ProfileCacheEntry = {
  userId: string;
  roleId: string;
  roleName: string;
  permissions: string[] | null;
  // Phase 20D-Fix2: also persist the user's display name from
  // `profiles.full_name` so consumers (e.g. Sidebar) can read it from
  // the cache instead of firing their own `from('profiles')` query on
  // every page mount. Old v1 cache entries without this field continue
  // to work — readers fall back to user_metadata.full_name when null.
  profileFullName: string | null;
  expiresAt: number;
};

let _profileMemCache: ProfileCacheEntry | null = null;

function readProfileCache(userId: string): ProfileCacheEntry | null {
  const now = Date.now();
  if (_profileMemCache && _profileMemCache.userId === userId && _profileMemCache.expiresAt > now) {
    return _profileMemCache;
  }
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileCacheEntry;
    if (parsed.userId !== userId || parsed.expiresAt <= now) {
      window.sessionStorage.removeItem(PROFILE_CACHE_KEY);
      return null;
    }
    _profileMemCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeProfileCache(entry: ProfileCacheEntry) {
  _profileMemCache = entry;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage unavailable / quota — memory cache still works.
  }
}

function clearProfileCache() {
  _profileMemCache = null;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    // ignore
  }
}

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
  // Phase 20D-Fix2: cached display name from profiles.full_name. Lets
  // consumers like Sidebar render the user's name without firing their
  // own `from('profiles')` query.
  profileFullName: string | null;
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
  const [profileFullName, setProfileFullName] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  // Phase 20D-Fix1: gate provider effects on the auth route. When a
  // user lands on /sign-up-login-screen with a stale cookie session,
  // supabase getSession briefly returns a session before signOut
  // clears it; without this gate we'd fire syncProfile against the
  // dying session and add a wasted ~1-second Supabase round-trip to
  // the login page mount.
  const pathname = usePathname();
  const onAuthRoute = isAuthRoute(pathname || '');

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
        setProfileFullName(null);
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

    // Phase 20D-Fix1: skip syncProfile while on the login route. If the
    // cookie still holds a stale session, middleware would already have
    // redirected an authed user away from this page; a transient `user`
    // here is a logout-in-progress and shouldn't trigger a network call.
    if (onAuthRoute) {
      setRoleLoading(false);
      return;
    }

    // Phase 20D-Fix1: serve from cache if same user.id and not expired.
    // The two profile/role queries are by far the most frequent
    // provider-level cost — caching them turns hard-refresh + token
    // refresh from "two ~1-second Supabase round-trips" into "instant".
    const cached = readProfileCache(user.id);
    if (cached) {
      setCurrentRoleId(cached.roleId);
      setCurrentRole(cached.roleName);
      setCustomPermissions(cached.permissions);
      // Phase 20D-Fix2: profileFullName may be missing on old (v1) cache
      // entries — fall back to null so consumers use user_metadata.
      setProfileFullName(cached.profileFullName ?? null);
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
          const finalPerms = effectivePerms.length > 0 ? effectivePerms : null;
          setCustomPermissions(finalPerms);
          // Phase 20D-Fix2: also derive + persist the display name.
          const fullName = profile.full_name || null;
          setProfileFullName(fullName);
          // Phase 20D-Fix1/Fix2: write cache only on the success path.
          writeProfileCache({
            userId: user.id,
            roleId,
            roleName,
            permissions: finalPerms,
            profileFullName: fullName,
            expiresAt: Date.now() + PROFILE_CACHE_TTL_MS,
          });
        } else {
          // No profile found - use defaults. Don't cache the default
          // fallback: a transient auth/RLS error here shouldn't pin a
          // user to r6 for 5 minutes.
          setCurrentRoleId('r6');
          setCurrentRole('خدمة عملاء');
          setCustomPermissions(getPermissionsForRoleId('r6'));
          setProfileFullName(null);
          clearProfileCache();
        }
      } catch (err) {
        console.error('Error syncing profile:', err);
        setCurrentRoleId('r6');
        setCurrentRole('خدمة عملاء');
        setCustomPermissions(getPermissionsForRoleId('r6'));
        setProfileFullName(null);
        // Phase 20D-Fix1: on error, drop any stale cache so we retry
        // fresh on the next mount/event rather than serving the old
        // (possibly wrong) role.
        clearProfileCache();
      } finally {
        setRoleLoading(false);
      }
    };

    syncProfile();
  }, [user, onAuthRoute]);

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
          // Phase 17: include user_id (auth.users uuid). Required by the
          // sessions_own_insert RLS policy
          //   WITH CHECK (user_id = auth.uid())
          // — without it, the insert silently fails under RLS and the
          // logout event is never logged. This is also the column we
          // want populated for traceability/joins to auth.users.
          await supabase.from('turath_masr_sessions').insert({
            user_id: user.id,
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
    setProfileFullName(null);

    // Phase 20D-Fix1: drop the profile cache so the next signed-in
    // user (different account, or same user re-signing in) starts
    // fresh rather than getting the old role for up to 5 minutes.
    clearProfileCache();

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
    profileFullName,
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
