(function initLoginCharacters(){
  const overlay=document.getElementById('loginOverlay');
  if(!overlay)return;
  const form=document.getElementById('loginForm');
  const stage=document.getElementById('loginStage');
  const email=document.getElementById('loginEmail');
  const password=document.getElementById('loginPass');
  const toggle=document.getElementById('loginPasswordToggle');
  const toggleIcon=toggle.querySelector('img');
  const button=document.getElementById('loginBtn');
  const label=document.getElementById('loginBtnLabel');
  const error=document.getElementById('loginErr');
  const characters=[...stage.querySelectorAll('.login-character')];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let busy=false,finished=false,frame=0,lastPoint=null;
  const inertBefore=new Map();
  const greetingTimers=new Map();
  const visible=()=>!overlay.classList.contains('oculto')&&!document.hidden;

  function mood(value){overlay.dataset.mood=value;}
  function inputMood(){
    if(busy||finished)return;
    if(password.type==='text'&&password.value){mood('revealed');return;}
    if(document.activeElement===password||document.activeElement===toggle){mood(password.type==='password'?'private':'revealed');return;}
    mood(document.activeElement===email?'typing':'idle');
  }
  function gaze(x,y,lean=0){
    stage.style.setProperty('--gaze-x',`${x.toFixed(2)}px`);
    stage.style.setProperty('--gaze-y',`${y.toFixed(2)}px`);
    stage.style.setProperty('--lean',`${lean.toFixed(2)}deg`);
  }
  function typingGaze(){
    if(reduced.matches)return;
    const progress=Math.min(1,(email.selectionStart??email.value.length)/32);
    gaze(-3+progress*6,2,progress*2);
  }
  function clearError(){
    if(busy||finished)return;
    error.textContent='';
    email.removeAttribute('aria-invalid');password.removeAttribute('aria-invalid');
    inputMood();
  }
  email.addEventListener('focus',()=>{inputMood();typingGaze();});
  email.addEventListener('input',()=>{clearError();typingGaze();});
  email.addEventListener('click',typingGaze);
  password.addEventListener('focus',inputMood);
  password.addEventListener('input',clearError);
  form.addEventListener('focusout',()=>requestAnimationFrame(inputMood));
  toggle.addEventListener('click',()=>{
    if(busy||finished)return;
    const revealing=password.type==='password';
    password.type=revealing?'text':'password';
    const text=revealing?'Ocultar contraseña':'Mostrar contraseña';
    toggle.setAttribute('aria-label',text);toggle.title=text;
    toggle.setAttribute('aria-pressed',String(revealing));
    toggleIcon.src=revealing?'./assets/login/eye-off.svg':'./assets/login/eye.svg';
    inputMood();
  });
  overlay.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse'||busy||finished||!visible()||reduced.matches)return;
    if(overlay.dataset.mood==='private'||overlay.dataset.mood==='revealed'||document.activeElement===email)return;
    lastPoint={x:event.clientX,y:event.clientY};
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      const bounds=stage.getBoundingClientRect();
      const x=Math.max(-1,Math.min(1,(lastPoint.x-bounds.left-bounds.width/2)/(bounds.width/2)));
      const y=Math.max(-1,Math.min(1,(lastPoint.y-bounds.top-bounds.height/2)/(bounds.height/2)));
      gaze(x*3,y*3,x*2.5);
    });
  });
  overlay.addEventListener('pointerleave',()=>{if(!busy&&!finished&&document.activeElement!==email)gaze(0,0);});
  characters.forEach(character=>{
    character.addEventListener('click',()=>{
      if(busy||finished)return;
      clearTimeout(greetingTimers.get(character));
      character.classList.remove('is-greeting');
      void character.offsetWidth;
      character.classList.add('is-greeting');
      greetingTimers.set(character,setTimeout(()=>{
        character.classList.remove('is-greeting');greetingTimers.delete(character);
      },800));
    });
  });

  // The underlying dashboard must not receive keyboard focus while the login is open.
  function syncVisibility(){
    const open=!overlay.classList.contains('oculto');
    if(open){
      [...document.body.children].forEach(element=>{
        if(element===overlay||['SCRIPT','STYLE','LINK'].includes(element.tagName)||inertBefore.has(element))return;
        inertBefore.set(element,element.inert);element.inert=true;
      });
    }else{
      inertBefore.forEach((value,element)=>{element.inert=value;});inertBefore.clear();
      if(frame){cancelAnimationFrame(frame);frame=0;}
      greetingTimers.forEach(clearTimeout);greetingTimers.clear();
    }
  }
  new MutationObserver(syncVisibility).observe(overlay,{attributes:true,attributeFilter:['class']});
  syncVisibility();
  overlay.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(el=>el.getClientRects().length);
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}
  });

  function setBusy(value){
    busy=value;button.disabled=value;toggle.disabled=value;
    email.readOnly=value;password.readOnly=value;
    button.setAttribute('aria-busy',String(value));
    label.textContent=value?'Entrando…':'Entrar al kiosco';
    if(value){mood('checking');gaze(0,-2);}
    else inputMood();
  }
  function showError(message){
    setBusy(false);error.textContent=message;
    mood('error');gaze(0,2);
    email.setAttribute('aria-invalid','true');password.setAttribute('aria-invalid','true');
  }
  async function success(){
    finished=true;mood('success');label.textContent='¡Ya estás adentro!';
    button.setAttribute('aria-busy','false');password.value='';gaze(0,-3);
    if(reduced.matches||!visible())return;
    const palette=['#7952ed','#ff936c','#e6d95b','#319c88'];
    for(let i=0;i<36;i++){
      const piece=document.createElement('i');piece.className='login-confetti';
      piece.style.setProperty('--x',`${20+Math.random()*60}%`);
      piece.style.setProperty('--dx',`${(Math.random()-.5)*270}px`);
      piece.style.setProperty('--dy',`${-80-Math.random()*140}px`);
      piece.style.setProperty('--spin',`${(Math.random()-.5)*700}deg`);
      piece.style.setProperty('--color',palette[i%palette.length]);
      piece.addEventListener('animationend',()=>piece.remove(),{once:true});stage.appendChild(piece);
    }
    await new Promise(resolve=>setTimeout(resolve,1400));
    stage.querySelectorAll('.login-confetti').forEach(piece=>piece.remove());
    overlay.classList.add('is-leaving');
    await new Promise(resolve=>setTimeout(resolve,400));
  }
  window.kioscoLogin={setBusy,showError,success};
})();
