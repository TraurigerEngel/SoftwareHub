'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const backend = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'lib.rs'), 'utf8');

test('Tauri portable cache merges per-program results before writing', () => {
  assert.match(backend, /fn choose_cache_entry/);
  assert.match(backend, /fn merge_cache_entries/);
  assert.match(backend, /merge_cache_entries\(&read_cache_from\(path\),\s*&sanitize_entries\(entries\)\)/);
  assert.match(backend, /let _guard = CACHE_WRITE_LOCK\.lock\(/);
});

test('Tauri portable cache retains a recoverable backup, not just a temporary file', () => {
  assert.match(backend, /fn read_cache_file/);
  assert.match(backend, /read_cache_file\(&path\.with_extension\("json\.bak"\)\)/);
  assert.match(backend, /let primary_is_valid = read_cache_file\(&path\)\.is_some\(\)/);
  assert.doesNotMatch(backend, /let _ = fs::remove_file\(&backup\)/);
});

test('Rust cache tests cover freshness, preserved entries and backup restore', () => {
  for (const name of [
    'newest_verified_timestamp_wins_over_later_failed_attempt',
    'most_recent_attempt_breaks_equal_verification_timestamps',
    'partial_ui_snapshot_does_not_delete_other_cached_programs',
    'on_disk_save_merges_entries_and_recovers_from_backup',
    'legacy_configured_fallback_never_counts_as_fresh'
  ]) assert.match(backend, new RegExp(`fn ${name}\\(`));
});
