/* E. 씹기 분석기
   입력: 매 프레임의 (시간, 턱 벌림, 턱 좌우 쏠림, 입술 벌어짐) — 모두 두 눈 사이 거리로 나눈 값
   출력: 씹은 횟수, 좌우, 한 입 묶음, 1분별 횟수, 점수 */
(function (root) {
  var CFG = {
    fastTau: 0.06,   // 떨림을 지우는 짧은 평균(초)
    slowTau: 1.2,    // 고개 움직임을 지우는 긴 평균(초)
    ampTau: 4,       // 최근 씹는 세기
    minAmp: 0.008,   // 이보다 작은 움직임은 씹기로 보지 않음
    minGap: 0.28,    // 씹기 사이 최소 간격(초)
    maxOpen: 1.2,    // 한 번 씹는 데 걸리는 최대 시간(초)
    biteGap: 2.0,    // 이만큼 쉬면 다음 한 입으로 봄(초)
    sideTh: 0.004,   // 좌우 판정 최소 쏠림
    lipOpen: 0.06    // 입을 벌리고 씹었다고 보는 입술 간격
  };

  function ChewAnalyzer() { this.reset(); }
  ChewAnalyzer.prototype.reset = function () {
    this.t0 = null; this.tLast = null; this.faceTime = 0;
    this.f = null; this.s = null; this.lf = null; this.ls = null; this.amp = 0.02; this.mn = 0; this.mx = 0; this.base = 0;
    this.open = false; this.tOpen = 0; this.latSum = 0; this.latN = 0; this.lipMax = 0;
    this.lastChew = -10;
    this.chews = 0; this.L = 0; this.R = 0; this.openChews = 0;
    this.bites = []; this.cur = 0; this.intervals = []; this.perMin = [];
    this.justChewed = false;
  };
  ChewAnalyzer.prototype.push = function (t, open, lat, lip) {
    this.justChewed = false;
    if (this.t0 === null) { this.t0 = t; this.tLast = t; this.f = this.s = open; this.lf = this.ls = lat; this.mn = open; return; }
    var dt = t - this.tLast; if (dt <= 0) return; this.tLast = t;
    if (dt > 1) { this.f = this.s = open; this.lf = this.ls = lat; this.open = false; this.mn = open; return; } // 얼굴을 놓쳤다가 다시 찾음
    this.faceTime += dt;
    var a = 1 - Math.exp(-dt / CFG.fastTau), b = 1 - Math.exp(-dt / CFG.slowTau);
    this.f += a * (open - this.f); this.s += b * (open - this.s);
    this.lf += a * (lat - this.lf); this.ls += b * (lat - this.ls);
    var f = this.f, y = this.lf - this.ls;
    // 골짜기에서 P만큼 올라갔다가 봉우리에서 P만큼 내려오면 한 번 씹은 것 (고개가 천천히 움직여도 영향이 적음)
    var P = Math.max(CFG.minAmp, 0.35 * this.amp);
    if (!this.open) {
      if (f < this.mn) this.mn = f;
      if (f - this.mn > P) { this.open = true; this.tOpen = t; this.mx = f; this.base = this.mn; this.latSum = 0; this.latN = 0; this.lipMax = 0; }
    } else {
      if (f > this.mx) this.mx = f;
      this.latSum += y; this.latN++; if (lip > this.lipMax) this.lipMax = lip;
      if (t - this.tOpen > CFG.maxOpen) { this.open = false; this.mn = f; }
      else if (this.mx - f > P) {
        this.open = false; this.mn = f;
        if (t - this.lastChew >= CFG.minGap) { this.amp += 0.2 * ((this.mx - this.base) - this.amp); this._chew(t); }
      }
    }
  };
  ChewAnalyzer.prototype._chew = function (t) {
    var gap = t - this.lastChew;
    if (gap > CFG.biteGap) { if (this.cur > 0) this.bites.push(this.cur); this.cur = 0; }
    else this.intervals.push(gap);
    this.cur++; this.chews++; this.lastChew = t; this.justChewed = true;
    var m = this.latN ? this.latSum / this.latN : 0;
    if (m > CFG.sideTh) this.L++; else if (m < -CFG.sideTh) this.R++;
    if (this.lipMax > CFG.lipOpen) this.openChews++;
    var i = Math.floor((t - this.t0) / 60);
    while (this.perMin.length <= i) this.perMin.push(0);
    this.perMin[i]++;
  };
  ChewAnalyzer.prototype.result = function (durSec) {
    var bites = this.bites.slice(); if (this.cur > 0) bites.push(this.cur);
    var real = bites.filter(function (n) { return n >= 3; });
    var avg = real.length ? real.reduce(function (p, q) { return p + q; }, 0) / real.length : 0;
    var iv = this.intervals.slice().sort(function (p, q) { return p - q; });
    var med = iv.length ? iv[Math.floor(iv.length / 2)] : 0;
    var dur = durSec != null ? durSec : (this.tLast - this.t0) || 0;
    var perMin = this.perMin.slice();
    var n = Math.max(1, Math.ceil(dur / 60)); while (perMin.length < n) perMin.push(0);
    return {
      durSec: Math.round(dur), chews: this.chews, L: this.L, R: this.R,
      bites: real.length, avgPerBite: Math.round(avg * 10) / 10,
      tempo: med ? Math.round(60 / med) : 0,            // 이어서 씹을 때 1분당 횟수
      openChews: this.openChews, perMin: perMin
    };
  };

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  /* 점수: 측정된 항목만으로 100점 환산 */
  function score(r) {
    var parts = [];
    if (r.bites > 0) parts.push({ key: 'bite', label: '한 입당 씹은 횟수', max: 35, pts: 35 * clamp01(r.avgPerBite / 25) });
    if (r.tempo > 0) parts.push({ key: 'tempo', label: '씹는 빠르기', max: 20, pts: 20 * clamp01((120 - r.tempo) / 40) });
    if (r.durSec >= 180) parts.push({ key: 'time', label: '식사 시간', max: 15, pts: 15 * clamp01(r.durSec / 900) });
    var sided = r.L + r.R;
    if (sided >= 10) parts.push({ key: 'side', label: '좌우 균형', max: 20, pts: 20 * (1 - clamp01((Math.abs(r.L - r.R) / sided) / 0.6)) });
    if (r.chews > 0) parts.push({ key: 'lip', label: '입 다물고 씹기', max: 10, pts: 10 * (1 - r.openChews / r.chews) });
    var mx = 0, pt = 0; parts.forEach(function (p) { mx += p.max; pt += p.pts; p.pts = Math.round(p.pts); });
    return { total: mx ? Math.round(pt / mx * 100) : 0, parts: parts };
  }

  root.ChewAnalyzer = ChewAnalyzer; root.chewScore = score; root.CHEW_CFG = CFG;
  if (typeof module !== 'undefined') module.exports = { ChewAnalyzer: ChewAnalyzer, chewScore: score };
})(typeof window !== 'undefined' ? window : globalThis);
