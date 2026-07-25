export type JobStatus = "in_review" | "in_process" | "print_ready" | "printed";

export type PrintFile = {
  id: string;
  kind: "image" | "pdf";
  name: string;
  thumbUrl: string; // placeholder solid color or gradient via CSS
  pages?: number;
  receivedAt: number; // epoch ms
  status: JobStatus;
  /** Demo source URL for the editor preview. */
  src?: string;
  /** Temporary edited thumbnail shown live in the job list. */
  livePreview?: string;
  /** Tight bitmap produced by Apply Crop, without an A4 page around it. */
  appliedCropSrc?: string;
  /** Persisted latest editor preview, restored after reload/restart. */
  workingSrc?: string;
  workingEdit?: import("@/components/shop/editor/types").EditState;
  /** Source file used to create this non-destructive edited copy. */
  originalFileId?: string;
  originalFile?: PrintFile;
  isEdited?: boolean;
  layoutType?: "aadhaar130" | "multiPage" | "passport";
  passportLayout?: {
    sourceFileIds: string[];
    preset: "4x6-8" | "a4-32" | "a4-45";
    configs: Record<string, { background: string; caption: string; zoom: number; x: number; y: number; brightness: number; contrast: number; crop: { left: number; top: number; width: number; height: number }; removedSrc?: string; croppedSrc?: string }>;
    gapMm: number;
    borderWidth: number;
    borderColor: string;
    cuttingMarks: boolean;
    hideSources: boolean;
    saveSingles: boolean;
  };
  multiLayout?: {
    sourceFileIds: string[];
    copies: Record<string, number>;
    rows: number;
    columns: number;
    orientation: "portrait" | "landscape";
    gap: number;
    keepSources?: boolean;
  };
  aadhaarLayout?: {
    slots: Array<{ imageId: string | null; rotate: number }>;
    scale: number;
    gapY: number;
    marginTop: number;
    marginLeft: number;
    blockOrientation: "landscape" | "portrait";
    keepSources?: boolean;
  };
};

export type JobCard = {
  id: string;
  customerId: string;
  receivedAt: number; // first file in batch
  lastAt: number; // last file in batch
  files: PrintFile[];
  status: JobStatus;
};

export type Customer = {
  id: string;
  name: string;
  mobile: string;
  avatarHue: number; // for placeholder avatar
  lastMessageAt: number;
  unread: number;
  avatarUrl?: string;
  source?: "baileys" | "meta" | "mock";
};

const now = Date.now();
const min = (n: number) => n * 60 * 1000;

export const mockCustomers: Customer[] = [
  { id: "c1", name: "Ramesh Patel", mobile: "+91 98250 12345", avatarHue: 20, lastMessageAt: now - min(2), unread: 3 },
  { id: "c2", name: "Priya Shah", mobile: "+91 99789 55421", avatarHue: 320, lastMessageAt: now - min(8), unread: 0 },
  { id: "c3", name: "Suresh Kumar", mobile: "+91 97250 88123", avatarHue: 210, lastMessageAt: now - min(15), unread: 1 },
  { id: "c4", name: "Anjali Mehta", mobile: "+91 98980 33221", avatarHue: 145, lastMessageAt: now - min(42), unread: 0 },
  { id: "c5", name: "Kirti Joshi", mobile: "+91 90999 71234", avatarHue: 265, lastMessageAt: now - min(70), unread: 0 },
  { id: "c6", name: "Nikhil Desai", mobile: "+91 99099 41234", avatarHue: 90, lastMessageAt: now - min(180), unread: 0 },
];

function mkFile(i: number, kind: "image" | "pdf", receivedAt: number, status: JobStatus = "in_review"): PrintFile {
  return {
    id: `f_${receivedAt}_${i}`,
    kind,
    name: kind === "pdf" ? `Document_${i}.pdf` : `IMG_${1000 + i}.jpg`,
    thumbUrl: "",
    pages: kind === "pdf" ? 1 + (i % 4) : undefined,
    receivedAt,
    status,
    src:
      kind === "image"
        ? `https://picsum.photos/seed/print-${i}/900/600`
        : undefined,
  };
}

export const mockJobs: JobCard[] = [
  {
    id: "j1",
    customerId: "c1",
    receivedAt: now - min(2),
    lastAt: now - min(1),
    status: "in_review",
    files: [
      mkFile(1, "image", now - min(2)),
      mkFile(2, "image", now - min(2)),
      mkFile(3, "pdf", now - min(1)),
    ],
  },
  {
    id: "j2",
    customerId: "c1",
    receivedAt: now - min(65),
    lastAt: now - min(63),
    status: "printed",
    files: [mkFile(4, "image", now - min(65), "printed"), mkFile(5, "image", now - min(63), "printed")],
  },
  {
    id: "j3",
    customerId: "c2",
    receivedAt: now - min(8),
    lastAt: now - min(6),
    status: "in_process",
    files: [mkFile(6, "pdf", now - min(8), "in_process"), mkFile(7, "pdf", now - min(6), "in_process")],
  },
  {
    id: "j4",
    customerId: "c3",
    receivedAt: now - min(15),
    lastAt: now - min(15),
    status: "print_ready",
    files: [mkFile(8, "image", now - min(15), "print_ready")],
  },
  {
    id: "j5",
    customerId: "c4",
    receivedAt: now - min(42),
    lastAt: now - min(40),
    status: "printed",
    files: [
      mkFile(9, "image", now - min(42), "printed"),
      mkFile(10, "image", now - min(42), "printed"),
      mkFile(11, "image", now - min(40), "printed"),
      mkFile(12, "pdf", now - min(40), "printed"),
    ],
  },
];
