export type PerspectivePoint = { x: number; y: number };
export type PerspectiveQuad = [PerspectivePoint, PerspectivePoint, PerspectivePoint, PerspectivePoint];
export const DEFAULT_QUAD: PerspectiveQuad = [{ x: 2, y: 2 }, { x: 98, y: 2 }, { x: 98, y: 98 }, { x: 2, y: 98 }];

const affineTriangle = (ctx: CanvasRenderingContext2D, image: CanvasImageSource, s: PerspectivePoint[], d: PerspectivePoint[]) => {
  const det = s[0].x * (s[1].y - s[2].y) + s[1].x * (s[2].y - s[0].y) + s[2].x * (s[0].y - s[1].y);
  if (Math.abs(det) < 0.001) return;
  const solve = (values: number[]) => ({
    a: (values[0] * (s[1].y - s[2].y) + values[1] * (s[2].y - s[0].y) + values[2] * (s[0].y - s[1].y)) / det,
    b: (values[0] * (s[2].x - s[1].x) + values[1] * (s[0].x - s[2].x) + values[2] * (s[1].x - s[0].x)) / det,
    c: (values[0] * (s[1].x * s[2].y - s[2].x * s[1].y) + values[1] * (s[2].x * s[0].y - s[0].x * s[2].y) + values[2] * (s[0].x * s[1].y - s[1].x * s[0].y)) / det,
  });
  const tx = solve(d.map((p) => p.x)), ty = solve(d.map((p) => p.y));
  ctx.save(); ctx.beginPath(); ctx.moveTo(d[0].x, d[0].y); ctx.lineTo(d[1].x, d[1].y); ctx.lineTo(d[2].x, d[2].y); ctx.closePath(); ctx.clip();
  ctx.setTransform(tx.a, ty.a, tx.b, ty.b, tx.c, ty.c); ctx.drawImage(image, 0, 0); ctx.restore();
};

export async function warpPerspective(source: string, quadPercent: PerspectiveQuad, maxEdge = 2400) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => { const item = new Image(); item.crossOrigin = "anonymous"; item.onload = () => resolve(item); item.onerror = reject; item.src = source; });
  const q = quadPercent.map((p) => ({ x: p.x * image.naturalWidth / 100, y: p.y * image.naturalHeight / 100 })) as PerspectiveQuad;
  const top = Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y), bottom = Math.hypot(q[2].x-q[3].x,q[2].y-q[3].y), left = Math.hypot(q[3].x-q[0].x,q[3].y-q[0].y), right = Math.hypot(q[2].x-q[1].x,q[2].y-q[1].y);
  let width = Math.max(top,bottom), height = Math.max(left,right); const scale = Math.min(1, maxEdge / Math.max(width,height)); width = Math.max(2, Math.round(width*scale)); height = Math.max(2, Math.round(height*scale));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d")!; ctx.fillStyle = "white"; ctx.fillRect(0,0,width,height);
  const cells = 24, bilinear = (u:number,v:number) => ({ x:(1-u)*(1-v)*q[0].x+u*(1-v)*q[1].x+u*v*q[2].x+(1-u)*v*q[3].x, y:(1-u)*(1-v)*q[0].y+u*(1-v)*q[1].y+u*v*q[2].y+(1-u)*v*q[3].y });
  for(let y=0;y<cells;y++) for(let x=0;x<cells;x++){ const u=x/cells,v=y/cells,u2=(x+1)/cells,v2=(y+1)/cells; const s00=bilinear(u,v),s10=bilinear(u2,v),s11=bilinear(u2,v2),s01=bilinear(u,v2); const d00={x:u*width,y:v*height},d10={x:u2*width,y:v*height},d11={x:u2*width,y:v2*height},d01={x:u*width,y:v2*height}; affineTriangle(ctx,image,[s00,s10,s11],[d00,d10,d11]); affineTriangle(ctx,image,[s00,s11,s01],[d00,d11,d01]); }
  return canvas.toDataURL("image/png");
}
