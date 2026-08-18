// ============================================================
//  api/analyze.js — Vercel Serverless Function
//  POST /api/analyze
//
//  Responsibility:
//    Receives { dataset: "main" | "test" } from the browser,
//    runs all 3 Gemini reasoning stages entirely server-side,
//    and returns the full structured result as JSON.
//    API keys are NEVER sent to the browser — they live only
//    in Vercel environment variables.
//
//  Pipeline (2 total API calls):
//    Stage 1 — Batch topic extraction  (1 call for ALL reels)
//    Stage 2+3 — Interest aggregation + Recommendation + hype filter (1 merged call)
//
//  Key rotation:
//    On 429/quota → rotate to next key immediately (no wait)
//    On 503       → wait 8s and retry same key
//    Single key   → wait 20s and retry
// ============================================================

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ── Data ─────────────────────────────────────────────────────
// Bundled at deploy time — no runtime file I/O
const REELS_DATA = require('../data/reels_data.json');
const TEST_DATA  = require('../data/test_custom.json');

const ALLOWED_CATEGORIES = [
  'AI', 'DSA', 'Java', 'HLD', 'Cybersecurity',
  'Cloud', 'Hardware', 'Career', 'Other'
];
const MODEL = 'gemini-3.6-flash';

// ── Main Handler ──────────────────────────────────────────────
module.exports = async (req, res) => {
  // CORS — allow same-origin and local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // ── Key pool (server-side only) ───────────────────────────
  const rawKeys = (process.env.GEMINI_API_KEYS || '')
    .split(',').map(k => k.trim()).filter(Boolean);
  if (rawKeys.length === 0)
    return res.status(500).json({ error: 'GEMINI_API_KEYS not configured on server.' });

  // Request-scoped rotation state — start with a random key to distribute load
  let keyIndex = Math.floor(Math.random() * rawKeys.length);
  const keyUsage = new Array(rawKeys.length).fill(0);
  const rotationLog = [];

  const currentKey = () => rawKeys[keyIndex];
  const rotateKey  = (label) => {
    const prev = keyIndex;
    keyIndex = (keyIndex + 1) % rawKeys.length;
    const entry = `Key ${prev+1}→${keyIndex+1} on ${label}`;
    rotationLog.push(entry);
    console.log(`🔄 ${entry}`);
  };

  // ── LLM Helper ────────────────────────────────────────────
  /**
   * Calls Gemini and returns parsed JSON.
   * Handles 429/quota via key rotation and 503 via timed retry.
   */
  async function callLLM(prompt, label) {
    const maxAttempts = Math.max(rawKeys.length * 2, 6);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`🔑 [${label}] attempt ${attempt}/${maxAttempts} — key ${keyIndex+1}/${rawKeys.length}`);
      keyUsage[keyIndex]++;

      // Instantiate once per attempt (key may have rotated since last attempt)
      const genAI = new GoogleGenerativeAI(currentKey());
      const model = genAI.getGenerativeModel({
        model: MODEL,
        generationConfig: {
          temperature: 0.2
        }
      });

      try {
        const result = await model.generateContent(prompt);
        const raw    = result.response.text().trim();
        
        // Robust JSON extraction (handles markdown blocks, leading/trailing chatter)
        let clean = raw;
        const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (codeBlockMatch) {
          clean = codeBlockMatch[1].trim();
        } else {
          const firstChar = raw.search(/[\[\{]/);
          const lastChar  = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'));
          if (firstChar !== -1 && lastChar !== -1 && lastChar > firstChar) {
            clean = raw.slice(firstChar, lastChar + 1);
          }
        }
        return JSON.parse(clean);

      } catch (err) {
        const isQuota   = err.message.includes('429') ||
                          err.message.includes('quota') ||
                          err.message.includes('RESOURCE_EXHAUSTED') ||
                          err.message.includes('Too Many Requests');
        const isService = err.message.includes('503') ||
                          err.message.includes('Service Unavailable') ||
                          err.message.includes('overloaded');
        const isJsonErr = err instanceof SyntaxError || err.message.includes('JSON');

        if (isQuota) {
          if (rawKeys.length > 1) { rotateKey(label); continue; }
          console.log(`⏳ [${label}] single key quota — waiting 5s...`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        if ((isService || isJsonErr) && attempt < maxAttempts) {
          console.log(`⏳ [${label}] ${isJsonErr ? 'JSON parse error' : '503/overload'} — rotating key and retrying...`);
          rotateKey(label);
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        throw new Error(`[${label}] Failed after ${attempt} attempt(s): ${err.message}`);
      }
    }
    throw new Error(`[${label}] Exhausted all ${maxAttempts} attempts.`);
  }

  // ── Unified 1-Call Pipeline Execution ─────────────────────────
  /**
   * Performs all 3 stages in a single unified LLM call:
   *   Stage 1: Per-reel topic & signal extraction
   *   Stage 2: Cross-reel interest aggregation & noise exclusion
   *   Stage 3: High-signal educational recommendation & hype filtering
   *
   * Executes in ~15-20s total, well within Vercel's 60s limit.
   */
  async function runUnifiedPipeline(reelsData) {
    const reelsList = reelsData.map((r, i) =>
      `[${i+1}] ID: ${r.id}\nCaption: "${r.caption}"\nTags: ${r.hashtags.slice(0, 5).join(', ')}`
    ).join('\n\n');

    const prompt = `
You are an expert AI recommendation agent analyzing a student's Instagram Reel watch history.
Perform all 3 reasoning stages and return a single unified JSON object.

REELS DATA:
${reelsList}

ALLOWED CATEGORIES (pick exactly one for Stage 3):
${ALLOWED_CATEGORIES.join(', ')}

Return ONLY valid JSON (no markdown fences, no extra text):
{
  "stage1": [
    {
      "id": "<reel_id>",
      "primary_topic": "<specific surface topic, e.g. Java NullPointerException humor>",
      "underlying_signal": "<deeper intent/identity, or flag as noise if hype-bait/unrelated>",
      "content_type": "<meme | tutorial | lifestyle | news | hype-bait | comparison>"
    }
  ],
  "stage2": {
    "excluded_reels": [
      { "id": "<reel_id>", "reason": "<why excluded as noise or entertainment>" }
    ],
    "interest_clusters": [
      {
        "rank": 1,
        "cluster_label": "<snake_case_label>",
        "confidence": "<High | Medium | Low>",
        "confidence_rationale": "<why this confidence level>",
        "supporting_reel_ids": ["<reel_id>"],
        "theme_explanation": "<plain English: shared theme connecting these reels, NOT a keyword list>"
      }
    ],
    "dominant_interest": "<dominant cluster label>",
    "dominant_confidence": "<High | Medium | Low>"
  },
  "stage3": {
    "rejected_candidates": [
      { "title": "<title>", "verdict": "REJECTED", "reason": "<why failed hype filter>" }
    ],
    "recommended_reel_title": "<high-signal, hype-free educational title>",
    "category": "<one from allowed list>",
    "difficulty": "<Beginner | Intermediate | Advanced>",
    "why_recommendation": "<why this serves the inferred cluster>",
    "hype_filter_passed": true
  }
}

STRICT REASONING RULES:
1. Stage 1: Analyze all ${reelsData.length} reels in order.
2. Stage 2: Find SHARED THEME across underlying signals (e.g. Java meme + interview joke + SWE life = "software_engineering_career", NOT "java"). Exclude pure entertainment & hype-bait noise.
3. Stage 2 Confidence: 1 reel = Low, 2 reels = Medium, 3+ reels = High.
4. Stage 3 Hype Filter: Evaluate and reject ≥2 candidate titles for listicles, outcome-bait, or manufactured FOMO before selecting the final title.
`.trim();

    const output = await callLLM(prompt, 'Unified-Pipeline');
    return output;
  }

  // ── Orchestrate ───────────────────────────────────────────
  const { dataset = 'main' } = req.body || {};
  const reelsData = dataset === 'test' ? TEST_DATA : REELS_DATA;

  try {
    console.log(`\n📥 Analyze request: dataset="${dataset}", ${reelsData.length} reels, ${rawKeys.length} key(s)`);

    const result = await runUnifiedPipeline(reelsData);
    const s1 = result.stage1 || [];
    const s2 = result.stage2 || { excluded_reels: [], interest_clusters: [], dominant_interest: '', dominant_confidence: '' };
    const s3 = result.stage3 || { rejected_candidates: [], recommended_reel_title: '', category: '', difficulty: '', why_recommendation: '', hype_filter_passed: true };

    console.log(`✓ Pipeline Complete: "${s2.dominant_interest}" (${s2.dominant_confidence}) → "${s3.recommended_reel_title}"`);

    return res.status(200).json({
      ok     : true,
      dataset,
      stage1 : s1,
      stage2 : s2,
      stage3 : s3,
      meta: {
        totalKeys  : rawKeys.length,
        keysUsed   : keyUsage.filter(Boolean).length,
        rotationLog,
        model      : MODEL
      }
    });

  } catch (err) {
    console.error('Pipeline error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
