// ─────────────────────────────────────────────────────────────────────────────
// src/app/orders-management/components/AddressCoveragePicker.tsx
//
// Phase Orders-Edit-Address-Shipping-1 — focused address cascade for
// EditOrderModal. Mirrors the data model AddOrderModal uses (same
// `getShippingRegions()` cache, same `normalizeCoverageHierarchy`,
// same `resolveShippingFeeFromCoverage`), but the UI is intentionally
// simpler: three selects (governorate → area → neighborhood) plus a
// detailed-address textarea.
//
// Why not extract AddOrderModal's typeable search cascade?
//   AddOrderModal threads a complex auto-suggest UX through several
//   refs and effects (cross-governorate jump, skipNextCrossGovReset,
//   areaSuggestionsInGov / areaSuggestionsOtherGov, etc.). Extracting
//   that without touching AddOrderModal's surrounding state machine is
//   risky for this phase. The pure helpers (`findArea`,
//   `findNeighborhood`, `resolveShippingFeeFromCoverage`) are already
//   shared — duplicating only the dumb UI is the safe move.
//
// Edit operators usually correct an existing address rather than
// type from scratch, so picking from filtered selects is actually a
// better fit here than the typeable search in AddOrder.
//
// Surface contract
//   • Loads the active coverage hierarchy on mount (same cache as
//     AddOrderModal — no extra network round-trip when both modals
//     have been opened in the same SPA session).
//   • Hides disabled governorates / areas / neighborhoods.
//   • Whenever the cascade changes, emits `onChange` with the new
//     value and `onStatusChange` with the resolved fee + coverage
//     verdict.
//   • Detects "legacy mismatch": when the initial saved value cannot
//     be mapped to current coverage, the parent renders a friendly
//     warning telling the operator to re-pick.
// ─────────────────────────────────────────────────────────────────────────────
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';

import { getShippingRegions } from '@/lib/settings/shippingRegionsCache';
import {
  findArea,
  findNeighborhood,
  isParent,
  normalizeCoverageHierarchy,
} from '@/lib/shipping/coverageHierarchy';
import {
  resolveShippingFeeFromCoverage,
  type ShippingFeeResolution,
} from '@/lib/shipping/resolveShippingFee';
import type { ShippingDistrict, ShippingGovernorate } from '@/lib/shipping/types';

export interface AddressCoverageValue {
  /** Arabic governorate name. */
  governorate: string;
  /** Area / district / مركز name. */
  area: string;
  /** Optional neighborhood / حي / قرية / شياخة. */
  neighborhood: string;
  /** Free-text detailed address line (street + number + landmarks). */
  detailedAddress: string;
}

export type AddressCoverageReason =
  | 'ok'
  | 'no_governorate'
  | 'governorate_unknown'
  | 'governorate_disabled'
  | 'area_missing'
  | 'area_unknown'
  | 'area_disabled'
  | 'neighborhood_required'
  | 'neighborhood_unknown'
  | 'neighborhood_disabled'
  | 'detailed_address_missing';

export interface AddressCoverageStatus {
  /** True when the cascade resolves cleanly to enabled coverage. */
  covered: boolean;
  /** Which check failed, if any (or `'ok'` when covered). */
  reason: AddressCoverageReason;
  /**
   * The fee returned by `resolveShippingFeeFromCoverage` for the
   * current selection. `null` until the regions payload finishes
   * loading. `source === 'none'` when coverage exists but no level
   * has an explicit fee configured.
   */
  fee: ShippingFeeResolution | null;
  /**
   * True when the initial value passed to the picker did NOT map to a
   * covered path under the current settings. The parent should show a
   * one-time legacy warning until the operator re-picks. Resets to
   * `false` as soon as the operator selects a covered path.
   */
  legacyMismatch: boolean;
  /** True when the coverage hierarchy has finished loading. */
  ready: boolean;
}

export interface AddressCoveragePickerProps {
  value: AddressCoverageValue;
  onChange: (next: AddressCoverageValue) => void;
  onStatusChange?: (status: AddressCoverageStatus) => void;
  disabled?: boolean;
  /** Field-level error text, keyed by field name. */
  errors?: Partial<Record<'governorate' | 'area' | 'neighborhood' | 'detailedAddress', string>>;
}

/** Apply the standard "enabled !== false" filter — settings rows
 *  without an explicit `enabled` field are treated as enabled. */
function isEnabled<T extends { enabled?: boolean }>(row: T): boolean {
  return row.enabled !== false;
}

export default function AddressCoveragePicker({
  value,
  onChange,
  onStatusChange,
  disabled = false,
  errors,
}: AddressCoveragePickerProps) {
  const [regions, setRegions] = useState<ShippingGovernorate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Track whether the operator has touched ANY cascade field. Once
  // touched, we stop reporting `legacyMismatch` even if the resulting
  // path is still uncovered — at that point the operator owns the
  // state and the parent's regular `covered=false` validation kicks in.
  const [touched, setTouched] = useState(false);

  // Load coverage hierarchy once. Same cache layer as AddOrderModal.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = (await getShippingRegions()) as unknown[];
        if (cancelled) return;
        const normalized = normalizeCoverageHierarchy(raw);
        setRegions(normalized);
      } catch (err) {
        if (cancelled) return;
        console.warn('[AddressCoveragePicker] shipping regions fetch failed', err);
        setLoadError('تعذر تحميل قائمة مناطق الشحن. حاول مرة أخرى أو راجع الإعدادات.');
        setRegions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Active governorates only.
  const activeGovs = useMemo<ShippingGovernorate[]>(
    () => (regions ?? []).filter(isEnabled),
    [regions]
  );

  // Resolve the currently-selected pieces from the normalized
  // hierarchy. `findArea` / `findNeighborhood` already use Arabic-
  // normalized equality so an alias-only match still resolves.
  const selectedGov = useMemo<ShippingGovernorate | null>(() => {
    if (!regions || !value.governorate) return null;
    // Governorates have no `aliases` field in the schema — exact
    // name match only. Areas/neighborhoods do, and those are
    // resolved via `findArea` / `findNeighborhood` which handle
    // alias matching internally.
    return regions.find((g) => g.name === value.governorate) ?? null;
  }, [regions, value.governorate]);

  const selectedArea = useMemo<ShippingDistrict | null>(() => {
    if (!regions || !value.governorate || !value.area) return null;
    return findArea(value.governorate, value.area, regions);
  }, [regions, value.governorate, value.area]);

  const selectedNeighborhood = useMemo<ShippingDistrict | null>(() => {
    if (!regions || !value.governorate || !value.area || !value.neighborhood) return null;
    return findNeighborhood(value.governorate, value.area, value.neighborhood, regions);
  }, [regions, value.governorate, value.area, value.neighborhood]);

  // Active areas under the selected governorate.
  const activeAreas = useMemo<ShippingDistrict[]>(() => {
    if (!selectedGov) return [];
    return (selectedGov.districts ?? []).filter(isEnabled);
  }, [selectedGov]);

  // Active neighborhoods (only when the area has children — leaf
  // areas don't render the third select).
  const activeNeighborhoods = useMemo<ShippingDistrict[]>(() => {
    if (!selectedArea) return [];
    return (selectedArea.children ?? []).filter(isEnabled);
  }, [selectedArea]);

  const areaHasChildren = !!selectedArea && isParent(selectedArea);

  // Coverage verdict.
  const status = useMemo<AddressCoverageStatus>(() => {
    const ready = regions !== null;
    if (!ready) {
      return { covered: false, reason: 'no_governorate', fee: null, legacyMismatch: false, ready };
    }

    let reason: AddressCoverageReason = 'ok';
    if (!value.governorate.trim()) reason = 'no_governorate';
    else if (!selectedGov) reason = 'governorate_unknown';
    else if (!isEnabled(selectedGov)) reason = 'governorate_disabled';
    else if (!value.area.trim()) reason = 'area_missing';
    else if (!selectedArea) reason = 'area_unknown';
    else if (!isEnabled(selectedArea)) reason = 'area_disabled';
    else if (areaHasChildren && !value.neighborhood.trim()) reason = 'neighborhood_required';
    else if (areaHasChildren && !selectedNeighborhood) reason = 'neighborhood_unknown';
    else if (selectedNeighborhood && !isEnabled(selectedNeighborhood))
      reason = 'neighborhood_disabled';

    const covered = reason === 'ok';

    const fee = resolveShippingFeeFromCoverage({
      governorate: selectedGov,
      area: selectedArea,
      neighborhood: selectedNeighborhood,
    });

    // Legacy mismatch is only reported while the operator hasn't
    // touched anything yet. Once they pick a value, the regular
    // `covered=false` signal is enough — no need for a separate
    // "this was already bad when you opened it" call-out.
    const legacyMismatch = ready && !covered && !touched;

    return { covered, reason, fee, legacyMismatch, ready };
  }, [
    regions,
    selectedGov,
    selectedArea,
    selectedNeighborhood,
    value.governorate,
    value.area,
    value.neighborhood,
    areaHasChildren,
    touched,
  ]);

  // Bubble status changes upward. We compare a serialized signature
  // to avoid emitting on every render — `onStatusChange` is expected
  // to be cheap, but the parent's effect that consumes it might not be.
  const lastStatusKeyRef = useRef<string>('');
  useEffect(() => {
    if (!onStatusChange) return;
    const key = JSON.stringify({
      ready: status.ready,
      covered: status.covered,
      reason: status.reason,
      fee: status.fee?.fee ?? null,
      source: status.fee?.source ?? null,
      legacyMismatch: status.legacyMismatch,
    });
    if (key !== lastStatusKeyRef.current) {
      lastStatusKeyRef.current = key;
      onStatusChange(status);
    }
  }, [status, onStatusChange]);

  // ── Change handlers ─────────────────────────────────────────────────────
  const handleGovernorateChange = (gov: string) => {
    setTouched(true);
    onChange({
      governorate: gov,
      area: '',
      neighborhood: '',
      detailedAddress: value.detailedAddress,
    });
  };
  const handleAreaChange = (area: string) => {
    setTouched(true);
    onChange({
      governorate: value.governorate,
      area,
      neighborhood: '',
      detailedAddress: value.detailedAddress,
    });
  };
  const handleNeighborhoodChange = (nb: string) => {
    setTouched(true);
    onChange({ ...value, neighborhood: nb });
  };
  const handleDetailedChange = (text: string) => {
    onChange({ ...value, detailedAddress: text });
  };

  // ── Render ──────────────────────────────────────────────────────────────
  const initialUncoveredGov = !!value.governorate && status.ready && !selectedGov;
  const initialUncoveredArea = !!value.area && status.ready && !!selectedGov && !selectedArea;
  const initialUncoveredNeighborhood =
    !!value.neighborhood &&
    status.ready &&
    !!selectedArea &&
    areaHasChildren &&
    !selectedNeighborhood;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {/* Governorate select */}
      <div>
        <label className="label-text">المحافظة *</label>
        <div className="relative">
          <select
            className={`input-field appearance-none pl-8 ${errors?.governorate ? 'border-red-400' : ''}`}
            value={value.governorate}
            onChange={(e) => handleGovernorateChange(e.target.value)}
            disabled={disabled || !status.ready}
          >
            {/* Render the saved value as a disabled option when it
                doesn't match any active governorate so the picker
                shows what the order currently carries instead of
                silently clearing it. */}
            {initialUncoveredGov && (
              <option value={value.governorate} disabled>
                {value.governorate} — خارج التغطية
              </option>
            )}
            {!value.governorate && <option value="">اختر المحافظة</option>}
            {activeGovs.map((g) => (
              <option key={`gov-${g.name}`} value={g.name}>
                {g.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none"
          />
        </div>
        {errors?.governorate && <p className="text-red-500 text-xs mt-1">{errors.governorate}</p>}
      </div>

      {/* Area / district select */}
      <div>
        <label className="label-text">المنطقة / المركز *</label>
        <div className="relative">
          <select
            className={`input-field appearance-none pl-8 ${errors?.area ? 'border-red-400' : ''}`}
            value={value.area}
            onChange={(e) => handleAreaChange(e.target.value)}
            disabled={disabled || !status.ready || !selectedGov}
          >
            {initialUncoveredArea && (
              <option value={value.area} disabled>
                {value.area} — خارج التغطية
              </option>
            )}
            {!value.area && <option value="">اختر المنطقة</option>}
            {activeAreas.map((a) => (
              <option key={`area-${a.name}`} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none"
          />
        </div>
        {errors?.area && <p className="text-red-500 text-xs mt-1">{errors.area}</p>}
      </div>

      {/* Neighborhood select — only when the area has children. */}
      {areaHasChildren && (
        <div className="sm:col-span-2">
          <label className="label-text">الحي / القرية / الشياخة *</label>
          <div className="relative">
            <select
              className={`input-field appearance-none pl-8 ${
                errors?.neighborhood ? 'border-red-400' : ''
              }`}
              value={value.neighborhood}
              onChange={(e) => handleNeighborhoodChange(e.target.value)}
              disabled={disabled || !status.ready || !selectedArea}
            >
              {initialUncoveredNeighborhood && (
                <option value={value.neighborhood} disabled>
                  {value.neighborhood} — خارج التغطية
                </option>
              )}
              {!value.neighborhood && <option value="">اختر الحي / القرية</option>}
              {activeNeighborhoods.map((n) => (
                <option key={`nb-${n.name}`} value={n.name}>
                  {n.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] pointer-events-none"
            />
          </div>
          {errors?.neighborhood && (
            <p className="text-red-500 text-xs mt-1">{errors.neighborhood}</p>
          )}
        </div>
      )}

      {/* Detailed address — free text; never auto-cleared. */}
      <div className="sm:col-span-2">
        <label className="label-text">العنوان التفصيلي *</label>
        <textarea
          className={`input-field min-h-[64px] ${errors?.detailedAddress ? 'border-red-400' : ''}`}
          value={value.detailedAddress}
          onChange={(e) => handleDetailedChange(e.target.value)}
          disabled={disabled}
        />
        {errors?.detailedAddress && (
          <p className="text-red-500 text-xs mt-1">{errors.detailedAddress}</p>
        )}
      </div>

      {/* Legacy-address banner — shown only when the original saved
          value couldn't be mapped to active coverage AND the operator
          hasn't picked a new path yet. */}
      {status.legacyMismatch && (
        <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs p-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            العنوان الحالي غير مطابق لمناطق الشحن المفعّلة. اختر المنطقة من القائمة لتحديث سعر
            الشحن.
          </span>
        </div>
      )}

      {/* Coverage load failure — surfaced inline so the operator
          knows why the selects are empty. Keeps detailed address
          editable as a fallback. */}
      {loadError && (
        <div className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs p-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{loadError}</span>
        </div>
      )}
    </div>
  );
}
