import {
  AdminProfile,
  AdminAuthState,
  AdminDashboardStats,
  RecitationSubmission,
  Reciter,
  Recitation,
  Announcement,
  Competition,
  RewardDefinition,
  ReciterHonor,
  AdminNotification,
  SubmissionStatus
} from '../types';
import { SUPABASE_CONFIG, SupabaseService } from './SupabaseService';
import { userService } from './UserService';
import { transformRecitationUrl, TransformUrlOptions } from '../utils/audioUrlTemplate';

export interface AdminAuthDiagnostic {
  authHttpStatus?: number;
  profileHttpStatus?: number;
  authenticatedUserId?: string | null;
  adminProfileId?: string | null;
  adminRole?: string | null;
  isActive?: boolean | string | number | null;
  profilesFoundCount?: number;
}

export interface IsAdminRpcDiagnostic {
  context: string;
  timestamp: string;
  authenticatedUserId: string | null;
  rpcHttpStatus: number | null;
  rpcResponse: any;
  isAdmin: boolean;
  adminProfileId: string | null;
  adminRole: string | null;
  isActive: boolean | string | number | null;
}

export interface PostRequestDiagnostic {
  endpoint: string;
  method: string;
  httpStatus: number | null;
  responseBody: any;
  authenticatedUserId: string | null;
  isAdminBeforePost: boolean | null;
  isAdminAfterPost: boolean | null;
  timestamp: string;
}

export interface AdminRecitationsFetchDiagnostic {
  timestamp: string;
  endpoint: string;
  httpStatus: number | null;
  statusText: string | null;
  durationMs: number;
  totalCount: number | null;
  itemsReturned: number | null;
  page: number;
  pageSize: number;
  filterApplied: {
    reciterId?: string;
    status?: string;
    search?: string;
  };
  supabaseError?: string | null;
  errorCode?: string | null;
}

const ADMIN_STORAGE_KEY = 'tilawatak_admin_session';

class AdminServiceImpl {
  private authState: AdminAuthState = {
    isAuthenticated: false,
    token: null,
    admin: null
  };

  private listeners: Set<(state: AdminAuthState) => void> = new Set();
  private diagnosticListeners: Set<(diag: IsAdminRpcDiagnostic | null) => void> = new Set();
  private postDiagnosticListeners: Set<(diag: PostRequestDiagnostic | null) => void> = new Set();
  private latestRpcDiagnostic: IsAdminRpcDiagnostic | null = null;
  private latestPostDiagnostic: PostRequestDiagnostic | null = null;
  private latestRecitationsFetchDiagnostic: AdminRecitationsFetchDiagnostic | null = null;

  constructor() {
    this.restoreSession();
  }

  private restoreSession() {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    try {
      const saved = sessionStorage.getItem(ADMIN_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.token && parsed.admin) {
          this.authState = {
            isAuthenticated: true,
            token: parsed.token,
            admin: parsed.admin
          };
        }
      }
    } catch (e) {
      console.warn('Failed to restore admin session:', e);
    }
  }

  private saveSession(token: string, admin: AdminProfile) {
    this.authState = {
      isAuthenticated: true,
      token,
      admin
    };
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        sessionStorage.setItem(
          ADMIN_STORAGE_KEY,
          JSON.stringify({ token, admin })
        );
      } catch (e) {
        console.warn('Failed to save admin session:', e);
      }
    }
    this.notifyListeners();
  }

  private clearSession() {
    this.authState = {
      isAuthenticated: false,
      token: null,
      admin: null
    };
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        sessionStorage.removeItem(ADMIN_STORAGE_KEY);
      } catch (e) {
        console.warn('Failed to clear admin session:', e);
      }
    }
    this.notifyListeners();
  }

  subscribe(listener: (state: AdminAuthState) => void) {
    this.listeners.add(listener);
    listener(this.authState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((l) => l(this.authState));
  }

  getAuthState(): AdminAuthState {
    return this.authState;
  }

  private getAuthHeaders() {
    const headers: Record<string, string> = {
      apikey: SUPABASE_CONFIG.anonKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };

    if (this.authState.token) {
      headers['Authorization'] = `Bearer ${this.authState.token}`;
    } else {
      headers['Authorization'] = `Bearer ${SUPABASE_CONFIG.anonKey}`;
    }

    return headers;
  }

  subscribeDiagnostic(listener: (diag: IsAdminRpcDiagnostic | null) => void) {
    this.diagnosticListeners.add(listener);
    listener(this.latestRpcDiagnostic);
    return () => {
      this.diagnosticListeners.delete(listener);
    };
  }

  private notifyDiagnosticListeners() {
    this.diagnosticListeners.forEach((l) => l(this.latestRpcDiagnostic));
  }

  getLatestRpcDiagnostic(): IsAdminRpcDiagnostic | null {
    return this.latestRpcDiagnostic;
  }

  subscribePostDiagnostic(listener: (diag: PostRequestDiagnostic | null) => void) {
    this.postDiagnosticListeners.add(listener);
    listener(this.latestPostDiagnostic);
    return () => {
      this.postDiagnosticListeners.delete(listener);
    };
  }

  private notifyPostDiagnosticListeners() {
    this.postDiagnosticListeners.forEach((l) => l(this.latestPostDiagnostic));
  }

  getLatestPostDiagnostic(): PostRequestDiagnostic | null {
    return this.latestPostDiagnostic;
  }

  // ============================================================================
  // DIAGNOSTICS
  // ============================================================================

  /**
   * Development-only diagnostic calling the public RPC is_admin() using the current access token.
   * Logs and stores strictly non-sensitive fields: status, response, user ID, boolean result.
   */
  async checkIsAdminRpc(context: string = 'diagnostic'): Promise<boolean | null> {
    if (typeof window === 'undefined' || !(import.meta as any).env?.DEV) return null;
    const admin = this.authState.admin;
    const authUserId = admin?.id || null;

    if (!this.authState.token) {
      const diag: IsAdminRpcDiagnostic = {
        context,
        timestamp: new Date().toLocaleTimeString('ar-SA'),
        authenticatedUserId: authUserId,
        rpcHttpStatus: null,
        rpcResponse: 'No token in session',
        isAdmin: false,
        adminProfileId: admin?.id || null,
        adminRole: admin?.role || null,
        isActive: admin?.isActive ?? null
      };
      this.latestRpcDiagnostic = diag;
      this.notifyDiagnosticListeners();
      return false;
    }

    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/is_admin`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_CONFIG.anonKey,
          Authorization: `Bearer ${this.authState.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({})
      });

      const rpcHttpStatus = rpcRes.status;
      let rpcResponse: any = null;
      try {
        rpcResponse = await rpcRes.json();
      } catch {
        rpcResponse = await rpcRes.text().catch(() => null);
      }

      const isAdmin = rpcResponse === true || rpcResponse === 'true';

      const diag: IsAdminRpcDiagnostic = {
        context,
        timestamp: new Date().toLocaleTimeString('ar-SA'),
        authenticatedUserId: authUserId,
        rpcHttpStatus,
        rpcResponse,
        isAdmin,
        adminProfileId: admin?.id || null,
        adminRole: admin?.role || null,
        isActive: admin?.isActive ?? null
      };

      this.latestRpcDiagnostic = diag;
      this.notifyDiagnosticListeners();

      return isAdmin;
    } catch (e: any) {
      const diag: IsAdminRpcDiagnostic = {
        context,
        timestamp: new Date().toLocaleTimeString('ar-SA'),
        authenticatedUserId: authUserId,
        rpcHttpStatus: null,
        rpcResponse: e?.message || 'Network error',
        isAdmin: false,
        adminProfileId: admin?.id || null,
        adminRole: admin?.role || null,
        isActive: admin?.isActive ?? null
      };
      this.latestRpcDiagnostic = diag;
      this.notifyDiagnosticListeners();

      console.warn(`[is_admin Diagnostic - ${context}] Error calling RPC is_admin:`, diag);
      return null;
    }
  }

  // ============================================================================
  // 1. ADMIN AUTHENTICATION
  // ============================================================================

  async login(email: string, password: string): Promise<{ success: boolean; error?: string; diagnostic?: AdminAuthDiagnostic }> {
    try {
      this.clearSession(); // Clear any previous stale session before authentication

      const cleanEmail = email.trim().toLowerCase();

      // 1. Supabase Auth token request
      const authRes = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_CONFIG.anonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: cleanEmail, password })
      });

      if (!authRes.ok) {
        const errJson = await authRes.json().catch(() => ({}));
        const message = errJson.error_description || errJson.msg || errJson.message || 'بيانات الدخول غير صحيحة';
        return {
          success: false,
          error: message,
          diagnostic: {
            authHttpStatus: authRes.status,
            profileHttpStatus: undefined,
            authenticatedUserId: null,
            adminProfileId: null,
            adminRole: null,
            isActive: null,
            profilesFoundCount: 0
          }
        };
      }

      const authData = await authRes.json();
      const accessToken = authData.access_token;
      const userId = authData.user?.id;
      const userEmail = (authData.user?.email || cleanEmail).toLowerCase();

      if (!accessToken || !userId) {
        return {
          success: false,
          error: 'تعذر التحقق من جلسة المستخدم',
          diagnostic: {
            authHttpStatus: authRes.status,
            profileHttpStatus: undefined,
            authenticatedUserId: userId || null,
            adminProfileId: null,
            adminRole: null,
            isActive: null,
            profilesFoundCount: 0
          }
        };
      }

      // 2. Query admin_profiles by ID with authenticated Bearer token
      let profileRes = await fetch(
        `${SUPABASE_CONFIG.restBaseUrl}/admin_profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.anonKey,
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json'
          }
        }
      );

      let profiles: any[] = [];
      if (profileRes.ok) {
        const resData = await profileRes.json().catch(() => []);
        if (Array.isArray(resData)) {
          profiles = resData;
        }
      }

      // Fallback query if id filter returned empty (e.g. by email)
      if (profiles.length === 0) {
        const fallbackRes = await fetch(
          `${SUPABASE_CONFIG.restBaseUrl}/admin_profiles?email=ilike.${encodeURIComponent(userEmail)}&select=*`,
          {
            headers: {
              apikey: SUPABASE_CONFIG.anonKey,
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json'
            }
          }
        );
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json().catch(() => []);
          if (Array.isArray(fallbackData) && fallbackData.length > 0) {
            profiles = fallbackData;
            profileRes = fallbackRes;
          }
        }
      }

      // Find matching profile by ID or email
      const profile = profiles.find(
        (p: any) => p.id === userId || (p.email && p.email.toLowerCase() === userEmail)
      ) || (profiles.length > 0 ? profiles[0] : null);

      const diagnosticData: AdminAuthDiagnostic = {
        authHttpStatus: authRes.status,
        profileHttpStatus: profileRes.status,
        authenticatedUserId: userId || null,
        adminProfileId: profile?.id || null,
        adminRole: profile?.role || null,
        isActive: profile ? (profile.is_active ?? null) : null,
        profilesFoundCount: profiles.length
      };

      // Safe development diagnostic log (no secrets or passwords)
      if (typeof window !== 'undefined' && (import.meta as any).env?.DEV) {
        console.log('[Admin Auth Diagnostic]', diagnosticData);
      }

      if (!profile) {
        return {
          success: false,
          error: 'هذا الحساب ليس لديه صلاحيات الإدارة',
          diagnostic: diagnosticData
        };
      }

      const isActive =
        profile.is_active === true ||
        profile.is_active === 'true' ||
        profile.is_active === 1 ||
        profile.is_active === 't';

      if (!isActive) {
        return {
          success: false,
          error: 'تم تعطيل هذا الحساب الإداري، يرجى مراجعة المسؤول',
          diagnostic: diagnosticData
        };
      }

      const adminProfile: AdminProfile = {
        id: profile.id,
        email: profile.email || userEmail,
        fullName: profile.full_name || 'مدير المنصة',
        role: profile.role || 'SUPER_ADMIN',
        isActive: true,
        createdAt: profile.created_at || new Date().toISOString()
      };

      this.saveSession(accessToken, adminProfile);

      // Development-only diagnostic call to public RPC is_admin() using the access token
      if (typeof window !== 'undefined' && (import.meta as any).env?.DEV) {
        this.checkIsAdminRpc('post-login');
      }

      return { success: true };
    } catch (e: any) {
      console.error('Admin login error:', e);
      return { success: false, error: e.message || 'حدث خطأ أثناء الاتصال بالخادم' };
    }
  }

  async logout(): Promise<void> {
    try {
      if (this.authState.token) {
        await fetch(`${SUPABASE_CONFIG.url}/auth/v1/logout`, {
          method: 'POST',
          headers: this.getAuthHeaders()
        }).catch(() => {});
      }
    } finally {
      this.clearSession();
    }
  }

  // ============================================================================
  // 2. DASHBOARD STATS
  // ============================================================================

  async getDashboardStats(): Promise<AdminDashboardStats> {
    const authHeaders = this.getAuthHeaders();

    // Strategy 1: Try get_admin_dashboard_metrics RPC for server-calculated live metrics
    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/get_admin_dashboard_metrics`, {
        method: 'POST',
        headers: authHeaders
      });
      if (rpcRes.ok) {
        const data = await rpcRes.json();
        if (data && typeof data === 'object') {
          return {
            totalReciters: Number(data.totalReciters) || 0,
            publishedReciters: Number(data.publishedReciters) || 0,
            totalRecitations: Number(data.totalRecitations) || 0,
            publishedRecitations: Number(data.publishedRecitations) || 0,
            pendingSubmissions: Number(data.pendingSubmissions) || 0,
            totalListens: Number(data.totalListens) || 0,
            totalLikes: Number(data.totalLikes) || 0,
            activeCompetitions: Number(data.activeCompetitions) || 0,
            totalUsers: Number(data.totalUsers) || 0
          };
        }
      }
    } catch (e) {
      console.warn('RPC get_admin_dashboard_metrics failed, falling back to count queries:', e);
    }

    // Strategy 2: Ultra-lightweight exact count queries (fetches 0-1 item metadata instead of full tables)
    const fetchExactCount = async (tableOrView: string, filterParams: string = ''): Promise<number> => {
      try {
        const queryStr = filterParams ? `?${filterParams}&select=id&limit=1` : '?select=id&limit=1';
        const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/${tableOrView}${queryStr}`, {
          method: 'GET',
          headers: {
            ...authHeaders,
            Prefer: 'count=exact'
          }
        });
        if (res.ok) {
          const cr = res.headers.get('content-range');
          if (cr && cr.includes('/')) {
            const countStr = cr.split('/')[1];
            if (countStr && countStr !== '*') {
              const num = parseInt(countStr, 10);
              if (!isNaN(num)) return num;
            }
          }
          const json = await res.json().catch(() => []);
          return Array.isArray(json) ? json.length : 0;
        }
      } catch (e) {
        console.warn(`fetchExactCount failed for ${tableOrView}:`, e);
      }
      return 0;
    };

    try {
      const [
        totalReciters,
        publishedReciters,
        totalRecitations,
        publishedRecitations,
        pendingSubmissions,
        totalListens,
        totalLikes,
        activeCompetitions,
        totalUsers
      ] = await Promise.all([
        fetchExactCount('reciters'),
        fetchExactCount('reciters', 'is_published=neq.false'),
        fetchExactCount('recitations'),
        fetchExactCount('recitations', 'status=eq.APPROVED'),
        fetchExactCount('recitation_submissions', 'status=eq.PENDING'),
        fetchExactCount('listen_events'),
        fetchExactCount('likes'),
        fetchExactCount('competitions', 'is_published=eq.true'),
        fetchExactCount('user_profiles')
      ]);

      return {
        totalReciters,
        publishedReciters: publishedReciters || totalReciters,
        totalRecitations,
        publishedRecitations: publishedRecitations || totalRecitations,
        pendingSubmissions,
        totalListens,
        totalLikes,
        activeCompetitions,
        totalUsers
      };
    } catch (e) {
      console.error('Failed to fetch dashboard stats:', e);
      return {
        totalReciters: 0,
        publishedReciters: 0,
        totalRecitations: 0,
        publishedRecitations: 0,
        pendingSubmissions: 0,
        totalListens: 0,
        totalLikes: 0,
        activeCompetitions: 0,
        totalUsers: 0
      };
    }
  }


  // ============================================================================
  // 3. RECITATION SUBMISSIONS MODERATION
  // ============================================================================

  async getSubmissions(status?: SubmissionStatus): Promise<RecitationSubmission[]> {
    try {
      let url = `${SUPABASE_CONFIG.restBaseUrl}/recitation_submissions?select=*&order=created_at.desc`;
      if (status) {
        url += `&status=in.(${encodeURIComponent(status.toUpperCase())},${encodeURIComponent(status.toLowerCase())})`;
      }

      const res = await fetch(url, { headers: this.getAuthHeaders() });
      if (!res.ok) {
        if (res.status === 401 && this.authState.token) {
          console.warn('Admin token expired on getSubmissions (401), clearing stale session');
          this.clearSession();
        }
        // Fallback query without status filter if filtered query returned error
        const fbRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/recitation_submissions?select=*&order=created_at.desc`, {
          headers: this.getAuthHeaders()
        });
        if (fbRes.ok) {
          const fbRows = await fbRes.json();
          if (Array.isArray(fbRows)) {
            const filtered = status
              ? fbRows.filter((r: any) => r.status?.toLowerCase() === status.toLowerCase())
              : fbRows;
            return filtered.map((r: any) => this.mapSubmissionRow(r));
          }
        }
        return [];
      }
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.map((r: any) => this.mapSubmissionRow(r));
    } catch (e) {
      console.warn('getSubmissions query warning:', e);
      return [];
    }
  }

  private mapSubmissionRow(r: any): RecitationSubmission {
    return {
      id: r.id,
      displayName: r.display_name,
      pseudonym: r.pseudonym,
      usePseudonym: r.use_pseudonym,
      gender: r.gender === 'FEMALE' ? 'female' : 'male',
      country: r.country,
      avatarUrl: r.profile_image_path,
      surahNumber: r.surah_number,
      surahName: r.surah_name,
      ayahRange: `${r.ayah_start} - ${r.ayah_end}`,
      riwayah: r.riwayah,
      description: r.description || '',
      audioFileName: r.audio_storage_path?.split('/').pop() || 'recording.mp3',
      audioDuration: 0,
      audioStoragePath: r.audio_storage_path || undefined,
      audioUrl: SupabaseService.resolveAudioUrl(r),
      externalAudioUrl: r.external_audio_url,
      externalImageUrl: r.profile_image_path,
      agreeToTerms: true,
      submittedAt: r.created_at,
      status: (
        r.status?.toUpperCase() === 'APPROVED' ? 'approved' :
        r.status?.toUpperCase() === 'APPROVED_UNPUBLISHED' ? 'approved_unpublished' :
        r.status?.toUpperCase() === 'REJECTED' ? 'rejected' : 'pending'
      ) as SubmissionStatus,
      adminNotes: r.admin_notes
    };
  }

  async updateSubmissionStatus(
    submissionId: string,
    status: 'APPROVED' | 'APPROVED_UNPUBLISHED' | 'REJECTED' | 'PENDING',
    adminNotes?: string
  ): Promise<void> {
    const res = await fetch(
      `${SUPABASE_CONFIG.restBaseUrl}/recitation_submissions?id=eq.${encodeURIComponent(submissionId)}`,
      {
        method: 'PATCH',
        headers: {
          ...this.getAuthHeaders(),
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          status,
          admin_notes: adminNotes || null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: this.authState.admin?.id || null
        })
      }
    );
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to update submission status (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }

  async approveSubmissionAndPublish(params: {
    submission: RecitationSubmission;
    reciterId?: string;
    createNewReciter?: boolean;
    publishDirectly?: boolean;
    newReciterData?: {
      displayName: string;
      pseudonym?: string;
      usePseudonym: boolean;
      gender: 'MALE' | 'FEMALE';
      country: string;
      bio: string;
      profileImagePath?: string;
      isVerified: boolean;
      isFeatured: boolean;
      isPublished: boolean;
    };
    recitationData: {
      surahName: string;
      surahNumber: number;
      ayahStart: number;
      ayahEnd: number;
      riwayah: string;
      durationSeconds: number;
      audioStoragePath: string;
      externalAudioUrl?: string;
      coverImagePath?: string;
      description?: string;
      isStaffPick: boolean;
    };
    adminNotes?: string;
  }): Promise<{ reciterId?: string; recitationId?: string }> {
    let finalReciterId = params.reciterId;
    const isPublished = params.publishDirectly !== false;

    // 1. Create new reciter if requested
    if (params.createNewReciter && params.newReciterData) {
      if (typeof window !== 'undefined' && (import.meta as any).env?.DEV) {
        await this.checkIsAdminRpc('approveSubmission-before-POST-reciters');
      }

      const reciterRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reciters`, {
        method: 'POST',
        headers: {
          ...this.getAuthHeaders(),
          Prefer: 'return=representation'
        },
        body: JSON.stringify({
          display_name: params.newReciterData.displayName,
          pseudonym: params.newReciterData.pseudonym || null,
          use_pseudonym: params.newReciterData.usePseudonym,
          gender: params.newReciterData.gender,
          country: params.newReciterData.country,
          bio: params.newReciterData.bio,
          profile_image_path: params.newReciterData.profileImagePath || null,
          is_verified: params.newReciterData.isVerified,
          is_featured: params.newReciterData.isFeatured,
          is_published: isPublished ? params.newReciterData.isPublished : false
        })
      });

      if (!reciterRes.ok) {
        if (typeof window !== 'undefined' && (import.meta as any).env?.DEV) {
          await this.checkIsAdminRpc(`approveSubmission-POST-reciters-failed-HTTP-${reciterRes.status}`);
        }
        throw new Error(`Failed to create reciter (HTTP ${reciterRes.status})`);
      }
      const newReciters = await reciterRes.json();
      finalReciterId = newReciters[0].id;
    }

    if (!finalReciterId) {
      throw new Error('يجب تحديد القارئ أو إنشاء قارئ جديد للمتابعة');
    }

    // 2. Prepare audio storage path (copy to public recitation-audio bucket if uploaded to submission-audio)
    let finalAudioStoragePath = params.recitationData.audioStoragePath;
    if (finalAudioStoragePath && finalAudioStoragePath.includes('submission-audio')) {
      const parts = finalAudioStoragePath.split('/');
      const fileName = parts[parts.length - 1];
      try {
        const copySuccess = await SupabaseService.copyStorageFile(
          'submission-audio',
          fileName,
          'recitation-audio',
          fileName,
          this.getAuthState().token || undefined
        );
        if (copySuccess) {
          finalAudioStoragePath = `recitation-audio/${fileName}`;
        }
      } catch (e) {
        console.warn('Storage copy error on approval:', e);
      }
    }

    // 3. Create recitation entry
    const recitationRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/recitations`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        reciter_id: finalReciterId,
        surah_name: params.recitationData.surahName,
        surah_number: params.recitationData.surahNumber,
        ayah_start: params.recitationData.ayahStart,
        ayah_end: params.recitationData.ayahEnd,
        riwayah: params.recitationData.riwayah || 'حفص عن عاصم',
        duration_seconds: params.recitationData.durationSeconds || 180,
        audio_storage_path: finalAudioStoragePath,
        external_audio_url: params.recitationData.externalAudioUrl || null,
        cover_image_path: params.recitationData.coverImagePath || null,
        description: params.recitationData.description || '',
        status: isPublished ? 'APPROVED' : 'APPROVED_UNPUBLISHED',
        is_published: isPublished,
        is_staff_pick: isPublished ? !!params.recitationData.isStaffPick : false,
        published_at: isPublished ? new Date().toISOString() : null
      })
    });

    if (!recitationRes.ok) {
      throw new Error(`Failed to save recitation (HTTP ${recitationRes.status})`);
    }

    // 3. Mark submission as approved or approved_unpublished
    await this.updateSubmissionStatus(
      params.submission.id,
      isPublished ? 'APPROVED' : 'APPROVED_UNPUBLISHED',
      params.adminNotes
    );

    return { reciterId: finalReciterId };
  }

  // ============================================================================
  // 4. RECITERS MANAGEMENT
  // ============================================================================

  async getAllAdminReciters(): Promise<any[]> {
    const authHeaders = this.getAuthHeaders();
    try {
      const url = `${SUPABASE_CONFIG.restBaseUrl}/reciters?select=*&order=created_at.desc`;
      const res = await fetch(url, {
        headers: authHeaders
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      }
    } catch (e) {
      console.warn('Direct fetch from /reciters encountered an issue, falling back to public_reciters_view:', e);
    }

    // Robust fallback to public_reciters_view to guarantee reciters are never missing
    try {
      const viewRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/public_reciters_view?select=*&order=created_at.desc`, {
        headers: authHeaders
      });
      if (viewRes.ok) {
        const viewData = await viewRes.json();
        if (Array.isArray(viewData)) {
          return viewData;
        }
      }
    } catch (e) {
      console.error('Failed to fetch from public_reciters_view fallback:', e);
    }

    return [];
  }

  async createReciter(data: {
    displayName: string;
    pseudonym?: string;
    usePseudonym: boolean;
    gender: 'MALE' | 'FEMALE';
    country: string;
    bio: string;
    profileImagePath?: string;
    bannerImagePath?: string;
    logoImagePath?: string;
    isVerified: boolean;
    isFeatured: boolean;
    isPublished: boolean;
  }): Promise<{ success: boolean }> {
    const authHeaders = this.getAuthHeaders();

    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reciters`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        display_name: data.displayName,
        pseudonym: data.pseudonym || null,
        use_pseudonym: data.usePseudonym,
        gender: data.gender,
        country: data.country || 'العالم الإسلامي',
        bio: data.bio || '',
        profile_image_path: data.profileImagePath || null,
        banner_image_path: data.bannerImagePath || null,
        logo_image_path: data.logoImagePath || null,
        is_verified: !!data.isVerified,
        is_featured: !!data.isFeatured,
        is_published: data.isPublished !== false
      })
    });

    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }

      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to create reciter (HTTP ${res.status})`;

      throw new Error(errorMsg);
    }

    // Return clear success result
    return { success: true };
  }

  async updateReciter(
    id: string,
    data: Partial<{
      displayName: string;
      pseudonym: string | null;
      usePseudonym: boolean;
      gender: 'MALE' | 'FEMALE';
      country: string;
      bio: string;
      profileImagePath: string | null;
      bannerImagePath: string | null;
      logoImagePath: string | null;
      isVerified: boolean;
      isFeatured: boolean;
      isPublished: boolean;
    }>
  ): Promise<void> {
    const payload: Record<string, any> = {};
    if (data.displayName !== undefined) payload.display_name = data.displayName;
    if (data.pseudonym !== undefined) payload.pseudonym = data.pseudonym;
    if (data.usePseudonym !== undefined) payload.use_pseudonym = data.usePseudonym;
    if (data.gender !== undefined) payload.gender = data.gender;
    if (data.country !== undefined) payload.country = data.country;
    if (data.bio !== undefined) payload.bio = data.bio ?? '';
    if (data.profileImagePath !== undefined) payload.profile_image_path = data.profileImagePath;
    if (data.bannerImagePath !== undefined) payload.banner_image_path = data.bannerImagePath;
    if (data.logoImagePath !== undefined) payload.logo_image_path = data.logoImagePath;
    if (data.isVerified !== undefined) payload.is_verified = data.isVerified;
    if (data.isFeatured !== undefined) payload.is_featured = data.isFeatured;
    if (data.isPublished !== undefined) payload.is_published = data.isPublished;

    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reciters?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to update reciter (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }

  async deleteReciter(id: string): Promise<void> {
    // Strategy 1: Try secure cascade RPC admin_delete_reciter
    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/admin_delete_reciter`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ p_id: id })
      });
      if (rpcRes.ok) return;
    } catch (e) {
      console.warn('RPC admin_delete_reciter bypassed, falling back to direct DELETE:', e);
    }

    // Strategy 2: Direct REST DELETE
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reciters?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to delete reciter (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }


  // ============================================================================
  // 5. RECITATIONS MANAGEMENT
  // ============================================================================

  public getLatestRecitationsFetchDiagnostic(): AdminRecitationsFetchDiagnostic | null {
    return this.latestRecitationsFetchDiagnostic;
  }

  async getAdminRecitationsPaginated(options: {
    page?: number;
    pageSize?: number;
    reciterId?: string;
    status?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}): Promise<{
    data: any[];
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const authHeaders = this.getAuthHeaders();
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.max(1, Math.min(100, options.pageSize || 24));
    const offset = (page - 1) * pageSize;

    const queryParts: string[] = [];
    queryParts.push('select=*,reciters(display_name,pseudonym,country,profile_image_path)');
    queryParts.push(`limit=${pageSize}`);
    queryParts.push(`offset=${offset}`);

    const sortField = options.sortBy || 'created_at';
    const sortDir = options.sortOrder || 'desc';
    queryParts.push(`order=${sortField}.${sortDir}`);

    if (options.reciterId && options.reciterId !== 'all') {
      queryParts.push(`reciter_id=eq.${encodeURIComponent(options.reciterId)}`);
    }

    if (options.status && options.status !== 'all') {
      queryParts.push(`status=eq.${encodeURIComponent(options.status.toUpperCase())}`);
    }

    if (options.search && options.search.trim()) {
      const q = encodeURIComponent(`*${options.search.trim()}*`);
      queryParts.push(`or=(surah_name.ilike.${q},riwayah.ilike.${q})`);
    }

    const queryString = queryParts.join('&');
    const url = `${SUPABASE_CONFIG.restBaseUrl}/recitations?${queryString}`;
    const startTime = Date.now();

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          ...authHeaders,
          Prefer: 'count=exact'
        }
      });

      const durationMs = Date.now() - startTime;

      if (res.ok) {
        const data = await res.json();
        let totalCount = Array.isArray(data) ? data.length : 0;
        const cr = res.headers.get('content-range');
        if (cr && cr.includes('/')) {
          const totalStr = cr.split('/')[1];
          if (totalStr && totalStr !== '*') {
            const parsed = parseInt(totalStr, 10);
            if (!isNaN(parsed)) totalCount = parsed;
          }
        }

        this.latestRecitationsFetchDiagnostic = {
          timestamp: new Date().toISOString(),
          endpoint: '/recitations',
          httpStatus: res.status,
          statusText: res.statusText,
          durationMs,
          totalCount,
          itemsReturned: Array.isArray(data) ? data.length : 0,
          page,
          pageSize,
          filterApplied: {
            reciterId: options.reciterId,
            status: options.status,
            search: options.search
          },
          supabaseError: null,
          errorCode: null
        };

        return {
          data: Array.isArray(data) ? data : [],
          totalCount,
          page,
          pageSize,
          totalPages: Math.ceil(totalCount / pageSize) || 1
        };
      } else {
        const errorText = await res.text().catch(() => '');
        let errMessage = res.statusText || 'Fetch error';
        let errCode: string | null = null;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.message) errMessage = parsed.message;
          if (parsed.code) errCode = parsed.code;
        } catch {}

        this.latestRecitationsFetchDiagnostic = {
          timestamp: new Date().toISOString(),
          endpoint: '/recitations',
          httpStatus: res.status,
          statusText: res.statusText,
          durationMs,
          totalCount: null,
          itemsReturned: null,
          page,
          pageSize,
          filterApplied: {
            reciterId: options.reciterId,
            status: options.status,
            search: options.search
          },
          supabaseError: errMessage,
          errorCode: errCode
        };

        throw new Error(`فشل استرجاع التلاوات من قاعدة البيانات (${res.status} ${res.statusText}): ${errMessage}`);
      }
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      if (!this.latestRecitationsFetchDiagnostic || this.latestRecitationsFetchDiagnostic.timestamp !== new Date().toISOString()) {
        this.latestRecitationsFetchDiagnostic = {
          timestamp: new Date().toISOString(),
          endpoint: '/recitations',
          httpStatus: null,
          statusText: 'Network / Connection Error',
          durationMs,
          totalCount: null,
          itemsReturned: null,
          page,
          pageSize,
          filterApplied: {
            reciterId: options.reciterId,
            status: options.status,
            search: options.search
          },
          supabaseError: e.message || 'Connection failure',
          errorCode: 'FETCH_FAILED'
        };
      }
      throw e;
    }
  }

  async getAllAdminRecitations(reciterId?: string): Promise<any[]> {
    const authHeaders = this.getAuthHeaders();
    let url = `${SUPABASE_CONFIG.restBaseUrl}/recitations?select=*,reciters(display_name,pseudonym,country,profile_image_path)&order=created_at.desc`;
    if (reciterId && reciterId !== 'all') {
      url += `&reciter_id=eq.${encodeURIComponent(reciterId)}`;
    }
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) return data;
    } else {
      const errText = await res.text().catch(() => '');
      throw new Error(`فشل جلب جميع التلاوات (${res.status}): ${errText}`);
    }
    return [];
  }

  async createRecitation(data: {
    reciterId: string;
    surahName: string;
    surahNumber: number;
    ayahStart: number;
    ayahEnd: number;
    riwayah: string;
    durationSeconds: number;
    audioStoragePath: string;
    externalAudioUrl?: string;
    coverImagePath?: string;
    description?: string;
    isStaffPick: boolean;
    status: 'APPROVED' | 'PENDING' | 'REJECTED';
  }): Promise<{ success: boolean }> {
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/recitations`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        reciter_id: data.reciterId,
        surah_name: data.surahName,
        surah_number: data.surahNumber,
        ayah_start: data.ayahStart,
        ayah_end: data.ayahEnd,
        riwayah: data.riwayah || 'حفص عن عاصم',
        duration_seconds: data.durationSeconds || 0,
        audio_storage_path: data.audioStoragePath,
        external_audio_url: data.externalAudioUrl || null,
        cover_image_path: data.coverImagePath || null,
        description: data.description || '',
        is_staff_pick: !!data.isStaffPick,
        status: data.status,
        is_published: data.status === 'APPROVED',
        published_at: data.status === 'APPROVED' ? new Date().toISOString() : null
      })
    });

    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }

      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to create recitation (HTTP ${res.status})`;

      throw new Error(errorMsg);
    }

    return { success: true };
  }

  async updateRecitation(
    id: string,
    data: Partial<{
      reciterId: string;
      surahName: string;
      surahNumber: number;
      ayahStart: number;
      ayahEnd: number;
      riwayah: string;
      durationSeconds: number;
      audioStoragePath: string;
      externalAudioUrl: string | null;
      coverImagePath: string | null;
      description: string | null;
      isStaffPick: boolean;
      status: 'APPROVED' | 'PENDING' | 'REJECTED';
    }>
  ): Promise<void> {
    const payload: Record<string, any> = {};
    if (data.reciterId !== undefined) payload.reciter_id = data.reciterId;
    if (data.surahName !== undefined) payload.surah_name = data.surahName;
    if (data.surahNumber !== undefined) payload.surah_number = data.surahNumber;
    if (data.ayahStart !== undefined) payload.ayah_start = data.ayahStart;
    if (data.ayahEnd !== undefined) payload.ayah_end = data.ayahEnd;
    if (data.riwayah !== undefined) payload.riwayah = data.riwayah;
    if (data.durationSeconds !== undefined) payload.duration_seconds = data.durationSeconds;
    if (data.audioStoragePath !== undefined) payload.audio_storage_path = data.audioStoragePath;
    if (data.externalAudioUrl !== undefined) payload.external_audio_url = data.externalAudioUrl;
    if (data.coverImagePath !== undefined) payload.cover_image_path = data.coverImagePath;
    if (data.description !== undefined) payload.description = data.description ?? '';
    if (data.isStaffPick !== undefined) payload.is_staff_pick = data.isStaffPick;
    if (data.status !== undefined) {
      payload.status = data.status;
      payload.is_published = data.status === 'APPROVED';
      if (data.status === 'APPROVED') {
        payload.published_at = new Date().toISOString();
      }
    }

    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/recitations?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to update recitation (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }

  async deleteRecitation(id: string): Promise<void> {
    // Strategy 1: Try secure cascade RPC admin_delete_recitation
    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/admin_delete_recitation`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ p_id: id })
      });
      if (rpcRes.ok) return;
    } catch (e) {
      console.warn('RPC admin_delete_recitation bypassed, falling back to direct DELETE:', e);
    }

    // Strategy 2: Direct REST DELETE
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/recitations?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to delete recitation (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }

  /**
   * Smart Bulk Recitations Publication Toggle (Server-Side atomic update)
   * Only targets records strictly matching the supplied filters.
   */
  async bulkToggleRecitationsPublication(params: {
    action: 'PUBLISH' | 'UNPUBLISH';
    reciterId?: string;
    status?: string;
    search?: string;
  }): Promise<{ updatedCount: number; action: string }> {
    const isPublish = params.action === 'PUBLISH';
    const reciterId = params.reciterId && params.reciterId !== 'all' ? params.reciterId : null;
    const currentStatus = params.status && params.status !== 'all' ? params.status.toUpperCase() : null;
    const search = params.search?.trim() || null;

    // Strategy 1: Call secure RPC admin_bulk_toggle_recitations
    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/admin_bulk_toggle_recitations`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          p_action: params.action,
          p_reciter_id: reciterId,
          p_current_status: currentStatus,
          p_search: search
        })
      });

      if (rpcRes.ok) {
        const data = await rpcRes.json();
        return {
          updatedCount: Number(data?.updated_count ?? 0),
          action: params.action
        };
      }
    } catch (e) {
      console.warn('RPC admin_bulk_toggle_recitations bypassed, using REST fallback:', e);
    }

    // Strategy 2: Single Server-Side PostgREST PATCH with exact filter criteria
    const queryParts: string[] = [];
    if (reciterId) {
      queryParts.push(`reciter_id=eq.${encodeURIComponent(reciterId)}`);
    }
    if (currentStatus) {
      queryParts.push(`status=eq.${encodeURIComponent(currentStatus)}`);
    }
    if (search) {
      const q = encodeURIComponent(`*${search}*`);
      queryParts.push(`or=(surah_name.ilike.${q},riwayah.ilike.${q})`);
    }

    const payload: Record<string, any> = {
      status: isPublish ? 'APPROVED' : 'PENDING',
      is_published: isPublish,
      updated_at: new Date().toISOString()
    };
    if (isPublish) {
      payload.published_at = new Date().toISOString();
    }

    const url = `${SUPABASE_CONFIG.restBaseUrl}/recitations${queryParts.length > 0 ? `?${queryParts.join('&')}` : ''}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=representation'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      throw new Error(errBody?.message || `Failed to bulk update recitations (${res.status})`);
    }

    const updatedRows = await res.json().catch(() => []);
    return {
      updatedCount: Array.isArray(updatedRows) ? updatedRows.length : 0,
      action: params.action
    };
  }


  // ============================================================================
  // 6. ANNOUNCEMENTS
  // ============================================================================

  async getAnnouncements(): Promise<Announcement[]> {
    try {
      const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/announcements?select=*&order=created_at.desc`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) {
        if (res.status === 401 && this.authState.token) {
          console.warn('Admin token expired on getAnnouncements (401), clearing stale session');
          this.clearSession();
        }
        return [];
      }
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        imagePath: r.image_path,
        isPublished: r.is_published,
        publishedAt: r.published_at,
        createdAt: r.created_at
      }));
    } catch (e) {
      console.warn('getAnnouncements warning:', e);
      return [];
    }
  }

  async createAnnouncement(data: {
    title: string;
    body: string;
    imagePath?: string;
    isPublished: boolean;
  }): Promise<{ success: boolean }> {
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/announcements`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        title: data.title,
        body: data.body || '',
        image_path: data.imagePath || null,
        is_published: !!data.isPublished,
        published_at: data.isPublished ? new Date().toISOString() : null
      })
    });

    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }

      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to create announcement (HTTP ${res.status})`;

      throw new Error(errorMsg);
    }

    return { success: true };
  }

  async updateAnnouncement(
    id: string,
    data: Partial<{
      title: string;
      body: string;
      imagePath: string | null;
      isPublished: boolean;
    }>
  ): Promise<void> {
    const payload: Record<string, any> = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.body !== undefined) payload.body = data.body ?? '';
    if (data.imagePath !== undefined) payload.image_path = data.imagePath;
    if (data.isPublished !== undefined) {
      payload.is_published = data.isPublished;
      if (data.isPublished) payload.published_at = new Date().toISOString();
    }

    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/announcements?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to update announcement (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }

  async deleteAnnouncement(id: string): Promise<void> {
    // Strategy 1: Try secure RPC admin_delete_announcement
    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/admin_delete_announcement`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ p_id: id })
      });
      if (rpcRes.ok) return;
    } catch (e) {
      console.warn('RPC admin_delete_announcement bypassed, falling back to direct DELETE:', e);
    }

    // Strategy 2: Direct REST DELETE
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/announcements?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to delete announcement (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }


  // ============================================================================
  // 7. COMPETITIONS
  // ============================================================================

  async getCompetitions(): Promise<Competition[]> {
    try {
      const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/competitions?select=*&order=created_at.desc`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) {
        if (res.status === 401 && this.authState.token) {
          console.warn('Admin token expired on getCompetitions (401), clearing stale session');
          this.clearSession();
        }
        return [];
      }
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        imagePath: r.image_path,
        linkUrl: r.link_url,
        startAt: r.start_at,
        endAt: r.end_at,
        isPublished: r.is_published,
        createdAt: r.created_at
      }));
    } catch (e) {
      console.warn('getCompetitions warning:', e);
      return [];
    }
  }

  async createCompetition(data: {
    title: string;
    description: string;
    imagePath?: string;
    linkUrl?: string;
    startAt: string;
    endAt: string;
    isPublished: boolean;
  }): Promise<{ success: boolean }> {
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/competitions`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        title: data.title,
        description: data.description || '',
        image_path: data.imagePath || null,
        link_url: data.linkUrl || null,
        start_at: data.startAt,
        end_at: data.endAt,
        is_published: !!data.isPublished
      })
    });

    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }

      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to create competition (HTTP ${res.status})`;

      throw new Error(errorMsg);
    }

    return { success: true };
  }

  async updateCompetition(
    id: string,
    data: Partial<{
      title: string;
      description: string;
      imagePath: string | null;
      linkUrl: string | null;
      startAt: string;
      endAt: string;
      isPublished: boolean;
    }>
  ): Promise<{ success: boolean }> {
    const payload: Record<string, any> = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.description !== undefined) payload.description = data.description ?? '';
    if (data.imagePath !== undefined) payload.image_path = data.imagePath;
    if (data.linkUrl !== undefined) payload.link_url = data.linkUrl;
    if (data.startAt !== undefined) payload.start_at = data.startAt;
    if (data.endAt !== undefined) payload.end_at = data.endAt;
    if (data.isPublished !== undefined) payload.is_published = data.isPublished;

    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/competitions?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }

      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to update competition (HTTP ${res.status})`;

      throw new Error(errorMsg);
    }

    return { success: true };
  }

  async deleteCompetition(id: string): Promise<void> {
    // Strategy 1: Try secure RPC admin_delete_competition
    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/admin_delete_competition`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ p_id: id })
      });
      if (rpcRes.ok) return;
    } catch (e) {
      console.warn('RPC admin_delete_competition bypassed, falling back to direct DELETE:', e);
    }

    // Strategy 2: Direct REST DELETE
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/competitions?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to delete competition (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }


  // ============================================================================
  // 8. REWARDS & HONORS
  // ============================================================================

  async getRewardDefinitions(): Promise<RewardDefinition[]> {
    try {
      const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reward_definitions?select=*&order=created_at.desc`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) {
        if (res.status === 401 && this.authState.token) {
          console.warn('Admin token expired on getRewardDefinitions (401), clearing stale session');
          this.clearSession();
        }
        return [];
      }
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        description: r.description,
        category: r.category,
        badgeIconPath: r.badge_icon_path,
        isActive: r.is_active,
        createdAt: r.created_at
      }));
    } catch (e) {
      console.warn('getRewardDefinitions warning:', e);
      return [];
    }
  }

  async createRewardDefinition(data: {
    code?: string;
    title: string;
    description: string;
    category?: 'TAJWEED_EXCELLENCE' | 'COMMUNITY_FAVORITE' | 'MILESTONE_COMPLETION' | 'EDITORIAL_HONOR' | string;
    badgeIconPath?: string;
    iconName?: string;
    pointsValue?: number;
  }): Promise<{ success: boolean }> {
    const code = data.code || `HONOR_${Date.now().toString(36).toUpperCase()}`;
    const category = (data.category && ['TAJWEED_EXCELLENCE', 'COMMUNITY_FAVORITE', 'MILESTONE_COMPLETION', 'EDITORIAL_HONOR'].includes(data.category))
      ? data.category
      : 'EDITORIAL_HONOR';

    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reward_definitions`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        code,
        title: data.title,
        description: data.description,
        category,
        badge_icon_path: data.badgeIconPath || data.iconName || null,
        is_active: true
      })
    });

    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }

      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to create reward definition (HTTP ${res.status})`;

      throw new Error(errorMsg);
    }

    return { success: true };
  }

  async updateRewardDefinition(
    id: string,
    data: Partial<{
      title: string;
      description: string;
      category: string;
      iconName: string;
      badgeIconPath: string;
      pointsValue: number;
      isActive: boolean;
    }>
  ): Promise<void> {
    const payload: Record<string, any> = {};
    if (data.title !== undefined) payload.title = data.title;
    if (data.description !== undefined) payload.description = data.description;
    if (data.category !== undefined) {
      if (['TAJWEED_EXCELLENCE', 'COMMUNITY_FAVORITE', 'MILESTONE_COMPLETION', 'EDITORIAL_HONOR'].includes(data.category)) {
        payload.category = data.category;
      }
    }
    if (data.badgeIconPath !== undefined || data.iconName !== undefined) {
      payload.badge_icon_path = data.badgeIconPath || data.iconName;
    }
    if (data.isActive !== undefined) payload.is_active = data.isActive;

    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reward_definitions?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to update reward definition (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }

  async deleteRewardDefinition(id: string): Promise<void> {
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reward_definitions?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to delete reward definition (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }

  async getReciterHonors(reciterId?: string): Promise<ReciterHonor[]> {
    let url = `${SUPABASE_CONFIG.restBaseUrl}/reciter_honors?select=*,reward_definitions(*),reciters(display_name,pseudonym,country,profile_image_path)&order=awarded_at.desc`;
    if (reciterId) {
      url += `&reciter_id=eq.${encodeURIComponent(reciterId)}`;
    }
    const res = await fetch(url, { headers: this.getAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    return rows.map((r: any) => ({
      id: r.id,
      reciterId: r.reciter_id,
      rewardId: r.reward_id,
      awardedAt: r.awarded_at,
      awardedBy: r.awarded_by,
      citationNote: r.citation_note,
      reciter: r.reciters
        ? {
            id: r.reciter_id,
            displayName: r.reciters.display_name,
            pseudonym: r.reciters.pseudonym,
            country: r.reciters.country,
            profileImagePath: r.reciters.profile_image_path
          }
        : undefined,
      reward: r.reward_definitions
        ? {
            id: r.reward_definitions.id,
            code: r.reward_definitions.code,
            title: r.reward_definitions.title,
            description: r.reward_definitions.description,
            category: r.reward_definitions.category,
            badgeIconPath: r.reward_definitions.badge_icon_path,
            isActive: r.reward_definitions.is_active,
            createdAt: r.reward_definitions.created_at
          }
        : undefined
    }));
  }

  async getHonors(reciterId?: string): Promise<any[]> {
    return this.getReciterHonors(reciterId);
  }

  async awardHonorToReciter(
    reciterIdOrParams:
      | string
      | {
          reciterId: string;
          rewardDefinitionId?: string;
          rewardId?: string;
          honorTitle?: string;
          citationNote?: string;
        },
    rewardId?: string,
    citationNote?: string
  ): Promise<{ success: boolean }> {
    let finalReciterId: string;
    let finalRewardId: string | null = null;
    let finalNote: string | null = null;

    if (typeof reciterIdOrParams === 'object') {
      finalReciterId = reciterIdOrParams.reciterId;
      finalRewardId = reciterIdOrParams.rewardDefinitionId || reciterIdOrParams.rewardId || null;
      finalNote = reciterIdOrParams.citationNote || reciterIdOrParams.honorTitle || null;
    } else {
      finalReciterId = reciterIdOrParams;
      finalRewardId = rewardId || null;
      finalNote = citationNote || null;
    }

    if (!finalRewardId) {
      // If reward definition is not given, fetch the first available or create a default honor
      const defs = await this.getRewardDefinitions();
      if (defs.length > 0) {
        finalRewardId = defs[0].id;
      }
    }

    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reciter_honors`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        reciter_id: finalReciterId,
        reward_id: finalRewardId,
        citation_note: finalNote,
        awarded_by: this.authState.admin?.id || null
      })
    });

    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }

      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to award honor (HTTP ${res.status})`;

      throw new Error(errorMsg);
    }

    return { success: true };
  }

  async revokeHonor(honorId: string): Promise<void> {
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reciter_honors?id=eq.${encodeURIComponent(honorId)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      let errBody: any = null;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => null);
      }
      const errorMsg =
        errBody?.message ||
        errBody?.msg ||
        errBody?.error_description ||
        `Failed to revoke honor (HTTP ${res.status})`;
      throw new Error(errorMsg);
    }
  }

  // ============================================================================
  // 9. ADMIN NOTIFICATIONS
  // ============================================================================

  async getAdminNotifications(): Promise<AdminNotification[]> {
    try {
      const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/admin_notifications?select=*&order=created_at.desc`, {
        headers: this.getAuthHeaders()
      });
      if (!res.ok) {
        if (res.status === 401 && this.authState.token) {
          console.warn('Admin token expired on getAdminNotifications (401), clearing stale session');
          this.clearSession();
        }
        return [];
      }
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.map((r: any) => ({
        id: r.id,
        notificationType: r.notification_type,
        title: r.title,
        content: r.content,
        referenceId: r.reference_id,
        isRead: r.is_read,
        sentViaEmail: r.sent_via_email,
        createdAt: r.created_at
      }));
    } catch (e) {
      console.warn('getAdminNotifications warning:', e);
      return [];
    }
  }

  async markNotificationAsRead(id: string): Promise<void> {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUUID) {
      // Local or fallback notification ID, update handled locally
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/admin_notifications?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ is_read: true })
      });
      if (!res.ok) {
        console.warn(`Supabase markNotificationAsRead returned HTTP ${res.status}`);
      }
    } catch (e) {
      console.warn('Failed to mark notification read on remote:', e);
    }
  }

  async markAllNotificationsAsRead(): Promise<void> {
    try {
      const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/admin_notifications?is_read=eq.false`, {
        method: 'PATCH',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ is_read: true })
      });
      if (!res.ok) {
        console.warn(`Supabase markAllNotificationsAsRead returned HTTP ${res.status}`);
      }
    } catch (e) {
      console.warn('Failed to mark all notifications read on remote:', e);
    }
  }

  async deleteAdminNotification(id: string): Promise<void> {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!isUUID) return;
    try {
      await fetch(`${SUPABASE_CONFIG.restBaseUrl}/admin_notifications?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });
    } catch (e) {
      console.warn('deleteAdminNotification error:', e);
    }
  }

  async sendBroadcastNotification(params: {
    title: string;
    body: string;
    notificationType?: string;
    targetType: 'all' | 'country' | 'user_type' | 'incomplete_profile' | 'specific_user';
    targetValue?: string;
  }): Promise<{ success: boolean; dispatchedCount: number }> {
    let dispatchedCount = 0;
    // Strategy 1: Try database RPC admin_send_broadcast
    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/admin_send_broadcast`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          p_title: params.title,
          p_body: params.body,
          p_notification_type: params.notificationType || 'ADMIN_ANNOUNCEMENT',
          p_target_type: params.targetType,
          p_target_value: params.targetValue || null
        })
      });
      if (rpcRes.ok) {
        const json = await rpcRes.json();
        dispatchedCount = json.dispatched_count || 0;
      }
    } catch (e) {
      console.warn('RPC admin_send_broadcast bypassed, using REST fallback:', e);
    }

    // Strategy 2: If RPC didn't dispatch, direct REST broadcast via user_profiles query & batch insert
    if (dispatchedCount === 0) {
      const users = await this.getUsers();
      let targetUsers = users;
      if (params.targetType === 'country' && params.targetValue) {
        targetUsers = users.filter((u) => u.country === params.targetValue);
      } else if (params.targetType === 'user_type' && params.targetValue) {
        targetUsers = users.filter((u) => u.userType === params.targetValue);
      } else if (params.targetType === 'incomplete_profile') {
        targetUsers = users.filter((u) => !u.isProfileCompleted);
      } else if (params.targetType === 'specific_user' && params.targetValue) {
        targetUsers = users.filter((u) => u.id === params.targetValue || u.installationId === params.targetValue);
      }

      const payload = targetUsers.map((u) => ({
        installation_id: u.installationId,
        title: params.title,
        body: params.body,
        notification_type: params.notificationType || 'ADMIN_ANNOUNCEMENT',
        is_read: false
      }));

      if (payload.length > 0) {
        await fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_notifications`, {
          method: 'POST',
          headers: {
            ...this.getAuthHeaders(),
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(payload)
        });
      }
      dispatchedCount = payload.length;
    }

    return { success: true, dispatchedCount };
  }

  // ============================================================================
  // 10. USER PROFILES & AUDIT
  // ============================================================================

  async getUsers(): Promise<any[]> {
    try {
      const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_profiles?select=*&order=last_active_at.desc`, {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows)) {
          return rows.map((r: any) => ({
            id: r.id,
            installationId: r.installation_id,
            displayName: r.display_name || 'زائر',
            avatarUrl: r.avatar_url,
            country: r.country || 'العالم الإسلامي',
            userType: r.user_type || 'LISTENER',
            bio: r.bio || '',
            email: r.email || null,
            whatsapp: r.whatsapp || null,
            isProfileCompleted: !!r.is_profile_completed,
            isSuspended: !!r.is_suspended,
            suspendedReason: r.suspended_reason || null,
            lastActiveAt: r.last_active_at,
            createdAt: r.created_at
          }));
        }
      }
    } catch (e) {
      console.warn('AdminService getUsers error:', e);
    }
    return [];
  }

  async updateUser(userId: string, data: Partial<any>): Promise<void> {
    const payload: Record<string, any> = {};
    if (data.displayName !== undefined) payload.display_name = data.displayName;
    if (data.avatarUrl !== undefined) payload.avatar_url = data.avatarUrl;
    if (data.country !== undefined) payload.country = data.country;
    if (data.userType !== undefined) payload.user_type = data.userType;
    if (data.bio !== undefined) payload.bio = data.bio;
    if (data.email !== undefined) payload.email = data.email;
    if (data.whatsapp !== undefined) payload.whatsapp = data.whatsapp;
    if (data.isSuspended !== undefined) payload.is_suspended = data.isSuspended;
    if (data.suspendedReason !== undefined) payload.suspended_reason = data.suspendedReason;

    try {
      const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: {
          ...this.getAuthHeaders(),
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error(`Failed to update user profile (HTTP ${res.status})`);
      }
    } catch (e) {
      console.warn('updateUser fallback:', e);
    }
  }

  async toggleUserSuspension(userId: string, isSuspended: boolean, suspendedReason?: string): Promise<void> {
    const reason = isSuspended ? suspendedReason || 'مخالفة معايير وشروط استخدام منصة تلاوتك للعالم' : null;
    await this.updateUser(userId, {
      isSuspended,
      suspendedReason: reason
    });

    try {
      const userRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_profiles?id=eq.${encodeURIComponent(userId)}&select=installation_id`, {
        headers: this.getAuthHeaders()
      });
      if (userRes.ok) {
        const rows = await userRes.json();
        if (Array.isArray(rows) && rows[0]?.installation_id) {
          const instId = rows[0].installation_id;
          const notifTitle = isSuspended ? 'إيقاف حسابك مؤقتًا' : 'إعادة تفعيل حسابك';
          const notifBody = isSuspended 
            ? `تم تقييد إمكانية رفع وتلاوة المحتوى في حسابك.${reason ? ` السبب: ${reason}` : ''}`
            : 'تم رفع القيود عن حسابك وبإمكانك الآن رفع واستخدام المنصة بحرية.';
          
          await fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_notifications`, {
            method: 'POST',
            headers: {
              ...this.getAuthHeaders(),
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              installation_id: instId,
              title: notifTitle,
              body: notifBody,
              notification_type: isSuspended ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_UNSUSPENDED',
              is_read: false
            })
          });

          await this.logUserActivity(
            instId, 
            isSuspended ? 'USER_SUSPENDED' : 'USER_UNSUSPENDED', 
            isSuspended ? `تم حظر الحساب. السبب: ${reason}` : 'تم رفع الحظر وإعادة تنشيط الحساب'
          );
        }
      }
    } catch (e) {
      console.warn('toggleUserSuspension notification / activity log error:', e);
    }
  }

  async getUserActivityLogs(installationId: string): Promise<any[]> {
    if (!installationId) return [];
    try {
      const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_activity_logs?installation_id=eq.${encodeURIComponent(installationId)}&order=created_at.desc`, {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows)) {
          return rows.map((r: any) => ({
            id: r.id,
            installationId: r.installation_id,
            eventType: r.event_type,
            description: r.description,
            adminName: r.admin_name,
            metadata: r.metadata,
            createdAt: r.created_at
          }));
        }
      }
    } catch (e) {
      console.warn('getUserActivityLogs error:', e);
    }
    return [];
  }

  async logUserActivity(installationId: string, eventType: string, description: string, adminName?: string, metadata?: any): Promise<void> {
    if (!installationId) return;
    try {
      await fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_activity_logs`, {
        method: 'POST',
        headers: {
          ...this.getAuthHeaders(),
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          installation_id: installationId,
          event_type: eventType,
          description: description,
          admin_name: adminName || this.authState.admin?.fullName || 'المسؤول',
          metadata: metadata || null
        })
      });
    } catch (e) {
      console.warn('logUserActivity error:', e);
    }
  }

  async getUserRecitations(installationId: string, displayName?: string): Promise<any[]> {
    if (!installationId && !displayName) return [];
    try {
      let query = `${SUPABASE_CONFIG.restBaseUrl}/recitation_submissions?select=*&order=created_at.desc`;
      if (installationId) {
        query += `&installation_id=eq.${encodeURIComponent(installationId)}`;
      } else if (displayName) {
        query += `&display_name=eq.${encodeURIComponent(displayName)}`;
      }
      const res = await fetch(query, {
        headers: this.getAuthHeaders()
      });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows)) {
          return rows.map((r: any) => ({
            id: r.id,
            installationId: r.installation_id,
            surahNumber: r.surah_number,
            surahName: r.surah_name,
            ayahStart: r.ayah_start,
            ayahEnd: r.ayah_end,
            riwayah: r.riwayah,
            status: r.status,
            createdAt: r.created_at,
            audioStoragePath: r.audio_storage_path,
            externalAudioUrl: r.external_audio_url,
            listenCount: r.listen_count || r.listens_count || 0,
            likeCount: r.like_count || r.likes_count || 0,
            rejectionReason: r.rejection_reason
          }));
        }
      }
    } catch (e) {
      console.warn('getUserRecitations error:', e);
    }
    return [];
  }

  async deleteUser(userId: string): Promise<void> {
    // Strategy 1: Try secure RPC admin_delete_user
    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/admin_delete_user`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ p_id: userId })
      });
      if (rpcRes.ok) return;
    } catch (e) {
      console.warn('RPC admin_delete_user bypassed, falling back to direct DELETE:', e);
    }

    // Strategy 2: Direct REST DELETE
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      throw new Error(`Failed to delete user profile (HTTP ${res.status})`);
    }
  }

  async deleteSubmission(submissionId: string): Promise<void> {
    // Strategy 1: Try secure RPC admin_delete_submission
    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/admin_delete_submission`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ p_id: submissionId })
      });
      if (rpcRes.ok) return;
    } catch (e) {
      console.warn('RPC admin_delete_submission bypassed, falling back to direct DELETE:', e);
    }

    // Strategy 2: Direct REST DELETE
    const res = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/recitation_submissions?id=eq.${encodeURIComponent(submissionId)}`, {
      method: 'DELETE',
      headers: this.getAuthHeaders()
    });
    if (!res.ok) {
      throw new Error(`Failed to delete recitation submission (HTTP ${res.status})`);
    }
  }


  // ============================================================================
  // 11. STORAGE UPLOAD
  // ============================================================================

  async uploadFile(bucket: string, path: string, file: File | Blob): Promise<string> {
    const headers: Record<string, string> = {
      apikey: SUPABASE_CONFIG.anonKey
    };
    if (this.authState.token) {
      headers['Authorization'] = `Bearer ${this.authState.token}`;
    }

    try {
      const res = await fetch(`${SUPABASE_CONFIG.storageBaseUrl}/object/${bucket}/${path}`, {
        method: 'POST',
        headers,
        body: file
      });

      if (res.ok) {
        if (bucket === 'submission-audio' || bucket === 'submission-images') {
          return `${bucket}/${path}`;
        }
        return `${SUPABASE_CONFIG.storageBaseUrl}/object/public/${bucket}/${path}`;
      }
      console.warn(`uploadFile to ${bucket}/${path} returned HTTP ${res.status}`);
    } catch (e) {
      console.warn(`uploadFile to ${bucket}/${path} network exception:`, e);
    }

    // Secondary fallback to public recitation-audio bucket if applicable
    if (bucket !== 'recitation-audio' && (bucket === 'submission-audio' || path.endsWith('.mp3') || path.endsWith('.m4a') || path.endsWith('.wav'))) {
      try {
        const fallbackRes = await fetch(`${SUPABASE_CONFIG.storageBaseUrl}/object/recitation-audio/${path}`, {
          method: 'POST',
          headers,
          body: file
        });
        if (fallbackRes.ok) {
          return `${SUPABASE_CONFIG.storageBaseUrl}/object/public/recitation-audio/${path}`;
        }
      } catch (e) {
        console.warn('Fallback upload to recitation-audio exception:', e);
      }
    }

    // Final fallback: Base64 data URL
    try {
      const dataUrl = await SupabaseService.fileToDataUrl(file);
      if (dataUrl) {
        return dataUrl;
      }
    } catch {
      // ignore
    }

    // Default public path representation
    return `${SUPABASE_CONFIG.storageBaseUrl}/object/public/${bucket}/${path}`;
  }

  // ============================================================================
  // 12. RECITER CLONING & AUDIO URL TEMPLATING
  // ============================================================================

  /**
   * Fetch all recitations specifically for a given reciter id with surah ordering
   */
  async getReciterRecitations(reciterId: string): Promise<any[]> {
    if (!reciterId) return [];
    try {
      const url = `${SUPABASE_CONFIG.restBaseUrl}/recitations?reciter_id=eq.${encodeURIComponent(reciterId)}&order=surah_number.asc,ayah_start.asc`;
      const res = await fetch(url, { headers: this.getAuthHeaders() });
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows)) {
          return rows.map((r: any) => ({
            id: r.id,
            reciterId: r.reciter_id,
            surahName: r.surah_name,
            surahNumber: r.surah_number,
            ayahStart: r.ayah_start,
            ayahEnd: r.ayah_end,
            riwayah: r.riwayah,
            durationSeconds: r.duration_seconds,
            audioStoragePath: r.audio_storage_path,
            externalAudioUrl: r.external_audio_url,
            coverImagePath: r.cover_image_path,
            description: r.description,
            status: r.status,
            isStaffPick: r.is_staff_pick,
            publishedAt: r.published_at,
            createdAt: r.created_at
          }));
        }
      }
    } catch (e) {
      console.warn('getReciterRecitations error:', e);
    }
    return [];
  }

  /**
   * Clone a full reciter profile and all associated recitations with fresh IDs,
   * completely independent from the original reciter.
   */
  async cloneReciterProfile(
    sourceReciterId: string,
    newDisplayName?: string,
    newCountry?: string
  ): Promise<{
    success: boolean;
    newReciterId: string;
    newDisplayName: string;
    copiedRecitationsCount: number;
  }> {
    if (!sourceReciterId) {
      throw new Error('معرف القارئ المصدر مطلوب لإتمام عملية النسخ');
    }

    // Strategy 1: Attempt transactional Supabase RPC `clone_reciter_profile`
    try {
      const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/clone_reciter_profile`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          p_source_reciter_id: sourceReciterId,
          p_new_display_name: newDisplayName || null,
          p_new_country: newCountry || null,
          p_initial_status: 'PENDING'
        })
      });

      if (rpcRes.ok) {
        const result = await rpcRes.json();
        if (result && result.new_reciter_id) {
          return {
            success: true,
            newReciterId: result.new_reciter_id,
            newDisplayName: result.new_display_name || newDisplayName || 'قارئ جديد',
            copiedRecitationsCount: Number(result.copied_recitations_count) || 0
          };
        }
      }
    } catch (e) {
      console.warn('RPC clone_reciter_profile unavailable or failed, utilizing atomic REST fallback:', e);
    }

    // Strategy 2: Robust Atomic REST fallback
    // 1. Fetch source reciter details
    const reciterFetchRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reciters?id=eq.${encodeURIComponent(sourceReciterId)}`, {
      headers: this.getAuthHeaders()
    });

    if (!reciterFetchRes.ok) {
      throw new Error('تعذر العثور على بيانات القارئ المصدر');
    }

    const sourceReciters = await reciterFetchRes.json();
    if (!Array.isArray(sourceReciters) || sourceReciters.length === 0) {
      throw new Error('القارئ المصدر غير موجود');
    }

    const src = sourceReciters[0];
    const targetName = (newDisplayName && newDisplayName.trim()) || `${src.display_name} (نسخة)`;

    // 2. Insert new reciter row
    const createReciterRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reciters`, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        display_name: targetName,
        pseudonym: src.pseudonym || null,
        use_pseudonym: Boolean(src.use_pseudonym),
        gender: src.gender || 'MALE',
        country: newCountry || src.country || 'العالم الإسلامي',
        bio: src.bio || '',
        profile_image_path: src.profile_image_path || null,
        banner_image_path: src.banner_image_path || null,
        logo_image_path: src.logo_image_path || null,
        is_verified: Boolean(src.is_verified),
        is_featured: false,
        is_published: false // Draft mode for safe review
      })
    });

    if (!createReciterRes.ok) {
      let errBody: any = null;
      try {
        errBody = await createReciterRes.json();
      } catch {
        // ignore
      }
      throw new Error(errBody?.message || `فشل إنشاء سجل القارئ الجديد (HTTP ${createReciterRes.status})`);
    }

    const createdReciters = await createReciterRes.json();
    const newReciterId = createdReciters[0]?.id;
    if (!newReciterId) {
      throw new Error('فشل استلام معرف القارئ الجديد');
    }

    // 3. Fetch source recitations
    let copiedCount = 0;
    try {
      const recitationsRes = await fetch(
        `${SUPABASE_CONFIG.restBaseUrl}/recitations?reciter_id=eq.${encodeURIComponent(sourceReciterId)}&order=surah_number.asc,ayah_start.asc`,
        { headers: this.getAuthHeaders() }
      );

      if (recitationsRes.ok) {
        const sourceRecitations = await recitationsRes.json();
        if (Array.isArray(sourceRecitations) && sourceRecitations.length > 0) {
          // Prepare clone payload with fresh IDs and zero stats
          const clonePayload = sourceRecitations.map((r: any) => ({
            reciter_id: newReciterId,
            surah_name: r.surah_name,
            surah_number: r.surah_number,
            ayah_start: r.ayah_start,
            ayah_end: r.ayah_end,
            riwayah: r.riwayah || 'حفص عن عاصم',
            duration_seconds: r.duration_seconds || 180,
            audio_storage_path: r.audio_storage_path,
            external_audio_url: r.external_audio_url || null,
            cover_image_path: r.cover_image_path || null,
            description: r.description || '',
            status: 'PENDING',
            is_staff_pick: false,
            published_at: null
          }));

          // Insert in chunks of 50 to avoid request size limits
          const CHUNK_SIZE = 50;
          for (let i = 0; i < clonePayload.length; i += CHUNK_SIZE) {
            const chunk = clonePayload.slice(i, i + CHUNK_SIZE);
            const insertChunkRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/recitations`, {
              method: 'POST',
              headers: {
                ...this.getAuthHeaders(),
                Prefer: 'return=minimal'
              },
              body: JSON.stringify(chunk)
            });

            if (insertChunkRes.ok) {
              copiedCount += chunk.length;
            } else {
              let errJson: any = null;
              try {
                errJson = await insertChunkRes.json();
              } catch {
                // ignore
              }
              console.warn(`Failed to insert recitation chunk ${i}: HTTP ${insertChunkRes.status}`, errJson);
              // Clean up newly created reciter and partial recitations to prevent orphans (Atomic Rollback)
              try {
                await fetch(`${SUPABASE_CONFIG.restBaseUrl}/recitations?reciter_id=eq.${encodeURIComponent(newReciterId)}`, {
                  method: 'DELETE',
                  headers: this.getAuthHeaders()
                });
                await fetch(`${SUPABASE_CONFIG.restBaseUrl}/reciters?id=eq.${encodeURIComponent(newReciterId)}`, {
                  method: 'DELETE',
                  headers: this.getAuthHeaders()
                });
              } catch (cleanupErr) {
                console.error('Failed to cleanup on rollback:', cleanupErr);
              }
              throw new Error(errJson?.message || `فشل نسخ جزء من التلاوات (HTTP ${insertChunkRes.status})، تم التراجع عن العملية.`);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('Error while copying recitations:', err);
      throw err;
    }

    return {
      success: true,
      newReciterId,
      newDisplayName: targetName,
      copiedRecitationsCount: copiedCount
    };
  }

  /**
   * Apply an audio URL template or identifier replacement to all recitations of a reciter
   */
  async applyReciterAudioTemplate(
    reciterId: string,
    options: TransformUrlOptions
  ): Promise<{ success: boolean; updatedCount: number }> {
    if (!reciterId) {
      throw new Error('معرف القارئ مطلوب لتطبيق قالب الروابط');
    }

    // Strategy 1: Attempt Supabase RPC `apply_reciter_audio_template`
    if (options.mode === 'template' && options.urlTemplate) {
      try {
        const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/apply_reciter_audio_template`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({
            p_reciter_id: reciterId,
            p_url_template: options.urlTemplate,
            p_reciter_slug: options.reciterSlug || null,
            p_replace_from: null,
            p_replace_to: null
          })
        });

        if (rpcRes.ok) {
          const resJson = await rpcRes.json();
          if (resJson && resJson.success) {
            return {
              success: true,
              updatedCount: Number(resJson.updated_recitations_count) || 0
            };
          }
        }
      } catch (e) {
        console.warn('RPC apply_reciter_audio_template unavailable, using batch REST fallback:', e);
      }
    } else if (options.mode === 'replace' && options.replaceFrom) {
      try {
        const rpcRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/rpc/apply_reciter_audio_template`, {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({
            p_reciter_id: reciterId,
            p_url_template: null,
            p_reciter_slug: null,
            p_replace_from: options.replaceFrom,
            p_replace_to: options.replaceTo || ''
          })
        });

        if (rpcRes.ok) {
          const resJson = await rpcRes.json();
          if (resJson && resJson.success) {
            return {
              success: true,
              updatedCount: Number(resJson.updated_recitations_count) || 0
            };
          }
        }
      } catch (e) {
        console.warn('RPC apply_reciter_audio_template replace mode failed, using REST fallback:', e);
      }
    }

    // Strategy 2: Batch REST fallback
    const recitations = await this.getReciterRecitations(reciterId);
    if (!recitations || recitations.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    let updatedCount = 0;
    for (const rec of recitations) {
      const currentUrl = rec.externalAudioUrl || rec.audioStoragePath || '';
      const newUrl = transformRecitationUrl(currentUrl, rec.surahNumber, rec.surahName, options);

      if (newUrl && newUrl !== currentUrl) {
        try {
          // Prepare update payload: preserve binary storage path if it was an internal Supabase Storage file
          const updatePayload: Record<string, any> = {
            external_audio_url: newUrl,
            updated_at: new Date().toISOString()
          };

          // If original audio_storage_path was already an http external link, update it as well
          if (rec.audioStoragePath && (rec.audioStoragePath.startsWith('http://') || rec.audioStoragePath.startsWith('https://'))) {
            updatePayload.audio_storage_path = newUrl;
          }

          const patchRes = await fetch(`${SUPABASE_CONFIG.restBaseUrl}/recitations?id=eq.${encodeURIComponent(rec.id)}`, {
            method: 'PATCH',
            headers: {
              ...this.getAuthHeaders(),
              Prefer: 'return=minimal'
            },
            body: JSON.stringify(updatePayload)
          });

          if (patchRes.ok) {
            updatedCount++;
          }
        } catch (e) {
          console.warn(`Failed to update recitation ${rec.id}:`, e);
        }
      }
    }

    return {
      success: true,
      updatedCount
    };
  }
}

export const adminService = new AdminServiceImpl();
