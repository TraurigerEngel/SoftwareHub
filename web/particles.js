'use strict';
/* Visual Preview 5 — Exact Kinoteka v1.0 Stable particle engine.
 * Derived directly from Kinoteka v1.0 Stable app/index.html
 * (RC1 Theme Preview 15 Hotfix 3 final particle field).
 * Original density, hue timing, clusters, twinkles, speeds, glints and streaks.
 * Adaptations: canvas ID, approved Software Hub startup gate and user a11y prefs.
 */
(() => {
  const launch = () => {
  /* RC1 Theme Preview 12 background — denser full-spectrum living particles with slightly more chaos. */
  /* RC1 Theme Preview 15 Hotfix 3 — restore decorative local glint crosses + short fast-particle streaks. */
  (()=>{
    const canvas=document.getElementById('shubParticleField');
    if(!canvas) return;
    const ctx=canvas.getContext('2d',{alpha:true});
    if(!ctx) return;
    let w=0,h=0,dpr=1,last=performance.now(),lastFrame=0,rafId=0;
    let particles=[],stars=[],glints=[];
    const motionQuery=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const contrastQuery=window.matchMedia?.('(prefers-contrast: more)');
    const MAX_FPS=90;
    const FRAME_INTERVAL=1000/MAX_FPS;
    const TAU=Math.PI*2;
    const rand=(a,b)=>a+Math.random()*(b-a);
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const HUE_CYCLE_SECONDS=72;
    const HUE_SPEED=360/HUE_CYCLE_SECONDS;
    const hslToRgb=(h,s,l)=>{h=((h%360)+360)%360;s/=100;l/=100;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r=0,g=0,b=0;if(h<60){r=c;g=x}else if(h<120){r=x;g=c}else if(h<180){g=c;b=x}else if(h<240){g=x;b=c}else if(h<300){r=x;b=c}else{r=c;b=x}return `${Math.round((r+m)*255)},${Math.round((g+m)*255)},${Math.round((b+m)*255)}`};
    const RGB_WHEEL=Array.from({length:360},(_,h)=>hslToRgb(h,82,70));
    const colorAt=(baseHue,t)=>RGB_WHEEL[(Math.floor(baseHue+t*HUE_SPEED)%360+360)%360];
    function resize(){
      const root=document.documentElement;
      const rect=canvas.getBoundingClientRect();
      dpr=Math.min(window.devicePixelRatio||1,1.5);
      w=Math.max(1,Math.round(rect.width||root.clientWidth||innerWidth));
      h=Math.max(1,Math.round(rect.height||root.clientHeight||innerHeight));
      const pixelW=Math.max(1,Math.ceil(w*dpr));
      const pixelH=Math.max(1,Math.ceil(h*dpr));
      if(canvas.width!==pixelW) canvas.width=pixelW;
      if(canvas.height!==pixelH) canvas.height=pixelH;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.clearRect(0,0,w,h);
    }
    const clusters=[
      [.06,.12,.16],[.16,.25,.12],[.28,.11,.12],[.43,.18,.10],
      [.58,.10,.13],[.73,.14,.15],[.88,.18,.15],[.96,.34,.13],
      [.08,.45,.14],[.20,.56,.12],[.34,.66,.12],[.50,.54,.10],
      [.65,.62,.14],[.80,.56,.13],[.92,.72,.15],[.14,.78,.13],
      [.28,.88,.14],[.44,.82,.11],[.60,.90,.13],[.78,.86,.14],[.92,.90,.13]
    ];
    function spawnParticle(clustered=false){
      let x,y;
      if(clustered){
        const c=clusters[(Math.random()*clusters.length)|0],a=rand(0,TAU),rr=Math.pow(Math.random(),1.75)*c[2];
        x=c[0]+Math.cos(a)*rr;y=c[1]+Math.sin(a)*rr*.72;
      }else{x=rand(-.02,1.02);y=rand(-.01,1.01);}
      if(Math.abs(x-.5)<.11&&y>.15&&y<.53&&Math.random()<.84)x+=(x<.5?-1:1)*rand(.035,.13);
      const depth=Math.random(),fast=depth>.865;
      return {x,y,vx:rand(-.000012,.000012)*(fast?2.15:.88),vy:rand(-.000011,.000011)*(fast?1.92:.82),drift:rand(.000005,.000023),phase:rand(0,TAU),phase2:rand(0,TAU),size:fast?rand(1.00,2.35):(depth>.66?rand(.62,1.52):rand(.30,.96)),alpha:fast?rand(.52,.96):(depth>.66?rand(.35,.76):rand(.20,.58)),hue:rand(0,360),shape:(()=>{const r=Math.random();return r<.06?'diamond':r<.18?'stretched':'round'})(),wobble:rand(.000007,.000026),fast,twinkle:rand(.50,2.3),seed:rand(0,1000)};
    }
    function spawnStar(){const depth=Math.random();return{x:rand(-.02,1.02),y:rand(-.02,1.02),phase:rand(0,TAU),size:depth>.90?rand(.66,1.08):(depth>.62?rand(.42,.78):rand(.22,.52)),alpha:depth>.90?rand(.30,.62):(depth>.62?rand(.18,.40):rand(.08,.25)),drift:rand(.0000010,.0000044),hue:rand(0,360),depth};}
    function spawnGlint(){return{x:rand(.03,.97),y:rand(.03,.97),phase:rand(0,TAU),period:rand(3.2,7.4),size:rand(1.0,1.9),alpha:rand(.18,.46),hue:rand(0,360)};}
    function rebuild(){const count=Math.min(1680,Math.max(1220,Math.round(w*h/1240)));const clustered=Math.round(count*.54);particles=Array.from({length:count},(_,i)=>spawnParticle(i<clustered));stars=Array.from({length:Math.min(520,Math.max(330,Math.round(w*h/6200)))},spawnStar);glints=Array.from({length:Math.min(34,Math.max(18,Math.round(w*h/42000)))},spawnGlint);}
    function draw(now){
      rafId=0;
      if(document.hidden||contrastQuery?.matches) return;
      if(lastFrame&&now-lastFrame<FRAME_INTERVAL-.5){rafId=requestAnimationFrame(draw);return;}
      lastFrame=now;
      const dt=Math.min(40,now-last);last=now;const t=now*.001;ctx.clearRect(0,0,w,h);
      for(const s of stars){s.x+=Math.sin(t*.05+s.phase)*s.drift;if(s.x<-.03)s.x=1.03;if(s.x>1.03)s.x=-.03;const x=s.x*w,y=s.y*h,tw=.80+.20*Math.sin(t*(.10+s.depth*.18)+s.phase),a=s.alpha*tw,r=s.size,starCol=colorAt(s.hue,t);const sx=r,sy=r;ctx.beginPath();ctx.fillStyle=`rgba(${starCol},${a})`;ctx.ellipse(x,y,sx,sy,0,0,TAU);ctx.fill();}
      for(const g of glints){const x=g.x*w,y=g.y*h,pulse=Math.max(0,Math.sin(t*(TAU/g.period)+g.phase));if(pulse<.78)continue;const a=g.alpha*((pulse-.78)/.22),r=g.size*(.72+.28*pulse),col=colorAt(g.hue,t);ctx.beginPath();ctx.strokeStyle=`rgba(${col},${a*.28})`;ctx.lineWidth=.55;ctx.lineCap='round';ctx.moveTo(x-r*3.5,y);ctx.lineTo(x+r*3.5,y);ctx.moveTo(x,y-r*3.5);ctx.lineTo(x,y+r*3.5);ctx.stroke();ctx.beginPath();ctx.fillStyle=`rgba(${col},${a})`;ctx.arc(x,y,r,0,TAU);ctx.fill();}
      for(const p of particles){const oldX=p.x*w,oldY=p.y*h,n1=Math.sin(t*.31+p.phase+p.y*9.1),n2=Math.cos(t*.23+p.phase2+p.x*7.3),n3=Math.sin(t*.11+p.seed+p.x*4.0-p.y*6.0),turbulence=(n1*.55+n2*.30+n3*.15)*p.wobble,curl=Math.cos(t*.19+p.phase2+p.y*5.5)*p.wobble*.68,speed=p.fast?1.78:.94;p.x+=(p.vx+(p.x<.5?p.drift:-p.drift)*.18+turbulence)*dt*speed;p.y+=(p.vy+curl+Math.sin(t*.17+p.phase)*.0000035)*dt*speed;p.x+=Math.sin(t*.13+p.phase2+p.y*8.0)*.0000032*dt*speed;p.y+=Math.cos(t*.16+p.phase+p.x*6.0)*.0000030*dt*speed;let wrapped=false;if(p.x<-.05){p.x=1.05;wrapped=true;}if(p.x>1.05){p.x=-.05;wrapped=true;}if(p.y<-.05){p.y=1.05;wrapped=true;}if(p.y>1.05){p.y=-.05;wrapped=true;}const x=p.x*w,y=p.y*h,pulse=.72+.28*Math.sin(t*p.twinkle+p.phase),grain=.86+.14*Math.sin(t*.21+p.phase2*1.7+p.x*12-p.y*8),a=clamp(p.alpha*pulse*grain,.055,.98),r=p.size*(.82+.18*Math.sin(t*.9+p.phase2)),rgb=colorAt(p.hue,t);if(p.fast&&r>1.05&&!wrapped){ctx.beginPath();ctx.moveTo(oldX,oldY);ctx.lineTo(x,y);ctx.lineWidth=Math.max(.35,r*.38);ctx.lineCap='round';ctx.strokeStyle=`rgba(${rgb},${a*.23})`;ctx.stroke();}ctx.beginPath();ctx.fillStyle=`rgba(${rgb},${a})`;if(p.shape==='diamond'){ctx.moveTo(x,y-r*1.25);ctx.lineTo(x+r*1.05,y);ctx.lineTo(x,y+r*1.25);ctx.lineTo(x-r*1.05,y);ctx.closePath();ctx.fill();}else if(p.shape==='stretched'){ctx.ellipse(x,y,r*1.45,r*.72,Math.atan2(p.vy,p.vx),0,TAU);ctx.fill();}else{ctx.arc(x,y,r,0,TAU);ctx.fill();}}
      if(!motionQuery?.matches) rafId=requestAnimationFrame(draw);
    }
    function startAnimation(){
      if(document.hidden||rafId||contrastQuery?.matches) return;
      last=performance.now();lastFrame=0;rafId=requestAnimationFrame(draw);
    }
    function stopAnimation(){
      if(rafId)cancelAnimationFrame(rafId);
      rafId=0;
    }
    resize();rebuild();
    window.addEventListener('resize',()=>{resize();rebuild();},{passive:true});
    window.visualViewport?.addEventListener('resize',()=>{resize();rebuild();},{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAnimation();else startAnimation();});
    motionQuery?.addEventListener?.('change',()=>{stopAnimation();startAnimation();});
    contrastQuery?.addEventListener?.('change',()=>{stopAnimation();if(!contrastQuery.matches)startAnimation();else ctx.clearRect(0,0,w,h);});
    startAnimation();
  })();
  };
  if (document.documentElement.dataset.startup === 'ready') {
    launch();
  } else if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => {
      if (document.documentElement.dataset.startup === 'ready') {
        observer.disconnect();
        launch();
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-startup'] });
  }
})();
