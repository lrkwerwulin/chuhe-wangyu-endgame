import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../research/upstream/xqwlight/JavaScript/', import.meta.url);
let alertOutput = '';
const context = vm.createContext({
  console,
  Math,
  Date,
  Int32Array,
  Uint8Array,
  alert: (value) => { alertOutput = String(value); },
});

for (const filename of ['position.js', 'test.js']) {
  const url = new URL(filename, root);
  vm.runInContext(fs.readFileSync(url, 'utf8'), context, { filename });
}

const puzzleCount = vm.runInContext('PUZZLE_LIST.length', context);
vm.runInContext('test()', context);
const counters = alertOutput.split('|').map(Number);

assert.equal(puzzleCount, 240, 'upstream puzzle corpus changed');
assert.deepEqual(counters, [7809, 7809, 7207, 718], 'upstream move-generation baseline changed');

console.log(`PASS  xqwlight pinned corpus: ${puzzleCount} positions`);
console.log(`PASS  legal=${counters[0]}, generated=${counters[1]}, self-check-safe=${counters[2]}, checking=${counters[3]}`);
