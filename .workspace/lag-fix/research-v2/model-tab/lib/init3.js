/* model-tab: settle the fiber-attribution gap.
 * Question: is the settings panel inside the fiber tree whose root commits fire
 * on, and if so why does stateNode matching come back 'no-dom'?
 * Read-only; observation only. */
(() => {
  const S = { commits: [], rootInfo: null, diag: null, hookInstalled: false, commitsTotal: 0 };
  window.__MT3 = S;
  const fname = (f) => { try { const t = f.type; if (typeof t === 'string') return t; if (typeof t === 'function') return t.displayName || t.name || 'anon'; if (t && typeof t === 'object') return t.displayName || (t.render && (t.render.displayName || t.render.name)) || 'obj'; return 'nil'; } catch (e) { return 'err'; } };

  const diag = () => {
    const out = {};
    const dlg = document.querySelector('[role="dialog"]');
    const nav = dlg && dlg.querySelector('nav');
    const content = nav ? nav.nextElementSibling : null;
    const panel = content && content.parentElement ? content.parentElement : content;
    const kf = (el) => { if (!el) return null; const k = Object.keys(el).filter((x) => x.startsWith('__react')); return k.length ? k : null; };
    out.dialog = { present: !!dlg, cls: dlg ? String(dlg.className).slice(0, 60) : null, nodes: dlg ? dlg.getElementsByTagName('*').length : 0, reactKeys: kf(dlg), parent: dlg && dlg.parentElement ? dlg.parentElement.tagName + '.' + String(dlg.parentElement.className).slice(0, 40) : null };
    out.content = { present: !!content, nodes: content ? content.getElementsByTagName('*').length : 0, reactKeys: kf(content) };
    out.panel = { present: !!panel, tag: panel ? panel.tagName : null, cls: panel ? String(panel.className).slice(0, 40) : null, nodes: panel ? panel.getElementsByTagName('*').length : 0, reactKeys: kf(panel) };
    out.bodyReactKeys = kf(document.body);
    out.rootReactKeys = kf(document.getElementById('root') || document.documentElement);
    out.bodyChildren = [...document.body.children].map((c) => c.tagName + '.' + String(c.className).slice(0, 30)).slice(0, 12);
    if (content) {
      const key = Object.keys(content).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'));
      out.contentFiberKey = key || null;
      if (key) {
        let f = content[key];
        const chain = [];
        let i = 0;
        while (f && i++ < 40) { chain.push(fname(f) + (f.tag === 3 ? '(HostRoot)' : f.tag === 5 ? '(Host)' : '') + (f.stateNode ? '[' + (f.stateNode.nodeType || 'x') + ']' : '[null]')); f = f.return; }
        out.contentAncestorChain = chain;
      }
    }
    return out;
  };

  const install = (hook) => {
    S.hookInstalled = true;
    const prev = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = function () {
      const fr = arguments[1];
      S.commitsTotal++;
      if (S.commits.length < 60) {
        try {
          const root = fr && fr.current;
          const info = { n: S.commitsTotal, t: Math.round(performance.now()), containerTag: fr && fr.containerInfo ? fr.containerInfo.tagName : null, containerCls: fr && fr.containerInfo ? String(fr.containerInfo.className || '').slice(0, 30) : null, rootTag: root && root.tag, rootFname: root ? fname(root) : null, tagHist: {}, stateNodeKind: {}, matchedPanel: 0 };
          const dlg = document.querySelector('[role="dialog"]');
          const de = new Set(); if (dlg) { de.add(dlg); const a = dlg.getElementsByTagName('*'); for (let i = 0; i < a.length; i++) de.add(a[i]); }
          const walk = (n, d) => {
            let c = 0;
            while (n && c < 40000) {
              const t = String(n.tag);
              info.tagHist[t] = (info.tagHist[t] || 0) + 1;
              const sn = n.stateNode;
              const kind = sn == null ? 'null' : sn.nodeType ? 'node' + sn.nodeType : (typeof sn === 'object' ? 'fiberStateNode' : typeof sn);
              info.stateNodeKind[kind] = (info.stateNodeKind[kind] || 0) + 1;
              if (sn && sn.nodeType === 1 && de.has(sn)) info.matchedPanel++;
              if (n.child && d < 60) walk(n.child, d + 1);
              n = n.sibling; c++;
            }
          };
          walk(root, 0);
          S.commits.push(info);
        } catch (e) { S.commits.push({ err: String(e).slice(0, 120) }); }
      }
      if (typeof prev === 'function') { try { return prev.apply(this, arguments); } catch (e) { } }
    };
  };
  if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) install(window.__REACT_DEVTOOLS_GLOBAL_HOOK__);
  else {
    const l = {};
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers: new Map(), on(e, f) { (l[e] = l[e] || []).push(f); }, off() { }, sub(e, f) { (l[e] = l[e] || []).push(f); return () => { }; }, emit() { }, inject() { return 1; }, onCommitFiberRoot() { }, onCommitFiberUnmount() { }, onPostCommitFiberRoot() { } };
    install(window.__REACT_DEVTOOLS_GLOBAL_HOOK__);
  }
  S.diagNow = diag;
})();
