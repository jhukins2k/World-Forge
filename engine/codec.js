// Packing big grids into compact text for saving and syncing.
async function gzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}
function fromBase64(text) {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
export async function packBytes(bytes) { return toBase64(await gzip(bytes)); }
export async function unpackBytes(text) { return text ? gunzip(fromBase64(text)) : new Uint8Array(0); }
export async function packHeights(h) {
    const q = new Uint16Array(h.length);
    for (let i = 0; i < h.length; i++)
        q[i] = Math.round(Math.min(1, Math.max(0, h[i])) * 65535);
    return packBytes(new Uint8Array(q.buffer));
}
export async function unpackHeights(text, n) {
    const out = new Float32Array(n);
    const b = await unpackBytes(text);
    if (b.length < n * 2)
        return out;
    const q = new Uint16Array(b.buffer, b.byteOffset, n);
    for (let i = 0; i < n; i++)
        out[i] = q[i] / 65535;
    return out;
}
export async function packFloats(f) { return packBytes(new Uint8Array(f.buffer.slice(0))); }
export async function unpackFloats(text) {
    const b = await unpackBytes(text);
    return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.length - (b.length % 4))));
}
