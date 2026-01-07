import "./style.css";
import Phaser from "phaser";

const W = 420;
const H = 820;
const STORAGE_KEY = "snapstack_v1";

function todayKey(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function loadSave(){try{const raw=localStorage.getItem(STORAGE_KEY);return raw?JSON.parse(raw):null;}catch{return null;}}
function saveState(s){localStorage.setItem(STORAGE_KEY, JSON.stringify(s));}

function seededRng(seedStr){
  let h=2166136261;
  for(let i=0;i<seedStr.length;i++){h^=seedStr.charCodeAt(i);h=Math.imul(h,16777619);}
  return function(){
    let t=(h+=0x6D2B79F5);
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}

const PIECES=[
  {id:"1",cells:[[0,0]]},
  {id:"2h",cells:[[0,0],[1,0]]},
  {id:"2v",cells:[[0,0],[0,1]]},
  {id:"3h",cells:[[0,0],[1,0],[2,0]]},
  {id:"3v",cells:[[0,0],[0,1],[0,2]]},
  {id:"L3",cells:[[0,0],[0,1],[1,1]]},
  {id:"J3",cells:[[1,0],[0,1],[1,1]]},
  {id:"S4",cells:[[1,0],[2,0],[0,1],[1,1]]},
  {id:"Z4",cells:[[0,0],[1,0],[1,1],[2,1]]},
  {id:"T4",cells:[[0,0],[1,0],[2,0],[1,1]]},
  {id:"O4",cells:[[0,0],[1,0],[0,1],[1,1]]},
  {id:"I4h",cells:[[0,0],[1,0],[2,0],[3,0]]},
  {id:"I4v",cells:[[0,0],[0,1],[0,2],[0,3]]},
];

const THEMES=[
  {id:"classic",name:"Classic Toy",board:0x0b1020,grid:0x223055,pieceA:0x6ee7ff,pieceB:0xa7ff83,accent:0xffd166},
  {id:"gumdrop",name:"Gumdrop",board:0x140b1f,grid:0x3a2452,pieceA:0xff7ac8,pieceB:0x8bf5ff,accent:0xfff275},
  {id:"arcade", name:"Arcade", board:0x070b14,grid:0x15304a,pieceA:0x7cff6b,pieceB:0x8a7dff,accent:0xff4d6d},
];
function themeById(id){return THEMES.find(t=>t.id===id)||THEMES[0];}

// Monetization stubs (we wire real AdMob later)
async function showRewardedAd(){ return Math.random()<0.7; }
async function showInterstitialAd(){ return true; }

class GameScene extends Phaser.Scene{
  constructor(){ super("game"); }
  init(){
    const saved=loadSave();
    const base={coins:0,best:0,theme:"classic",lastDaily:null,dailyStreak:0,removeAds:false,interstitialCounter:0};
    this.profile=Object.assign(base,saved||{});
    this.dailyKey=todayKey();
    this.isDaily=false;
    this.rng=Math.random;

    this.boardN=10;
    this.cell=30;
    this.board=Array.from({length:this.boardN},()=>Array(this.boardN).fill(0));
    this.score=0;
    this.gameOver=false;
    this.pool=[];
    this.drag=null;

    this.theme=themeById(this.profile.theme);
  }

  create(){
    this.scale.resize(W,H);
    this.cameras.main.setBackgroundColor(this.theme.board);

    // tiny toy textures
    const g=this.make.graphics({x:0,y:0,add:false});
    g.fillStyle(0xffffff,1);
    g.fillRoundedRect(0,0,this.cell,this.cell,6);
    g.lineStyle(2,0x000000,0.15);
    g.strokeRoundedRect(1,1,this.cell-2,this.cell-2,6);
    g.fillStyle(0x000000,0.10);
    g.fillRoundedRect(4,4,this.cell-8,this.cell-8,5);
    g.generateTexture("tileBase",this.cell,this.cell);
    g.clear();
    g.fillStyle(0xffffff,1);
    g.fillCircle(6,6,3); g.fillCircle(12,10,2);
    g.generateTexture("sparkle",16,16);
    g.destroy();

    this.boardPx={x:(W-this.boardN*this.cell)/2,y:140,w:this.boardN*this.cell,h:this.boardN*this.cell};

    this.add.text(W/2,26,"SNAP & STACK",{fontFamily:"system-ui,sans-serif",fontSize:"22px",fontStyle:"900",color:"#E7F0FF"}).setOrigin(0.5,0.5);
    this.modeText=this.add.text(18,58,"MODE: CLASSIC",{fontFamily:"system-ui,sans-serif",fontSize:"12px",color:"#b9c7ff"});
    this.scoreText=this.add.text(18,78,`SCORE: ${this.score}`,{fontFamily:"system-ui,sans-serif",fontSize:"14px",color:"#e7f0ff"});
    this.bestText=this.add.text(18,98,`BEST: ${this.profile.best}`,{fontFamily:"system-ui,sans-serif",fontSize:"12px",color:"#b9c7ff"});
    this.coinsText=this.add.text(W-18,78,`COINS: ${this.profile.coins}`,{fontFamily:"system-ui,sans-serif",fontSize:"14px",color:"#ffd166"}).setOrigin(1,0);

    this.gridGfx=this.add.graphics();
    this.hintGfx=this.add.graphics();

    this.drawBoard();
    this.trayY=this.boardPx.y+this.boardPx.h+70;
    this.add.text(18,this.trayY-52,"PLACE ALL 3 PIECES",{fontFamily:"system-ui,sans-serif",fontSize:"12px",color:"#b9c7ff"});

    this.spawnPool();

    this.input.on("pointerdown",p=>this.onDown(p));
    this.input.on("pointermove",p=>this.onMove(p));
    this.input.on("pointerup",p=>this.onUp(p));

    this.persist();
  }
  makeButton(x,y,label,onClick){
    const t=this.add.text(x,y,label,{fontFamily:"system-ui,sans-serif",fontSize:"12px",color:"#0b1020",fontStyle:"800"}).setOrigin(1,0.5);
    const bg=this.add.rectangle(0,0,t.width+20,t.height+12,this.theme.accent,1).setOrigin(1,0.5).setStrokeStyle(2,0xffffff,0.15);
    const c=this.add.container(x,y,[bg,t]);
    c.setSize(bg.width,bg.height);
    c.setInteractive(new Phaser.Geom.Rectangle(-bg.width,-bg.height/2,bg.width,bg.height),Phaser.Geom.Rectangle.Contains);
    c.on("pointerdown",()=>bg.setScale(0.98));
    c.on("pointerup",()=>{bg.setScale(1);onClick();});
    c.on("pointerout",()=>bg.setScale(1));
    return c;
  }

  drawBoard(){
    const {x,y,w,h}=this.boardPx;
    this.gridGfx.clear();
    this.hintGfx.clear();

    this.gridGfx.fillStyle(0x000000,0.18);
    this.gridGfx.fillRoundedRect(x-14,y-14,w+28,h+28,18);
    this.gridGfx.lineStyle(2,0xffffff,0.08);
    this.gridGfx.strokeRoundedRect(x-14,y-14,w+28,h+28,18);

    this.gridGfx.lineStyle(1,this.theme.grid,0.8);
    for(let i=0;i<=this.boardN;i++){
      const gx=x+i*this.cell, gy=y+i*this.cell;
      this.gridGfx.lineBetween(gx,y,gx,y+h);
      this.gridGfx.lineBetween(x,gy,x+w,gy);
    }

    // filled cells
    for(let r=0;r<this.boardN;r++){
      for(let c=0;c<this.boardN;c++){
        const tint=this.board[r][c];
        if(!tint) continue;
        const px=x+c*this.cell+this.cell/2;
        const py=y+r*this.cell+this.cell/2;
        const img=this.add.image(px,py,"tileBase").setTint(tint);
        img.setDepth(1);
      }
    }
  }

  updateHUD(){
    this.scoreText.setText(`SCORE: ${this.score}`);
    this.bestText.setText(`BEST: ${this.profile.best}`);
    this.coinsText.setText(`COINS: ${this.profile.coins}`);
  }
  persist(){ saveState(this.profile); }

  randomPiece(){ return PIECES[Math.floor(this.rng()*PIECES.length)]; }

  makePieceSprite(piece,x,y){
    const ctn=this.add.container(x,y);
    const cells=piece.cells;
    const maxX=Math.max(...cells.map(c=>c[0]));
    const maxY=Math.max(...cells.map(c=>c[1]));
    const w=(maxX+1)*this.cell, h=(maxY+1)*this.cell;
    const ox=-w/2, oy=-h/2;

    for(const [cx,cy] of cells){
      const img=this.add.image(ox+cx*this.cell+this.cell/2, oy+cy*this.cell+this.cell/2, "tileBase");
      const color=(this.rng()<0.5)?this.theme.pieceA:this.theme.pieceB;
      img.setTint(color);
      const sp=this.add.image(img.x-6,img.y-6,"sparkle").setAlpha(0.25);
      ctn.add([img,sp]);
    }

    ctn.setSize(w,h);
    ctn.setInteractive(new Phaser.Geom.Rectangle(-w/2,-h/2,w,h),Phaser.Geom.Rectangle.Contains);
    this.tweens.add({targets:ctn,y:y-2,duration:800,yoyo:true,repeat:-1,ease:"Sine.easeInOut"});
    return ctn;
  }

  spawnPool(){
    if(this.poolSprites) this.poolSprites.forEach(s=>s.destroy(true));
    this.poolSprites=[];
    this.pool=[this.randomPiece(),this.randomPiece(),this.randomPiece()];

    const spacing=W/3;
    for(let i=0;i<3;i++){
      const px=spacing*(i+0.5), py=this.trayY;
      const spr=this.makePieceSprite(this.pool[i],px,py);
      spr.meta={index:i,homeX:px,homeY:py};
      this.poolSprites.push(spr);
    }
  }

  pointerToCell(x,y){
    const {x:bx,y:by,w,h}=this.boardPx;
    if(x<bx||y<by||x>=bx+w||y>=by+h) return null;
    return {c:Math.floor((x-bx)/this.cell), r:Math.floor((y-by)/this.cell)};
  }

  canPlace(r,c,piece){
    for(const [dx,dy] of piece.cells){
      const rr=r+dy, cc=c+dx;
      if(rr<0||rr>=this.boardN||cc<0||cc>=this.boardN) return false;
      if(this.board[rr][cc]) return false;
    }
    return true;
  }

  drawHint(r,c,piece){
    this.hintGfx.clear();
    if(r==null||c==null) return;
    const ok=this.canPlace(r,c,piece);
    const alpha=ok?0.18:0.08;
    const {x:bx,y:by}=this.boardPx;

    for(const [dx,dy] of piece.cells){
      const rr=r+dy, cc=c+dx;
      if(rr<0||rr>=this.boardN||cc<0||cc>=this.boardN) continue;
      const px=bx+cc*this.cell, py=by+rr*this.cell;
      this.hintGfx.fillStyle(ok?this.theme.accent:0xff4d6d, alpha);
      this.hintGfx.fillRoundedRect(px+2,py+2,this.cell-4,this.cell-4,6);
    }
  }

  clearFullLines(){
    const fullRows=[], fullCols=[];
    for(let r=0;r<this.boardN;r++){
      let ok=true;
      for(let c=0;c<this.boardN;c++) if(!this.board[r][c]){ok=false;break;}
      if(ok) fullRows.push(r);
    }
    for(let c=0;c<this.boardN;c++){
      let ok=true;
      for(let r=0;r<this.boardN;r++) if(!this.board[r][c]){ok=false;break;}
      if(ok) fullCols.push(c);
    }
    const total=fullRows.length+fullCols.length;
    if(!total) return 0;
    for(const r of fullRows) for(let c=0;c<this.boardN;c++) this.board[r][c]=0;
    for(const c of fullCols) for(let r=0;r<this.boardN;r++) this.board[r][c]=0;
    return total;
  }

  tryPlace(r,c,piece){
    if(!this.canPlace(r,c,piece)) return false;
    const tint=(this.rng()<0.5)?this.theme.pieceA:this.theme.pieceB;

    for(const [dx,dy] of piece.cells){
      const rr=r+dy, cc=c+dx;
      this.board[rr][cc]=tint;

      const {x:bx,y:by}=this.boardPx;
      const px=bx+cc*this.cell+this.cell/2;
      const py=by+rr*this.cell+this.cell/2;
      const spr=this.add.image(px,py,"tileBase").setTint(tint).setScale(0.7);
      this.tweens.add({targets:spr,scale:1,duration:110,ease:"Back.easeOut"});
    }

    this.score += piece.cells.length;

    const cleared=this.clearFullLines();
    if(cleared){
      this.score += cleared*10;
      this.profile.coins += cleared*2;
    }

    if(this.score>this.profile.best) this.profile.best=this.score;

    this.updateHUD();
    this.persist();
    this.scene.restart(); // simplest way to redraw cleanly
    return true;
  }

  anyMoveAvailable(){
    const active=this.poolSprites.filter(s=>s.active);
    for(const s of active){
      const piece=this.pool[s.meta.index];
      for(let r=0;r<this.boardN;r++){
        for(let c=0;c<this.boardN;c++){
          if(this.canPlace(r,c,piece)) return true;
        }
      }
    }
    return false;
  }

  async endGame(){
    this.gameOver=true;
    if(!this.profile.removeAds){
      this.profile.interstitialCounter=(this.profile.interstitialCounter||0)+1;
      if(this.profile.interstitialCounter%3===0) await showInterstitialAd();
    }

    const panel=this.add.rectangle(W/2,H/2,360,280,0x000000,0.55).setStrokeStyle(2,0xffffff,0.12);
    const title=this.add.text(W/2,H/2-90,"NO MOVES!",{fontFamily:"system-ui,sans-serif",fontSize:"24px",color:"#e7f0ff",fontStyle:"900"}).setOrigin(0.5);
    const body=this.add.text(W/2,H/2-40,`SCORE: ${this.score}\nBEST: ${this.profile.best}\n\nContinue? (Rewarded)`,{fontFamily:"system-ui,sans-serif",fontSize:"16px",color:"#b9c7ff",align:"center"}).setOrigin(0.5);

    const btnC=this.makeButton(W/2+80,H/2+70,"CONTINUE",async()=>{
      const ok=await showRewardedAd();
      if(ok){
        // clear a random row+col
        const rr=Math.floor(this.rng()*this.boardN);
        const cc=Math.floor(this.rng()*this.boardN);
        for(let c=0;c<this.boardN;c++) this.board[rr][c]=0;
        for(let r=0;r<this.boardN;r++) this.board[r][cc]=0;
        panel.destroy();title.destroy();body.destroy();btnC.destroy();btnN.destroy();
        this.gameOver=false;
        this.scene.restart();
      }
    }).setOrigin(1,0.5);

    const btnN=this.makeButton(W/2-80,H/2+70,"NEW RUN",()=>{
      panel.destroy();title.destroy();body.destroy();btnC.destroy();btnN.destroy();
      localStorage.removeItem(STORAGE_KEY);
      this.scene.restart();
    }).setOrigin(1,0.5);

    this.persist();
  }

  onDown(p){
    if(this.gameOver) return;
    for(let i=this.poolSprites.length-1;i>=0;i--){
      const s=this.poolSprites[i];
      if(!s.active) continue;
      if(s.getBounds().contains(p.x,p.y)){
        this.drag={sprite:s,piece:this.pool[s.meta.index]};
        this.children.bringToTop(s);
        s.setScale(1.06);
        return;
      }
    }
  }

  onMove(p){
    if(!this.drag) return;
    const s=this.drag.sprite;
    s.x=p.x; s.y=p.y;
    const cellPos=this.pointerToCell(p.x,p.y);
    this.drawHint(cellPos?.r, cellPos?.c, this.drag.piece);
  }

  onUp(p){
    if(!this.drag) return;
    const s=this.drag.sprite;
    s.setScale(1);

    const cellPos=this.pointerToCell(p.x,p.y);
    let placed=false;
    if(cellPos) placed=this.tryPlace(cellPos.r, cellPos.c, this.drag.piece);

    if(!placed){
      this.tweens.add({targets:s,x:s.meta.homeX,y:s.meta.homeY,duration:120,ease:"Quad.easeOut"});
    }else{
      s.active=false; s.setVisible(false);
      if(this.poolSprites.filter(ps=>ps.active).length===0) this.spawnPool();
      if(!this.anyMoveAvailable()) this.endGame();
    }

    this.hintGfx.clear();
    this.drag=null;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: "#0b1020",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: W, height: H },
  scene: [GameScene],
});
