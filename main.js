/* ============================================================
   NEO CRAFT — a neon voxel sandbox
   Single-file game engine built on three.js.
   Sections: config, world/terrain, mesh building, player physics,
   input (keyboard/mouse/touch), day-night, save/load, UI wiring.
   ============================================================ */

//////////////////////// CONFIG ////////////////////////

const CHUNK = 16;                 // blocks per chunk edge
const CHUNKS_PER_AXIS = 3;        // 3x3 chunks
const WORLD_SIZE = CHUNK * CHUNKS_PER_AXIS; // 48
const WORLD_HEIGHT = 28;
const SEA_LEVEL = 9;
const BLOCK_SIZE = 1;
const REACH = 6; // block interaction distance

const BLOCKS = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4,
  WOOD: 5, LEAVES: 6, WATER: 7, GLOW: 8, PLANK: 9
};

const LIQUID = new Set([BLOCKS.WATER]);
const TRANSPARENT = new Set([BLOCKS.AIR, BLOCKS.WATER, BLOCKS.LEAVES]);

// Base colors per block (top / side / bottom) as hex ints
const BLOCK_COLORS = {
  [BLOCKS.GRASS]: { top: 0x5fd35a, side: 0x4a8f3f, bottom: 0x6b4a2f },
  [BLOCKS.DIRT]:  { top: 0x6b4a2f, side: 0x6b4a2f, bottom: 0x6b4a2f },
  [BLOCKS.STONE]: { top: 0x7d8698, side: 0x7d8698, bottom: 0x7d8698 },
  [BLOCKS.SAND]:  { top: 0xe4d692, side: 0xe4d692, bottom: 0xe4d692 },
  [BLOCKS.WOOD]:  { top: 0x8a6a45, side: 0x5a4128, bottom: 0x5a4128 },
  [BLOCKS.LEAVES]:{ top: 0x2fbf8f, side: 0x28a67a, bottom: 0x28a67a },
  [BLOCKS.WATER]: { top: 0x2fd0e6, side: 0x2fd0e6, bottom: 0x2fd0e6 },
  [BLOCKS.GLOW]:  { top: 0xd66bff, side: 0xb026ff, bottom: 0xb026ff },
  [BLOCKS.PLANK]: { top: 0xc99a5b, side: 0xc99a5b, bottom: 0xc99a5b },
};

const HOTBAR_ORDER = [BLOCKS.GRASS, BLOCKS.DIRT, BLOCKS.STONE, BLOCKS.SAND, BLOCKS.WOOD, BLOCKS.LEAVES, BLOCKS.GLOW, BLOCKS.PLANK];

function idx(x, y, z) {
  return (x * WORLD_SIZE + z) * WORLD_HEIGHT + y;
}
function inBounds(x, y, z) {
  return x >= 0 && z >= 0 && x < WORLD_SIZE && z < WORLD_SIZE && y >= 0 && y < WORLD_HEIGHT;
}

//////////////////////// WORLD ////////////////////////

class NeoWorld {
  constructor(seed) {
    this.seed = seed;
    this.data = new Uint8Array(WORLD_SIZE * WORLD_SIZE * WORLD_HEIGHT);
    this.heightNoise = new NeoNoise(seed + '_h');
    this.moistNoise = new NeoNoise(seed + '_m');
    this.treeRand = makeSeededRandom(seed + '_t');
    this.chunkGroups = new Map(); // key "cx,cz" -> THREE.Group
    this.dirtyChunks = new Set();
  }

  get(x, y, z) {
    if (!inBounds(x, y, z)) return BLOCKS.AIR;
    return this.data[idx(x, y, z)];
  }
  set(x, y, z, val) {
    if (!inBounds(x, y, z)) return;
    this.data[idx(x, y, z)] = val;
    this._markChunkDirty(x, z);
  }
  _markChunkDirty(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    this.dirtyChunks.add(cx + ',' + cz);
    // also mark neighbor chunk dirty if on border (face culling across chunk boundary)
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    if (lx === 0) this.dirtyChunks.add((cx - 1) + ',' + cz);
    if (lx === CHUNK - 1) this.dirtyChunks.add((cx + 1) + ',' + cz);
    if (lz === 0) this.dirtyChunks.add(cx + ',' + (cz - 1));
    if (lz === CHUNK - 1) this.dirtyChunks.add(cx + ',' + (cz + 1));
  }

  heightAt(x, z) {
    const n = this.heightNoise.fbm(x / 42, z / 42, 4, 2.1, 0.5);
    return Math.max(1, Math.min(WORLD_HEIGHT - 4, Math.floor(4 + n * 16)));
  }

  generate() {
    for (let x = 0; x < WORLD_SIZE; x++) {
      for (let z = 0; z < WORLD_SIZE; z++) {
        const h = this.heightAt(x, z);
        const moist = this.moistNoise.fbm(x / 30, z / 30, 3, 2, 0.5);
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          let b = BLOCKS.AIR;
          if (y < h - 3) b = BLOCKS.STONE;
          else if (y < h - 1) b = BLOCKS.DIRT;
          else if (y === h - 1) {
            if (h - 1 <= SEA_LEVEL + 1 && moist < 0.55) b = BLOCKS.SAND;
            else b = BLOCKS.GRASS;
          } else if (y < SEA_LEVEL && h - 1 < SEA_LEVEL) {
            b = BLOCKS.WATER;
          }
          this.data[idx(x, y, z)] = b;
        }
      }
    }
    // scatter trees on grass
    for (let x = 2; x < WORLD_SIZE - 2; x++) {
      for (let z = 2; z < WORLD_SIZE - 2; z++) {
        const h = this.heightAt(x, z);
        if (this.get(x, h - 1, z) === BLOCKS.GRASS && this.treeRand() < 0.02) {
          this._plantTree(x, h, z);
        }
      }
    }
  }

  _plantTree(x, y, z) {
    const trunk = 3 + Math.floor(this.treeRand() * 2);
    for (let i = 0; i < trunk; i++) {
      if (inBounds(x, y + i, z)) this.data[idx(x, y + i, z)] = BLOCKS.WOOD;
    }
    const top = y + trunk;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) <= 3) {
            const bx = x + dx, by = top + dy, bz = z + dz;
            if (inBounds(bx, by, bz) && this.data[idx(bx, by, bz)] === BLOCKS.AIR) {
              this.data[idx(bx, by, bz)] = BLOCKS.LEAVES;
            }
          }
        }
      }
    }
  }

  serialize() {
    let bin = '';
    const chunkStep = 8192;
    for (let i = 0; i < this.data.length; i += chunkStep) {
      bin += String.fromCharCode.apply(null, this.data.subarray(i, i + chunkStep));
    }
    return btoa(bin);
  }
  static deserialize(seed, b64) {
    const w = new NeoWorld(seed);
    const bin = atob(b64);
    for (let i = 0; i < bin.length; i++) w.data[i] = bin.charCodeAt(i);
    return w;
  }
}

//////////////////////// MESH BUILDING ////////////////////////

const FACE_DEFS = [
  { dir: [1, 0, 0],  corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], shade: 0.75 }, // +x
  { dir: [-1, 0, 0], corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], shade: 0.75 }, // -x
  { dir: [0, 1, 0],  corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], shade: 1.0 },  // +y top
  { dir: [0, -1, 0], corners: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]], shade: 0.5 },  // -y bottom
  { dir: [0, 0, 1],  corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]], shade: 0.85 }, // +z
  { dir: [0, 0, -1], corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]], shade: 0.85 }, // -z
];

function colorFor(block, faceIdx) {
  const c = BLOCK_COLORS[block];
  if (!c) return 0xffffff;
  if (faceIdx === 2) return c.top;
  if (faceIdx === 3) return c.bottom;
  return c.side;
}

function buildChunkMesh(world, cx, cz) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const wPositions = []; const wNormals = []; const wColors = []; const wIndices = [];

  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  let vCount = 0, wvCount = 0;

  for (let lx = 0; lx < CHUNK; lx++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      const x = x0 + lx, z = z0 + lz;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        const b = world.get(x, y, z);
        if (b === BLOCKS.AIR) continue;
        const isWater = LIQUID.has(b);

        for (let f = 0; f < FACE_DEFS.length; f++) {
          const def = FACE_DEFS[f];
          const nx = x + def.dir[0], ny = y + def.dir[1], nz = z + def.dir[2];
          const neighbor = world.get(nx, ny, nz);
          const neighborIsSameLiquid = isWater && neighbor === b;
          const visible = neighbor === BLOCKS.AIR ||
            (TRANSPARENT.has(neighbor) && neighbor !== b) ||
            (isWater && neighbor === BLOCKS.AIR);
          if (neighborIsSameLiquid) continue;
          if (!visible) continue;

          const col = new THREE.Color(colorFor(b, f));
          const shade = def.shade;
          col.r *= shade; col.g *= shade; col.b *= shade;

          const baseX = x, baseY = y, baseZ = z;
          const arrP = isWater ? wPositions : positions;
          const arrN = isWater ? wNormals : normals;
          const arrC = isWater ? wColors : colors;
          const arrI = isWater ? wIndices : indices;
          let vc = isWater ? wvCount : vCount;

          for (const corner of def.corners) {
            arrP.push(baseX + corner[0], baseY + corner[1], baseZ + corner[2]);
            arrN.push(def.dir[0], def.dir[1], def.dir[2]);
            arrC.push(col.r, col.g, col.b);
          }
          arrI.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
          if (isWater) wvCount += 4; else vCount += 4;
        }
      }
    }
  }

  function makeMesh(pos, norm, col, ind, transparent) {
    if (pos.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(ind);
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: transparent,
      opacity: transparent ? 0.72 : 1,
      side: THREE.FrontSide,
    });
    return new THREE.Mesh(geo, mat);
  }

  const group = new THREE.Group();
  const solidMesh = makeMesh(positions, normals, colors, indices, false);
  const waterMesh = makeMesh(wPositions, wNormals, wColors, wIndices, true);
  if (solidMesh) { solidMesh.userData.isTerrain = true; group.add(solidMesh); }
  if (waterMesh) group.add(waterMesh);
  return group;
}

//////////////////////// GAME ////////////////////////

class NeoGame {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !this.isMobile });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.isMobile ? 1.5 : 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);

    this.clock = new THREE.Clock();
    this.time = 0; // day-night 0..1
    this.glowLights = [];
    this.selectedBlock = HOTBAR_ORDER[0];
    this.paused = false;
    this.pointerLocked = false;

    this._setupLights();
    this._setupInput();
    window.addEventListener('resize', () => this._onResize());
  }

  _setupLights() {
    this.hemi = new THREE.HemisphereLight(0x8fd6ff, 0x1a1230, 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.9);
    this.sun.position.set(60, 100, 40);
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0x404060, 0.35));
  }

  newWorld(seedStr) {
    const seed = seedStr && seedStr.trim() ? seedStr.trim() : String(Math.floor(Math.random() * 1e9));
    this.seed = seed;
    this.world = new NeoWorld(seed);
    this.world.generate();
    this._rebuildAllChunks();
    this._placePlayerAtSpawn();
    return seed;
  }

  loadWorld(seed, b64) {
    this.seed = seed;
    this.world = NeoWorld.deserialize(seed, b64);
    this._rebuildAllChunks();
    this._placePlayerAtSpawn();
  }

  _placePlayerAtSpawn() {
    const cx = Math.floor(WORLD_SIZE / 2), cz = Math.floor(WORLD_SIZE / 2);
    const h = this.world.heightAt(cx, cz);
    this.player = {
      pos: new THREE.Vector3(cx + 0.5, h + 2, cz + 0.5),
      vel: new THREE.Vector3(0, 0, 0),
      yaw: Math.PI, pitch: -0.1,
      onGround: false,
      height: 1.7, radius: 0.3, eyeOffset: 1.55,
    };
  }

  _rebuildAllChunks() {
    for (const [key, group] of this.world.chunkGroups) {
      this.scene.remove(group);
    }
    this.world.chunkGroups.clear();
    for (let cx = 0; cx < CHUNKS_PER_AXIS; cx++) {
      for (let cz = 0; cz < CHUNKS_PER_AXIS; cz++) {
        this._rebuildChunk(cx, cz);
      }
    }
  }

  _rebuildChunk(cx, cz) {
    const key = cx + ',' + cz;
    const old = this.world.chunkGroups.get(key);
    if (old) this.scene.remove(old);
    const group = buildChunkMesh(this.world, cx, cz);
    this.world.chunkGroups.set(key, group);
    this.scene.add(group);
  }

  _flushDirtyChunks() {
    if (this.world.dirtyChunks.size === 0) return;
    for (const key of this.world.dirtyChunks) {
      const [cx, cz] = key.split(',').map(Number);
      if (cx < 0 || cz < 0 || cx >= CHUNKS_PER_AXIS || cz >= CHUNKS_PER_AXIS) continue;
      this._rebuildChunk(cx, cz);
    }
    this.world.dirtyChunks.clear();
    this._refreshGlowLights();
  }

  _refreshGlowLights() {
    for (const l of this.glowLights) this.scene.remove(l);
    this.glowLights = [];
    let count = 0;
    const maxLights = 6;
    const px = this.player.pos.x, pz = this.player.pos.z;
    // find nearest glow blocks
    const found = [];
    for (let x = 0; x < WORLD_SIZE; x++) {
      for (let z = 0; z < WORLD_SIZE; z++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          if (this.world.get(x, y, z) === BLOCKS.GLOW) {
            const d = (x - px) * (x - px) + (z - pz) * (z - pz);
            found.push([d, x, y, z]);
          }
        }
      }
    }
    found.sort((a, b) => a[0] - b[0]);
    for (const [d, x, y, z] of found.slice(0, maxLights)) {
      const light = new THREE.PointLight(0xd66bff, 1.4, 9, 2);
      light.position.set(x + 0.5, y + 0.5, z + 0.5);
      this.scene.add(light);
      this.glowLights.push(light);
      count++;
    }
  }

  //////////////// INPUT ////////////////

  _setupInput() {
    this.keys = {};
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= HOTBAR_ORDER.length) this.selectHotbar(n - 1);
      if (e.code === 'Escape') this.togglePause();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    // Desktop mouse look via pointer lock
    this.canvas.addEventListener('click', () => {
      if (!this.isMobile && !this.paused && document.getElementById('hud').classList.contains('hidden') === false) {
        this.canvas.requestPointerLock && this.canvas.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked || !this.player) return;
      this.player.yaw -= e.movementX * 0.0022;
      this.player.pitch -= e.movementY * 0.0022;
      this.player.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.player.pitch));
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.isMobile || this.paused) return;
      if (e.button === 0) this.tryBreak();
      if (e.button === 2) this.tryPlace();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch controls
    this._setupTouch();
  }

  _setupTouch() {
    const joyZone = document.getElementById('joystickZone');
    const joyThumb = document.getElementById('joystickThumb');
    const lookZone = document.getElementById('lookZone');
    this.moveVec = { x: 0, y: 0 };
    let joyTouchId = null, joyCenter = { x: 0, y: 0 };

    joyZone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      joyTouchId = t.identifier;
      const r = joyZone.getBoundingClientRect();
      joyCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      e.preventDefault();
    }, { passive: false });
    joyZone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyTouchId) continue;
        let dx = t.clientX - joyCenter.x, dy = t.clientY - joyCenter.y;
        const max = 45;
        const len = Math.hypot(dx, dy);
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        joyThumb.style.transform = `translate(${dx}px, ${dy}px)`;
        this.moveVec.x = dx / max; this.moveVec.y = dy / max;
      }
      e.preventDefault();
    }, { passive: false });
    const endJoy = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== joyTouchId) continue;
        joyTouchId = null;
        joyThumb.style.transform = 'translate(0,0)';
        this.moveVec.x = 0; this.moveVec.y = 0;
      }
    };
    joyZone.addEventListener('touchend', endJoy);
    joyZone.addEventListener('touchcancel', endJoy);

    let lookTouchId = null, lastLook = { x: 0, y: 0 };
    lookZone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      lookTouchId = t.identifier;
      lastLook = { x: t.clientX, y: t.clientY };
      e.preventDefault();
    }, { passive: false });
    lookZone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== lookTouchId) continue;
        const dx = t.clientX - lastLook.x, dy = t.clientY - lastLook.y;
        lastLook = { x: t.clientX, y: t.clientY };
        if (this.player) {
          this.player.yaw -= dx * 0.0045;
          this.player.pitch -= dy * 0.0045;
          this.player.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.player.pitch));
        }
      }
      e.preventDefault();
    }, { passive: false });
    lookZone.addEventListener('touchend', (e) => {
      for (const t of e.changedTouches) if (t.identifier === lookTouchId) lookTouchId = null;
    });

    document.getElementById('jumpBtn').addEventListener('touchstart', (e) => { e.preventDefault(); this.wantJump = true; }, { passive: false });
    document.getElementById('breakBtn').addEventListener('touchstart', (e) => { e.preventDefault(); this.tryBreak(); }, { passive: false });
    document.getElementById('placeBtn').addEventListener('touchstart', (e) => { e.preventDefault(); this.tryPlace(); }, { passive: false });
  }

  selectHotbar(i) {
    this.selectedBlock = HOTBAR_ORDER[i];
    document.querySelectorAll('.hotSlot').forEach((el, idx2) => {
      el.classList.toggle('active', idx2 === i);
    });
  }

  //////////////// RAYCAST BREAK/PLACE ////////////////

  _raycastVoxel() {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const origin = this.camera.position.clone();
    const step = 0.05;
    let pos = origin.clone();
    let lastAir = null;
    for (let t = 0; t < REACH; t += step) {
      pos = origin.clone().addScaledVector(dir, t);
      const bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z);
      const b = this.world.get(bx, by, bz);
      if (b !== BLOCKS.AIR && !LIQUID.has(b)) {
        return { hit: [bx, by, bz], before: lastAir };
      }
      lastAir = [bx, by, bz];
    }
    return null;
  }

  tryBreak() {
    if (!this.world) return;
    const r = this._raycastVoxel();
    if (!r) return;
    const [x, y, z] = r.hit;
    this.world.set(x, y, z, BLOCKS.AIR);
    this._flushDirtyChunks();
  }

  tryPlace() {
    if (!this.world) return;
    const r = this._raycastVoxel();
    if (!r || !r.before) return;
    const [x, y, z] = r.before;
    // don't place inside player
    const px = Math.floor(this.player.pos.x), py = Math.floor(this.player.pos.y - 0.9), pz = Math.floor(this.player.pos.z);
    if (x === px && z === pz && (y === py || y === py + 1)) return;
    if (!inBounds(x, y, z)) return;
    if (this.world.get(x, y, z) !== BLOCKS.AIR) return;
    this.world.set(x, y, z, this.selectedBlock);
    this._flushDirtyChunks();
  }

  //////////////// PHYSICS ////////////////

  _solidAt(x, y, z) {
    const b = this.world.get(Math.floor(x), Math.floor(y), Math.floor(z));
    return b !== BLOCKS.AIR && !LIQUID.has(b);
  }

  _updatePlayer(dt) {
    const p = this.player;
    const speed = 4.3;
    let mx = 0, mz = 0;
    if (this.keys['KeyW']) mz -= 1;
    if (this.keys['KeyS']) mz += 1;
    if (this.keys['KeyA']) mx -= 1;
    if (this.keys['KeyD']) mx += 1;
    if (this.moveVec) { mx += this.moveVec.x; mz += this.moveVec.y; }
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    const sinY = Math.sin(p.yaw), cosY = Math.cos(p.yaw);
    const forwardX = -sinY, forwardZ = -cosY;
    const rightX = cosY, rightZ = -sinY;
    const moveX = (forwardX * -mz + rightX * mx) * speed;
    const moveZ = (forwardZ * -mz + rightZ * mx) * speed;

    p.vel.x = moveX; p.vel.z = moveZ;

    if ((this.keys['Space'] || this.wantJump) && p.onGround) {
      p.vel.y = 6.4;
      p.onGround = false;
    }
    this.wantJump = false;

    p.vel.y -= 16 * dt; // gravity
    if (p.vel.y < -30) p.vel.y = -30;

    this._moveAxis(p, 'x', p.vel.x * dt);
    this._moveAxis(p, 'z', p.vel.z * dt);
    this._moveAxis(p, 'y', p.vel.y * dt);

    this.camera.position.set(p.pos.x, p.pos.y + p.eyeOffset - p.height, p.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = p.yaw;
    this.camera.rotation.x = p.pitch;
  }

  _moveAxis(p, axis, delta) {
    const r = p.radius;
    p.pos[axis] += delta;
    const feetY = p.pos.y - p.height;
    const topY = p.pos.y - 0.05;

    const checkCollide = () => {
      const xs = [p.pos.x - r, p.pos.x + r];
      const zs = [p.pos.z - r, p.pos.z + r];
      const ys = axis === 'y' ? [p.pos.y - 0.05, feetY + 0.05] : [feetY + 0.1, p.pos.y - 0.1, topY];
      for (const x of xs) for (const z of zs) for (const y of ys) {
        if (this._solidAt(x, y, z)) return true;
      }
      return false;
    };

    if (checkCollide()) {
      if (axis === 'y') {
        if (delta < 0) p.onGround = true;
        p.vel.y = 0;
        // step back out
        const sign = Math.sign(delta) || 1;
        while (checkCollide()) p.pos[axis] -= sign * 0.02;
      } else {
        const sign = Math.sign(delta) || 1;
        while (checkCollide()) p.pos[axis] -= sign * 0.02;
      }
    } else if (axis === 'y' && delta < 0) {
      p.onGround = false;
    }
  }

  //////////////// DAY / NIGHT ////////////////

  _updateDayNight(dt) {
    this.time = (this.time + dt / 180) % 1; // full cycle ~3 min
    const angle = this.time * Math.PI * 2;
    const sunHeight = Math.sin(angle);
    this.sun.position.set(Math.cos(angle) * 80, Math.max(sunHeight, -0.2) * 90 + 20, 40);
    const dayFactor = Math.max(0, sunHeight);
    this.sun.intensity = 0.25 + dayFactor * 0.9;
    this.hemi.intensity = 0.25 + dayFactor * 0.5;

    const skyDay = new THREE.Color(0x1a2b4a);
    const skyNight = new THREE.Color(0x03050c);
    const sky = skyNight.clone().lerp(skyDay, dayFactor);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky.getHex(), 30, 95);
  }

  //////////////// LOOP ////////////////

  start() {
    this._loop();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.paused || !this.world) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this._updatePlayer(dt);
    this._updateDayNight(dt);

    this._fps = 1 / dt;
    this._fpsAccum = (this._fpsAccum || 0) * 0.9 + this._fps * 0.1;
    const badge = document.getElementById('fpsBadge');
    if (badge) badge.textContent = Math.round(this._fpsAccum) + ' FPS';

    this.renderer.render(this.scene, this.camera);
  }

  togglePause() {
    this.paused = !this.paused;
    document.getElementById('pauseMenu').classList.toggle('hidden', !this.paused);
    if (this.paused && this.pointerLocked) document.exitPointerLock && document.exitPointerLock();
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  saveToStorage() {
    if (!this.world) return;
    try {
      const payload = { seed: this.seed, data: this.world.serialize() };
      localStorage.setItem('neocraft_save', JSON.stringify(payload));
      return true;
    } catch (e) {
      console.error('Save failed', e);
      return false;
    }
  }

  static hasSave() {
    try { return !!localStorage.getItem('neocraft_save'); } catch (e) { return false; }
  }
}

//////////////////////// UI WIRING ////////////////////////

let game;
try {
  game = new NeoGame();
} catch (err) {
  console.error('NeoGame failed to initialize', err);
  if (typeof showEngineError === 'function') {
    showEngineError('⚠ Game engine එක start කරන්න බැරි උනා: ' + err.message +
      '. Page එක reload කරලා බලන්න, නැත්නම් වෙන browser එකකින් try කරන්න.');
  }
  throw err;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 2200);
}

function buildHotbar() {
  const bar = document.getElementById('hotbar');
  bar.innerHTML = '';
  HOTBAR_ORDER.forEach((block, i) => {
    const c = BLOCK_COLORS[block];
    const slot = document.createElement('div');
    slot.className = 'hotSlot' + (i === 0 ? ' active' : '');
    slot.style.background = `linear-gradient(160deg, #${c.top.toString(16).padStart(6,'0')}, #${c.side.toString(16).padStart(6,'0')})`;
    const num = document.createElement('span');
    num.className = 'slotNum';
    num.textContent = i + 1;
    slot.appendChild(num);
    slot.addEventListener('click', () => game.selectHotbar(i));
    slot.addEventListener('touchstart', (e) => { e.preventDefault(); game.selectHotbar(i); }, { passive: false });
    bar.appendChild(slot);
  });
}

function enterGame() {
  document.getElementById('titleScreen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  if (game.isMobile) document.getElementById('touchControls').classList.remove('hidden');
  buildHotbar();
  game._refreshGlowLights();
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    const deviceHint = document.getElementById('deviceHint');
    const desktopHint = document.getElementById('controlsHintDesktop');
    if (game.isMobile) {
      deviceHint.textContent = '📱 ස්පර්ශ පාලන අනාවරණය විය — joystick + බොත්තම් යොදාගන්න';
      desktopHint.style.display = 'none';
    } else {
      deviceHint.textContent = '🖥 keyboard + mouse අනාවරණය විය';
    }

    if (NeoGame.hasSave()) {
      document.getElementById('continueBtn').style.display = 'block';
    }

    document.getElementById('newWorldBtn').addEventListener('click', () => {
      const seedVal = document.getElementById('seedInput').value;
      const seed = game.newWorld(seedVal);
      showToast('New world seeded: ' + seed);
      enterGame();
    });

    document.getElementById('continueBtn').addEventListener('click', () => {
      try {
        const payload = JSON.parse(localStorage.getItem('neocraft_save'));
        game.loadWorld(payload.seed, payload.data);
        showToast('Welcome back!');
        enterGame();
      } catch (e) {
        showToast('Save data was corrupted — starting fresh.');
        const seed = game.newWorld('');
        enterGame();
      }
    });

    document.getElementById('menuBtn').addEventListener('click', () => game.togglePause());
    document.getElementById('resumeBtn').addEventListener('click', () => game.togglePause());
    document.getElementById('saveBtn').addEventListener('click', () => {
      const ok = game.saveToStorage();
      showToast(ok ? 'World saved ✔' : 'Save failed');
    });
    document.getElementById('quitBtn').addEventListener('click', () => {
      game.togglePause();
      document.getElementById('hud').classList.add('hidden');
      document.getElementById('touchControls').classList.add('hidden');
      document.getElementById('titleScreen').classList.remove('hidden');
      document.getElementById('pauseMenu').classList.add('hidden');
      game.paused = false;
    });

    game.start();
  } catch (err) {
    console.error('Game bootstrap failed', err);
    if (typeof showEngineError === 'function') {
      showEngineError('⚠ Game start කරන අතරතුර error එකක්: ' + err.message +
        '. Page එක reload කරලා බලන්න.');
    }
  }
});
