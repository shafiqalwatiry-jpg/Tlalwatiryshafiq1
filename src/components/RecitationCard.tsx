import React, { useState, useEffect } from 'react';
import { Recitation, PlayerState } from '../types';
import { offlineAudioService } from '../services/OfflineAudioService';
import {
  Play,
  Pause,
  Heart,
  Headphones,
  Clock,
  Share2,
  Download,
  CheckCircle2,
  Loader2
} from 'lucide-react';

interface RecitationCardProps {
  recitation: Recitation;
  playerState: PlayerState;
  onPlay: (recitation: Recitation) => void;
  onLikeToggle: (recitationId: string) => void;
  onReciterClick?: (reciterId: string) => void;
}

export const RecitationCard: React.FC<RecitationCardProps> = ({
  recitation,
  playerState,
  onPlay,
  onLikeToggle
}) => {
  const [isDownloaded, setIsDownloaded] = useState(() =>
    offlineAudioService.isDownloaded(recitation.id)
  );
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    setIsDownloaded(offlineAudioService.isDownloaded(recitation.id));
    const unsubscribe = offlineAudioService.subscribe((downloadedIds) => {
      setIsDownloaded(downloadedIds.has(recitation.id));
    });
    return () => {
      unsubscribe();
    };
  }, [recitation.id]);

  const isCurrentPlaying =
    playerState.currentRecitation?.id === recitation.id && playerState.isPlaying;
  const isCurrentSelected = playerState.currentRecitation?.id === recitation.id;

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      navigator
        .share({
          title: `${recitation.surahNameArabic} - تلاوتك للعالم`,
          text: `استمع لتلاوة مباركة من ${recitation.surahNameArabic}`,
          url: window.location.href
        })
        .catch(() => {});
    } else {
      navigator.clipboard.writeText(
        `تلاوة ${recitation.surahNameArabic} - منصة تلاوتك للعالم`
      );
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDownloaded || isDownloading) return;

    setIsDownloading(true);
    try {
      await offlineAudioService.downloadRecitation(recitation);
      setIsDownloaded(true);
    } catch (err) {
      console.warn('Failed to download audio for offline:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      className={`relative bg-white rounded-2xl px-4 py-3 sm:py-3.5 border transition-all duration-200 shadow-2xs hover:shadow-md flex items-center justify-between gap-3 ${
        isCurrentSelected
          ? 'border-[#1687C7] bg-[#E7F7FD]/40 ring-2 ring-[#1687C7]/20'
          : 'border-[#D8E8F2] hover:border-[#55BFEA]'
      }`}
    >
      {/* Right side: Play Button + Surah Name & Riwayah */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Play/Pause Button Circle */}
        <button
          type="button"
          onClick={() => onPlay(recitation)}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform active:scale-95 shadow-2xs shrink-0 ${
            isCurrentPlaying
              ? 'bg-[#1687C7] text-white ring-3 ring-[#1687C7]/25'
              : 'bg-[#F6FBFF] border border-[#D8E8F2] text-[#1687C7] hover:bg-[#1687C7] hover:text-white'
          }`}
          title={isCurrentPlaying ? 'إيقاف مؤقت' : 'تشغيل التلاوة'}
        >
          {isCurrentPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current mr-0.5" />
          )}
        </button>

        {/* Surah Name & Meta (Clickable to Play/Pause) */}
        <div
          onClick={() => onPlay(recitation)}
          className="min-w-0 flex-1 cursor-pointer group select-none"
          title="اضغط لتشغيل أو إيقاف السورة"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-bold text-sm sm:text-base text-[#193B4D] group-hover:text-[#1687C7] transition-colors font-amiri leading-tight">
              {recitation.surahNameArabic}
            </h4>

            {recitation.isStaffPick && (
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-[#F2C96B]/20 text-[#145273] border border-[#F2C96B]/40">
                مختارة
              </span>
            )}

            <span className="text-[11px] text-[#6C8795] font-tajawal hidden sm:inline-block">
              {recitation.riwayah} • {recitation.ayahRange || 'كاملة'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[#6C8795] sm:hidden mt-0.5">
            <span>{recitation.riwayah}</span>
          </div>
        </div>
      </div>

      {/* Left side: 4 Actions in the same compact row (Listens, Download, Share, Like) + Duration */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Duration */}
        <div className="hidden md:flex items-center gap-1 text-[11px] text-[#6C8795] bg-[#F6FBFF] px-2 py-0.5 rounded-lg border border-[#D8E8F2]">
          <Clock className="w-3 h-3 text-[#6C8795]" />
          <span dir="ltr">{recitation.durationFormatted}</span>
        </div>

        {/* Listen Count */}
        <div className="flex items-center gap-1 text-xs text-[#6C8795] px-1.5 py-1 rounded-lg bg-[#F6FBFF] border border-[#D8E8F2]/60" title="مرات الاستماع">
          <Headphones className="w-3.5 h-3.5 text-[#1687C7]" />
          <span className="font-semibold text-[11px]">{recitation.listenCount.toLocaleString('ar-EG')}</span>
        </div>

        {/* Download Offline */}
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloaded || isDownloading}
          className={`p-1.5 rounded-lg transition-colors ${
            isDownloaded
              ? 'text-emerald-600 bg-emerald-50'
              : 'text-[#6C8795] hover:text-[#1687C7] hover:bg-[#F6FBFF]'
          }`}
          title={isDownloaded ? 'محفوظة للاستماع دون اتصال' : 'تحميل للاستماع دون اتصال'}
        >
          {isDownloading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1687C7]" />
          ) : isDownloaded ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Share */}
        <button
          type="button"
          onClick={handleShare}
          className="p-1.5 text-[#6C8795] hover:text-[#1687C7] rounded-lg hover:bg-[#F6FBFF] transition-colors"
          title="مشاركة التلاوة"
        >
          <Share2 className="w-3.5 h-3.5" />
        </button>

        {/* Like */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLikeToggle(recitation.id);
          }}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all ${
            recitation.isLiked
              ? 'bg-rose-50 text-rose-600 border border-rose-200'
              : 'text-[#6C8795] hover:bg-[#F6FBFF] border border-[#D8E8F2]/60'
          }`}
          title="إعجاب"
        >
          <Heart
            className={`w-3.5 h-3.5 ${
              recitation.isLiked ? 'fill-rose-500 text-rose-500' : 'text-[#6C8795]'
            }`}
          />
          <span className="text-[11px]">{recitation.likeCount.toLocaleString('ar-EG')}</span>
        </button>
      </div>
    </div>
  );
};
