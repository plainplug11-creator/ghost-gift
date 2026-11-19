import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:4173/ghost-gift/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'ru-RU' });
const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
await p.addInitScript(() => localStorage.setItem('gg.onb', '1'));
await p.goto(BASE + '?tier=high&push=case:ghost&autoopen=1&force=cup', { waitUntil: 'load' });
await p.waitForSelector('.op.is-reel', { timeout: 20000 });
if (process.env.CSS) await p.addStyleTag({ content: process.env.CSS });
await p.waitForTimeout(800);
let layers = [];
const FN = `function(){const e=this.nodeType===1?this:this.parentElement; const r=e&&e.closest('.op-row'); if(!r) return ''; const t=e.closest('.tile'); return r.className+' #'+[...r.children].indexOf(t);}`;
cdp.on('LayerTree.layerTreeDidChange', (e) => { if (e.layers) layers = e.layers; });
await cdp.send('DOM.enable'); await cdp.send('LayerTree.enable');
await p.waitForTimeout(500);
const rows = [];
for (const l of layers) { if (!l.drawsContent) continue; let name = ''; if (l.backendNodeId) { try { const d = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId }); const n = d.node; name = n.localName + (n.attributes ? '.' + (n.attributes[n.attributes.indexOf('class') + 1] || '').split(' ').slice(0, 3).join('.') : ''); const o = await cdp.send('DOM.resolveNode', { backendNodeId: l.backendNodeId }); const r = await cdp.send('Runtime.callFunctionOn', { objectId: o.object.objectId, functionDeclaration: FN, returnByValue: true }); name += ' <' + (r.result.value||'') + '>'; } catch {} }
  let why=''; try { why=(await cdp.send('LayerTree.compositingReasons',{layerId:l.layerId})).compositingReasonIds.join(','); } catch {}
  rows.push([Math.round(l.width * l.height / 1000), `${Math.round(l.width)}x${Math.round(l.height)}`, name, why]); }
rows.sort((a, c) => c[0] - a[0]);
console.log('layers drawing:', rows.length, 'total kpx', rows.reduce((s, r) => s + r[0], 0));
const by={}; for (const r of rows){const k=r[2].split('.').slice(0,2).join('.')+' | '+r[3]; by[k]=(by[k]||0)+1;} console.log(Object.entries(by).sort((a,c)=>c[1]-a[1]).slice(0,40).map(([k,v])=>v+'  '+k).join('\n'));
console.log(rows.filter(r=>r[2].includes('op-sharp')).sort((a,c)=>(parseInt(a[2].split('#')[1]))-(parseInt(c[2].split('#')[1]))).slice(0,12).map(r=>r.join('  ')).join('\n'));console.log(rows.slice(0, 0).map((r) => r.join('  ')).join('\n'));
await b.close();
