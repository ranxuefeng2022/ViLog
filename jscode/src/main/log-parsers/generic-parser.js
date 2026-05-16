'use strict';

const fs = require('fs');
const path = require('path');

// Format specifier → regex capture group
const SPEC_PATTERNS = {
  d: '(-?\\d+)',
  i: '(-?\\d+)',
  u: '(\\d+)',
  x: '([0-9a-fA-F]+)',
  X: '([0-9a-fA-F]+)',
  o: '([0-7]+)',
  s: '([^,\\s\\n]+)',
  c: '(.)',
  f: '(-?\\d+\\.?\\d*)',
  F: '(-?\\d+\\.?\\d*)',
  e: '(-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)',
  E: '(-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)',
  g: '(-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)',
  G: '(-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)',
  a: '([0-9a-fA-F.]+)',
  A: '([0-9a-fA-F.]+)',
  p: '(0x[0-9a-fA-F]+|\\S+)',
  n: ''
};

// Type conversion for each specifier
function convertValue(raw, specType) {
  if (raw === undefined || raw === null) return '';
  const s = String(raw);
  if ('di'.includes(specType)) { const n = parseInt(s, 10); return isNaN(n) ? s : n; }
  if (specType === 'u') { const n = parseInt(s, 10); return isNaN(n) ? s : n; }
  if ('xX'.includes(specType)) { const n = parseInt(s, 16); return isNaN(n) ? s : n; }
  if ('fFeEgGaA'.includes(specType)) { const n = parseFloat(s); return isNaN(n) ? s : n; }
  return s;
}

// Normalize printf specifiers: strip flags, width, precision, length modifiers
function normalizeSpec(fmt) {
  return fmt.replace(/%[-+0 #]*(\d+|\*)?(\.?\d+|\.\*)?(hh|h|l|ll|L|q|j|z|Z|t)?([diuoxXfFeEgGaAcspn])/g, '%$4');
}

function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Split format string by top-level commas (respecting parentheses)
function splitTopLevel(format) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < format.length; i++) {
    if (format[i] === '(') depth++;
    else if (format[i] === ')') depth--;
    else if (format[i] === ',' && depth === 0) {
      parts.push(format.substring(start, i));
      start = i + 1;
    }
  }
  if (start < format.length) parts.push(format.substring(start));
  return parts;
}

// Count format specifiers in a string
function countSpecifiers(s) {
  let count = 0;
  const re = /%[diuoxXfFeEgGaAcsp]/g;
  while (re.exec(s) !== null) count++;
  return count;
}

// Parse one format segment (the part between commas) after the key= or key: prefix
// Returns { regexParts: [string], fields: [{key, label, specType}] }
function parseValueFormat(fmtPart, fieldName, labels, labelIdx) {
  const regexParts = [];
  const fields = [];

  if (fmtPart.startsWith('(')) {
    // Tuple: (%d,%d,...)
    const inner = fmtPart.substring(1, fmtPart.length - 1);
    const parts = inner.split(',');
    regexParts.push('\\(');
    for (let k = 0; k < parts.length; k++) {
      if (k > 0) regexParts.push(',');
      const st = extractSpecType(parts[k].trim());
      regexParts.push(SPEC_PATTERNS[st] || '([^,\\s\\n]+)');
      const label = labelIdx.value < labels.length ? labels[labelIdx.value] : fieldName + '_' + (k + 1);
      const key = fieldName + '_' + (k + 1);
      fields.push({ name: fieldName, key, label, specType: st });
      labelIdx.value++;
    }
    regexParts.push('\\)');
  } else if (fmtPart.startsWith('0x')) {
    // Hex with prefix: 0x%x
    regexParts.push('0x');
    const rest = fmtPart.substring(2);
    const st = extractSpecType(rest);
    regexParts.push(SPEC_PATTERNS[st] || '([^,\\s\\n]+)');
    const label = labelIdx.value < labels.length ? labels[labelIdx.value] : fieldName;
    fields.push({ name: fieldName, key: fieldName, label, specType: st });
    labelIdx.value++;
  } else {
    // Simple (%d) or compound (%d(%d))
    const st = extractSpecType(fmtPart);
    regexParts.push(SPEC_PATTERNS[st] || '([^,\\s\\n]+)');
    const label = labelIdx.value < labels.length ? labels[labelIdx.value] : fieldName;
    fields.push({ name: fieldName, key: fieldName, label, specType: st });
    labelIdx.value++;

    // Check compound: %d(%d)
    let pos = 2; // skip %x
    if (pos < fmtPart.length && fmtPart[pos] === '(') {
      const inner = fmtPart.substring(pos + 1, fmtPart.length - 1);
      const st2 = extractSpecType(inner.trim());
      regexParts.push('\\(' + (SPEC_PATTERNS[st2] || '([^,\\s\\n]+)') + '\\)');
      const label2 = labelIdx.value < labels.length ? labels[labelIdx.value] : fieldName + '_2';
      fields.push({ name: fieldName, key: fieldName + '_2', label: label2, specType: st2 });
      labelIdx.value++;
    }
  }

  return { regexParts, fields };
}

function extractSpecType(s) {
  const m = s.match(/^%([diuoxXfFeEgGaAcsp])/);
  return m ? m[1] : 's';
}

// Compile format string into field definitions + payload regex
function compileFormat(format, labels) {
  const norm = normalizeSpec(format);
  const segments = splitTopLevel(norm);
  const allFields = [];
  const regexParts = [];
  const labelIdx = { value: 0 };

  for (let si = 0; si < segments.length; si++) {
    if (si > 0) regexParts.push(',');

    const seg = segments[si];
    // Match: fieldName=fmt  or  fieldName:fmt
    const sepMatch = seg.match(/^(\w+)([:=])/);
    if (!sepMatch) {
      regexParts.push(reEscape(seg));
      continue;
    }

    const fieldName = sepMatch[1];
    const sepChar = sepMatch[2];
    const fmtPart = seg.substring(sepMatch[0].length);

    regexParts.push(reEscape(fieldName) + sepChar);
    const result = parseValueFormat(fmtPart, fieldName, labels, labelIdx);
    regexParts.push(...result.regexParts);
    allFields.push(...result.fields);
  }

  return {
    fields: allFields,
    payloadRegex: new RegExp(regexParts.join('')),
    labelCount: labelIdx.value
  };
}

// Standard prefix fields common to all parsers
const STANDARD_FIELDS = [
  { key: 'source_file', label: '源文件' },
  { key: 'android_time', label: 'Android时间' },
  { key: 'timestamp', label: '时间戳(s)' },
  { key: 'ts_raw', label: '原始时间戳(μs)' },
  { key: 'caller', label: '调用线程' }
];

// Preprocess format config:
//  - Accept string or array of strings (multi-line C printf)
//  - Auto-extract [xxx] marker from beginning
//  - Strip \n suffix
//  - Normalize trailing commas between segments
function preprocessFormat(format) {
  let fmt = Array.isArray(format) ? format.join('') : String(format);
  // Strip literal \n or escaped \\n at end
  fmt = fmt.replace(/\\n$/, '').replace(/\n$/, '');
  // Auto-extract marker: [AP], [CP], etc.
  const markerMatch = fmt.match(/^(\[[A-Za-z]+\])\s*/);
  let marker = null;
  if (markerMatch) {
    marker = markerMatch[1];
    fmt = fmt.substring(markerMatch[0].length);
  }
  return { fmt, marker };
}

// Create a parser module from a config entry
function createParser(config) {
  const { tag, keyword, platform, labels, fieldAliases } = config;
  const { fmt, marker: autoMarker } = preprocessFormat(config.format);
  const marker = config.marker || autoMarker;
  const compiled = compileFormat(fmt, labels || []);

  // Apply field aliases if configured
  if (fieldAliases) {
    for (const f of compiled.fields) {
      if (fieldAliases[f.key]) f.key = fieldAliases[f.key];
    }
  }

  // Build HEADER_ORDER: standard prefix + data fields
  const headers = [];
  const headerLabels = {};
  for (const sf of STANDARD_FIELDS) {
    headers.push(sf.key);
    headerLabels[sf.key] = sf.label;
  }
  for (const f of compiled.fields) {
    headers.push(f.key);
    headerLabels[f.key] = f.label;
  }

  // Build FIELD_MAPPING
  const fieldMapping = buildFieldMapping(fmt, compiled);

  // Build printInterface — just the format string for display
  const printInterface = (marker ? marker + ' ' : '') + fmt;

  // Build field lookup for smart fallback: fieldName → [field defs]
  // e.g. "cycle_counter" → [{key:"cycle_counter",specType:"d"}, {key:"cycle_counter_2",specType:"d"}]
  const fieldDefsMap = {};
  for (const f of compiled.fields) {
    if (!fieldDefsMap[f.name]) fieldDefsMap[f.name] = [];
    fieldDefsMap[f.name].push(f);
  }
  // Also index by output key (after alias) for colon-separated fields
  const knownKeys = new Set(compiled.fields.map(f => f.key));

  // Extract prefix fields from log line (common for all parsers)
  function extractPrefix(line) {
    const firstComma = line.indexOf(',');
    const secondComma = line.indexOf(',', firstComma + 1);
    const thirdComma = line.indexOf(',', secondComma + 1);
    const level = firstComma > 0 ? line.substring(0, firstComma) : '';
    const tsSeconds = (firstComma > 0 && secondComma > firstComma)
      ? line.substring(firstComma + 1, secondComma) : '';
    const tsRaw = (secondComma > firstComma && thirdComma > secondComma)
      ? line.substring(secondComma + 1, thirdComma) : '';
    let caller = '';
    const callerMatch = line.match(/caller=(T\d+)/);
    if (callerMatch) caller = callerMatch[1];
    return { source_file: '', level, timestamp: tsSeconds, ts_raw: tsRaw, caller };
  }

  // Smart kv extraction: uses format metadata for type conversion,
  // handles compound/tuple values, only extracts known fields
  function extractSmartKv(payload) {
    const result = {};
    const kvRegex = /(\w+)[=:]\((?:[^)]*)\)|(\w+)[=:]((?:\([^)]*\)|[^,])*)/g;
    let kvMatch;
    while ((kvMatch = kvRegex.exec(payload)) !== null) {
      const key = kvMatch[1] || kvMatch[2];
      const rawVal = kvMatch[3] !== undefined ? kvMatch[3] : kvMatch[0].substring(kvMatch[0].indexOf('=') + 1);
      const defs = fieldDefsMap[key];
      if (!defs) continue; // Unknown field — skip

      // Tuple: key=(v1,v2,...)
      const tupleMatch = rawVal.match(/^\((.+)\)$/);
      if (tupleMatch && defs.length > 1) {
        const parts = tupleMatch[1].split(',');
        for (let i = 0; i < parts.length && i < defs.length; i++) {
          result[defs[i].key] = convertValue(parts[i].trim(), defs[i].specType);
        }
        continue;
      }
      // Compound: key=v(sub)
      const subMatch = rawVal.match(/^(-?\d+(?:\.\d+)?)\(([^)]+)\)$/);
      if (subMatch && defs.length > 1) {
        const mainDef = defs.find(d => d.key === key) || defs[0];
        result[mainDef.key] = convertValue(subMatch[1], mainDef.specType);
        const subDef = defs.find(d => d.key === key + '_2') || defs[1];
        if (subDef) result[subDef.key] = convertValue(subMatch[2], subDef.specType);
        continue;
      }
      // Simple value
      const def = defs.find(d => d.key === key) || defs[0];
      if (def) result[def.key] = convertValue(rawVal, def.specType);
    }
    return result;
  }

  function parse(line, sourceFile) {
    if (!line || !line.includes(keyword)) return null;

    // Locate payload
    let payload;
    if (marker) {
      const markerIdx = line.indexOf(marker);
      if (markerIdx === -1) return null;
      payload = line.substring(markerIdx + marker.length).trim();
    } else {
      const firstField = compiled.fields[0];
      if (!firstField) return null;
      let idx = line.indexOf(firstField.name + '=');
      if (idx === -1) idx = line.indexOf(firstField.name + ':');
      if (idx === -1) return null;
      payload = line.substring(idx).trim();
    }

    // Handle corrupted trailing data
    const corruptIdx = payload.indexOf(keyword);
    if (corruptIdx > 0) {
      payload = payload.substring(0, corruptIdx).trim();
    }

    // Extract common prefix fields
    const data = extractPrefix(line);
    data.source_file = sourceFile || '';

    // Strategy 1: Fast regex match (exact format)
    const m = payload.match(compiled.payloadRegex);
    if (m) {
      for (let i = 0; i < compiled.fields.length; i++) {
        const f = compiled.fields[i];
        data[f.key] = m[i + 1] !== undefined ? convertValue(m[i + 1], f.specType) : '';
      }
      return data;
    }

    // Strategy 2: Smart kv extraction (format changed — fields added/removed/reordered)
    Object.assign(data, extractSmartKv(payload));
    return data;
  }

  function getHeaders() { return headers; }
  function getHeaderLabels() { return headerLabels; }
  function getTabName() { return tag; }
  function getFieldMapping() { return fieldMapping; }
  function getPrintInterface() { return printInterface; }

  return {
    keyword,
    platform: platform || undefined,
    parser: { parse, getHeaders, getHeaderLabels, getTabName, getFieldMapping, getPrintInterface }
  };
}

// Build FIELD_MAPPING from preprocessed format + compiled fields
function buildFieldMapping(formatStr, compiled) {
  const norm = normalizeSpec(formatStr);
  const segments = splitTopLevel(norm);
  const mapping = [];
  let fieldIdx = 0;

  for (const seg of segments) {
    const sepMatch = seg.match(/^(\w+)([:=])/);
    if (!sepMatch) { fieldIdx += countSpecifiers(seg); continue; }
    const raw = seg;
    const specCount = countSpecifiers(seg.substring(sepMatch[0].length));
    const keys = [];
    for (let k = 0; k < specCount && fieldIdx < compiled.fields.length; k++) {
      keys.push(compiled.fields[fieldIdx].key);
      fieldIdx++;
    }
    mapping.push({ raw, keys });
  }

  return mapping;
}

// Read raw config.json
function readConfig() {
  const configPath = path.join(__dirname, 'config.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('[generic-parser] Failed to load config.json:', e.message);
    return null;
  }
}

// Get file patterns from config (e.g. ["kernel_log"])
function getFilePatterns() {
  const config = readConfig();
  if (!config) return ['kernel_log'];
  // Support both new {filePatterns, parsers} format and legacy [parser] array
  const patterns = config.filePatterns;
  if (Array.isArray(patterns) && patterns.length > 0) return patterns;
  return ['kernel_log'];
}

// Load all config-based parsers from config.json
function loadConfigParsers() {
  const config = readConfig();
  if (!config) return [];

  try {
    // Support both formats: {parsers: [...]} or legacy [...]
    const configs = Array.isArray(config) ? config : (config.parsers || []);
    const parsers = [];
    for (const cfg of configs) {
      try {
        parsers.push(createParser(cfg));
      } catch (e) {
        console.error('[generic-parser] Failed to compile config for "' + (cfg.tag || cfg.keyword || '?') + '":', e.message);
      }
    }
    return parsers;
  } catch (e) {
    console.error('[generic-parser] Failed to load config.json:', e.message);
    return [];
  }
}

module.exports = { createParser, loadConfigParsers, getFilePatterns, compileFormat, convertValue };
