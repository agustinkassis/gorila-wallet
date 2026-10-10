import { GorillaLogo } from "@/components/logo"

/**
 * Desktop app boot screen. The window opens on the same screen served locally (src-tauri/splash) while the server
 * starts; here it covers the first page load, the bar filling as the page's scripts, styles and fonts arrive, then
 * fades out. Only in the desktop app (src-tauri sets __GORILLA_NATIVE__ before any script): the web never shows it.
 */
const CSS = `
#splash{display:none}
[data-boot] #splash{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:16px;background:linear-gradient(160deg,#d81e2a 0%,#b20e18 50%,#6b0710 100%);color:#fff;transition:opacity .35s ease,visibility .35s}
[data-boot=done] #splash{opacity:0;visibility:hidden;pointer-events:none}
#splash h1{margin:0;font:800 clamp(28px,6vw,44px)/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.18em;text-indent:.18em;text-align:center}
#splash svg{width:clamp(112px,24vw,168px);height:auto;margin-bottom:4px}
#splash .track{width:min(240px,60vw);height:4px;border-radius:999px;background:rgba(255,255,255,.25);overflow:hidden}
#splash-bar{height:100%;border-radius:inherit;background:#fff;transform:scaleX(0);transform-origin:left;transition:transform .2s ease-out}
`

// Progress = page assets with a finished resource timing entry / page assets found so far (capped until the HTML is
// fully parsed, since more keep appearing). Done once everything has loaded; 20 s at most, never stuck on a slow asset.
const PROGRESS = `(function(){
var root=document.documentElement;if(!root.dataset.boot)return;
var bar=document.getElementById("splash-bar"),shown=0,start=Date.now();
function step(){
var urls={},total=0,loaded=0,seen={};
document.querySelectorAll("script[src]:not([nomodule]),link[rel=stylesheet][href],link[rel=preload][href]").forEach(function(e){urls[e.src||e.href]=1});
performance.getEntriesByType("resource").forEach(function(e){seen[e.name]=1});
for(var u in urls){total++;if(seen[u])loaded++}
var p=total?loaded/total:0;if(document.readyState==="loading")p=Math.min(p,.9);
shown=Math.max(shown,p);bar.style.transform="scaleX("+shown+")";
if((shown>=1&&document.readyState==="complete")||Date.now()-start>2e4)return setTimeout(function(){root.dataset.boot="done"},250);
requestAnimationFrame(step)}
step()})()`

/** In <head>: the styles, and the native flag turned into data-boot before anything paints. */
export function SplashHead() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <script dangerouslySetInnerHTML={{ __html: `if(window.__GORILLA_NATIVE__)document.documentElement.dataset.boot="native"` }} />
    </>
  )
}

/** First thing in <body>, so it paints before the app. */
export function Splash() {
  return (
    <>
      <div id="splash" aria-hidden="true">
        <GorillaLogo />
        <h1>GORILA WALLET</h1>
        <div className="track">
          <div id="splash-bar" />
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: PROGRESS }} />
    </>
  )
}
