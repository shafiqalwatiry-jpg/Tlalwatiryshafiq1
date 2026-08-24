import React, { useState, useEffect } from 'react';
import { adminService } from '../../services/AdminService';
import { UserProfile } from '../../types';
import {
  Users,
  Search,
  CheckCircle2,
  XCircle,
  Mail,
  Phone,
  Globe,
  Calendar,
  Clock,
  Shield,
  ShieldAlert,
  Trash2,
  RefreshCw,
  UserCheck,
  Headphones,
  Mic2,
  Edit,
  Ban,
  Unlock,
  X,
  Save,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Activity,
  FileText,
  Play,
  Filter
} from 'lucide-react';
import { CountrySelectField } from '../CountrySelectField';
import { SupabaseService, supabase } from '../../services/SupabaseService';
import { userService } from '../../services/UserService';
import { Send } from 'lucide-react';

export const AdminUsersView: React.FC = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterRecitations, setFilterRecitations] = useState<string>('all');
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('latest');
  const [pageSize, setPageSize] = useState<number>(20);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Selected User Modal & Edit State
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [userRecitations, setUserRecitations] = useState<any[]>([]);
  const [userActivityLogs, setUserActivityLogs] = useState<any[]>([]);
  const [loadingUserDetails, setLoadingUserDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'recitations' | 'activity' | 'notification'>('profile');

  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<UserProfile>>({});
  const [actionLoading, setActionLoading] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [showSuspendPrompt, setShowSuspendPrompt] = useState(false);

  // Direct User Notification Form State
  const [directNotifTitle, setDirectNotifTitle] = useState('');
  const [directNotifBody, setDirectNotifBody] = useState('');
  const [isSendingDirectNotif, setIsSendingDirectNotif] = useState(false);
  const [directNotifSuccess, setDirectNotifSuccess] = useState<string | null>(null);
  const [directNotifError, setDirectNotifError] = useState<string | null>(null);

  // Audio preview state in modal
  const [playingRecId, setPlayingRecId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await adminService.getUsers();
      setUsers(data);
    } catch (e) {
      console.warn('Failed to load users:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();

    // Supabase Realtime Subscription for instant bi-directional updates
    const channel = supabase
      .channel('realtime:admin_users_view')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_profiles' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const r: any = payload.new;
            if (r) {
              const mapped = {
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
              };
              setUsers((prev) => {
                if (prev.some((u) => u.id === mapped.id || u.installationId === mapped.installationId)) {
                  return prev.map((u) => (u.id === mapped.id || u.installationId === mapped.installationId ? mapped : u));
                }
                return [mapped, ...prev];
              });
            }
          } else if (payload.eventType === 'UPDATE') {
            const r: any = payload.new;
            if (r) {
              const mapped = {
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
              };
              setUsers((prev) => prev.map((u) => (u.id === mapped.id ? mapped : u)));
              setSelectedUser((current: any) => (current && current.id === mapped.id ? mapped : current));
            }
          } else if (payload.eventType === 'DELETE') {
            const oldRow: any = payload.old;
            if (oldRow?.id) {
              setUsers((prev) => prev.filter((u) => u.id !== oldRow.id));
              setSelectedUser((current: any) => (current && current.id === oldRow.id ? null : current));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleOpenUserDetails = async (user: any) => {
    setSelectedUser(user);
    setEditFormData({
      displayName: user.displayName,
      country: user.country,
      bio: user.bio,
      userType: user.userType,
      email: user.email,
      whatsapp: user.whatsapp,
      avatarUrl: user.avatarUrl
    });
    setIsEditing(false);
    setShowSuspendPrompt(false);
    setActiveTab('profile');

    // Fetch user recitations and activity logs
    setLoadingUserDetails(true);
    try {
      const [recits, logs] = await Promise.all([
        adminService.getUserRecitations(user.installationId, user.displayName),
        adminService.getUserActivityLogs(user.installationId)
      ]);
      setUserRecitations(recits);
      setUserActivityLogs(logs);
    } catch (e) {
      console.warn('Failed to load user details sub-data:', e);
    } finally {
      setLoadingUserDetails(false);
    }
  };

  const handleSaveUserEdits = async () => {
    if (!selectedUser) return;
    setActionLoading(true);
    try {
      await adminService.updateUser(selectedUser.id, editFormData);
      await adminService.logUserActivity(
        selectedUser.installationId,
        'ADMIN_UPDATE_PROFILE',
        'تعديل بيانات المستخدم الإدارية بواسطة لوحة التحكم'
      );

      const updated = { ...selectedUser, ...editFormData };
      setUsers((prev) =>
        prev.map((u) => (u.id === selectedUser.id ? updated : u))
      );
      setSelectedUser(updated);
      setIsEditing(false);
      alert('تم تحديث بيانات المستخدم بنجاح');
    } catch (e: any) {
      alert(e?.message || 'تعذر حفظ التعديلات');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleSuspension = async (isSuspended: boolean) => {
    if (!selectedUser) return;
    setActionLoading(true);
    try {
      const reason = isSuspended
        ? suspendReason || 'مخالفة معايير وشروط استخدام منصة تلاوتك للعالم ونشر محتوى مخالف'
        : '';
      await adminService.toggleUserSuspension(selectedUser.id, isSuspended, reason);
      
      const updated = {
        ...selectedUser,
        isSuspended,
        suspendedReason: reason
      };

      setUsers((prev) =>
        prev.map((u) => (u.id === selectedUser.id ? updated : u))
      );
      setSelectedUser(updated);
      setShowSuspendPrompt(false);
      setSuspendReason('');
      alert(isSuspended ? 'تم إيقاف وحظر حساب المستخدم عن رفع التلاوات بنجاح' : 'تم رفع الحظر وإعادة تنشيط الحساب');
    } catch (e: any) {
      alert(e?.message || 'تعذر تغيير حالة الحساب');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من رغبتك في حذف هذا الملف نهائيًا من قاعدة البيانات؟')) return;
    try {
      await adminService.deleteUser(id);
      setUsers(users.filter((u) => u.id !== id));
      if (selectedUser?.id === id) setSelectedUser(null);
      alert('تم حذف المستخدم بنجاح');
    } catch (e: any) {
      alert(e?.message || 'تعذر الحذف');
    }
  };

  const handleSendDirectNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !directNotifTitle.trim() || !directNotifBody.trim()) {
      setDirectNotifError('يرجى كتابة عنوان ونص الإشعار.');
      return;
    }

    setIsSendingDirectNotif(true);
    setDirectNotifError(null);
    setDirectNotifSuccess(null);

    try {
      await adminService.sendBroadcastNotification({
        title: directNotifTitle.trim(),
        body: directNotifBody.trim(),
        notificationType: 'ADMIN_ANNOUNCEMENT',
        targetType: 'specific_user',
        targetValue: selectedUser.installationId
      });

      await adminService.logUserActivity(
        selectedUser.installationId,
        'ADMIN_DIRECT_NOTIFICATION',
        `إرسال إشعار مباشر: ${directNotifTitle.trim()}`
      );

      setDirectNotifSuccess('تم إرسال الإشعار الفوري للمستخدم بنجاح.');
      setDirectNotifTitle('');
      setDirectNotifBody('');

      // Refresh activity logs
      const updatedLogs = await adminService.getUserActivityLogs(selectedUser.installationId);
      setUserActivityLogs(updatedLogs);
    } catch (err: any) {
      setDirectNotifError(err?.message || 'فشل إرسال الإشعار للمستخدم.');
    } finally {
      setIsSendingDirectNotif(false);
    }
  };

  // Unique countries list for filtering
  const availableCountries = Array.from(new Set(users.map((u) => u.country).filter(Boolean)));

  // Filtering & Search
  const filteredUsers = users.filter((user) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = user.displayName?.toLowerCase().includes(q);
      const matchCountry = user.country?.toLowerCase().includes(q);
      const matchEmail = user.email?.toLowerCase().includes(q);
      const matchInstall = user.installationId?.toLowerCase().includes(q);
      const matchWhatsapp = user.whatsapp?.toLowerCase().includes(q);
      if (!matchName && !matchCountry && !matchEmail && !matchInstall && !matchWhatsapp) return false;
    }

    if (filterType === 'completed' && !user.isProfileCompleted) return false;
    if (filterType === 'incomplete' && user.isProfileCompleted) return false;
    if (filterType === 'suspended' && !user.isSuspended) return false;
    if (filterType === 'active' && user.isSuspended) return false;
    if (filterType === 'listeners' && user.userType !== 'LISTENER') return false;
    if (filterType === 'reciters' && user.userType !== 'RECITER' && user.userType !== 'BOTH') return false;

    if (filterCountry !== 'all' && user.country !== filterCountry) return false;

    return true;
  });

  // Sorting
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    if (sortBy === 'latest') {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    }
    if (sortBy === 'oldest') {
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    }
    if (sortBy === 'last_active') {
      return new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime();
    }
    if (sortBy === 'name') {
      return (a.displayName || '').localeCompare(b.displayName || '');
    }
    return 0;
  });

  // Pagination
  const totalPages = Math.ceil(sortedUsers.length / pageSize) || 1;
  const paginatedUsers = sortedUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Statistics
  const totalUsersCount = users.length;
  const completedCount = users.filter((u) => u.isProfileCompleted).length;
  const incompleteCount = totalUsersCount - completedCount;
  const suspendedCount = users.filter((u) => u.isSuspended).length;
  const activeCount = totalUsersCount - suspendedCount;
  const listenersCount = users.filter((u) => u.userType === 'LISTENER').length;
  const recitersCount = users.filter((u) => u.userType === 'RECITER' || u.userType === 'BOTH').length;

  return (
    <div className="space-y-6 font-tajawal">
      {/* Header & Stats Cards */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-[#55BFEA]" />
            <span>إدارة المستخدمين والزوار</span>
          </h2>
          <p className="text-xs text-[#A8C2B3] mt-1">
            نظام متكامل لإدارة حسابات الزوار والقراء، فحص النشاط، تعديل البيانات، وتطبيق الحظر والتقييد عند المخالفة
          </p>
        </div>

        <button
          onClick={fetchUsers}
          disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#162B22] border border-[#2B493B] text-xs text-[#E8EFEA] hover:bg-[#1E3B2E] transition disabled:opacity-50 shadow-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>تحديث مباشر</span>
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="bg-[#12231B] border border-[#234235] p-3.5 rounded-2xl shadow-xs">
          <span className="text-[11px] text-[#A8C2B3]">إجمالي الحسابات</span>
          <div className="text-2xl font-bold text-white mt-1">{totalUsersCount}</div>
        </div>
        <div className="bg-[#12231B] border border-[#234235] p-3.5 rounded-2xl shadow-xs">
          <span className="text-[11px] text-[#A8C2B3]">المستخدمون النشطون</span>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{activeCount}</div>
        </div>
        <div className="bg-[#12231B] border border-[#234235] p-3.5 rounded-2xl shadow-xs">
          <span className="text-[11px] text-[#A8C2B3]">الملفات المكتملة</span>
          <div className="text-2xl font-bold text-[#55BFEA] mt-1">{completedCount}</div>
        </div>
        <div className="bg-[#12231B] border border-[#234235] p-3.5 rounded-2xl shadow-xs">
          <span className="text-[11px] text-[#A8C2B3]">الزوار (غير مكتمل)</span>
          <div className="text-2xl font-bold text-[#F2C96B] mt-1">{incompleteCount}</div>
        </div>
        <div className="bg-[#12231B] border border-[#234235] p-3.5 rounded-2xl shadow-xs">
          <span className="text-[11px] text-[#A8C2B3]">الحسابات المحظورة</span>
          <div className="text-2xl font-bold text-rose-400 mt-1">{suspendedCount}</div>
        </div>
        <div className="bg-[#12231B] border border-[#234235] p-3.5 rounded-2xl shadow-xs">
          <span className="text-[11px] text-[#A8C2B3]">القراء والمستمعون</span>
          <div className="text-2xl font-bold text-amber-400 mt-1">{recitersCount} / {listenersCount}</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-[#12231B] border border-[#234235] p-4 rounded-2xl space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-96">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="بحث بالاسم، البريد، رقم الواتساب، أو معرف التثبيت (Installation ID)..."
              className="w-full pl-3 pr-9 py-2 rounded-xl bg-[#0A1410] border border-[#234235] text-xs text-white placeholder-[#6E8E7E] focus:outline-hidden focus:border-[#55BFEA]"
            />
            <Search className="w-4 h-4 text-[#6E8E7E] absolute right-3 top-1/2 -translate-y-1/2" />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-end">
            {/* Country Filter */}
            <select
              value={filterCountry}
              onChange={(e) => {
                setFilterCountry(e.target.value);
                setCurrentPage(1);
              }}
              className="px-3 py-2 rounded-xl bg-[#0A1410] border border-[#234235] text-xs text-white focus:outline-hidden"
            >
              <option value="all">جميع الدول ({availableCountries.length})</option>
              {availableCountries.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 rounded-xl bg-[#0A1410] border border-[#234235] text-xs text-white focus:outline-hidden"
            >
              <option value="latest">الأحدث انضماماً</option>
              <option value="oldest">الأقدم انضماماً</option>
              <option value="last_active">آخر نشاط</option>
              <option value="name">الاسم أبجدياً</option>
            </select>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full pt-2 border-t border-[#234235] scrollbar-none">
          <span className="text-[11px] text-[#A8C2B3] font-bold pl-2 flex items-center gap-1">
            <Filter className="w-3 h-3 text-[#55BFEA]" />
            <span>الحالة:</span>
          </span>
          {[
            { id: 'all', label: 'الكل' },
            { id: 'active', label: 'نشط' },
            { id: 'suspended', label: 'محظور / موقوف' },
            { id: 'completed', label: 'ملف مكتمل' },
            { id: 'incomplete', label: 'زائر مؤقت' },
            { id: 'listeners', label: 'مستمعون' },
            { id: 'reciters', label: 'قراء' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setFilterType(tab.id);
                setCurrentPage(1);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs whitespace-nowrap transition ${
                filterType === tab.id
                  ? 'bg-[#1687C7] text-white font-medium shadow-xs'
                  : 'bg-[#0A1410] text-[#A8C2B3] border border-[#234235] hover:bg-[#162B22]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-[#12231B] border border-[#234235] rounded-2xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-[#0A1410] border-b border-[#234235] text-[#A8C2B3]">
              <tr>
                <th className="px-4 py-3 font-semibold">المستخدم والبريد</th>
                <th className="px-4 py-3 font-semibold">الدولة</th>
                <th className="px-4 py-3 font-semibold">التصنيف</th>
                <th className="px-4 py-3 font-semibold">حالة الحساب والرفع</th>
                <th className="px-4 py-3 font-semibold">تاريخ الانضمام</th>
                <th className="px-4 py-3 font-semibold">آخر نشاط</th>
                <th className="px-4 py-3 font-semibold text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#234235]/60">
              {paginatedUsers.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => handleOpenUserDetails(user)}
                  className="hover:bg-[#162B22]/70 transition cursor-pointer group"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {user.avatarUrl ? (
                        <img
                          src={user.avatarUrl}
                          alt={user.displayName}
                          referrerPolicy="no-referrer"
                          className="w-9 h-9 rounded-full object-cover border border-[#234235]"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-[#162B22] border border-[#234235] flex items-center justify-center text-[#55BFEA] font-bold text-xs">
                          {user.displayName?.charAt(0) || 'ز'}
                        </div>
                      )}
                      <div>
                        <div className="font-semibold text-white group-hover:text-[#55BFEA] transition-colors flex items-center gap-1.5">
                          <span>{user.displayName}</span>
                          {user.isSuspended && (
                            <span className="px-1.5 py-0.2 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px]">
                              محظور من الرفع
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-[#A8C2B3] mt-0.5">
                          {user.email ? (
                            <span className="flex items-center gap-1">
                              <Mail className="w-3 h-3 text-[#6E8E7E]" />
                              <span>{user.email}</span>
                            </span>
                          ) : (
                            <span className="font-mono text-[10px] text-[#6E8E7E]">
                              ID: {user.installationId?.substring(0, 12)}...
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3 text-[#A8C2B3]">
                    <span className="flex items-center gap-1">
                      <Globe className="w-3.5 h-3.5 text-[#6E8E7E]" />
                      <span>{user.country || 'العالم الإسلامي'}</span>
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    {user.userType === 'RECITER' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#1687C7]/20 text-[#55BFEA] border border-[#1687C7]/30">
                        <Mic2 className="w-3 h-3" />
                        <span>قارئ</span>
                      </span>
                    ) : user.userType === 'BOTH' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/20 text-[#F2C96B] border border-amber-500/30">
                        <span>قارئ ومستمع</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#234235] text-[#A8C2B3] border border-[#2B493B]">
                        <Headphones className="w-3 h-3" />
                        <span>مستمع</span>
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {user.isSuspended ? (
                      <span className="inline-flex items-center gap-1 text-rose-400 font-medium bg-rose-500/10 px-2 py-0.5 rounded-md border border-rose-500/20">
                        <Ban className="w-3.5 h-3.5" />
                        <span>موقوف عن الرفع</span>
                      </span>
                    ) : user.isProfileCompleted ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>نشط (مكتمل)</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[#F2C96B]">
                        <Clock className="w-3.5 h-3.5" />
                        <span>زائر مؤقت</span>
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-[#A8C2B3]">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString('ar-EG') : '-'}
                  </td>

                  <td className="px-4 py-3 text-[#A8C2B3]">
                    {user.lastActiveAt ? new Date(user.lastActiveAt).toLocaleDateString('ar-EG') : '-'}
                  </td>

                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => handleOpenUserDetails(user)}
                        className="px-2.5 py-1 rounded-lg bg-[#162B22] border border-[#2B493B] text-[#55BFEA] hover:bg-[#1E3B2E] transition font-medium flex items-center gap-1"
                        title="عرض الملف والتفاصيل"
                      >
                        <Edit className="w-3 h-3" />
                        <span>الملف</span>
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 transition"
                        title="حذف الملف"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {paginatedUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[#A8C2B3]">
                    لا توجد حسابات أو زوار تطابق معايير البحث والفلترة الحالية
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {sortedUsers.length > 0 && (
          <div className="p-4 bg-[#0A1410] border-t border-[#234235] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#A8C2B3]">
            <div>
              عرض {(currentPage - 1) * pageSize + 1} إلى {Math.min(currentPage * pageSize, sortedUsers.length)} من إجمالي {sortedUsers.length} مستخدماً
            </div>

            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="px-2 py-1 rounded-lg bg-[#12231B] border border-[#234235] text-white"
              >
                <option value={10}>10 لكل صفحة</option>
                <option value={20}>20 لكل صفحة</option>
                <option value={50}>50 لكل صفحة</option>
                <option value={100}>100 لكل صفحة</option>
              </select>

              <button
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg bg-[#12231B] border border-[#234235] text-white disabled:opacity-40 hover:bg-[#1E3B2E] transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <span className="px-3 py-1 bg-[#12231B] border border-[#234235] text-white font-bold rounded-lg">
                {currentPage} / {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg bg-[#12231B] border border-[#234235] text-white disabled:opacity-40 hover:bg-[#1E3B2E] transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User Details & Management Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-[#12231B] border border-[#234235] rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col text-white">
            
            {/* Modal Header */}
            <div className="p-5 bg-[#0A1410] border-b border-[#234235] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-[#162B22] border border-[#2B493B] flex items-center justify-center text-[#55BFEA]">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    <span>{selectedUser.displayName}</span>
                    {selectedUser.isSuspended && (
                      <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px]">
                        موقوف عن الرفع
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-[#A8C2B3] flex items-center gap-2 mt-0.5">
                    <span>معرف التثبيت:</span>
                    <code className="text-[#55BFEA] font-mono text-[11px] bg-[#162B22] px-2 py-0.5 rounded-md">
                      {selectedUser.installationId}
                    </code>
                  </p>
                </div>
              </div>

              <button
                onClick={() => setSelectedUser(null)}
                className="w-9 h-9 rounded-full bg-[#162B22] hover:bg-[#234235] text-[#A8C2B3] flex items-center justify-center transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs Navigation */}
            <div className="flex items-center gap-2 px-6 pt-4 bg-[#0A1410] border-b border-[#234235]">
              {[
                { id: 'profile', label: 'الملف الشخصي والبيانات', icon: Users },
                { id: 'recitations', label: `تلاوات المستخدم (${userRecitations.length})`, icon: Mic2 },
                { id: 'activity', label: `سجل النشاط والتدقيق (${userActivityLogs.length})`, icon: Activity },
                { id: 'notification', label: 'إرسال إشعار فوري', icon: Send }
              ].map((tab) => {
                const IconComp = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold transition border-t border-x ${
                      activeTab === tab.id
                        ? 'bg-[#12231B] text-[#55BFEA] border-[#234235] border-b-transparent'
                        : 'bg-transparent text-[#A8C2B3] border-transparent hover:text-white'
                    }`}
                  >
                    <IconComp className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              
              {/* Account Status Banner */}
              {selectedUser.isSuspended ? (
                <div className="p-4 rounded-2xl bg-rose-950/50 border border-rose-500/50 text-rose-200 flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs">
                    <p className="font-bold text-rose-300">
                      حساب هذا المستخدم مقيد وموقوف عن رفع ونشر التلاوات الجديدة
                    </p>
                    <p className="text-rose-200/90">
                      سبب الإيقاف: {selectedUser.suspendedReason || 'مخالفة معايير الاستخدام والنشر للمنصة'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>الحساب نشط ويتمتع بكامل صلاحيات التصفح والرفع والاستماع</span>
                  </div>
                  <span className="text-[11px] text-emerald-400/80">
                    آخر نشاط: {selectedUser.lastActiveAt ? new Date(selectedUser.lastActiveAt).toLocaleString('ar-EG') : 'غير متوفر'}
                  </span>
                </div>
              )}

              {/* TAB 1: Profile & Editing */}
              {activeTab === 'profile' && (
                <div className="space-y-5">
                  {isEditing ? (
                    <div className="space-y-4 bg-[#0A1410] p-5 rounded-2xl border border-[#234235]">
                      <h4 className="font-bold text-xs text-[#55BFEA] flex items-center gap-1.5">
                        <Edit className="w-4 h-4" />
                        <span>تعديل بيانات المستخدم الإدارية</span>
                      </h4>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-[#A8C2B3] mb-1 font-bold">الاسم الظاهر</label>
                          <input
                            type="text"
                            value={editFormData.displayName || ''}
                            onChange={(e) => setEditFormData({ ...editFormData, displayName: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-[#162B22] border border-[#234235] text-xs text-white"
                          />
                        </div>

                        <div>
                          <CountrySelectField
                            value={editFormData.country || 'العالم الإسلامي'}
                            onChange={(val) => setEditFormData({ ...editFormData, country: val })}
                          />
                        </div>

                        <div>
                          <label className="block text-xs text-[#A8C2B3] mb-1 font-bold">البريد الإلكتروني</label>
                          <input
                            type="email"
                            value={editFormData.email || ''}
                            onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-[#162B22] border border-[#234235] text-xs text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-xs text-[#A8C2B3] mb-1 font-bold">رقم الواتساب</label>
                          <input
                            type="text"
                            value={editFormData.whatsapp || ''}
                            onChange={(e) => setEditFormData({ ...editFormData, whatsapp: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-[#162B22] border border-[#234235] text-xs text-white"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-xs text-[#A8C2B3] mb-1 font-bold">تصنيف المستخدم</label>
                          <select
                            value={editFormData.userType || 'LISTENER'}
                            onChange={(e) => setEditFormData({ ...editFormData, userType: e.target.value as any })}
                            className="w-full px-3 py-2 rounded-xl bg-[#162B22] border border-[#234235] text-xs text-white"
                          >
                            <option value="LISTENER">مستمع للقرآن الكريم</option>
                            <option value="RECITER">قارئ معتمد</option>
                            <option value="BOTH">قارئ ومستمع</option>
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-xs text-[#A8C2B3] mb-1 font-bold">النبذة التعريفية</label>
                          <textarea
                            rows={3}
                            value={editFormData.bio || ''}
                            onChange={(e) => setEditFormData({ ...editFormData, bio: e.target.value })}
                            className="w-full px-3 py-2 rounded-xl bg-[#162B22] border border-[#234235] text-xs text-white"
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-2">
                        <button
                          onClick={handleSaveUserEdits}
                          disabled={actionLoading}
                          className="px-4 py-2 rounded-xl bg-[#1687C7] hover:bg-[#145273] text-white text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50 shadow-xs"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>حفظ التعديلات في القاعدة</span>
                        </button>
                        <button
                          onClick={() => setIsEditing(false)}
                          className="px-4 py-2 rounded-xl bg-[#162B22] hover:bg-[#234235] text-[#A8C2B3] text-xs font-bold transition"
                        >
                          إلغاء
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Avatar & Summary Card */}
                      <div className="flex items-center gap-4 p-5 rounded-2xl bg-[#0A1410] border border-[#234235]">
                        {selectedUser.avatarUrl ? (
                          <img
                            src={selectedUser.avatarUrl}
                            alt={selectedUser.displayName}
                            referrerPolicy="no-referrer"
                            className="w-16 h-16 rounded-full object-cover border-2 border-[#55BFEA]"
                          />
                        ) : (
                          <div className="w-16 h-16 rounded-full bg-[#162B22] border-2 border-[#2B493B] flex items-center justify-center text-[#55BFEA] font-bold text-xl">
                            {selectedUser.displayName?.charAt(0) || 'ز'}
                          </div>
                        )}

                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-lg font-bold text-white font-amiri">
                              {selectedUser.displayName}
                            </h4>
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#1687C7]/20 text-[#55BFEA] border border-[#1687C7]/30">
                              {selectedUser.userType === 'RECITER' ? 'قارئ' : selectedUser.userType === 'BOTH' ? 'قارئ ومستمع' : 'مستمع'}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-xs text-[#A8C2B3]">
                            <span className="flex items-center gap-1">
                              <Globe className="w-3.5 h-3.5 text-[#55BFEA]" />
                              <span>{selectedUser.country || 'العالم الإسلامي'}</span>
                            </span>
                            <span>•</span>
                            <span>انضم في: {selectedUser.createdAt ? new Date(selectedUser.createdAt).toLocaleDateString('ar-EG') : '-'}</span>
                          </div>

                          {selectedUser.bio && (
                            <p className="text-xs text-[#A8C2B3]/90 pt-1 leading-relaxed">
                              "{selectedUser.bio}"
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Info Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="p-3.5 rounded-xl bg-[#0A1410] border border-[#234235]">
                          <span className="text-[#6E8E7E] block mb-0.5">البريد الإلكتروني</span>
                          <span className="text-white font-mono">{selectedUser.email || 'غير مسجل (زائر)'}</span>
                        </div>

                        <div className="p-3.5 rounded-xl bg-[#0A1410] border border-[#234235]">
                          <span className="text-[#6E8E7E] block mb-0.5">رقم الواتساب</span>
                          <span className="text-white font-mono">{selectedUser.whatsapp || 'غير مسجل'}</span>
                        </div>

                        <div className="p-3.5 rounded-xl bg-[#0A1410] border border-[#234235]">
                          <span className="text-[#6E8E7E] block mb-0.5">حالة اكتمال الملف</span>
                          <span className={selectedUser.isProfileCompleted ? 'text-emerald-400 font-bold' : 'text-[#F2C96B]'}>
                            {selectedUser.isProfileCompleted ? 'ملف مكتمل ومسجل' : 'زائر مؤقت (لم يكمل بياناته)'}
                          </span>
                        </div>

                        <div className="p-3.5 rounded-xl bg-[#0A1410] border border-[#234235]">
                          <span className="text-[#6E8E7E] block mb-0.5">عدد التلاوات المرتبطة</span>
                          <span className="text-white font-bold">{userRecitations.length} تلاوة مسجلة</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: User Recitations */}
              {activeTab === 'recitations' && (
                <div className="space-y-3">
                  <h4 className="font-bold text-xs text-[#55BFEA] flex items-center gap-1.5 mb-2">
                    <Mic2 className="w-4 h-4" />
                    <span>تلاوات وطلبات هذا المستخدم المرسلة ({userRecitations.length})</span>
                  </h4>

                  {userRecitations.map((rec) => (
                    <div key={rec.id} className="p-3.5 rounded-xl bg-[#0A1410] border border-[#234235] flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#162B22] border border-[#2B493B] flex items-center justify-center text-[#55BFEA] font-bold text-xs">
                          {rec.surahNumber || 'قرآن'}
                        </div>
                        <div>
                          <div className="font-bold text-white text-xs">
                            سورة {rec.surahName} (الآيات {rec.ayahStart}-{rec.ayahEnd})
                          </div>
                          <div className="text-[11px] text-[#A8C2B3] flex items-center gap-2 mt-0.5">
                            <span>الرواية: {rec.riwayah}</span>
                            <span>•</span>
                            <span>{new Date(rec.createdAt).toLocaleDateString('ar-EG')}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium ${
                          rec.status === 'APPROVED' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                          rec.status === 'REJECTED' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                          'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}>
                          {rec.status === 'APPROVED' ? 'منشورة ومقبولة' : rec.status === 'REJECTED' ? 'مرفوضة' : 'قيد المراجعة'}
                        </span>

                        {(rec.audioStoragePath || rec.externalAudioUrl) && (
                          <button
                            onClick={() => {
                              const audioUrl = rec.externalAudioUrl || SupabaseService.getStoragePublicUrl(rec.audioStoragePath, 'recitation-audio');
                              const a = new Audio(audioUrl);
                              a.play().catch(() => alert('تعذر تشغيل الملف الصوتي'));
                            }}
                            className="p-2 rounded-xl bg-[#1687C7] hover:bg-[#145273] text-white transition"
                            title="تشغيل التلاوة"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {userRecitations.length === 0 && (
                    <div className="p-8 text-center text-[#A8C2B3] text-xs bg-[#0A1410] rounded-xl border border-[#234235]">
                      لا توجد تلاوات مسجلة لهذا المستخدم حتى الآن.
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: Activity Logs */}
              {activeTab === 'activity' && (
                <div className="space-y-3">
                  <h4 className="font-bold text-xs text-[#55BFEA] flex items-center gap-1.5 mb-2">
                    <Activity className="w-4 h-4" />
                    <span>سجل النشاط التدقيقي والعمليات ({userActivityLogs.length})</span>
                  </h4>

                  <div className="space-y-2">
                    {userActivityLogs.map((log) => (
                      <div key={log.id} className="p-3 rounded-xl bg-[#0A1410] border border-[#234235] flex items-start justify-between gap-3 text-xs">
                        <div>
                          <div className="font-bold text-white flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-[#55BFEA]" />
                            <span>{log.eventType}</span>
                            {log.adminName && (
                              <span className="text-[10px] text-[#A8C2B3] bg-[#162B22] px-2 py-0.5 rounded-md">
                                بواسطة: {log.adminName}
                              </span>
                            )}
                          </div>
                          <p className="text-[#A8C2B3] mt-1 pr-4">{log.description}</p>
                        </div>
                        <span className="text-[10px] text-[#6E8E7E] whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString('ar-EG')}
                        </span>
                      </div>
                    ))}

                    {userActivityLogs.length === 0 && (
                      <div className="p-8 text-center text-[#A8C2B3] text-xs bg-[#0A1410] rounded-xl border border-[#234235]">
                        لا توجد سجلات نشاط مسجلة لهذا الحساب.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: Direct Notification */}
              {activeTab === 'notification' && (
                <div className="space-y-4 bg-[#0A1410] p-5 rounded-2xl border border-[#234235]">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-xs text-[#55BFEA] flex items-center gap-1.5">
                      <Send className="w-4 h-4" />
                      <span>إرسال إشعار فوري مباشر إلى هذا المستخدم</span>
                    </h4>
                    <span className="text-[11px] text-[#A8C2B3]">
                      المستلم: {selectedUser.displayName} ({selectedUser.country})
                    </span>
                  </div>

                  {directNotifSuccess && (
                    <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>{directNotifSuccess}</span>
                    </div>
                  )}

                  {directNotifError && (
                    <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{directNotifError}</span>
                    </div>
                  )}

                  <form onSubmit={handleSendDirectNotification} className="space-y-4">
                    <div>
                      <label className="block text-xs text-[#A8C2B3] mb-1 font-bold">عنوان الإشعار *</label>
                      <input
                        type="text"
                        value={directNotifTitle}
                        onChange={(e) => setDirectNotifTitle(e.target.value)}
                        placeholder="مثال: تنبيه بخصوص جودة التسجيل، أو رسالة شكر خاصة..."
                        required
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#12231B] border border-[#234235] text-xs text-white placeholder:text-[#6E8E7E] focus:border-[#55BFEA] outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-[#A8C2B3] mb-1 font-bold">نص الإشعار والتفاصيل *</label>
                      <textarea
                        value={directNotifBody}
                        onChange={(e) => setDirectNotifBody(e.target.value)}
                        rows={4}
                        placeholder="اكتب الرسالة التي ستصل للمستخدم في الإشعارات الفورية داخل التطبيق..."
                        required
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#12231B] border border-[#234235] text-xs text-white placeholder:text-[#6E8E7E] focus:border-[#55BFEA] outline-hidden"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSendingDirectNotif}
                      className="px-5 py-2.5 rounded-xl bg-[#1687C7] hover:bg-[#145273] text-white text-xs font-bold transition flex items-center gap-2 shadow-xs disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{isSendingDirectNotif ? 'جاري الإرسال المباشر...' : 'إرسال الإشعار فورياً للمستخدم'}</span>
                    </button>
                  </form>
                </div>
              )}

              {/* Suspension Prompt */}
              {showSuspendPrompt && (
                <div className="p-4 rounded-2xl bg-rose-950/60 border border-rose-500/50 space-y-3 mt-4">
                  <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                    <span>تأكيد إيقاف وحظر الحساب عن رفع التلاوات</span>
                  </div>
                  <p className="text-xs text-rose-200/80">
                    عند تفعيل هذا الحظر، سيتمكن المستخدم من تصفح الموقع والاستماع فقط، ولكن سيتم رفض أي محاولة لرفع أو إرسال تلاوة جديدة عبر قاعدة البيانات والخادم تلقائياً.
                  </p>
                  <div>
                    <label className="block text-[11px] text-rose-200 mb-1">سبب الحظر (سيظهر في الإشعار وسجل التدقيق):</label>
                    <input
                      type="text"
                      value={suspendReason}
                      onChange={(e) => setSuspendReason(e.target.value)}
                      placeholder="مثال: مخالفة شروط النشر، تكرار إرسال ملفات غير قرآنية..."
                      className="w-full px-3 py-2 rounded-xl bg-[#0A1410] border border-rose-500/40 text-xs text-white"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => handleToggleSuspension(true)}
                      disabled={actionLoading}
                      className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>تأكيد وحفظ الحظر</span>
                    </button>
                    <button
                      onClick={() => setShowSuspendPrompt(false)}
                      className="px-4 py-2 rounded-xl bg-[#162B22] text-[#A8C2B3] text-xs font-bold"
                    >
                      تراجع
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="p-4 bg-[#0A1410] border-t border-[#234235] flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {!isEditing && activeTab === 'profile' && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3.5 py-2 rounded-xl bg-[#1687C7] hover:bg-[#145273] text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
                  >
                    <Edit className="w-3.5 h-3.5" />
                    <span>تعديل البيانات</span>
                  </button>
                )}

                {selectedUser.isSuspended ? (
                  <button
                    onClick={() => handleToggleSuspension(false)}
                    disabled={actionLoading}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    <span>إلغاء الحظر وإعادة تنشيط الرفع</span>
                  </button>
                ) : (
                  !showSuspendPrompt && (
                    <button
                      onClick={() => setShowSuspendPrompt(true)}
                      className="px-3.5 py-2 rounded-xl bg-rose-600/80 hover:bg-rose-700 text-white text-xs font-bold transition flex items-center gap-1.5"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>حظر من رفع التلاوات</span>
                    </button>
                  )
                )}
              </div>

              <button
                onClick={() => handleDeleteUser(selectedUser.id)}
                className="px-3.5 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 text-xs font-bold transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف نهائي</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
