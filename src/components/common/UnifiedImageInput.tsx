import React, { useState, useRef } from 'react';
import { Upload, Trash2, Link as LinkIcon, Loader2, Image as ImageIcon, CheckCircle, AlertCircle } from 'lucide-react';
import { SupabaseService } from '../../services/SupabaseService';

export interface UnifiedImageInputProps {
  label: string;
  description?: string;
  value?: string | null;
  onChange: (newValue: string) => void;
  storageBucket?: string;
  variant?: 'avatar' | 'banner' | 'logo' | 'cover';
  disabled?: boolean;
}

export const UnifiedImageInput: React.FC<UnifiedImageInputProps> = ({
  label,
  description,
  value = '',
  onChange,
  storageBucket = 'profile-images',
  variant = 'avatar',
  disabled = false
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUrlMode, setIsUrlMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanValue = (value || '').trim();
  const previewUrl = cleanValue ? SupabaseService.resolveImageUrl(cleanValue, storageBucket) : '';

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);

    // Validate size (max 5MB)
    const MAX_SIZE_MB = 5;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setErrorMsg(`حجم الصورة يتجاوز ${MAX_SIZE_MB} ميجابايت. يرجى اختيار صورة أصغر.`);
      return;
    }

    // Validate mime type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (!validTypes.includes(file.type) && !/\.(jpe?g|png|webp|gif|svg)$/i.test(file.name)) {
      setErrorMsg('نوع الملف غير مدعوم. يرجى اختيار صورة بصيغة (JPG, PNG, WebP).');
      return;
    }

    setIsUploading(true);

    try {
      // If there was an old uploaded storage file, safely delete it
      if (cleanValue && !cleanValue.startsWith('http') && !cleanValue.startsWith('data:')) {
        SupabaseService.deleteStorageFile(cleanValue).catch(() => {});
      }

      const uploadResult = await SupabaseService.uploadImage(file, storageBucket);

      if (uploadResult && uploadResult.storagePath) {
        onChange(uploadResult.storagePath);
        setErrorMsg(null);
      } else {
        // Fallback: Use Base64 data URL for uninterrupted local/demo operation if storage RLS blocked anon
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            onChange(reader.result);
          }
        };
        reader.readAsDataURL(file);
      }
    } catch (err: any) {
      console.warn('UnifiedImageInput upload error:', err);
      // Local fallback
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          onChange(reader.result);
        }
      };
      reader.readAsDataURL(file);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDelete = () => {
    setErrorMsg(null);
    if (cleanValue && !cleanValue.startsWith('http') && !cleanValue.startsWith('data:')) {
      SupabaseService.deleteStorageFile(cleanValue).catch(() => {});
    }
    onChange('');
  };

  // Preview container styling based on variant
  const getPreviewClasses = () => {
    switch (variant) {
      case 'banner':
        return 'w-full h-24 rounded-xl object-cover';
      case 'logo':
        return 'w-14 h-14 rounded-xl object-contain bg-black/40 p-1';
      case 'cover':
        return 'w-20 h-20 rounded-xl object-cover';
      case 'avatar':
      default:
        return 'w-14 h-14 rounded-xl object-cover';
    }
  };

  return (
    <div className="space-y-2 bg-[#0D1813] p-3 rounded-2xl border border-[#234235] text-right font-tajawal">
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-xs font-bold text-[#A8C2B3]">{label}</label>
          {description && <p className="text-[10px] text-[#6C8795] mt-0.5">{description}</p>}
        </div>

        {cleanValue && (
          <span className="text-[10px] text-[#34D399] flex items-center gap-1 font-semibold">
            <CheckCircle className="w-3 h-3" />
            <span>محددة</span>
          </span>
        )}
      </div>

      {errorMsg && (
        <div className="p-2 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-300 text-[11px] flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center gap-3">
        {/* Preview Frame */}
        <div className="relative shrink-0 flex items-center justify-center bg-[#14241D] border border-[#2B5742] rounded-xl overflow-hidden min-w-[56px] min-h-[56px]">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={label}
              referrerPolicy="no-referrer"
              className={getPreviewClasses()}
              onError={() => setErrorMsg('تعذر تحميل معاينة الصورة من الرابط الحالي')}
            />
          ) : (
            <div className="w-14 h-14 flex flex-col items-center justify-center text-[#4B8569] gap-1 p-2 text-center">
              <ImageIcon className="w-5 h-5 opacity-60" />
              <span className="text-[9px] text-[#6C8795]">لا توجد</span>
            </div>
          )}

          {isUploading && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center text-white">
              <Loader2 className="w-5 h-5 animate-spin text-[#34D399]" />
            </div>
          )}
        </div>

        {/* Unified Controls (Upload / Delete / Direct URL) */}
        <div className="flex-1 w-full space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Upload Button */}
            <label
              className={`flex-1 min-w-[110px] py-1.5 px-3 rounded-xl text-center text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs ${
                disabled || isUploading
                  ? 'bg-[#162720] text-[#5A7B6C] cursor-not-allowed'
                  : 'bg-[#2B5742] hover:bg-[#346950] text-white'
              }`}
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>جاري الرفع...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>رفع من الجهاز</span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                disabled={disabled || isUploading}
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>

            {/* Toggle Direct URL input */}
            <button
              type="button"
              onClick={() => setIsUrlMode(!isUrlMode)}
              className={`p-1.5 px-2.5 rounded-xl border text-xs font-semibold flex items-center gap-1 transition ${
                isUrlMode
                  ? 'bg-[#1E372C] text-[#34D399] border-[#34D399]/40'
                  : 'bg-[#162720] text-[#A8C2B3] border-[#2B493B] hover:text-white'
              }`}
              title="إدخال أو تعديل رابط مباشر"
            >
              <LinkIcon className="w-3.5 h-3.5" />
              <span>{isUrlMode ? 'إخفاء الرابط' : 'رابط مباشر'}</span>
            </button>

            {/* Delete button (only when image is present) */}
            {cleanValue && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={disabled || isUploading}
                className="p-1.5 px-2.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 rounded-xl border border-rose-800 text-xs font-semibold flex items-center gap-1 transition"
                title="حذف الصورة بالكامل"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف</span>
              </button>
            )}
          </div>

          {/* Direct URL input field */}
          {isUrlMode && (
            <div className="relative">
              <input
                type="url"
                value={cleanValue.startsWith('data:') ? '' : cleanValue}
                onChange={(e) => {
                  setErrorMsg(null);
                  onChange(e.target.value.trim());
                }}
                placeholder="الصق رابط الصورة المباشر (https://...)"
                className="w-full bg-[#14241D] border border-[#2B493B] focus:border-[#34D399] rounded-xl px-3 py-1.5 text-xs text-white placeholder-[#5A7B6C] focus:outline-hidden"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
