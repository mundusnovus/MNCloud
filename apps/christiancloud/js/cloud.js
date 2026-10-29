/* SPDX-License-Identifier: AGPL-3.0-only */
(() => {
'use strict';
const start = () => {
 const root = document.getElementById('christian-cloud'); if (!root) return;
 const $ = id => document.getElementById(id), uid = root.dataset.uid;
 const encode = path => path.split('/').map(encodeURIComponent).join('/');
 const dav = '/remote.php/dav/files/' + encodeURIComponent(uid), trashBase = '/remote.php/dav/trashbin/' + encodeURIComponent(uid);
 let folder = '/', trash = false, entries = [], token, loading = 0;
 const say = text => { $('status').textContent = text; };
 const bytes = n => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n / (n >= 1e9 ? 1e9 : n >= 1e6 ? 1e6 : 1e3)) + (n >= 1e9 ? ' GB' : n >= 1e6 ? ' MB' : ' KB');
 async function request(path, options = {}) {
  if (!token) { const r = await fetch('/index.php/csrftoken', { credentials:'same-origin' }); if (!r.ok) throw Error('Sign in again to continue.'); token = (await r.json()).token; }
  const r = await fetch(path, { ...options, credentials:'same-origin', headers:{ requesttoken:token, 'OCS-APIRequest':'true', ...options.headers } });
  if (!r.ok) throw Error(r.status === 507 ? 'There is not enough storage for this file.' : r.status === 412 ? 'A file with that name already exists, or this file changed. Refresh and try again.' : r.status === 401 ? 'Sign in again to continue.' : 'The request failed (' + r.status + '). Your files have not been replaced.');
  return r;
 }
 const xml = text => text.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
 const prop = (node, name) => [...node.getElementsByTagNameNS('*', name)][0]?.textContent || '';
 const props = '<d:displayname/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/><oc:fileid/><oc:size/><d:quota-used-bytes/><d:quota-available-bytes/><nc:trashbin-original-filename/><nc:trashbin-original-location/><nc:trashbin-deletion-time/>';
 async function list() {
  const generation = ++loading; say('Loading…');
  const base = trash ? trashBase + '/trash' : dav + encode(folder);
  const response = await request(base, { method:'PROPFIND', headers:{Depth:'1','Content-Type':'application/xml'}, body:'<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"><d:prop>' + props + '</d:prop></d:propfind>' });
  const doc = new DOMParser().parseFromString(await response.text(), 'application/xml');
  if (doc.querySelector('parsererror')) throw Error('Cloud returned an unreadable folder.');
  if (generation !== loading) return;
  const responses = [...doc.getElementsByTagNameNS('DAV:', 'response')];
  entries = responses.flatMap(node => {
   const href = new URL(prop(node,'href'), location.origin);
   if (href.origin !== location.origin || href.pathname.replace(/\/$/,'') === base.replace(/\/$/,'')) return [];
   const good = [...node.getElementsByTagNameNS('DAV:','propstat')].find(p => / 200 /.test(prop(p,'status'))); if (!good) return [];
   return [{href:href.pathname, name:prop(good,'trashbin-original-filename') || prop(good,'displayname') || decodeURIComponent(href.pathname.replace(/\/$/,'').split('/').pop()), directory:good.getElementsByTagNameNS('DAV:','collection').length > 0, id:prop(good,'fileid'), size:Number(prop(good,'size') || prop(good,'getcontentlength')), modified:prop(good,'getlastmodified'), etag:prop(good,'getetag'), original:prop(good,'trashbin-original-location')}];
  });
  entries.sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name));
  draw(); say(entries.length + (entries.length === 1 ? ' item' : ' items'));
  if (!trash) {
   const r = await request('/ocs/v2.php/cloud/users/' + encodeURIComponent(uid) + '?format=json');
   const q = (await r.json()).ocs?.data?.quota;
   if (q) { $('quota').value = Math.max(0,q.used); $('quota-text').textContent = bytes(q.used) + ' of 3 GB'; }
  }
 }
 function button(text, fn, label) { const b = document.createElement('button'); b.textContent = text; if (label) b.setAttribute('aria-label',label); b.onclick = () => run(fn); return b; }
 function ask(title, label, initial = '', help = '') {
  $('dialog-title').textContent=title; $('dialog-label').textContent=label; $('dialog-input').value=initial; $('dialog-help').textContent=help;
  const dialog=$('dialog'); dialog.returnValue='cancel'; dialog.showModal(); $('dialog-input').focus(); $('dialog-input').select();
  return new Promise(resolve => dialog.addEventListener('close',()=>resolve(dialog.returnValue==='ok' ? $('dialog-input').value.trim() : null), {once:true}));
 }
 function valid(name) { if (!name || name==='.' || name==='..' || /[\/\\\x00-\x1f]/.test(name)) throw Error('Use a name without slashes or control characters.'); return name; }
 async function run(fn) { try { await fn(); } catch(e) { say(e.message); } }
 async function mutate(fn) { await fn(); await list(); }
 function draw() {
  $('rows').replaceChildren(); $('breadcrumbs').replaceChildren();
  $('folder-title').textContent = trash ? 'Trash' : folder==='/' ? 'Your files' : folder.split('/').filter(Boolean).pop();
  $('all-files').setAttribute('aria-current',trash?'false':'page'); $('trash').setAttribute('aria-current',trash?'page':'false');
  $('new-folder').disabled=trash; $('upload').disabled=trash;
  if (!trash) {
   $('breadcrumbs').append(button('Files',()=>{ folder='/'; return list(); }));
   let path='/'; for(const part of folder.split('/').filter(Boolean)) { path+=part+'/'; const target=path; $('breadcrumbs').append(button(part,()=>{folder=target; return list();})); }
  }
  const visible=entries.filter(e=>e.name.toLowerCase().includes($('search').value.toLowerCase())); $('empty').hidden=visible.length>0;
  $('empty').querySelector('h2').textContent=trash?'Nothing in the trash.':$('search').value?'No matching files.':'Room for your work.';
  $('empty').querySelector('p').textContent=trash?'Deleted files appear here.':$('search').value?'Try another name.':'Upload a file or make a folder.';
  for(const e of visible) {
   const row=document.createElement('tr'), name=document.createElement('td'), size=document.createElement('td'), date=document.createElement('td'), actions=document.createElement('td');
   const open=button((e.directory?'▦ ':'▤ ')+e.name,()=>{
    if(trash) return;
    if(e.directory){ folder=decodeURIComponent(e.href.slice(dav.length)).replace(/\/?$/,'/'); return list(); }
    if(/\.(docx?|odt|xlsx?|ods|csv|pptx?|odp|pdf|rtf|txt)$/i.test(e.name) && e.id) location.href='/apps/eurooffice/'+encodeURIComponent(e.id);
    else download(e);
   }); open.className='filename'; if(trash)open.disabled=true; name.append(open);
   size.textContent=e.directory?'Folder':bytes(e.size); const dt=new Date(e.modified); date.textContent=isNaN(dt)?'—':dt.toLocaleDateString();
   if(trash) actions.append(button('Restore',()=>mutate(()=>request(e.href,{method:'MOVE',headers:{Destination:location.origin+trashBase+'/restore/'+e.href.replace(/\/$/,'').split('/').pop(),Overwrite:'F'}})), 'Restore '+e.name));
   else {
    if(!e.directory) actions.append(button('Download',()=>download(e),'Download '+e.name));
    actions.append(button('Rename',async()=>{const n=await ask('Rename','File name',e.name);if(n && n!==e.name) await move(e,folder+valid(n));},'Rename '+e.name));
    actions.append(button('Move',async()=>{const p=await ask('Move','Destination folder','/','Use a folder path, such as /Documents.'); if(p!==null){const parts=p.split('/').filter(Boolean);parts.forEach(valid);await move(e,'/'+parts.join('/')+(parts.length?'/':'')+e.name);}},'Move '+e.name));
    // Share with a person: they find it in their own Cloud and can edit it with you, live, in Christian Office.
    actions.append(button('Share with…',async()=>{
     const who=await ask('Share with a person','Their Christian Systems name','','They can open and edit it with you at the same time. Use their name without the @.');
     if(!who)return;
     const name=who.trim().replace(/^@/,'').toLowerCase();
     const r=await request('/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json',{method:'POST',body:new URLSearchParams({path:decodeURIComponent(e.href.slice(dav.length)),shareType:'0',shareWith:name,permissions:e.directory?'31':'19'})});
     const data=(await r.json()).ocs;
     if(!r.ok||data?.meta?.statuscode>=400)throw Error(/not.*(exist|found)|unknown/i.test(data?.meta?.message||'')?'@'+name+' has not opened Christian Cloud yet. Ask them to sign in once, then share again.':(data?.meta?.message||'Sharing failed.'));
     say('Shared with @'+name+'. They can edit it with you.');
    },'Share '+e.name+' with a person'));
    actions.append(button('Link',async()=>{
     const r=await request('/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json',{method:'POST',body:new URLSearchParams({path:decodeURIComponent(e.href.slice(dav.length)),shareType:'3',permissions:'1'})});
     const data=(await r.json()).ocs; if(!data?.data?.url)throw Error(data?.meta?.message || 'Sharing failed.');
     await ask('Read-only link','Copy this link',data.data.url,'Anyone with this link can read this file. Manage links in the sharing settings.');
    },'Share '+e.name));
    actions.append(button('Trash',async()=>{const answer=await ask('Move to trash','Type the file name', '',e.name+' can be restored later.');if(answer===e.name) await mutate(()=>request(e.href,{method:'DELETE',headers:e.etag?{'If-Match':e.etag}:{}}));},'Move '+e.name+' to trash'));
   }
   row.append(name,size,date,actions); $('rows').append(row);
  }
 }
 const move=(e,path)=>mutate(()=>request(e.href,{method:'MOVE',headers:{Destination:location.origin+dav+encode(path),Overwrite:'F',...(e.etag?{'If-Match':e.etag}:{})}}));
 function download(e){const a=document.createElement('a');a.href=e.href;a.download=e.name;a.click();}
 $('all-files').onclick=()=>run(()=>{trash=false;folder='/';return list();}); $('trash').onclick=()=>run(()=>{trash=true;return list();});
 $('search').oninput=draw;
 $('new-folder').onclick=()=>run(async()=>{const n=await ask('New folder','Folder name');if(n)await mutate(()=>request(dav+encode(folder+valid(n)),{method:'MKCOL'}));});
 $('upload').onchange=()=>run(async()=>{
  const files=[...$('upload').files]; $('progress').hidden=false;$('progress').max=files.length;$('progress').value=0;
  try { for(const file of files){say('Uploading '+file.name+'…');await request(dav+encode(folder+valid(file.name)),{method:'PUT',headers:{'If-None-Match':'*','Content-Type':file.type||'application/octet-stream'},body:file});$('progress').value++;} await list(); }
  finally{$('progress').hidden=true;$('upload').value='';}
 });
 try{root.dataset.theme=localStorage.getItem('cs-theme')||'';}catch{}
 $('theme').onclick=()=>{const dark=root.dataset.theme==='dark'||(!root.dataset.theme&&matchMedia('(prefers-color-scheme:dark)').matches);root.dataset.theme=dark?'light':'dark';try{localStorage.setItem('cs-theme',root.dataset.theme);}catch{}};
 run(list);
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
