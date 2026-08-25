import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
  isLight?: boolean;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>;
  onTouchStart?: React.TouchEventHandler<HTMLDivElement>;
  onTouchEnd?: React.TouchEventHandler<HTMLDivElement>;
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
  onMouseUp?: React.MouseEventHandler<HTMLDivElement>;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export const Logo: React.FC<LogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
  isLight = false,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onTouchStart,
  onTouchEnd,
  onMouseDown,
  onMouseUp,
  onClick
}) => {
  const iconSizes = {
    sm: 'w-7 h-7',
    md: 'w-9 h-9',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16'
  };

  const titleSizes = {
    sm: 'text-sm',
    md: 'text-base sm:text-lg',
    lg: 'text-xl sm:text-2xl',
    xl: 'text-2xl sm:text-3xl'
  };

  const subtitleSizes = {
    sm: 'text-[9px]',
    md: 'text-[10px] sm:text-xs',
    lg: 'text-xs sm:text-sm',
    xl: 'text-sm'
  };

  return (
    <div
      className={`flex items-center gap-2.5 select-none ${className}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onClick={onClick}
    >
      {/* Official Logo Emblem Image */}
      <div className={`relative ${iconSizes[size]} flex items-center justify-center shrink-0 overflow-hidden rounded-xl shadow-xs border border-amber-400/30`}>
        <img
          src="/logo.png"
          alt="تلاوتك للعالم"
          className="w-full h-full object-cover"
        />
      </div>

      {/* Typography */}
      {showText && (
        <div className="flex flex-col">
          <div className={`font-bold font-amiri tracking-tight leading-none ${titleSizes[size]} ${isLight ? 'text-white' : 'text-[#145273]'}`}>
            تلاوتك للعالم
          </div>
          <div className={`font-medium font-tajawal mt-0.5 tracking-normal leading-none ${subtitleSizes[size]} ${isLight ? 'text-[#E7F7FD]' : 'text-[#6C8795]'}`}>
            منصة التلاوات القرآنية المعتمدة
          </div>
        </div>
      )}
    </div>
  );
};
