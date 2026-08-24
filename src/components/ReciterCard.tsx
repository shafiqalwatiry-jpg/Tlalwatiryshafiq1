import React from 'react';
import { Reciter } from '../types';
import { Globe, Headphones, Heart, BookOpen, Sparkles } from 'lucide-react';
import { ReciterAvatar } from './ReciterAvatar';

interface ReciterCardProps {
  reciter: Reciter;
  onClick: (reciter: Reciter) => void;
}

export const ReciterCard: React.FC<ReciterCardProps> = ({ reciter, onClick }) => {
  return (
    <div
      onClick={() => onClick(reciter)}
      className="cursor-pointer bg-white rounded-3xl p-5 border border-[#D8E8F2] hover:border-[#1687C7] shadow-2xs hover:shadow-md transition-all duration-200 group flex flex-col justify-between"
    >
      <div>
        {/* Reciter Avatar & Verification */}
        <div className="flex items-start gap-3.5">
          <ReciterAvatar
            name={reciter.displayName}
            imageUrl={reciter.avatarUrl}
            size="lg"
            isVerified={reciter.verified}
            showVerifiedBadge={true}
          />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="font-bold text-sm text-[#193B4D] group-hover:text-[#1687C7] transition-colors truncate font-amiri">
                {reciter.displayName}
              </h4>
              {reciter.isAnonymous && (
                <span className="text-[10px] bg-[#F6FBFF] border border-[#D8E8F2] text-[#6C8795] px-1.5 py-0.2 rounded-md font-medium">
                  مستعار
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 text-xs text-[#6C8795] mt-1">
              <Globe className="w-3.5 h-3.5 text-[#1687C7]" />
              <span>{reciter.country}</span>
            </div>

            {reciter.isStaffPick && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#145273] bg-[#F2C96B]/20 border border-[#F2C96B]/40 px-2 py-0.5 rounded-full mt-1.5">
                <Sparkles className="w-3 h-3 text-[#F2C96B]" />
                <span>اختيار الإدارة</span>
              </span>
            )}
          </div>
        </div>

        {/* Bio Snippet */}
        {reciter.bio && (
          <p className="text-xs text-[#6C8795] line-clamp-2 mt-3 leading-relaxed">
            {reciter.bio}
          </p>
        )}
      </div>

      {/* Stats Bar */}
      <div className="mt-4 pt-3 border-t border-[#D8E8F2]/70 flex items-center justify-between text-[11px] text-[#6C8795]">
        <div className="flex items-center gap-1" title="عدد التلاوات المعتمدة">
          <BookOpen className="w-3.5 h-3.5 text-[#1687C7]" />
          <span>{reciter.stats.totalRecitations} تلاوات</span>
        </div>

        <div className="flex items-center gap-1" title="إجمالي مرات الاستماع">
          <Headphones className="w-3.5 h-3.5 text-[#55BFEA]" />
          <span>{reciter.stats.totalListens.toLocaleString('ar-EG')}</span>
        </div>

        <div className="flex items-center gap-1" title="إجمالي الإعجابات">
          <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-50" />
          <span>{reciter.stats.totalLikes.toLocaleString('ar-EG')}</span>
        </div>
      </div>
    </div>
  );
};
