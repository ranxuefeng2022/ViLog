const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const vm = require('vm');

// Create a browser-like context for testing renderer modules
function createBrowserContext() {
  const context = {
    window: {},
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
    },
    document: {
      addEventListener: () => {},
      getElementById: () => null,
    },
    setTimeout: (fn, ms) => fn(),
    setInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  context.window = context;
  vm.createContext(context);
  return context;
}

function loadModule(context, filePath) {
  const fs = require('fs');
  const code = fs.readFileSync(filePath, 'utf8');
  vm.runInContext(code, context);
}

// ===================================================================
// EventBus tests
// ===================================================================

describe('EventBus', () => {
  let ctx;

  beforeEach(() => {
    ctx = createBrowserContext();
    loadModule(ctx, 'renderer/js/core/event-bus.js');
  });

  it('emits events to subscribers', () => {
    vm.runInContext(`
      var received_val = 0;
      window.App.EventBus.on("test", (d) => { received_val = d.value; });
      window.App.EventBus.emit("test", { value: 42 });
    `, ctx);
    assert.strictEqual(ctx.received_val, 42);
  });

  it('supports multiple subscribers', () => {
    vm.runInContext(`
      var count1 = 0, count2 = 0;
      window.App.EventBus.on("inc", () => { count1++ });
      window.App.EventBus.on("inc", () => { count2++ });
      window.App.EventBus.emit("inc");
    `, ctx);
    assert.strictEqual(ctx.count1, 1);
    assert.strictEqual(ctx.count2, 1);
  });

  it('off() removes subscriber', () => {
    vm.runInContext(`
      var count = 0;
      var unsub = window.App.EventBus.on("toggle", () => { count++ });
      window.App.EventBus.emit("toggle");
      unsub();
      window.App.EventBus.emit("toggle");
    `, ctx);
    assert.strictEqual(ctx.count, 1);
  });

  it('once() fires only once', () => {
    vm.runInContext(`
      var count = 0;
      window.App.EventBus.once("fire", () => { count++ });
      window.App.EventBus.emit("fire");
      window.App.EventBus.emit("fire");
    `, ctx);
    assert.strictEqual(ctx.count, 1);
  });

  it('emit on unknown event does not throw', () => {
    assert.doesNotThrow(() => {
      vm.runInContext('window.App.EventBus.emit("nonexistent", {})', ctx);
    });
  });

  it('subscriber error does not break other subscribers', () => {
    vm.runInContext(`
      var reached = false;
      window.App.EventBus.on("chain", () => { throw new Error("boom"); });
      window.App.EventBus.on("chain", () => { reached = true; });
      window.App.EventBus.emit("chain");
    `, ctx);
    assert.strictEqual(ctx.reached, true);
  });

  it('listenerCount reports correct count', () => {
    vm.runInContext(`
      window.App.EventBus.on("count-test", () => {});
      window.App.EventBus.on("count-test", () => {});
    `, ctx);
    const count = vm.runInContext('window.App.EventBus.listenerCount("count-test")', ctx);
    assert.strictEqual(count, 2);
  });

  it('eventNames returns all registered events', () => {
    vm.runInContext(`
      window.App.EventBus.on("evt-a", () => {});
      window.App.EventBus.on("evt-b", () => {});
    `, ctx);
    const names = vm.runInContext('window.App.EventBus.eventNames()', ctx);
    assert.ok(names.includes('evt-a'));
    assert.ok(names.includes('evt-b'));
  });
});

// ===================================================================
// State tests
// ===================================================================

describe('State', () => {
  let ctx;

  beforeEach(() => {
    ctx = createBrowserContext();
    // State depends on EventBus
    loadModule(ctx, 'renderer/js/core/event-bus.js');
    loadModule(ctx, 'renderer/js/core/state.js');
  });

  it('gets default values', () => {
    const val = vm.runInContext('window.App.State.get("isFullscreen")', ctx);
    assert.strictEqual(val, false);
  });

  it('sets and gets values', () => {
    vm.runInContext('window.App.State.set("searchKeyword", "hello")', ctx);
    const val = vm.runInContext('window.App.State.get("searchKeyword")', ctx);
    assert.strictEqual(val, 'hello');
  });

  it('set syncs to window global', () => {
    vm.runInContext('window.App.State.set("searchKeyword", "world")', ctx);
    const globalVal = vm.runInContext('window.searchKeyword', ctx);
    assert.strictEqual(globalVal, 'world');
  });

  it('watcher receives new and old value', () => {
    vm.runInContext(`
      var captured = null;
      window.App.State.on("searchKeyword", (newVal, oldVal) => {
        captured = { newVal: newVal, oldVal: oldVal };
      });
      window.App.State.set("searchKeyword", "test");
    `, ctx);
    assert.strictEqual(ctx.captured.newVal, 'test');
    assert.strictEqual(ctx.captured.oldVal, '');
  });

  it('watcher unsubscribe stops notifications', () => {
    vm.runInContext(`
      var count = 0;
      var unsub = window.App.State.on("searchKeyword", () => { count++ });
      window.App.State.set("searchKeyword", "a");
      unsub();
      window.App.State.set("searchKeyword", "b");
    `, ctx);
    assert.strictEqual(ctx.count, 1);
  });

  it('batchSet updates multiple keys', () => {
    vm.runInContext(`
      window.App.State.batchSet({
        searchKeyword: "batch",
        totalMatchCount: 10
      });
    `, ctx);
    assert.strictEqual(vm.runInContext('window.App.State.get("searchKeyword")', ctx), 'batch');
    assert.strictEqual(vm.runInContext('window.App.State.get("totalMatchCount")', ctx), 10);
  });

  it('getAll returns snapshot with correct types', () => {
    vm.runInContext(`
      window.App.State.set("searchKeyword", "snap");
      var snapshot = window.App.State.getAll();
    `, ctx);
    const kw = vm.runInContext('window.App.State.get("searchKeyword")', ctx);
    assert.strictEqual(kw, 'snap');
    // snapshot should be a plain object
    const snap = ctx.snapshot;
    assert.ok(typeof snap === 'object');
    assert.strictEqual(snap.searchKeyword, 'snap');
  });

  it('syncFromGlobal pulls window values into state', () => {
    vm.runInContext(`
      window.searchKeyword = "from-global";
      window.App.State.syncFromGlobal();
    `, ctx);
    assert.strictEqual(vm.runInContext('window.App.State.get("searchKeyword")', ctx), 'from-global');
  });

  it('LEGACY_GLOBAL_KEYS is an array with expected entries', () => {
    const keys = vm.runInContext('window.App.State.LEGACY_GLOBAL_KEYS', ctx);
    assert.ok(Array.isArray(keys));
    assert.ok(keys.includes('originalLines'));
    assert.ok(keys.includes('searchKeyword'));
    assert.ok(keys.includes('bookmarkedIndexSet'));
    assert.ok(keys.includes('customHighlights'));
  });
});
