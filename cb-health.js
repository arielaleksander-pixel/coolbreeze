/* Coolbreeze · Home / Knowledge Base / Dashboard Health engine (build 2026-11-08.2). Shared by every page; see the Knowledge Base. */
/* ============================================================================================
   HOME / KNOWLEDGE BASE / DASHBOARD HEALTH   (added 2026-11-08, mirrored from Best Plumber's)
   Multi-page version (build 2026-11-08.2): ONE shared engine for index.html, dashboard.html,
   knowledge-base.html and health.html, picked by <body data-cb-page="...">. On the dashboard the
   checks read window directly; on health.html they read a hidden same-origin copy of the dashboard
   (#cbProbe iframe). Home and the Knowledge Base only show the last result (saved in localStorage).
   Own IIFE: reads (never writes) a few top-level globals of the other script blocks —
   ALL_JOBS / isCompletedJob (Jobs), RV_ALL / rvDataReady / rvStatus (Reviews) — plus the
   download log kept by the small #cbFetchLog script in <head> (window.__cbLoadLog).
   Nothing here writes data anywhere.

   Azure files are discovered AT RUNTIME by scanning this page's own <script> text for
   https://<account>.blob.core.windows.net/<container>/<file>?<sas> links, so no token is
   copied into this block and a renewed token / new file is picked up automatically.
   Freshness comes from a HEAD request (Last-Modified), so nothing large is downloaded.
   Differences from Best Plumber's version: no Google Ads conversion section (Cool Breeze has
   no Conversion Monitor); feeds are grouped by source system (ServiceTitan vs QuickBooks)
   instead of by Power Automate flow, since Cool Breeze's automation is not documented yet;
   the live address is whatever host is serving this page (no hard-coded site).
   ============================================================================================ */
(function(){
'use strict';

/* ---------- Settings (change thresholds here) ---------- */
var HC = {
  freshWarnDays: 2,                        // daily feeds: amber after this many days without an update...
  freshBadDays: 4,                         // ...red after this many. [CONFIRM the real ServiceTitan / QuickBooks schedules]
  keyWarnDays: 60, keyBadDays: 14,         // SAS access-key expiry
  reviewsWarnDays: 21, reviewsBadDays: 45, // Windsor.ai reviews: days since the newest review before amber / red
  recheckMs: 10*60*1000,                   // background re-check while the dashboard stays open
  firstCheckMs: 6000,                      // first automatic check, after the dashboard has started loading
  yearlyDue: {month: 0, day: 2},           // "older years" reports are regenerated every January 2
  yearlyLastDone: null                     // set to the year (e.g. 2027) once the January job has been done
};

/* ---------- Which report writes which file ----------
   [regex on the lower-cased file name, area, report, source ('st' | 'qb' | null), kind]
   kind: daily = should refresh every day; lastyear = changes at New Year (not judged for age);
         older = manual yearly snapshot; static = manual file. */
var FEEDS = [
  [/^jobs service titan\.xlsx$/, 'Jobs', 'ServiceTitan · Jobs', 'st', 'daily'],
  [/^jobs service titan previous year\.xlsx$/, 'Jobs · last year', 'ServiceTitan · Jobs (last year)', 'st', 'lastyear'],
  [/^jobs previous prior year\.xlsx$/, 'Jobs · older years', 'ServiceTitan · Jobs (older years)', 'st', 'older'],
  [/^estimates service titan\.xlsx$/, 'Sales (Estimates)', 'ServiceTitan · Estimates', 'st', 'daily'],
  [/^estimates previous year\.xlsx$/, 'Sales · last year', 'ServiceTitan · Estimates (last year)', 'st', 'lastyear'],
  [/^calls service titan\.xlsx$/, 'Marketing · Calls', 'ServiceTitan · Calls', 'st', 'daily'],
  [/^calls previous years?\.xlsx$/, 'Marketing · Calls · last year', 'ServiceTitan · Calls (last year)', 'st', 'lastyear'],
  [/^web booking service titan\.xlsx$/, 'Marketing · Web bookings', 'ServiceTitan · Web Bookings', 'st', 'daily'],
  [/^invoices service titan\.xlsx$/, 'Accounts Receivable / Construction revenue', 'ServiceTitan · Invoices', 'st', 'daily'],
  [/^invoices previous years?\.xlsx$/, 'Invoices · last year', 'ServiceTitan · Invoices (last year)', 'st', 'lastyear'],
  [/^invoices prior previous year\.xlsx$/, 'Invoices · older years', 'ServiceTitan · Invoices (older years)', 'st', 'older'],
  [/^customer list\.xlsx$/, 'Customer Acquisition', 'ServiceTitan · Customer List', 'st', 'daily'],
  [/^memberships\.xlsx$/, 'Memberships / Membership Reconciliation', 'ServiceTitan · Memberships', 'st', 'daily'],
  [/^purchase orders this year\.xlsx$/, 'Bills Reconciliation (ServiceTitan side)', 'ServiceTitan · Purchase Orders', 'st', 'daily'],
  [/^purchase orders last year\.xlsx$/, 'Bills Reconciliation · last year', 'ServiceTitan · Purchase Orders (last year)', 'st', 'lastyear'],
  [/^bills quickbooks\.xlsx$/, 'Bills Reconciliation (QuickBooks side)', 'QuickBooks · Bills', 'qb', 'daily'],
  [/^memberships quickbooks\.xlsx$/, 'Membership Reconciliation (QuickBooks side)', 'QuickBooks · Membership Agreements', 'qb', 'daily']
];
var SRC = {st:'ServiceTitan', qb:'QuickBooks'};
function classify(name){
  var n = String(name).toLowerCase();
  for(var i=0;i<FEEDS.length;i++) if(FEEDS[i][0].test(n)) return {area:FEEDS[i][1], flow:FEEDS[i][2], via:FEEDS[i][3], kind:FEEDS[i][4], known:true};
  if(/previous year|last year|\bpy\.|past year/.test(n)) return {area:'(not in the health list)', flow:null, via:null, kind:'lastyear', known:false};
  if(/prior|up to 20\d\d|20\d\d\.xlsx/.test(n)) return {area:'(not in the health list)', flow:null, via:null, kind:'older', known:false};
  return {area:'(not in the health list)', flow:null, via:null, kind:'static', known:false};
}

/* ---------- tiny helpers ---------- */
var PAGE = (document.body && document.body.getAttribute('data-cb-page')) || 'dashboard';
var NOEL = document.createElement('div');            /* pages that lack an element get this harmless stand-in */
function $(id){ return document.getElementById(id) || NOEL; }
/* The jobs / reviews / download-log data live inside the dashboard page. On the dashboard they are on window;
   on the Health page they are read from a hidden same-origin copy of the dashboard (#cbProbe). */
function HW(){ if(PAGE==='dashboard') return window; try{ var f = document.getElementById('cbProbe'); return (f && f.contentWindow && f.contentWindow.document) ? f.contentWindow : null; }catch(e){ return null; } }
function snap(){ var hw = HW(); try{ return hw && hw.__cbHealthData ? hw.__cbHealthData() : null; }catch(e){ return null; } }
var DASH_KEYS = {jobs:'jobs', sales:'sales', marketing:'marketing', calls:'calls', reviews:'reviews', customers:'customers', memberships:'memberships', bills:'bills', 'membership-recon':'membership-recon', ar:'ar'};
function go(key){
  var map = {home:'index.html', dashboard:'dashboard.html', kb:'knowledge-base.html', health:'health.html'};
  location.href = map[key] || ('dashboard.html#'+(DASH_KEYS[key]||key));
}
function esc(x){ return String(x==null?'':x).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
var RANK = {ok:0, info:0, wait:1, warn:2, bad:3};
function worst(list){ var w='ok'; list.forEach(function(l){ if(l && RANK[l]>RANK[w]) w=l; }); return w; }
var WORD = {ok:'OK', warn:'Look into it', bad:'Problem', info:'Info', wait:'Checking…'};
function chip(level, text){ return '<span class="hl-s '+level+'"><i></i>'+esc(text||WORD[level])+'</span>'; }
function ageTxt(ms){
  var m = Math.round(ms/60000); if(m < 2) return 'just now'; if(m < 90) return m+' min ago';
  var h = Math.round(m/60); if(h < 36) return h+' h ago'; return Math.round(h/24)+' d ago';
}
function dt(d){ return d ? d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '—'; }
function dOnly(d){ return d ? d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'; }
function sizeTxt(b){ if(b==null) return '—'; if(b<1024) return b+' B'; if(b<1048576) return Math.round(b/1024)+' KB'; return (b/1048576).toFixed(1)+' MB'; }
function daysBetween(a,b){ return (b-a)/86400000; }
function kv(k, v, level){ return '<div class="r"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="s">'+(level?chip(level):'')+'</div></div>'; }
function kbLink(id, text){ return '<span class="kb-link" onclick="window.cbOpenKb(\''+id+'\')">'+(text||'What to do →')+'</span>'; }

/* ---------- state ---------- */
var R = null, running = null, retries = 0, lastRunAt = 0, feedFilter = 'all';

/* ---------- running version ---------- */
function runningBuild(){ var m = document.querySelector('meta[name="cb-build"]'); return m ? m.getAttribute('content') : null; }
async function readBuildFrom(resp){
  /* \x22 keeps this pattern from matching its own source text when a published copy has no stamp */
  var re = new RegExp('<meta name=\x22cb-build\x22 content=\x22([^\x22]+)\x22'), buf = '';
  if(resp.body && resp.body.getReader){
    var rd = resp.body.getReader(), dec = new TextDecoder();
    for(var i=0;i<40;i++){ var r = await rd.read(); if(r.done) break; buf += dec.decode(r.value,{stream:true}); if(re.test(buf) || buf.length > 60000) break; }
    try{ rd.cancel(); }catch(e){}
  } else { buf = await resp.text(); }
  var m = re.exec(buf); return m ? m[1] : null;
}

/* ---------- 1. published site + GitHub ---------- */
async function checkSite(){
  var out = {level:'info', rows:[], items:[]};
  var host = location.host, proto = location.protocol, mine = runningBuild();
  var local = proto === 'file:';
  out.rows.push(kv('Address', '<b>'+esc(local?'a local file on this computer':host)+'</b>'+(local?'<br>Opened from a file, so the published copy cannot be checked. Azure downloads can also fail from a local file (no web address for the CORS rule to allow).':''), 'info'));
  var pubLevel = 'info', pubHtml = '', lm = null;
  if(local){
    pubHtml = 'This page was opened from a file, so it cannot be compared with the published copy.';
  } else {
    try{
      var resp = await fetch(location.href.split('#')[0], {cache:'no-store'});
      if(!resp.ok) throw new Error('HTTP '+resp.status);
      var lmh = resp.headers.get('last-modified'); lm = lmh ? new Date(lmh) : null;
      var theirs = await readBuildFrom(resp);
      var etag = resp.headers.get('etag');
      if(!theirs){ pubLevel='warn'; pubHtml = 'The published copy has no version stamp, so it is older than this one (running <b>'+esc(mine||'?')+'</b>). Publish the latest file.'; }
      else if(theirs === mine){ pubLevel='ok'; pubHtml = 'You are running the latest published version: <b>'+esc(mine)+'</b>.'; }
      else { pubLevel='warn'; pubHtml = 'A different version is published (<b>'+esc(theirs)+'</b>) than the one in this browser (<b>'+esc(mine||'?')+'</b>). Press <b>Hard Refresh</b> (Ctrl+Shift+R) to load the published one.'; }
      if(lm) pubHtml += '<br>Live file last changed <b>'+esc(dt(lm))+'</b> ('+ageTxt(Date.now()-lm.getTime())+').';
      else if(etag) pubHtml += '<br>The host does not report a “last modified” time.';
    }catch(e){
      pubLevel = 'bad'; pubHtml = 'Could not read the live site ('+esc(e.message||e)+'). If the site is down, its hosting needs checking.';
    }
  }
  if(!local && PAGE !== 'dashboard'){
    try{
      var rd = await fetch('dashboard.html', {cache:'no-store'});
      if(!rd.ok) throw new Error('HTTP '+rd.status);
      var dv = await readBuildFrom(rd);
      if(dv === mine) pubHtml += '<br>The Executive Dashboard page is the same version.';
      else { pubLevel = 'warn'; pubHtml += '<br>The Executive Dashboard page is version <b>'+esc(dv||'with no stamp')+'</b>, not <b>'+esc(mine||'?')+'</b>. Publish all the files together.'; }
    }catch(e){ pubLevel = 'bad'; pubHtml += '<br>Could not open the Executive Dashboard page (dashboard.html): '+esc(e.message||e)+'. Upload it next to this page.'; }
  }
  out.rows.push(kv('Published version', pubHtml, pubLevel));
  if(!local) out.items.push({group:'Published site', name:'Live site matches this version', level:pubLevel==='info'?'ok':pubLevel, detail:pubHtml.replace(/<[^>]+>/g,''), kb:'kb-publish'});
  out.lm = lm; out.pubLevel = pubLevel;

  /* GitHub (optional) */
  var cfg = {}; try{ cfg = JSON.parse(localStorage.getItem('cb_health_gh')||'{}')||{}; }catch(e){}
  var ghLevel = 'info', ghHtml = '';
  if(!cfg.owner || !cfg.repo){
    ghHtml = 'Not connected. If the dashboard is published from a GitHub repository, enter it to see its latest commit and whether publishing succeeded. <span class="kb-confirm">To confirm</span> where the dashboard is hosted.'
      + ghForm(cfg, true);
  } else {
    try{
      var branch = cfg.branch || 'main';
      var base = '/repos/'+encodeURIComponent(cfg.owner)+'/'+encodeURIComponent(cfg.repo);
      var com = await ghGet(base+'/commits/'+encodeURIComponent(branch), cfg);
      var runs = await ghGet(base+'/actions/runs?branch='+encodeURIComponent(branch)+'&per_page=5', cfg);
      var run = (runs.workflow_runs||[])[0], cdate = new Date(com.commit.committer.date);
      var line1 = '<b>'+esc(cfg.owner+'/'+cfg.repo)+'</b> · branch <b>'+esc(branch)+'</b><br>Latest commit <code>'+esc(com.sha.slice(0,7))+'</code> “'+esc((com.commit.message||'').split('\n')[0].slice(0,90))+'” by '+esc((com.commit.author&&com.commit.author.name)||'?')+', '+ageTxt(Date.now()-cdate.getTime())+'.';
      var line2 = '';
      if(!run){ ghLevel = 'info'; line2 = '<br>No GitHub Actions run found on this branch (fine if the site is not published by an Action).'; }
      else {
        var rdate = new Date(run.updated_at), rtxt = 'Publish run “'+esc(run.display_title||run.name)+'” '+ageTxt(Date.now()-rdate.getTime());
        if(run.status !== 'completed'){ ghLevel='warn'; line2 = '<br>'+rtxt+' is <b>'+esc(run.status)+'</b>. Give it a minute or two.'; }
        else if(run.conclusion === 'success'){
          ghLevel='ok'; line2 = '<br>'+rtxt+': <b>succeeded</b>.';
          if(cdate.getTime() > rdate.getTime() + 15*60000){ ghLevel='warn'; line2 += ' But the latest commit is newer than that run, so it may not be published.'; }
          else if(lm && lm.getTime() < rdate.getTime() - 20*60000){ ghLevel='warn'; line2 += ' The live file looks older than this run (it may be cached, or the site publishes from somewhere else).'; }
        } else { ghLevel='bad'; line2 = '<br>'+rtxt+': <b>'+esc(run.conclusion||'failed')+'</b>. The latest commit did not reach the live site. '+kbLink('kb-trouble','Troubleshooting →'); }
        if(run.path) line2 += '<br><small>Workflow file: '+esc(run.path)+'</small>';
      }
      ghHtml = line1 + line2 + ghForm(cfg, false);
    }catch(e){
      ghLevel = 'warn';
      var why = e.status===404 ? 'GitHub says this repository does not exist, or it is private and needs a read-only token.' : e.status===401 ? 'The token was rejected.' : e.status===403 ? 'GitHub refused the request (rate limit or token permissions).' : 'Could not reach GitHub ('+esc(e.message||e)+').';
      ghHtml = why + ghForm(cfg, false);
    }
  }
  out.rows.push(kv('GitHub repository', ghHtml, ghLevel));
  if(cfg.owner && cfg.repo) out.items.push({group:'Published site', name:'GitHub publish', level:ghLevel==='info'?'ok':ghLevel, detail:ghHtml.replace(/<[^>]+>/g,' ').slice(0,200), kb:'kb-publish'});
  out.ghLevel = ghLevel; out.ghConfigured = !!(cfg.owner && cfg.repo);
  out.level = worst([pubLevel, out.ghConfigured?ghLevel:'ok']);
  return out;
}
async function ghGet(path, cfg){
  var h = {Accept:'application/vnd.github+json'}; if(cfg.token) h.Authorization = 'Bearer '+cfg.token;
  var r = await fetch('https://api.github.com'+path, {headers:h, cache:'no-store'});
  if(!r.ok){ var e = new Error('HTTP '+r.status); e.status = r.status; throw e; }
  return r.json();
}
function ghForm(cfg, first){
  return '<div class="hl-form" id="hlGhForm">'
    + '<input id="hlGhOwner" placeholder="GitHub owner" value="'+esc(cfg.owner||'')+'" aria-label="GitHub owner">'
    + '<input id="hlGhRepo" placeholder="repository" value="'+esc(cfg.repo||'')+'" aria-label="Repository">'
    + '<input id="hlGhBranch" placeholder="branch (main)" value="'+esc(cfg.branch||'')+'" style="min-width:100px" aria-label="Branch">'
    + '<input id="hlGhToken" type="password" placeholder="read-only token (private repo only)" value="'+esc(cfg.token||'')+'" style="min-width:220px" aria-label="Token" autocomplete="off">'
    + '<button type="button" class="hl-btn" data-act="ghsave">'+(first?'Connect':'Save')+'</button>'
    + (first?'':'<button type="button" class="hl-btn ghost" data-act="ghclear">Disconnect</button>')
    + '</div><div class="hl-note" style="margin-top:6px">Saved only in this browser. A token is needed only if the repository is private: create a fine-grained token limited to this one repository with read-only access to Contents and Actions.</div>';
}

/* ---------- 2. Azure feeds ---------- */
function scanFiles(txt, seen, out){
  var re = /https:\/\/([a-z0-9]+)\.blob\.core\.windows\.net\/([^\/\s"'`?\\]+)\/([^\s"'`?\\]+)\?([^\s"'`\\]+)/g, m;
    while((m = re.exec(txt))){
      var name; try{ name = decodeURIComponent(m[3]); }catch(e){ name = m[3]; }
      var key = (m[1]+'/'+m[2]+'/'+name).toLowerCase(); if(seen[key]) continue; seen[key] = 1;
      var se = null; try{ var v = new URLSearchParams(m[4]).get('se'); if(v) se = new Date(v); }catch(e){}
      out.push({name:name, url:m[0], expires:(se && !isNaN(se))?se:null});
    }
}
async function discoverFiles(){
  var seen = {}, out = [];
  Array.prototype.forEach.call(document.scripts, function(s){ if(!s.src && s.textContent) scanFiles(s.textContent, seen, out); });
  if(!out.length && PAGE !== 'dashboard'){
    try{ var r = await fetch('dashboard.html', {cache:'no-store'}); if(r.ok) scanFiles(await r.text(), seen, out); }catch(e){}
  }
  return out;
}
async function probe(url){
  var o = {status:0, ok:false, lm:null, size:null, err:null};
  try{
    var r = await fetch(url, {method:'HEAD', cache:'no-store'});
    o.status = r.status; o.ok = r.ok;
    var lm = r.headers.get('last-modified'); if(lm) o.lm = new Date(lm);
    var cl = r.headers.get('content-length'); if(cl != null) o.size = +cl;
  }catch(e1){
    try{   /* some setups block HEAD: ask for one byte instead */
      var r2 = await fetch(url, {method:'GET', headers:{Range:'bytes=0-0'}, cache:'no-store'});
      o.status = r2.status; o.ok = r2.ok;
      var lm2 = r2.headers.get('last-modified'); if(lm2) o.lm = new Date(lm2);
      var cr = r2.headers.get('content-range'); if(cr && /\/(\d+)$/.test(cr)) o.size = +RegExp.$1;
      try{ await r2.arrayBuffer(); }catch(e){}
    }catch(e2){ o.err = (e2 && e2.message) || 'Failed to fetch'; }
  }
  /* Fallback for the "last updated" time: the Last-Modified header the dashboard's own download saw */
  if(!o.lm){ try{ var bm = window.__blobMeta && window.__blobMeta[url]; if(bm && bm.lastModified){ var d = new Date(bm.lastModified); if(!isNaN(d)) o.lm = d; } }catch(e){} }
  return o;
}
async function pool(items, n, fn){
  var i = 0, res = new Array(items.length);
  await Promise.all(Array.from({length: Math.min(n, items.length)}, async function(){ while(i < items.length){ var k = i++; res[k] = await fn(items[k], k); } }));
  return res;
}
function evalFile(f, p, now){
  var c = classify(f.name), notes = [], levels = [];
  var o = {name:f.name, area:c.area, flow:c.flow, via:c.via, kind:c.kind, known:c.known, status:p.status, lm:p.lm, size:p.size, expires:f.expires, err:p.err};
  if(p.err){ levels.push('bad'); notes.push('Browser could not reach Azure ('+p.err+'). If every file shows this, check the Azure CORS rule or the network.'); o.net = true; }
  else if(!p.ok){
    levels.push('bad');
    notes.push(p.status===403 ? 'HTTP 403: the access key (SAS token) for this file was rejected. Renew it.'
      : p.status===404 ? 'HTTP 404: the file is missing or was renamed. Restore the original name.'
      : 'HTTP '+p.status+' from Azure.');
  } else {
    if(p.size === 0){ levels.push('bad'); notes.push('The file is empty.'); }
    if(p.lm){
      var days = daysBetween(p.lm.getTime(), now); o.ageDays = days;
      if(c.kind === 'daily'){
        if(days > HC.freshBadDays){ levels.push('bad'); notes.push('Not updated for '+Math.floor(days)+' days.'); o.stale = true; }
        else if(days > HC.freshWarnDays){ levels.push('warn'); notes.push('Last update is '+Math.floor(days)+' days old.'); o.stale = true; }
      } else if(c.kind === 'older'){
        var d = new Date(now), y = d.getFullYear(), due = new Date(y, HC.yearlyDue.month, HC.yearlyDue.day);
        if(d > new Date(due.getTime()+8*86400000) && p.lm < due && d.getMonth() === 0){ levels.push('warn'); notes.push('Yearly “older years” update looks missed this January.'); }
      }
    } else if(c.kind === 'daily'){ levels.push('info'); notes.push('Azure did not report a last-modified time.'); }
    if(c.kind === 'lastyear') notes.push('Not judged for age (changes at New Year).');
    if(c.kind === 'static' || c.kind === 'older') if(!notes.length) notes.push('Manual / yearly file: not judged for age.');
  }
  if(f.expires){
    var left = daysBetween(now, f.expires.getTime()); o.keyDays = left;
    if(left < 0){ levels.push('bad'); notes.push('Access key already expired.'); }
    else if(left < HC.keyBadDays){ levels.push('bad'); notes.push('Access key expires in '+Math.ceil(left)+' days.'); }
    else if(left < HC.keyWarnDays){ levels.push('warn'); notes.push('Access key expires in '+Math.ceil(left)+' days.'); }
  }
  o.level = worst(levels); o.notes = notes;
  return o;
}
async function checkFeeds(){
  var files = await discoverFiles(), now = Date.now();
  var probes = await pool(files, 6, function(f){ return probe(f.url); });
  return files.map(function(f,i){ return evalFile(f, probes[i], now); });
}

/* ---------- renderers ---------- */
function paintSite(S){ $('hlSite').innerHTML = '<div class="hl-kv">'+S.rows.join('')+'</div>'; }
function okStatus(r){ return !r.err && (r.status===200||r.status===206); }

function paintFeeds(rows){
  var errs = rows.filter(function(r){ return r.err || (r.status && r.status!==200 && r.status!==206); });
  var fresh = rows.filter(function(r){ return r.kind==='daily' && !r.stale && okStatus(r); }).length;
  var stale = rows.filter(function(r){ return r.stale; }).length;
  var minKey = null; rows.forEach(function(r){ if(r.expires && (!minKey || r.expires<minKey)) minKey = r.expires; });
  var kd = minKey ? daysBetween(Date.now(), minKey.getTime()) : null;
  function tile(l,b,s,cls){ return '<div class="hl-tile '+(cls||'')+'"><small>'+l+'</small><b>'+b+'</b><span>'+s+'</span></div>'; }
  $('hlFeedTiles').innerHTML = '<div class="hl-tiles">'
    + tile('Files checked', rows.length, 'discovered in this page', '')
    + tile('Reachable', (rows.length-errs.length)+' / '+rows.length, errs.length?errs.length+' failing':'all readable from the browser', errs.length?'bad':'ok')
    + tile('Daily feeds fresh', fresh+' / '+(fresh+stale), stale?stale+' stale (over '+HC.freshWarnDays+' days)':'updated within '+HC.freshWarnDays+' days', stale?'warn':'ok')
    + tile('Earliest key expiry', minKey?dOnly(minKey):'—', kd==null?'':(kd<0?'expired':'in '+Math.round(kd)+' days'), kd!=null&&kd<HC.keyBadDays?'bad':kd!=null&&kd<HC.keyWarnDays?'warn':'ok')
    + '</div>';

  /* diagnosis: which source system stopped? */
  function grp(src){ var all = rows.filter(function(r){ return r.via===src && r.kind==='daily' && okStatus(r); }); return {all:all, stale:all.filter(function(r){ return r.stale; }), fresh:all.filter(function(r){ return !r.stale; })}; }
  var st = grp('st'), qb = grp('qb');
  var s403 = rows.filter(function(r){ return r.status===403; }), net = rows.filter(function(r){ return r.net; });
  var d = '';
  if(net.length && net.length >= Math.ceil(rows.length/2)) d = '<div class="hl-diag bad"><span>🚫</span><span><b>This browser cannot read Azure at all</b> ('+net.length+' of '+rows.length+' files). With no error number this usually means the Azure CORS rule changed, the page was opened as a local file, or this computer is offline. '+kbLink('kb-trouble','Troubleshooting →')+'</span></div>';
  else if(s403.length) d = '<div class="hl-diag bad"><span>🔑</span><span><b>'+s403.length+' file'+(s403.length>1?'s are':' is')+' refusing the access key (HTTP 403):</b> '+esc(s403.slice(0,4).map(function(r){return r.name;}).join(', '))+(s403.length>4?' and more':'')+'. Those tabs will be blank. '+kbLink('kb-sas','How to renew a key →')+'</span></div>';
  else if(st.stale.length && qb.stale.length && !st.fresh.length && !qb.fresh.length) d = '<div class="hl-diag bad"><span>⚙️</span><span><b>Both the ServiceTitan and the QuickBooks files are stale.</b> The automation that saves the reports to Azure (or its Azure connection) is probably not running. '+kbLink('kb-mailbox','What to check →')+'</span></div>';
  else if(st.stale.length >= 3 && qb.fresh.length) d = '<div class="hl-diag'+(st.stale.some(function(r){return r.level==='bad';})?' bad':'')+'"><span>📧</span><span><b>'+st.stale.length+' of '+st.all.length+' ServiceTitan feeds are stale while the QuickBooks feeds are fresh.</b> The automation still works, so the ServiceTitan scheduled reports have probably stopped being sent or received (a changed report schedule, address or mailbox login). Check the report schedules in ServiceTitan, then resend them. '+kbLink('kb-mailbox','Step-by-step →')+'</span></div>';
  else if(qb.stale.length && qb.stale.length === qb.all.length && st.fresh.length) d = '<div class="hl-diag'+(qb.stale.some(function(r){return r.level==='bad';})?' bad':'')+'"><span>📒</span><span><b>The QuickBooks feeds are stale while the ServiceTitan feeds are fresh.</b> The QuickBooks scheduled reports have probably stopped. Until they are fixed, Bills and Membership Reconciliation will show differences that are not real. '+kbLink('kb-mailbox','What to check →')+'</span></div>';
  else if(st.stale.length || qb.stale.length){ var sl = st.stale.concat(qb.stale); d = '<div class="hl-diag"><span>📧</span><span><b>'+sl.length+' feed'+(sl.length>1?'s have':' has')+' not updated recently:</b> '+esc(sl.map(function(r){return r.name;}).join(', '))+'. If the report was simply not sent, nothing is wrong with the dashboard. '+kbLink('kb-mailbox','What to check →')+'</span></div>'; }
  $('hlFeedDiag').innerHTML = d;

  var list = rows.slice().sort(function(a,b){ return (RANK[b.level]-RANK[a.level]) || String(a.area).localeCompare(String(b.area)) || a.name.localeCompare(b.name); });
  if(feedFilter === 'attn') list = list.filter(function(r){ return r.level==='bad' || r.level==='warn'; });
  var h = '<thead><tr><th>Status</th><th>File</th><th>Used by</th><th>Report</th><th>Last updated</th><th class="n">Size</th><th>Key expires</th></tr></thead><tbody>';
  if(!list.length) h += '<tr><td colspan="7" style="text-align:center;color:var(--ink-soft);padding:18px">Nothing needs attention.</td></tr>';
  list.forEach(function(r){
    var upd = r.lm ? dt(r.lm)+'<small>'+ageTxt(Date.now()-r.lm.getTime())+'</small>' : (r.err||r.status>=400 ? '—' : 'not reported');
    var key = r.expires ? dOnly(r.expires)+(r.keyDays!=null && r.keyDays<HC.keyWarnDays?'<small>in '+Math.max(0,Math.ceil(r.keyDays))+' days</small>':'') : '—';
    h += '<tr><td>'+chip(r.level)+'</td><td><b>'+esc(r.name)+'</b>'+(r.notes.length?'<small>'+esc(r.notes.join(' '))+'</small>':'')+'</td><td>'+esc(r.area)+'</td><td>'+(r.flow?esc(r.flow)+'<small>'+esc(SRC[r.via]||'')+' scheduled report</small>':'—')+'</td><td class="mono">'+upd+'</td><td class="n">'+sizeTxt(r.size)+'</td><td class="mono">'+key+'</td></tr>';
  });
  $('hlFeedTbl').innerHTML = h+'</tbody>';
}

function paintFlows(rows){
  var by = {};
  rows.forEach(function(r){ if(!r.flow) return; var k = r.flow; (by[k] = by[k] || {flow:k, via:r.via, files:[], newest:null, kinds:{}}); var g = by[k]; g.files.push(r); g.kinds[r.kind]=1; if(r.lm && (!g.newest || r.lm > g.newest)) g.newest = r.lm; });
  var arr = Object.keys(by).map(function(k){ return by[k]; });
  arr.forEach(function(g){
    var judged = g.kinds.daily; g.level = 'info'; g.msg = g.kinds.older ? 'Not judged (fixed snapshot, updated by hand every January)' : 'Not judged (changes at New Year)';
    if(judged){
      var fs = g.files.filter(function(f){ return f.kind==='daily' && f.lm; });
      if(!fs.length){ g.level = 'info'; g.msg = 'Cannot tell: its file could not be read (see section 2)'; }
      else {
        var lv = worst(fs.map(function(f){ return f.stale ? f.level : 'ok'; })); g.level = lv;
        g.msg = lv==='ok' ? 'Written within the last '+HC.freshWarnDays+' days' : lv==='warn' ? 'Not written for over '+HC.freshWarnDays+' days' : 'Not written for over '+HC.freshBadDays+' days';
      }
    }
  });
  arr.sort(function(a,b){ return (RANK[b.level]-RANK[a.level]) || a.flow.localeCompare(b.flow); });
  var h = '<thead><tr><th>Status</th><th>Report</th><th>Source</th><th>Writes</th><th>Last write</th><th>Reading</th></tr></thead><tbody>';
  arr.forEach(function(g){
    h += '<tr><td>'+chip(g.level)+'</td><td><b>'+esc(g.flow)+'</b></td><td>'+esc(SRC[g.via]||'—')+'</td><td>'+esc(g.files.map(function(f){return f.name;}).join(', '))+'</td><td class="mono">'+(g.newest?dt(g.newest)+'<small>'+ageTxt(Date.now()-g.newest.getTime())+'</small>':'—')+'</td><td>'+esc(g.msg)+'</td></tr>';
  });
  $('hlFlowTbl').innerHTML = h+'</tbody>';
  return arr;
}

/* ---------- 4. live data ---------- */
function checkLive(){
  var items = [], rows = [];
  /* header badge */
  var hw = HW(), b = null; try{ b = hw ? hw.document.getElementById('lastUpdated') : null; }catch(e){}
  var bt = b ? String(b.textContent||'').trim() : '';
  var bl = !b ? 'wait' : /^✓/.test(bt) ? 'ok' : /^⚠/.test(bt) ? 'bad' : /^⚡/.test(bt) ? 'info' : 'wait';
  if(bl==='wait' && performance.now() > 90000) bl = 'warn';
  if(!hw && PAGE !== 'dashboard'){ bl = performance.now() > 60000 ? 'bad' : 'wait'; bt = bl==='bad' ? 'The background copy of the dashboard did not open.' : 'Opening the dashboard in the background…'; }   /* still "Loading…" after 90 s: the first load stalled or failed (see Downloads below) */
  rows.push(kv('Main data load (top bar)', '<b>'+esc(bt||'—')+'</b>'+(bl==='bad'&&b&&b.title?'<br><small>'+esc(b.title)+'</small>':''), bl));
  items.push({group:'Live data', name:'Main data load', level:bl==='info'?'ok':bl, detail:bt, kb:'kb-trouble'});
  /* downloads this session */
  var log = (hw && hw.__cbLoadLog) || [], latest = {};
  log.forEach(function(x){ latest[x.file] = x; });                       /* judge each file by its most recent attempt */
  var names = Object.keys(latest), failed = names.filter(function(k){ return !latest[k].ok; }).map(function(k){ return latest[k]; });
  var dl = !names.length ? 'wait' : failed.length >= 4 ? 'bad' : failed.length ? 'warn' : 'ok';
  rows.push(kv('Downloads this session', names.length ? '<b>'+(names.length-failed.length)+' of '+names.length+'</b> data sources loaded'+(failed.length?'. Did not load: <b>'+esc(failed.slice(0,6).map(function(x){return x.file+(x.status?' ('+x.status+')':'');}).join(', '))+'</b>'+(failed.length>6?' and more':'')+'. An optional prior-year file can fail without anything being wrong; several at once is a problem.':'.') : 'No downloads recorded yet.', dl));
  items.push({group:'Live data', name:'Data downloads this session', level:dl, detail:failed.length?failed.length+' failed: '+failed.slice(0,4).map(function(x){return x.file;}).join(', '):'', kb:'kb-trouble'});
  /* newest completed job */
  var jl = 'wait', jt = 'Jobs have not loaded yet.';
  try{
    var SN = snap();
    if(SN && SN.jobs){
      var m = SN.newestCompleted || '';
      if(m){ var age = daysBetween(new Date(m+'T12:00:00').getTime(), Date.now()); jl = age <= 2 ? 'ok' : age <= 4 ? 'warn' : 'bad'; jt = 'Newest completed job is <b>'+esc(m)+'</b> ('+Math.max(0,Math.floor(age))+' days ago) among '+SN.jobs.toLocaleString()+' jobs.'; }
      else { jl = 'warn'; jt = 'No completed jobs found in the loaded data.'; }
    } else if(performance.now() > 90000){ jl = 'bad'; jt = 'Jobs still have not loaded. Check “Jobs Service Titan.xlsx” in section 2.'; }
  }catch(e){ jl = 'info'; jt = 'Could not read the jobs list.'; }
  rows.push(kv('Newest completed job', jt, jl));
  items.push({group:'Live data', name:'Newest completed job', level:jl==='info'?'ok':jl, detail:jt.replace(/<[^>]+>/g,''), kb:'kb-weekly'});
  /* Windsor.ai Google reviews */
  var rl = 'wait', rt = 'The Reviews feed has not started loading.';
  try{
    var SR = snap() || {};
    var st = String(SR.rvStatus||''), ready = !!SR.rvReady, nRv = SR.reviews||0;
    if(!SR.loaded){ st = ''; ready = false; }
    if(/^Failed/.test(st)){ rl = 'bad'; rt = 'Feed failed: '+esc(st.replace(/^Failed:\s*/,''))+'. The Reviews tab will be empty.'; }
    else if(!ready){ rl = performance.now() > 90000 ? 'warn' : 'wait'; rt = rl==='warn' ? 'Still not loaded after 90 seconds.' : 'Still loading…'; }
    else if(!nRv){ rl = 'warn'; rt = 'The feed answered but returned no reviews.'; }
    else {
      var nd = SR.newestReview || '';
      var ag = nd ? daysBetween(new Date(nd+'T12:00:00').getTime(), Date.now()) : null;
      rl = ag==null ? 'info' : ag > HC.reviewsBadDays ? 'bad' : ag > HC.reviewsWarnDays ? 'warn' : 'ok';
      rt = nRv.toLocaleString()+' reviews · newest <b>'+esc(nd||'—')+'</b>'+(ag!=null?' ('+Math.max(0,Math.floor(ag))+' days ago)':'')+'. A long gap can just mean no new reviews; if Google shows newer ones, reconnect Windsor.ai.';
    }
  }catch(e){ rl = 'info'; rt = 'Could not read the reviews feed.'; }
  /* Windsor.ai Google Ads spend */
  var gl='wait', gt='The Google Ads feed has not started loading.';
  try{
    var GS=snap()||{};
    if(GS.spendOk){ var gn=GS.spendNewest||''; var ga=gn ? daysBetween(new Date(gn+'T12:00:00').getTime(), Date.now()) : null; gl=ga==null?'info':ga>7?'bad':ga>3?'warn':'ok'; gt=(GS.spendRows||0).toLocaleString()+' rows · newest day <b>'+esc(gn||'—')+'</b>'+(ga!=null?' ('+Math.max(0,Math.floor(ga))+' days ago)':'')+'.'; }
    else if(/^Failed/.test(GS.spendStatus||'')){ gl='bad'; gt='Feed failed: '+esc(String(GS.spendStatus).replace(/^Failed:\s*/,''))+'. Marketing Spend, ROAS and Cost per Lead show —.'; }
    else if(performance.now()>90000){ gl='warn'; gt='Still not loaded after 90 seconds.'; }
  }catch(e){ gl='info'; gt='Could not read the Google Ads feed.'; }
  rows.push(kv('Google Ads spend (Windsor.ai)', gt+(gl==='bad'||gl==='warn'?' '+kbLink('kb-trouble','What to do →'):''), gl));
  items.push({group:'Live data', name:'Google Ads spend (Windsor.ai)', level:gl==='info'?'ok':gl, detail:gt.replace(/<[^>]+>/g,''), kb:'kb-trouble'});
  /* Windsor.ai QuickBooks marketing expenses */
  var ql='wait', qt='The QuickBooks marketing-expense feed has not started loading.';
  try{
    var QS=snap()||{};
    if(QS.qbOk){ var qn=QS.qbNewest||''; var qa=qn ? daysBetween(new Date(qn+'T12:00:00').getTime(), Date.now()) : null; ql=qa==null?'info':qa>60?'warn':'ok'; qt=(QS.qbRows||0).toLocaleString()+' expenses · newest <b>'+esc(qn||'—')+'</b>'+(qa!=null?' ('+Math.max(0,Math.floor(qa))+' days ago)':'')+'.'+(QS.qbSkipped?' '+QS.qbSkipped+' Google Ads …1656 charges left out (already counted from the Google Ads feed).':'')+(ql==='warn'?' Marketing charges are usually monthly; check that QuickBooks is up to date.':''); }
    else if(/^Failed/.test(QS.qbStatus||'')){ ql='bad'; qt='Feed failed: '+esc(String(QS.qbStatus).replace(/^Failed:\s*/,''))+'. Hibu, JD Marketing and other QuickBooks marketing spend is missing from Marketing Spend.'; }
    else if(performance.now()>90000){ ql='warn'; qt='Still not loaded after 90 seconds.'; }
  }catch(e){ ql='info'; qt='Could not read the QuickBooks marketing-expense feed.'; }
  rows.push(kv('QuickBooks marketing expenses (Windsor.ai)', qt+(ql==='bad'||ql==='warn'?' '+kbLink('kb-trouble','What to do →'):''), ql));
  items.push({group:'Live data', name:'QuickBooks marketing expenses (Windsor.ai)', level:ql==='info'?'ok':ql, detail:qt.replace(/<[^>]+>/g,''), kb:'kb-trouble'});
  /* Windsor.ai Google Business Profile traffic */
  var bl2='wait', bt2='The Google Business Profile feed has not started loading.';
  try{
    var BS=snap()||{};
    if(BS.gmbOk){ var bn=BS.gmbNewest||''; var ba=bn ? daysBetween(new Date(bn+'T12:00:00').getTime(), Date.now()) : null; bl2=ba==null?'warn':ba>10?'warn':'ok'; bt2=(BS.gmbRows||0).toLocaleString()+' days · newest day with clicks or views <b>'+esc(bn||'—')+'</b>'+(ba!=null?' ('+Math.max(0,Math.floor(ba))+' days ago). Google reports this with a few days of delay.':'.'); }
    else if(/^Failed/.test(BS.gmbStatus||'')){ bl2='bad'; bt2='Feed failed: '+esc(String(BS.gmbStatus).replace(/^Failed:\s*/,''))+'. Organic impressions and clicks are missing from the journey and ROI table.'; }
    else if(performance.now()>90000){ bl2='warn'; bt2='Still not loaded after 90 seconds.'; }
  }catch(e){ bl2='info'; bt2='Could not read the Google Business Profile feed.'; }
  rows.push(kv('Google Business Profile (Windsor.ai)', bt2+(bl2==='bad'||bl2==='warn'?' '+kbLink('kb-trouble','What to do →'):''), bl2));
  items.push({group:'Live data', name:'Google Business Profile (Windsor.ai)', level:bl2==='info'?'ok':bl2, detail:bt2.replace(/<[^>]+>/g,''), kb:'kb-trouble'});
  rows.push(kv('Google reviews (Windsor.ai)', rt+(rl==='bad'||rl==='warn'?' '+kbLink('kb-trouble','What to do →'):''), rl));
  items.push({group:'Live data', name:'Google reviews (Windsor.ai)', level:rl==='info'?'ok':rl, detail:rt.replace(/<[^>]+>/g,''), kb:'kb-trouble'});
  return {rows:rows, items:items, reviewsLevel:rl};
}

/* ---------- 5. what expires ---------- */
function paintExpire(rows){
  var withKey = rows.filter(function(r){ return r.expires; }).sort(function(a,b){ return a.expires-b.expires; });
  var first = withKey[0], out = [], items = [];
  if(first){
    var left = daysBetween(Date.now(), first.expires.getTime()), lv = left < HC.keyBadDays ? 'bad' : left < HC.keyWarnDays ? 'warn' : 'ok';
    var soonest = withKey.slice(0,3).map(function(r){ return esc(r.name)+' ('+dOnly(r.expires)+')'; }).join('; ');
    out.push(kv('Access keys (SAS tokens)', 'Earliest expiry: <b>'+dOnly(first.expires)+'</b> ('+(left<0?'already expired':'in '+Math.round(left)+' days')+'). Soonest: '+soonest+'. Renew at least 30 days before. '+kbLink('kb-sas','How to renew →'), lv));
    items.push({group:'Expiry', name:'Earliest access-key expiry', level:lv, detail:dOnly(first.expires), kb:'kb-sas'});
  } else out.push(kv('Access keys (SAS tokens)', 'No expiry dates could be read.', 'info'));
  var now = new Date(), y = now.getFullYear(), due = new Date(y, HC.yearlyDue.month, HC.yearlyDue.day); if(due < now) due = new Date(y+1, HC.yearlyDue.month, HC.yearlyDue.day);
  var dd = Math.ceil(daysBetween(now.getTime(), due.getTime())), inWin = (now.getMonth()===0 && now.getDate()<=31);
  var notDone = !HC.yearlyLastDone || HC.yearlyLastDone < y;
  var yl = (inWin && notDone) ? 'warn' : dd <= 30 ? 'warn' : 'ok';
  out.push(kv('Yearly “older years” reports', 'Next due <b>'+dOnly(due)+'</b> (in '+dd+' days): Jobs Previous Prior Year and Invoices Prior Previous Year. '+(HC.yearlyLastDone?'Last recorded as done in <b>January '+HC.yearlyLastDone+'</b>.':'Not recorded as done yet.')+(inWin && notDone?' <b>It is January: this year’s update has not been recorded.</b>':'')+' '+kbLink('kb-yearly','Checklist →'), yl));
  items.push({group:'Expiry', name:'Yearly older-years update', level:yl, detail:'Next due '+dOnly(due), kb:'kb-yearly'});
  out.push(kv('Report automation connection', 'Cannot be read from here. If several files in section 2 go stale together, this is the first thing to check. '+kbLink('kb-mailbox','What to do →'), 'info'));
  out.push(kv('Windsor.ai connection', 'Read through section 4: if the newest review stops moving while Google shows newer ones, reconnect it.', 'info'));
  $('hlExpire').innerHTML = '<div class="hl-kv">'+out.join('')+'</div>';
  return items;
}

/* ---------- summary + home pill + KB node dots ---------- */
function summarize(items){
  var c = {bad:0, warn:0, ok:0, info:0, wait:0};
  items.forEach(function(i){ c[i.level] = (c[i.level]||0) + 1; });
  var lvl = c.bad ? 'bad' : c.warn ? 'warn' : c.wait ? 'wait' : 'ok';
  return {counts:c, level:lvl};
}
function paintSummary(items, S){
  var c = S.counts, t, p;
  if(S.level==='bad'){ t = c.bad+' problem'+(c.bad>1?'s':'')+' need'+(c.bad>1?'':'s')+' attention'; p = 'Something behind the dashboard is not working. Details are listed below.'; }
  else if(S.level==='warn'){ t = c.warn+' item'+(c.warn>1?'s':'')+' to look into'; p = 'Nothing is broken, but something is getting old or close to expiring.'; }
  else if(S.level==='wait'){ t = 'Checking…'; p = 'Some data is still loading. This page re-checks automatically.'; }
  else { t = 'Everything checked is live and working'; p = 'All data feeds, publishing and reviews checks passed.'; }
  var attn = items.filter(function(i){ return i.level==='bad' || i.level==='warn'; }).sort(function(a,b){ return RANK[b.level]-RANK[a.level]; });
  var list = '';
  if(attn.length){
    list = '<div class="hl-attn"><h4>Needs attention</h4><ul style="margin:0;padding:0">' + attn.slice(0,8).map(function(i){
      return '<li>'+chip(i.level)+'<span><b>'+esc(i.group)+' · '+esc(i.name)+'</b> <span class="d">'+esc(String(i.detail||'').slice(0,170))+'</span> '+(i.kb?kbLink(i.kb):'')+'</span></li>';
    }).join('') + (attn.length>8 ? '<li><span class="d">…and '+(attn.length-8)+' more in the sections below.</span></li>' : '') + '</ul></div>';
  }
  $('hlSummary').innerHTML = '<div class="hl-banner '+S.level+'"><span class="hl-dot '+S.level+'" style="width:16px;height:16px"></span><div><h2>'+esc(t)+'</h2><p>'+esc(p)+' Checked '+esc(dt(new Date(R.at)))+'.</p></div>'
    + '<div class="hl-counts"><div class="hl-count bad"><b>'+c.bad+'</b><small>Problems</small></div><div class="hl-count warn"><b>'+c.warn+'</b><small>To look into</small></div><div class="hl-count ok"><b>'+(c.ok+c.info)+'</b><small>OK</small></div></div></div>' + list;
  $('hlFinfo').textContent = 'Checked '+dt(new Date(R.at))+' · '+items.length+' checks';
}
function paintHome(S){
  var dot = $('hmDot'), tx = $('hmHealthText');
  var c = S.counts, at = S.at || (R && R.at) || Date.now();
  dot.className = 'hl-dot '+(S.level==='wait'?'wait':S.level);
  tx.innerHTML = S.level==='bad' ? '<b>'+c.bad+' problem'+(c.bad>1?'s':'')+'</b> found in the data feeds'
    : S.level==='warn' ? '<b>'+c.warn+' item'+(c.warn>1?'s':'')+'</b> to look into'
    : S.level==='wait' ? 'Checking the data feeds…'
    : '<b>All data feeds are live</b> · checked '+new Date(at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  var nav = $('hlNavDot'); if(nav) nav.className = 'hl-dot hl-navdot '+(S.level==='wait'?'wait':S.level);
}
function paintNodes(nodes){
  document.querySelectorAll('[data-hlnode]').forEach(function(el){ var l = nodes[el.getAttribute('data-hlnode')] || 'wait'; el.className = 'hl-dot '+(l==='info'?'ok':l); el.title = {ok:'Working',warn:'Look into it',bad:'Problem',wait:'Checking…'}[l==='info'?'ok':l]||''; });
}

/* ---------- run everything ---------- */
function run(){
  if(running) return running;
  running = (async function(){
    var btn = $('hlRunBtn'); if(btn){ btn.disabled = true; btn.textContent = '↻ Checking…'; }
    try{
      var results = await Promise.all([checkSite(), checkFeeds()]);
      var S = results[0], rows = results[1];
      var items = [].concat(S.items);
      /* One item per distinct problem: a stale file is reported through its report (section 3); a total outage is one item, not 17. */
      var netCount = rows.filter(function(r){ return r.net; }).length, allNet = netCount >= Math.ceil(rows.length/2);
      if(allNet) items.push({group:'Azure feeds', name:'Azure storage reachable', level:'bad', detail:netCount+' of '+rows.length+' files could not be reached from this browser (Azure CORS rule, a local file, or the network).', kb:'kb-trouble'});
      rows.forEach(function(r){
        if(allNet && r.net) return;
        if(r.stale && r.flow) return;
        var nt = r.notes.join(' ');
        items.push({group:'Azure feeds', name:r.name, level:r.level==='info'?'ok':r.level, detail:nt, kb:/403|access key/.test(nt)?'kb-sas':/missing|404/.test(nt)?'kb-trouble':'kb-mailbox'});
      });
      paintSite(S); paintFeeds(rows);
      var flows = paintFlows(rows);
      flows.forEach(function(g){ if(g.level==='bad' || g.level==='warn') items.push({group:'Reports', name:g.flow, level:g.level, detail:g.msg, kb:'kb-mailbox'}); else items.push({group:'Reports', name:g.flow, level:'ok', detail:g.msg}); });
      var live = checkLive(); $('hlLive').innerHTML = '<div class="hl-kv">'+live.rows.join('')+'</div>'; items = items.concat(live.items);
      items = items.concat(paintExpire(rows));
      R = {at:Date.now(), items:items, rows:rows, site:S, live:live, flows:flows};
      var sm = summarize(items); R.summary = sm;
      paintSummary(items, sm); paintHome(sm);
      try{ localStorage.setItem('cb_health_snap', JSON.stringify({level:sm.level, counts:sm.counts, at:R.at})); }catch(e){}
      /* diagram dots in the Knowledge Base */
      function srcLevel(src){ var d = rows.filter(function(r){ return r.via===src && r.kind==='daily'; }); if(!d.length) return 'info'; var bad = d.filter(function(r){ return r.stale && r.level==='bad'; }).length; return bad >= Math.max(1, Math.ceil(d.length/3)) ? 'bad' : d.some(function(r){ return r.stale; }) ? 'warn' : 'ok'; }
      R.nodes = {st:srcLevel('st'), qb:srcLevel('qb'), flows:worst(flows.map(function(g){return g.level;})), azure:rows.some(function(r){return r.err||(r.status&&r.status>=400);})?'bad':'ok', site:S.pubLevel, github:S.ghConfigured?S.ghLevel:'info', windsor:live.reviewsLevel}; paintNodes(R.nodes);
      try{ localStorage.setItem('cb_health_snap', JSON.stringify({level:sm.level, counts:sm.counts, at:R.at, nodes:R.nodes})); }catch(e){}
      lastRunAt = Date.now();
      if(sm.counts.wait && retries < 8){ retries++; setTimeout(function(){ run(); }, 15000); } else if(!sm.counts.wait){ retries = 0; }
    }catch(e){
      console.error('[Health] check failed', e);
      var f = $('hlFinfo'); if(f) f.textContent = 'Check failed: '+(e.message||e);
    }finally{
      var b2 = $('hlRunBtn'); if(b2){ b2.disabled = false; b2.textContent = '↻ Run checks now'; }
      running = null;
    }
  })();
  return running;
}

/* ---------- Knowledge Base ---------- */
function openKb(id){
  if(PAGE !== 'kb'){ location.href = 'knowledge-base.html#'+id; return; }
  var el = $(id); if(el === NOEL) return;
  var s = $('kbSearch'); if(s && s.value){ s.value=''; kbFilter(''); }
  if(el.tagName === 'DETAILS') el.open = true;
  el.scrollIntoView({behavior:'smooth', block:'start'});
  try{ history.replaceState(null, '', '#'+id); }catch(e){}
  document.querySelectorAll('#kbToc a').forEach(function(a){ a.classList.toggle('on', a.getAttribute('data-id')===id); });
}
function kbFilter(q){
  q = (q||'').trim().toLowerCase();
  var secs = Array.prototype.slice.call(document.querySelectorAll('.kb-sec')), n = 0;
  secs.forEach(function(s){
    var hit = !q || s.textContent.toLowerCase().indexOf(q) >= 0;
    s.style.display = hit ? '' : 'none'; if(hit && q) s.open = true; if(hit) n++;
    var a = document.querySelector('#kbToc a[data-id="'+s.id+'"]'); if(a) a.style.display = hit ? '' : 'none';
  });
  $('kbCount').textContent = q ? n+' of '+secs.length+' sections match' : '';
  $('kbNone').style.display = n ? 'none' : '';
}
function initKb(){
  var toc = $('kbToc'); if(toc === NOEL || toc.querySelector('a')) return;
  document.querySelectorAll('.kb-sec').forEach(function(s){
    var a = document.createElement('a'); a.setAttribute('data-id', s.id);
    a.textContent = s.querySelector('summary').textContent.replace(/^\d+/, '').trim();
    a.addEventListener('click', function(){ openKb(s.id); });
    toc.appendChild(a);
  });
  $('kbSearch').addEventListener('input', function(){ kbFilter(this.value); });
  $('kbExpand').addEventListener('click', function(){ document.querySelectorAll('.kb-sec').forEach(function(s){ if(s.style.display!=='none') s.open = true; }); });
  $('kbCollapse').addEventListener('click', function(){ document.querySelectorAll('.kb-sec').forEach(function(s){ s.open = false; }); });
}

/* ---------- wiring ---------- */
window.cbOpenKb = openKb;
window.cbHealth = {run:run, results:function(){ return R; }, discover:discoverFiles, classify:classify};
window.cbGo = go;

document.addEventListener('click', function(e){
  var t = e.target; if(!t || !t.closest) return;
  var f = t.closest('#hlFeedFilter button');
  if(f){ feedFilter = f.getAttribute('data-f'); document.querySelectorAll('#hlFeedFilter button').forEach(function(b){ b.classList.toggle('on', b===f); }); if(R) paintFeeds(R.rows); return; }
  var a = t.closest('[data-act]'); if(!a) return;
  if(a.getAttribute('data-act') === 'ghsave'){
    var cfg = {owner:($('hlGhOwner').value||'').trim(), repo:($('hlGhRepo').value||'').trim(), branch:($('hlGhBranch').value||'').trim(), token:($('hlGhToken').value||'').trim()};
    try{ localStorage.setItem('cb_health_gh', JSON.stringify(cfg)); }catch(err){}
    run();
  } else if(a.getAttribute('data-act') === 'ghclear'){
    try{ localStorage.removeItem('cb_health_gh'); }catch(err){}
    run();
  }
});
function paintSnap(){
  var sn = null; try{ sn = JSON.parse(localStorage.getItem('cb_health_snap')||'null'); }catch(e){}
  var dot = $('hmDot'), tx = $('hmHealthText'), nav = $('hlNavDot');
  var none = function(msg){ dot.className = 'hl-dot wait'; nav.className = 'hl-dot hl-navdot wait'; tx.innerHTML = msg; };
  if(!sn || !sn.at) return none('Not checked yet in this browser. <b>Open Dashboard Health</b> to run the checks.');
  var age = Date.now() - sn.at;
  if(age > 60*60000) return none('Last checked <b>'+esc(ageTxt(age))+'</b>. Open Dashboard Health to check again.');
  paintHome(sn); if(sn.nodes) paintNodes(sn.nodes);
}
function mountProbe(){
  if(document.getElementById('cbProbe')) return;
  var f = document.createElement('iframe'); f.id = 'cbProbe'; f.src = 'dashboard.html?cbprobe=1'; f.setAttribute('aria-hidden','true'); f.tabIndex = -1;
  f.style.cssText = 'position:absolute;left:-9999px;top:0;width:1280px;height:800px;border:0;visibility:hidden';
  document.body.appendChild(f);
}
document.addEventListener('DOMContentLoaded', function(){
  var rb = $('hlRunBtn'); if(rb !== NOEL) rb.addEventListener('click', function(){ retries = 0; run(); });
  var v = $('hmVer'); v.textContent = runningBuild() || '—';
  var cv = $('cbVer'); cv.textContent = 'v'+(runningBuild()||'—');
  if(PAGE === 'kb'){ initKb(); if(location.hash.length > 1) setTimeout(function(){ openKb(decodeURIComponent(location.hash.slice(1))); }, 60); }
  if(PAGE === 'home' || PAGE === 'kb') paintSnap();
  var auto = (PAGE === 'dashboard' && window.top === window) || PAGE === 'health';
  if(PAGE === 'health') mountProbe();
  if(auto){
    setTimeout(function(){ run(); }, PAGE === 'health' ? 1500 : HC.firstCheckMs);
    setInterval(function(){ if(document.visibilityState === 'visible') run(); }, HC.recheckMs);
  }
});
})();
