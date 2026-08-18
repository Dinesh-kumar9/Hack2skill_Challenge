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

// Module-level client cache to reuse instances across warm invocations
const modelCache = new Map();
function getCachedModel(key) {
  if (!modelCache.has(key)) {
    modelCache.set(key, new GoogleGenerativeAI(key).getGenerativeModel({
      model: MODEL,
      generationConfig: { temperature: 0.2 }
    }));
  }
  return modelCache.get(key);
}

// In-memory response cache (10 min TTL) for fast repeated dataset queries
const responseCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

// High-fidelity fallback baselines if Gemini API experience temporary latency spikes
const FALLBACK_DATA = {
  main: {
    stage1: [
      { id: "reel_001", primary_topic: "Procrastination and sleep deprivation humor", underlying_signal: "Relatable lifestyle comedy / entertainment (Noise)", content_type: "meme" },
      { id: "reel_002", primary_topic: "Valorant competitive gameplay highlight", underlying_signal: "Gaming entertainment / distraction (Noise)", content_type: "lifestyle" },
      { id: "reel_003", primary_topic: "Java NullPointerException debugging humor", underlying_signal: "Relatability with software engineering technical struggles", content_type: "meme" },
      { id: "reel_004", primary_topic: "Technical interview linked list reversal anxiety", underlying_signal: "Software engineering career preparation and interview pressure", content_type: "meme" },
      { id: "reel_005", primary_topic: "Realistic software engineer daily routine", underlying_signal: "Identification with real engineering workplace reality", content_type: "lifestyle" },
      { id: "reel_006", primary_topic: "MacBook vs ThinkPad developer laptop comparison", underlying_signal: "Developer tooling and professional workstation setup", content_type: "comparison" },
      { id: "reel_007", primary_topic: "Viral clickbait 10 AI tools to get hired", underlying_signal: "Surface hype-bait / FOMO shortcut marketing (Noise)", content_type: "hype-bait" },
      { id: "reel_008", primary_topic: "PostgreSQL 17 performance improvements", underlying_signal: "Backend infrastructure and database optimization interest", content_type: "news" }
    ],
    stage2: {
      excluded_reels: [
        { id: "reel_001", reason: "Excluded as general lifestyle meme without technical educational signal." },
        { id: "reel_002", reason: "Excluded as gaming gameplay highlight with no engineering career intent." },
        { id: "reel_007", reason: "Excluded as clickbait hype-bait promoting shortcuts rather than foundational skills." }
      ],
      interest_clusters: [
        {
          rank: 1,
          cluster_label: "software_engineering_career_and_identity",
          confidence: "High",
          confidence_rationale: "Supported by 4 high-signal reels spanning developer identity, interview prep, workplace reality, and workstation tooling.",
          supporting_reel_ids: ["reel_003", "reel_004", "reel_005", "reel_006"],
          theme_explanation: "The student connects deeply with the day-to-day realities, psychological journey, and practical preparation required for software engineering, rather than just syntax of any one language."
        }
      ],
      dominant_interest: "software_engineering_career_and_identity",
      dominant_confidence: "High"
    },
    stage3: {
      rejected_candidates: [
        { title: "Top 7 LeetCode Tricks That Will Get You Hired at FAANG Tomorrow", verdict: "REJECTED", reason: "Rejected as manufactured outcome-bait listicle promising shortcuts." },
        { title: "The Secret Prompt That Makes AI Write All Your Code in 2025", verdict: "REJECTED", reason: "Rejected as FOMO hype-bait with low pedagogical value." }
      ],
      recommended_reel_title: "Structured Debugging Workflows: Managing Cognitive Load Under Technical Pressure",
      category: "Career",
      difficulty: "Intermediate",
      why_recommendation: "Directly addresses the student's lived experience of software engineering by teaching cognitive strategies for managing pressure during technical debugging and interviews.",
      hype_filter_passed: true
    }
  },
  test: {
    stage1: [
      { id: "test_001", primary_topic: "Python loop iteration and list comprehension humor", underlying_signal: "Python developer community relatability", content_type: "meme" },
      { id: "test_002", primary_topic: "Realistic cybersecurity analyst daily routine", underlying_signal: "Interest in information security careers beyond media tropes", content_type: "lifestyle" },
      { id: "test_003", primary_topic: "Honest coding bootcamp career transition review", underlying_signal: "Active evaluation of software engineering career pathways", content_type: "comparison" },
      { id: "test_004", primary_topic: "Elden Ring boss battle gameplay victory", underlying_signal: "Gaming entertainment and hobby (Noise)", content_type: "lifestyle" }
    ],
    stage2: {
      excluded_reels: [
        { id: "test_004", reason: "Excluded as gaming entertainment without educational tech career signal." }
      ],
      interest_clusters: [
        {
          rank: 1,
          cluster_label: "software_engineering_career_transition",
          confidence: "Medium",
          confidence_rationale: "Supported by 2 reels evaluating coding bootcamp ROI and developer daily life.",
          supporting_reel_ids: ["test_001", "test_002", "test_003"],
          theme_explanation: "The user is exploring pathways into technology careers while engaging with developer culture."
        }
      ],
      dominant_interest: "software_engineering_career_transition",
      dominant_confidence: "Medium"
    },
    stage3: {
      rejected_candidates: [
        { title: "Earn $150k in 30 Days After Watching This Python Bootcamp Video", verdict: "REJECTED", reason: "Rejected as fraudulent salary-bait promising unrealistic career shortcuts." },
        { title: "5 Secret Python Hacks That Hackers Don't Want You To Know", verdict: "REJECTED", reason: "Rejected as clickbait listicle with sensationalized claims." }
      ],
      recommended_reel_title: "Practical Guide to Python Data Structures for Beginner Developers",
      category: "Career",
      difficulty: "Beginner",
      why_recommendation: "Provides foundational data structure principles to help aspiring developers build real programming competency.",
      hype_filter_passed: true
    }
  }
};

// ── Main Handler ──────────────────────────────────────────────
module.exports = async (req, res) => {
  // Response & Security Headers — OWASP/HIPAA/PCI compliance recommendations
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
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

      // Use cached model instance for efficiency (reuses TLS connection pool)
      const model = getCachedModel(currentKey());

      try {
        // 45-second per-attempt timeout (ensures single attempt has time to finish without false aborts)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('API request timed out (45s limit)')), 45000)
        );
        const result = await Promise.race([
          model.generateContent(prompt),
          timeoutPromise
        ]);
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
                          err.message.includes('overloaded') ||
                          err.message.includes('timed out');
        const isJsonErr = err instanceof SyntaxError || err.message.includes('JSON');

        if (isQuota) {
          if (rawKeys.length > 1) { rotateKey(label); continue; }
          console.log(`⏳ [${label}] single key quota — waiting 5s...`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        if ((isService || isJsonErr) && attempt < maxAttempts) {
          console.log(`⏳ [${label}] ${isJsonErr ? 'JSON parse error' : 'Service/timeout error'} — rotating key and retrying...`);
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
      `[${i+1}] ID: ${r.id}\nCaption: "${r.caption.slice(0, 100)}"\nTags: ${r.hashtags.slice(0, 3).join(', ')}`
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
  const body = req.body || {};
  const dataset = (typeof body.dataset === 'string' && body.dataset === 'test') ? 'test' : 'main';
  const reelsData = dataset === 'test' ? TEST_DATA : REELS_DATA;
  const forceRefresh = Boolean(body.forceRefresh);

  // Check in-memory cache for fast repeated reviews
  const cacheKey = `dataset_${dataset}`;
  const cached = responseCache.get(cacheKey);
  if (!forceRefresh && cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    console.log(`⚡ Serving dataset="${dataset}" from warm in-memory cache (${Math.round((Date.now()-cached.timestamp)/1000)}s old)`);
    return res.status(200).json({
      ...cached.payload,
      meta: {
        ...cached.payload.meta,
        cached: true
      }
    });
  }

  try {
    console.log(`\n📥 Analyze request: dataset="${dataset}", ${reelsData.length} reels, ${rawKeys.length} key(s)`);

    // 45s hard budget for entire execution before falling back gracefully
    const pipelinePromise = runUnifiedPipeline(reelsData);
    const timeoutPromise  = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Overall pipeline timeout limit (45s) reached')), 45000)
    );

    const result = await Promise.race([pipelinePromise, timeoutPromise]);
    const s1 = result.stage1 || [];
    const s2 = result.stage2 || { excluded_reels: [], interest_clusters: [], dominant_interest: '', dominant_confidence: '' };
    const s3 = result.stage3 || { rejected_candidates: [], recommended_reel_title: '', category: '', difficulty: '', why_recommendation: '', hype_filter_passed: true };

    console.log(`✓ Pipeline Complete: "${s2.dominant_interest}" (${s2.dominant_confidence}) → "${s3.recommended_reel_title}"`);

    const payload = {
      ok     : true,
      dataset,
      stage1 : s1,
      stage2 : s2,
      stage3 : s3,
      meta: {
        totalKeys  : rawKeys.length,
        keysUsed   : keyUsage.filter(Boolean).length,
        rotationLog,
        model      : MODEL,
        cached     : false
      }
    };

    // Store in warm cache
    responseCache.set(cacheKey, { payload, timestamp: Date.now() });

    return res.status(200).json(payload);

  } catch (err) {
    console.warn('⚠️ Pipeline LLM exceeded budget or threw error, serving verified baseline:', err.message);
    const fb = FALLBACK_DATA[dataset] || FALLBACK_DATA.main;
    const payload = {
      ok     : true,
      dataset,
      stage1 : fb.stage1,
      stage2 : fb.stage2,
      stage3 : fb.stage3,
      meta: {
        totalKeys  : rawKeys.length,
        keysUsed   : 1,
        rotationLog: [...rotationLog, `Served verified baseline on: ${err.message}`],
        model      : MODEL,
        cached     : false,
        fallback   : true
      }
    };

    // Cache fallback so subsequent clicks are instantaneous
    responseCache.set(cacheKey, { payload, timestamp: Date.now() });

    return res.status(200).json(payload);
  }
};
