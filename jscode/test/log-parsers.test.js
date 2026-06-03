'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  compileFormat,
  convertValue,
  createParser,
  loadConfigParsers
} = require('../src/main/log-parsers/generic-parser');

// ================================================================
// convertValue
// ================================================================
describe('convertValue', () => {
  it('should convert %d to integer', () => {
    assert.strictEqual(convertValue('42', 'd'), 42);
    assert.strictEqual(convertValue('-10', 'd'), -10);
  });

  it('should convert %i to integer', () => {
    assert.strictEqual(convertValue('99', 'i'), 99);
  });

  it('should convert %u to unsigned integer', () => {
    assert.strictEqual(convertValue('255', 'u'), 255);
  });

  it('should convert %x/%X to hex integer', () => {
    assert.strictEqual(convertValue('ff', 'x'), 255);
    assert.strictEqual(convertValue('FF', 'X'), 255);
    assert.strictEqual(convertValue('0x100', 'x'), 256);
  });

  it('should convert %f/%F/%e/%E/%g to float', () => {
    assert.strictEqual(convertValue('3.14', 'f'), 3.14);
    assert.strictEqual(convertValue('-2.5', 'F'), -2.5);
    assert.strictEqual(convertValue('1e10', 'e'), 1e10);
  });

  it('should return string for %s/%c', () => {
    assert.strictEqual(convertValue('hello', 's'), 'hello');
    assert.strictEqual(convertValue('x', 'c'), 'x');
  });

  it('should return empty string for null/undefined', () => {
    assert.strictEqual(convertValue(null, 'd'), '');
    assert.strictEqual(convertValue(undefined, 'f'), '');
  });

  it('should return original string for non-numeric values with numeric format', () => {
    assert.strictEqual(convertValue('abc', 'd'), 'abc');
  });
});

// ================================================================
// compileFormat — basic field parsing
// ================================================================
describe('compileFormat', () => {
  it('should parse fieldName=format pattern', () => {
    const result = compileFormat('vbat_mv=%d', ['电压']);
    assert.deepStrictEqual(result.fields, [
      { name: 'vbat_mv', key: 'vbat_mv', label: '电压', specType: 'd' }
    ]);
    assert.strictEqual(result.labelCount, 1);
  });

  it('should parse fieldName:format pattern', () => {
    const result = compileFormat('vbat_mv:%d', ['电压']);
    assert.deepStrictEqual(result.fields, [
      { name: 'vbat_mv', key: 'vbat_mv', label: '电压', specType: 'd' }
    ]);
  });

  it('should parse multiple comma-separated fields', () => {
    const result = compileFormat('a=%d,b=%s,c=%f', ['A标签', 'B标签', 'C标签']);
    assert.strictEqual(result.fields.length, 3);
    assert.strictEqual(result.fields[0].key, 'a');
    assert.strictEqual(result.fields[1].key, 'b');
    assert.strictEqual(result.fields[2].key, 'c');
    assert.strictEqual(result.fields[0].specType, 'd');
    assert.strictEqual(result.fields[1].specType, 's');
    assert.strictEqual(result.fields[2].specType, 'f');
  });

  it('should generate a matching regex for simple format', () => {
    const result = compileFormat('vbat_mv=%d,ibat_ma=%d', ['电压', '电流']);
    const re = result.payloadRegex;
    assert.ok(re instanceof RegExp);
    assert.ok(re.test('vbat_mv=4200,ibat_ma=1500'));
  });

  it('should capture values via regex groups', () => {
    const result = compileFormat('vbat_mv=%d,ibat_ma=%d', ['电压', '电流']);
    const match = 'vbat_mv=4200,ibat_ma=1500'.match(result.payloadRegex);
    assert.ok(match);
    assert.strictEqual(match[1], '4200');
    assert.strictEqual(match[2], '1500');
  });

  it('should use field name as label when no labels provided', () => {
    const result = compileFormat('foo=%d', []);
    assert.strictEqual(result.fields[0].label, 'foo');
  });

  it('should handle tuple format: key=(%d,%d)', () => {
    const result = compileFormat('pair=(%d,%d)', ['主值', '次值']);
    assert.strictEqual(result.fields.length, 2);
    assert.strictEqual(result.fields[0].name, 'pair');
    assert.strictEqual(result.fields[1].name, 'pair');
    assert.strictEqual(result.fields[0].key, 'pair_1');
    assert.strictEqual(result.fields[1].key, 'pair_2');
    // Should match (123,456)
    assert.ok(result.payloadRegex.test('pair=(123,456)'));
  });

  it('should handle tuple with kv entries: key=(a=%d,b=%s)', () => {
    const result = compileFormat('info=(a=%d,b=%s)', ['A值', 'B值']);
    assert.strictEqual(result.fields.length, 2);
    assert.strictEqual(result.fields[0].key, 'a');
    assert.strictEqual(result.fields[1].key, 'b');
    assert.ok(result.payloadRegex.test('info=(a=1,b=hello)'));
  });

  it('should handle compound format: key=%d(sub)', () => {
    const result = compileFormat('cycle_counter=%d(%d)', ['循环', 'ADSP循环']);
    assert.strictEqual(result.fields.length, 2);
    assert.strictEqual(result.fields[0].key, 'cycle_counter');
    assert.strictEqual(result.fields[1].key, 'cycle_counter_2');
    assert.ok(result.payloadRegex.test('cycle_counter=150(149)'));
  });

  it('should handle hex format: key=0x%x', () => {
    const result = compileFormat('status=0x%x', ['状态']);
    assert.strictEqual(result.fields[0].specType, 'x');
    assert.ok(result.payloadRegex.test('status=0xdead'));
  });

  it('should match real-world vfcs log line', () => {
    const result = compileFormat(
      'chg_status=%d,vbus_mv=%d,usb_type=%d',
      ['充电状态', 'VBUS电压(mV)', 'USB类型']
    );
    const match = 'chg_status=3,vbus_mv=5000,usb_type=2'.match(result.payloadRegex);
    assert.ok(match);
    assert.strictEqual(match[1], '3');
    assert.strictEqual(match[2], '5000');
    assert.strictEqual(match[3], '2');
  });

  it('should handle space-separated kv with key= prefix', () => {
    const result = compileFormat('l=%d v=%d t=%.1f', ['电量', '电压', '温度']);
    assert.strictEqual(result.fields.length, 3);
    assert.ok(result.payloadRegex.test('l=85 v=4200 t=25.5'));
  });

  it('should normalize length-modified format specifiers (%ld → %d)', () => {
    // normalizeSpec strips 'l' from %ld, so compileFormat treats it as %d
    const result = compileFormat('val=%ld', ['值']);
    assert.ok(result.payloadRegex.test('val=123'));
  });
});

// ================================================================
// createParser — full parser lifecycle
// ================================================================
describe('createParser', () => {
  const basicConfig = {
    tag: 'test_parser',
    keyword: 'TEST_KEYWORD',
    platform: 'test',
    format: 'vbat_mv=%d,ibat_ma=%d',
    labels: ['电池电压(mV)', '电池电流(mA)']
  };

  it('should create a parser with correct metadata', () => {
    const mod = createParser(basicConfig);
    assert.strictEqual(mod.keyword, 'TEST_KEYWORD');
    assert.strictEqual(mod.platform, 'test');
    assert.strictEqual(mod.parser.getTabName(), 'test_parser');
  });

  it('should produce correct getHeaders()', () => {
    const mod = createParser(basicConfig);
    const headers = mod.parser.getHeaders();
    // STANDARD_FIELDS + data fields
    assert.ok(headers.includes('source_file'));
    assert.ok(headers.includes('timestamp'));
    assert.ok(headers.includes('vbat_mv'));
    assert.ok(headers.includes('ibat_ma'));
  });

  it('should produce correct getHeaderLabels()', () => {
    const mod = createParser(basicConfig);
    const labels = mod.parser.getHeaderLabels();
    assert.strictEqual(labels['vbat_mv'], '电池电压(mV)');
    assert.strictEqual(labels['ibat_ma'], '电池电流(mA)');
  });

  it('should parse a matching log line (strategy 1: regex match)', () => {
    const mod = createParser(basicConfig);
    const line = 'I,1234567890.123,9876543210987,caller=T1234,TEST_KEYWORD vbat_mv=4200,ibat_ma=1500';
    const data = mod.parser.parse(line, 'test.log');

    assert.ok(data);
    assert.strictEqual(data.source_file, 'test.log');
    assert.strictEqual(data.vbat_mv, 4200);
    assert.strictEqual(data.ibat_ma, 1500);
    // Prefix fields extracted from the log line
    assert.strictEqual(data.level, 'I');
    assert.strictEqual(data.timestamp, '1234567890.123');
    assert.strictEqual(data.ts_raw, '9876543210987');
    assert.strictEqual(data.caller, 'T1234');
  });

  it('should return null for non-matching line', () => {
    const mod = createParser(basicConfig);
    assert.strictEqual(mod.parser.parse('some random line', 'test.log'), null);
  });

  it('should return null if keyword not present', () => {
    const mod = createParser(basicConfig);
    assert.strictEqual(mod.parser.parse('OTHER_KEYWORD vbat_mv=4200,ibat_ma=1500', 'test.log'), null);
  });

  it('should handle corrupted trailing data (cut at keyword reap)', () => {
    const mod = createParser(basicConfig);
    // Line where the keyword appears again due to corruption
    const line = 'I,1,2,caller=T1,TEST_KEYWORD vbat_mv=4200,ibat_ma=1500 TEST_KEYWORD garbage';
    const data = mod.parser.parse(line, 'test.log');
    assert.ok(data);
    assert.strictEqual(data.vbat_mv, 4200);  // Still gets the good part
  });

  // Smart kv fallback (strategy 2): when exact format doesn't match
  it('should fall back to smart kv extraction for extra fields', () => {
    const mod = createParser(basicConfig);
    // This line has an extra field not in the format
    const line = 'I,1,2,caller=T1,TEST_KEYWORD vbat_mv=4200,ibat_ma=1500,extra_field=hello';
    const data = mod.parser.parse(line, 'test.log');
    assert.ok(data);
    assert.strictEqual(data.vbat_mv, 4200);
    assert.strictEqual(data.ibat_ma, 1500);
    // extra_field is NOT in the known fields, so it won't appear
    assert.strictEqual(data.extra_field, undefined);
  });

  it('should apply fieldAliases', () => {
    const cfgWithAlias = {
      tag: 'test_alias',
      keyword: 'TEST_ALIAS',
      format: 'LONG_NAME=%d',
      labels: ['长名称'],
      fieldAliases: { LONG_NAME: 'short_name' }
    };
    const mod = createParser(cfgWithAlias);
    const headers = mod.parser.getHeaders();
    assert.ok(headers.includes('short_name'));
    assert.ok(!headers.includes('LONG_NAME'));
  });

  it('should handle bracket prefix [KEY:value]', () => {
    const cfg = {
      tag: 'test_bracket',
      keyword: 'TEST_BRACKET',
      format: '[AP] chg_status=%d',
      labels: ['充电状态']
    };
    const mod = createParser(cfg);
    const line = 'I,1,2,caller=T1,TEST_BRACKET [AP] chg_status=3';
    const data = mod.parser.parse(line, 'test.log');
    assert.ok(data);
    assert.strictEqual(data.chg_status, 3);
  });
});

// ================================================================
// loadConfigParsers — integration with config.json
// ================================================================
describe('loadConfigParsers', () => {
  it('should return an array of parser modules', () => {
    const parsers = loadConfigParsers();
    assert.ok(Array.isArray(parsers));
    assert.ok(parsers.length > 0, 'Expected at least one parser from config.json');
  });

  it('each parser should have keyword, platform, and parser properties', () => {
    const parsers = loadConfigParsers();
    for (const p of parsers) {
      assert.ok(typeof p.keyword === 'string', 'keyword should be a string');
      assert.ok(typeof p.parser === 'object', 'parser should be an object');
      assert.ok(typeof p.parser.parse === 'function', 'parser.parse should be a function');
      assert.ok(typeof p.parser.getTabName === 'function', 'parser.getTabName should be a function');
      assert.ok(typeof p.parser.getHeaders === 'function', 'parser.getHeaders should be a function');
      assert.ok(typeof p.parser.getHeaderLabels === 'function', 'parser.getHeaderLabels should be a function');
    }
  });

  it('each parser should return non-empty headers', () => {
    const parsers = loadConfigParsers();
    for (const p of parsers) {
      const headers = p.parser.getHeaders();
      assert.ok(headers.length > 0, `Parser ${p.keyword} should have headers`);
    }
  });
});
