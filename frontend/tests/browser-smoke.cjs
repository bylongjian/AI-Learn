// Requires the opt-in fixed-content QA API on :8000 and built H5 on :10086.
// Runs agent-browser's documented CLI; never calls a paid model directly.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const executable = process.argv[2] || 'agent-browser'
const session = 'xueximie-smoke-' + Date.now()
const options = ['--session', session]
if (process.argv[3]) options.push('--executable-path', process.argv[3])
const artifacts = path.resolve('.qa'); fs.mkdirSync(artifacts, { recursive: true })
const ringProbe = `(() => { const canvas=document.querySelector('.score-canvas canvas'); if(!canvas) return {canvasMissing:true}; const rect=canvas.getBoundingClientRect(); const host=canvas.closest('.score-canvas'); const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data; let ink=0; for(let i=3;i<data.length;i+=4) if(data[i]) ink++; return {width:canvas.width,height:canvas.height,cssWidth:rect.width,cssHeight:rect.height,hostId:host?.id,canvasId:canvas.id,ink}; })()`
const commands = [
  ['open', 'http://127.0.0.1:10086'], ['set', 'viewport', '375', '812'], ['wait', '.topic-input textarea'], ['snapshot', '-i'],
  ['fill', '.topic-input textarea', 'RAG'], ['click', '.topic-form .primary'],
  ['wait', '.taro_page_stationed:not(.taro_page_shade) .answer-options'], ['snapshot', '-i'],
]
for (let i = 0; i < 5; i++) {
  commands.push(['click', '.answer-options > .answer-option:nth-child(1)'])
  if (i === 3) commands.push(['click', '.answer-options > .answer-option:nth-child(2)'])
  commands.push(['wait', '.answer-submit .primary:not([disabled])'], ['click', '.answer-submit .primary'], ['wait', '.answer-feedback'], ['snapshot', '-i'],
    ['click', '.answer-feedback .primary'])
  if (i < 4) commands.push(['wait', '.answer-submit'])
}
commands.push(['wait', '.taro_page_stationed:not(.taro_page_shade) .report-score'], ['snapshot', '-i'], ['get', 'text', '.report-score'],
  ['click', '.back-button'], ['wait', '.taro_page_stationed:not(.taro_page_shade) .profile-stats'], ['snapshot', '-i'], ['get', 'text', '.profile-stats'],
  ['click', '.tab-bar .tab-item:nth-child(2)'], ['wait', '.taro_page_stationed:not(.taro_page_shade) .search-input input'], ['snapshot', '-i'],
  ['fill', '.search-input input', 'no-such-topic'], ['snapshot', '-i'], ['get', 'text', '.empty-state'],
  ['click', '.empty-state .text-action'], ['wait', '.library-row'],
  ['click', '.filter-button:nth-child(2)'], ['snapshot', '-i'], ['get', 'text', '.empty-state'],
  ['click', '.empty-state .text-action'], ['click', '.library-row .row-link'],
  ['wait', '.taro_page_stationed:not(.taro_page_shade) .report-score'], ['snapshot', '-i'], ['get', 'text', '.back-button'],
  ['click', '.report-actions .secondary-text'], ['get', 'text', '.review-list'], ['eval', ringProbe],
  ['click', '.report-more-toggle'], ['eval', ringProbe], ['click', '.report-more-toggle'], ['eval', ringProbe])
for (const width of [320, 375, 414]) commands.push(
  ['set', 'viewport', String(width), '812'], ['reload'], ['wait', '.taro_page_stationed:not(.taro_page_shade) .report-score'], ['snapshot', '-i'],
  ['eval', ringProbe], ['screenshot', 'body', path.join(artifacts, `report-${width}.png`)], ['errors'])
commands.push(['set','viewport','375','812'],['snapshot','-i'],['eval',ringProbe],['set','viewport','414','812'],['snapshot','-i'],['eval',ringProbe])

try {
  const run = spawnSync(executable, [...options, 'batch', '--bail', '--json'], {
    input: JSON.stringify(commands), encoding: 'utf8', timeout: 180000,
    maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  })
  fs.writeFileSync(path.join(artifacts, 'browser-smoke.json'), run.stdout || '')
  if (run.status !== 0) throw new Error(run.stderr || run.stdout || String(run.error))
  const result = JSON.parse(run.stdout)
  const content = JSON.stringify(result)
  const probes = result.filter(entry => entry.command[0] === 'eval').map(entry => entry.result.result)
  console.log('Ring probes:', JSON.stringify(probes))
  assert.equal(probes.length, 8, 'Expected every viewport and report-toggle probe to execute')
  for (const probe of probes) {
    assert.ok(probe.ink > 500, 'Expected actual painted ring pixels')
    assert.ok(probe.width >= probe.cssWidth && probe.height >= probe.cssHeight, 'Expected sufficient canvas resolution at every viewport size')
  }
  assert.ok(content.includes('80%') && content.includes('40 XP'), 'Expected report and profile statistics')
  assert.ok(content.includes('没有找到相关关卡'), 'Expected search/filter no-results state')
  assert.ok(content.includes('返回题库'), 'Expected report return source')
  assert.ok(content.includes('我的答案') && content.includes('正确答案'), 'Expected answer review')
  console.log('Browser smoke passed: five questions, report, profile, search/filter, review and 320/375/414 screenshots.')
} finally {
  spawnSync(executable, [...options, 'close'], { encoding: 'utf8', timeout: 30000, windowsHide: true })
}
