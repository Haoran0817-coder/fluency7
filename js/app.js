(function () {
'use strict';

/* ============================================================
   0. 工具
============================================================ */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const DAY = 86400000;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 1900);
}

/* ============================================================
   1. 数据装配
============================================================ */
const DECKS = {
  core:  { name: '① 日常核心', list: window.VOCAB_CORE  || [] },
  daily: { name: '② 日常进阶', list: window.VOCAB_DAILY || [] },
  ielts: { name: '③ 雅思学术', list: window.VOCAB_IELTS || [] },
  toefl: { name: '④ 托福学术', list: window.VOCAB_TOEFL || [] },
  b1:    { name: '⑤ 基础高频词 (B1)', list: window.VOCAB_B1 || [] },
  b2:    { name: '⑥ 中级常用词 (B2)', list: window.VOCAB_B2 || [] },
  b3:    { name: '⑦ 进阶词汇 (B3)', list: window.VOCAB_B3 || [] },
  ieltsfull: { name: '⑧ 雅思全量词库', list: window.VOCAB_IELTS_FULL || [] }
};
const IELTS_FULL = window.VOCAB_IELTS_FULL || [];
const IELTS_MAP = {}; IELTS_FULL.forEach(v => { if (v && v.w) IELTS_MAP[String(v.w).toLowerCase()] = v; });
const ALL = [], MAP = {};
['core', 'daily', 'ielts', 'toefl'].forEach(dk => {
  DECKS[dk].list.forEach(v => {
    if (!v || !v.w) return;
    const key = String(v.w).toLowerCase().trim();
    const item = { w: String(v.w).trim(), p: v.p || '', t: v.t || '', z: v.z || '', e: v.e || '', ez: v.ez || '', deck: dk };
    if (MAP[key]) return;               // 去重：保留更靠前（更基础）的那个
    MAP[key] = item; ALL.push(item);
  });
});
const LESSONS = window.LESSONS || [];
const DECODER = window.DECODER || [];

/* ============================================================
   2. 本地存储
============================================================ */
const DEF = {
  settings: { engine: 'auto', voice: '', rate: 1, daily: 80, listenGoal: 2, autoVault: 1, ieltsDaily: 4000 },
  srs: {},            // word -> {r,i,e,d,l,w}
  vault: {},          // word -> item
  weakLink: {},       // 连读薄弱条目 key(norm h) -> {w,h,ipa,z,n,cat,c,ts}
  screen: { date: '', today: 0, known: {}, unknown: {} },  // 雅思筛查进度
  batchDone: 0,       // 生词本分批次背诵已完成批数
  stats: { days: {}, streak: 0, lastDay: '', totalReviews: 0, minutes: 0 },
  tasks: {},          // day -> {idx:true}
  startDate: '',
  doneLessons: {}     // lessonId -> 1
};
let S;
function load() {
  try { S = JSON.parse(localStorage.getItem('fluency7') || 'null') || JSON.parse(JSON.stringify(DEF)); }
  catch (e) { S = JSON.parse(JSON.stringify(DEF)); }
  for (const k in DEF) if (S[k] === undefined) S[k] = JSON.parse(JSON.stringify(DEF[k]));
  for (const k in DEF.settings) if (S.settings[k] === undefined) S.settings[k] = DEF.settings[k];
  if (!S.startDate) S.startDate = todayKey();
}
let _syncTimer = null, _syncing = false;
function save() {
  try { localStorage.setItem('fluency7', JSON.stringify(S)); } catch (e) { }
  // 自动同步：本地有改动后延迟 1.5s 推到 gist（同步过程中自身的 save 不触发，避免死循环）
  if (SYNC.enabled && SYNC.token && !_syncing) {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(() => { syncNow(false).then(updateSyncUI); }, 1500);
  }
}
load();
// 一次性迁移：仍停在旧默认 1000 的，按「2 天背完 8000」升到 4000/天（可手动改回）
if (S.settings && S.settings.ieltsDaily === 1000) { S.settings.ieltsDaily = 4000; save(); }

/* ---- 云同步配置（设备独立，仅存本机，不随学习数据同步）---- */
const SYNC_KEY = 'fluency7_sync';
let SYNC = { mode: 'lan', lanHost: '', key: '', token: '', gistId: '', base: 'https://api.github.com', enabled: false, lastSync: 0 };
(function loadSync() {
  try { const o = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}'); for (const k in o) if (o[k] !== undefined) SYNC[k] = o[k]; } catch (e) { }
})();
function saveSync() { try { localStorage.setItem(SYNC_KEY, JSON.stringify(SYNC)); } catch (e) { } }

function todayStat() {
  const k = todayKey();
  if (!S.stats.days[k]) S.stats.days[k] = { new: 0, rev: 0, right: 0, wrong: 0, listen: 0, min: 0 };
  return S.stats.days[k];
}
function addMin(m) { const t = todayStat(); t.min += m; S.stats.minutes += m; }
function bumpStreak() {
  const k = todayKey();
  if (S.stats.lastDay !== k) {
    const y = new Date(Date.now() - DAY);
    const yk = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
    S.stats.streak = (S.stats.lastDay === yk) ? (S.stats.streak + 1) : 1;
    S.stats.lastDay = k; save();
  }
}

/* ============================================================
   3. 发音引擎：有道词典真人美音 + 浏览器语音
============================================================ */
let userReady = false;
document.addEventListener('pointerdown', () => { userReady = true; }, { once: true });
document.addEventListener('keydown', () => { userReady = true; }, { once: true });
const TTS = {
  voices: [], voice: null, curAudio: null, seqToken: 0,

  init() {
    if (!('speechSynthesis' in window)) return;
    const load = () => {
      this.voices = speechSynthesis.getVoices().filter(v => /^en(-|_)?(US|GB)?/i.test(v.lang) || /english/i.test(v.name));
      this.pickVoice();
    };
    load();
    speechSynthesis.onvoiceschanged = load;
  },
  score(v) {
    const n = (v.name || '').toLowerCase(); let s = 0;
    if (/natural|online|neural/.test(n)) s += 60;
    if (/google/.test(n)) s += 40;
    if (/microsoft/.test(n)) s += 25;
    if (/^en-us|en_us|united states/i.test(v.lang + ' ' + n)) s += 30;
    if (/zira|david|mark/i.test(n)) s -= 10;   // 老式机械音
    if (/espeak|pico/i.test(n)) s -= 40;
    return s;
  },
  pickVoice() {
    if (!this.voices.length) return;
    if (S.settings.voice) {
      const v = this.voices.find(v => v.name === S.settings.voice);
      if (v) { this.voice = v; return; }
    }
    this.voice = this.voices.slice().sort((a, b) => this.score(b) - this.score(a))[0] || null;
    if (this.voice) { S.settings.voice = this.voice.name; save(); }
    this.renderVoiceSel();
  },
  renderVoiceSel() {
    const sel = $('#setVoice'); if (!sel) return;
    if (!this.voices.length) { sel.innerHTML = '<option>当前浏览器无 en-US 语音</option>'; return; }
    sel.innerHTML = this.voices
      .slice().sort((a, b) => this.score(b) - this.score(a))
      .map(v => `<option value="${esc(v.name)}"${v.name === (this.voice && this.voice.name) ? ' selected' : ''}>${esc(v.name)}${this.score(v) >= 60 ? ' ★' : ''}</option>`).join('');
  },
  // 朗文（Longman）真人美音：经本地代理 /ldoce 取音频，绕过跨域/防盗链
  longmanUrl(word) { return '/ldoce?w=' + encodeURIComponent(word); },
  youdaoUrl(text) { return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(text) + '&type=2'; },

  // 朗文：单词级真人录音（单 token 才可靠）。失败 reject 以回退
  playLongman(text, rate) {
    return new Promise((resolve, reject) => {
      const a = new Audio(this.longmanUrl(text));
      a.preload = 'auto';
      if (rate && rate !== 1 && 'playbackRate' in a) a.playbackRate = rate;
      let done = false;
      const ok = () => { if (!done) { done = true; resolve(); } };
      const bad = () => { if (!done) { done = true; reject(new Error('ldoce fail')); } };
      a.onended = ok; a.onerror = bad;
      a.oncanplay = () => { if (rate) { try { a.playbackRate = rate; } catch (e) { } } };
      setTimeout(() => { if (a.readyState < 2) bad(); }, 4000);
      this.curAudio = a;
      a.play().catch(bad);
    });
  },
  // 有道：作为句子/短语回退音源（无盗链限制）
  playYoudao(text, rate) {
    return new Promise((resolve, reject) => {
      const a = new Audio(this.youdaoUrl(text));
      a.preload = 'auto';
      if (rate && rate !== 1 && 'playbackRate' in a) a.playbackRate = rate;
      let done = false;
      const ok = () => { if (!done) { done = true; resolve(); } };
      const bad = () => { if (!done) { done = true; reject(new Error('youdao fail')); } };
      a.onended = ok; a.onerror = bad;
      setTimeout(() => { if (a.readyState < 2) bad(); }, 3500);
      this.curAudio = a;
      a.play().catch(bad);
    });
  },
  // 逐词播放朗文音频（用于连读实验室"书面读法"对比）
  speakWords(words, rate) {
    return new Promise(async resolve => {
      for (const w of words) {
        if (!/^[a-zA-Z][a-zA-Z'\-]*$/.test(w)) continue;
        try { await this.playLongman(w, rate); } catch (e) { /* 跳过无朗文音频的词 */ }
      }
      resolve();
    });
  },
  playBrowser(text, rate, onend) {
    return new Promise(res => {
      if (!('speechSynthesis' in window)) { res(); return; }
      try { speechSynthesis.cancel(); } catch (e) { }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = rate || 1; u.pitch = 1;
      if (this.voice) u.voice = this.voice;
      u.onend = () => { res(); if (onend) onend(); };
      u.onerror = () => res();
      speechSynthesis.speak(u);
    });
  },
  async speak(text, opt) {
    opt = opt || {};
    if (!userReady) return;            // 首次用户交互前不发声，避免浏览器自动播放拦截
    const rate = opt.rate || S.settings.rate || 1;
    const eng = S.settings.engine;
    const isWord = /^[a-zA-Z][a-zA-Z'\-]*$/.test(text) && text.length <= 30;
    // 朗文优先：单词且引擎为 dict/auto
    if ((eng === 'dict' || eng === 'auto') && isWord) {
      try { await this.playLongman(text, rate); if (opt.onend) opt.onend(); return; }
      catch (e) { /* 朗文无此词，回退 */ }
    }
    // 有道兜底：短语，或朗文失败
    if (eng === 'dict' || eng === 'auto') {
      try { await this.playYoudao(text, rate); if (opt.onend) opt.onend(); return; }
      catch (e) { /* 回退浏览器 */ }
    }
    await this.playBrowser(text, rate, opt.onend);
  },
  stop() {
    try { if (this.curAudio) { this.curAudio.pause(); this.curAudio.currentTime = 0; } } catch (e) { }
    try { speechSynthesis.cancel(); } catch (e) { }
    this.seqToken++;
  }
};

/* ============================================================
   4. 7 天计划
============================================================ */
const PLAN = [
  { t: '打地基：功能词 + 音变规则', g: ['理解弱读/连读/缩读/失爆四大现象', '核心高频词 80', '精听 2 篇日常对话'] },
  { t: '生活场景：动词短语 + 日常对话', g: ['日常进阶词 80', '精听 2 篇（点单/租房/机场）', '影子跟读 5 句'] },
  { t: '突破耳朵：连读弱读专项', g: ['过一遍美语解码表', '0.6x 与 1.0x 对比听同一篇', '精听 2 篇 + 错题复习'] },
  { t: '雅思听力：S1-S2 生活场景', g: ['雅思学术词 80', '精听 2 篇雅思（填空/公告）', '练数字与拼写听辨'] },
  { t: '学术听力：雅思 S4 / 托福讲座', g: ['托福学术词 80', '精听 2 篇学术讲座', '抓信号词：however / consequently'] },
  { t: '沉浸强化：常速材料 + 全量刷词', g: ['1.15x 常速精听 3 篇', '速刷 150 词', '跟读并录音对比'] },
  { t: '总复盘：错题 + 生词本总攻', g: ['清空待复习队列', '生词本全部过一遍', '常速盲听检验'] }
];
function curDay() {
  const d0 = new Date(S.startDate + 'T00:00:00');
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let n = Math.round((now - d0) / DAY) + 1;
  if (!isFinite(n) || n < 1) n = 1;
  return Math.min(7, n);
}
const TASKS = [
  { t: '新学单词（点此开始突击）', view: 'blitz' },
  { t: '复习到期单词', view: 'blitz' },
  { t: '精听 2 篇材料', view: 'listen' },
  { t: '影子跟读 10 句', view: 'listen' },
  { t: '过一遍美语解码', view: 'decoder' }
];

/* ============================================================
   5. SRS
============================================================ */
function srsOf(w) { return S.srs[w.toLowerCase()]; }
function isDue(w) { const s = S.srs[w.toLowerCase()]; return !s || s.d <= Date.now(); }
function dueList() { return ALL.filter(v => { const s = S.srs[v.w.toLowerCase()]; return s && s.d <= Date.now(); }); }
function masteredCount() { return ALL.reduce((n, v) => n + ((S.srs[v.w.toLowerCase()] || {}).l >= 3 ? 1 : 0), 0); }

// grade: 0 忘了 / 1 模糊 / 2 认识 / 3 简单
function review(w, grade) {
  const k = w.toLowerCase();
  let s = S.srs[k] || { r: 0, i: 0, e: 2.5, d: 0, l: 0, w: 0 };
  s.r++;
  if (grade === 0) { s.l = 0; s.i = 0; s.d = Date.now() + 10 * 60000; s.w++; s.e = Math.max(1.3, s.e - 0.2); }
  else if (grade === 1) { s.l = 1; s.i = 0.5; s.d = Date.now() + 12 * 3600000; s.w++; }
  else if (grade === 2) { s.l = 2; s.i = Math.max(1, (s.i || 1) * 2); s.d = Date.now() + s.i * DAY; }
  else { s.l = 3; s.i = Math.max(4, (s.i || 1) * 3); s.d = Date.now() + s.i * DAY; }
  S.srs[k] = s;
  S.stats.totalReviews++;
  const t = todayStat();
  if (s.r === 1) t.new++; else t.rev++;
  save();
  return s;
}
function addVault(item) {
  const k = item.w.toLowerCase();
  if (!S.vault[k]) {
    S.vault[k] = { w: item.w, p: item.p, t: item.t, z: item.z, e: item.e, ez: item.ez, src: item.deck || 'lesson', ts: Date.now(), wrong: 0 };
    save(); renderVaultBadge(); return true;
  }
  return false;
}
function vaultList() {
  const arr = Object.values(S.vault);
  const q = ($('#vSearch') && $('#vSearch').value || '').trim().toLowerCase();
  let out = arr;
  if (q) out = out.filter(v => v.w.toLowerCase().includes(q) || (v.z || '').toLowerCase().includes(q));
  const sort = $('#vSort') ? $('#vSort').value : 'time';
  if (sort === 'alpha') out.sort((a, b) => a.w.localeCompare(b.w));
  else if (sort === 'weak') out.sort((a, b) => ((S.srs[b.w.toLowerCase()] || {}).l || 0) - ((S.srs[a.w.toLowerCase()] || {}).l || 0));
  else out.sort((a, b) => b.ts - a.ts);
  return out;
}

/* ============================================================
   6. 视图切换
============================================================ */
$$('#tabs .tab').forEach(b => b.onclick = () => {
  $$('#tabs .tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + b.dataset.view).classList.add('active');
  if (b.dataset.view === 'home') renderHome();
  if (b.dataset.view === 'vault') renderVault();
  if (b.dataset.view === 'linking') renderLinking();
  if (b.dataset.view === 'ielts') renderIelts();
  window.scrollTo(0, 0);
});
function go(view) { const b = $(`#tabs .tab[data-view="${view}"]`); if (b) b.click(); }

/* ============================================================
   7. 今日
============================================================ */
function renderHome() {
  const d = curDay(), p = PLAN[d - 1];
  $('#dayChip').textContent = 'Day ' + d;
  $('#heroTitle').textContent = `第 ${d} 天 · ${p.t}`;
  $('#heroDesc').textContent = d === 1
    ? '今天的目标是让耳朵熟悉英语的真实节奏。美国人说话时功能词几乎全部被弱读、连读、吞音——这就是"每个词都认识却听不懂"的唯一原因。先听慢速，再听常速，最后跟读。'
    : '按下面的路线推进。每天的黄金组合是：先复习 -> 再新学 -> 最后精听。单词追求"多次短接触"，一次看 20 秒比盯着看 5 分钟有效。';
  $('#heroGoals').innerHTML = p.g.map(g => `<span>${esc(g)}</span>`).join('');

  const t = todayStat(), due = dueList().length;
  $('#stNew').textContent = t.new;
  $('#stDue').textContent = due;
  $('#stMaster').textContent = masteredCount();
  $('#stMin').textContent = t.min;
  $('#stVocab').textContent = Object.keys(S.vault).length;
  $('#stTotal').textContent = S.stats.totalReviews;

  const done = S.tasks[d] || {};
  $('#taskList').innerHTML = TASKS.map((x, i) =>
    `<li data-i="${i}" data-view="${x.view}" class="${done[i] ? 'done' : ''}"><span class="box">✓</span><span>${esc(x.t)}</span><span class="go">开始 →</span></li>`).join('');
  $$('#taskList li').forEach(li => li.onclick = () => {
    const i = li.dataset.i;
    S.tasks[d] = S.tasks[d] || {}; S.tasks[d][i] = !S.tasks[d][i]; save();
    li.classList.toggle('done', !!S.tasks[d][i]);
    if (S.tasks[d][i]) go(li.dataset.view);
  });
  $('#resetDay').onclick = () => { S.tasks[d] = {}; save(); renderHome(); };

  const pct = Math.round(Object.values(S.tasks[d] || {}).filter(Boolean).length / TASKS.length * 100);
  $('#dayRing').style.setProperty('--p', pct);
  $('#ringPct').textContent = pct;

  $('#planList').innerHTML = PLAN.map((x, i) =>
    `<li class="${i + 1 === d ? 'cur' : (i + 1 < d ? 'past' : '')}"><span class="d">${i + 1}</span><span class="pt"><b>${esc(x.t)}</b><span>${esc(x.g.join(' · '))}</span></span></li>`).join('');

  const cat = d <= 3 ? 'daily' : (d <= 5 ? 'ielts' : 'toefl');
  const rec = LESSONS.filter(l => l.cat === cat).slice(0, 3);
  const fallback = rec.length ? rec : LESSONS.slice(0, 3);
  $('#recLessons').innerHTML = fallback.map(l =>
    `<div class="recc" data-id="${l.id}"><span class="tag">${l.cat === 'daily' ? '日常美语' : l.cat === 'ielts' ? '雅思' : '托福'}</span><h4>${esc(l.title)}</h4><p>${esc(l.zh)} · ${esc(l.desc).slice(0, 40)}…</p></div>`).join('');
  $$('#recLessons .recc').forEach(c => c.onclick = () => { go('listen'); openLesson(c.dataset.id); });
  $('#streakNum').textContent = S.stats.streak || 0;
  renderVaultBadge();
}
function renderVaultBadge() { const n = Object.keys(S.vault).length; $('#vaultBadge').textContent = n; $('#vaultBadge').style.display = n ? '' : 'none'; }

/* ============================================================
   8. 精听
============================================================ */
let curLesson = null, curFilter = 'all', playingAll = false;
function renderLesList() {
  const list = LESSONS.filter(l => curFilter === 'all' || l.cat === curFilter);
  $('#lesList').innerHTML = list.map(l =>
    `<button class="les-item ${curLesson && curLesson.id === l.id ? 'active' : ''}" data-id="${l.id}">
      <div class="lt">${esc(l.title)} <i>${l.cat === 'daily' ? '日常' : l.cat === 'ielts' ? 'IELTS' : 'TOEFL'}</i></div>
      <div class="ld">${esc(l.zh)} · ${l.lines.length} 句 ${S.doneLessons[l.id] ? ' ✅' : ''}</div></button>`).join('');
  $$('#lesList .les-item').forEach(b => b.onclick = () => openLesson(b.dataset.id));
}
$$('#lesFilter .f-btn').forEach(b => b.onclick = () => {
  $$('#lesFilter .f-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
  curFilter = b.dataset.cat; renderLesList();
});
function openLesson(id) {
  curLesson = LESSONS.find(l => l.id === id); if (!curLesson) return;
  renderLesList();
  $('#lesTitle').textContent = curLesson.title + '　' + curLesson.zh;
  $('#lesMeta').textContent = curLesson.desc;
  renderLines();
  TTS.speak(curLesson.lines[0].s, { rate: +$('#rateSel').value });
}
function renderLines() {
  if (!curLesson) return;
  const hideEn = $('#hideEn').checked, hideZh = $('#hideZh').checked, showTip = $('#showTip').checked;
  $('#lines').innerHTML = curLesson.lines.map((l, i) => {
    const words = l.s.split(' ').map(w => {
      const clean = w.replace(/[^A-Za-z'-]/g, '');
      const saved = S.vault[clean.toLowerCase()];
      return `<span class="w ${saved ? 'saved' : ''}" data-w="${esc(clean)}">${esc(w)}</span>`;
    }).join(' ');
    return `<div class="ln" data-i="${i}">
      <div class="n">${i + 1}</div>
      <div class="body">
        <div class="en ${hideEn ? 'masked' : ''}" data-i="${i}">${words}</div>
        ${hideZh ? `<div class="zh">${esc(l.z)}</div>` : ''}
        ${showTip && l.tip ? `<div class="tip">🎯 ${esc(l.tip)}</div>` : ''}
      </div>
      <div class="ops">
        <button class="icobtn" data-act="play" data-i="${i}" title="播放">🔊</button>
        <button class="icobtn" data-act="slow" data-i="${i}" title="0.7x 慢速">🐢</button>
        <button class="icobtn" data-act="rec" data-i="${i}" title="跟读录音对比">🎤</button>
      </div>
    </div>`;
  }).join('');

  $$('#lines .en').forEach(el => el.onclick = e => {
    if (e.target.classList.contains('w')) { showWord(e.target.dataset.w); return; }
    el.classList.remove('masked'); playLine(+el.dataset.i);
  });
  $$('#lines .icobtn').forEach(b => b.onclick = () => {
    const i = +b.dataset.i, a = b.dataset.act;
    if (a === 'play') playLine(i, +$('#rateSel').value);
    if (a === 'slow') playLine(i, 0.7);
    if (a === 'rec') startRecord(i, b);
  });
}
function playLine(i, rate) {
  if (!curLesson) return;
  $$('#lines .ln').forEach(x => x.classList.remove('playing'));
  const el = $(`#lines .ln[data-i="${i}"]`); if (el) el.classList.add('playing');
  TTS.speak(curLesson.lines[i].s, { rate: rate || +$('#rateSel').value });
}
$('#btnPlayAll').onclick = async () => {
  if (!curLesson) return toast('先选一篇材料');
  playingAll = true; const token = ++TTS.seqToken;
  for (let i = 0; i < curLesson.lines.length; i++) {
    if (token !== TTS.seqToken) break;
    playLine(i, +$('#rateSel').value);
    $$('#lines .ln').forEach(x => x.classList.remove('playing'));
    const el = $(`#lines .ln[data-i="${i}"]`); if (el) el.classList.add('playing');
    await TTS.speak(curLesson.lines[i].s, { rate: +$('#rateSel').value });
    await new Promise(r => setTimeout(r, 450));
  }
  playingAll = false;
  if (!S.doneLessons[curLesson.id]) { S.doneLessons[curLesson.id] = 1; todayStat().listen++; addMin(Math.round(curLesson.lines.length * 0.5)); save(); renderLesList(); }
};
$('#btnStop').onclick = () => { TTS.stop(); playingAll = false; $$('#lines .ln').forEach(x => x.classList.remove('playing')); };
['hideEn', 'hideZh', 'showTip'].forEach(id => { const el = $('#' + id); el.onchange = renderLines; });

/* 跟读录音 + 语音识别打分 */
async function startRecord(i, btn) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('浏览器不支持录音（需 Chrome/Edge + localhost 或 https）'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream); const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    btn.textContent = '⏹'; btn.style.background = '#ff6b6b';
    rec.start();
    const stop = () => {
      rec.stop(); stream.getTracks().forEach(t => t.stop());
      btn.textContent = '🎤'; btn.style.background = '';
    };
    btn.onclick = stop;
    setTimeout(() => { if (rec.state !== 'inactive') stop(); }, 8000);
    rec.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' }));
      new Audio(url).play();
      addMin(0.3); save();
      tryRecognize(i);
    };
    toast('开始跟读（最多 8 秒），说完自动回放');
  } catch (e) { toast('无法访问麦克风'); }
}
function tryRecognize(i) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  const r = new SR(); r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
  r.onresult = ev => {
    const said = (ev.results[0][0].transcript || '').toLowerCase().replace(/[^a-z0-9' ]/g, '');
    const target = curLesson.lines[i].s.toLowerCase().replace(/[^a-z0-9' ]/g, '');
    const A = said.split(/\s+/).filter(Boolean), B = target.split(/\s+/).filter(Boolean);
    let hit = 0; B.forEach(w => { if (A.includes(w)) hit++; });
    const pct = B.length ? Math.round(hit / B.length * 100) : 0;
    toast(`跟读匹配度 ${pct}%　你说：${said.slice(0, 60)}`);
  };
  r.onerror = () => { };
  try { r.start(); } catch (e) { }
}

/* 单词查询弹窗 */
function showWord(raw) {
  const w = (raw || '').replace(/[^A-Za-z'-]/g, '').toLowerCase();
  if (!w) return;
  const local = MAP[w] || S.vault[w];
  const open = (extra) => {
    const base = local || { w: raw, p: '', t: '', z: '（本地词库未收录）', e: '', ez: '' };
    const inVault = !!S.vault[w];
    $('#modalBody').innerHTML = `
      <h3>${esc(base.w)} <button class="icobtn" id="mwSpeak" style="width:34px;height:34px">🔊</button></h3>
      ${base.p ? `<div class="mph">${esc(base.p)}</div>` : ''}
      <div class="mpos">${esc(base.t || '')} ${base.deck ? '· 来自 ' + DECKS[base.deck].name : ''}</div>
      <div class="mdef">${esc(base.z)}${extra ? '<br><span style="font-size:13px;color:#9fb0c6">' + esc(extra) + '</span>' : ''}</div>
      ${base.e ? `<div class="mex"><div>${esc(base.e)}</div><div>${esc(base.ez || '')}</div></div>` : ''}
      <div class="macts">
        <button class="btn" id="mwVault">${inVault ? '✓ 已在生词本' : '＋ 加入生词本'}</button>
        <button class="btn ghost" id="mwAgain">🔊 再读一次</button>
      </div>`;
    $('#modal').classList.add('on');
    $('#mwSpeak').onclick = () => TTS.speak(base.w, { rate: 0.9 });
    $('#mwAgain').onclick = () => TTS.speak(base.w, { rate: 0.9 });
    $('#mwVault').onclick = () => {
      if (addVault({ w: base.w, p: base.p, t: base.t, z: base.z, e: base.e, ez: base.ez, deck: base.deck })) toast('已加入生词本');
      else { delete S.vault[w]; save(); toast('已移出生词本'); }
      renderVaultBadge(); $('#modal').classList.remove('on');
    };
    TTS.speak(base.w, { rate: 0.9 });
  };
  if (local && local.z && local.z !== '（本地词库未收录）') return open('');
  // 联网补充释义
  let settled = false;
  const t = setTimeout(() => { if (!settled) { settled = true; open(''); } }, 2500);
  fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + w)
    .then(r => r.json()).then(j => {
      if (settled) return; settled = true; clearTimeout(t);
      const en = j && j[0] && j[0].meanings && j[0].meanings[0] && j[0].meanings[0].definitions[0];
      const ph = j && j[0] && (j[0].phonetic || (j[0].phonetics || []).map(p => p.text).filter(Boolean)[0]) || '';
      open((ph ? '[' + ph + '] ' : '') + (en ? en.definition : ''));
    }).catch(() => { if (!settled) { settled = true; clearTimeout(t); open(''); } });
}
$('#modalX').onclick = () => $('#modal').classList.remove('on');
$('#modal').onclick = e => { if (e.target.id === 'modal') $('#modal').classList.remove('on'); };

/* ============================================================
   9. 单词突击
============================================================ */
let Q = { mode: 'card', deck: 'all', list: [], i: 0, right: 0, wrong: 0, start: 0, shown: false, cur: null, answering: false };

$$('#modeSel .m-btn').forEach(b => b.onclick = () => {
  $$('#modeSel .m-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
  Q.mode = b.dataset.mode; newRound();
});
$('#deckSel').onchange = () => newRound();
$('#qRestart').onclick = () => newRound();

function pool() {
  const d = Q.deck;
  if (d === 'vault') return Object.values(S.vault).map(v => MAP[v.w.toLowerCase()] || v);
  if (d === 'due') return dueList();
  if (d === 'weak') return ALL.filter(v => { const s = S.srs[String(v.w).toLowerCase()]; return !s || s.l < 3; });
  if (d === 'ieltsfull') return IELTS_FULL.map(v => ({ w: v.w, p: v.p, t: v.t, z: v.z, deck: 'ieltsfull' }));
  if (d === 'all') return ALL.slice();
  if (!DECKS[d]) return [];
  return DECKS[d].list.map(v => MAP[String(v.w).toLowerCase()]).filter(Boolean);
}
function newRound() {
  Q.deck = $('#deckSel').value;
  const all = pool();
  const now = Date.now(), due = [], fresh = [], rest = [];
  all.forEach(v => { const s = S.srs[v.w.toLowerCase()]; if (!s) fresh.push(v); else if (s.d <= now) due.push(v); else rest.push(v); });
  let q = shuffle(due).concat(shuffle(fresh));
  const cap = Q.mode === 'rush' ? 300 : 120;
  if (Q.mode === 'rush' || q.length < 15) q = q.concat(shuffle(rest));
  Q.list = q.slice(0, cap);
  Q.i = 0; Q.right = 0; Q.wrong = 0; Q.start = Date.now(); Q.shown = false; Q.answering = false;
  bumpStreak();
  renderQ();
}
function cur() { return Q.list[Q.i]; }
function renderQ() {
  const total = Q.list.length;
  $('#qPos').textContent = total ? (Q.i + 1) + ' / ' + total : '0 / 0';
  $('#qDeck').textContent = Q.deck === 'vault' ? '生词本' : Q.deck === 'due' ? '待复习' : (DECKS[Q.deck] ? DECKS[Q.deck].name : '全部');
  $('#qRight').textContent = Q.right; $('#qWrong').textContent = Q.wrong;
  const st = $('#stage');
  if (!total) { st.innerHTML = '<div class="empty">这个词库暂时没有词可选，换个词库试试</div>'; $('#qActions').innerHTML = ''; return; }
  if (Q.i >= total) return finishRound();
  const v = cur(); Q.cur = v; Q.shown = false; Q.answering = false;
  const acts = $('#qActions');
  const speakCur = () => TTS.speak(v.w, { rate: 0.9 });

  if (Q.mode === 'card' || Q.mode === 'rush') {
    st.innerHTML = `<div class="pos">${esc(v.t || '')}</div>
      <div class="bigword" id="bw">${esc(v.w)}</div>
      ${v.p ? `<div class="phon">${esc(v.p)}</div>` : ''}
      <div id="more" style="display:none;width:100%;max-width:640px">
        <div class="meaning">${esc(v.z)}</div>
        ${v.e ? `<div class="exbox"><div class="e">${esc(v.e)}</div><div class="z">${esc(v.ez || '')}</div></div>` : ''}
      </div>`;
    $('#bw').onclick = speakCur;
    acts.innerHTML = `<button class="btn ghost" id="aPlay">🔊 发音</button>
      <button class="btn" id="aShow">显示释义 (空格)</button>`;
    $('#aPlay').onclick = speakCur;
    $('#aShow').onclick = () => reveal();
    TTS.speak(v.w, { rate: 0.9 });
    if (Q.mode === 'rush') setTimeout(() => { if (!Q.shown && Q.cur === v) reveal(); }, 2600);
  }
  else if (Q.mode === 'listen') {
    const others = shuffle(ALL.filter(x => x.w !== v.w)).slice(0, 3);
    const opts = shuffle([v].concat(others));
    st.innerHTML = `<div style="font-size:13px;color:#9fb0c6">听音选义</div>
      <button class="btn ghost" id="aPlay2">🔊 再听一次</button>
      <div class="opts">${opts.map(o => `<button class="opt" data-w="${esc(o.w)}">${esc(o.z)}</button>`).join('')}</div>`;
    $('#aPlay2').onclick = speakCur;
    $$('#stage .opt').forEach(b => b.onclick = () => {
      if (Q.answering) return; Q.answering = true;
      const ok = b.dataset.w === v.w;
      b.classList.add(ok ? 'right' : 'wrong');
      if (!ok) $$('#stage .opt').forEach(x => { if (x.dataset.w === v.w) x.classList.add('right'); });
      acts.innerHTML = `<button class="btn" id="aNext">下一个 (Enter)</button>`;
      $('#aNext').onclick = next;
      grade(ok ? 2 : 0, ok);
      setTimeout(next, ok ? 700 : 1800);
    });
    acts.innerHTML = `<button class="btn ghost" id="aPlay3">🔊 播放</button>`;
    $('#aPlay3').onclick = speakCur;
    setTimeout(speakCur, 250);
  }
  else if (Q.mode === 'spell') {
    st.innerHTML = `<div style="font-size:13px;color:#9fb0c6">听写拼写　${esc(v.z)}</div>
      <button class="btn ghost" id="aPlay4">🔊 播放</button>
      <input class="spellin" id="spIn" placeholder="type the word" autocomplete="off" spellcheck="false">
      <div id="spHint" style="font-size:12.5px;color:#6b7d94">${esc((v.w[0] || '') + '… (' + v.w.length + ' 个字母)')}</div>`;
    $('#aPlay4').onclick = speakCur;
    const inp = $('#spIn'); inp.focus();
    inp.onkeydown = e => {
      if (e.key !== 'Enter') return;
      const ok = inp.value.trim().toLowerCase() === v.w.toLowerCase();
      inp.classList.add(ok ? 'ok' : 'no');
      inp.value = ok ? v.w : v.w;
      grade(ok ? 2 : 0, ok);
      acts.innerHTML = `<button class="btn" id="aNext">下一个 (Enter)</button>`;
      $('#aNext').onclick = next;
      setTimeout(next, ok ? 600 : 1600);
    };
    acts.innerHTML = `<button class="btn ghost" id="aPlay5">🔊 播放</button><button class="btn" id="aGive">看答案</button>`;
    $('#aPlay5').onclick = speakCur; $('#aGive').onclick = () => { inp.value = v.w; grade(0, false); setTimeout(next, 1400); };
    setTimeout(speakCur, 250);
  }
  else if (Q.mode === 'cloze') {
    const blank = v.e ? v.e.replace(new RegExp('\\b' + v.w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), '____') : '';
    st.innerHTML = `<div style="font-size:13px;color:#9fb0c6">例句填空　${esc(v.z)}</div>
      <div class="clozeline">${esc(blank || (v.w + ' …'))}</div>
      <input class="spellin" id="clIn" placeholder="填单词" autocomplete="off" spellcheck="false">
      <div style="font-size:12.5px;color:#6b7d94">${esc(v.w[0] || '')}… ${v.w.length} 字母</div>`;
    const inp = $('#clIn'); inp.focus();
    inp.onkeydown = e => {
      if (e.key !== 'Enter') return;
      const ok = inp.value.trim().toLowerCase() === v.w.toLowerCase();
      inp.classList.add(ok ? 'ok' : 'no'); if (!ok) inp.value = v.w;
      grade(ok ? 2 : 0, ok);
      acts.innerHTML = `<button class="btn" id="aNext">下一个 (Enter)</button>`;
      $('#aNext').onclick = next; TTS.speak(v.e || v.w, { rate: 0.9 });
      setTimeout(next, ok ? 700 : 1700);
    };
    acts.innerHTML = `<button class="btn ghost" id="aPlay6">🔊 读例句</button><button class="btn" id="aGive">看答案</button>`;
    $('#aPlay6').onclick = () => TTS.speak(v.e || v.w, { rate: 0.9 });
    $('#aGive').onclick = () => { inp.value = v.w; grade(0, false); setTimeout(next, 1400); };
  }
}
function reveal() {
  if (Q.shown) return; Q.shown = true;
  const m = $('#more'); if (m) m.style.display = 'block';
  const v = cur();
  $('#qActions').innerHTML = Q.mode === 'rush'
    ? `<button class="btn qa-forget" data-g="0">不认识 (1)</button><button class="btn qa-know" data-g="3">认识 (2)</button>`
    : `<button class="btn qa-forget" data-g="0">忘了 (1)</button><button class="btn qa-fuzz" data-g="1">模糊 (2)</button><button class="btn" data-g="2">认识 (3)</button><button class="btn qa-know" data-g="3">简单 (4)</button>`;
  $$('#qActions .btn').forEach(b => b.onclick = () => { grade(+b.dataset.g, +b.dataset.g >= 2); next(); });
  if (v && v.e) TTS.speak(v.e, { rate: 0.95 });
}
function grade(g, ok) {
  const v = cur(); if (!v) return;
  review(v.w, g);
  if (ok) { Q.right++; todayStat().right++; } else { Q.wrong++; todayStat().wrong++; if (S.settings.autoVault) addVault(v); }
  save(); $('#qRight').textContent = Q.right; $('#qWrong').textContent = Q.wrong;
}
function next() { Q.i++; if (Q.i >= Q.list.length) return finishRound(); renderQ(); }
function finishRound() {
  const min = Math.max(1, Math.round((Date.now() - Q.start) / 60000));
  addMin(min); save();
  const total = Q.right + Q.wrong;
  const acc = total ? Math.round(Q.right / total * 100) : 0;
  $('#stage').innerHTML = `<div class="empty">🎉 本轮完成！<br><br>
    <div style="font-size:34px;font-weight:800;color:#5ee0b0">${acc}%</div>
    <div style="margin-top:6px">正确率 · 共 ${total} 词 · 用时约 ${min} 分钟</div></div>`;
  $('#qActions').innerHTML = `<button class="btn" id="aAgain">再来一轮</button><button class="btn ghost" id="aVault">去复习生词本</button>`;
  $('#aAgain').onclick = newRound;
  $('#aVault').onclick = () => { $('#deckSel').value = 'vault'; newRound(); };
  $('#report').innerHTML = `<div class="repstat">正确率 <b>${acc}%</b></div>
    <div class="repstat">题量 <b>${total}</b></div>
    <div class="repstat">用时 <b>${min} 分钟</b></div>
    <div class="repstat">平均 <b>${total ? Math.round(min * 60 / total) : 0} 秒/词</b></div>`;
  renderHome();
}
document.addEventListener('keydown', e => {
  if ($('#view-ielts').classList.contains('active') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter' || e.key === '2') {
      e.preventDefault(); const b = $('#iscYes'); if (b) b.click();
    } else if (e.key === 'ArrowLeft' || e.key === '1') {
      e.preventDefault(); const b = $('#iscNo'); if (b) b.click();
    } else if (e.key === ',' || e.key === 'p' || e.key === 'P') {
      e.preventDefault(); const b = $('#iscPrev'); if (b && !b.disabled) b.click();
    } else if (e.key === '.' || e.key === 'n' || e.key === 'N') {
      e.preventDefault(); const b = $('#iscNext'); if (b) b.click();
    }
  }
  if ($('#view-blitz').classList.contains('active') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) {
    if (e.code === 'Space') { e.preventDefault(); if (Q.cur) TTS.speak(Q.cur.w, { rate: 0.9 }); if (!Q.shown) reveal(); }
    if (e.key === 'Enter') { const b = $('#aNext') || $('#aShow'); if (b) b.click(); }
    if (['1', '2', '3', '4'].includes(e.key)) {
      const bs = $$('#qActions .btn[data-g]'); const b = bs[+e.key - 1]; if (b) b.click();
    }
  }
  if (e.key === 'Escape') $('#modal').classList.remove('on');
});

/* ============================================================
   10. 生词本
============================================================ */
function renderVault() {
  const arr = vaultList();
  const el = $('#vaultList');
  if (!arr.length) { el.innerHTML = '<div class="empty">生词本还是空的。在精听里点生词、或在突击里点"不认识"会自动收藏。</div>'; return; }
  el.innerHTML = arr.map(v => {
    const s = S.srs[v.w.toLowerCase()] || { l: 0 };
    const lvn = ['未掌握', '模糊', '认识', '已掌握'][s.l || 0];
    return `<div class="vrow">
      <span class="lv lv${s.l || 0}">${lvn}</span>
      <h4>${esc(v.w)} <button class="icobtn" data-sp="${esc(v.w)}" style="width:26px;height:26px">🔊</button></h4>
      ${v.p ? `<div class="ph">${esc(v.p)}</div>` : ''}
      <div class="mz">${esc(v.z || '')}</div>
      ${v.e ? `<div class="ex">${esc(v.e)}<br><span style="color:#6b7d94">${esc(v.ez || '')}</span></div>` : ''}
      <div class="ops">
        <button class="mini" data-add="${esc(v.w)}">＋1 复习强度</button>
        <button class="mini" data-mas="${esc(v.w)}">标记掌握</button>
        <button class="mini" data-del="${esc(v.w)}">移除</button>
      </div></div>`;
  }).join('');
  $$('#vaultList .icobtn').forEach(b => b.onclick = () => TTS.speak(b.dataset.sp, { rate: 0.9 }));
  $$('#vaultList [data-del]').forEach(b => b.onclick = () => { delete S.vault[b.dataset.del.toLowerCase()]; save(); renderVault(); renderVaultBadge(); });
  $$('#vaultList [data-mas]').forEach(b => b.onclick = () => { review(b.dataset.mas, 3); renderVault(); toast('已标记掌握'); });
  $$('#vaultList [data-add]').forEach(b => b.onclick = () => { review(b.dataset.add, 0); renderVault(); toast('已重置为高频复习'); });
}
$('#vSearch').oninput = renderVault;
$('#vSort').onchange = renderVault;
$('#vDrill').onclick = () => { go('blitz'); $('#deckSel').value = 'vault'; newRound(); };
$('#vBatch').onclick = startBatch;
$('#vClear').onclick = () => { if (confirm('确定清空生词本？（已掌握记录会保留）') ) { S.vault = {}; save(); renderVault(); renderVaultBadge(); } };
$('#vExport').onclick = () => {
  const rows = [['word', 'phonetic', 'pos', 'meaning', 'example', 'zh']];
  Object.values(S.vault).forEach(v => rows.push([v.w, v.p, v.t, v.z, v.e, v.ez]));
  const csv = '\ufeff' + rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'fluency7-vocab.csv'; a.click();
};
$('#vExportAnki').onclick = () => {
  // Anki 原生偏好 tab 分隔（TSV），无引号包裹，避免释义里的逗号/引号冲突
  const rows = [['word', 'phonetic', 'meaning', 'example', 'pos']];
  Object.values(S.vault).forEach(v => rows.push([v.w, v.p, v.z, v.e, v.t]));
  const tsv = rows.map(r => r.map(c => String(c == null ? '' : c).replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + tsv], { type: 'text/tab-separated-values' }));
  a.download = 'fluency7-anki.tsv'; a.click();
  toast('已导出 Anki TSV（直接导入 Anki 即可）');
};

/* ============================================================
   10.5 雅思全量词库 · 第一遍筛查 + 生词本批次背诵
============================================================ */
function ensureScreenDate() {
  const k = todayKey();
  if (S.screen.date !== k) { S.screen.date = k; S.screen.today = 0; save(); }
}

function renderIelts() {
  ensureScreenDate();
  const list = IELTS_FULL;
  const total = list.length;
  const known = S.screen.known, unknown = S.screen.unknown;
  const remain = list.filter(v => { const k = v.w.toLowerCase(); return !known[k] && !unknown[k]; });
  const done = Object.keys(known).length + Object.keys(unknown).length;
  const goal = S.settings.ieltsDaily;

  $('#ieltsGoalTxt').textContent = goal;
  $('#ieltsAllTxt').textContent = done + ' / ' + total;
  $('#ieltsBarAll').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  $('#ieltsTodayTxt').textContent = S.screen.today + ' / ' + goal;
  $('#ieltsBarToday').style.width = Math.min(100, goal ? Math.round(S.screen.today / goal * 100) : 0) + '%';
  $('#ieltsKnown').textContent = Object.keys(known).length;
  $('#ieltsUnk').textContent = Object.keys(unknown).length;
  $('#ieltsLeft').textContent = remain.length;

  const stage = $('#ieltsStage');
  // 初始化浏览历史（用于上一个/下一个回退修改）
  if (!S.screen.hist) S.screen.hist = [];
  if (S.screen.pos == null) S.screen.pos = 0;
  if (!S.screen.hist.length) {
    const startPool = remain.length ? remain : list;
    if (!startPool.length) { stage.innerHTML = '<div class="empty">词库为空</div>'; return; }
    S.screen.hist.push(startPool[0].w.toLowerCase());
    S.screen.pos = 0;
  }
  S.screen.pos = Math.max(0, Math.min(S.screen.pos, S.screen.hist.length - 1));
  const curKey = S.screen.hist[S.screen.pos];
  const v = IELTS_MAP[curKey] || IELTS_FULL.find(x => x.w.toLowerCase() === curKey);
  if (!v) { S.screen.hist.splice(S.screen.pos, 1); save(); renderIelts(); return; }

  const overGoal = S.screen.today >= goal;
  const allDone = remain.length === 0;
  const curStatus = known[curKey] ? '已标：认识' : unknown[curKey] ? '已标：不认识' : '未标记';
  const statusCls = known[curKey] ? 'st-kn' : unknown[curKey] ? 'st-un' : 'st-no';

  stage.innerHTML = `
    <div class="isc">
      ${allDone ? '<div class="isc-goal">🎉 全部 ' + total + ' 词已筛查完成！可用「上一个 / 下一个」回看修改，或 <button class="lnk" id="ieltsGoVault2">📖 去生词本分批次背</button></div>'
        : (overGoal ? '<div class="isc-goal">✅ 今日目标已达成，可继续超额筛查</div>' : '')}
      <div class="isc-word" id="iscWord">${esc(v.w)}</div>
      <div class="isc-phon">${v.p ? esc(v.p) : ''} <button class="icobtn" id="iscPlay" style="width:30px;height:30px">🔊</button></div>
      ${v.t ? `<div class="isc-pos">${esc(v.t)}</div>` : ''}
      <div class="isc-z">${esc(v.z || '')}</div>
      <div class="isc-nav">
        <button class="btn ghost" id="iscPrev" ${S.screen.pos === 0 ? 'disabled' : ''}>← 上一个</button>
        <span class="isc-count"><span class="st-tag ${statusCls}">${curStatus}</span> 第 ${S.screen.pos + 1} / ${S.screen.hist.length} 个浏览</span>
        <button class="btn ghost" id="iscNext">下一个 →</button>
      </div>
      <div class="isc-acts">
        <button class="btn isc-no" id="iscNo">← 不认识</button>
        <button class="btn isc-yes" id="iscYes">认识 →</button>
      </div>
      <div class="isc-hint">快捷键：←/1 不认识 · →/空格 认识 · , 上一个 · . 下一个（点错可回退修改）</div>
    </div>`;
  $('#iscPlay').onclick = () => TTS.speak(v.w, { rate: 0.9 });
  $('#iscYes').onclick = () => ieltsMark(v, true);
  $('#iscNo').onclick = () => ieltsMark(v, false);
  $('#iscPrev').onclick = ieltsPrev;
  $('#iscNext').onclick = ieltsNext;
  if ($('#ieltsGoVault2')) $('#ieltsGoVault2').onclick = () => go('vault');
  TTS.speak(v.w, { rate: 0.9 });
}
function ieltsAdvance() {
  const atFront = S.screen.pos === S.screen.hist.length - 1;
  if (atFront) {
    const remain = IELTS_FULL.filter(x => { const k = x.w.toLowerCase(); return !S.screen.known[k] && !S.screen.unknown[k]; });
    if (remain.length) { S.screen.hist.push(remain[0].w.toLowerCase()); S.screen.pos++; }
  } else {
    S.screen.pos++;
  }
}
function ieltsMark(v, know) {
  const k = v.w.toLowerCase();
  const wasKn = !!S.screen.known[k];
  const wasUnk = !!S.screen.unknown[k];
  if (know) {
    delete S.screen.unknown[k];
    S.screen.known[k] = 1;
    if (wasUnk) delete S.vault[k];   // 改判为认识 → 移出生词本
  } else {
    delete S.screen.known[k];
    S.screen.unknown[k] = 1;
    if (!wasUnk) addVault({ w: v.w, p: v.p, t: v.t, z: v.z, deck: 'ielts' });
  }
  if (!wasKn && !wasUnk) S.screen.today++;   // 仅首次判定计入当日目标
  ieltsAdvance();
  save();
  renderIelts();
}
function ieltsPrev() {
  if (S.screen.pos > 0) { S.screen.pos--; save(); renderIelts(); }
}
function ieltsNext() {
  if (S.screen.pos < S.screen.hist.length - 1) S.screen.pos++;
  else {
    const remain = IELTS_FULL.filter(x => { const k = x.w.toLowerCase(); return !S.screen.known[k] && !S.screen.unknown[k]; });
    if (remain.length) { S.screen.hist.push(remain[0].w.toLowerCase()); S.screen.pos++; }
  }
  save(); renderIelts();
}
$('#ieltsReset').onclick = () => {
  if (confirm('重置雅思筛查进度？已认识/已入生词本的记录会清空（生词本里的词保留）。')) {
    S.screen = { date: todayKey(), today: 0, known: {}, unknown: {}, hist: [], pos: 0 }; save(); renderIelts();
  }
};

// 生词本：分批次背诵（取前 N 个未掌握词，进入卡片模式）
function startBatch() {
  const n = parseInt(($('#vBatchSize') && $('#vBatchSize').value) || '30', 10) || 30;
  const due = Object.values(S.vault)
    .map(v => ({ w: v.w, p: v.p, t: v.t, z: v.z, e: v.e, ez: v.ez, deck: v.src || 'vault' }))
    .filter(v => { const s = S.srs[v.w.toLowerCase()]; return !s || s.l < 3; });
  if (!due.length) { toast('没有未掌握的生词，先去筛查或标记掌握吧'); return; }
  const batch = due.slice(0, n);
  Q.deck = 'vault'; Q.mode = 'card'; Q.list = batch;
  Q.i = 0; Q.right = 0; Q.wrong = 0; Q.start = Date.now(); Q.shown = false; Q.cur = null; Q.answering = false;
  S.batchDone = (S.batchDone || 0) + 1; save();
  go('blitz'); renderQ();
  const rem = due.length - batch.length;
  if ($('#vBatchInfo')) $('#vBatchInfo').textContent = '已背 ' + S.batchDone + ' 批 · 本批 ' + batch.length + ' 词 · 还剩未掌握 ' + rem + ' 词';
  toast('开始第 ' + S.batchDone + ' 批 · 共 ' + batch.length + ' 词');
}

/* ============================================================
   11. 美语解码
============================================================ */
let decFilter = 'all';
function renderDec() {
  const list = DECODER.filter(d => decFilter === 'all' || d.ty === decFilter);
  $('#decList').innerHTML = list.map(d => {
    const added = !!S.vault[norm(d.real)];
    const exs = (d.exs || []).map(x =>
      `<div class="dec-ex">
        <button class="icobtn sm" data-say="${esc(x[0])}">🔊</button>
        <span class="dec-en">${esc(x[0])}</span>
        <span class="dec-zh">${esc(x[1])}</span>
      </div>`).join('');
    const note = d.note ? `<div class="dec-note">💡 ${esc(d.note)}</div>` : '';
    return `<div class="drow">
      <span class="ty">${{ contract: '缩读', link: '连读', reduce: '弱读', slang: '口语' }[d.ty] || d.ty}</span>
      <div class="full">
        <div class="wrote">${esc(d.full)}</div>
        <div class="real">${esc(d.real)} <span class="sounds">${esc(d.sound)}</span></div>
        <div class="zh">${esc(d.zh)}</div>
        ${exs}
        ${note}
      </div>
      <div class="drow-acts">
        <button class="icobtn" data-say="${esc(d.real)}" title="朗读实际读音">🔊</button>
        <button class="mini dec-vault${added ? ' added' : ''}" data-real="${esc(d.real)}" data-sound="${esc(d.sound)}" data-zh="${esc(d.zh)}" data-full="${esc(d.full)}" data-ex0="${esc(((d.exs || [])[0] || [])[0] || '')}">${added ? '✅ 已加入' : '⭐ 生词本'}</button>
      </div>
    </div>`;
  }).join('');
  $$('#decList .icobtn').forEach(b => b.onclick = (e) => { e.stopPropagation(); TTS.speak(b.dataset.say, { rate: 0.85 }); });
  $$('#decList .dec-vault').forEach(b => b.onclick = () => {
    const ok = addVault({ w: b.dataset.real, p: b.dataset.sound, t: '解码', z: b.dataset.zh, e: b.dataset.full, ez: b.dataset.ex0, deck: 'decoder' });
    if (ok) { b.classList.add('added'); b.textContent = '✅ 已加入'; toast('⭐ 已加入生词本'); }
    else { b.classList.add('added'); b.textContent = '✅ 已加入'; toast('这条已在生词本里'); }
  });
}
$$('#decFilter .f-btn').forEach(b => b.onclick = () => {
  $$('#decFilter .f-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
  decFilter = b.dataset.t; renderDec();
});

/* ============================================================
   11.5 连读实验室
============================================================ */
const LINKING = window.LINKING || [];
let lkMode = 'contrast', lkFilter = 'all', lkIdx = 0, lkList = [];
const CAT_CN = { contract: '缩读', reduce: '弱读', link: '连读', flap: '浊化失爆', assim: '同化', fast: '综合串读' };

function lkAddVault(d) {
  // 连读条目以「实际口语写法 d.h」入库，复习时记住美国人怎么说
  const ok = addVault({ w: d.h, p: d.ipa, t: '连读', z: d.z, e: d.w, ez: d.z, deck: 'linking' });
  toast(ok ? '⭐ 已加入生词本' : '这条已在生词本里');
}
function lkWrong(d) {
  const k = norm(d.h);
  const o = S.weakLink[k] || { w: d.w, h: d.h, ipa: d.ipa, z: d.z, n: d.n, cat: d.cat, c: 0, ts: 0 };
  o.c++; o.ts = Date.now(); S.weakLink[k] = o; save();
  const nb = $('#lkWeakN'); if (nb) nb.textContent = Object.keys(S.weakLink).length;
}

function renderLinking() {
  const isDlg = (lkMode === 'dialog');
  lkList = isDlg ? (window.LK_DIALOGS || [])
    : (lkFilter === 'weak' ? Object.values(S.weakLink)
      : LINKING.filter(d => lkFilter === 'all' || d.cat === lkFilter));
  $('#lkProg').textContent = (lkList.length ? lkIdx + 1 : 0) + ' / ' + lkList.length;
  const stage = $('#lkStage'), acts = $('#lkActions');
  const nb = $('#lkWeakN'); if (nb) nb.textContent = Object.keys(S.weakLink).length;
  if (!lkList.length) {
    stage.innerHTML = lkFilter === 'weak'
      ? '<p class="muted">🎉 目前没有薄弱连读。听写/听辨做错会自动收集到这里。</p>'
      : '<p class="muted">该分类暂无内容。</p>';
    acts.innerHTML = ''; return;
  }
  if (lkIdx >= lkList.length) lkIdx = 0;
  if (lkIdx < 0) lkIdx = lkList.length - 1;
  const d = lkList[lkIdx];
  if (isDlg) { lkDialog(d, stage, acts); return; }
  if (lkMode === 'contrast') lkContrast(d, stage, acts);
  else if (lkMode === 'dictation') lkDictation(d, stage, acts);
  else if (lkMode === 'choose') lkChoose(d, stage, acts);
  else lkShadow(d, stage, acts);
  // 统一加「加入生词本」按钮（四种单句模式通用）
  const added = !!S.vault[norm(d.h)];
  const vb = document.createElement('button');
  vb.className = 'mini lk-vaultbtn' + (added ? ' added' : '');
  vb.id = 'lkVault';
  vb.innerHTML = added ? '✅ 已加入生词本' : '⭐ 加入生词本';
  vb.onclick = () => {
    lkAddVault(d);
    vb.classList.add('added'); vb.innerHTML = '✅ 已加入生词本';
  };
  stage.insertBefore(vb, stage.firstChild);
}
function norm(s) { return (s || '').toLowerCase().replace(/[^a-z' ]/g, '').replace(/\s+/g, ' ').trim(); }

function lkContrast(d, stage, acts) {
  stage.innerHTML = `
    <div class="lk-card">
      <div class="lk-line"><span class="lk-tag">📝 书面写法（课本上的）</span><div class="lk-written">${esc(d.w)}</div></div>
      <div class="lk-btns"><button class="mini" id="lkSW">🔊 慢速·书面读法（朗文逐词）</button></div>
      <div class="lk-line"><span class="lk-tag acc">🗣 美国人实际说的</span><div class="lk-real">${esc(d.h)}</div></div>
      <div class="lk-btns">
        <button class="mini" id="lkSH">🔊 慢速·真实口语</button>
        <button class="mini" id="lkFH">🔊 常速·真实口语</button>
      </div>
      <div class="lk-ipa">${esc(d.ipa)}</div>
      <div class="lk-note">💡 ${esc(d.n)}</div>
      <div class="lk-zh">🇨🇳 ${esc(d.z)}</div>
    </div>`;
  acts.innerHTML = `<button class="btn" id="lkPrev">← 上一句</button><button class="btn" id="lkNext">下一句 →</button>`;
  $('#lkSW').onclick = () => TTS.speakWords(d.w.split(/\s+/), 0.6);
  $('#lkSH').onclick = () => TTS.speak(d.h, { rate: 0.7 });
  $('#lkFH').onclick = () => TTS.speak(d.h, { rate: 1.0 });
  $('#lkPrev').onclick = () => { lkIdx--; renderLinking(); };
  $('#lkNext').onclick = () => { lkIdx++; renderLinking(); };
}
function lkDictation(d, stage, acts) {
  stage.innerHTML = `
    <div class="lk-card">
      <div class="lk-line"><span class="lk-tag">⌨️ 听写训练</span><div class="muted small">听下面这段真实口语，写出你听到的样子</div></div>
      <div class="lk-btns">
        <button class="mini" id="lkPH">🔊 播放（慢速）</button>
        <button class="mini" id="lkPH2">🔊 播放（常速）</button>
      </div>
      <input class="lk-input" id="lkIn" placeholder="在这里打出来…" autocomplete="off" />
      <div class="lk-btns"><button class="mini" id="lkRev">显示答案</button></div>
      <div id="lkAns" class="lk-answer" style="display:none">
        <div class="lk-real">${esc(d.h)}</div>
        <div class="lk-ipa">${esc(d.ipa)}</div>
        <div class="lk-zh">🇨🇳 ${esc(d.z)}</div>
        <div class="lk-orig">📝 原句：${esc(d.w)}</div>
        <div class="lk-note">💡 ${esc(d.n)}</div>
      </div>
    </div>`;
  acts.innerHTML = `<button class="btn" id="lkNext">下一句 →</button>`;
  $('#lkPH').onclick = () => TTS.speak(d.h, { rate: 0.7 });
  $('#lkPH2').onclick = () => TTS.speak(d.h, { rate: 1.0 });
  $('#lkRev').onclick = () => {
    const ans = $('#lkAns'); ans.style.display = 'block';
    const inp = norm($('#lkIn').value);
    if (inp) {
      if (inp === norm(d.h)) ans.insertAdjacentHTML('beforeend', '<div class="lk-ok">✅ 完全正确！</div>');
      else { lkWrong(d); ans.insertAdjacentHTML('beforeend', '<div class="lk-warn">❌ 你的答案：' + esc($('#lkIn').value) + '　已记入薄弱连读</div>'); }
    }
  };
  $('#lkNext').onclick = () => { lkIdx++; renderLinking(); };
}
function lkChoose(d, stage, acts) {
  const opts = [d.h];
  const pool = LINKING.filter(x => x.h !== d.h);
  shuffle(pool).slice(0, 3).forEach(x => opts.push(x.h));
  shuffle(opts);
  stage.innerHTML = `
    <div class="lk-card">
      <div class="lk-line"><span class="lk-tag">🎯 听辨选择</span><div class="muted small">听原音，选出美国人实际说出来的样子</div></div>
      <div class="lk-btns"><button class="mini" id="lkPH">🔊 听原音</button></div>
      <div class="lk-opts" id="lkOpts">
        ${opts.map((o, i) => `<button class="lk-opt" data-i="${i}">${esc(o)}</button>`).join('')}
      </div>
      <div id="lkChk" class="lk-note"></div>
      <div class="lk-ipa">${esc(d.ipa)}</div>
      <div class="lk-note">💡 ${esc(d.n)}</div>
      <div class="lk-zh">🇨🇳 ${esc(d.z)}</div>
    </div>`;
  acts.innerHTML = `<button class="btn" id="lkNext">下一句 →</button>`;
  $('#lkPH').onclick = () => TTS.speak(d.h, { rate: 0.85 });
  $$('#lkOpts .lk-opt').forEach(b => b.onclick = () => {
    const correct = b.textContent === d.h;
    $$('#lkOpts .lk-opt').forEach(x => x.classList.add('dim'));
    b.classList.remove('dim'); b.classList.add(correct ? 'right' : 'wrong');
    if (!correct) lkWrong(d);
    $('#lkChk').innerHTML = (correct ? '✅ 答对！' : '❌ 正确是：' + esc(d.h)) + '　🇨🇳 ' + esc(d.z);
  });
  $('#lkNext').onclick = () => { lkIdx++; renderLinking(); };
}
function lkShadow(d, stage, acts) {
  stage.innerHTML = `
    <div class="lk-card">
      <div class="lk-line"><span class="lk-tag">🗣 影子跟读</span><div class="lk-real">${esc(d.h)}</div></div>
      <div class="lk-ipa">${esc(d.ipa)}</div>
      <div class="lk-btns"><button class="mini" id="lkPH">🔊 听原音</button></div>
      <button class="btn" id="lkRec">🎤 开始跟读</button>
      <div id="lkOut" class="lk-note"></div>
    </div>`;
  acts.innerHTML = `<button class="btn" id="lkNext">下一句 →</button>`;
  $('#lkPH').onclick = () => TTS.speak(d.h, { rate: 0.8 });
  $('#lkRec').onclick = () => lkRecognize(d);
  $('#lkNext').onclick = () => { lkIdx++; renderLinking(); };
}
function lkDialog(d, stage, acts) {
  let html = `<div class="lk-card">
    <div class="lk-dlg-title">💬 ${esc(d.title)} <span class="muted small">· ${esc(d.scene || '')}</span></div>
    <div class="lk-btns"><button class="mini" id="lkDlgPlayAll">🔊 整段连播（慢速）</button></div>`;
  d.lines.forEach((ln, i) => {
    html += `<div class="lk-dlg-line">
      <div class="lk-dlg-en"><span>${esc(ln.en)}</span>
        <button class="icobtn" data-pl="${i}" title="慢速">🔊</button>
        <button class="icobtn" data-plf="${i}" title="常速">⏩</button>
      </div>
      <div class="lk-dlg-zh">🇨🇳 ${esc(ln.zh || '')}</div>
      ${ln.tip ? `<div class="lk-dlg-tip">💡 ${esc(ln.tip)}</div>` : ''}
    </div>`;
  });
  html += `</div>`;
  stage.innerHTML = html;
  acts.innerHTML = `<button class="btn" id="lkPrev">← 上一段</button><button class="btn" id="lkNext">下一段 →</button>`;
  $$('[data-pl]', stage).forEach(b => b.onclick = () => TTS.speak(d.lines[+b.dataset.pl].en, { rate: 0.8 }));
  $$('[data-plf]', stage).forEach(b => b.onclick = () => TTS.speak(d.lines[+b.dataset.pl].en, { rate: 1.0 }));
  $('#lkDlgPlayAll').onclick = () => {
    d.lines.forEach((ln, i) => setTimeout(() => TTS.speak(ln.en, { rate: 0.8 }), i * 2800));
  };
  $('#lkPrev').onclick = () => { lkIdx--; renderLinking(); };
  $('#lkNext').onclick = () => { lkIdx++; renderLinking(); };
}

function lkRecognize(d) {
  const out = $('#lkOut'); out.textContent = '🎙 请跟读…';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { out.textContent = '⚠️ 当前浏览器不支持语音识别，请用 Chrome / Edge。'; return; }
  const r = new SR(); r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
  r.onresult = e => {
    const heard = norm(e.results[0][0].transcript);
    const ta = norm(d.h).split(' ').filter(Boolean), ha = heard.split(' ').filter(Boolean);
    let hit = 0; ta.forEach(w => { if (ha.includes(w)) hit++; });
    const pct = ta.length ? Math.round(hit / ta.length * 100) : 0;
    out.innerHTML = `你说：<b>${esc(heard)}</b>　匹配度 <b style="color:${pct >= 70 ? 'var(--acc2)' : 'var(--warn)'}">${pct}%</b><br>🇨🇳 ${esc(d.z)}`;
  };
  r.onerror = e => { out.textContent = '⚠️ 识别失败：' + e.error; };
  try { r.start(); } catch (e) { out.textContent = '⚠️ 请允许麦克风权限。'; }
}
$$('#lkMode .m-btn').forEach(b => b.onclick = () => {
  $$('#lkMode .m-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
  lkMode = b.dataset.m; lkIdx = 0; renderLinking();
});
$$('#lkFilter .f-btn').forEach(b => b.onclick = () => {
  $$('#lkFilter .f-btn').forEach(x => x.classList.remove('active')); b.classList.add('active');
  lkFilter = b.dataset.c; lkIdx = 0; renderLinking();
});

/* ============================================================
   12. 设置
============================================================ */
$('#setEngine').onchange = e => { S.settings.engine = e.target.value; save(); };
$('#setVoice').onchange = e => { S.settings.voice = e.target.value; TTS.pickVoice(); };
$('#setDaily').onchange = e => { S.settings.daily = +e.target.value; save(); };
$('#setListen').onchange = e => { S.settings.listenGoal = +e.target.value; save(); };
$('#setAuto').onchange = e => { S.settings.autoVault = +e.target.value; save(); };
$('#setIeltsDaily').onchange = e => { S.settings.ieltsDaily = +e.target.value; save(); };
$('#testSpeak').onclick = () => TTS.speak("The weather's really nice today, isn't it?", { rate: 1 });
$('#resetPlan').onclick = () => { if (confirm('重置到第 1 天？生词本和已掌握记录会保留。')) { S.startDate = todayKey(); S.tasks = {}; save(); renderHome(); toast('已重置为 Day 1'); } };
$('#expAll').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' }));
  a.download = 'fluency7-backup-' + todayKey() + '.json'; a.click();
};
$('#impAll').onclick = () => $('#impFile').click();
$('#impFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => { try { S = JSON.parse(r.result); save(); location.reload(); } catch (x) { toast('文件格式不对'); } };
  r.readAsText(f);
};

/* ============================================================
   12.5 云同步（GitHub Gist 双向合并）
============================================================ */
const GIST_FILE = 'fluency7-state.json';

async function gistReq(method, path, body) {
  const base = (SYNC.base || 'https://api.github.com').replace(/\/$/, '');
  const url = /^https?:\/\//.test(path) ? path : base + path;
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'token ' + SYNC.token };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error('GitHub API ' + res.status + ' ' + t.slice(0, 160)); }
  return res.json();
}
/* 自动发现已存在的同步 gist：本机没 ID 时，列出账号下所有 gist，
   找到含 fluency7-state.json 的那个并采用（多端共用同一个，避免各建各的）*/
async function gistDiscover() {
  if (!SYNC.token || SYNC.gistId) return SYNC.gistId;
  const list = await gistReq('GET', '/gists?per_page=100');
  const mine = (list || []).filter(g => g.files && g.files[GIST_FILE]);
  if (!mine.length) return '';
  mine.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  SYNC.gistId = mine[0].id; saveSync();
  return SYNC.gistId;
}
async function safeDiscover() { try { await gistDiscover(); } catch (e) { console.error('[sync] discover', e); } }

async function gistPull() {
  if (!SYNC.token) return null;
  if (!SYNC.gistId) await safeDiscover();     // 首次：先找别人已建的仓库
  if (!SYNC.gistId) return null;
  let g;
  try { g = await gistReq('GET', '/gists/' + SYNC.gistId); }
  catch (e) {
    // ID 失效（仓库被删/不属于本账号）→ 清空后重新发现，并真正拉取新仓库内容
    if (/404/.test(e.message)) {
      SYNC.gistId = ''; saveSync();
      await safeDiscover();
      if (!SYNC.gistId) return null;
      try { g = await gistReq('GET', '/gists/' + SYNC.gistId); }
      catch (e2) { return null; }
    } else return null;
  }
  const f = g.files && g.files[GIST_FILE];
  if (!f || !f.content) return null;
  return JSON.parse(f.content);
}
/* ---- 局域网直连后端（零账号，数据不出本地网络）---- */
function lanBase() {
  let h = (SYNC.lanHost || '').trim().replace(/\/+$/, '');
  if (!h) return '';
  if (!/^https?:\/\//.test(h)) h = 'http://' + h;
  return h;
}
async function lanPull() {
  const b = lanBase(); if (!b) throw new Error('未填写电脑地址');
  const res = await fetch(b + '/api/state', { headers: { 'X-Sync-Key': SYNC.key || 'x' } });
  if (!res.ok) throw new Error('电脑无响应 ' + res.status);
  const j = await res.json();
  return (j && j.data && Object.keys(j.data).length) ? j.data : null;
}
async function lanPush(stateObj) {
  const b = lanBase(); if (!b) throw new Error('未填写电脑地址');
  if (!SYNC.key) throw new Error('未设置同步码');
  const res = await fetch(b + '/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Sync-Key': SYNC.key },
    body: JSON.stringify({ data: stateObj })
  });
  if (!res.ok) throw new Error(res.status === 403 ? '同步码不一致' : '写入失败 ' + res.status);
  return res.json();
}

async function gistPush(stateObj) {
  const body = { files: { [GIST_FILE]: { content: JSON.stringify(stateObj) } } };
  if (!SYNC.gistId) {
    const g = await gistReq('POST', '/gists', { public: false, description: 'Fluency7 学习数据同步', files: body.files });
    SYNC.gistId = g.id; saveSync();
    return g;
  }
  return gistReq('PATCH', '/gists/' + SYNC.gistId, body);
}
// 合并两端：按 key 取并集，srs 取更高掌握等级，统计用本地值避免重复累加
function mergeState(local, remote) {
  const m = JSON.parse(JSON.stringify(local));
  if (!remote) return m;
  const lr = remote || {};
  // 生词本 / 薄弱连读 / 筛查标记 / 完成课时 / 任务：并集
  m.vault = Object.assign({}, lr.vault || {}, local.vault || {});
  m.weakLink = Object.assign({}, lr.weakLink || {}, local.weakLink || {});
  m.doneLessons = Object.assign({}, lr.doneLessons || {}, local.doneLessons || {});
  m.tasks = Object.assign({}, lr.tasks || {}, local.tasks || {});
  m.screen = Object.assign({}, local.screen);
  m.screen.known = Object.assign({}, (lr.screen && lr.screen.known) || {}, local.screen.known || {});
  m.screen.unknown = Object.assign({}, (lr.screen && lr.screen.unknown) || {}, local.screen.unknown || {});
  m.screen.today = Math.max(local.screen.today || 0, (lr.screen && lr.screen.today) || 0);
  // SRS：并集，同级取更高掌握等级 l
  m.srs = Object.assign({}, lr.srs || {}, local.srs || {});
  for (const k in local.srs) if (local.srs[k] && lr.srs && lr.srs[k]) m.srs[k] = (local.srs[k].l >= lr.srs[k].l) ? local.srs[k] : lr.srs[k];
  // 统计：天数并集（同日各指标取较大值），累计数保留本地，不累加避免翻倍
  m.stats = Object.assign({}, local.stats); m.stats.days = Object.assign({}, local.stats.days || {});
  const rd = (lr.stats && lr.stats.days) || {};
  for (const d in rd) {
    if (!m.stats.days[d]) m.stats.days[d] = rd[d];
    else for (const kk in rd[d]) m.stats.days[d][kk] = Math.max(m.stats.days[d][kk] || 0, rd[d][kk] || 0);
  }
  m.stats.streak = Math.max(local.stats.streak || 0, (lr.stats && lr.stats.streak) || 0);
  m.stats.lastDay = local.stats.lastDay || (lr.stats && lr.stats.lastDay) || '';
  m.batchDone = Math.max(local.batchDone || 0, lr.batchDone || 0);
  // 设置项保留本机（设备相关，如发音引擎/语速），不同步
  m.settings = Object.assign({}, local.settings);
  return m;
}
function refreshAfterSync() {
  try { renderHome(); } catch (e) { }
  if ($('#vaultList')) { try { renderVault(); } catch (e) { } }
  if ($('#ieltsStage')) { try { renderIelts(); } catch (e) { } }
  if ($('#decList')) { try { renderDec(); } catch (e) { } }
  updateSyncUI();
}
async function syncNow(showToast) {
  const lan = (SYNC.mode !== 'gist');
  if (lan && (!lanBase() || !SYNC.key)) { if (showToast) toast('请先填写电脑地址与同步码'); return; }
  if (!lan && !SYNC.token) { if (showToast) toast('请先填写 GitHub Token'); return; }
  if (_syncing) return;
  _syncing = true;
  try {
    if (showToast) toast('同步中…');
    let remote = null;
    try { remote = lan ? await lanPull() : await gistPull(); } catch (e) { /* 远端可能还没有数据 */ }
    const merged = mergeState(S, remote);
    if (!lan) merged.__gist = SYNC.gistId || (remote && remote.__gist) || undefined;
    S = merged; save();
    if (lan) await lanPush(S); else await gistPush(S);
    SYNC.lastSync = Date.now(); saveSync();
    refreshAfterSync();
    if (showToast) toast('✓ 已同步');
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    if (showToast) toast('同步失败：' + msg); else console.error('[sync]', e);
    const st = document.getElementById('syncStatus');
    if (st) st.innerHTML = '⚠️ 同步失败：<b style="color:var(--warn)">' + esc(msg) + '</b>';
  } finally { _syncing = false; }
}
function updateSyncUI() {
  const st = $('#syncStatus'); const lan = (SYNC.mode !== 'gist');
  // 按模式显示/隐藏对应配置行
  const show = (id, on) => { const el = $(id); if (el) el.closest('.setrow').style.display = on ? '' : 'none'; };
  show('#syncLanHost', lan); show('#syncKey', lan); show('#syncLanHint', lan);
  show('#syncToken', !lan); show('#syncBase', !lan);
  if (st) {
    let t;
    if (lan) t = '局域网 · ' + (lanBase() ? lanBase() : '未填电脑地址') + ' · ' + (SYNC.key ? '同步码已设' : '未设同步码');
    else t = (SYNC.token ? 'GitHub · ' + (SYNC.gistId ? ('Gist ' + SYNC.gistId.slice(0, 8) + '…') : '未建仓库') : 'GitHub · 未填 Token');
    t += ' · ' + (SYNC.enabled ? '自动同步：开' : '自动同步：关');
    if (SYNC.lastSync) t += ' · 上次 ' + new Date(SYNC.lastSync).toLocaleString();
    st.innerHTML = t;
  }
  const ab = $('#syncAutoBtn'); if (ab) ab.textContent = '自动同步：' + (SYNC.enabled ? '开' : '关');
}

$('#syncSaveToken').onclick = () => { SYNC.token = $('#syncToken').value.trim(); saveSync(); updateSyncUI(); toast('Token 已保存'); };
$('#syncBase').onchange = e => { SYNC.base = e.target.value.trim() || 'https://api.github.com'; saveSync(); };
$('#syncMode').onchange = e => { SYNC.mode = e.target.value === 'gist' ? 'gist' : 'lan'; saveSync(); updateSyncUI(); };
$('#syncLanHost').onchange = e => { SYNC.lanHost = e.target.value.trim(); saveSync(); updateSyncUI(); };
$('#syncKey').onchange = e => { SYNC.key = e.target.value.trim(); saveSync(); updateSyncUI(); };
$('#syncUseLocal').onclick = () => {
  $('#syncLanHost').value = location.host;
  SYNC.lanHost = location.host; saveSync(); updateSyncUI(); toast('已填入：' + location.host);
};
$('#syncNow').onclick = () => syncNow(true).then(updateSyncUI);
$('#syncFind').onclick = async () => {
  if (!SYNC.token) { toast('请先填写 GitHub Token'); return; }
  toast('查找中…');
  SYNC.gistId = ''; saveSync();                    // 强制重新查找
  try {
    const id = await gistDiscover();
    if (id) { toast('已找到同步仓库 ' + id.slice(0, 8) + '…'); await syncNow(true); }
    else toast('未找到已有仓库，将新建');
  } catch (e) { toast('查找失败：' + e.message); }
  updateSyncUI();
};
$('#syncAutoBtn').onclick = () => {
  SYNC.enabled = !SYNC.enabled; saveSync(); updateSyncUI();
  if (SYNC.enabled) syncNow(true).then(updateSyncUI);
};

/* ============================================================
   13. 启动
============================================================ */
function boot() {
  TTS.init();
  $('#setEngine').value = S.settings.engine;
  $('#setDaily').value = S.settings.daily;
  $('#setListen').value = S.settings.listenGoal;
  $('#setAuto').value = S.settings.autoVault;
  $('#setIeltsDaily').value = S.settings.ieltsDaily;
  $('#syncToken').value = SYNC.token;
  $('#syncBase').value = SYNC.base || 'https://api.github.com';
  if (!SYNC.lanHost) { SYNC.lanHost = location.host; saveSync(); }   // 首次自动填本机/当前访问地址
  $('#syncLanHost').value = SYNC.lanHost;
  $('#syncKey').value = SYNC.key || '';
  $('#syncMode').value = SYNC.mode === 'gist' ? 'gist' : 'lan';
  updateSyncUI();
  setTimeout(() => TTS.renderVoiceSel(), 400);
  renderHome(); renderLesList(); renderDec(); newRound();
  if (!LESSONS.length) return;
  openLesson(LESSONS[0].id);
  bumpStreak();
  if (SYNC.enabled && SYNC.token) setTimeout(() => syncNow(false).then(updateSyncUI), 1200);
}
boot();
window.__F7 = { S, ALL, MAP, LESSONS, TTS };
})();
