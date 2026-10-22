
/** v0.5 validation workbench — API-backed studio mount for forge-console. */
export const WORKBENCH_INTENT_ID = 'forge:studio-lightboat';

export async function mountStudioWorkbench(host, options = {}) {
  if (!host) return { destroy() {} };
  host.innerHTML = `<div id="forge-workflow" lang="zh-CN"><div class="fw-shell" id="fw-shell"></div><div class="fw-announcement" id="fw-announcement" aria-live="polite"></div></div>`;
  const root = host.querySelector('#forge-workflow');
  const shell = root.querySelector('#fw-shell');
  const live = root.querySelector('#fw-announcement');

// root/shell/live bound by mount
let timer=null,storageOK=true,draft=null,feedbackDraft='',responseDraft='',alertText='';
const fresh=()=>({schema:6,lang:'zh',stage:'brief',role:'maker',panel:'default',accepted:false,built:false,busy:false,buildTick:0,req:{title:'轻舟报价器',price:800,threshold:7,rate:30},locked:null,rule:null,version:0,versions:[],tests:null,checks:[],comment:null,submitted:null,submissions:[],acceptedDelivery:null,payable:null,pages:3,days:10,selectedCase:'normal',budget:{total:1200,spent:0,reserved:0},contract:null,asset:null,toast:'',history:[],testRunning:false});
let s=fresh(); s.feedbackHistory=[];
const L=(z,e)=>s.lang==='zh'?z:e;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'¥'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
const vname=v=>'v0.'+v;
const now=()=>new Date().toISOString();
const copy=o=>JSON.parse(JSON.stringify(o));
const obligation=()=>s.contract?600:0;
const available=()=>s.budget.total-s.budget.spent-s.budget.reserved-obligation();
const save=()=>{};
const announce=t=>{live.textContent=t;};
const log=(z,e)=>s.history.push({z,e,at:now(),version:s.version});
const note=(z,e)=>{s.toast=L(z,e);announce(s.toast);};
const btn=(a,z,e,cls='',disabled=false,extra='')=>`<button type="button" class="fw-btn ${cls} cursor-interaction" data-action="${a}" ${disabled?'disabled':''} ${extra}>${L(z,e)}</button>`;
const textbtn=(a,z,e,extra='')=>`<button type="button" class="fw-textbtn cursor-interaction" data-action="${a}" ${extra}>${L(z,e)}</button>`;
const pill=(z,e,c='')=>`<span class="fw-pill ${c}">${L(z,e)}</span>`;
const field=(label,id,value,type='number',attrs='')=>`<label class="fw-label" for="${id}">${label}</label><input class="fw-input" id="${id}" type="${type}" value="${esc(value)}" ${attrs}>`;
function calc(rule,pages,days){if(!rule||!Number.isInteger(pages)||pages<1||pages>30||!Number.isInteger(days)||days<1||days>60)return null;const base=pages*rule.price,fee=days<rule.threshold?Math.round(base*rule.rate/100):0;return{base,fee,total:base+fee};}
function cases(){const r=s.locked||s.req;return[{id:'normal',z:'常规交付',e:'Standard',pages:3,days:r.threshold+3,expected:3*r.price},{id:'rush',z:'加急边界前一天',e:'One day below cutoff',pages:3,days:r.threshold-1,expected:3*r.price+Math.round(3*r.price*r.rate/100)},{id:'edge',z:'恰好到达边界',e:'Exactly at the cutoff',pages:3,days:r.threshold,expected:3*r.price}];}
function testReady(){return s.tests&&s.tests.version===s.version&&s.tests.results.every(x=>x.pass);}
function feedbackReady(){return !s.comment||s.comment.status==='resolved';}
function ruleMatchesRequirements(r=s.rule){return !!r&&!!s.locked&&['price','threshold','rate'].every(k=>r[k]===s.locked[k]);}
function canSubmit(){return s.role==='maker'&&s.built&&!s.submitted&&!s.acceptedDelivery&&testReady()&&feedbackReady()&&ruleMatchesRequirements();}
function displayRule(){return s.acceptedDelivery?s.acceptedDelivery.rule:s.submitted?s.submitted.rule:s.rule;}
function header(){const stageIdx=['brief','craft','check','deliver'].indexOf(s.stage);const names=[['需求','Brief'],['制作','Make'],['试用','Try'],['交付','Deliver']];return `<header class="fw-top"><div class="fw-brand"><span class="fw-logo" aria-hidden="true"></span>InnoForge</div><div class="fw-project">${L('轻舟项目 / 客户自助报价','Lightboat / Self-service quotes')}</div><div class="fw-top-actions"><button type="button" class="fw-demo cursor-interaction" data-action="demo"><span class="fw-dot"></span>${L('本地演示','Local demo')}</button><button type="button" class="fw-textbtn fw-top-budget cursor-interaction" data-action="budget">${L('可用','Available')} ${money(available())}</button>${textbtn('lang',s.lang==='zh'?'EN':'中文',s.lang==='zh'?'EN':'中文','aria-label="'+L('切换为英文','Switch to Chinese')+'"')}</div></header><nav class="fw-path" aria-label="${L('工作过程','Workflow')}">${names.map((n,i)=>`${i?'<span class="fw-path-line" aria-hidden="true"></span>':''}<button type="button" class="fw-path-item ${i<stageIdx?'fw-done':''} cursor-interaction" data-action="stage" data-stage="${['brief','craft','check','deliver'][i]}" ${i===stageIdx?'aria-current="step"':''} ${((i>0&&!s.accepted)||(i>1&&!s.built)||(i===3&&!s.submitted&&!s.acceptedDelivery))?'disabled':''}><span class="fw-path-number">${i<stageIdx?'✓':i+1}</span>${L(...n)}</button>`).join('')}</nav>`;}
function workhead(){let title=L('网站报价工具','A website quote tool'),eyebrow=L('新的制作委托','NEW ASSIGNMENT'),meta=pill('待接单','Open');if(s.accepted){title=s.locked.title;eyebrow=s.acceptedDelivery?L('已交付 · T-01','DELIVERED · T-01'):s.submitted?L('待客户验收 · T-01','AWAITING CLIENT REVIEW · T-01'):s.stage==='check'?L('客户试用 · T-01','CLIENT TRIAL · T-01'):L('制作中 · T-01','IN PROGRESS · T-01');const failures=s.tests?s.tests.results.filter(x=>!x.pass).length:0;meta=`${s.built?pill(vname(s.version),vname(s.version)):pill('任务已创建','Task created','accent')}${s.acceptedDelivery?pill('已验收','Accepted','good'):s.comment&&s.comment.status!=='resolved'?pill('1 条反馈','1 comment','warn'):s.tests&&s.tests.version===s.version?pill(failures?failures+' 处待修订':'3 项通过',failures?failures+' mismatches':'3 checks pass',failures?'warn':'good'):s.built?pill('待试用','Ready to try'):''}`;}return `<div class="fw-workhead"><div><div class="fw-eyebrow">${eyebrow}</div><h1>${esc(title)}</h1></div><div class="fw-meta">${meta}</div></div>`;}
function briefCanvas(){const r=s.locked||s.req,locked=!!s.locked;return `<div class="fw-paper"><div class="fw-paper-top"><span>${L('客户简报','Client brief')}</span>${pill('演示材料','Demo material')}</div><div class="fw-note"><div class="fw-person"><span class="fw-avatar">${L('林','L')}</span><div><div style="font-size:12px">${L('林女士 · 星野设计','Lin · Hoshino Studio')}</div><div class="fw-tiny">${L('今天 09:41','Today 09:41')}</div></div></div><p class="fw-brief-copy">${L('“让客户填页数和交期，<br>自己拿到一份算得清的报价。”','“Let clients enter pages and timing,<br>and get a quote they can understand.”')}</p><div style="margin-bottom:18px">${field(L('产物名称','Product name'),'fw-brief-title',r.title,'text',`maxlength="30" ${locked?'readonly':''}`)}</div><div class="fw-brief-rules"><div class="fw-brief-rule"><label class="fw-label" for="fw-brief-price">${L('每页价格 · 元','Price / page · CNY')}</label><input id="fw-brief-price" type="number" min="100" max="10000" step="1" value="${r.price}" ${locked?'readonly':''}></div><div class="fw-brief-rule"><label class="fw-label" for="fw-brief-threshold">${L('少于几天算加急','Rush below · days')}</label><input id="fw-brief-threshold" type="number" min="3" max="25" step="1" value="${r.threshold}" ${locked?'readonly':''}></div><div class="fw-brief-rule"><label class="fw-label" for="fw-brief-rate">${L('加急加收 · %','Rush surcharge · %')}</label><input id="fw-brief-rate" type="number" min="1" max="100" step="1" value="${r.rate}" ${locked?'readonly':''}></div></div><div class="fw-source-line"><span>${locked?'✓':'↳'}</span><span>${locked?L('客户要求已冻结 · R1','Client requirements frozen · R1'):L('要求会随接单冻结为验收依据','Accepting locks these acceptance criteria')}</span></div></div></div>`;}
function contractPanel(){return `<div class="fw-panelhead"><h3>${L('本轮交付','This delivery')}</h3>${pill('1 个任务','1 task')}</div><ul class="fw-checklist"><li><span class="fw-checkmark">✓</span>${L('可运行的报价工具','A working quote tool')}</li><li><span class="fw-checkmark">✓</span>${L('3 个固定验收案例','3 frozen acceptance cases')}</li><li><span class="fw-checkmark">✓</span>${L('一轮反馈与修订','One round of revisions')}</li></ul><hr class="fw-sep"><div class="fw-small">${L('协作者固定报酬','Fixed collaborator fee')}</div><div class="fw-agreement"><div class="fw-money">¥600</div><small>${L('验收后 7 天到期','Due 7 days after acceptance')}</small></div><div class="fw-row fw-small"><span>${L('委托人','Client')}</span><span>${L('林女士〔演示〕','Lin · demo')}</span></div><div class="fw-row fw-small" style="margin-top:7px"><span>${L('执行者','Maker')}</span><span>${L('你〔演示〕','You · demo')}</span></div><div class="fw-bottom-action">${s.accepted?btn('return-work','回到制作','Back to making','primary block'):btn('accept-contract','接下制作 · 约定 ¥600','Accept job · ¥600','primary block')}${textbtn('terms','查看约定','View agreement')}</div>${alertText?`<p class="fw-error" role="alert">${esc(alertText)}</p>`:''}`;}
function emptyCanvas(){return `<div class="fw-paper"><div class="fw-paper-top"><div class="fw-paper-dots"><span></span><span></span><span></span></div><span>${L('报价工具 / 首版','Quote tool / First draft')}</span><span>—</span></div><div class="fw-empty-canvas"><div class="fw-product-brand"><span class="fw-product-sign"></span>LIGHTBOAT</div><div class="fw-skeleton-title"></div><div class="fw-skeleton-fields"><div></div><div></div></div><div class="fw-skeleton-result"></div><div class="fw-build-label">${s.busy?'<span class="fw-pending-dot"></span> '+L(['准备材料','创建输入字段','连接报价规则','整理首版'][s.buildTick]||'整理首版',['Preparing','Creating inputs','Connecting rules','Finishing draft'][s.buildTick]||'Finishing draft'):L('首版将在这里变成可操作的工具','Your working tool will appear here')}</div></div></div>`;}
function buildPanel(){return `<div class="fw-panelhead"><h3>${s.busy?L('正在制作首版','Building the first draft'):L('从通用模板开始','Start from a template')}</h3>${pill('演示代理','Demo agent','accent')}</div><div class="fw-small">${L('客户要求 R1 → 报价工具','Requirements R1 → Quote tool')}</div>${[['创建页数与交期输入','Create page and timing inputs'],['连接费用计算与明细','Connect pricing and line items'],['准备三个验收案例','Prepare three acceptance cases']].map((x,i)=>`<div class="fw-taskline ${s.busy?(s.buildTick>i?'done':s.buildTick===i?'current':''):''}"><span>${s.busy&&s.buildTick>i?'✓':'·'}</span>${L(...x)}</div>`).join('')}${s.busy?`<div class="fw-build-progress" role="progressbar" aria-label="${L('制作进度','Build progress')}" aria-valuenow="${(s.buildTick+1)*25}" aria-valuemin="0" aria-valuemax="100"><span style="width:${(s.buildTick+1)*25}%"></span></div>`:''}<hr class="fw-sep"><div class="fw-row fw-small"><span>${L('本次预算上限','This run’s limit')}</span><span>¥120</span></div><div class="fw-row fw-small" style="margin-top:7px"><span>${L('当前可用','Available')}</span><span>${money(available())}</span></div><div class="fw-bottom-action">${s.busy?btn('cancel-build','暂停制作','Pause build','block'):btn('build','生成首版 · 上限 ¥120','Build draft · up to ¥120','primary block',available()<120)}</div>`;}
function quoteContent(){const r=displayRule(),q=calc(r,s.pages,s.days);return `<div class="fw-product-brand"><span class="fw-product-sign"></span>LIGHTBOAT STUDIO</div><h2 class="fw-product-title">${L('你的网站，多少钱？','What will your site cost?')}</h2><p class="fw-small">${L('选好规模和交期，报价即刻算清。','Choose pages and timing. See your price instantly.')}</p><div class="fw-quote-inputs"><div><label class="fw-label" for="fw-pages">${L('网站页数','Website pages')}</label><div class="fw-stepper"><button type="button" data-action="minus-pages" aria-label="${L('减少页数','Fewer pages')}">−</button><input id="fw-pages" type="number" min="1" max="30" step="1" value="${esc(s.pages)}"><span>${L('页','pg')}</span><button type="button" data-action="plus-pages" aria-label="${L('增加页数','More pages')}">+</button></div></div><div><label class="fw-label" for="fw-days">${L('期望交期','Delivery time')}</label><div class="fw-stepper"><button type="button" data-action="minus-days" aria-label="${L('减少天数','Fewer days')}">−</button><input id="fw-days" type="number" min="1" max="60" step="1" value="${esc(s.days)}"><span>${L('天','days')}</span><button type="button" data-action="plus-days" aria-label="${L('增加天数','More days')}">+</button></div></div></div><div id="fw-quote-output">${quoteOutput(q,r)}</div><div class="fw-product-foot"><button type="button" class="fw-rule-chip ${s.panel==='rule'?'active':''} cursor-interaction" data-action="open-rule">${L('报价规则','Pricing rules')} · ${money(r.price)}/${L('页','page')} · &lt;${r.threshold}${L('天加急',' days rush')} ${s.role==='maker'&&!s.submitted&&!s.acceptedDelivery?'↗':''}</button><span>${vname(s.version)}</span></div>`;}
function quoteOutput(q,r){if(!q)return `<div class="fw-quote-sheet"><p class="fw-error" role="alert">${L('页数填 1–30，交期填 1–60 天，均为整数。','Enter 1–30 pages and 1–60 days, using whole numbers.')}</p><div class="fw-quote-total"><span>${L('预计报价','Estimated quote')}</span><span class="fw-total">—</span></div></div>`;const archived=!!s.acceptedDelivery;return `<div class="fw-quote-sheet"><div class="fw-quote-line"><span>${L('页面设计与制作','Page design and build')} <span class="fw-muted">× ${s.pages}</span></span><span>${money(q.base)}</span></div>${archived&&!s.comment?`<div class="fw-quote-line"><span>${L('加急费','Rush fee')}</span><span id="fw-rush-fee">${money(q.fee)}</span></div>`:`<button type="button" class="fw-quote-line fw-fee-button ${s.panel==='feedback'||s.panel==='comment'?'selected':''} cursor-interaction" data-action="${archived?'past-feedback':'annotate'}" aria-label="${archived?L('查看加急费用的反馈记录','View rush fee feedback'):L('在加急费用处留下反馈','Leave feedback on the rush fee')}"><span class="fw-fee-label">${L('加急费','Rush fee')}<span class="fw-comment-pin">${archived?'✓':s.comment&&s.comment.status!=='resolved'?'1':L('反馈','Comment')}</span></span><span id="fw-rush-fee">${money(q.fee)}</span></button>`}<div class="fw-quote-total"><span class="fw-small">${L('预计报价','Estimated quote')}</span><output class="fw-total" id="fw-total" aria-live="polite">${money(q.total)}</output></div></div>`;}
function quoteCanvas(){const replied=s.comment&&s.comment.response&&s.comment.version===s.version;return `<div class="fw-workbar"><div class="fw-switch" aria-label="${L('演示角色','Demo role')}"><button type="button" data-action="role-maker" aria-pressed="${s.role==='maker'}">${L('制作者 · 你','Maker · you')}</button><button type="button" data-action="role-client" aria-pressed="${s.role==='client'}">${L('客户 · 林女士','Client · Lin')}</button></div>${textbtn('history','版本记录','History')}</div>${s.comment&&s.comment.status==='recheck'?`<div class="fw-revision-strip"><span>↳</span>${replied?L('制作者已回复，等待客户确认','Maker replied. Awaiting client confirmation.'):L('已修改规则，等待客户复查','Rules updated. Ready for the client to recheck.')}</div>`:''}<div class="fw-paper"><div class="fw-paper-top"><div class="fw-paper-dots"><span></span><span></span><span></span></div><span>${esc(s.locked.title)}</span><span>${s.acceptedDelivery?L('交付版本','Delivered'):s.submitted?L('待验收版本','In review'):L('可操作预览','Live preview')}</span></div><div class="fw-quote-app" id="fw-product">${quoteContent()}</div></div><div class="fw-statusbar"><span>${L('来源：通用报价模板','Source: starter quote template')}</span><span>${s.acceptedDelivery?L('交付已冻结','Delivery frozen'):s.submitted?L('提交已冻结','Submission frozen'):s.tests&&s.tests.version===s.version?L('本版已检查','This version checked'):L('本版待检查','Checks pending')}</span></div>`;}
function caseList(){const result=s.tests&&s.tests.version===s.version?s.tests.results:null;return `<div class="fw-testlist">${cases().map((c,i)=>{const a=result&&result[i];return `<button type="button" class="fw-test ${s.selectedCase===c.id?'selected':''} cursor-interaction" data-action="case" data-case="${c.id}"><span class="fw-test-name"><span>${L(c.z,c.e)}</span><span class="${a?(a.pass?'fw-test-pass':'fw-test-fail'):'fw-muted'}">${a?(a.pass?'✓':L('不一致','Mismatch')):'○'}</span></span><span class="fw-tiny">${c.pages} ${L('页','pages')} · ${c.days} ${L('天','days')}</span><span class="fw-test-amounts">${a&&!a.pass?`<span class="fw-strike">${money(a.actual)}</span><span>→</span>`:''}<span>${money(c.expected)}</span><span class="fw-tiny">${a&&a.pass?L('符合要求','matches'):L('客户要求','required')}</span></span></button>`;}).join('')}</div>`;}
function defaultPanel(){if(!s.accepted)return contractPanel();if(!s.built)return buildPanel();if(s.acceptedDelivery)return receiptPanel();if(s.submitted)return submissionPanel();if(s.comment&&s.comment.status==='open')return commentPanel();if(s.panel==='recheck'||(s.comment&&s.comment.status==='recheck'))return testsPanel();if(s.stage==='check'||s.tests||s.version>1)return testsPanel();return `<div class="fw-panelhead"><h3>${L('首版可以试了','The first draft is ready')}</h3>${pill(vname(s.version),vname(s.version),'accent')}</div><div class="fw-current-task"><span class="fw-checkmark">✓</span>${L('页数、交期与报价已连接','Inputs now drive the quote')}</div><hr class="fw-sep"><div class="fw-row"><h3>${L('客户要求','Client criteria')}</h3>${pill('R1','R1')}</div>${caseList()}<div class="fw-bottom-action">${btn('try','以客户身份试用','Try as the client','primary block')}${btn('open-rule','调整报价规则','Edit pricing rules','block')}</div>`;}
function testsPanel(){const tested=s.tests&&s.tests.version===s.version,pass=testReady(),fails=tested?s.tests.results.filter(x=>!x.pass).length:0;return `<div class="fw-panelhead"><h3>${L('三个验收案例','Acceptance checks')}</h3>${pill(tested?(pass?'3/3 通过':fails+' 处不一致'):'未运行',tested?(pass?'3/3 pass':fails+' mismatches'):'Not run',tested?(pass?'good':'warn'):'')}</div><div class="fw-small">${L('预期值来自客户要求 R1','Expected values from client criteria R1')}</div>${caseList()}${s.comment&&s.comment.status==='recheck'?`<div class="fw-annotation"><div class="fw-annot-source">${L('待确认的反馈','Feedback to confirm')}</div><p>${esc(s.comment.text)}</p><div class="fw-tiny">${vname(s.comment.version)}${s.comment.version===s.version?'':' → '+vname(s.version)}</div></div>`:''}<div class="fw-bottom-action">${!tested?btn('run-tests',s.testRunning?'正在检查…':'运行 3 个案例',s.testRunning?'Checking…':'Run 3 checks','primary block',s.testRunning):!pass?`${btn('annotate','指出这处问题','Comment on this difference','primary block')}${btn(s.role==='client'?'maker-edit':'open-rule','直接修改规则','Edit the rule','block')}`:s.comment&&s.comment.status==='recheck'?s.role==='client'?btn('resolve-comment','确认反馈已解决','Confirm feedback resolved','primary block'):btn('client-recheck','请客户复查反馈','Recheck as the client','primary block'):s.role==='client'?btn('back-maker','交回制作者提交','Return to maker','primary block'):btn('submit','提交 '+vname(s.version)+' 验收','Submit '+vname(s.version),'primary block',!canSubmit())}${tested?btn('run-tests','重新检查','Run again','quiet block',s.testRunning):''}</div>`;}
function feedbackPanel(){const q=calc(displayRule(),s.pages,s.days),expected=calc(s.locked,s.pages,s.days);return `<div class="fw-panelhead"><h3>${L('对这项费用提意见','Comment on this fee')}</h3>${textbtn('close-panel','×','×','aria-label="'+L('关闭反馈','Close comment')+'"')}</div><div class="fw-annotation"><div class="fw-annot-source">${L('报价明细 / 加急费','Quote / Rush fee')} · ${vname(s.version)}</div><p>${s.pages}${L(' 页',' pages')} · ${s.days}${L(' 天',' days')} · ${q?money(q.fee):'—'}</p></div><label class="fw-label" for="fw-feedback">${L('哪里需要修改？','What needs to change?')}</label><textarea id="fw-feedback" class="fw-textarea" maxlength="280">${esc(feedbackDraft)}</textarea>${q&&expected&&q.total!==expected.total?`<div class="fw-inline-case"><div class="fw-row"><span>${L('客户要求','Required')}</span><span>${money(expected.total)}</span></div><div class="fw-row"><span>${L('当前报价','Current')}</span><span class="fw-test-fail">${money(q.total)}</span></div></div>`:''}<div class="fw-bottom-action">${btn('post-comment','提交修改意见','Send revision request','primary block',!q||!!s.acceptedDelivery)}</div>${alertText?`<p class="fw-error" role="alert">${esc(alertText)}</p>`:''}`;}
function commentPanel(){const c=s.comment;return `<div class="fw-panelhead"><h3>${L('这处需要处理','Feedback to address')}</h3>${pill('待处理','Open','warn')}</div><div class="fw-person" style="margin-bottom:10px"><span class="fw-avatar">${L('林','L')}</span><span class="fw-small">${L('客户 · 演示反馈','Client · demo feedback')}</span></div><div class="fw-annotation"><div class="fw-annot-source">${L('加急费','Rush fee')} · ${vname(c.version)}</div><p>${esc(c.text)}</p><div class="fw-tiny">${c.inputs.pages}${L(' 页',' pages')} / ${c.inputs.days}${L(' 天',' days')} · ${money(c.snapshot.total)}</div></div><div class="fw-current-task"><span class="fw-pending-dot"></span>${L('处理这条客户反馈','Address this client feedback')}</div><div class="fw-bottom-action">${s.role==='maker'?btn('open-rule','定位并修改规则','Locate and edit rule','primary block'):btn('handle-feedback','切换为制作者 · 处理反馈','Switch to maker · revise','primary block')}${btn('reply','回复说明','Reply with an explanation','quiet block')}</div>`;}
function replyPanel(){return `<div class="fw-panelhead"><h3>${L('回复这条反馈','Reply to this feedback')}</h3>${textbtn('close-panel','×','×','aria-label="'+L('关闭回复','Close reply')+'"')}</div><div class="fw-annotation"><div class="fw-annot-source">${L('客户反馈','Client feedback')}</div><p>${esc(s.comment.text)}</p></div><label class="fw-label" for="fw-response">${L('说明计算依据或处理方式','Explain the calculation or resolution')}</label><textarea id="fw-response" class="fw-textarea" maxlength="350">${esc(responseDraft)}</textarea><div class="fw-bottom-action">${btn('send-reply','发回客户确认','Send for client confirmation','primary block')}</div>${alertText?`<p class="fw-error" role="alert">${esc(alertText)}</p>`:''}`;}
function rulePanel(){const r=draft||displayRule(),frozen=!!s.submitted||!!s.acceptedDelivery;const editable=s.role==='maker'&&!frozen;const expected=s.locked;return `<div class="fw-panelhead"><h3>${L('报价规则','Pricing rule')}</h3>${textbtn('close-panel','×','×','aria-label="'+L('关闭规则编辑','Close rules')+'"')}</div>${s.comment?`<div class="fw-annotation"><div class="fw-annot-source">${L('来自这条反馈','Linked feedback')}</div><p>${esc(s.comment.text)}</p></div>`:''}<div class="fw-fieldgroup"><div>${field(L('每页价格 · 元','Price per page · CNY'),'fw-rule-price',r.price,'number',`min="100" max="10000" step="1" ${!editable?'readonly':''}`)}</div><div>${field(L('交期少于几天时加急','Rush when delivery is below'),'fw-rule-threshold',r.threshold,'number',`min="1" max="50" step="1" ${!editable?'readonly':''}`)}<div class="fw-tiny" style="margin-top:5px">${L('客户要求','Client requires')} &lt; ${expected.threshold} ${L('天','days')}</div></div><div>${field(L('加急加收 · %','Rush surcharge · %'),'fw-rule-rate',r.rate,'number',`min="1" max="100" step="1" ${!editable?'readonly':''}`)}</div></div><div id="fw-rule-diff">${ruleDiff(r)}</div><div class="fw-bottom-action">${editable?btn('apply-rule','应用修改','Apply changes','primary block'):s.acceptedDelivery?pill('已验收版本只读','Accepted version is read-only','good'):s.submitted?btn('withdraw','撤回提交并编辑','Withdraw and edit','block'):btn('maker-edit','切换为制作者修改','Switch to maker to edit','primary block')}</div>${alertText?`<p class="fw-error" role="alert">${esc(alertText)}</p>`:''}`;}
function ruleDiff(r){const before=calc(displayRule(),s.pages,s.days),after=calc(r,s.pages,s.days);return `<div class="fw-inline-case"><span class="fw-tiny">${s.pages} ${L('页','pages')} · ${s.days} ${L('天','days')}</span><div class="fw-diff"><span>${before?money(before.total):'—'}</span><span>→</span><span class="fw-diff-new">${after?money(after.total):'—'}</span></div></div>`;}
function submissionPanel(){const client=s.role==='client';return `<div class="fw-panelhead"><h3>${L('交付验收','Review delivery')}</h3>${pill(vname(s.submitted.version),vname(s.submitted.version),'accent')}</div><ul class="fw-checklist"><li><span class="fw-checkmark">✓</span>${L('可运行报价器已冻结','Working tool frozen')}</li><li><span class="fw-checkmark">✓</span>${L('3 个固定案例通过','3 frozen cases pass')}</li><li><span class="fw-checkmark">✓</span>${L(s.comment?'反馈已修订并确认':'没有待处理反馈',s.comment?'Revision confirmed':'No open feedback')}</li></ul><hr class="fw-sep"><div class="fw-row fw-small"><span>${L('本次验收后应付','Payable on acceptance')}</span><strong>¥600</strong></div><div class="fw-tiny" style="margin-top:6px">${L('7 天内到期 · 演示约定','Due in 7 days · demo agreement')}</div><div class="fw-bottom-action">${client?`${btn('accept-delivery','验收 · 形成 ¥600 应付','Accept · create ¥600 payable','primary block')}${btn('return-delivery','退回修改','Request a revision','block')}`:`${btn('review-as-client','以客户身份验收','Review as the client','primary block')}${btn('withdraw','撤回并继续编辑','Withdraw to edit','quiet block')}`}</div>`;}
function receiptPanel(){const p=s.payable;return `<div class="fw-receipt-seal">✓</div><h3>${L('客户已验收','Accepted by client')}</h3><div class="fw-small" style="margin-top:4px">${vname(s.acceptedDelivery.version)} · ${L('演示验收','Demo acceptance')}</div><hr class="fw-sep"><div class="fw-small">${L('协作者应付','Collaborator payable')}</div><div class="fw-receipt-money">¥600</div><div class="fw-row fw-tiny"><span>${new Date(p.dueAt).toLocaleDateString(s.lang==='zh'?'zh-CN':'en-US',{month:'short',day:'numeric'})} ${L('到期','due')}</span>${pill(p&&(p.status==='PAYABLE'||p.status==='unpaid')?'尚未支付':'尚未支付',p&&(p.status==='PAYABLE'||p.status==='unpaid')?'Unpaid':'Unpaid','warn')}</div><div class="fw-bottom-action">${btn('download','下载交付包','Download delivery','primary block')}${btn('asset','保存为团队资产','Save as a team asset','block')}</div><hr class="fw-sep"><button type="button" data-action="pilot" class="fw-list-action cursor-interaction"><span>${L('下一轮：5 家团队付费试点','Next: paid pilot with 5 teams')}</span><span>↗</span></button>`;}
function specialPanel(){if(s.panel==='feedback')return feedbackPanel();if(s.panel==='comment'&&s.comment)return commentPanel();if(s.panel==='rule')return rulePanel();if(s.panel==='recheck')return testsPanel();if(s.panel==='budget')return `<div class="fw-panelhead"><h3>${L('本项目预算','Project budget')}</h3>${textbtn('close-panel','×','×','aria-label="'+L('关闭预算','Close budget')+'"')}</div><div class="fw-stack">${[[L('项目上限','Project limit'),money(s.budget.total)],[L('制作费用','Build expense'),money(s.budget.spent)],[L('运行预留','Run reservation'),money(s.budget.reserved)],[L(s.payable?'合同应付':'委托承诺',s.payable?'Contract payable':'Contract commitment'),money(obligation())],[L('已支付报酬','Fee paid'),'¥0']].map(x=>`<div class="fw-row fw-small"><span>${x[0]}</span><span>${x[1]}</span></div>`).join('')}</div><hr class="fw-sep"><div class="fw-row"><span>${L('可用余额','Available')}</span><span class="fw-money">${money(available())}</span></div>${s.built?`<div class="fw-tiny" style="margin-top:15px">${L('本次预留 ¥120，发生 ¥96，释放 ¥24。','Run reserved ¥120, used ¥96, released ¥24.')}</div>`:''}`;
if(s.panel==='terms')return `<div class="fw-panelhead"><h3>${L('制作约定','Delivery agreement')}</h3>${textbtn('close-panel','×','×','aria-label="'+L('关闭约定','Close agreement')+'"')}</div><div class="fw-stack"><div><div class="fw-label">${L('交付内容','Deliverables')}</div><p style="font-size:12px">${L('可运行报价器、三个验收案例、一轮修订及交付记录。','A working quote tool, three acceptance cases, one revision round and delivery records.')}</p></div><div><div class="fw-label">${L('报酬与验收','Fee and acceptance')}</div><p style="font-size:12px">${L('固定 ¥600，由客户按冻结要求验收，验收后 7 天到期。','Fixed ¥600. Client reviews against frozen requirements; payment is due 7 days after acceptance.')}</p></div><div><div class="fw-label">${L('使用范围','Usage')}</div><p style="font-size:12px">${L('本演示允许团队复用报价器代码；客户原话与反馈仅限项目内。','This demo permits team reuse of the tool code. Client wording and feedback stay within the project.')}</p></div><div><div class="fw-label">${L('未达预期时','If expectations are not met')}</div><p style="font-size:12px">${L('未通过交付案例，退回修订。后续市场试点失败，不撤销已合格交付的固定报酬。','Failed delivery checks return for revision. A later negative market pilot does not cancel the fee for accepted work.')}</p></div></div><div class="fw-bottom-action">${btn('close-panel','回到当前工作','Back to work','block')}</div>`;
if(s.panel==='history')return `<div class="fw-panelhead"><h3>${L('版本与工作记录','Versions and history')}</h3>${textbtn('close-panel','×','×','aria-label="'+L('关闭历史','Close history')+'"')}</div>${s.versions.slice().reverse().map(v=>`<button type="button" class="fw-version-link cursor-interaction" data-action="version-detail" data-version="${v.version}"><span>${vname(v.version)} · ${L(v.type==='template'?'通用模板首版':'规则修订',v.type==='template'?'Starter template':'Rule revision')}</span><span>↗</span></button>`).join('')}<hr class="fw-sep"><ol class="fw-history">${s.history.length?s.history.slice().reverse().map(h=>`<li>${esc(L(h.z,h.e))}<small>${h.version?vname(h.version)+' · ':''}${new Date(h.at).toLocaleTimeString(s.lang==='zh'?'zh-CN':'en-US',{hour:'2-digit',minute:'2-digit'})}</small></li>`).join(''):`<li>${L('等待接下这份委托','Waiting for the job to be accepted')}</li>`}</ol>`;
if(s.panel==='version'){const v=s.versions.find(x=>x.version===s.previewVersion);if(v)return `<div class="fw-panelhead"><h3>${L('历史版本','Historical version')} ${vname(v.version)}</h3>${textbtn('history','返回','Back')}</div><div class="fw-small">${money(v.rule.price)}/${L('页','page')} · &lt;${v.rule.threshold}${L('天加急',' days rush')} · ${v.rule.rate}%</div><div class="fw-testlist">${cases().map(c=>{const q=calc(v.rule,c.pages,c.days);return `<div class="fw-test"><span>${c.pages}${L('页',' pages')} / ${c.days}${L('天',' days')}</span><span class="fw-test-amounts"><span>${money(q.total)}</span><span class="fw-tiny">${L('当时的报价','Historical quote')}</span></span></div>`;}).join('')}</div><div class="fw-tiny" style="margin-top:14px">${L('当前工作版本仍为','Current working version remains')} ${vname(s.version)}</div>`;}
if(s.panel==='past-feedback')return `<div class="fw-panelhead"><h3>${L('反馈记录','Feedback record')}</h3>${textbtn('close-panel','×','×','aria-label="'+L('关闭反馈记录','Close feedback record')+'"')}</div>${s.comment?`<div class="fw-annotation"><div class="fw-annot-source">${vname(s.comment.version)} · ${L('加急费','Rush fee')}</div><p>${esc(s.comment.text)}</p></div>${pill('已确认解决','Confirmed resolved','good')}<div class="fw-small" style="margin-top:12px">${vname(s.comment.resolvedVersion||s.version)} · ${L('客户复查确认','Confirmed by client')}</div>`:`<div class="fw-small">${L('无反馈记录','No feedback recorded')}</div>`}`;
if(s.panel==='demo')return `<div class="fw-panelhead"><h3>${L('本地演示','Local demo')}</h3>${textbtn('close-panel','×','×','aria-label="'+L('关闭演示设置','Close demo settings')+'"')}</div><div class="fw-stack"><div class="fw-small">${L('模板与角色为预置演示；报价计算、编辑和下载实际运行。','Templates and roles are simulated; calculations, editing and exports work locally.')}</div><div class="fw-small">${L('未连接模型、付款或外部消息服务。','No model, payment or messaging service is connected.')}</div></div><div class="fw-bottom-action">${btn('restart','重新开始这次委托','Restart this demo','block')}</div>`;
if(s.panel==='pilot')return `<div class="fw-panelhead"><h3>${L('下一轮付费试点','Next paid pilot')}</h3>${textbtn('close-panel','×','×','aria-label="'+L('关闭试点','Close pilot')+'"')}</div><div class="fw-small">${L('5 家团队 · 14 天 · ¥500 / 家','5 teams · 14 days · ¥500 per team')}</div>${['A','B','C','D','E'].map((n,i)=>`<div class="fw-observation"><span>0${i+1}</span><span>${L('目标团队','Target team')} ${n}</span>${pill('待招募','Not recruited')}</div>`).join('')}<div class="fw-row fw-small" style="margin-top:17px"><span>${L('真实付款凭据','Real payment records')}</span><strong>0</strong></div><div class="fw-tiny" style="margin-top:9px">${L('工具验收通过，需求与付费意愿仍待验证。','The tool is accepted. Demand and willingness to pay remain untested.')}</div><div class="fw-bottom-action">${btn('download-pilot','下载试点邀请稿','Download pilot invitation','block')}</div>`;
if(s.panel==='asset')return `<div class="fw-panelhead"><h3>${L('保存团队资产','Save a team asset')}</h3>${textbtn('close-panel','×','×','aria-label="'+L('关闭资产','Close asset')+'"')}</div><div class="fw-attachment"><span class="fw-file">HTML</span><div><strong>${esc(s.locked.title)} ${vname(s.version)}</strong><small>${L('可运行代码 · 可在团队内复用','Working code · team reuse permitted')}</small></div></div><div class="fw-small">${L('接收范围：轻舟设计团队','Shared with: Lightboat design team')}</div><div class="fw-tiny" style="margin-top:12px">${L('客户简报、反馈与应付记录留在本项目。','Client brief, feedback and payable records remain in this project.')}</div><div class="fw-bottom-action">${s.asset?pill('已保存到团队资产','Saved to team assets','good'):btn('save-asset','保存到轻舟设计团队','Save to Lightboat team','primary block')}</div>`;
return defaultPanel();}
function render(){root.lang=s.lang==='zh'?'zh-CN':'en';let canvas=s.stage==='brief'?briefCanvas():s.built?quoteCanvas():emptyCanvas();shell.innerHTML=`${header()}${workhead()}<div class="fw-bench"><main class="fw-canvas">${canvas}</main><aside class="fw-inspector" aria-label="${L('当前工作','Current work')}">${s.panel==='reply'?replyPanel():specialPanel()}</aside></div>${s.toast?`<div class="fw-toast" role="status"><span>${esc(s.toast)}</span><button type="button" data-action="dismiss-toast" aria-label="${L('关闭消息','Dismiss message')}">×</button></div>`:''}${!storageOK?`<div class="fw-storage-note">${L('当前环境不保留进度；请下载交付文件。','This environment does not retain progress. Download your delivery.')}</div>`:''}<footer class="fw-footer"><span>${L('任务归属：轻舟项目','Task belongs to: Lightboat project')} ${s.accepted?'· T-01':''}</span><div class="fw-footer-links">${textbtn('brief','客户要求','Client criteria')}${textbtn('terms','约定','Agreement')}${textbtn('budget','预算','Budget')}${textbtn('pilot','后续试点','Next pilot')}</div></footer>`;if(s.comment&&s.comment.status==='recheck'&&s.comment.response){const a=shell.querySelector('.fw-inspector .fw-annotation');if(a)a.insertAdjacentHTML('beforeend',`<div class="fw-annot-source" style="margin-top:12px">${L('制作者回复','Maker’s reply')}</div><p>${esc(s.comment.response)}</p>`);}save();}
function returnDefault(){s.panel='default';draft=null;alertText='';}
function openRule(){if(!s.built)return;s.panel='rule';draft=copy(displayRule());alertText='';render();if(s.role==='maker'&&!s.submitted&&!s.acceptedDelivery){const input=root.querySelector('#fw-rule-threshold');if(input){input.focus();input.select();}}}
function validRule(r){return Number.isInteger(r.price)&&r.price>=100&&r.price<=10000&&Number.isInteger(r.threshold)&&r.threshold>=1&&r.threshold<=50&&Number.isInteger(r.rate)&&r.rate>=1&&r.rate<=100;}


  const intentId = options.intentId || WORKBENCH_INTENT_ID;
  const api = options.api;
  if (typeof options.lang === 'string') s.lang = options.lang;

  function applyView(view) {
    s = view.state;
    s.feedbackHistory = s.feedbackHistory || [];
    s.checks = s.checks || [];
    s.demo = s.demo !== false;
    render();
  }

  async function pull() {
    const view = await api('GET', `/v1/forge/intents/${encodeURIComponent(intentId)}/workbench`);
    applyView(view);
    return view;
  }

  async function post(suffix, body = {}) {
    const view = await api('POST', `/v1/forge/intents/${encodeURIComponent(intentId)}/workbench${suffix}`, body);
    applyView(view);
    return view;
  }

  async function patchState(body) {
    const view = await api('PATCH', `/v1/forge/intents/${encodeURIComponent(intentId)}/workbench`, body);
    applyView(view);
    return view;
  }

  async function startBuild() {
    if (s.busy || s.built || !s.accepted) return;
    await post('/build', { action: 'start' });
    if (timer) clearInterval(timer);
    timer = setInterval(async () => {
      if (!s.busy) { clearInterval(timer); timer = null; return; }
      try {
        await post('/build', { action: 'tick' });
        if (s.built && timer) { clearInterval(timer); timer = null; }
      } catch (err) {
        if (timer) { clearInterval(timer); timer = null; }
        options.onError?.(err);
      }
    }, 450);
  }

  async function runTests() {
    if (!s.built || s.testRunning) return;
    s.testRunning = true;
    render();
    try {
      await post('/run-checks', {});
    } catch (err) {
      s.testRunning = false;
      options.onError?.(err);
      render();
    }
  }

  async function downloadDelivery() {
    if (!s.acceptedDelivery) return;
    const res = await fetch(`/v1/forge/intents/${encodeURIComponent(intentId)}/workbench/delivery.zip`, {
      headers: options.headers?.() || {},
    });
    if (!res.ok) throw new Error('WORKBENCH_ZIP_FAILED');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lightboat-delivery-v0.${s.version}.zip`;
    root.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    announce(L('已生成包含报价器和交付记录的下载文件。', 'Delivery download contains the quote tool and records.'));
  }

  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'fw-pages' || el.id === 'fw-days') {
      const key = el.id === 'fw-pages' ? 'pages' : 'days';
      s[key] = el.value === '' ? null : Number(el.value);
      s.selectedCase = '';
      const out = root.querySelector('#fw-quote-output');
      if (out) out.innerHTML = quoteOutput(calc(displayRule(), s.pages, s.days), displayRule());
      if (draft && root.querySelector('#fw-rule-diff')) root.querySelector('#fw-rule-diff').innerHTML = ruleDiff(draft);
    }
    if (el.id === 'fw-feedback') feedbackDraft = el.value;
    if (el.id === 'fw-response') responseDraft = el.value;
    if (el.id.startsWith('fw-rule-') && draft) {
      draft[el.id.replace('fw-rule-', '')] = el.value === '' ? null : Number(el.value);
      const diff = root.querySelector('#fw-rule-diff');
      if (diff) diff.innerHTML = ruleDiff(draft);
    }
    if (el.id.startsWith('fw-brief-') && !s.accepted) {
      const key = el.id.replace('fw-brief-', '');
      s.req[key] = key === 'title' ? el.value : Number(el.value);
    }
  });

  root.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.id === 'fw-pages' || el.id === 'fw-days') {
      try {
        await patchState({
          pages: Number.isInteger(s.pages) ? s.pages : 3,
          days: Number.isInteger(s.days) ? s.days : 10,
          selectedCase: '',
        });
      } catch (err) { options.onError?.(err); }
    }
    if (el.id.startsWith('fw-brief-') && !s.accepted) {
      try { await patchState({ req: { ...s.req } }); } catch (err) { options.onError?.(err); }
    }
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b || !root.contains(b) || b.disabled) return;
    const a = b.dataset.action;
    alertText = '';
    try {
      if (a === 'lang') {
        await patchState({ lang: s.lang === 'zh' ? 'en' : 'zh' });
        options.onLang?.(s.lang);
        return;
      }
      if (a === 'dismiss-toast') { await patchState({ toast: '' }); return; }
      if (a === 'stage') {
        await patchState({ stage: b.dataset.stage });
        return;
      }
      if (['terms', 'budget', 'history', 'demo', 'pilot'].includes(a)) {
        await patchState({ panel: s.panel === a ? 'default' : a });
        return;
      }
      if (a === 'close-panel') { await patchState({ panel: 'default' }); return; }
      if (a === 'restart') {
        if (timer) { clearInterval(timer); timer = null; }
        await post('/reset', {});
        return;
      }
      if (a === 'version-detail') {
        await patchState({ panel: 'version', previewVersion: Number(b.dataset.version) });
        return;
      }
      if (a === 'past-feedback') { await patchState({ panel: 'past-feedback' }); return; }
      if (a === 'brief') { await patchState({ stage: 'brief', panel: 'default' }); return; }
      if (a === 'return-work') {
        await patchState({
          stage: s.submitted || s.acceptedDelivery ? 'deliver' : 'craft',
          panel: 'default',
        });
        return;
      }
      if (a === 'accept-contract') {
        if (!s.req.title.trim() || s.req.title.length > 30 || !validRule({ ...s.req, threshold: s.req.threshold }) || s.req.threshold < 3 || s.req.threshold > 25) {
          alertText = L('名称必填；每页 100–10000 元；加急 3–25 天；比例 1–100%。', 'Add a name; price 100–10000; rush 3–25 days; surcharge 1–100%.');
          render();
          return;
        }
        await patchState({ req: { ...s.req } });
        await post('/accept', {});
        return;
      }
      if (a === 'build') { await startBuild(); return; }
      if (a === 'cancel-build') {
        if (!s.busy) return;
        if (timer) { clearInterval(timer); timer = null; }
        await post('/build', { action: 'pause' });
        return;
      }
      if (a === 'try' || a === 'role-client' || a === 'client-recheck') {
        if (!s.built) return;
        await patchState({
          role: 'client',
          stage: (!s.submitted && !s.acceptedDelivery) ? 'check' : s.stage,
          panel: 'default',
        });
        return;
      }
      if (a === 'role-maker' || a === 'back-maker' || a === 'handle-feedback') {
        if (!s.built) return;
        await patchState({
          role: 'maker',
          stage: (!s.submitted && !s.acceptedDelivery) ? 'craft' : s.stage,
          panel: a === 'handle-feedback' ? 'rule' : 'default',
        });
        if (a === 'handle-feedback') {
          draft = copy(displayRule());
          render();
          const input = root.querySelector('#fw-rule-threshold');
          if (input) { input.focus(); input.select(); }
        }
        return;
      }
      if (a === 'case') {
        const c = cases().find((x) => x.id === b.dataset.case);
        if (c) await patchState({ selectedCase: c.id, pages: c.pages, days: c.days });
        return;
      }
      if (a === 'run-tests') { await runTests(); return; }
      if (a === 'open-rule' || a === 'maker-edit') {
        if (!s.built) return;
        draft = copy(displayRule());
        await patchState({
          role: 'maker',
          stage: 'craft',
          panel: 'rule',
        });
        const input = root.querySelector('#fw-rule-threshold');
        if (input) { input.focus(); input.select(); }
        return;
      }
      if (a.startsWith('minus-') || a.startsWith('plus-')) {
        const key = a.split('-')[1];
        const max = key === 'pages' ? 30 : 60;
        const next = Math.max(1, Math.min(max, (Number(s[key]) || 1) + (a.startsWith('plus') ? 1 : -1)));
        await patchState({ [key]: next, selectedCase: '' });
        return;
      }
      if (a === 'annotate') {
        if (!s.built) return;
        if (s.acceptedDelivery) {
          note('这份交付已经冻结，可查看版本记录。', 'This delivery is frozen. See version history.');
          render();
          return;
        }
        if (s.comment && s.comment.status === 'open' && !s.submitted) {
          await patchState({ panel: 'comment' });
          return;
        }
        const q = calc(displayRule(), s.pages, s.days);
        const exp = calc(s.locked, s.pages, s.days);
        feedbackDraft = q && exp && q.total !== exp.total
          ? L(`${s.days} 天交付不应收这笔加急费。`, `${s.days}-day delivery should not include this rush fee.`)
          : '';
        await patchState({ panel: 'feedback' });
        const input = root.querySelector('#fw-feedback');
        if (input) input.focus();
        return;
      }
      if (a === 'return-delivery') {
        feedbackDraft = '';
        await patchState({ panel: 'feedback' });
        return;
      }
      if (a === 'post-comment') {
        if (!feedbackDraft.trim()) {
          alertText = L('写下这处需要怎么改。', 'Describe the change you need.');
          render();
          return;
        }
        await post('/feedback', { text: feedbackDraft.trim() });
        feedbackDraft = '';
        return;
      }
      if (a === 'apply-rule') {
        if (!draft) return;
        if (!validRule(draft)) {
          alertText = L('价格、天数和比例须为范围内整数。', 'Use whole numbers within the allowed ranges.');
          render();
          return;
        }
        await post('/rules', { price: draft.price, threshold: draft.threshold, rate: draft.rate });
        draft = null;
        return;
      }
      if (a === 'reply') {
        if (!s.comment || s.comment.status !== 'open') return;
        responseDraft = s.comment.response || '';
        await patchState({ role: 'maker', stage: 'craft', panel: 'reply' });
        const input = root.querySelector('#fw-response');
        if (input) input.focus();
        return;
      }
      if (a === 'send-reply') {
        if (!responseDraft.trim()) {
          alertText = L('写下对这条反馈的回复。', 'Write a reply to the feedback.');
          render();
          return;
        }
        await post('/reply', { response: responseDraft.trim() });
        responseDraft = '';
        return;
      }
      if (a === 'resolve-comment') {
        await post('/resolve-feedback', {});
        return;
      }
      if (a === 'submit') {
        await post('/submit', {});
        return;
      }
      if (a === 'review-as-client') {
        if (!s.submitted) return;
        await patchState({ role: 'client', panel: 'default' });
        return;
      }
      if (a === 'withdraw') {
        await post('/withdraw', {});
        return;
      }
      if (a === 'accept-delivery') {
        await post('/accept-delivery', {});
        return;
      }
      if (a === 'asset') { await patchState({ panel: 'asset' }); return; }
      if (a === 'save-asset') { await post('/register-asset', {}); return; }
      if (a === 'download') { await downloadDelivery(); return; }
      if (a === 'download-pilot') {
        const title = s.locked ? s.locked.title : s.req.title;
        const t = `${title} · 两周付费试点邀请稿\n\n演示草稿，尚未发送。\n`;
        const blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const aEl = document.createElement('a');
        aEl.href = url;
        aEl.download = 'lightboat-pilot-invitation.txt';
        root.appendChild(aEl);
        aEl.click();
        aEl.remove();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        return;
      }
    } catch (err) {
      options.onError?.(err);
      const msg = err?.message || String(err);
      s.toast = s.lang === 'zh' ? `操作未完成：${msg}` : `Action failed: ${msg}`;
      render();
    }
  });

  if (typeof options.ensure === 'function') await options.ensure();
  await pull();
  if (options.lang && s.lang !== options.lang) {
    try { await patchState({ lang: options.lang }); } catch (_) { /* keep server lang */ }
  }

  return {
    destroy() {
      if (timer) clearInterval(timer);
      host.innerHTML = '';
    },
    refresh: pull,
    getState: () => JSON.parse(JSON.stringify(s)),
  };
}
