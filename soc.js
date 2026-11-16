// ============================================================
//  AI 訂正（v3.34，2026-11-16）：獨立檔 soc.js，和 student.html 放同一個資料夾。
//  只有 student.html 在「場次 soc＝true、已公布結果、網址帶 sw」時才載入（core.js 的 socLoad），單純形成性評量完全不下載；route-a／b 不載入
//  老師：「好，修正為答錯後一鍵進入蘇格拉底訂正，但是要在教師結束考試之後，才出現蘇格拉底訂正的選項」
//  ・出現條件：場次 soc＝true（老師建立場次時勾「公布結果後開放 AI 訂正」）、results 不為空（已按「公布結果」）、網址帶 sw（Worker 網址）
//    三個都成立才顯示按鈕、才載入面板；Worker 端再用 Firestore 檢查一次（action:'fa'）
//  ・題目、正解、選項、迷思存 sessionStorage（fa-socres:代碼:座號）：老師按「結束場次」刪掉雲端資料後仍可繼續
//  ・對話存 localStorage（fa-soc:代碼:座號:題目），重新整理可接續；進度回寫自己座號文件的 soc（場次還在才寫）
// ============================================================
window.FA_SOC_INIT = function (X) {
  const { params, $, esc, M, V, ls, ss, show, toast, roundItems, rk, FIG, OPT_COLOR, renderStudent, stopStudent, LocalStore, FireStore } = X;
  const url = X.sw;
  const STG = ['', '條件', '關係', '計算', '驗算'];
  const STAGE_RE = /^\s*\**\s*階段[:：]\s*(條件|關係|計算|驗算|完成)\s*\**\s*\n?/;
  const STAGE_MAP = { 條件: 1, 關係: 2, 計算: 3, 驗算: 4, 完成: 5 };
  const QUICK = { 1: ['我不知道從哪裡開始', '請給我一點提示', '我當時是這樣想的：'], 2: ['我不知道要用哪個性質', '請給我一點提示', '我列的式子是：'], 3: ['我算出來是：', '我卡在計算', '請檢查我的算式'], 4: ['要怎麼驗算？', '我代回去檢查了：', '我覺得答案怪怪的'] };
  const resKey = (code, seat) => `fa-socres:${code || X.S.code}:${seat || X.S.seat}`;
  const chatKey = id => `fa-soc:${X.S.code}:${X.S.seat}:${id}`;
  let P = null, busy = false, ticketsAsked = '';
  const figCache = {};

  const on = s => !!(url && s && s.soc === true && s.results && typeof s.results === 'object' && Object.keys(s.results).length);
  function remember(s) {
    const old = ss.get(resKey()) || {};
    ss.set(resKey(), { session: { label: s.label || '', soc: true, round: s.round, sets: s.sets, results: s.results, active: true }, ans: X.S.ans, demo: !!(X.store && X.store.mode === 'demo'), tickets: old.tickets || {} });
  }
  function cached() { if (!X.S.code) return null; const c = ss.get(resKey()); return c && c.session && on(c.session) ? c.session : null; }
  function forget() { if (X.S.code && ss.get(resKey())) ss.del(resKey()); close(true); }
  // 重新整理時場次已被刪除（加入失敗）：用平板存的結果繼續
  function resume(saved) {
    const c = ss.get(resKey(saved.code, saved.seat)); if (!c || !c.session || !on(c.session)) return false;
    if (c.demo) X.store = new LocalStore(); else if (!X.store || X.store.mode !== 'cloud') X.store = new FireStore();
    stopStudent(); Object.assign(X.S, { code: saved.code, seat: saved.seat, ans: c.ans || {}, done: {}, round: 0, session: null, hasLocal: true, pend: new Map(), loading: false });
    show('v-stu'); renderStudent(); return true;
  }
  const sess = () => (X.S.session && X.S.session.results ? X.S.session : cached());
  const state = id => { const c = ls.get(chatKey(id), null); return c && Array.isArray(c.chat) ? c : { chat: [], stage: 1, done: false }; };
  const misOf = (R, choice) => (choice && R && R.mis && R.mis[choice]) || null;

  // 結果表的一格：按鈕＋已完成／進行中
  function cell(it, round, a, no) {
    const c = state(it.id), going = c.chat.some(m => m.role === 'me');
    return `<button class="btn sm ${c.done ? 'ghost' : 'qing'} soc-go" data-soc="${esc(it.id)}" data-r="${round}" data-no="${no}">🤖 和 AI 一起訂正</button>${c.done ? '<span class="soc-badge">✓ 已完成</span>' : going ? '<span class="soc-badge go">進行中</span>' : ''}`;
  }
  function after(s) {
    document.querySelectorAll('#v-stu [data-soc]').forEach(b => b.onclick = () => open(b.dataset.soc, +b.dataset.r, +b.dataset.no));
    if (P) paint();
    if (ticketsAsked !== X.S.code + ':' + X.S.seat && X.S.session && X.S.session.results) { ticketsAsked = X.S.code + ':' + X.S.seat; getTickets(); }
  }
  // 訂正憑證：公布結果後先拿（不算次數），之後老師刪掉場次也能開始或繼續訂正
  async function getTickets() {
    try {
      const tok = await X.store.idToken();
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'faTickets', fbProject: X.store.projectId, idToken: tok, code: X.S.code, seat: X.S.seat }) });
      if (!r.ok) return;
      const d = await r.json(); const c = ss.get(resKey()); if (c && d && d.tickets) { c.tickets = d.tickets; ss.set(resKey(), c); }
    } catch (e) { /* 拿不到就算了：場次還在時照常驗證 */ }
  }

  function cur() {
    const s = sess(); if (!s || !P) return null;
    const it = roundItems(s, P.round).find(x => x.id === P.id); const R = s.results[P.id];
    if (!it || !R) return null;
    return { s, it, R, a: X.S.ans[rk(it.id, P.round)] || null };
  }
  function panel() {
    let el = $('soc-panel');
    if (!el) { el = document.createElement('div'); el.id = 'soc-panel'; el.hidden = true; $('stage').appendChild(el); }
    return el;
  }
  function open(id, round, no) {
    P = { id, round, no, err: '', retry: '' };
    const x = cur(); if (!x) { P = null; toast('找不到這一題'); return; }
    panel().hidden = false; paint();
    if (!state(id).chat.length) send(intro(x));
  }
  function close(silent) { P = null; const el = $('soc-panel'); if (el) { el.hidden = true; el.innerHTML = ''; } if (!silent && $('v-stu') && !$('v-stu').hidden) renderStudent(); }
  const intro = x => x.a && x.a.choice ? `我選了 ${x.a.choice}，想知道哪裡錯了。` : '這題我沒有作答，想弄懂怎麼做。';
  const txt = t => String(t || '').split('\n').map(l => V.mathHTML(l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')).join('<br>');
  function msgHTML(m) {
    if (m.role === 'me') return `<div class="soc-msg me">${txt(m.text)}</div>`;
    if (m.role === 'err') return `<div class="soc-msg err">${esc(m.text)}</div>`;
    if (m.role === 'wait') return `<div class="soc-msg tutor"><span class="soc-dots"><i></i><i></i><i></i></span></div>`;
    return `<div class="soc-msg tutor">${m.stage ? `<span class="soc-pill s${m.stage}">${m.stage === 5 ? '完成' : STG[m.stage]}</span>` : ''}${txt(m.text)}</div>`;
  }
  function paint(extra) {
    const x = cur(); if (!x) return close();
    const { it, R, a } = x, c = state(it.id), choice = a && a.choice || '', mis = misOf(R, choice), el = panel();
    if (!el.firstChild) el.innerHTML = `
      <div class="soc-bar"><button class="btn sm ghost" id="soc-back">← 回到我的結果</button><b id="soc-title"></b><span id="soc-badge"></span></div>
      <div class="soc-q" id="soc-q"></div>
      <div class="soc-steps" id="soc-steps"></div>
      <div class="soc-msgs" id="soc-msgs" aria-live="polite"></div>
      <div class="soc-quick" id="soc-quick"></div>
      <form class="soc-form" id="soc-form"><input id="soc-inp" autocomplete="off" enterkeyhint="send" placeholder="輸入你的想法、算式或答案…"><button class="btn zhu" id="soc-send" type="submit">送出</button></form>
      <div class="soc-hint" id="soc-hint"></div>`;
    $('soc-title').textContent = `第 ${P.no} 題・${P.round === 2 ? '第二場（平行題）' : '第一場'}・和 AI 一起訂正`;
    $('soc-badge').innerHTML = c.done ? '<span class="soc-badge">✓ 已完成</span>' : '';
    if ($('soc-q').dataset.id !== it.id) {
      $('soc-q').dataset.id = it.id;
      $('soc-q').innerHTML = `<div class="soc-stem">${M(it.stem)}</div>${FIG(it, 'fig-soc')}
        <div class="soc-opts">${it.options.map(o => `<div class="soc-opt ${o.key === R.answer ? 'ans' : ''} ${o.key === choice ? 'mine' : ''}"><span class="k" style="background:${OPT_COLOR(o.key)}">${o.key}</span><span class="t">${M(o.text)}</span>${o.key === choice ? '<em class="me">你選的</em>' : ''}${o.key === R.answer ? '<em class="ok">正解</em>' : ''}</div>`).join('')}</div>
        <div class="soc-mis">${!choice ? '這題你沒有作答。' : mis ? `可能的迷思：<b>${M(mis.name)}</b>` : ''}</div>`;
    }
    $('soc-steps').innerHTML = [1, 2, 3, 4, 5].map(k => `<span class="soc-step ${k === 5 ? (c.done ? 'on' : '') : c.done || c.stage > k ? 'done' : c.stage === k ? 'on' : ''}">${k === 5 ? '完成' : STG[k]}</span>`).join('<i>›</i>');
    const box = $('soc-msgs');
    box.innerHTML = c.chat.map(msgHTML).join('') + (extra ? msgHTML(extra) : '') + (P.err && !busy ? msgHTML({ role: 'err', text: P.err }) : '');
    box.scrollTop = box.scrollHeight;
    const q = busy ? [] : P.err && P.retry ? ['再送一次'] : !c.chat.length ? ['開始訂正'] : c.done ? ['換一種方法再想一次'] : (QUICK[c.stage] || []);
    $('soc-quick').innerHTML = q.map(t => `<button type="button" class="btn sm ghost" data-q="${esc(t)}">${esc(t)}</button>`).join('');
    $('soc-inp').disabled = busy; $('soc-send').disabled = busy;
    $('soc-hint').textContent = P.hint || '';
    $('soc-back').onclick = () => close();
    $('soc-quick').onclick = e => { const b = e.target.closest('[data-q]'); if (!b) return; const t = b.dataset.q;
      if (t === '再送一次') return send(P.retry); if (t === '開始訂正') return send(intro(x));
      if (/[：:]$/.test(t)) { const i = $('soc-inp'); i.value = t; i.focus(); } else send(t); };
    $('soc-form').onsubmit = e => { e.preventDefault(); const v = $('soc-inp').value; $('soc-inp').value = ''; send(v); };
  }
  function live(t, c) {   // 串流中：逐字更新最後一則
    const m = t.match(STAGE_RE);
    if (!m && /^\s*\**\s*階/.test(t) && !t.includes('\n')) return;   // 還在寫「階段：」那一行
    const st = m ? STAGE_MAP[m[1]] : c.stage, body = m ? t.slice(m[0].length) : t;
    const box = $('soc-msgs'), last = box && box.lastElementChild; if (!last || !body.trim()) return;
    last.outerHTML = msgHTML({ role: 'tutor', stage: st, text: body }); box.scrollTop = box.scrollHeight;
  }
  async function send(text) {
    text = String(text || '').trim(); if (!text || busy || !P) return;
    const id = P.id, c = state(id); c.chat.push({ role: 'me', text }); P.err = ''; P.retry = '';
    busy = true; ls.set(chatKey(id), c); paint({ role: 'wait' });
    try {
      const r = await callWorker(c);
      const m = r.text.match(STAGE_RE); const st = m ? STAGE_MAP[m[1]] : c.stage; const body = (m ? r.text.slice(m[0].length) : r.text).trim();
      c.chat.push({ role: 'tutor', stage: st, text: body });
      if (st === 5) { c.done = true; c.stage = 4; } else c.stage = st;
      if (P && P.id === id) P.hint = r.remaining != null && r.remaining <= 10 ? `今天還可以訂正對話 ${r.remaining} 次。` : '';
    } catch (e) {
      c.chat.pop();                                       // 沒送到：把這句收回，可以「再送一次」
      if (P && P.id === id) { P.err = e.message || '連線失敗，請再送出一次。'; P.retry = text; }
    } finally {
      busy = false; ls.set(chatKey(id), c); if (P && P.id === id) paint(); writeBack();
    }
  }
  function why(status, m) {
    if (status === 429) return /全站/.test(m) ? '今天全校的 AI 訂正次數已達上限，明天再繼續。' : '今天的訂正次數用完了，明天再繼續。';
    if (status === 403) return m || '現在不能和 AI 訂正。';
    if (status >= 500) return m || 'AI 服務暫時忙線，請過一兩分鐘再送出一次。';
    return m || `AI 訂正服務發生錯誤（${status}），請再送出一次。`;
  }
  async function callWorker(c) {
    const x = cur(); if (!x) throw new Error('找不到這一題');
    const { it, R, a } = x, choice = a && a.choice || '';
    const hist = c.chat.filter(m => m.role === 'me' || m.role === 'tutor').map(m => ({ role: m.role === 'me' ? 'user' : 'tutor', text: (m.role === 'tutor' && m.stage ? '階段：' + (m.stage === 5 ? '完成' : STG[m.stage]) + '\n' : '') + m.text }));
    let tok; try { tok = await X.store.idToken(); } catch (e) { throw new Error('連不上登入服務，請確認網路後再送出一次。'); }
    const tk = ((ss.get(resKey()) || {}).tickets || {})[it.id];
    const body = { action: 'fa', fbProject: X.store.projectId, idToken: tok, code: X.S.code, itemId: it.id, round: P.round, seat: X.S.seat, choice, mis: misOf(R, choice) || {},
      history: hist, stage: c.stage, fig: await figPng(it), ticket: c.ticket || (tk && tk.t) || '',
      snap: { stem: it.stem, options: it.options.map(o => ({ key: o.key, text: o.text })), answer: R.answer, choice: tk ? tk.choice : choice } };
    let res; try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('連不上 AI 訂正服務，請確認網路後再送出一次。'); }
    if (!res.ok) { let m = ''; try { m = (await res.json()).error || ''; } catch (e) { } throw new Error(why(res.status, m)); }
    const t2 = res.headers.get('X-FA-Ticket'); if (t2) c.ticket = t2;
    const rem = res.headers.get('X-Remaining');
    const rd = res.body.getReader(), dec = new TextDecoder(); let t = '', queued = false;
    for (; ;) { const { done, value } = await rd.read(); if (done) break; t += dec.decode(value, { stream: true }); if (!queued && P && P.id === it.id) { queued = true; requestAnimationFrame(() => { queued = false; if (P && P.id === it.id && busy) live(t, c); }); } }
    return { text: t, remaining: rem === null || rem === '' ? null : Number(rem) };
  }
  // 附圖（SVG）→ PNG base64，200 KB 以內（太大就縮小，還是太大就不送）
  async function figPng(it) {
    if (!it.fig) return '';
    if (it.id in figCache) return figCache[it.id];
    let out = '';
    try {
      const doc = new DOMParser().parseFromString(V.safeSVG(it.fig), 'image/svg+xml'); const el = doc.documentElement;
      if (!el.getAttribute('xmlns')) el.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      const w0 = vb[2] || parseFloat(el.getAttribute('width')) || 400, h0 = vb[3] || parseFloat(el.getAttribute('height')) || 300;
      const sc = Math.min(3, 1000 / Math.max(w0, h0));
      el.setAttribute('width', w0 * sc); el.setAttribute('height', h0 * sc);
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(el));
      await img.decode();
      for (const k of [1, 0.75, 0.55, 0.4]) {
        const cv = document.createElement('canvas'); cv.width = Math.round(w0 * sc * k); cv.height = Math.round(h0 * sc * k);
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        const d = cv.toDataURL('image/png').split(',')[1];
        if (d.length * 3 / 4 <= 200 * 1024) { out = d; break; }
      }
    } catch (e) { out = ''; }
    return (figCache[it.id] = out);
  }
  // 進度回寫：自己座號文件的 soc＝{題目:{stage,done,n}}；場次已結束（或還沒公布）就不寫、不報錯
  function writeBack() {
    const s = X.S.session; if (!X.store || !X.store.saveSoc || !s || !s.active || s.soc !== true || !s.results) return;
    const m = {};
    for (const r of [1, 2]) roundItems(s, r).forEach(it => { if (!s.results[it.id]) return; const c = ls.get(chatKey(it.id), null); if (c && c.chat && c.chat.length) m[it.id] = { stage: c.done ? 5 : c.stage || 1, done: !!c.done, n: c.chat.filter(x => x.role === 'me').length }; });
    X.store.saveSoc(X.S.code, X.S.seat, m).catch(e => console.warn('AI 訂正進度沒有寫入', e && (e.code || e.message)));
  }
  // 樣式：只在 student.html
  try { const st = document.createElement('style'); st.id = 'soc-css'; st.textContent = `
#stage > #soc-panel{position:absolute;inset:0;z-index:40;background:var(--paper);display:flex;flex-direction:column;gap:10px;padding:16px 24px 14px}
#soc-panel[hidden]{display:none}
.soc-bar{display:flex;align-items:center;gap:14px;font-size:22px}.soc-bar b{flex:1}
.soc-q{flex:0 1 auto;max-height:40%;overflow-y:auto;background:var(--card);border:2px solid var(--line);border-radius:14px;padding:12px 18px}
.soc-stem{font-family:var(--serif);font-size:26px;font-weight:700;line-height:1.5;white-space:pre-line}
.fig-soc svg{max-height:22vh}
#stage.fluid .fig-soc svg{max-height:calc(var(--sh, 900px) * .16)}
.soc-opts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
#stage.narrow .soc-opts{grid-template-columns:1fr}
.soc-opt{display:flex;align-items:center;gap:10px;border:2px solid var(--line);border-radius:10px;padding:6px 10px;font-size:21px;background:#fff}
.soc-opt .k{flex:0 0 34px;height:34px;border-radius:8px;display:grid;place-items:center;color:#fff;font-weight:900}
.soc-opt .t{flex:1}
.soc-opt em{font-style:normal;font-size:15px;font-weight:800;border-radius:999px;padding:2px 10px}
.soc-opt em.me{background:var(--zhu-l);color:var(--zhu)}.soc-opt em.ok{background:var(--qing-l);color:var(--qing)}
.soc-opt.ans{border-color:var(--qing)}.soc-opt.mine:not(.ans){border-color:var(--zhu)}
.soc-mis{margin-top:6px;font-size:19px;color:var(--ink2)}
.soc-steps{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:18px}.soc-steps i{color:var(--ink3);font-style:normal}
.soc-step{padding:3px 14px;border-radius:999px;border:2px solid var(--line);color:var(--ink3);font-weight:700}
.soc-step.done{background:var(--qing-l);border-color:var(--qing);color:var(--qing)}.soc-step.on{background:var(--dai, #2f7fd8);border-color:var(--dai, #2f7fd8);color:#fff}
.soc-msgs{flex:1 1 0;min-height:120px;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:4px 2px}
.soc-msg{max-width:86%;padding:10px 16px;border-radius:16px;font-size:22px;line-height:1.65;word-break:break-word}
.soc-msg.me{align-self:flex-end;background:var(--dai-l, #e8f2fd);border:1px solid var(--line)}
.soc-msg.tutor{align-self:flex-start;background:var(--card);border:2px solid var(--line)}
.soc-msg.err{align-self:center;background:var(--zhu-l);color:var(--zhu);font-weight:700;font-size:19px}
.soc-pill{display:inline-block;font-size:14px;font-weight:800;color:#fff;border-radius:999px;padding:1px 10px;margin-right:8px;background:var(--dai, #2f7fd8);vertical-align:2px}.soc-pill.s5{background:var(--qing)}
.soc-dots i{display:inline-block;width:9px;height:9px;margin:0 3px;border-radius:50%;background:var(--ink3);animation:socb 1s infinite}.soc-dots i:nth-child(2){animation-delay:.15s}.soc-dots i:nth-child(3){animation-delay:.3s}
@keyframes socb{0%,80%,100%{opacity:.25}40%{opacity:1}}
.soc-quick{display:flex;gap:8px;flex-wrap:wrap;min-height:34px}.soc-quick .btn{font-size:17px}
.soc-form{display:flex;gap:10px}.soc-form input{flex:1;font-size:22px;padding:10px 14px;border:2px solid var(--line);border-radius:12px;min-width:0}
.soc-hint{font-size:16px;color:var(--ink3);min-height:0}
.soc-go{font-size:16px !important}.soc-badge{display:inline-block;margin-left:8px;font-size:15px;font-weight:800;color:var(--qing)}.soc-badge.go{color:var(--huang)}
`; document.head.appendChild(st); } catch (e) { }

  return { on, remember, cached, forget, resume, cell, after, close, get url() { return url; }, _state: state, _P: () => P };
};
