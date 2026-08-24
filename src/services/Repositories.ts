import {
  Reciter,
  Recitation,
  RecitationSubmission,
  SubmissionStatus,
  ListenEvent,
  LikeResult,
  Competition,
  Announcement,
  ReciterHonor
} from '../types';
import { SupabaseService } from './SupabaseService';
import { userService } from './UserService';
import { syncEngine } from './SyncEngine';

export enum DataSourceMode {
  MOCK = 'MOCK',
  SUPABASE = 'SUPABASE'
}

let currentDataSourceMode: DataSourceMode = DataSourceMode.SUPABASE;

export function getDataSourceMode(): DataSourceMode {
  return currentDataSourceMode;
}

export function setDataSourceMode(mode: DataSourceMode) {
  currentDataSourceMode = mode;
}

// ============================================================================
// DOMAIN REPOSITORY INTERFACES (Clean Architecture - Backend Agnostic)
// ============================================================================

/**
 * Repository interface for managing and querying Reciters.
 * Compatible with Kotlin Flow streams and suspend functions.
 */
export interface IReciterRepository {
  getRecitersStream(onUpdate?: (reciters: Reciter[]) => void): () => void;
  getAllReciters(): Promise<Reciter[]>;
  getReciterById(id: string): Promise<Reciter | null>;
  getFeaturedReciters(): Promise<Reciter[]>;
  searchReciters(query: string): Promise<Reciter[]>;
  getNewestReciters(limit?: number): Promise<Reciter[]>;
}

/**
 * Repository interface for managing Recitations, user-specific like states,
 * and listen event ingestion.
 */
export interface IRecitationRepository {
  getRecitationsStream(onUpdate?: (recitations: Recitation[]) => void): () => void;
  getAllRecitations(): Promise<Recitation[]>;
  getRecitationsByReciter(reciterId: string): Promise<Recitation[]>;
  toggleLike(recitationId: string, userId?: string): Promise<LikeResult>;
  recordListenEvent(event: ListenEvent): Promise<void>;
}

/**
 * Repository interface for fetching ranking, discovery, and statistical metrics.
 * Decouples sorting and ranking logic from the UI presentation layer.
 */
export interface IStatisticsRepository {
  getMostListenedRecitations(limit?: number): Promise<Recitation[]>;
  getMostLikedRecitations(limit?: number): Promise<Recitation[]>;
  getMostListenedReciters(limit?: number): Promise<Reciter[]>;
  getMostLikedReciters(limit?: number): Promise<Reciter[]>;
  getNewestRecitations(limit?: number): Promise<Recitation[]>;
}

/**
 * Repository interface for handling recitation submission drafts and moderation status.
 */
export interface ISubmissionRepository {
  submitRecitation(
    submission: Omit<RecitationSubmission, 'id' | 'submittedAt' | 'status'>
  ): Promise<RecitationSubmission>;
  getUserSubmissions(): Promise<RecitationSubmission[]>;
}

export interface ICompetitionRepository {
  getPublishedCompetitions(): Promise<Competition[]>;
  getCompetitionsStream(onUpdate?: (competitions: Competition[]) => void): () => void;
}

export interface IAnnouncementRepository {
  getPublishedAnnouncements(): Promise<Announcement[]>;
  getAnnouncementsStream(onUpdate?: (announcements: Announcement[]) => void): () => void;
}

export interface IHonorRepository {
  getReciterHonors(reciterId?: string): Promise<ReciterHonor[]>;
  getHonorsStream(onUpdate?: (honors: ReciterHonor[]) => void): () => void;
}

// ============================================================================
// CACHE-FIRST REPOSITORY IMPLEMENTATIONS (Powered by SyncEngine)
// ============================================================================

class SyncReciterRepository implements IReciterRepository {
  getRecitersStream(onUpdate?: (reciters: Reciter[]) => void): () => void {
    if (!onUpdate) return () => {};
    return syncEngine.subscribeReciters(onUpdate);
  }

  async getAllReciters(): Promise<Reciter[]> {
    return syncEngine.getReciters();
  }

  async getReciterById(id: string): Promise<Reciter | null> {
    const list = syncEngine.getReciters();
    return list.find((r) => r.id === id) || null;
  }

  async getFeaturedReciters(): Promise<Reciter[]> {
    const list = syncEngine.getReciters();
    return list.filter((r) => r.isStaffPick || r.verified);
  }

  async searchReciters(query: string): Promise<Reciter[]> {
    const list = syncEngine.getReciters();
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.displayName.toLowerCase().includes(q) ||
        r.country.toLowerCase().includes(q) ||
        (r.pseudonym && r.pseudonym.toLowerCase().includes(q))
    );
  }

  async getNewestReciters(limit: number = 10): Promise<Reciter[]> {
    const list = syncEngine.getReciters();
    return [...list]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
}

class SyncRecitationRepository implements IRecitationRepository {
  getRecitationsStream(onUpdate?: (recitations: Recitation[]) => void): () => void {
    if (!onUpdate) return () => {};
    return syncEngine.subscribeRecitations(onUpdate);
  }

  async getAllRecitations(): Promise<Recitation[]> {
    return syncEngine.getRecitations();
  }

  async getRecitationsByReciter(reciterId: string): Promise<Recitation[]> {
    const all = syncEngine.getRecitations();
    return all
      .filter((r) => r.reciterId === reciterId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async toggleLike(recitationId: string, userId?: string): Promise<LikeResult> {
    const installId = userId || userService.getInstallationId();
    return syncEngine.toggleLike(recitationId, installId);
  }

  async recordListenEvent(event: ListenEvent): Promise<void> {
    const installId = userService.getInstallationId();
    return syncEngine.recordListenEvent(event, installId);
  }
}

class SyncStatisticsRepository implements IStatisticsRepository {
  async getMostListenedRecitations(limit: number = 10): Promise<Recitation[]> {
    const all = syncEngine.getRecitations();
    return [...all].sort((a, b) => b.listenCount - a.listenCount).slice(0, limit);
  }

  async getMostLikedRecitations(limit: number = 10): Promise<Recitation[]> {
    const all = syncEngine.getRecitations();
    return [...all].sort((a, b) => b.likeCount - a.likeCount).slice(0, limit);
  }

  async getMostListenedReciters(limit: number = 10): Promise<Reciter[]> {
    const allReciters = syncEngine.getReciters();
    const allRecitations = syncEngine.getRecitations();

    const reciterListensMap = new Map<string, number>();
    const reciterLikesMap = new Map<string, number>();
    const reciterCountMap = new Map<string, number>();

    allRecitations.forEach((r) => {
      reciterListensMap.set(r.reciterId, (reciterListensMap.get(r.reciterId) || 0) + (r.listenCount || 0));
      reciterLikesMap.set(r.reciterId, (reciterLikesMap.get(r.reciterId) || 0) + (r.likeCount || 0));
      reciterCountMap.set(r.reciterId, (reciterCountMap.get(r.reciterId) || 0) + 1);
    });

    const enriched = allReciters.map((rec) => {
      const recListens = reciterListensMap.get(rec.id);
      const recLikes = reciterLikesMap.get(rec.id);
      const recCount = reciterCountMap.get(rec.id);
      return {
        ...rec,
        stats: {
          totalRecitations: recCount !== undefined ? Math.max(rec.stats.totalRecitations, recCount) : rec.stats.totalRecitations,
          totalListens: recListens !== undefined ? Math.max(rec.stats.totalListens, recListens) : rec.stats.totalListens,
          totalLikes: recLikes !== undefined ? Math.max(rec.stats.totalLikes, recLikes) : rec.stats.totalLikes
        }
      };
    });

    return [...enriched].sort((a, b) => b.stats.totalListens - a.stats.totalListens).slice(0, limit);
  }

  async getMostLikedReciters(limit: number = 10): Promise<Reciter[]> {
    const allReciters = syncEngine.getReciters();
    const allRecitations = syncEngine.getRecitations();

    const reciterLikesMap = new Map<string, number>();
    const reciterListensMap = new Map<string, number>();
    const reciterCountMap = new Map<string, number>();

    allRecitations.forEach((r) => {
      reciterListensMap.set(r.reciterId, (reciterListensMap.get(r.reciterId) || 0) + (r.listenCount || 0));
      reciterLikesMap.set(r.reciterId, (reciterLikesMap.get(r.reciterId) || 0) + (r.likeCount || 0));
      reciterCountMap.set(r.reciterId, (reciterCountMap.get(r.reciterId) || 0) + 1);
    });

    const enriched = allReciters.map((rec) => {
      const recListens = reciterListensMap.get(rec.id);
      const recLikes = reciterLikesMap.get(rec.id);
      const recCount = reciterCountMap.get(rec.id);
      return {
        ...rec,
        stats: {
          totalRecitations: recCount !== undefined ? Math.max(rec.stats.totalRecitations, recCount) : rec.stats.totalRecitations,
          totalListens: recListens !== undefined ? Math.max(rec.stats.totalListens, recListens) : rec.stats.totalListens,
          totalLikes: recLikes !== undefined ? Math.max(rec.stats.totalLikes, recLikes) : rec.stats.totalLikes
        }
      };
    });

    return [...enriched].sort((a, b) => b.stats.totalLikes - a.stats.totalLikes).slice(0, limit);
  }

  async getNewestRecitations(limit: number = 10): Promise<Recitation[]> {
    const all = syncEngine.getRecitations();
    return [...all]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
}

class SyncSubmissionRepository implements ISubmissionRepository {
  async getUserSubmissions(): Promise<RecitationSubmission[]> {
    const installId = userService.getInstallationId();
    // Return cached immediately and refresh in background
    syncEngine.syncUserSubmissions(installId).catch(() => {});
    return syncEngine.getSubmissions();
  }

  async submitRecitation(
    data: Omit<RecitationSubmission, 'id' | 'submittedAt' | 'status'>
  ): Promise<RecitationSubmission> {
    const submissionId = `sub-${Date.now()}`;
    const newSubmission: RecitationSubmission = {
      ...data,
      id: submissionId,
      submittedAt: new Date().toISOString(),
      status: 'pending',
      adminNotes: 'تم استلام طلبكم وهو قيد المراجعة والتدقيق الصوتي والتجويدي من قبل الإدارة.'
    };

    let ayahStart = 1;
    let ayahEnd = 1;
    if (data.ayahRange) {
      const nums = data.ayahRange.match(/\d+/g);
      if (nums && nums.length >= 2) {
        ayahStart = parseInt(nums[0], 10) || 1;
        ayahEnd = parseInt(nums[1], 10) || ayahStart;
      } else if (nums && nums.length === 1) {
        ayahStart = parseInt(nums[0], 10) || 1;
        ayahEnd = ayahStart;
      }
    }

    const storagePath = data.audioStoragePath || '';
    const installId = userService.getInstallationId();

    try {
      const submitRes = await SupabaseService.submitRecitation({
        display_name: data.displayName,
        pseudonym: data.pseudonym || null,
        use_pseudonym: !!data.usePseudonym,
        gender: data.gender?.toUpperCase() === 'FEMALE' ? 'FEMALE' : 'MALE',
        country: data.country || 'العالم الإسلامي',
        profile_image_path: data.externalImageUrl || data.avatarUrl || null,
        surah_number: data.surahNumber,
        surah_name: data.surahName,
        ayah_start: ayahStart,
        ayah_end: ayahEnd,
        riwayah: data.riwayah || 'حفص عن عاصم',
        description: data.description || '',
        audio_storage_path: storagePath,
        external_audio_url: data.externalAudioUrl || null,
        installation_id: installId,
        status: 'PENDING'
      });

      if (submitRes?.id) {
        newSubmission.id = submitRes.id;
      }
    } catch (e) {
      console.warn('[SyncSubmissionRepository] submitRecitation Supabase error:', e);
    }

    syncEngine.addSubmissionOptimistic(newSubmission);
    return newSubmission;
  }
}

class SyncCompetitionRepository implements ICompetitionRepository {
  async getPublishedCompetitions(): Promise<Competition[]> {
    return syncEngine.getCompetitions();
  }

  getCompetitionsStream(onUpdate?: (competitions: Competition[]) => void): () => void {
    if (!onUpdate) return () => {};
    return syncEngine.subscribeCompetitions(onUpdate);
  }
}

class SyncAnnouncementRepository implements IAnnouncementRepository {
  async getPublishedAnnouncements(): Promise<Announcement[]> {
    return syncEngine.getAnnouncements();
  }

  getAnnouncementsStream(onUpdate?: (announcements: Announcement[]) => void): () => void {
    if (!onUpdate) return () => {};
    return syncEngine.subscribeAnnouncements(onUpdate);
  }
}

class SyncHonorRepository implements IHonorRepository {
  async getReciterHonors(reciterId?: string): Promise<ReciterHonor[]> {
    return syncEngine.getHonors(reciterId);
  }

  getHonorsStream(onUpdate?: (honors: ReciterHonor[]) => void): () => void {
    if (!onUpdate) return () => {};
    return syncEngine.subscribeHonors(onUpdate);
  }
}

// ============================================================================
// SINGLETON REPOSITORY INSTANCES (Dependency Injection)
// ============================================================================

export const reciterRepository: IReciterRepository = new SyncReciterRepository();
export const recitationRepository: IRecitationRepository = new SyncRecitationRepository();
export const statisticsRepository: IStatisticsRepository = new SyncStatisticsRepository();
export const submissionRepository: ISubmissionRepository = new SyncSubmissionRepository();
export const competitionRepository: ICompetitionRepository = new SyncCompetitionRepository();
export const announcementRepository: IAnnouncementRepository = new SyncAnnouncementRepository();
export const honorRepository: IHonorRepository = new SyncHonorRepository();
