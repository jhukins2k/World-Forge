// World Forge map engine: the map editor screen. Tools, panels and pointer handling,
// tying the terrain, renderer and camera together.
import { MapState, regenerate, createDetailMap } from './state.js';
import { Renderer } from './renderer.js';
import { Camera, project, TOP_PITCH, ISO_PITCH } from './camera.js';
import { MATERIALS } from './terrain.js';
import { MODEL_NAMES, WALL_TYPE } from './models.js';
import { rng } from './noise.js';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const AREA_COLORS = [['#c0392b', 'Crimson'], ['#2e86c1', 'Blue'], ['#d4ac0d', 'Gold'], ['#7d3c98', 'Purple'], ['#239b56', 'Green'], ['#e67e22', 'Orange'], ['#f1e6cc', 'Parchment'], ['#212121', 'Black']];
const rgb = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const TOOLS = [
    { id: 'move', label: 'Move & select', key: 'V', group: 'View', icon: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>' },
    { id: 'raise', label: 'Raise land', key: 'R', group: 'Shape', icon: '<path d="M3 20h18M6 20l6-12 6 12M12 3v4M10 5l2-2 2 2"/>' },
    { id: 'lower', label: 'Lower land', key: 'L', group: 'Shape', icon: '<path d="M3 8h18M6 8l6 10 6-10M12 21v-3M10 19l2 2 2-2"/>' },
    { id: 'smooth', label: 'Smooth', key: 'S', group: 'Shape', icon: '<path d="M3 15c3-4 6-4 9 0s6 4 9 0"/>' },
    { id: 'flatten', label: 'Flatten', key: 'F', group: 'Shape', icon: '<path d="M3 14h18M6 10h12M9 18h6"/>' },
    { id: 'paint', label: 'Paint ground', key: 'P', group: 'Paint', icon: '<path d="M4 20l4-1 10-10-3-3L5 16zM14 6l3 3"/>' },
    { id: 'objects', label: 'Trees & buildings', key: 'O', group: 'Paint', icon: '<path d="M12 3l5 8h-3l4 6H6l4-6H7zM12 17v4"/>' },
    { id: 'erase', label: 'Erase objects', key: 'X', group: 'Paint', icon: '<path d="M4 16l8-8 8 8-4 4H8zM9 20h11"/>' },
    { id: 'road', label: 'Road', key: '1', group: 'Draw', icon: '<path d="M8 21l2-18M16 21l-2-18M12 5v2M12 11v2M12 17v2"/>' },
    { id: 'river', label: 'River', key: '2', group: 'Draw', icon: '<path d="M6 3c4 4-4 8 0 12s4 6 4 6M14 3c4 4-4 8 0 12s4 6 4 6"/>' },
    { id: 'wall', label: 'Wall', key: '3', group: 'Draw', icon: '<path d="M3 10h18v10H3zM3 10V6h3v4M9 10V6h3v4M15 10V6h3v4M3 15h18M9 10v5M15 15v5"/>' },
    { id: 'area', label: 'Region or border', key: '4', group: 'Draw', icon: '<path d="M4 6l7-3 9 4-2 11-9 3-5-7z" stroke-dasharray="3 2"/>' },
    { id: 'pin', label: 'Pin a place', key: '5', group: 'Draw', icon: '<path d="M12 21s-6-6-6-11a6 6 0 1 1 12 0c0 5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>' },
    { id: 'detail', label: 'Zoom-in map', key: '6', group: 'Draw', icon: '<rect x="3" y="3" width="18" height="18"/><rect x="11" y="11" width="7" height="7"/><path d="M11 11L5 5"/>' },
];
const svg = (body, s = 20) => `<svg aria-hidden="true" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export async function mountForgeMap(root, opts) {
    root.innerHTML = '<div class="fm-loading">Unrolling the map…</div>';
    const st = await MapState.load(opts.record);
    const R = st.rec;
    const cam = new Camera();
    let tool = 'move';
    let brush = { size: Math.max(2, Math.round(st.n / 40)), strength: 0.5 };
    let paintMat = 0, objType = 0;
    const pref = (k, d) => { try {
        return localStorage.getItem('wf-map-' + k) ?? d;
    }
    catch {
        return d;
    } };
    const setPref = (k, v) => { try {
        localStorage.setItem('wf-map-' + k, v);
    }
    catch { /* ignore */ } };
    let pixelScale = Number(pref('px', window.innerWidth < 700 ? '2' : '3')) || 3;
    let retro = pref('retro', '0') === '1';
    let animate = pref('anim', '1') === '1';
    let drawing = [];
    let selected = null;
    const undo = [], redo = [];
    const ancestorsHtml = opts.ancestors.map(a => `<button type="button" class="fm-crumb" data-open-parent="${esc(a.id)}">${esc(a.name)}</button><span aria-hidden="true">›</span>`).join('');
    root.innerHTML = `<div class="fm" tabindex="-1">
    <div class="fm-top">
      <nav class="fm-crumbs" aria-label="Map breadcrumb">
        <a href="${esc(opts.atlasHref)}">Atlas</a><span aria-hidden="true">›</span>${ancestorsHtml}<span class="fm-name" aria-current="page">${esc(R.name)}</span>
      </nav>
      <div class="fm-top-tools">
        <div class="seg" role="group" aria-label="View">
          <button type="button" data-view="top" aria-pressed="true">Top-down</button>
          <button type="button" data-view="iso" aria-pressed="false">Isometric</button>
        </div>
        <button type="button" class="icon-btn boxed" data-act="rot-l" aria-label="Rotate left (Q)">${svg('<path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/>', 18)}</button>
        <button type="button" class="icon-btn boxed" data-act="rot-r" aria-label="Rotate right (E)">${svg('<path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"/>', 18)}</button>
        <button type="button" class="btn ghost sm" data-act="fit">Fit</button>
        <button type="button" class="icon-btn boxed" data-act="undo" aria-label="Undo (Ctrl+Z)">${svg('<path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>', 18)}</button>
        <button type="button" class="icon-btn boxed" data-act="redo" aria-label="Redo (Ctrl+Y)">${svg('<path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"/>', 18)}</button>
        <span class="fm-status" role="status">Saved</span>
      </div>
    </div>
    <div class="fm-body">
      <div class="fm-tools" role="toolbar" aria-label="Map tools" aria-orientation="vertical">
        ${TOOLS.map((t, i) => `${i && TOOLS[i - 1].group !== t.group ? '<span class="fm-tsep"></span>' : ''}<button type="button" class="fm-tool" data-tool="${t.id}" aria-pressed="${t.id === tool}" title="${esc(t.label)} (${t.key})" aria-label="${esc(t.label)}">${svg(t.icon)}</button>`).join('')}
      </div>
      <div class="fm-stage">
        <canvas class="fm-canvas" aria-label="Map of ${esc(R.name)}"></canvas>
        <svg class="fm-lines" aria-hidden="true"></svg>
        <div class="fm-pins"></div>
        <div class="fm-hint" aria-live="polite"></div>
        <div class="fm-scale" aria-hidden="true"><span class="fm-scale-bar"></span><span class="fm-scale-txt"></span></div>
      </div>
      <aside class="fm-panel" aria-label="Map tools and settings"></aside>
    </div>
  </div>`;
    const canvas = root.querySelector('.fm-canvas');
    const lines = root.querySelector('.fm-lines');
    const pinsEl = root.querySelector('.fm-pins');
    const hint = root.querySelector('.fm-hint');
    const panel = root.querySelector('.fm-panel');
    const statusEl = root.querySelector('.fm-status');
    let ren;
    try {
        ren = new Renderer(canvas);
    }
    catch (err) {
        root.querySelector('.fm-stage').innerHTML = `<div class="fm-loading">${esc(err.message)}</div>`;
        return { destroy() { } };
    }
    ren.pixelScale = pixelScale;
    const terrainInput = () => ({ n: st.n, col: st.col, materials: st.materials, overlay: st.overlay, shadows: st.shadows, areaIds: st.areaIds,
        areaColors: R.areas.map(a => a.color), waterY: st.waterY, seed: R.seed });
    ren.setTerrain(terrainInput());
    ren.setObjects(st.objects, R.paths, R.objScale);
    // ---------- saving ----------
    let saveTimer = 0;
    const setStatus = (t) => { statusEl.textContent = t; };
    const scheduleSave = () => {
        setStatus('Saving…');
        clearTimeout(saveTimer);
        saveTimer = window.setTimeout(async () => { saveTimer = 0; await opts.save(await withThumb()); setStatus('Saved'); }, 1200);
    };
    const flushSave = async () => { if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = 0;
        await opts.save(await withThumb());
    } };
    // A small picture of the map for the Atlas list.
    const withThumb = async () => {
        const rec = await st.toRecord();
        try {
            const t = document.createElement('canvas');
            const w = 320, h = Math.round(320 * canvas.height / Math.max(1, canvas.width));
            t.width = w;
            t.height = h;
            const ctx = t.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(canvas, 0, 0, w, h);
            rec.thumb = t.toDataURL('image/jpeg', 0.8);
        }
        catch { /* thumbnail is optional */ }
        return rec;
    };
    const snapshot = () => ({ heights: st.heights.slice(), materials: st.materials.slice(), objects: st.objects.map(o => ({ ...o })),
        paths: structuredClone(R.paths), areas: structuredClone(R.areas), pins: structuredClone(R.pins), waterLevel: R.waterLevel });
    const pushUndo = () => { undo.push(snapshot()); if (undo.length > 25)
        undo.shift(); redo.length = 0; };
    const restore = (s) => {
        st.heights = s.heights;
        st.materials = s.materials;
        st.objects = s.objects;
        R.paths = s.paths;
        R.areas = s.areas;
        R.pins = s.pins;
        R.waterLevel = s.waterLevel;
        rebuildAll();
        drawPanel();
        scheduleSave();
    };
    function rebuildAll() {
        st.refreshPaths();
        st.refreshAreas();
        st.refreshColumns();
        st.refreshShadows();
        ren.setTerrain(terrainInput());
        ren.setObjects(st.objects, R.paths, R.objScale);
        cam.y = st.waterY;
        dirty = true;
    }
    // ---------- camera ----------
    const fitZoom = () => {
        ren.resize();
        const iso = cam.pitch < 80;
        return Math.min(ren.fbW, ren.fbH) / (st.n * (iso ? 1.5 : 1.08));
    };
    cam.x = st.n / 2;
    cam.z = st.n / 2;
    cam.y = st.waterY;
    requestAnimationFrame(() => {
        cam.zoom = fitZoom();
        const from = opts.zoomFromChild ? opts.children().find(c => c.id === opts.zoomFromChild) : null;
        if (from?.rect) {
            const r = from.rect;
            const target = { x: cam.x, z: cam.z, zoom: cam.zoom };
            cam.x = r.x + r.w / 2;
            cam.z = r.y + r.h / 2;
            cam.zoom = Math.min(ren.fbW, ren.fbH) / (Math.max(r.w, r.h) * 1.05);
            cam.animateTo(target, 900);
        }
        dirty = true;
    });
    const groundVectors = () => {
        const yw = cam.yaw * Math.PI / 180;
        return { s: [Math.cos(yw), -Math.sin(yw)], u: [-Math.sin(yw), -Math.cos(yw)], sinp: Math.max(0.2, Math.sin(cam.pitch * Math.PI / 180)) };
    };
    const screenToGround = (cssX, cssY) => {
        const k = cam.zoom * pixelScale, { s, u, sinp } = groundVectors();
        const dx = (cssX - canvas.clientWidth / 2) / k, dy = -(cssY - canvas.clientHeight / 2) / k / sinp;
        return { x: cam.x + s[0] * dx + u[0] * dy, z: cam.z + s[1] * dx + u[1] * dy };
    };
    const zoomAt = (factor, cssX, cssY) => {
        const before = screenToGround(cssX, cssY);
        cam.zoom = Math.min(80, Math.max(0.15, cam.zoom * factor));
        const after = screenToGround(cssX, cssY);
        cam.x += before.x - after.x;
        cam.z += before.z - after.z;
        dirty = true;
    };
    const setView = (v) => {
        cam.animateTo({ pitch: v === 'top' ? TOP_PITCH : ISO_PITCH, yaw: v === 'iso' && Math.abs(cam.yaw % 90) < 1 ? cam.yaw + 45 : v === 'top' ? Math.round(cam.yaw / 90) * 90 : cam.yaw });
        root.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    };
    // ---------- render loop ----------
    let dirty = true, raf = 0, lastDraw = 0, vp = null;
    let hover = null;
    const brushTools = ['raise', 'lower', 'smooth', 'flatten', 'paint', 'objects', 'erase'];
    const sunDir = () => {
        const az = R.sun.az * Math.PI / 180, el = R.sun.el * Math.PI / 180;
        return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
    };
    const frame = (now) => {
        raf = requestAnimationFrame(frame);
        if (document.hidden)
            return;
        cam.update(now);
        const water = animate && now - lastDraw > 125;
        if (!dirty && !cam.animating && !water)
            return;
        lastDraw = now;
        dirty = false;
        vp = ren.render(cam, { time: now / 1000, sunDir: sunDir(), retro,
            brush: hover && brushTools.includes(tool) ? { x: hover.x, z: hover.z, r: brush.size } : null });
        drawOverlay();
    };
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => { dirty = true; });
    ro.observe(canvas);
    // ---------- overlay: pins, lines, labels ----------
    const toCss = (x, y, z) => {
        const [px, py] = project(vp, x, y, z, ren.fbW, ren.fbH);
        return [px * pixelScale, py * pixelScale];
    };
    const groundY = (x, z) => {
        const i = Math.min(st.n - 1, Math.max(0, Math.floor(x))), j = Math.min(st.n - 1, Math.max(0, Math.floor(z)));
        return Math.max(st.col[j * st.n + i], st.waterY);
    };
    const entryName = (id) => opts.entries.find(e => e.id === id)?.name || '';
    function drawOverlay() {
        if (!vp)
            return;
        let out = '';
        for (const c of opts.children()) {
            if (!c.rect)
                continue;
            const r = c.rect, y = st.waterY;
            const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, z]) => toCss(x, Math.max(y, groundY(x, z)), z));
            const sel = selected?.kind === 'child' && selected.id === c.id;
            out += `<polygon class="fm-child ${sel ? 'on' : ''}" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
            const [lx, ly] = pts[0];
            out += `<text class="fm-child-label" x="${lx + 4}" y="${ly - 6}">${esc(c.name)}</text>`;
        }
        for (const a of R.areas) {
            if (!a.pts.length)
                continue;
            const cx = a.pts.reduce((s, p) => s + p[0], 0) / a.pts.length, cz = a.pts.reduce((s, p) => s + p[1], 0) / a.pts.length;
            const [x, y] = toCss(cx, groundY(cx, cz) + 1, cz);
            out += `<text class="fm-area-label" x="${x}" y="${y}" text-anchor="middle">${esc(a.name || entryName(a.entryId))}</text>`;
        }
        if (selected?.kind === 'path') {
            const p = R.paths.find(q => q.id === selected.id);
            if (p)
                out += `<polyline class="fm-sel-line" points="${p.pts.map(([x, z]) => toCss(x, groundY(x, z) + 0.3, z).join(',')).join(' ')}"/>`;
        }
        if (drawing.length) {
            const pts = drawing.map(([x, z]) => toCss(x, groundY(x, z) + 0.3, z));
            const end = hover ? [toCss(hover.x, groundY(hover.x, hover.z) + 0.3, hover.z)] : [];
            const cls = tool === 'area' ? 'fm-draw area' : 'fm-draw';
            out += `<polyline class="${cls}" points="${[...pts, ...end].map(p => p.join(',')).join(' ')}"/>`;
            out += pts.map(([x, y]) => `<circle class="fm-dot" cx="${x}" cy="${y}" r="4"/>`).join('');
        }
        if (rectDrag) {
            const { a, b } = rectDrag;
            const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
            const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => toCss(x, groundY(x, z) + 0.3, z));
            out += `<polygon class="fm-child on" points="${pts.map(p => p.join(',')).join(' ')}"/>`;
        }
        lines.innerHTML = out;
        pinsEl.innerHTML = R.pins.map(p => {
            const x = p.x * st.n, z = p.y * st.n;
            const [sx, sy] = toCss(x, groundY(x, z) + 0.2, z);
            const e = opts.entries.find(q => q.id === p.entryId);
            return `<button type="button" class="fm-pin ${selected?.kind === 'pin' && selected.id === p.id ? 'on' : ''}" data-pin="${esc(p.id)}" style="left:${sx}px;top:${sy}px;--c:${esc(e?.color || '#6e2a26')}">
        <span class="fm-pin-label">${esc(e?.name || p.label || 'Pin')}</span><span class="fm-pin-dot"></span></button>`;
        }).join('');
        // scale bar
        const k = cam.zoom * pixelScale;
        const targetPx = 110, cells = targetPx / k, meters = cells * R.metersPerCell;
        const nice = [1, 2, 5].flatMap(b => [1, 10, 100, 1000, 10000, 100000, 1000000].map(m => b * m)).sort((a, b) => a - b);
        const pick = nice.reduce((best, v) => Math.abs(v - meters) < Math.abs(best - meters) ? v : best, nice[0]);
        const bar = root.querySelector('.fm-scale-bar'), txt = root.querySelector('.fm-scale-txt');
        bar.style.width = `${(pick / R.metersPerCell) * k}px`;
        txt.textContent = pick >= 1000 ? `${pick / 1000} km` : `${pick} m`;
        root.querySelector('.fm-scale').hidden = cam.pitch < 80;
    }
    // ---------- editing ----------
    let flatTarget = 0, lastScatter = 0;
    const r = rng((R.seed + Date.now()) >>> 0);
    let touched = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    function applyBrush(cx, cz) {
        const n = st.n, rad = brush.size, s = brush.strength;
        const x0 = Math.max(0, Math.floor(cx - rad)), x1 = Math.min(n - 1, Math.ceil(cx + rad));
        const y0 = Math.max(0, Math.floor(cz - rad)), y1 = Math.min(n - 1, Math.ceil(cz + rad));
        if (tool === 'objects') {
            const now = performance.now();
            if (now - lastScatter < 90)
                return;
            lastScatter = now;
            const count = brush.size <= 1.5 ? 1 : Math.max(1, Math.round(rad * rad * 0.04 * s));
            for (let k = 0; k < count; k++) {
                const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (brush.size <= 1.5 ? 0 : rad);
                const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
                if (x < 0 || z < 0 || x >= n || z >= n)
                    continue;
                if (st.col[Math.floor(z) * n + Math.floor(x)] < st.waterY)
                    continue;
                st.objects.push({ t: objType, x, y: z, r: MODEL_NAMES[objType].group === 'Buildings' ? Math.round(r() * 4) * Math.PI / 2 + (cam.yaw * Math.PI / 180) : r() * Math.PI * 2, s: 0.85 + r() * 0.3 });
            }
            ren.setObjects(st.objects, R.paths, R.objScale);
            dirty = true;
            return;
        }
        if (tool === 'erase') {
            const before = st.objects.length;
            st.objects = st.objects.filter(o => Math.hypot(o.x - cx, o.y - cz) > rad);
            if (st.objects.length !== before) {
                ren.setObjects(st.objects, R.paths, R.objScale);
                dirty = true;
            }
            return;
        }
        const h = st.heights, m = st.materials;
        const src = tool === 'smooth' ? h.slice() : h;
        for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
                const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cz);
                if (d > rad)
                    continue;
                const f = Math.pow(1 - d / rad, 1.5);
                const i = y * n + x;
                if (tool === 'raise')
                    h[i] = Math.min(1, h[i] + s * 0.012 * f);
                else if (tool === 'lower')
                    h[i] = Math.max(0, h[i] - s * 0.012 * f);
                else if (tool === 'flatten')
                    h[i] += (flatTarget - h[i]) * s * 0.35 * f;
                else if (tool === 'smooth') {
                    let sum = 0, c = 0;
                    for (let yy = Math.max(0, y - 1); yy <= Math.min(n - 1, y + 1); yy++)
                        for (let xx = Math.max(0, x - 1); xx <= Math.min(n - 1, x + 1); xx++) {
                            sum += src[yy * n + xx];
                            c++;
                        }
                    h[i] += (sum / c - h[i]) * s * 0.6 * f;
                }
                else if (tool === 'paint') {
                    if (r() < f * 1.6 + 0.1)
                        m[i] = paintMat;
                }
            }
        // refresh only what changed
        for (let y = y0; y <= y1; y++)
            for (let x = x0; x <= x1; x++) {
                const i = y * n + x;
                let v = Math.round(h[i] * R.heightScale * 2) / 2;
                if (st.overlay[i] === 2)
                    v -= 0.5;
                st.col[i] = Math.max(0, v);
            }
        touched = { x0: Math.min(touched.x0, x0), y0: Math.min(touched.y0, y0), x1: Math.max(touched.x1, x1), y1: Math.max(touched.y1, y1) };
        ren.updateCells(x0, y0, x1, y1);
        dirty = true;
    }
    function endStroke() {
        if (['raise', 'lower', 'smooth', 'flatten'].includes(tool)) {
            st.refreshShadows();
            ren.setTerrain(terrainInput());
            ren.setObjects(st.objects, R.paths, R.objScale);
        }
        touched = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        dirty = true;
        scheduleSave();
        drawPanel();
    }
    async function finishDrawing() {
        const pts = drawing.slice();
        drawing = [];
        dirty = true;
        if (tool === 'area') {
            if (pts.length < 3) {
                opts.dialogs.toast('A region needs at least three points.');
                return;
            }
            const res = await opts.dialogs.form('New region', `
        <label class="flabel" for="fa-name">Name</label><input class="inp" id="fa-name" name="name" maxlength="60" placeholder="e.g. Corporation territory">
        <label class="flabel" for="fa-color">Color</label><select class="inp" id="fa-color" name="color">${AREA_COLORS.map(([c, n], i) => `<option value="${c}" ${i === R.areas.length % AREA_COLORS.length ? 'selected' : ''}>${n}</option>`).join('')}</select>
        <label class="flabel" for="fa-entry">Links to (optional)</label><select class="inp" id="fa-entry" name="entry"><option value="">Nothing</option>${entryOptions()}</select>`, 'Add region');
            if (!res)
                return;
            pushUndo();
            R.areas.push({ id: opts.uid(), name: res.name.trim(), color: res.color, entryId: res.entry, pts });
            st.refreshAreas();
            ren.setTerrain(terrainInput());
            ren.setObjects(st.objects, R.paths, R.objScale);
        }
        else {
            if (pts.length < 2) {
                opts.dialogs.toast('Click at least two points.');
                return;
            }
            const kind = tool;
            const label = kind === 'road' ? 'road' : kind === 'river' ? 'river' : 'wall';
            const res = await opts.dialogs.form(`New ${label}`, `
        <label class="flabel" for="fp-name">Name (optional)</label><input class="inp" id="fp-name" name="name" maxlength="60" placeholder="${kind === 'road' ? 'e.g. The Old Trade Road' : kind === 'river' ? 'e.g. River Ash' : 'e.g. Ashmark city wall'}">
        ${kind !== 'wall' ? `<label class="flabel" for="fp-w">Width in squares</label><input class="inp" id="fp-w" name="width" type="number" min="0.5" max="12" step="0.5" value="${kind === 'river' ? 1.5 : 1}">` : ''}`, `Add ${label}`);
            if (!res)
                return;
            pushUndo();
            R.paths.push({ id: opts.uid(), kind, name: res.name.trim(), pts, width: Number(res.width) || 1 });
            rebuildAll();
        }
        scheduleSave();
        drawPanel();
    }
    function entryOptions(selectedId = '') {
        const books = [...new Set(opts.entries.map(e => e.book))];
        return books.map(b => `<optgroup label="${esc(b)}">${opts.entries.filter(e => e.book === b).map(e => `<option value="${esc(e.id)}" ${e.id === selectedId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>`).join('');
    }
    async function placePin(x, z, existing) {
        const res = await opts.dialogs.form(existing ? 'Change pin' : 'New pin', `
      <label class="flabel" for="fpin-e">Links to</label><select class="inp" id="fpin-e" name="entry"><option value="">Nothing (just a label)</option>${entryOptions(existing?.entryId)}</select>
      <label class="flabel" for="fpin-l">Label (optional)</label><input class="inp" id="fpin-l" name="label" maxlength="60" value="${esc(existing?.label || '')}">`, existing ? 'Save' : 'Add pin');
        if (!res)
            return;
        if (!res.entry && !res.label.trim()) {
            opts.dialogs.toast('Pick an entry or type a label.');
            return;
        }
        pushUndo();
        if (existing) {
            existing.entryId = res.entry;
            existing.label = res.label.trim();
        }
        else {
            const p = { id: opts.uid(), x: x / st.n, y: z / st.n, entryId: res.entry, label: res.label.trim() };
            R.pins.push(p);
            selected = { kind: 'pin', id: p.id };
        }
        dirty = true;
        scheduleSave();
        drawPanel();
    }
    async function makeDetail(rect) {
        const res = await opts.dialogs.form('New zoom-in map', `
      <p class="muted">Creates a more detailed map of this area. It starts from the land you see here and adds finer detail, so you can build cities and villages inside it.</p>
      <label class="flabel" for="fd-name">Name</label><input class="inp" id="fd-name" name="name" required maxlength="60" placeholder="e.g. Ashmark and surroundings">
      <label class="flabel" for="fd-size">Detail</label><select class="inp" id="fd-size" name="size"><option value="128">Light (128 × 128)</option><option value="256" selected>Standard (256 × 256)</option></select>`, 'Create map');
        if (!res)
            return;
        setStatus('Creating…');
        const rec = await createDetailMap(st, rect, { id: opts.uid(), name: res.name.trim(), size: Number(res.size) || 256, seed: Math.floor(Math.random() * 1e9), order: opts.children().length });
        await opts.createChild(rec);
        selected = { kind: 'child', id: rec.id };
        setStatus('Saved');
        dirty = true;
        drawPanel();
        opts.dialogs.toast(`“${rec.name}” created. Double-click inside its outline to zoom in.`);
    }
    function enterChild(c) {
        if (!c.rect)
            return opts.open(c.id);
        const rr = c.rect;
        cam.animateTo({ x: rr.x + rr.w / 2, z: rr.y + rr.h / 2, zoom: Math.min(ren.fbW, ren.fbH) / (Math.max(rr.w, rr.h) * 1.05), pitch: TOP_PITCH, yaw: Math.round(cam.yaw / 90) * 90 }, 700);
        setTimeout(async () => { await flushSave(); opts.open(c.id); }, 720);
    }
    const childAt = (x, z) => opts.children().find(c => c.rect && x >= c.rect.x && x <= c.rect.x + c.rect.w && z >= c.rect.y && z <= c.rect.y + c.rect.h);
    // ---------- pointer input ----------
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    let rectDrag = null;
    const local = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    canvas.addEventListener('pointerdown', e => {
        canvas.setPointerCapture(e.pointerId);
        const p = local(e);
        pointers.set(e.pointerId, p);
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom };
            drag = null;
            return;
        }
        const rotate = e.button === 2 || (e.button === 0 && e.altKey);
        if (rotate || tool === 'move' || e.button === 1) {
            drag = { kind: rotate ? 'rotate' : 'pan', sx: p.x, sy: p.y, cx: cam.x, cz: cam.z, yaw: cam.yaw, moved: false };
            return;
        }
        const g = ren.pick(cam, p.x, p.y);
        if (!g)
            return;
        if (brushTools.includes(tool)) {
            pushUndo();
            if (tool === 'flatten')
                flatTarget = st.heights[Math.min(st.n - 1, Math.floor(g.z)) * st.n + Math.min(st.n - 1, Math.floor(g.x))];
            drag = { kind: 'paint', sx: p.x, sy: p.y, cx: 0, cz: 0, yaw: 0, moved: false };
            applyBrush(g.x, g.z);
        }
        else if (tool === 'detail') {
            rectDrag = { a: { x: g.x, z: g.z }, b: { x: g.x, z: g.z } };
        }
    });
    canvas.addEventListener('pointermove', e => {
        const p = local(e);
        if (pointers.has(e.pointerId))
            pointers.set(e.pointerId, p);
        if (pinch && pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            cam.zoom = Math.min(80, Math.max(0.15, pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
            dirty = true;
            return;
        }
        const g = ren.pick(cam, p.x, p.y);
        hover = g ? { x: g.x, z: g.z } : null;
        if (g) {
            const i = Math.floor(g.z) * st.n + Math.floor(g.x);
            const mat = MATERIALS[st.materials[i]]?.name || '';
            const elev = Math.round((st.heights[i] - R.waterLevel) / (1 - R.waterLevel || 1) * 4500 / 10) * 10;
            hint.textContent = `${st.col[i] < st.waterY ? 'Water' : mat}${st.col[i] >= st.waterY ? ` · ${elev} m up` : ''}`;
        }
        if (drag) {
            const dx = p.x - drag.sx, dy = p.y - drag.sy;
            if (Math.abs(dx) + Math.abs(dy) > 3)
                drag.moved = true;
            if (drag.kind === 'pan') {
                const k = cam.zoom * pixelScale, { s, u, sinp } = groundVectors();
                cam.x = drag.cx - (s[0] * dx - u[0] * dy / sinp) / k;
                cam.z = drag.cz - (s[1] * dx - u[1] * dy / sinp) / k;
            }
            else if (drag.kind === 'rotate') {
                cam.yaw = drag.yaw - dx * 0.4;
            }
            else if (drag.kind === 'paint' && g)
                applyBrush(g.x, g.z);
        }
        if (rectDrag && g)
            rectDrag.b = { x: g.x, z: g.z };
        dirty = true;
    });
    const end = async (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2)
            pinch = null;
        const p = local(e);
        if (drag?.kind === 'paint') {
            drag = null;
            endStroke();
            return;
        }
        if (drag && !drag.moved && tool === 'move' && e.button === 0) {
            const g = ren.pick(cam, p.x, p.y);
            const c = g && childAt(g.x, g.z);
            selected = c ? { kind: 'child', id: c.id } : null;
            drawPanel();
            dirty = true;
        }
        drag = null;
        if (rectDrag) {
            const { a, b } = rectDrag;
            rectDrag = null;
            dirty = true;
            const x0 = Math.max(0, Math.min(a.x, b.x)), z0 = Math.max(0, Math.min(a.z, b.z));
            const side = Math.min(st.n - x0, st.n - z0, Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)));
            if (side < 4) {
                opts.dialogs.toast('Drag a larger square to make a zoom-in map.');
                return;
            }
            await makeDetail({ x: x0, y: z0, w: side, h: side });
            return;
        }
        if (e.button !== 0)
            return;
        const g = ren.pick(cam, p.x, p.y);
        if (!g)
            return;
        if (tool === 'road' || tool === 'river' || tool === 'wall' || tool === 'area') {
            drawing.push([g.x, g.z]);
            dirty = true;
            drawPanel();
        }
        if (tool === 'pin')
            await placePin(g.x, g.z);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); pinch = null; drag = null; rectDrag = null; });
    canvas.addEventListener('pointerleave', () => { hover = null; hint.textContent = ''; dirty = true; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('dblclick', e => {
        if (drawing.length) {
            drawing.pop();
            finishDrawing();
            return;
        }
        const p = local(e);
        const g = ren.pick(cam, p.x, p.y);
        const c = g && childAt(g.x, g.z);
        if (c && (tool === 'move'))
            enterChild(c);
    });
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const p = local(e);
        zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    }, { passive: false });
    pinsEl.addEventListener('click', e => {
        const b = e.target.closest('[data-pin]');
        if (!b)
            return;
        selected = { kind: 'pin', id: b.dataset.pin };
        drawPanel();
        dirty = true;
    });
    // ---------- keyboard ----------
    const onKey = (e) => {
        const t = e.target;
        if (t.closest('input, textarea, select, dialog') || document.querySelector('dialog[open]'))
            return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            doUndo(e.shiftKey);
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            doUndo(true);
            return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey)
            return;
        const k = e.key.toLowerCase();
        if (k === 'q')
            cam.animateTo({ yaw: cam.yaw + 90 }, 400);
        else if (k === 'e')
            cam.animateTo({ yaw: cam.yaw - 90 }, 400);
        else if (k === 't')
            setView('top');
        else if (k === 'i')
            setView('iso');
        else if (k === '[') {
            brush.size = Math.max(1, brush.size - 1);
            drawPanel();
        }
        else if (k === ']') {
            brush.size = Math.min(60, brush.size + 1);
            drawPanel();
        }
        else if (k === 'enter' && drawing.length) {
            e.preventDefault();
            finishDrawing();
        }
        else if (k === 'escape') {
            drawing = [];
            rectDrag = null;
            dirty = true;
            drawPanel();
        }
        else if (k === 'backspace' && drawing.length) {
            e.preventDefault();
            drawing.pop();
            dirty = true;
            drawPanel();
        }
        else {
            const tl = TOOLS.find(x => x.key.toLowerCase() === k);
            if (tl)
                setTool(tl.id);
        }
        dirty = true;
    };
    window.addEventListener('keydown', onKey);
    function doUndo(isRedo) {
        const from = isRedo ? redo : undo, to = isRedo ? undo : redo;
        const s = from.pop();
        if (!s)
            return;
        to.push(snapshot());
        restore(s);
    }
    function setTool(t) {
        tool = t;
        drawing = [];
        rectDrag = null;
        root.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
        canvas.style.cursor = t === 'move' ? 'grab' : 'crosshair';
        drawPanel();
        dirty = true;
    }
    // ---------- side panel ----------
    const km = (p) => {
        let cells = 0;
        for (let k = 0; k < p.pts.length - 1; k++)
            cells += Math.hypot(p.pts[k + 1][0] - p.pts[k][0], p.pts[k + 1][1] - p.pts[k][1]);
        return cells * R.metersPerCell / 1000;
    };
    const dist = (k) => k >= 10 ? `${Math.round(k)} km` : `${k.toFixed(1)} km`;
    function toolPanel() {
        const tl = TOOLS.find(x => x.id === tool);
        let body = '';
        if (brushTools.includes(tool)) {
            body += `<label class="flabel" for="fm-size">Brush size · <span data-out="size">${brush.size}</span></label>
        <input type="range" id="fm-size" min="1" max="60" step="1" value="${brush.size}" data-set="size">`;
            if (tool !== 'erase')
                body += `<label class="flabel" for="fm-str">Strength · <span data-out="strength">${Math.round(brush.strength * 100)}%</span></label>
        <input type="range" id="fm-str" min="0.05" max="1" step="0.05" value="${brush.strength}" data-set="strength">`;
        }
        if (tool === 'paint')
            body += `<div class="fm-swatches" role="radiogroup" aria-label="Ground type">${MATERIALS.map(m => `<button type="button" role="radio" aria-checked="${m.id === paintMat}" class="fm-swatch ${m.id === paintMat ? 'on' : ''}" data-mat="${m.id}" style="--c:${rgb(m.top)}"><span></span>${esc(m.name)}</button>`).join('')}</div>`;
        if (tool === 'objects') {
            body += ['Nature', 'Buildings'].map(g => `<div class="flabel fm-group">${g}</div><div class="fm-objs" role="radiogroup" aria-label="${g}">${MODEL_NAMES.map((m, i) => m.group === g && i !== WALL_TYPE ? `<button type="button" role="radio" aria-checked="${i === objType}" class="fm-obj ${i === objType ? 'on' : ''}" data-obj="${i}">${esc(m.name)}</button>` : '').join('')}</div>`).join('');
            body += '<p class="hint">Click to place one (brush size 1), or drag to scatter.</p>';
        }
        if (tool === 'road' || tool === 'river' || tool === 'wall' || tool === 'area') {
            body += `<p class="hint">Click points along the ${tool === 'area' ? 'border' : tool}. Double-click or press Enter to finish; Backspace removes the last point; Esc cancels.</p>
        ${drawing.length ? `<p>${drawing.length} points${tool !== 'area' && drawing.length > 1 ? ` · ${dist(km({ id: '', kind: 'road', name: '', width: 1, pts: drawing }))}` : ''}</p>
        <div class="btn-row"><button type="button" class="btn primary sm" data-act="finish">Finish</button><button type="button" class="btn ghost sm" data-act="cancel-draw">Cancel</button></div>` : ''}`;
        }
        if (tool === 'pin')
            body += '<p class="hint">Click the map to drop a pin, then link it to a place, character or anything else.</p>';
        if (tool === 'detail')
            body += '<p class="hint">Drag a square over the area you want to zoom into, such as a city or valley. You get a new, more detailed map of just that area.</p>';
        if (tool === 'move')
            body += '<p class="hint">Drag to move around, scroll or pinch to zoom, right-drag (or Alt-drag) to rotate. Q / E rotate, T / I switch views. Double-click a zoom-in map\'s outline to enter it.</p>';
        return `<section class="fm-sec"><h2 class="fm-h">${esc(tl.label)}</h2>${body}</section>`;
    }
    function selectedPanel() {
        if (!selected)
            return '';
        if (selected.kind === 'pin') {
            const p = R.pins.find(q => q.id === selected.id);
            if (!p)
                return '';
            const e = opts.entries.find(q => q.id === p.entryId);
            return `<section class="fm-sec"><h2 class="fm-h">Pin</h2>
        <p class="fm-big">${e ? `<a href="${esc(opts.entryHref(e.id))}">${esc(e.name)}</a>` : esc(p.label)}</p>${e && p.label ? `<p class="muted small">${esc(p.label)}</p>` : ''}
        <div class="btn-row"><button type="button" class="btn ghost sm" data-act="pin-edit">Change</button><button type="button" class="btn danger-ghost sm" data-act="pin-del">Remove</button></div></section>`;
        }
        if (selected.kind === 'child') {
            const c = opts.children().find(q => q.id === selected.id);
            if (!c)
                return '';
            return `<section class="fm-sec"><h2 class="fm-h">Zoom-in map</h2><p class="fm-big">${esc(c.name)}</p>
        <div class="btn-row"><button type="button" class="btn primary sm" data-act="child-open">Zoom in</button><button type="button" class="btn danger-ghost sm" data-act="child-del">Delete</button></div></section>`;
        }
        return '';
    }
    function listsPanel() {
        const kids = opts.children();
        const pathRows = R.paths.map(p => `<li><button type="button" class="linklike" data-sel-path="${esc(p.id)}">${esc(p.name || (p.kind === 'road' ? 'Road' : p.kind === 'river' ? 'River' : 'Wall'))}</button>
      <span class="muted small">${p.kind} · ${dist(km(p))}${p.kind === 'road' ? ` · ~${Math.max(1, Math.round(km(p) / 25))} days on foot` : ''}</span>
      <button type="button" class="icon-btn" data-del-path="${esc(p.id)}" aria-label="Delete ${esc(p.name || p.kind)}">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 14)}</button></li>`).join('');
        return `
      <section class="fm-sec"><h2 class="fm-h">Pins · ${R.pins.length}</h2>${R.pins.length ? `<ul class="fm-list">${R.pins.map(p => `<li><button type="button" class="linklike" data-goto-pin="${esc(p.id)}">${esc(entryName(p.entryId) || p.label || 'Pin')}</button></li>`).join('')}</ul>` : '<p class="muted small">Use the pin tool to mark places.</p>'}</section>
      <section class="fm-sec"><h2 class="fm-h">Roads, rivers & walls · ${R.paths.length}</h2>${R.paths.length ? `<ul class="fm-list">${pathRows}</ul>` : '<p class="muted small">None drawn yet.</p>'}</section>
      <section class="fm-sec"><h2 class="fm-h">Regions · ${R.areas.length}</h2>${R.areas.length ? `<ul class="fm-list">${R.areas.map(a => `<li><span class="fm-dotc" style="background:${esc(a.color)}"></span><span>${esc(a.name || entryName(a.entryId) || 'Region')}</span>
        <button type="button" class="icon-btn" data-del-area="${esc(a.id)}" aria-label="Delete region">${svg('<path d="M6 6l12 12M18 6L6 18"/>', 14)}</button></li>`).join('')}</ul>` : '<p class="muted small">Draw borders for kingdoms, territories or zones.</p>'}</section>
      <section class="fm-sec"><h2 class="fm-h">Zoom-in maps · ${kids.length}</h2>${kids.length ? `<ul class="fm-list">${kids.map(c => `<li><button type="button" class="linklike" data-open-child="${esc(c.id)}">${esc(c.name)}</button></li>`).join('')}</ul>` : '<p class="muted small">Use the zoom-in tool to make detailed maps of cities and regions.</p>'}</section>`;
    }
    function settingsPanel() {
        return `<section class="fm-sec"><h2 class="fm-h">Map settings</h2>
      <label class="flabel" for="fm-sun">Sun direction</label><input type="range" id="fm-sun" min="0" max="359" step="1" value="${R.sun.az}" data-set="sunAz">
      <label class="flabel" for="fm-sunh">Sun height</label><input type="range" id="fm-sunh" min="8" max="85" step="1" value="${R.sun.el}" data-set="sunEl">
      <label class="flabel" for="fm-water">Water level</label><input type="range" id="fm-water" min="0.02" max="0.9" step="0.005" value="${R.waterLevel}" data-set="water">
      <label class="flabel" for="fm-obj">Object size</label><input type="range" id="fm-obj" min="0.4" max="3" step="0.1" value="${R.objScale}" data-set="objScale">
      <label class="flabel" for="fm-mpc">Each square is (meters)</label><input class="inp sm" id="fm-mpc" type="number" min="1" step="any" value="${Math.round(R.metersPerCell * 100) / 100}" data-set="mpc">
      <label class="flabel" for="fm-px">Pixel size</label><select class="inp sm" id="fm-px" data-set="px">${[2, 3, 4, 5].map(v => `<option value="${v}" ${v === pixelScale ? 'selected' : ''}>${v}×</option>`).join('')}</select>
      <label class="check"><input type="checkbox" data-set="retro" ${retro ? 'checked' : ''}> Retro color dithering</label>
      <label class="check"><input type="checkbox" data-set="anim" ${animate ? 'checked' : ''}> Animated water (uses more battery)</label>
      <div class="btn-row fm-gen"><button type="button" class="btn ghost sm" data-act="generate">Regenerate landscape…</button><button type="button" class="btn ghost sm" data-act="rename">Rename map</button></div>
    </section>`;
    }
    function drawPanel() { panel.innerHTML = selectedPanel() + toolPanel() + listsPanel() + settingsPanel(); }
    let setTimer = 0;
    panel.addEventListener('input', e => {
        const el = e.target;
        const k = el.dataset.set;
        if (!k)
            return;
        const v = Number(el.value);
        if (k === 'size') {
            brush.size = v;
            panel.querySelector('[data-out="size"]').textContent = String(v);
            return;
        }
        if (k === 'strength') {
            brush.strength = v;
            panel.querySelector('[data-out="strength"]').textContent = `${Math.round(v * 100)}%`;
            return;
        }
        if (k === 'sunAz' || k === 'sunEl') {
            if (k === 'sunAz')
                R.sun.az = v;
            else
                R.sun.el = v;
            dirty = true;
            clearTimeout(setTimer);
            setTimer = window.setTimeout(() => { st.refreshShadows(); ren.setTerrain(terrainInput()); ren.setObjects(st.objects, R.paths, R.objScale); dirty = true; scheduleSave(); }, 150);
            return;
        }
        if (k === 'water') {
            R.waterLevel = v;
            ren.setWater(st.waterY);
            cam.y = st.waterY;
            dirty = true;
            clearTimeout(setTimer);
            setTimer = window.setTimeout(() => { ren.setTerrain(terrainInput()); ren.setObjects(st.objects, R.paths, R.objScale); dirty = true; scheduleSave(); }, 200);
            return;
        }
        if (k === 'objScale') {
            R.objScale = v;
            ren.setObjects(st.objects, R.paths, R.objScale);
            dirty = true;
            scheduleSave();
            return;
        }
        if (k === 'mpc' && v > 0) {
            R.metersPerCell = v;
            dirty = true;
            scheduleSave();
        }
    });
    panel.addEventListener('change', e => {
        const el = e.target;
        if (el.dataset.set === 'px') {
            pixelScale = Number(el.value);
            ren.pixelScale = pixelScale;
            setPref('px', el.value);
            dirty = true;
        }
        if (el.dataset.set === 'retro') {
            retro = el.checked;
            setPref('retro', retro ? '1' : '0');
            dirty = true;
        }
        if (el.dataset.set === 'anim') {
            animate = el.checked;
            setPref('anim', animate ? '1' : '0');
            dirty = true;
        }
        if (el.dataset.set === 'water') {
            pushUndo();
        }
    });
    panel.addEventListener('click', async (e) => {
        const t = e.target;
        const btn = t.closest('button');
        if (!btn)
            return;
        if (btn.dataset.mat) {
            paintMat = Number(btn.dataset.mat);
            drawPanel();
            return;
        }
        if (btn.dataset.obj) {
            objType = Number(btn.dataset.obj);
            drawPanel();
            return;
        }
        if (btn.dataset.gotoPin) {
            const p = R.pins.find(q => q.id === btn.dataset.gotoPin);
            if (p) {
                selected = { kind: 'pin', id: p.id };
                cam.animateTo({ x: p.x * st.n, z: p.y * st.n, zoom: Math.max(cam.zoom, fitZoom() * 3) });
                drawPanel();
            }
            return;
        }
        if (btn.dataset.selPath) {
            selected = { kind: 'path', id: btn.dataset.selPath };
            dirty = true;
            return;
        }
        if (btn.dataset.delPath) {
            const p = R.paths.find(q => q.id === btn.dataset.delPath);
            if (!p || !await opts.dialogs.confirm(`Delete ${p.name ? `“${p.name}”` : `this ${p.kind}`}?`, { title: `Delete ${p.kind}?`, confirmLabel: 'Delete' }))
                return;
            pushUndo();
            R.paths = R.paths.filter(q => q.id !== p.id);
            rebuildAll();
            scheduleSave();
            drawPanel();
            return;
        }
        if (btn.dataset.delArea) {
            if (!await opts.dialogs.confirm('Delete this region?', { title: 'Delete region?', confirmLabel: 'Delete' }))
                return;
            pushUndo();
            R.areas = R.areas.filter(a => a.id !== btn.dataset.delArea);
            st.refreshAreas();
            ren.setTerrain(terrainInput());
            ren.setObjects(st.objects, R.paths, R.objScale);
            dirty = true;
            scheduleSave();
            drawPanel();
            return;
        }
        if (btn.dataset.openChild) {
            const c = opts.children().find(q => q.id === btn.dataset.openChild);
            if (c)
                enterChild(c);
            return;
        }
        const act = btn.dataset.act;
        if (act === 'finish')
            finishDrawing();
        if (act === 'cancel-draw') {
            drawing = [];
            dirty = true;
            drawPanel();
        }
        if (act === 'pin-edit') {
            const p = R.pins.find(q => q.id === selected?.id);
            if (p)
                placePin(0, 0, p);
        }
        if (act === 'pin-del') {
            pushUndo();
            R.pins = R.pins.filter(q => q.id !== selected?.id);
            selected = null;
            dirty = true;
            scheduleSave();
            drawPanel();
        }
        if (act === 'child-open') {
            const c = opts.children().find(q => q.id === selected?.id);
            if (c)
                enterChild(c);
        }
        if (act === 'child-del') {
            const c = opts.children().find(q => q.id === selected?.id);
            if (!c || !await opts.dialogs.confirm(`Delete the zoom-in map “${c.name}” and everything painted on it? This can't be undone.`, { title: 'Delete zoom-in map?', confirmLabel: 'Delete map' }))
                return;
            await opts.removeChild(c.id);
            selected = null;
            dirty = true;
            drawPanel();
        }
        if (act === 'rename') {
            const res = await opts.dialogs.form('Rename map', `<label class="flabel" for="fr-n">Name</label><input class="inp" id="fr-n" name="name" required maxlength="60" value="${esc(R.name)}">`);
            if (res?.name.trim()) {
                R.name = res.name.trim();
                root.querySelector('.fm-name').textContent = R.name;
                scheduleSave();
            }
        }
        if (act === 'generate') {
            const g = R.gen;
            const slider = (name, label, min, max, step) => `<label class="flabel" for="fg-${name}">${label}</label><input type="range" id="fg-${name}" name="${name}" min="${min}" max="${max}" step="${step}" value="${g[name]}">`;
            const res = await opts.dialogs.form('Regenerate landscape', `
        <p class="muted">Grows a new landscape from a seed. The same seed and settings always give the same land.</p>
        <label class="flabel" for="fg-seed">Seed</label><input class="inp" id="fg-seed" name="seed" type="number" value="${Math.floor(Math.random() * 1e6)}">
        <label class="flabel" for="fg-shape">Shape</label><select class="inp" id="fg-shape" name="shape">
          <option value="continent" ${g.shape === 'continent' ? 'selected' : ''}>Continent surrounded by sea</option>
          <option value="islands" ${g.shape === 'islands' ? 'selected' : ''}>Islands</option>
          <option value="inland" ${g.shape === 'inland' ? 'selected' : ''}>Inland (land to the edges)</option></select>
        ${slider('land', 'How much land', 0.1, 0.9, 0.01)}${slider('mountains', 'Mountains', 0, 1, 0.01)}${slider('roughness', 'Roughness', 0, 1, 0.01)}
        ${slider('moisture', 'Dry ← → Wet', -0.4, 0.4, 0.01)}${slider('cold', 'Warm ← → Cold', 0, 1, 0.01)}${slider('forests', 'Forests', 0, 1, 0.01)}
        <label class="check"><input type="checkbox" name="keep" value="1" checked> Keep my roads, rivers, regions and pins</label>`, 'Regenerate');
            if (!res)
                return;
            setStatus('Generating…');
            pushUndo();
            await new Promise(r2 => setTimeout(r2, 30));
            const gen = { shape: res.shape, land: Number(res.land), mountains: Number(res.mountains), roughness: Number(res.roughness), moisture: Number(res.moisture), cold: Number(res.cold), forests: Number(res.forests) };
            await regenerate(st, Number(res.seed) || 1, gen, res.keep === '1');
            rebuildAll();
            scheduleSave();
            drawPanel();
        }
    });
    root.querySelector('.fm-tools').addEventListener('click', e => {
        const b = e.target.closest('[data-tool]');
        if (b)
            setTool(b.dataset.tool);
    });
    root.querySelector('.fm-top').addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b)
            return;
        if (b.dataset.view)
            setView(b.dataset.view);
        if (b.dataset.openParent) {
            await flushSave();
            sessionStorage.setItem('wf-map-from', R.id);
            opts.open(b.dataset.openParent);
        }
        const act = b.dataset.act;
        if (act === 'rot-l')
            cam.animateTo({ yaw: cam.yaw + 90 }, 400);
        if (act === 'rot-r')
            cam.animateTo({ yaw: cam.yaw - 90 }, 400);
        if (act === 'fit')
            cam.animateTo({ x: st.n / 2, z: st.n / 2, zoom: fitZoom() });
        if (act === 'undo')
            doUndo(false);
        if (act === 'redo')
            doUndo(true);
    });
    setTool('move');
    return {
        destroy() {
            cancelAnimationFrame(raf);
            ro.disconnect();
            window.removeEventListener('keydown', onKey);
            flushSave();
            ren.destroy();
        },
    };
}
