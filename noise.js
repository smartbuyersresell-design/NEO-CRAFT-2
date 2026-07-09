// Minimal seedable 2D noise (value-noise based, smooth + fast enough for chunked terrain).
// Not a literal copy of any specific library — small self-contained implementation.

function makeSeededRandom(seedStr) {
  // xmur3 hash -> 32bit seed
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let seed = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  return seed;
}

class NeoNoise {
  constructor(seedStr) {
    const rand = makeSeededRandom(String(seedStr));
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  static fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  static lerp(a, b, t) { return a + t * (b - a); }

  grad(hash, x, y) {
    const h = hash & 7;
    const gradients = [
      [1,1],[-1,1],[1,-1],[-1,-1],
      [1,0],[-1,0],[0,1],[0,-1]
    ];
    const g = gradients[h];
    return g[0] * x + g[1] * y;
  }

  noise2D(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = NeoNoise.fade(xf);
    const v = NeoNoise.fade(yf);

    const aa = this.perm[this.perm[X] + Y];
    const ab = this.perm[this.perm[X] + Y + 1];
    const ba = this.perm[this.perm[X + 1] + Y];
    const bb = this.perm[this.perm[X + 1] + Y + 1];

    const x1 = NeoNoise.lerp(this.grad(aa, xf, yf), this.grad(ba, xf - 1, yf), u);
    const x2 = NeoNoise.lerp(this.grad(ab, xf, yf - 1), this.grad(bb, xf - 1, yf - 1), u);

    return NeoNoise.lerp(x1, x2, v); // range roughly [-1,1]
  }

  // fractal/octave noise, output normalized to [0,1]
  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2D(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return (sum / norm + 1) / 2;
  }
}
