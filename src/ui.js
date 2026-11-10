export default `<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Histree Mailflow</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap" rel=stylesheet>
<style>
:root{--bg:#0d1110;--panel:#151b19;--line:#25312b;--text:#e8efe9;--mut:#8b9b91;--acc:#3ddc84;--bad:#ff6b6b;--warn:#f5c451}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 Manrope,system-ui,sans-serif}
header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line)}
header b{font-weight:800;letter-spacing:.04em}header span{color:var(--acc);font-weight:600}header button{margin-left:auto}
nav{display:flex;gap:4px;padding:10px 20px;border-bottom:1px solid var(--line);overflow-x:auto}
nav a{padding:8px 14px;border-radius:999px;color:var(--mut);cursor:pointer;white-space:nowrap}nav a.on{background:var(--acc);color:#06110a;font-weight:600}
main{max-width:1000px;margin:0 auto;padding:20px}h2{margin:0 0 12px;font-size:20px}
.g{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}.s{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.s b{display:block;font-size:26px;font-weight:800}.s small{color:var(--mut)}
.p{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:16px}
input,select,textarea,button{font:inherit;color:var(--text);background:#0f1513;border:1px solid var(--line);border-radius:8px;padding:9px 11px}
input,select,textarea{width:100%}textarea{min-height:90px}label{display:block;color:var(--mut);font-size:13px;margin:10px 0 4px}
button{cursor:pointer}button.pr{background:var(--acc);color:#06110a;border-color:var(--acc);font-weight:700}button.dg{color:var(--bad)}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,nav a:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
.r{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}.w{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}th{color:var(--mut);font-weight:600}
.t{padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line)}.sent,.active,.done,.test_ok{color:var(--acc)}.failed,.dnc,.retry,.test_failed{color:var(--bad)}.review,.replied{color:var(--warn)}
.m{color:var(--mut)}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
</style><body><header><b>HISTREE STUDIOS</b><span>Mailflow</span><button id=pz></button></header><nav id=nav></nav><main id=app></main>
<script>
const $=s=>document.querySelector(s);let S=null,tab='Overview',steps=[{subject:'',body:'',delay:0}];
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(p,b){const r=await fetch('/api/'+p,{method:b?'POST':'GET',headers:{'X-Req':'1','Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
 if(r.status===401&&p!=='login'){showLogin();throw 0}const j=await r.json();if(!r.ok){alert(j.error||'Something went wrong');throw 0}return j}
function showLogin(){$('#nav').innerHTML='';$('#pz').style.display='none';$('#app').innerHTML='<div class=p style="max-width:360px;margin:60px auto"><h2>Sign in</h2><label>Admin password</label><input id=pw type=password autofocus><p><button class=pr id=go>Sign in</button></p></div>';
 const f=async()=>{await api('login',{password:$('#pw').value});load()};$('#go').onclick=f;$('#pw').onkeydown=e=>{if(e.key==='Enter')f()}}
async function load(){S=await api('state');$('#pz').style.display='';$('#pz').textContent=S.paused?'Resume all sending':'Pause all sending';$('#pz').className=S.paused?'pr':'dg';draw()}
$('#pz').onclick=async()=>{await api('pause',{on:!S.paused});load()};
function draw(){const T=['Overview','Leads','Campaigns','Mailboxes'];$('#nav').innerHTML=T.map(t=>'<a tabindex=0 class="'+(t===tab?'on':'')+'" data-t="'+t+'">'+t+'</a>').join('');
 document.querySelectorAll('nav a').forEach(a=>{a.onclick=()=>{tab=a.dataset.t;draw()};a.onkeydown=e=>{if(e.key==='Enter')a.click()}});V[tab]()}
const tag=s=>'<span class="t '+esc(s)+'">'+esc(s)+'</span>';
const V={
Overview(){const k=S.stats,c=[['Leads',k.leads],['Queued',k.queued],['Sent',k.sent],['Replied',k.replied],['Unsubscribed or suppressed',k.suppressed],['Needs review',k.review],['Failed',k.failed],['Interrupted (check)',k.stuck]];
 const lr=S.last_run?Math.round((Date.now()-S.last_run)/60000):null;$('#app').innerHTML=(S.paused?'<div class=p style="border-color:var(--warn)">All sending is paused.</div>':'')+'<div class=p>Sender (GitHub): '+(lr===null?'has not connected yet. Finish the sender setup in the README.':lr<=20?'checked in '+lr+' min ago.':'last checked in '+lr+' min ago. Open the repo Actions tab and run Sender.')+'</div>'+'<div class=g>'+c.map(x=>'<div class=s><b>'+x[1]+'</b><small>'+x[0]+'</small></div>').join('')+'</div><h2 style="margin-top:24px">Activity</h2><div class="p w"><table><tr><th>Time<th>Event<th>Lead<th>Detail</tr>'+
 (S.events.map(e=>'<tr><td>'+new Date(e.ts).toLocaleString()+'<td>'+tag(e.type)+'<td>'+esc(e.lead||'')+'<td class=m>'+esc(e.detail)).join('')||'<tr><td colspan=4 class=m>Nothing sent yet. Add a mailbox, import leads, then start a campaign.')+'</table></div>'},
Leads(){$('#app').innerHTML='<div class=p><h2>Import leads</h2><p class=m>CSV columns: first_name, last_name, email, company, website, role, source, personalization_note. Imported leads are never emailed until you start a campaign.</p><input type=file id=f accept=.csv></div><div class="p w"><table><tr><th>Email<th>Name<th>Company<th>Status<th></tr>'+
 S.leads.map(l=>'<tr><td>'+esc(l.email)+'<td>'+esc((l.first_name+' '+l.last_name).trim())+'<td>'+esc(l.company)+'<td>'+tag(l.status)+'<td><button data-i='+l.id+' data-s=replied>Mark replied</button> <button class=dg data-i='+l.id+' data-s=dnc>Do not contact</button>').join('')+'</table></div>';
 $('#f').onchange=async e=>{const rows=csv(await e.target.files[0].text()),h=rows.shift().map(x=>x.trim().toLowerCase());
  const o=rows.filter(r=>r.length>1).map(r=>Object.fromEntries(h.map((k,i)=>[k,(r[i]||'').trim()])));const j=await api('leads',{rows:o});alert('Added '+j.added+', duplicates '+j.duplicates+', invalid '+j.invalid);load()};
 document.querySelectorAll('button[data-s]').forEach(b=>b.onclick=async()=>{await api('lead/'+b.dataset.i+'/status',{status:b.dataset.s});load()})},
Campaigns(){const d=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
 $('#app').innerHTML='<div class=p><h2>New campaign</h2><div class=r><div><label>Name</label><input id=cn></div><div><label>Send from</label><select id=cm>'+S.mailboxes.map(m=>'<option value='+m.id+'>'+esc(m.email)+'</option>').join('')+'</select></div><div><label>Time zone</label><input id=tz value="Asia/Dhaka"></div></div>'+
 '<div class=r><div><label>Send from hour (0-23)</label><input id=sh type=number value=9></div><div><label>Until hour (0-23)</label><input id=eh type=number value=17></div><div><label>Gap between emails, min minutes</label><input id=g1 type=number value=5></div><div><label>Gap, max minutes</label><input id=g2 type=number value=12></div></div>'+
 '<label>Sending days</label><div class=row>'+d.map(x=>'<label style="margin:0"><input type=checkbox style="width:auto" class=dy value='+x+(x<'Sat'||x==='Thu'||x==='Tue'||x==='Wed'?'':'')+(['Sat','Sun'].includes(x)?'':' checked')+'> '+x+'</label>').join('')+'</div><div id=st></div><p class=row><button id=ad>Add follow-up</button><button class=pr id=sv>Save campaign</button></p><p class=m>Use {{first_name}}, {{last_name}}, {{company}}, {{website}}, {{personalization_note}}. Add a fallback like {{first_name|there}}; a missing value without a fallback holds the email for review.</p></div>'+
 '<div class="p w"><table><tr><th>Campaign<th>Status<th>Progress<th></tr>'+S.campaigns.map(c=>'<tr><td>'+esc(c.name)+'<td>'+tag(c.status)+'<td>'+c.done+' done, '+c.active+' active of '+c.total+'<td>'+(c.status==='draft'?'<button class=pr data-a=start data-i='+c.id+'>Start</button>':c.status==='active'?'<button data-a=pause data-i='+c.id+'>Pause</button>':'<button data-a=resume data-i='+c.id+'>Resume</button>')).join('')+'</table></div>';
 const rs=()=>{$('#st').innerHTML=steps.map((s,i)=>'<div class=p style="background:#0f1513"><b>'+(i?'Follow-up '+i:'First email')+'</b>'+(i?'<label>Send after (days since previous email)</label><input type=number data-k=delay data-i='+i+' value='+s.delay+'>':'')+'<label>Subject</label><input data-k=subject data-i='+i+' value="'+esc(s.subject)+'"><label>Message</label><textarea data-k=body data-i='+i+'>'+esc(s.body)+'</textarea></div>').join('');
  $('#st').querySelectorAll('[data-k]').forEach(x=>x.oninput=()=>{steps[x.dataset.i][x.dataset.k]=x.value})};rs();$('#ad').onclick=()=>{steps.push({subject:'',body:'',delay:3});rs()};
 $('#sv').onclick=async()=>{await api('campaign',{name:$('#cn').value,mailbox_id:$('#cm').value,tz:$('#tz').value,start_hour:$('#sh').value,end_hour:$('#eh').value,gap_min:$('#g1').value,gap_max:$('#g2').value,days:[...document.querySelectorAll('.dy:checked')].map(x=>x.value),steps});steps=[{subject:'',body:'',delay:0}];load()};
 document.querySelectorAll('button[data-a]').forEach(b=>b.onclick=async()=>{if(b.dataset.a==='start'&&!confirm('Start now? Every lead currently marked new will be queued for this campaign.'))return;await api('campaign/'+b.dataset.i+'/'+b.dataset.a,{});load()})},
Mailboxes(){$('#app').innerHTML='<div class=p><h2>Add Hostinger mailbox</h2><p class=m>Copy the exact SMTP host and port from your Hostinger email settings. The password is encrypted on the server and never shown again.</p><div class=r><div><label>Sender name</label><input id=mn></div><div><label>Email</label><input id=me></div><div><label>SMTP host</label><input id=mh></div><div><label>Port (465 or 587)</label><input id=mp type=number value=465></div><div><label>Password</label><input id=mw type=password autocomplete=new-password></div><div><label>Daily cap</label><input id=mc type=number value=20></div></div><p><button class=pr id=ma>Save mailbox</button></p></div>'+
 '<div class="p w"><table><tr><th>Mailbox<th>Host<th>Daily cap<th>Status<th></tr>'+S.mailboxes.map(m=>'<tr><td>'+esc(m.email)+'<td>'+esc(m.host)+':'+m.port+'<td>'+m.daily_cap+'<td>'+tag(m.paused?'paused':'active')+'<td><button data-t='+m.id+'>Send test</button> <button data-p='+m.id+'>'+(m.paused?'Resume':'Pause')+'</button> <button class=dg data-d='+m.id+'>Delete</button>').join('')+'</table></div>';
 $('#ma').onclick=async()=>{await api('mailbox',{name:$('#mn').value,email:$('#me').value,host:$('#mh').value,port:$('#mp').value,password:$('#mw').value,daily_cap:$('#mc').value});load()};
 document.querySelectorAll('button[data-t]').forEach(b=>b.onclick=async()=>{const to=prompt('Send a test email to which address?');if(to){await api('mailbox/'+b.dataset.t+'/test',{to});alert('Test queued. The sender sends it within about 15 minutes, or run Sender from the GitHub Actions tab to send now. The result shows in Overview activity.')}});
 document.querySelectorAll('button[data-p]').forEach(b=>b.onclick=async()=>{await api('mailbox/'+b.dataset.p+'/pause',{});load()});
 document.querySelectorAll('button[data-d]').forEach(b=>b.onclick=async()=>{if(confirm('Delete this mailbox?')){await api('mailbox/'+b.dataset.d+'/delete',{});load()}})}};
function csv(t){const rows=[];let r=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++}else q=false}else f+=c}else if(c==='"')q=true;else if(c===','){r.push(f);f=''}else if(c==='\\n'||c==='\\r'){if(c==='\\r'&&t[i+1]==='\\n')i++;r.push(f);f='';rows.push(r);r=[]}else f+=c}if(f||r.length){r.push(f);rows.push(r)}return rows}
load().catch(()=>{});
</script></html>`;
