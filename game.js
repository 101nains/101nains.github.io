/* ==========================================================================
   GAME.JS — Logique applicative, état & interactions UI
   ========================================================================== */

let allianceDisplayName='NA1N';
function applyAllianceName(name){
  const cleaned=String(name||'').trim().slice(0,60)||'NA1N';
  allianceDisplayName=cleaned;
  document.querySelectorAll('[data-alliance-name]').forEach(el=>{el.textContent=cleaned;});
  document.title='Bienvenue chez '+cleaned+' 🚂';
  const input=document.getElementById('allianceNameInput');if(input)input.value=cleaned;
}
async function loadAllianceName(){
  if(!sb)return;
  try{
    const {data,error}=await sb.from('app_config').select('value').eq('key',ALLIANCE_NAME_KEY).maybeSingle();
    if(error)throw error;
    const value=data?.value;
    applyAllianceName(typeof value==='string'?value:value?.name||'NA1N');
  }catch(e){console.warn('Nom de l’alliance non chargé :',e.message);applyAllianceName('NA1N');}
}
async function saveAllianceName(){
  if(!isAdmin()){toast('Réservé aux administrateurs');return;}
  const input=document.getElementById('allianceNameInput');
  const status=document.getElementById('allianceNameStatus');
  const name=input?.value.trim();
  if(!name){if(status)status.textContent='Indique un nom valide.';return;}
  if(name.length>60){if(status)status.textContent='60 caractères maximum.';return;}
  try{
    const {error}=await sb.from('app_config').upsert({key:ALLIANCE_NAME_KEY,value:{name},updated_at:new Date().toISOString()});
    if(error)throw error;
    applyAllianceName(name);
    if(status)status.textContent='Nom enregistré pour tous les visiteurs.';
    toast('Nom de l’alliance mis à jour');
  }catch(e){if(status)status.textContent='Enregistrement impossible : '+e.message;}
}
let sb=null;
function initSB(){
  try{
    if(typeof supabase==='undefined'){console.error('Supabase non chargé');return false;}
    if(!SUPABASE_URL||!SUPABASE_KEY){console.error('Configuration Supabase incomplète');return false;}
    sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
    return true;
  }catch(e){console.error('Erreur init Supabase:',e);return false;}
}


let participants=[],history=[],weeksHistory=[],busy=false,dragSrcIdx=null;
let presentMode=false,presentIds=new Set();
let searchFilter='',sortAlpha=false,statSort='name';
let currentUser=null;
let evNbTeams=1,evRoles={},evTeams=null,evDragSrc=null,evTeamsLoaded=false;
// V18.6 — disponibilités par session et créneaux de chaque équipe.
let tddSlotVotes={},tddSlotOriginal={},tddTeamSlots={A:'midi',B:'soir'};
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function tddSlotLabel(slot){return slot==='midi'?'☀️ Midi':slot==='soir'?'🌙 Soir':slot==='both'?'🔄 Les deux':'⚪ Non renseigné';}
function tddSlotCompatible(id,teamKey){const slot=tddSlotVotes[id];return !slot||slot==='both'||slot===tddTeamSlots[teamKey];}
async function loadTddSlotVotes(){
 if(!sb||!availabilityState.tdd?.id)return;
 const {data,error}=await sb.from('tdd_slot_preferences').select('participant_id,slot,original_slot').eq('session_id',availabilityState.tdd.id);
 if(error){console.warn('Créneaux TDD : exécuter SQL V18.6',error.message);return;}
 tddSlotVotes=Object.fromEntries((data||[]).map(r=>[r.participant_id,r.slot]));
 tddSlotOriginal=Object.fromEntries((data||[]).filter(r=>r.original_slot).map(r=>[r.participant_id,r.original_slot]));
 renderEventPlayers();
 renderTddSlotStaff();
}
async function loadTddTeamSlots(){
 if(!sb)return;
 const {data,error}=await sb.from('tdd_team_slots').select('team_key,slot');
 if(!error)(data||[]).forEach(r=>{if(r.team_key==='A'||r.team_key==='B')tddTeamSlots[r.team_key]=r.slot;});
 renderTddSlotStaff();
}
async function setTddTeamSlot(team,slot){
 if(!isAdminOrStaff()||!['A','B'].includes(team)||!['midi','soir'].includes(slot))return;
 const incompatible=evTeams?.[team]?CATEGORIES.flatMap(c=>evTeams[team][c.key]||[]).filter(p=>{const pref=tddSlotVotes[p.id];return pref&&pref!=='both'&&pref!==slot;}):[];
 if(incompatible.length&&!confirm('Attention : '+incompatible.length+' joueur(s) de cette équipe ne sont pas disponibles à cet horaire. Continuer ?')){renderTddSlotStaff();return;}
 const {error}=await sb.from('tdd_team_slots').upsert({team_key:team,slot});
 if(error){alert('Créneau non enregistré : '+error.message);return;}
 tddTeamSlots[team]=slot;renderTddSlotStaff();renderEventTeams();
}
async function setTddPlayerSlot(id,slot){
 if(!isAdminOrStaff()||!['midi','soir','both'].includes(slot)||!availabilityState.tdd?.id)return;
 const old=tddSlotVotes[id];
 const {error}=await sb.from('tdd_slot_preferences').upsert({session_id:availabilityState.tdd.id,participant_id:id,slot});
 if(error){alert('Modification impossible : '+error.message);renderTddSlotStaff();return;}
 tddSlotVotes[id]=slot;renderTddSlotStaff();renderEventPlayers();renderEventTeams();
}
function tddPlayerOriginalBadge(p){
 const original=tddSlotOriginal[p.id];
 if(!original)return '<span class="tdd-original-choice tdd-original-unknown" title="Aucun horaire déclaré dans le sondage">📝 Non renseigné</span>';
 const adjusted=tddSlotVotes[p.id]&&tddSlotVotes[p.id]!==original;
 return `<span class="tdd-original-choice" title="Horaire choisi par le joueur dans le sondage${adjusted?' — modifié ensuite par le staff':''}">📝 ${tddSlotLabel(original)}${adjusted?' · ajusté':''}</span>`;
}
function tddPlayerSlotSelect(p){
 const current=tddSlotVotes[p.id]||'both';
 return `<select class="tdd-player-slot-select" aria-label="Créneau TDD de ${escapeHtml(p.name)}" title="Ajuster le créneau de ${escapeHtml(p.name)}" onchange="setTddPlayerSlot(${Number(p.id)},this.value)"><option value="both" ${current==='both'?'selected':''}>🔄 Les deux</option><option value="midi" ${current==='midi'?'selected':''}>☀️ Midi</option><option value="soir" ${current==='soir'?'selected':''}>🌙 Soir</option></select>`;
}
function renderTddSlotStaff(){
 const el=document.getElementById('tddSlotStaff');if(!el)return;
 if(!isAdminOrStaff()){el.innerHTML='';return;}
 const choices=key=>`<label class="tdd-slot-inline-team">Équipe ${key} <select aria-label="Horaire équipe ${key}" onchange="setTddTeamSlot('${key}',this.value)"><option value="midi" ${tddTeamSlots[key]==='midi'?'selected':''}>☀️ Midi</option><option value="soir" ${tddTeamSlots[key]==='soir'?'selected':''}>🌙 Soir</option></select></label>`;
 el.innerHTML=choices('A')+choices('B');
}

function tddBalancedSlots(){
 const capTit=CATEGORIES.filter(c=>c.key!=='SUB').reduce((n,c)=>n+c.size,0);
 const starters=sortTddPlayers(participants.filter(p=>evRoles[p.id]==='starter'));
 const subs=sortTddPlayers(participants.filter(p=>evRoles[p.id]==='sub'));
 const teams={A:{starters:[],subs:[]},B:{starters:[],subs:[]}};
 const placed=new Set();
 const assign=(pool,kind,cap)=>{
   const strict=pool.filter(p=>tddSlotVotes[p.id]&&tddSlotVotes[p.id]!=='both');
   const flexible=pool.filter(p=>!tddSlotVotes[p.id]||tddSlotVotes[p.id]==='both');
   for(const p of [...strict,...flexible]){
     const options=['A','B'].filter(k=>tddSlotCompatible(p.id,k)&&teams[k][kind].length<cap&&!placed.has(p.id));
     if(!options.length)continue;
     options.sort((a,b)=>teams[a][kind].length-teams[b][kind].length || teamPower(teams[a])-teamPower(teams[b]));
     teams[options[0]][kind].push(p);placed.add(p.id);
   }
 };
 const teamPower=t=>[...t.starters,...t.subs].reduce((n,p)=>n+(p.power_t1||0),0);
 assign(starters,'starters',capTit);assign(subs,'subs',TOTAL_SUBS);
 // Titulaires excédentaires : places de remplaçants, sans dépasser les 10 par équipe.
 assign(starters.filter(p=>!placed.has(p.id)),'subs',TOTAL_SUBS);
 return {A:buildOneTeam(teams.A.starters,teams.A.subs,true),B:buildOneTeam(teams.B.starters,teams.B.subs,true)};
}

let evAsymMode=false;
// Rotation équitable des joueurs non retenus, conservée d'une semaine à l'autre.
let tddNonRetenus = {};
let tddNonRetenusWeek = '';
let tddFairStats={counts:{},starters:{},week:''};
let weeklyDrawsData=[];
let drawBuffer=null; // Mémoire tampon 48h post-archivage (coffres_snapshot de la semaine passée)


// ── Système de permissions ─────────────────────────────────────────────────

let permConfig=JSON.parse(JSON.stringify(DEFAULT_PERM));
let permTableExists=true;

function canSeeSection(secId){
  if(!currentUser)return false;
  const role=currentUser.role;
  if(secId==='secRewards'||secId==='secMovements')return role==='admin'||role==='staff';
  if(secId==='aboutSection') return role==='admin';
  if(role==='admin')return true;
  const p=role==='staff'?permConfig.staff:permConfig.member;
  return p[secId]!==false;
}

function applyPermissions(){
  if(!currentUser)return;
  PERM_SECTIONS.forEach(({id})=>{
    const visible=canSeeSection(id);
    const sec=document.getElementById(id);
    if(sec)sec.style.display=visible?'':'none';
    const btn=document.querySelector(`.mob-nav-btn[data-tab="${id}"]`);
    if(btn)btn.style.display=visible?'':'none';
  });
  // Stats: render si maintenant visible et pas encore rendu
  if(canSeeSection('sectionStats')){
    const g=document.getElementById('statsGrid');
    if(g&&!g.innerHTML)renderStats();
    else if(!g)renderStats();
  }
}

async function loadPriorityConfig(){
  if(!sb)return;
  try{
    const{data}=await sb.from('app_config').select('value').eq('key','priority_config').maybeSingle();
    if(data&&data.value){
      priorityModeActive = data.value.active||false;
      priorityMultiplier = data.value.multiplier||2;
      updatePriorityUI();
    }
  }catch(e){}
}

async function savePriorityConfig(){
  if(!sb)return;
  await sb.from('app_config').upsert({key:'priority_config',value:{active:priorityModeActive,multiplier:priorityMultiplier},updated_at:new Date().toISOString()});
}

function togglePriorityMode(){
  priorityModeActive=!priorityModeActive;
  updatePriorityUI();
  savePriorityConfig();
}

function setPriorityMult(val){
  priorityMultiplier=parseFloat(val);
  savePriorityConfig();
  const labels={1.5:'Faible',2:'Moyen',3:'Élevé'};
  if(priorityModeActive) toast(`Priorité staff : ${labels[priorityMultiplier]||'Moyen'}`);
}

function updatePriorityUI(){
  const btn=document.getElementById('priorityToggleBtn');
  const lbl=document.getElementById('priorityToggleLabel');
  const sel=document.getElementById('priorityMultSelect');
  const wrap=document.getElementById('priorityToggleWrap');
  if(!btn)return;
  if(priorityModeActive){
    btn.style.opacity='1';
    lbl.textContent='Priorité staff ON';
    lbl.style.color='var(--amber)';
    if(sel){sel.style.display='';sel.value=String(priorityMultiplier);}
    if(wrap)wrap.style.background='rgba(255,184,77,0.12)';
    if(wrap)wrap.style.borderColor='rgba(255,184,77,0.35)';
  }else{
    btn.style.opacity='0.4';
    lbl.textContent='Priorité staff OFF';
    lbl.style.color='var(--text3)';
    if(sel)sel.style.display='none';
    if(wrap)wrap.style.background='rgba(255,184,77,0.04)';
    if(wrap)wrap.style.borderColor='rgba(255,184,77,0.15)';
  }
}

async function togglePriority(playerId, checkbox){
  if(!isAdmin())return;
  const val=checkbox.checked;
  await sb.from('participants').update({is_priority:val}).eq('id',playerId);
  const p=participants.find(x=>x.id===playerId);
  if(p) p.is_priority=val;
  toast(val?'⭐ Priorité staff activée':'Priorité retirée');
}

async function loadPermConfig(){
  if(!sb)return;
  try{
    const{data,error}=await sb.from('app_config').select('value').eq('key','permissions').maybeSingle();
    if(error)throw error;
    if(data?.value){
      permConfig={
        staff: {...DEFAULT_PERM.staff,...(data.value.staff||{})},
        member:{...DEFAULT_PERM.member,...(data.value.member||{})}
      };
    }
    permTableExists=true;
  }catch(e){
    permTableExists=false;
  }
  if(isAdmin())renderPermPanel();
  applyPermissions();
}

async function savePermConfig(){
  if(!sb||!isAdmin())return;
  try{
    const{error}=await sb.from('app_config').upsert({key:'permissions',value:permConfig,updated_at:new Date().toISOString()});
    if(error)throw error;
    permTableExists=true;
    toast('✓ Permissions sauvegardées');
    applyPermissions();
  }catch(e){
    permTableExists=false;
    renderPermPanel();
    toast('Erreur : créez la table app_config dans Supabase');
  }
}

function togglePerm(role,secId,val){
  if(!permConfig[role])permConfig[role]={};
  permConfig[role][secId]=val;
}

function copyPermSQL(){
  const sql=`CREATE TABLE IF NOT EXISTS app_config (\n  key TEXT PRIMARY KEY,\n  value JSONB,\n  updated_at TIMESTAMPTZ DEFAULT NOW()\n);\nALTER TABLE app_config ENABLE ROW LEVEL SECURITY;\nCREATE POLICY "perm_all" ON app_config USING (true) WITH CHECK (true);`;
  navigator.clipboard.writeText(sql.replace(/\\n/g,'\n')).then(()=>toast('SQL copié !'));
}

function renderPermPanel(){
  const el=document.getElementById('permPanel');
  if(!el)return;
  if(!permTableExists){
    el.innerHTML=`<div class="perm-setup-banner">
      <div class="perm-setup-title">⚙️ Configuration requise</div>
      <div class="perm-setup-text">Pour activer les permissions, créez la table <code>app_config</code> dans votre projet Supabase (Table Editor → New table ou SQL Editor) :</div>
      <pre class="perm-sql-block">CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perm_all" ON app_config
  USING (true) WITH CHECK (true);</pre>
      <button class="btn btn-primary" style="margin-top:12px;height:34px" onclick="copyPermSQL()">📋 Copier le SQL</button>
    </div>`;
    return;
  }
  const mkToggle=(role,secId,checked)=>`<label class="perm-toggle"><input type="checkbox" ${checked?'checked':''} onchange="togglePerm('${role}','${secId}',this.checked)"><span class="perm-toggle-slider"></span></label>`;
  const rows=PERM_SECTIONS.map(({id,label,icon})=>`
    <tr>
      <td><div class="perm-section-label"><span class="perm-sec-icon">${icon}</span>${label}</div></td>
      <td class="perm-td-center">${mkToggle('staff',id,permConfig.staff[id]!==false)}</td>
      <td class="perm-td-center">${mkToggle('member',id,permConfig.member[id]!==false)}</td>
    </tr>`).join('');
  el.innerHTML=`<table class="perm-table">
    <thead><tr>
      <th class="perm-th-section">Section</th>
      <th class="perm-th-role">🛡️ Staff</th>
      <th class="perm-th-role">👤 Membre</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="display:flex;justify-content:flex-end;margin-top:12px">
    <button class="btn btn-primary" style="height:34px" onclick="savePermConfig()">💾 Sauvegarder</button>
  </div>`;
}
// ───────────────────────────────────────────────────────────────────────────


// Sessions TDD / Canyon et verrouillage local par session.
const availabilityState={tdd:null,canyon:null};
function participationKey(kind,id){return 'alliance_vote_'+kind+'_'+id;}
function participationLocked(kind){const session=availabilityState[kind];return !!(session&&localStorage.getItem(participationKey(kind,session.id)));}
function availabilityPublicStatus(kind){
 const session=availabilityState[kind];const prefix=kind==='tdd'?'poll':'canyonPoll';
 const closed=!session,locked=participationLocked(kind);
 const msg=document.getElementById(prefix+'Gate');
 if(msg){msg.style.display=(closed||locked)?'block':'none';msg.textContent=closed?'Ce sondage est clôturé. Reviens à la prochaine session.':'Tu as déjà participé à cette session. Tu pourras voter à la prochaine ouverture.';}
 const steps=kind==='tdd'?['pollStep1','pollStep2','pollStep3']:['canyonPollStep1','canyonPollStep2','canyonPollStep3'];
 if(closed||locked)steps.forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
 return !(closed||locked);
}
async function fetchAvailabilitySession(kind){
 const {data,error}=await sb.from('availability_sessions').select('id,label,opened_at').eq('kind',kind).eq('status','open').order('opened_at',{ascending:false}).limit(1);
 if(error)throw error;
 availabilityState[kind]=data?.[0]||null;
 const title=document.getElementById(kind==='tdd'?'pollSessionLabel':'canyonSessionLabel');
 if(title)title.textContent=availabilityState[kind]?'🟢 Sondage en cours — '+availabilityState[kind].label:'🔒 Sondage clos';
 if(kind==='canyon')updateCanyonPollCounts();
 if(kind==='tdd')updatePollEvBanner();
 return availabilityState[kind];
}
// Le hash du compte reste uniquement en mémoire jusqu'au rechargement de la page.
// Les RPC Supabase vérifient toujours le compte et le rôle à chaque action.
let staffActionHash = null;
async function getStaffActionHash(){
 if(!isAdminOrStaff() || !currentUser)throw new Error('Compte staff/admin requis.');
 if(staffActionHash)return staffActionHash;
 // Une connexion restaurée ne suffit pas à autoriser les RPC sensibles :
 // le hash du mot de passe n'est volontairement jamais sauvegardé dans le navigateur.
 alert('Pour gérer les sondages, reconnecte-toi avec ton compte staff/admin. Tu ne devras ensuite plus saisir de mot de passe pour ouvrir, clôturer ou corriger les sondages.');
 doLogout();
 return null;
}
async function availabilityStaffAction(kind,action){
 if(!isAdminOrStaff()){alert('Connecte-toi avec un compte staff ou administrateur pour gérer le sondage.');return;}
 try{
  // Ne pas se fier à l'état local : il peut être périmé après une ouverture ou un rechargement.
  await fetchAvailabilitySession(kind);
  const session=availabilityState[kind];
  if(action==='open' && session){alert('Une session est déjà ouverte. Clôture-la d’abord.');return;}
  if(action==='close' && !session){alert('Aucune session ouverte à clôturer.');return;}
  const label=action==='open'?prompt('Nom de la nouvelle session (ex. Semaine 42) :'):null;
  if(action==='open'&&!label?.trim())return;
  if(action==='close'&&!confirm('Clôturer la session en cours ? Les votes seront conservés.'))return;
  const hash=await getStaffActionHash();if(!hash)return;
  const args={p_username:currentUser.username,p_account_hash:hash,p_kind:kind};
  if(action==='open')args.p_label=label.trim();
  // Avant la clôture, figer la présélection Canyon, sans toucher aux équipes équilibrées.
  if(kind==='canyon'&&action==='close')await saveCanyonClosedRoles();
  const {error}=await sb.rpc(action==='open'?'availability_session_open_v3':'availability_session_close_v3',args);
  if(error)throw error;
  await fetchAvailabilitySession(kind);await loadAvailabilityStaff(kind);await loadPollResults();await loadCanyonPollResults();
  toast(action==='open'?'Nouvelle session ouverte.':'Session clôturée.');
 }catch(e){alert('Action impossible : '+(e?.message||String(e)));}
}
async function loadAvailabilityStaff(kind){
 const el=document.getElementById(kind==='tdd'?'tddSessionStaff':'canyonSessionStaff');if(!el)return;
 const {data,error}=await sb.from('availability_sessions').select('id,label,status,opened_at').eq('kind',kind).order('opened_at',{ascending:false}).limit(1);
 if(error){el.textContent='Erreur : '+error.message;return;}
 const session=data?.[0];const open=session?.status==='open';
 el.replaceChildren();
 const badge=document.createElement('div');badge.style.cssText='display:inline-block;margin:10px 0;padding:8px 12px;border-radius:9px;font-size:13px;font-weight:800;border:1px solid '+(open?'#1d9e70':'#b76b62')+';color:'+(open?'#54dbad':'#f2a19a');
 badge.textContent=open?'🟢 Sondage en cours — '+session.label:'🔒 Sondage clos';el.appendChild(badge);
}
// ══ SYSTÈME DE SONDAGE TDD ══════════════════════════════════════════════════
let pollParticipants = [];
let pollResults = {};
let pollSelectedId = null;
let pollSelectedName = null;

function checkPollMode(){
  const params = new URLSearchParams(window.location.search);
  if(params.get('poll') === 't1') return checkT1PollMode();
  if(params.get('poll') === 'canyon') return checkCanyonPollMode();
  if(params.get('poll') !== 'tdd') return false;
  const ls = document.getElementById('loginScreen');
  if(ls) ls.style.display = 'none';
  const as = document.getElementById('appScreen');
  if(as) as.style.display = 'none';
  const po = document.getElementById('pollOverlay');
  if(po) po.style.display = 'flex';
  initPollPage();
  return true;
}

async function initPollPage(){
  if(!sb){ setTimeout(initPollPage, 200); return; }
  await fetchAvailabilitySession('tdd');
  if(!availabilityPublicStatus('tdd'))return;
  sb.channel('tdd_sessions_public').on('postgres_changes',{event:'*',schema:'public',table:'availability_sessions'},()=>initPollPage()).subscribe();
  // Charger les participants (critique — erreur bloquante)
  try{
    const pRes = await sb.from('participants').select('id,name').order('name');
    if(pRes.error) throw pRes.error;
    pollParticipants = pRes.data || [];
  }catch(e){
    pollParticipants = [];
    console.warn('Poll: erreur chargement participants:', e);
    const list = document.getElementById('pollNamesList');
    if(list) list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--red);font-size:13px">❌ Impossible de charger les joueurs.<br><span style="font-size:11px;opacity:.7">' + (e.message||JSON.stringify(e)) + '</span></div>';
    return;
  }
  // Charger les votes existants (non critique)
  try{
    const pollRes = await sb.from('tdd_poll').select('participant_id,response');
    if(!pollRes.error)(pollRes.data||[]).forEach(r=>{ pollResults[r.participant_id] = r.response; });
  }catch(e){
    console.warn('Poll: erreur chargement votes (non bloquant):', e);
  }
  await loadTddSlotVotes();
  // Les pseudos ayant voté ne sont plus proposés, quel que soit l'appareil.
  renderPollNames('');
  // Temps réel
  try{
    sb.channel('tdd_poll_rt').on('postgres_changes',
      {event:'*', schema:'public', table:'tdd_poll'},
      (payload)=>{
        const r = payload.new || payload.old;
        if(payload.eventType === 'DELETE') { if(r) delete pollResults[r.participant_id]; }
        else if(r) pollResults[r.participant_id] = r.response;
        refreshPollNameBadges();
        updatePollEvBanner();
      }
    ).subscribe();
  }catch(e){}
}

function filterPollNames(){
  const q = document.getElementById('pollSearchInp').value;
  renderPollNames(q);
}

function renderPollNames(q){
  q = (q || '').toLowerCase();
  const list = document.getElementById('pollNamesList');
  if(!list) return;
  const filtered = pollParticipants.filter(p=>!pollResults[p.id] && p.name.toLowerCase().includes(q));
  if(!filtered.length){
    list.textContent = q ? 'Aucun joueur disponible trouvé.' : 'Tous les joueurs ont répondu.';
    return;
  }
  list.replaceChildren();
  filtered.forEach(p=>{
    const button=document.createElement('button');
    button.className='poll-name-btn';
    button.textContent=p.name;
    button.onclick=()=>selectPollParticipant(p.id,p.name);
    list.appendChild(button);
  });
}

function refreshPollNameBadges(){
  renderPollNames(document.getElementById('pollSearchInp')?.value || '');
}

function selectPollParticipant(id,name){
  if(pollResults[id]) { refreshPollNameBadges(); return; }
  pollSelectedId=id;
  pollSelectedName=name;
  document.getElementById('pollSelectedName').textContent=name;
  document.querySelectorAll('.poll-choice').forEach(b=>b.classList.remove('selected'));
  pollStep(2);
}

let pollVotePending=false;
async function submitPollVote(response){
  if(!pollSelectedId || pollVotePending || !POLL_ROLE_MAP.hasOwnProperty(response)) return;
  const slot=document.querySelector('#tddPollSlots input[name="tddSlot"]:checked')?.value||'both';
  pollVotePending=true;
  document.querySelectorAll('.poll-choice').forEach(b=>b.disabled=true);
  try{
    // INSERT uniquement : la clé primaire et la politique SQL bloquent le second vote.
    const {error}=await sb.rpc('tdd_submit_with_slot',{p_session_id:availabilityState.tdd.id,p_participant_id:pollSelectedId,p_response:response,p_slot:response==='absent'?null:slot});
    if(error){
      if(error.code==='23505'){
        await loadPollResults();
        alert('Ce joueur a déjà voté. Choisis un autre pseudo.');
        pollStep(1);
        return;
      }
      throw error;
    }
    pollResults[pollSelectedId]=response;
    try{localStorage.setItem(participationKey('tdd',availabilityState.tdd.id),String(pollSelectedId));}
    catch(storageError){console.warn('Mémorisation locale TDD impossible :',storageError);}
    // V18.5 : comme pour T1, fermer le formulaire dès que le vote est confirmé.
    const tddGate=document.getElementById('pollGate');
    if(tddGate){tddGate.style.display='block';tddGate.textContent=pollSelectedName+', ton vote est enregistré. Tu as déjà participé à cette session. Reviens à la prochaine ouverture.';}
    ['pollStep1','pollStep2','pollStep2b','pollStep3'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  }catch(e){
    console.error('Vote TDD:',e);
    alert('Vote non enregistré : '+(e.message||'Erreur de connexion'));
  }finally{
    pollVotePending=false;
    document.querySelectorAll('.poll-choice').forEach(b=>b.disabled=false);
  }
}

function showPollConfirm(response, isNew){
  const counts = getPollCounts();
  document.getElementById('pollConfirmIcon').textContent = POLL_ICONS[response];
  document.getElementById('pollConfirmMsg').textContent = isNew
    ? (pollSelectedName + ', ta réponse a été enregistrée !')
    : (pollSelectedName + ', tu as déjà répondu.');
  document.getElementById('pollConfirmSub').textContent =
    response === 'present' ? 'Tu es inscrit comme titulaire.' :
    response === 'remplacant' ? 'Tu es inscrit comme remplaçant.' :
    'Tu es inscrit comme absent.';
  document.getElementById('pollConfirmSummary').innerHTML =
    '<span class="poll-summary-pill present">✅ ' + counts.present + ' présent' + (counts.present>1?'s':'') + '</span>'
    + '<span class="poll-summary-pill remplacant">🔄 ' + counts.remplacant + ' remplaçant' + (counts.remplacant>1?'s':'') + '</span>'
    + '<span class="poll-summary-pill absent">❌ ' + counts.absent + ' absent' + (counts.absent>1?'s':'') + '</span>';
  pollStep(3);
  // Confirmation visible, puis formulaire bloqué au prochain chargement.
}

function getPollCounts(){
  const c = {present:0, remplacant:0, absent:0};
  Object.values(pollResults).forEach(function(r){ if(c[r] !== undefined) c[r]++; });
  return c;
}

function pollStep(n){
  var steps = ['1','2','2b','3'];
  steps.forEach(function(i){
    const el = document.getElementById('pollStep' + i);
    if(el) el.style.display = (String(i) === String(n)) ? '' : 'none';
  });
  if(n === 1 && !availabilityPublicStatus('tdd'))return;
  if(n === 1){
    const inp = document.getElementById('pollSearchInp');
    if(inp) inp.value = '';
    renderPollNames('');
  }
  if(n === '2b') setTimeout(function(){ const inp = document.getElementById('pollPinInp'); if(inp) inp.focus(); }, 100);
}

function applyTddPollRolesToEvent(){
  if(!availabilityState.tdd || !currentUser || !participants.length)return;
  // La réponse au sondage alimente la présélection TDD : présent = titulaire,
  // remplaçant = remplaçant, absent/non-répondant = aucun rôle.
  participants.forEach(p=>{evRoles[p.id]=POLL_ROLE_MAP[pollResults[p.id]]||'none';});
  updateEvBanner();
  renderEventPlayers();
}

async function loadPollResults(){
  if(!sb) return;
  try{
    const {data,error} = await sb.from('tdd_poll').select('participant_id,response');
    if(error)throw error;
    pollResults = {};
    (data||[]).forEach(function(r){ pollResults[r.participant_id] = r.response; });
    updatePollEvBanner();
    renderPollStaffTable();
    if(availabilityState.tdd && currentUser){
      await loadTddSlotVotes();
      applyTddPollRolesToEvent();
    }
    renderEventPlayers();
  }catch(e){console.warn('Chargement des réponses TDD :',e);}
}

function updatePollEvBanner(){
  // Le compteur TDD est visible uniquement pendant une session ouverte.
  const banner=document.getElementById('pollEvBanner');
  if(banner)banner.style.display='none';
  const el=document.getElementById('tddPollCounts');
  if(!el)return;
  const isOpen=!!availabilityState.tdd;
  const count=Object.keys(pollResults).length;
  el.style.display=isOpen?'inline':'none';
  el.textContent=isOpen?`${count} votant${count>1?'s':''}`:'';
}

// ══ MODAL SONDAGE (bouton "Lancer le sondage" dans le hall) ═════════════════

function openPollModal(){
  const modal = document.getElementById('pollModal');
  if(!modal) return;
  // Remplir le champ lien
  const url = window.location.href.split('?')[0] + '?poll=tdd';
  const inp = document.getElementById('pollLinkInput');
  if(inp) inp.value = url;
  // Tableau de correction réservé aux membres du staff et administrateurs.
  const staffPanel=document.getElementById('pollStaffPanel');
  if(staffPanel) staffPanel.style.display=isAdminOrStaff()?'':'none';
  renderPollStaffTable();
  loadAvailabilityStaff('tdd');
  modal.style.display = 'flex';
}

function closePollModal(){
  const modal = document.getElementById('pollModal');
  if(modal) modal.style.display = 'none';
}

function copyPollLinkModal(){
  const inp = document.getElementById('pollLinkInput');
  if(!inp) return;
  navigator.clipboard.writeText(inp.value).then(function(){ toast('Lien sondage copié !'); });
}

function renderPollStaffTable(){
  const tbody=document.querySelector('#pollStaffTable tbody');
  if(!tbody) return;
  tbody.replaceChildren();
  if(!isAdminOrStaff()) return;
  [...participants].sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    const tr=document.createElement('tr');
    const name=document.createElement('td');name.textContent=p.name;
    name.style.padding='7px 5px';
    const cell=document.createElement('td');cell.style.padding='7px 5px';
    const select=document.createElement('select');select.style.cssText='width:100%;height:34px;font-size:12px';
    [['','Non répondu'],['present','Présent'],['remplacant','Remplaçant'],['absent','Absent']].forEach(([value,label])=>{
      const option=document.createElement('option');option.value=value;option.textContent=label;
      select.appendChild(option);
    });
    select.value=pollResults[p.id]||'';
    select.onchange=()=>staffCorrectPoll(p.id,p.name,select);
    cell.appendChild(select);tr.append(name,cell);tbody.appendChild(tr);
  });
}

async function staffCorrectPoll(id,name,select){
  if(!isAdminOrStaff()) return;
  const old=pollResults[id]||'';
  const next=select.value;
  const hash=await getStaffActionHash();
  if(!hash){select.value=old;return;}
  select.disabled=true;
  try{
    
    const {error}=await sb.rpc('availability_correct_v3',{
      p_username:currentUser.username,p_account_hash:hash,
      p_kind:'tdd',p_participant_id:id,p_response:next||null
    });
    if(error) throw error;
    if(next)pollResults[id]=next;else delete pollResults[id];
    updatePollEvBanner();renderEventPlayers();toast('Vote TDD mis à jour.');
  }catch(e){select.value=old;alert('Correction impossible : '+(e.message||e));}
  finally{select.disabled=false;}
}

function copyPollLink(){
  const url = window.location.href.split('?')[0] + '?poll=tdd';
  navigator.clipboard.writeText(url).then(function(){ toast('Lien sondage copié !'); });
}
// ────────────────────────────────────────────────────────────────────────────

// ══ SONDAGE BATAILLE DU CANYON (indépendant de la TDD) ══
let canyonPollParticipants=[],canyonPollResults={},canyonPollSelected=null,canyonPollPending=false;
function canyonPollUrl(){return window.location.href.split('?')[0]+'?poll=canyon';}
function openCanyonPollModal(){
  const url=canyonPollUrl();
  const input=document.getElementById('canyonPollLink');if(input)input.value=url;
  const modal=document.getElementById('canyonPollModal');if(modal)modal.style.display='flex';
  renderCanyonPollStaff();
  loadCanyonPollResults();
  loadAvailabilityStaff('canyon');
}
function copyCanyonPollLink(){
  const url=canyonPollUrl();
  navigator.clipboard.writeText(url).then(()=>toast('Lien Canyon copié !')).catch(()=>prompt('Copie le lien :',url));
}
function checkCanyonPollMode(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='none';
  document.getElementById('canyonPollOverlay').style.display='flex';
  initCanyonPoll();return true;
}
async function initCanyonPoll(){
  if(!sb){setTimeout(initCanyonPoll,200);return;}
  try{
    await fetchAvailabilitySession('canyon');
    if(!availabilityPublicStatus('canyon'))return;
    sb.channel('canyon_sessions_public').on('postgres_changes',{event:'*',schema:'public',table:'availability_sessions'},()=>initCanyonPoll()).subscribe();
    const [pr,vr]=await Promise.all([
      sb.from('participants').select('id,name').order('name'),
      sb.from('canyon_poll').select('participant_id,response')
    ]);
    if(pr.error)throw pr.error;if(vr.error)throw vr.error;
    canyonPollParticipants=pr.data||[];
    canyonPollResults=Object.fromEntries((vr.data||[]).map(v=>[v.participant_id,v.response]));
    renderCanyonPollNames();
    sb.channel('canyon_poll_public').on('postgres_changes',
      {event:'*',schema:'public',table:'canyon_poll'},()=>refreshCanyonPoll()).subscribe();
  }catch(e){document.getElementById('canyonPollNames').textContent='Erreur de chargement : '+e.message;}
}
async function refreshCanyonPoll(){
  try{await fetchAvailabilitySession('canyon');}catch(e){console.warn('Statut session Canyon :',e);return;}
  const {data,error}=await sb.from('canyon_poll').select('participant_id,response');
  if(error)return;
  canyonPollResults=Object.fromEntries((data||[]).map(v=>[v.participant_id,v.response]));
  syncCanyonRolesFromPoll();
  renderCanyonPollNames();renderCanyonPollStaff();updateCanyonPollCounts();renderCanyonPlayers();
}
function renderCanyonPollNames(){
  const list=document.getElementById('canyonPollNames');if(!list)return;
  const available=canyonPollParticipants.filter(p=>!Object.prototype.hasOwnProperty.call(canyonPollResults,p.id));
  list.replaceChildren();
  const select=document.createElement('select');
  select.id='canyonPollPlayerSelect';
  select.className='poll-player-select';
  select.setAttribute('aria-label','Sélectionner votre pseudo');
  select.style.cssText='width:100%;height:48px;padding:0 14px;border:1px solid var(--border2);border-radius:12px;background:var(--surface2);color:var(--text);font:inherit;';
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=available.length?'— Sélectionne ton pseudo —':'Tous les joueurs ont répondu';
  select.appendChild(placeholder);
  available.forEach(p=>{const option=document.createElement('option');option.value=String(p.id);option.textContent=p.name;select.appendChild(option);});
  select.disabled=!available.length;
  select.onchange=()=>{
    const p=available.find(p=>String(p.id)===select.value);
    if(!p||Object.prototype.hasOwnProperty.call(canyonPollResults,p.id))return;
    canyonPollSelected=p;
    document.getElementById('canyonPollSelectedName').textContent=p.name;
    canyonPollStep(2);
  };
  list.appendChild(select);
}

function canyonPollStep(n){
  [1,2,3].forEach(i=>document.getElementById('canyonPollStep'+i).style.display=i===n?'':'none');
  if(n===1){if(!availabilityPublicStatus('canyon'))return;canyonPollSelected=null;renderCanyonPollNames();}
}
async function submitCanyonPoll(response){
  if(!canyonPollSelected||canyonPollPending||!['present','remplacant','absent'].includes(response))return;
  canyonPollPending=true;
  document.querySelectorAll('#canyonPollStep2 button.poll-choice').forEach(b=>b.disabled=true);
  try{
    const {error}=await sb.rpc('availability_submit',{p_kind:'canyon',p_session_id:availabilityState.canyon.id,p_participant_id:canyonPollSelected.id,p_response:response});
    if(error){
      if(error.code==='23505'){await refreshCanyonPoll();alert('Ce pseudo a déjà voté.');canyonPollStep(1);return;}
      throw error;
    }
    canyonPollResults[canyonPollSelected.id]=response;
    syncCanyonRolesFromPoll();
    renderCanyonPlayers();
    updateCanyonPollCounts();
    try{localStorage.setItem(participationKey('canyon',availabilityState.canyon.id),String(canyonPollSelected.id));}
    catch(storageError){console.warn('Mémorisation locale Canyon impossible :',storageError);}
    // V18.5 : comme pour T1, fermer le formulaire dès que le vote est confirmé.
    const canyonGate=document.getElementById('canyonPollGate');
    if(canyonGate){canyonGate.style.display='block';canyonGate.textContent=canyonPollSelected.name+' : vote enregistré ('+({present:'Présent',remplacant:'Remplaçant',absent:'Absent'}[response])+'). Tu as déjà participé à cette session. Reviens à la prochaine ouverture.';}
    ['canyonPollStep1','canyonPollStep2','canyonPollStep3'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  }catch(e){alert('Vote non enregistré : '+e.message);}
  finally{canyonPollPending=false;document.querySelectorAll('#canyonPollStep2 button.poll-choice').forEach(b=>b.disabled=false);}
}
async function loadCanyonPollResults(){
  if(!sb)return;
  try{await fetchAvailabilitySession('canyon');}catch(e){console.warn('Statut session Canyon :',e);return;}
  const {data,error}=await sb.from('canyon_poll').select('participant_id,response');
  if(error){console.warn('Canyon poll:',error);return;}
  canyonPollResults=Object.fromEntries((data||[]).map(v=>[v.participant_id,v.response]));
  if(availabilityState.canyon)syncCanyonRolesFromPoll();
  else await restoreCanyonClosedRoles();
  updateCanyonPollCounts();renderCanyonPollStaff();renderCanyonPlayers();renderCanyonTeams();
}
function updateCanyonPollCounts(){
  const el=document.getElementById('canyonPollCounts');if(!el)return;
  const votes=Object.values(canyonPollResults);
  // Afficher uniquement le nombre de votants lorsque la session Canyon est ouverte.
  const isOpen=!!availabilityState.canyon;
  el.style.display=isOpen?'inline':'none';
  el.textContent=isOpen?`${votes.length} votant${votes.length>1?'s':''}`:'';
}
function renderCanyonPollStaff(){
  const panel=document.getElementById('canyonPollStaffPanel');const body=document.querySelector('#canyonPollStaffTable tbody');
  if(!panel||!body)return;
  panel.style.display=isAdminOrStaff()?'':'none';body.replaceChildren();
  if(!isAdminOrStaff())return;
  [...participants].sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    const tr=document.createElement('tr'),td=document.createElement('td'),cell=document.createElement('td'),sel=document.createElement('select');
    td.textContent=p.name;td.style.padding='6px';cell.style.padding='6px';sel.style.cssText='width:100%;height:32px;font-size:12px';
    [['','Non répondu'],['present','Présent'],['remplacant','Remplaçant'],['absent','Absent']].forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;sel.appendChild(o);});
    sel.value=canyonPollResults[p.id]||'';sel.onchange=()=>correctCanyonPoll(p.id,sel);cell.appendChild(sel);tr.append(td,cell);body.appendChild(tr);
  });
}
async function correctCanyonPoll(id,sel){
  if(!isAdminOrStaff())return;
  const old=canyonPollResults[id]||'',next=sel.value;
  const hash=await getStaffActionHash();
  if(!hash){sel.value=old;return;}
  sel.disabled=true;
  try{
    
    const {error}=await sb.rpc('availability_correct_v3',{p_username:currentUser.username,p_account_hash:hash,p_kind:'canyon',p_participant_id:id,p_response:next||null});
    if(error)throw error;
    await loadCanyonPollResults();toast('Vote Canyon corrigé.');
  }catch(e){sel.value=old;alert('Correction impossible : '+e.message);}
  finally{sel.disabled=false;}
}
let canyonZonesEnabled = false;

const CANYON_ZONES = [
  { key: 'electrons', label: '⚡ Électrons libres', size: 5, color: '#ffb84d', bg: 'rgba(255, 184, 77, 0.12)' },
  { key: 'gauche',    label: '⬅️ Zone Gauche',      size: 5, color: '#7c9fff', bg: 'rgba(124, 159, 255, 0.12)' },
  { key: 'centrale',  label: '🎯 Zone Centrale',    size: 5, color: '#4ade80', bg: 'rgba(74, 222, 128, 0.12)' },
  { key: 'droite',    label: '➡️ Zone Droite',      size: 5, color: '#f87171', bg: 'rgba(248, 113, 113, 0.12)' }
];

function toggleCanyonZonesMode() {
  canyonZonesEnabled = !canyonZonesEnabled;
  const btn = document.getElementById('canyonZonesToggleBtn');
  const lbl = document.getElementById('canyonZonesToggleLabel');
  if (lbl) {
    lbl.textContent = canyonZonesEnabled ? 'Zones ON' : 'Zones OFF';
    lbl.style.color = canyonZonesEnabled ? 'var(--blue)' : 'var(--text3)';
  }
  if (btn && btn.parentElement) {
    btn.parentElement.style.borderColor = canyonZonesEnabled ? 'rgba(124,159,255,0.5)' : 'rgba(124,159,255,0.2)';
    btn.parentElement.style.background = canyonZonesEnabled ? 'rgba(124,159,255,0.14)' : 'rgba(124,159,255,0.06)';
  }
  // Si des équipes Canyon existent déjà, on réadapte ou on relance le rendu
  if (typeof canyonTeams !== 'undefined' && canyonTeams) {
    renderCanyonTeams();
  }
  toast(canyonZonesEnabled ? 'Mode Zones activé pour le Canyon (4 × 5 joueurs)' : 'Mode Zones désactivé');
}
function assignCanyonZonesForTeam(teamPlayers) {
  // Trier les titulaires par puissance décroissante
  const sorted = [...teamPlayers].sort((a, b) => (Number(b.power) || 0) - (Number(a.power) || 0));

  const zones = {
    electrons: [],
    gauche: [],
    centrale: [],
    droite: []
  };

  // 1. Les 5 plus puissants vont en Électrons libres
  zones.electrons = sorted.slice(0, 5);

  // 2. Les 15 restants sont répartis en serpentin équilibré sur Gauche, Centrale, Droite (5 chacun)
  const remaining = sorted.slice(5, 20);
  const laneKeys = ['gauche', 'centrale', 'droite'];

  remaining.forEach((player, idx) => {
    const round = Math.floor(idx / 3);
    const pos = idx % 3;
    // Alternance gauche->droite puis droite->gauche pour équilibrer la puissance moyenne de chaque ligne
    const targetLane = (round % 2 === 0) ? laneKeys[pos] : laneKeys[2 - pos];
    if (zones[targetLane].length < 5) {
      zones[targetLane].push(player);
    }
  });

  return zones;
}
if (canyonZonesEnabled) {
  const zoned = assignCanyonZonesForTeam(teamTitulaires);
  canyonTeams[teamKey] = {
    ...zoned,
    remplacants: teamRemplacants
  };
}
const categoriesToRender = canyonZonesEnabled
  ? [...CANYON_ZONES, { key: 'remplacants', label: '🔄 Remplaçants', size: 10, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' }]
  : CANYON_CATEGORIES; // vos catégories classiques sans zones
  
  if (canyonZonesEnabled) {
  CANYON_ZONES.forEach(z => {
    const list = (team[z.key] || []).map(p => p.name).join(', ') || 'Aucun';
    lines.push(`${z.label} (${(team[z.key] || []).length}/5) : ${list}`);
  });
}
// ══ SYSTÈME DE SANCTIONS ════════════════════════════════════════════════════




let sanctionDrawId = null, sanctionRole = null, sanctionPlayerName = null;
let activeAbsentMenu = null;
let priorityModeActive = false;  // toggle priorité staff
let priorityMultiplier = 2;      // multiplicateur (1.5 / 2 / 3)

function openAbsentModal(evt, drawId, role, playerName){
  evt.stopPropagation();
  const trigger = evt.currentTarget;

  // Un second clic sur la même croix referme la liste.
  if(activeAbsentMenu && activeAbsentMenu.dataset.drawId===String(drawId) && activeAbsentMenu.dataset.role===role){
    closeAbsentModal();
    return;
  }
  closeAbsentModal();

  sanctionDrawId = drawId;
  sanctionRole = role;
  sanctionPlayerName = playerName;

  // La liste est attachée au bloc du pseudo : elle se déploie donc depuis la croix.
  const menu = document.createElement('div');
  menu.id = 'absentInlineMenu';
  menu.dataset.drawId = drawId;
  menu.dataset.role = role;
  menu.className = 'absent-inline-menu';
  menu.setAttribute('role','menu');
  const title = document.createElement('div');
  title.className = 'absent-inline-title';
  title.textContent = '↳ Choisir le remplaçant';
  const list = document.createElement('div');
  list.className = 'replace-list';
  menu.append(title, list);
  document.body.appendChild(menu);
  activeAbsentMenu = menu;
  renderReplaceList(list);

  // Positionnement intelligent : sous le bouton si possible, sinon au-dessus.
  requestAnimationFrame(()=>{
    if(activeAbsentMenu!==menu)return;
    const r=trigger.getBoundingClientRect();
    const gap=8;
    const menuW=menu.offsetWidth;
    const menuH=menu.offsetHeight;
    let left=r.right-menuW;
    let top=r.bottom+gap;
    const margin=6;
    if(top+menuH>window.innerHeight-margin) top=r.top-menuH-gap;
    left=Math.max(margin,Math.min(left,window.innerWidth-menuW-margin));
    top=Math.max(margin,Math.min(top,window.innerHeight-menuH-margin));
    menu.style.left=left+'px';
    menu.style.top=top+'px';
  });

  // Laisser finir le clic en cours avant d'écouter les clics extérieurs.
  setTimeout(()=>document.addEventListener('pointerdown', closeAbsentMenuOnOutsideClick), 0);
}

function closeAbsentModal(){
  if(activeAbsentMenu) activeAbsentMenu.remove();
  activeAbsentMenu = null;
  document.removeEventListener('pointerdown', closeAbsentMenuOnOutsideClick);
}

function closeAbsentMenuOnOutsideClick(event){
  if(activeAbsentMenu && !activeAbsentMenu.contains(event.target) && !event.target.closest('.planning-absent-btn')) closeAbsentModal();
}

document.addEventListener('keydown', event=>{if(event.key==='Escape')closeAbsentModal();});

function showAbsentStep(n){ /* étape unique — remplaçant direct */ }
function absentPrevStep(){ closeAbsentModal(); }





function renderReplaceList(list=document.getElementById('replaceList')){
  if(!list) return;
  const current = weeklyDrawsData.find(d=>d.id===sanctionDrawId);
  // Exclure uniquement les joueurs tirés le MÊME jour (pas toute la semaine)
  // Un joueur prévu un autre jour reste disponible comme remplaçant
  const sameDayNames = current
    ? weeklyDrawsData.filter(d=>d.day_index===current.day_index).flatMap(d=>[d.driver,d.vip])
    : [];
  const available = participants.filter(p=>p.name!==sanctionPlayerName && !sameDayNames.includes(p.name));
  const elig = available.filter(p=>isEligible(p));
  const others = available.filter(p=>!isEligible(p));
  const mkBtn = (p,tag) => `<button class="replace-player-btn" onclick="confirmReplace('${p.name.replace(/'/g,"\'")}')">
    <span>${p.name}</span>
    ${tag?'<span class="replace-player-elig">'+tag+'</span>':''}
  </button>`;
  list.innerHTML = [
    elig.length?'<div style="font-size:10px;font-weight:700;color:var(--green);letter-spacing:.08em;text-transform:uppercase;padding:6px 2px">Éligibles</div>':'',
    ...elig.map(p=>mkBtn(p,'')),
    others.length?'<div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.08em;text-transform:uppercase;padding:6px 2px;margin-top:8px">Autres joueurs</div>':'',
    ...others.map(p=>mkBtn(p,''))
  ].join('');
  if(!available.length) list.innerHTML='<div style="padding:16px;color:var(--text3);font-size:12px;text-align:center">Aucun joueur disponible.</div>';
}

async function confirmReplace(newPlayerName){
  if(!sanctionDrawId||!sanctionRole) return;
  const field = sanctionRole==='driver' ? 'driver' : 'vip';
  const update = {[field]: newPlayerName};

  // Récupérer le tirage concerné pour retrouver l'entrée dans historique
  const draw = weeklyDrawsData.find(d=>d.id===sanctionDrawId);

  // Mettre à jour le planning de la semaine
  await sb.from('weekly_draws').update(update).eq('id', sanctionDrawId);

  // Mettre à jour l'historique des tirages : trouver l'entrée correspondant au bon jour
  // weekly_draws stocke day_index (0=Lundi…6=Dimanche), pas week_day en texte
  if(draw && draw.day_index !== undefined){
    const dayName = DAYS_LABELS_WEEK[draw.day_index];
    const {data: histEntries} = await sb.from('historique')
      .select('id')
      .eq(field, sanctionPlayerName)
      .eq('week_day', dayName)
      .eq('is_weekly', true)
      .order('created_at', {ascending: false})
      .limit(1);
    if(histEntries && histEntries.length){
      await sb.from('historique').update(update).eq('id', histEntries[0].id);
      // Mettre aussi à jour le tableau local pour éviter un rechargement complet
      const h = history.find(x=>x.id===histEntries[0].id);
      if(h) h[field] = newPlayerName;
    }
  }

  const countField = sanctionRole==='driver' ? 'driver_count' : 'vip_count';

  // Décrémenter le compteur de l'absent (A n'a pas joué)
  const absent = participants.find(x=>x.name===sanctionPlayerName);
  if(absent && (absent[countField]||0) > 0){
    const newCount = (absent[countField]||0) - 1;
    await sb.from('participants').update({[countField]: newCount}).eq('id', absent.id);
    absent[countField] = newCount;
  }

  // Incrémenter le compteur du remplaçant (B a joué à la place)
  const p = participants.find(x=>x.name===newPlayerName);
  if(p){
    await sb.from('participants').update({[countField]:(p[countField]||0)+1}).eq('id',p.id);
    p[countField]=(p[countField]||0)+1;
  }
  closeAbsentModal();
  await loadWeeklyDraws();
  toast(`${newPlayerName} remplace ${sanctionPlayerName} ✅`);
}
// ────────────────────────────────────────────────────────────────────────────
function isAdmin(){return currentUser?.role==='admin';}
function isStaff(){return currentUser?.role==='staff';}
function isAdminOrStaff(){return isAdmin()||isStaff();}
function roleLabel(r){if(r==='admin')return'👑 Admin';if(r==='staff')return'🛡️ Staff';return'👤 Membre';}
function roleBadgeClass(r){if(r==='admin')return'admin';if(r==='staff')return'staff';return'member';}

async function sha256(str){
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function doLogin(){
  const username=document.getElementById('loginUser').value.trim();
  const password=document.getElementById('loginPass').value;
  const remember=document.getElementById('rememberMe').checked;
  const errEl=document.getElementById('loginError');
  const btn=document.getElementById('loginBtn');
  if(!username||!password){errEl.textContent='Remplis tous les champs.';return;}
  if(!sb){errEl.textContent='Erreur : Supabase non initialisé.';return;}
  btn.disabled=true;btn.innerHTML='<span class="login-spinner"></span>Connexion…';errEl.textContent='';
  try{
    const hash=await sha256(password);
    // Recherche le pseudo sans tenir compte des majuscules/minuscules.
    // Le mot de passe, lui, reste strictement sensible à la casse.
    const{data,error}=await sb.from('app_users').select('*').eq('username',username).eq('password',hash).single();
    if(error||!data){
      errEl.textContent='Identifiant ou mot de passe incorrect.';
      document.getElementById('loginPass').classList.add('error');
      btn.disabled=false;btn.innerHTML='Se connecter';return;
    }
    currentUser={username:data.username,role:data.role};
    staffActionHash=(data.role==='admin'||data.role==='staff')?hash:null;
    const session={username:data.username,role:data.role,expires:remember?Date.now()+(SESSION_DURATION_DAYS*24*60*60*1000):null};
    if(remember){localStorage.setItem(SESSION_KEY,JSON.stringify(session));sessionStorage.removeItem(SESSION_KEY);}
    else{sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));localStorage.removeItem(SESSION_KEY);}
    showApp();
  }catch(e){
    errEl.textContent='Erreur : '+e.message;
    btn.disabled=false;btn.innerHTML='Se connecter';
  }
}

function doLogout(){
  if(rwPollTimer){clearInterval(rwPollTimer);rwPollTimer=null;}if(rwChannel&&sb){sb.removeChannel(rwChannel);rwChannel=null;}rwData=null;
  staffActionHash=null;currentUser=null;localStorage.removeItem(SESSION_KEY);sessionStorage.removeItem(SESSION_KEY);
  document.getElementById('appScreen').style.display='none';
  document.getElementById('loginScreen').style.display='flex';
  document.getElementById('loginUser').value='';
  document.getElementById('loginPass').value='';
  document.getElementById('loginPass').classList.remove('error');
  document.getElementById('loginError').textContent='';
  document.getElementById('loginBtn').disabled=false;
  document.getElementById('loginBtn').innerHTML='Se connecter';
}

async function checkSession(){
  let saved=localStorage.getItem(SESSION_KEY);let isPersistent=true;
  if(!saved){saved=sessionStorage.getItem(SESSION_KEY);isPersistent=false;}
  if(saved){
    try{
      const session=JSON.parse(saved);
      if(isPersistent&&session.expires&&Date.now()>session.expires){localStorage.removeItem(SESSION_KEY);document.getElementById('loginScreen').style.display='flex';return;}
      const{data}=await sb.from('app_users').select('role').eq('username',session.username).single();
      // Une session staff/admin restaurée après rechargement ne possède plus
      // le secret de validation des RPC. Exiger une connexion normale plutôt
      // que de redemander un mot de passe au moment d'ouvrir un sondage.
      if(['staff','admin'].includes(data?.role||session.role)){
        localStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        document.getElementById('loginScreen').style.display='flex';
        return;
      }
      currentUser={username:session.username,role:data?data.role:session.role};
      showApp();return;
    }catch{localStorage.removeItem(SESSION_KEY);sessionStorage.removeItem(SESSION_KEY);}
  }
  document.getElementById('loginScreen').style.display='flex';
}

function showApp(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='block';
  const alliancePanel=document.getElementById('allianceNameAdminPanel');if(alliancePanel)alliancePanel.style.display=isAdmin()?'':'none';
  const av=document.getElementById('userAvatar');
  av.textContent=currentUser.username.charAt(0).toUpperCase();
  av.className='user-avatar '+roleBadgeClass(currentUser.role);
  document.getElementById('userNameDisplay').textContent=currentUser.username;
  const rb=document.getElementById('userRoleDisplay');
  rb.textContent=roleLabel(currentUser.role);
  rb.className='user-role-badge '+roleBadgeClass(currentUser.role);
  const saved=localStorage.getItem(SESSION_KEY);
  if(saved){try{const s=JSON.parse(saved);if(s.expires){const days=Math.ceil((s.expires-Date.now())/(24*60*60*1000));document.getElementById('sessionInfo').textContent=`· Session : ${days}j`;}}catch{}}
  else document.getElementById('sessionInfo').textContent='· Session temporaire';
  document.getElementById('sectionParticipants').style.display=isAdminOrStaff()?'':'none';
  document.getElementById('sectionStats').style.display=isAdminOrStaff()?'':'none';
  // aboutSection géré via canSeeSection dans PERM_SECTIONS
  rwInit();
  mvInit();
  loadRestorePoints();
  // Bouton tirage visible seulement pour admin/staff
  const drawBtn=document.getElementById('doWeeklyDrawsBtn');
  if(drawBtn)drawBtn.style.display=isAdminOrStaff()?'flex':'none';
  const archiveBtn=document.getElementById('archiveWeekParticipantsBtn');
  if(archiveBtn)archiveBtn.style.display=isAdminOrStaff()?'inline-flex':'none';
  const repairBtn=document.getElementById('btnRepairHistory');if(repairBtn)repairBtn.style.display=isAdmin()?'':'none';
  const recalcBtn=document.getElementById('btnRecalcStats');if(recalcBtn)recalcBtn.style.display=isAdmin()?'':'none';
  const priorityWrap=document.getElementById('priorityToggleWrap');if(priorityWrap)priorityWrap.style.display=isAdminOrStaff()?'flex':'none';
  if(isAdmin())loadUsers();
  loadPermConfig();
  loadPriorityConfig();
  loadAll();
  subscribeRT();
  loadWeeklyDraws();
  subscribeWeeklyDraws();
}

async function loadUsers(){
  if(!sb||!isAdmin())return;
  const{data}=await sb.from('app_users').select('id,username,role,created_at').order('created_at');
  const grid=document.getElementById('usersGrid');
  if(!data||!data.length){grid.innerHTML='<span class="empty">Aucun utilisateur.</span>';return;}
  grid.innerHTML=data.map(u=>`
    <div class="user-card">
      <div class="user-card-header">
        <div class="user-card-name">
          <div class="user-avatar ${roleBadgeClass(u.role)}" style="width:26px;height:26px;font-size:11px">${u.username.charAt(0).toUpperCase()}</div>
          ${u.username}
        </div>
        ${u.username!==currentUser.username?`<button class="user-del-btn" onclick="deleteUser(${u.id},'${u.username}')">×</button>`:'<span style="font-size:11px;color:var(--text3)">Vous</span>'}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="font-size:11px;color:var(--text3)">${new Date(u.created_at).toLocaleDateString('fr-FR')}</span>
        ${u.username!==currentUser.username
          ?`<select class="role-select-inline" onchange="changeUserRole(${u.id},'${u.username}',this.value)">
              <option value="member" ${u.role==='member'?'selected':''}>👤 Membre</option>
              <option value="staff"  ${u.role==='staff' ?'selected':''}>🛡️ Staff</option>
              <option value="admin"  ${u.role==='admin' ?'selected':''}>👑 Admin</option>
            </select>`
          :`<span class="user-role-badge ${roleBadgeClass(u.role)}">${roleLabel(u.role)}</span>`}
      </div>
    </div>`).join('');
}

async function addUser(){
  if(!isAdmin())return;
  const username=document.getElementById('newUserName').value.trim();
  const password=document.getElementById('newUserPass').value;
  const role=document.getElementById('newUserRole').value;
  if(!username||!password){toast('Remplis tous les champs');return;}
  if(password.length<6){toast('Mot de passe trop court (6 min)');return;}
  const hash=await sha256(password);
  const{error}=await sb.from('app_users').insert({username,password:hash,role});
  if(error){toast('Erreur : identifiant déjà utilisé ?');return;}
  document.getElementById('newUserName').value='';document.getElementById('newUserPass').value='';
  toast(`"${username}" créé !`);loadUsers();
}

async function deleteUser(id,username){
  if(!confirm(`Supprimer "${username}" ?`))return;
  await sb.from('app_users').delete().eq('id',id);
  toast(`"${username}" supprimé`);loadUsers();
}

async function changeUserRole(id,username,newRole){
  await sb.from('app_users').update({role:newRole}).eq('id',id);
  toast(`"${username}" → ${roleLabel(newRole)}`);loadUsers();
}

function setStatus(s,msg){
  document.getElementById('statusDot').className='status-dot'+(s==='on'?' on':s==='err'?' err':'');
  document.getElementById('statusTxt').textContent=msg;
}

function getTddWeekKey(date=new Date()){
  const d=new Date(date); d.setHours(0,0,0,0);
  const day=(d.getDay()+6)%7;
  d.setDate(d.getDate()-day+3);
  const first=new Date(d.getFullYear(),0,4);
  const week=1+Math.round(((d-first)/86400000-3+(first.getDay()+6)%7)/7);
  return d.getFullYear()+'-W'+String(week).padStart(2,'0');
}
async function loadTddNonRetenus(){
  if(!sb)return;
  try{const{data}=await sb.from('app_config').select('value').eq('key',TDD_NON_RETENUS_CONFIG_KEY).maybeSingle();if(data&&data.value){tddNonRetenus=data.value.counts||{};tddNonRetenusWeek=data.value.week||'';}}catch(e){}
  renderTddNonRetenus();
}
async function saveTddNonRetenus(){
  if(!sb)return;
  await sb.from('app_config').upsert({key:TDD_NON_RETENUS_CONFIG_KEY,value:{counts:tddNonRetenus,week:tddNonRetenusWeek},updated_at:new Date().toISOString()});
}
function renderTddNonRetenus(){
  const summary=document.getElementById('evFairnessSummary'),list=document.getElementById('evFairnessList');
  const entries=Object.entries(tddNonRetenus).map(([id,count])=>({p:participants.find(x=>String(x.id)===String(id)),count:Number(count)||0})).filter(x=>x.p&&x.count>0).sort((a,b)=>b.count-a.count||a.p.name.localeCompare(b.p.name));
  if(summary)summary.textContent=entries.length?`🔄 Rotation : ${entries.length} joueur${entries.length>1?'s':''} à rattraper`:'🔄 Rotation : aucun joueur en attente';
  if(list)list.innerHTML=entries.length?'<div style="padding:8px 12px;border:1px solid rgba(255,184,77,0.2);background:rgba(255,184,77,0.05);border-radius:var(--radius-lg);font-size:11px;color:var(--text3)"><strong style="color:var(--amber)">🔄 Rotation des non-retenus</strong> — les joueurs non pris sont automatiquement enregistrés et prioritaires la semaine suivante.<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">'+entries.map(x=>`<span style="padding:3px 7px;border:1px solid var(--border2);border-radius:99px;color:var(--text)">${x.p.name} <b style="color:var(--amber)">×${x.count}</b></span>`).join('')+'</div></div>':'';
}
async function recordTddNonRetenus(registeredIds,placedIds){
  const week=getTddWeekKey(); if(tddNonRetenusWeek===week)return;
  const excluded=registeredIds.filter(id=>!placedIds.has(id));
  excluded.forEach(id=>{tddNonRetenus[id]=Number(tddNonRetenus[id]||0)+1;});
  tddNonRetenusWeek=week; await saveTddNonRetenus(); renderTddNonRetenus();
  if(excluded.length)toast(`🔄 ${excluded.length} joueur${excluded.length>1?'s':''} non retenu${excluded.length>1?'s':''} enregistré${excluded.length>1?'s':''} pour la rotation`);
}
async function resetTddNonRetenus(){
  if(!confirm('Réinitialiser complètement la rotation des joueurs non retenus ?'))return;
  tddNonRetenus={};tddNonRetenusWeek='';await saveTddNonRetenus();renderTddNonRetenus();toast('♻️ Rotation des non-retenus réinitialisée');
}
function sortTddPlayers(players){
  return [...players].sort((a,b)=>{const fa=Number(tddNonRetenus[a.id]||0),fb=Number(tddNonRetenus[b.id]||0);if(fa!==fb)return fb-fa;const pa=a.ev_priority?1:0,pb=b.ev_priority?1:0;if(pa!==pb)return pb-pa;return (b.power_t1||0)-(a.power_t1||0);});
}

async function loadTddFairStats(){
  if(!sb)return;
  try{
    const {data}=await sb.from('app_config').select('value').eq('key',TDD_FAIR_ROTATION_KEY).maybeSingle();
    if(data&&data.value){
      tddFairStats={counts:data.value.counts||{},starters:data.value.starters||{},week:data.value.week||''};
    }
  }catch(e){}
  updateTddFairRotationUi();
}
async function saveTddFairStats(){
  if(!sb)return;
  await sb.from('app_config').upsert({key:TDD_FAIR_ROTATION_KEY,value:tddFairStats,updated_at:new Date().toISOString()});
}
function updateTddFairRotationUi(){
  const btn=document.getElementById('tddFairRotationBtn');
  const thumb=document.getElementById('tddFairRotationThumb');
  if(btn)btn.style.background=evFairRotation?'#50e898':'var(--border2)';
  if(thumb)thumb.style.transform=evFairRotation?'translateX(18px)':'translateX(0px)';
}
function toggleTddFairRotation(){
  evFairRotation=!evFairRotation;
  try{localStorage.setItem('tdd_fair_rotation',evFairRotation?'1':'0');}catch(e){}
  updateTddFairRotationUi();
  toast(evFairRotation?'🔄 Rotation équitable ON — compatible avec EL priorité':'🔄 Rotation équitable OFF');
}
function getTddFairKey(){return getTddWeekKey();}
function buildTddFairRank(players){
  const counts=tddFairStats.counts||{}, starters=tddFairStats.starters||{};
  return [...players].sort((a,b)=>{
    const ac=Number(counts[a.id]||0), bc=Number(counts[b.id]||0);
    if(ac!==bc)return ac-bc;
    const as=Number(starters[a.id]||0), bs=Number(starters[b.id]||0);
    if(as!==bs)return as-bs;
    const af=Number(tddNonRetenus[a.id]||0), bf=Number(tddNonRetenus[b.id]||0);
    if(af!==bf)return bf-af;
    const ap=a.ev_priority?1:0,bp=b.ev_priority?1:0;
    if(ap!==bp)return bp-ap;
    return (b.power_t1||0)-(a.power_t1||0);
  });
}
async function recordTddFairParticipation(placedIds,starterIds){
  const week=getTddFairKey();
  const ids=[...placedIds];
  if(!ids.length)return;
  // Une seule comptabilisation automatique par semaine pour éviter qu'un second clic
  // sur « équilibrer » ne fasse artificiellement monter les compteurs.
  if(tddFairStats.week===week)return;
  ids.forEach(id=>{tddFairStats.counts[id]=Number(tddFairStats.counts[id]||0)+1;});
  starterIds.forEach(id=>{tddFairStats.starters[id]=Number(tddFairStats.starters[id]||0)+1;});
  tddFairStats.week=week;
  await saveTddFairStats();
}

// V16 — Regroupement des notifications Realtime : une seule lecture pour une rafale.
let _rtRefreshTimer=null;
let _rtRefreshPending=false;
let _rtRefreshRunning=false;
function scheduleRealtimeRefresh(){
  _rtRefreshPending=true;
  if(_rtRefreshTimer!==null)return;
  _rtRefreshTimer=setTimeout(async()=>{
    _rtRefreshTimer=null;
    if(_rtRefreshRunning)return;
    _rtRefreshRunning=true;
    try{
      while(_rtRefreshPending){
        _rtRefreshPending=false;
        await loadAll();
      }
    }finally{_rtRefreshRunning=false;}
  },180);
}

let _loadAllInFlight=null;
async function loadAll(){
  if(_loadAllInFlight)return _loadAllInFlight;
  _loadAllInFlight=_loadAllImpl();
  try{return await _loadAllInFlight;}
  finally{_loadAllInFlight=null;}
}
async function _loadAllImpl(){
  if(!sb)return;
  try{
    const[{data:pData,error:pErr},{data:hData,error:hErr},{data:wData},{data:erData},{data:etData}]=await Promise.all([
      sb.from('participants').select('*').order('position',{ascending:true}),
      sb.from('historique').select('*').order('created_at',{ascending:false}),
      sb.from('weeks_history').select('*').order('archived_at',{ascending:false}),
      sb.from('event_roles').select('*'),
      sb.from('event_teams').select('*,participants(*)').order('position')
    ]);
    if(pErr||hErr)throw pErr||hErr;
    participants=pData||[];history=hData||[];weeksHistory=wData||[];if(rwData&&rwAllowed()){rwRefreshPlayerSelects();rwRenderInput();rwRender();}
    // Afficher immédiatement les historiques dès que les données sont chargées.
    // Ainsi, une erreur dans une autre section (TDD, Canyon, etc.) ne peut plus
    // laisser ces deux zones bloquées sur « Chargement… ».
    renderHistFiltered();
    renderArchiveList();
    await loadTddNonRetenus();
    await loadTddFairStats();
    evRoles={};
    if(erData){
      erData.forEach(r=>{evRoles[r.player_id]=r.role;});
      if(erData.length>0&&erData[0].nb_teams){
        evNbTeams=erData[0].nb_teams;
        document.getElementById('evNb1').classList.toggle('active',evNbTeams===1);
        document.getElementById('evNb2').classList.toggle('active',evNbTeams===2);
      }
    }
    if(etData&&etData.length>0){
      const teams={A:null,B:null};
      const teamKeys=[...new Set(etData.map(r=>r.team_key))];
      teamKeys.forEach(tk=>{
        const team=makeEmptyTeam();
        CATEGORIES.forEach(cat=>{
          const rows=etData.filter(r=>r.team_key===tk&&r.cat_key===cat.key).sort((a,b)=>a.position-b.position);
          team[cat.key]=rows.map(r=>r.participants).filter(Boolean);
        });
        teams[tk]=team;
      });
      evTeams=teams.A?teams:null;evTeamsLoaded=!!evTeams;
    }else{evTeams=null;evTeamsLoaded=false;}
    const ids=new Set(participants.map(p=>p.id));
    presentIds=new Set([...presentIds].filter(id=>ids.has(id)));
    setStatus('on','Connecté · temps réel actif');
    initEvRoles();render();renderEventPlayers();renderEventTeams();
    // La page principale doit elle aussi connaître la session TDD active :
    // sans cela, applyTddPollRolesToEvent() ignore les réponses du sondage.
    await fetchAvailabilitySession('tdd');
    await loadTddTeamSlots();
    await loadTddSlotVotes();
    // Charger les votes avant d'afficher la présélection : au rechargement,
    // event_roles ne doit pas masquer les réponses du sondage actif.
    await loadPollResults();
    applyTddPollRolesToEvent();
    if(canSeeSection('sectionStats'))renderStats();
  renderCanyonPlayers();
  loadCanyonPollResults();
  refreshT1ResponseCounter();
    loadDrawBuffer();
  }catch(e){setStatus('err','Erreur : '+(e.message||e));}
}

function subscribeRT(){
  if(!sb)return;
  // Subscribe to tdd_poll for real-time banner updates
  // Synchronisation de la présélection TDD depuis les votes, comme pour Canyon.
  // Ne modifie jamais les équipes déjà équilibrées.
  async function refreshTddSelectionFromVotes(){
    if(!sb || !currentUser)return;
    try{
      // Récupérer la session depuis l'onglet principal, même si le staff
      // n'a jamais ouvert la page publique du sondage sur cet appareil.
      await fetchAvailabilitySession('tdd');
      if(!availabilityState.tdd){updatePollEvBanner();return;}
      const {data,error}=await sb.from('tdd_poll').select('participant_id,response');
      if(error)throw error;
      pollResults={};
      (data||[]).forEach(r=>{pollResults[r.participant_id]=r.response;});
      // Le rôle et le créneau sont deux données distinctes du même vote.
      await loadTddSlotVotes();
      applyTddPollRolesToEvent();
      updatePollEvBanner();renderPollStaffTable();updateEvBanner();
    }catch(e){console.warn('Synchronisation TDD :',e);}
  }
  // Rattrapage périodique si Supabase Realtime ne transmet pas un changement.
  setInterval(()=>{if(currentUser)refreshTddSelectionFromVotes();},10000);
  sb.channel('tdd_poll_main').on('postgres_changes',{event:'*',schema:'public',table:'tdd_poll'},(payload)=>{
    const r=payload.new||payload.old;
    if(payload.eventType==='DELETE'){if(r)delete pollResults[r.participant_id];}
    else if(r){pollResults[r.participant_id]=r.response;}
    updatePollEvBanner();
    renderPollStaffTable();
    refreshTddSelectionFromVotes();
  }).subscribe();
  // Une ouverture/fermeture de session doit aussi être connue de l'onglet TDD.
  sb.channel('tdd_session_management_sync').on('postgres_changes',
    {event:'*',schema:'public',table:'availability_sessions'},
    async(payload)=>{
      const row=payload.new||payload.old;
      if(row?.kind!=='tdd')return;
      availabilityState.tdd=null;
      await fetchAvailabilitySession('tdd');
      if(availabilityState.tdd)await refreshTddSelectionFromVotes();
      else updatePollEvBanner();
    }
  ).subscribe();

  sb.channel('t1_counter_management_sync').on('postgres_changes',{event:'*',schema:'public',table:'t1_submissions'},()=>refreshT1ResponseCounter()).on('postgres_changes',{event:'*',schema:'public',table:'t1_rounds'},()=>refreshT1ResponseCounter()).subscribe();

  sb.channel('canyon_poll_management_sync').on('postgres_changes',{event:'*',schema:'public',table:'canyon_poll'},()=>{loadCanyonPollResults();}).subscribe();
  sb.channel('canyon_session_management_sync').on('postgres_changes',{event:'*',schema:'public',table:'availability_sessions'},async()=>{try{await fetchAvailabilitySession('canyon');await loadCanyonPollResults();}catch(e){console.warn('Session Canyon :',e);}}).subscribe();

  sb.channel('tr-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'participants'},scheduleRealtimeRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'historique'},scheduleRealtimeRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'weeks_history'},scheduleRealtimeRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'event_roles'},async()=>{
      const{data}=await sb.from('event_roles').select('*');
      evRoles={};
      if(data){
        data.forEach(r=>{evRoles[r.player_id]=r.role;});
        if(data.length>0&&data[0].nb_teams){evNbTeams=data[0].nb_teams;document.getElementById('evNb1').classList.toggle('active',evNbTeams===1);document.getElementById('evNb2').classList.toggle('active',evNbTeams===2);}
      }
      initEvRoles();
      // Une mise à jour event_roles ne doit pas faire disparaître la présélection
      // issue du sondage TDD toujours ouvert.
      applyTddPollRolesToEvent();
      renderEventPlayers();updateEvBanner();
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'event_teams'},async()=>{
      if(_evSaving)return; // ignore pendant un save en cours (DELETE + INSERT)
      const{data}=await sb.from('event_teams').select('*,participants(*)').order('position');
      if(data&&data.length>0){
        const teams={A:null,B:null};
        const teamKeys=[...new Set(data.map(r=>r.team_key))];
        teamKeys.forEach(tk=>{
          const team=makeEmptyTeam();
          CATEGORIES.forEach(cat=>{
            const rows=data.filter(r=>r.team_key===tk&&r.cat_key===cat.key).sort((a,b)=>a.position-b.position);
            team[cat.key]=rows.map(r=>r.participants).filter(Boolean);
          });
          teams[tk]=team;
        });
        evTeams=teams.A?teams:null;evTeamsLoaded=!!evTeams;
      }else{evTeams=null;evTeamsLoaded=false;}
      renderEventTeams();
    })
    .subscribe();
}

function toLocalDateString(d){
  // Toujours utiliser la date LOCALE (pas UTC) pour éviter le bug de timezone
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}

function getNextMonday(){
  const now=new Date();
  const day=now.getDay(); // jour local
  const daysUntilMonday=day===0?1:8-day;
  const monday=new Date(now);
  monday.setDate(now.getDate()+daysUntilMonday);
  return toLocalDateString(monday); // ← date locale, pas UTC
}

function getCurrentMonday(){
  const now=new Date();
  const day=now.getDay(); // jour local
  const diff=day===0?-6:1-day;
  const monday=new Date(now);
  monday.setDate(now.getDate()+diff); // ← ne mute pas now
  return toLocalDateString(monday); // ← date locale, pas UTC
}

function getDateForDayOfWeek(weekStart,dayIndex){
  const d=new Date(weekStart);
  d.setDate(d.getDate()+dayIndex);
  return d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
}

function formatDateShort(dateStr){
  const d=new Date(dateStr);
  return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});
}

async function loadWeeklyDraws(){
  if(!sb)return;
  const nextMonday=getNextMonday();
  let{data}=await sb.from('weekly_draws').select('*').eq('week_start',nextMonday).order('day_index');
  if(!data||!data.length){
    const currMonday=getCurrentMonday();
    const res=await sb.from('weekly_draws').select('*').eq('week_start',currMonday).order('day_index');
    data=res.data;
  }
  weeklyDrawsData=data||[];
  renderPlanning();
  if(weeklyDrawsData.length){
    document.getElementById('showWeeklyDrawsBtn').style.display='flex';
    window._currentWeeklyDraws={
      draws:weeklyDrawsData.map(d=>({driver:d.driver,vip:d.vip,day:d.day_index})),
      weekStart:weeklyDrawsData[0].week_start
    };
  }
}

function subscribeWeeklyDraws(){
  if(!sb)return;
  sb.channel('weekly-draws-rt')
    .on('postgres_changes',{event:'*',schema:'public',table:'weekly_draws'},()=>{loadWeeklyDraws();})
    .subscribe();
}

function renderPlanning(){
  const container=document.getElementById('planningContainer');
  const labelEl=document.getElementById('planningWeekLabel');
  if(!weeklyDrawsData.length){
    container.innerHTML='<div class="planning-empty">Aucun planning cette semaine pour l\'instant…</div>';
    if(labelEl)labelEl.textContent='';
    return;
  }
  const weekStart=weeklyDrawsData[0].week_start;
  const weekEnd=new Date(weekStart);weekEnd.setDate(weekEnd.getDate()+6);
  if(labelEl)labelEl.textContent=`Semaine du ${formatDateShort(weekStart)} au ${weekEnd.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})}`;
  const todayIdx=new Date().getDay();
  container.innerHTML=weeklyDrawsData.map(draw=>{
    const dayName=DAYS_LABELS_WEEK[draw.day_index]||`Jour ${draw.day_index+1}`;
    const jsDay=draw.day_index===6?0:draw.day_index+1;
    const isToday=jsDay===todayIdx;
    const canEdit=isAdminOrStaff();
    const absBtnDrv=canEdit?`<button class="planning-absent-btn" title="Signaler absent" onclick="openAbsentModal(event,${draw.id},'driver','${draw.driver.replace(/'/g,"\'")}')">✕</button>`:'';
    const absBtnVip=canEdit?`<button class="planning-absent-btn" title="Signaler absent" onclick="openAbsentModal(event,${draw.id},'vip','${draw.vip.replace(/'/g,"\'")}')">✕</button>`:'';
    return `<div class="planning-day-card${isToday?' today':''}">
      <div class="planning-day-name">
        ${isToday?'📍 ':''}${dayName}
        ${isToday?'<span class="planning-today-badge">Aujourd\'hui</span>':''}
      </div>
      <div class="planning-roles">
        <div class="planning-role planning-role-wrap"><span class="planning-role-icon">🚗</span><span class="planning-role-name">${draw.driver}</span>${absBtnDrv}</div>
        <span class="planning-sep">·</span>
        <div class="planning-role planning-role-wrap"><span class="planning-role-icon">⭐</span><span class="planning-role-name">${draw.vip}</span>${absBtnVip}</div>
      </div>
    </div>`;
  }).join('');
}

function copyPlanningText(){
  if(!weeklyDrawsData.length){toast('Aucun planning à copier');return;}
  const weekStart=weeklyDrawsData[0].week_start;
  const weekEnd=new Date(weekStart);weekEnd.setDate(weekEnd.getDate()+6);
  let txt='';
  weeklyDrawsData.forEach(draw=>{
    const dayName=DAYS_LABELS_WEEK[draw.day_index]||`Jour ${draw.day_index+1}`;
    txt+=`${dayName} - Chauffeur: ${draw.driver} / VIP: ${draw.vip}\n`;
  });
  txt=txt.trim();
  txt = txt.trim().slice(0, 500);

navigator.clipboard.writeText(txt)
  .then(()=>toast(`Planning copié (${txt.length}/500 caractères)`))
  .catch(()=>toast('Erreur de copie'));
}

function getCoffres(p){try{return JSON.parse(p.coffres_days||'[false,false,false,false,false]')}catch{return[false,false,false,false,false]}}
function isEligible(p){return getCoffres(p).every(d=>d===false)}
async function toggleCoffre(id,dayIdx){
  if(busy)return;const p=participants.find(x=>x.id===id);if(!p)return;
  const days=getCoffres(p);days[dayIdx]=!days[dayIdx];
  setBusy(true);await sb.from('participants').update({coffres_days:JSON.stringify(days)}).eq('id',id);setBusy(false);
}
async function resetCoffres(id){await sb.from('participants').update({coffres_days:JSON.stringify([false,false,false,false,false])}).eq('id',id);}

function renderEligInfo(){
  const el=document.getElementById('eligInfo');if(!participants.length){el.innerHTML='';return;}
  const basePool=applyDrawBuffer(presentMode?participants.filter(p=>presentIds.has(p.id)):participants);
  const elig=basePool.filter(p=>isEligible(p));
  if(!elig.length)el.innerHTML='<span style="color:var(--text3);font-size:12px">Aucun joueur éligible 🏆</span>';
  else el.innerHTML=`<span class="elig-pill">🏆 ${elig.length} joueur${elig.length>1?'s':''} éligible${elig.length>1?'s':''} sur ${basePool.length}${drawBuffer?'&nbsp;📦':''}</span>`;
}

async function draw(presentOnly){
  if(busy||!sb)return;
  const basePool=applyDrawBuffer(presentOnly?participants.filter(p=>presentIds.has(p.id)):participants);
  if(basePool.length<2){toast(presentOnly?'Coche au moins 2 présents':'Ajoute au moins 2 participants');return;}
  const eligibles=basePool.filter(p=>isEligible(p));
  const useEligFilter=eligibles.length>=2;
  const drawPool=useEligFilter?eligibles:basePool;
  const minScoreD=Math.min(...drawPool.map(p=>p.driver_count));
  const driverCandidates=drawPool.filter(p=>p.driver_count<=minScoreD);
  const driverUrn=driverCandidates;
  const driver=driverUrn[Math.floor(Math.random()*driverUrn.length)];
  const rest=drawPool.filter(p=>p.id!==driver.id);
  const minScoreV=Math.min(...rest.map(p=>p.vip_count));
  const vipCandidates=rest.filter(p=>p.vip_count<=minScoreV);
  const vipUrn=vipCandidates;
  const vip=vipUrn[Math.floor(Math.random()*vipUrn.length)];
  const badge=useEligFilter?'🏆 Éligibles':presentOnly?'🟣 Présents':'';
  const bCls=useEligFilter?' gold':'';
  const resDrvEl=document.getElementById('resDrv');
  const resVipEl=document.getElementById('resVip');
  const resDrvBadgeEl=document.getElementById('resDrvBadge');
  const resVipBadgeEl=document.getElementById('resVipBadge');
  if(resDrvEl)resDrvEl.textContent=driver.name;
  if(resVipEl)resVipEl.textContent=vip.name;
  if(resDrvBadgeEl)resDrvBadgeEl.innerHTML=badge?`<span class="res-badge${bCls}">${badge}</span>`:'';
  if(resVipBadgeEl)resVipBadgeEl.innerHTML=badge?`<span class="res-badge${bCls}">${badge}</span>`:'';
  ['cardDrv','cardVip'].forEach((id,i)=>{
    const el=document.getElementById(id);
    if(!el)return;
    const cls=useEligFilter?'fl-gold':i===0?'fl-blue':'fl-amber';
    el.classList.add(cls);setTimeout(()=>el.classList.remove(cls),1000);
  });
  setBusy(true);
  const ops=[
    sb.from('participants').update({driver_count:driver.driver_count+1}).eq('id',driver.id),
    sb.from('participants').update({vip_count:vip.vip_count+1}).eq('id',vip.id),
    sb.from('historique').insert({driver:driver.name,vip:vip.name,is_manual:false,is_present_draw:presentOnly,used_eligible:useEligFilter})
  ];
  if(isEligible(driver))ops.push(resetCoffres(driver.id));
  if(isEligible(vip))ops.push(resetCoffres(vip.id));
  await Promise.all(ops);setBusy(false);
}

function openManual(){
  document.getElementById('manualPlayers').innerHTML=participants.map(p=>`<input type="checkbox" class="manual-player" value="${p.id}" checked style="display:none">`).join('');
  refreshManualSelects();openModal('manualModal');
}

function refreshManualSelects(){
  const checked=[...document.querySelectorAll('.manual-player:checked')].map(el=>parseInt(el.value));
  const pool=participants.filter(p=>checked.includes(p.id));
  const opts=pool.map(p=>`<option value="${p.id}">${p.name}${isEligible(p)?' 🏆':''}</option>`).join('');
  document.getElementById('manDrv').innerHTML=opts||'<option>— aucun —</option>';
  document.getElementById('manVip').innerHTML=opts||'<option>— aucun —</option>';
  if(pool.length>1)document.getElementById('manVip').selectedIndex=1;
}

async function doManual(){
  const checked=[...document.querySelectorAll('.manual-player:checked')].map(el=>parseInt(el.value));
  if(checked.length<2){toast('Sélectionne au moins 2 joueurs');return;}
  const dId=parseInt(document.getElementById('manDrv').value);
  const vId=parseInt(document.getElementById('manVip').value);
  if(dId===vId){toast('Chauffeur et VIP doivent être différents !');return;}
  const driver=participants.find(p=>p.id===dId);
  const vip=participants.find(p=>p.id===vId);
  closeModal('manualModal');
  const resDrvEl=document.getElementById('resDrv');
  const resVipEl=document.getElementById('resVip');
  const resDrvBadgeEl=document.getElementById('resDrvBadge');
  const resVipBadgeEl=document.getElementById('resVipBadge');
  if(resDrvEl)resDrvEl.textContent=driver.name;
  if(resVipEl)resVipEl.textContent=vip.name;
  if(resDrvBadgeEl)resDrvBadgeEl.innerHTML='<span class="res-badge">Tirage personnalisé</span>';
  if(resVipBadgeEl)resVipBadgeEl.innerHTML='<span class="res-badge">Tirage personnalisé</span>';
  setBusy(true);
  const ops=[
    sb.from('participants').update({driver_count:driver.driver_count+1}).eq('id',dId),
    sb.from('participants').update({vip_count:vip.vip_count+1}).eq('id',vId),
    sb.from('historique').insert({driver:driver.name,vip:vip.name,is_manual:true,is_present_draw:false,used_eligible:false})
  ];
  if(isEligible(driver))ops.push(resetCoffres(dId));
  if(isEligible(vip))ops.push(resetCoffres(vId));
  await Promise.all(ops);toast('Tirage personnalisé enregistré !');setBusy(false);
}

async function archiveWeek(){
  if(!confirm(`Procéder aux 7 tirages de la semaine ?`))return;
  setBusy(true);
  await doWeeklyDraws();
  setBusy(false);
}

async function archiveWeekFromParticipants(){
  if(!isAdminOrStaff())return;
  const eligible=participants.filter(p=>isEligible(p));
  if(!confirm(`Archiver la semaine ?\n\n${eligible.length}/${participants.length} joueur(s) éligibles.\nLes coffres seront réinitialisés pour tout le monde.\n\nCette action est irréversible.`))return;
  setBusy(true);
  const now=new Date().toISOString();
  // Récupérer les réponses du sondage pour les archiver avec la semaine
  const {data:pollSnap} = await sb.from('tdd_poll').select('participant_id,response');
  const pollMap = {};
  (pollSnap||[]).forEach(r=>{ pollMap[r.participant_id]=r.response; });

  const ops=participants.map(p=>{
    const validated=isEligible(p);
    const days=getCoffres(p);
    const daysDone=days.filter(d=>d===false).length;
    return[
      sb.from('weeks_history').insert({
        participant_id:p.id,participant_name:p.name,
        validated,days_done:daysDone,
        coffres_snapshot:p.coffres_days,power_snapshot:p.power_t1||null,
        poll_response:pollMap[p.id]||null,
        archived_at:now
      }),
      validated
        ?sb.from('participants').update({weeks_validated:(p.weeks_validated||0)+1,coffres_days:JSON.stringify([false,false,false,false,false])}).eq('id',p.id)
        :sb.from('participants').update({coffres_days:JSON.stringify([false,false,false,false,false])}).eq('id',p.id)
    ];
  }).flat();
  await Promise.all(ops);
  toast(`Semaine archivée ! ${eligible.length} joueur(s) validé(s) ✅`);
  await loadDrawBuffer();
  setBusy(false);
}
async function saveRestorePoint(){
  if(!isAdmin())return;
  const nameInp=document.getElementById('restorePointName');
  const label=(nameInp&&nameInp.value.trim())||('Point du '+new Date().toLocaleString('fr-FR'));
  const{data:histData}=await sb.from('historique').select('*').order('created_at',{ascending:false});
  const{data:weeksData}=await sb.from('weeks_history').select('*').order('archived_at',{ascending:false});
  const{data:drawsData}=await sb.from('weekly_draws').select('*').order('week_start').order('day_index');
  const snap={
    label,
    participants:participants.map(p=>({...p})),
    historique:histData||[],
    weeks_history:weeksData||[],
    weekly_draws:drawsData||[],
    created_at:new Date().toISOString()
  };
  const{data:existing}=await sb.from('restore_points').select('id,created_at').order('created_at',{ascending:false});
  if(existing&&existing.length>=5){
    const toDelete=existing.slice(4).map(r=>r.id);
    await sb.from('restore_points').delete().in('id',toDelete);
  }
  await sb.from('restore_points').insert({
    snapshot:JSON.stringify(snap),
    created_at:snap.created_at,
    week_start:toLocalDateString(new Date())
  });
  if(nameInp)nameInp.value='';
  toast('Point de restauration créé 💾');
  loadRestorePoints();
}

async function loadRestorePoints(){
  const el=document.getElementById('restorePointsList');if(!el)return;
  const{data}=await sb.from('restore_points').select('*').order('created_at',{ascending:false});
  if(!data||data.length===0){el.innerHTML='<div class="restore-empty">Aucun point de restauration.</div>';return;}
  el.innerHTML=data.map((r,i)=>{
    const snap=JSON.parse(r.snapshot);
    const d=new Date(r.created_at).toLocaleString('fr-FR');
    const nbPart=snap.participants?snap.participants.length:0;
    const nbHist=snap.historique?snap.historique.length:0;
    const nbWeeks=snap.weeks_history?snap.weeks_history.length:0;
    return `<div class="restore-item">
      <div style="flex:1">
        <span class="restore-label">${snap.label||'Point #'+(i+1)}</span>
        <span class="restore-date" style="display:block;margin-top:2px">📅 ${d} · 👥 ${nbPart} participants · 🎲 ${nbHist} tirages · 📦 ${nbWeeks} semaines archivées</span>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-purple" style="font-size:11px;height:30px;padding:0 12px" onclick="restorePoint('${r.id}')">↩ Restaurer</button>
        <button class="btn" style="font-size:11px;height:30px;padding:0 10px;color:var(--red);border-color:rgba(255,107,107,0.2)" onclick="deleteRestorePoint('${r.id}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

async function deleteRestorePoint(id){
  if(!confirm('Supprimer ce point de restauration ?'))return;
  await sb.from('restore_points').delete().eq('id',id);
  toast('Point supprimé');
  loadRestorePoints();
}

async function restorePoint(id){
  if(!confirm('Restaurer ce point ?\n\nAttention : toutes les données actuelles (participants, tirages, historiques) seront remplacées par celles de ce point. Cette action est irréversible.'))return;
  if(!confirm('Dernière confirmation : écraser toutes les données actuelles ?'))return;
  setBusy(true);
  try{
    const{data,error}=await sb.from('restore_points').select('snapshot').eq('id',id).single();
    if(error||!data){toast('Point introuvable ❌');setBusy(false);return;}
    const snap=JSON.parse(data.snapshot);
    await Promise.all(snap.participants.map(p=>
      sb.from('participants').update({
        driver_count:p.driver_count,vip_count:p.vip_count,
        weeks_validated:p.weeks_validated,coffres_days:p.coffres_days,
        power_t1:p.power_t1||null
      }).eq('name',p.name)
    ));
    await sb.from('historique').delete().neq('id',0);
    if(snap.historique&&snap.historique.length>0){
      const histRows=snap.historique.map(({id:_,...h})=>h);
      await sb.from('historique').insert(histRows);
    }
    await sb.from('weeks_history').delete().neq('id',0);
    if(snap.weeks_history&&snap.weeks_history.length>0){
      const weeksRows=snap.weeks_history.map(({id:_,...w})=>w);
      await sb.from('weeks_history').insert(weeksRows);
    }
    await sb.from('weekly_draws').delete().neq('id',0);
    if(snap.weekly_draws&&snap.weekly_draws.length>0){
      const drawRows=snap.weekly_draws.map(({id:_,...d})=>d);
      await sb.from('weekly_draws').insert(drawRows);
    }
    toast('Restauration effectuée ✅');
    await loadAll();
    await loadWeeklyDraws();
  }catch(e){
    console.error('Erreur restauration',e);
    toast('Erreur lors de la restauration ❌');
  }finally{
    setBusy(false);
  }
}

async function doWeeklyDraws(){
  const{data:fresh}=await sb.from('participants').select('*');
  if(!fresh||fresh.length<2){toast('Pas assez de participants');return;}

  // ── Appliquer la mémoire tampon 48h (coffres de la semaine passée) ──
  const poolSource=applyDrawBuffer(fresh);
  const bufferActive=drawBuffer&&drawBuffer.length>0;

  const weekStart=getNextMonday();
  await sb.from('weekly_draws').delete().eq('week_start',weekStart);
  const draws=[];
  const usedDrivers=new Set();
  const usedVips=new Set();
  const usedAny=new Set();

  // ── Pool éligibles (ont fait leurs coffres) ──
  // Nouveau joueur (< 2 semaines d'historique) = toujours éligible
  const eligibles=poolSource.filter(p=>{
    const weeks=getPlayerWeeks(p);
    if(weeks.length<2) return true; // pas encore assez d'historique → éligible par défaut
    return isEligible(p);
  });
  const useEligPool=eligibles.length>=2;
  let pool=useEligPool?[...eligibles]:[...poolSource];

  // ── Calcul de la dette de tirages (équité proportionnelle) ──
  // Chaque joueur devrait avoir totalTirages/nbJoueurs tirages idéalement
  // Score de dette = tirages_du_joueur / totalTirages_guilde
  // Plus le score est bas → plus le joueur est prioritaire
  const totalDrivers=pool.reduce((s,p)=>s+(p.driver_count||0),0)||1;
  const totalVips=pool.reduce((s,p)=>s+(p.vip_count||0),0)||1;

  // Fonction de sélection équitable par dette
  // Si priorityModeActive : les joueurs is_priority ont un score divisé par le multiplicateur
  // → ils semblent avoir moins de tirages → priorité plus élevée
  function pickByDebt(candidates, countKey, totalCount){
    const scores=candidates.map(p=>({
      p,
      score: priorityModeActive && p.is_priority
        ? (p[countKey]||0) / totalCount / priorityMultiplier   // score réduit = plus prioritaire
        : (p[countKey]||0) / totalCount
    }));
    const minScore=Math.min(...scores.map(s=>s.score));
    const prioritized=scores.filter(s=>s.score<=minScore+0.01).map(s=>s.p);
    return prioritized[Math.floor(Math.random()*prioritized.length)];
  }

  // Compteurs locaux pour suivre les tirages de la semaine en cours
  let localDriverTotal=totalDrivers;
  let localVipTotal=totalVips;

  // Quand la priorité staff est active, on réserve au moins une journée
  // à chaque membre du staff (dans la limite des 7 jours), en commençant
  // par ceux qui ont le moins de tirages cumulés.
  const staffWaiting = priorityModeActive
    ? pool.filter(p=>p.is_priority).sort((a,b)=>{
        const sa=(a.driver_count||0)+(a.vip_count||0);
        const sb=(b.driver_count||0)+(b.vip_count||0);
        if(sa!==sb)return sa-sb;
        return (a.name||'').localeCompare(b.name||'');
      })
    : [];
  const staffScheduled = new Set();

  function pickForcedStaff(){
    const candidates=staffWaiting.filter(p=>!staffScheduled.has(p.id)&&!usedAny.has(p.id));
    return candidates.length ? candidates[0] : null;
  }

  for(let day=0;day<7;day++){
    const forcedStaff = pickForcedStaff();

    // ── Tirage du chauffeur ──
    // Si un membre du staff doit encore être assuré cette semaine,
    // on lui donne sa place dans le rôle où sa dette est la plus faible.
    let driver;
    if(forcedStaff){
      const driverDebt=(forcedStaff.driver_count||0)/localDriverTotal;
      const vipDebt=(forcedStaff.vip_count||0)/localVipTotal;
      if(driverDebt<=vipDebt){
        driver=forcedStaff;
      }
    }
    if(!driver){
      // Priorité 1 : pas encore tiré cette semaine (ni chauffeur ni VIP)
      let dPool=pool.filter(p=>!usedAny.has(p.id));
      // Priorité 2 : pas encore chauffeur cette semaine
      if(dPool.length<1) dPool=pool.filter(p=>!usedDrivers.has(p.id));
      // Priorité 3 : tout le pool
      if(dPool.length<1) dPool=[...pool];
      driver=pickByDebt(dPool,'driver_count',localDriverTotal);
    }

    // ── Tirage du VIP ──
    // Si un membre du staff doit être assuré et qu'il n'a pas été choisi
    // comme chauffeur, on le force en VIP.
    let forcedVip = forcedStaff && driver.id!==forcedStaff.id ? forcedStaff : null;
    let vip;
    if(forcedVip){
      vip=forcedVip;
    }else{
      // Si le chauffeur est staff, on conserve la règle historique :
      // éviter un second membre staff le même jour lorsque c'est possible.
      const driverIsStaff = priorityModeActive && driver.is_priority;
      const excludeStaff  = p => driverIsStaff && p.is_priority;

      // Priorité 1 : pas encore tiré cette semaine, hors chauffeur du jour (+ règle staff)
      let vPool=pool.filter(p=>p.id!==driver.id&&!usedAny.has(p.id)&&!excludeStaff(p));
      // Si pas assez sans la contrainte staff, on la retire temporairement
      if(vPool.length<1) vPool=pool.filter(p=>p.id!==driver.id&&!usedAny.has(p.id));
      // Priorité 2 : pas encore VIP cette semaine
      if(vPool.length<1) vPool=pool.filter(p=>p.id!==driver.id&&!usedVips.has(p.id)&&!excludeStaff(p));
      if(vPool.length<1) vPool=pool.filter(p=>p.id!==driver.id&&!usedVips.has(p.id));
      // Priorité 3 : tout le pool sauf chauffeur du jour
      if(vPool.length<1) vPool=pool.filter(p=>p.id!==driver.id&&!excludeStaff(p));
      if(vPool.length<1) vPool=pool.filter(p=>p.id!==driver.id);
      vip=pickByDebt(vPool,'vip_count',localVipTotal);
    }

    if(forcedStaff) staffScheduled.add(forcedStaff.id);
    if(priorityModeActive && driver.is_priority) staffScheduled.add(driver.id);
    if(priorityModeActive && vip.is_priority) staffScheduled.add(vip.id);

    draws.push({driver:driver.name,vip:vip.name,day});

    usedDrivers.add(driver.id);
    usedVips.add(vip.id);
    usedAny.add(driver.id);
    usedAny.add(vip.id);
    localDriverTotal++;
    localVipTotal++;

    pool=pool.map(p=>{
      if(p.id===driver.id)return{...p,driver_count:(p.driver_count||0)+1};
      if(p.id===vip.id)return{...p,vip_count:(p.vip_count||0)+1};
      return p;
    });
  }
   await sb.from('weekly_draws').insert(draws.map(d=>({week_start:weekStart,day_index:d.day,driver:d.driver,vip:d.vip})));

  // ── Ajout dans l'historique des tirages ──
  const histRows=draws.map(d=>({
    driver:d.driver,
    vip:d.vip,
    is_manual:false,
    is_present_draw:false,
    used_eligible:false,
    is_weekly:true,
    week_day:DAYS_LABELS_WEEK[d.day]
  }));
  await sb.from('historique').insert(histRows);

  const updateOps=[];
  fresh.forEach(orig=>{
    const updated=pool.find(p=>p.id===orig.id);
    if(updated&&(updated.driver_count!==orig.driver_count||updated.vip_count!==orig.vip_count)){
      updateOps.push(sb.from('participants').update({driver_count:updated.driver_count,vip_count:updated.vip_count}).eq('id',orig.id));
    }
  });
  if(updateOps.length)await Promise.all(updateOps);
  window._currentWeeklyDraws={draws,weekStart};
  document.getElementById('showWeeklyDrawsBtn').style.display='flex';
  toast(bufferActive?'7 tirages effectués avec les stats de la semaine passée ! 📦🎲':'7 tirages effectués pour la semaine ! 🎲');
}


function renderArchiveList(){
  const el=document.getElementById('archiveList');
  if(!el)return;
  if(!weeksHistory||!weeksHistory.length){
    el.innerHTML='<span class="empty">Aucune semaine archivée pour l\'instant.</span>';
    return;
  }
  const groups={};
  weeksHistory.forEach(w=>{
    const d=new Date(w.archived_at);
    const key=d.toISOString().slice(0,16);
    if(!groups[key])groups[key]=[];
    groups[key].push(w);
  });
  const sortedKeys=Object.keys(groups).sort((a,b)=>b.localeCompare(a));
  el.innerHTML=sortedKeys.map((key,idx)=>{
    const entries=groups[key];
    const date=new Date(key);
    const dateStr=date.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
    const timeStr=date.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    const validated=entries.filter(e=>e.validated).length;
    const notValidated=entries.length-validated;
    const weekNum=sortedKeys.length-idx;
    const playersHtml=entries
      .sort((a,b)=>a.participant_name.localeCompare(b.participant_name,'fr',{sensitivity:'base'}))
      .map(e=>{
        let days;
        try{days=JSON.parse(e.coffres_snapshot||'[false,false,false,false,false]')}
        catch{days=[false,false,false,false,false]}
        const dots=days.map((d,i)=>`<span title="${DAYS[i]}" style="width:16px;height:16px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;background:${d?'rgba(255,107,107,0.15)':'rgba(80,232,152,0.12)'};color:${d?'var(--red)':'var(--green)'};border:1px solid ${d?'rgba(255,107,107,0.2)':'rgba(80,232,152,0.2)'}">${d?'✗':'✓'}</span>`).join('');
        return `<div class="archive-player-row ${e.validated?'validated':'not-validated'}">
          <span style="flex:1;font-weight:600">${e.participant_name}</span>
          <div style="display:flex;gap:3px">${dots}</div>
          <span style="font-size:11px;min-width:60px;text-align:right;color:${e.validated?'var(--gold)':'var(--red)'};font-weight:700">${e.validated?'✓ Validée':'✗ '+e.days_done+'/5'}</span>
        </div>`;
      }).join('');
    return `<div class="archive-week-card">
      <div class="archive-week-header">
        <div class="archive-week-title">
          📅 Semaine #${weekNum}
          <span class="archive-week-date">${dateStr} à ${timeStr}</span>
        </div>
        ${isAdminOrStaff()?`<button class="btn-danger" style="height:32px;padding:0 12px;font-size:12px" onclick="deleteArchiveWeek('${key}')">🗑️ Supprimer</button>`:''}
      </div>
      <div class="archive-week-stats">
        <span class="archive-week-pill blue">${entries.length} joueur${entries.length>1?'s':''}</span>
        <span class="archive-week-pill gold">✓ ${validated} validée${validated>1?'s':''}</span>
        ${notValidated?`<span class="archive-week-pill red">✗ ${notValidated} non validée${notValidated>1?'s':''}</span>`:''}
      </div>
      <div class="archive-week-players">${playersHtml}</div>
    </div>`;
  }).join('');
}

async function deleteArchiveWeek(key){
  if(!confirm('Supprimer cette semaine archivée ?'))return;
  const entries=weeksHistory.filter(w=>new Date(w.archived_at).toISOString().slice(0,16)===key);
  const ids=entries.map(e=>e.id);
  if(!ids.length)return;
  await sb.from('weeks_history').delete().in('id',ids);
  toast('Semaine supprimée !');
}

function showCurrentWeeklyDraws(){
  if(!window._currentWeeklyDraws)return;
  const{draws,weekStart}=window._currentWeeklyDraws;
  openWeeklyModal(draws,weekStart,generateWeeklyText(draws,weekStart));
}

function generateWeeklyText(draws,weekStart){
  const weekEnd=new Date(weekStart);weekEnd.setDate(weekEnd.getDate()+6);
let txt='';
  draws.forEach(d=>{
    const day=d.day!==undefined?d.day:d.day_index;
    const dayName=DAYS_LABELS_WEEK[day]||`Jour ${day+1}`;
    txt+=`${dayName} - Chauffeur: ${d.driver} / VIP: ${d.vip}\n`;
  });
  txt=txt.trim();
  return txt.trim().slice(0, 500);
}

function openWeeklyModal(draws,weekStart,txt){
  document.getElementById('weeklyDrawVisual').innerHTML=draws.map(d=>{
    const day=d.day!==undefined?d.day:d.day_index;
    return `<div class="weekly-draw-item">
      <div class="weekly-draw-day">${DAYS_LABELS_WEEK[day]}</div>
      <div class="weekly-draw-names">
        <span class="weekly-badge-driver">Chauffeur</span>
        <span style="font-size:13px;font-weight:700">${d.driver}</span>
        <span style="color:var(--border2)">·</span>
        <span class="weekly-badge-vip">VIP</span>
        <span style="font-size:13px;font-weight:700">${d.vip}</span>
      </div>
    </div>`;
  }).join('');
  const ta=document.getElementById('weeklyDrawText');
  ta.value=txt;ta.removeAttribute('readonly');
  openModal('weeklyDrawModal');
}

function copyWeeklyText(){
  const txt=document.getElementById('weeklyDrawText').value;
  navigator.clipboard.writeText(txt).then(()=>toast('Texte copié !')).catch(()=>{
    const ta=document.getElementById('weeklyDrawText');ta.select();document.execCommand('copy');toast('Texte copié !');
  });
}


function getPlayerWeeks(p){return weeksHistory.filter(w=>w.participant_name===p.name).sort((a,b)=>new Date(a.archived_at)-new Date(b.archived_at));}
function getBestStreak(weeks){let best=0,cur=0;weeks.forEach(w=>{if(w.validated){cur++;best=Math.max(best,cur);}else cur=0;});return best;}
function getCurrentStreak(weeks){let cur=0;for(let i=weeks.length-1;i>=0;i--){if(weeks[i].validated)cur++;else break;}return cur;}
function getLastDrawDate(name,role){const f=history.find(h=>role==='driver'?h.driver===name:h.vip===name);return f?new Date(f.created_at):null;}


// ── Mémoire tampon 48h post-archivage ──────────────────────────────────────
async function loadDrawBuffer(){
  if(!sb)return;
  try{
    const cutoff=new Date(Date.now()-48*60*60*1000).toISOString();
    const{data}=await sb.from('weeks_history').select('*').gte('archived_at',cutoff).order('archived_at',{ascending:false});
    if(data&&data.length>0){
      const top=data[0].archived_at.slice(0,16);
      const batch=data.filter(w=>w.archived_at.slice(0,16)===top);
      drawBuffer=batch.length>0?batch:null;
    }else{drawBuffer=null;}
  }catch(e){console.warn('loadDrawBuffer:',e);drawBuffer=null;}
  renderBufferBanner();
}

function applyDrawBuffer(pool){
  if(!drawBuffer||!drawBuffer.length)return pool;
  return pool.map(p=>{
    const ae=drawBuffer.find(w=>w.participant_id===p.id);
    return ae?{...p,coffres_days:ae.coffres_snapshot}:p;
  });
}

function renderBufferBanner(){
  const el=document.getElementById('drawBufferBanner');
  if(!el)return;
  if(!drawBuffer||!drawBuffer.length){el.style.display='none';return;}
  const archDate=new Date(drawBuffer[0].archived_at);
  const expiresAt=new Date(archDate.getTime()+48*60*60*1000);
  const remainingMs=expiresAt-Date.now();
  if(remainingMs<=0){drawBuffer=null;el.style.display='none';return;}
  const remainingH=Math.ceil(remainingMs/(60*60*1000));
  const dateStr=archDate.toLocaleDateString('fr-FR',{weekday:'long',day:'2-digit',month:'long'});
  const timeStr=archDate.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  el.style.display='flex';
  el.innerHTML=`<span>📦</span><div><strong>Mémoire tampon active (${remainingH}h restantes)</strong>Les tirages utilisent les stats de la semaine archivée le ${dateStr} à ${timeStr} — seuls les joueurs éligibles de la semaine passée participent au pool.</div>`;
}
// ───────────────────────────────────────────────────────────────────────────

let statsSearchFilter='';
let currentStatsView='cards';
let lbSort='total';
let lbDir=-1;

function setStatSort(key,btn){
  statSort=key;
  document.querySelectorAll('.stats-sort-btn').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  renderStats();
}

function setStatsView(view){
  currentStatsView=view;
  ['podium','cards','leaderboard','reliability','graphiques','t1history'].forEach(v=>{
    const el=document.getElementById('statsView'+v.charAt(0).toUpperCase()+v.slice(1));
    const tab=document.getElementById('svt'+v.charAt(0).toUpperCase()+v.slice(1));
    if(el)el.style.display=v===view?'':'none';
    if(tab)tab.classList.toggle('active',v===view);
  });
  if(view==='t1history') loadT1History();
  if(view==='reliability') renderStatsReliability();
  if(view==='graphiques')  renderStatsGraphiques();
}

function onStatsSearch(inp){
  statsSearchFilter=inp.value.toLowerCase();
  document.getElementById('statsSearchClear').classList.toggle('show',statsSearchFilter.length>0);
  renderStatsCards();
}

function clearStatsSearch(){
  document.getElementById('statsSearchInp').value='';
  statsSearchFilter='';
  document.getElementById('statsSearchClear').classList.remove('show');
  renderStatsCards();
}

/* ── Calcul des joueurs sous la moyenne ────────────── */
function computeBelowAvg(){
  if(participants.length<3)return new Set();
  // Critère unique : taux de validation des coffres uniquement
  // (ne pas pénaliser les joueurs pas encore tirés au train/VIP)
  const withRate=participants.map(p=>{
    const w=getPlayerWeeks(p);
    return w.length>=2?w.filter(x=>x.validated).length/w.length:null;
  }).filter(x=>x!==null);
  if(withRate.length<3)return new Set(); // pas assez de données
  const avgRate=withRate.reduce((s,v)=>s+v,0)/withRate.length;
  const result=new Set();
  participants.forEach(p=>{
    const weeks=getPlayerWeeks(p);
    if(weeks.length<2)return; // pas assez d'historique
    const rate=weeks.filter(w=>w.validated).length/weeks.length;
    // Signaler uniquement si taux significativement sous la moyenne (>15 points d'écart)
    if(rate<avgRate-0.15)result.add(p.id);
  });
  return result;
}

/* ── Podium ─────────────────────────────────────────── */
function renderStatsPodium(){
  const el=document.getElementById('statsPodium');
  if(!el)return;
  if(!participants.length){el.innerHTML='';return;}
  const medal=(rank)=>['m1','m2','m3'][rank]||'m3';
  const medTxt=(rank)=>['🥇','🥈','🥉'][rank]||'';

  const mkPodium=(title,icon,color,items,valFn,unitFn)=>{
    const top3=items.slice(0,3);
    if(!top3.length)return'';
    const places=top3.map((item,i)=>`
      <div class="podium-place">
        <div class="podium-medal ${medal(i)}">${medTxt(i)}</div>
        <span class="podium-place-name">${item.name}</span>
        <span class="podium-place-val" style="color:${color}">${valFn(item)}${unitFn?unitFn(item):''}</span>
      </div>`).join('');
    return`<div class="podium-card">
      <div class="podium-card-header">
        <span style="font-size:16px">${icon}</span>
        <span class="podium-card-title" style="color:${color}">${title}</span>
      </div>
      <div class="podium-places">${places}</div>
    </div>`;
  };

  // Top Chauffeurs
  const topDrv=[...participants].sort((a,b)=>(b.driver_count||0)-(a.driver_count||0)).filter(p=>(p.driver_count||0)>0);
  // Top VIP
  const topVip=[...participants].sort((a,b)=>(b.vip_count||0)-(a.vip_count||0)).filter(p=>(p.vip_count||0)>0);
  // Top Puissance
  const topPow=[...participants].filter(p=>p.power_t1).sort((a,b)=>(b.power_t1||0)-(a.power_t1||0));
  // Top Taux validation (min 2 semaines)
  const topRate=[...participants].map(p=>{const w=getPlayerWeeks(p);const r=w.length>=2?Math.round(w.filter(x=>x.validated).length/w.length*100):null;return{...p,_rate:r};}).filter(p=>p._rate!==null).sort((a,b)=>b._rate-a._rate);
  // Meilleures séries actuelles
  const topStreak=[...participants].map(p=>{const w=getPlayerWeeks(p);return{...p,_streak:getCurrentStreak(w)};}).filter(p=>p._streak>0).sort((a,b)=>b._streak-a._streak);

  const podiumBlocks=[
    mkPodium('Top Chauffeurs','🚂','var(--blue)',topDrv,p=>p.driver_count||0,()=>' fois'),
    mkPodium('Top VIP','⭐','var(--amber)',topVip,p=>p.vip_count||0,()=>' fois'),
    mkPodium('Top Puissance','⚡','var(--cyan)',topPow,p=>t1FormatPower(p.power_t1),()=>''),
    mkPodium('Taux de validation','📈','var(--green)',topRate,p=>p._rate+'%',()=>''),
    mkPodium('Série en cours','🔥','var(--purple)',topStreak,p=>p._streak,()=>' sem.'),
  ].filter(Boolean).join('');
  el.innerHTML=!podiumBlocks
    ?`<div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:13px;font-style:italic">Pas encore de tirages archivés — le podium s'affichera après le premier tirage.</div>`
    :`<div class="stats-podium-grid">${podiumBlocks}</div>`;
}

/* ── Leaderboard ────────────────────────────────────── */
function renderLeaderboard(){
  const el=document.getElementById('statsLeaderboard');
  if(!el||!participants.length){if(el)el.innerHTML='';return;}
  const totalDrawsAll=participants.reduce((s,p)=>s+(p.driver_count||0)+(p.vip_count||0),0)||1;
  const maxPow=Math.max(...participants.map(p=>p.power_t1||0),1);
  const maxDrv=Math.max(...participants.map(p=>p.driver_count||0),1);
  const maxVip=Math.max(...participants.map(p=>p.vip_count||0),1);
  const belowAvg=computeBelowAvg();
  const data=participants.map(p=>{
    const w=getPlayerWeeks(p);
    const rate=w.length?Math.round(w.filter(x=>x.validated).length/w.length*100):null;
    const total=(p.driver_count||0)+(p.vip_count||0);
    const score=Math.round(((p.driver_count||0)/maxDrv+(p.vip_count||0)/maxVip+(rate||0)/100+(p.power_t1||0)/maxPow)/4*100);
    return{...p,_rate:rate,_total:total,_score:score,_weeks:w.length};
  });
  const dirs={name:1,power:-1,driver:-1,vip:-1,total:-1,rate:-1,score:-1};
  const colDir=dirs[lbSort]||lbDir;
  const sorted=[...data].sort((a,b)=>{
    if(lbSort==='name')return lbDir*a.name.localeCompare(b.name,'fr',{sensitivity:'base'});
    if(lbSort==='power')return lbDir*((b.power_t1||0)-(a.power_t1||0));
    if(lbSort==='driver')return lbDir*((b.driver_count||0)-(a.driver_count||0));
    if(lbSort==='vip')return lbDir*((b.vip_count||0)-(a.vip_count||0));
    if(lbSort==='total')return lbDir*(b._total-a._total);
    if(lbSort==='rate')return lbDir*((b._rate||0)-(a._rate||0));
    if(lbSort==='score')return lbDir*(b._score-a._score);
    return 0;
  });
  const th=(key,label)=>`<th onclick="lbSortBy('${key}')" class="${lbSort===key?'lb-sorted':''}">${label}<span class="lb-arrow">${lbSort===key?(lbDir===-1?'▼':'▲'):'⇅'}</span></th>`;
  const bar=(val,max,color)=>`<span class="lb-bar-wrap"><span class="lb-bar-fill" style="width:${Math.round(val/max*100)}%;background:${color};display:block;height:100%;border-radius:99px"></span></span>`;
  const rateColor=r=>r===null?'var(--text3)':r>=80?'var(--green)':r>=50?'var(--amber)':'var(--red)';
  const rows=sorted.map((p,i)=>{
    const rankCls=i===0?'r1':i===1?'r2':i===2?'r3':'';
    const belowDot=belowAvg.has(p.id)?'<span class="lb-below-dot" title="Sous la moyenne guilde"></span>':'';
    return`<tr>
      <td class="lb-rank ${rankCls}">${i===0?'🥇':i===1?'🥈':i===2?'🥉':'#'+(i+1)}</td>
      <td><span class="lb-name">${p.name}${belowDot}</span></td>
      <td class="lb-val" style="color:var(--cyan)">${p.power_t1?t1FormatPower(p.power_t1):'—'}${p.power_t1?bar(p.power_t1,maxPow,'var(--cyan)'):''}</td>
      <td class="lb-val" style="color:var(--blue)">${p.driver_count||0}${bar(p.driver_count||0,maxDrv,'var(--blue)')}</td>
      <td class="lb-val" style="color:var(--amber)">${p.vip_count||0}${bar(p.vip_count||0,maxVip,'var(--amber)')}</td>
      <td class="lb-val">${p._total}${bar(p._total,Math.max(...data.map(x=>x._total),1),'var(--purple)')}</td>
      <td class="lb-val" style="color:${rateColor(p._rate)}">${p._rate!==null?p._rate+'%':'—'}</td>
      <td class="lb-val" style="color:var(--gold);font-size:13px;font-weight:800">${p._score}</td>
    </tr>`;
  }).join('');
  el.innerHTML=`<div class="leaderboard-wrap"><table class="leaderboard-table">
    <thead><tr>
      <th style="width:40px">#</th>
      ${th('name','Joueur')}
      ${th('power','⚡ Puissance')}
      ${th('driver','🚂 Chauf.')}
      ${th('vip','⭐ VIP')}
      ${th('total','Total')}
      ${th('rate','📈 Taux')}
      ${th('score','★ Score')}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <div style="font-size:11px;color:var(--text3);margin-top:8px;padding:0 2px">
    <span style="display:inline-flex;align-items:center;gap:5px"><span class="lb-below-dot"></span> Sous la moyenne guilde sur 2+ indicateurs</span>
    <span style="margin-left:12px">★ Score = moyenne normalisée puissance + tirages + taux valid.</span>
  </div>`;
}

function lbSortBy(key){
  if(lbSort===key)lbDir*=-1;else{lbSort=key;lbDir=-1;}
  renderLeaderboard();
}

/* ── Cards (joueurs) ────────────────────────────────── */
function renderStatsCards(){
  const grid=document.getElementById('statsGrid');
  if(!grid)return;
  if(!participants.length){grid.innerHTML='<span class="empty">Aucun participant.</span>';return;}
  const maxDriver=Math.max(...participants.map(p=>p.driver_count||0),1);
  const maxVip=Math.max(...participants.map(p=>p.vip_count||0),1);
  const maxPower=Math.max(...participants.map(p=>p.power_t1||0),1);
  const totalDrawsAll=participants.reduce((s,p)=>s+(p.driver_count||0)+(p.vip_count||0),0)||1;
  const totalPower=participants.reduce((s,p)=>s+(p.power_t1||0),0);
  const sortedByPower=[...participants].filter(p=>p.power_t1).sort((a,b)=>(b.power_t1||0)-(a.power_t1||0));
  const belowAvg=computeBelowAvg();
  // Moyennes pour les nouveaux badges
  const avgDrv=participants.reduce((s,p)=>s+(p.driver_count||0),0)/participants.length;
  const avgVip=participants.reduce((s,p)=>s+(p.vip_count||0),0)/participants.length;
  let sorted=[...participants];
  if(statSort==='name')sorted.sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'}));
  else if(statSort==='power')sorted.sort((a,b)=>(b.power_t1||0)-(a.power_t1||0));
  else if(statSort==='driver')sorted.sort((a,b)=>(b.driver_count||0)-(a.driver_count||0));
  else if(statSort==='vip')sorted.sort((a,b)=>(b.vip_count||0)-(a.vip_count||0));

  else if(statSort==='rate'){sorted.sort((a,b)=>{const wa=getPlayerWeeks(a),wb=getPlayerWeeks(b);const ra=wa.length?wa.filter(w=>w.validated).length/wa.length:0,rb=wb.length?wb.filter(w=>w.validated).length/wb.length:0;return rb-ra;});}
  if(statsSearchFilter)sorted=sorted.filter(p=>p.name.toLowerCase().includes(statsSearchFilter));
  const fmtDate=d=>d?d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'}):'Jamais';
  const maxDriverCount=Math.max(...participants.map(x=>x.driver_count||0));
  const maxVipCount=Math.max(...participants.map(x=>x.vip_count||0));
  grid.innerHTML=sorted.map(p=>{
    const weeks=getPlayerWeeks(p);const totalWeeks=weeks.length;
    const validatedWeeks=weeks.filter(w=>w.validated).length;
    const validRate=totalWeeks>0?Math.round(validatedWeeks/totalWeeks*100):null;
    const bestStreak=getBestStreak(weeks);const currentStreak=getCurrentStreak(weeks);
    const totalPart=(p.driver_count||0)+(p.vip_count||0);
    const shareOfDraws=Math.round(totalPart/totalDrawsAll*100);
    const powerRank=sortedByPower.findIndex(x=>x.id===p.id);
    const powerPct=maxPower>0?Math.round((p.power_t1||0)/maxPower*100):0;
    const powerShare=totalPower>0?Math.round((p.power_t1||0)/totalPower*100):0;
    const lastDriver=getLastDrawDate(p.name,'driver');const lastVip=getLastDrawDate(p.name,'vip');
    const isBelowAvg=belowAvg.has(p.id);
    let rankHtml='';
    if(powerRank===0)rankHtml='<span class="stat-card-rank r1">🥇 #1</span>';
    else if(powerRank===1)rankHtml='<span class="stat-card-rank r2">🥈 #2</span>';
    else if(powerRank===2)rankHtml='<span class="stat-card-rank r3">🥉 #3</span>';
    else if(powerRank>2)rankHtml=`<span class="stat-card-rank r2">#${powerRank+1}</span>`;
    // Badges existants
    const badges=[];
    if(isEligible(p))badges.push('<span class="stat-badge gold">🏆 Éligible</span>');
    if(currentStreak>=3)badges.push(`<span class="stat-badge green">🔥 Série ${currentStreak}</span>`);
    if(bestStreak>=5)badges.push(`<span class="stat-badge gold">⭐ Record ${bestStreak}</span>`);
    if(p.driver_count===maxDriverCount&&p.driver_count>0)badges.push('<span class="stat-badge blue">🚂 Top Chauffeur</span>');
    if(p.vip_count===maxVipCount&&p.vip_count>0)badges.push('<span class="stat-badge amber">★ Top VIP</span>');
    if(validRate===100&&totalWeeks>=3)badges.push('<span class="stat-badge green">✓ Parfait</span>');
    
    // Nouveaux badges
    if((p.driver_count||0)===0&&(p.vip_count||0)===0&&totalWeeks>=2)badges.push('<span class="stat-badge red">⚡ Jamais tiré</span>');
    else if((p.driver_count||0)===0&&(p.vip_count||0)>0)badges.push('<span class="stat-badge amber">🚂 Jamais chauf.</span>');
    else if((p.vip_count||0)===0&&(p.driver_count||0)>0)badges.push('<span class="stat-badge amber">⭐ Jamais VIP</span>');
    if(bestStreak>0&&bestStreak===totalWeeks&&totalWeeks>=4)badges.push(`<span class="stat-badge gold">💎 Série parfaite</span>`);
    if(isBelowAvg)badges.push('<span class="stat-badge red">📦 Coffres insuffisants</span>');
    const last10=weeks.slice(-10);
    const streakDots=last10.map(w=>`<span class="stat-streak-dot ${w.validated?'ok':'ko'}"></span>`).join('');
    const vr=validRate!==null?validRate:0;
    const vrColor=validRate===null?'var(--text3)':validRate>=80?'var(--green)':validRate>=50?'var(--amber)':'var(--red)';
    const vrBar=validRate===null?'green':validRate>=80?'green':validRate>=50?'amber':'red';
    const weekRows=weeks.length
      ?[...weeks].reverse().slice(0,10).map((w,i)=>{
          const d=w.archived_at?new Date(w.archived_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}):'';
          let days;try{days=JSON.parse(w.coffres_snapshot||'[false,false,false,false,false]')}catch{days=[false,false,false,false,false]}
          const dots=days.map(d=>`<span class="week-day-dot${d?'':' done'}"></span>`).join('');
          return `<div class="week-row ${w.validated?'validated':'not-validated'}"><span class="week-num">S${weeks.length-i}</span><div class="week-days-mini">${dots}</div><span>${w.validated?'✓ Validée':'✗ '+w.days_done+'/5'}</span><span style="font-size:10px;opacity:.7">${d}</span></div>`;
        }).join('')
      :'<div style="font-size:11px;color:var(--text3);padding:4px 0;font-style:italic">Pas encore de semaine archivée</div>';
    const belowBadge=isBelowAvg?`<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(255,107,107,0.06);border-bottom:1px solid rgba(255,107,107,0.12);font-size:11px;color:var(--red);font-weight:600;border-radius:0"><span>📉</span> Joueur sous la moyenne guilde — à accompagner</div>`:'';
    return `<div class="stat-card${isBelowAvg?' below-avg':''}">
      ${belowBadge}
      <div class="stat-card-header">
        <div class="stat-card-name">${p.name}${p.power_t1?rankHtml:''}</div>
        ${p.power_t1?`<span class="stat-card-power">⚡ ${t1FormatPower(p.power_t1)}</span>`:'<span style="font-size:11px;color:var(--text3)">—</span>'}
      </div>
      <div class="stat-rows">
        <div class="stat-section-title">⚡ Puissance</div>
        ${p.power_t1?`
        <div class="stat-row"><span class="stat-row-label">Puissance T1</span><span class="stat-row-val">${t1FormatPower(p.power_t1)}</span><div class="stat-bar-wrap"><div class="stat-bar blue" style="width:${powerPct}%"></div></div></div>
        <div class="stat-row"><span class="stat-row-label">% de la guilde</span><span class="stat-row-val">${powerShare}%</span><div class="stat-bar-wrap"><div class="stat-bar blue" style="width:${powerShare}%"></div></div></div>
        <div class="stat-row"><span class="stat-row-label">Rang puissance</span><span class="stat-row-val" style="color:var(--gold)">${powerRank>=0?'#'+(powerRank+1):'—'}</span></div>`
        :'<div style="font-size:12px;color:var(--text3);font-style:italic">Aucune puissance renseignée</div>'}
        <div class="stat-section-title">🎯 Tirages</div>
        <div class="stat-row"><span class="stat-row-label">🚂 Chauffeur</span><span class="stat-row-val${(p.driver_count||0)<avgDrv*0.7?' '+vrBar:''}" style="${(p.driver_count||0)<avgDrv*0.7?'color:var(--red)':''}">${p.driver_count||0}</span><div class="stat-bar-wrap"><div class="stat-bar blue" style="width:${Math.round((p.driver_count||0)/maxDriver*100)}%"></div></div></div>
        <div class="stat-row"><span class="stat-row-label">⭐ VIP</span><span class="stat-row-val" style="${(p.vip_count||0)<avgVip*0.7?'color:var(--red)':''}">${p.vip_count||0}</span><div class="stat-bar-wrap"><div class="stat-bar amber" style="width:${Math.round((p.vip_count||0)/maxVip*100)}%"></div></div></div>
        <div class="stat-row"><span class="stat-row-label">Total participations</span><span class="stat-row-val">${totalPart}</span><div class="stat-bar-wrap"><div class="stat-bar purple" style="width:${shareOfDraws}%"></div></div></div>
        <div class="stat-row"><span class="stat-row-label">Dernier Chauffeur</span><span class="stat-row-val" style="font-size:10px;min-width:60px">${fmtDate(lastDriver)}</span></div>
        <div class="stat-row"><span class="stat-row-label">Dernier VIP</span><span class="stat-row-val" style="font-size:10px;min-width:60px">${fmtDate(lastVip)}</span></div>
        <div class="stat-section-title">🏆 Coffres & Éligibilité</div>

        <div class="stat-row"><span class="stat-row-label">Semaines validées</span><span class="stat-row-val">${validatedWeeks}/${totalWeeks}</span><div class="stat-bar-wrap"><div class="stat-bar green" style="width:${vr}%"></div></div></div>
        <div class="stat-row"><span class="stat-row-label">Taux de validation</span><span class="stat-row-val" style="color:${vrColor}">${validRate!==null?validRate+'%':'—'}</span><div class="stat-bar-wrap"><div class="stat-bar ${vrBar}" style="width:${vr}%"></div></div></div>
        <div class="stat-row"><span class="stat-row-label">Meilleure série</span><span class="stat-row-val" style="color:var(--gold)">${bestStreak} sem.</span></div>
        <div class="stat-row"><span class="stat-row-label">Série actuelle</span><span class="stat-row-val" style="color:${currentStreak>=3?'var(--green)':'var(--text2)'}">${currentStreak} sem.</span></div>
        ${last10.length?`<div style="margin-top:6px"><div style="font-size:10px;color:var(--text3);margin-bottom:4px;font-weight:600;letter-spacing:.05em;text-transform:uppercase">10 dernières semaines</div><div class="stat-streak">${streakDots}</div></div>
        <div class="stat-section-title">📅 Historique (${totalWeeks} semaine${totalWeeks>1?'s':''})</div>
        <div class="week-hist">${weekRows}</div>`:''}
      </div>
      ${badges.length?`<div class="stat-badge-row">${badges.join('')}</div>`:''}
      ${isAdminOrStaff()?`<div style="padding:10px 14px 14px"><div class="stat-section-title" style="margin-top:0;padding-top:0;border-top:none">📝 Note interne</div><textarea id="note_${p.id}" placeholder="Note visible uniquement par admin/staff..." onblur="savePlayerNote(${p.id},this.value)" style="width:100%;min-height:48px;resize:vertical;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:7px 10px;font-family:inherit;font-size:12px;color:var(--text);box-sizing:border-box;outline:none;transition:border-color .2s" onfocus="this.style.borderColor='var(--blue)'" onblur="this.style.borderColor='var(--border)';savePlayerNote(${p.id},this.value)">${(p.note||'').replace(/</g,'&lt;')}</textarea></div>`:''}
    </div>`;
  }).join('');
  if(!sorted.length)grid.innerHTML=`<div style="padding:20px;color:var(--text3);font-style:italic;font-size:13px">Aucun joueur pour "${statsSearchFilter}".</div>`;
}

/* ── renderStats : point d'entrée ── */
function renderStats(){
  const globalEl=document.getElementById('statsGlobal');
  if(!participants.length){
    document.getElementById('statsGrid').innerHTML='<span class="empty">Aucun participant.</span>';
    globalEl.innerHTML='';
    return;
  }
  const totalDraws=history.length;
  const eligCount=participants.filter(p=>isEligible(p)).length;
  const pwP=participants.filter(p=>p.power_t1).sort((a,b)=>a.power_t1-b.power_t1);
  const avgPower=pwP.length?Math.round(pwP.reduce((s,p)=>s+(p.power_t1||0),0)/pwP.length):0;
  const totalPower=participants.reduce((s,p)=>s+(p.power_t1||0),0);
  const medianPower=pwP.length?pwP[Math.floor(pwP.length/2)].power_t1:0;
  const totalWeeksArchived=new Set(weeksHistory.map(w=>w.archived_at?w.archived_at.slice(0,10):'')).size;
  const withRate=participants.map(p=>{const w=getPlayerWeeks(p);return w.length?Math.round(w.filter(x=>x.validated).length/w.length*100):null;}).filter(x=>x!==null);
  const avgRate=withRate.length?Math.round(withRate.reduce((s,v)=>s+v,0)/withRate.length):null;
  globalEl.innerHTML=[
    {val:participants.length,lbl:'Joueurs'},{val:totalDraws,lbl:'Tirages'},
    {val:eligCount,lbl:'Éligibles 🏆'},
    {val:totalWeeksArchived||'—',lbl:'Semaines archivées'},
    {val:avgPower?(avgPower/1e6).toFixed(2)+'M':'—',lbl:'Puissance moy.'},
    {val:medianPower?(medianPower/1e6).toFixed(2)+'M':'—',lbl:'Puissance médiane'},
    {val:totalPower?(totalPower>=1e9?(totalPower/1e9).toFixed(2)+'G':(totalPower/1e6).toFixed(2)+'M'):'—',lbl:'Puissance totale'},
    {val:avgRate!==null?avgRate+'%':'—',lbl:'Taux valid. moy.'},
  ].map(({val,lbl})=>`<div class="stats-global-card"><div class="stats-global-val">${val}</div><div class="stats-global-lbl">${lbl}</div></div>`).join('');
  renderStatsPodium();
  renderStatsCards();
  renderLeaderboard();
}


/* ══════════════════════════════════════════════════════
   GRAPHIQUES STATS — canvas natif, aucune dépendance
   ══════════════════════════════════════════════════════ */


/* ══════════════════════════════════════════════════════
   FIABILITÉ v3 — Calcul affiné
   ══════════════════════════════════════════════════════

   Formule (3 composantes) :
   ┌─ Coffres pondérés (70%) ──────────────────────────┐
   │  Semaines récentes comptent davantage (expo -0.15)│
   │  → mesure la régularité ACTUELLE                  │
   ├─ Puissance T1 relative (15%) ─────────────────────┤
   │  Puissance du joueur vs moyenne de la guilde      │
   │  → récompense les joueurs forts                   │
   ├─ Tendance (15%) ──────────────────────────────────┤
   │  Dernière semaine vs précédente                   │
   │  → bonus si progression, malus si régression      │
   └───────────────────────────────────────────────────┘
   Joueurs < 2 semaines : score null = "Données insuffisantes"
   ══════════════════════════════════════════════════════ */

function computeReliabilityScore(p){
  const weeks = getPlayerWeeks(p);
  if(weeks.length < 2) return null;

  // ── 1. Coffres pondérés (70%) ─────────────────────────
  let weightedValid = 0, weightedTotal = 0;
  weeks.forEach((w, i) => {
    const weight = Math.exp(-0.15 * (weeks.length - 1 - i));
    weightedTotal += weight;
    if(w.validated) weightedValid += weight;
  });
  const coffresScore = weightedTotal > 0 ? weightedValid / weightedTotal : 0;

  // ── 2. Puissance T1 relative (15%) ────────────────────
  // Compare la puissance du joueur à la moyenne de la guilde
  // Neutre (0.5) si pas de puissance renseignée
  const playerPow = p.power_t1 || 0;
  let powerScore = 0.5;
  if(playerPow > 0){
    const allPow = participants.map(x=>x.power_t1||0).filter(x=>x>0);
    const avgPow = allPow.length ? allPow.reduce((s,v)=>s+v,0)/allPow.length : 1;
    // Score : 0.5 à la moyenne, 1.0 à 2× la moyenne, 0 à 0
    powerScore = Math.max(0, Math.min(1, playerPow / (avgPow * 2)));
  }

  // ── 3. Tendance (15%) ─────────────────────────────────
  let trendScore = 0.5;
  if(weeks.length >= 2){
    const diff = (weeks[weeks.length-1].validated?1:0) - (weeks[weeks.length-2].validated?1:0);
    trendScore = Math.max(0, Math.min(1, 0.5 + diff * 0.5));
  }

  return Math.round((coffresScore*0.70 + powerScore*0.15 + trendScore*0.15) * 100);
}

// Détail lisible pour l'affichage admin
function computeReliabilityDetail(p){
  const weeks = getPlayerWeeks(p);
  if(weeks.length < 2) return null;

  // Coffres
  let wValid=0, wTotal=0;
  weeks.forEach((w,i)=>{ const wt=Math.exp(-0.15*(weeks.length-1-i)); wTotal+=wt; if(w.validated)wValid+=wt; });
  const coffres = wTotal>0?wValid/wTotal:0;

  // Puissance
  const playerPow = p.power_t1||0;
  let powerScore = 0.5;
  if(playerPow>0){
    const allPow=participants.map(x=>x.power_t1||0).filter(x=>x>0);
    const avgPow=allPow.length?allPow.reduce((s,v)=>s+v,0)/allPow.length:1;
    powerScore=Math.max(0,Math.min(1,playerPow/(avgPow*2)));
  }
  const avgPowGuilde = (()=>{ const a=participants.map(x=>x.power_t1||0).filter(x=>x>0); return a.length?Math.round(a.reduce((s,v)=>s+v,0)/a.length):0; })();

  // Tendance
  let trend=0.5, trendLabel='→ Insuffisant';
  if(weeks.length>=2){
    const d=(weeks[weeks.length-1].validated?1:0)-(weeks[weeks.length-2].validated?1:0);
    trend=Math.max(0,Math.min(1,0.5+d*0.5));
    trendLabel=d>0?'↑ En progression':d<0?'↓ En régression':'→ Stable';
  }

  return {
    coffres:   Math.round(coffres*100),
    power:     Math.round(powerScore*100),
    powerRaw:  playerPow,
    avgPow:    avgPowGuilde,
    trend:     Math.round(trend*100),
    trendLabel,
    weeks:     weeks.length,
    noPower:   playerPow===0,
  };
}

let _reliabilitySort = 'score'; // 'score' | 'coffres' | 'power' | 'trend'

function setReliabilitySort(key){
  _reliabilitySort = key;
  renderStatsReliability();
}

function renderStatsReliability(){
  const el=document.getElementById('statsReliabilityContainer');
  if(!el)return;

  const allScored = participants.map(p=>({...p, score:computeReliabilityScore(p), detail:computeReliabilityDetail(p)}));
  let scored = allScored.filter(p=>p.score!==null);
  const insufficient = allScored.filter(p=>p.score===null);

  // Tri selon la sélection
  if(_reliabilitySort==='coffres')
    scored.sort((a,b)=>(b.detail?.coffres||0)-(a.detail?.coffres||0));
  else if(_reliabilitySort==='power')
    scored.sort((a,b)=>(b.power_t1||0)-(a.power_t1||0));
  else if(_reliabilitySort==='trend')
    scored.sort((a,b)=>(b.detail?.trend||0)-(a.detail?.trend||0));
  else
    scored.sort((a,b)=>b.score-a.score);

  const getColor = s => s>=80?'#4FD1A5':s>=60?'#FFB84D':'#FF6B6B';
  const avg = scored.length?Math.round(scored.reduce((s,p)=>s+p.score,0)/scored.length):0;
  const top = scored.filter(p=>p.score>=80).length;
  const mid = scored.filter(p=>p.score>=60&&p.score<80).length;
  const low = scored.filter(p=>p.score<60).length;
  const fmtPow = v => v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'k':v||'—';

  const sortBtns = [
    {key:'score',   lbl:'Score'},
    {key:'coffres', lbl:'📦 Coffres'},
    {key:'power',   lbl:'⚡ Puissance'},
    {key:'trend',   lbl:'📈 Tendance'},
  ];

  el.innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin:4px 0 14px">
      ${[{val:avg+'%',lbl:'Score moyen guilde',color:'var(--blue)'},{val:top,lbl:'🟢 Fiables (≥80)',color:'#4FD1A5'},{val:mid,lbl:'🟡 Moyens (60-79)',color:'#FFB84D'},{val:low,lbl:'🔴 À risque (<60)',color:'#FF6B6B'}]
        .map(({val,lbl,color})=>`<div class="stats-global-card"><div class="stats-global-val" style="color:${color}">${val}</div><div class="stats-global-lbl">${lbl}</div></div>`).join('')}
    </div>

    <!-- Tri par item -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <span style="font-size:11px;font-weight:700;color:var(--text3)">Trier par</span>
      ${sortBtns.map(b=>`<button onclick="setReliabilitySort('${b.key}')" style="height:28px;padding:0 12px;border:1px solid ${_reliabilitySort===b.key?'var(--blue)':'var(--border2)'};border-radius:99px;background:${_reliabilitySort===b.key?'rgba(124,159,255,0.12)':'transparent'};color:${_reliabilitySort===b.key?'var(--blue)':'var(--text3)'};font-size:11px;font-weight:700;cursor:pointer;transition:all .15s">${b.lbl}</button>`).join('')}
    </div>

    <details style="margin-bottom:12px;font-size:11px;color:var(--text3);cursor:pointer">
      <summary style="font-weight:700;letter-spacing:.03em;user-select:none">ℹ️ Comment est calculé ce score ?</summary>
      <div style="margin-top:8px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);line-height:1.7">
        <b style="color:var(--text)">70% Coffres pondérés</b> — Les semaines récentes comptent davantage. Critère principal.<br>
        <b style="color:var(--text)">15% Puissance T1</b> — Puissance du joueur vs moyenne de la guilde. Score max à 2× la moyenne.<br>
        <b style="color:var(--text)">15% Tendance</b> — Dernière semaine vs précédente. ↑ progression, ↓ régression.
      </div>
    </details>

    <div style="display:flex;flex-direction:column;gap:6px">
      ${scored.map((p,i)=>{
        const d=p.detail;
        const trendIcon=d.trendLabel?d.trendLabel.slice(0,1):'→';
        const trendColor=trendIcon==='↑'?'#4FD1A5':trendIcon==='↓'?'#FF6B6B':'#FFB84D';
        const adminDetail = isAdmin() ? `
          <div style="display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--border)">
            ${[
              {lbl:'📦 Coffres',    val:d.coffres+'%',      note:'(pondéré)'},
              {lbl:'⚡ Puissance',  val:d.noPower?'—':fmtPow(d.powerRaw), note:d.noPower?'non renseignée':`moy. ${fmtPow(d.avgPow)}`},
              {lbl:'📈 Tendance',   val:trendIcon,           note:d.trendLabel||''},
            ].map(({lbl,val,note})=>`
              <div style="padding:7px 10px;border-right:1px solid var(--border)">
                <div style="font-size:10px;color:var(--text3);margin-bottom:2px">${lbl}</div>
                <div style="font-size:12px;font-weight:700;color:var(--text);font-family:var(--font-mono)">${val}</div>
                <div style="font-size:9px;color:var(--text3);opacity:.7">${note}</div>
              </div>`).join('')}
          </div>` : '';
        return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;transition:border-color .2s" onmouseover="this.style.borderColor='var(--border2)'" onmouseout="this.style.borderColor='var(--border)'">
          <div style="display:flex;align-items:center;gap:10px;padding:10px 14px">
            <span style="width:24px;text-align:center;font-size:12px;font-weight:800;color:var(--text3);font-family:var(--font-mono)">${i+1}</span>
            <span style="flex:1;font-weight:700;font-size:13px;color:var(--text)">${p.name}</span>
            <span title="${d.trendLabel||'Tendance'}" style="font-size:14px;font-weight:800;color:${trendColor}">${trendIcon}</span>
            <div style="position:relative;width:100px;height:7px;background:var(--border);border-radius:99px;overflow:hidden">
              <div style="position:absolute;left:0;top:0;height:100%;width:${p.score}%;background:${getColor(p.score)};border-radius:99px;transition:width .5s ease"></div>
            </div>
            <span style="width:36px;text-align:right;font-size:14px;font-weight:800;font-family:var(--font-mono);color:${getColor(p.score)}">${p.score}%</span>
          </div>
          ${adminDetail}
        </div>`;
      }).join('')}
      ${insufficient.length?`
        <div style="margin-top:12px;padding:10px 14px;background:var(--surface);border:1px dashed var(--border);border-radius:var(--radius-lg)">
          <div style="font-size:11px;font-weight:700;color:var(--text3);margin-bottom:8px">⏳ Données insuffisantes (< 2 semaines archivées)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${insufficient.map(p=>`<span style="font-size:12px;padding:3px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:99px;color:var(--text2)">${p.name}</span>`).join('')}
          </div>
        </div>`:''}
    </div>`;
}


/* ══════════════════════════════════════════════════════
   CONSTRUCTEUR DE GRAPHIQUES — Onglet Graphiques
   ══════════════════════════════════════════════════════ */

// ── Définition des axes disponibles ──────────────────────────────────────




let _chartBuilderState = {
  xAxis:    'players',
  yAxis:    'power_t1',
  chartType:'hbar',
  filter:   'all',
  sortBy:   'desc',
  topN:     15,      // 15 joueurs par défaut pour garder des libellés lisibles
  groupSim: false,   // regrouper les valeurs similaires
  simPct:   1,       // seuil de similitude en %
  chartInst: null,
};

// ── Données calculées selon les sélections ────────────────────────────────
function getChartData(){
  const s = _chartBuilderState;

  if(s.xAxis === 'players'){
    // Filtrer les joueurs selon le filtre
    let pts = [...participants];
    if(s.filter === 'staff')    pts = pts.filter(p=>p.is_priority);
    if(s.filter === 'members')  pts = pts.filter(p=>!p.is_priority);
    if(s.filter === 'eligible') pts = pts.filter(p=>isEligible(p));

    // Calculer la valeur Y pour chaque joueur
    pts = pts.map(p=>{
      let val = null;
      if(s.yAxis === 'total_draws')   val = (p.driver_count||0)+(p.vip_count||0);
      else if(s.yAxis === 'reliability') val = computeReliabilityScore(p);
      else if(s.yAxis === 'trend'){
        const d = computeReliabilityDetail(p);
        val = d ? (d.trendLabel==='↑ En progression'?1:d.trendLabel==='↓ En régression'?-1:0) : null;
      }
      else val = p[s.yAxis] || 0;
      return {label: p.name, value: val, isPriority: p.is_priority};
    }).filter(d=>d.value!==null);

    // Trier
    if(s.sortBy==='desc')  pts.sort((a,b)=>b.value-a.value);
    if(s.sortBy==='asc')   pts.sort((a,b)=>a.value-b.value);
    if(s.sortBy==='name')  pts.sort((a,b)=>a.label.localeCompare(b.label));
    if(s.sortBy==='power'){
      // Trier par groupe de puissance T1 puis par valeur dans chaque groupe
      // Groupes : < 1M / 1M-2M / 2M-5M / 5M-10M / > 10M
      const powerGroup = p => {
        const pow = (participants.find(x=>x.name===p.label)||{}).power_t1 || 0;
        if(pow < 1e6)  return 0;
        if(pow < 2e6)  return 1;
        if(pow < 5e6)  return 2;
        if(pow < 10e6) return 3;
        return 4;
      };
      pts.sort((a,b)=> powerGroup(b)-powerGroup(a) || b.value-a.value);
    }

    // Limiter au top N
    if(s.topN > 0) pts = pts.slice(0, s.topN);

    // Regrouper les valeurs similaires
    if(s.groupSim && pts.length > 3){
      const threshold = s.simPct / 100;
      const maxVal = Math.max(...pts.map(p=>p.value), 1);
      const grouped = [];
      let bucket = [];
      pts.forEach((p, i) => {
        if(bucket.length === 0){
          bucket.push(p);
        } else {
          const diff = Math.abs(p.value - bucket[0].value) / maxVal;
          if(diff <= threshold) {
            bucket.push(p);
          } else {
            if(bucket.length >= 3){
              const avg = Math.round(bucket.reduce((s,x)=>s+x.value,0)/bucket.length);
              grouped.push({label:`${bucket.length} joueurs (~${avg})`, value:avg, isPriority:false, isGroup:true});
            } else {
              grouped.push(...bucket);
            }
            bucket = [p];
          }
        }
      });
      if(bucket.length >= 3){
        const avg = Math.round(bucket.reduce((s,x)=>s+x.value,0)/bucket.length);
        grouped.push({label:`${bucket.length} joueurs (~${avg})`, value:avg, isPriority:false, isGroup:true});
      } else {
        grouped.push(...bucket);
      }
      pts = grouped;
    }

    // Calcul des groupes de puissance pour séparation visuelle
    const PWR_LABELS = ['< 1M','1-2M','2-5M','5-10M','> 10M'];
    const getPowerGroup = name => {
      const pow = (participants.find(x=>x.name===name)||{}).power_t1||0;
      if(pow<1e6) return 0; if(pow<2e6) return 1;
      if(pow<5e6) return 2; if(pow<10e6) return 3; return 4;
    };
    const powerGroups = s.sortBy==='power' ? pts.map(d=>getPowerGroup(d.label)) : null;

    return {
      labels:      pts.map(d=>d.label),
      values:      pts.map(d=>d.value),
      colors:      pts.map(d=>d.isGroup?'rgba(124,159,255,0.45)':d.isPriority?'#FFB84D':CHART_COLORS[0]),
      powerGroups, // null si tri non par puissance
      PWR_LABELS,
    };
  }

  return {labels:[], values:[], colors:[]};
}

// ── Rendu principal ───────────────────────────────────────────────────────
function renderStatsGraphiques(){
  const el = document.getElementById('statsGraphiquesContainer');
  if(!el) return;

  const isDark = !document.body.classList.contains('light');
  const TEXT  = isDark?'rgba(255,255,255,0.8)':'rgba(0,0,0,0.75)';
  const TEXT2 = isDark?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.3)';
  const GRID  = isDark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.07)';
  const BG    = isDark?'#0f111a':'#ffffff';

  // Axes Y disponibles
  const yAxes = CHART_AXES.y;
  if(!yAxes.find(a=>a.key===_chartBuilderState.yAxis)){
    _chartBuilderState.yAxis = yAxes[0].key;
  }
  const yGroups = {};
  yAxes.forEach(a=>{ if(!yGroups[a.group]) yGroups[a.group]=[]; yGroups[a.group].push(a); });
  const compatTypes = CHART_TYPES;

  el.innerHTML = `
    <div class="lw-stats-chart-layout">

      <!-- Panneau de configuration -->
      <div class="lw-stats-chart-controls">

        <!-- Type de graphique -->
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Type</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
            ${compatTypes.map(t=>`
              <button onclick="chartBuilderSet('chartType','${t.key}')" style="padding:6px 4px;border:1px solid ${_chartBuilderState.chartType===t.key?'var(--blue)':'var(--border)'};border-radius:var(--radius-lg);background:${_chartBuilderState.chartType===t.key?'rgba(124,159,255,0.12)':'var(--surface2)'};color:${_chartBuilderState.chartType===t.key?'var(--blue)':'var(--text2)'};font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;gap:4px">
                <span style="font-size:14px">${t.icon}</span>${t.label}
              </button>`).join('')}
          </div>
        </div>



        <!-- Axe Y -->
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Valeur Y</div>
          ${Object.entries(yGroups).map(([grp, axes])=>`
            <div style="font-size:9px;color:var(--text3);margin:6px 0 3px;font-weight:700">${grp}</div>
            <div style="display:flex;flex-direction:column;gap:3px">
              ${axes.map(a=>`
                <button onclick="chartBuilderSet('yAxis','${a.key}')" style="padding:6px 10px;border:1px solid ${_chartBuilderState.yAxis===a.key?'rgba(124,159,255,0.4)':'var(--border)'};border-radius:var(--radius-lg);background:${_chartBuilderState.yAxis===a.key?'rgba(124,159,255,0.12)':'transparent'};color:${_chartBuilderState.yAxis===a.key?'var(--blue)':'var(--text2)'};font-size:11px;font-weight:600;cursor:pointer;text-align:left;transition:all .15s">
                  ${a.label}
                </button>`).join('')}
            </div>`).join('')}
        </div>

        <!-- Filtre joueurs -->
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Filtre</div>
          <select onchange="chartBuilderSet('filter',this.value)" style="width:100%;height:32px;padding:0 8px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-lg);color:var(--text2);font-size:12px">
            ${CHART_FILTERS.map(f=>`<option value="${f.key}" ${_chartBuilderState.filter===f.key?'selected':''}>${f.label}</option>`).join('')}
          </select>
        </div>

        <!-- Tri -->
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Tri</div>
          <select onchange="chartBuilderSet('sortBy',this.value)" style="width:100%;height:32px;padding:0 8px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-lg);color:var(--text2);font-size:12px">
            <option value="desc"  ${_chartBuilderState.sortBy==='desc' ?'selected':''}>Valeur décroissante</option>
            <option value="asc"   ${_chartBuilderState.sortBy==='asc'  ?'selected':''}>Valeur croissante</option>
            <option value="name"  ${_chartBuilderState.sortBy==='name' ?'selected':''}>Alphabétique</option>
            <option value="power" ${_chartBuilderState.sortBy==='power'?'selected':''}>Par groupe de puissance</option>
          </select>
        </div>

        <!-- Limite d'affichage -->
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px">Afficher</div>
          <select onchange="chartBuilderSet('topN',parseInt(this.value))" style="width:100%;height:32px;padding:0 8px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-lg);color:var(--text2);font-size:12px">
            <option value="0"  ${_chartBuilderState.topN===0 ?'selected':''}>Tous les joueurs</option>
            <option value="5"  ${_chartBuilderState.topN===5 ?'selected':''}>Top 5</option>
            <option value="10" ${_chartBuilderState.topN===10?'selected':''}>Top 10</option>
            <option value="15" ${_chartBuilderState.topN===15?'selected':''}>Top 15</option>
            <option value="20" ${_chartBuilderState.topN===20?'selected':''}>Top 20</option>
            <option value="25" ${_chartBuilderState.topN===25?'selected':''}>Top 25</option>
            <option value="30" ${_chartBuilderState.topN===30?'selected':''}>Top 30</option>
            <option value="40" ${_chartBuilderState.topN===40?'selected':''}>Top 40</option>
            <option value="50" ${_chartBuilderState.topN===50?'selected':''}>Top 50</option>
            <option value="75" ${_chartBuilderState.topN===75?'selected':''}>Top 75</option>
            <option value="100" ${_chartBuilderState.topN===100?'selected':''}>Top 100</option>
          </select>
        </div>

        <!-- Regroupement -->
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.05em;text-transform:uppercase">Regrouper similaires</div>
            <button onclick="chartBuilderSet('groupSim',!_chartBuilderState.groupSim)" style="width:38px;height:20px;border-radius:99px;border:none;cursor:pointer;transition:background .2s;background:${_chartBuilderState.groupSim?'var(--blue)':'var(--border2)'}">
              <span style="display:block;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s;transform:translateX(${_chartBuilderState.groupSim?'18px':'2px'})"></span>
            </button>
          </div>
          ${_chartBuilderState.groupSim?`<div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:10px;color:var(--text3)">Seuil</span>
            <input type="range" min="1" max="50" step="1" value="${_chartBuilderState.simPct}"
              oninput="chartBuilderSet('simPct',parseInt(this.value))"
              style="flex:1;accent-color:var(--blue)">
            <span style="font-size:11px;font-weight:700;color:var(--blue);width:36px">${_chartBuilderState.simPct}%</span>
          </div>`:'<div style="font-size:10px;color:var(--text3);line-height:1.5">Fusionne les joueurs avec des valeurs proches en un seul groupe.</div>'}
        </div>

      </div>

      <!-- Zone graphique -->
      <div class="lw-stats-chart-display">
        <div id="chartBuilderTitle" class="lw-stats-chart-title"></div><div id="chartBuilderSummary" class="lw-stats-chart-summary"></div>
        <canvas id="chartBuilderCanvas" height="360" style="width:100%;display:block"></canvas>
        <button type="button" class="btn" style="margin-top:14px" onclick="saveAllianceChartJpeg()">📷 Enregistrer le graphique en JPEG</button>
        <div id="chartBuilderEmpty" style="display:none;text-align:center;padding:60px 20px;color:var(--text3);font-size:13px">Aucune donnée disponible pour cette sélection.</div>
      </div>
    </div>`;

  // Dessiner le graphique
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    drawBuilderChart(TEXT, TEXT2, GRID, BG);
  }));
}

function chartBuilderSet(key, val){
  _chartBuilderState[key] = val;
  renderStatsGraphiques();
}

function drawBuilderChart(TEXT, TEXT2, GRID, BG){
  const s = _chartBuilderState;
  const canvas = document.getElementById('chartBuilderCanvas');
  const titleEl = document.getElementById('chartBuilderTitle');
  const emptyEl = document.getElementById('chartBuilderEmpty');
  if(!canvas) return;

  const data = getChartData();
  const yDef = CHART_AXES.y.find(a=>a.key===s.yAxis);
  const xDef = CHART_AXES.x.find(a=>a.key===s.xAxis);
  if(titleEl) titleEl.textContent = `${yDef?.label||''} par ${xDef?.label||''}`;
  const summaryEl=document.getElementById('chartBuilderSummary');
  if(summaryEl) summaryEl.textContent=`${data.labels.length} joueur(s) affiché(s) · ${s.chartType==='hbar'?'Barres horizontales':'Barres verticales'} · ${s.topN===0?'Tous les joueurs':'Top '+s.topN}`;

  if(!data.values.length){
    canvas.style.display='none';
    if(emptyEl) emptyEl.style.display='';
    return;
  }
  canvas.style.display='';
  if(emptyEl) emptyEl.style.display='none';

  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth||600;
  const H = s.chartType==='hbar' ? Math.max(360, data.labels.length*36+28) : 420;
  canvas.height = H;
  canvas.width = W;
  ctx.clearRect(0,0,W,H);

  if(s.chartType==='bar')   drawChartBar(ctx,data,W,H,TEXT,TEXT2,GRID,false);
  if(s.chartType==='hbar')  drawChartHBar(ctx,data,W,H,TEXT,TEXT2,GRID);
  if(s.chartType==='line')  drawChartLine(ctx,data,W,H,TEXT,TEXT2,GRID);
  if(s.chartType==='donut') drawChartDonut(ctx,data,W,H,TEXT,BG);
}

// ── Rendu Barres verticales ───────────────────────────────────────────────
function drawChartBar(ctx,data,W,H,TEXT,TEXT2,GRID){
  const PAD={top:20,right:16,bottom:64,left:42};
  const gW=W-PAD.left-PAD.right, gH=H-PAD.top-PAD.bottom;
  const maxV=Math.max(...data.values,1);
  const groupW=gW/data.labels.length;
  const barW=Math.min(groupW*0.65,36);

  // Grilles
  for(let i=0;i<=4;i++){
    const v=Math.round(maxV*i/4);
    const y=PAD.top+gH-gH*i/4;
    ctx.beginPath();ctx.strokeStyle=GRID;ctx.lineWidth=1;
    ctx.moveTo(PAD.left,y);ctx.lineTo(PAD.left+gW,y);ctx.stroke();
    ctx.font='10px sans-serif';ctx.fillStyle=TEXT2;ctx.textAlign='right';
    ctx.fillText(v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'k':v,PAD.left-4,y+3);
  }

  // Barres
  data.labels.forEach((lbl,i)=>{
    const val=data.values[i];
    const bh=Math.max(2,(val/maxV)*gH);
    const x=PAD.left+i*groupW+groupW/2-barW/2;
    const y=PAD.top+gH-bh;
    const r=Math.min(4,barW/2);
    const color=data.colors[i]||CHART_COLORS[i%CHART_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(x+r,y);ctx.lineTo(x+barW-r,y);
    ctx.quadraticCurveTo(x+barW,y,x+barW,y+r);
    ctx.lineTo(x+barW,y+bh);ctx.lineTo(x,y+bh);
    ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();ctx.fillStyle=color;ctx.fill();
    // Label
    ctx.save();ctx.translate(x+barW/2,PAD.top+gH+8);ctx.rotate(-Math.PI/4);
    ctx.font='10px sans-serif';ctx.fillStyle=TEXT;ctx.textAlign='right';
    ctx.fillText(lbl.length>12?lbl.slice(0,11)+'…':lbl,0,0);ctx.restore();
    // Valeur
    ctx.font='bold 9px sans-serif';ctx.fillStyle=TEXT;ctx.textAlign='center';
    if(bh>16) ctx.fillText(val>=1e6?(val/1e6).toFixed(1)+'M':val>=1e3?(val/1e3).toFixed(0)+'k':val,x+barW/2,y-3);
  });
}

// ── Rendu Barres horizontales ─────────────────────────────────────────────
function drawChartHBar(ctx,data,W,H,TEXT,TEXT2,GRID){
  const labelW=Math.min(185,Math.max(112,W*0.29)), PAD={top:14,right:76,bottom:14,left:labelW};
  const gW=W-PAD.left-PAD.right;
  const rowH=(H-PAD.top-PAD.bottom)/data.labels.length;
  const barH=rowH*0.55;
  const maxV=Math.max(...data.values,1);

  data.labels.forEach((lbl,i)=>{
    const val=data.values[i];
    const y=PAD.top+i*rowH+rowH/2;
    const bw=Math.max(2,(val/maxV)*gW);
    const color=data.colors[i]||CHART_COLORS[i%CHART_COLORS.length];
    ctx.font='12px sans-serif';ctx.fillStyle=TEXT;ctx.textAlign='right';
    let name=lbl; while(ctx.measureText(name).width>labelW-14 && name.length>3) name=name.slice(0,-2)+'…';
    ctx.fillText(name,labelW-9,y+4);
    // Fond
    ctx.fillStyle=GRID;
    ctx.beginPath();if(ctx.roundRect)ctx.roundRect(PAD.left,y-barH/2,gW,barH,3);
    else ctx.rect(PAD.left,y-barH/2,gW,barH);ctx.fill();
    // Barre
    ctx.fillStyle=color;
    ctx.beginPath();if(ctx.roundRect)ctx.roundRect(PAD.left,y-barH/2,bw,barH,3);
    else ctx.rect(PAD.left,y-barH/2,bw,barH);ctx.fill();
    // Valeur
    ctx.font='bold 12px sans-serif';ctx.fillStyle=TEXT;ctx.textAlign='left';
    ctx.fillText(val>=1e6?(val/1e6).toFixed(2)+'M':val>=1e3?(val/1e3).toFixed(1)+'k':val,PAD.left+gW+8,y+4);
  });
}

// ── Rendu Courbe ──────────────────────────────────────────────────────────
function drawChartLine(ctx,data,W,H,TEXT,TEXT2,GRID){
  if(data.values.length<2) return drawChartBar(ctx,data,W,H,TEXT,TEXT2,GRID);
  const PAD={top:20,right:16,bottom:44,left:44};
  const gW=W-PAD.left-PAD.right, gH=H-PAD.top-PAD.bottom;
  const vals=data.values;
  const minV=Math.min(...vals)*0.95, maxV=Math.max(...vals)*1.05||1;
  const toX=i=>PAD.left+i*(gW/(vals.length-1));
  const toY=v=>PAD.top+gH-((v-minV)/(maxV-minV||1))*gH;
  const color=data.colors[0]||CHART_COLORS[0];

  for(let i=0;i<=4;i++){
    const v=minV+(maxV-minV)*i/4;
    const y=toY(v);
    ctx.beginPath();ctx.strokeStyle=GRID;ctx.lineWidth=1;
    ctx.moveTo(PAD.left,y);ctx.lineTo(PAD.left+gW,y);ctx.stroke();
    ctx.font='10px sans-serif';ctx.fillStyle=TEXT2;ctx.textAlign='right';
    ctx.fillText(v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'k':Math.round(v),PAD.left-4,y+3);
  }

  // Aire de remplissage
  ctx.beginPath();ctx.moveTo(toX(0),toY(vals[0]));
  vals.forEach((_,i)=>{ if(i>0)ctx.lineTo(toX(i),toY(vals[i])); });
  ctx.lineTo(toX(vals.length-1),PAD.top+gH);ctx.lineTo(toX(0),PAD.top+gH);ctx.closePath();
  ctx.fillStyle=color.replace(')',',0.12)').replace('rgb','rgba');ctx.fill();

  // Ligne
  ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.lineJoin='round';
  vals.forEach((v,i)=>i===0?ctx.moveTo(toX(i),toY(v)):ctx.lineTo(toX(i),toY(v)));
  ctx.stroke();

  // Points + labels X
  vals.forEach((v,i)=>{
    ctx.beginPath();ctx.arc(toX(i),toY(v),3.5,0,Math.PI*2);
    ctx.fillStyle=color;ctx.fill();
    if(i%(Math.ceil(vals.length/8))===0||i===vals.length-1){
      ctx.save();ctx.translate(toX(i),PAD.top+gH+10);ctx.rotate(-Math.PI/5);
      ctx.font='10px sans-serif';ctx.fillStyle=TEXT;ctx.textAlign='right';
      ctx.fillText(data.labels[i],0,0);ctx.restore();
    }
  });
}

// ── Rendu Donut ───────────────────────────────────────────────────────────
function drawChartDonut(ctx,data,W,H,TEXT,BG){
  const cx=W/2, cy=H/2-10;
  const R=Math.min(cx,cy)*0.75, r=R*0.55;
  const total=data.values.reduce((s,v)=>s+v,0)||1;
  let angle=-Math.PI/2;

  data.values.forEach((v,i)=>{
    const sweep=(v/total)*Math.PI*2;
    const color=data.colors[i]||CHART_COLORS[i%CHART_COLORS.length];
    ctx.beginPath();ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,R,angle,angle+sweep);ctx.closePath();
    ctx.fillStyle=color;ctx.fill();
    // Label sur le segment si assez grand
    if(sweep>0.3){
      const mid=angle+sweep/2;
      const lx=cx+Math.cos(mid)*(R+r)/2, ly=cy+Math.sin(mid)*(R+r)/2;
      ctx.font='bold 10px sans-serif';ctx.fillStyle='#fff';ctx.textAlign='center';
      ctx.fillText(Math.round(v/total*100)+'%',lx,ly+4);
    }
    angle+=sweep;
  });

  // Trou
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=BG;ctx.fill();
  ctx.font='bold 18px sans-serif';ctx.fillStyle=TEXT;ctx.textAlign='center';
  ctx.fillText(total>=1e6?(total/1e6).toFixed(1)+'M':total,cx,cy+6);

  // Légende
  const legY=H-24;
  let lx=20;
  data.labels.forEach((lbl,i)=>{
    if(i>8)return;
    const color=data.colors[i]||CHART_COLORS[i%CHART_COLORS.length];
    ctx.beginPath();ctx.arc(lx+5,legY,5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
    ctx.font='10px sans-serif';ctx.fillStyle=TEXT;ctx.textAlign='left';
    const short=lbl.length>10?lbl.slice(0,9)+'…':lbl;
    ctx.fillText(short,lx+13,legY+4);
    lx+=ctx.measureText(short).width+28;
    if(lx>W-60){lx=20;}
  });
}


function openRepairModal(){
  if(!isAdmin())return;
  const sel=document.getElementById('repairNewName');
  if(sel){
    sel.innerHTML='<option value="">— Choisir un joueur —</option>'+
      [...participants].sort((a,b)=>a.name.localeCompare(b.name))
        .map(p=>`<option value="${p.name}">${p.name}</option>`).join('');
  }
  const inp=document.getElementById('repairOldName');
  if(inp) inp.value='';
  const prev=document.getElementById('repairPreview');
  if(prev) prev.textContent='';
  openModal('repairModal');

  const updatePreview=()=>{
    const oldN=(document.getElementById('repairOldName')||{}).value||'';
    const newN=(document.getElementById('repairNewName')||{}).value||'';
    const pv=document.getElementById('repairPreview');
    if(!pv)return;
    if(!oldN.trim()||!newN){pv.textContent='';return;}
    const wh=weeksHistory.filter(w=>w.participant_name===oldN.trim()).length;
    const dr=history.filter(h=>h.driver===oldN.trim()||h.vip===oldN.trim()).length;
    pv.innerHTML=`<span style="color:#4FD1A5">✓ Entrées trouvées :</span> ${wh} semaine${wh!==1?'s':''} archivée${wh!==1?'s':''}, ${dr} tirage${dr!==1?'s':''}`;
  };
  setTimeout(()=>{
    const inp2=document.getElementById('repairOldName');
    const sel2=document.getElementById('repairNewName');
    if(inp2) inp2.oninput=updatePreview;
    if(sel2) sel2.onchange=updatePreview;
  },50);
}

async function doRepairHistory(){
  const oldName=(document.getElementById('repairOldName')||{}).value||'';
  const newName=(document.getElementById('repairNewName')||{}).value||'';
  if(!oldName.trim()||!newName){toast('Remplis les deux champs');return;}
  if(!confirm(`Remplacer toutes les occurrences de "${oldName.trim()}" par "${newName}" dans l'historique ?\n\nCette action est irréversible.`))return;
  const p=participants.find(x=>x.name===newName);
  if(!p){toast('Joueur introuvable');return;}
  closeModal('repairModal');
  setBusy(true);
  await Promise.all([
    sb.from('weeks_history').update({participant_name:newName}).eq('participant_name',oldName.trim()),
    sb.from('historique').update({driver:newName}).eq('driver',oldName.trim()),
    sb.from('historique').update({vip:newName}).eq('vip',oldName.trim()),
    sb.from('weekly_draws').update({driver:newName}).eq('driver',oldName.trim()),
    sb.from('weekly_draws').update({vip:newName}).eq('vip',oldName.trim()),
    sb.from('tdd_poll').update({participant_name:newName}).eq('participant_name',oldName.trim()),
  ]);
  await loadAll();
  setBusy(false);
  toast(`✅ Historique de "${oldName.trim()}" rattaché à ${newName}`);
}


async function exportPlayersXlsx(){
  if(!participants.length){ toast('Aucun joueur à exporter'); return; }
  if(typeof XLSX === 'undefined'){
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const sorted = [...participants].sort((a,b)=>a.name.localeCompare(b.name));
  const wb = XLSX.utils.book_new();
  const rows = [
    ['Pseudo', 'Puissance T1'],
    ...sorted.map(p => [p.name, p.power_t1 ? t1FormatPower(p.power_t1) : ''])
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch: 25}, {wch: 18}];
  XLSX.utils.book_append_sheet(wb, ws, 'Joueurs');
  const date = new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
  XLSX.writeFile(wb, 'joueurs_nains_de_mithril_'+date+'.xlsx');
  toast('📥 '+sorted.length+' joueurs exportés');
}


async function savePlayerNote(playerId, note){
  if(!isAdminOrStaff()||!sb) return;
  const val = note.trim()||null;
  await sb.from('participants').update({note:val}).eq('id',playerId);
  const p = participants.find(x=>x.id===playerId);
  if(p) p.note = val;
}


/* ══ FONCTIONNALITÉS NOUVELLES ══════════════════════════════════════════ */

/* ── Feat 1 : Historique sondage — affiché dans la fiche joueur ── */
function getPollHistory(playerName){
  return weeksHistory.filter(w=>w.participant_name===playerName&&w.poll_response)
    .sort((a,b)=>new Date(b.archived_at)-new Date(a.archived_at));
}

/* ── Feat 2 : Notes joueur ── */
async function savePlayerNote(playerId, note){
  if(!isAdminOrStaff()||!sb) return;
  const val = note.trim()||null;
  const {error} = await sb.from('participants').update({note:val}).eq('id',playerId);
  if(!error){ const p=participants.find(x=>x.id===playerId); if(p) p.note=val; }
}

/* ── Feat 3 : Alerte régression coffres ── */
function updateRegressionAlert(){
  const banner = document.getElementById('alertRegressionBanner');
  const list   = document.getElementById('alertRegressionList');
  if(!banner||!list) return;
  const regressing = participants.filter(p=>{
    const w = getPlayerWeeks(p);
    if(w.length < 2) return false;
    const last2 = w.slice(-2);
    return !last2[0].validated && !last2[1].validated; // 2 semaines consécutives sans valider
  });
  if(!regressing.length){ banner.style.display='none'; return; }
  banner.style.display='';
  list.innerHTML = regressing.map(p=>`
    <span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 10px;background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.2);border-radius:99px;color:#FF6B6B;font-weight:700">
      ${p.is_priority?'⭐ ':''} ${p.name}
    </span>`).join('');
}

/* ── Feat 4 : Filtres historique + onglet remplacements ── */
let _histFilter = 'all';
function setHistFilter(filter, btn){
  _histFilter = filter;
  document.querySelectorAll('.hist-filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderHistFiltered();
}

function renderHistFiltered(){
  const el = document.getElementById('histList');
  if(!el) return;
  let filtered = [...history];
  if(_histFilter === 'weekly')  filtered = filtered.filter(h=>h.is_weekly);
  if(_histFilter === 'manual')  filtered = filtered.filter(h=>h.is_manual);
  if(_histFilter === 'present') filtered = filtered.filter(h=>h.is_present_draw);
  if(_histFilter === 'replace'){
    // Remplacements = tirages hebdo dont le driver ou vip diffère de ce qui était prévu
    // On détecte via weekly_draws : trouver les entrées is_weekly où le nom a changé
    filtered = filtered.filter(h=>h.is_weekly && h.replaced === true);
    if(!filtered.length){
      el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3);font-size:13px">Aucun remplacement enregistré.<br><span style="font-size:11px;opacity:.7">Les remplacements s\'enregistrent automatiquement lors du remplacement d\'un absent.</span></div>';
      return;
    }
  }
  // Rendu standard
  if(!filtered.length){ el.innerHTML='<span class="empty">Aucune entrée.</span>'; return; }
  el.innerHTML = filtered.slice(0,100).map(h=>{
    const d = new Date(h.created_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    const badge = h.is_weekly?`<span style="font-size:10px;padding:1px 6px;background:rgba(124,159,255,0.1);border-radius:4px;color:var(--blue)">${h.week_day||'Hebdo'}</span>`
                : h.is_manual?`<span style="font-size:10px;padding:1px 6px;background:rgba(255,184,77,0.1);border-radius:4px;color:var(--amber)">Manuel</span>`
                : `<span style="font-size:10px;padding:1px 6px;background:rgba(183,138,255,0.1);border-radius:4px;color:var(--purple)">Présents</span>`;
    const replaceBadge = h.replaced?`<span style="font-size:10px;padding:1px 6px;background:rgba(79,209,165,0.1);border-radius:4px;color:#4FD1A5">🔄 Remplacé</span>`:'';
    return `<div class="hist-row">
      <span class="hist-date">${d}</span>
      <span class="hist-name drv">${h.driver}</span>
      <span style="color:var(--text3);font-size:11px">→</span>
      <span class="hist-name vip">${h.vip}</span>
      ${badge}${replaceBadge}
    </div>`;
  }).join('');
}

/* ── Feat 5 : Badge ⭐ sur les lignes du planning ── */
// (voir rendu dans renderWeeklyPlanning — driverIsStaff/vipIsStaff déjà injectés)


async function recalcDrawStats(){
  if(!isAdmin()) return;
  if(!confirm('Recalculer les stats de tirage (driver_count / vip_count) de tous les joueurs depuis l\'historique ?\n\nCela corrige les compteurs si des remplacements ont créé des incohérences.\nOpération irréversible.')) return;
  if(!sb) return;
  setBusy(true);

  // Compter depuis historique (is_weekly = true uniquement = tirages officiels)
  const {data: hist, error} = await sb.from('historique')
    .select('driver, vip')
    .eq('is_weekly', true);

  if(error || !hist){
    setBusy(false);
    toast('Erreur lors du chargement de l\'historique ❌');
    return;
  }

  // Compter driver_count et vip_count par joueur
  const driverCounts = {};
  const vipCounts = {};
  hist.forEach(h => {
    if(h.driver) driverCounts[h.driver] = (driverCounts[h.driver]||0) + 1;
    if(h.vip)    vipCounts[h.vip]       = (vipCounts[h.vip]||0)       + 1;
  });

  // Mettre à jour chaque participant
  const updates = participants.map(p => ({
    id:           p.id,
    driver_count: driverCounts[p.name] || 0,
    vip_count:    vipCounts[p.name]    || 0,
  }));

  // Appliquer en batch
  let errors = 0;
  for(const u of updates){
    const {error: e} = await sb.from('participants')
      .update({driver_count: u.driver_count, vip_count: u.vip_count})
      .eq('id', u.id);
    if(e) errors++;
    // Mettre à jour localement
    const p = participants.find(x=>x.id===u.id);
    if(p){ p.driver_count=u.driver_count; p.vip_count=u.vip_count; }
  }

  await loadAll();
  setBusy(false);
  if(errors) toast(`⚠️ ${errors} erreur(s) lors de la mise à jour`);
  else toast(`✅ Stats de tirage recalculées pour ${updates.length} joueurs`);
}


/* ══════════════════════════════════════════════════════
   TEMPÊTE DU CANYON — Équilibrage simple sans catégories
   ══════════════════════════════════════════════════════ */

let canyonNbTeams = 1;
let canyonRoles   = {};   // {playerId: 'starter'|'sub'|'none'}
// Les votes du sondage alimentent directement la présélection Canyon.
// Ne modifie jamais les équipes déjà équilibrées (canyonTeams).
// Sauvegarde de la présélection au moment de la clôture, partagée entre appareils.
async function saveCanyonClosedRoles(){
  if(!sb)return;
  const {error}=await sb.from('app_config').upsert({key:'canyon_closed_roles',value:{roles:{...canyonRoles},saved_at:new Date().toISOString()}},{onConflict:'key'});
  if(error)throw error;
}
async function restoreCanyonClosedRoles(){
  if(!sb||availabilityState.canyon)return;
  const {data,error}=await sb.from('app_config').select('value').eq('key','canyon_closed_roles').maybeSingle();
  if(error){console.warn('Présélection Canyon:',error);return;}
  if(data?.value?.roles && typeof data.value.roles==='object'){
    canyonRoles={...data.value.roles};
  }
}
function syncCanyonRolesFromPoll(){
  // Une fois la session clôturée, préserver les choix manuels du staff.
  if(!availabilityState.canyon)return;
  for(const [id,response] of Object.entries(canyonPollResults)){
    canyonRoles[id]=response==='present'?'starter':response==='remplacant'?'sub':'none';
  }
}

let canyonTeams   = null; // {A: {starters: [...], subs: [...]}, B: {...}|null}

function setCanyonNbTeams(n){
  canyonNbTeams = n;
  document.getElementById('canyonNb1').classList.toggle('active', n===1);
  document.getElementById('canyonNb2').classList.toggle('active', n===2);
  canyonTeams = null;
  renderCanyonTeams();
  updateCanyonSelectionSummary();
}

function updateCanyonSelectionSummary(){
  const starters = Object.values(canyonRoles).filter(r=>r==='starter').length;
  const subs = Object.values(canyonRoles).filter(r=>r==='sub').length;
  const selected = starters + subs;
  const elSelected = document.getElementById('canyonCountSelected');
  const elStarters = document.getElementById('canyonCountStarters');
  const elSubs = document.getElementById('canyonCountSubs');
  if(elSelected) elSelected.textContent = `${selected} sélectionné${selected>1?'s':''}`;
  if(elStarters) elStarters.textContent = `${starters}/${CANYON_STARTERS_PER_TEAM*canyonNbTeams} titulaire${starters>1?'s':''}`;
  if(elSubs) elSubs.textContent = `${subs}/${CANYON_SUBS_PER_TEAM*canyonNbTeams} remplaçant${subs>1?'s':''}`;
}


// Réponses de disponibilité uniquement : aucun changement automatique des équipes.

function renderCanyonPlayers(){
  const list=document.getElementById('canyonPlayersList');
  if(!list) return;
  if(!participants.length){list.innerHTML='<div style="padding:10px;font-size:13px;color:var(--text3)">Aucun participant.</div>';return;}
  const search=(document.getElementById('canyonSearch')||{}).value||'';
  const searchLow=search.toLowerCase();
  const sorted=[...participants].sort((a,b)=>(b.power_t1||0)-(a.power_t1||0));
  const starters=sorted.filter(p=>canyonRoles[p.id]==='starter');
  const subs=sorted.filter(p=>canyonRoles[p.id]==='sub');
  const absents=sorted.filter(p=>!canyonRoles[p.id]||canyonRoles[p.id]==='none');
  updateCanyonSelectionSummary();

  const rowHtml=(p,role,addMode=false)=>{
    const rowCls=role==='starter'?'role-starter':role==='sub'?'role-sub':'';
    const nameHl=searchLow ? p.name.replace(new RegExp('('+search.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')+')','gi'),'<mark style="background:rgba(255,184,77,0.2);color:var(--amber);border-radius:2px;padding:0 2px">$1</mark>') : p.name;
    return '<div class="ev-player-row canyon-player-row '+rowCls+'">'+
      '<span class="canyon-player-name">'+nameHl+'</span>'+
      '<div class="ev-role-btns">'+
        (addMode ?
          '<button class="ev-role-btn" onclick="setCanyonRole('+p.id+',\'starter\');canyonClearSearch()">+ Titulaire</button>'+
          '<button class="ev-role-btn" onclick="setCanyonRole('+p.id+',\'sub\');canyonClearSearch()">+ Remplaçant</button>' :
          '<button class="ev-role-btn'+(role==='starter'?' starter':'')+'" onclick="setCanyonRole('+p.id+',\'starter\')">Titulaire</button>'+
          '<button class="ev-role-btn'+(role==='sub'?' sub':'')+'" onclick="setCanyonRole('+p.id+',\'sub\')">Remplaçant</button>'+
          '<button class="ev-role-btn absent" onclick="setCanyonRole('+p.id+',\'none\')">Retirer</button>')+
      '</div></div>';
  };

  let html='<div style="border:1px solid var(--border);border-radius:var(--radius-xl);overflow:hidden;background:var(--surface);margin-bottom:10px">';
  html+='<div style="padding:10px 14px;background:linear-gradient(135deg,var(--surface2),var(--surface3))"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)">➕ Ajouter un joueur ('+absents.length+' disponible'+(absents.length>1?'s':'')+')</span></div>';
  if(!searchLow){
    html+='<div style="padding:14px;font-size:12px;color:var(--text3);font-style:italic">🔍 Tapez un pseudo pour trouver et ajouter un joueur</div>';
  }else{
    const matches=absents.filter(p=>p.name.toLowerCase().includes(searchLow));
    if(!matches.length) html+='<div style="padding:14px;font-size:12px;color:var(--text3);font-style:italic">Aucun résultat pour "'+search+'"</div>';
    else html+=matches.map(p=>rowHtml(p,'none',true)).join('');
  }
  html+='</div>';

  const present=[...starters,...subs];
  if(present.length){
    html+='<div style="border:1px solid var(--border);border-radius:var(--radius-xl);overflow:hidden;background:var(--surface);margin-bottom:10px">';
    if(starters.length){html+='<div style="padding:6px 14px 4px;background:rgba(124,159,255,0.08);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--blue)">Titulaires ('+starters.length+')</div>';html+=starters.map(p=>rowHtml(p,'starter')).join('');}
    if(subs.length){html+='<div style="padding:6px 14px 4px;background:rgba(255,184,77,0.08);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--amber)">Remplaçants ('+subs.length+')</div>';html+=subs.map(p=>rowHtml(p,'sub')).join('');}
    html+='</div>';
  }else{
    html+='<div style="padding:14px;font-size:13px;color:var(--text3);font-style:italic;border:1px solid var(--border);border-radius:var(--radius-xl);margin-bottom:10px">Aucun joueur sélectionné.</div>';
  }
  list.innerHTML=html;
}

function canyonClearSearch(){
  const input=document.getElementById('canyonSearch');
  if(input) input.value='';
  renderCanyonPlayers();
}

function setCanyonRole(id, role, rowEl){
  if(role==='starter'){
    const maxStarters=CANYON_STARTERS_PER_TEAM*canyonNbTeams;
    const currentStarters=Object.values(canyonRoles).filter(r=>r==='starter').length;
    if(canyonRoles[id]!=='starter'&&currentStarters>=maxStarters){
      toast(`⚠️ Maximum : ${maxStarters} titulaires pour ${canyonNbTeams} équipe${canyonNbTeams>1?'s':''} (20 par équipe)`);return;
    }
  }
  if(role==='sub'){
    const maxSubs=CANYON_SUBS_PER_TEAM*canyonNbTeams;
    const currentSubs=Object.values(canyonRoles).filter(r=>r==='sub').length;
    if(canyonRoles[id]!=='sub'&&currentSubs>=maxSubs){
      toast(`⚠️ Maximum : ${maxSubs} remplaçants pour ${canyonNbTeams} équipe${canyonNbTeams>1?'s':''} (10 par équipe)`);return;
    }
  }
  canyonRoles[id]=role;
  canyonTeams=null;
  renderCanyonPlayers();
  renderCanyonTeams();
}

async function canyonSelectAll(role){
  if(role==='starter'){
    const max = CANYON_STARTERS_PER_TEAM * canyonNbTeams;
    participants.forEach((p,i)=>{ canyonRoles[p.id]=i<max?'starter':'none'; });
    if(participants.length>max) toast(`⚠️ ${max} titulaires maximum (${CANYON_STARTERS_PER_TEAM} par équipe)`);
  }else if(role==='sub'){
    const max = CANYON_SUBS_PER_TEAM * canyonNbTeams;
    participants.forEach((p,i)=>{ canyonRoles[p.id]=i<max?'sub':'none'; });
    if(participants.length>max) toast(`⚠️ ${max} remplaçants maximum (${CANYON_SUBS_PER_TEAM} par équipe)`);
  }else{
    participants.forEach(p=>{ canyonRoles[p.id]='none'; });
  }
  renderCanyonPlayers();
}

function splitCanyonBalanced(players){
  // Répartition serpentine par puissance décroissante
  const sorted = [...players].sort((a,b)=>(b.power_t1||0)-(a.power_t1||0));
  const A=[], B=[];
  sorted.forEach((p,i)=>{ if(i%2===0)A.push(p); else B.push(p); });
  return [A,B];
}

async function balanceCanyonTeams(){
  const selectedStarters = participants.filter(p=>canyonRoles[p.id]==='starter');
  const selectedSubs = participants.filter(p=>canyonRoles[p.id]==='sub');
  const maxStarters = CANYON_STARTERS_PER_TEAM * canyonNbTeams;
  const maxSubs = CANYON_SUBS_PER_TEAM * canyonNbTeams;
  if(!selectedStarters.length){ toast('Sélectionne au moins un titulaire'); return; }
  if(selectedStarters.length>maxStarters){ toast(`⚠️ Trop de titulaires : ${selectedStarters.length}/${maxStarters}`); return; }
  if(selectedSubs.length>maxSubs){ toast(`⚠️ Trop de remplaçants : ${selectedSubs.length}/${maxSubs}`); return; }

  const starterGroups = canyonNbTeams===1 ? [selectedStarters] : splitCanyonBalanced(selectedStarters);
  const subGroups = canyonNbTeams===1 ? [selectedSubs] : splitCanyonBalanced(selectedSubs);
  const A = {starters: starterGroups[0]||[], subs: subGroups[0]||[]};
  const B = canyonNbTeams===2 ? {starters: starterGroups[1]||[], subs: subGroups[1]||[]} : null;
  canyonTeams = {A, B};

  const fmtPow = v=>v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'k':v;
  const totalA = [...A.starters,...A.subs];
  const totalB = B ? [...B.starters,...B.subs] : [];
  toast(`⚖️ A : ${A.starters.length} tit. + ${A.subs.length} rem. (${fmtPow(totalA.reduce((s,p)=>s+(p.power_t1||0),0))})${B?` · B : ${B.starters.length} tit. + ${B.subs.length} rem. (${fmtPow(totalB.reduce((s,p)=>s+(p.power_t1||0),0))})`:''}`);

  renderCanyonTeams();
  // Sauvegarder dans app_config
  if(sb){
    await sb.from('app_config').upsert({
      key:'canyon_teams',
      value: {
        teams: {
          A: {starters:A.starters.map(p=>p.id), subs:A.subs.map(p=>p.id)},
          B: B ? {starters:B.starters.map(p=>p.id), subs:B.subs.map(p=>p.id)} : null
        },
        updated_at: new Date().toISOString()
      }
    });
  }
}

function renderCanyonTeams(){
  const result = document.getElementById('canyonTeamsResult');
  const copyBtn = document.getElementById('canyonCopyBtn');
  if(!result) return;
  if(!canyonTeams){ result.innerHTML=''; if(copyBtn)copyBtn.style.display='none'; return; }
  if(copyBtn) copyBtn.style.display='';

  const renderPlayers = (players, role, title) => {
    if(!players.length) return '';
    const rowCls = role==='starter' ? 'role-starter' : 'role-sub';
    const titleCls = role==='starter' ? 'canyon-result-title starter' : 'canyon-result-title sub';
    return `<div class="canyon-result-group">
      <div class="${titleCls}">${title} <span>(${players.length})</span></div>
      ${players.map((p,i)=>`<div class="ev-team-player">
        <span class="ev-pnum">${i+1}</span>
        <span class="ev-pname">${p.name}</span>
      </div>`).join('')}
    </div>`;
  };

  const renderTeam = (team, label, headerCls) => {
    if(!team) return '';
    const starters = Array.isArray(team) ? team : (team.starters||[]);
    const subs = Array.isArray(team) ? [] : (team.subs||[]);
    return `<div class="ev-team-card">
      <div class="ev-team-header ${headerCls}">
        <span class="ev-team-title ${headerCls}">⚔️ ${label}</span>
        <span class="ev-team-power">${starters.length}/${CANYON_STARTERS_PER_TEAM} tit. · ${subs.length}/${CANYON_SUBS_PER_TEAM} rempl.</span>
      </div>
      <div class="canyon-team-body">
        ${renderPlayers(starters,'starter','Titulaires')}
        ${renderPlayers(subs,'sub','Remplaçants')}
      </div>
      <button class="ev-copy-btn" onclick="copyCanyonText()">📋 Copier ${label}</button>
    </div>`;
  };

  result.innerHTML = `<div class="ev-teams-grid${canyonTeams.B?' two':''}">
    ${renderTeam(canyonTeams.A,'Équipe A','teamA')}
    ${canyonTeams.B?renderTeam(canyonTeams.B,'Équipe B','teamB'):''}
  </div>`;
}

async function resetCanyonTeams(){
  if(!confirm('Réinitialiser les équipes Canyon ?')) return;
  canyonTeams = null;
  canyonRoles = {};
  // Enregistrer aussi la sélection vide : sinon l'ancienne présélection clôturée
  // serait restaurée au prochain rechargement de la page.
  if(sb){
    try{
      const {error:rolesError}=await sb.from('app_config').upsert(
        {key:'canyon_closed_roles',value:{roles:{},saved_at:new Date().toISOString()}},
        {onConflict:'key'}
      );
      if(rolesError)throw rolesError;
      const {error:teamsError}=await sb.from('app_config').delete().eq('key','canyon_teams');
      if(teamsError)throw teamsError;
    }catch(e){
      alert('Réinitialisation non enregistrée dans Supabase : '+(e?.message||String(e)));
      await loadCanyonPollResults();
      return;
    }
  }
  renderCanyonPlayers();
  renderCanyonTeams();
  updateCanyonSelectionSummary();
  toast('Équipes Canyon réinitialisées');
}

function copyCanyonText(){
  if(!canyonTeams) return;
  const fmt = (teamData, label) => {
    if(!teamData) return '';
    const starters = Array.isArray(teamData) ? teamData : (teamData.starters||[]);
    const subs     = Array.isArray(teamData) ? [] : (teamData.subs||[]);
    let t = label+' ('+(starters.length+subs.length)+' joueurs) :\n';
    if(starters.length){ t += 'Titulaires :\n'+starters.map(p=>'- '+p.name).join('\n')+'\n'; }
    if(subs.length){ t += 'Remplaçants :\n'+subs.map(p=>'- '+p.name).join('\n')+'\n'; }
    return t;
  };
  let txt = fmt(canyonTeams.A,'Équipe A');
  if(canyonTeams.B) txt += '\n' + fmt(canyonTeams.B,'Équipe B');
  navigator.clipboard.writeText(txt.trim()).then(()=>toast('📋 Équipes Canyon copiées !'));
}


function onSearch(){searchFilter=document.getElementById('searchInput').value.toLowerCase();document.getElementById('searchClear').classList.toggle('show',searchFilter.length>0);render();}
function clearSearch(){document.getElementById('searchInput').value='';searchFilter='';document.getElementById('searchClear').classList.remove('show');render();}
async function toggleSortAlpha(){
  sortAlpha=!sortAlpha;const btn=document.getElementById('sortAlphaBtn');
  btn.classList.toggle('active',sortAlpha);btn.textContent=sortAlpha?'A→Z ✓':'A→Z';
  if(sortAlpha){participants.sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'}));render();await reorder(participants.map(p=>p.id));}
  else render();
}

function onDragStart(e,idx){dragSrcIdx=idx;e.dataTransfer.effectAllowed='move';setTimeout(()=>{const r=document.querySelector(`[data-idx="${idx}"]`);if(r)r.classList.add('dragging')},0);}
function onDragOver(e,idx){e.preventDefault();document.querySelectorAll('.p-row').forEach(r=>r.classList.remove('drag-over'));const r=document.querySelector(`[data-idx="${idx}"]`);if(r&&dragSrcIdx!==idx)r.classList.add('drag-over');}
function onDrop(e,idx){e.preventDefault();if(dragSrcIdx===null||dragSrcIdx===idx)return;const moved=participants.splice(dragSrcIdx,1)[0];participants.splice(idx,0,moved);dragSrcIdx=null;render();reorder(participants.map(p=>p.id));}
function onDragEnd(){dragSrcIdx=null;document.querySelectorAll('.p-row').forEach(r=>{r.classList.remove('dragging');r.classList.remove('drag-over');});}

function startEdit(idx){const row=document.querySelector(`[data-idx="${idx}"]`);if(!row)return;row.querySelector('.name-disp').style.display='none';const inp=row.querySelector('.name-inp');inp.style.display='inline-block';inp.value=participants[idx].name;inp.focus();inp.select();}
function commitEdit(idx){const row=document.querySelector(`[data-idx="${idx}"]`);if(!row)return;renameName(participants[idx].id,participants[idx].name,row.querySelector('.name-inp').value);}
function startEditPower(idx){if(!isAdminOrStaff())return;const row=document.querySelector(`[data-idx="${idx}"]`);if(!row)return;row.querySelector('.power-disp').style.display='none';const inp=row.querySelector('.power-inp');inp.style.display='block';inp.value=participants[idx].power_t1?(Number(participants[idx].power_t1)/1e6).toFixed(2):'';inp.focus();inp.select();}
async function commitPower(idx){
  if(!isAdminOrStaff())return;
  const row=document.querySelector(`[data-idx="${idx}"]`);
  const input=row?.querySelector('.power-inp');
  const p=participants[idx];
  if(!input||!p)return;
  const raw=input.value.trim();
  const val=raw?t1ParsePower(/[a-z]/i.test(raw)?raw:raw+'M'):null;
  if(raw&&val===null){alert('Puissance invalide : indique par exemple 51.00 (en millions).');input.focus();return;}
  if(val===null){alert('Indique une puissance en millions, par exemple 51.00.');input.focus();return;}
  if(Number(p.power_t1)===val){render();return;}
  if(!sb){alert('Connexion Supabase indisponible.');return;}
  input.disabled=true;
  setBusy(true);
  try{
    const {data,error}=await sb.from('participants').update({power_t1:val}).eq('id',p.id).select('id,power_t1').maybeSingle();
    if(error)throw error;
    if(!data)throw new Error('La base n’a modifié aucune ligne (autorisations RLS possibles).');
    const saved=Number(data.power_t1);
    if(!Number.isFinite(saved)||Math.abs(saved-val)>0.5){
      throw new Error('Supabase a retourné '+String(data.power_t1)+' au lieu de '+val+'. Vérifie le type de la colonne power_t1 et les déclencheurs SQL.');
    }
    // Relire la valeur stockée pour ne jamais annoncer une réussite sur une valeur restée à zéro.
    const {data:verified,error:readError}=await sb.from('participants').select('power_t1').eq('id',p.id).maybeSingle();
    if(readError)throw readError;
    if(!verified||Math.abs(Number(verified.power_t1)-val)>0.5){
      throw new Error('La vérification après enregistrement a échoué : valeur en base = '+String(verified?.power_t1));
    }
    p.power_t1=Number(verified.power_t1);
    render();
    if(typeof renderStats==='function')renderStats();
    toast('⚡ Puissance enregistrée : '+t1FormatPower(p.power_t1));
  }catch(err){
    console.error('Erreur correction puissance participant',err);
    alert('Impossible d’enregistrer la puissance de '+p.name+' : '+(err?.message||err));
    input.disabled=false;
    input.focus();
  }finally{setBusy(false);}
}

function toggleSection(bodyId,toggleId){
  const body=document.getElementById(bodyId);const toggle=document.getElementById(toggleId);if(!body||!toggle)return;
  const isCollapsed=body.classList.contains('collapsed');
  if(isCollapsed){
    // À l'ouverture du tirage du train, afficher directement les joueurs tirés pour la semaine.
    if(bodyId==='tirageBody'){
      const planning=document.getElementById('planningBody');
      const planningToggle=document.getElementById('planningToggle');
      if(planning){
        planning.classList.remove('collapsed');
        planning.style.maxHeight='none';
      }
      if(planningToggle)planningToggle.classList.remove('collapsed');
    }
    body.classList.remove('collapsed');body.style.maxHeight='none';
    const h=body.scrollHeight;body.style.maxHeight='0';body.getBoundingClientRect();
    body.style.maxHeight=h+'px';toggle.classList.remove('collapsed');
    setTimeout(()=>{if(!body.classList.contains('collapsed'))body.style.maxHeight='none'},400);
  }else{
    body.style.maxHeight=body.scrollHeight+'px';body.getBoundingClientRect();
    body.style.maxHeight='0';body.classList.add('collapsed');toggle.classList.add('collapsed');
  }
}

function updateDrawBtns(){
  const presPool=participants.filter(p=>presentIds.has(p.id));
  const drawPresBtn=document.getElementById('drawPresBtn');
  if(drawPresBtn) drawPresBtn.disabled=!presentMode||presPool.length<2||busy;
}


function render(){
  const body=document.getElementById('ptableBody');const head=document.getElementById('ptableHead');
  const showPres=presentMode;
  const minD=participants.length?Math.min(...participants.map(p=>p.driver_count)):0;
  const minV=participants.length?Math.min(...participants.map(p=>p.vip_count)):0;
  const filtered=searchFilter?participants.filter(p=>p.name.toLowerCase().includes(searchFilter)):participants;
  const participantIndex=new Map(participants.map((p,i)=>[p.id,i]));


    head.style.display='';
    const cols=`${showPres?'36px ':''}32px minmax(120px,1fr) 85px repeat(5,28px) 90px${isAdmin()?' 32px':''}`;
    head.style.gridTemplateColumns=cols;
    head.innerHTML=`${showPres?'<span style="text-align:center">✓</span>':''}<span style="font-size:9px;text-align:center">#</span><span class="h-name">Nom</span><span style="font-size:9px;color:var(--cyan);text-align:center">Puiss.</span>${DAYS.map(d=>`<span style="font-size:9px;text-align:center">${d}</span>`).join('')}<span style="font-size:9px;text-align:center">Élig.</span>${isAdmin()?'<span title="Priorité staff" style="font-size:9px;text-align:center">⭐</span>':''}`;
    if(!filtered.length){
      body.innerHTML=`<div style="padding:16px;font-size:13px;color:var(--text3);font-style:italic">${searchFilter?'Aucun résultat pour "'+searchFilter+'"':'Aucun participant.'}</div>`;
    }else{
      body.innerHTML=filtered.map(p=>{
        const realIdx=participantIndex.get(p.id);const elig=isEligible(p);
        const pd=p.driver_count===minD,pv=p.vip_count===minV;const isPresent=presentIds.has(p.id);
        const absCls=presentMode&&!isPresent?' absent':'';const eligCls=elig?' eligible':' not-eligible';
        const nameHtml=searchFilter?p.name.replace(new RegExp(`(${searchFilter.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi'),'<mark style="background:rgba(255,184,77,0.2);color:var(--amber);border-radius:3px;padding:0 2px">$1</mark>'):p.name;
        const coffresBtns=getCoffres(p).map((missed,di)=>`<button class="coffre-btn${missed?' missed':''}" onclick="toggleCoffre(${p.id},${di})" title="${DAYS[di]}: ${missed?'Manqué':'Fait'}">${missed?'✗':'✓'}</button>`).join('');
        return `<div class="p-row${absCls}${eligCls}" data-idx="${realIdx}" style="grid-template-columns:${cols}" draggable="${searchFilter?'false':'true'}" ondragstart="onDragStart(event,${realIdx})" ondragover="onDragOver(event,${realIdx})" ondrop="onDrop(event,${realIdx})" ondragend="onDragEnd()">
          ${showPres?`<div style="display:flex;align-items:center;justify-content:center"><input type="checkbox" class="cb-pres" ${isPresent?'checked':''} onchange="togglePresent(${p.id})" ondragstart="event.stopPropagation()"/></div>`:''}
          <span class="player-num">${realIdx+1}</span>
          <div class="name-cell"><span class="name-disp" onclick="startEdit(${realIdx})">${nameHtml}</span><input class="name-inp" ondragstart="event.stopPropagation()" onblur="commitEdit(${realIdx})" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape')render();"/></div>
          <div class="power-cell"><span class="power-disp${!p.power_t1?' empty-val':''}" onclick="startEditPower(${realIdx})" title="${isAdminOrStaff()?'Cliquer pour corriger la puissance':'Puissance T1'}" style="${isAdminOrStaff()?'cursor:pointer':'cursor:default'}">${p.power_t1?t1FormatPower(p.power_t1):'—'}${isAdminOrStaff()?' ✏️':''}</span><input class="power-inp" type="text" inputmode="decimal" placeholder="51.00" title="Puissance en millions (M)" ondragstart="event.stopPropagation()" onblur="commitPower(${realIdx})" onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape')render();"/></div>
          <div style="display:contents">${coffresBtns}</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:4px"><span class="elig-btn ${elig?'yes':'no'}">${elig?'✓':'✗'}</span><button class="del-btn" onclick="removeName(${p.id})">×</button></div>
          ${isAdmin()?`<div style="display:flex;align-items:center;justify-content:center"><input type="checkbox" title="Priorité staff ⭐" ${p.is_priority?'checked':''} onchange="togglePriority(${p.id},this)" ondragstart="event.stopPropagation()" style="width:15px;height:15px;accent-color:var(--amber);cursor:pointer"/></div>`:''}
        </div>`;
      }).join('');
    }
  if(presentMode)updatePresCount();updateDrawBtns();renderEligInfo();
  if(history.length){
    const resDrvEl=document.getElementById('resDrv');
    const resVipEl=document.getElementById('resVip');
    const resDrvBadgeEl=document.getElementById('resDrvBadge');
    const resVipBadgeEl=document.getElementById('resVipBadge');
    if(resDrvEl)resDrvEl.textContent=history[0].driver;
    if(resVipEl)resVipEl.textContent=history[0].vip;
    const bTxt=history[0].is_manual?'Tirage personnalisé':history[0].used_eligible?'🏆 Éligibles':history[0].is_present_draw?'🟣 Présents':'';
    const bCls=history[0].used_eligible?' gold':'';
    if(resDrvBadgeEl)resDrvBadgeEl.innerHTML=bTxt?`<span class="res-badge${bCls}">${bTxt}</span>`:'';
    if(resVipBadgeEl)resVipBadgeEl.innerHTML=bTxt?`<span class="res-badge${bCls}">${bTxt}</span>`:'';
  }
  document.getElementById('histList').innerHTML=!history.length?'<span class="empty">Aucun tirage effectué.</span>':history.map((h,i)=>{
    return `<div class="hist-item"><span class="hnum">#${history.length-i}</span><span class="hpart"><span class="role-dot drv" style="width:16px;height:16px;font-size:9px">T</span>${h.driver}</span><span class="hsep">·</span><span class="hpart"><span class="role-dot vip" style="width:16px;height:16px;font-size:9px">★</span>${h.vip}</span><button class="hist-del" onclick="deleteHistoryEntry(${h.id})">×</button></div>`;
  }).join('');

  renderArchiveList();
}

async function addName(){
  if(busy)return;
  const inp=document.getElementById('nameInput');
  const name=inp.value.trim();
  if(!name){toast('Saisis un nom');return;}
  if(participants.find(p=>p.name.toLowerCase()===name.toLowerCase())){toast('Ce nom existe déjà !');return;}
  setBusy(true);
  const pos=participants.length;
  const{error}=await sb.from('participants').insert({name,position:pos,driver_count:0,vip_count:0,weeks_validated:0,coffres_days:JSON.stringify([false,false,false,false,false])});
  if(error){toast('Erreur : '+error.message);setBusy(false);return;}
  inp.value='';setBusy(false);
}

async function removeName(id){
  const p = participants.find(x=>x.id===id);
  if(!confirm('Supprimer ce participant ?'))return;
  setBusy(true);await sb.from('participants').delete().eq('id',id);setBusy(false);
}

async function renameName(id,oldName,newName){
  const n=newName.trim();
  if(!n||n===oldName){render();return;}
  if(participants.find(p=>p.name.toLowerCase()===n.toLowerCase()&&p.id!==id)){toast('Ce nom existe déjà !');render();return;}
  setBusy(true);
  await propagateRename(id, oldName, n);
  setBusy(false);
}

// Propage un renommage dans TOUTES les tables qui stockent le nom en texte
async function propagateRename(id, oldName, newName){
  if(!sb||!oldName||!newName||oldName===newName) return;
  await Promise.all([
    sb.from('participants').update({name:newName}).eq('id',id),
    sb.from('weeks_history').update({participant_name:newName}).eq('participant_name',oldName),
    sb.from('historique').update({driver:newName}).eq('driver',oldName),
    sb.from('historique').update({vip:newName}).eq('vip',oldName),
    sb.from('weekly_draws').update({driver:newName}).eq('driver',oldName),
    sb.from('weekly_draws').update({vip:newName}).eq('vip',oldName),
    sb.from('tdd_poll').update({participant_name:newName}).eq('participant_name',oldName),
  ]);
}

async function reorder(ids){
  if(!sb)return;
  await Promise.all(ids.map((id,i)=>sb.from('participants').update({position:i}).eq('id',id)));
}

async function changeScore(id,type,delta){
  if(busy)return;
  const p=participants.find(x=>x.id===id);if(!p)return;
  const field=type==='driver'?'driver_count':'vip_count';
  const newVal=Math.max(0,(p[field]||0)+delta);
  setBusy(true);await sb.from('participants').update({[field]:newVal}).eq('id',id);setBusy(false);
}

async function deleteHistoryEntry(id){
  if(!confirm('Supprimer cette entrée ?'))return;
  const entry=history.find(h=>h.id===id);
  const ops=[sb.from('historique').delete().eq('id',id)];
  if(entry){
    const driver=participants.find(p=>p.name===entry.driver);
    const vip=participants.find(p=>p.name===entry.vip);
    if(driver)ops.push(sb.from('participants').update({driver_count:Math.max(0,(driver.driver_count||0)-1)}).eq('id',driver.id));
    if(vip)ops.push(sb.from('participants').update({vip_count:Math.max(0,(vip.vip_count||0)-1)}).eq('id',vip.id));
  }
  await Promise.all(ops);
}

let pendingExcelRows = [];

function resetImportModal(){
  pendingExcelRows = [];
  const fileInp = document.getElementById('importExcelFile');
  const statusEl = document.getElementById('importExcelStatus');
  const txtEl = document.getElementById('importTxt');
  if(fileInp) fileInp.value = '';
  if(statusEl) statusEl.textContent = '';
  if(txtEl) txtEl.value = '';
  closeModal('importModal');
}

async function ensureXlsxLoaded(){
  if(typeof XLSX !== 'undefined') return;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function handleImportExcelFile(input){
  const file = input.files?.[0];
  const statusEl = document.getElementById('importExcelStatus');
  if(!file) return;

  try{
    if(statusEl) statusEl.textContent = '⏳ Lecture du fichier Excel…';
    await ensureXlsxLoaded();

    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    pendingExcelRows = [];
    rawRows.forEach((row, index) => {
      const name = String(row[0] ?? '').trim();
      const rawPow = String(row[1] ?? '').trim();
      if(!name) return;

      // Ignorer la ligne d'en-tête (ex: "Pseudo" / "Puissance T1")
      if(index === 0 && /^(pseudo|nom|joueur|player|name)$/i.test(name)) return;

      const power = rawPow ? t1ParsePower(rawPow) : null;
      pendingExcelRows.push({ name, power });
    });

    if(!pendingExcelRows.length){
      if(statusEl) statusEl.textContent = '⚠️ Aucun joueur valide trouvé dans la première feuille.';
      return;
    }

    const withPow = pendingExcelRows.filter(r => r.power !== null).length;
    if(statusEl){
      statusEl.textContent = `✅ ${pendingExcelRows.length} joueur(s) détecté(s) (${withPow} avec puissance T1) dans "${file.name}".`;
    }
  }catch(e){
    console.error('Erreur import Excel :', e);
    pendingExcelRows = [];
    if(statusEl) statusEl.textContent = '❌ Impossible de lire ce fichier Excel.';
  }
}

function parseImportTextarea(txt){
  const entries = [];
  txt.split(/\r?\n/).forEach(line => {
    const clean = line.trim();
    if(!clean) return;

    // Supporte : "Pseudo", "Pseudo\t51.30M", "Pseudo;51.30", "Pseudo,51.30"
    let name = clean;
    let rawPow = '';

    if(clean.includes('\t')){
      const parts = clean.split('\t');
      name = parts[0].trim();
      rawPow = (parts[1] || '').trim();
    } else if(clean.includes(';')){
      const parts = clean.split(';');
      name = parts[0].trim();
      rawPow = (parts[1] || '').trim();
    } else {
      const m = clean.match(/^(.+?)\s+(\d+(?:[.,]\d+)?\s*[mMkK]?)$/);
      if(m){
        name = m[1].trim();
        rawPow = m[2].trim();
      }
    }

    if(!name || /^(pseudo|nom|joueur)$/i.test(name)) return;
    const power = rawPow ? t1ParsePower(rawPow) : null;
    entries.push({ name, power });
  });
  return entries;
}

async function doImport(){
  const txt = document.getElementById('importTxt').value;
  const textEntries = parseImportTextarea(txt);

  // Fusionner les entrées Excel + texte (le texte prioritaire en cas de doublon)
  const mergedMap = new Map();
  [...pendingExcelRows, ...textEntries].forEach(item => {
    const key = item.name.toLowerCase();
    const prev = mergedMap.get(key);
    mergedMap.set(key, {
      name: item.name,
      power: item.power !== null ? item.power : (prev?.power ?? null)
    });
  });

  const entries = [...mergedMap.values()];
  if(!entries.length){
    toast('Aucun joueur ou fichier Excel à importer');
    return;
  }

  resetImportModal();
  setBusy(true);

  try{
    const existingByName = new Map(participants.map(p => [p.name.toLowerCase(), p]));
    const toInsert = [];
    const toUpdate = [];

    entries.forEach(item => {
      const found = existingByName.get(item.name.toLowerCase());
      if(found){
        // Si le joueur existe déjà et qu'une puissance T1 est fournie, on met à jour sa puissance
        if(item.power !== null && Number(found.power_t1) !== item.power){
          toUpdate.push({ id: found.id, power_t1: item.power });
        }
      } else {
        toInsert.push({
          name: item.name,
          position: participants.length + toInsert.length,
          driver_count: 0,
          vip_count: 0,
          weeks_validated: 0,
          power_t1: item.power,
          coffres_days: JSON.stringify([false, false, false, false, false])
        });
      }
    });

    if(!toInsert.length && !toUpdate.length){
      toast('Aucune nouveauté (joueurs et puissances déjà à jour)');
      setBusy(false);
      return;
    }

    if(toInsert.length){
      const { error } = await sb.from('participants').insert(toInsert);
      if(error) throw error;
    }

    if(toUpdate.length){
      await Promise.all(
        toUpdate.map(u => sb.from('participants').update({ power_t1: u.power_t1 }).eq('id', u.id))
      );
    }

    await loadAll();
    const msgs = [];
    if(toInsert.length) msgs.push(`${toInsert.length} ajouté(s)`);
    if(toUpdate.length) msgs.push(`${toUpdate.length} puissance(s) T1 mise(s) à jour`);
    toast(`✅ Import terminé : ${msgs.join(', ')}`);
  }catch(e){
    console.error('Erreur doImport :', e);
    toast('❌ Erreur lors de l’import : ' + (e.message || e));
  }finally{
    setBusy(false);
  }
}

function togglePresentMode(){
  presentMode=!presentMode;
  const btn=document.getElementById('presModeBtn');
  btn.textContent=presentMode?'☑ Mode présents':'☐ Mode présents';
  btn.classList.toggle('btn-primary',presentMode);
  document.getElementById('presBanner').classList.toggle('on',presentMode);
  if(!presentMode)presentIds.clear();
  render();updateDrawBtns();
}

function togglePresent(id){
  if(presentIds.has(id))presentIds.delete(id);else presentIds.add(id);
  updatePresCount();updateDrawBtns();renderEligInfo();
}

function updatePresCount(){
  document.getElementById('presCount').textContent=presentIds.size+' présent'+(presentIds.size>1?'s':'')+' coché'+(presentIds.size>1?'s':'');
}

function checkAll(){participants.forEach(p=>presentIds.add(p.id));render();updatePresCount();updateDrawBtns();renderEligInfo();}
function uncheckAll(){presentIds.clear();render();updatePresCount();updateDrawBtns();renderEligInfo();}

async function resetAll(){
  if(!isAdmin())return;
  if(!confirm('⚠️ Réinitialiser TOUT ? Cette action est irréversible !'))return;
  if(!confirm('Dernière confirmation : supprimer tous les compteurs, coffres, historique et équipes ?'))return;
  setBusy(true);
  await Promise.all([
    sb.from('historique').delete().neq('id',0),
    sb.from('weeks_history').delete().neq('id',0),
    sb.from('weekly_draws').delete().neq('id',0),
    sb.from('event_roles').delete().neq('player_id',0),
    sb.from('event_teams').delete().neq('id',0),
  ]);
  await Promise.all(participants.map(p=>sb.from('participants').update({
    driver_count:0,vip_count:0,weeks_validated:0,
    coffres_days:JSON.stringify([false,false,false,false,false])
  }).eq('id',p.id)));
  toast('Tout a été réinitialisé !');setBusy(false);
}

function setBusy(val){busy=val;document.getElementById('addBtn').disabled=val;updateDrawBtns();}
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3000);}
function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
document.getElementById('nameInput').addEventListener('keydown',e=>{if(e.key==='Enter')addName();});
document.getElementById('loginUser').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('loginPass').focus();});
document.getElementById('loginPass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
document.querySelectorAll('.modal-ov').forEach(m=>m.addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal(m.id);}));

function updateEvBanner(){
  const hasActive=Object.values(evRoles).some(r=>r!=='none');
  document.getElementById('evActiveBanner').classList.toggle('on',hasActive);
  document.getElementById('evTeamsSavedBanner').classList.toggle('on',evTeamsLoaded);
  if(hasActive){
    const starters=Object.values(evRoles).filter(r=>r==='starter').length;
    const subs=Object.values(evRoles).filter(r=>r==='sub').length;
    document.getElementById('evActiveBannerText').textContent=`⚔️ ${starters} titulaire${starters>1?'s':''}, ${subs} remplaçant${subs>1?'s':''} — temps réel`;
  }
  if(evTeamsLoaded){
    const powA=teamTotalPower(evTeams?.A);const powB=evTeams?.B?teamTotalPower(evTeams.B):0;
    document.getElementById('evTeamsSavedText').textContent=`✅ Équipes sauvegardées — visibles par tous`;
  }
}

function initEvRoles(){
  participants.forEach(p=>{if(evRoles[p.id]===undefined)evRoles[p.id]='none';});
  const ids=new Set(participants.map(p=>p.id));
  Object.keys(evRoles).forEach(id=>{if(!ids.has(parseInt(id)))delete evRoles[id];});
  updateEvBanner();
}

async function evSetRole(playerId,role){
  evRoles[playerId]=role;
  // Ne pas reset evTeams pour conserver les équipes déjà équilibrées
  await sb.from('event_roles').upsert({player_id:playerId,role,nb_teams:evNbTeams,updated_at:new Date().toISOString()},{onConflict:'player_id'});
  updateEvBanner();renderEventPlayers();renderEventTeams();
}

async function evSelectAll(role){
  participants.forEach(p=>{evRoles[p.id]=role;});
  if(participants.length)await Promise.all(participants.map(p=>sb.from('event_roles').upsert({player_id:p.id,role,nb_teams:evNbTeams,updated_at:new Date().toISOString()},{onConflict:'player_id'})));
  // Sélection globale = réinitialiser les équipes (changement massif)
  evTeams=null;
  updateEvBanner();renderEventPlayers();renderEventTeams();
}

async function resetTeams(){
  if(!confirm('Réinitialiser tous les rôles ET les équipes pour tout le monde ?'))return;
  evRoles={};evTeams=null;evTeamsLoaded=false;
  participants.forEach(p=>{evRoles[p.id]='none';});
  await Promise.all([
    sb.from('event_roles').delete().neq('player_id',0),
    sb.from('event_teams').delete().neq('id',0)
  ]);
  updateEvBanner();renderEventPlayers();renderEventTeams();
  toast('Rôles et équipes réinitialisés ↺');
}

function toggleElPriority(){
  evElPriority = !evElPriority;
  const btn = document.getElementById('elPriorityBtn');
  const thumb = document.getElementById('elPriorityThumb');
  if(btn) btn.style.background = evElPriority ? 'var(--amber)' : 'var(--border2)';
  if(thumb) thumb.style.transform = evElPriority ? 'translateX(18px)' : 'translateX(0px)';
  toast(evElPriority ? '⚡ EL priorité ON — les plus forts sont privilégiés parmi les joueurs sélectionnés' : 'EL priorité OFF');
}
async function setNbTeams(n){
  if(n==='asym'){
    evAsymMode=true; evNbTeams=2;
  } else {
    evAsymMode=false; evNbTeams=n;
  }
  document.getElementById('evNb1').classList.toggle('active',evNbTeams===1&&!evAsymMode);
  document.getElementById('evNb2').classList.toggle('active',evNbTeams===2&&!evAsymMode);
  const asymBtn=document.getElementById('evNbAsym');
  if(asymBtn) asymBtn.classList.toggle('active',evAsymMode);
  const asymCtrl=document.getElementById('asymControls');
  if(asymCtrl) asymCtrl.style.display=evAsymMode?'flex':'none';
  const balBtn=document.getElementById('balanceBtn');
  if(balBtn) balBtn.innerHTML=evAsymMode?'⚡ Créer les équipes asymétriques':'⚖️ Équilibrer et sauvegarder';
  if(Object.keys(evRoles).some(id=>evRoles[id]!=='none'))
    await sb.from('event_roles').update({nb_teams:evNbTeams}).neq('player_id',0);
  evTeams=null;renderEventPlayers();renderEventTeams();
}

function evOnSearch(){const val=document.getElementById('evSearchInput').value;document.getElementById('evSearchClear').classList.toggle('show',val.length>0);renderEventPlayers();}
function evClearSearch(){document.getElementById('evSearchInput').value='';document.getElementById('evSearchClear').classList.remove('show');renderEventPlayers();}

async function saveEvTeamsToDB(){
  if(!sb||!evTeams)return;
  _evSaving=true;

  // Construire les nouvelles lignes
  const rows=[];
  ['A','B'].forEach(tk=>{
    if(!evTeams[tk])return;
    CATEGORIES.forEach(cat=>{
      const players=evTeams[tk][cat.key]||[];
      players.forEach((p,i)=>{rows.push({team_key:tk,cat_key:cat.key,player_id:p.id,position:i,updated_at:new Date().toISOString()});});
    });
  });

  // Supprimer et réinsérer dans une seule transaction via RPC si possible
  // sinon : INSERT d'abord dans une table temporaire puis swap — ou simplement
  // désactiver le realtime le temps de l'opération complète
  await sb.from('event_teams').delete().neq('id',0);
  if(rows.length) await sb.from('event_teams').insert(rows);

  evTeamsLoaded=true;
  // Garder le flag actif suffisamment longtemps pour que le realtime
  // ne reçoive pas les événements DELETE/INSERT intermédiaires
  setTimeout(()=>{
    _evSaving=false;
    // Forcer un render depuis evTeams local (pas depuis la DB)
    renderEventTeams();
  }, 1500);
}

function renderEventPlayers(){
  const list=document.getElementById('evPlayersList');
  if(!list)return;
  if(!participants.length){list.innerHTML='<div style="padding:10px;font-size:13px;color:var(--text3)">Aucun participant.</div>';return;}
  const maxS=20;
  const maxSub=10;
  const evSearch=(document.getElementById('evSearchInput')||{}).value||'';
  const evSearchLow=evSearch.toLowerCase();
  const sorted=[...participants].sort((a,b)=>(b.power_t1||0)-(a.power_t1||0));
  const starters=sorted.filter(p=>evRoles[p.id]==='starter');
  const subs=sorted.filter(p=>evRoles[p.id]==='sub');
  const absents=sorted.filter(p=>!evRoles[p.id]||evRoles[p.id]==='none');
  const maxTotalS=maxS*evNbTeams;const maxTotalSub=maxSub*evNbTeams;
  const csEl=document.getElementById('evCountStarters');const csubEl=document.getElementById('evCountSubs');
  if(csEl)csEl.textContent=starters.length+'/'+maxTotalS+' titulaire'+(starters.length>1?'s':'');
  if(csubEl)csubEl.textContent=subs.length+'/'+maxTotalSub+' remplaçant'+(subs.length>1?'s':'');
  const rowHtml=(p,role)=>{
    const rowCls=role==='starter'?'role-starter':'role-sub';
    return '<div class="ev-player-row '+rowCls+'">'+
      '<span style="font-size:11px;color:var(--text3);min-width:22px;text-align:right">'+(participants.indexOf(p)+1)+'</span>'+
      '<span class="tdd-player-identity"><strong>'+escapeHtml(p.name)+'</strong>'+tddPlayerOriginalBadge(p)+'</span>'+
      tddPlayerSlotSelect(p)+
      '<div class="ev-role-btns">'+
        '<button class="ev-role-btn'+(role==='starter'?' starter':'')+'" onclick="evSetRole('+p.id+',\'starter\')">Titulaire</button>'+
        '<button class="ev-role-btn'+(role==='sub'?' sub':'')+'" onclick="evSetRole('+p.id+',\'sub\')">Remplaçant</button>'+
        '<button class="ev-role-btn absent" onclick="evSetRole('+p.id+',\'none\')">Retirer</button>'+
      '</div></div>';
  };
  let html='<div style="border:1px solid var(--border);border-radius:var(--radius-xl);overflow:hidden;background:var(--surface);margin-bottom:10px">';
  html+='<div style="padding:10px 14px;background:linear-gradient(135deg,var(--surface2),var(--surface3))"><span style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text3)">➕ Ajouter un joueur ('+absents.length+' disponible'+(absents.length>1?'s':'')+')</span></div>';
  if(!evSearchLow){html+='<div style="padding:14px;font-size:12px;color:var(--text3);font-style:italic">🔍 Tapez un pseudo pour trouver et ajouter un joueur</div>';}
  else{
    const fa=absents.filter(p=>p.name.toLowerCase().includes(evSearchLow));
    if(!fa.length){html+='<div style="padding:14px;font-size:12px;color:var(--text3);font-style:italic">Aucun résultat pour "'+evSearch+'"</div>';}
    else{html+=fa.map(p=>{
      const nameHl=p.name.replace(new RegExp('('+evSearch.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'),'<mark style="background:rgba(255,184,77,0.2);color:var(--amber);border-radius:2px;padding:0 2px">$1</mark>');
      return '<div class="ev-player-row" style="border-left:2px solid var(--border2)">'+
        '<span style="font-size:11px;color:var(--text3);min-width:22px;text-align:right">'+(participants.indexOf(p)+1)+'</span>'+
        '<span class="tdd-player-identity"><strong>'+nameHl+'</strong>'+tddPlayerOriginalBadge(p)+'</span>'+
        tddPlayerSlotSelect(p)+
        '<div class="ev-role-btns">'+
          '<button class="ev-role-btn" onclick="evSetRole('+p.id+',\'starter\');evClearSearch()">+ Titulaire</button>'+
          '<button class="ev-role-btn" onclick="evSetRole('+p.id+',\'sub\');evClearSearch()">+ Remplaçant</button>'+
        '</div></div>';
    }).join('');}
  }
  html+='</div>';
  const present=[...starters,...subs];
  if(present.length){
    html+='<div style="border:1px solid var(--border);border-radius:var(--radius-xl);overflow:hidden;background:var(--surface);margin-bottom:10px">';
    if(starters.length){html+='<div style="padding:6px 14px 4px;background:rgba(124,159,255,0.08);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--blue)">Titulaires ('+starters.length+')</div>';html+=starters.map(p=>rowHtml(p,'starter')).join('');}
    if(subs.length){html+='<div style="padding:6px 14px 4px;background:rgba(255,184,77,0.08);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--amber)">Remplaçants ('+subs.length+')</div>';html+=subs.map(p=>rowHtml(p,'sub')).join('');}
    html+='</div>';
  }else{html+='<div style="padding:14px;font-size:13px;color:var(--text3);font-style:italic;border:1px solid var(--border);border-radius:var(--radius-xl);margin-bottom:10px">Aucun joueur sélectionné.</div>';}
  list.innerHTML=html;
}


function makeEmptyTeam(){const t={};CATEGORIES.forEach(c=>{t[c.key]=[];});return t;}

function renderTddFairResultStats(starters,placedIds){
  const el=document.getElementById('evFairnessList');
  if(!el)return;
  if(!(evFairRotation&&!evAsymMode)){el.innerHTML='';return;}
  const starterPlacedIds=[...placedIds].filter(id=>evRoles[id]==='starter');
  const starterAsSubIds=[...placedIds].filter(id=>evRoles[id]==='starter' && ['A','B'].some(t=>evTeams?.[t]?.SUB?.some(p=>p.id===id)));
  const realSubIds=[...placedIds].filter(id=>evRoles[id]==='sub');
  const avg=starters.length?starters.reduce((sum,p)=>sum+Number(tddFairStats.counts?.[p.id]||0),0)/starters.length:0;
  const green=starterPlacedIds.filter(id=>Number(tddFairStats.counts?.[id]||0)<avg).length;
  const yellow=starterPlacedIds.filter(id=>Math.abs(Number(tddFairStats.counts?.[id]||0)-avg)<0.0001).length;
  const red=starterPlacedIds.filter(id=>Number(tddFairStats.counts?.[id]||0)>avg).length;
  const overflow=starterAsSubIds.length;
  el.innerHTML=`<div style="padding:9px 12px;border:1px solid rgba(124,159,255,0.2);background:rgba(124,159,255,0.05);border-radius:var(--radius-lg);font-size:11px;color:var(--text3)"><div style="font-weight:800;color:var(--blue);margin-bottom:6px">🔄 Rotation de la semaine</div><div style="display:flex;gap:8px;flex-wrap:wrap"><span>👤 ${starterPlacedIds.length-overflow} titulaires sélectionnés selon la rotation</span><span>↪️ ${overflow} titulaire${overflow>1?'s':''} reporté${overflow>1?'s':''} en remplaçant</span><span>🔁 ${realSubIds.length} remplaçant${realSubIds.length>1?'s':''} sélectionné${realSubIds.length>1?'s':''}</span></div><div style="margin-top:7px;display:flex;gap:8px;flex-wrap:wrap"><span>🟢 ${green} sous la moyenne de participations</span><span>🟡 ${yellow} dans la moyenne</span><span>🔴 ${red} au-dessus de la moyenne</span></div></div>`;
}

async function balanceTeams(){
  if(evNbTeams===2&&!evAsymMode){
    await loadTddSlotVotes();await loadTddTeamSlots();
    const pool=participants.filter(p=>evRoles[p.id]==='starter'||evRoles[p.id]==='sub');
    if(!pool.length){toast('Sélectionne au moins un joueur');return;}
    evTeams=tddBalancedSlots();
    await saveEvTeamsToDB();
    const placed=new Set(['A','B'].flatMap(k=>CATEGORIES.flatMap(c=>(evTeams[k]?.[c.key]||[]).map(p=>p.id))));
    await recordTddNonRetenus(pool.map(p=>p.id),placed);
    renderEventTeams();toast('⚖️ Équipes TDD équilibrées par horaires et sauvegardées');return;
  }
  const allTddRegisteredIds=participants.filter(p=>evRoles[p.id]==='starter'||evRoles[p.id]==='sub').map(p=>p.id);
  let starters=sortTddPlayers(participants.filter(p=>evRoles[p.id]==='starter'));
  let subs=sortTddPlayers(participants.filter(p=>evRoles[p.id]==='sub'));
  const useFairRotation=evFairRotation&&!evAsymMode;
  if(useFairRotation){
    starters=buildTddFairRank(starters);
    // Les remplaçants conservent la logique actuelle (rotation des non-retenus + puissance).
    subs=sortTddPlayers(subs);
  }
  if(starters.length+subs.length<1){toast('Sélectionne au moins 1 joueur');return;}

  if(evNbTeams===1){
    if(useFairRotation){
      const cap=CATEGORIES.filter(c=>c.key!=='SUB').reduce((s,c)=>s+c.size,0);
      const forced=starters.filter(p=>p.ev_priority);
      const forcedSet=new Set(forced.map(p=>p.id));
      starters=[...sortTddPlayers(forced),...buildTddFairRank(starters.filter(p=>!forcedSet.has(p.id)))].slice(0,cap);
    }
    evTeams={A:buildOneTeam(starters,subs),B:null};
  } else if(evAsymMode){
    // Mode asymétrique : tous les joueurs triés par puissance
    // Équipe A = les N premiers (les plus forts), Équipe B = le reste
    const all=sortTddPlayers([...starters,...subs]);
    if(all.length<2){toast('Sélectionne au moins 2 joueurs');return;}
    const nA = Math.min(Math.max(1, evAsymSizeA), all.length-1);
    const groupA = all.slice(0, nA);
    const groupB = all.slice(nA);
    // Remplir les catégories avec les joueurs du groupe, le surplus va en SUB
    // On calcule combien de places de titulaires existent (hors SUB)
    const STARTER_SLOTS = CATEGORIES.filter(c=>c.key!=='SUB').reduce((s,c)=>s+c.size,0);
    const titA = groupA.slice(0, STARTER_SLOTS);
    const subA = groupA.slice(STARTER_SLOTS);
    const titB = groupB.slice(0, STARTER_SLOTS);
    const subB = groupB.slice(STARTER_SLOTS);
    evTeams={A:buildOneTeam(titA, subA), B:buildOneTeam(titB, subB)};
    const powA=teamTotalPower(evTeams.A), powB=teamTotalPower(evTeams.B);
    const fmtPow = v => v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'k':v;
    toast(`⚡ A : ${groupA.length} joueurs (${fmtPow(powA)}) · B : ${groupB.length} joueurs (${fmtPow(powB)})`);
  } else {
    const STARTER_SLOTS = CATEGORIES.filter(c=>c.key!=='SUB').reduce((s,c)=>s+c.size,0);
    const TOTAL_STARTER_CAP = STARTER_SLOTS * 2;
    let selectedStarterPool = [];
    let overflowStarterPool = [];
    let selectedSubPool = [];

    if(useFairRotation){
      // 1) La rotation équitable sélectionne d'abord les TITULAIRES.
      //    Les REMPLAÇANTS ne peuvent compléter les places titulaires que s'il en manque.
      const rankedStarters = buildTddFairRank(starters);
      const selectedStarterCount = Math.min(TOTAL_STARTER_CAP, rankedStarters.length);
      selectedStarterPool = rankedStarters.slice(0, selectedStarterCount);
      overflowStarterPool = rankedStarters.slice(selectedStarterCount);

      // 2) S'il manque des titulaires, on complète les places titulaires avec les R.
      const rankedSubs = sortTddPlayers(subs);
      const missingStarterSlots = Math.max(0, TOTAL_STARTER_CAP - selectedStarterPool.length);
      const subsUsedAsStarters = rankedSubs.slice(0, missingStarterSlots);
      selectedStarterPool = [...selectedStarterPool, ...subsUsedAsStarters];

      // 3) Les titulaires excédentaires restent prioritaires dans les SUB,
      //    puis on complète avec les vrais remplaçants.
      const remainingSubs = rankedSubs.slice(subsUsedAsStarters.length);
      selectedSubPool = [...overflowStarterPool, ...remainingSubs].slice(0, TOTAL_SUBS * 2);
    } else {
      // Fonctionnement historique lorsque Rotation équitable est désactivée.
      const priorityStarters = sortTddPlayers(starters.filter(p=>p.ev_priority));
      const normalStarters   = sortTddPlayers(starters.filter(p=>!p.ev_priority));
      selectedStarterPool = [...priorityStarters, ...normalStarters];
      selectedSubPool = sortTddPlayers(subs);
    }

    // 4) Une fois la sélection faite, la puissance sert uniquement à équilibrer A/B.
    const [starterGroupA, starterGroupB] = splitBalanced(selectedStarterPool);
    const titA = starterGroupA.slice(0, STARTER_SLOTS);
    const titB = starterGroupB.slice(0, STARTER_SLOTS);
    const overA = starterGroupA.slice(STARTER_SLOTS);
    const overB = starterGroupB.slice(STARTER_SLOTS);

    let subPoolA, subPoolB;
    if(useFairRotation){
      // Les dépassements de titulaires sont toujours placés avant les R dans le pool SUB.
      const orderedSubPool = [...overA, ...overB, ...selectedSubPool];
      const chosenSubPool = orderedSubPool.slice(0, TOTAL_SUBS * 2);
      [subPoolA, subPoolB] = splitBalanced(chosenSubPool);
      subPoolA = subPoolA.slice(0, TOTAL_SUBS);
      subPoolB = subPoolB.slice(0, TOTAL_SUBS);
    } else {
      // Même comportement qu'avant en mode classique : les excédents de titulaires
      // complètent les remplaçants, puis chaque équipe reçoit jusqu'à 10 SUB.
      const [subsA, subsB] = splitBalanced(selectedSubPool);
      subPoolA = [...overA, ...subsA].slice(0, TOTAL_SUBS);
      subPoolB = [...overB, ...subsB].slice(0, TOTAL_SUBS);
    }

    evTeams={A:buildOneTeam(titA, subPoolA), B:buildOneTeam(titB, subPoolB)};

    // Retirer ev_priority des joueurs effectivement placés (Option A)
    const placedIds = new Set();
    ['A','B'].forEach(tk=>{ if(!evTeams[tk])return; CATEGORIES.forEach(cat=>(evTeams[tk][cat.key]||[]).forEach(p=>placedIds.add(p.id))); });
    const toReset = participants.filter(p=>p.ev_priority && placedIds.has(p.id));
    if(toReset.length){
      toReset.forEach(p=>{ p.ev_priority=false; });
      Promise.all(toReset.map(p=>sb.from('participants').update({ev_priority:false}).eq('id',p.id)));
    }

    const powA=teamTotalPower(evTeams.A), powB=teamTotalPower(evTeams.B);
    const fmtPow=v=>v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'k':v;
    const titleCountInSubs = useFairRotation ? overflowStarterPool.length : 0;
    toast(`⚖️ A : ${titA.length} tit. + ${subPoolA.length} rem. (${fmtPow(powA)}) · B : ${titB.length} tit. + ${subPoolB.length} rem. (${fmtPow(powB)})${titleCountInSubs?` · ${titleCountInSubs} titulaire${titleCountInSubs>1?'s':''} reporté${titleCountInSubs>1?'s':''} en SUB`:''}`);
  }
  await saveEvTeamsToDB();
  const placedIds=new Set();
  ['A','B'].forEach(tk=>{if(!evTeams?.[tk])return;CATEGORIES.forEach(cat=>(evTeams[tk][cat.key]||[]).forEach(p=>placedIds.add(p.id)));});
  const starterPlacedIds=[];
  if(useFairRotation){
    ['A','B'].forEach(tk=>{
      if(!evTeams?.[tk])return;
      CATEGORIES.filter(cat=>cat.key!=='SUB').forEach(cat=>{
        (evTeams[tk][cat.key]||[]).forEach(p=>{
          if(evRoles[p.id]==='starter') starterPlacedIds.push(p.id);
        });
      });
    });
  }
  if(useFairRotation) renderTddFairResultStats(starters,placedIds);
  if(useFairRotation) await recordTddFairParticipation(placedIds,starterPlacedIds);
  await recordTddNonRetenus(allTddRegisteredIds,placedIds);
  if(!evAsymMode) toast('⚖️ Équipes sauvegardées !');
  updateEvBanner();renderEventTeams();
}

function splitBalanced(players){
  const sorted=[...players].sort((a,b)=>(b.power_t1||0)-(a.power_t1||0));
  const A=[],B=[];let pA=0,pB=0;
  sorted.forEach(p=>{if(pA<=pB){A.push(p);pA+=p.power_t1||0;}else{B.push(p);pB+=p.power_t1||0;}});
  return[A,B];
}

function buildOneTeam(starters,subs,keepSubs=false){
  const team=makeEmptyTeam();const subPool=[...subs];
  const sorted=[...starters].sort((a,b)=>(b.power_t1||0)-(a.power_t1||0));
  const starterCats=CATEGORIES.filter(c=>c.key!=='SUB'); // toutes les cats titulaires
  let pool;
  if(evElPriority){
    // Les plus forts vont en EL en premier, le reste remplit H1-R2
    const elCat=CATEGORIES.find(c=>c.key==='EL');
    const elSize=elCat?elCat.size:4;
    team['EL']=[...sorted.slice(0,elSize)];
    pool=[...sorted.slice(elSize)];
    const nonElCats=starterCats.filter(c=>c.key!=='EL');
    let filled=true;
    while(filled&&pool.length>0){filled=false;for(const cat of nonElCats){if(team[cat.key].length<cat.size&&pool.length>0){team[cat.key].push(pool.shift());filled=true;}}}
  } else {
    pool=[...sorted];
    let filled=true;
    while(filled&&pool.length>0){filled=false;for(const cat of starterCats){if(team[cat.key].length<cat.size&&pool.length>0){team[cat.key].push(pool.shift());filled=true;}}}
  }
  // En équilibrage TDD midi/soir, les remplaçants restent remplaçants :
  // ne pas les déplacer pour combler des postes titulaires vacants.
  if(!keepSubs){
    for(const cat of starterCats){while(team[cat.key].length<cat.size&&subPool.length>0){team[cat.key].push(subPool.shift());}}
  }
  team['SUB']=subPool.slice(0,TOTAL_SUBS);return team;
}

function teamTotalPower(team){if(!team)return 0;return CATEGORIES.flatMap(c=>team[c.key]||[]).reduce((s,p)=>s+(p.power_t1||0),0);}
function catPower(arr){return arr.reduce((s,p)=>s+(p.power_t1||0),0);}

let evDragSrcData=null;
function evDragStart(e,team,catKey,idx){
  evDragSrcData={team,catKey,idx};
  const player=evTeams&&evTeams[team]&&evTeams[team][catKey]?evTeams[team][catKey][idx]:null;
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain',team+':'+catKey+':'+(player?player.id:0));
  setTimeout(()=>{const el=document.querySelector(`[data-ev-team="${team}"][data-ev-cat="${catKey}"][data-ev-idx="${idx}"]`);if(el)el.classList.add('dragging-team');},0);
}
function evDragOver(e){e.preventDefault();document.querySelectorAll('.ev-team-player').forEach(el=>el.classList.remove('drag-over-team'));}

function evDropZoneOver(event,teamKey,catKey){
  event.preventDefault();
  const cat=evTeams&&evTeams[teamKey]?evTeams[teamKey][catKey]:null;
  const catDef=CATEGORIES.find(c=>c.key===catKey);
  const isFull=cat&&catDef&&cat.length>=catDef.size;
  const z=event.currentTarget;
  z.style.background='rgba(124,159,255,0.08)';z.style.outline='2px dashed rgba(124,159,255,0.4)';
}
function evDropZoneLeave(event){event.currentTarget.style.background='';event.currentTarget.style.outline='';}
function evDropOnCatUniversal(event,teamKey,catKey){
  event.preventDefault();
  event.currentTarget.style.background='';event.currentTarget.style.outline='';
  if(evDragSrcData){evDropOnCat(event,teamKey,catKey);}
}
async function evDropOnCat(e,toTeam,toCatKey){
  e.preventDefault();if(!evDragSrcData||!evTeams)return;
  const{team:fromTeam,catKey:fromCat,idx:fromIdx}=evDragSrcData;
  const preview=evTeams[fromTeam][fromCat][fromIdx];if(preview&&!tddSlotCompatible(preview.id,toTeam)){toast('Horaire incompatible pour ce joueur');return;}
  const player=evTeams[fromTeam][fromCat].splice(fromIdx,1)[0];
  evTeams[toTeam][toCatKey].push(player);evDragSrcData=null;
  await saveEvTeamsToDB();renderEventTeams();
}
function evDragEnd(){evDragSrcData=null;document.querySelectorAll('.ev-team-player').forEach(el=>{el.classList.remove('dragging-team');el.classList.remove('drag-over-team');});}

function closeTddReplaceMenu(){
  const menu=document.getElementById('tddReplaceMenu');
  if(menu)menu.remove();
}

function openTddReplaceMenu(event,teamKey,catKey,idx){
  event.preventDefault();
  event.stopPropagation();
  closeTddReplaceMenu();
  if(!evTeams||!evTeams[teamKey]||!evTeams[teamKey][catKey])return;
  const current=evTeams[teamKey][catKey][idx];
  if(!current)return;

  const placedIds=new Set();
  ['A','B'].forEach(tk=>{
    if(!evTeams[tk])return;
    CATEGORIES.forEach(cat=>(evTeams[tk][cat.key]||[]).forEach(p=>placedIds.add(p.id)));
  });
  const candidates=sortTddPlayers(participants.filter(p=>!placedIds.has(p.id)&&evRoles[p.id]!=='none'));
  if(!candidates.length){toast('Aucun joueur non placé disponible');return;}

  const menu=document.createElement('div');
  menu.id='tddReplaceMenu';
  menu.className='tdd-replace-menu';
  const title=document.createElement('div');
  title.className='tdd-replace-title';
  title.textContent=`Remplacer ${current.name} · ${catKey}`;
  menu.appendChild(title);

  candidates.forEach(p=>{
    const role=evRoles[p.id]==='starter'?'T':'R';
    const count=Number(tddNonRetenus[p.id])||0;
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='tdd-replace-item';
    const roleSpan=document.createElement('span');
    roleSpan.className='tdd-replace-role';
    roleSpan.textContent=role;
    const nameSpan=document.createElement('span');
    nameSpan.className='tdd-replace-name';
    nameSpan.textContent=p.name;
    const infoSpan=document.createElement('span');
    infoSpan.className='tdd-replace-info';
    const bits=[];
    if(p.power_t1)bits.push(t1FormatPower(p.power_t1));
    if(count>0)bits.push(`🔄 ×${count}`);
    infoSpan.textContent=bits.join(' · ');
    btn.append(roleSpan,nameSpan,infoSpan);
    btn.addEventListener('click',async e=>{
      e.stopPropagation();
      closeTddReplaceMenu();
      await applyTddReplacement(teamKey,catKey,idx,p.id);
    });
    menu.appendChild(btn);
  });

  const closeBtn=document.createElement('button');
  closeBtn.type='button';
  closeBtn.textContent='Annuler';
  closeBtn.className='tdd-replace-cancel';
  closeBtn.onclick=closeTddReplaceMenu;
  menu.appendChild(closeBtn);
  document.body.appendChild(menu);

  const r=event.currentTarget.getBoundingClientRect();
  const margin=8;
  let left=r.left;
  let top=r.bottom+margin;
  if(left+menu.offsetWidth>window.innerWidth-margin)left=Math.max(margin,window.innerWidth-menu.offsetWidth-margin);
  if(top+menu.offsetHeight>window.innerHeight-margin)top=Math.max(margin,r.top-menu.offsetHeight-margin);
  menu.style.left=`${left}px`;
  menu.style.top=`${top}px`;
  setTimeout(()=>{
    const onDocClick=e=>{
      if(!menu.contains(e.target)&&e.target!==event.currentTarget){closeTddReplaceMenu();document.removeEventListener('click',onDocClick,true);}
    };
    document.addEventListener('click',onDocClick,true);
  },0);
}

async function applyTddReplacement(teamKey,catKey,idx,replacementId){
  if(!evTeams||!evTeams[teamKey]||!evTeams[teamKey][catKey])return;
  const current=evTeams[teamKey][catKey][idx];
  const replacement=participants.find(p=>String(p.id)===String(replacementId));
  if(!current||!replacement)return;
  const placedIds=new Set();
  ['A','B'].forEach(tk=>{
    if(!evTeams[tk])return;
    CATEGORIES.forEach(cat=>(evTeams[tk][cat.key]||[]).forEach(p=>placedIds.add(p.id)));
  });
  if(placedIds.has(replacement.id)){toast('Ce joueur est déjà placé dans une équipe');return;}

  // Remplacement = échange logique : le joueur non placé entre dans
  // exactement le même slot, et le joueur sorti redevient non placé.
  evTeams[teamKey][catKey][idx]=replacement;

  // Le joueur entrant consomme une rotation : x2 -> x1, x1 disparaît.
  const replacementCount=Number(tddNonRetenus[replacement.id])||0;
  if(replacementCount>1)tddNonRetenus[replacement.id]=replacementCount-1;
  else if(replacementCount===1)delete tddNonRetenus[replacement.id];

  // Le joueur sorti devient à nouveau non placé pour cette semaine.
  // On lui attribue une rotation à rattraper afin qu'il apparaisse dans
  // la zone « Non placés » dès qu'il quitte l'équipe.
  const currentCount=Number(tddNonRetenus[current.id])||0;
  tddNonRetenus[current.id]=currentCount+1;

  await saveTddNonRetenus();
  await saveEvTeamsToDB();
  renderEventTeams();
  renderTddNonRetenus();
  toast(`${replacement.name} remplace ${current.name} dans ${catKey} — Équipe ${teamKey}`);
}

function replaceTeamPlayer(teamKey,catKey,idx){
  const button=event?.currentTarget;
  if(button)openTddReplaceMenu(event,teamKey,catKey,idx);
}

async function switchTeam(fromTeam,fromCat,idx){
  if(!evTeams||!evTeams.B)return;const toTeam=fromTeam==='A'?'B':'A';
  const preview=evTeams[fromTeam][fromCat][idx];if(preview&&!tddSlotCompatible(preview.id,toTeam)){toast('Horaire incompatible pour ce joueur');return;}
  const player=evTeams[fromTeam][fromCat].splice(idx,1)[0];
  const toCat=evTeams[toTeam][fromCat];const catDef=CATEGORIES.find(c=>c.key===fromCat);
  if(catDef&&toCat.length<catDef.size){toCat.push(player);}
  else{let placed=false;for(const cat of CATEGORIES){const arr=evTeams[toTeam][cat.key];const def=CATEGORIES.find(c=>c.key===cat.key);if(def&&arr.length<def.size){arr.push(player);placed=true;break;}}if(!placed)evTeams[toTeam]['SUB'].push(player);}
  await saveEvTeamsToDB();renderEventTeams();toast(`${player.name} → Équipe ${toTeam}`);
}

function renderEventTeams(){
  const result=document.getElementById('evTeamsResult');
  updateEvBanner();
  if(!evTeams){result.innerHTML='';return;}
  const powA=teamTotalPower(evTeams.A);const powB=evTeams.B?teamTotalPower(evTeams.B):0;
  let balanceHtml='';
  if(evTeams.B){
    const diff=Math.abs(powA-powB);const total=powA+powB;const pct=total>0?Math.round(diff/total*100):0;
    const cls=pct<=5?'ev-balance-pill':'ev-balance-pill warn';
    const icon=pct<=5?'✓ Très équilibré':pct<=10?'~ Bon équilibre':'⚠️ Déséquilibré';
    balanceHtml=`<div class="ev-balance-info" style="margin-bottom:14px"><span class="${cls}">Écart A/B : ${diff.toLocaleString('fr-FR')} pts (${pct}%) — ${icon}</span></div>`;
  }
  const renderTeam=(teamKey,label,headerCls)=>{
    const team=evTeams[teamKey];if(!team)return'';
    const pow=teamTotalPower(team);const stCount=STARTER_CATS.reduce((s,k)=>s+(team[k]||[]).length,0);const subCount=(team['SUB']||[]).length;
    const otherTeam=teamKey==='A'?'B':'A';const hasOtherTeam=!!evTeams.B;
    const catsHtml=CATEGORIES.map(cat=>{
      const players=team[cat.key]||[];const isEmpty=players.length===0;
      const playersHtml=players.map((p,i)=>{
        const switchBtn=hasOtherTeam?`<button onclick="switchTeam('${teamKey}','${cat.key}',${i})" style="background:rgba(255,255,255,0.04);border:1px solid var(--border2);border-radius:6px;cursor:pointer;font-size:11px;padding:2px 8px;color:var(--text2);white-space:nowrap;flex-shrink:0;transition:all .15s">↔ ${otherTeam}</button>`:'';
        const replaceBtn=`<button onclick="openTddReplaceMenu(event,'${teamKey}','${cat.key}',${i})" title="Remplacer par un joueur non placé" style="background:rgba(124,159,255,0.07);border:1px solid rgba(124,159,255,0.2);border-radius:6px;cursor:pointer;font-size:11px;padding:2px 7px;color:var(--blue);white-space:nowrap;flex-shrink:0;transition:all .15s">⇄ Remplacer</button>`;
        const roleLetter=evRoles[p.id]==='starter'?'T':evRoles[p.id]==='sub'?'R':'';
        const roleBadge=roleLetter?`<span style="font-size:11px;font-weight:800;color:var(--text2);min-width:14px;text-align:center" title="${roleLetter==='T'?'Titulaire':'Remplaçant'}">${roleLetter}</span>`:'';
        return `<div class="ev-team-player" data-ev-team="${teamKey}" data-ev-cat="${cat.key}" data-ev-idx="${i}" draggable="true" ondragstart="evDragStart(event,'${teamKey}','${cat.key}',${i})" ondragend="evDragEnd()"><span class="ev-pnum">${i+1}</span>${roleBadge}<span class="ev-pname">${p.name}</span>${replaceBtn}${switchBtn}<span style="font-size:11px;color:var(--text4);cursor:grab;flex-shrink:0">⠿</span></div>`;
      }).join('');
      const isFull=players.length>=cat.size;const dropZone=`<div class="ev-cat-drop" ondragover="evDropZoneOver(event,'${teamKey}','${cat.key}')" ondragleave="evDropZoneLeave(event)" ondrop="evDropOnCatUniversal(event,'${teamKey}','${cat.key}')" style="min-height:${isEmpty?'38px':'4px'};display:flex;align-items:center;justify-content:center;border-radius:6px;transition:all .15s">${isEmpty?`<span style="font-size:11px;color:var(--text3);font-style:italic">${isFull?'Plein':'Déposer ici'}</span>`:''}</div>`;
      return `<div class="ev-cat-block" style="border-left:2px solid ${cat.color}"><div class="ev-cat-header" style="background:${cat.bg}"><span class="ev-cat-title" style="color:${cat.color}">${cat.label}</span><span class="ev-cat-info">${players.length}/${cat.size}</span></div>${playersHtml}${dropZone}</div>`;
    }).join('');
    return `<div class="ev-team-card"><div class="ev-team-header ${headerCls}"><span class="ev-team-title ${headerCls}">⚔️ ${label} — ${tddSlotLabel(tddTeamSlots[teamKey])}</span><span class="ev-team-power">${stCount} tit. · ${subCount} rempl.</span></div><div class="ev-team-body">${catsHtml}</div><button class="ev-copy-btn" onclick="evCopyTeam('${teamKey}','${label}')">📋 Copier ${label}</button></div>`;
  };
  result.innerHTML=`${balanceHtml}<div class="ev-teams-grid${evTeams.B?' two':''}">
    ${renderTeam('A','Équipe A','teamA')}
    ${evTeams.B?renderTeam('B','Équipe B','teamB'):''}
  </div>`;
}

function evCopyTeam(teamKey,label){
  if(!evTeams||!evTeams[teamKey])return;
  const team=evTeams[teamKey];
  let txt=`⚔️ ${label} — ${tddSlotLabel(tddTeamSlots[teamKey])}\n`;
  CATEGORIES.forEach(cat=>{
    const players=team[cat.key]||[];
    if(!players.length)return;
    txt+=`\n— ${cat.label} —\n`;
    players.forEach(p=>{txt+=`${p.name}\n`;});
  });
  navigator.clipboard.writeText(txt.trim()).then(()=>toast(`${label} copiée !`)).catch(()=>toast('Erreur de copie'));
}

function applyTheme(theme){
  if(theme==='light'){document.body.classList.add('light');const btn=document.getElementById('themeToggleBtn');if(btn)btn.textContent='☀️';}
  else{document.body.classList.remove('light');const btn=document.getElementById('themeToggleBtn');if(btn)btn.textContent='🌙';}
}

function toggleTheme(){
  const isLight=document.body.classList.contains('light');
  const newTheme=isLight?'dark':'light';
  localStorage.setItem(THEME_KEY,newTheme);
  applyTheme(newTheme);
}

function loadTheme(){
  const saved=localStorage.getItem(THEME_KEY)||'light';
  applyTheme(saved);
}

async function startApp(){
  const ok=initSB();
  if(!ok){
    document.getElementById('loginError').textContent=!SUPABASE_URL||!SUPABASE_KEY
      ?'Configure l’URL et la clé anon en haut du fichier.'
      :'Erreur : impossible de charger Supabase.';
    document.getElementById('loginBtn').disabled=true;
    return;
  }
  if(document.documentElement.classList.contains('public-poll-route')){
    checkPollMode();
    return;
  }
  await loadAllianceName();
  if(checkPollMode())return;
  await checkSession();
}

window.addEventListener('load',()=>{
  window._appReady=true;
  loadTheme();
  setTimeout(()=>{
    if(typeof supabase!=='undefined'){
      window._supabaseReady=true;
      startApp();
    }else{
      document.getElementById('loginError').textContent='Erreur : Supabase non chargé.';
    }
  },500);
});

// ══ RECENSEMENT PUISSANCE T1 ══
let t1Players=[],t1Entries={},t1Busy=false,t1OcrLoaded=false,t1CurrentRound=null;
const t1Url=()=>window.location.href.split('?')[0]+'?poll=t1';
function t1Status(message,isError=false){const el=document.getElementById('t1Status');if(el){el.textContent=message;el.style.color=isError?'var(--red)':'var(--text2)';}}
function checkT1PollMode(){
  document.getElementById('loginScreen').style.display='none';
  document.getElementById('appScreen').style.display='none';
  document.getElementById('t1PollOverlay').style.display='flex';
  initT1Poll();return true;
}
async function initT1Poll(){
  if(!sb){setTimeout(initT1Poll,200);return;}
  try{
    const [p,r]=await Promise.all([sb.from('participants').select('id,name').order('name'),sb.from('t1_rounds').select('id,label,opened_at').eq('status','open').order('opened_at',{ascending:false}).limit(1)]);
    if(p.error)throw p.error;if(r.error)throw r.error;
    t1CurrentRound=r.data?.[0]||null;t1Players=p.data||[];
    await refreshT1Select();
    const locked=t1CurrentRound&&localStorage.getItem(participationKey('t1',t1CurrentRound.id));
    document.getElementById('t1Form').style.display=(!t1CurrentRound||locked)?'none':'block';
    document.getElementById('t1Success').style.display=locked?'block':'none';
    if(locked)document.getElementById('t1SuccessText').textContent='Tu as déjà participé à ce recensement. Reviens lors de la prochaine session.';
    const closedInfo=document.getElementById('t1ClosedInfo');if(closedInfo)closedInfo.style.display=!t1CurrentRound?'block':'none';
    document.getElementById('t1RoundLabel').textContent=t1CurrentRound?'🟢 Sondage en cours — '+t1CurrentRound.label:'🔒 Sondage clos';
    renderT1Select();
    sb.channel('t1_poll_public').on('postgres_changes',{event:'*',schema:'public',table:'t1_submissions'},()=>refreshT1Select()).on('postgres_changes',{event:'*',schema:'public',table:'t1_rounds'},()=>initT1Poll()).subscribe();
  }catch(e){t1Status('Impossible de charger le sondage T1 : '+e.message,true);}
}
async function refreshT1Select(){
  const {data,error}=t1CurrentRound?await sb.from('t1_submissions').select('participant_id').eq('round_id',t1CurrentRound.id):{data:[],error:null};
  if(!error){t1Entries=Object.fromEntries((data||[]).map(x=>[x.participant_id,true]));renderT1Select();}
}
function renderT1Select(){
  const el=document.getElementById('t1Player');if(!el)return;
  const previous=el.value;el.replaceChildren(new Option('— Sélectionne ton pseudo —',''));
  t1Players.filter(p=>!t1Entries[p.id]).forEach(p=>el.add(new Option(p.name,String(p.id))));
  if([...el.options].some(o=>o.value===previous))el.value=previous;
  if(!t1CurrentRound){el.options[0].textContent='Aucun recensement ouvert';el.disabled=true;}
  else if(el.options.length===1){el.options[0].textContent='Tous les joueurs ont répondu';el.disabled=true;}
  else el.disabled=false;
}
function t1ParsePower(raw){
  let s=String(raw||'').trim().toUpperCase().replace(/\s/g,'').replace(/,/g,'.');
  const m=s.match(/^(\d+(?:\.\d+)?)([MK]?)$/);
  if(!m)return null;
  const amount=Number(m[1]);
  // Sans suffixe, les petites valeurs sont des millions (18.31 = 18.31M).
  // Une valeur brute déjà en unités (ex. 18310000) reste acceptée.
  const n=amount*(m[2]==='M'?1e6:m[2]==='K'?1e3:amount<=1000?1e6:1);
  return Number.isSafeInteger(Math.round(n))&&n>0&&n<=1e12?Math.round(n):null;
}
function t1FormatPower(n){return (Number(n)/1e6).toFixed(2)+'M';}
function t1PowerChanged(){
  const input=document.getElementById('t1Power');
  const btn=document.getElementById('t1SubmitBtn');
  const file=document.getElementById('t1Image').files[0];
  const valid=!!t1ParsePower(input.value);
  if(btn)btn.disabled=t1Busy||!file||!valid;
  input.setAttribute('aria-invalid',input.value&&!valid?'true':'false');
}
function t1ImageChanged(){
  const file=document.getElementById('t1Image').files[0];const img=document.getElementById('t1Preview');
  if(!file){img.style.display='none';document.getElementById('t1Power').value='';document.getElementById('t1SubmitBtn').disabled=true;t1Status('');return;}
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){
    document.getElementById('t1Image').value='';img.style.display='none';t1Status('Image JPG, PNG ou WEBP de 5 Mo maximum.',true);return;
  }
  img.src=URL.createObjectURL(file);img.style.display='block';img.onload=()=>URL.revokeObjectURL(img.src);
  document.getElementById('t1Power').value='';
  document.getElementById('t1SubmitBtn').disabled=true;
  t1Recognize(file);
}
async function t1Recognize(selectedFile){
  const status=(message,error=false)=>t1Status(message,error);
  const input=document.getElementById('t1Image');
  const file=selectedFile || (input && input.files && input.files[0]);
  if(!file){status('Choisis une capture d’écran.',true);return;}
  const submitBtn=document.getElementById('t1SubmitBtn');
  if(submitBtn)submitBtn.disabled=true;
  const timeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),ms))]);
  try{
    status('Chargement de la reconnaissance… La première utilisation peut prendre 20 à 40 secondes.');
    if(!window.Tesseract){
      await timeout(new Promise((resolve,reject)=>{
        const sc=document.createElement('script');
        sc.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        sc.onload=resolve;
        sc.onerror=()=>reject(new Error('Impossible de charger la bibliothèque OCR (connexion ou bloqueur de scripts).'));
        document.head.appendChild(sc);
      }),20000,'Chargement OCR trop long. Vérifie ta connexion Internet.');
    }
    if(!window.Tesseract)throw new Error('Bibliothèque OCR non chargée.');
    status('Préparation de la capture…');
    const bmp=await timeout(createImageBitmap(file),12000,'Impossible de décoder cette image. Essaie un fichier JPG ou PNG.');
    // Plusieurs cadrages : les captures peuvent varier selon l'appareil.
    const crops=[
      [.28,0,.46,.105],
      [.18,0,.65,.16],
      [0,0,1,.20]
    ];
    const found=[];const readings=[];
    for(let k=0;k<crops.length;k++){
      const [rx,ry,rw,rh]=crops[k];
      const sx=Math.round(bmp.width*rx),sy=Math.round(bmp.height*ry);
      const sw=Math.max(1,Math.round(bmp.width*rw)),sh=Math.max(1,Math.round(bmp.height*rh));
      const canvas=document.createElement('canvas');
      const scale=Math.min(4,1800/sw);
      canvas.width=Math.round(sw*scale);canvas.height=Math.round(sh*scale);
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.drawImage(bmp,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
      const variants=[canvas];
      const bw=document.createElement('canvas');bw.width=canvas.width;bw.height=canvas.height;
      const bc=bw.getContext('2d',{willReadFrequently:true});bc.drawImage(canvas,0,0);
      const pixels=bc.getImageData(0,0,bw.width,bw.height);
      for(let j=0;j<pixels.data.length;j+=4){
        const r=pixels.data[j],g=pixels.data[j+1],b=pixels.data[j+2];
        const yellow=r>120&&g>95&&r>b*1.25&&g>b*1.2;
        const v=yellow?0:255;
        pixels.data[j]=pixels.data[j+1]=pixels.data[j+2]=v;
      }
      bc.putImageData(pixels,0,0);variants.push(bw);
      for(let v=0;v<variants.length;v++){
        status('Analyse de la puissance : essai '+(k*2+v+1)+'/6…');
        const result=await timeout(window.Tesseract.recognize(variants[v],'eng',{
          tessedit_pageseg_mode:6,
          tessedit_char_whitelist:'0123456789.,Mm '
        }),45000,'Reconnaissance trop longue.');
        const txt=(result.data.text||'').toUpperCase().replace(/,/g,'.');
        readings.push(txt.trim().replace(/\s+/g,' '));
        // Le M est parfois lu comme absent, mais le séparateur décimal doit être présent.
        for(const m of txt.matchAll(/(?:^|[^\d])(\d{1,3})\s*[.]\s*(\d{1,3})\s*M?(?=$|[^\d])/g)){
          const raw=m[1]+'.'+m[2]+'M';
          if(t1ParsePower(raw))found.push(raw);
        }
      }
      if(found.length)break;
    }
    if(bmp.close)bmp.close();
    const unique=[...new Set(found)];
    if(unique.length!==1){
      const debug=readings.filter(Boolean).slice(0,4).join(' | ').slice(0,130);
      throw new Error((unique.length?'Lectures différentes : '+unique.join(' / '):'Puissance non reconnue')+(debug?' (texte lu : '+debug+')':''));
    }
    const value=t1ParsePower(unique[0]);
    if(input.files[0]!==file)return; // Ignorer une ancienne lecture si une autre capture a été choisie.
    document.getElementById('t1Power').value=t1FormatPower(value);
    t1PowerChanged();
    status('Puissance détectée : '+t1FormatPower(value)+'. Vérifie avant de valider.');
  }catch(e){
    console.error('Lecture T1 :',e);
    if(input.files[0]!==file)return;
    status((e && e.message?e.message:'Erreur lors de la lecture.')+' Tu peux saisir la puissance dans la case, en conservant la capture.',true);
  }finally{
    if(input.files[0]===file)t1PowerChanged();
  }
}
async function t1Submit(){
  if(t1Busy)return;
  const select=document.getElementById('t1Player'),id=Number(select.value);
  const p=t1Players.find(x=>x.id===id),power=t1ParsePower(document.getElementById('t1Power').value);
  if(!t1CurrentRound){t1Status('Aucun recensement T1 ouvert.',true);return;}
  if(!p){t1Status('Sélectionne ton pseudo.',true);return;}
  if(!power){t1Status('Vérifie la puissance : indique par exemple 18.31 ou 18.31M.',true);return;}
  const file=document.getElementById('t1Image').files[0];
  if(!file){t1Status('Ajoute une capture d’écran pour déclarer ta puissance.',true);return;}
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){t1Status('Capture invalide (5 Mo max).',true);return;}
  if(!confirm(p.name+' : confirmer ta puissance T1 de '+t1FormatPower(power)+' ? Tu ne pourras plus la modifier.'))return;
  t1Busy=true;document.getElementById('t1SubmitBtn').disabled=true;
  let imagePath=null;
  try{
    if(file){
      t1Status('Envoi de la capture…');
      imagePath=crypto.randomUUID()+'.'+({ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type]);
      const up=await sb.storage.from('t1-captures').upload(imagePath,file,{contentType:file.type,upsert:false});
      if(up.error)throw up.error;
    }
    t1Status('Enregistrement de la puissance…');
    const {error}=await sb.rpc('t1_submit_once',{p_participant_id:id,p_power:power,p_image_path:imagePath,p_round_id:t1CurrentRound.id});
    if(error)throw error;
    t1Entries[id]=true;localStorage.setItem(participationKey('t1',t1CurrentRound.id),String(id));document.getElementById('t1Form').style.display='none';
    document.getElementById('t1Success').style.display='block';
    document.getElementById('t1SuccessText').textContent=p.name+' — '+t1FormatPower(power)+' enregistrés.';
  }catch(e){
    // Une capture orpheline peut être nettoyée ultérieurement par le staff.
    t1Status(e.code==='23505'?'Ce pseudo a déjà transmis sa puissance.':('Envoi impossible : '+e.message),true);
    await refreshT1Select();
  }finally{t1Busy=false;document.getElementById('t1SubmitBtn').disabled=false;}
}
// Nombre de déclarations pour le recensement T1 actuellement ouvert.
let t1CounterRequestInFlight=false;
async function refreshT1ResponseCounter(){
  const el=document.getElementById('t1ResponseCounter');
  if(!el||!sb||t1CounterRequestInFlight)return;
  t1CounterRequestInFlight=true;
  try{
    const {data:rounds,error:roundError}=await sb.from('t1_rounds').select('id').eq('status','open').order('opened_at',{ascending:false}).limit(1);
    if(roundError)throw roundError;
    if(!rounds?.length){el.style.display='none';el.textContent='';return;}
    const {count,error}=await sb.from('t1_submissions').select('participant_id',{count:'exact',head:true}).eq('round_id',rounds[0].id);
    if(error)throw error;
    el.textContent=(count??0)+' réponse'+(count===1?'':'s');
    el.style.display='inline';
  }catch(e){console.warn('Compteur T1 :',e);el.style.display='none';}
  finally{t1CounterRequestInFlight=false;}
}
// Le compteur se rafraîchit même lorsque la publication Realtime n'est pas activée.
setInterval(()=>{if(currentUser)refreshT1ResponseCounter();},15000);
async function openT1StaffModal(){
  const modal=document.getElementById('t1StaffModal');modal.style.display='flex';
  document.getElementById('t1ShareLink').value=t1Url();
  if(!isAdminOrStaff()){document.getElementById('t1StaffList').textContent='Seul le staff peut consulter et corriger les déclarations.';return;}
  await loadT1Staff();
  await refreshT1ResponseCounter();
}
async function loadT1Staff(){
  const el=document.getElementById('t1StaffList');el.textContent='Chargement…';
  const [pr,rr]=await Promise.all([sb.from('participants').select('id,name,power_t1').order('name'),sb.from('t1_rounds').select('id,label,status,opened_at').order('opened_at',{ascending:false})]);
  const round=rr.data?.find(x=>x.status==='open');
  const sr=round?await sb.from('t1_submissions').select('participant_id,power,image_path,updated_at').eq('round_id',round.id):{data:[],error:null};
  if(pr.error||rr.error||sr.error){el.textContent='Erreur : '+(pr.error||rr.error||sr.error).message;return;}
  document.getElementById('t1StaffRoundInfo').textContent=round?'🟢 Sondage en cours — '+round.label:'🔒 Sondage clos';
  refreshT1ResponseCounter();
  const entries=Object.fromEntries((sr.data||[]).map(x=>[x.participant_id,x]));el.replaceChildren();
  (pr.data||[]).forEach(p=>{
    const v=entries[p.id];const row=document.createElement('div');row.className='t1-staff-row';
    const name=document.createElement('strong');name.textContent=p.name;
    const input=document.createElement('input');input.className='t1-field';input.value=v?t1FormatPower(v.power):'';input.placeholder='53,12M';
    const btn=document.createElement('button');btn.className='btn';btn.textContent='Corriger';btn.onclick=()=>t1StaffCorrect(p,input);
    row.append(name,input,btn);
    if(v?.image_path){const link=document.createElement('button');link.className='btn';link.textContent='📷 Voir capture';link.onclick=()=>t1StaffViewImage(v.image_path);row.appendChild(link);}
    el.appendChild(row);
  });
}
async function t1StaffViewImage(path){
  const hash=await getStaffActionHash();if(!hash)return;
  try{
    
    const {data,error}=await sb.rpc('t1_staff_check',{p_username:currentUser.username,p_password_hash:hash});
    if(error||!data)throw (error||new Error('Accès refusé'));
    const url=sb.storage.from('t1-captures').getPublicUrl(path).data.publicUrl;
    window.open(url,'_blank','noopener');
  }catch(e){alert('Impossible de consulter la capture : '+e.message);}
}
async function t1StaffCorrect(p,input){
  const power=t1ParsePower(input.value);if(!power){alert('Puissance invalide.');return;}
  const hash=await getStaffActionHash();if(!hash)return;
  try{
    
    const {error}=await sb.rpc('t1_correct_power_v3',{p_username:currentUser.username,p_account_hash:hash,p_participant_id:p.id,p_power:power});
    if(error)throw error;
    toast('Puissance T1 corrigée.');await loadT1Staff();
  }catch(e){alert('Correction impossible : '+e.message);}
}

async function t1StaffNewRound(){
 if(!isAdminOrStaff())return;
 const label=prompt('Nom du nouveau recensement (ex. 15 octobre 2026) :');if(!label?.trim())return;
 const hash=await getStaffActionHash();if(!hash)return;
 try{
  const {error}=await sb.rpc('t1_open_round_v3',{p_username:currentUser.username,p_account_hash:hash,p_label:label.trim()});
  if(error)throw error;toast('Nouveau recensement T1 ouvert.');await loadT1Staff();
 }catch(e){alert('Impossible d’ouvrir le recensement : '+e.message);}
}
async function t1StaffCloseRound(){
 if(!isAdminOrStaff()){alert('Connecte-toi avec un compte staff ou administrateur pour clôturer le recensement.');return;}
 if(!confirm('Clôturer le recensement T1 en cours ?'))return;
 const hash=await getStaffActionHash();if(!hash)return;
 try{
  const {error}=await sb.rpc('t1_close_round_v3',{p_username:currentUser.username,p_account_hash:hash});
  if(error)throw error;toast('Recensement T1 clôturé.');await loadT1Staff();
 }catch(e){alert('Impossible de clôturer : '+e.message);}
}
function t1SafeText(v){return String(v??'');}
async function loadT1History(){
 const el=document.getElementById('t1HistoryStats');if(!el)return;el.textContent='Chargement de l’historique T1…';
 const [r,v,p]=await Promise.all([sb.from('t1_rounds').select('id,label,opened_at,status').order('opened_at'),sb.from('t1_submissions').select('round_id,participant_id,power'),sb.from('participants').select('id,name').order('name')]);
 if(r.error||v.error||p.error){el.textContent='Historique indisponible : '+(r.error||v.error||p.error).message;return;}
 const rounds=r.data||[],votes=v.data||[],players=p.data||[];el.replaceChildren();
 const header=document.createElement('p');header.className='t1-help';header.textContent=rounds.length+' recensement(s) • '+votes.length+' déclaration(s). Les périodes sans réponse restent vides.';el.appendChild(header);
 if(!rounds.length){el.append('Aucun recensement T1 enregistré.');return;}
 const sel=document.createElement('select');sel.className='t1-field';sel.style.maxWidth='400px';sel.append(new Option('— Choisir un joueur —',''));
 players.forEach(x=>sel.add(new Option(x.name,String(x.id))));el.appendChild(sel);
 const result=document.createElement('div');result.style.marginTop='18px';el.appendChild(result);
 const render=()=>{
  result.replaceChildren();const id=Number(sel.value);if(!id){result.textContent='Sélectionne un joueur pour voir sa progression.';return;}
  const vals=rounds.map(round=>({round,power:votes.find(x=>x.round_id===round.id&&x.participant_id===id)?.power??null}));
  const known=vals.filter(x=>x.power!==null);if(!known.length){result.textContent='Aucune puissance déclarée pour ce joueur.';return;}
  const first=known[0].power,last=known[known.length-1].power,delta=last-first;
  const summary=document.createElement('h3');summary.textContent='Dernière puissance : '+t1FormatPower(last)+' • Évolution : '+(delta>=0?'+':'')+t1FormatPower(delta)+' ('+(first?((delta/first)*100).toFixed(1):'0')+' %)';result.appendChild(summary);
  // Courbe T1 : axes chiffrés, étiquettes, valeurs et périodes manquantes visibles.
  const svgNS='http://www.w3.org/2000/svg',svg=document.createElementNS(svgNS,'svg');
  const W=Math.max(760,vals.length*88+120),H=340,L=82,R=35,T=44,B=74;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('role','img');
  svg.setAttribute('aria-label','Évolution de la puissance T1 en millions pour '+(players.find(x=>Number(x.id)===id)?.name||'ce joueur'));
  svg.style.cssText=`width:${W}px;max-width:none;display:block;background:#f8fbff;border-radius:12px`;
  const wrap=document.createElement('div');wrap.style.cssText='overflow-x:auto;max-width:100%;border:1px solid var(--border);border-radius:14px;background:#f8fbff;padding:6px;margin:16px 0';wrap.appendChild(svg);result.appendChild(wrap);
  const add=(tag,attrs,text)=>{const n=document.createElementNS(svgNS,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,String(v)));if(text!==undefined)n.textContent=text;svg.appendChild(n);return n;};
  const powers=known.map(x=>Number(x.power)/1e6),rawMin=Math.min(...powers),rawMax=Math.max(...powers);
  const pad=Math.max((rawMax-rawMin)*.15,rawMax*.025,.5),lo=Math.max(0,rawMin-pad),hi=rawMax+pad;
  const px=i=>L+(i*(W-L-R)/Math.max(1,vals.length-1));
  const py=p=>T+(hi-p/1e6)/(hi-lo)*(H-T-B);
  add('text',{x:L,y:24,fill:'#223650','font-size':15,'font-weight':700},'PUISSANCE T1 (M)');
  for(let i=0;i<=4;i++){
    const power=lo+(hi-lo)*i/4,y=T+(H-T-B)*(1-i/4);
    add('line',{x1:L,y1:y,x2:W-R,y2:y,stroke:'#dbe5ef','stroke-width':1});
    add('text',{x:L-12,y:y+5,'text-anchor':'end',fill:'#52647a','font-size':13},power.toFixed(1)+'M');
  }
  let prev=null;
  vals.forEach((entry,i)=>{
    const x=px(i),power=entry.power,y=power===null?null:py(Number(power));
    add('text',{x,y:H-38,'text-anchor':'middle',fill:'#334a65','font-size':13,'font-weight':600},'R'+(i+1));
    const roundLabel=String(entry.round.label||'Recensement '+(i+1));
    const date=entry.round.opened_at?new Date(entry.round.opened_at).toLocaleDateString('fr-FR'):'',short=(roundLabel.length>14?roundLabel.slice(0,12)+'…':roundLabel);
    add('text',{x,y:H-20,'text-anchor':'middle',fill:'#68788d','font-size':10},short);
    if(y===null){add('text',{x,y:T+20,'text-anchor':'middle',fill:'#9aa5b5','font-size':12},'—');prev=null;return;}
    if(prev)add('line',{x1:prev.x,y1:prev.y,x2:x,y2:y,stroke:'#2372c9','stroke-width':3.5,'stroke-linecap':'round'});
    add('circle',{cx:x,cy:y,r:6,fill:'#ff9d27',stroke:'#fff','stroke-width':2});
    const valueLabel=(Number(power)/1e6).toFixed(2)+'M';
    add('text',{x,y:Math.max(31,y-13),'text-anchor':'middle',fill:'#173d6b','font-size':13,'font-weight':700},valueLabel);
    const tooltip=document.createElementNS(svgNS,'title');tooltip.textContent=roundLabel+(date?' • '+date:'')+' : '+valueLabel;svg.lastChild.appendChild(tooltip);
    prev={x,y};
  });
  const note=document.createElement('p');note.className='t1-help';note.textContent='Valeurs en millions (M). Les recensements sans réponse ne sont pas reliés. Sur téléphone, fais glisser le graphique horizontalement si nécessaire.';result.appendChild(note);
  const saveBtn=document.createElement('button');saveBtn.type='button';saveBtn.className='btn';saveBtn.style.margin='6px 0 18px';saveBtn.textContent='📷 Enregistrer le graphique T1 en JPEG';
  saveBtn.onclick=()=>saveT1HistoryJpeg(svg,players.find(x=>Number(x.id)===id)?.name||'joueur');result.appendChild(saveBtn);
  const table=document.createElement('table');table.style.cssText='width:100%;border-collapse:collapse';
  const head=document.createElement('tr');['Recensement','Puissance T1','Évolution'].forEach(t=>{const th=document.createElement('th');th.textContent=t;th.style.padding='9px';head.appendChild(th);});table.appendChild(head);
  let prior=null;vals.forEach(x=>{const tr=document.createElement('tr');const diff=x.power!==null&&prior!==null?x.power-prior:null;[x.round.label,x.power===null?'Non répondu':t1FormatPower(x.power),diff===null?'—':(diff>=0?'+':'')+t1FormatPower(diff)].forEach(t=>{const td=document.createElement('td');td.textContent=t;td.style.cssText='padding:9px;border-top:1px solid var(--border)';tr.appendChild(td);});table.appendChild(tr);if(x.power!==null)prior=x.power;});result.appendChild(table);
 };sel.onchange=render;render();
}

function downloadAllianceJpeg(canvas,filename){
  if(!canvas||!canvas.width||!canvas.height){alert('Aucun graphique à enregistrer.');return;}
  const out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height;
  const ctx=out.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(canvas,0,0);
  out.toBlob(blob=>{if(!blob){alert('Impossible de créer le JPEG.');return;}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  },'image/jpeg',0.94);
}
function saveAllianceChartJpeg(){
  const canvas=document.getElementById('chartBuilderCanvas');
  if(!canvas||canvas.style.display==='none'||document.getElementById('chartBuilderEmpty')?.style.display!=='none'){
    alert('Génère d’abord un graphique.');return;
  }
  downloadAllianceJpeg(canvas,'NA1N-graphique-puissance-'+new Date().toISOString().slice(0,10)+'.jpg');
}
function saveT1HistoryJpeg(svg,player){
  const copy=svg.cloneNode(true);copy.setAttribute('xmlns','http://www.w3.org/2000/svg');copy.setAttribute('width','1360');copy.setAttribute('height','680');
  copy.querySelectorAll('[fill="currentColor"]').forEach(n=>n.setAttribute('fill','#26344c'));
  copy.querySelectorAll('[stroke="currentColor"]').forEach(n=>n.setAttribute('stroke','#8a96a8'));
  const bg=document.createElementNS('http://www.w3.org/2000/svg','rect');const vb=svg.viewBox.baseVal;bg.setAttribute('width',String(vb.width));bg.setAttribute('height',String(vb.height));bg.setAttribute('fill','#ffffff');copy.insertBefore(bg,copy.firstChild);
  const blob=new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml;charset=utf-8'});
  const url=URL.createObjectURL(blob),img=new Image();
  img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=1360;canvas.height=680;canvas.getContext('2d').drawImage(img,0,0,1360,680);URL.revokeObjectURL(url);
    downloadAllianceJpeg(canvas,'NA1N-evolution-T1-'+String(player).replace(/[^a-z0-9_-]/gi,'_').slice(0,45)+'.jpg');};
  img.onerror=()=>{URL.revokeObjectURL(url);alert('Impossible de convertir le graphique en JPEG.');};img.src=url;
}
function copyT1Link(){
  navigator.clipboard.writeText(t1Url()).then(()=>toast('Lien T1 copié !')).catch(()=>prompt('Copie le lien :',t1Url()));
}

// Traduction locale des trois pages publiques. Les pseudos et les valeurs de puissance ne sont pas traduits.
let pollLanguage=['fr','en','es','de','it'].includes(localStorage.getItem('alliance_poll_language'))?localStorage.getItem('alliance_poll_language'):'fr';

// V16.1 — Compléments pour les états dynamiques des sondages publics.
Object.assign(pollTranslations, {"Aucun joueur disponible trouvé.": "No available player found.", "Tous les joueurs ont répondu.": "All players have responded.", "Tous les joueurs ont répondu": "All players have responded", "❌ Impossible de charger les joueurs.": "❌ Unable to load players.", "Tu as déjà participé à ce recensement. Reviens lors de la prochaine session.": "You have already participated in this survey. Come back for the next session.", "🟢 Sondage en cours — ": "🟢 Survey in progress — ", "🔒 Sondage clos": "🔒 Survey closed", "Aucun recensement ouvert": "No survey open", " enregistrés.": " saved.", "Choisis ton pseudo": "Choose your player name", "Chargement des joueurs…": "Loading players…", "La session est clôturée.": "This session is closed.", "Choisis une capture d’écran.": "Choose a screenshot."});
Object.assign(pollTranslationsEs, {"Aucun joueur disponible trouvé.": "No se encontró ningún jugador disponible.", "Tous les joueurs ont répondu.": "Todos los jugadores han respondido.", "Tous les joueurs ont répondu": "Todos los jugadores han respondido", "❌ Impossible de charger les joueurs.": "❌ No se pueden cargar los jugadores.", "Tu as déjà participé à ce recensement. Reviens lors de la prochaine session.": "Ya has participado en este censo. Vuelve en la próxima sesión.", "🟢 Sondage en cours — ": "🟢 Encuesta en curso — ", "🔒 Sondage clos": "🔒 Encuesta cerrada", "Aucun recensement ouvert": "No hay ningún censo abierto", " enregistrés.": " registrados.", "Choisis ton pseudo": "Elige tu nombre de jugador", "Chargement des joueurs…": "Cargando jugadores…", "La session est clôturée.": "La sesión está cerrada.", "Choisis une capture d’écran.": "Elige una captura de pantalla."});
Object.assign(pollTranslationsDe, {"Aucun joueur disponible trouvé.": "Kein verfügbarer Spieler gefunden.", "Tous les joueurs ont répondu.": "Alle Spieler haben geantwortet.", "Tous les joueurs ont répondu": "Alle Spieler haben geantwortet", "❌ Impossible de charger les joueurs.": "❌ Spieler konnten nicht geladen werden.", "Tu as déjà participé à ce recensement. Reviens lors de la prochaine session.": "Du hast bereits an dieser Erfassung teilgenommen. Komm zur nächsten Runde zurück.", "🟢 Sondage en cours — ": "🟢 Umfrage läuft — ", "🔒 Sondage clos": "🔒 Umfrage geschlossen", "Aucun recensement ouvert": "Keine Erfassung geöffnet", " enregistrés.": " gespeichert.", "Choisis ton pseudo": "Wähle deinen Spielernamen", "Chargement des joueurs…": "Spieler werden geladen…", "La session est clôturée.": "Die Sitzung ist geschlossen.", "Choisis une capture d’écran.": "Wähle einen Screenshot."});
Object.assign(pollTranslationsIt, {"Aucun joueur disponible trouvé.": "Nessun giocatore disponibile trovato.", "Tous les joueurs ont répondu.": "Tutti i giocatori hanno risposto.", "Tous les joueurs ont répondu": "Tutti i giocatori hanno risposto", "❌ Impossible de charger les joueurs.": "❌ Impossibile caricare i giocatori.", "Tu as déjà participé à ce recensement. Reviens lors de la prochaine session.": "Hai già partecipato a questo censimento. Torna alla prossima sessione.", "🟢 Sondage en cours — ": "🟢 Sondaggio in corso — ", "🔒 Sondage clos": "🔒 Sondaggio chiuso", "Aucun recensement ouvert": "Nessun censimento aperto", " enregistrés.": " registrati.", "Choisis ton pseudo": "Scegli il tuo nome giocatore", "Chargement des joueurs…": "Caricamento giocatori…", "La session est clôturée.": "La sessione è chiusa.", "Choisis une capture d’écran.": "Scegli uno screenshot."});
// V16.5 — Textes T1 segmentés, menus et états des sondages.
Object.assign(pollTranslations, {"— Sélectionne ton pseudo —": "— Select your player name —", "Prends une capture de l’écran de formation de ton équipe T1, avec ": "Take a screenshot of your T1 team formation screen, with ", "la puissance totale bien visible en haut": "the total power clearly visible at the top", " (ici : ": " (here: ", "). Voici un exemple :": "). Here is an example:", "Sondage en cours — ": "Survey in progress — ", "Sondage clos": "Survey closed", "Ce sondage est clôturé. Reviens à la prochaine session.": "This survey is closed. Come back for the next session.", "Aucun recensement ouvert. Reviens à la prochaine session.": "No survey is open. Come back for the next session."});
Object.assign(pollTranslationsEs, {"— Sélectionne ton pseudo —": "— Selecciona tu nombre de jugador —", "Prends une capture de l’écran de formation de ton équipe T1, avec ": "Haz una captura de la formación de tu equipo T1, con ", "la puissance totale bien visible en haut": "la potencia total claramente visible arriba", " (ici : ": " (aquí: ", "). Voici un exemple :": "). Aquí tienes un ejemplo:", "Sondage en cours — ": "Encuesta en curso — ", "Sondage clos": "Encuesta cerrada", "Ce sondage est clôturé. Reviens à la prochaine session.": "Esta encuesta está cerrada. Vuelve en la próxima sesión.", "Aucun recensement ouvert. Reviens à la prochaine session.": "No hay ningún censo abierto. Vuelve en la próxima sesión."});
Object.assign(pollTranslationsDe, {"— Sélectionne ton pseudo —": "— Wähle deinen Spielernamen —", "Prends une capture de l’écran de formation de ton équipe T1, avec ": "Mache einen Screenshot deiner T1-Teamaufstellung, auf dem ", "la puissance totale bien visible en haut": "die Gesamtstärke oben deutlich sichtbar ist", " (ici : ": " (hier: ", "). Voici un exemple :": "). Hier ist ein Beispiel:", "Sondage en cours — ": "Umfrage läuft — ", "Sondage clos": "Umfrage geschlossen", "Ce sondage est clôturé. Reviens à la prochaine session.": "Diese Umfrage ist geschlossen. Komm zur nächsten Runde zurück.", "Aucun recensement ouvert. Reviens à la prochaine session.": "Keine Erfassung geöffnet. Komm zur nächsten Runde zurück."});
Object.assign(pollTranslationsIt, {"— Sélectionne ton pseudo —": "— Seleziona il tuo nome giocatore —", "Prends une capture de l’écran de formation de ton équipe T1, avec ": "Fai uno screenshot della formazione della tua squadra T1, con ", "la puissance totale bien visible en haut": "la potenza totale ben visibile in alto", " (ici : ": " (qui: ", "). Voici un exemple :": "). Ecco un esempio:", "Sondage en cours — ": "Sondaggio in corso — ", "Sondage clos": "Sondaggio chiuso", "Ce sondage est clôturé. Reviens à la prochaine session.": "Questo sondaggio è chiuso. Torna alla prossima sessione.", "Aucun recensement ouvert. Reviens à la prochaine session.": "Nessun censimento aperto. Torna alla prossima sessione."});
const pollOriginalText=new WeakMap(),pollOriginalAttrs=new WeakMap();
const pollRoots=()=>['t1PollOverlay','canyonPollOverlay','pollOverlay'].map(id=>document.getElementById(id)).filter(Boolean);
function translatePollString(source){
 if(pollLanguage==='fr')return source;
 const trimmed=source.trim();if(!trimmed)return source;
 let result=({es:pollTranslationsEs,de:pollTranslationsDe,it:pollTranslationsIt,en:pollTranslations}[pollLanguage]||pollTranslations)[trimmed];
 if(result===undefined){
   result=trimmed;
   // Préfixes dynamiques avec libellé de session conservé tel quel.
   const active=trimmed.match(/^(🟢\s*)?Sondage en cours\s*[—–-]\s*(.+)$/);
   if(active){const dict=({es:pollTranslationsEs,de:pollTranslationsDe,it:pollTranslationsIt,en:pollTranslations}[pollLanguage]||pollTranslations);return source.replace(trimmed,(active[1]||'')+(dict['Sondage en cours — ']||'Sondage en cours — ')+active[2]);}
   const dynamic=pollLanguage==='de'?[
    [/^Puissance détectée : (.+)\. Vérifie avant de valider\.$/,'Erkannte Kraft: $1. Vor dem Absenden prüfen.'],
    [/^Recensement (.+) ouvert$/,'Erfassung $1 geöffnet'],
    [/^Sondage clôturé/i,'Umfrage geschlossen'],[/^Sondage ouvert/i,'Umfrage geöffnet'],
    [/^Merci pour ta réponse/i,'Danke für deine Antwort'],[/^Ta réponse a été enregistrée/i,'Deine Antwort wurde gespeichert'],[/^Puissance (.+) enregistrée/i,'Kraft $1 gespeichert'],
   ]:pollLanguage==='it'?[
    [/^Puissance détectée : (.+)\. Vérifie avant de valider\.$/,'Potenza rilevata: $1. Controlla prima di inviare.'],
    [/^Recensement (.+) ouvert$/,'Censimento $1 aperto'],
    [/^Sondage clôturé/i,'Sondaggio chiuso'],[/^Sondage ouvert/i,'Sondaggio aperto'],
    [/^Merci pour ta réponse/i,'Grazie per la risposta'],[/^Ta réponse a été enregistrée/i,'La tua risposta è stata salvata'],[/^Puissance (.+) enregistrée/i,'Potenza $1 salvata'],
   ]:pollLanguage==='es'?[
    [/^Puissance détectée : (.+)\. Vérifie avant de valider\.$/,'Potencia detectada: $1. Compruébala antes de enviar.'],
    [/^Recensement (.+) ouvert$/,'Censo $1 abierto'],
    [/^Sondage clôturé/i,'Encuesta cerrada'],
    [/^Sondage ouvert/i,'Encuesta abierta'],
    [/^Merci pour ta réponse/i,'Gracias por tu respuesta'],
    [/^Ta réponse a été enregistrée/i,'Tu respuesta se ha guardado'],
    [/^Puissance (.+) enregistrée/i,'Potencia $1 guardada'],
   ]:[
    [/^Puissance détectée : (.+)\. Vérifie avant de valider\.$/,'Detected power: $1. Check before submitting.'],
    [/^Recensement (.+) ouvert$/,'Survey $1 is open'],
    [/^Sondage clôturé/i,'Survey closed'],
    [/^Sondage ouvert/i,'Survey open'],
    [/^Merci pour ta réponse/i,'Thank you for your response'],
    [/^Ta réponse a été enregistrée/i,'Your response has been saved'],
    [/^Puissance (.+) enregistrée/i,'Power $1 saved'],
   ];
   for(const [pattern,replacement] of dynamic){if(pattern.test(result)){result=result.replace(pattern,replacement);break;}}
 }
 return source.replace(trimmed,result);
}
function applyPollTranslations(){
 for(const root of pollRoots()){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){
   if(node.parentElement?.closest('.poll-language,script,style,option[value]:not([value=""])'))continue;
   if(!pollOriginalText.has(node))pollOriginalText.set(node,node.nodeValue);
   const original=pollOriginalText.get(node),translated=translatePollString(original);
   if(node.nodeValue!==translated)node.nodeValue=translated;
  }
  root.querySelectorAll('[placeholder],[alt],[title],[aria-label]').forEach(el=>{
   if(!pollOriginalAttrs.has(el))pollOriginalAttrs.set(el,{});
   const originals=pollOriginalAttrs.get(el);
   for(const attr of ['placeholder','alt','title','aria-label'])if(el.hasAttribute(attr)){
    if(!(attr in originals))originals[attr]=el.getAttribute(attr);
    const translated=translatePollString(originals[attr]);if(el.getAttribute(attr)!==translated)el.setAttribute(attr,translated);
   }
  });
 }
 document.querySelectorAll('.poll-language button').forEach(button=>{
  button.classList.toggle('active',button.classList.contains('lang-'+pollLanguage));
  button.setAttribute('aria-pressed',String(button.classList.contains('active')));
 });
 document.documentElement.lang=pollLanguage;
}
function setPollLanguage(lang){pollLanguage=['fr','en','es','de','it'].includes(lang)?lang:'fr';localStorage.setItem('alliance_poll_language',pollLanguage);applyPollTranslations();}
window.addEventListener('DOMContentLoaded',()=>{
 applyPollTranslations();
 // Les réponses sont injectées dynamiquement par le code des sondages.
 const observer=new MutationObserver(records=>{
  let changed=false;
  for(const rec of records){
   if(rec.type==='characterData'){
    const node=rec.target;
    if(node.parentElement?.closest('.poll-language'))continue;
    const previous=pollOriginalText.get(node);
    if(previous===undefined||node.nodeValue!==translatePollString(previous)){
     pollOriginalText.set(node,node.nodeValue);changed=true;
    }
   }else if(rec.type==='childList'&&rec.addedNodes.length)changed=true;
  }
  if(changed)applyPollTranslations();
 });
 pollRoots().forEach(root=>observer.observe(root,{subtree:true,childList:true,characterData:true}));
});

// V17.5 — Édition collaborative Supabase, RPC avec vérification staff côté serveur.
let rwData=null,rwRevision=0,rwPending=0,rwBusy=false,rwLastError='',rwChannel=null,rwPollTimer=null,rwLastApplied=0;
function rwDefault(){return {season:'',chief:'',tacticians:'',events:[{name:'Cristal d’or',weight:40,scores:{}},{name:'Capture',weight:30,scores:{}},{name:'Éliminations',weight:30,scores:{}}],overrides:{},overrideReasons:{}};}
function rwAllowed(){return typeof isAdminOrStaff==='function'&&isAdminOrStaff();}
function rwStatus(message){const el=document.getElementById('rwInputStatus');if(el)el.textContent=message;}
async function rwRpc(action,patch={}){if(!rwAllowed()||!sb||!currentUser)throw Error('Connexion staff requise');const hash=await getStaffActionHash();if(!hash)throw Error('Reconnecte-toi avec ton compte staff');const {data,error}=await sb.rpc('reward_live_edit_v1',{p_username:currentUser.username,p_account_hash:hash,p_action:action,p_patch:patch});if(error)throw error;return data;}
function rwApplyRemote(response,force=false){if(!response||!response.data)return;const revision=Number(response.revision||0);if(revision<rwRevision)return;rwRevision=revision;const active=document.activeElement;const editing=active&&document.getElementById('secRewards')?.contains(active)&&['INPUT','TEXTAREA','SELECT'].includes(active.tagName);if(editing&&!force){rwLastApplied=Math.min(rwLastApplied,revision-1);return;}rwData={...rwDefault(),...response.data};rwLastApplied=revision;const season=document.getElementById('rwSeason');if(season)season.value=rwData.season||'';rwDrawEvents();rwRender();rwRenderInput();}
async function rwFetch(force=false){if(!rwAllowed()||rwBusy||rwPending)return;rwBusy=true;try{const result=await rwRpc('read');if(force||Number(result.revision)!==rwLastApplied)rwApplyRemote(result,force);rwLastError='';rwStatus('🟢 Synchronisé · version '+rwRevision);}catch(e){rwLastError=e.message;rwStatus('🔴 Synchronisation impossible : '+e.message);}finally{rwBusy=false;}}
async function rwPatch(type,payload={}){if(!rwAllowed())return;rwPending++;rwStatus('⏳ Enregistrement partagé…');try{const result=await rwRpc('patch',{type,...payload});rwRevision=Math.max(rwRevision,Number(result.revision||0));rwLastApplied=0;rwLastError='';rwStatus('🟢 Enregistré · version '+rwRevision);rwChannel?.send({type:'broadcast',event:'changed',payload:{revision:rwRevision}}).catch(()=>{});setTimeout(()=>rwFetch(),120);}catch(e){rwLastError=e.message;rwStatus('🔴 NON ENREGISTRÉ : '+e.message);alert('Modification non enregistrée dans Supabase : '+e.message);}finally{rwPending--;}}
function rwSave(){if(!rwAllowed()||!rwData)return;const season=document.getElementById('rwSeason')?.value||'';rwData.season=season;rwPatch('season',{value:season});}
function rwInit(){if(!rwAllowed())return;rwData=rwDefault();rwRevision=0;rwLastApplied=0;rwDrawEvents();rwRender();rwRenderInput();if(rwPollTimer)clearInterval(rwPollTimer);if(rwChannel){sb.removeChannel(rwChannel);rwChannel=null;}rwChannel=sb.channel('reward-live-refresh-v1').on('broadcast',{event:'changed'},()=>rwFetch()).subscribe();rwPollTimer=setInterval(()=>{if(rwAllowed())rwFetch();},3000);rwFetch(true);}
function rwRefreshPlayerSelects(){}
function rwDrawEvents(){if(!rwAllowed())return;const host=document.getElementById('rwEvents'),sel=document.getElementById('rwImportEvent');host.replaceChildren();sel.replaceChildren();rwData.events.forEach((ev,i)=>{const div=document.createElement('div');div.className='rw-panel';const name=document.createElement('input');name.value=ev.name;name.setAttribute('aria-label','Nom du classement');name.onchange=()=>{ev.name=name.value.trim()||`Classement ${i+1}`;rwPatch('event_name',{index:i,value:ev.name});rwDrawEvents();rwRender();rwRenderInput();};const lab=document.createElement('label');lab.textContent='Nom de l’événement';div.append(lab,name);const weight=document.createElement('input');weight.type='number';weight.min='0';weight.max='100';weight.value=ev.weight;weight.setAttribute('aria-label','Coefficient');weight.onchange=()=>{ev.weight=Math.max(0,Math.min(100,Number(weight.value)||0));rwPatch('weight',{index:i,value:ev.weight});rwRender();};const wl=document.createElement('label');wl.textContent='Coefficient';wl.style.marginTop='8px';div.append(wl,weight);const count=document.createElement('p');count.className='rw-note';count.textContent=Object.keys(ev.scores||{}).length+' scores importés';div.append(count);host.append(div);sel.add(new Option(ev.name,String(i)));});}
function rwAddEvent(){if(!rwAllowed()||rwData.events.length>=4)return;rwData.events.push({name:'Nouveau classement',weight:25,scores:{}});rwPatch('add_event');rwDrawEvents();rwRender();rwRenderInput();}
function rwResetEvents(){if(!rwAllowed()||!confirm('Réinitialiser les noms et coefficients ? Les scores importés seront perdus.'))return;rwData.events=rwDefault().events;rwPatch('reset_events');rwDrawEvents();rwRender();rwRenderInput();}
function rwReadFile(input){const file=input.files?.[0];if(!file)return;if(file.size>2e6){alert('Fichier trop volumineux (2 Mo maximum).');return;}const reader=new FileReader();reader.onload=()=>{document.getElementById('rwPaste').value=String(reader.result||'').replace(/^\uFEFF/,'');};reader.readAsText(file);}
function rwParse(text){const out={},errors=[];text.split(/\r?\n/).forEach((line,i)=>{line=line.trim();if(!line)return;const parts=line.split(/[;\t]/);if(parts.length<2){const m=line.match(/^(.*?),\s*([\d., ]+)$/);if(m){parts.splice(0,parts.length,m[1],m[2]);}}if(parts.length<2){errors.push(i+1);return;}const name=parts[0].trim();const raw=parts.slice(1).join('').replace(/[\s\u00a0]/g,'').replace(',','.');const score=Number(raw);if(!name||!Number.isFinite(score)||score<0){errors.push(i+1);return;}out[name]=score;});return {out,errors};}
function rwImport(){if(!rwAllowed())return;const i=Number(document.getElementById('rwImportEvent').value),ev=rwData.events[i];if(!ev)return;const parsed=rwParse(document.getElementById('rwPaste').value);const count=Object.keys(parsed.out).length;if(!count){document.getElementById('rwImportStatus').textContent='Aucun score valide. Utiliser pseudo;score.';return;}if(parsed.errors.length&&!confirm(`${parsed.errors.length} lignes invalides (${parsed.errors.slice(0,12).join(', ')}). Continuer avec ${count} scores ?`))return;if(!confirm(`Remplacer les scores de « ${ev.name} » par ${count} résultats ?`))return;ev.scores=parsed.out;rwPatch('import',{index:Number(document.getElementById('rwImportEvent').value),scores:ev.scores});rwDrawEvents();rwRender();rwRenderInput();document.getElementById('rwImportStatus').textContent=`${count} scores importés dans ${ev.name}. ${parsed.errors.length} ligne(s) ignorée(s).`;}
function rwClearEvent(){if(!rwAllowed())return;const ev=rwData.events[Number(document.getElementById('rwImportEvent').value)];if(ev&&confirm(`Effacer les scores de ${ev.name} ?`)){ev.scores={};rwPatch('clear_event',{index:Number(document.getElementById('rwImportEvent').value)});rwDrawEvents();rwRender();rwRenderInput();}}
function rwRoster(){const unique=new Map();(Array.isArray(participants)?participants:[]).forEach(p=>{const n=String(typeof p==='string'?p:(p.name||'')).trim();if(n)unique.set(n.toLocaleLowerCase(),n);});rwData.events.forEach(e=>Object.keys(e.scores||{}).forEach(n=>{const k=n.trim().toLocaleLowerCase();if(k&&!unique.has(k))unique.set(k,n.trim());}));[rwData.chief,...(rwData.tacticians||'').split(/\r?\n|;/)].forEach(n=>{const k=n.trim().toLocaleLowerCase();if(k&&!unique.has(k))unique.set(k,n.trim());});return [...unique.values()].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));}
function rwScore(ev,name){const key=name.trim().toLocaleLowerCase();const entry=Object.entries(ev.scores||{}).find(([n])=>n.trim().toLocaleLowerCase()===key);return entry?Number(entry[1]):null;}
function rwResults(){if(!rwData)return[];const events=rwData.events,weights=events.map(e=>Math.max(0,Number(e.weight)||0)),total=weights.reduce((a,b)=>a+b,0),roster=rwRoster();const points=new Map(roster.map(n=>[n.toLocaleLowerCase(),{name:n,points:Array(events.length).fill(null)}]));events.forEach((ev,i)=>{const entries=roster.map(n=>({name:n,value:rwScore(ev,n)})).filter(x=>x.value!==null&&Number.isFinite(x.value)).sort((a,b)=>b.value-a.value);entries.forEach(({name,value})=>{const rank=entries.findIndex(x=>x.value===value)+1;const percentile=entries.length<=1?100:100*(entries.length-rank)/(entries.length-1);points.get(name.toLocaleLowerCase()).points[i]=percentile;});});return [...points.values()].map(p=>{const attended=p.points.filter(v=>v!==null).length;const perf=total?weights.reduce((sum,w,i)=>sum+w*(p.points[i]??0),0)/total:0;return {...p,attended,score:perf};}).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));}
function rwSetRole(name,role){if(!rwAllowed()||!rwData)return;const key=name.trim().toLocaleLowerCase();const chief=(rwData.chief||'').trim().toLocaleLowerCase(),tacts=(rwData.tacticians||'').split(/\r?\n|;/).map(x=>x.trim()).filter(Boolean);if(role==='chief'&&chief!==key&&rwData.chief){alert('Un chef est déjà désigné. Remettez son rôle sur Automatique avant de choisir un autre chef.');rwRenderInput();return;}if(role==='tactician'&&!tacts.some(n=>n.toLocaleLowerCase()===key)&&tacts.length>=4){alert('Les quatre postes de tacticien sont déjà occupés.');rwRenderInput();return;}if(chief===key)rwData.chief='';rwData.tacticians=tacts.filter(n=>n.toLocaleLowerCase()!==key).join('\n');if(role==='chief')rwData.chief=name;if(role==='tactician')rwData.tacticians=[...rwData.tacticians.split('\n').filter(Boolean),name].join('\n');rwRefreshPlayerSelects();rwPatch('role',{name,role});rwRenderInput();rwRender();}
function rwSetScore(name,eventIndex,value){if(!rwAllowed()||!rwData)return;const ev=rwData.events[eventIndex];if(!ev)return;const key=Object.keys(ev.scores||{}).find(n=>n.trim().toLocaleLowerCase()===name.trim().toLocaleLowerCase())||name;if(value.trim()===''){delete ev.scores[key];}else{const score=Number(value.replace(',','.'));if(!Number.isFinite(score)||score<0){alert('Saisir un nombre positif ou laisser la case vide.');rwRenderInput();return;}ev.scores[key]=score;}rwPatch('score',{name,index:eventIndex,value:value.trim()===''?null:Number(value.replace(',','.'))});rwRender();}
function rwRenderInput(){if(!rwAllowed()||!rwData)return;const head=document.getElementById('rwInputHead'),body=document.getElementById('rwInputRows');if(!head||!body)return;head.replaceChildren();body.replaceChildren();const h=document.createElement('tr');['Pseudo',...rwData.events.map(e=>e.name),'Catégorie / rôle'].forEach(t=>{const th=document.createElement('th');th.textContent=t;h.append(th);});head.append(h);const roster=rwRoster(),chief=(rwData.chief||'').trim().toLocaleLowerCase(),tacts=new Set((rwData.tacticians||'').split(/\r?\n|;/).map(x=>x.trim().toLocaleLowerCase()).filter(Boolean));roster.forEach(name=>{const tr=document.createElement('tr'),td=document.createElement('td');td.textContent=name;td.style.fontWeight='600';tr.append(td);rwData.events.forEach((ev,i)=>{const cell=document.createElement('td'),input=document.createElement('input');input.type='number';input.min='0';input.step='any';input.style.minWidth='92px';input.placeholder='—';const val=rwScore(ev,name);input.value=val===null?'':String(val);input.setAttribute('aria-label',ev.name+' — '+name);input.onchange=()=>rwSetScore(name,i,input.value);cell.append(input);tr.append(cell);});const cell=document.createElement('td'),select=document.createElement('select');select.style.minWidth='170px';[['auto','Automatique (classement)'],['chief','👑 Chef d’alliance'],['tactician','🧠 Membre tacticien']].forEach(([v,t])=>select.add(new Option(t,v)));select.value=name.toLocaleLowerCase()===chief?'chief':tacts.has(name.toLocaleLowerCase())?'tactician':'auto';select.onchange=()=>rwSetRole(name,select.value);cell.append(select);tr.append(cell);body.append(tr);});document.getElementById('rwInputStatus').textContent=roster.length+' joueurs affichés · données partagées avec le staff.';}
function rwAssignment(p,index,chief,tacticians){const key=p.name.trim().toLocaleLowerCase();if(key===chief)return 'Chef d’alliance';if(tacticians.has(key))return 'Tacticien';const forced=rwData.overrides?.[key];if(forced)return forced;return index<15?'Membre clé':index<45?'Membre élite':index<95?'Membre précieux':'Hors quota';}
function rwRender(){if(!rwAllowed()||!rwData)return;const rows=document.getElementById('rwRows'),summary=document.getElementById('rwSummary');rows.replaceChildren();const all=rwResults(),chief=(rwData.chief||'').trim().toLocaleLowerCase(),tacticians=new Set((rwData.tacticians||'').split(/\r?\n|;/).map(x=>x.trim().toLocaleLowerCase()).filter(Boolean));tacticians.delete(chief);const eligible=all.filter(p=>p.name.trim().toLocaleLowerCase()!==chief&&!tacticians.has(p.name.trim().toLocaleLowerCase()));const indexed=new Map(eligible.map((p,i)=>[p.name.trim().toLocaleLowerCase(),i]));const ordered=[...all].sort((a,b)=>{const rank=p=>p.name.trim().toLocaleLowerCase()===chief?-2:tacticians.has(p.name.trim().toLocaleLowerCase())?-1:indexed.get(p.name.trim().toLocaleLowerCase())??9999;return rank(a)-rank(b);});const weights=rwData.events.reduce((a,e)=>a+Number(e.weight||0),0);summary.textContent=`${all.length} joueurs avec scores · ${rwData.events.length} classements · ${eligible.length} joueurs classés hors chef/tacticiens · ${weights===0?'⚠️ Coefficients tous nuls · ':''}Chef et tacticiens absents des imports : à vérifier manuellement. Les changements d'attribution ne rééquilibrent pas automatiquement les quotas.`;
 ordered.forEach((p,i)=>{const key=p.name.trim().toLocaleLowerCase(),tr=document.createElement('tr');const cells=[String(i+1),p.name,p.score.toFixed(1),`${p.attended}/${rwData.events.length}`,rwAssignment(p,indexed.get(key)??9999,chief,tacticians)];cells.forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td);});const td=document.createElement('td');if(key!==chief&&!tacticians.has(key)){const select=document.createElement('select');[['','Auto'],['Membre clé','Clé'],['Membre élite','Élite'],['Membre précieux','Précieux'],['Hors quota','Hors quota']].forEach(([v,label])=>select.add(new Option(label,v)));select.value=rwData.overrides?.[key]||'';select.onchange=()=>{if(select.value){const reason=prompt('Motif de la correction (obligatoire) :');if(!reason?.trim()){select.value=rwData.overrides?.[key]||'';return;}rwData.overrides[key]=select.value;rwData.overrideReasons=rwData.overrideReasons||{};rwData.overrideReasons[key]=reason.trim();}else{delete rwData.overrides[key];if(rwData.overrideReasons)delete rwData.overrideReasons[key];}rwPatch('override',{name:p.name,value:select.value,reason:rwData.overrideReasons?.[key]||''});rwRender();};td.append(select);}tr.append(td);rows.append(tr);});}
function rwDownload(name,content,type){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function rwExport(){if(!rwAllowed()||!rwData)return;const all=rwResults(),chief=(rwData.chief||'').trim().toLocaleLowerCase(),tacticians=new Set((rwData.tacticians||'').split(/\r?\n|;/).map(x=>x.trim().toLocaleLowerCase()).filter(Boolean));const eligible=all.filter(p=>p.name.trim().toLocaleLowerCase()!==chief&&!tacticians.has(p.name.trim().toLocaleLowerCase()));const indexed=new Map(eligible.map((p,i)=>[p.name.trim().toLocaleLowerCase(),i]));const csv=[['Pseudo','Score','Présences','Attribution','Motif correction'].join(';'),...all.map(p=>[p.name,p.score.toFixed(2),p.attended+'/'+rwData.events.length,rwAssignment(p,indexed.get(p.name.trim().toLocaleLowerCase())??9999,chief,tacticians),rwData.overrideReasons?.[p.name.trim().toLocaleLowerCase()]||''].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';'))].join('\r\n');rwDownload('recompenses_saison.csv','\uFEFF'+csv,'text/csv;charset=utf-8');}
function rwExportBackup(){if(!rwAllowed()||!rwData)return;rwDownload('recompenses_saison_sauvegarde.json',JSON.stringify(rwData,null,2),'application/json');}
function rwRestoreBackup(input){if(!rwAllowed())return;const file=input.files?.[0];if(!file||file.size>2e6)return;const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result);if(!Array.isArray(data.events)||data.events.length<1||data.events.length>4||data.events.some(e=>typeof e.name!=='string'||!e.scores||typeof e.scores!=='object'))throw Error('Format invalide');if(!confirm('Remplacer le brouillon local par cette sauvegarde ?'))return;rwData={...rwDefault(),...data,overrides:data.overrides||{}};rwPatch('restore',{data:rwData});rwDrawEvents();rwRender();rwRenderInput();}catch(e){alert('Sauvegarde JSON invalide.');}};reader.readAsText(file);input.value='';}
// V17.6 — mouvements inter-saisons (RPC staff)
let mvSeason='',mvRows=[],mvNotes=[],mvSelectedId=null,mvCurrentFilter='all',mvStatusFilter='all',mvAllianceFilter='all',mvServerFilter='all',mvTimer=null,mvBusy=false;
function mvAllowed(){return typeof isAdminOrStaff==='function'&&isAdminOrStaff();}
function mvSetStatus(t){const el=document.getElementById('mvSync');if(el)el.textContent=t;}
async function mvRpc(action,payload={}){if(!mvAllowed()||!sb||!currentUser)throw Error('Compte staff requis');const hash=await getStaffActionHash();if(!hash)throw Error('Reconnecte-toi avec ton compte staff');const {data,error}=await sb.rpc('interseason_staff_v1',{p_username:currentUser.username,p_account_hash:hash,p_action:action,p_payload:payload});if(error)throw error;return data;}
function mvTypeChange(){
 const departure=document.getElementById('mvType').value==='departure';
 document.getElementById('mvAllianceLabel').textContent=departure?'Alliance de destination':"Alliance d'origine";
 const text=document.getElementById('mvPlayer'),select=document.getElementById('mvPlayerDeparture');
 text.style.display=departure?'none':'';select.style.display=departure?'':'none';
 if(departure)mvPopulateDeparturePlayers();
 if(!document.getElementById('mvEditId')?.value)mvSyncDeparturePower();
}
function mvPopulateDeparturePlayers(){
 const select=document.getElementById('mvPlayerDeparture');if(!select)return;
 const previous=select.value;
 select.replaceChildren(new Option('— Choisir un membre de l’alliance —',''));
 (participants||[]).filter(p=>p&&p.name).slice().sort((a,b)=>a.name.localeCompare(b.name,'fr',{sensitivity:'base'})).forEach(p=>select.add(new Option(p.name,p.name)));
 if(Array.from(select.options).some(o=>o.value===previous))select.value=previous;
}
function mvFindAlliancePlayer(name){const key=String(name||'').trim().toLocaleLowerCase('fr');return (participants||[]).find(p=>String(p.name||'').trim().toLocaleLowerCase('fr')===key);}
function mvSyncDeparturePower(){
 const isDeparture=document.getElementById('mvType').value==='departure';
 const input=document.getElementById('mvPower'),hint=document.getElementById('mvPowerHint');
 const player=isDeparture?mvFindAlliancePlayer(document.getElementById('mvPlayerDeparture').value):null;
 if(!isDeparture){if(input.dataset.autoDeparture==='1')input.value='';input.readOnly=false;delete input.dataset.autoDeparture;hint.textContent='';return;}
 if(!player){if(input.dataset.autoDeparture==='1')input.value='';input.readOnly=false;delete input.dataset.autoDeparture;hint.textContent='Sélectionne un joueur de l’alliance pour récupérer sa puissance T1.';return;}
 const power=Number(player.power_t1);
 if(Number.isFinite(power)&&power>0){input.value=(power/1e6).toLocaleString('fr-FR',{maximumFractionDigits:4})+' M';input.readOnly=true;input.dataset.autoDeparture='1';hint.textContent='✓ Puissance T1 récupérée depuis la fiche du joueur sur le site.';}
 else{if(input.dataset.autoDeparture==='1')input.value='';input.readOnly=false;delete input.dataset.autoDeparture;hint.textContent='Aucune puissance T1 renseignée pour ce joueur : saisie manuelle possible.';}
}
function mvInit(){if(!mvAllowed())return;mvSeason='Registre commun';document.getElementById('mvSeason').value=mvSeason;mvTypeChange();if(mvTimer)clearInterval(mvTimer);mvTimer=setInterval(()=>{if(mvAllowed()&&document.visibilityState==='visible')mvRefresh(true);},4000);mvRefresh();}
// Synchronisation au retour sur l'onglet et après reconnexion.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&mvAllowed()&&mvSeason)mvRefresh(true);});
window.addEventListener('online',()=>{if(mvAllowed()&&mvSeason)mvRefresh(true);});
function mvSelectSeason(){mvRefresh();} // Registre unique partagé : aucun filtre local par saison
let mvRefreshPending=false;
async function mvRefresh(silent=false){
 if(!mvAllowed())return;
 if(mvBusy){mvRefreshPending=true;return;}
 mvBusy=true;
 const requestedSeason=mvSeason;
 try{
  const r=await mvRpc('list',{});
  if(requestedSeason!==mvSeason){mvRefreshPending=true;return;}
  mvRows=Array.isArray(r?.movements)?r.movements:[];
  mvNotes=Array.isArray(r?.notes)?r.notes:[];
  mvRender();
  if(!document.getElementById('mvNoteModal').hidden)mvRenderNoteModal();
  mvSetStatus('🟢 Synchronisé · '+mvRows.length+' fiche(s) · registre commun');
 }catch(e){mvSetStatus('🔴 Synchronisation impossible : '+e.message);console.error('Synchronisation recrutements/départs :',e);}
 finally{
  mvBusy=false;
  if(mvRefreshPending){mvRefreshPending=false;queueMicrotask(()=>mvRefresh(true));}
 }
}
async function mvChange(action,payload){try{await mvRpc(action,payload);mvSetStatus('🟢 Modification enregistrée');await mvRefresh();return true;}catch(e){mvSetStatus('🔴 NON ENREGISTRÉ : '+e.message);alert('Modification non enregistrée : '+e.message);return false;}}
function mvCancelEdit(){document.getElementById('mvEditId').value='';document.getElementById('mvFormTitle').textContent='Ajouter un mouvement';document.getElementById('mvSaveButton').textContent='➕ Enregistrer le mouvement';document.getElementById('mvCancelEdit').style.display='none';for(const id of ['mvPlayer','mvPlayerDeparture','mvPower','mvPlayerPower','mvKills','mvServer','mvAlliance'])document.getElementById(id).value='';document.getElementById('mvType').value='recruit';document.getElementById('mvStatus').value='discussion';document.getElementById('mvInitialNote').value='';mvTypeChange();}
function mvEdit(id){const r=mvRows.find(x=>x.id===id);if(!r)return;document.getElementById('mvEditId').value=r.id;document.getElementById('mvType').value=r.kind;mvTypeChange();document.getElementById('mvPlayer').value=r.player_name;const departureSelect=document.getElementById('mvPlayerDeparture');if(r.kind==='departure'&&!Array.from(departureSelect.options).some(o=>o.value===r.player_name))departureSelect.add(new Option(r.player_name+' (ancien membre)',r.player_name));departureSelect.value=r.player_name;document.getElementById('mvPower').readOnly=false;delete document.getElementById('mvPower').dataset.autoDeparture;document.getElementById('mvPower').value=r.power||'';document.getElementById('mvPlayerPower').value=r.player_power??'';document.getElementById('mvKills').value=r.kills??'';document.getElementById('mvServer').value=r.server||'';document.getElementById('mvAlliance').value=r.alliance||'';document.getElementById('mvStatus').value=r.status;document.getElementById('mvInitialNote').value='';document.getElementById('mvFormTitle').textContent='Modifier la fiche — '+r.player_name;document.getElementById('mvSaveButton').textContent='💾 Enregistrer les modifications';document.getElementById('mvCancelEdit').style.display='inline-block';document.getElementById('mvFormTitle').scrollIntoView({behavior:'smooth',block:'center'});}
async function mvAdd(){const editId=document.getElementById('mvEditId').value;const departure=document.getElementById('mvType').value==='departure';if(!editId)mvSyncDeparturePower();if(!mvNormalizePowerInput()){alert('Puissance T1 invalide. Exemple : 51.3, 51,3 ou 51.3M');return;}const name=(departure?document.getElementById('mvPlayerDeparture').value:document.getElementById('mvPlayer').value).trim();if(!name)return alert(departure?'Sélectionner un membre de l’alliance':'Saisir un pseudo');const playerPowerRaw=document.getElementById('mvPlayerPower').value.trim().replace(',','.');const killsRaw=document.getElementById('mvKills').value.trim().replace(/[\s\u00a0\u202f]/g,'');if(playerPowerRaw&&(!/^\d+(?:\.\d{1,3})?$/.test(playerPowerRaw)||Number(playerPowerRaw)>1e9)){alert('Puissance joueur invalide (en millions).');return;}if(killsRaw&&(!/^\d+$/.test(killsRaw)||!Number.isSafeInteger(Number(killsRaw)))){alert('Nombre de kills invalide.');return;}const payload={player_power:playerPowerRaw===''?null:Number(playerPowerRaw),kills:killsRaw===''?null:Number(killsRaw),kind:document.getElementById('mvType').value,player_name:name,power:document.getElementById('mvPower').value.trim(),server:document.getElementById('mvServer').value.trim(),alliance:document.getElementById('mvAlliance').value.trim(),status:document.getElementById('mvStatus').value};const initialNote=document.getElementById('mvInitialNote').value.trim();if(editId)payload.id=editId;else payload.season='Registre commun';if(!editId&&initialNote)payload.initial_note=initialNote;if(await mvChange(editId?'update':'add',payload)){if(editId&&initialNote){const saved=await mvChange('add_note',{movement_id:editId,body:initialNote});if(!saved)return;}mvCancelEdit();}}
function mvUpdateLocationFilters(){
 const norm=v=>String(v??'').trim();
 const fill=(id,values,selected,allLabel)=>{
  const select=document.getElementById(id);if(!select)return 'all';
  const unique=[...new Set(values.map(norm).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr',{numeric:true,sensitivity:'base'}));
  select.replaceChildren(new Option(allLabel,'all'));
  unique.forEach(v=>select.add(new Option(v,v)));
  const match=unique.find(v=>v.toLocaleLowerCase('fr')===String(selected).toLocaleLowerCase('fr'));
  select.value=match??'all';return select.value;
 };
 mvAllianceFilter=fill('mvAllianceFilter',mvRows.map(r=>r.alliance),mvAllianceFilter,'Toutes les alliances');
 mvServerFilter=fill('mvServerFilter',mvRows.map(r=>r.server),mvServerFilter,'Tous les serveurs');
}
function mvFilter(kind){mvCurrentFilter=kind;const selector=document.getElementById('mvTypeFilter');if(selector)selector.value=kind;mvRender();}
function mvCell(tr,text){const td=document.createElement('td');td.textContent=text??'';tr.append(td);return td;}
function mvParseT1(value){const raw=String(value??'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');if(!raw)return null;const match=raw.match(/^([0-9]+(?:\.[0-9]+)?)([kKmMbB]?)$/);if(!match)return null;const number=Number(match[1]);if(!Number.isFinite(number))return null;return number*({k:1e3,m:1e6,b:1e9}[match[2].toLowerCase()]||1);}
// Les puissances saisies sans suffixe sont exprimées en millions, comme les fiches T1.
function mvNormalizePowerInput(){
 const input=document.getElementById('mvPower');if(!input||input.readOnly)return true;
 const raw=input.value.trim();if(!raw)return true;
 const cleaned=raw.replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
 const match=cleaned.match(/^([0-9]+(?:\.[0-9]+)?)([kKmMbB]?)$/);
 if(!match)return false;
 const amount=Number(match[1]);if(!Number.isFinite(amount))return false;
 const suffix=(match[2]||'M').toUpperCase();
 input.value=amount.toLocaleString('fr-FR',{maximumFractionDigits:6})+' '+suffix;
 return true;
}
function mvFormatT1(value){return (value/1e6).toLocaleString('fr-FR',{maximumFractionDigits:2})+' M';}
let mvRenderDeferred=false;
// Ne pas reconstruire les lignes pendant qu'un menu Statut / Siège est ouvert.
// Les données Supabase continuent d'être récupérées en arrière-plan.
document.addEventListener('focusout',event=>{
 const host=document.getElementById('mvRows');
 if(!mvRenderDeferred||!host||!host.contains(event.target))return;
 setTimeout(()=>{
  if(!mvRenderDeferred||host.contains(document.activeElement))return;
  mvRenderDeferred=false;
  mvRender();
 },0);
});
function mvRender(){const host=document.getElementById('mvRows');if(!host)return;
 if(host.contains(document.activeElement)){
  mvRenderDeferred=true;
  return;
 }
 mvRenderDeferred=false;document.querySelectorAll('body > .mv-note-tooltip').forEach(el=>el.remove());host.replaceChildren();mvUpdateLocationFilters();const included=mvRows.filter(r=>r.status==='confirmed'||r.status==='finalized'||r.status==='completed');const incoming=included.filter(r=>r.kind==='recruit').length,outgoing=included.filter(r=>r.kind==='departure').length;document.getElementById('mvIn').textContent=incoming;document.getElementById('mvOut').textContent=outgoing;document.getElementById('mvBalance').textContent=(incoming-outgoing>0?'+':'')+(incoming-outgoing);const withT1=included.map(r=>({...r,t1:mvParseT1(r.power)})).filter(r=>r.t1!==null);const t1In=withT1.filter(r=>r.kind==='recruit'),t1Out=withT1.filter(r=>r.kind==='departure');const sumT1=rows=>rows.reduce((sum,r)=>sum+r.t1,0);const inPower=sumT1(t1In),outPower=sumT1(t1Out),difference=inPower-outPower;document.getElementById('mvT1In').textContent=mvFormatT1(inPower);document.getElementById('mvT1Out').textContent=mvFormatT1(outPower);const diffEl=document.getElementById('mvT1Diff');diffEl.textContent=(difference>0?'+':'')+mvFormatT1(difference);diffEl.style.color=difference>0?'#22c55e':difference<0?'#ef4444':'';document.getElementById('mvT1Coverage').textContent='Bilan des recrutements et départs confirmés ou finalisés (anciens dossiers « terminés » inclus) : '+t1In.length+'/'+incoming+' arrivées et '+t1Out.length+'/'+outgoing+' départs avec puissance T1 renseignée. Les valeurs manquantes ne sont pas comptées.';mvRows.filter(r=>(mvCurrentFilter==='all'||r.kind===mvCurrentFilter)&&(mvStatusFilter==='all'||(mvStatusFilter==='finalized'?(r.status==='finalized'||r.status==='completed'):r.status===mvStatusFilter))&&(mvAllianceFilter==='all'||String(r.alliance??'').trim()===mvAllianceFilter)&&(mvServerFilter==='all'||String(r.server??'').trim()===mvServerFilter)).forEach(r=>{const tr=document.createElement('tr');const name=mvCell(tr,r.player_name);name.style.fontWeight='600';const meta=document.createElement('div');meta.className='mv-note';meta.textContent=[r.power&&'T1 : '+r.power,r.server&&'Serveur '+r.server,r.alliance].filter(Boolean).join(' · ');name.append(meta);mvCell(tr,r.player_power==null?'—':Number(r.player_power).toLocaleString('fr-FR',{maximumFractionDigits:3})+' M');mvCell(tr,r.kills==null?'—':Number(r.kills).toLocaleString('fr-FR'));mvCell(tr,r.kind==='recruit'?'🟢 Arrivée':'🔴 Départ');const status=mvCell(tr,'');const sel=document.createElement('select');Object.entries(mvStatuses).forEach(([k,v])=>sel.add(new Option(v,k)));sel.value=r.status;sel.onchange=async()=>{const old=r.status;r.status=sel.value;if(!await mvChange('update',{id:r.id,status:sel.value}))sel.value=old;};status.append(sel);const seat=mvCell(tr,'');const sc=document.createElement('select');mvColors.forEach(([k,v])=>sc.add(new Option(v,k)));sc.value=r.seat_color||'';sc.title='Couleur du siège';sc.setAttribute('aria-label','Couleur du siège de '+r.player_name);sc.style.width='58px';sc.style.minWidth='58px';sc.onchange=()=>mvChange('update',{id:r.id,seat_color:sc.value});seat.append(sc);const note=mvCell(tr,'');const btn=document.createElement('button');btn.className='btn';const playerNotes=mvNotes.filter(n=>n.movement_id===r.id);btn.textContent='📝';btn.title='Voir les notes ('+playerNotes.length+')';btn.setAttribute('aria-label','Notes de '+r.player_name+' ('+playerNotes.length+')');btn.onclick=()=>mvOpenNoteModal(r.id);if(playerNotes.length){const wrap=document.createElement('span');wrap.className='mv-note-tooltip-wrap';btn.classList.add('mv-notes-present');btn.setAttribute('aria-label',playerNotes.length+' annotation(s) pour '+r.player_name+'. Cliquer pour ouvrir la fiche.');const bubble=document.createElement('div');bubble.className='mv-note-tooltip';bubble.hidden=true;bubble.setAttribute('role','tooltip');const heading=document.createElement('strong');heading.className='mv-note-tooltip-heading';heading.textContent='📝 '+playerNotes.length+' annotation(s) — '+r.player_name;bubble.append(heading);playerNotes.forEach(n=>{const item=document.createElement('span');item.className='mv-note-tooltip-item';const author=document.createElement('strong');author.textContent=(n.author||'Staff')+' · '+(n.created_at?new Date(n.created_at).toLocaleDateString('fr-FR'):'');const body=document.createElement('span');body.textContent=n.body||'';item.append(author,body);bubble.append(item);});wrap.append(btn);note.append(wrap);document.body.append(bubble);
const positionBubble=()=>{const rect=btn.getBoundingClientRect();const w=Math.min(440,window.innerWidth-24);const x=Math.max(12,Math.min(rect.left,window.innerWidth-w-12));bubble.style.left=x+'px';bubble.style.top='12px';bubble.hidden=false;const h=bubble.getBoundingClientRect().height;const above=rect.top-h-10;const below=rect.bottom+10;bubble.style.top=(above>=12?above:below+h<=window.innerHeight-12?below:Math.max(12,Math.min(window.innerHeight-h-12,rect.top-h/2)))+'px';};
const hideBubble=()=>{bubble.hidden=true;};btn.addEventListener('mouseenter',positionBubble);btn.addEventListener('mouseleave',hideBubble);btn.addEventListener('focus',positionBubble);btn.addEventListener('blur',hideBubble);btn.addEventListener('click',hideBubble);}else{note.append(btn);}const act=mvCell(tr,'');const actionGroup=document.createElement('div');actionGroup.className='mv-row-actions';const edit=document.createElement('button');edit.className='btn';edit.textContent='✏️';edit.title='Modifier la fiche';edit.setAttribute('aria-label','Modifier '+r.player_name);edit.onclick=()=>mvEdit(r.id);actionGroup.append(edit);const del=document.createElement('button');del.className='btn mv-delete-icon';del.textContent='❌';del.title='Supprimer le mouvement';del.setAttribute('aria-label','Supprimer le mouvement de '+r.player_name);del.onclick=()=>{if(confirm('Supprimer ce mouvement et toutes ses annotations ?'))mvChange('delete',{id:r.id});};actionGroup.append(del);act.append(actionGroup);host.append(tr);});}

function mvOpenNoteModal(id){mvSelectedId=id;mvRenderNoteModal();const modal=document.getElementById('mvNoteModal');modal.hidden=false;document.getElementById('mvNoteModalInput').focus();}
function mvCloseNoteModal(){document.getElementById('mvNoteModal').hidden=true;document.getElementById('mvNoteModalInput').value='';}
function mvRenderNoteModal(){const r=mvRows.find(x=>x.id===mvSelectedId),list=document.getElementById('mvNoteModalList');list.replaceChildren();document.getElementById('mvNoteModalTitle').textContent='📝 Notes — '+(r?.player_name||'Joueur');if(!r)return;const notes=mvNotes.filter(n=>n.movement_id===r.id);if(!notes.length){const p=document.createElement('p');p.textContent='Aucune annotation pour le moment.';list.append(p);}notes.forEach(n=>{const item=document.createElement('div');item.className='mv-note-modal-item';const meta=document.createElement('small');meta.textContent=(n.author||'Staff')+' · '+(n.created_at?new Date(n.created_at).toLocaleString('fr-FR'):'');const body=document.createElement('div');body.textContent=n.body||'';item.append(meta,body);if(n.author===currentUser?.username||isAdmin()){const edit=document.createElement('button');edit.className='btn';edit.textContent='✏️ Modifier';edit.onclick=async()=>{const next=prompt('Modifier cette annotation :',n.body);if(next!==null&&next.trim())await mvChange('edit_note',{id:n.id,body:next.trim()});};const del=document.createElement('button');del.className='btn';del.textContent='Supprimer';del.onclick=async()=>{if(confirm('Supprimer cette annotation ?'))await mvChange('delete_note',{id:n.id});};item.append(edit,del);}list.append(item);});}
async function mvSubmitModalNote(){if(!mvSelectedId)return;const el=document.getElementById('mvNoteModalInput'),body=el.value.trim();if(!body)return alert('Écrire une annotation');if(await mvChange('add_note',{movement_id:mvSelectedId,body})){el.value='';mvRenderNoteModal();}}
