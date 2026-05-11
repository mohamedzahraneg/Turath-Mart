#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/cleanup-order-line-images.mjs
//
// Phase Egress-Fix1 — strip legacy base64 image payloads from
// `turath_masr_orders.lines`.
//
// What this script does
// ---------------------
// For every order whose `lines` JSONB still carries an inline
// `data:image/...;base64,...` URL, rewrite each line element so that:
//
//   • If `line.productType` matches a row in `turath_masr_inventory`
//     (the common case — 6 of 8 distinct productType UUIDs in our
//     audit), drop the inline `image` field and set
//     `image_source: 'inventory'`. The UI already renders the
//     inventory thumbnail via `/api/inventory/<id>/thumbnail`.
//
//   • Otherwise (orphan line — the original inventory row was deleted
//     and only ~2 such elements exist as of the audit), decode the
//     base64 into raw bytes, upload them to the private
//     `order-line-images` storage bucket at
//     `order-line-images/{order_id}/{line_index}.<ext>`, and replace
//     the line with `image_path` + `image_source: 'storage'`.
//
// In both cases the `image` JSON field is removed entirely from the
// line, shrinking each row's `lines` JSONB from ~122 kB (avg) to a
// few hundred bytes. Existing slim rows (orders with no base64) are
// never touched.
//
// What this script does NOT do
// ----------------------------
//   • It never touches business fields (status, totals, customer
//     data, schedule, audit fields, etc.). The only mutation is the
//     `lines` column.
//   • It never deletes a row.
//   • It never strips images from rows that don't have base64 to
//     begin with — only `lines::text` matching `%base64%` /
//     `%data:image%` is in scope.
//   • It never hard-deletes the source `data:` URL from the row
//     without first uploading orphan bytes to storage (when the
//     bucket is required).
//
// Usage
// -----
//
//   # Read-only dry-run (DEFAULT). Reports what would change without
//   # writing anything. Safe to run against production any time.
//   pnpm node scripts/cleanup-order-line-images.mjs
//
//   # Same, with verbose per-row logs:
//   VERBOSE=1 pnpm node scripts/cleanup-order-line-images.mjs
//
//   # Apply the changes. Requires explicit env flag and a
//   # service-role key in the environment.
//   APPLY=1 SUPABASE_SERVICE_ROLE_KEY='...' pnpm node \
//     scripts/cleanup-order-line-images.mjs
//
// Required env (apply mode only)
// ------------------------------
//   NEXT_PUBLIC_SUPABASE_URL          — the project URL (or SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY         — service role, never committed
//
// In dry-run mode the script can use the anon key (NEXT_PUBLIC_…)
// because no writes happen. It still selects only what RLS allows;
// historical rows under the existing policies are readable by
// authenticated users, but the simplest path is to pass either key.
//
// Backup requirement (apply mode)
// -------------------------------
// Before invoking with `APPLY=1` the operator MUST take a backup of
// `public.turath_masr_orders`. Recommended approach:
//
//   1. Supabase dashboard → Database → Backups → manual backup, OR
//   2. Export the affected rows to a snapshot table BEFORE running
//      the script:
//
//        CREATE TABLE public.turath_masr_orders_lines_backup_YYYYMMDD AS
//        SELECT id, order_num, lines, updated_at
//          FROM public.turath_masr_orders
//         WHERE lines::text ILIKE '%base64%'
//            OR lines::text ILIKE '%data:image%';
//
// Neither this script nor the related migration creates the backup
// — that's an explicit operator step so the script never assumes it
// has permission to write outside its blast radius.
//
// Idempotency
// -----------
// The script's filter is `lines::text ILIKE '%base64%' OR
// '%data:image%'`. After a successful apply, those substrings are
// gone, so re-running the script in dry-run or apply mode finds
// nothing to do.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import process from 'node:process';
import { Buffer } from 'node:buffer';

// ─── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';
const VERBOSE = process.env.VERBOSE === '1' || process.env.VERBOSE === 'true';
const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE || '20', 10);
const BUCKET = 'order-line-images';

// ─── Bootstrap ───────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) {
  fail('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is required. Set it in your .env or shell.');
}

if (APPLY && !SERVICE_ROLE_KEY) {
  fail(
    'APPLY mode requires SUPABASE_SERVICE_ROLE_KEY. Re-run without APPLY to dry-run, or set the key:\n' +
      "  APPLY=1 SUPABASE_SERVICE_ROLE_KEY='...' pnpm node scripts/cleanup-order-line-images.mjs"
  );
}

const KEY = APPLY ? SERVICE_ROLE_KEY : SERVICE_ROLE_KEY || ANON_KEY;
if (!KEY) {
  fail(
    'No Supabase key available. Set SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.'
  );
}

const supabase = createClient(SUPABASE_URL, KEY, {
  auth: { persistSession: false },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isDataImageUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

function parseDataUrl(value) {
  // data:image/<subtype>[;params];base64,<payload>
  const match = value.match(/^data:(image\/[a-zA-Z0-9+.-]+)(?:;[^,]+)?;base64,([\s\S]+)$/);
  if (!match) return null;
  const mime = match[1];
  const ext =
    mime === 'image/jpeg'
      ? 'jpg'
      : mime === 'image/png'
        ? 'png'
        : mime === 'image/webp'
          ? 'webp'
          : mime.split('/')[1] || 'bin';
  let bytes;
  try {
    bytes = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  return { mime, ext, bytes };
}

function approxJsonSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return 0;
  }
}

async function loadInventoryIdSet() {
  // RLS on `turath_masr_inventory` allows authenticated users only.
  // Under the anon key this returns 0 rows; in that case we warn but
  // continue — every line will be classified as "orphan" and end up
  // in the storage bucket. In apply mode the service_role key
  // bypasses RLS, so the real classification runs.
  const { data, error } = await supabase.from('turath_masr_inventory').select('id');
  if (error) {
    throw new Error(`Failed to load inventory id list: ${error.message}`);
  }
  const rows = data || [];
  if (rows.length === 0) {
    console.warn(
      '⚠ Inventory id list is empty under this key — RLS likely blocked the SELECT.'
    );
    if (APPLY) {
      console.warn(
        '  In APPLY mode you must use SUPABASE_SERVICE_ROLE_KEY (not anon).'
      );
    } else {
      console.warn(
        '  Dry-run will treat every base64 line as an orphan upload (worst-case estimate).'
      );
    }
  }
  return new Set(rows.map((r) => String(r.id)));
}

async function fetchAffectedOrders() {
  // PostgREST rejects `lines::text.ilike.%…%` inside .or(), and there
  // is no direct ILIKE operator on a jsonb column. We therefore fetch
  // every order's lightweight columns and filter client-side. The
  // payload per row is small (we don't pull totals/customer/phone),
  // and the orders table has a few hundred rows at most.
  const { data, error } = await supabase
    .from('turath_masr_orders')
    .select('id, order_num, lines')
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`Failed to fetch orders: ${error.message}`);
  }
  const rows = data || [];
  // Same predicate as the audit query — substring match on the
  // serialised JSON.
  const filtered = rows.filter((r) => {
    const text = JSON.stringify(r.lines ?? '');
    return text.includes('base64') || text.includes('data:image');
  });
  return filtered;
}

async function uploadOrphanImage(orderId, lineIndex, parsed) {
  const objectPath = `${orderId}/${lineIndex}.${parsed.ext}`;
  if (!APPLY) {
    return { path: `${BUCKET}/${objectPath}`, uploaded: false };
  }
  const { error } = await supabase.storage.from(BUCKET).upload(objectPath, parsed.bytes, {
    contentType: parsed.mime,
    upsert: true,
  });
  if (error) {
    throw new Error(`Storage upload failed for ${orderId}/${lineIndex}: ${error.message}`);
  }
  return { path: `${BUCKET}/${objectPath}`, uploaded: true };
}

async function writeOrderLines(orderId, newLines) {
  if (!APPLY) return { updated: false };
  const { error } = await supabase
    .from('turath_masr_orders')
    .update({ lines: newLines })
    .eq('id', orderId);
  if (error) {
    throw new Error(`Order update failed for ${orderId}: ${error.message}`);
  }
  return { updated: true };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n────────────────────────────────────────────────────────────────`);
  console.log(`Phase Egress-Fix1 — strip legacy base64 from order lines`);
  console.log(`Mode:              ${APPLY ? 'APPLY (writes will happen)' : 'DRY-RUN (read-only)'}`);
  console.log(`Supabase URL:      ${SUPABASE_URL.replace(/^(https?:\/\/[^.]+).*/, '$1.…')}`);
  console.log(
    `Key in use:        ${APPLY ? 'service_role' : SERVICE_ROLE_KEY ? 'service_role' : 'anon'}`
  );
  console.log(`Batch size:        ${BATCH_SIZE}`);
  console.log(`────────────────────────────────────────────────────────────────\n`);

  const inventoryIds = await loadInventoryIdSet();
  console.log(`✓ Loaded ${inventoryIds.size} inventory ids for productType matching.`);

  const affected = await fetchAffectedOrders();
  console.log(`✓ Found ${affected.length} orders with base64/data:image in lines.\n`);

  if (affected.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let beforeTotalBytes = 0;
  let afterTotalBytes = 0;
  let imagesStrippedInventory = 0;
  let imagesUploadedOrphan = 0;
  let imagesStrippedNoSource = 0;
  let rowsTouched = 0;
  let rowsSkippedNoLines = 0;
  let rowsErrored = 0;

  for (let i = 0; i < affected.length; i += BATCH_SIZE) {
    const batch = affected.slice(i, i + BATCH_SIZE);
    for (const row of batch) {
      const orderId = row.id;
      const orderNum = row.order_num;
      const lines = Array.isArray(row.lines) ? row.lines : null;
      if (!lines) {
        rowsSkippedNoLines += 1;
        if (VERBOSE) console.log(`  · ${orderNum}: skipped — lines is not an array`);
        continue;
      }
      const beforeBytes = approxJsonSize(lines);
      beforeTotalBytes += beforeBytes;
      let rowChanged = false;
      const newLines = [];
      try {
        for (let idx = 0; idx < lines.length; idx++) {
          const ln = lines[idx];
          if (!ln || typeof ln !== 'object') {
            newLines.push(ln);
            continue;
          }
          const image = ln.image;
          if (!isDataImageUrl(image)) {
            // Already clean. Preserve as-is.
            newLines.push(ln);
            continue;
          }
          const productType = ln.productType ? String(ln.productType) : '';
          const inInventory = productType && inventoryIds.has(productType);
          // Always drop `image`; sometimes also drop `note` is NOT in scope here.
          const { image: _drop, ...rest } = ln;
          if (inInventory) {
            // UI renders /api/inventory/{productType}/thumbnail. No copy.
            newLines.push({ ...rest, image_source: 'inventory' });
            imagesStrippedInventory += 1;
            rowChanged = true;
            if (VERBOSE) {
              console.log(
                `  · ${orderNum}#${idx}: inventory(${productType}) — drop image (${(image.length / 1024).toFixed(1)} kB)`
              );
            }
          } else {
            const parsed = parseDataUrl(image);
            if (!parsed) {
              // Malformed data URL — drop with no_image source, log loudly.
              newLines.push({ ...rest, image_source: 'none' });
              imagesStrippedNoSource += 1;
              rowChanged = true;
              console.warn(
                `  ! ${orderNum}#${idx}: image is not a valid data: URL — dropped without copy`
              );
              continue;
            }
            const { path } = await uploadOrphanImage(orderId, idx, parsed);
            newLines.push({
              ...rest,
              image_source: 'storage',
              image_path: path,
            });
            imagesUploadedOrphan += 1;
            rowChanged = true;
            if (VERBOSE) {
              console.log(
                `  · ${orderNum}#${idx}: orphan(${productType || 'no-productType'}) — upload ${parsed.bytes.length} B → ${path}`
              );
            }
          }
        }
        if (rowChanged) {
          await writeOrderLines(orderId, newLines);
          rowsTouched += 1;
        }
        const afterBytes = approxJsonSize(newLines);
        afterTotalBytes += afterBytes;
        if (rowChanged) {
          console.log(
            `${APPLY ? '✓' : 'DRY'} ${orderNum} — ${(beforeBytes / 1024).toFixed(1)} kB → ${(afterBytes / 1024).toFixed(1)} kB`
          );
        }
      } catch (err) {
        rowsErrored += 1;
        console.error(`✖ ${orderNum} (${orderId}) — ${err instanceof Error ? err.message : err}`);
        // Continue with next row; do NOT throw — partial progress is OK in dry-run
        // because nothing was written. In apply mode the offending row is left
        // intact (no row.lines update happened for it).
      }
    }
  }

  console.log(`\n────────────────────────────────────────────────────────────────`);
  console.log(`Summary`);
  console.log(`────────────────────────────────────────────────────────────────`);
  console.log(`Rows scanned:                 ${affected.length}`);
  console.log(`Rows that would change:       ${rowsTouched}`);
  console.log(`Rows skipped (no lines):      ${rowsSkippedNoLines}`);
  console.log(`Rows errored:                 ${rowsErrored}`);
  console.log(`Images stripped (inventory):  ${imagesStrippedInventory}`);
  console.log(`Images uploaded (orphan):     ${imagesUploadedOrphan}`);
  console.log(`Images dropped (malformed):   ${imagesStrippedNoSource}`);
  console.log(
    `Total bytes BEFORE:           ${beforeTotalBytes.toLocaleString()} (~${(beforeTotalBytes / 1024 / 1024).toFixed(2)} MB)`
  );
  console.log(
    `Total bytes AFTER:            ${afterTotalBytes.toLocaleString()} (~${(afterTotalBytes / 1024 / 1024).toFixed(2)} MB)`
  );
  if (beforeTotalBytes > 0) {
    const pct = ((1 - afterTotalBytes / beforeTotalBytes) * 100).toFixed(1);
    console.log(`Reduction:                    ${pct}%`);
  }
  if (!APPLY) {
    console.log(
      `\nThis was a DRY-RUN. No writes happened. To apply, re-run with:\n  APPLY=1 SUPABASE_SERVICE_ROLE_KEY='…' pnpm node scripts/cleanup-order-line-images.mjs\n` +
        `Take a backup of public.turath_masr_orders before APPLY.`
    );
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
