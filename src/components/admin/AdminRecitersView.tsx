import React, { useState, useEffect } from 'react';
import { adminService } from '../../services/AdminService';
import { SupabaseService } from '../../services/SupabaseService';
import { ALL_WORLD_COUNTRIES } from '../../data/countries';
import { UnifiedImageInput } from '../common/UnifiedImageInput';
import { ReciterAvatar } from '../ReciterAvatar';
import { ReciterAudioUrlTemplateSection } from './ReciterAudioUrlTemplateSection';
import {
  Users,
  UserPlus,
  Edit,
  Trash2,
  CheckCircle,
  ShieldCheck,
  Globe,
  RefreshCw,
  Search,
  AlertCircle,
  Eye,
  EyeOff,
  Star,
  Copy,
  Wand2,
  Sparkles,
  Check
} from 'lucide-react';

export function AdminRecitersView() {
  const [reciters, setReciters] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingReciter, setEditingReciter] = useState<any | null>(null);

  // Form State
  const [displayName, setDisplayName] = useState('');
  const [pseudonym, setPseudonym] = useState('');
  const [usePseudonym, setUsePseudonym] = useState(false);
  const [gender, setGender] = useState<'MALE' | 'FEMALE'>('MALE');
  const [country, setCountry] = useState('المملكة العربية السعودية');
  const [bio, setBio] = useState('');
  const [profileImagePath, setProfileImagePath] = useState('');
  const [bannerImagePath, setBannerImagePath] = useState('');
  const [logoImagePath, setLogoImagePath] = useState('');
  const [isVerified, setIsVerified] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);
  const [isPublished, setIsPublished] = useState(true);

  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Clone Reciter State
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [cloningSourceReciter, setCloningSourceReciter] = useState<any | null>(null);
  const [cloneTargetName, setCloneTargetName] = useState('');
  const [cloneTargetCountry, setCloneTargetCountry] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [toastNotification, setToastNotification] = useState<{
    type: 'success' | 'info';
    message: string;
  } | null>(null);

  const loadReciters = async () => {
    setIsLoading(true);
    try {
      const data = await adminService.getAllAdminReciters();
      setReciters(data || []);
    } catch (e) {
      console.error('Failed to load reciters:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadReciters();
  }, []);

  // Toast Auto-Dismiss
  useEffect(() => {
    if (toastNotification) {
      const timer = setTimeout(() => {
        setToastNotification(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [toastNotification]);

  const openCreateModal = () => {
    setEditingReciter(null);
    setDisplayName('');
    setPseudonym('');
    setUsePseudonym(false);
    setGender('MALE');
    setCountry('المملكة العربية السعودية');
    setBio('');
    setProfileImagePath('');
    setBannerImagePath('');
    setLogoImagePath('');
    setIsVerified(true);
    setIsFeatured(false);
    setIsPublished(true);
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (reciter: any) => {
    setEditingReciter(reciter);
    setDisplayName(reciter.display_name || '');
    setPseudonym(reciter.pseudonym || '');
    setUsePseudonym(reciter.use_pseudonym || false);
    setGender(reciter.gender || 'MALE');
    setCountry(reciter.country || 'المملكة العربية السعودية');
    setBio(reciter.bio || '');
    setProfileImagePath(reciter.profile_image_path || '');
    setBannerImagePath(reciter.banner_image_path || '');
    setLogoImagePath(reciter.logo_image_path || '');
    setIsVerified(reciter.is_verified ?? true);
    setIsFeatured(reciter.is_featured ?? false);
    setIsPublished(reciter.is_published ?? true);
    setFormError(null);
    setIsModalOpen(true);
  };

  // Open Clone Reciter Confirmation Modal
  const openCloneModal = (reciter: any) => {
    setCloningSourceReciter(reciter);
    setCloneTargetName(`${reciter.display_name || 'قارئ'} (نسخة جديدة)`);
    setCloneTargetCountry(reciter.country || 'المملكة العربية السعودية');
    setCloneError(null);
    setIsCloneModalOpen(true);
  };

  // Handle Confirmed Cloning
  const handleConfirmClone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloningSourceReciter) return;
    if (!cloneTargetName.trim()) {
      setCloneError('يرجى تحديد اسم القارئ الجديد');
      return;
    }

    setIsCloning(true);
    setCloneError(null);

    try {
      const result = await adminService.cloneReciterProfile(
        cloningSourceReciter.id,
        cloneTargetName.trim(),
        cloneTargetCountry.trim() || undefined
      );

      setIsCloneModalOpen(false);

      // Show prominent success notification
      setToastNotification({
        type: 'success',
        message: `تم نسخ ملف القارئ بنجاح مع (${result.copiedRecitationsCount}) تلاوة! جاري فتح نموذج التعديل لتطبيق قالب روابط الصوت وتحديث البيانات.`
      });

      // Reload reciters list
      await loadReciters();

      // Automatically open the new cloned reciter in Edit Modal
      const freshList = await adminService.getAllAdminReciters();
      const newlyCreated = freshList.find((r) => r.id === result.newReciterId) || {
        id: result.newReciterId,
        display_name: result.newDisplayName,
        country: cloneTargetCountry,
        bio: cloningSourceReciter.bio,
        profile_image_path: cloningSourceReciter.profile_image_path,
        banner_image_path: cloningSourceReciter.banner_image_path,
        logo_image_path: cloningSourceReciter.logo_image_path,
        is_verified: cloningSourceReciter.is_verified,
        is_featured: false,
        is_published: false
      };

      openEditModal(newlyCreated);
    } catch (err: any) {
      setCloneError(err?.message || 'فشلت عملية نسخ ملف القارئ');
    } finally {
      setIsCloning(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setFormError('يرجى كتابة الاسم المعروض للقارئ');
      return;
    }
    if (!country.trim()) {
      setFormError('يرجى تحديد دولة القارئ');
      return;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      if (editingReciter) {
        await adminService.updateReciter(editingReciter.id, {
          displayName,
          pseudonym: pseudonym.trim() ? pseudonym : null,
          usePseudonym,
          gender,
          country,
          bio,
          profileImagePath: profileImagePath.trim() ? profileImagePath : null,
          bannerImagePath: bannerImagePath.trim() ? bannerImagePath : null,
          logoImagePath: logoImagePath.trim() ? logoImagePath : null,
          isVerified,
          isFeatured,
          isPublished
        });
      } else {
        await adminService.createReciter({
          displayName,
          pseudonym: pseudonym.trim() ? pseudonym : undefined,
          usePseudonym,
          gender,
          country,
          bio,
          profileImagePath: profileImagePath.trim() ? profileImagePath : undefined,
          bannerImagePath: bannerImagePath.trim() ? bannerImagePath : undefined,
          logoImagePath: logoImagePath.trim() ? logoImagePath : undefined,
          isVerified,
          isFeatured,
          isPublished
        });
      }

      setIsModalOpen(false);
      setToastNotification({
        type: 'success',
        message: editingReciter ? 'تم حفظ تعديلات ملف القارئ بنجاح' : 'تم إضافة القارئ الجديد بنجاح'
      });
      await loadReciters();
    } catch (err: any) {
      setFormError(err?.message || 'فشلت عملية حفظ بيانات القارئ');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePublish = async (reciter: any) => {
    try {
      await adminService.updateReciter(reciter.id, {
        isPublished: !reciter.is_published
      });
      setReciters((prev) =>
        prev.map((r) =>
          r.id === reciter.id ? { ...r, is_published: !r.is_published } : r
        )
      );
    } catch (e) {
      console.error('Failed to toggle publish:', e);
    }
  };

  const handleToggleFeatured = async (reciter: any) => {
    try {
      await adminService.updateReciter(reciter.id, {
        isFeatured: !reciter.is_featured
      });
      setReciters((prev) =>
        prev.map((r) =>
          r.id === reciter.id ? { ...r, is_featured: !r.is_featured } : r
        )
      );
    } catch (e) {
      console.error('Failed to toggle featured:', e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا القارئ وجميع تلاواته المرتبطة به؟')) return;
    try {
      await adminService.deleteReciter(id);
      setReciters((prev) => prev.filter((r) => r.id !== id));
      setToastNotification({
        type: 'info',
        message: 'تم حذف القارئ وسجلاته بنجاح'
      });
    } catch (e: any) {
      alert(e.message || 'فشل حذف القارئ');
    }
  };

  const filteredReciters = reciters.filter((r) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const name = (r.display_name || r.public_name || '').toLowerCase();
    const pseudo = (r.pseudonym || '').toLowerCase();
    const c = (r.country || '').toLowerCase();
    return name.includes(q) || pseudo.includes(q) || c.includes(q);
  });

  return (
    <div className="space-y-6 select-none font-tajawal">
      {/* Toast Notification Banner */}
      {toastNotification && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 max-w-lg w-[92%] bg-[#0F281E] border border-[#34D399]/60 text-white p-3.5 rounded-2xl shadow-2xl flex items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-2.5">
            <CheckCircle className="w-5 h-5 text-[#34D399] shrink-0" />
            <span className="leading-relaxed font-semibold">{toastNotification.message}</span>
          </div>
          <button
            onClick={() => setToastNotification(null)}
            className="text-[#8BA496] hover:text-white text-xs px-2 py-1"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#234235]">
        <div>
          <h1 className="text-xl font-bold font-amiri text-[#F0F5F2] flex items-center gap-2">
            <Users className="w-5 h-5 text-[#34D399]" />
            <span>إدارة وتوثيق القراء</span>
          </h1>
          <p className="text-xs text-[#8BA496] mt-0.5">
            إضافة وتعديل بيانات القراء، نسخ ملفات القراء وتلاواتهم، وضبط قوالب روابط الصوت
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadReciters}
            disabled={isLoading}
            className="p-2 bg-[#162720] hover:bg-[#1E372C] text-[#A8C2B3] rounded-xl border border-[#2B493B] transition"
            title="تحديث"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-[#2B5742] hover:bg-[#346950] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            <span>إضافة قارئ جديد</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="بحث عن قارئ بالاسم أو الدولة..."
          className="w-full bg-[#14241D] border border-[#234235] rounded-xl px-3.5 py-2 pr-9 text-xs text-white placeholder-[#5A7B6C] focus:outline-none focus:border-[#3E745A]"
        />
        <Search className="w-4 h-4 text-[#5A7B6C] absolute right-3 top-2.5 pointer-events-none" />
      </div>

      {/* Reciters Table / Grid */}
      {isLoading ? (
        <div className="py-16 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-[#34D399]/30 border-t-[#34D399] rounded-full animate-spin mx-auto"></div>
          <p className="text-xs text-[#8BA496]">جاري تحميل قائمة القراء من السحابة...</p>
        </div>
      ) : filteredReciters.length === 0 ? (
        <div className="py-16 px-4 bg-[#14241D]/50 border border-dashed border-[#234235] rounded-2xl text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-[#1A3328] border border-[#2B5742] flex items-center justify-center mx-auto text-[#8BA496]">
            <Users className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-[#F0F5F2]">لا يوجد قراء حتى الآن</h3>
          <p className="text-xs text-[#8BA496] max-w-sm mx-auto">
            قاعدة البيانات جاهزة لاستقبال ملفات القراء المعتمدين وتلاواتهم.
          </p>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-[#2B5742] hover:bg-[#346950] text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition"
          >
            <UserPlus className="w-4 h-4" />
            <span>تسجيل القارئ الأول</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredReciters.map((reciter) => (
            <div
              key={reciter.id}
              className="p-4 bg-[#14241D] border border-[#234235] rounded-2xl space-y-3 shadow-sm hover:border-[#2E5E49] transition flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <ReciterAvatar
                      name={reciter.display_name}
                      imageUrl={reciter.profile_image_path}
                      size="md"
                      shape="rounded"
                    />

                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-sm text-[#F0F5F2]">
                          {reciter.display_name}
                        </h3>
                        {reciter.is_verified && (
                          <ShieldCheck className="w-4 h-4 text-[#34D399]" title="موثق" />
                        )}
                        {reciter.is_featured && (
                          <Star className="w-3.5 h-3.5 text-[#D4AF37] fill-[#D4AF37]" title="مميز" />
                        )}
                      </div>

                      {reciter.pseudonym && (
                        <p className="text-[11px] text-[#A8C2B3]">
                          الاسم المستعار: {reciter.pseudonym}
                        </p>
                      )}

                      <div className="flex items-center gap-2 text-xs text-[#8BA496] mt-0.5">
                        <span className="flex items-center gap-1">
                          <Globe className="w-3 h-3 text-[#4B8569]" />
                          <span>{reciter.country}</span>
                        </span>
                        <span>•</span>
                        <span>{reciter.gender === 'FEMALE' ? 'أنثى' : 'ذكر'}</span>
                      </div>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${
                      reciter.is_published
                        ? 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
                        : 'bg-zinc-800 border border-zinc-700 text-zinc-400'
                    }`}
                  >
                    {reciter.is_published ? 'منشور عام' : 'مسودة'}
                  </span>
                </div>

                {reciter.bio && (
                  <p className="text-xs text-[#A8C2B3] line-clamp-2 bg-[#0D1813] p-2.5 rounded-xl border border-[#1F372C]">
                    {reciter.bio}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-[#1F372C] text-xs">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleTogglePublish(reciter)}
                    className={`p-1.5 rounded-lg border transition ${
                      reciter.is_published
                        ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400 hover:bg-emerald-900/60'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                    }`}
                    title={reciter.is_published ? 'إلغاء النشر' : 'نشر في التطبيق'}
                  >
                    {reciter.is_published ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={() => handleToggleFeatured(reciter)}
                    className={`p-1.5 rounded-lg border transition ${
                      reciter.is_featured
                        ? 'bg-amber-950/40 border-amber-800 text-amber-300 hover:bg-amber-900/60'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800'
                    }`}
                    title="تمييز القارئ"
                  >
                    <Star className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  {/* Clone Reciter Button */}
                  <button
                    onClick={() => openCloneModal(reciter)}
                    className="px-2.5 py-1.5 bg-[#142A20] hover:bg-[#1D3E2F] border border-[#2D6047] text-[#34D399] hover:text-[#5EEAD4] rounded-lg transition flex items-center gap-1 text-[11px] font-bold shadow-sm"
                    title="نسخ ملف القارئ وكافة تلاواته بالكامل لإنشاء قارئ جديد"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ القارئ</span>
                  </button>

                  <button
                    onClick={() => openEditModal(reciter)}
                    className="p-1.5 bg-[#1A3328] hover:bg-[#224435] border border-[#2B5742] text-[#A8C2B3] hover:text-white rounded-lg transition"
                    title="تعديل بيانات القارئ وتلاواته"
                  >
                    <Edit className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleDelete(reciter.id)}
                    className="p-1.5 bg-rose-950/50 hover:bg-rose-900/70 border border-rose-800 text-rose-300 rounded-lg transition"
                    title="حذف"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ========================================================================= */}
      {/* CLONE RECITER CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {isCloneModalOpen && cloningSourceReciter && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-[#14241D] border border-[#2B5742] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl text-right animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-[#234235]">
              <h2 className="text-base font-bold font-amiri text-[#F0F5F2] flex items-center gap-2">
                <Copy className="w-5 h-5 text-[#34D399]" />
                <span>نسخ ملف قارئ كامل مع تلاواته</span>
              </h2>

              <button
                onClick={() => setIsCloneModalOpen(false)}
                className="text-[#8BA496] hover:text-white text-xs font-semibold"
              >
                إلغاء
              </button>
            </div>

            {/* Source Reciter Info */}
            <div className="p-3 bg-[#0D1813] border border-[#1F372C] rounded-xl flex items-center gap-3">
              <ReciterAvatar
                name={cloningSourceReciter.display_name}
                imageUrl={cloningSourceReciter.profile_image_path}
                size="md"
                shape="rounded"
              />
              <div>
                <div className="text-[11px] text-[#8BA496]">القارئ المصدر المراد نسخه:</div>
                <div className="font-bold text-sm text-white">{cloningSourceReciter.display_name}</div>
                <div className="text-[11px] text-[#A8C2B3]">{cloningSourceReciter.country}</div>
              </div>
            </div>

            <div className="p-3 bg-[#172B21] border border-[#27533E] rounded-xl text-xs text-[#C8DFD3] space-y-1">
              <div className="font-bold text-[#34D399] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                <span>ماذا سيحدث عند النسخ؟</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-[#A8C2B3]">
                <li>إنشاء سجل قارئ مستقل تماماً بهوية ومعرف جديد (<code className="text-white">reciter_id</code> جديد).</li>
                <li>نسخ جميع تلاوات القارئ مع تصفير الإحصائيات والإعجابات وعدد الاستماعات.</li>
                <li><strong>استقلالية تامة:</strong> تعديل القارئ الجديد أو تلاواته لن يؤثر إطلاقاً على القارئ الأصلي.</li>
                <li>فتح نموذج التعديل تلقائياً لتعديل الاسم وتطبيق قالب روابط الصوت دفعة واحدة.</li>
              </ul>
            </div>

            {cloneError && (
              <div className="p-3 bg-red-950/70 border border-red-800 rounded-xl text-xs text-red-200 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{cloneError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmClone} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="block font-semibold text-[#A8C2B3]">
                  اسم القارئ الجديد المراد إنشاؤه *
                </label>
                <input
                  type="text"
                  required
                  value={cloneTargetName}
                  onChange={(e) => setCloneTargetName(e.target.value)}
                  placeholder="مثال: الشيخ ياسر الدوسري"
                  className="w-full bg-[#0D1813] border border-[#264436] rounded-xl px-3 py-2.5 text-white font-bold focus:outline-none focus:border-[#4B8569]"
                />
              </div>

              <div className="space-y-1">
                <label className="block font-semibold text-[#A8C2B3]">دولة القارئ الجديد</label>
                <input
                  type="text"
                  list="admin-clone-countries"
                  value={cloneTargetCountry}
                  onChange={(e) => setCloneTargetCountry(e.target.value)}
                  placeholder="اختر أو اكتب الدولة"
                  className="w-full bg-[#0D1813] border border-[#264436] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#4B8569]"
                />
                <datalist id="admin-clone-countries">
                  {ALL_WORLD_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.name}>
                      {c.flag} {c.name}
                    </option>
                  ))}
                </datalist>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#234235]">
                <button
                  type="button"
                  onClick={() => setIsCloneModalOpen(false)}
                  disabled={isCloning}
                  className="px-4 py-2 bg-[#1A3328] hover:bg-[#224435] text-[#A8C2B3] rounded-xl font-semibold transition"
                >
                  إلغاء
                </button>

                <button
                  type="submit"
                  disabled={isCloning}
                  className="px-5 py-2 bg-[#2B5742] hover:bg-[#346950] text-white rounded-xl font-bold flex items-center gap-1.5 transition disabled:opacity-50 shadow-md"
                >
                  {isCloning ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>جاري نسخ ملف القارئ والتلاوات...</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>تأكيد النسخ والبدء بالتعديل</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CREATE / EDIT RECITER MODAL (With Scrollable Boundaries & URL Template Engine) */}
      {/* ========================================================================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-[#14241D] border border-[#2B5742] rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl text-right overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Sticky Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#234235] bg-[#14241D] shrink-0 sticky top-0 z-10">
              <h2 className="text-base font-bold font-amiri text-[#F0F5F2] flex items-center gap-2">
                <Users className="w-5 h-5 text-[#34D399]" />
                <span>{editingReciter ? `تعديل بيانات القارئ: ${displayName || editingReciter.display_name}` : 'إضافة قارئ جديد'}</span>
              </h2>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-[#8BA496] hover:text-white text-xs font-semibold px-2 py-1 rounded-lg hover:bg-[#1C362A] transition"
              >
                إغلاق
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
              {formError && (
                <div className="p-3 bg-red-950/70 border border-red-800 rounded-xl text-xs text-red-200 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <form id="reciterForm" onSubmit={handleSubmit} className="space-y-4">
                {/* Basic Reciter Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block font-semibold text-[#A8C2B3]">الاسم المعروض *</label>
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="مثال: الشيخ عبدالرحمن السديس"
                      className="w-full bg-[#0D1813] border border-[#264436] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#4B8569]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-semibold text-[#A8C2B3]">الاسم المستعار (اختياري)</label>
                    <input
                      type="text"
                      value={pseudonym}
                      onChange={(e) => setPseudonym(e.target.value)}
                      placeholder="اسم الشهرة أو اللقب"
                      className="w-full bg-[#0D1813] border border-[#264436] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#4B8569]"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 p-2 bg-[#0D1813] rounded-xl border border-[#1F372C]">
                  <input
                    type="checkbox"
                    id="usePseudonymCheckbox"
                    checked={usePseudonym}
                    onChange={(e) => setUsePseudonym(e.target.checked)}
                    className="rounded border-[#2B5742] bg-[#0D1813] text-[#34D399] focus:ring-0"
                  />
                  <label htmlFor="usePseudonymCheckbox" className="text-[#E8EFEA] cursor-pointer">
                    استخدام الاسم المستعار كاسم علني رئيسي في التطبيق
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block font-semibold text-[#A8C2B3]">الجنس</label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value as any)}
                      className="w-full bg-[#0D1813] border border-[#264436] rounded-xl px-3 py-2 text-white focus:outline-none"
                    >
                      <option value="MALE">ذكر</option>
                      <option value="FEMALE">أنثى</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="block font-semibold text-[#A8C2B3]">الدولة *</label>
                      <span className="text-[11px] text-[#6C8795]">اختر من القائمة أو اكتب يدوياً</span>
                    </div>
                    <input
                      type="text"
                      required
                      list="admin-countries-list"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="اختر أو اكتب اسم الدولة (مثال: مصر، السعودية، المغرب...)"
                      className="w-full bg-[#0D1813] border border-[#264436] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#55BFEA]"
                    />
                    <datalist id="admin-countries-list">
                      {ALL_WORLD_COUNTRIES.map((c) => (
                        <option key={c.code} value={c.name}>
                          {c.flag} {c.name}
                        </option>
                      ))}
                    </datalist>
                  </div>
                </div>

                {/* Identity Images */}
                <div className="space-y-3 pt-2 border-t border-[#1F372C]/60">
                  <label className="block font-semibold text-[#A8C2B3]">صور الهوية البصرية (الملف الشخصي، البنر، والشعار)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <UnifiedImageInput
                      label="الصورة الشخصية"
                      value={profileImagePath}
                      onChange={setProfileImagePath}
                      type="avatar"
                      name={displayName || 'قارئ'}
                      bucket="profile-images"
                    />

                    <UnifiedImageInput
                      label="صورة البنر (الغلاف)"
                      value={bannerImagePath}
                      onChange={setBannerImagePath}
                      type="banner"
                      name={displayName || 'قارئ'}
                      bucket="profile-images"
                    />

                    <UnifiedImageInput
                      label="شعار القارئ (Logo)"
                      value={logoImagePath}
                      onChange={setLogoImagePath}
                      type="logo"
                      name={displayName || 'قارئ'}
                      bucket="profile-images"
                    />
                  </div>
                </div>

                {/* Bio */}
                <div className="space-y-1">
                  <label className="block font-semibold text-[#A8C2B3]">السيرة والنبذة التعريفية</label>
                  <textarea
                    rows={2}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="نبذة عن إجازات القارئ وخبرته في التلاوة..."
                    className="w-full bg-[#0D1813] border border-[#264436] rounded-xl p-2.5 text-white focus:outline-none focus:border-[#4B8569]"
                  />
                </div>

                {/* Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-[#1F372C]">
                  <label className="flex items-center gap-2 p-2 bg-[#0D1813] border border-[#1F372C] rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isVerified}
                      onChange={(e) => setIsVerified(e.target.checked)}
                      className="rounded border-[#2B5742] bg-[#0D1813] text-[#34D399]"
                    />
                    <span>قارئ موثق</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-[#0D1813] border border-[#1F372C] rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isFeatured}
                      onChange={(e) => setIsFeatured(e.target.checked)}
                      className="rounded border-[#2B5742] bg-[#0D1813] text-[#D4AF37]"
                    />
                    <span>قارئ مميز</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-[#0D1813] border border-[#1F372C] rounded-xl cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPublished}
                      onChange={(e) => setIsPublished(e.target.checked)}
                      className="rounded border-[#2B5742] bg-[#0D1813] text-[#34D399]"
                    />
                    <span>نشر الملف العام</span>
                  </label>
                </div>

                {/* ============================================================= */}
                {/* Audio URL Template Engine Section (Included when editing) */}
                {/* ============================================================= */}
                {editingReciter && (
                  <div className="pt-3 border-t border-[#234235]">
                    <ReciterAudioUrlTemplateSection
                      reciterId={editingReciter.id}
                      reciterDisplayName={displayName || editingReciter.display_name}
                      onUrlsUpdated={() => {
                        setToastNotification({
                          type: 'success',
                          message: 'تم تحديث روابط التلاوات بنجاح لهذا القارئ'
                        });
                      }}
                    />
                  </div>
                )}
              </form>
            </div>

            {/* Sticky Footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-[#234235] bg-[#14241D] shrink-0 sticky bottom-0 z-10">
              <span className="text-[11px] text-[#8BA496]">
                {editingReciter ? 'التعديلات تحفظ مباشرة في السحابة' : 'سيتم إنشاء ملف القارئ الجديد'}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-[#1A3328] hover:bg-[#224435] text-[#A8C2B3] rounded-xl font-semibold transition"
                >
                  إلغاء
                </button>

                <button
                  type="submit"
                  form="reciterForm"
                  disabled={isSaving}
                  className="px-5 py-2 bg-[#2B5742] hover:bg-[#346950] text-white rounded-xl font-bold flex items-center gap-1.5 transition disabled:opacity-50 shadow-md"
                >
                  {isSaving ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      <span>{editingReciter ? 'حفظ بيانات القارئ' : 'إضافة القارئ'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
