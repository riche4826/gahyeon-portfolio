import { firebaseConfig, appCheckSiteKey } from './firebase-config.js';
const $ = id => document.getElementById(id);
const el = (tag, className='', text='') => { const n=document.createElement(tag); if(className)n.className=className; n.textContent=text; return n; };
const params=new URLSearchParams(location.search);
const threadId=params.get('id');
const work=params.get('work');
const workTitle=work==='space'?'숲과 도시의 만남':work==='product'?'StyleHANGER':'';
let auth,db,F,A,user=null,operator=false,ready=false,posts=[],comments=[],currentPost=null,limitCount=20;
let stopPosts,stopThread,stopComments,mode=null,deleting=null,authGeneration=0;
let operatorRef;
let slotKnown = false;
let operatorUid = null;
let signingUp = false;
const canWrite = () => ready;
const canManage = () => ready && operator;
const postLabel = post => post.title || post.body.split('\n')[0].slice(0, 80);
function status(message,error=false){$('connection-status').textContent=message;$('connection-status').classList.toggle('error',error);}
function messageFor(error){
 const map = {'auth/invalid-credential':'이메일 또는 비밀번호를 확인해 주세요.', 'auth/too-many-requests':'잠시 후 다시 시도해 주세요.', 'permission-denied':'저장 권한을 확인해 주세요.', 'unavailable':'인터넷 연결을 확인해 주세요.'};
 return map[error.code] || '처리하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.';
}
function dateLabel(value){return value?.toDate ? new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(value.toDate()):'저장 확인 중';}
function metadata(d){const row=el('div','post-meta');row.append(el('span','author',d.author));if(d.official)row.append(el('span','badge','운영자'));row.append(el('time','',dateLabel(d.createdAt)));if(d.updatedAt?.seconds>d.createdAt?.seconds)row.append(el('span','','수정됨'));return row;}
function action(label,fn){const b=el('button','text-btn',label);b.type='button';b.addEventListener('click',fn);return b;}
function empty(container,title,body){container.replaceChildren();const box=el('div','empty');box.append(el('span','','✳'),el('h3','',title),el('p','',body));container.append(box);}
function renderPosts(){
 const query=$('search-query').value.trim().toLocaleLowerCase();
 const filtered=posts.filter(p=>!query||(p.author+' '+p.body).toLocaleLowerCase().includes(query));
 $('post-count').textContent=String(filtered.length);$('search-scope').textContent=`현재 ${posts.length}개 글을 불러왔습니다. 검색은 불러온 글의 이름·내용에 적용됩니다.`;
 if(!filtered.length){empty($('posts'),query?'검색된 이야기가 없습니다.':'첫 번째 이야기를 기다립니다.',query?'검색 조건을 바꾸거나 이전 이야기를 더 불러와 주세요.':'작품에 대한 질문과 생각으로 대화를 시작해 주세요.');return;}
 $('posts').replaceChildren();
 for(const p of filtered){const row=el('article','post-row');const center=el('div');const a=el('a','',postLabel(p));a.href=`board.html?id=${encodeURIComponent(p.id)}`;const h=el('h3');h.append(a);center.append(h,metadata(p));const arrow=el('a','','↗');arrow.href=a.href;arrow.setAttribute('aria-label',p.author+' 님의 글 읽기');row.append(el('span','category-label',p.category || '방명록'),center,arrow);$('posts').append(row);}
}
function renderThread(){
 if(!currentPost)return;
 if(currentPost.deleted){empty($('thread-post'),'삭제된 이야기입니다.','목록으로 돌아가 다른 이야기를 확인해 주세요.');$('new-comment').disabled=true;$('comments').replaceChildren();return;}
 const header=el('header','thread-header');header.append(el('h2','',currentPost.title || currentPost.author+' 님의 방명록'),metadata(currentPost));$('thread-post').replaceChildren(header,el('div','body-text',currentPost.body));
 if(canManage(currentPost)){const actions=el('div','manage-actions');actions.append(action('글 수정',()=>openEditor('edit-post',currentPost)),action('글 삭제',()=>openDelete('post',currentPost)));$('thread-post').append(actions);}
 $('new-comment').disabled=!canWrite();renderComments();
}
function renderComments(){
 $('comments').replaceChildren();$('comment-count').textContent=String(comments.filter(c=>!c.deleted).length);
 if(!comments.length){empty($('comments'),'아직 댓글이 없습니다.','첫 의견을 남겨 대화를 이어 주세요.');return;}
 const draw=(c,reply=false)=>{const node=el('article','comment'+(reply?' reply':'')+(c.deleted?' deleted':''));node.id='comment-'+c.id;node.append(metadata(c),el('p','body-text',c.deleted?'삭제된 댓글입니다.':c.body));const actions=el('div','manage-actions');if(!c.deleted&&canWrite()&&!reply)actions.append(action('답글 ＋',()=>openEditor('reply',c)));if(!c.deleted&&canManage(c))actions.append(action('수정',()=>openEditor('edit-comment',c)),action('삭제',()=>openDelete('comment',c)));node.append(actions);$('comments').append(node);};
 const roots=comments.filter(c=>!c.parentId);for(const c of roots){draw(c);for(const r of comments.filter(r=>r.parentId===c.id))draw(r,true);}
}
function subscribePosts(){
 stopPosts?.();$('load-more').disabled=true;
 stopPosts=F.onSnapshot(F.query(F.collection(db,'posts'),F.where('deleted','==',false),F.orderBy('createdAt','desc'),F.limit(limitCount)),snapshot=>{
  posts=snapshot.docs.map(d=>({...d.data(),id:d.id}));renderPosts();$('load-more').hidden=snapshot.size<limitCount;$('load-more').disabled=false;status('이야기가 연결되었습니다. 새 글은 자동으로 반영됩니다.');
 },error=>{status(messageFor(error),true);empty($('posts'),'이야기를 불러오지 못했습니다.','연결을 확인한 뒤 페이지를 새로고침해 주세요.');$('load-more').disabled=false;});
}
function subscribeThread(){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(threadId)){status('올바르지 않은 글 주소입니다.',true);return;}
 $('list-view').hidden=true;$('thread-view').hidden=false;
 stopThread=F.onSnapshot(F.doc(db,'posts',threadId),snapshot=>{
  if(!snapshot.exists()){currentPost=null;empty($('thread-post'),'글을 찾을 수 없습니다.','삭제되었거나 존재하지 않는 글입니다.');$('new-comment').disabled=true;stopComments?.();return;}
  currentPost={...snapshot.data(),id:snapshot.id};document.title=postLabel(currentPost)+' | GAHYEON FORM';renderThread();status('글과 댓글이 연결되었습니다. 새 답변은 자동으로 반영됩니다.');
  if(currentPost.deleted){stopComments?.();return;}
  if(!stopComments)stopComments=F.onSnapshot(F.query(F.collection(db,'posts',threadId,'comments'),F.orderBy('createdAt','asc')),snap=>{comments=snap.docs.map(d=>({...d.data(),id:d.id}));renderComments();},error=>status(messageFor(error),true));
 },error=>{currentPost=null;$('new-comment').disabled=true;stopComments?.();$('comments').replaceChildren();empty($('thread-post'),'글을 열 수 없습니다.','삭제된 글이거나 연결을 확인해야 하는 상태입니다.');status(messageFor(error),true);});
}
function showRole(isOperator) {
 operator = isOperator;
 $('account-toggle').hidden = operator;
 $('signup-toggle').hidden = !slotKnown || operatorUid !== null;
 if (operator) setSignupOpen(false);
 $('logout').hidden = !operator;
 $('account-label').textContent = operator ? '현가현 · 운영자' : '방문자 글쓰기';
 $('account-detail').textContent = operator ? '방명록과 댓글을 수정하거나 삭제할 수 있습니다.' : '이름과 내용만 입력하면 누구나 방명록을 남길 수 있습니다.';
 if ($('editor-dialog').open && mode?.kind.startsWith('edit') && !operator) $('editor-dialog').close();
 if ($('delete-dialog').open && !operator) $('delete-dialog').close();
 renderThread();
}
async function syncRole() {
 const generation = ++authGeneration;
 const allowed = slotKnown && user != null && user.uid === operatorUid;
 showRole(allowed);
 if (allowed) {
  $('auth-form').hidden = true;
  return;
 }
 if (!user || !slotKnown || signingUp) return;
 try {
  await A.signOut(auth);
  if (generation !== authGeneration && auth.currentUser) return;
  $('auth-form').hidden = false;
  $('auth-message').textContent = '등록된 운영자 계정으로 로그인해 주세요.';
 } catch (error) { status(messageFor(error), true); }
}
function watchOperator() {
 operatorRef = F.doc(db, 'guestbook', 'operator');
 F.onSnapshot(operatorRef, {includeMetadataChanges:true}, snapshot => {
  if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
  slotKnown = true;
  operatorUid = snapshot.exists() ? snapshot.data().uid : null;
  if (operatorUid !== null && !signingUp) setSignupOpen(false);
  void syncRole();
 }, error => {
  slotKnown = false;
  showRole(false);
  status(messageFor(error), true);
 });
 A.onAuthStateChanged(auth, next => {
  user = next;
  void syncRole();
 });
}
function openEditor(kind,data=null){
 if(!ready || (kind.startsWith('edit') && !operator)) return;
 mode={kind,data};const form=$('editor-form');form.reset();const post=kind.includes('post');const editing=kind.startsWith('edit');
 $('editor-heading').textContent=editing?'내용 수정':kind==='reply'?'답글 남기기':post?'방명록 남기기':'댓글 남기기';
 form.elements.body.maxLength = post ? 5000 : 2000;
 $('body-limit').textContent = post ? '최대 5,000자' : '최대 2,000자';
 form.elements.body.value = editing ? data.body : '';
 form.elements.author.required = true;
 form.elements.author.value = editing ? data.author : operator ? '현가현' : '';
 form.elements.author.readOnly = editing ? data.official : operator;
 $('reply-context').textContent=kind==='reply'?data.author+' 님의 댓글에 답글을 남깁니다.':operator&&!editing?'현가현 · 운영자 이름으로 작성합니다.':'';
 $('editor-message').textContent='';$('save-editor').disabled=false;$('save-editor').textContent=editing?'수정 완료':'등록하기 ↗';$('editor-dialog').showModal();(form.elements.author.readOnly ? form.elements.body : form.elements.author).focus();
}
function openDelete(kind,data){deleting={kind,data};$('delete-description').textContent=kind==='post'?postLabel(data)+' — 글을 삭제하면 방문자는 이 글과 연결된 댓글을 열 수 없습니다.':'이 댓글의 본문을 삭제합니다. 기존 답글은 남습니다.';$('delete-message').textContent='';$('confirm-delete').disabled=false;$('delete-dialog').showModal();}
async function commit(ref,data,update=false){
 if (!ready || (update && !operator)) throw {code:'permission-denied'};
 if (!navigator.onLine) throw {code:'unavailable'};
 if (update) await F.updateDoc(ref,data);
 else await F.setDoc(ref,data);
}
$('editor-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!mode||$('save-editor').disabled)return;const form=event.currentTarget;const {kind,data}=mode;const post=kind.includes('post');const editing=kind.startsWith('edit');const body=form.elements.body.value.trim();const author=form.elements.author.value.trim();
 if(!body || !author){$('editor-message').textContent='이름과 내용을 입력해 주세요.';return;}
 $('save-editor').disabled=true;$('editor-message').textContent='저장하고 있습니다. 연결이 느리면 잠시 기다려 주세요.';
 try{
  const payload = {author, body, updatedAt:F.serverTimestamp()};
  if (!editing) Object.assign(payload,{official:operator, deleted:false, createdAt:F.serverTimestamp()});
  if(!post&&!editing)payload.parentId=kind==='reply'?data.id:'';
  const ref=editing?F.doc(db,post?'posts':'posts/'+threadId+'/comments',data.id):F.doc(F.collection(db,post?'posts':'posts/'+threadId+'/comments'));
  await commit(ref,payload,editing);$('editor-dialog').close();if(post&&!editing)location.href='board.html?id='+encodeURIComponent(ref.id);else status('저장했습니다. 새 내용이 반영되었습니다.');
 }catch(error){$('editor-message').textContent=messageFor(error);}finally{$('save-editor').disabled=false;}
});
$('delete-form').addEventListener('submit',async event=>{event.preventDefault();if(!deleting||$('confirm-delete').disabled)return;$('confirm-delete').disabled=true;try{const {kind,data}=deleting;const payload={body:'',author:'작성자',deleted:true,updatedAt:F.serverTimestamp()};if(kind==='post' && data.title)payload.title='삭제된 이야기';await commit(F.doc(db,kind==='post'?'posts':'posts/'+threadId+'/comments',data.id),payload,true);$('delete-dialog').close();if(kind==='post')location.href='board.html';else status('댓글 본문을 삭제했습니다.');}catch(error){$('delete-message').textContent=messageFor(error);}finally{$('confirm-delete').disabled=false;}});
$('close-editor').onclick=$('cancel-editor').onclick=()=>$('editor-dialog').close();$('cancel-delete').onclick=()=>$('delete-dialog').close();
$('new-post').onclick=()=>openEditor('new-post');$('new-comment').onclick=()=>openEditor('comment');
$('search-form').onsubmit=e=>{e.preventDefault();renderPosts();};$('clear-search').onclick=()=>{$('search-query').value='';renderPosts();};
$('load-more').onclick=()=>{limitCount+=20;subscribePosts();};
function setSignupOpen(open) {
 $('signup-form').hidden = !open;
 $('signup-toggle').setAttribute('aria-expanded', String(open));
 if (open) {
  $('auth-form').hidden = true;
  $('signup-email').focus();
 }
}
$('signup-toggle').onclick = () => setSignupOpen($('signup-form').hidden);
$('signup-form').addEventListener('submit', async event => {
 event.preventDefault();
 if (!ready || signingUp || !slotKnown || operatorUid !== null) return;
 const email = $('signup-email').value.trim();
 const password = $('signup-password').value;
 const message = $('signup-message');
 if (password !== $('signup-confirm').value) {
  message.textContent = '비밀번호가 일치하지 않습니다.';
  $('signup-confirm').focus();
  return;
 }
 signingUp = true;
 $('signup-submit').disabled = true;
 $('account-toggle').disabled = true;
 $('signup-toggle').disabled = true;
 message.textContent = '계정을 만들고 있습니다.';
 let registered = false;
 try {
  let credential;
  try {
   credential = await A.createUserWithEmailAndPassword(auth, email, password);
  } catch (error) {
   if (error.code !== 'auth/email-already-in-use') throw error;
   credential = await A.signInWithEmailAndPassword(auth, email, password);
  }
  const uid = credential.user.uid;
  await F.runTransaction(db, async transaction => {
   const slot = await transaction.get(operatorRef);
   if (!slot.exists()) transaction.set(operatorRef, {uid});
   else if (slot.data().uid !== uid) throw new Error('operator-taken');
  });
  registered = true;
  operatorUid = uid;
  user = auth.currentUser;
  $('signup-form').reset();
  status('첫 운영자로 등록했습니다. 지금부터 방명록을 관리할 수 있습니다.');
 } catch (error) {
  if (auth.currentUser) await A.signOut(auth);
  const detail = error.message === 'operator-taken' ? '이미 첫 운영자가 등록되었습니다.' :
   error.code === 'auth/weak-password' ? '더 긴 비밀번호를 입력해 주세요.' : messageFor(error);
  message.textContent = detail;
  status(detail, true);
 } finally {
  signingUp = false;
  if (registered || operatorUid !== null) setSignupOpen(false);
  void syncRole();
  $('signup-submit').disabled = false;
  $('account-toggle').disabled = false;
  $('signup-toggle').disabled = false;
 }
});
$('account-toggle').onclick=()=>{setSignupOpen(false);$('auth-form').hidden=!$('auth-form').hidden;if(!$('auth-form').hidden)$('auth-email').focus();};
$('auth-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!ready)return;const button=event.submitter || event.currentTarget.querySelector('button[type="submit"]');const email=$('auth-email').value.trim(), password=$('auth-password').value;
 button.disabled=true;
 try {
  $('auth-message').textContent='운영자 권한을 확인하고 있습니다.';
  await A.signInWithEmailAndPassword(auth,email,password);
  $('auth-password').value='';
 } catch(error) { $('auth-message').textContent=messageFor(error); }
 finally { button.disabled=false; }
});

$('logout').onclick=async()=>{try{await A.signOut(auth);status('로그아웃했습니다.');}catch(error){status(messageFor(error),true);}};
$('reset-password').onclick=async()=>{if(!$('auth-email').reportValidity())return;try{await A.sendPasswordResetEmail(auth,$('auth-email').value.trim());$('auth-message').textContent='등록된 이메일이라면 재설정 안내가 전송됩니다.';}catch(error){$('auth-message').textContent=messageFor(error);}};
if(workTitle){$('work-context').hidden=false;$('work-context').textContent=workTitle+'에 대한 생각을 남겨 주세요.';}
async function start(){
 if(!firebaseConfig.apiKey||!firebaseConfig.projectId||!firebaseConfig.appId||!firebaseConfig.authDomain){status('게시판 연결 전입니다. 현재는 작품을 둘러볼 수 있으며 글 작성은 연결 후 열립니다.');empty($('posts'),'대화를 준비하고 있습니다.','게시판 연결이 완료되면 이곳에서 글과 댓글을 주고받을 수 있습니다.');return;}
 try{
  const sdk='https://www.gstatic.com/firebasejs/13.3.0/';
  const [appModule,firestoreModule,authModule]=await Promise.all([import(sdk+'firebase-app.js'),import(sdk+'firebase-firestore.js'),import(sdk+'firebase-auth.js')]);F=firestoreModule;A=authModule;
  const app=appModule.initializeApp(firebaseConfig);
  if(appCheckSiteKey){const check=await import(sdk+'firebase-app-check.js');check.initializeAppCheck(app,{provider:new check.ReCaptchaEnterpriseProvider(appCheckSiteKey),isTokenAutoRefreshEnabled:true});}
  db=F.getFirestore(app);auth=A.getAuth(app);auth.languageCode='ko';ready=true;$('signup-submit').disabled=false;$('signup-message').textContent='';$('new-post').disabled=false;$('account-toggle').disabled=false;
  watchOperator();if(threadId)subscribeThread();else subscribePosts();
 }catch(error){status('게시판에 연결하지 못했습니다. 인터넷 연결 또는 사이트 연결 설정을 확인해 주세요.',true);empty($('posts'),'연결을 기다리고 있습니다.','잠시 후 페이지를 새로고침해 주세요.');}
}
start();
window.addEventListener('offline',()=>status('인터넷 연결이 끊겼습니다. 다시 연결될 때까지 새 글을 저장할 수 없습니다.',true));
