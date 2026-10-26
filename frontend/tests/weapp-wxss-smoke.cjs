const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const compiler = process.argv[2]
assert.ok(compiler, 'Pass the installed official WeChat wcsc.exe path')
const run = spawnSync(compiler, ['-pc', '1', 'app.wxss'], { cwd:path.resolve(__dirname,'../dist/weapp'), encoding:'utf8', windowsHide:true, maxBuffer:8*1024*1024 })
assert.equal(run.status, 0, run.stderr || run.error?.message || 'WeChat WXSS compilation failed')
console.log('WeChat native WXSS compilation passed.')