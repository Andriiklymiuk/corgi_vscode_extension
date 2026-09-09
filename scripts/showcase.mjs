// Draws the README pictures: a VS Code window with the extension's agent
// pieces — the Agent sessions view, the status bar item, the toast, the
// session quick pick, a Claude Code permission prompt in the terminal — as
// HTML for Chrome to screenshot. The labels mirror src/agentTree.ts and
// src/agentStatus.ts, so keep them in step. scripts/capture.sh runs it.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

// Dark Modern.
const bg = "#1F1F1F", side = "#181818", edge = "#2B2B2B", fg = "#CCCCCC", dim = "#9D9D9D", faint = "#6E6E6E";
const yellow = "#CCA700", blueLine = "#0078D4", green = "#89D185", red = "#F14C4C", orange = "#D18616";

// Codicons, drawn by hand: the few the extension uses.
const ico = {
	pulse: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M11.8 9L10 3l-2 9-2-6-1.2 3H2v1h3.5l.5-1.3 2 6 2-9 1.4 4.3H14V9z"/></svg>`,
	bell: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M13.4 12l-1.4-2V6.5A4 4 0 0 0 8.5 2.6V1.5h-1v1.1A4 4 0 0 0 4 6.5V10l-1.4 2v1h10.8v-1zM6.5 14a1.5 1.5 0 0 0 3 0z"/></svg>`,
	check: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M14.4 3.7l-8 9-.7.1-3.4-3.4.7-.7 3 3 7.7-8.7z"/></svg>`,
	warning: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M7.6 1.3h.8L15 13.5l-.4.6H1.4l-.4-.6zM8 3.2L2.3 13h11.4zM7.5 6h1v4h-1zm0 5h1v1h-1z"/></svg>`,
	circle: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2z"/></svg>`,
	folder: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M14.5 3H7.7L6.6 1.9 6.2 1.7H1.5l-.5.5v11.6l.5.5h13l.5-.5V3.5zM14 13H2V2.7h4l1.1 1.1.4.2H14z"/></svg>`,
	chev: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618z"/></svg>`,
	chevR: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M5.7 13.7L5 13l4.6-4.6L5 3.7l.7-.7L11 8.4v.5z"/></svg>`,
	x: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M8 8.7l3.6 3.6.7-.7L8.7 8l3.6-3.6-.7-.7L8 7.3 4.4 3.7l-.7.7L7.3 8l-3.6 3.6.7.7z"/></svg>`,
	branch: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M4 2a2 2 0 0 0-.5 3.9v4.2A2 2 0 1 0 5 10.1V8.4c.5.4 1.1.6 1.8.6H8a3 3 0 0 0 3-2.1A2 2 0 1 0 10 5c0 1.1-.9 2-2 2H6.8C5.8 7 5 6.2 5 5.1v.8A2 2 0 0 0 4 2z"/></svg>`,
	files: (c = fg) => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.4"><path d="M13 3H6v18h12V8zM13 3v5h5"/></svg>`,
	search: (c = fg) => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.4"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>`,
	scm: (c = fg) => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.4"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 3-3 4-6 4H6"/></svg>`,
	debug: (c = fg) => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.4"><path d="M6 4l14 8-14 8z"/></svg>`,
	ext: (c = fg) => `<svg viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.4"><rect x="3" y="10" width="7" height="7"/><rect x="10" y="3" width="7" height="7"/><rect x="10" y="10" width="7" height="7"/><rect x="3" y="3" width="7" height="7"/></svg>`,
	paw: (c = fg) => `<svg viewBox="0 0 24 24" fill="${c}"><circle cx="7" cy="8" r="2"/><circle cx="12" cy="5.5" r="2"/><circle cx="17" cy="8" r="2"/><path d="M12 10c-3 0-6 3.2-6 6a3 3 0 0 0 3 3c1 0 2-.6 3-.6s2 .6 3 .6a3 3 0 0 0 3-3c0-2.8-3-6-6-6z"/></svg>`,
	error: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm2.8 3.2l.7.7L8.7 8l2.8 2.8-.7.7L8 8.7l-2.8 2.8-.7-.7L7.3 8 4.5 5.2l.7-.7L8 7.3z"/></svg>`,
	sync: (c = fg) => `<svg viewBox="0 0 16 16" fill="${c}"><path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L10 6h4V2l-1.4 1.4A6.5 6.5 0 0 0 1.5 8zm11 0a5.5 5.5 0 0 1-9.4 3.9L6 10H2v4l1.4-1.4A6.5 6.5 0 0 0 14.5 8z"/></svg>`,
};

const statusIcon = { working: "pulse", needs_input: "bell", done: "check", limited: "warning", stale: "circle" };
const statusWord = { working: "working", needs_input: "needs you", done: "done", limited: "limited", stale: "stale" };

/** A tree row the way agentTree.ts builds it: icon, name, then "status · what · ctx · elapsed". */
const treeSession = (s, hover) => {
	const meta = [statusWord[s.status]];
	if (s.pending) meta.push(`asks ${s.pending}`);
	else if (s.note) meta.push(`"${s.note}"`);
	else if (s.detail) meta.push(s.detail);
	if (s.ctx) meta.push(`ctx ${s.ctx}%`);
	if (s.elapsed) meta.push(s.elapsed);
	const color = s.status === "needs_input" ? yellow : fg;
	return `<div class="ti s${hover ? " hover" : ""}${s.pressed ? " pressed" : ""}"><i class="ic">${ico[statusIcon[s.status]](color)}</i><span class="lbl">${s.title ?? s.name}</span><span class="desc">${meta.join(" · ")}</span>${s.pending && hover ? `<span class="inline"><i class="${s.pressed === "allow" ? "on" : ""}" title="Allow">${ico.check(green)}</i><i title="Deny">${ico.x(red)}</i></span>` : ""}</div>`;
};
const treeGroup = (g, hover) => `<div class="ti g"><i class="tw">${ico.chev(fg)}</i><i class="ic">${ico.folder(fg)}</i><span class="lbl">${g.label}</span><span class="desc">${g.sessions.length}</span></div>${g.sessions.map((s) => treeSession(s, hover === s.name)).join("")}`;

const statusText = (b) => `<span class="sbi${b.needs ? " warn" : ""}"><i>${ico.pulse(b.needs ? yellow : fg)}</i> ${b.working} · <i>${ico.bell(b.needs ? yellow : fg)}</i> ${b.needs} · 5h ${b.fiveH}%</span>`;

const toast = (s) => `<div class="toast"><div class="t"><i>${ico.paw(blueLine)}</i><span><b>${s.name}</b> needs you: ${s.detail}</span><i class="close">${ico.x(fg)}</i></div><div class="src">Source: Corgi (Extension)<span class="go">Go</span></div></div>`;

/** Claude Code in the terminal, asking. */
const terminal = (t) => {
	const lines = [
		`<span class="p">●</span> <span class="b">Bash</span>(go test ./...)`,
		t === 1 || t === 2
			? `<div class="box"><b>Bash command</b><br><span class="mono">go test ./...</span><br><span class="dim">Run the tests</span><br><br>Do you want to proceed?<br><span class="${t === 2 ? "sel" : ""}">❯ 1. Yes</span><br>&nbsp; 2. Yes, and don't ask again for <span class="mono">go test</span> commands in <span class="mono">~/dev/acme-api</span><br>&nbsp; 3. No, and tell Claude what to do differently (esc)</div>`
			: t === 0 ? `<span class="dim">  ⎿  Running…</span>` : `<span class="dim">  ⎿  ok  &nbsp;acme-api/auth&nbsp;&nbsp;0.42s<br>  ⎿  ok  &nbsp;acme-api/orders  1.10s</span>${t >= 4 ? `<br><br><span class="p">●</span> All green. The redirect test covers the empty-path case now.` : ""}`,
	];
	return `<div class="term">${lines.join("<br>")}<div class="input">${t === 3 ? `<span class="dim">✶ Testing… (12s · ↑ 1.2k tokens)</span>` : `<span class="prompt">&gt;</span> <span class="dim">Try "fix the failing test"</span>`}</div></div>`;
};

const termTabs = (t) => {
	const acme = t === 1 || t === 2 ? `<span class="tt active"><b class="r">▲</b> acme-api NEEDS YOU</span>` : t >= 4 ? `<span class="tt active"><b class="g">✓</b> acme-api 74%</span>` : `<span class="tt active"><b class="a">●</b> acme-api WORKING</span>`;
	return `<div class="ttabs">${acme}<span class="tt"><b class="a">●</b> corgi WORKING</span><span class="tt">zsh</span></div>`;
};

// ---- the board over time -----------------------------------------------------
const boardAt = (t) => {
	const acme = [
		{ name: "acme-api", status: "working", detail: "Bash go test", ctx: 72, elapsed: "8m" },
		{ name: "acme-api", status: "needs_input", pending: "Bash", ctx: 72, elapsed: "2s", detail: "Bash go test" },
		{ name: "acme-api", status: "needs_input", pending: "Bash", ctx: 72, elapsed: "6s", detail: "Bash go test", pressed: "allow" },
		{ name: "acme-api", status: "working", detail: "Bash go test", ctx: 73, elapsed: "1s" },
		{ name: "acme-api", status: "done", detail: "Bash go test", ctx: 74, elapsed: "2s" },
		{ name: "acme-api", status: "done", detail: "Bash go test", ctx: 74, elapsed: "14s" },
	][Math.min(t, 5)];
	const groups = [
		{ label: "corgi", sessions: [
			{ name: "corgi", title: "Fix the login redirect", status: "working", detail: "Edit registry.go", ctx: 41 + t * 2, elapsed: ["9s", "15s", "22s", "30s", "41s", "50s"][t] },
			{ name: "corgi 2", status: "done", note: "waiting on PR review", ctx: 23, elapsed: "11m" },
		] },
		{ label: "acme-api", sessions: [acme] },
		{ label: "web", sessions: [{ name: "web", status: "working", detail: "Bash npm test", ctx: 58, elapsed: "13m" }] },
		{ label: "mobile", sessions: [{ name: "mobile", status: "limited", detail: "resets 1:10pm" }] },
	];
	const needs = t === 1 || t === 2 ? 1 : 0;
	const working = t >= 4 ? 2 : 3;
	return { groups, needs, working, fiveH: 62, acme };
};

// ---- pages ---------------------------------------------------------------------
const css = `
  *{box-sizing:border-box}
  html,body{margin:0;width:1600px;height:1000px;overflow:hidden;background:#101010;font-family:-apple-system,"SF Pro Text",Inter,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:${fg};font-size:13px}
  .win{position:absolute;inset:0;background:${bg};display:grid;grid-template-rows:36px 1fr 22px;grid-template-columns:48px 360px 1fr}
  .title{grid-column:1/4;background:${side};border-bottom:1px solid ${edge};display:flex;align-items:center;justify-content:center;position:relative;color:${dim};font-size:12px}
  .lights{position:absolute;left:12px;top:11px;display:flex;gap:8px}.lights i{width:12px;height:12px;border-radius:50%;background:#FF5F57}.lights i:nth-child(2){background:#FEBC2E}.lights i:nth-child(3){background:#28C840}
  .cmd{width:520px;height:24px;border:1px solid ${edge};background:#242424;border-radius:6px;display:flex;align-items:center;justify-content:center;gap:6px;color:${dim}}
  .cmd svg{width:13px;height:13px}
  .act{background:${side};border-right:1px solid ${edge};display:flex;flex-direction:column;align-items:center;padding-top:6px;gap:4px}
  .act i{width:48px;height:44px;display:flex;align-items:center;justify-content:center;opacity:.55;border-left:2px solid transparent}
  .act i svg{width:24px;height:24px}.act i.on{opacity:1;border-left-color:${fg}}
  .side{background:${side};border-right:1px solid ${edge};display:flex;flex-direction:column;min-width:0}
  .side h3{margin:0;padding:10px 20px;font-size:11px;font-weight:400;color:${dim};text-transform:uppercase}
  .sec{display:flex;align-items:center;gap:2px;height:22px;padding:0 4px;font-size:11px;font-weight:700;text-transform:uppercase;border-top:1px solid ${edge}}
  .sec i{width:16px;height:16px}.sec i svg{width:16px;height:16px}
  .sec.open{background:${bg}}
  .ti{display:flex;align-items:center;height:22px;padding-right:6px;white-space:nowrap;min-width:0}
  .ti.g{padding-left:12px}.ti.s{padding-left:36px}
  .ti.hover{background:#2A2D2E}.ti.pressed{background:#04395E}
  .ti .tw{width:16px;height:16px;margin-right:2px}.ti .ic{width:16px;height:16px;margin-right:6px}.ti i svg{width:16px;height:16px}
  .ti .lbl{flex:none}.ti .desc{margin-left:6px;color:${dim};font-size:12px;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .ti.g .desc{margin-left:auto;padding:0 4px}
  .inline{margin-left:auto;display:flex;gap:2px;padding-left:8px;background:linear-gradient(90deg,transparent,#2A2D2E 20%)}.inline i{width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:4px}.inline i.on{background:rgba(137,209,133,.25);box-shadow:0 0 0 1px ${green}}.inline i svg{width:16px;height:16px}
  .main{display:grid;grid-template-rows:35px 1fr 300px;min-width:0}
  .tabs{background:${side};border-bottom:1px solid ${edge};display:flex}
  .tab{padding:0 14px;display:flex;align-items:center;gap:6px;border-right:1px solid ${edge};color:${dim};font-size:13px}
  .tab.on{background:${bg};color:${fg};border-top:1px solid ${blueLine};margin-bottom:-1px}
  .tab .go{color:#4FC1FF;font-size:11px;font-weight:700}
  .ed{padding:10px 0 0 0;font:12.5px/20px ui-monospace,Menlo,monospace;color:${fg};overflow:hidden}
  .ed div{white-space:pre}.ed b{display:inline-block;width:56px;text-align:right;padding-right:18px;color:${faint};font-weight:400}
  .kw{color:#569CD6}.fn{color:#DCDCAA}.cm{color:#6A9955}.ty{color:#4EC9B0}.num{color:#B5CEA8}
  .panel{border-top:1px solid ${edge};display:grid;grid-template-columns:1fr 200px;min-width:0}
  .ph{grid-column:1/3;height:35px;display:flex;align-items:center;gap:22px;padding:0 16px;font-size:11px;text-transform:uppercase;color:${dim};border-bottom:1px solid ${edge}}
  .ph b{color:${fg};font-weight:400;border-bottom:1px solid ${fg};padding-bottom:1px}
  .term{padding:8px 14px;font:12.5px/19px ui-monospace,Menlo,monospace;overflow:hidden;position:relative}
  .term .p{color:${green}}.term .b{font-weight:700}.term .dim{color:${dim}}.term .mono{color:#4FC1FF}
  .box{margin:8px 0;border:1px solid ${faint};border-radius:4px;padding:8px 12px;max-width:640px}
  .box .sel{background:#264F78;padding:0 4px}
  .term .input{position:absolute;left:14px;right:14px;bottom:10px;border-top:1px solid ${faint};padding-top:6px}.term .prompt{color:${fg}}
  .ttabs{border-left:1px solid ${edge};padding-top:4px;display:flex;flex-direction:column}
  .tt{display:flex;align-items:center;gap:6px;padding:3px 10px;font-size:12px;color:${dim};white-space:nowrap}.tt.active{color:${fg};background:#2A2D2E;border-left:2px solid ${blueLine}}
  .tt b{font-weight:400}.tt .r{color:${red}}.tt .a{color:${orange}}.tt .g{color:${green}}
  .status{grid-column:1/4;background:${side};border-top:1px solid ${edge};display:flex;align-items:center;font-size:12px;padding:0 10px;gap:4px;color:${fg}}
  .status span{display:inline-flex;align-items:center;gap:4px;padding:0 5px;height:22px}
  .status i{width:14px;height:14px;display:inline-flex}.status i svg{width:14px;height:14px}
  .status .remote{background:${blueLine};margin:0 6px 0 -10px;padding:0 8px}
  .status .sp{flex:1}
  .sbi.warn{color:${yellow}}
  .toast{position:absolute;right:24px;bottom:44px;width:420px;background:#252526;border:1px solid ${edge};box-shadow:0 8px 24px rgba(0,0,0,.5);font-size:13px}
  .toast .t{display:flex;align-items:flex-start;gap:8px;padding:12px 12px 8px}.toast .t i{width:16px;height:16px;flex:none;margin-top:1px}.toast .t i svg{width:16px;height:16px}.toast .t span{flex:1}.toast .close{opacity:.7}
  .toast .src{display:flex;align-items:center;justify-content:space-between;padding:0 12px 10px;color:${dim};font-size:12px}
  .toast .go{background:${blueLine};color:#fff;padding:4px 12px;border-radius:2px;font-size:13px}
  .qp{position:absolute;left:50%;top:36px;transform:translateX(-50%);width:600px;background:#222222;border:1px solid #454545;box-shadow:0 6px 24px rgba(0,0,0,.55);padding:6px;font-size:13px}
  .qp .in{height:26px;border:1px solid ${blueLine};background:#313131;padding:0 8px;display:flex;align-items:center;color:${fg}}
  .qp .sep{height:22px;display:flex;align-items:center;padding:0 8px;color:${dim};font-size:11px;border-top:1px solid #3c3c3c;margin-top:2px}.qp .sep b{font-weight:400;margin-right:8px}
  .qp .it{display:flex;align-items:center;gap:6px;height:22px;padding:0 8px}.qp .it.on{background:#04395E}
  .qp .it i{width:16px;height:16px;display:inline-flex}.qp .it i svg{width:16px;height:16px}
  .qp .it .d{color:${dim};margin-left:4px}.qp .it .dt{margin-left:auto;color:${faint};font-size:12px}
  .qp .row2{padding:0 8px 4px 30px;color:${faint};font-size:12px;height:18px}
`;

const editor = `<div class="ed">
<div><b>38</b><span class="cm">// A session that keeps working but stays silent is flagged, not dropped.</span></div>
<div><b>39</b><span class="kw">func</span> (r *Registry) <span class="fn">Sweep</span>(now time.Time) {</div>
<div><b>40</b>    <span class="kw">for</span> _, s := <span class="kw">range</span> r.sessions {</div>
<div><b>41</b>        <span class="kw">if</span> s.Status == <span class="ty">Working</span> && now.Sub(s.LastActivity) > <span class="ty">StuckAfter</span> {</div>
<div><b>42</b>            s.Stuck = <span class="kw">true</span></div>
<div><b>43</b>        }</div>
<div><b>44</b>        <span class="kw">if</span> s.Status == <span class="ty">NeedsInput</span> && s.Pending == <span class="kw">nil</span> {</div>
<div><b>45</b>            s.Pending = <span class="fn">pendingFrom</span>(s.LastEvent)</div>
<div><b>46</b>        }</div>
<div><b>47</b>    }</div>
<div><b>48</b>    r.publish()</div>
<div><b>49</b>}</div>
<div><b>50</b></div>
<div><b>51</b><span class="cm">// StuckAfter is how long a working session may stay silent: twelve minutes.</span></div>
<div><b>52</b><span class="kw">const</span> <span class="ty">StuckAfter</span> = <span class="num">12</span> * time.Minute</div>
</div>`;

const window = ({ t = 1, hover = t === 1 || t === 2 ? "acme-api" : "", showToast = t === 1, quick = false }) => {
	const b = boardAt(t);
	return `<!doctype html><meta charset="utf-8"><title>corgi</title><style>${css}</style>
<div class="win">
  <div class="title"><div class="lights"><i></i><i></i><i></i></div><div class="cmd">${ico.search(dim)} corgi</div></div>
  <div class="act"><i>${ico.files()}</i><i>${ico.search()}</i><i>${ico.scm()}</i><i>${ico.debug()}</i><i>${ico.ext()}</i><i class="on">${ico.paw()}</i></div>
  <div class="side">
    <h3>Corgi</h3>
    <div class="sec"><i>${ico.chevR(fg)}</i>Commands</div>
    <div class="sec"><i>${ico.chevR(fg)}</i>Examples</div>
    <div class="sec open"><i>${ico.chev(fg)}</i>Agent sessions</div>
    ${b.groups.map((g) => treeGroup(g, hover)).join("")}
  </div>
  <div class="main">
    <div class="tabs"><span class="tab on"><span class="go">GO</span> registry.go</span><span class="tab">${ico.paw(dim).replace("<svg", '<svg width="14" height="14"')} ✓ corgi 43%</span><span class="tab">session.go</span></div>
    ${editor}
    <div class="panel">
      <div class="ph"><span>Problems</span><span>Output</span><span>Debug console</span><b>Terminal</b><span>Ports</span></div>
      ${terminal(t)}
      ${termTabs(t)}
    </div>
  </div>
  <div class="status"><span class="remote">${ico.sync("#fff")}</span><span><i>${ico.branch()}</i> main*</span><span><i>${ico.error()}</i> 0 <i>${ico.warning()}</i> 0</span>${statusText(b)}<span class="sp"></span><span>Ln 42, Col 27</span><span>Spaces: 4</span><span>UTF-8</span><span>Go</span><span><i>${ico.paw()}</i> corgi</span></div>
  ${showToast ? toast({ name: "acme-api", detail: "Bash go test" }) : ""}
  ${quick ? quickPick(b) : ""}
</div>`;
};

const quickPick = (b) => `<div class="qp">
  <div class="in">Corgi Agent: Sessions — pick one to focus</div>
  ${b.groups.map((g, gi) => `<div class="sep"><b>${g.label}</b></div>${g.sessions.map((s, si) => {
		const icon = s.status === "needs_input" ? ico.bell(fg) : s.status === "working" ? ico.pulse(fg) : s.status === "limited" ? ico.warning(fg) : s.status === "done" ? ico.check(fg) : "";
		const meta = [statusWord[s.status], s.pending ? `asks ${s.pending}` : s.detail, s.ctx ? `ctx ${s.ctx}%` : "", s.elapsed].filter(Boolean).join(" — ");
		const on = g.label === "acme-api";
		return `<div class="it${on ? " on" : ""}"><i>${icon}</i>${s.title ?? s.name}<span class="d">${meta}</span></div><div class="row2">${gi === 0 ? "default" : gi === 1 ? "work" : "default"}  ·  ~/dev/${g.label}${s.note ? `  ·  "${s.note}"` : ""}</div>`;
	}).join("")}`).join("")}
</div>`;

const out = "docs/media";
rmSync(`${out}/frames`, { recursive: true, force: true });
mkdirSync(`${out}/frames`, { recursive: true });
const write = (name, html) => writeFileSync(`${out}/${name}`, html);
write("frames/hero.html", window({ t: 1 }));
write("frames/quickpick.html", window({ t: 1, hover: "", showToast: false, quick: true }));
for (let t = 0; t <= 5; t++) write(`frames/story-${t}.html`, window({ t }));
console.log("wrote docs/media/frames/");
