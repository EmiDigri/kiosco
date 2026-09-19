(function(){
  'use strict';
  let library;
  let activeDialog=null;

  function loadCropper(){
    if(window.Cropper)return Promise.resolve(window.Cropper);
    if(!library){
      library=new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src='./assets/vendor/cropper-1.6.2/cropper.min.js';
        script.onload=()=>resolve(window.Cropper);
        script.onerror=()=>{script.remove();library=null;reject(new Error('cropper-load'));};
        document.head.append(script);
      });
    }
    return library;
  }

  function loadImage(img,url){
    return new Promise((resolve,reject)=>{
      img.crossOrigin='anonymous';
      img.onload=()=>resolve();
      img.onerror=()=>reject(new Error('image-load'));
      img.src=url;
    });
  }

  async function open({date,url,onSaved}){
    if(activeDialog)return;
    const returnFocus=document.activeElement;
    const dialog=document.createElement('dialog');
    dialog.className='hist-foto-recorte';
    dialog.setAttribute('aria-labelledby','hfcTitle');
    dialog.innerHTML=`<div class="hfc-layout">
      <header class="hfc-header"><div><h2 id="hfcTitle">Recortar foto</h2><p class="hfc-date"></p></div><button type="button" class="hfc-close" title="Cerrar" aria-label="Cerrar recorte">&#215;</button></header>
      <div class="hfc-toolbar"><div class="hfc-modes" role="group" aria-label="Vista de la foto"><button type="button" data-hfc-mode="edit" aria-pressed="true" disabled>Recortar</button><button type="button" data-hfc-mode="preview" aria-pressed="false" disabled>Vista previa</button></div><button type="button" class="hfc-reset" title="Restablecer selección" aria-label="Restablecer selección" disabled>&#8634;</button></div>
      <div class="hfc-workspace"><div class="hfc-stage"><img class="hfc-original" alt="Foto del cuaderno para recortar"></div><div class="hfc-preview" hidden><img alt="Vista previa del recorte"></div><span class="hfc-loading" role="status">Cargando foto…</span></div>
      <p class="hfc-error" role="alert" hidden></p>
      <footer class="hfc-footer"><button type="button" class="hfc-cancel">Cancelar</button><button type="button" class="hfc-save" disabled>Guardar recorte</button></footer>
    </div>`;
    dialog.querySelector('.hfc-date').textContent=String(date).split('-').reverse().join('/');
    document.body.append(dialog);
    activeDialog=dialog;
    const original=dialog.querySelector('.hfc-original');
    const stage=dialog.querySelector('.hfc-stage');
    const preview=dialog.querySelector('.hfc-preview');
    const save=dialog.querySelector('.hfc-save');
    const reset=dialog.querySelector('.hfc-reset');
    const loading=dialog.querySelector('.hfc-loading');
    const error=dialog.querySelector('.hfc-error');
    const modes=Array.from(dialog.querySelectorAll('[data-hfc-mode]'));
    let cropper=null,ready=false,busy=false,closed=false,mode='edit';

    function showError(message){error.textContent=message;error.hidden=!message;}
    function selectionValid(){
      if(!ready||!cropper)return false;
      const data=cropper.getData();
      return data.width>=16&&data.height>=16;
    }
    function updateButtons(){
      save.disabled=busy||!selectionValid();
      reset.disabled=busy||!ready;
      modes.forEach(button=>{button.disabled=busy||!ready;});
      dialog.querySelector('.hfc-cancel').disabled=busy;
      dialog.querySelector('.hfc-close').disabled=busy;
    }
    function close(){if(!busy)dialog.close();}
    function croppedImage(){
      if(!selectionValid())throw new Error('empty-crop');
      const canvas=cropper.getCroppedCanvas({maxWidth:1400,maxHeight:1400,fillColor:'#fff',imageSmoothingEnabled:true,imageSmoothingQuality:'high'});
      if(!canvas||!canvas.width||!canvas.height)throw new Error('empty-canvas');
      const data=canvas.toDataURL('image/jpeg',.9);
      if(!data.startsWith('data:image/jpeg;base64,'))throw new Error('invalid-canvas');
      return data;
    }
    function setMode(next){
      try{
        if(next==='preview')preview.querySelector('img').src=croppedImage();
        mode=next;
        // Keep the cropper laid out while previewing so resize does not lose the selection.
        stage.style.visibility=mode==='preview'?'hidden':'';
        preview.hidden=mode!=='preview';
        modes.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.hfcMode===mode)));
        showError('');
      }catch(e){showError('No pude preparar el recorte. Ajustá el marco y probá de nuevo.');}
    }
    dialog.querySelector('.hfc-close').addEventListener('click',close);
    dialog.querySelector('.hfc-cancel').addEventListener('click',close);
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',()=>{
      closed=true;
      cropper?.destroy();
      dialog.remove();
      activeDialog=null;
      if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
    },{once:true});
    modes.forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.hfcMode)));
    reset.addEventListener('click',()=>{setMode('edit');cropper.reset();updateButtons();});
    save.addEventListener('click',async()=>{
      if(busy||!selectionValid())return;
      let data;
      try{data=croppedImage();}catch(e){showError('No pude preparar el recorte. Ajustá el marco y probá de nuevo.');return;}
      busy=true;showError('');updateButtons();cropper.disable();save.textContent='Guardando…';
      let saved=false;
      try{
        const response=await fetch('/api/cierre-foto-guardar',{
          method:'POST',headers:await sbAuthHeaders({'Content-Type':'application/json'}),
          body:JSON.stringify({fecha:date,image:data.split(',')[1],mime:'image/jpeg'})
        });
        if(!response.ok)throw new Error('save');
        saved=true;
      }catch(e){
        showError('No pude confirmar el guardado. Podés volver a intentar.');
      }finally{
        busy=false;cropper.enable();save.textContent='Guardar recorte';updateButtons();
      }
      if(saved){
        dialog.close();
        if(typeof showToast==='function')showToast('Recorte guardado');
        try{await onSaved?.();}catch(e){if(typeof showToast==='function')showToast('Recorte guardado. Reabrí el día para ver la foto.');}
      }
    });
    dialog.showModal();
    try{
      const [Cropper]=await Promise.all([loadCropper(),loadImage(original,url)]);
      if(closed)return;
      cropper=new Cropper(original,{
        viewMode:1,dragMode:'crop',autoCropArea:1,background:false,
        checkOrientation:false,checkCrossOrigin:false,movable:false,rotatable:false,scalable:false,
        zoomable:false,toggleDragModeOnDblclick:false,minCropBoxWidth:36,minCropBoxHeight:36,
        ready(){if(closed)return;ready=true;loading.hidden=true;updateButtons();},
        crop(){if(ready)updateButtons();}
      });
    }catch(e){
      if(closed)return;
      loading.hidden=true;
      showError('No pude cargar la foto para recortar. Cerrá y probá de nuevo.');
    }
  }

  window.HistFotoRecorte={open};
})();
