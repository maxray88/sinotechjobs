#!/usr/bin/env bash
# generate-og.sh — SinotechJobs OG card pipeline
# Docs: docs/og-pipeline.md + docs/og-pipeline.json
# Outputs: public/media/og-home.png public/media/og-jobs.png public/media/og-article.png (1200x630)
# Brand: primary #1e3a5f / accent #e11d48 / muted #f1f5f9 (src/app/globals.css)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$ROOT/docs/og-pipeline.json"
OUTDIR="$ROOT/public/media"
mkdir -p "$OUTDIR"

usage() {
  cat <<EOF
Usage: bash scripts/generate-og.sh [options]
  --comfyui         Run ComfyUI workflow (requires comfyui CLI + checkpoint)
  --template NAME   Only generate one template: home|jobs|article
  --fallback        Regenerate placeholder PNGs via Node (no deps, default if no comfyui)
  --help            Show this help

Examples:
  # Full ComfyUI pipeline (preferred when GPU available):
  comfyui --workflow docs/og-pipeline.json --output public/media/
  # Single template:
  comfyui --workflow docs/og-pipeline.json --prompt-template home --output public/media/og-home.png
  # Fallback without ComfyUI (Node stdlib only):
  bash scripts/generate-og.sh --fallback

Workflow JSON: docs/og-pipeline.json (canvas 1200x630, brand tokens, 3 prompts)
Fallback SVGs: public/media/og-home.svg etc. (valid og:image if PNG missing)
EOF
}

TEMPLATE="${1:-}"
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then usage; exit 0; fi

# --- ComfyUI path (requires external install) ---
# comfyui --workflow docs/og-pipeline.json --output public/media/
# If comfyui is on PATH and user asked for it, run it:
if [[ "${1:-}" == "--comfyui" ]]; then
  shift || true
  TPL="${1:-}"
  if command -v comfyui >/dev/null 2>&1; then
    if [[ -n "$TPL" && "$TPL" != "--template" ]]; then
      echo "[og] Running ComfyUI for template: $TPL"
      comfyui --workflow "$WORKFLOW" --prompt-template "$TPL" --output "$OUTDIR/og-${TPL}.png"
    elif [[ "${1:-}" == "--template" ]]; then
      TPL2="${2:-home}"
      echo "[og] Running ComfyUI for template: $TPL2"
      comfyui --workflow "$WORKFLOW" --prompt-template "$TPL2" --output "$OUTDIR/og-${TPL2}.png"
    else
      echo "[og] Running ComfyUI full pipeline → $OUTDIR"
      comfyui --workflow "$WORKFLOW" --output "$OUTDIR"
    fi
    echo "[og] Copy outputs: ComfyUI/output/og-*.png → $OUTDIR (if SaveImage used ComfyUI/output)"
    # ComfyUI default writes to ComfyUI/output; copy into repo if needed:
    if [[ -d "ComfyUI/output" ]]; then
      cp -v ComfyUI/output/og-*.png "$OUTDIR"/ 2>/dev/null || true
    fi
    ls -lh "$OUTDIR"/og-*.png "$OUTDIR"/og-*.svg 2>/dev/null || true
    exit 0
  else
    echo "[og] comfyui CLI not found — falling back to Node placeholder generation." >&2
  fi
fi

# --- Fallback: Node zlib PNG generation (no deps) ---
# This is the default path used in CI / without GPU. It produces valid 1200x630 PNGs
# that approximate the SVG layouts (brand colors, 14px accent bar, safe margins).
# For crisp text, serve the companion SVGs: public/media/og-*.svg (1200x630).
echo "[og] Generating placeholder PNGs via Node (no deps, 1200x630) → $OUTDIR"
node <<'NODE'
import fs from 'fs';
import zlib from 'zlib';
function crc32(buf){let t=crc32.table;if(!t){t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}crc32.table=t;}let c=0^-1;for(let i=0;i<buf.length;i++)c=(c>>>8)^t[(c^buf[i])&0xFF];return(c^-1)>>>0;}
function chunk(type,data){const l=Buffer.alloc(4);l.writeUInt32BE(data.length,0);const tb=Buffer.from(type);const cb=Buffer.alloc(4);cb.writeUInt32BE(crc32(Buffer.concat([tb,data])),0);return Buffer.concat([l,tb,data,cb]);}
function createPNG(w,h,rgbaFn){const sig=Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]);const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;const ihdrC=chunk('IHDR',ihdr);const rb=w*4+1,raw=Buffer.alloc(rb*h);for(let y=0;y<h;y++){raw[y*rb]=0;for(let x=0;x<w;x++){const [r,g,b,a]=rgbaFn(x,y,w,h);const o=y*rb+1+x*4;raw[o]=r;raw[o+1]=g;raw[o+2]=b;raw[o+3]=a;}}const idat=chunk('IDAT',zlib.deflateSync(raw));return Buffer.concat([sig,ihdrC,idat,chunk('IEND',Buffer.alloc(0))]);}
const primary=[0x1e,0x3a,0x5f],accent=[0xe1,0x1d,0x48],muted=[0xf1,0xf5,0xf9],white=[255,255,255];
const clamp=v=>Math.max(0,Math.min(255,Math.round(v)));
function homeRGBA(x,y,w,h){const cx=w/2,cy=h/2,dx=(x-cx)/w,dy=(y-cy)/h,dist=Math.sqrt(dx*dx+dy*dy),t=Math.min(1,dist*1.4),light=[0x2c,0x52,0x82],r=clamp(primary[0]*(1-t*0.35)+light[0]*t*0.35),g=clamp(primary[1]*(1-t*0.35)+light[1]*t*0.35),b=clamp(primary[2]*(1-t*0.35)+light[2]*t*0.35);if(y>=h-14)return[...accent,255];if(y>=165&&y<465&&x>=120&&x<1080){if(y===165||y===464||x===120||x===1079)return[0x33,0x55,0x88,255];if(y<190)return[0xf8,0xfa,0xfc,255];return[...white,255];}if(x%40===0&&y%40===0)return[clamp(r+22),clamp(g+28),clamp(b+28),255];return[r,g,b,255];}
function jobsRGBA(x,y,w,h){if(y<96){if(y>=88)return[...accent,255];return[...primary,255];}if(y>=h-14)return[...accent,255];const tops=[130,250,370],ch=95;for(let i=0;i<3;i++){const top=tops[i];if(y>=top&&y<top+ch&&x>=80&&x<1120){if(y===top||y===top+ch-1||x===80||x===1119)return[0xe2,0xe8,0xf0,255];if(x<84)return[...primary,255];return[...white,255];}}return[...white,255];}
function articleRGBA(x,y,w,h){if(y>=h-14)return[...accent,255];if(y<72)return[...primary,255];if(y>=110&&y<520&&x>=90&&x<1110){if(y===110||y===519||x===90||x===1109)return[0xe2,0xe8,0xf0,255];if(y<175&&x>=110&&x<1090){if(y>=130&&y<142&&x>=110&&x<760)return[...primary,255];if(y>=150&&y<158&&x>=110&&x<620)return[0x64,0x74,0x8b,255];return[...white,255];}if(y>=175&&y<178)return[...accent,255];return[...white,255];}const t=Math.abs(y-h/2)/h;return[clamp(muted[0]-t*6),clamp(muted[1]-t*6),clamp(muted[2]-t*6),255];}
const W=1200,H=630;import path from 'path';fs.mkdirSync('public/media',{recursive:true});fs.writeFileSync('public/media/og-home.png',createPNG(W,H,homeRGBA));fs.writeFileSync('public/media/og-jobs.png',createPNG(W,H,jobsRGBA));fs.writeFileSync('public/media/og-article.png',createPNG(W,H,articleRGBA));console.log('[og-fallback] PNGs regenerated (1200x630, valid PNG sig 89504e47)');
NODE
ls -lh "$OUTDIR"/og-*.png "$OUTDIR"/og-*.svg 2>/dev/null || true
echo "[og] Done. Verify: file $OUTDIR/og-*.png && curl -I http://localhost:3000/media/og-home.png"
echo "[og] Docs: docs/og-pipeline.md (prompts, workflow JSON, satori fallback)"
