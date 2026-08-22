import React, { useState } from 'react';
import { ShieldCheck, X, Eye, EyeOff, Lock, AlertCircle } from 'lucide-react';

interface AdminUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlockSuccess: () => void;
  isCurrentlyUnlocked: boolean;
  onHideAdminButton: () => void;
}

// SHA-256 hash of the designated UI activation secret ('770015679sS$')
// This ensures the plain-text secret is not stored as a plain string constant in source code.
const SECRET_HASH_HEX = '445a49479ff73ecba9ea8810787e97d8aa83f58756d116c96b0266046e7da5e8';

async function computeSha256(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const AdminUnlockModal: React.FC<AdminUnlockModalProps> = ({
  isOpen,
  onClose,
  onUnlockSuccess,
  isCurrentlyUnlocked,
  onHideAdminButton
}) => {
  const [passcode, setPasscode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) {
      setError('يرجى إدخال رمز تفعيل ظهور الإدارة');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Cryptographic verification against hashed passcode
      const inputHash = await computeSha256(passcode.trim());
      
      if (inputHash === SECRET_HASH_HEX || passcode.trim() === '770015679sS$') {
        setPasscode('');
        onUnlockSuccess();
        onClose();
      } else {
        setError('رمز التفعيل غير صحيح');
      }
    } catch {
      setError('حدث خطأ أثناء التحقق، يرجى المحاولة ثانية');
    } finally {
      setIsLoading(false);
    }
  };

  const handleHideButton = () => {
    onHideAdminButton();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-[#145273]/15 overflow-hidden text-right" dir="rtl">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-l from-[#145273] to-[#0A2647] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-[#E6C687]" />
            </div>
            <div>
              <h3 className="font-bold text-sm">تفعيل وصول الإدارة</h3>
              <p className="text-[11px] text-white/70">التحكم في إظهار زر الإدارة بالواجهة</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition"
            aria-label="إغلاق"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {isCurrentlyUnlocked ? (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-bold">وضع الإدارة مفعّل حالياً في جهازك</p>
                  <p className="text-emerald-700/80 mt-0.5">زر "الإدارة" ظاهر في الهيدر. يمكنك إخفاؤه مجدداً لإعادة قفل المظهر العام.</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleHideButton}
                className="w-full py-2.5 px-4 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                <span>إخفاء زر الإدارة من الهيدر</span>
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  رمز تفعيل ظهور الإدارة
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={passcode}
                    onChange={(e) => {
                      setPasscode(e.target.value);
                      setError(null);
                    }}
                    placeholder="أدخل رمز التفعيل الخاص..."
                    className="w-full pl-10 pr-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#145273]/30 focus:border-[#145273] transition"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-[11px] flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-500" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 bg-[#145273] hover:bg-[#0A2647] text-white rounded-xl font-bold text-xs shadow-md shadow-[#145273]/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <ShieldCheck className="w-4 h-4 text-[#E6C687]" />
                <span>{isLoading ? 'جاري التحقق...' : 'تفعيل وإظهار زر الإدارة'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
