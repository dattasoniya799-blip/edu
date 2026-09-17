/*
 * LectureScene · 播放器
 * 节拍(2026-09-05 按用户讲题习惯定稿):
 *   审题 —— 开场是一页 PPT 式审题页(全静默,无语音无计时,学生自读):题干(三色高亮:
 *          红=限制词 / 蓝=数据 / 绿=隐含条件来源)+ 题图 + 已知 / 隐含条件 / 求什么 / 思路切入
 *          四块(对应一线「三色笔法 + 黄金四步」);读完手动点「开始讲解」。
 *   讲解 —— 一步步连续上课:步内 say/do/fx 交错,步间自动连播(advance:'manual' 可改每步停);
 *          全程不开放拖拽;左上「题目」标签随时可点:自动暂停并整页切回审题页,「返回讲解」继续。
 *   总结 —— 最后一步讲完,全页 PPT 式总结页(四色块:知识点/易错/技巧/举一反三)逐条念+浮现;念完进动手环节。
 *   动手 —— explore:亮手柄 + 探索任务条 + 恢复标准参数;「📋 总结」可回看。
 *
 * 状态机:idle(审题页) → playing ⇄ paused → (waiting) → … → summary → explore
 */
(function (global) {
  'use strict';
  var LS = (global.LectureScene = global.LectureScene || {});
  var Clock = LS.Clock;

  function h(tag, cls, parent, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    if (parent) parent.appendChild(n);
    return n;
  }

  function Player(root, script, options) {
    options = options || {};
    this.root = root;
    this.script = script;
    this.options = options;
    this.tpl = LS.templates[script.template];
    if (!this.tpl) throw new Error('未知模板:' + script.template);
    this.stepIndex = -1;
    this.state = 'idle';
    this.tts = LS.tts.create(script.tts === false || options.tts === false ? 'silent' : 'browser', script.audio);
    this.tts.rate = script.ttsRate || 1;
    this._speech = null;
    this._stepToken = 0;
    this._pausedFrom = 'playing';
    this._reviewResume = false;
    this.listeners = {};
    this._buildUI();
    this.scene = this.tpl.mount(this.stage, this._canonicalParams(0), { player: this });
    this.scene.setUnlocked([]);
    this._renderDots();
    // 开场即审题页(题目全貌 + 审题板),全静默
    if (script.problem) this._showAnalysisPage(false);
    this._setSubtitle(script.problem ? '自己把题读一遍,读完点「开始讲解」。' : (script.title || ''), 1);
    this._updateControls();
  }

  // ---------------- 事件 ----------------
  Player.prototype.on = function (evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); return this; };
  Player.prototype._emit = function (evt, payload) { (this.listeners[evt] || []).forEach(function (fn) { fn(payload); }); };

  // ---------------- UI ----------------
  Player.prototype._buildUI = function () {
    var self = this;
    var root = this.root;
    root.classList.add('ls-player');
    root.innerHTML = '';
    var head = h('div', 'ls-head', root);
    h('div', 'ls-title', head, this.script.title || '讲解');
    this.stepLabel = h('div', 'ls-step-label', head, '');
    this.dots = h('div', 'ls-dots', head);
    this.stage = h('div', 'ls-stage', root);
    // 审题页(整页,开场显示;讲解中点「题目」标签整页回看)
    this.analysisPage = h('div', 'ls-analysis-page', this.stage);
    this.analysisPage.style.display = 'none';
    // 题目标签(讲解开始后常驻左上角)
    this.problemPill = h('button', 'ls-problem-pill', this.stage, '题目 ▾');
    this.problemPill.type = 'button';
    this.problemPill.style.display = 'none';
    this.problemPill.addEventListener('click', function () { self._onPillClick(); });
    // 总结页(整页,与审题页同版式;讲完逐条念+浮现,动手环节可整页回看)
    this.summaryPage = h('div', 'ls-summary-page', this.stage);
    this.summaryPage.style.display = 'none';
    this.hintBar = h('div', 'ls-hint', root, '');
    this.tasksBox = h('div', 'ls-tasks', root);
    this.tasksBox.style.display = 'none';
    var sub = h('div', 'ls-subtitle', root);
    this.subtitleText = h('div', 'ls-subtitle-text', sub, '');
    this.progress = h('div', 'ls-progress', sub);
    this.progressFill = h('div', 'ls-progress-fill', this.progress);
    var ctl = h('div', 'ls-controls', root);
    this.btnPrev = this._button(ctl, '上一步', 'prev');
    this.btnPlay = this._button(ctl, '▶ 开始讲解', 'play');
    this.btnReplay = this._button(ctl, '重听本步', 'replay');
    this.btnNext = this._button(ctl, '继续 →', 'next');
    var right = h('div', 'ls-controls-right', ctl);
    this.btnTakeaways = this._button(right, '📋 总结', 'takeaways');
    this.btnTts = this._button(right, this.tts.available ? '🔊 语音开' : '🔇 仅字幕', 'tts');
    this.btnReset = this._button(right, '↺ 恢复标准参数', 'reset');
  };
  Player.prototype._button = function (parent, label, action) {
    var b = h('button', 'ls-btn ls-btn-' + action, parent, label);
    b.type = 'button';
    var self = this;
    b.addEventListener('click', function () { self._onAction(action); });
    return b;
  };
  Player.prototype._renderDots = function () {
    var self = this;
    this.dots.innerHTML = '';
    this.script.steps.forEach(function (st, i) {
      var d = h('button', 'ls-dot', self.dots, String(i + 1));
      d.type = 'button';
      d.title = st.title || '';
      d.addEventListener('click', function () { self.goto(i); });
    });
    this._updateDots();
  };
  Player.prototype._updateDots = function () {
    var self = this;
    var terminal = this.state === 'explore' || this.state === 'summary';
    Array.prototype.forEach.call(this.dots.children, function (d, i) {
      d.classList.toggle('is-current', i === self.stepIndex && !terminal && self.state !== 'idle');
      d.classList.toggle('is-done', (i < self.stepIndex && self.state !== 'idle') || terminal);
    });
    var st = this.script.steps[this.stepIndex];
    this.stepLabel.textContent =
      this.state === 'idle' ? '审题 · 已知 · 求什么 · 思路'
      : this.state === 'summary' ? '总结 · 知识点 · 考点 · 技巧 · 举一反三'
      : this.state === 'explore' ? '动手环节 · 拖一拖,验证刚才的结论'
      : st ? '第 ' + (this.stepIndex + 1) + ' / ' + this.script.steps.length + ' 步 · ' + (st.title || '') : '';
  };
  Player.prototype._setSubtitle = function (text, progress) {
    this.subtitleText.textContent = text || '';
    this.progressFill.style.width = Math.round((progress || 0) * 100) + '%';
  };
  Player.prototype._setHint = function (text, tone) {
    this.hintBar.textContent = text || '';
    this.hintBar.className = 'ls-hint' + (text ? ' is-visible' : '') + (tone ? ' is-' + tone : '');
  };
  Player.prototype._updateControls = function () {
    var s = this.state, i = this.stepIndex, n = this.script.steps.length;
    this.btnPrev.disabled = i <= 0 || s === 'idle';
    this.btnReplay.disabled = i < 0 || s === 'idle' || s === 'summary';
    this.btnNext.disabled = s === 'idle' || s === 'explore';
    this.btnPlay.textContent =
      s === 'idle' ? '▶ 开始讲解'
      : s === 'playing' || s === 'summary' ? '⏸ 暂停'
      : s === 'paused' ? '▶ 继续播放'
      : s === 'waiting' ? '▶ 继续'
      : '↻ 从头再看';
    this.btnNext.textContent =
      s === 'summary' ? '进入动手环节 →'
      : i >= n - 1 ? '进入总结 →'
      : '继续 →';
    this.btnReset.disabled = s !== 'explore';
    var hasTakeaways = this._hasTakeaways();
    this.btnTakeaways.style.display = hasTakeaways ? '' : 'none';
    this.btnTakeaways.disabled = s !== 'explore';
    this.root.setAttribute('data-state', s);
  };
  Player.prototype._setState = function (s) {
    this.state = s;
    this._updateControls();
    this._updateDots();
    this._emit('state', { state: s, step: this.stepIndex });
  };
  Player.prototype._hasTakeaways = function () {
    var t = this.script.takeaways || {};
    return Boolean((t.knowledge && t.knowledge.length) || (t.keyPoints && t.keyPoints.length) || (t.methods && t.methods.length) || (t.variants && t.variants.length));
  };

  // ---------------- 审题页 ----------------
  /** 题干高亮:按 analysis.marks(三色笔法)把命中的词包成着色片段 */
  Player.prototype._highlightInto = function (parent, text) {
    var marks = (this.script.analysis && this.script.analysis.marks) || [];
    var valid = marks.filter(function (m) { return m && m.text && ['red', 'blue', 'green'].indexOf(m.color) >= 0; });
    var rest = text;
    while (rest.length) {
      var best = null;
      for (var i = 0; i < valid.length; i++) {
        var idx = rest.indexOf(valid[i].text);
        if (idx < 0) continue;
        if (!best || idx < best.idx || (idx === best.idx && valid[i].text.length > best.m.text.length)) best = { idx: idx, m: valid[i] };
      }
      if (!best) { parent.appendChild(document.createTextNode(rest)); break; }
      if (best.idx > 0) parent.appendChild(document.createTextNode(rest.slice(0, best.idx)));
      h('span', 'ls-mark-' + best.m.color, parent, best.m.text);
      rest = rest.slice(best.idx + best.m.text.length);
    }
  };
  /** 构建审题页;review=讲解中回看(带「返回讲解」按钮) */
  Player.prototype._buildAnalysisPage = function (review) {
    var self = this;
    var page = this.analysisPage;
    page.innerHTML = '';
    var head = h('div', 'ls-analysis-head', page);
    h('span', 'ls-analysis-eyebrow', head, '审题');
    var legend = h('span', 'ls-analysis-legend', head);
    h('span', 'ls-mark-red', legend, '限制条件');
    h('span', 'ls-mark-blue', legend, '数据');
    h('span', 'ls-mark-green', legend, '隐含线索');
    var body = h('div', 'ls-analysis-body', page);
    var stem = h('div', 'ls-analysis-stem', body);
    var text = this.script.problem || this.script.title || '';
    // 分行:(1)(2) 处断行;①② 只在句末标点后断(句中引用「① 的条件下」不切)
    var parts = text
      .split(/(?=\(\d\))/)
      .reduce(function (acc, seg) { return acc.concat(seg.split(/(?<=[。;;!?])\s*(?=[①②③④⑤])/)); }, [])
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    (parts.length ? parts : [text]).forEach(function (line, i) {
      var div = h('div', 'ls-problem-line' + (i === 0 ? ' is-stem' : ''), stem);
      self._highlightInto(div, line);
    });
    var images = this.script.problemImages || [];
    if (images.length) {
      var figs = h('div', 'ls-analysis-figs', body);
      images.forEach(function (src) {
        var img = document.createElement('img');
        img.className = 'ls-analysis-fig';
        img.src = src;
        figs.appendChild(img);
      });
    }
    var a = this.script.analysis || {};
    var blocks = [
      { title: '已知', items: a.given || [], cls: 'given' },
      { title: '隐含条件', items: a.hidden || [], cls: 'hidden' },
      { title: '求什么', items: a.find || [], cls: 'find' },
      { title: '思路切入', items: a.ideas || [], cls: 'ideas' }
    ].filter(function (b) { return b.items.length; });
    if (blocks.length) {
      var grid = h('div', 'ls-analysis-grid', page);
      blocks.forEach(function (b) {
        var box = h('div', 'ls-analysis-block is-' + b.cls, grid);
        h('div', 'ls-analysis-block-title', box, b.title);
        b.items.forEach(function (item) {
          var li = h('div', 'ls-analysis-item', box);
          h('span', 'ls-analysis-item-mark', li, '·');
          h('span', null, li, item);
        });
      });
    }
    if (review) {
      var back = h('button', 'ls-btn ls-btn-primary ls-analysis-return', page, '▶ 返回讲解');
      back.type = 'button';
      back.addEventListener('click', function () { self._closeAnalysisReview(); });
    }
  };
  Player.prototype._showAnalysisPage = function (review) {
    this._buildAnalysisPage(review);
    this.analysisPage.style.display = 'block';
  };
  /** 讲解中点「题目」标签:自动暂停 + 整页审题页;「返回讲解」恢复 */
  Player.prototype._onPillClick = function () {
    if (this.analysisPage.style.display !== 'none') { this._closeAnalysisReview(); return; }
    this._reviewResume = false;
    if (this.state === 'playing' || this.state === 'summary') {
      this.pause();
      this._reviewResume = true;
    }
    this._showAnalysisPage(true);
  };
  Player.prototype._closeAnalysisReview = function () {
    this.analysisPage.style.display = 'none';
    if (this._reviewResume && this.state === 'paused') this.resume();
    this._reviewResume = false;
  };
  Player.prototype._showPill = function () {
    if (this.script.problem) this.problemPill.style.display = '';
  };

  // ---------------- 参数 ----------------
  /** 第 i 步的标准参数 = 剧本 params 叠加该步 params;i < 0 时为纯标准参数(动手环节用) */
  Player.prototype._canonicalParams = function (i) {
    var base = Object.assign({}, this.tpl.defaults(), this.script.params || {});
    var st = i >= 0 ? this.script.steps[i] : null;
    if (st && st.params) Object.assign(base, st.params);
    return base;
  };

  /** 动手环节配置:explore 字段缺省时,由各步 unlock 并集兜底;并集为空 → 开放全部 */
  Player.prototype._exploreConfig = function () {
    var ex = this.script.explore || {};
    var unlock = Array.isArray(ex.unlock) ? ex.unlock.slice() : [];
    if (!unlock.length) {
      var union = [];
      this.script.steps.forEach(function (st) {
        (st.unlock || []).forEach(function (u) { if (union.indexOf(u) < 0) union.push(u); });
      });
      unlock = union;
    }
    if (!unlock.length) unlock = Object.keys(this.tpl.params || {});
    return {
      unlock: unlock,
      tasks: Array.isArray(ex.tasks) ? ex.tasks.filter(Boolean) : [],
      hint: ex.hint || '到你动手了:拖动画面上亮起的手柄,验证刚才讲的结论。'
    };
  };

  // ---------------- 控制 ----------------
  Player.prototype._onAction = function (action) {
    switch (action) {
      case 'play':
        if (this.state === 'idle') return this.goto(0);
        if (this.state === 'playing' || this.state === 'summary') return this.pause();
        if (this.state === 'paused') return this.resume();
        if (this.state === 'waiting') return this._advance();
        if (this.state === 'explore') return this.goto(0);
        break;
      case 'replay': return this.goto(this.stepIndex);
      case 'next':
        if (this.state === 'summary') { this._abortCurrent(); this._enterExplore(); return; }
        if (this.state === 'playing' || this.state === 'paused' || this.state === 'waiting') return this._advance();
        break;
      case 'prev': return this.goto(Math.max(0, this.stepIndex - 1));
      case 'takeaways':
        if (this.state === 'explore') this._toggleTakeawaysCard();
        break;
      case 'tts':
        this.tts.stop();
        this.tts = LS.tts.create(this.tts instanceof LS.tts.SilentProvider ? 'browser' : 'silent', this.script.audio);
        this.tts.rate = this.script.ttsRate || 1;
        this.btnTts.textContent = this.tts.available ? '🔊 语音开' : '🔇 仅字幕';
        break;
      case 'reset':
        this.scene.setParams(this._canonicalParams(-1));
        break;
    }
  };

  /** 进下一步;已是最后一步则进总结 */
  Player.prototype._advance = function () {
    if (this.stepIndex >= this.script.steps.length - 1) return this._startSummary();
    return this.goto(this.stepIndex + 1);
  };

  Player.prototype.pause = function () {
    if (this.state !== 'playing' && this.state !== 'summary') return;
    this._pausedFrom = this.state;
    Clock.pause();
    this.tts.pause();
    this._setState('paused');
  };
  Player.prototype.resume = function () {
    if (this.state !== 'paused') return;
    Clock.resume();
    this.tts.resume();
    this._setState(this._pausedFrom || 'playing');
  };

  Player.prototype._abortCurrent = function () {
    this._stepToken++;
    if (this._speech) { this._speech.cancel(); this._speech = null; }
    LS.cancelAllTweens();
    if (Clock.isPaused()) Clock.resume();
    this._reviewResume = false;
    this.tasksBox.style.display = 'none';
    this.analysisPage.style.display = 'none';
    this.summaryPage.style.display = 'none';
    if (LS.effects && this.scene) LS.effects.clear(this.scene); // 残留的 focus/label 效果一并清场
  };

  /** 跳到第 i 步并播放(点编号/上一步/重听都走这里) */
  Player.prototype.goto = function (i) {
    var st = this.script.steps[i];
    if (!st) return;
    this._playStep(i);
  };

  Player.prototype._playStep = function (i) {
    var self = this;
    var st = this.script.steps[i];
    if (!st) return;
    this._abortCurrent();
    this._showPill();
    var token = this._stepToken;
    this.stepIndex = i;
    this._updateDots();
    this._setHint('');
    this.scene.setUnlocked([]);
    this.scene.setParams(this._canonicalParams(i));
    this._fastForward(i);
    if (typeof this.scene.beginStep === 'function') this.scene.beginStep(st, i);
    this._setState('playing');
    this._emit('step', { index: i, step: st });
    this._setSubtitle('', 0);

    var run = (st.flow && st.flow.length)
      ? this._runFlow(st, token)
      : this._runLegacy(st, token);

    run.then(function () {
      if (token !== self._stepToken) return;
      self._speech = null;
      self.progressFill.style.width = '100%';
      return LS.wait(st.dwellMs == null ? 1200 : st.dwellMs);
    }).then(function () {
      if (token !== self._stepToken) return;
      if (i >= self.script.steps.length - 1) return self._startSummary();
      if (self.script.advance === 'manual') {
        self._setHint('这一步讲完了,点「继续」进入下一步。', 'info');
        self._setState('waiting');
        return;
      }
      self._advance();
    });
  };

  /** 执行一个动作:模板声明支持的交给模板,通用效果(label/focus/pulse)走运行时 */
  Player.prototype._runAction = function (act, st) {
    var supported = (this.tpl.actions || []).indexOf(act.type) >= 0;
    if (!supported && LS.effects && LS.effects.types.indexOf(act.type) >= 0) {
      return LS.effects.apply(this.scene, act);
    }
    return this.scene.applyAction(act, { player: this, step: st });
  };

  /** 新形态:flow 交错。say 定界;do 挡进度;fx 不挡(与后续 say 并行) */
  Player.prototype._runFlow = function (st, token) {
    var self = this;
    var items = st.flow.slice();
    var fullText = items.map(function (it) { return it.say || ''; }).filter(Boolean).join('');
    var spoken = 0;
    return items.reduce(function (p, it, idx0) {
      return p.then(function () {
        if (token !== self._stepToken) return;
        if (it.say) {
          var text = String(it.say);
          self._setSubtitle(text, fullText ? spoken / fullText.length : 0);
          var speech = self.tts.speak(text, {
            key: 'steps.' + st.id + '.flow.' + idx0, // 预渲染音频路径键(与 tts/prerender.ts collectUtterances 一致)
            onBoundary: function (idx) {
              if (token !== self._stepToken) return;
              var done = spoken + Math.min(idx, text.length);
              self.progressFill.style.width = Math.round((done / Math.max(1, fullText.length)) * 100) + '%';
            }
          });
          self._speech = speech;
          return speech.done.then(function () { spoken += text.length; });
        }
        if (it.do) return self._runAction(it.do, st);
        if (it.fx) {
          var fx = self._runAction(it.fx, st);
          if (fx && fx.catch) fx.catch(function () {});
          return; // 不等
        }
      });
    }, Promise.resolve());
  };

  /** 旧形态:整段讲解词 ∥ 动作链(兼容存量剧本) */
  Player.prototype._runLegacy = function (st, token) {
    var self = this;
    var narration = st.narration || '';
    this._setSubtitle(narration, 0);
    var speech = this.tts.speak(narration, {
      key: 'steps.' + st.id + '.narration',
      onBoundary: function (idx) {
        if (token !== self._stepToken) return;
        self.progressFill.style.width = Math.round((idx / Math.max(1, narration.length)) * 100) + '%';
      }
    });
    this._speech = speech;
    var actions = (st.actions || []).slice();
    var runActions = actions.reduce(function (p, act) {
      return p.then(function () {
        if (token !== self._stepToken) return;
        return self._runAction(act, st);
      });
    }, Promise.resolve());
    return Promise.all([speech.done, runActions]);
  };

  Player.prototype._fastForward = function (upto) {
    var self = this;
    var SKIP = { run: 1, highlight: 1, reset: 1, label: 1, focus: 1, pulse: 1 };
    for (var k = 0; k < upto; k++) {
      var prev = this.script.steps[k];
      var acts = (prev.actions || []).slice();
      (prev.flow || []).forEach(function (it) { if (it.do) acts.push(it.do); });
      acts.forEach(function (act) {
        if (SKIP[act.type]) return;
        var instant = Object.assign({}, act, { durationMs: 0 });
        if (act.type === 'move') { instant.from = act.to; }
        try { self._runAction(instant, prev); } catch (e) {}
      });
    }
    this.scene.setParams(this._canonicalParams(upto));
  };

  // ---------------- 总结 ----------------
  /** 条目文本里的【重点词】渲染为该组重点色;返回念的纯文本 */
  function fillAccented(parent, text) {
    var rest = String(text);
    for (;;) {
      var a = rest.indexOf('【');
      var b = a >= 0 ? rest.indexOf('】', a + 1) : -1;
      if (a < 0 || b < 0) { if (rest) parent.appendChild(document.createTextNode(rest)); break; }
      if (a > 0) parent.appendChild(document.createTextNode(rest.slice(0, a)));
      h('span', 'ls-sum-accent', parent, rest.slice(a + 1, b));
      rest = rest.slice(b + 1);
    }
    return String(text).replace(/[【】]/g, '');
  }

  /**
   * 构建全页总结页(板书规范:四色块分区、红色专用于易错警示、条目内重点词标色)。
   * review=动手环节回看(全部显示 + 「返回」按钮);否则条目初始隐藏,逐条念+浮现。
   */
  Player.prototype._buildSummaryPage = function (review) {
    var self = this;
    var page = this.summaryPage;
    page.innerHTML = '';
    var head = h('div', 'ls-analysis-head', page);
    h('span', 'ls-analysis-eyebrow', head, '总结 · 这道题带走什么');
    var t = this.script.takeaways || {};
    var groups = [
      { key: 'knowledge', icon: '📘', title: '核心知识点', items: t.knowledge || [], cls: 'knowledge' },
      { key: 'keyPoints', icon: '⚠️', title: '考点与易错', items: t.keyPoints || [], cls: 'keypoints' },
      { key: 'methods', icon: '💡', title: '方法与技巧', items: t.methods || [], cls: 'methods' },
      { key: 'variants', icon: '🔁', title: '举一反三', items: t.variants || [], cls: 'variants' }
    ].filter(function (gr) { return gr.items.length; });
    var grid = h('div', 'ls-summary-grid', page);
    var units = [];
    groups.forEach(function (gr) {
      var box = h('div', 'ls-summary-block is-' + gr.cls, grid);
      var title = h('div', 'ls-summary-block-title', box);
      h('span', 'ls-summary-icon', title, gr.icon);
      h('span', null, title, gr.title);
      if (!review) { title.style.opacity = '0'; box.style.opacity = '0'; } // 整块随本组第一条浮现,不留空框
      gr.items.forEach(function (item, idx) {
        var li = h('div', 'ls-summary-item', box);
        h('span', 'ls-summary-item-mark', li, idx + 1 + '.');
        var span = h('span', 'ls-summary-item-text', li);
        var speakText = fillAccented(span, item);
        if (!review) li.style.opacity = '0';
        units.push({ el: li, boxEl: box, text: speakText, group: gr.title, groupKey: gr.key, index: idx, titleEl: idx === 0 ? title : null });
      });
    });
    if (review) {
      var back = h('button', 'ls-btn ls-btn-primary ls-summary-return', page, '返回');
      back.type = 'button';
      back.addEventListener('click', function () { self.summaryPage.style.display = 'none'; });
    }
    return units;
  };
  Player.prototype._startSummary = function () {
    var self = this;
    if (!this._hasTakeaways()) return this._enterExplore();
    this._abortCurrent();
    var token = this._stepToken;
    this.stepIndex = this.script.steps.length - 1;
    // 场景推到讲完的样子(总结页收起后就是动手环节)
    this._fastForward(this.script.steps.length);
    this.scene.setParams(this._canonicalParams(-1));
    this._showPill();
    var units = this._buildSummaryPage(false);
    this.summaryPage.style.display = 'block';
    this._setState('summary');
    var lastGroup = null;
    var chain = units.reduce(function (p, u) {
      return p.then(function () {
        if (token !== self._stepToken) return;
        var text = (u.group !== lastGroup ? u.group + ':' : '') + u.text;
        lastGroup = u.group;
        self._setSubtitle(text, 0);
        var reveal = LS.tween({ duration: 320, onUpdate: function (t2) {
          u.el.style.opacity = String(t2);
          if (u.titleEl) { u.titleEl.style.opacity = String(t2); u.boxEl.style.opacity = String(t2); }
        } });
        var speech = self.tts.speak(text, {
          key: 'takeaways.' + u.groupKey + '.' + u.index,
          onBoundary: function (idx) {
            if (token !== self._stepToken) return;
            self.progressFill.style.width = Math.round((idx / Math.max(1, text.length)) * 100) + '%';
          }
        });
        self._speech = speech;
        return Promise.all([speech.done, reveal]);
      });
    }, Promise.resolve());
    chain.then(function () {
      if (token !== self._stepToken) return;
      self._speech = null;
      return LS.wait(1000);
    }).then(function () {
      if (token !== self._stepToken) return;
      self._enterExplore();
    });
  };
  /** 动手环节「📋 总结」:整页回看(全部显示,无语音) */
  Player.prototype._toggleTakeawaysCard = function () {
    if (this.summaryPage.style.display === 'none') {
      this._buildSummaryPage(true);
      this.summaryPage.style.display = 'block';
    } else {
      this.summaryPage.style.display = 'none';
    }
  };

  // ---------------- 动手环节 ----------------
  Player.prototype._enterExplore = function () {
    var self = this;
    this._abortCurrent();
    this.stepIndex = this.script.steps.length - 1;
    this._fastForward(this.script.steps.length);
    this.scene.setParams(this._canonicalParams(-1));
    this._showPill();
    var cfg = this._exploreConfig();
    this.scene.setUnlocked(cfg.unlock);
    this._setHint(cfg.hint, 'play');
    this._setSubtitle(this.script.summary || '讲解结束,现在自己动手试一试。', 1);
    this._renderTasks(cfg.tasks);
    this._setState('explore');
    this._emit('explore', { unlock: cfg.unlock, tasks: cfg.tasks });
  };

  Player.prototype._renderTasks = function (tasks) {
    var box = this.tasksBox;
    box.innerHTML = '';
    if (!tasks.length) { box.style.display = 'none'; return; }
    h('span', 'ls-tasks-title', box, '动手试试');
    tasks.forEach(function (t) {
      var item = h('button', 'ls-task', box);
      item.type = 'button';
      h('span', 'ls-task-mark', item, '○');
      h('span', 'ls-task-text', item, t);
      item.addEventListener('click', function () {
        var done = item.classList.toggle('is-done');
        item.querySelector('.ls-task-mark').textContent = done ? '✓' : '○';
      });
    });
    box.style.display = 'flex';
  };

  Player.prototype.destroy = function () {
    this._abortCurrent();
    this.tts.stop();
    this.scene.destroy && this.scene.destroy();
    this.root.innerHTML = '';
  };

  LS.Player = Player;
  /** 便捷入口:LectureScene.mount(rootEl, script, options) */
  LS.mount = function (root, script, options) { return new Player(root, script, options); };
})(window);
