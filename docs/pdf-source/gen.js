const R=require('path').join(__dirname,'../../js/');
const th=require(R+'physics/thermal.js'), B=require(R+'physics/bolometer.js'), el=require(R+'physics/electrical.js');
const um=1e-6, rect=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const out={};
// Fig A: profiles
const base={hole:{cx:0,cy:0,a:1e-6},source:{x:0,y:0,r0:300e-9},Q:3e-6,t:32e-9,kappa:13.2,kappaSup:13.2,G:5e7};
const xs=[];for(let i=0;i<=300;i++)xs.push(-2e-6+4e-6*i/300);
out.profiles=[['Fourier',{model:'fourier'}],['GK, l = 100 nm',{model:'gk',l:100e-9}],['GK, l = 200 nm',{model:'gk',l:200e-9}],['GK, l = 300 nm',{model:'gk',l:300e-9}]].map(([lab,m])=>{const s=th.solve(Object.assign({},base,m));return {label:lab,x:xs.map(x=>x/um),y:xs.map(x=>s.rise(x,0))};});
// off-centre profile
const so=th.solve(Object.assign({},base,{model:'fourier',source:{x:0.6e-6,y:0,r0:300e-9}}));
out.offc={label:'Fourier, source at x = 0.6 µm',x:xs.map(x=>x/um),y:xs.map(x=>so.rise(x,0)),modes:so.nModes};
// device cfg
const cfg={T0:295,nModes:160,geometry:{crystal:[[-7e-6,-2.6e-6],[6.5e-6,-3e-6],[7.2e-6,2.4e-6],[-6.2e-6,3.1e-6]],contacts:[{poly:rect(-9*um,-4*um,-3*um,4*um),role:'I+',Rc:20},{poly:rect(3*um,-4*um,9*um,4*um),role:'I-',Rc:20}],hole:{cx:0,cy:0,a:1*um},source:{x:0,y:0},resolution:160},
 material:{t:32e-9,kappa:13.2,kappaSup:13.2,tieKappa:true,G:5e7,model:'fourier',l:0},
 heating:{method:'optical',optical:{P:10e-6,absorbance:0.3,r0:300e-9},mechanical:{mode:'contactTemp',Q:1e-7,dTc:1,Ttip:300,Gts:1e-7,r0:20e-9}},
 electrical:{rhoKind:'resistivity',rho0:4e-6,model:{type:'tcr',alpha:0.0025},biasMode:'cv',V:0.05,I:1e-4,bandwidth:1}};
const dev=B.buildDevice(cfg.geometry);
const ex=B.evaluate(cfg,dev); out.example={Q:ex.Q,peak:ex.peakRise,mean:ex.meanHoleRise,dR:ex.dR,dRrel:ex.dRrel,Rs:ex.Rs,Rtot:ex.Rtot,Ibolo:ex.Ibolo,snr:ex.snr,noise:ex.noise,heal:1/ex.beta};
out.kG=[1e7,5e7,2e8].map(G=>{const c=JSON.parse(JSON.stringify(cfg));c.material.G=G;return {label:`G = ${G.toExponential(0).replace('e+','×10^')} W/m²K`,data:B.sweepKappa(c,dev,0.3,1000,30)};});
const cm=JSON.parse(JSON.stringify(cfg)); cm.heating.method='mechanical';
out.kMBT=B.sweepKappa(cm,dev,0.3,1000,30);
out.kOBT=out.kG[1].data;
out.scan=B.lineScan(cfg,dev,{x:-6.5e-6,y:0},{x:6.5e-6,y:0},81);
const exm=B.evaluate(cm,dev); out.exMBT={Q:exm.Q,dR:exm.dR,dRrel:exm.dRrel,snr:exm.snr};
// validation
const t0=Date.now(); const fit=B.fitKappa(cfg,dev,B.evaluate(cfg,dev,{kappa:7.5}).dR); out.fit={k:fit.roots[0],ms:Date.now()-t0};
const d=el.solveDevice({crystal:rect(0,0,10*um,2*um),contacts:[{poly:rect(-1*um,-1*um,2*um,3*um),role:'I+'},{poly:rect(8*um,-1*um,11*um,3*um),role:'I-'}],resolution:200});
out.bar={R:d.Runit,w:d.wSum};
// energy balance
out.energy=[0,0.5e-6,1.6e-6].map(off=>{const p={hole:{cx:0,cy:0,a:1e-6},source:{x:off,y:0,r0:250e-9},Q:2e-6,t:30e-9,kappa:10,kappaSup:15,G:3e7,model:'fourier'};const s=th.solve(p);const Rm=1e-6+30/s.beta+2e-6;let P=0;const nr=1500,nt=360;for(let i=0;i<nr;i++){const r=1e-6+(i+.5)*(Rm-1e-6)/nr;for(let j=0;j<nt;j++){const t=2*Math.PI*(j+.5)/nt;P+=p.G*s.rise(r*Math.cos(t),r*Math.sin(t))*r*((Rm-1e-6)/nr)*(2*Math.PI/nt);}}return {off,ratio:P/p.Q};});
require('fs').writeFileSync('data.json',JSON.stringify(out));
console.log(JSON.stringify({ex:out.example,mbt:out.exMBT,fit:out.fit,bar:out.bar,energy:out.energy,modes:out.offc.modes}));
