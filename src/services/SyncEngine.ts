/**
 * SyncEngine.ts
 * Enterprise-grade Cache-First + Incremental Sync + Supabase Realtime + Background Refresh Engine
 * Platform: Tilawatak Lil-Alem (تلاوتك للعالم)
 *
 * Architecture:
 * 1. Cache-First (L1 In-Memory + L2 Persistent LocalStorage): Instant 0ms startup, no blank screens, no zeros.
 * 2. Incremental Sync: Fetches only modified records (updated_at > lastSync) and deleted tombstones.
 * 3. Supabase Realtime: Listens to postgres_changes for live INSERT / UPDATE / DELETE without page reload.
 * 4. Background Refresh: Background reconciliation on app resume, tab focus, or network reconnect.
 */

import {
  Reciter,
  Recitation,
  RecitationSubmission,
  Competition,
  Announcement,
  ReciterHonor,
  LikeResult,
  ListenEvent
} from '../types';
import { supabase, SUPABASE_CONFIG, SupabaseService } from './SupabaseService';
import { userService } from './UserService';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Local storage keys
const STORAGE_PREFIX = 'tilawatak_sync_v2_';
const KEYS = {
  RECITERS: `${STORAGE_PREFIX}reciters`,
  RECITATIONS: `${STORAGE_PREFIX}recitations`,
  COMPETITIONS: `${STORAGE_PREFIX}competitions`,
  ANNOUNCEMENTS: `${STORAGE_PREFIX}announcements`,
  HONORS: `${STORAGE_PREFIX}honors`,
  SUBMISSIONS: `${STORAGE_PREFIX}submissions`,
  LIKES: `${STORAGE_PREFIX}user_likes`,
  METADATA: `${STORAGE_PREFIX}metadata`
};

interface SyncMetadata {
  lastSyncTimestamp: string | null;
  collections: {
    [key: string]: {
      lastSyncAt: string | null;
      count: number;
    };
  };
}

// ============================================================================
// PERSISTENT STORAGE LAYER (L2 Persistent Cache)
// ============================================================================

class SyncStorage {
  static get<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch (e) {
      console.warn(`[SyncStorage] Failed to read ${key}:`, e);
      return fallback;
    }
  }

  static set<T>(key: string, data: T): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn(`[SyncStorage] Failed to write ${key}:`, e);
    }
  }

  static getMetadata(): SyncMetadata {
    return this.get<SyncMetadata>(KEYS.METADATA, {
      lastSyncTimestamp: null,
      collections: {}
    });
  }

  static saveMetadata(meta: SyncMetadata): void {
    this.set(KEYS.METADATA, meta);
  }
}

// ============================================================================
// CORE SYNC ENGINE (Cache-First + Incremental Sync + Realtime)
// ============================================================================

export class SyncEngine {
  private static instance: SyncEngine;

  // L1 In-Memory Fast State (Hydrated synchronously on instantiation)
  private reciters: Reciter[] = [];
  private recitations: Recitation[] = [];
  private competitions: Competition[] = [];
  private announcements: Announcement[] = [];
  private honors: ReciterHonor[] = [];
  private submissions: RecitationSubmission[] = [];
  private userLikes: Set<string> = new Set();

  private metadata: SyncMetadata;
  private isSyncing: boolean = false;
  private syncPromise: Promise<void> | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private realtimeRetryTimer: any = null;
  private isClosingRealtimeChannel: boolean = false;

  // Observers / Listeners for reactive updates
  private reciterListeners: Set<(reciters: Reciter[]) => void> = new Set();
  private recitationListeners: Set<(recitations: Recitation[]) => void> = new Set();
  private competitionListeners: Set<(competitions: Competition[]) => void> = new Set();
  private announcementListeners: Set<(announcements: Announcement[]) => void> = new Set();
  private honorListeners: Set<(honors: ReciterHonor[]) => void> = new Set();
  private submissionListeners: Set<(submissions: RecitationSubmission[]) => void> = new Set();
  private syncStateListeners: Set<(isSyncing: boolean) => void> = new Set();

  private constructor() {
    this.metadata = SyncStorage.getMetadata();
    this.hydrateFromCache();

    if (typeof window !== 'undefined') {
      this.initRealtimeSubscriptions();
      this.initLifecycleListeners();
      
      // On startup, if local cache is empty or on cold boot, trigger full sync immediately
      const isColdStart = !this.recitations.length || !this.reciters.length;
      setTimeout(() => {
        this.performBackgroundSync(isColdStart);
      }, 50);

      // Periodic silent background refresh for live stats and counters (every 25 seconds)
      setInterval(() => {
        this.performBackgroundSync().catch(() => {});
      }, 25000);
    }
  }

  public static getInstance(): SyncEngine {
    if (!SyncEngine.instance) {
      SyncEngine.instance = new SyncEngine();
    }
    return SyncEngine.instance;
  }

  // --------------------------------------------------------------------------
  // 1. CACHE HYDRATION (0ms Startup)
  // --------------------------------------------------------------------------
  private hydrateFromCache(): void {
    try {
      this.reciters = SyncStorage.get<Reciter[]>(KEYS.RECITERS, []);
      this.recitations = SyncStorage.get<Recitation[]>(KEYS.RECITATIONS, []);
      this.competitions = SyncStorage.get<Competition[]>(KEYS.COMPETITIONS, []);
      this.announcements = SyncStorage.get<Announcement[]>(KEYS.ANNOUNCEMENTS, []);
      this.honors = SyncStorage.get<ReciterHonor[]>(KEYS.HONORS, []);
      this.submissions = SyncStorage.get<RecitationSubmission[]>(KEYS.SUBMISSIONS, []);

      const savedLikes = SyncStorage.get<string[]>(KEYS.LIKES, []);
      this.userLikes = new Set(savedLikes);

      // Attach like state to hydrated recitations
      if (this.userLikes.size > 0 && this.recitations.length > 0) {
        this.recitations = this.recitations.map((r) => ({
          ...r,
          isLiked: this.userLikes.has(r.id)
        }));
      }

      console.log('[SyncEngine] Hydrated from cache successfully:', {
        reciters: this.reciters.length,
        recitations: this.recitations.length,
        competitions: this.competitions.length,
        announcements: this.announcements.length,
        lastSync: this.metadata.lastSyncTimestamp
      });
    } catch (e) {
      console.warn('[SyncEngine] Cache hydration warning:', e);
    }
  }

  // --------------------------------------------------------------------------
  // 2. SYNCHRONOUS GETTERS (Instant UI Read)
  // --------------------------------------------------------------------------
  public getReciters(): Reciter[] {
    return [...this.reciters];
  }

  public getRecitations(): Recitation[] {
    return [...this.recitations].sort((a, b) => (Number(a.surahNumber) || 1) - (Number(b.surahNumber) || 1));
  }

  public getCompetitions(): Competition[] {
    return [...this.competitions];
  }

  public getAnnouncements(): Announcement[] {
    return [...this.announcements];
  }

  public getHonors(reciterId?: string): ReciterHonor[] {
    if (reciterId) {
      return this.honors.filter((h) => h.reciterId === reciterId);
    }
    return [...this.honors];
  }

  public getSubmissions(): RecitationSubmission[] {
    return [...this.submissions];
  }

  public isSyncInProgress(): boolean {
    return this.isSyncing;
  }

  public getLastSyncTimestamp(): string | null {
    return this.metadata.lastSyncTimestamp;
  }

  // --------------------------------------------------------------------------
  // 3. REACTIVE SUBSCRIPTIONS
  // --------------------------------------------------------------------------
  public subscribeReciters(callback: (reciters: Reciter[]) => void): () => void {
    this.reciterListeners.add(callback);
    // Instant initial delivery from cache
    callback(this.getReciters());
    return () => {
      this.reciterListeners.delete(callback);
    };
  }

  public subscribeRecitations(callback: (recitations: Recitation[]) => void): () => void {
    this.recitationListeners.add(callback);
    callback(this.getRecitations());
    return () => {
      this.recitationListeners.delete(callback);
    };
  }

  public subscribeCompetitions(callback: (competitions: Competition[]) => void): () => void {
    this.competitionListeners.add(callback);
    callback(this.getCompetitions());
    return () => {
      this.competitionListeners.delete(callback);
    };
  }

  public subscribeAnnouncements(callback: (announcements: Announcement[]) => void): () => void {
    this.announcementListeners.add(callback);
    callback(this.getAnnouncements());
    return () => {
      this.announcementListeners.delete(callback);
    };
  }

  public subscribeHonors(callback: (honors: ReciterHonor[]) => void): () => void {
    this.honorListeners.add(callback);
    callback(this.getHonors());
    return () => {
      this.honorListeners.delete(callback);
    };
  }

  public subscribeSubmissions(callback: (subs: RecitationSubmission[]) => void): () => void {
    this.submissionListeners.add(callback);
    callback(this.getSubmissions());
    return () => {
      this.submissionListeners.delete(callback);
    };
  }

  public subscribeSyncState(callback: (isSyncing: boolean) => void): () => void {
    this.syncStateListeners.add(callback);
    callback(this.isSyncing);
    return () => {
      this.syncStateListeners.delete(callback);
    };
  }

  private notifyReciters(): void {
    const data = this.getReciters();
    this.reciterListeners.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error('[SyncEngine] Error in reciter listener:', err);
      }
    });
  }

  private notifyRecitations(): void {
    const data = this.getRecitations();
    this.recitationListeners.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error('[SyncEngine] Error in recitation listener:', err);
      }
    });
  }

  private notifyCompetitions(): void {
    const data = this.getCompetitions();
    this.competitionListeners.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error('[SyncEngine] Error in competition listener:', err);
      }
    });
  }

  private notifyAnnouncements(): void {
    const data = this.getAnnouncements();
    this.announcementListeners.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error('[SyncEngine] Error in announcement listener:', err);
      }
    });
  }

  private notifyHonors(): void {
    const data = this.getHonors();
    this.honorListeners.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error('[SyncEngine] Error in honor listener:', err);
      }
    });
  }

  private notifySubmissions(): void {
    const data = this.getSubmissions();
    this.submissionListeners.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error('[SyncEngine] Error in submission listener:', err);
      }
    });
  }

  private notifySyncState(): void {
    this.syncStateListeners.forEach((cb) => {
      try {
        cb(this.isSyncing);
      } catch (err) {
        console.error('[SyncEngine] Error in sync state listener:', err);
      }
    });
  }

  // --------------------------------------------------------------------------
  // 4. INCREMENTAL SYNC ENGINE
  // --------------------------------------------------------------------------
  public async performBackgroundSync(forceFull: boolean = false): Promise<void> {
    if (this.syncPromise) {
      return this.syncPromise;
    }

    this.syncPromise = (async () => {
      this.isSyncing = true;
      this.notifySyncState();

      const isCacheEmpty = !this.recitations.length || !this.reciters.length;
      const lastSync = (forceFull || isCacheEmpty) ? null : this.metadata.lastSyncTimestamp;
      const installId = userService.getInstallationId();

      try {
        // Step A: Fetch User Likes in background
        this.syncUserLikes(installId).catch(() => {});

        // Step B: Strategy 1 - Try consolidated Incremental RPC
        let diffSucceeded = false;
        try {
          const { data, error } = await supabase.rpc('get_incremental_sync_diff', {
            p_last_sync_timestamp: lastSync,
            p_installation_id: installId
          });

          if (!error && data) {
            this.applyIncrementalDiff(data);
            diffSucceeded = true;
          }
        } catch (rpcErr) {
          // RPC not available or exception, fallback to direct multi-query incremental sync
          console.warn('[SyncEngine] RPC get_incremental_sync_diff fallback to REST sync:', rpcErr);
        }

        // Step C: Strategy 2 - Direct REST Incremental / Full Sync Fallback
        if (!diffSucceeded || (isCacheEmpty && !this.recitations.length)) {
          await this.performRestIncrementalSync(lastSync, installId);
        }

        // Step D: User Submissions Sync
        await this.syncUserSubmissions(installId);
      } catch (e) {
        console.warn('[SyncEngine] Sync iteration encountered error:', e);
      } finally {
        this.isSyncing = false;
        this.syncPromise = null;
        this.notifySyncState();
      }
    })();

    return this.syncPromise;
  }

  /**
   * Applies the structured diff payload returned from get_incremental_sync_diff RPC
   */
  private applyIncrementalDiff(diff: any): void {
    const syncTime = diff.sync_timestamp || new Date().toISOString();
    let hasReciterChanges = false;
    let hasRecitationChanges = false;
    let hasCompChanges = false;
    let hasAnnoChanges = false;
    let hasHonorChanges = false;

    // 1. Process Tombstones (Deletions)
    if (Array.isArray(diff.tombstones) && diff.tombstones.length > 0) {
      const deletedReciters = new Set<string>();
      const deletedRecitations = new Set<string>();
      const deletedCompetitions = new Set<string>();
      const deletedAnnouncements = new Set<string>();
      const deletedHonors = new Set<string>();

      diff.tombstones.forEach((t: any) => {
        const table = (t.table || '').toLowerCase();
        const id = String(t.id);
        if (table === 'reciters') deletedReciters.add(id);
        else if (table === 'recitations') deletedRecitations.add(id);
        else if (table === 'competitions') deletedCompetitions.add(id);
        else if (table === 'announcements') deletedAnnouncements.add(id);
        else if (table === 'reciter_honors') deletedHonors.add(id);
      });

      if (deletedReciters.size > 0) {
        const prevLen = this.reciters.length;
        this.reciters = this.reciters.filter((r) => !deletedReciters.has(r.id));
        if (this.reciters.length !== prevLen) hasReciterChanges = true;
      }

      if (deletedRecitations.size > 0) {
        const prevLen = this.recitations.length;
        this.recitations = this.recitations.filter((r) => !deletedRecitations.has(r.id));
        if (this.recitations.length !== prevLen) hasRecitationChanges = true;
      }

      if (deletedCompetitions.size > 0) {
        const prevLen = this.competitions.length;
        this.competitions = this.competitions.filter((c) => !deletedCompetitions.has(c.id));
        if (this.competitions.length !== prevLen) hasCompChanges = true;
      }

      if (deletedAnnouncements.size > 0) {
        const prevLen = this.announcements.length;
        this.announcements = this.announcements.filter((a) => !deletedAnnouncements.has(a.id));
        if (this.announcements.length !== prevLen) hasAnnoChanges = true;
      }

      if (deletedHonors.size > 0) {
        const prevLen = this.honors.length;
        this.honors = this.honors.filter((h) => !deletedHonors.has(h.id));
        if (this.honors.length !== prevLen) hasHonorChanges = true;
      }
    }

    // 2. Process Reciters (INSERT & UPDATE)
    if (Array.isArray(diff.reciters) && diff.reciters.length > 0) {
      const mappedNew = diff.reciters.map((d: any) => this.mapRawReciter(d));
      const reciterMap = new Map<string, Reciter>();
      this.reciters.forEach((r) => reciterMap.set(r.id, r));
      mappedNew.forEach((r: Reciter) => reciterMap.set(r.id, r));
      this.reciters = Array.from(reciterMap.values());
      hasReciterChanges = true;
    }

    // 3. Process Recitations (INSERT & UPDATE)
    if (Array.isArray(diff.recitations) && diff.recitations.length > 0) {
      const mappedNew = diff.recitations.map((d: any) => this.mapRawRecitation(d));
      const recMap = new Map<string, Recitation>();
      this.recitations.forEach((r) => recMap.set(r.id, r));
      mappedNew.forEach((r: Recitation) => recMap.set(r.id, r));
      this.recitations = Array.from(recMap.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      hasRecitationChanges = true;
    }

    // 4. Process Competitions
    if (Array.isArray(diff.competitions) && diff.competitions.length > 0) {
      const compMap = new Map<string, Competition>();
      this.competitions.forEach((c) => compMap.set(c.id, c));
      diff.competitions.forEach((d: any) => {
        compMap.set(d.id, {
          id: d.id,
          title: d.title,
          description: d.description,
          startAt: d.start_at,
          endAt: d.end_at,
          linkUrl: d.link_url,
          imagePath: d.image_path ? SupabaseService.resolveImageUrl(d.image_path, 'competition-images') : undefined,
          isPublished: !!d.is_published,
          createdAt: d.created_at
        });
      });
      this.competitions = Array.from(compMap.values()).filter((c) => c.isPublished);
      hasCompChanges = true;
    }

    // 5. Process Announcements
    if (Array.isArray(diff.announcements) && diff.announcements.length > 0) {
      const annoMap = new Map<string, Announcement>();
      this.announcements.forEach((a) => annoMap.set(a.id, a));
      diff.announcements.forEach((d: any) => {
        annoMap.set(d.id, {
          id: d.id,
          title: d.title,
          body: d.body || d.content || '',
          linkUrl: d.link_url,
          imagePath: d.image_path ? SupabaseService.resolveImageUrl(d.image_path, 'announcement-images') : undefined,
          isPublished: !!d.is_published,
          createdAt: d.created_at
        });
      });
      this.announcements = Array.from(annoMap.values()).filter((a) => a.isPublished);
      hasAnnoChanges = true;
    }

    // 6. Process Honors
    if (Array.isArray(diff.honors) && diff.honors.length > 0) {
      const honorMap = new Map<string, ReciterHonor>();
      this.honors.forEach((h) => honorMap.set(h.id, h));
      diff.honors.forEach((d: any) => {
        honorMap.set(d.id, {
          id: d.id,
          reciterId: d.reciter_id,
          reciterName: d.reciter_name,
          reciterAvatar: d.reciter_avatar,
          rewardId: d.reward_id || d.id,
          citationNote: d.citation_note || d.description,
          awardedAt: d.awarded_at || d.created_at,
          reward: d.reward || {
            id: d.reward_id || d.id,
            code: d.reward_code || 'HONOR',
            title: d.title || d.reward_title || 'وسام تقديري',
            description: d.description || d.citation_note || '',
            category: d.category || 'COMMUNITY_FAVORITE',
            isActive: true,
            createdAt: d.created_at || new Date().toISOString()
          }
        });
      });
      this.honors = Array.from(honorMap.values());
      hasHonorChanges = true;
    }

    // 7. Update Metadata & Persist Changes
    this.metadata.lastSyncTimestamp = syncTime;
    SyncStorage.saveMetadata(this.metadata);

    if (hasReciterChanges) {
      SyncStorage.set(KEYS.RECITERS, this.reciters);
      this.notifyReciters();
    }
    if (hasRecitationChanges) {
      SyncStorage.set(KEYS.RECITATIONS, this.recitations);
      this.notifyRecitations();
    }
    if (hasCompChanges) {
      SyncStorage.set(KEYS.COMPETITIONS, this.competitions);
      this.notifyCompetitions();
    }
    if (hasAnnoChanges) {
      SyncStorage.set(KEYS.ANNOUNCEMENTS, this.announcements);
      this.notifyAnnouncements();
    }
    if (hasHonorChanges) {
      SyncStorage.set(KEYS.HONORS, this.honors);
      this.notifyHonors();
    }
  }

  /**
   * Fallback incremental sync using standard Supabase REST endpoints
   */
  private async performRestIncrementalSync(lastSync: string | null, installId: string): Promise<void> {
    const syncTime = new Date().toISOString();

    // 1. Sync Reciters
    try {
      const rawReciters = await SupabaseService.fetchPublicReciters();
      if (Array.isArray(rawReciters) && rawReciters.length > 0) {
        this.reciters = rawReciters.map((d: any) => this.mapRawReciter(d));
        SyncStorage.set(KEYS.RECITERS, this.reciters);
        this.notifyReciters();
      }
    } catch (e) {
      console.warn('[SyncEngine] REST reciters sync warning:', e);
    }

    // 2. Sync Recitations
    try {
      const rawRecitations = await SupabaseService.fetchPublicRecitations();
      if (Array.isArray(rawRecitations) && rawRecitations.length > 0) {
        this.recitations = rawRecitations.map((d: any) => this.mapRawRecitation(d));
        SyncStorage.set(KEYS.RECITATIONS, this.recitations);
        this.notifyRecitations();
      }
    } catch (e) {
      console.warn('[SyncEngine] REST recitations sync warning:', e);
    }

    // 3. Sync Competitions
    try {
      const rawCompetitions = await SupabaseService.fetchPublicCompetitions();
      if (Array.isArray(rawCompetitions)) {
        this.competitions = rawCompetitions;
        SyncStorage.set(KEYS.COMPETITIONS, this.competitions);
        this.notifyCompetitions();
      }
    } catch (e) {
      console.warn('[SyncEngine] REST competitions sync warning:', e);
    }

    // 4. Sync Announcements
    try {
      const rawAnnouncements = await SupabaseService.fetchPublicAnnouncements();
      if (Array.isArray(rawAnnouncements)) {
        this.announcements = rawAnnouncements;
        SyncStorage.set(KEYS.ANNOUNCEMENTS, this.announcements);
        this.notifyAnnouncements();
      }
    } catch (e) {
      console.warn('[SyncEngine] REST announcements sync warning:', e);
    }

    // 5. Sync Honors
    try {
      const rawHonors = await SupabaseService.fetchPublicReciterHonors();
      if (Array.isArray(rawHonors)) {
        this.honors = rawHonors;
        SyncStorage.set(KEYS.HONORS, this.honors);
        this.notifyHonors();
      }
    } catch (e) {
      console.warn('[SyncEngine] REST honors sync warning:', e);
    }

    this.metadata.lastSyncTimestamp = syncTime;
    SyncStorage.saveMetadata(this.metadata);
  }

  /**
   * Syncs user-specific likes
   */
  private async syncUserLikes(installId: string): Promise<void> {
    try {
      const remoteLikes = await SupabaseService.fetchUserLikes(installId);
      this.userLikes = remoteLikes;
      SyncStorage.set(KEYS.LIKES, Array.from(remoteLikes));

      let hasChanges = false;
      this.recitations = this.recitations.map((r) => {
        const liked = remoteLikes.has(r.id);
        if (r.isLiked !== liked) {
          hasChanges = true;
          return { ...r, isLiked: liked };
        }
        return r;
      });

      if (hasChanges) {
        SyncStorage.set(KEYS.RECITATIONS, this.recitations);
        this.notifyRecitations();
      }
    } catch (e) {
      console.warn('[SyncEngine] syncUserLikes warning:', e);
    }
  }

  /**
   * Syncs user-specific recitation submissions
   */
  public async syncUserSubmissions(installId: string): Promise<RecitationSubmission[]> {
    try {
      const res = await fetch(
        `${SUPABASE_CONFIG.restBaseUrl}/recitation_submissions?installation_id=eq.${encodeURIComponent(installId)}&order=created_at.desc`,
        {
          headers: {
            apikey: SUPABASE_CONFIG.anonKey,
            Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`
          }
        }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows)) {
          const remoteMapped: RecitationSubmission[] = rows.map((r: any) => ({
            id: r.id,
            displayName: r.display_name,
            pseudonym: r.pseudonym || undefined,
            usePseudonym: !!r.use_pseudonym,
            gender: r.gender?.toLowerCase() === 'female' ? 'female' : 'male',
            country: r.country || 'العالم الإسلامي',
            avatarUrl: r.profile_image_path ? SupabaseService.resolveImageUrl(r.profile_image_path, 'profile-images') : undefined,
            surahNumber: r.surah_number,
            surahName: r.surah_name,
            ayahRange: r.ayah_start === r.ayah_end ? `${r.ayah_start}` : `${r.ayah_start} - ${r.ayah_end}`,
            riwayah: r.riwayah,
            description: r.description || '',
            audioFileName: r.audio_storage_path?.split('/').pop() || 'audio.mp3',
            audioDuration: 0,
            audioStoragePath: r.audio_storage_path,
            audioUrl: SupabaseService.resolveAudioUrl(r),
            externalAudioUrl: r.external_audio_url,
            externalImageUrl: r.profile_image_path,
            agreeToTerms: true,
            submittedAt: r.created_at,
            status: (
              r.status === 'APPROVED' ? 'approved' :
              r.status === 'APPROVED_UNPUBLISHED' ? 'approved_unpublished' :
              r.status === 'REJECTED' ? 'rejected' : 'pending'
            ),
            adminNotes: r.admin_notes,
            rejectionReason: r.rejection_reason
          }));

          this.submissions = remoteMapped;
          SyncStorage.set(KEYS.SUBMISSIONS, this.submissions);
          this.notifySubmissions();
          return this.submissions;
        }
      }
    } catch (e) {
      console.warn('[SyncEngine] syncUserSubmissions warning:', e);
    }
    return this.submissions;
  }

  // --------------------------------------------------------------------------
  // 5. SUPABASE REALTIME INTEGRATION (Live In-App Updates)
  // --------------------------------------------------------------------------
  public initRealtimeSubscriptions(): void {
    if (this.realtimeRetryTimer) {
      clearTimeout(this.realtimeRetryTimer);
      this.realtimeRetryTimer = null;
    }

    try {
      if (this.realtimeChannel) {
        this.isClosingRealtimeChannel = true;
        try {
          supabase.removeChannel(this.realtimeChannel);
        } catch {}
        this.realtimeChannel = null;
        this.isClosingRealtimeChannel = false;
      }

      const channel = supabase
        .channel('tilawatak_public_sync')
        // 1. Reciters Realtime changes
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'reciters' },
          (payload) => {
            this.handleReciterRealtimeChange(payload);
          }
        )
        // 2. Recitations Realtime changes
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'recitations' },
          (payload) => {
            this.handleRecitationRealtimeChange(payload);
          }
        )
        // 3. Competitions Realtime changes
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'competitions' },
          (payload) => {
            this.handleCompetitionRealtimeChange(payload);
          }
        )
        // 4. Announcements Realtime changes
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'announcements' },
          (payload) => {
            this.handleAnnouncementRealtimeChange(payload);
          }
        )
        // 5. Honors Realtime changes
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'reciter_honors' },
          (payload) => {
            this.handleHonorRealtimeChange(payload);
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log('[SyncEngine] Supabase Realtime channel connected.');
            if (this.realtimeRetryTimer) {
              clearTimeout(this.realtimeRetryTimer);
              this.realtimeRetryTimer = null;
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[SyncEngine] Realtime channel status: ${status}`, err || '');
            if (!this.realtimeRetryTimer) {
              this.realtimeRetryTimer = setTimeout(() => {
                this.realtimeRetryTimer = null;
                this.initRealtimeSubscriptions();
              }, 5000);
            }
          } else if (status === 'CLOSED') {
            if (!this.isClosingRealtimeChannel && !this.realtimeRetryTimer) {
              this.realtimeRetryTimer = setTimeout(() => {
                this.realtimeRetryTimer = null;
                this.initRealtimeSubscriptions();
              }, 5000);
            }
          }
        });

      this.realtimeChannel = channel;
    } catch (e) {
      console.warn('[SyncEngine] Failed to connect Supabase Realtime channel:', e);
    }
  }

  private handleReciterRealtimeChange(payload: any): void {
    const { eventType, new: newRow, old: oldRow } = payload;
    let changed = false;

    if (eventType === 'INSERT') {
      if (newRow && newRow.is_published !== false) {
        const mapped = this.mapRawReciter(newRow);
        this.reciters = [mapped, ...this.reciters.filter((r) => r.id !== mapped.id)];
        changed = true;
      }
    } else if (eventType === 'UPDATE') {
      if (newRow) {
        if (newRow.is_published === false) {
          // If unpublished, remove from public list
          this.reciters = this.reciters.filter((r) => r.id !== newRow.id);
        } else {
          const mapped = this.mapRawReciter(newRow);
          let found = false;
          this.reciters = this.reciters.map((r) => {
            if (r.id === mapped.id) {
              found = true;
              return { ...r, ...mapped };
            }
            return r;
          });
          if (!found) {
            this.reciters.unshift(mapped);
          }
        }
        changed = true;
      }
    } else if (eventType === 'DELETE') {
      if (oldRow?.id) {
        const prevLen = this.reciters.length;
        this.reciters = this.reciters.filter((r) => r.id !== oldRow.id);
        if (this.reciters.length !== prevLen) changed = true;
      }
    }

    if (changed) {
      SyncStorage.set(KEYS.RECITERS, this.reciters);
      this.notifyReciters();
    }
  }

  private handleRecitationRealtimeChange(payload: any): void {
    const { eventType, new: newRow, old: oldRow } = payload;
    let changed = false;

    const isRowApproved = (row: any) =>
      row &&
      row.status === 'APPROVED' &&
      (row.is_published === undefined || row.is_published === null || row.is_published === true);

    if (eventType === 'INSERT') {
      if (isRowApproved(newRow)) {
        const mapped = this.mapRawRecitation(newRow);
        this.recitations = [mapped, ...this.recitations.filter((r) => r.id !== mapped.id)];
        changed = true;

        // If reciter is not yet in cache (e.g. newly approved submission with new reciter), fetch reciters
        if (!this.reciters.some((r) => r.id === newRow.reciter_id)) {
          SupabaseService.fetchPublicReciters().then((raw) => {
            if (Array.isArray(raw) && raw.length > 0) {
              this.reciters = raw.map((d: any) => this.mapRawReciter(d));
              SyncStorage.set(KEYS.RECITERS, this.reciters);
              this.notifyReciters();
              // Re-map recitations to bind fresh reciter names
              this.recitations = this.recitations.map((rec) => {
                const recRaw = {
                  ...rec,
                  reciter_id: rec.reciterId,
                  surah_number: rec.surahNumber,
                  surah_name: rec.surahNameArabic,
                  audio_storage_path: rec.audioUrl,
                  duration_seconds: rec.duration,
                  published_at: rec.createdAt
                };
                return this.mapRawRecitation(recRaw);
              });
              SyncStorage.set(KEYS.RECITATIONS, this.recitations);
              this.notifyRecitations();
            }
          }).catch(() => {});
        }
      }
    } else if (eventType === 'UPDATE') {
      if (newRow) {
        if (!isRowApproved(newRow)) {
          // If status changed away from approved or unpublished, remove from public list
          this.recitations = this.recitations.filter((r) => r.id !== newRow.id);
        } else {
          const mapped = this.mapRawRecitation(newRow);
          let found = false;
          this.recitations = this.recitations.map((r) => {
            if (r.id === mapped.id) {
              found = true;
              return { ...r, ...mapped, isLiked: this.userLikes.has(mapped.id) };
            }
            return r;
          });
          if (!found) {
            this.recitations.unshift(mapped);
          }
        }
        changed = true;
      }
    } else if (eventType === 'DELETE') {
      if (oldRow?.id) {
        const prevLen = this.recitations.length;
        this.recitations = this.recitations.filter((r) => r.id !== oldRow.id);
        if (this.recitations.length !== prevLen) changed = true;
      }
    }

    if (changed) {
      SyncStorage.set(KEYS.RECITATIONS, this.recitations);
      this.notifyRecitations();
    }
  }

  private handleCompetitionRealtimeChange(payload: any): void {
    const { eventType, new: newRow, old: oldRow } = payload;
    let changed = false;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (newRow) {
        if (!newRow.is_published) {
          this.competitions = this.competitions.filter((c) => c.id !== newRow.id);
        } else {
          const mapped: Competition = {
            id: newRow.id,
            title: newRow.title,
            description: newRow.description,
            startAt: newRow.start_at,
            endAt: newRow.end_at,
            linkUrl: newRow.link_url,
            imagePath: newRow.image_path ? SupabaseService.resolveImageUrl(newRow.image_path, 'competition-images') : undefined,
            isPublished: !!newRow.is_published,
            createdAt: newRow.created_at
          };
          this.competitions = [mapped, ...this.competitions.filter((c) => c.id !== mapped.id)];
        }
        changed = true;
      }
    } else if (eventType === 'DELETE') {
      if (oldRow?.id) {
        this.competitions = this.competitions.filter((c) => c.id !== oldRow.id);
        changed = true;
      }
    }

    if (changed) {
      SyncStorage.set(KEYS.COMPETITIONS, this.competitions);
      this.notifyCompetitions();
    }
  }

  private handleAnnouncementRealtimeChange(payload: any): void {
    const { eventType, new: newRow, old: oldRow } = payload;
    let changed = false;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (newRow) {
        if (!newRow.is_published) {
          this.announcements = this.announcements.filter((a) => a.id !== newRow.id);
        } else {
          const mapped: Announcement = {
            id: newRow.id,
            title: newRow.title,
            body: newRow.body || newRow.content || '',
            linkUrl: newRow.link_url,
            imagePath: newRow.image_path ? SupabaseService.resolveImageUrl(newRow.image_path, 'announcement-images') : undefined,
            isPublished: !!newRow.is_published,
            createdAt: newRow.created_at
          };
          this.announcements = [mapped, ...this.announcements.filter((a) => a.id !== mapped.id)];
        }
        changed = true;
      }
    } else if (eventType === 'DELETE') {
      if (oldRow?.id) {
        this.announcements = this.announcements.filter((a) => a.id !== oldRow.id);
        changed = true;
      }
    }

    if (changed) {
      SyncStorage.set(KEYS.ANNOUNCEMENTS, this.announcements);
      this.notifyAnnouncements();
    }
  }

  private handleHonorRealtimeChange(payload: any): void {
    const { eventType, new: newRow, old: oldRow } = payload;
    let changed = false;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      if (newRow) {
        const mapped: ReciterHonor = {
          id: newRow.id,
          reciterId: newRow.reciter_id,
          reciterName: newRow.reciter_name,
          reciterAvatar: newRow.reciter_avatar,
          rewardId: newRow.reward_id || newRow.id,
          citationNote: newRow.citation_note || newRow.description,
          awardedAt: newRow.awarded_at || newRow.created_at,
          reward: newRow.reward || {
            id: newRow.reward_id || newRow.id,
            code: newRow.reward_code || 'HONOR',
            title: newRow.title || newRow.reward_title || 'وسام تقديري',
            description: newRow.description || newRow.citation_note || '',
            category: newRow.category || 'COMMUNITY_FAVORITE',
            isActive: true,
            createdAt: newRow.created_at || new Date().toISOString()
          }
        };
        this.honors = [mapped, ...this.honors.filter((h) => h.id !== mapped.id)];
        changed = true;
      }
    } else if (eventType === 'DELETE') {
      if (oldRow?.id) {
        this.honors = this.honors.filter((h) => h.id !== oldRow.id);
        changed = true;
      }
    }

    if (changed) {
      SyncStorage.set(KEYS.HONORS, this.honors);
      this.notifyHonors();
    }
  }

  // --------------------------------------------------------------------------
  // 6. LIFECYCLE LISTENERS (Tab focus, visibility change, WebView resume)
  // --------------------------------------------------------------------------
  private initLifecycleListeners(): void {
    if (typeof window === 'undefined') return;

    // 1. Android WebView Resume & Tab Visibility Change (Primary standard for Android WebViews)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const last = this.metadata.lastSyncTimestamp;
        const elapsed = last ? Date.now() - new Date(last).getTime() : Infinity;
        // If empty or > 15s since last sync or cold resumed, trigger background sync
        if (!this.recitations.length || elapsed > 15000) {
          this.performBackgroundSync(elapsed > 300000); // force full if > 5 minutes
        }
        // Verify and reconnect Realtime if connection dropped while app was backgrounded
        this.initRealtimeSubscriptions();
      }
    });

    // 2. Window focus fallback
    window.addEventListener('focus', () => {
      const last = this.metadata.lastSyncTimestamp;
      if (!last || Date.now() - new Date(last).getTime() > 20000) {
        this.performBackgroundSync();
      }
    });

    // 3. Online network recovery
    window.addEventListener('online', () => {
      this.performBackgroundSync(true);
      this.initRealtimeSubscriptions();
    });

    // 4. Android WebView Java Interface / postMessage Support (e.g. onResume, onPageFinished)
    window.addEventListener('message', (event) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && (data.type === 'APP_RESUME' || data.type === 'REFRESH_DATA' || data.action === 'SYNC')) {
          this.performBackgroundSync(true);
        }
      } catch {}
    });
  }

  // --------------------------------------------------------------------------
  // 7. OPTIMISTIC MUTATIONS (Likes, Listens, Submissions)
  // --------------------------------------------------------------------------
  public async toggleLike(recitationId: string, installId: string): Promise<LikeResult> {
    const wasLiked = this.userLikes.has(recitationId);
    const willBeLiked = !wasLiked;

    // Optimistic memory & storage update
    if (willBeLiked) {
      this.userLikes.add(recitationId);
    } else {
      this.userLikes.delete(recitationId);
    }
    SyncStorage.set(KEYS.LIKES, Array.from(this.userLikes));

    let finalCount = 0;
    this.recitations = this.recitations.map((r) => {
      if (r.id === recitationId) {
        const count = willBeLiked ? r.likeCount + 1 : Math.max(0, r.likeCount - 1);
        finalCount = count;
        return {
          ...r,
          isLiked: willBeLiked,
          likeCount: count
        };
      }
      return r;
    });

    SyncStorage.set(KEYS.RECITATIONS, this.recitations);
    this.notifyRecitations();

    // Call Supabase RPC in background
    try {
      const rpcResult = await SupabaseService.toggleLike(recitationId, installId);
      if (rpcResult) {
        const serverLiked = !!(rpcResult.is_liked ?? rpcResult.v_new_state);
        const serverCount = Number(rpcResult.total_likes ?? rpcResult.v_count) || 0;

        if (serverLiked !== willBeLiked || serverCount !== finalCount) {
          if (serverLiked) this.userLikes.add(recitationId);
          else this.userLikes.delete(recitationId);
          SyncStorage.set(KEYS.LIKES, Array.from(this.userLikes));

          this.recitations = this.recitations.map((r) => {
            if (r.id === recitationId) {
              return { ...r, isLiked: serverLiked, likeCount: serverCount };
            }
            return r;
          });
          SyncStorage.set(KEYS.RECITATIONS, this.recitations);
          this.notifyRecitations();
          return { isLiked: serverLiked, likeCount: serverCount };
        }
      }
    } catch (e) {
      console.warn('[SyncEngine] toggleLike background RPC warning:', e);
    }

    return { isLiked: willBeLiked, likeCount: finalCount };
  }

  public async recordListenEvent(event: ListenEvent, installId: string): Promise<void> {
    // Optimistic local increment
    this.recitations = this.recitations.map((r) => {
      if (r.id === event.recitationId) {
        return { ...r, listenCount: r.listenCount + 1 };
      }
      return r;
    });
    this.notifyRecitations();

    // Background RPC
    try {
      await SupabaseService.recordListenEvent(
        event.recitationId,
        installId,
        event.durationSeconds || 5,
        event.completed || false
      );
    } catch (e) {
      console.warn('[SyncEngine] recordListenEvent background RPC warning:', e);
    }
  }

  public addSubmissionOptimistic(sub: RecitationSubmission): void {
    this.submissions = [sub, ...this.submissions.filter((s) => s.id !== sub.id)];
    SyncStorage.set(KEYS.SUBMISSIONS, this.submissions);
    this.notifySubmissions();
  }

  // --------------------------------------------------------------------------
  // 8. DATA MAPPERS
  // --------------------------------------------------------------------------
  private mapRawReciter(d: any): Reciter {
    const isAnon = d.use_pseudonym ?? false;
    return {
      id: d.id,
      displayName: d.display_name || d.public_name || 'قارئ',
      pseudonym: d.pseudonym || undefined,
      isAnonymous: isAnon,
      gender: d.gender?.toLowerCase() === 'female' ? 'female' : 'male',
      country: d.country || 'العالم الإسلامي',
      countryCode: d.country_code || 'SA',
      bio: d.bio || '',
      avatarUrl: SupabaseService.resolveImageUrl(d.profile_image_path || d.avatar_url, 'profile-images'),
      bannerUrl: SupabaseService.resolveImageUrl(d.banner_image_path || d.banner_url, 'profile-images'),
      logoUrl: SupabaseService.resolveImageUrl(d.logo_image_path || d.logo_url, 'profile-images'),
      verified: !!d.is_verified,
      isStaffPick: !!(d.is_featured || d.is_staff_pick),
      stats: {
        totalRecitations: Number(d.total_recitations) || 0,
        totalListens: Number(d.total_listens) || 0,
        totalLikes: Number(d.total_likes) || 0
      },
      createdAt: d.created_at || new Date().toISOString()
    };
  }

  private mapRawRecitation(d: any): Recitation {
    const duration = Number(d.duration_seconds) || 180;
    const durMin = Math.floor(duration / 60).toString().padStart(2, '0');
    const durSec = (duration % 60).toString().padStart(2, '0');

    let ayahRange = d.ayah_range;
    if (!ayahRange) {
      if (d.ayah_start && d.ayah_end) {
        ayahRange = d.ayah_start === d.ayah_end ? `${d.ayah_start}` : `${d.ayah_start} - ${d.ayah_end}`;
      } else {
        ayahRange = 'كاملة';
      }
    }

    const reciter = this.reciters.find((r) => r.id === d.reciter_id);
    const reciterName =
      d.reciter_name ||
      (reciter ? (reciter.isAnonymous && reciter.pseudonym ? reciter.pseudonym : reciter.displayName) : 'قارئ');
    const reciterAvatar =
      d.reciter_avatar ||
      d.avatar_url ||
      (reciter ? reciter.avatarUrl : undefined);
    const reciterBannerUrl =
      d.reciter_banner ||
      d.banner_image_path ||
      (reciter ? reciter.bannerUrl : undefined);
    const reciterLogoUrl =
      d.reciter_logo ||
      d.logo_image_path ||
      (reciter ? reciter.logoUrl : undefined);
    const reciterCountry =
      d.reciter_country ||
      (reciter ? reciter.country : '');

    return {
      id: d.id,
      reciterId: d.reciter_id,
      reciterName,
      reciterAvatar: SupabaseService.resolveImageUrl(reciterAvatar, 'profile-images'),
      reciterBannerUrl: SupabaseService.resolveImageUrl(reciterBannerUrl, 'profile-images'),
      reciterLogoUrl: SupabaseService.resolveImageUrl(reciterLogoUrl, 'profile-images'),
      reciterCountry,
      surahNumber: Number(d.surah_number) || 1,
      surahNameArabic: d.surah_name || d.surah_name_arabic || 'سورة',
      surahNameEnglish: d.surah_name_english || '',
      ayahRange,
      riwayah: d.riwayah || 'حفص عن عاصم',
      duration,
      durationFormatted: `${durMin}:${durSec}`,
      audioUrl: SupabaseService.resolveAudioUrl(d),
      coverUrl: d.cover_image_path ? SupabaseService.resolveImageUrl(d.cover_image_path, 'recitation-covers') : undefined,
      listenCount: Number(d.listen_count ?? d.total_listens ?? 0),
      likeCount: Number(d.like_count ?? d.total_likes ?? 0),
      isLiked: this.userLikes.has(d.id),
      isStaffPick: !!d.is_staff_pick,
      isFeatured: !!d.is_featured,
      description: d.description || '',
      createdAt: d.published_at || d.created_at || new Date().toISOString()
    };
  }
}

export const syncEngine = SyncEngine.getInstance();
