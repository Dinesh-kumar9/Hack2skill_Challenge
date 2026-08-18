// ============================================================
//  Reel Intelligence Agent — Hack2Skill Challenge
//  AI-powered tech interest inference + recommendation pipeline
//
//  Pipeline: Stage 1 → Stage 2 → Stage 3 → Stage 4
//    1. Per-reel topic extraction      (LLM, 1 batched call for ALL reels)
//    2. Cross-reel interest aggregation (LLM, 1 call)
//    3. Recommendation + hype filter   (LLM, 1 call)
//    4. Structured output formatting   (pure JS)
//
//  Total API calls per run: exactly 3 (one per stage)
//
//  Key rotation: on 429/quota, switches to next key immediately.
//  Set GEMINI_API_KEYS=key1,key2,key3 (comma-separated) in .env
//
//  Usage:
//    node agent.js                    ← runs on reels_data.json
//    node agent.js path/to/reels.json ← runs on custom input
// ============================================================

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs   = require('fs');
const path = require('path');

// ── Key Pool ──────────────────────────────────────────────────
// Reads GEMINI_API_KEYS (comma-separated) or falls back to GEMINI_API_KEY
const rawKeys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
  .split(',').map(k => k.trim()).filter(Boolean);

if (rawKeys.length === 0) {
  console.error(
    '\n❌  No API keys found.\n' +
    '    Set GEMINI_API_KEYS=key1,key2,key3 (or GEMINI_API_KEY=key) in .env\n' +
    '    Get a free key at: https://aistudio.google.com/app/apikey\n'
  );
  process.exit(1);
}

let currentKeyIndex = 0;

/** Returns the currently active API key. */
function getCurrentKey() { return rawKeys[currentKeyIndex]; }

/** Rotates to the next key in the pool and logs the switch. */
function rotateKey(label) {
  const prev = currentKeyIndex;
  currentKeyIndex = (currentKeyIndex + 1) % rawKeys.length;
  console.log(
    `\n    🔄  [${label}] Key ${prev + 1}/${rawKeys.length} hit quota — ` +
    `rotating to key ${currentKeyIndex + 1}/${rawKeys.length} ` +
    `[${getCurrentKey().slice(0, 12)}...]`
  );
}

/** Returns a fresh model instance bound to the current key. */
function getModel() {
  return new GoogleGenerativeAI(getCurrentKey())
    .getGenerativeModel({ model: 'gemini-3.6-flash' });
}

// Allowed recommendation categories (from architecture spec)
const ALLOWED_CATEGORIES = ['AI', 'DSA', 'Java', 'HLD', 'Cybersecurity', 'Cloud', 'Hardware', 'Career', 'Other'];

// ── LLM Helper ───────────────────────────────────────────────
/**
 * Calls Gemini and returns parsed JSON.
 *
 * Key-rotation strategy:
 *   - On 429 / quota error  → rotate to next key immediately, retry (no wait)
 *   - On 503 / service error → wait 8s on same key, then retry
 *   - Attempts: up to (keyCount * 2), so every key gets at least 2 tries
 *
 * @param {string} prompt - Full prompt string
 * @param {string} label  - Human-readable label for logging
 */
async function callLLM(prompt, label = 'LLM') {
  const maxAttempts = rawKeys.length > 1 ? rawKeys.length * 2 : 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`    🔑  [${label}] Using key ${currentKeyIndex + 1}/${rawKeys.length} [${getCurrentKey().slice(0, 12)}...]`);
    try {
      const result = await getModel().generateContent(prompt);
      const raw = result.response.text().trim();

      // Strip markdown fences if present
      const stripped = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      return JSON.parse(stripped);

    } catch (err) {
      const isQuota   = err.message.includes('429') || err.message.includes('quota') ||
                        err.message.includes('Too Many Requests') || err.message.includes('RESOURCE_EXHAUSTED');
      const isService = err.message.includes('503') || err.message.includes('Service Unavailable');

      if (isQuota) {
        if (rawKeys.length > 1) {
          rotateKey(label);
          continue; // retry immediately with new key — no wait
        } else {
          // Only 1 key — wait for quota window to reset (60s)
          const waitSec = 60;
          console.log(`    ⏳  [${label}] Single key quota — waiting ${waitSec}s for quota reset (attempt ${attempt}/${maxAttempts})...`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          continue;
        }
      }

      if (isService && attempt < maxAttempts) {
        console.log(`    ⏳  [${label}] Service error (503), waiting 8s...`);
        await new Promise(r => setTimeout(r, 8000));
        continue;
      }

      throw new Error(`[${label}] Failed after ${attempt} attempt(s): ${err.message}`);
    }
  }

  throw new Error(`[${label}] Exhausted all ${maxAttempts} attempts across ${rawKeys.length} key(s).`);
}

// ── Stage 1: Batched Topic Extraction ────────────────────────
/**
 * Sends ALL reels in a SINGLE LLM call and extracts per-reel:
 *   - primary_topic    : specific surface topic
 *   - underlying_signal: deeper viewer interest beyond surface
 *   - content_type     : meme | tutorial | lifestyle | news | hype-bait | comparison
 *
 * 1 API call total regardless of reel count.
 *
 * @param {Array} reelsData - Raw reel objects
 * @returns {Array}         - Array of enriched reel objects
 */
async function stage1_extractTopics(reelsData) {
  const reelsList = reelsData.map((r, i) =>
    `[${i + 1}] ID: ${r.id}\n` +
    `    Caption   : "${r.caption}"\n` +
    `    Transcript: "${r.transcript_snippet}"\n` +
    `    Hashtags  : ${r.hashtags.join(', ')}`
  ).join('\n\n');

  const prompt = `
You are analyzing ${reelsData.length} Instagram Reels for a recommendation system.
For EACH reel, extract three fields independently (do not compare reels to each other yet).

REELS:
${reelsList}

RULES for each reel:
- primary_topic   : specific surface topic — be precise (e.g. "Java NullPointerException debugging humor", not just "coding")
- underlying_signal: the DEEPER interest watching this reel reveals about the viewer — go beyond the literal topic.
  Ask: what does choosing to watch this hint at about the viewer's goals, identity, or curiosity?
  If hype-bait (FOMO language, numbered lists of "life-changing" tools, unsubstantiated outcome claims): flag it explicitly as noise.
- content_type    : exactly one of: meme | tutorial | lifestyle | news | hype-bait | comparison

Return ONLY a valid JSON array (same order as input, no markdown, no extra text):
[
  {
    "id": "<reel id>",
    "primary_topic": "<specific surface topic>",
    "underlying_signal": "<deeper viewer interest, not just a restatement of the surface topic>",
    "content_type": "<one of the allowed values>"
  }
]
`.trim();

  console.log(`    → Single batched call for all ${reelsData.length} reels...`);
  const result = await callLLM(prompt, 'Stage 1 – batch');

  // Normalise: ensure array and map ids back safely
  const arr = Array.isArray(result) ? result : Object.values(result);
  return arr.map((r, i) => ({
    id               : r.id || reelsData[i]?.id || `reel_${i}`,
    primary_topic    : r.primary_topic,
    underlying_signal: r.underlying_signal,
    content_type     : r.content_type
  }));
}

// ── Stage 2: Cross-Reel Interest Aggregation ─────────────────
/**
 * Analyzes ALL underlying signals together (1 API call) to find the
 * dominant interest cluster. Looks for shared theme across signals —
 * does NOT keyword-count.
 *
 * @param {Array} stage1Results - Enriched reel objects from Stage 1
 * @returns {Object}            - Dominant interest + ranked cluster list
 */
async function stage2_aggregateInterests(stage1Results) {
  const signalSummary = stage1Results.map(r =>
    `  [${r.id}] type: ${r.content_type}\n` +
    `          surface: ${r.primary_topic}\n` +
    `          signal : ${r.underlying_signal}`
  ).join('\n\n');

  const prompt = `
You are identifying a student's underlying tech interests by analyzing the signals across ALL their recent reels together.

EXTRACTED SIGNALS (Stage 1 output):
${signalSummary}

Return ONLY a valid JSON object (no markdown, no extra text):
{
  "excluded_reels": [
    { "id": "<reel_id>", "reason": "<why excluded from interest analysis>" }
  ],
  "interest_clusters": [
    {
      "rank": 1,
      "cluster_label": "<snake_case_label>",
      "confidence": "<High | Medium | Low>",
      "confidence_rationale": "<plain English — why this confidence level>",
      "supporting_reel_ids": ["<reel_id>"],
      "theme_explanation": "<plain English: what shared theme connects these reels — NOT a keyword list>"
    }
  ],
  "dominant_interest": "<cluster_label of rank 1>",
  "dominant_confidence": "<confidence of rank 1>"
}

STRICT RULES:
1. EXCLUDE hype-bait and pure entertainment noise — list them in excluded_reels
2. Find the SHARED THEME across underlying signals even when surface topics differ completely
   EXAMPLE: Java meme + interview joke + SWE lifestyle + laptop comparison = "software_engineering_career", NOT "java"
3. Confidence: 1 reel = Low, 2 reels = Medium, 3+ reels = High
4. Rank 1–3 clusters only. theme_explanation must explain WHY, not just list what the reels are
`.trim();

  return callLLM(prompt, 'Stage 2 – aggregation');
}

// ── Stage 3: Recommendation + Hype Filter ───────────────────
/**
 * Generates a single recommendation for the dominant interest cluster (1 API call).
 * Requires at least 2 candidates to be evaluated and rejected by the hype filter.
 *
 * @param {Object} stage2Results - Interest cluster output from Stage 2
 * @returns {Object}             - Recommendation with hype filter log
 */
async function stage3_recommend(stage2Results) {
  const dominantCluster = stage2Results.interest_clusters.find(
    c => c.cluster_label === stage2Results.dominant_interest
  ) || stage2Results.interest_clusters[0];

  const prompt = `
You are a recommendation engine generating a single educational tech Reel recommendation.

INFERRED STUDENT INTEREST:
  Cluster          : ${stage2Results.dominant_interest}
  Confidence       : ${stage2Results.dominant_confidence}
  Supporting reels : ${dominantCluster.supporting_reel_ids.join(', ')}
  Theme explanation: ${dominantCluster.theme_explanation}

ALLOWED CATEGORIES (pick exactly one): ${ALLOWED_CATEGORIES.join(', ')}

Return ONLY a valid JSON object (no markdown, no extra text):
{
  "rejected_candidates": [
    { "title": "<candidate title>", "verdict": "REJECTED", "reason": "<why it failed the hype filter>" }
  ],
  "recommended_reel_title": "<final accepted title>",
  "category": "<exactly one from the allowed list>",
  "difficulty": "<Beginner | Intermediate | Advanced>",
  "why_recommendation": "<plain English: why this content serves the inferred cluster — connect to the THEME, not any single reel>",
  "hype_filter_passed": true
}

STRICT RULES:
1. Match the BROADER cluster — not the surface topic of any one reel
2. Generate at least 2 candidate titles and REJECT before selecting. Reject if:
   - Numbered listicle ("10 things...", "5 tools...")
   - Unsubstantiated outcome claims ("will get you hired", "got me into Google")
   - Manufactured urgency / FOMO ("you NEED to know", "your boss doesn't want")
   - Shortcuts without mechanism ("the secret to...", "one trick...")
3. Difficulty: memes/lifestyle/humor → Beginner; mix with tutorials → Intermediate; deep technical → Advanced
4. Final title must: name a specific teachable concept, calm factual language, no exaggerated claims
`.trim();

  return callLLM(prompt, 'Stage 3 – recommendation');
}

// ── Stage 4: Structured Output Formatter ─────────────────────
/**
 * Formats pipeline outputs into the final display card. Pure JS — no LLM.
 */
function stage4_formatOutput(reelsData, stage1Results, stage2Results, stage3Results) {
  const dominantCluster = stage2Results.interest_clusters.find(
    c => c.cluster_label === stage2Results.dominant_interest
  ) || stage2Results.interest_clusters[0];

  const supportingIds = dominantCluster.supporting_reel_ids || [];

  // Pick most representative reel (prefer lifestyle/comparison as most descriptive)
  const preferredTypes = ['lifestyle', 'comparison', 'news', 'tutorial', 'meme'];
  let representativeReel = null;
  for (const type of preferredTypes) {
    const match = stage1Results.find(r => supportingIds.includes(r.id) && r.content_type === type);
    if (match) { representativeReel = match; break; }
  }
  if (!representativeReel && supportingIds.length > 0) {
    representativeReel = stage1Results.find(r => r.id === supportingIds[0]);
  }

  const rawReel = reelsData.find(r => r.id === representativeReel?.id);
  const currentReelDisplay = rawReel
    ? `${rawReel.caption.slice(0, 80)}${rawReel.caption.length > 80 ? '...' : ''} [${representativeReel.id}]`
    : 'See supporting reels: ' + supportingIds.join(', ');

  const excludedNote = stage2Results.excluded_reels?.length
    ? ` (${stage2Results.excluded_reels.length} reel(s) excluded: ${stage2Results.excluded_reels.map(e => e.id).join(', ')})`
    : '';
  const whyText        = `${dominantCluster.theme_explanation}${excludedNote}`;
  const confidenceText = `${stage2Results.dominant_confidence} — ${supportingIds.length} reel(s): ${supportingIds.join(', ')}. ${dominantCluster.confidence_rationale}`;
  const rejectedCount  = stage3Results.rejected_candidates?.length || 0;
  const rejectedTitles = stage3Results.rejected_candidates
    ?.map(c => `"${c.title}" (${c.reason})`).join('; ') || 'none logged';
  const whyRec = `${stage3Results.why_recommendation} [Hype filter: ${rejectedCount} rejected — ${rejectedTitles}]`;

  const SEP = '─'.repeat(72);
  const pad = l => l.padEnd(26);

  return [
    '', SEP,
    '  🎯  REEL INTELLIGENCE — RECOMMENDATION OUTPUT',
    SEP, '',
    `  ${pad('CURRENT REEL')}:  ${currentReelDisplay}`,
    `  ${pad('INTEREST DETECTED')}:  ${stage2Results.dominant_interest}`,
    `  ${pad('WHY')}:  ${wrap(whyText, 26)}`,
    `  ${pad('RECOMMENDED TECH REEL')}:  "${stage3Results.recommended_reel_title}"`,
    `  ${pad('CATEGORY')}:  ${stage3Results.category}`,
    `  ${pad('WHY THIS RECOMMENDATION')}:  ${wrap(whyRec, 26)}`,
    `  ${pad('DIFFICULTY')}:  ${stage3Results.difficulty}`,
    `  ${pad('CONFIDENCE')}:  ${wrap(confidenceText, 26)}`,
    '', SEP, ''
  ].join('\n');
}

function wrap(text, indent, width = 72) {
  const maxLen    = width - indent - 4;
  const words     = text.split(' ');
  const lines     = [];
  let   current   = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxLen) { lines.push(current.trim()); current = word; }
    else { current = current ? current + ' ' + word : word; }
  }
  if (current) lines.push(current.trim());
  return lines.join('\n  ' + ' '.repeat(indent + 4));
}

// ── Main Pipeline ────────────────────────────────────────────
/**
 * Runs all 4 pipeline stages end-to-end. Total: exactly 3 LLM calls.
 *
 * @param {Array} reelsData - Array of reel objects (reels_data.json schema)
 * @returns {string}        - Formatted recommendation card
 */
async function analyzeReelsAndRecommend(reelsData) {
  if (!Array.isArray(reelsData) || reelsData.length === 0)
    throw new Error('reelsData must be a non-empty array.');

  console.log(`\n📥  Loaded ${reelsData.length} reels. Key pool: ${rawKeys.length} key(s).`);
  console.log(`    Active key: [${currentKeyIndex + 1}/${rawKeys.length}] ${getCurrentKey().slice(0, 12)}...\n`);

  // Stage 1 — 1 batched call
  console.log('🔍  Stage 1 — Batched topic extraction (1 API call for all reels)...');
  const stage1Results = await stage1_extractTopics(reelsData);
  console.log(`    ✓ Extracted topics for ${stage1Results.length} reels.`);

  // Stage 2 — 1 call
  console.log('\n🧠  Stage 2 — Cross-reel interest aggregation...');
  const stage2Results = await stage2_aggregateInterests(stage1Results);
  console.log(`    ✓ Dominant interest: "${stage2Results.dominant_interest}" (${stage2Results.dominant_confidence})`);
  if (stage2Results.excluded_reels?.length)
    console.log(`    ✓ Excluded ${stage2Results.excluded_reels.length} reel(s) as noise/hype-bait.`);

  // Stage 3 — 1 call
  console.log('\n🎯  Stage 3 — Generating recommendation with hype filter...');
  const stage3Results = await stage3_recommend(stage2Results);
  console.log(`    ✓ Hype filter: ${stage3Results.rejected_candidates?.length || 0} rejected.`);
  console.log(`    ✓ Accepted: "${stage3Results.recommended_reel_title}"`);

  // Stage 4 — pure JS
  console.log('\n📋  Stage 4 — Formatting output...');
  const output = stage4_formatOutput(reelsData, stage1Results, stage2Results, stage3Results);

  fs.writeFileSync(path.join(__dirname, 'stage1_topics_live.json'),        JSON.stringify(stage1Results, null, 2));
  fs.writeFileSync(path.join(__dirname, 'stage2_interests_live.json'),     JSON.stringify(stage2Results, null, 2));
  fs.writeFileSync(path.join(__dirname, 'stage3_recommendation_live.json'), JSON.stringify(stage3Results, null, 2));
  console.log('    ✓ Intermediate results saved.');

  console.log(`\n    Final active key: [${currentKeyIndex + 1}/${rawKeys.length}] ${getCurrentKey().slice(0, 12)}...`);

  return output;
}

// ── Entry Point ──────────────────────────────────────────────
(async () => {
  const inputFile = process.argv[2] || path.join(__dirname, 'data', 'reels_data.json');
  if (!fs.existsSync(inputFile)) { console.error(`\n❌  File not found: ${inputFile}\n`); process.exit(1); }

  let reelsData;
  try { reelsData = JSON.parse(fs.readFileSync(inputFile, 'utf-8')); }
  catch (e) { console.error(`\n❌  Failed to parse ${inputFile}: ${e.message}\n`); process.exit(1); }

  try {
    const output = await analyzeReelsAndRecommend(reelsData);
    console.log(output);
  } catch (err) {
    console.error(`\n❌  Pipeline error: ${err.message}\n`);
    process.exit(1);
  }
})();

module.exports = { analyzeReelsAndRecommend };
