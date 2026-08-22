import React, { useState, useEffect, useRef } from 'react';
import { Logo } from './Logo';
import { UserProfile } from '../types';
import { userService } from '../services/UserService';
import {
  Bell,
  User,
  ShieldCheck
} from 'lucide-react';

interface HeaderProps {
  onOpenProfile: () => void;
  onOpenNotifications: () => void;
  onOpenAdmin: () => void;
  isAdminButtonVisible: boolean;
  onTriggerAdminUnlock: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenProfile,
  onOpenNotifications,
  onOpenAdmin,
  isAdminButtonVisible,
  onTriggerAdminUnlock
}) => {
  const [profile, setProfile] = useState<UserProfile | null>(userService.getProfile());
  const [unreadCount, setUnreadCount] = useState<number>(userService.getUnreadNotificationsCount());

  // Secret gesture: 2 quick taps followed by 3rd press held for 2.5 seconds
  const tapCountRef = useRef<number>(0);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const unsubProf = userService.subscribeProfile((p) => setProfile(p));
    const unsubNotif = userService.subscribeNotifications((notifs) => {
      setUnreadCount(notifs.filter((n) => !n.isRead).length);
    });
    return () => {
      unsubProf();
      unsubNotif();
      if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const handlePointerDown = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (tapCountRef.current === 2) {
      // 3rd press: start 2.5 second hold timer
      longPressTimerRef.current = setTimeout(() => {
        onTriggerAdminUnlock();
        tapCountRef.current = 0;
        if (tapTimeoutRef.current) {
          clearTimeout(tapTimeoutRef.current);
          tapTimeoutRef.current = null;
        }
      }, 2500);
    }
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (tapCountRef.current < 2) {
      tapCountRef.current += 1;
      if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = setTimeout(() => {
        tapCountRef.current = 0;
      }, 600);
    } else {
      tapCountRef.current = 0;
      if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    }
  };

  const handlePointerCancel = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    tapCountRef.current = 0;
    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
  };

  return (
    <header className="sticky top-0 z-30 bg-[#F6FBFF]/95 backdrop-blur-md border-b border-[#D8E8F2] shadow-2xs">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between">
        {/* Brand & Logo with gesture trigger */}
        <div
          className="cursor-pointer select-none"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          <Logo size="md" />
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Notifications Button */}
          <button
            onClick={onOpenNotifications}
            className="relative p-2 rounded-xl bg-white border border-[#D8E8F2] text-[#193B4D] hover:bg-[#E7F7FD] hover:text-[#1687C7] hover:border-[#55BFEA] transition shadow-2xs"
            title="الإشعارات والتنبيهات"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#1687C7] text-white text-[10px] flex items-center justify-center font-bold animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* User Profile Button */}
          <button
            onClick={onOpenProfile}
            className="px-3 py-1.5 rounded-xl bg-white border border-[#D8E8F2] text-[#193B4D] hover:bg-[#E7F7FD] hover:border-[#55BFEA] transition flex items-center gap-2 text-xs font-semibold shadow-2xs"
            title="الملف الشخصي وإعدادات الحساب"
          >
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.displayName}
                referrerPolicy="no-referrer"
                className="w-5 h-5 rounded-full object-cover border border-[#D8E8F2]"
              />
            ) : (
              <div className="w-5 h-5 rounded-full bg-[#E7F7FD] text-[#1687C7] flex items-center justify-center font-bold text-[10px]">
                <User className="w-3 h-3" />
              </div>
            )}
            <span className="hidden sm:inline truncate max-w-[110px]">
              {profile?.isProfileCompleted ? profile.displayName : 'الملف الشخصي'}
            </span>
          </button>

          {/* Admin Control Switch - Strictly conditional */}
          {isAdminButtonVisible && (
            <button
              onClick={onOpenAdmin}
              className="px-3 py-1.5 rounded-xl bg-[#145273]/10 hover:bg-[#145273]/15 border border-[#145273]/20 text-[#145273] transition flex items-center gap-1.5 text-xs font-bold animate-fadeIn"
              title="لوحة تحكم إدارة المنصة"
            >
              <ShieldCheck className="w-4 h-4 text-[#1687C7]" />
              <span className="hidden sm:inline">الإدارة</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

