import React, { useState, useEffect } from 'react';
import { adminService } from '../../services/AdminService';
import {
  generateReciterSlug,
  detectIdentifierInUrl,
  transformRecitationUrl,
  generateUrlPreviewList,
  TransformUrlOptions
} from '../../utils/audioUrlTemplate';
import {
  Link2,
  Wand2,
  Sparkles,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Eye,
  Layers,
  Code2,
  HelpCircle,
  ListMusic,
  ArrowLeft
} from 'lucide-react';

interface ReciterAudioUrlTemplateSectionProps {
  reciterId: string;
  reciterDisplayName: string;
  onUrlsUpdated?: (updatedCount: number) => void;
}

export function ReciterAudioUrlTemplateSection({
  reciterId,
  reciterDisplayName,
  onUrlsUpdated
}: ReciterAudioUrlTemplateSectionProps) {
  const [recitations, setRecitations] = useState<any[]>([]);
  const [isLoadingRecitations, setIsLoadingRecitations] = useState(true);
  const [mode, setMode] = useState<'template' | 'replace'>('template');

  // Template Mode State
  const [reciterSlug, setReciterSlug] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('');

  // Replace Mode State
  const [replaceFrom, setReplaceFrom] = useState('');
  const [replaceTo, setReplaceTo] = useState('');

  // Preview & Action State
  const [showAllPreviews, setShowAllPreviews] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyStatus, setApplyStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Load reciter recitations
  const loadRecitations = async () => {
    if (!reciterId) return;
    setIsLoadingRecitations(true);
    try {
      const data = await adminService.getReciterRecitations(reciterId);
      setRecitations(data || []);

      // Auto-detect initial values from sample URL
      if (data && data.length > 0) {
        const sample = data[0].externalAudioUrl || data[0].audioStoragePath || '';
        const detected = detectIdentifierInUrl(sample);

        const autoSlug = generateReciterSlug(reciterDisplayName);
        setReciterSlug(autoSlug);

        if (sample && !urlTemplate) {
          if (detected.identifier && detected.hasNumber) {
            // Build smart template replacing the detected identifier
            const templated = sample
              .replace(detected.identifier, '{reciter}')
              .replace(/(\d{1,3})(\.mp3|\.m4a|\.wav)/i, (m, num, ext) => {
                return num.length === 3 ? `{surah_number_padded}${ext}` : `{surah_number}${ext}`;
              });
            setUrlTemplate(templated);
          } else {
            setUrlTemplate(sample);
          }
        }

        if (detected.identifier && !replaceFrom) {
          setReplaceFrom(detected.identifier);
          setReplaceTo(autoSlug);
        }
      }
    } catch (err) {
      console.warn('Failed to load recitations for reciter:', err);
    } finally {
      setIsLoadingRecitations(false);
    }
  };

  useEffect(() => {
    loadRecitations();
  }, [reciterId]);

  // Update slug when reciter name changes if empty
  useEffect(() => {
    if (!reciterSlug && reciterDisplayName) {
      setReciterSlug(generateReciterSlug(reciterDisplayName));
    }
  }, [reciterDisplayName]);

  // Quick preset templates
  const presets = [
    {
      title: 'خادم Mp3Quran القياسي (3 خانات)',
      template: 'https://server.mp3quran.net/{reciter}/{surah_number_padded}.mp3'
    },
    {
      title: 'مشروع EveryAyah (معرف القارئ)',
      template: 'https://everyayah.com/data/{reciter}/{surah_number_padded}.mp3'
    },
    {
      title: 'تخزين السحاب المباشر (تلاوتك)',
      template: 'https://ixkganrxtkywypvqkqkn.supabase.co/storage/v1/object/public/recitation-audio/{reciter}/{surah_number_padded}.mp3'
    }
  ];

  // Options for transformer
  const transformOptions: TransformUrlOptions = {
    mode,
    urlTemplate,
    reciterSlug,
    replaceFrom,
    replaceTo
  };

  // Generate preview diffs
  const previewList = generateUrlPreviewList(recitations, transformOptions);
  const changedCount = previewList.filter((p) => p.isChanged).length;

  // Apply batch update
  const handleApplyTemplate = async () => {
    if (changedCount === 0) {
      setApplyStatus({
        type: 'error',
        message: 'لا توجد تغييرات لتطبيقها على روابط التلاوات'
      });
      return;
    }

    if (!window.confirm(`هل أنت متأكد من تطبيق القالب وتحديث روابط ${changedCount} تلاوة لهذا القارئ؟`)) {
      return;
    }

    setIsApplying(true);
    setApplyStatus(null);

    try {
      const result = await adminService.applyReciterAudioTemplate(reciterId, transformOptions);
      setApplyStatus({
        type: 'success',
        message: `تم تحديث روابط ${result.updatedCount} تلاوة بنجاح!`
      });

      await loadRecitations();
      if (onUrlsUpdated) {
        onUrlsUpdated(result.updatedCount);
      }
    } catch (e: any) {
      setApplyStatus({
        type: 'error',
        message: e?.message || 'فشل تطبيق قالب الروابط'
      });
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="bg-[#0B1511] border border-[#234235] rounded-2xl p-4 space-y-4 text-xs font-tajawal">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#1C362A]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#173024] border border-[#2B5742] flex items-center justify-center text-[#34D399]">
            <Wand2 className="w-4 h-4" />
          </div>
          <div>
            <h4 className="font-bold text-[#F0F5F2] text-sm flex items-center gap-1.5">
              <span>قالب روابط الصوت الذكي (Audio URL Engine)</span>
              <span className="px-2 py-0.5 bg-[#1F3D2F] border border-[#2F5E48] rounded-full text-[10px] text-[#A8C2B3]">
                {isLoadingRecitations ? '...' : `${recitations.length} تلاوة`}
              </span>
            </h4>
            <p className="text-[11px] text-[#8BA496]">
              تحديث جماعي وفوري لروابط ملفات السور بنقرة واحدة باستخدام القوالب أو استبدال المعرّف
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadRecitations}
          disabled={isLoadingRecitations}
          className="p-1.5 bg-[#14261E] hover:bg-[#1D382C] text-[#A8C2B3] rounded-lg border border-[#254636] transition"
          title="تحديث قائمة التلاوات"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRecitations ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {isLoadingRecitations ? (
        <div className="py-6 text-center text-[#8BA496] space-y-2">
          <div className="w-5 h-5 border-2 border-[#34D399]/30 border-t-[#34D399] rounded-full animate-spin mx-auto"></div>
          <p>جاري فحص تلاوات القارئ...</p>
        </div>
      ) : recitations.length === 0 ? (
        <div className="py-6 px-3 bg-[#112019] rounded-xl border border-dashed border-[#234235] text-center space-y-1">
          <p className="text-[#A8C2B3] font-bold">لا توجد تلاوات مسجلة لهذا القارئ حتى الآن</p>
          <p className="text-[11px] text-[#6E8E7E]">
            عند نسخ ملف قارئ أو رفع تلاوات، ستتمكن من تطبيق القالب على جميع السور دفعة واحدة.
          </p>
        </div>
      ) : (
        <>
          {/* Mode Switcher */}
          <div className="flex items-center gap-2 p-1 bg-[#12211A] border border-[#234235] rounded-xl">
            <button
              type="button"
              onClick={() => setMode('template')}
              className={`flex-1 py-1.5 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition ${
                mode === 'template'
                  ? 'bg-[#2B5742] text-white shadow-sm'
                  : 'text-[#8BA496] hover:text-white'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>نمط القالب المتغير (Template)</span>
            </button>

            <button
              type="button"
              onClick={() => setMode('replace')}
              className={`flex-1 py-1.5 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition ${
                mode === 'replace'
                  ? 'bg-[#2B5742] text-white shadow-sm'
                  : 'text-[#8BA496] hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>استبدال المعرّف المباشر (Quick Replace)</span>
            </button>
          </div>

          {/* Mode 1: Template Config */}
          {mode === 'template' && (
            <div className="space-y-3 p-3 bg-[#112019] border border-[#213C2F] rounded-xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block font-semibold text-[#A8C2B3] flex items-center justify-between">
                    <span>معرّف القارئ في الرابط (Reciter Slug)</span>
                    <button
                      type="button"
                      onClick={() => setReciterSlug(generateReciterSlug(reciterDisplayName))}
                      className="text-[10px] text-[#34D399] hover:underline flex items-center gap-0.5"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>توليد تلقائي</span>
                    </button>
                  </label>
                  <input
                    type="text"
                    value={reciterSlug}
                    onChange={(e) => setReciterSlug(e.target.value)}
                    placeholder="مثال: yasser_aldosari أو k_aljaleel"
                    className="w-full bg-[#0B1511] border border-[#264436] rounded-xl px-3 py-2 text-white font-mono text-[11px] focus:outline-none focus:border-[#4B8569]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-[#A8C2B3]">
                    قوالب جاهزة سريعة
                  </label>
                  <select
                    onChange={(e) => {
                      if (e.target.value) setUrlTemplate(e.target.value);
                    }}
                    defaultValue=""
                    className="w-full bg-[#0B1511] border border-[#264436] rounded-xl px-3 py-2 text-white text-xs focus:outline-none"
                  >
                    <option value="" disabled>اختر قالباً للتعبئة السريعة...</option>
                    {presets.map((p, idx) => (
                      <option key={idx} value={p.template}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block font-semibold text-[#A8C2B3]">
                  صيغة القالب (Template URL)
                </label>
                <input
                  type="text"
                  value={urlTemplate}
                  onChange={(e) => setUrlTemplate(e.target.value)}
                  placeholder="https://server.com/{reciter}/{surah_number_padded}.mp3"
                  className="w-full bg-[#0B1511] border border-[#264436] rounded-xl px-3 py-2 text-white font-mono text-[11px] focus:outline-none focus:border-[#4B8569]"
                />
              </div>

              {/* Supported Tokens Guide */}
              <div className="p-2.5 bg-[#0D1813] border border-[#1A3125] rounded-lg text-[11px] text-[#8BA496] space-y-1">
                <div className="flex items-center gap-1 text-[#34D399] font-bold">
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>المتغيرات المدعومة داخل القالب:</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono text-[10px] text-[#A8C2B3]">
                  <span className="bg-[#14261E] p-1 rounded border border-[#224032]">{'{reciter}'} → المعرف</span>
                  <span className="bg-[#14261E] p-1 rounded border border-[#224032]">{'{surah_number_padded}'} → 001..114</span>
                  <span className="bg-[#14261E] p-1 rounded border border-[#224032]">{'{surah_number}'} → 1..114</span>
                  <span className="bg-[#14261E] p-1 rounded border border-[#224032]">{'{surah_name}'} → الفاتحة</span>
                </div>
              </div>
            </div>
          )}

          {/* Mode 2: Quick Replace Config */}
          {mode === 'replace' && (
            <div className="space-y-3 p-3 bg-[#112019] border border-[#213C2F] rounded-xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block font-semibold text-[#A8C2B3]">المعرف أو النص القديم في الرابط</label>
                  <input
                    type="text"
                    value={replaceFrom}
                    onChange={(e) => setReplaceFrom(e.target.value)}
                    placeholder="مثال: khalid أو jaleel"
                    className="w-full bg-[#0B1511] border border-[#264436] rounded-xl px-3 py-2 text-white font-mono text-[11px] focus:outline-none focus:border-[#4B8569]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block font-semibold text-[#A8C2B3]">المعرف أو النص الجديد البديل</label>
                  <input
                    type="text"
                    value={replaceTo}
                    onChange={(e) => setReplaceTo(e.target.value)}
                    placeholder="مثال: yasser أو dosari"
                    className="w-full bg-[#0B1511] border border-[#264436] rounded-xl px-3 py-2 text-white font-mono text-[11px] focus:outline-none focus:border-[#4B8569]"
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#8BA496]">
                سيتم استبدال كل تكرار لـ <code className="text-emerald-300 font-mono">"{replaceFrom || '...'}"</code> في جميع روابط التلاوات بـ <code className="text-emerald-300 font-mono">"{replaceTo || '...'}"</code>.
              </p>
            </div>
          )}

          {/* Live Diff Preview Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#E2EBE6] flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-[#34D399]" />
                <span>معاينة التغيير قبل التطبيق</span>
                <span className="text-[11px] font-normal text-[#8BA496]">
                  (سيتم تعديل <strong className="text-emerald-400 font-mono">{changedCount}</strong> من أصل {recitations.length} تلاوة)
                </span>
              </span>

              <button
                type="button"
                onClick={() => setShowAllPreviews(!showAllPreviews)}
                className="text-[11px] text-[#34D399] hover:underline"
              >
                {showAllPreviews ? 'عرض عينات فقط' : 'عرض كافة السور الـ 114'}
              </button>
            </div>

            {/* Preview List */}
            <div className="max-h-48 overflow-y-auto space-y-2 p-2.5 bg-[#09120E] border border-[#1C362A] rounded-xl">
              {(showAllPreviews ? previewList : previewList.slice(0, 3)).map((item, idx) => (
                <div
                  key={idx}
                  className="p-2 bg-[#12211A] border border-[#1F3A2C] rounded-lg space-y-1 font-mono text-[10px]"
                >
                  <div className="flex items-center justify-between text-[#8BA496] font-tajawal text-[11px]">
                    <span className="font-bold text-[#F0F5F2]">
                      سورة {item.surahName} ({item.surahNumber})
                    </span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] ${
                        item.isChanged
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-zinc-900 text-zinc-400'
                      }`}
                    >
                      {item.isChanged ? 'سيتم التعديل' : 'مطابق'}
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    <div className="text-zinc-400 truncate" title={item.originalUrl}>
                      <span className="text-zinc-500 select-none">الرابط الحالي: </span>
                      {item.originalUrl || '<لا يوجد رابط>'}
                    </div>
                    <div
                      className={`truncate ${
                        item.isChanged ? 'text-emerald-300 font-bold' : 'text-zinc-500'
                      }`}
                      title={item.newUrl}
                    >
                      <span className="text-emerald-500/80 select-none">الرابط الجديد: </span>
                      {item.newUrl || '<لا يوجد رابط>'}
                    </div>
                  </div>
                </div>
              ))}

              {!showAllPreviews && previewList.length > 3 && (
                <div className="text-center py-1 text-[10px] text-[#6E8E7E]">
                  + {previewList.length - 3} تلاوة أخرى ستخضع لنفس القالب بدقة
                </div>
              )}
            </div>
          </div>

          {/* Status Message */}
          {applyStatus && (
            <div
              className={`p-3 rounded-xl border flex items-center gap-2 text-xs ${
                applyStatus.type === 'success'
                  ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                  : 'bg-rose-950/80 border-rose-800 text-rose-200'
              }`}
            >
              {applyStatus.type === 'success' ? (
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{applyStatus.message}</span>
            </div>
          )}

          {/* Apply Button */}
          <div className="pt-2 flex items-center justify-between">
            <span className="text-[11px] text-[#8BA496]">
              تحديث جماعي لكافة ملفات السور
            </span>

            <button
              type="button"
              onClick={handleApplyTemplate}
              disabled={isApplying || changedCount === 0}
              className="px-4 py-2 bg-[#2B5742] hover:bg-[#346950] text-white rounded-xl font-bold flex items-center gap-1.5 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isApplying ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>جاري تحديث الروابط...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>تطبيق القالب على ({changedCount}) تلاوة</span>
                </>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
