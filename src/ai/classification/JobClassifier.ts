export interface AIJobClassification {
  jobSessionId: string;
  category:
    | 'image'
    | 'pdf'
    | 'aadhaar'
    | 'passport-photo'
    | 'pvc-card'
    | 'multi-layout'
    | 'unknown';
  confidence: number;
  reasons: string[];
  suggestedTool: string | null;
  intentParams?: {
    removeBackground?: boolean;
    bgFill?: string;
    passportCount?: number;
    enhance?: boolean;
    pdfAction?: 'merge' | 'split';
  };
}

export interface ClassifiableFileMetadata {
  id: string;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  pageCount?: number;
  caption?: string;
}

export interface ClassifiableJobSession {
  jobSessionId: string;
  customerId: string;
  files: ClassifiableFileMetadata[];
  captionText?: string;
  customerInstructions?: string[];
}

const GREETING_WORDS = new Set([
  'hi',
  'hello',
  'hey',
  'thanks',
  'thank',
  'you',
  'ok',
  'okay',
  'good',
  'morning',
  'afternoon',
  'evening',
  'night',
  'sir',
  'bhai',
  'bro',
  'pls',
  'please',
  'dhanyawad',
  'namaste',
]);

function filterGreetings(text: string): string {
  const words = text.toLowerCase().split(/\s+/);
  const filtered = words.filter((w) => !GREETING_WORDS.has(w.replace(/[^a-z]/g, '')));
  return filtered.join(' ');
}

export class JobClassifier {
  /**
   * Combined Text + Media Intent Classifier.
   * Reads incoming media and customer text instructions received in the completion window.
   */
  public static classifyJobSession(session: ClassifiableJobSession): AIJobClassification {
    const reasons: string[] = [];
    const files = session.files || [];

    if (files.length === 0) {
      return {
        jobSessionId: session.jobSessionId,
        category: 'unknown',
        confidence: 0.1,
        reasons: ['No files present in job session'],
        suggestedTool: null,
      };
    }

    const rawInstructionText = [
      session.captionText || '',
      ...(session.customerInstructions || []),
    ].join(' ');

    const cleanText = filterGreetings(rawInstructionText).toLowerCase();
    const fileNamesText = files.map((f) => f.name).join(' ').toLowerCase();

    const hasPdf = files.some(
      (f) => f.mimeType === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    const hasImage = files.some(
      (f) => f.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|webp|bmp)$/i.test(f.name)
    );

    // Rule 1: Passport Photo Intent
    const passportKeywords = [
      'passport',
      'pass_port',
      'stamp_size',
      'passportphoto',
      'pass port',
      'copy',
      'copies',
      'kopio',
    ];
    const matchedPassport = passportKeywords.some((kw) => cleanText.includes(kw));
    if (matchedPassport && hasImage) {
      reasons.push('Customer instruction requested passport photo layout');
      const numMatch = cleanText.match(/(\d+)\s*(copy|copies|photo|pc|pcs)?/i);
      const passportCount = numMatch ? parseInt(numMatch[1], 10) : 8;
      reasons.push(`Passport photo quantity detected: ${passportCount}`);

      return {
        jobSessionId: session.jobSessionId,
        category: 'passport-photo',
        confidence: 0.95,
        reasons,
        suggestedTool: 'passport',
        intentParams: { passportCount },
      };
    }

    // Rule 2: Background Removal / White Background Intent
    const bgKeywords = [
      'white background',
      'white bg',
      'bg remove',
      'remove bg',
      'background remove',
      'background white',
      'cutout',
    ];
    const matchedBg = bgKeywords.some((kw) => cleanText.includes(kw));
    if (matchedBg && hasImage) {
      reasons.push('Customer requested white background removal');
      return {
        jobSessionId: session.jobSessionId,
        category: 'image',
        confidence: 0.95,
        reasons,
        suggestedTool: 'image-editor',
        intentParams: { removeBackground: true, bgFill: '#ffffff' },
      };
    }

    // Rule 3: Image Enhancement Intent ("photo clear", "enhance", "hd")
    const enhanceKeywords = [
      'photo clear',
      'clear photo',
      'image clear',
      'enhance',
      'hd',
      'clean photo',
      'sharp',
    ];
    const matchedEnhance = enhanceKeywords.some((kw) => cleanText.includes(kw));
    if (matchedEnhance && hasImage) {
      reasons.push('Customer requested photo enhancement / cleanup');
      return {
        jobSessionId: session.jobSessionId,
        category: 'image',
        confidence: 0.95,
        reasons,
        suggestedTool: 'image-editor',
        intentParams: { enhance: true },
      };
    }

    // Rule 4: Card Match Intent (Aadhaar, PAN, Driving Licence, Ration, Ayushman, Voter)
    const cardKeywords = [
      'aadhaar',
      'adhaar',
      'adhar',
      'pan',
      'pancard',
      'driving',
      'licence',
      'license',
      'ration',
      'ayushman',
      'voter',
      'both side',
      'front back',
    ];
    const matchedCard = cardKeywords.some(
      (kw) => cleanText.includes(kw) || fileNamesText.includes(kw)
    );
    if (matchedCard) {
      reasons.push('Detected card identity / front & back match keywords');
      return {
        jobSessionId: session.jobSessionId,
        category: 'aadhaar',
        confidence: 0.95,
        reasons,
        suggestedTool: 'aadhaar',
      };
    }

    // Rule 5: Multi-Layout Intent (MUST have files.length >= 2 AND explicit multi-layout instructions)
    // Single images MUST NEVER select multi-layout!
    if (files.length >= 2) {
      const explicitMultiKeywords = [
        'ek page ma',
        '1 page ma',
        'one page',
        'collage',
        'grid',
        '4 photo',
        '4 image',
        'side by side',
        'print together',
      ];
      const matchedMulti = explicitMultiKeywords.some((kw) => cleanText.includes(kw));
      if (matchedMulti) {
        reasons.push('Explicit multi-layout instruction detected for multiple images');
        return {
          jobSessionId: session.jobSessionId,
          category: 'multi-layout',
          confidence: 0.9,
          reasons,
          suggestedTool: 'multi-layout',
        };
      }
    }

    // Rule 6: PDF Merge / Edit Intent
    if (hasPdf) {
      const mergeKeywords = ['merge', 'combine', 'join', 'single pdf'];
      const isMerge = mergeKeywords.some((kw) => cleanText.includes(kw));
      reasons.push(
        isMerge ? 'Detected PDF merge instruction' : 'Detected standard PDF document'
      );
      return {
        jobSessionId: session.jobSessionId,
        category: 'pdf',
        confidence: 0.95,
        reasons,
        suggestedTool: 'pdf-editor',
        intentParams: isMerge ? { pdfAction: 'merge' } : undefined,
      };
    }

    // Rule 7: Single / Multiple Image Default -> IMAGE / image-editor
    if (hasImage) {
      reasons.push('Standard image file -> Defaulting to Image Editor');
      return {
        jobSessionId: session.jobSessionId,
        category: 'image',
        confidence: 0.95,
        reasons,
        suggestedTool: 'image-editor',
      };
    }

    // Rule 8: Low Confidence Fallback -> IMAGE / manual-review
    reasons.push('Unclear intent or unrecognized format -> Defaulting to Manual Review');
    return {
      jobSessionId: session.jobSessionId,
      category: 'image',
      confidence: 0.4,
      reasons,
      suggestedTool: 'image-editor',
    };
  }
}
