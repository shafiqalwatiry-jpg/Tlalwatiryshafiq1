/**
 * UserService & NotificationService
 * Supabase-first reactive identity, user profiles, and real-time personal notification records.
 */

import { UserProfile, UserNotification } from '../types';
import { SUPABASE_CONFIG, supabase } from './SupabaseService';
import { triggerSystemNotification } from '../utils/notificationUtils';
import type { RealtimeChannel } from '@supabase/supabase-js';

const INSTALLATION_KEY = 'tilawatak_installation_id';
const USER_PROFILE_KEY = 'tilawatak_user_profile_v1';
const USER_NOTIFICATIONS_KEY = 'tilawatak_notifications_v1';

export class UserService {
  private static instance: UserService;
  private currentInstallationId: string = '';
  private currentProfile: UserProfile | null = null;
  private notifications: UserNotification[] = [];
  private listeners: Set<(profile: UserProfile | null) => void> = new Set();
  private notificationListeners: Set<(notifs: UserNotification[]) => void> = new Set();

  private profileRealtimeChannel: RealtimeChannel | null = null;
  private notifRealtimeChannel: RealtimeChannel | null = null;
  private fallbackSyncTimer: any = null;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.initInstallation();
      this.loadLocalProfile();
      this.loadNotifications();
      this.ensureVisitorRegistered();
      this.initRealtimeSubscriptions();
      this.setupLifecycleSync();
    }
  }

  public static getInstance(): UserService {
    if (!UserService.instance) {
      UserService.instance = new UserService();
    }
    return UserService.instance;
  }

  private initInstallation() {
    let installId = localStorage.getItem(INSTALLATION_KEY);
    if (!installId) {
      installId = `inst_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem(INSTALLATION_KEY, installId);
    }
    this.currentInstallationId = installId;
  }

  public getInstallationId(): string {
    if (!this.currentInstallationId) {
      this.initInstallation();
    }
    return this.currentInstallationId;
  }

  /**
   * Initializes Supabase Realtime Channels for user profile and notifications
   */
  private initRealtimeSubscriptions() {
    const installId = this.getInstallationId();
    if (!installId) return;

    try {
      // 1. Subscribe to User Profile changes (e.g. Admin updates, suspension, or deletion)
      if (this.profileRealtimeChannel) {
        supabase.removeChannel(this.profileRealtimeChannel);
      }

      this.profileRealtimeChannel = supabase
        .channel(`realtime:user_profile_${installId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_profiles',
            filter: `installation_id=eq.${installId}`
          },
          (payload) => {
            if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
              const r: any = payload.new;
              if (r) {
                const updated: UserProfile = {
                  id: r.id,
                  installationId: r.installation_id,
                  displayName: r.display_name || 'زائر المنصة',
                  avatarUrl: r.avatar_url,
                  country: r.country || 'العالم الإسلامي',
                  userType: r.user_type || 'LISTENER',
                  bio: r.bio || '',
                  email: r.email,
                  whatsapp: r.whatsapp,
                  isProfileCompleted: !!r.is_profile_completed,
                  isSuspended: !!r.is_suspended,
                  suspendedReason: r.suspended_reason || undefined,
                  lastActiveAt: r.last_active_at,
                  createdAt: r.created_at
                };
                this.currentProfile = updated;
                localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(updated));
                this.notifyProfileListeners();
              }
            } else if (payload.eventType === 'DELETE') {
              // Admin deleted this user profile from database -> Reset cleanly
              const resetProfile: UserProfile = {
                installationId: installId,
                displayName: 'زائر المنصة',
                country: 'العالم الإسلامي',
                userType: 'LISTENER',
                isProfileCompleted: false,
                lastActiveAt: new Date().toISOString(),
                createdAt: new Date().toISOString()
              };
              this.currentProfile = resetProfile;
              localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(resetProfile));
              this.notifyProfileListeners();
            }
          }
        )
        .subscribe();

      // 2. Subscribe to In-App User Notifications (e.g. Submissions status, broadcasts, admin alerts)
      if (this.notifRealtimeChannel) {
        supabase.removeChannel(this.notifRealtimeChannel);
      }

      this.notifRealtimeChannel = supabase
        .channel(`realtime:user_notifications_${installId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_notifications',
            filter: `installation_id=eq.${installId}`
          },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              const r: any = payload.new;
              if (r) {
                const newNotif: UserNotification = {
                  id: r.id,
                  installationId: r.installation_id,
                  title: r.title,
                  body: r.body,
                  notificationType: r.notification_type || 'SUBMISSION_STATUS',
                  referenceId: r.reference_id,
                  rejectionReason: r.rejection_reason,
                  isRead: !!r.is_read,
                  createdAt: r.created_at
                };

                const exists = this.notifications.some((n) => n.id === newNotif.id);
                if (!exists) {
                  this.notifications = [newNotif, ...this.notifications];
                  localStorage.setItem(USER_NOTIFICATIONS_KEY, JSON.stringify(this.notifications));
                  this.notifyNotificationListeners();

                  // Trigger native system / browser push notification
                  triggerSystemNotification({
                    id: newNotif.id,
                    title: newNotif.title,
                    body: newNotif.body,
                    tag: newNotif.referenceId
                  });
                }
              }
            } else if (payload.eventType === 'UPDATE') {
              const r: any = payload.new;
              if (r) {
                this.notifications = this.notifications.map((n) =>
                  n.id === r.id
                    ? {
                        ...n,
                        title: r.title,
                        body: r.body,
                        isRead: !!r.is_read,
                        rejectionReason: r.rejection_reason
                      }
                    : n
                );
                localStorage.setItem(USER_NOTIFICATIONS_KEY, JSON.stringify(this.notifications));
                this.notifyNotificationListeners();
              }
            } else if (payload.eventType === 'DELETE') {
              const oldRow: any = payload.old;
              if (oldRow?.id) {
                this.notifications = this.notifications.filter((n) => n.id !== oldRow.id);
                localStorage.setItem(USER_NOTIFICATIONS_KEY, JSON.stringify(this.notifications));
                this.notifyNotificationListeners();
              }
            }
          }
        )
        .subscribe();
    } catch (err) {
      console.warn('Realtime subscription setup warning:', err);
    }
  }

  private setupLifecycleSync() {
    if (typeof window === 'undefined') return;
    const onResume = () => {
      if (document.visibilityState === 'visible') {
        this.syncWithRemoteProfile().catch(() => {});
        this.fetchRemoteNotifications().catch(() => {});
      }
    };
    window.addEventListener('visibilitychange', onResume);
    window.addEventListener('online', onResume);
  }

  public async ensureVisitorRegistered(): Promise<void> {
    const installId = this.getInstallationId();
    const profile = this.getProfile();
    // Only update active timestamp if profile is already registered/completed or has remote ID
    if (!profile.isProfileCompleted && !profile.id) {
      return;
    }
    try {
      await supabase
        .from('user_profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('installation_id', installId);
    } catch (e) {
      console.warn('Auto update visitor activity skipped:', e);
    }
  }

  private loadLocalProfile() {
    try {
      const stored = localStorage.getItem(USER_PROFILE_KEY);
      if (stored) {
        this.currentProfile = JSON.parse(stored);
      } else {
        this.currentProfile = {
          installationId: this.getInstallationId(),
          displayName: 'زائر المنصة',
          country: 'العالم الإسلامي',
          userType: 'LISTENER',
          isProfileCompleted: false,
          lastActiveAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        };
      }
    } catch {
      this.currentProfile = {
        installationId: this.getInstallationId(),
        displayName: 'زائر المنصة',
        country: 'العالم الإسلامي',
        userType: 'LISTENER',
        isProfileCompleted: false,
        lastActiveAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
    }
  }

  public async syncWithRemoteProfile(): Promise<UserProfile> {
    const installId = this.getInstallationId();
    try {
      const res = await fetch(
        `${SUPABASE_CONFIG.restBaseUrl}/user_profiles?installation_id=eq.${encodeURIComponent(installId)}&select=*`,
        {
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
          }
        }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0) {
          const r = rows[0];
          const remoteProfile: UserProfile = {
            id: r.id,
            installationId: r.installation_id,
            displayName: r.display_name || 'زائر المنصة',
            avatarUrl: r.avatar_url,
            country: r.country || 'العالم الإسلامي',
            userType: r.user_type || 'LISTENER',
            bio: r.bio || '',
            email: r.email,
            whatsapp: r.whatsapp,
            isProfileCompleted: !!r.is_profile_completed || (r.display_name && r.display_name !== 'زائر المنصة'),
            isSuspended: !!r.is_suspended,
            suspendedReason: r.suspended_reason || undefined,
            lastActiveAt: r.last_active_at,
            createdAt: r.created_at
          };
          this.currentProfile = remoteProfile;
          localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(remoteProfile));
          this.notifyProfileListeners();
          return remoteProfile;
        } else if (Array.isArray(rows) && rows.length === 0 && this.currentProfile?.id) {
          // If was previously registered but not found in DB anymore, it was deleted by admin
          const freshVisitor: UserProfile = {
            installationId: installId,
            displayName: 'زائر المنصة',
            country: 'العالم الإسلامي',
            userType: 'LISTENER',
            isProfileCompleted: false,
            lastActiveAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
          };
          this.currentProfile = freshVisitor;
          localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(freshVisitor));
          this.notifyProfileListeners();
          return freshVisitor;
        }
      }
    } catch (e) {
      console.warn('Sync profile with Supabase skipped:', e);
    }
    return this.getProfile();
  }

  public getProfile(): UserProfile {
    if (!this.currentProfile) {
      this.loadLocalProfile();
    }
    return this.currentProfile!;
  }

  public subscribeProfile(listener: (profile: UserProfile | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.currentProfile);
    return () => this.listeners.delete(listener);
  }

  private notifyProfileListeners() {
    this.listeners.forEach((fn) => fn(this.currentProfile));
  }

  public async saveProfile(updated: Partial<UserProfile>): Promise<UserProfile> {
    const installId = this.getInstallationId();
    const current = this.getProfile();

    const merged: UserProfile = {
      ...current,
      ...updated,
      installationId: installId,
      isProfileCompleted: true,
      lastActiveAt: new Date().toISOString()
    };

    this.currentProfile = merged;
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(merged));
    this.notifyProfileListeners();

    // Push to Supabase user_profiles via upsert
    try {
      const payload: any = {
        installation_id: installId,
        display_name: merged.displayName,
        avatar_url: merged.avatarUrl || null,
        country: merged.country,
        user_type: merged.userType,
        bio: merged.bio || '',
        email: merged.email || null,
        whatsapp: merged.whatsapp || null,
        is_profile_completed: true,
        last_active_at: merged.lastActiveAt
      };

      const { data, error } = await supabase
        .from('user_profiles')
        .upsert(payload, { onConflict: 'installation_id' })
        .select('id, created_at')
        .single();

      if (!error && data?.id) {
        merged.id = data.id;
        if (data.created_at) merged.createdAt = data.created_at;
        this.currentProfile = merged;
        localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(merged));
        this.notifyProfileListeners();
      }
    } catch (e) {
      console.warn('Save user profile remote sync error:', e);
    }

    return merged;
  }

  // ==========================================
  // Notifications System (DB-First + Realtime)
  // ==========================================

  private loadNotifications() {
    try {
      const stored = localStorage.getItem(USER_NOTIFICATIONS_KEY);
      if (stored) {
        this.notifications = JSON.parse(stored);
      } else {
        this.notifications = [];
        localStorage.setItem(USER_NOTIFICATIONS_KEY, JSON.stringify(this.notifications));
      }
    } catch {
      this.notifications = [];
    }
  }

  public subscribeNotifications(listener: (notifs: UserNotification[]) => void): () => void {
    this.notificationListeners.add(listener);
    listener([...this.notifications]);
    return () => this.notificationListeners.delete(listener);
  }

  private notifyNotificationListeners() {
    const copy = [...this.notifications];
    this.notificationListeners.forEach((fn) => fn(copy));
  }

  public async fetchRemoteNotifications(): Promise<UserNotification[]> {
    const installId = this.getInstallationId();
    try {
      const res = await fetch(
        `${SUPABASE_CONFIG.restBaseUrl}/user_notifications?installation_id=eq.${encodeURIComponent(installId)}&order=created_at.desc`,
        {
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
          }
        }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows)) {
          const mapped: UserNotification[] = rows.map((r: any) => ({
            id: r.id,
            installationId: r.installation_id,
            title: r.title,
            body: r.body,
            notificationType: r.notification_type || 'SUBMISSION_STATUS',
            referenceId: r.reference_id,
            rejectionReason: r.rejection_reason,
            isRead: !!r.is_read,
            createdAt: r.created_at
          }));

          const existingIds = new Set(this.notifications.map((n) => n.id));
          mapped.forEach((notif) => {
            if (!notif.isRead && !existingIds.has(notif.id)) {
              triggerSystemNotification({
                id: notif.id,
                title: notif.title,
                body: notif.body,
                tag: notif.referenceId
              });
            }
          });

          this.notifications = mapped;
          localStorage.setItem(USER_NOTIFICATIONS_KEY, JSON.stringify(this.notifications));
          this.notifyNotificationListeners();
          return this.notifications;
        }
      }
    } catch (e) {
      console.warn('Fetch remote notifications error:', e);
    }
    return this.notifications;
  }

  public addNotification(notification: Omit<UserNotification, 'id' | 'createdAt' | 'isRead'>): UserNotification {
    const newNotif: UserNotification = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      isRead: false,
      createdAt: new Date().toISOString()
    };

    this.notifications.unshift(newNotif);
    localStorage.setItem(USER_NOTIFICATIONS_KEY, JSON.stringify(this.notifications));
    this.notifyNotificationListeners();

    triggerSystemNotification({
      id: newNotif.id,
      title: newNotif.title,
      body: newNotif.body,
      tag: newNotif.referenceId
    });

    try {
      fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_notifications`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          installation_id: newNotif.installationId,
          title: newNotif.title,
          body: newNotif.body,
          notification_type: newNotif.notificationType,
          reference_id: newNotif.referenceId || null,
          rejection_reason: newNotif.rejectionReason || null,
          is_read: false
        })
      }).catch(() => {});
    } catch {}

    return newNotif;
  }

  public markNotificationAsRead(id: string) {
    this.notifications = this.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n));
    localStorage.setItem(USER_NOTIFICATIONS_KEY, JSON.stringify(this.notifications));
    this.notifyNotificationListeners();

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      try {
        fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_notifications?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ is_read: true })
        }).catch(() => {});
      } catch {}
    }
  }

  public markAllNotificationsAsRead() {
    this.notifications = this.notifications.map((n) => ({ ...n, isRead: true }));
    localStorage.setItem(USER_NOTIFICATIONS_KEY, JSON.stringify(this.notifications));
    this.notifyNotificationListeners();

    try {
      const installId = this.getInstallationId();
      fetch(`${SUPABASE_CONFIG.restBaseUrl}/user_notifications?installation_id=eq.${encodeURIComponent(installId)}&is_read=eq.false`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ is_read: true })
      }).catch(() => {});
    } catch {}
  }

  public getUnreadNotificationsCount(): number {
    return this.notifications.filter((n) => !n.isRead).length;
  }
}

export const userService = UserService.getInstance();

