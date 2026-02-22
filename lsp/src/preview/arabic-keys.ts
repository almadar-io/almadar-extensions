/**
 * Arabic key mappings for .orb schema rendering.
 *
 * Maps Arabic JSON keys found in .ar.orb files to their semantic roles,
 * and provides display labels for the RTL preview.
 */

/** Arabic → English key mapping for schema structure detection */
export const AR_KEYS = {
    // Schema root
    اسم: 'name',
    وصف: 'description',
    إصدار: 'version',
    مدارات: 'orbitals',

    // Orbital
    كيان: 'entity',
    سمات: 'traits',
    صفحات: 'pages',

    // Entity
    ثبات: 'persistence',
    مجموعة: 'collection',
    حقول: 'fields',
    نوع: 'type',
    مطلوب: 'required',
    افتراضي: 'default',
    قيم: 'values',
    _بنية: '_structure',

    // Trait
    فئة: 'category',
    كيان_مرتبط: 'linkedEntity',
    آلة_حالة: 'stateMachine',
    تفاعل: 'interaction',

    // State machine
    حالات: 'states',
    أحداث: 'events',
    انتقالات: 'transitions',
    أولي: 'isInitial',
    نهائي: 'isTerminal',

    // Events
    مفتاح: 'key',

    // Transitions
    من: 'from',
    إلى: 'to',
    حدث: 'event',
    حراس: 'guards',
    تأثيرات: 'effects',
    _مبدأ: '_principle',

    // Pages
    مسار: 'path',
    مرجع: 'ref',

    // Effects / S-expressions
    جلب: 'fetch',
    حفظ: 'persist',
    تعيين: 'set',
    استدعاء_خدمة: 'call-service',
    إشعار: 'emit',
    أشعر: 'notify',

    // S-expression operators
    افعل: 'do',
    ليكن: 'let',
    إذا: 'if',
    عندما: 'when',
    و: 'and',
    أو: 'or',
    يساوي: 'eq',
    أكبر_من: 'gt',
    أكبر_أو_يساوي: 'gte',
    أصغر_من: 'lt',
    أصغر_أو_يساوي: 'lte',
    قسمة: 'div',
    دالة: 'fn',

    // Array/Object operators
    'مصفوفة/طول': 'array/length',
    'مصفوفة/تصفية': 'array/filter',
    'مصفوفة/تحويل': 'array/map',
    'مصفوفة/متوسط': 'array/avg',
    'مصفوفة/البعض': 'array/some',
    'مصفوفة/الكل': 'array/every',
    'مصفوفة/يتضمن': 'array/includes',
    'مصفوفة/فريد': 'array/unique',
    'مصفوفة/تسطيح': 'array/flatten',
    'كائن/جلب': 'object/get',
    'كائن/يملك': 'object/has',
    'تحقق/مطلوب': 'validate/required',
    'تحقق/نطاق': 'validate/range',
} as const;

/** Display labels for section headers in the preview */
export const AR_LABELS = {
    schema: 'المخطط',
    version: 'الإصدار',
    description: 'الوصف',
    orbital: 'المدار',
    entity: 'الكيان',
    collection: 'المجموعة',
    persistence: 'الثبات',
    fields: 'الحقول',
    fieldName: 'الحقل',
    fieldType: 'النوع',
    required: 'مطلوب',
    default: 'الافتراضي',
    structure: 'البنية',
    traits: 'السمات',
    trait: 'السمة',
    category: 'الفئة',
    linkedEntity: 'الكيان المرتبط',
    stateMachine: 'آلة الحالة',
    states: 'الحالات',
    initial: 'أولي',
    terminal: 'نهائي',
    events: 'الأحداث',
    transitions: 'الانتقالات',
    from: 'من',
    to: 'إلى',
    event: 'الحدث',
    principle: 'المبدأ',
    guards: 'الحراس',
    effects: 'التأثيرات',
    pages: 'الصفحات',
    page: 'الصفحة',
    path: 'المسار',
    traitRefs: 'مراجع السمات',
    yes: 'نعم',
    no: 'لا',
    parseError: 'خطأ في تحليل الملف',
    documentClosed: 'تم إغلاق الملف',
    connected: 'متصل',
    disconnected: 'غير متصل',
    noContent: 'لا يوجد محتوى',
} as const;

/**
 * Detect whether a parsed schema object uses Arabic keys.
 * Checks for the presence of `اسم` (name) at the top level.
 */
export function isArabicSchema(obj: Record<string, unknown>): boolean {
    return 'اسم' in obj;
}

/**
 * Get a value from a schema object, trying Arabic key first, then English.
 */
export function getSchemaValue(
    obj: Record<string, unknown>,
    arabicKey: string,
    englishKey: string,
): unknown {
    if (arabicKey in obj) return obj[arabicKey];
    if (englishKey in obj) return obj[englishKey];
    return undefined;
}
