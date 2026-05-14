import type {
  InstallationPayer,
  InstallationTarget,
  PaymentStatus,
  PreviewMode,
} from '@/lib/orders/checkoutDetails';

export const ORDER_DRAFT_VERSION = 1;

const ORDER_DRAFT_KEY_PREFIX = 'turath:add-order-draft:v1';

export interface OrderDraftLine {
  id: string;
  productType: string;
  color: string;
  quantity: number;
  unitPrice: number;
  includeFlashlight: boolean;
  flashlightPrice: number;
  note: string;
}

export interface AddOrderDraftData {
  customerName: string;
  phone: string;
  phone2: string;
  governorate: string;
  district: string;
  neighborhood: string;
  address: string;
  expressShipping: boolean;
  freeShipping: boolean;
  notes: string;
  warranty: string;
  lines: OrderDraftLine[];
  step: number;
  previewMode: PreviewMode;
  installationTarget: InstallationTarget;
  installationPayer: InstallationPayer;
  discountAmount: number;
  discountReason: string;
  discountBy: string;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  paidTo: string;
  paymentMethod: string;
}

export interface StoredAddOrderDraft {
  version: typeof ORDER_DRAFT_VERSION;
  updatedAt: string;
  data: AddOrderDraftData;
}

export function getOrderDraftKey(userId?: string | null): string | null {
  if (!userId) return null;
  return `${ORDER_DRAFT_KEY_PREFIX}:${userId}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function safePreviewMode(value: unknown): PreviewMode {
  if (value === 'preview_only' || value === 'preview_with_installation') return value;
  return 'none';
}

function safeInstallationTarget(value: unknown): InstallationTarget {
  return value === 'mosque' || value === 'customer' ? value : null;
}

function safeInstallationPayer(value: unknown): InstallationPayer {
  return value === 'factory' ? 'factory' : 'customer';
}

function safePaymentStatus(value: unknown): PaymentStatus {
  if (value === 'paid' || value === 'partial') return value;
  return 'unpaid';
}

function sanitizeLine(input: unknown): OrderDraftLine | null {
  if (!isObject(input)) return null;

  return {
    id: safeString(input.id) || `draft-line-${Date.now()}-${Math.random()}`,
    productType: safeString(input.productType),
    color: safeString(input.color),
    quantity: Math.max(1, safeNumber(input.quantity, 1)),
    unitPrice: Math.max(0, safeNumber(input.unitPrice, 0)),
    includeFlashlight: input.includeFlashlight === true,
    flashlightPrice: Math.max(0, safeNumber(input.flashlightPrice, 150)),
    note: safeString(input.note),
  };
}

export function sanitizeOrderDraftData(input: unknown): AddOrderDraftData | null {
  if (!isObject(input)) return null;

  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const lines = rawLines
    .map((line) => sanitizeLine(line))
    .filter((line): line is OrderDraftLine => Boolean(line && line.productType));
  const legacyInstallationEnabled = input.holderInstallationEnabled === true;
  const legacyInstallationTarget = safeInstallationTarget(input.holderInstallationType);

  return {
    customerName: safeString(input.customerName),
    phone: safeString(input.phone),
    phone2: safeString(input.phone2),
    governorate: safeString(input.governorate) || 'القاهرة',
    district: safeString(input.district),
    neighborhood: safeString(input.neighborhood),
    address: safeString(input.address),
    expressShipping: input.expressShipping === true,
    freeShipping: input.freeShipping === true,
    notes: safeString(input.notes),
    warranty: safeString(input.warranty) || 'بدون ضمان',
    lines,
    step: Math.min(3, Math.max(1, Math.floor(safeNumber(input.step, 1)))),
    previewMode: legacyInstallationEnabled
      ? 'preview_with_installation'
      : safePreviewMode(input.previewMode),
    installationTarget:
      safeInstallationTarget(input.installationTarget) ?? legacyInstallationTarget,
    installationPayer: safeInstallationPayer(
      input.installationPayer ?? input.holderInstallationPayer
    ),
    discountAmount: Math.max(0, safeNumber(input.discountAmount, 0)),
    discountReason: safeString(input.discountReason),
    discountBy: safeString(input.discountBy),
    paymentStatus: safePaymentStatus(input.paymentStatus),
    paidAmount: Math.max(0, safeNumber(input.paidAmount, 0)),
    paidTo: safeString(input.paidTo),
    paymentMethod: safeString(input.paymentMethod),
  };
}

export function hasMeaningfulOrderDraft(data: AddOrderDraftData): boolean {
  return (
    Boolean(data.customerName.trim()) ||
    Boolean(data.phone.trim()) ||
    Boolean(data.phone2.trim()) ||
    Boolean(data.district.trim()) ||
    Boolean(data.neighborhood.trim()) ||
    Boolean(data.address.trim()) ||
    Boolean(data.notes.trim()) ||
    data.expressShipping ||
    data.freeShipping ||
    data.previewMode !== 'none' ||
    data.discountAmount > 0 ||
    Boolean(data.discountReason.trim()) ||
    data.paymentStatus !== 'unpaid' ||
    data.paidAmount > 0 ||
    Boolean(data.paidTo.trim()) ||
    Boolean(data.paymentMethod.trim()) ||
    data.lines.length > 0
  );
}

export function loadOrderDraft(userId?: string | null): StoredAddOrderDraft | null {
  if (typeof window === 'undefined') return null;
  const key = getOrderDraftKey(userId);
  if (!key) return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed) || parsed.version !== ORDER_DRAFT_VERSION) return null;

    const data = sanitizeOrderDraftData(parsed.data);
    if (!data || !hasMeaningfulOrderDraft(data)) return null;

    return {
      version: ORDER_DRAFT_VERSION,
      updatedAt: safeString(parsed.updatedAt) || new Date().toISOString(),
      data,
    };
  } catch {
    return null;
  }
}

export function saveOrderDraft(userId: string | null | undefined, data: AddOrderDraftData): void {
  if (typeof window === 'undefined') return;
  const key = getOrderDraftKey(userId);
  if (!key) return;

  try {
    if (!hasMeaningfulOrderDraft(data)) {
      window.localStorage.removeItem(key);
      return;
    }

    const payload: StoredAddOrderDraft = {
      version: ORDER_DRAFT_VERSION,
      updatedAt: new Date().toISOString(),
      data: sanitizeOrderDraftData(data) ?? data,
    };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Local draft persistence is best-effort and must never block order entry.
  }
}

export function clearOrderDraft(userId?: string | null): void {
  if (typeof window === 'undefined') return;
  const key = getOrderDraftKey(userId);
  if (!key) return;

  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort cleanup only.
  }
}
