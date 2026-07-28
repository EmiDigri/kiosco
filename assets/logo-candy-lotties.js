(function(){
  'use strict';

  const C={
    red:[.94,.08,.13,1],redDark:[.66,.035,.06,1],pink:[1,.27,.48,1],
    white:[1,.98,.96,1],cream:[1,.91,.72,1],silver:[.82,.85,.88,1],
    silverDark:[.37,.42,.47,1],blue:[.09,.36,.72,1],chocolate:[.25,.11,.075,1],
    ink:[.25,.19,.22,1],blush:[1,.48,.6,1]
  };
  const ease={i:{x:.667,y:1},o:{x:.333,y:0}};
  const still=k=>({a:0,k});
  const loop=(start,mid,end=start)=>({a:1,k:[
    {...ease,t:0,s:start,e:mid},
    {...ease,t:60,s:mid,e:end},
    {t:120,s:end}
  ]});
  const quickBlink=(open,closed)=>({a:1,k:[
    {...ease,t:0,s:open,e:open},{...ease,t:43,s:open,e:closed},
    {...ease,t:48,s:closed,e:open},{...ease,t:53,s:open,e:open},{t:120,s:open}
  ]});
  const fill=color=>({ty:'fl',c:still(color),o:still(100),r:1,bm:0,nm:'Fill',hd:false});
  const stroke=(color,width)=>({ty:'st',c:still(color),o:still(100),w:still(width),lc:2,lj:2,ml:4,bm:0,nm:'Stroke',hd:false});
  const tr=(position=[0,0],scale=[100,100],rotation=0,opacity=100)=>({
    ty:'tr',p:still(position),a:still([0,0]),s:still(scale),r:still(rotation),o:still(opacity),
    sk:still(0),sa:still(0),nm:'Transform'
  });
  const ellipse=(name,size,position,color)=>({ty:'gr',it:[
    {ty:'el',d:1,s:still(size),p:still(position),nm:name+' shape',hd:false},fill(color),tr()
  ],nm:name,np:2,cix:2,bm:0,hd:false});
  const rect=(name,size,position,radius,color,rotation=0)=>({ty:'gr',it:[
    {ty:'rc',d:1,s:still(size),p:still(position),r:still(radius),nm:name+' shape',hd:false},fill(color),tr([0,0],[100,100],rotation)
  ],nm:name,np:2,cix:2,bm:0,hd:false});
  const line=(name,points,color,width)=>({ty:'gr',it:[
    {ty:'sh',ks:still({i:points.map(()=>[0,0]),o:points.map(()=>[0,0]),v:points,c:false}),nm:name+' path',hd:false},
    stroke(color,width),tr()
  ],nm:name,np:2,cix:2,bm:0,hd:false});
  const polygon=(name,points,color)=>({ty:'gr',it:[
    {ty:'sh',ks:still({i:points.map(()=>[0,0]),o:points.map(()=>[0,0]),v:points,c:true}),nm:name+' shape',hd:false},
    fill(color),tr()
  ],nm:name,np:2,cix:2,bm:0,hd:false});
  const layer=(index,name,shapes,opts={})=>({
    ddd:0,ind:index,ty:4,nm:name,sr:1,ks:{
      o:opts.opacity||still(100),r:opts.rotation||still(0),p:opts.position||still([32,32,0]),
      a:still([0,0,0]),s:opts.scale||still([100,100,100])
    },ao:0,shapes,ip:0,op:120,st:0,bm:0
  });
  const animation=(name,w,h,layers)=>({v:'5.13.0',fr:60,ip:0,op:120,w,h,nm:name,ddd:0,assets:[],layers,markers:[]});

  const canMotion={
    position:loop([32,34,0],[32,29,0]),
    rotation:loop([-7],[7],[-7]),
    scale:loop([100,100,100],[102,104,100],[100,100,100])
  };
  const sodaCan=animation('Kiosco soda can',64,64,[
    layer(1,'Can details',[ellipse('Top',[29,8],[0,-19],C.silver),ellipse('Tab',[9,3],[2,-20],C.silverDark),line('White wave',[[-12,3],[-7,0],[-1,1],[5,5],[12,1]],C.white,4),rect('Highlight',[3,24],[-8,-1],1.5,[1,.55,.58,1])],canMotion),
    layer(2,'Can body',[rect('Body',[29,42],[0,1],5,C.red),ellipse('Bottom',[28,6],[0,21],C.redDark)],canMotion)
  ]);

  const marshMotion={
    position:loop([32,34,0],[32,30,0]),
    rotation:loop([-3],[3],[-3]),
    scale:loop([100,100,100],[108,92,100],[100,100,100])
  };
  const marshmallow=animation('Kiosco marshmallow',64,64,[
    layer(1,'Face',[ellipse('Left eye',[4,6],[-8,-1],C.ink),ellipse('Right eye',[4,6],[8,-1],C.ink),ellipse('Left cheek',[7,4],[-13,7],C.blush),ellipse('Right cheek',[7,4],[13,7],C.blush),line('Smile',[[-4,5],[0,8],[4,5]],C.ink,2)],{...marshMotion,scale:quickBlink([100,100,100],[103,95,100])}),
    layer(2,'Marshmallow',[rect('Body',[42,34],[0,2],14,C.white),rect('Pink base',[35,8],[0,12],4,[1,.76,.81,1]),ellipse('Glow',[12,7],[-10,-8],[1,1,1,.65])],marshMotion),
    layer(3,'Shadow',[ellipse('Shadow',[33,7],[0,24],[.09,.08,.12,.24])],{position:still([32,34,0]),scale:loop([100,100,100],[82,82,100],[100,100,100])})
  ]);

  const bonbonMotion={
    position:loop([32,33,0],[32,29,0]),
    rotation:loop([-6],[6],[-6]),
    scale:loop([100,100,100],[105,105,100],[100,100,100])
  };
  const bonbon=animation('Kiosco wrapped bonbon',64,64,[
    layer(1,'Bonbon label',[rect('Blue band',[27,8],[0,1],4,C.blue,-8),ellipse('Red seal',[8,8],[0,1],C.red),ellipse('Gloss',[9,5],[-7,-8],[1,1,1,.7])],bonbonMotion),
    layer(2,'Bonbon center',[ellipse('Chocolate rim',[37,37],[0,0],C.chocolate),ellipse('White wrapper',[32,32],[0,0],C.white)],bonbonMotion),
    layer(3,'Wrapper ends',[polygon('Left wrapper',[[-16,-7],[-30,-14],[-26,0],[-30,14],[-15,8]],C.red),polygon('Left blue fold',[[-18,-5],[-28,-10],[-25,0],[-28,10],[-17,6]],C.blue),polygon('Right wrapper',[[16,-7],[30,-14],[26,0],[30,14],[15,8]],C.red),polygon('Right blue fold',[[18,-5],[28,-10],[25,0],[28,10],[17,6]],C.blue)],bonbonMotion)
  ]);

  window.KIOSCO_LOGO_LOTTIES={sodaCan,marshmallow,bonbon};
})();
