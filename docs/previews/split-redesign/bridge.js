// Browser-only facade. No PTYs, IPC, persistent settings or local command execution.
(() => {
  const params = new URLSearchParams(location.search);
  document.getElementById('redesign').disabled = params.get('design') === 'old';
  document.body.dataset.variant = ['a','b','c','d'].includes(params.get('variant')) ? params.get('variant') : 'b';
  let output, exit, next = 0, clipboard = '';
  const sessions = new Map();
  const settings = { profile: params.get('theme') === 'light' ? 'Basic' : 'Pro', font_family:'Monospace', font_size:12, background:null, wallpaper:null, wallpaper_opacity:0.35, username_color:'#28c840', shell:'' };
  function emit(id, data) { output?.({id,data}); }
  function prompt() { return '\x1b[38;2;40;200;64msong@debian\x1b[0m:\x1b[34m~/Projects/terminal\x1b[0m$ '; }
  const demos = [
    'git status\r\nOn branch main\r\nYour branch is up to date with \'origin/main\'.\r\n\r\nnothing to commit, working tree clean\r\n\r\n',
    'npm run dev\r\n\r\n  VITE  ready in 182 ms\r\n\r\n  ➜  Local:   http://localhost:5173/\r\n  ➜  Network: use --host to expose\r\n\r\n',
    'ls desktop/renderer\r\napp.js         appearance.js  index.html\r\nprompt.js      splits.js      style.css\r\n\r\n'
  ];
  async function confirmClose() {
    let dialog = document.getElementById('preview-confirm');
    if (!dialog) {
      dialog = document.createElement('dialog');dialog.id='preview-confirm';
      dialog.setAttribute('aria-labelledby','confirm-title');
      dialog.innerHTML='<form method="dialog"><h2 id="confirm-title">关闭终端</h2><p>终端中可能有正在运行的命令。</p><p class="muted">关闭会终止这些会话。</p><footer><button value="cancel" autofocus>取消</button><button value="close">关闭</button></footer></form>';
      document.body.append(dialog);
    }
    if(dialog.open) return false;
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close',()=>resolve(dialog.returnValue === 'close'),{once:true}));
  }
  window.terminalAPI = {
    bootstrap:async()=>({settings:{...settings},fonts:['Monospace','DejaVu Sans Mono'],shells:[{id:'bash',label:'bash'}],platform:'linux',user:'song',host:'debian'}),
    createSession:async()=>{
      const id=String(++next);sessions.set(id,{input:''});
      setTimeout(()=>emit(id,'\x1b]0;bash — ~/Projects/terminal\x07'+prompt()+demos[(Number(id)-1)%demos.length]+prompt()),80);
      return {id,label:'bash',cwd:'/home/song/Projects/terminal',user:'song',host:'debian'};
    },
    write:async(id,data)=>{
      if(!sessions.has(id))return; const s=sessions.get(id);
      if(data==='\r') { emit(id,'\r\n\x1b[90m网页设计预览：命令不会执行。\x1b[0m\r\n'+prompt());s.input=''; }
      else if(data==='\x7f') { if(s.input){s.input=s.input.slice(0,-1);emit(id,'\b \b');} }
      else if(data==='\x03') {emit(id,'^C\r\n'+prompt());s.input='';}
      else if(!data.startsWith('\x1b')) {s.input+=data;emit(id,data);}
    },
    resize:async()=>{},ack:async()=>{},
    closeSession:async(id)=>sessions.delete(id),
    sessionInfo:async()=>({cwd:'/home/song/Projects/terminal',busy:false}),
    saveSettings:async(value)=>({...value}),
    importWallpaper:async()=>null,discardWallpapers:async()=>{},wallpaper:async()=>null,
    windowAction:async(action)=>{if(action==='close')await confirmClose();}, confirmClose,
    readClipboard:async()=>clipboard,writeClipboard:async(text)=>{clipboard=text;},
    onOutput:callback=>{output=callback;return()=>{output=null;};},onExit:callback=>{exit=callback;return()=>{exit=null;};}
  };
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==parent)return;
    if(event.data.type==='settings') document.getElementById('settings-open').click();
    if(event.data.type==='confirm') confirmClose();
    if(event.data.type==='design') document.getElementById('redesign').disabled=event.data.value==='old';
    if(event.data.type==='variant') {
      if(!['a','b','c','d'].includes(event.data.value)) return;
      document.body.dataset.variant=event.data.value;
      window.dispatchEvent(new Event('resize'));
    }
  });
  async function ready() {
    if(!document.querySelector('.terminal-pane'))return setTimeout(ready,30);
    const layout=params.get('layout');
    if(layout==='single')return;
    document.getElementById(layout==='vertical'?'split-vertical':'split-horizontal').click();
    if(layout==='nested') {
      while(document.querySelectorAll('.terminal-pane').length<2)await new Promise(r=>setTimeout(r,20));
      await new Promise(r=>setTimeout(r,100));
      document.getElementById('split-vertical').click();
    }
  }
  ready();
})();
