import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PlayerState, Reciter, Recitation } from '../types';
import {
  X,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Heart,
  Share2,
  Gauge,
  Info,
  Sparkles,
  Headphones,
  Download,
  CheckCircle2,
  Loader2,
  ChevronDown,
  Volume2
} from 'lucide-react';
import { AudioService, audioService } from '../services/AudioService';
import { offlineAudioService } from '../services/OfflineAudioService';
import { ReciterAvatar } from './ReciterAvatar';

interface FullPlayerModalProps {
  playerState: PlayerState;
  reciters?: Reciter[];
  onClose: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (seconds: number) => void;
  onLikeToggle: (recitationId: string) => void;
  onReciterClick?: (reciterId: string) => void;
}

export const FullPlayerModal: React.FC<FullPlayerModalProps> = ({
  playerState,
  reciters,
  onClose,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
  onLikeToggle,
  onReciterClick
}) => {
  const current = playerState.currentRecitation;
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [showDetailsTab, setShowDetailsTab] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Match full reciter data if available
  const reciter = reciters?.find((r) => r.id === current?.reciterId);
  const bannerUrl = current?.reciterBannerUrl || reciter?.bannerUrl;
  const logoUrl = current?.reciterLogoUrl || reciter?.logoUrl;
  const avatarUrl = current?.reciterAvatar || reciter?.avatarUrl;

  // Lock background body scroll when modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Offline status tracking
  useEffect(() => {
    if (!current) return;
    setIsDownloaded(offlineAudioService.isDownloaded(current.id));
    const unsubscribe = offlineAudioService.subscribe((downloadedIds) => {
      setIsDownloaded(downloadedIds.has(current.id));
    });
    return () => {
      unsubscribe();
    };
  }, [current?.id]);

  if (!current) return null;

  const speeds = [0.75, 1.0, 1.25, 1.5, 2.0];
  const maxDuration = playerState.duration || current.duration || 100;

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      navigator
        .share({
          title: `${current.surahNameArabic} - القارئ ${current.reciterName}`,
          text: `استمع لتلاوة خاشعة من ${current.surahNameArabic} بصوت القارئ ${current.reciterName} عبر منصة تلاوتك للعالم`,
          url: window.location.href
        })
        .catch(() => {});
    } else {
      navigator.clipboard.writeText(
        `استمع لتلاوة ${current.surahNameArabic} بصوت ${current.reciterName} على منصة تلاوتك للعالم`
      );
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDownloaded || isDownloading) return;

    setIsDownloading(true);
    try {
      await offlineAudioService.downloadRecitation(current);
      setIsDownloaded(true);
    } catch (err) {
      console.warn('Failed to download offline audio:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const modalContent = (
    <div
      id="tilawatak-player-overlay"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-5 overflow-hidden font-tajawal select-none"
      dir="rtl"
    >
      {/* 1. Backdrop Overlay with Dark Tint and Heavy Blur */}
      <div
        className="fixed inset-0 bg-[#07131B]/85 backdrop-blur-2xl transition-opacity duration-300"
        onClick={onClose}
      />

      {/* 2. Ambient Atmosphere: Blurred Reciter Banner or Logo or Islamic Dark Gradient */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden select-none">
        {bannerUrl ? (
          <img
            src={bannerUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover scale-110 blur-3xl opacity-15"
          />
        ) : logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover scale-125 blur-3xl opacity-12"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#0B1E2B] via-[#0E2820] to-[#07131B] opacity-70" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-[#07131B]/85 via-[#0B1E2B]/80 to-[#07131B]/95" />
      </div>

      {/* 3. Subtle Reciter Watermark Logo (Emblem) in Center Background if available */}
      {logoUrl && (
        <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-0 overflow-hidden select-none">
          <img
            src={logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-56 h-56 sm:w-72 sm:h-72 object-contain opacity-10 filter drop-shadow-2xl"
          />
        </div>
      )}

      {/* 4. Independent Modal Container (Mobile First, High-Contrast & Elegant) */}
      <div
        className="relative z-10 bg-[#0B1E2B]/95 text-white rounded-3xl w-full max-w-md border border-[#1E435E]/80 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] p-4 sm:p-6 flex flex-col justify-between max-h-[92dvh] sm:max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between border-b border-[#1A3A50] pb-3 mb-2 shrink-0">
          {/* Close Button (Right side in RTL) */}
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 flex items-center justify-center text-white transition-all shadow-xs border border-white/10"
            title="إغلاق المشغل والعودة للتطبيق"
          >
            <ChevronDown className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>

          {/* Central Title */}
          <div className="text-center flex-1 px-2">
            <span className="text-[11px] text-[#55BFEA] font-bold tracking-wide flex items-center justify-center gap-1">
              <Volume2 className="w-3 h-3 animate-pulse" />
              <span>مشغل تلاوتك للعالم</span>
            </span>
            <h3 className="text-xs font-semibold text-[#9BBACD] truncate font-amiri">
              تلاوة قرآنية خاشعة ومباركة
            </h3>
          </div>

          {/* Details / Tab Toggle */}
          <button
            type="button"
            onClick={() => setShowDetailsTab(!showDetailsTab)}
            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center text-white transition-all shadow-xs border ${
              showDetailsTab
                ? 'bg-[#1687C7] border-[#55BFEA]'
                : 'bg-white/10 hover:bg-white/20 border-white/10'
            }`}
            title={showDetailsTab ? 'العودة للمشغل' : 'بيانات واعتماد التلاوة'}
          >
            <Info className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        {!showDetailsTab ? (
          <div className="flex-1 flex flex-col justify-between space-y-3 sm:space-y-4 py-1 overflow-y-auto no-scrollbar">
            {/* Reciter Avatar & Verification */}
            <div className="flex flex-col items-center text-center pt-1">
              <div className="relative mb-2 sm:mb-3">
                <ReciterAvatar
                  name={current.reciterName}
                  imageUrl={avatarUrl}
                  size="xl"
                  shape="circle"
                  isVerified={reciter?.verified}
                  showVerifiedBadge={true}
                  className="w-24 h-24 sm:w-28 sm:h-28 ring-4 ring-[#1687C7]/30 shadow-2xl"
                />
                {playerState.isPlaying && (
                  <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 bg-[#1687C7] text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md flex items-center gap-1 border border-white/20 whitespace-nowrap">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                    <span>جارِ الاستماع</span>
                  </div>
                )}
              </div>

              {/* Reciter Name with click trigger to profile */}
              <button
                type="button"
                onClick={() => {
                  if (onReciterClick) {
                    onClose();
                    onReciterClick(current.reciterId);
                  }
                }}
                className={`inline-flex items-center gap-1.5 text-xs sm:text-sm font-bold text-[#55BFEA] hover:text-white transition-colors ${
                  onReciterClick ? 'cursor-pointer hover:underline' : ''
                }`}
                title="عرض الملف الشخصي للقارئ"
              >
                <span>القارئ: {current.reciterName}</span>
                {current.reciterCountry && (
                  <span className="text-[11px] text-[#9BBACD]">({current.reciterCountry})</span>
                )}
              </button>

              {/* Surah Name in Amiri font */}
              <h2 className="text-2xl sm:text-3xl font-bold font-amiri text-white drop-shadow-sm mt-1 leading-tight">
                {current.surahNameArabic}
              </h2>

              {/* Riwayah & Ayah range */}
              <div className="flex items-center justify-center gap-2 flex-wrap text-xs text-[#9BBACD] mt-1">
                <span className="px-2.5 py-0.5 rounded-full bg-white/10 text-[#E7F7FD] border border-white/10 font-medium text-[11px]">
                  {current.riwayah}
                </span>
                <span>•</span>
                <span className="text-[11px]">الآيات: {current.ayahRange || 'كاملة'}</span>
              </div>

              {/* Listen Count */}
              <div className="inline-flex items-center gap-1 text-[11px] text-[#55BFEA] bg-[#1687C7]/15 px-2.5 py-0.5 rounded-full mt-2 border border-[#1687C7]/30">
                <Headphones className="w-3 h-3" />
                <span>{current.listenCount.toLocaleString('ar-EG')} استماع</span>
              </div>
            </div>

            {/* Seek Bar & Timers */}
            <div className="space-y-1.5 px-1">
              <div className="relative flex items-center">
                <input
                  type="range"
                  min={0}
                  max={maxDuration}
                  step={1}
                  value={playerState.currentTime}
                  onChange={(e) => onSeek(parseFloat(e.target.value))}
                  className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#55BFEA] hover:accent-[#1687C7] transition-all"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-[#9BBACD] font-mono select-none" dir="ltr">
                <span>{AudioService.formatDuration(playerState.currentTime)}</span>
                <span>{AudioService.formatDuration(maxDuration)}</span>
              </div>
            </div>

            {/* Playback Controls (Previous, Play/Pause, Next, Speed) */}
            <div className="flex items-center justify-center gap-4 sm:gap-6 py-1">
              {/* Previous */}
              <button
                type="button"
                onClick={onPrevious}
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center transition-all border border-white/10 shadow-xs"
                title="التلاوة السابقة"
              >
                <SkipForward className="w-5 h-5 rotate-180" />
              </button>

              {/* Central Play/Pause Button */}
              <button
                type="button"
                onClick={onTogglePlay}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-tr from-[#1687C7] to-[#55BFEA] text-white flex items-center justify-center shadow-xl active:scale-95 transition-all ring-4 ring-[#1687C7]/30 hover:brightness-110"
                title={playerState.isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
              >
                {playerState.isPlaying ? (
                  <Pause className="w-7 h-7 fill-current" />
                ) : (
                  <Play className="w-7 h-7 fill-current mr-1" />
                )}
              </button>

              {/* Next */}
              <button
                type="button"
                onClick={onNext}
                className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-white/10 hover:bg-white/20 active:scale-95 text-white flex items-center justify-center transition-all border border-white/10 shadow-xs"
                title="التلاوة التالية"
              >
                <SkipBack className="w-5 h-5 rotate-180" />
              </button>
            </div>

            {/* Bottom Actions Row: Like, Download Offline, Share, Speed Selector */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#1A3A50]/80">
              {/* Like */}
              <button
                type="button"
                onClick={() => onLikeToggle(current.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                  current.isLiked
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-white/5 hover:bg-white/10 text-[#E7F7FD] border-white/10'
                }`}
                title="إعجاب بالتلاوة"
              >
                <Heart className={`w-4 h-4 ${current.isLiked ? 'fill-rose-500 text-rose-500' : ''}`} />
                <span>{current.likeCount.toLocaleString('ar-EG')}</span>
              </button>

              {/* Download Offline */}
              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloaded || isDownloading}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all border ${
                  isDownloaded
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-white/5 hover:bg-white/10 text-[#E7F7FD] border-white/10'
                }`}
                title={isDownloaded ? 'محفوظة للاستماع دون اتصال' : 'تحميل للاستماع دون اتصال'}
              >
                {isDownloading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#55BFEA]" />
                ) : isDownloaded ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>{isDownloaded ? 'محفوظة' : 'تحميل'}</span>
              </button>

              {/* Share */}
              <button
                type="button"
                onClick={handleShare}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-[#E7F7FD] border border-white/10 transition-colors"
                title="مشاركة التلاوة"
              >
                <Share2 className="w-4 h-4" />
              </button>

              {/* Speed Selector */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSpeedMenuOpen(!speedMenuOpen)}
                  className="px-2.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-[#E7F7FD] text-xs font-bold border border-white/10 transition-colors flex items-center gap-1"
                  title="سرعة التلاوة"
                >
                  <Gauge className="w-3.5 h-3.5 text-[#55BFEA]" />
                  <span>{playerState.playbackSpeed}x</span>
                </button>

                {speedMenuOpen && (
                  <div className="absolute bottom-11 left-0 bg-[#07131B] border border-[#1E435E] rounded-2xl p-1 shadow-2xl z-50 flex flex-col gap-1 min-w-[70px]">
                    {speeds.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          audioService.setSpeed(s);
                          setSpeedMenuOpen(false);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold text-center transition-colors ${
                          playerState.playbackSpeed === s
                            ? 'bg-[#1687C7] text-white'
                            : 'text-[#9BBACD] hover:bg-white/10'
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Recitation & Reciter Details Sub-View */
          <div className="p-3 sm:p-4 space-y-3 bg-white/5 rounded-2xl border border-[#1A3A50] overflow-y-auto flex-1 my-2">
            <h4 className="font-bold text-sm text-[#55BFEA] font-amiri flex items-center gap-2">
              <Info className="w-4 h-4" />
              <span>بطاقة التلاوة والاعتماد</span>
            </h4>

            <div className="space-y-2 text-xs text-[#E7F7FD]">
              <div className="flex justify-between py-1 border-b border-white/10">
                <span className="text-[#9BBACD]">السورة:</span>
                <span className="font-bold font-amiri text-sm">{current.surahNameArabic}</span>
              </div>

              <div className="flex justify-between py-1 border-b border-white/10">
                <span className="text-[#9BBACD]">القارئ:</span>
                <span className="font-semibold">{current.reciterName}</span>
              </div>

              <div className="flex justify-between py-1 border-b border-white/10">
                <span className="text-[#9BBACD]">الرواية:</span>
                <span className="text-[#55BFEA] font-semibold">{current.riwayah}</span>
              </div>

              <div className="flex justify-between py-1 border-b border-white/10">
                <span className="text-[#9BBACD]">الآيات المسجلة:</span>
                <span>{current.ayahRange || 'كاملة'}</span>
              </div>

              <div className="flex justify-between py-1 border-b border-white/10">
                <span className="text-[#9BBACD]">مرات الاستماع:</span>
                <span>{current.listenCount.toLocaleString('ar-EG')}</span>
              </div>

              <div className="flex justify-between py-1 border-b border-white/10">
                <span className="text-[#9BBACD]">الإعجابات:</span>
                <span>{current.likeCount.toLocaleString('ar-EG')}</span>
              </div>

              {current.description && (
                <div className="pt-1">
                  <span className="text-[#9BBACD] block mb-1">وصف التسجيل:</span>
                  <p className="text-[#E7F7FD] bg-white/5 p-2 rounded-xl leading-relaxed text-xs">
                    {current.description}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-3 p-2.5 rounded-xl bg-[#1687C7]/20 border border-[#1687C7]/40 text-xs text-[#E7F7FD] space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-[#55BFEA]">
                <Sparkles className="w-3.5 h-3.5" />
                <span>حالة الجودة والاعتماد</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                تلاوة قرآنية خاضعة لمراجعة الأداء وأحكام التجويد والترتيل المعتمدة في منصة تلاوتك للعالم.
              </p>
            </div>
          </div>
        )}

        {/* Modal Footer Note */}
        <div className="mt-2 pt-2 border-t border-[#1A3A50] text-center text-[10px] text-[#6C8795] shrink-0">
          تلاوتك للعالم • صوتك القرآني يصل لكل قلب
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null;
};
