// World Forge map engine: the camera. Orthographic (no perspective), so it can glide
// between straight-down and isometric views and still keep crisp pixels.
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export function multiply(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++) {
            o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
    return o;
}
export const TOP_PITCH = 89.99;
export const ISO_PITCH = 35;
const ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export class Camera {
    // world point the camera looks at (x east, z south); y is resolved from the terrain
    x = 0;
    z = 0;
    y = 0;
    zoom = 2; // screen pixels (at the low internal resolution) per world unit
    yaw = 0; // degrees, 0 = north up
    pitch = TOP_PITCH; // degrees, 90 = straight down
    from = null;
    to = null;
    t0 = 0;
    dur = 0;
    get animating() { return this.to !== null; }
    animateTo(target, ms = 550) {
        this.from = { x: this.x, z: this.z, zoom: this.zoom, yaw: this.yaw, pitch: this.pitch };
        this.to = { ...this.from, ...target };
        this.t0 = performance.now();
        this.dur = ms;
    }
    update(now) {
        if (!this.to || !this.from)
            return;
        const t = Math.min(1, (now - this.t0) / this.dur), k = ease(t);
        for (const key of ['x', 'z', 'yaw', 'pitch'])
            this[key] = this.from[key] + (this.to[key] - this.from[key]) * k;
        this.zoom = Math.exp(Math.log(this.from.zoom) + (Math.log(this.to.zoom) - Math.log(this.from.zoom)) * k);
        if (t >= 1) {
            this.to = null;
            this.from = null;
        }
    }
    // Unit vector pointing from the target toward the camera.
    back() {
        const p = this.pitch * Math.PI / 180, yw = this.yaw * Math.PI / 180;
        return [Math.cos(p) * Math.sin(yw), Math.sin(p), Math.cos(p) * Math.cos(yw)];
    }
    upVec() {
        const p = this.pitch * Math.PI / 180, yw = this.yaw * Math.PI / 180;
        return [-Math.sin(p) * Math.sin(yw), Math.cos(p), -Math.sin(p) * Math.cos(yw)];
    }
    viewProj(w, h) {
        const target = [this.x, this.y, this.z];
        const back = this.back();
        const D = 2000;
        const eye = [target[0] + back[0] * D, target[1] + back[1] * D, target[2] + back[2] * D];
        const f = norm(sub(target, eye));
        const s = norm(cross(f, this.upVec()));
        const u = cross(s, f);
        // Snap the view to whole pixels so nothing shimmers while panning.
        const px = 1 / this.zoom;
        const tx = Math.round(-dot(s, eye) / px) * px, ty = Math.round(-dot(u, eye) / px) * px;
        const view = new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, tx, ty, dot(f, eye), 1]);
        const hw = w / 2 / this.zoom, hh = h / 2 / this.zoom, near = 1, far = 4000;
        const proj = new Float32Array([1 / hw, 0, 0, 0, 0, 1 / hh, 0, 0, 0, 0, -2 / (far - near), 0, 0, 0, -(far + near) / (far - near), 1]);
        return multiply(proj, view);
    }
    // Screen (internal pixels, origin top-left) → a ray in the world.
    ray(sx, sy, w, h) {
        const back = this.back(), up = this.upVec();
        const f = [-back[0], -back[1], -back[2]];
        const s = norm(cross(f, up));
        const ox = (sx - w / 2) / this.zoom, oy = -(sy - h / 2) / this.zoom;
        const D = 2000;
        const o = [this.x + back[0] * D + s[0] * ox + up[0] * oy, this.y + back[1] * D + s[1] * ox + up[1] * oy, this.z + back[2] * D + s[2] * ox + up[2] * oy];
        return { o, d: f };
    }
}
export function project(m, x, y, z, w, h) {
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(cx / cw * 0.5 + 0.5) * w, (1 - (cy / cw * 0.5 + 0.5)) * h];
}
