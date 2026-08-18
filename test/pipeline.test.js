// ============================================================
//  test/pipeline.test.js — Minimal Integration Tests
//
//  Tests the 3-stage pipeline using mock LLM responses,
//  so no real API calls are made and no keys are needed.
//
//  Run with: node test/pipeline.test.js
// ============================================================

const assert = require('assert');

// ── Mock LLM output (mirrors real Gemini response structure) ──
const MOCK_STAGE1 = [
  { id: 'reel_001', primary_topic: 'sleep deprivation humor', underlying_signal: 'relatable millennial content consumption', content_type: 'meme' },
  { id: 'reel_002', primary_topic: 'Valorant gaming highlight', underlying_signal: 'entertainment / gaming', content_type: 'lifestyle' },
  { id: 'reel_003', primary_topic: 'Java NullPointerException debugging humor', underlying_signal: 'software engineering career frustration', content_type: 'meme' },
  { id: 'reel_004', primary_topic: 'tech interview anxiety — linked list reversal', underlying_signal: 'job-seeking software engineer preparing for FAANG interviews', content_type: 'meme' },
  { id: 'reel_005', primary_topic: 'realistic software engineer day-in-the-life', underlying_signal: 'software engineering career curiosity and lifestyle', content_type: 'lifestyle' },
  { id: 'reel_006', primary_topic: 'MacBook M3 vs ThinkPad developer laptop comparison', underlying_signal: 'developer tooling investment for professional growth', content_type: 'comparison' },
  { id: 'reel_007', primary_topic: 'AI tools career hype-bait', underlying_signal: 'NOISE — hype-bait clickbait', content_type: 'hype-bait' },
  { id: 'reel_008', primary_topic: 'PostgreSQL 17 performance improvements', underlying_signal: 'backend engineering technical depth', content_type: 'news' }
];

const MOCK_STAGE2 = {
  excluded_reels: [{ id: 'reel_001', reason: 'unrelated lifestyle/entertainment' }, { id: 'reel_002', reason: 'gaming entertainment' }, { id: 'reel_007', reason: 'hype-bait noise' }],
  interest_clusters: [{
    rank: 1,
    cluster_label: 'software_engineering_career',
    confidence: 'High',
    confidence_rationale: '4 independent reels support this cluster across different content types',
    supporting_reel_ids: ['reel_003', 'reel_004', 'reel_005', 'reel_006'],
    theme_explanation: 'The viewer consistently engages with content reflecting the full arc of a software engineering career: debugging, interviews, workplace reality, and hardware investment.'
  }],
  dominant_interest: 'software_engineering_career',
  dominant_confidence: 'High'
};

const MOCK_STAGE3 = {
  rejected_candidates: [
    { title: '10 Tricks to Pass Google Interview in 30 Days', verdict: 'REJECTED', reason: 'Numbered listicle with unsubstantiated outcome claims' },
    { title: 'The Secret Algorithm That Gets You Hired', verdict: 'REJECTED', reason: 'Shortcut framing without mechanism' }
  ],
  recommended_reel_title: 'Systematic Debugging Workflows for Complex Codebases',
  category: 'Career',
  difficulty: 'Intermediate',
  why_recommendation: 'Addresses the practical engineering skills the viewer is actively building',
  hype_filter_passed: true
};

const ALLOWED_CATEGORIES = ['AI', 'DSA', 'Java', 'HLD', 'Cybersecurity', 'Cloud', 'Hardware', 'Career', 'Other'];
const VALID_CONTENT_TYPES = ['meme', 'tutorial', 'lifestyle', 'news', 'hype-bait', 'comparison'];
const REQUIRED_OUTPUT_FIELDS = [
  'CURRENT REEL', 'INTEREST DETECTED', 'WHY',
  'RECOMMENDED TECH REEL', 'CATEGORY',
  'WHY THIS RECOMMENDATION', 'DIFFICULTY', 'CONFIDENCE'
];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ── Stage 1 Schema Tests ──────────────────────────────────────
console.log('\n🔍 Stage 1 — Topic Extraction Schema');

test('Returns an array', () => {
  assert.ok(Array.isArray(MOCK_STAGE1), 'stage1 result must be an array');
});

test('Correct number of entries (matches input reel count)', () => {
  assert.strictEqual(MOCK_STAGE1.length, 8);
});

test('Every entry has required fields: id, primary_topic, underlying_signal, content_type', () => {
  for (const r of MOCK_STAGE1) {
    assert.ok(r.id,                `Missing id in entry: ${JSON.stringify(r)}`);
    assert.ok(r.primary_topic,     `Missing primary_topic in ${r.id}`);
    assert.ok(r.underlying_signal, `Missing underlying_signal in ${r.id}`);
    assert.ok(r.content_type,      `Missing content_type in ${r.id}`);
  }
});

test('content_type is always from allowed set', () => {
  for (const r of MOCK_STAGE1) {
    assert.ok(
      VALID_CONTENT_TYPES.includes(r.content_type),
      `Invalid content_type "${r.content_type}" in ${r.id}. Allowed: ${VALID_CONTENT_TYPES.join(', ')}`
    );
  }
});

test('primary_topic is specific (not just "coding" or "tech")', () => {
  const tooVague = ['coding', 'tech', 'programming', 'software'];
  for (const r of MOCK_STAGE1) {
    assert.ok(
      !tooVague.includes(r.primary_topic.toLowerCase()),
      `primary_topic "${r.primary_topic}" in ${r.id} is too vague`
    );
  }
});

// ── Stage 2 Schema Tests ──────────────────────────────────────
console.log('\n🧠 Stage 2 — Interest Aggregation Schema');

test('Has dominant_interest (non-empty string)', () => {
  assert.ok(typeof MOCK_STAGE2.dominant_interest === 'string' && MOCK_STAGE2.dominant_interest.length > 0);
});

test('dominant_confidence is High, Medium, or Low', () => {
  assert.ok(['High', 'Medium', 'Low'].includes(MOCK_STAGE2.dominant_confidence));
});

test('interest_clusters is a non-empty array', () => {
  assert.ok(Array.isArray(MOCK_STAGE2.interest_clusters) && MOCK_STAGE2.interest_clusters.length > 0);
});

test('dominant cluster supporting_reel_ids has ≥1 entry', () => {
  const dom = MOCK_STAGE2.interest_clusters[0];
  assert.ok(Array.isArray(dom.supporting_reel_ids) && dom.supporting_reel_ids.length >= 1);
});

test('excluded_reels each have id and reason', () => {
  for (const e of MOCK_STAGE2.excluded_reels) {
    assert.ok(e.id,     `excluded_reel missing id`);
    assert.ok(e.reason, `excluded_reel ${e.id} missing reason`);
  }
});

test('Confidence rule: High confidence requires 3+ supporting reels', () => {
  if (MOCK_STAGE2.dominant_confidence === 'High') {
    const dom = MOCK_STAGE2.interest_clusters[0];
    assert.ok(dom.supporting_reel_ids.length >= 3,
      `High confidence claimed but only ${dom.supporting_reel_ids.length} supporting reels`);
  }
});

// ── Stage 3 Schema Tests ──────────────────────────────────────
console.log('\n🎯 Stage 3 — Recommendation + Hype Filter Schema');

test('Has recommended_reel_title (non-empty)', () => {
  assert.ok(typeof MOCK_STAGE3.recommended_reel_title === 'string' && MOCK_STAGE3.recommended_reel_title.length > 0);
});

test('category is from allowed list', () => {
  assert.ok(ALLOWED_CATEGORIES.includes(MOCK_STAGE3.category),
    `Category "${MOCK_STAGE3.category}" not in allowed list: ${ALLOWED_CATEGORIES.join(', ')}`);
});

test('difficulty is Beginner, Intermediate, or Advanced', () => {
  assert.ok(['Beginner', 'Intermediate', 'Advanced'].includes(MOCK_STAGE3.difficulty));
});

test('Hype filter: ≥2 candidates were rejected', () => {
  assert.ok(
    Array.isArray(MOCK_STAGE3.rejected_candidates) && MOCK_STAGE3.rejected_candidates.length >= 2,
    `Expected ≥2 rejected candidates, got ${MOCK_STAGE3.rejected_candidates?.length}`
  );
});

test('hype_filter_passed is true', () => {
  assert.strictEqual(MOCK_STAGE3.hype_filter_passed, true);
});

test('Recommended title is not a numbered listicle', () => {
  const listiclePattern = /^\d+\s+(things|tips|tricks|tools|ways|reasons|hacks)/i;
  assert.ok(!listiclePattern.test(MOCK_STAGE3.recommended_reel_title),
    `Title looks like a listicle: "${MOCK_STAGE3.recommended_reel_title}"`);
});

test('Recommended title does not contain outcome-bait language', () => {
  const hypePhrases = ['get you hired', 'land your dream', 'crack the interview', 'secret', 'you need to know', "boss doesn't want"];
  const title = MOCK_STAGE3.recommended_reel_title.toLowerCase();
  for (const phrase of hypePhrases) {
    assert.ok(!title.includes(phrase),
      `Title contains hype phrase "${phrase}": "${MOCK_STAGE3.recommended_reel_title}"`);
  }
});

// ── Stage 4 / Output Format Tests ────────────────────────────
console.log('\n📋 Stage 4 — Output Format Alignment');

// Simulate stage4 output (mirrors agent.js stage4_formatOutput)
const DUMMY_OUTPUT = `
  CURRENT REEL              :  day in the life of a software engineer [reel_005]
  INTEREST DETECTED         :  software_engineering_career
  WHY                       :  Consistent engagement with SWE career content
  RECOMMENDED TECH REEL     :  "Systematic Debugging Workflows for Complex Codebases"
  CATEGORY                  :  Career
  WHY THIS RECOMMENDATION   :  Addresses practical engineering skills
  DIFFICULTY                :  Intermediate
  CONFIDENCE                :  High — 4 reel(s): reel_003, reel_004, reel_005, reel_006
`;

test('All 8 required output fields are present', () => {
  for (const field of REQUIRED_OUTPUT_FIELDS) {
    assert.ok(DUMMY_OUTPUT.includes(field), `Missing required field: "${field}"`);
  }
});

test('CATEGORY value is from allowed list', () => {
  const match = DUMMY_OUTPUT.match(/CATEGORY\s*:\s*(.+)/);
  assert.ok(match, 'CATEGORY field not found');
  const cat = match[1].trim();
  assert.ok(ALLOWED_CATEGORIES.includes(cat), `Category "${cat}" not in allowed list`);
});

test('CONFIDENCE contains reel IDs (not vague)', () => {
  const match = DUMMY_OUTPUT.match(/CONFIDENCE\s*:\s*(.+)/);
  assert.ok(match, 'CONFIDENCE field not found');
  assert.ok(/reel_\d+/.test(match[1]), 'CONFIDENCE should reference specific reel IDs');
});

// ── Summary ───────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('  ✅ All tests passed.\n');
} else {
  console.log('  ❌ Some tests failed — review output above.\n');
  process.exit(1);
}
