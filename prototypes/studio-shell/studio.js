const groups = [
 {name:'内容发现',icon:'<circle cx="12" cy="12" r="8"/><path d="m16 8-3 5-5 3 3-5z"/>',modules:[['热点雷达','发现值得表达的事','从信息到灵感，让下一个好内容在这里发生。','新建采集'],['视频热榜','看见正在发生的趋势','跟踪账号与热门作品，为创作积累真实参考。','添加账号']]},
 {name:'素材管理',icon:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18M8 5V3"/>',modules:[['账号库','每个好作品，都有迹可循','集中管理参考账号、作品与转写内容。','添加账号'],['项目工作台','把零散资料，整理成方向','围绕项目组织素材，沉淀可复用的风格。','新建项目']]},
 {name:'内容创作',icon:'<path d="m4 16 11-11 4 4-11 11H4zM13 7l4 4"/>',modules:[['对话写作','给想法一个完整表达','左侧准备任务，右侧专注内容。','新建草稿'],['生图工作台','让想象，有迹可见','参考、提示词与画布，组成一次完整创作。','新建画布'],['评论生成','让内容，产生更多对话','准备素材与生成参数，集中整理互动结果。','新建任务']]},
 {name:'数据运营',icon:'<path d="M4 20V10m8 10V4m8 16v-7"/>',modules:[['数据维护','让每一项数据都清晰','输入、核对与计算，在一个工作区完成。','导入数据'],['数据监控','关注每一次关键变化','对比目标与当前表现，定位值得关注的变化。','添加监控']]},
 {name:'工作区设置',icon:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',modules:[['AI 模型配置','让工具，适合你的工作方式','按创作环节组织模型与服务配置。','保存配置'],['工具台','简单的工具，顺手的工作','视频、文档与发布工具，随取随用。','打开工具']]}
];
const stories=[
 {title:'一款小体量独立游戏，为什么能成为本周讨论焦点？',category:'游戏观察',source:'行业资讯',time:'10:24',priority:'重点关注',summary:'玩家的自发分享正在推动话题扩散。相比规模与预算，独特体验和清晰表达可能更值得关注。',angle:'从“玩家为什么愿意主动分享”切入，拆解三个具体体验，而不是重复热度数据。'},
 {title:'从新作预告看，今年的内容审美正在怎样变化',category:'行业动态',source:'公开资讯',time:'09:48',priority:'持续观察',summary:'几支新预告呈现出相似的表达倾向：更简洁的画面、更直接的情绪，以及更鲜明的个人风格。',angle:'并列分析三种视觉表达，以具体镜头解释变化。'},
 {title:'社区里的一个小建议，如何改变产品的更新方向',category:'社区声音',source:'社区观察',time:'09:16',priority:'重点关注',summary:'开发者和用户之间的有效沟通，往往从一个足够具体的问题开始。',angle:'用问题、反馈、改进三个阶段讲清楚一次有效沟通。'},
 {title:'内容创作者开始重新重视“慢一点”的作品',category:'创作趋势',source:'编辑精选',time:'昨天',priority:'持续观察',summary:'更长的制作周期不一定意味着更多内容，也可能意味着一次更完整的表达。',angle:'讨论制作投入与观众感受之间的关系，避免只比较视频长度。'}
];
const $=id=>document.getElementById(id);let groupIndex=0,moduleIndex=0,selected=0,tab='全部内容',cards=false;let menuCloseTimer;let menuGroup=null;let toastTimer;const drafts=new Map();
const moduleRoutes = [['hotspots','hotlist'],['library','projects'],['writer','images','comments'],['data','monitor'],['settings','tools']];
function readRoute(){
 groupIndex=0;moduleIndex=0;
 const route=new URLSearchParams(location.search).get('module');
 for(let g=0;g<moduleRoutes.length;g++){const m=moduleRoutes[g].indexOf(route);if(m>=0){groupIndex=g;moduleIndex=m;break}}
 tab='全部内容';
}
function saveRoute(){const url=new URL(location.href);url.searchParams.set('module',moduleRoutes[groupIndex][moduleIndex]);if(url.href!==location.href)history.pushState(null,'',url);}
readRoute();
window.addEventListener('popstate',()=>{readRoute();$('content-search').value='';$('priority').value='all';openMenu(false);render()});
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3000)}
function renderNav(){ $('rail-links').innerHTML=groups.map((g,i)=>`<button class="workspace-tab ${i===groupIndex?'active':''}" aria-label="${g.name}" title="${g.name}" aria-pressed="${i===groupIndex}" aria-controls="module-menu" aria-expanded="${!$('module-menu').hidden&&menuGroup===i}" data-group="${i}">${g.name}<span>⌄</span></button>`).join('');const query=$('search').value.trim();$('modules').innerHTML=groups.flatMap((g,gi)=>g.modules.map((m,mi)=>({m,gi,mi}))).filter(x=>(menuGroup===null||x.gi===menuGroup)&&x.m[0].includes(query)).map(({m,gi,mi})=>`<button class="module ${gi===groupIndex&&mi===moduleIndex?'active':''}" data-module="${gi},${mi}"><span class="module-symbol">${['◈','▤','✎','▥','⚙'][gi]}</span><span>${m[0]}<small>${groups[gi].name}</small></span><span class="module-arrow">↗</span></button>`).join('')||'<p class="empty">没有匹配模块</p>'; }
function render(){renderNav();document.querySelector('.page').getAnimations?.().forEach(animation=>animation.cancel());if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)document.querySelector('.page').animate?.([{opacity:.5,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});const g=groups[groupIndex],m=g.modules[moduleIndex];$('crumb-group').textContent=g.name;$('crumb-module').textContent=m[0];$('eyebrow').textContent=['DISCOVER','COLLECTION','CREATE','ANALYTICS','PREFERENCES'][groupIndex]+' / 0'+(moduleIndex+1);$('title').textContent=m[1];$('description').textContent=m[2];$('main-action').textContent='＋ '+m[3];document.title=m[0]+' · Studio 预览';const tabs=groupIndex===0?['全部内容','重点关注','持续观察']:groupIndex===2?['工作区','历史记录']:groupIndex===4?['工作区']:['全部内容'];if(!tabs.includes(tab))tab=tabs[0];$('tabs').innerHTML=tabs.map(t=>`<button class="${tab===t?'active':''}" data-tab="${t}">${t}${t==='全部内容'?'<small>4</small>':''}</button>`).join('');renderContent();}
function renderContent(){const q=$('content-search').value.trim();const items=stories.map((s,i)=>({...s,i})).filter(s=>(!q||s.title.includes(q))&&($('priority').value==='all'||s.priority===$('priority').value)&&(tab!=='重点关注'&&tab!=='持续观察'||s.priority===tab));$('count').textContent=items.length+' 条示例';document.querySelector('.toolbar').hidden=groupIndex!==0;document.querySelector('.content-frame').classList.toggle('module-frame',groupIndex!==0);if(groupIndex!==0)$('filter-panel').hidden=true;$('content-list').parentElement.classList.toggle('cards',cards&&groupIndex===0&&moduleIndex===0);
 if(renderModuleSkeleton())return;
 if(!items.some(s=>s.i===selected)&&items.length)selected=items[0].i;
 $('content-list').innerHTML='<div class="list-label"><span>'+(groupIndex===0?'内容 / 来源':'项目 / 内容')+'</span><span>最近更新 ↓</span></div>'+items.map(s=>`<button class="story ${s.i===selected?'selected':''}" data-story="${s.i}" aria-pressed="${s.i===selected}"><span class="story-number">0${s.i+1}</span><div class="story-copy"><div class="story-meta"><span class="category">${s.category}</span><span>${s.source}</span></div><h3>${groupIndex===0?s.title:groups[groupIndex].modules[moduleIndex][0]+' · 示例项目 '+(s.i+1)}</h3><p>${s.summary}</p><div class="story-foot"><span>${s.time}</span><span>·</span><span>${s.priority}</span></div></div><span class="story-arrow">↗</span></button>`).join('')+(items.length?'':'<div class="empty">没有匹配内容，试试清除筛选。</div>');if(!items.some(s=>s.i===selected)&&items.length)selected=items[0].i;const s=stories[selected];$('inspector').innerHTML=items.length?`<div class="inspector-top"><span>DETAIL / 内容预览</span><span>↗</span></div><div class="preview-art"><span>IDEAS IN MOTION</span></div><span class="category">${s.category}</span><h2>${s.title}</h2><p>${s.summary}</p><div class="detail-label">创作切入点</div><div class="angle">${s.angle}</div><button class="primary" id="write">送入写作工作区 →</button>`:'<div class="empty">选择一项内容查看详情</div>';if($('write'))$('write').onclick=()=>{drafts.set('对话写作',s.title+'\n\n'+s.angle);groupIndex=2;moduleIndex=0;tab='工作区';saveRoute();render();};}
document.addEventListener('click',e=>{const g=e.target.closest('[data-group]'),m=e.target.closest('[data-module]'),s=e.target.closest('[data-story]'),t=e.target.closest('[data-tab]');if(g){menuGroup=Number(g.dataset.group);$('search').value='';renderNav();openMenu(true);document.querySelector(`[data-module="${Number(g.dataset.group)},0"]`)?.focus()}if(m){[groupIndex,moduleIndex]=m.dataset.module.split(',').map(Number);tab='全部内容';$('content-search').value='';$('priority').value='all';openMenu(false);saveRoute();render();$('title').focus()}if(s){selected=Number(s.dataset.story);renderContent()}if(t){tab=t.dataset.tab;render()}});
$('search').oninput=renderNav;$('content-search').oninput=renderContent;$('priority').onchange=renderContent;$('filter').onclick=()=>{$('filter-panel').hidden=!$('filter-panel').hidden;$('filter').setAttribute('aria-expanded',String(!$('filter-panel').hidden))};$('reset').onclick=()=>{$('priority').value='all';$('content-search').value='';tab='全部内容';render()};$('view').onclick=()=>{cards=!cards;$('view').textContent=cards?'☷ 列表':'▦ 卡片';$('view').setAttribute('aria-pressed',String(cards));renderContent()};$('theme').onclick=()=>{const dark=document.body.classList.toggle('dark');$('theme').setAttribute('aria-pressed',String(dark));try{localStorage.setItem('studio-preview-theme',dark?'dark':'light')}catch{toast('主题已切换，浏览器未允许保存偏好')}};$('main-action').onclick=()=>toast('已预留「'+groups[groupIndex].modules[moduleIndex][3]+'」入口，业务接入后启用');document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();menuGroup=null;renderNav();openMenu(true);$('search').focus()}});render();

function openMenu(open){clearTimeout(menuCloseTimer);const menu=$('module-menu');menu.classList.toggle('scoped',menuGroup!==null);if(menuGroup!==null){const anchor=document.querySelector(`[data-group="${menuGroup}"]`);const left=anchor?.getBoundingClientRect().left||24;menu.style.setProperty('--menu-left',Math.max(16,Math.min(left,innerWidth-376))+'px')}document.querySelectorAll('[data-group]').forEach(button=>button.setAttribute('aria-expanded',String(open&&Number(button.dataset.group)===menuGroup)));document.querySelector('.menu-heading strong').textContent=menuGroup===null?'全部模块':groups[menuGroup].name;document.querySelector('.menu-heading p').textContent=menuGroup===null?'选择一个工作模块':'选择此工作区的功能';$('module-menu').hidden=!open;$('launcher').setAttribute('aria-expanded',String(open));}
$('launcher').onclick=()=>{const open=$('module-menu').hidden||menuGroup!==null;menuGroup=null;$('search').value='';renderNav();openMenu(open)};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('module-menu').hidden){const target=menuGroup===null?$('launcher'):document.querySelector(`[data-group="${menuGroup}"]`);openMenu(false);target?.focus()}});
document.addEventListener('click',e=>{if(!e.composedPath().includes(document.querySelector('.navigation')))openMenu(false)});

function frame(content, detail) {
 $('content-list').innerHTML=content;
 $('inspector').innerHTML=detail;
 document.querySelectorAll('[data-demo]').forEach(button=>button.onclick=()=>toast(button.dataset.demo+'：此处为示例入口，尚未接入业务'));
 document.querySelectorAll('[data-draft]').forEach(input=>{input.value=drafts.get(input.dataset.draft)||'';input.oninput=()=>{drafts.set(input.dataset.draft,input.value);updateDraftStatus(input)};updateDraftStatus(input)});
}
function demo(label){return `<button data-demo="${label}">${label}</button>`}
function note(title,body){return `<div class="inspector-top">CONTEXT / 当前工作</div><h2>${title}</h2><p>${body}</p>`}
function renderModuleSkeleton(){
 if(groupIndex===0&&moduleIndex===1){frame(`<div class="list-label"><span>本周热门作品</span><span>以下均为示例数据</span></div>${stories.map((s,i)=>`<div class="video-item"><span class="story-number">0${i+1}</span><div class="video-cover cover-${i}"><span>▶</span><small>03:2${i}</small></div><div><span class="category">游戏观察</span><h3>${s.title}</h3><p>示例账号 ${i+1} · ${s.time}</p><div class="video-metrics"><span>播放 ${(i+1)*12}.8 万</span><span>点赞 ${(i+1)*2},300</span></div></div></div>`).join('')}`,note('关注中的账号','按账号追踪作品变化，筛选热门视频后查看来源与转写。')+['游戏观察室','创作研究所','日常灵感库'].map(n=>`<div class="account-line"><span class="avatar">${n[0]}</span><span>${n}<small>示例账号 · 已关注</small></span></div>`).join('')+demo('管理关注账号'));return true;}
 if(groupIndex===1&&moduleIndex===0){frame(`<div class="collection-summary"><strong>账号与作品</strong><span>3 个示例账号 · 12 个示例作品</span></div><div class="account-grid">${['游戏观察室','创作研究所','日常灵感库'].map((n,i)=>`<button class="account-tile" data-account="${i}"><span class="avatar">${n[0]}</span><h3>${n}</h3><p>${['B站','抖音','B站'][i]} · 4 个作品</p><span class="category">查看作品 →</span></button>`).join('')}</div><div class="list-label">最近整理的作品</div>${stories.slice(0,3).map(s=>`<div class="asset-row"><span>▤</span><div><strong>${s.title}</strong><small>转写已完成 · 示例内容</small></div>${demo('查看转写')}</div>`).join('')}`,note('账号详情','选择一个账号，查看账号资料、作品与风格入口。')+demo('批量转写')+demo('提取风格'));document.querySelectorAll('[data-account]').forEach(b=>b.onclick=()=>{$('inspector').innerHTML=note(b.querySelector('h3').textContent,'4 个示例作品，3 份转写。后续接入真实账号信息、作品选择与风格分析。');document.querySelectorAll('[data-account]').forEach(x=>x.classList.toggle('selected',x===b))});return true;}
 if(groupIndex===1){frame(`<div class="collection-summary"><strong>秋季内容企划</strong><span>项目资料 / 示例</span></div><div class="project-flow"><div><h3>参考资料</h3>${['产品背景资料','账号风格参考','本周选题笔记'].map(n=>`<div class="asset-row"><span>▤</span><div><strong>${n}</strong><small>资料已整理</small></div></div>`).join('')}${demo('添加资料')}</div><div class="document-editor"><span class="eyebrow">STYLE CARD</span><h2>项目风格卡</h2><label for="project-style">语气、结构与表达习惯</label><textarea id="project-style" data-draft="项目风格卡" placeholder="清晰、直接、有观点。先讲具体问题，再给出证据与建议。"></textarea>${demo('保存风格卡')}</div></div>`,note('项目概览','将参考资料和风格放在同一工作区，创建内容时直接调用。')+'<div class="detail-label">项目成员</div><p>团队功能将在后续部署阶段接入。</p>'+demo('切换项目'));return true;}
 if(groupIndex===2&&tab==='历史记录'){frame('<div class="list-label">历史记录 · 示例</div>'+['第一版草稿','表达优化版','最终整理版'].map((n,i)=>`<div class="asset-row"><span>0${i+1}</span><div><strong>${n}</strong><small>今天 · 示例版本</small></div>${demo('打开版本')}</div>`).join(''),note('版本与历史','这里将对应接入各模块现有的历史、恢复与导出能力。'));return true;}
 if(groupIndex===2&&moduleIndex===0){frame(`<div class="writing-split"><section class="writing-brief"><span class="eyebrow">BRIEF / 创作任务</span><h3>这次想表达什么？</h3><label for="writing-source">素材与要求</label><textarea id="writing-source" data-draft="对话写作" placeholder="粘贴素材，或者描述你想讲的故事…"></textarea><label for="writing-style">风格参考</label><select id="writing-style"><option>清楚、简洁、有观点</option><option>自然对话</option></select>${demo('添加参考资料')}<button class="primary" data-demo="开始写作">开始写作 →</button></section><section class="document-editor"><div class="list-label"><span>未命名文稿</span><span>当前会话保留</span></div><h2>好内容从一个想法开始</h2><label for="writing-output">文稿编辑区</label><textarea id="writing-output" data-draft="文稿正文" placeholder="在这里自由编辑文稿。接入业务后，生成内容与版本记录将在此呈现。"></textarea><div class="toolbar-actions">${demo('保存版本')}${demo('导出文稿')}</div></section></div>`,note('写作上下文','任务、文稿和历史各有位置，写作时不用在大段表单之间寻找正文。')+'<div class="detail-label">本篇风格</div><span class="category">清楚 · 简洁</span><div class="detail-label">版本</div><p>尚未保存版本</p>');return true;}
 if(groupIndex===2&&moduleIndex===1){frame(`<div class="canvas-toolbar"><span>未命名画布</span><span class="category">1:1</span>${demo('图片库')}</div><div class="image-canvas"><div class="canvas-outline"><span>＋</span><h3>留白，等待你的想象</h3><p>生成结果将在画布中展示</p></div></div><div class="image-composer"><label for="image-prompt">画面描述</label><textarea id="image-prompt" data-draft="生图描述" placeholder="描述主体、环境、光线与构图…"></textarea><div class="toolbar-actions">${demo('添加参考图')}<button class="primary" data-demo="生成图片">生成图片 ↗</button></div></div>`,note('画面设置','参数和参考放在右侧，画布保持完整。')+'<label class="setting-control">画幅比例<select><option>1:1 · 方形</option><option>16:9 · 横向</option><option>9:16 · 竖向</option></select></label><label class="setting-control">生成数量<select><option>1 张</option><option>2 张</option><option>4 张</option></select></label><div class="detail-label">参考图片</div>'+demo('选择参考'));return true;}
 if(groupIndex===2){frame(`<div class="engagement-layout"><section class="writing-brief"><h3>准备互动素材</h3><label for="comment-source">视频链接或正文</label><textarea id="comment-source" data-draft="评论素材" placeholder="粘贴视频链接或文案…"></textarea><label class="setting-control">平台<select><option>B站</option><option>抖音</option></select></label><label class="setting-control">内容类型<select><option>评论</option><option>评论与弹幕</option></select></label><button class="primary" data-demo="生成互动内容">生成内容 →</button></section><section class="comment-results"><div class="list-label">评论结果 · 示例</div>${['这个角度值得继续展开。','最有感触的是关于具体体验的部分。','期待下一期讲讲背后的设计过程。'].map((x,i)=>`<div class="comment-item"><span>0${i+1}</span><p>${x}</p><button data-copy="${i}">复制</button></div>`).join('')}${demo('导出结果')}</section></div>`,note('生成参数','左侧准备素材，中央浏览与编辑结果，历史记录独立放在顶部。')+'<span class="category">示例文案 · 非模型生成</span>');document.querySelectorAll('[data-copy]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.parentElement.querySelector('p').textContent);toast('已复制示例文案')}catch{toast('复制失败，请选中文案手动复制')}});return true;}
 if(groupIndex===3){const monitor=moduleIndex===1;frame(`<div class="metric-strip">${[['示例项目','4'],['平均毛利率','34.3%'],['待关注','2']].map(([l,v])=>`<div><small>${l}</small><strong>${v}</strong></div>`).join('')}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>项目</th><th>当前毛利率</th><th>目标</th><th>${monitor?'差值':'输入成本'}</th><th>操作</th></tr></thead><tbody>${[32,28,41,36].map((n,i)=>`<tr><td>示例项目 ${'ABCD'[i]}</td><td>${n}%</td><td>35%</td><td>${monitor?(n-35)+'%':'¥ '+(680+i*100)}</td><td><button data-demo="${monitor?'查看趋势':'编辑数据'}">${monitor?'查看趋势':'编辑'}</button></td></tr>`).join('')}</tbody></table></div>`,note(monitor?'关注偏离目标的项目':'核对与计算',monitor?'将目标、当前值和差值放在同一行，减少来回对照。':'在右侧编辑所选数据，计算结果与输入保持对应。')+'<div class="detail-label">数据说明</div><p>当前数值均为布局示例，不代表真实经营数据。</p>'+demo(monitor?'筛选异常项目':'导入模板'));return true;}
 if(groupIndex===4&&moduleIndex===0){frame(`<div class="settings-content"><span class="eyebrow">MODEL PREFERENCES</span><h2>按工作环节配置</h2>${['对话与写作','资料分析','图片生成','备用节点'].map(n=>`<div class="settings-row"><div><strong>${n}</strong><p>为${n}选择服务与模型</p></div><label><span class="sr-only">${n}模型</span><select><option>尚未配置</option><option>示例模型 A</option><option>示例模型 B</option></select></label></div>`).join('')}<div class="settings-footer"><span>此原型不收集密钥或连接外部服务</span>${demo('保存配置')}</div></div>`,note('配置说明','业务接入后沿用现有配置链、保存与放弃机制。这里先确定设置分组和编辑体验。'));return true;}
 if(groupIndex===4){frame(`<div class="tool-picker">${[['视频提取','提取文稿、音频与封面'],['发布包装','整理标题与平台文案'],['PDF 工具','压缩、合并与格式转换']].map(([n,d],i)=>`<button data-tool="${i}"><span class="tool-index">0${i+1}</span><h3>${n}</h3><p>${d}</p><span>进入工具 ↗</span></button>`).join('')}</div><div id="tool-workspace" class="editor"><h3>视频提取</h3><label for="tool-source">输入视频链接</label><textarea id="tool-source" data-draft="工具输入" placeholder="在此输入待处理内容…"></textarea>${demo('开始处理')}</div>`,note('一次只处理一件事','工具入口在上方，输入和结果在下方展开。'));document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{$('tool-workspace').querySelector('h3').textContent=b.querySelector('h3').textContent;$('tool-workspace').querySelector('label').textContent=['输入视频链接','输入素材正文','PDF 服务地址'][Number(b.dataset.tool)]});return true;}
 return false;
}

// Delegate hover handling because navigation buttons are replaced during rendering.
function cancelMenuClose(){clearTimeout(menuCloseTimer)}
function scheduleMenuClose(){cancelMenuClose();menuCloseTimer=setTimeout(()=>{if(menuGroup!==null)openMenu(false)},180)}
const navigation=document.querySelector('.navigation');
navigation.addEventListener('pointerover',event=>{
 if(event.pointerType!=='mouse')return;
 const category=event.target.closest('[data-group]');
 if(category){
  cancelMenuClose();
  const next=Number(category.dataset.group);
  if(menuGroup!==next||$('module-menu').hidden){menuGroup=next;$('search').value='';renderNav();openMenu(true)}
 }else if(event.target.closest('#module-menu'))cancelMenuClose();
});
navigation.addEventListener('pointerout',event=>{
 if(event.pointerType!=='mouse'||menuGroup===null)return;
 const destination=event.relatedTarget;
 if(destination instanceof Element&&(destination.closest('[data-group]')||destination.closest('#module-menu')))return;
 if(event.target.closest('[data-group]')||event.target.closest('#module-menu'))scheduleMenuClose();
});
navigation.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse'&&menuGroup!==null)scheduleMenuClose()});

function updateDraftStatus(input){
 let status=input.nextElementSibling;
 if(!status?.classList.contains('draft-status')){status=document.createElement('small');status.className='draft-status';input.after(status)}
 status.textContent=`${input.value.length} 字 · 仅保留在当前页面会话`;
}
try{document.body.classList.toggle('dark',localStorage.getItem('studio-preview-theme')==='dark')}catch{/* 主题偏好不可读时继续使用默认主题。 */}
$('theme').setAttribute('aria-pressed',String(document.body.classList.contains('dark')));
window.addEventListener('beforeunload',event=>{if([...drafts.values()].some(value=>value.trim())){event.preventDefault();event.returnValue=''}});
navigation.addEventListener('keydown',event=>{
 const category=event.target.closest('[data-group]');
 if(category&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
  event.preventDefault();const buttons=[...document.querySelectorAll('[data-group]')];const index=buttons.indexOf(category);const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].focus();return;
 }
 if(category&&event.key==='ArrowDown'){event.preventDefault();menuGroup=Number(category.dataset.group);$('search').value='';renderNav();openMenu(true);document.querySelector('[data-module]')?.focus();return}
 if(event.target.closest('#modules')&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
  event.preventDefault();const items=[...document.querySelectorAll('[data-module]')];const index=items.indexOf(event.target.closest('[data-module]'));const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();
 }
});
navigation.addEventListener('focusout',event=>{if(event.relatedTarget&&!navigation.contains(event.relatedTarget))openMenu(false)});

// Shared prototype overlays: one focus lifecycle for dialogs and drawers.
const overlay=document.createElement('dialog');
overlay.className='preview-dialog';overlay.setAttribute('aria-labelledby','overlay-title');document.body.append(overlay);
let overlayTrigger=null;
function closeOverlay(){overlay.close();overlayTrigger?.focus()}
function showOverlay(kind,title,body){
 clearTimeout(stateTimer);
 if(!overlay.open)overlayTrigger=document.activeElement;
 document.body.classList.add('overlay-open');
 overlay.classList.toggle('drawer',kind==='drawer');
 overlay.innerHTML=`<header class="overlay-header"><div><small>交互演示</small><h2 id="overlay-title">${title}</h2></div><button class="overlay-close" aria-label="关闭">×</button></header><div class="overlay-body">${body}</div><footer class="overlay-footer"><button class="overlay-cancel">关闭</button></footer>`;
 overlay.querySelectorAll('.overlay-close,.overlay-cancel').forEach(b=>b.onclick=closeOverlay);
 overlay.showModal();overlay.querySelector('.overlay-close').focus();
}
overlay.addEventListener('click',event=>{if(event.target===overlay){const r=overlay.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeOverlay()}});
overlay.addEventListener('close',()=>{document.body.classList.remove('overlay-open');overlayTrigger?.focus()});
overlay.addEventListener('cancel',()=>{document.body.classList.remove('overlay-open')});
const stateButton=document.createElement('button');stateButton.id='state-preview';stateButton.textContent='交互状态';stateButton.className='state-preview';document.querySelector('.topbar-right').prepend(stateButton);
stateButton.onclick=()=>{
 showOverlay('drawer','交互与状态预览',`<p class="state-description">以下操作仅演示界面状态，不读取或保存业务数据。</p><div class="state-options">${[['dialog','表单弹窗'],['loading','加载状态'],['empty','空状态'],['error','错误与重试'],['saved','保存反馈'],['selection','多选反馈']].map(([id,label])=>`<button data-state="${id}">${label}<span>↗</span></button>`).join('')}</div>`);
 overlay.querySelectorAll('[data-state]').forEach(button=>button.onclick=()=>showState(button.dataset.state));
};
let stateTimer;
function showState(state){
 clearTimeout(stateTimer);
 if(state==='dialog'){
  showOverlay('dialog','新建示例项目','<form id="demo-form"><label for="demo-name">项目名称</label><input id="demo-name" name="name" autocomplete="off" placeholder="例如：秋季内容企划" required maxlength="60" aria-describedby="demo-help"><small id="demo-help">仅演示表单反馈，不会创建真实项目。</small><p id="demo-error" class="inline-error" role="alert" hidden></p><button class="primary" type="submit">演示保存</button></form>');
  const form=overlay.querySelector('form');form.noValidate=true;form.onsubmit=event=>{event.preventDefault();const input=overlay.querySelector('input');const error=overlay.querySelector('#demo-error');if(!input.value.trim()){error.hidden=false;error.textContent='请输入项目名称后再继续。';input.setAttribute('aria-invalid','true');input.focus();return}input.removeAttribute('aria-invalid');error.hidden=true;const submit=form.querySelector('[type="submit"]');submit.disabled=true;submit.textContent='正在演示保存…';form.setAttribute('aria-busy','true');stateTimer=setTimeout(()=>{if(!overlay.open)return;form.setAttribute('aria-busy','false');submit.disabled=false;submit.textContent='演示保存';toast('保存反馈演示完成 · 未写入业务数据');closeOverlay()},650)};return;
 }
 if(state==='loading'){
  showOverlay('drawer','加载状态','<div class="state-loading" role="status" aria-live="polite" aria-busy="true"><span class="loading-spinner"></span><p>正在演示读取内容…</p><div class="skeleton-line"></div><div class="skeleton-line short"></div><div class="skeleton-block"></div></div>');
  stateTimer=setTimeout(()=>{if(overlay.open){overlay.querySelector('.overlay-body').innerHTML='<div class="state-message" role="status"><span class="state-symbol">✓</span><h3>加载演示完成</h3><p>真实页面将根据请求结果展示对应内容。</p></div>'}},1200);return;
 }
 if(state==='empty')showOverlay('drawer','空状态','<div class="state-message"><span class="state-symbol">＋</span><h3>这里还没有内容</h3><p>添加第一份资料，开始整理你的项目。</p><button class="primary" id="empty-action">添加示例资料</button></div>');
 if(state==='error')showOverlay('drawer','错误状态','<div class="state-message error-state" role="alert"><span class="state-symbol">!</span><h3>暂时未能加载</h3><p>这是网络错误演示。已有输入会保留，你可以重新尝试。</p><button class="primary" id="retry-state">重试演示</button></div>');
 if(state==='saved'){closeOverlay();toast('保存成功反馈演示 · 未写入业务数据');return}
 if(state==='selection'){
  showOverlay('drawer','选中与批量操作',`<div class="selection-list">${['选题资料','账号参考','项目风格'].map((x,i)=>`<label><input type="checkbox" value="${i}"><span>${x}</span><small>示例资料</small></label>`).join('')}</div><div class="selection-footer" role="status">已选择 <strong id="selected-count">0</strong> 项<button id="selected-action" disabled>演示批量操作</button></div>`);
  overlay.querySelectorAll('input').forEach(input=>input.onchange=()=>{const count=overlay.querySelectorAll('input:checked').length;overlay.querySelector('#selected-count').textContent=count;overlay.querySelector('#selected-action').disabled=!count});overlay.querySelector('#selected-action').onclick=()=>toast('批量操作反馈演示 · 未修改真实资料');
 }
 const empty=overlay.querySelector('#empty-action');if(empty)empty.onclick=()=>showState('dialog');const retry=overlay.querySelector('#retry-state');if(retry)retry.onclick=()=>showState('loading');
}
overlay.addEventListener('close',()=>clearTimeout(stateTimer));
