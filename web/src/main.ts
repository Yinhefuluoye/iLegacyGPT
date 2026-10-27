import { Bridge } from './bridge';
import { App } from './app';

function boot(): void {
  const bridge = new Bridge();
  const app = new App(bridge);
  (window as any).__app = app;
  app.init().catch(function (err: any) {
    const box = document.createElement('pre');
    box.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:12px;z-index:999;margin:0;padding:10px 12px;' +
      'border-radius:10px;background:#fff;color:#b3261e;font-size:12px;line-height:1.5;white-space:pre-wrap;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.18)';
    box.textContent = 'UI init failed: ' + (err && err.message ? err.message : String(err));
    document.body.appendChild(box);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, false);
} else {
  boot();
}