import { QURAN_SURAHS } from '../data/quranSurahs';

/**
 * Common Arabic to Latin transliteration mappings for Arabic reciter names
 */
const ARABIC_TRANSLIT_MAP: Record<string, string> = {
  'عبد الرحمن': 'abdulrahman',
  'عبدالرحمن': 'abdulrahman',
  'عبد الباسط': 'abdulbasit',
  'عبدالباسط': 'abdulbasit',
  'عبد الله': 'abdullah',
  'عبدالله': 'abdullah',
  'مشاري': 'mishari',
  'العفاسي': 'alafasy',
  'ماهر': 'maher',
  'المعيقلي': 'almuaiqly',
  'سعد': 'saad',
  'الغامدي': 'alghamdi',
  'ياسر': 'yasser',
  'الدوسري': 'aldosari',
  'خالد': 'khalid',
  'الجليل': 'aljaleel',
  'المنشاوي': 'alminshawi',
  'الحصري': 'alhusary',
  'السديس': 'alsudais',
  'الشريم': 'alshuraim',
  'ناصر': 'nasser',
  'القطامي': 'alqatami',
  'فارس': 'fares',
  'عباد': 'abbad',
  'بندر': 'bandar',
  'بليلة': 'baleelah',
  'صلاح': 'salah',
  'بو خاطر': 'bukhatir',
  'علي': 'ali',
  'جابر': 'jaber',
  'هزاع': 'hazza',
  'البلوشي': 'albalushi',
  'وديع': 'wadih',
  'اليمني': 'alyamani',
  'إدريس': 'idrees',
  'أبكر': 'abkar',
  'أحمد': 'ahmed',
  'العجمي': 'alajmy',
  'محمد': 'muhammad',
  'أيوب': 'ayyoub',
  'صديق': 'siddiq'
};

/**
 * Generate a clean URL slug from Arabic or English name
 */
export function generateReciterSlug(name: string): string {
  if (!name || typeof name !== 'string') return 'reciter';

  let cleaned = name.trim().toLowerCase();

  // Try known name replacements
  for (const [ar, en] of Object.entries(ARABIC_TRANSLIT_MAP)) {
    if (cleaned.includes(ar)) {
      cleaned = cleaned.replace(new RegExp(ar, 'g'), en);
    }
  }

  // Remove common prefixes/titles
  cleaned = cleaned
    .replace(/^الشيخ\s+/i, '')
    .replace(/^القارئ\s+/i, '')
    .replace(/^sheikh\s+/i, '')
    .replace(/^qari\s+/i, '');

  // Transliterate remaining Arabic characters if any
  const charMap: Record<string, string> = {
    'أ': 'a', 'إ': 'i', 'آ': 'aa', 'ا': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th',
    'ج': 'j', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z',
    'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a',
    'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
    'ه': 'h', 'و': 'w', 'ي': 'y', 'ى': 'a', 'ة': 'h', 'ء': 'a', 'ئ': 'e', 'ؤ': 'o'
  };

  let transliterated = '';
  for (const char of cleaned) {
    transliterated += charMap[char] !== undefined ? charMap[char] : char;
  }

  // Clean into slug format: letters, numbers, and dashes
  const slug = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'reciter';
}

/**
 * Detect possible reciter identifier and surah pattern from sample URL
 */
export function detectIdentifierInUrl(sampleUrl: string): {
  identifier: string;
  surahPattern: string;
  hasNumber: boolean;
} {
  if (!sampleUrl || typeof sampleUrl !== 'string') {
    return { identifier: '', surahPattern: '', hasNumber: false };
  }

  try {
    const urlObj = new URL(sampleUrl.startsWith('http') ? sampleUrl : `https://${sampleUrl}`);
    const pathname = urlObj.pathname;
    const segments = pathname.split('/').filter(Boolean);

    let identifier = '';
    let surahPattern = '';
    let hasNumber = false;

    // Find the segment containing the surah number (e.g. 001.mp3, surah-001.mp3, 1.mp3)
    const surahSegmentIndex = segments.findIndex(s => /\d{1,3}/.test(s));

    if (surahSegmentIndex !== -1) {
      surahPattern = segments[surahSegmentIndex];
      hasNumber = true;

      // The segment immediately preceding the surah file is usually the reciter folder/identifier
      if (surahSegmentIndex > 0) {
        identifier = segments[surahSegmentIndex - 1];
      }
    } else if (segments.length > 0) {
      identifier = segments[segments.length - 1];
    }

    return { identifier, surahPattern, hasNumber };
  } catch {
    // Regex fallback
    const match = sampleUrl.match(/\/([^/]+)\/([^/]*\d{1,3}[^/]*\.mp3)/i);
    if (match) {
      return {
        identifier: match[1],
        surahPattern: match[2],
        hasNumber: true
      };
    }
    return { identifier: '', surahPattern: '', hasNumber: false };
  }
}

export interface TransformUrlOptions {
  mode: 'template' | 'replace';
  urlTemplate?: string;
  reciterSlug?: string;
  replaceFrom?: string;
  replaceTo?: string;
}

/**
 * Transform a single recitation audio URL using template or identifier replacement
 */
export function transformRecitationUrl(
  currentUrl: string,
  surahNumber: number,
  surahNameArabic: string,
  options: TransformUrlOptions
): string {
  const surahMeta = QURAN_SURAHS.find(s => s.number === surahNumber);
  const surahNumberPadded = String(surahNumber).padStart(3, '0');
  const surahNameEn = surahMeta?.nameEnglish || `Surah-${surahNumber}`;
  const surahNameSlug = surahNameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  if (options.mode === 'template' && options.urlTemplate && options.urlTemplate.trim()) {
    let result = options.urlTemplate.trim();
    const slug = (options.reciterSlug && options.reciterSlug.trim()) || 'reciter';

    result = result.replace(/\{reciter\}/gi, slug);
    result = result.replace(/\{reciter_slug\}/gi, slug);
    result = result.replace(/\{surah_number_padded\}/gi, surahNumberPadded);
    result = result.replace(/\{surah_number\}/gi, String(surahNumber));
    result = result.replace(/\{surah_name_arabic\}/gi, surahNameArabic || surahMeta?.nameArabic || '');
    result = result.replace(/\{surah_name\}/gi, surahNameArabic || surahMeta?.nameArabic || '');
    result = result.replace(/\{surah_name_en\}/gi, surahNameEn);
    result = result.replace(/\{surah_name_slug\}/gi, surahNameSlug);

    return result;
  }

  if (options.mode === 'replace' && options.replaceFrom && options.replaceTo !== undefined) {
    if (!currentUrl) return '';
    return currentUrl.split(options.replaceFrom).join(options.replaceTo);
  }

  return currentUrl;
}

/**
 * Generate preview diff for a list of recitations
 */
export function generateUrlPreviewList(
  recitations: Array<{
    id?: string;
    surahNumber: number;
    surahNameArabic?: string;
    surahName?: string;
    externalAudioUrl?: string;
    audioStoragePath?: string;
  }>,
  options: TransformUrlOptions
): Array<{
  id?: string;
  surahNumber: number;
  surahName: string;
  originalUrl: string;
  newUrl: string;
  isChanged: boolean;
}> {
  return recitations.map(r => {
    const surahNumber = r.surahNumber || 1;
    const surahName = r.surahNameArabic || r.surahName || (QURAN_SURAHS.find(s => s.number === surahNumber)?.nameArabic) || `سورة ${surahNumber}`;
    const originalUrl = r.externalAudioUrl || r.audioStoragePath || '';
    const newUrl = transformRecitationUrl(originalUrl, surahNumber, surahName, options);

    return {
      id: r.id,
      surahNumber,
      surahName,
      originalUrl,
      newUrl,
      isChanged: originalUrl !== newUrl && Boolean(newUrl)
    };
  });
}
