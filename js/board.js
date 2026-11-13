import { firebaseConfig, appCheckSiteKey } from './firebase-config.js';
const $ = id => document.getElementById(id);
const el = (tag, className='', text='') => { const n=document.createElement(tag); if(className)n.className=className; n.textContent=text; return n; };
const params=new URLSearchParams(location.search);
const threadId=params.get('id');
const work=params.get('work');
const workTitle=work==='space'?'숲과 도시의 만남':work==='product'?'StyleHANGER':'';
let auth,db,F,A,user=null,operator=false,ready=false,posts=[],comments=[],currentPost=null,limitCount=20;
let stopPosts,stopThread,stopComments,mode=null,deleting=null,authGeneration=0;
const canWrite=()=>ready && user?.emailVerified;
const canManage=d=>canWrite() && (operator || (!d.official && d.uid===user.uid));
function status(message,error=false){$('connection-status').textContent=message;$('connection-status').classList.toggle('error',error);}
function messageFor(error){
 const map={'auth/invalid-credential':'이메일 또는 비밀번호를 확인해 주세요.','auth/invalid-email':'이메일 형식을 확인해 주세요.','auth/email-already-in-use':'이미 가입한 이메일입니다. 로그인 또는 비밀번호 재설정을 이용해 주세요.','auth/weak-password':'더 긴 비밀번호를 사용해 주세요.','auth/too-many-requests':'요청이 많습니다. 잠시 후 다시 시도해 주세요.','auth/network-request-failed':'인터넷 연결을 확인해 주세요.','auth/operation-not-allowed':'로그인을 준비 중입니다. 잠시 후 이용해 주세요.','permission-denied':'권한을 확인해 주세요. 연속 작성은 15초 간격으로 가능합니다. 이메일 인증 후 다시 로그인해 보세요.','unavailable':'서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.','failed-precondition':'게시판을 준비 중입니다. 잠시 후 다시 이용해 주세요.'};
 return map[error.code] || '처리하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.';
}
function dateLabel(value){return value?.toDate ? new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(value.toDate()):'저장 확인 중';}
function metadata(d){const row=el('div','post-meta');row.append(el('span','author',d.author));if(d.official)row.append(el('span','badge','운영자'));row.append(el('time','',dateLabel(d.createdAt)));if(d.updatedAt?.seconds>d.createdAt?.seconds)row.append(el('span','','수정됨'));return row;}
function action(label,fn){const b=el('button','text-btn',label);b.type='button';b.addEventListener('click',fn);return b;}
function empty(container,title,body){container.replaceChildren();const box=el('div','empty');box.append(el('span','','✳'),el('h3','',title),el('p','',body));container.append(box);}
function renderPosts(){
 const query=$('search-query').value.trim().toLocaleLowerCase();const category=$('category-filter').value;
 const filtered=posts.filter(p=>(!category||p.category===category)&&(!query||(p.title+' '+p.body).toLocaleLowerCase().includes(query)));
 $('post-count').textContent=String(filtered.length);$('search-scope').textContent=`현재 ${posts.length}개 글을 불러왔습니다. 검색은 불러온 글의 제목·내용에 적용됩니다.`;
 if(!filtered.length){empty($('posts'),query||category?'검색된 이야기가 없습니다.':'첫 번째 이야기를 기다립니다.',query||category?'검색 조건을 바꾸거나 이전 이야기를 더 불러와 주세요.':'작품에 대한 질문과 생각으로 대화를 시작해 주세요.');return;}
 $('posts').replaceChildren();
 for(const p of filtered){const row=el('article','post-row');const center=el('div');const a=el('a','',p.title);a.href=`board.html?id=${encodeURIComponent(p.id)}`;const h=el('h3');h.append(a);center.append(h,metadata(p));const arrow=el('a','','↗');arrow.href=a.href;arrow.setAttribute('aria-label',p.title+' 읽기');row.append(el('span','category-label',p.category),center,arrow);$('posts').append(row);}
}
function renderThread(){
 if(!currentPost)return;
 if(currentPost.deleted){empty($('thread-post'),'삭제된 이야기입니다.','목록으로 돌아가 다른 이야기를 확인해 주세요.');$('new-comment').disabled=true;$('comments').replaceChildren();return;}
 const header=el('header','thread-header');header.append(el('span','category-label',currentPost.category),el('h2','',currentPost.title),metadata(currentPost));$('thread-post').replaceChildren(header,el('div','body-text',currentPost.body));
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
  currentPost={...snapshot.data(),id:snapshot.id};document.title=currentPost.title+' | GAHYEON FORM';renderThread();status('글과 댓글이 연결되었습니다. 새 답변은 자동으로 반영됩니다.');
  if(currentPost.deleted){stopComments?.();return;}
  if(!stopComments)stopComments=F.onSnapshot(F.query(F.collection(db,'posts',threadId,'comments'),F.orderBy('createdAt','asc')),snap=>{comments=snap.docs.map(d=>({...d.data(),id:d.id}));renderComments();},error=>status(messageFor(error),true));
 },error=>{currentPost=null;$('new-comment').disabled=true;stopComments?.();$('comments').replaceChildren();empty($('thread-post'),'글을 열 수 없습니다.','삭제된 글이거나 연결을 확인해야 하는 상태입니다.');status(messageFor(error),true);});
}
async function updateAccount(next){
 const generation=++authGeneration;user=next;operator=false;
 $('account-toggle').hidden=!!user;$('logout').hidden=!user;$('auth-form').hidden=true;$('verify-panel').hidden=!user||user.emailVerified;
 let nextOperator=false;
 if(next?.emailVerified){try{const role=await F.getDoc(F.doc(db,'admins',next.uid));nextOperator=role.exists() && role.data().enabled===true;}catch(error){if(generation===authGeneration)status(messageFor(error),true);}}
 if(generation!==authGeneration)return;operator=nextOperator;
 $('account-label').textContent=user?(operator?'현가현 · 운영자':user.email):'누구나 읽고, 로그인 후 이야기해요.';
 $('account-detail').textContent=!user?'이메일 인증을 완료하면 글·댓글·답글을 남길 수 있습니다.':user.emailVerified?'글과 댓글을 남길 수 있습니다. 이메일은 게시글에 표시되지 않습니다.':'인증 메일을 확인하고 아래의 인증 완료 확인을 눌러 주세요.';
 $('new-post').disabled=!canWrite();$('new-comment').disabled=!canWrite()||!currentPost||currentPost.deleted;
 if($('editor-dialog').open)$('editor-dialog').close();if($('delete-dialog').open)$('delete-dialog').close();renderThread();
}
function openEditor(kind,data=null){
 if(!canWrite()){status('이메일 인증을 완료한 계정으로 로그인해 주세요.',true);return;}
 mode={kind,data};const form=$('editor-form');form.reset();const post=kind.includes('post');const editing=kind.startsWith('edit');
 $('editor-heading').textContent=editing?'내용 수정':kind==='reply'?'답글 남기기':post?'이야기 남기기':'댓글 남기기';
 $('post-fields').hidden=!post;form.elements.title.required=post;form.elements.title.value=editing?data.title||'':post&&workTitle?'['+workTitle+'] ':'';
 form.elements.category.value=editing?data.category||'작품 이야기':'작품 이야기';form.elements.body.maxLength=post?5000:2000;$('body-limit').textContent=post?'최대 5,000자':'최대 2,000자';form.elements.body.value=editing?data.body:'';
 $('author-field').hidden=editing||operator;form.elements.author.required=!editing&&!operator;form.elements.author.value=operator?'현가현':'';
 $('reply-context').textContent=kind==='reply'?data.author+' 님의 댓글에 답글을 남깁니다.':operator&&!editing?'현가현 · 운영자 이름으로 작성합니다.':'';
 $('editor-message').textContent='';$('save-editor').disabled=false;$('save-editor').textContent=editing?'수정 완료':'등록하기 ↗';$('editor-dialog').showModal();(post?form.elements.title:form.elements.body).focus();
}
function openDelete(kind,data){deleting={kind,data};$('delete-description').textContent=kind==='post'?data.title+' — 글을 삭제하면 방문자는 이 글과 연결된 댓글을 열 수 없습니다.':'이 댓글의 본문을 삭제합니다. 기존 답글은 남습니다.';$('delete-message').textContent='';$('confirm-delete').disabled=false;$('delete-dialog').showModal();}
async function commit(ref,data,update=false){
 if(!canWrite())throw {code:'permission-denied'};if(!navigator.onLine)throw {code:'unavailable'};
 const batch=F.writeBatch(db);batch.set(F.doc(db,'throttles',user.uid),{lastWrite:F.serverTimestamp()});if(update)batch.update(ref,data);else batch.set(ref,data);await batch.commit();
}
$('editor-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!mode||$('save-editor').disabled)return;const form=event.currentTarget;const {kind,data}=mode;const post=kind.includes('post');const editing=kind.startsWith('edit');const body=form.elements.body.value.trim();const title=form.elements.title.value.trim();const author=operator?'현가현':form.elements.author.value.trim();
 if(!body||post&&!title||!editing&&!author){$('editor-message').textContent='내용과 필수 항목을 입력해 주세요.';return;}
 $('save-editor').disabled=true;$('editor-message').textContent='저장하고 있습니다. 연결이 느리면 잠시 기다려 주세요.';
 try{
  const payload={body,updatedAt:F.serverTimestamp()};if(post)Object.assign(payload,{title,category:form.elements.category.value});
  if(!editing)Object.assign(payload,{uid:user.uid,author,official:operator,deleted:false,createdAt:F.serverTimestamp()});
  if(!post&&!editing)payload.parentId=kind==='reply'?data.id:'';
  const ref=editing?F.doc(db,post?'posts':'posts/'+threadId+'/comments',data.id):F.doc(F.collection(db,post?'posts':'posts/'+threadId+'/comments'));
  await commit(ref,payload,editing);$('editor-dialog').close();if(post&&!editing)location.href='board.html?id='+encodeURIComponent(ref.id);else status('저장했습니다. 새 내용이 반영되었습니다.');
 }catch(error){$('editor-message').textContent=messageFor(error);}finally{$('save-editor').disabled=false;}
});
$('delete-form').addEventListener('submit',async event=>{event.preventDefault();if(!deleting||$('confirm-delete').disabled)return;$('confirm-delete').disabled=true;try{const {kind,data}=deleting;const payload={body:'',author:'작성자',deleted:true,updatedAt:F.serverTimestamp()};if(kind==='post')payload.title='삭제된 이야기';await commit(F.doc(db,kind==='post'?'posts':'posts/'+threadId+'/comments',data.id),payload,true);$('delete-dialog').close();if(kind==='post')location.href='board.html';else status('댓글 본문을 삭제했습니다.');}catch(error){$('delete-message').textContent=messageFor(error);}finally{$('confirm-delete').disabled=false;}});
$('close-editor').onclick=$('cancel-editor').onclick=()=>$('editor-dialog').close();$('cancel-delete').onclick=()=>$('delete-dialog').close();
$('new-post').onclick=()=>openEditor('new-post');$('new-comment').onclick=()=>openEditor('comment');
$('search-form').onsubmit=e=>{e.preventDefault();renderPosts();};$('category-filter').onchange=renderPosts;$('clear-search').onclick=()=>{$('search-query').value='';$('category-filter').value='';renderPosts();};
$('load-more').onclick=()=>{limitCount+=20;subscribePosts();};
$('account-toggle').onclick=()=>{$('auth-form').hidden=!$('auth-form').hidden;if(!$('auth-form').hidden)$('auth-email').focus();};
$('auth-form').addEventListener('submit',async event=>{
 event.preventDefault();if(!ready)return;const button=event.submitter || event.currentTarget.querySelector('button[type="submit"]');const intent=button?.dataset.intent||'login';const email=$('auth-email').value.trim(),password=$('auth-password').value;button.disabled=true;$('auth-message').textContent='처리 중입니다.';
 try{if(intent==='signup'){const result=await A.createUserWithEmailAndPassword(auth,email,password);try{await A.sendEmailVerification(result.user);status('인증 메일을 보냈습니다. 이메일에서 링크를 열고 인증 완료 확인을 눌러 주세요.');}catch(error){status('계정은 생성되었습니다. 인증 메일 다시 받기를 눌러 주세요.',true);}}else{await A.signInWithEmailAndPassword(auth,email,password);status('로그인했습니다.');}$('auth-password').value='';$('auth-message').textContent='';}catch(error){$('auth-message').textContent=messageFor(error);}finally{button.disabled=false;}
});
$('logout').onclick=async()=>{try{await A.signOut(auth);status('로그아웃했습니다.');}catch(error){status(messageFor(error),true);}};
$('reset-password').onclick=async()=>{if(!$('auth-email').reportValidity())return;try{await A.sendPasswordResetEmail(auth,$('auth-email').value.trim());$('auth-message').textContent='등록된 이메일이라면 재설정 안내가 전송됩니다.';}catch(error){$('auth-message').textContent=messageFor(error);}};
$('resend-verification').onclick=async()=>{try{await A.sendEmailVerification(user);status('인증 메일을 다시 보냈습니다.');}catch(error){status(messageFor(error),true);}};
$('refresh-user').onclick=async()=>{try{await A.reload(user);await user.getIdToken(true);await updateAccount(auth.currentUser);status(user.emailVerified?'이메일 인증이 확인되었습니다.':'아직 인증되지 않았습니다. 이메일의 인증 링크를 먼저 열어 주세요.');}catch(error){status(messageFor(error),true);}};
if(workTitle){$('work-context').hidden=false;$('work-context').textContent=workTitle+'에 대한 이야기를 남겨 보세요. 새 글 제목에 작품명이 들어갑니다.';}
async function start(){
 if(!firebaseConfig.apiKey||!firebaseConfig.projectId||!firebaseConfig.appId||!firebaseConfig.authDomain){status('게시판 연결 전입니다. 현재는 작품을 둘러볼 수 있으며 글 작성은 연결 후 열립니다.');empty($('posts'),'대화를 준비하고 있습니다.','게시판 연결이 완료되면 이곳에서 글과 댓글을 주고받을 수 있습니다.');return;}
 try{
  const sdk='https://www.gstatic.com/firebasejs/13.3.0/';
  const [appModule,firestoreModule,authModule]=await Promise.all([import(sdk+'firebase-app.js'),import(sdk+'firebase-firestore.js'),import(sdk+'firebase-auth.js')]);F=firestoreModule;A=authModule;
  const app=appModule.initializeApp(firebaseConfig);
  if(appCheckSiteKey){const check=await import(sdk+'firebase-app-check.js');check.initializeAppCheck(app,{provider:new check.ReCaptchaEnterpriseProvider(appCheckSiteKey),isTokenAutoRefreshEnabled:true});}
  db=F.getFirestore(app);auth=A.getAuth(app);auth.languageCode='ko';ready=true;$('account-toggle').disabled=false;
  A.onAuthStateChanged(auth,updateAccount);if(threadId)subscribeThread();else subscribePosts();
 }catch(error){status('게시판에 연결하지 못했습니다. 인터넷 연결 또는 사이트 연결 설정을 확인해 주세요.',true);empty($('posts'),'연결을 기다리고 있습니다.','잠시 후 페이지를 새로고침해 주세요.');}
}
start();
window.addEventListener('offline',()=>status('인터넷 연결이 끊겼습니다. 다시 연결될 때까지 새 글을 저장할 수 없습니다.',true));
