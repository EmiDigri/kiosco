(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.KioscoPriceUnit=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function isIndividual(item){
    if(!item)return false;
    const needsProof=['casa-paso','dulce-sur'].includes(item.source)||['wholesale','unit'].includes(item.priceType);
    if(needsProof&&(item.unitSaleVerified!==true||Number(item.minimum)!==1))return false;
    if(item.unitSaleVerified===false||item.priceBasis==='pack-derived')return false;
    if(Number(item.packUnits)>1||Number(item.unitsPerPack)>1||Number(item.minimum)>1)return false;
    const text=[item.title||item.name||item.nombre,item.presentation||item.presentacion,item.saleFormat]
      .filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(/\b(packs?|multipacks?|tripacks?|bipacks?|bultos?|combos?|lotes?|docenas?|displays?|cajas?)\b/.test(text))return false;
    if(/\b(?:2\s*x\s*1|3\s*x\s*2)\b/.test(text))return false;
    for(const match of text.matchAll(/\b(?:minimo|minima|desde|a partir de)\s*(?:de\s*)?(\d+)\s*(?:unidades?|uds?|un|u)\b/g)){
      if(Number(match[1])>1)return false;
    }
    // Counts of sheets and physical measurements describe a single item.
    for(const match of text.matchAll(/(?:^|[\s-])(?:x|por)\s*(\d+(?:[.,]\d+)?)\s*([a-z]+)?/g)){
      if(/^(?:g|gr|grs|gramos?|kg|ml|cc|l|lt|lts|litros?|hojas?|h|mm|cm|m)$/.test(match[2]||''))continue;
      if(Number(match[1].replace(',','.'))>1)return false;
    }
    for(const match of text.matchAll(/(?:\b|x)(\d+)\s*(?:unidades|unidad|uds|ud|un|u)\b/g)){
      if(Number(match[1])>1)return false;
    }
    for(const match of text.matchAll(/\b(\d+)\s*x\s*\d+(?:[.,]\d+)?\s*(?:g|gr|grs|kg|ml|cc|l|lt|hojas?)\b/g)){
      if(Number(match[1])>1)return false;
    }
    return true;
  }
  return {isIndividual};
});
