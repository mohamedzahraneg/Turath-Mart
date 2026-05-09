// ─────────────────────────────────────────────────────────────────────────────
// Phase 22N — shipping fee resolver.
//
// One small, well-tested function used by both the new-order modal and
// the order writer. Decides which fee applies to a (governorate, area,
// neighborhood) selection based on the three-level inheritance:
//
//     neighborhood → area → governorate
//
// `null` and `undefined` mean "inherit from parent". Explicit `0` is a
// real value (free shipping) and is RESPECTED — it must not be coerced
// to a fallback. This matches how admins curate shipping in the
// settings UI: leaving a field blank inherits, typing `0` means
// "free at this level".
//
// The helper accepts both `fee` and `shippingFee` field names from the
// district objects so legacy and modern shapes are equivalent. Pure —
// no side effects.
// ─────────────────────────────────────────────────────────────────────────────

import type { ShippingDistrict, ShippingGovernorate } from './types';

export type ShippingFeeSource = 'neighborhood' | 'area' | 'governorate' | 'none';

export interface ShippingFeeResolution {
  /** The resolved fee in EGP. `0` is a real value. */
  fee: number;
  /**
   * Which level supplied the fee. `'none'` only when no level had an
   * explicit value (the resolver returns `0` in that case for safety,
   * but callers should consider `'none'` an edge case to surface as
   * "no fee configured" in the UI rather than rendering `0`).
   */
  source: ShippingFeeSource;
  /**
   * Human-readable Arabic label for the source — handy for the
   * "يستخدم سعر شحن المحافظة" / "سعر شحن خاص للحي" hint under the
   * total in the order modal.
   */
  label: string;
}

const LABELS: Record<ShippingFeeSource, string> = {
  neighborhood: 'سعر شحن خاص للحي',
  area: 'يستخدم سعر شحن المنطقة',
  governorate: 'يستخدم سعر شحن المحافظة',
  none: 'لا يوجد سعر شحن مكوّن',
};

/**
 * `null` and `undefined` are both "missing" (inherit). Anything else
 * that's a finite number, including `0`, is treated as an explicit
 * value the user set on purpose.
 */
function hasExplicitFee(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Read either `fee` or `shippingFee` — the project's two field names. */
function readFee(obj?: Pick<ShippingDistrict, 'fee' | 'shippingFee'> | null): number | null {
  if (!obj) return null;
  if (hasExplicitFee(obj.fee)) return obj.fee;
  if (hasExplicitFee(obj.shippingFee)) return obj.shippingFee;
  return null;
}

export interface ResolveInputs {
  governorateFee?: number | null;
  areaFee?: number | null;
  neighborhoodFee?: number | null;
}

/**
 * Numeric-only resolver. Returns the first explicit number from
 * `neighborhoodFee → areaFee → governorateFee`. If nothing is set,
 * `fee = 0` and `source = 'none'`.
 */
export function resolveShippingFee(inputs: ResolveInputs): ShippingFeeResolution {
  if (hasExplicitFee(inputs.neighborhoodFee)) {
    return {
      fee: inputs.neighborhoodFee,
      source: 'neighborhood',
      label: LABELS.neighborhood,
    };
  }
  if (hasExplicitFee(inputs.areaFee)) {
    return { fee: inputs.areaFee, source: 'area', label: LABELS.area };
  }
  if (hasExplicitFee(inputs.governorateFee)) {
    return {
      fee: inputs.governorateFee,
      source: 'governorate',
      label: LABELS.governorate,
    };
  }
  return { fee: 0, source: 'none', label: LABELS.none };
}

/**
 * Same resolver but reads each level off the project's domain types.
 * Pass the matched governorate / area / neighborhood — any of them may
 * be `null` / `undefined`. Both `fee` and `shippingFee` field names are
 * honoured.
 */
export function resolveShippingFeeFromCoverage(args: {
  governorate?: ShippingGovernorate | null;
  area?: ShippingDistrict | null;
  neighborhood?: ShippingDistrict | null;
}): ShippingFeeResolution {
  return resolveShippingFee({
    governorateFee: readFee(args.governorate ?? null),
    areaFee: readFee(args.area ?? null),
    neighborhoodFee: readFee(args.neighborhood ?? null),
  });
}

export const __test_only = { hasExplicitFee, readFee, LABELS };
