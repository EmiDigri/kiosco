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
    if(/\b(packs?|multipacks?|tripacks?|bipacks?|bultos?|combos?|lotes?|docenas?|displays?|cajas?|cjas?|cjs|cj|caj|estuches?)\b/.test(text))return false;
    if(/\b(?:2\s*x\s*1|3\s*x\s*2)\b/.test(text))return false;
    for(const match of text.matchAll(/\b(?:minimo|minima|desde|a partir de)\s*(?:de\s*)?(\d+)\s*(?:unidades?|uds?|un|u)\b/g)){
      if(Number(match[1])>1)return false;
    }
    // Counts of sheets and physical measurements describe a single item.
    for(const match of text.matchAll(/(?:^|[\s-])(?:x|por)\s*(\d+(?:[.,]\d+)?)\s*([a-z]+)?/g)){
      if(/^(?:g|gr|grs|grm|gramos?|kg|ml|cc|l|lt|lts|litros?|hojas?|h|mm|cm|m)$/.test(match[2]||''))continue;
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
  const aliases={alfajores:'alfajor',chocolates:'chocolate',choc:'chocolate',choco:'chocolate',bombones:'bombon',caramelos:'caramelo',chicles:'chicle',gomitas:'gomita',galletas:'galletita',galleta:'galletita',galletitas:'galletita',obleas:'oblea',turrones:'turron',pastillas:'pastilla',alm:'almendra',almendras:'almendra',avellanas:'avellana',frutillas:'frutilla',negra:'negro',blanca:'blanco',black:'negro',white:'blanco',resmas:'resma',hojas:'hoja',biromes:'boligrafo',birome:'boligrafo',boligrafos:'boligrafo',lapiceras:'boligrafo',lapicera:'boligrafo',fibrones:'marcador',fibron:'marcador',marcadores:'marcador',resaltadores:'resaltador',lapices:'lapiz',gaseosas:'gaseosa',jugos:'jugo',bebidas:'bebida',cigarrillos:'cigarrillo',encendedores:'encendedor',pilas:'pila',panuelos:'panuelo',cuadernos:'cuaderno',budines:'budin',bizcochos:'bizcocho',papitas:'papita',snacks:'snack',cervezas:'cerveza'};
  const productTypes=new Set(('alfajor chocolate bombon caramelo chicle gomita galletita oblea turron pastilla chupetin chupetines confite confites malvavisco malvaviscos golosina golosinas snack papita mani pochoclo palitos nachos semilla semillas helado helados postre postres gaseosa bebida agua soda jugo energizante energizantes isotonica cerveza vino vodka fernet whisky licor leche yogur yogurt manteca queso fiambre mantecol budin bizcocho pan magdalena magdalenas tortita tortitas azucar edulcorante yerba cafe cacao te mate cocido harina arroz fideos aceite sal mayonesa ketchup mostaza mermelada atun conserva conservas resma boligrafo marcador resaltador lapiz cuaderno carpeta carpetas cartulina goma regla corrector tempera crayon crayones adhesivo abrochadora clip clips libreria cigarrillo tabaco encendedor fosforo fosforos pila preservativo preservativos panuelo servilleta servilletas').split(' '));
  const kioskBrands=new Set(('rasta milka arcor cofler block guaymallen fantoche jorgito jorgelin aguila terrabusi tatin oreo pepitos toddy bagley chocolinas sonrisas diversion opera criollitas traviata tentaciones kesitas saladix mogul rocklets shot marroc cabsha cadbury kinder ferrero nutella beldent topline bazooka sugus bonobon lays doritos cheetos twistos pehuamar krachitos coca sprite fanta pepsi manaos speed monster gatorade powerade cepita baggio levite villavicencio aquarius tic tac halls menthoplus flynn paff').split(' '));
  const stopWords=new Set(['de','del','la','el','las','los','con','c','por','x','y','unidad','unidades','individual','un','u']);
  function searchText(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function itemText(item){return [item.brand||item.marca,item.title||item.name||item.nombre,item.presentation||item.presentacion].filter(Boolean).join(' ');}
  function searchTokens(value){
    return searchText(value).replace(/\bbon\s*o\s*bon\b/g,'bonobon')
      .replace(/\bcocacola\b/g,'coca cola').replace(/\blay['’]?s\b/g,'lays')
      .replace(/\bclasicos?\b|\bclasicas\b/g,'clasica')
      .replace(/\bs\s*\//g,'sin ').replace(/\bc\s*\//g,'con ')
      .replace(/\bx(?=\d)/g,' ')
      .replace(/\b(?:x\s*)?(\d+)\s*hojas?\b/g,'$1 hoja')
      .replace(/\b(\d+(?:[.,]\d+)?)\s*(kilogramos?|kg|gramos?|grs?|grm|g|mililitros?|ml|cc|litros?|lts?|l)\b/g,(_,n,u)=>{
        const volume=/^(?:mililitro|ml|cc|litro|lt|l)/.test(u),factor=/^(?:kilogramo|kg|litro|lt|l$)/.test(u)?1000:1;
        return ' '+(Math.round(Number(n.replace(',','.'))*factor*1000)/1000)+(volume?'ml':'g')+' ';
      }).replace(/[^a-z0-9.]+/g,' ').replace(/\.(?!\d)/g,' ').replace(/(^|[^0-9])\./g,'$1 ').split(/\s+/)
      .filter(Boolean).map(token=>aliases[token]||token).filter(token=>!stopWords.has(token)&&token!=='1u');
  }
  function brandOf(item){
    const tokens=searchTokens(item.title||item.name||item.nombre);
    const joined=tokens.join(' ');
    for(const name of ['coca cola','bonobon','red bull','tic tac','flynn paff','eco andes']){
      if((' '+joined+' ').includes(' '+name+' '))return name==='bonobon'?'Bon o Bon':name.replace(/\b\w/g,c=>c.toUpperCase());
    }
    const known=new Set([...kioskBrands,'bic','filgo','faber','ledesma','boreal','chamex','autor','estrada','exito','pelikan','simball']);
    const found=tokens.find(token=>known.has(token));
    if(found)return found.charAt(0).toUpperCase()+found.slice(1);
    const provided=String(item.brand||item.marca||'').trim();
    return /^(?:sin marca|rappi(?: buenos aires)?|open ?25|dulce sur|precios claros|mercadolibre)$/i.test(provided)?'':provided;
  }
  function identityTokens(item){
    const brand=brandOf(item);
    let tokens=searchTokens([brand,item.title||item.name||item.nombre,item.presentation||item.presentacion,item.saleFormat].filter(Boolean).join(' '));
    // Lay's listings omit "papas fritas" interchangeably; retain flavour and weight.
    if(searchTokens(brand).join(' ')==='lays')tokens=tokens.filter(token=>!['papas','fritas','papa','frita'].includes(token));
    return new Set(tokens);
  }
  function barcode(item){
    const value=String(item.ean||item.gtin||item.barcode||'').trim();
    if(!/^(?:\d{8}|\d{12,14})$/.test(value)||/^0+$/.test(value))return null;
    let sum=0;
    for(let i=value.length-2,weight=3;i>=0;i--,weight=4-weight)sum+=Number(value[i])*weight;
    return (10-sum%10)%10===Number(value.at(-1))?value.padStart(14,'0'):null;
  }
  function sameProduct(left,right){
    if(!isIndividual(left)||!isIndividual(right))return false;
    const a=identityTokens(left),b=identityTokens(right);
    const sizes=tokens=>[...tokens].filter(token=>/^\d+(?:\.\d+)?(?:g|ml)$/.test(token)).sort().join('|');
    if(sizes(a)&&sizes(b)&&sizes(a)!==sizes(b))return false;
    const aCode=barcode(left),bCode=barcode(right);
    if(aCode&&bCode)return aCode===bCode;
    const brand=item=>searchTokens(brandOf(item)).join(' ');
    if(!brand(left)||brand(left)!==brand(right))return false;
    return a.size>=3&&a.size===b.size&&[...a].every(token=>b.has(token));
  }
  function comparisonQuery(item){
    return [...identityTokens(item)].join(' ');
  }
  function groupProducts(items){
    const groups=[];
    for(const item of items.filter(isIndividual)){
      // Pairwise agreement prevents a missing barcode from bridging two different EANs.
      const group=groups.find(rows=>rows.every(row=>sameProduct(row,item)));
      if(group)group.push(item);else groups.push([item]);
    }
    return groups;
  }
  function presentationOf(item){
    return [...new Set(searchTokens([item.title||item.name,item.presentation].filter(Boolean).join(' ')))]
      .filter(token=>/^\d+(?:\.\d+)?(?:g|ml)$/.test(token)).sort().join(' · ');
  }
  function isKioskProduct(item){
    if(!item)return false;
    const text=searchText(itemText(item));
    const category=searchText(item.category||item.categoria||'');
    if(/\b(limpieza|perfumeria|electrodomesticos|indumentaria|ferreteria)\b/.test(category))return false;
    if(/\b(lavandina|detergentes?|limpiador(?:a|es|as)?|desinfectantes?|desengrasantes?|suavizantes?|jabon|jabones|lavarropas|lavavajillas|esponjas?|escobas?|trapos?|insecticidas?|shampoo|champu|acondicionador|desodorantes?|perfumes?|dentifrico|lavapisos|lustramuebles|remeras?|camisetas?|tazas?|vasos?|copas?|termos?|vajilla|muebles?|heladeras?|llaveros?|peluches?|fundas?|merchandising)\b/.test(text))return false;
    // Suppliers sometimes label every result "Kiosco"; that is not proof of its category.
    const tokens=searchTokens(text);
    return tokens.some(token=>productTypes.has(token)||kioskBrands.has(token));
  }
  function matchesSearch(item,query,options={}){
    if(!isIndividual(item)||!isKioskProduct(item))return false;
    const raw=String(query||'').trim();
    if(/^\d{8,14}$/.test(raw))return [item.ean,item.barcode,item.gtin].some(code=>String(code||'').padStart(14,'0')===raw.padStart(14,'0'));
    const wanted=searchTokens(raw),actual=searchTokens(itemText(item));
    if(!wanted.length)return false;
    // A broad brand query may return its variants, but every specified attribute must match.
    return wanted.every((token,index)=>{
      if(token==='sin')return actual.some((value,i)=>value==='sin'&&actual[i+1]===wanted[index+1]);
      const exact=actual.includes(token);
      if(exact&&index>0&&wanted[index-1]!=='sin'&&actual.some((value,i)=>value===token&&actual[i-1]==='sin')&&!wanted.includes('sin'))return false;
      return exact||(options.partial===true&&index===wanted.length-1&&/^[a-z]{2,}$/.test(token)&&actual.some(value=>value.startsWith(token)));
    });
  }
  return {isIndividual,isKioskProduct,matchesSearch,sameProduct,comparisonQuery,barcode,brandOf,groupProducts,presentationOf};
});
