// ─────────────────────────────────────────────────────────────────────────────
// Device-class detection from the user-agent string.
// Used by the login screen, the order-creation flow, and the audit log to
// label which device a user was on.
// ─────────────────────────────────────────────────────────────────────────────

export type DeviceLabel = 'موبايل' | 'تابلت' | 'كمبيوتر';

export function getDeviceLabel(userAgent?: string): DeviceLabel {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (!ua) return 'كمبيوتر';
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'تابلت';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'موبايل';
  return 'كمبيوتر';
}
