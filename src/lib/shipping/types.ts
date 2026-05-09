// ─────────────────────────────────────────────────────────────────────────────
// Phase 22M — shared types for the shipping coverage hierarchy.
//
// The on-disk JSON shape stored in turath_masr_settings.value (key
// `settings_regions`) keeps the legacy fields the existing app already
// reads: each governorate has `id, name, fee, enabled, districts[]`,
// and each district has `name, enabled`. Phase 22M layers OPTIONAL
// metadata on top so the same row can carry hierarchy without breaking
// any reader that hasn't been updated yet:
//
//   • district.type      — broad classification (city / markaz / kism /
//                          neighborhood / village / shiakha / area /
//                          compound). Drives display badges only.
//   • district.parent    — name of the parent district within the
//                          same governorate. Lets us render
//                          neighborhoods grouped under their city /
//                          markaz without changing the array shape.
//   • district.aliases   — extra Arabic names users might type (e.g.
//                          `النزهه` ↔ `النزهة` after normalisation, or
//                          colloquial vs official names).
//   • district.source    — provenance: 'existing' (already in the live
//                          row), 'official' (admin import from a
//                          public boundary dataset), or
//                          'manual_supplement' (commercial / known
//                          area added by hand).
//   • district.needsReview — true when the entry was added without an
//                          authoritative source and a human should
//                          confirm before exposing it to customers.
//   • district.shippingFee — per-area override; falls back to the
//                          governorate fee when undefined.
//
// All of these are optional; readers that ignore them keep working.
// Writers that care about hierarchy can opt in.
// ─────────────────────────────────────────────────────────────────────────────

export type ShippingDistrictType =
  | 'governorate'
  | 'city'
  | 'markaz'
  | 'kism'
  | 'district'
  | 'neighborhood'
  | 'village'
  | 'shiakha'
  | 'area'
  | 'compound';

export type ShippingSource = 'existing' | 'official' | 'manual_supplement';

export interface ShippingDistrict {
  /** Optional stable id. Many existing entries have none. */
  id?: string;
  /** Canonical Arabic name as displayed in UI and stored in orders. */
  name: string;
  /** Whether the area is currently in coverage. Default `true` for legacy rows. */
  enabled: boolean;
  /** Optional override; falls back to the governorate fee when undefined. */
  shippingFee?: number;
  /** Hierarchy classification — drives display badges only. */
  type?: ShippingDistrictType;
  /** Parent district name within the same governorate. Used for nesting. */
  parent?: string;
  /** Alternate spellings normalised against `normalizeArabic`. */
  aliases?: string[];
  /** Provenance — see file header. */
  source?: ShippingSource;
  /** True when the entry needs a human review before exposing to customers. */
  needsReview?: boolean;
}

export interface ShippingGovernorate {
  /** Optional stable id. Existing entries use sequential strings. */
  id?: string;
  name: string;
  /** Per-governorate flat fee in EGP. Currency is implicit (EGP). */
  fee: number;
  /** Whether the entire governorate is in coverage. */
  enabled: boolean;
  /** Flat list — children represent their parent via `district.parent`. */
  districts: ShippingDistrict[];
  /** Provenance — defaults to 'existing' for legacy rows. */
  source?: ShippingSource;
}

/** Legacy district entries that came in as plain strings. */
export type LegacyDistrictEntry = string | ShippingDistrict;

export interface LegacyGovernorate extends Omit<ShippingGovernorate, 'districts'> {
  districts: LegacyDistrictEntry[];
}
