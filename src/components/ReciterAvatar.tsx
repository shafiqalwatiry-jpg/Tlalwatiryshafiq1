import React, { useState } from 'react';
import { CheckCircle2, User } from 'lucide-react';
import { SupabaseService } from '../services/SupabaseService';

interface ReciterAvatarProps {
  name?: string;
  imageUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  isVerified?: boolean;
  showVerifiedBadge?: boolean;
  shape?: 'circle' | 'rounded';
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-20 h-20 sm:w-24 sm:h-24 text-2xl sm:text-3xl',
  '2xl': 'w-28 h-28 text-4xl'
};

const BADGE_SIZE_MAP = {
  xs: 'w-2.5 h-2.5 -bottom-0.5 -right-0.5 p-0',
  sm: 'w-3.5 h-3.5 -bottom-0.5 -right-0.5 p-0.5',
  md: 'w-4 h-4 -bottom-1 -right-1 p-0.5',
  lg: 'w-5 h-5 -bottom-1 -right-1 p-0.5',
  xl: 'w-6 h-6 -bottom-1 -right-1 p-1',
  '2xl': 'w-7 h-7 -bottom-1 -right-1 p-1'
};

export const ReciterAvatar: React.FC<ReciterAvatarProps> = ({
  name = 'قارئ',
  imageUrl,
  size = 'md',
  className = '',
  isVerified = false,
  showVerifiedBadge = false,
  shape = 'circle'
}) => {
  const [hasError, setHasError] = useState(false);

  // Extract clean initial letter for Arabic display
  const cleanName = (name || '').trim();
  const initial = cleanName ? cleanName.charAt(0) : 'ق';

  const resolvedUrl = imageUrl ? SupabaseService.resolveImageUrl(imageUrl, 'profile-images') : '';
  const canShowImage = Boolean(resolvedUrl && !hasError);

  const roundedClass = shape === 'circle' ? 'rounded-full' : 'rounded-2xl';

  return (
    <div className={`relative inline-block shrink-0 ${className}`}>
      {canShowImage ? (
        <img
          src={resolvedUrl}
          alt={cleanName}
          referrerPolicy="no-referrer"
          onError={() => setHasError(true)}
          className={`${SIZE_MAP[size]} ${roundedClass} object-cover border border-[#D8E8F2] shadow-2xs`}
        />
      ) : (
        <div
          className={`${SIZE_MAP[size]} ${roundedClass} bg-gradient-to-br from-[#102A20] via-[#1A3F31] to-[#315F4A] text-white flex items-center justify-center font-bold font-amiri select-none border border-[#315F4A]/40 shadow-2xs`}
          title={cleanName}
        >
          <span>{initial}</span>
        </div>
      )}

      {showVerifiedBadge && isVerified && (
        <span
          className={`absolute bg-white rounded-full shadow-xs flex items-center justify-center ${BADGE_SIZE_MAP[size]}`}
          title="قارئ موثق"
        >
          <CheckCircle2 className="w-full h-full text-[#1687C7] fill-[#E7F7FD]" />
        </span>
      )}
    </div>
  );
};
