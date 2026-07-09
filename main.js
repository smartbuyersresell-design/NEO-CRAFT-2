/* ============================================================
   NEO CRAFT — main.js
   Core game engine: seeded voxel terrain, chunk streaming,
   Minecraft-style pixel textures, physics, desktop + touch
   controls, save/continue, pause menu.
   Requires: THREE (global), NeoNoise (from js/noise.js)
   ============================================================ */
(function () {
  'use strict';

  try {
    initGame();
  } catch (err) {
    console.error(err);
    if (typeof showEngineError === 'function') {
      showEngineError('⚠ Game එකේ error එකක් ආවා: ' + (err && err.message ? err.message : err) +
        '. Page එක reload කරලා try කරන්න.');
    }
  }

  function initGame() {

  /* ---------------------------------------------------------
     0. CONSTANTS
  --------------------------------------------------------- */
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  const CHUNK_SIZE   = 16;
  const WORLD_HEIGHT = 36;
  const SEA_LEVEL     = 14;
  const RENDER_DIST   = isTouch ? 2 : 3;
  const GRAVITY        = 22;
  const JUMP_SPEED     = 9;
  const WALK_SPEED     = 5.2;
  const SPRINT_SPEED   = 8.2;
  const FLY_SPEED      = 12;
  const MOUSE_SENS     = 0.0022;
  const TOUCH_SENS     = 0.0045;
  const REACH          = 6;
  const SAVE_KEY       = 'neocraft_save_v1';

  const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4,
        WOOD = 5, LEAVES = 6, WATER = 7, GLASS = 8, BRICK = 9, SNOW = 10;

  const HOTBAR_BLOCKS = [GRASS, DIRT, STONE, SAND, WOOD, LEAVES, GLASS, BRICK, SNOW];

  function isTransparent(t){ return t === AIR || t === WATER || t === GLASS; }
  function isSolidForPhysics(t){ return t !== AIR && t !== WATER; }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  /* ---------------------------------------------------------
     1. TEXTURE ATLAS — procedural Minecraft-style pixel tiles
  --------------------------------------------------------- */
  const TILE = {
    GRASS_TOP:0, GRASS_SIDE:1, DIRT:2, STONE:3, SAND:4,
    WOOD_SIDE:5, WOOD_TOP:6, LEAVES:7, WATER:8, GLASS:9,
    BRICK:10, SNOW:11
  };
  const ATLAS_COLS = 6, ATLAS_ROWS = 2, TILE_SIZE = 32;
  const texRand = makeSeededRandom('neocraft-textures');
  function texRng(){ return texRand(); }
  function rgbStr(r,g,b){ return `rgb(${r|0},${g|0},${b|0})`; }
  function shadeC(rgb, d){ return rgbStr(clamp(rgb[0]+d,0,255), clamp(rgb[1]+d,0,255), clamp(rgb[2]+d,0,255)); }

  function speckleRect(ctx,x0,y0,w,h,rgb,variance,cell,density){
    density = density === undefined ? 0.55 : density;
    ctx.fillStyle = rgbStr(rgb[0],rgb[1],rgb[2]);
    ctx.fillRect(x0,y0,w,h);
    const nx = Math.max(1, Math.floor(w/cell)), ny = Math.max(1, Math.floor(h/cell));
    for (let i=0;i<nx;i++) for (let j=0;j<ny;j++){
      if (texRng() < density){
        const d = (texRng()-0.5)*variance;
        ctx.fillStyle = shadeC(rgb, d);
        ctx.fillRect(x0+i*(w/nx), y0+j*(h/ny), Math.ceil(w/nx), Math.ceil(h/ny));
      }
    }
  }

  const TILE_DRAWERS = [];
  TILE_DRAWERS[TILE.GRASS_TOP] = (ctx,x0,y0,s) => speckleRect(ctx,x0,y0,s,s,[87,161,74],36,s/8,0.6);
  TILE_DRAWERS[TILE.DIRT]      = (ctx,x0,y0,s) => speckleRect(ctx,x0,y0,s,s,[108,80,50],22,s/8,0.55);
  TILE_DRAWERS[TILE.GRASS_SIDE] = (ctx,x0,y0,s) => {
    speckleRect(ctx,x0,y0,s,s,[108,80,50],22,s/8,0.5);
    const stripH = Math.round(s*0.34), cell = s/8;
    speckleRect(ctx,x0,y0,s,stripH,[87,161,74],30,cell,0.6);
    for (let i=0;i<8;i++){
      if (texRng() < 0.5){
        const dipH = cell*(1+Math.floor(texRng()*2));
        ctx.fillStyle = shadeC([87,161,74], (texRng()-0.5)*30);
        ctx.fillRect(x0+i*cell, y0+stripH, cell, dipH);
      }
    }
  };
  TILE_DRAWERS[TILE.STONE] = (ctx,x0,y0,s) => {
    speckleRect(ctx,x0,y0,s,s,[126,126,131],18,s/8,0.5);
    for (let i=0;i<3;i++){
      ctx.strokeStyle = 'rgba(60,60,65,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const sx = x0+texRng()*s, sy = y0+texRng()*s;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + (texRng()-0.5)*s*0.5, sy + (texRng()-0.5)*s*0.5);
      ctx.stroke();
    }
  };
  TILE_DRAWERS[TILE.SAND] = (ctx,x0,y0,s) => speckleRect(ctx,x0,y0,s,s,[221,203,146],14,s/8,0.5);
  TILE_DRAWERS[TILE.WOOD_SIDE] = (ctx,x0,y0,s) => {
    ctx.fillStyle = rgbStr(92,66,40); ctx.fillRect(x0,y0,s,s);
    const cols = s/4;
    for (let i=0;i<cols;i++){
      ctx.fillStyle = shadeC([92,66,40], (texRng()-0.5)*26);
      ctx.fillRect(x0+i*4, y0, 4, s);
    }
  };
  TILE_DRAWERS[TILE.WOOD_TOP] = (ctx,x0,y0,s) => {
    ctx.fillStyle = rgbStr(176,140,92); ctx.fillRect(x0,y0,s,s);
    const cx = x0+s/2, cy = y0+s/2;
    for (let r=s/2; r>0; r-=3){
      ctx.strokeStyle = shadeC([176,140,92], (texRng()-0.5)*26);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
    }
  };
  TILE_DRAWERS[TILE.LEAVES] = (ctx,x0,y0,s) => speckleRect(ctx,x0,y0,s,s,[46,122,42],40,s/8,0.85);
  TILE_DRAWERS[TILE.WATER] = (ctx,x0,y0,s) => {
    speckleRect(ctx,x0,y0,s,s,[45,108,205],26,s/6,0.6);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    for (let y=0;y<s;y+=6){
      ctx.beginPath();
      ctx.moveTo(x0, y0+y+texRng()*3);
      ctx.lineTo(x0+s, y0+y+texRng()*3);
      ctx.stroke();
    }
  };
  TILE_DRAWERS[TILE.GLASS] = (ctx,x0,y0,s) => {
    ctx.fillStyle = 'rgb(214,235,240)'; ctx.fillRect(x0,y0,s,s);
    ctx.strokeStyle = 'rgba(140,170,180,0.55)'; ctx.lineWidth = 2;
    ctx.strokeRect(x0+2,y0+2,s-4,s-4);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x0+4,y0+s-4); ctx.lineTo(x0+s-4,y0+4); ctx.stroke();
  };
  TILE_DRAWERS[TILE.BRICK] = (ctx,x0,y0,s) => {
    ctx.fillStyle = 'rgb(196,188,175)'; ctx.fillRect(x0,y0,s,s);
    const rowH = s/4, brickW = s/2;
    ctx.fillStyle = 'rgb(150,60,46)';
    for (let r=0;r<4;r++){
      const offset = (r%2===0) ? 0 : brickW/2;
      for (let bx=-offset; bx<s; bx+=brickW){
        ctx.fillStyle = shadeC([150,60,46], (texRng()-0.5)*18);
        ctx.fillRect(x0+bx+1, y0+r*rowH+1, brickW-2, rowH-2);
      }
    }
  };
  TILE_DRAWERS[TILE.SNOW] = (ctx,x0,y0,s) => speckleRect(ctx,x0,y0,s,s,[232,238,248],10,s/8,0.5);

  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = ATLAS_COLS*TILE_SIZE; atlasCanvas.height = ATLAS_ROWS*TILE_SIZE;
  const actx = atlasCanvas.getContext('2d');
  actx.imageSmoothingEnabled = false;
  for (let t=0;t<TILE_DRAWERS.length;t++){
    const col = t % ATLAS_COLS, row = Math.floor(t/ATLAS_COLS);
    TILE_DRAWERS[t](actx, col*TILE_SIZE, row*TILE_SIZE, TILE_SIZE);
  }
  const atlasTexture = new THREE.CanvasTexture(atlasCanvas);
  atlasTexture.magFilter = THREE.NearestFilter;
  atlasTexture.minFilter = THREE.NearestFilter;
  atlasTexture.generateMipmaps = false;
  atlasTexture.wrapS = atlasTexture.wrapT = THREE.ClampToEdgeWrapping;
  atlasTexture.needsUpdate = true;

  function getTileUV(tileIdx){
    const col = tileIdx % ATLAS_COLS, row = Math.floor(tileIdx/ATLAS_COLS);
    const pad = 0.5;
    const u0 = (col*TILE_SIZE+pad)/atlasCanvas.width;
    const u1 = ((col+1)*TILE_SIZE-pad)/atlasCanvas.width;
    const v0 = 1 - ((row+1)*TILE_SIZE-pad)/atlasCanvas.height;
    const v1 = 1 - (row*TILE_SIZE+pad)/atlasCanvas.height;
    return { u0, v0, u1, v1 };
  }
  function tileFor(blockType, faceName){
    switch (blockType){
      case GRASS: return faceName==='top' ? TILE.GRASS_TOP : (faceName==='bottom' ? TILE.DIRT : TILE.GRASS_SIDE);
      case DIRT: return TILE.DIRT;
      case STONE: return TILE.STONE;
      case SAND: return TILE.SAND;
      case WOOD: return faceName==='side' ? TILE.WOOD_SIDE : TILE.WOOD_TOP;
      case LEAVES: return TILE.LEAVES;
      case WATER: return TILE.WATER;
      case GLASS: return TILE.GLASS;
      case BRICK: return TILE.BRICK;
      case SNOW: return faceName==='bottom' ? TILE.DIRT : TILE.SNOW;
      default: return TILE.STONE;
    }
  }
  function makeIconDataURL(blockType){
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const faceName = (blockType===GRASS || blockType===WOOD) ? 'side' : 'top';
    const tileIdx = tileFor(blockType, faceName);
    TILE_DRAWERS[tileIdx](ctx,0,0,64);
    return c.toDataURL();
  }

  /* ---------------------------------------------------------
     2. SEEDED HASH (for deterministic tree placement)
  --------------------------------------------------------- */
  function seedToInt(str){
    let h = 1779033703 ^ str.length;
    for (let i=0;i<str.length;i++){
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h<<13) | (h>>>19);
    }
    return h >>> 0;
  }
  let SEED_INT = 0;
  function hash2(x,z){
    let h = (x*374761393 + z*668265263) ^ SEED_INT;
    h = (h ^ (h>>>13)) * 1274126177;
    h = h ^ (h>>>16);
    return ((h>>>0) % 100000)/100000;
  }

  let noise = null; // NeoNoise instance, created per world
  function heightAt(x,z){
    const e = noise.fbm(x*0.010, z*0.010, 4, 2.1, 0.5); // 0..1
    let h = Math.floor(SEA_LEVEL + 3 + (e-0.5)*24);
    return clamp(h, 4, WORLD_HEIGHT-6);
  }

  /* ---------------------------------------------------------
     3. WORLD / CHUNK STORAGE + PERSISTENT CHANGES
  --------------------------------------------------------- */
  let chunks = new Map();
  let allChanges = new Map(); // "x,y,z" -> blockType (player-made edits)
  const key = (cx,cz) => cx + ',' + cz;
  const idx = (lx,y,lz) => (y*CHUNK_SIZE + lz)*CHUNK_SIZE + lx;

  function ensureChunkData(cx, cz){
    const k = key(cx,cz);
    let c = chunks.get(k);
    if (c) return c;
    const data = new Uint8Array(CHUNK_SIZE*CHUNK_SIZE*WORLD_HEIGHT);
    const baseX = cx*CHUNK_SIZE, baseZ = cz*CHUNK_SIZE;

    for (let lx=0; lx<CHUNK_SIZE; lx++){
      for (let lz=0; lz<CHUNK_SIZE; lz++){
        const wx = baseX+lx, wz = baseZ+lz;
        const h = heightAt(wx,wz);
        for (let y=0;y<WORLD_HEIGHT;y++){
          let t = AIR;
          if (y < h-4) t = STONE;
          else if (y < h-1) t = DIRT;
          else if (y === h-1) t = (h-1 <= SEA_LEVEL+1) ? SAND : GRASS;
          else if (y < SEA_LEVEL && y >= h) t = WATER;
          data[idx(lx,y,lz)] = t;
        }
        const top = h-1;
        if (data[idx(lx,top,lz)] === GRASS && hash2(wx,wz) < 0.018 &&
            lx>1 && lx<CHUNK_SIZE-2 && lz>1 && lz<CHUNK_SIZE-2){
          const trunkH = 3 + Math.floor(hash2(wx+1,wz+1)*3);
          for (let ty=1; ty<=trunkH; ty++) if (top+ty<WORLD_HEIGHT) data[idx(lx,top+ty,lz)] = WOOD;
          const leafBase = top+trunkH-1;
          for (let dx=-2; dx<=2; dx++)
            for (let dz=-2; dz<=2; dz++)
              for (let dy=0; dy<=2; dy++){
                const ax=lx+dx, az=lz+dz, ay=leafBase+dy;
                if (ax<0||ax>=CHUNK_SIZE||az<0||az>=CHUNK_SIZE||ay>=WORLD_HEIGHT) continue;
                const dist = Math.abs(dx)+Math.abs(dz)+Math.abs(dy-0.5);
                if (dist<=3.2 && data[idx(ax,ay,az)]===AIR && hash2(wx+dx*3, wz+dz*7+ay)>0.15){
                  data[idx(ax,ay,az)] = LEAVES;
                }
              }
          for (let ty=1; ty<=trunkH; ty++) if (top+ty<WORLD_HEIGHT) data[idx(lx,top+ty,lz)] = WOOD;
        }
      }
    }
    // re-apply any saved player edits for blocks inside this chunk
    if (allChanges.size){
      for (const [ck, type] of allChanges){
        const parts = ck.split(',');
        const ax = +parts[0], ay = +parts[1], az = +parts[2];
        if (ax>=baseX && ax<baseX+CHUNK_SIZE && az>=baseZ && az<baseZ+CHUNK_SIZE && ay>=0 && ay<WORLD_HEIGHT){
          data[idx(ax-baseX, ay, az-baseZ)] = type;
        }
      }
    }
    c = { data, mesh:null, waterMesh:null, dirty:true };
    chunks.set(k, c);
    return c;
  }

  function getBlock(x,y,z){
    if (y<0) return STONE;
    if (y>=WORLD_HEIGHT) return AIR;
    const cx = Math.floor(x/CHUNK_SIZE), cz = Math.floor(z/CHUNK_SIZE);
    const c = chunks.get(key(cx,cz));
    if (!c) return AIR;
    const lx = ((x%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    const lz = ((z%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    return c.data[idx(lx,y,lz)];
  }
  function setBlock(x,y,z,type){
    if (y<0||y>=WORLD_HEIGHT) return;
    const cx = Math.floor(x/CHUNK_SIZE), cz = Math.floor(z/CHUNK_SIZE);
    const c = chunks.get(key(cx,cz));
    if (!c) return;
    const lx = ((x%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    const lz = ((z%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
    c.data[idx(lx,y,lz)] = type;
    c.dirty = true;
    allChanges.set(x+','+y+','+z, type);
    if (lx===0) markDirty(cx-1,cz);
    if (lx===CHUNK_SIZE-1) markDirty(cx+1,cz);
    if (lz===0) markDirty(cx,cz-1);
    if (lz===CHUNK_SIZE-1) markDirty(cx,cz+1);
  }
  function markDirty(cx,cz){ const c = chunks.get(key(cx,cz)); if (c) c.dirty = true; }

  /* ---------------------------------------------------------
     4. CHUNK MESH BUILDING (face-culled, atlas-textured)
  --------------------------------------------------------- */
  const FACES = [
    { dir:[1,0,0],  name:'side',   corners:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
    { dir:[-1,0,0], name:'side',   corners:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
    { dir:[0,1,0],  name:'top',    corners:[[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
    { dir:[0,-1,0], name:'bottom', corners:[[0,0,1],[0,0,0],[1,0,0],[1,0,1]] },
    { dir:[0,0,1],  name:'side',   corners:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
    { dir:[0,0,-1], name:'side',   corners:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
  ];
  FACES.forEach(f => {
    const n = f.dir.findIndex(v => v !== 0);
    const others = [0,1,2].filter(a => a !== n);
    f.normalAxis = n; f.uAxis = others[0]; f.vAxis = others[1];
  });

  const solidMaterial = new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: true });
  const waterMaterial = new THREE.MeshLambertMaterial({
    map: atlasTexture, vertexColors: true, transparent: true, opacity: 0.68,
    depthWrite: false, side: THREE.DoubleSide
  });

  function buildChunkMesh(cx, cz){
    const c = chunks.get(key(cx,cz));
    if (!c) return;
    const baseX = cx*CHUNK_SIZE, baseZ = cz*CHUNK_SIZE;

    const sPos=[], sNorm=[], sCol=[], sUV=[], sIdx=[];
    const wPos=[], wNorm=[], wCol=[], wUV=[], wIdx=[];
    let sVert=0, wVert=0;

    for (let lx=0; lx<CHUNK_SIZE; lx++){
      for (let lz=0; lz<CHUNK_SIZE; lz++){
        for (let y=0; y<WORLD_HEIGHT; y++){
          const t = c.data[idx(lx,y,lz)];
          if (t === AIR) continue;
          const wx=baseX+lx, wy=y, wz=baseZ+lz;
          const transparent = isTransparent(t);

          for (const f of FACES){
            const nx=wx+f.dir[0], ny=wy+f.dir[1], nz=wz+f.dir[2];
            const nt = getBlock(nx,ny,nz);
            let draw;
            if (!transparent) draw = isTransparent(nt);
            else if (t === WATER) draw = nt === AIR;
            else draw = nt === AIR || (nt !== GLASS && isTransparent(nt));
            if (!draw) continue;

            const tileIdx = tileFor(t, f.name);
            const uvRect = getTileUV(tileIdx);
            let shade = 1.0;
            if (f.name === 'top') shade = 1.0;
            else if (f.name === 'bottom') shade = 0.55;
            else shade = f.dir[0] !== 0 ? 0.78 : 0.85;

            const P = transparent ? wPos : sPos, N = transparent ? wNorm : sNorm,
                  C = transparent ? wCol : sCol, U = transparent ? wUV : sUV,
                  I = transparent ? wIdx : sIdx;
            let vCount = transparent ? wVert : sVert;

            for (const corner of f.corners){
              P.push(wx+corner[0], wy+corner[1], wz+corner[2]);
              N.push(f.dir[0], f.dir[1], f.dir[2]);
              C.push(shade, shade, shade);
              const u = corner[f.uAxis], v = corner[f.vAxis];
              U.push(uvRect.u0 + u*(uvRect.u1-uvRect.u0), uvRect.v0 + v*(uvRect.v1-uvRect.v0));
            }
            I.push(vCount, vCount+1, vCount+2, vCount, vCount+2, vCount+3);
            if (transparent) wVert += 4; else sVert += 4;
          }
        }
      }
    }

    if (c.mesh){ scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh=null; }
    if (c.waterMesh){ scene.remove(c.waterMesh); c.waterMesh.geometry.dispose(); c.waterMesh=null; }

    if (sPos.length){
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(sPos,3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(sNorm,3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(sCol,3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(sUV,2));
      geo.setIndex(sIdx);
      const mesh = new THREE.Mesh(geo, solidMaterial);
      scene.add(mesh);
      c.mesh = mesh;
    }
    if (wPos.length){
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(wPos,3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(wNorm,3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(wCol,3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(wUV,2));
      geo.setIndex(wIdx);
      const mesh = new THREE.Mesh(geo, waterMaterial);
      scene.add(mesh);
      c.waterMesh = mesh;
    }
    c.dirty = false;
  }

  /* ---------------------------------------------------------
     5. THREE.JS SCENE
  --------------------------------------------------------- */
  const canvas = document.getElementById('gameCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const SKY_DAY = new THREE.Color(0x8fd3ff);
  const SKY_NIGHT = new THREE.Color(0x0a1020);
  scene.background = SKY_DAY.clone();
  scene.fog = new THREE.Fog(SKY_DAY.getHex(), 36, CHUNK_SIZE*(RENDER_DIST+1));

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.05, 1000);
  camera.rotation.order = 'YXZ';

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x445566, 0.55);
  scene.add(hemiLight);
  const sunLight = new THREE.DirectionalLight(0xfff3d6, 1.0);
  sunLight.position.set(60,90,40);
  scene.add(sunLight); scene.add(sunLight.target);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ---------------------------------------------------------
     6. PLAYER + PHYSICS
  --------------------------------------------------------- */
  const player = {
    pos: new THREE.Vector3(0,0,0), vel: new THREE.Vector3(0,0,0),
    onGround:false, flying:false, yaw:0, pitch:0,
    width:0.6, height:1.8, eyeHeight:1.62
  };
  let bobPhase = 0;

  function spawnPlayer(){
    const sh = heightAt(0,0) + 2;
    player.pos.set(0.5, sh, 0.5);
    player.vel.set(0,0,0);
    player.yaw = 0; player.pitch = 0;
  }

  function collidesAt(px,py,pz){
    const half = player.width/2;
    const minX=Math.floor(px-half), maxX=Math.floor(px+half);
    const minY=Math.floor(py), maxY=Math.floor(py+player.height);
    const minZ=Math.floor(pz-half), maxZ=Math.floor(pz+half);
    for (let x=minX;x<=maxX;x++)
      for (let y=minY;y<=maxY;y++)
        for (let z=minZ;z<=maxZ;z++)
          if (isSolidForPhysics(getBlock(x,y,z))) return true;
    return false;
  }

  function getMoveInput(){
    if (touch.move.active) return { f: touch.move.f, r: touch.move.r };
    const k = input.keys;
    let f = (k['KeyW']?1:0) - (k['KeyS']?1:0);
    let r = (k['KeyD']?1:0) - (k['KeyA']?1:0);
    const len = Math.hypot(f,r);
    if (len>0){ f/=len; r/=len; }
    return { f, r };
  }

  function updatePlayerPhysics(dt){
    const { f: moveF, r: moveR } = getMoveInput();
    const yaw = player.yaw;
    const fx=-Math.sin(yaw), fz=-Math.cos(yaw);
    const rx=Math.cos(yaw), rz=-Math.sin(yaw);
    const dirX = fx*moveF + rx*moveR;
    const dirZ = fz*moveF + rz*moveR;
    const sprint = input.keys['ShiftLeft'] || input.keys['ShiftRight'];

    if (player.flying){
      const speed = FLY_SPEED * (sprint?1.6:1);
      player.vel.x = dirX*speed; player.vel.z = dirZ*speed;
      let vy = 0;
      if (input.keys['Space'] || touch.jump) vy += 1;
      if (input.keys['ControlLeft'] || input.keys['KeyC']) vy -= 1;
      player.vel.y = vy*speed;
    } else {
      const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
      player.vel.x = dirX*speed; player.vel.z = dirZ*speed;
      player.vel.y -= GRAVITY*dt;
      if (player.vel.y < -40) player.vel.y = -40;
      if ((input.keys['Space'] || touch.jump) && player.onGround){
        player.vel.y = JUMP_SPEED;
        player.onGround = false;
      }
    }

    const p = player.pos;
    let nx = p.x + player.vel.x*dt;
    if (!collidesAt(nx,p.y,p.z)) p.x = nx; else player.vel.x = 0;
    let nz = p.z + player.vel.z*dt;
    if (!collidesAt(p.x,p.y,nz)) p.z = nz; else player.vel.z = 0;
    let ny = p.y + player.vel.y*dt;
    if (!collidesAt(p.x,ny,p.z)){ p.y = ny; player.onGround = false; }
    else { if (player.vel.y<0) player.onGround = true; player.vel.y = 0; }

    const hSpeed = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && hSpeed>0.2 && !player.flying) bobPhase += dt*hSpeed*1.8;
    else bobPhase += dt*1.2;
    const bobY = (player.onGround && !player.flying) ? Math.abs(Math.sin(bobPhase*2))*0.045*Math.min(hSpeed/WALK_SPEED,1) : 0;

    camera.position.set(p.x, p.y+player.eyeHeight+bobY, p.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
  }

  /* ---------------------------------------------------------
     7. INPUT — desktop keyboard/mouse + pointer lock
  --------------------------------------------------------- */
  const input = { keys:{}, selected:0 };
  const touch = { move:{f:0,r:0,active:false}, jump:false, lookId:null, joyId:null, lastX:0, lastY:0 };
  let pointerLocked = false;
  let state = 'title'; // 'title' | 'playing' | 'paused'

  document.addEventListener('keydown', e => {
    input.keys[e.code] = true;
    if (state !== 'playing') return;
    if (e.code === 'KeyF'){ player.flying = !player.flying; player.vel.set(0,0,0); }
    const num = parseInt(e.key, 10);
    if (num>=1 && num<=9){ input.selected = num-1; updateHotbarActive(); }
  });
  document.addEventListener('keyup', e => { input.keys[e.code] = false; });

  document.addEventListener('wheel', e => {
    if (state !== 'playing') return;
    const dir = e.deltaY>0 ? 1 : -1;
    input.selected = (input.selected+dir+HOTBAR_BLOCKS.length)%HOTBAR_BLOCKS.length;
    updateHotbarActive();
  });

  document.addEventListener('mousemove', e => {
    if (!pointerLocked || state !== 'playing') return;
    player.yaw -= e.movementX*MOUSE_SENS;
    player.pitch -= e.movementY*MOUSE_SENS;
    const lim = Math.PI/2 - 0.01;
    player.pitch = clamp(player.pitch, -lim, lim);
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked && state === 'playing' && !isTouch) pauseGame();
  });

  canvas.addEventListener('mousedown', e => {
    if (state !== 'playing' || isTouch) return;
    if (!pointerLocked) return;
    if (e.button===0) breakBlock(); else if (e.button===2) placeBlock();
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  /* voxel raycast by stepping along view ray */
  function raycastVoxel(){
    const origin = camera.position;
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const step = 0.05;
    let prev = { x:Math.floor(origin.x), y:Math.floor(origin.y), z:Math.floor(origin.z) };
    for (let t=0; t<REACH; t+=step){
      const px=origin.x+dir.x*t, py=origin.y+dir.y*t, pz=origin.z+dir.z*t;
      const bx=Math.floor(px), by=Math.floor(py), bz=Math.floor(pz);
      const block = getBlock(bx,by,bz);
      if (block !== AIR && block !== WATER) return { hit:{x:bx,y:by,z:bz}, before:prev };
      prev = { x:bx, y:by, z:bz };
    }
    return null;
  }
  function breakBlock(){
    if (state !== 'playing') return;
    const r = raycastVoxel();
    if (!r) return;
    setBlock(r.hit.x, r.hit.y, r.hit.z, AIR);
  }
  function placeBlock(){
    if (state !== 'playing') return;
    const r = raycastVoxel();
    if (!r) return;
    const { x, y, z } = r.before;
    const half = player.width/2, px=player.pos.x, py=player.pos.y, pz=player.pos.z;
    const overlaps = x+1>px-half && x<px+half && z+1>pz-half && z<pz+half && y+1>py && y<py+player.height;
    if (overlaps) return;
    if (getBlock(x,y,z) !== AIR) return;
    setBlock(x, y, z, HOTBAR_BLOCKS[input.selected]);
  }

  /* ---------------------------------------------------------
     8. TOUCH CONTROLS (pointer events: joystick, look, buttons)
  --------------------------------------------------------- */
  const joystickBase = document.getElementById('joystickBase');
  const joystickThumb = document.getElementById('joystickThumb');
  const lookZone = document.getElementById('lookZone');
  const jumpBtn = document.getElementById('jumpBtn');
  const breakBtn = document.getElementById('breakBtn');
  const placeBtn = document.getElementById('placeBtn');

  function updateJoystick(e){
    const rect = joystickBase.getBoundingClientRect();
    const cx = rect.left+rect.width/2, cy = rect.top+rect.height/2;
    let dx = e.clientX-cx, dy = e.clientY-cy;
    const maxR = 36;
    const dist = Math.hypot(dx,dy);
    if (dist > maxR){ dx = dx/dist*maxR; dy = dy/dist*maxR; }
    joystickThumb.style.transform = `translate(${dx}px,${dy}px)`;
    touch.move.f = -dy/maxR; touch.move.r = dx/maxR; touch.move.active = true;
  }
  function resetJoystick(){
    joystickThumb.style.transform = 'translate(0,0)';
    touch.move.f = 0; touch.move.r = 0; touch.move.active = false; touch.joyId = null;
  }
  joystickBase.addEventListener('pointerdown', e => {
    e.preventDefault(); touch.joyId = e.pointerId;
    joystickBase.setPointerCapture(e.pointerId); updateJoystick(e);
  });
  joystickBase.addEventListener('pointermove', e => { if (e.pointerId===touch.joyId) updateJoystick(e); });
  joystickBase.addEventListener('pointerup', e => { if (e.pointerId===touch.joyId) resetJoystick(); });
  joystickBase.addEventListener('pointercancel', () => resetJoystick());

  lookZone.addEventListener('pointerdown', e => {
    e.preventDefault(); touch.lookId = e.pointerId;
    touch.lastX = e.clientX; touch.lastY = e.clientY;
    lookZone.setPointerCapture(e.pointerId);
  });
  lookZone.addEventListener('pointermove', e => {
    if (e.pointerId !== touch.lookId || state !== 'playing') return;
    const dx = e.clientX-touch.lastX, dy = e.clientY-touch.lastY;
    touch.lastX = e.clientX; touch.lastY = e.clientY;
    player.yaw -= dx*TOUCH_SENS; player.pitch -= dy*TOUCH_SENS;
    const lim = Math.PI/2-0.01; player.pitch = clamp(player.pitch,-lim,lim);
  });
  lookZone.addEventListener('pointerup', e => { if (e.pointerId===touch.lookId) touch.lookId = null; });
  lookZone.addEventListener('pointercancel', () => { touch.lookId = null; });

  jumpBtn.addEventListener('pointerdown', e => { e.preventDefault(); touch.jump = true; });
  ['pointerup','pointercancel','pointerleave'].forEach(ev =>
    jumpBtn.addEventListener(ev, () => { touch.jump = false; }));

  function holdRepeat(btn, fn, interval){
    let timer = null;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault(); fn();
      timer = setInterval(fn, interval);
    });
    ['pointerup','pointercancel','pointerleave'].forEach(ev =>
      btn.addEventListener(ev, () => { if (timer){ clearInterval(timer); timer=null; } }));
  }
  holdRepeat(breakBtn, breakBlock, 260);
  holdRepeat(placeBtn, placeBlock, 320);

  /* ---------------------------------------------------------
     9. HOTBAR UI
  --------------------------------------------------------- */
  const hotbarEl = document.getElementById('hotbar');
  function buildHotbarUI(){
    hotbarEl.innerHTML = '';
    HOTBAR_BLOCKS.forEach((b,i) => {
      const slot = document.createElement('div');
      slot.className = 'hotSlot' + (i===input.selected ? ' active' : '');
      slot.style.backgroundImage = `url(${makeIconDataURL(b)})`;
      slot.style.backgroundSize = 'cover';
      slot.style.imageRendering = 'pixelated';
      const num = document.createElement('span');
      num.className = 'slotNum';
      num.textContent = i+1;
      slot.appendChild(num);
      slot.addEventListener('pointerdown', e => { e.preventDefault(); input.selected = i; updateHotbarActive(); });
      hotbarEl.appendChild(slot);
    });
  }
  function updateHotbarActive(){
    [...hotbarEl.children].forEach((slot,i) => slot.classList.toggle('active', i===input.selected));
  }

  /* ---------------------------------------------------------
     10. CHUNK STREAMING
  --------------------------------------------------------- */
  function updateChunks(){
    const pcx = Math.floor(player.pos.x/CHUNK_SIZE), pcz = Math.floor(player.pos.z/CHUNK_SIZE);
    const needed = new Set();
    for (let dx=-RENDER_DIST; dx<=RENDER_DIST; dx++)
      for (let dz=-RENDER_DIST; dz<=RENDER_DIST; dz++){
        const cx=pcx+dx, cz=pcz+dz;
        needed.add(key(cx,cz));
        ensureChunkData(cx,cz);
      }
    for (const k of needed){
      const c = chunks.get(k);
      if (c && (c.dirty || !c.mesh)){
        const parts = k.split(','); buildChunkMesh(+parts[0], +parts[1]);
        return;
      }
    }
    for (const [k,c] of chunks){
      if (!needed.has(k)){
        const parts = k.split(','); const cx=+parts[0], cz=+parts[1];
        if (Math.abs(cx-pcx)>RENDER_DIST+1 || Math.abs(cz-pcz)>RENDER_DIST+1){
          if (c.mesh){ scene.remove(c.mesh); c.mesh.geometry.dispose(); }
          if (c.waterMesh){ scene.remove(c.waterMesh); c.waterMesh.geometry.dispose(); }
          chunks.delete(k);
        }
      }
    }
  }

  function disposeAllChunks(){
    for (const [,c] of chunks){
      if (c.mesh){ scene.remove(c.mesh); c.mesh.geometry.dispose(); }
      if (c.waterMesh){ scene.remove(c.waterMesh); c.waterMesh.geometry.dispose(); }
    }
    chunks.clear();
  }

  /* ---------------------------------------------------------
     11. DAY / NIGHT CYCLE
  --------------------------------------------------------- */
  let worldTime = 0.25;
  const DAY_LENGTH = 240;
  function updateDayNight(dt){
    worldTime += dt/DAY_LENGTH;
    if (worldTime>1) worldTime -= 1;
    const angle = worldTime*Math.PI*2;
    const sunHeight = Math.sin(angle);
    sunLight.position.set(Math.cos(angle)*80, Math.max(sunHeight,0.05)*90, 40);
    sunLight.target.position.copy(player.pos);
    const dayFactor = Math.max(0, sunHeight);
    sunLight.intensity = 0.25 + dayFactor*0.9;
    hemiLight.intensity = 0.25 + dayFactor*0.4;
    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, dayFactor);
    scene.background = sky; scene.fog.color = sky;
  }

  /* ---------------------------------------------------------
     12. SAVE / LOAD
  --------------------------------------------------------- */
  const newWorldBtn = document.getElementById('newWorldBtn');
  const continueBtn = document.getElementById('continueBtn');
  const seedInput = document.getElementById('seedInput');
  let currentSeed = '';

  function refreshContinueVisibility(){
    const raw = localStorage.getItem(SAVE_KEY);
    continueBtn.style.display = raw ? 'block' : 'none';
  }
  function saveWorld(showMsg){
    try {
      const data = {
        seed: currentSeed,
        changes: Array.from(allChanges.entries()),
        player: { x:player.pos.x, y:player.pos.y, z:player.pos.z, yaw:player.yaw, pitch:player.pitch },
        time: worldTime,
        selected: input.selected
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      if (showMsg) showToast('World saved ✓');
      refreshContinueVisibility();
    } catch (e){
      if (showMsg) showToast('Save failed — storage full?');
    }
  }

  function startNewWorld(){
    let seed = seedInput.value.trim();
    if (!seed) seed = 'seed-' + Math.floor(Math.random()*1e6);
    currentSeed = seed;
    noise = new NeoNoise(seed);
    SEED_INT = seedToInt(seed);
    allChanges = new Map();
    disposeAllChunks();
    worldTime = 0.25;
    spawnPlayer();
    beginWorldLoad(() => showToast('New world "' + seed + '" ready!'));
  }

  function continueSavedWorld(){
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw){ showToast('No saved world found.'); return; }
    let data;
    try { data = JSON.parse(raw); } catch (e){ showToast('Save data corrupted.'); return; }
    currentSeed = data.seed || ('seed-' + Math.floor(Math.random()*1e6));
    noise = new NeoNoise(currentSeed);
    SEED_INT = seedToInt(currentSeed);
    allChanges = new Map(data.changes || []);
    worldTime = typeof data.time === 'number' ? data.time : 0.25;
    disposeAllChunks();
    if (data.player){
      player.pos.set(data.player.x, data.player.y, data.player.z);
      player.yaw = data.player.yaw || 0;
      player.pitch = data.player.pitch || 0;
      player.vel.set(0,0,0);
    } else spawnPlayer();
    if (typeof data.selected === 'number') input.selected = data.selected;
    beginWorldLoad(() => showToast('Welcome back!'));
  }

  function beginWorldLoad(cb){
    newWorldBtn.disabled = true; continueBtn.disabled = true;
    const origNewText = 'New World';
    const pcx = Math.floor(player.pos.x/CHUNK_SIZE), pcz = Math.floor(player.pos.z/CHUNK_SIZE);
    const list = [];
    for (let dx=-RENDER_DIST; dx<=RENDER_DIST; dx++)
      for (let dz=-RENDER_DIST; dz<=RENDER_DIST; dz++) list.push([pcx+dx,pcz+dz]);
    list.sort((a,b) => (a[0]*a[0]+a[1]*a[1]) - (b[0]*b[0]+b[1]*b[1]));

    let i = 0;
    function step(){
      const batch = 2;
      for (let n=0; n<batch && i<list.length; n++, i++){
        ensureChunkData(list[i][0], list[i][1]);
        buildChunkMesh(list[i][0], list[i][1]);
      }
      const pct = Math.round(i/list.length*100);
      newWorldBtn.textContent = 'Generating... ' + pct + '%';
      continueBtn.textContent = 'Generating... ' + pct + '%';
      if (i < list.length) requestAnimationFrame(step);
      else finish();
    }
    function finish(){
      newWorldBtn.disabled = false; newWorldBtn.textContent = origNewText;
      continueBtn.disabled = false; continueBtn.textContent = 'Continue Saved World';
      document.getElementById('titleScreen').classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
      document.getElementById('crosshair').style.display = '';
      buildHotbarUI();
      state = 'playing';
      if (!isTouch){
        showToast('Click anywhere to look around');
        const onFirstClick = () => { canvas.requestPointerLock(); canvas.removeEventListener('click', onFirstClick); };
        canvas.addEventListener('click', onFirstClick);
      }
      cb && cb();
    }
    step();
  }

  newWorldBtn.addEventListener('click', startNewWorld);
  continueBtn.addEventListener('click', continueSavedWorld);

  /* ---------------------------------------------------------
     13. PAUSE MENU
  --------------------------------------------------------- */
  const pauseMenu = document.getElementById('pauseMenu');
  document.getElementById('menuBtn').addEventListener('click', pauseGame);
  document.getElementById('resumeBtn').addEventListener('click', resumeGame);
  document.getElementById('saveBtn').addEventListener('click', () => saveWorld(true));
  document.getElementById('quitBtn').addEventListener('click', quitToTitle);

  function pauseGame(){
    if (state !== 'playing') return;
    state = 'paused';
    pauseMenu.classList.remove('hidden');
    document.getElementById('crosshair').style.display = 'none';
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  function resumeGame(){
    if (state !== 'paused') return;
    pauseMenu.classList.add('hidden');
    document.getElementById('crosshair').style.display = '';
    state = 'playing';
    if (!isTouch) canvas.requestPointerLock();
  }
  function quitToTitle(){
    state = 'title';
    pauseMenu.classList.add('hidden');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('crosshair').style.display = 'none';
    document.getElementById('titleScreen').classList.remove('hidden');
    disposeAllChunks();
    refreshContinueVisibility();
  }

  /* ---------------------------------------------------------
     14. TOAST + DEVICE HINT
  --------------------------------------------------------- */
  let toastTimer = null;
  function showToast(msg, duration){
    duration = duration || 2200;
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  document.getElementById('deviceHint').textContent = isTouch
    ? 'Touch controls detected — joystick & buttons below.'
    : 'Keyboard + mouse detected — WASD to move, mouse to look.';
  if (isTouch){
    const hint = document.getElementById('controlsHintDesktop');
    if (hint) hint.classList.add('hidden');
  }
  document.getElementById('touchControls').classList.toggle('hidden', !isTouch);
  refreshContinueVisibility();

  /* ---------------------------------------------------------
     15. HUD (fps)
  --------------------------------------------------------- */
  const fpsBadge = document.getElementById('fpsBadge');
  let frameCount=0, fpsTimer=0, fps=0;
  function updateHUD(dt){
    frameCount++; fpsTimer += dt;
    if (fpsTimer >= 0.5){ fps = Math.round(frameCount/fpsTimer); frameCount=0; fpsTimer=0; }
    fpsBadge.textContent = fps + ' FPS';
  }

  /* autosave every 60s while playing */
  setInterval(() => { if (state === 'playing') saveWorld(false); }, 60000);

  /* ---------------------------------------------------------
     16. MAIN LOOP
  --------------------------------------------------------- */
  const clock = new THREE.Clock();
  function animate(){
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (state === 'playing'){
      updatePlayerPhysics(dt);
      updateDayNight(dt);
      updateChunks();
      updateHUD(dt);
      renderer.render(scene, camera);
    } else if (state === 'paused'){
      renderer.render(scene, camera);
    }
    // when state === 'title', skip rendering to save battery
  }
  animate();

  } // end initGame
})();
