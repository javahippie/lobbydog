/**
 * Aho-Corasick multi-pattern string matching automaton.
 * Finds all occurrences of any pattern in O(n + m + z) time
 * where n = text length, m = total pattern length, z = number of matches.
 */
class AhoCorasick {
  constructor() {
    this.goto = [{}];
    this.fail = [0];
    this.output = [[]];
    this.built = false;
  }

  addPattern(pattern) {
    if (this.built) throw new Error('Cannot add patterns after build');
    let state = 0;
    for (const ch of pattern) {
      if (!this.goto[state][ch]) {
        const next = this.goto.length;
        this.goto.push({});
        this.fail.push(0);
        this.output.push([]);
        this.goto[state][ch] = next;
      }
      state = this.goto[state][ch];
    }
    this.output[state].push(pattern);
  }

  build() {
    const queue = [];
    // Initialize fail links for depth-1 states
    for (const ch in this.goto[0]) {
      const s = this.goto[0][ch];
      this.fail[s] = 0;
      queue.push(s);
    }
    // BFS to build fail links
    while (queue.length > 0) {
      const r = queue.shift();
      for (const ch in this.goto[r]) {
        const s = this.goto[r][ch];
        queue.push(s);
        let state = this.fail[r];
        while (state !== 0 && !this.goto[state][ch]) {
          state = this.fail[state];
        }
        this.fail[s] = this.goto[state][ch] || 0;
        if (this.fail[s] === s) this.fail[s] = 0;
        this.output[s] = this.output[s].concat(this.output[this.fail[s]]);
      }
    }
    this.built = true;
  }

  search(text) {
    if (!this.built) this.build();
    const results = [];
    let state = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      while (state !== 0 && !this.goto[state][ch]) {
        state = this.fail[state];
      }
      state = this.goto[state][ch] || 0;
      for (const pattern of this.output[state]) {
        results.push({
          name: pattern,
          start: i - pattern.length + 1,
          end: i + 1
        });
      }
    }
    return results;
  }
}

// Export for both module and content script contexts
if (typeof globalThis !== 'undefined') {
  globalThis.AhoCorasick = AhoCorasick;
}
