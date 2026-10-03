export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function hexA(hex,alpha){const n=parseInt(hex.replace('#',''),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${alpha})`;}
