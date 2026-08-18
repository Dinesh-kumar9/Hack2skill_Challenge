# Reel Intelligence — AI-Powered Tech Interest Recommendation Agent

> **Hack2Skill Challenge Submission**
> An AI agent that infers a student's *deeper* tech interests from Instagram Reel watch history and recommends genuinely useful educational content — going beyond surface keywords to detect real intent.

🌐 **Live Demo:** [https://reel-intelligence-omega.vercel.app](https://reel-intelligence-omega.vercel.app)

---

## What It Does

Most recommendation systems match on surface-level keywords (e.g. "watched a Java video → recommend Java"). This agent goes deeper:

1. **Stage 1** — Extracts `primary_topic` (surface) + `underlying_signal` (deeper intent) + `content_type` for every reel in **one batched API call**
2. **Stage 2** — Aggregates signals across ALL reels to find a shared interest cluster, not the most-repeated keyword. Example: Java meme + interview joke + SWE lifestyle = `software_engineering_career`, not `java`
3. **Stage 3** — Recommends one educational reel, runs a **hype filter** that explicitly rejects clickbait before accepting a title
4. **Stage 4** — Formats the structured output with all 8 required fields

**Total API calls per run: exactly 3** (one per reasoning stage).

---

## Output Format

Every run produces exactly these 8 fields:

```
CURRENT REEL              :  <representative reel from the cluster>
INTEREST DETECTED         :  <inferred interest cluster>
WHY                       :  <theme explanation + excluded reel count>
RECOMMENDED TECH REEL     :  "<title>"
CATEGORY                  :  <one of: AI / DSA / Java / HLD / Cybersecurity / Cloud / Hardware / Career / Other>
WHY THIS RECOMMENDATION   :  <justification + hype filter rejection log>
DIFFICULTY                :  <Beginner / Intermediate / Advanced>
CONFIDENCE                :  <High / Medium / Low> — <N> reel(s): <ids>
```

---

## Project Structure

```
Hack2Skill/
├── api/
│   └── analyze.js          # Vercel serverless — all 3 Gemini stages, key rotation
├── data/
│   ├── reels_data.json      # Original 8 reels (primary dataset)
│   └── test_custom.json     # Generalization test: 4 reels across different domains
├── public/
│   └── index.html          # Single-file demo UI — no build step
├── test/
│   └── pipeline.test.js    # 21 schema + alignment tests (no API keys needed)
├── agent.js                # Node.js CLI — run locally with: node agent.js
├── vercel.json             # Vercel config — 60s function timeout
├── package.json
├── .env.example            # Template for local API key setup
├── ARCHITECTURE.md         # Full system design and design decisions
└── README.md               # This file
```

---

## Running Locally (CLI)

```bash
# 1. Install dependencies
npm install

# 2. Set up API key(s)
cp .env.example .env
# Edit .env and add: GEMINI_API_KEYS=your_key_here
# Multiple keys (comma-separated) enable automatic key rotation on quota

# 3. Run on the default dataset
node agent.js

# 4. Run on custom input
node agent.js data/test_custom.json
```

---

## Running Tests

```bash
# No API keys needed — uses mock LLM responses
node test/pipeline.test.js
```

Tests cover:
- Stage 1 schema validation (id, primary_topic, underlying_signal, content_type)
- Stage 2 confidence rules (High = 3+ reels, not self-reported)
- Stage 3 hype filter (≥2 rejections required, category from allowed list)
- Stage 4 output format (all 8 required fields present)

---

## Security

- **API keys are never exposed to the browser** — stored as Vercel environment variables, accessed only inside `api/analyze.js` (serverless function)
- `.env` is gitignored; `.env.example` contains no real keys
- The client (`public/index.html`) makes zero direct calls to Gemini — only calls `/api/analyze`

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Batched Stage 1 (1 call for all reels) | Free-tier quota is the real constraint; batching cuts 8 calls to 1 |
| Key rotation on 429 (no wait) | Switching keys immediately is faster than waiting for quota reset |
| Hype filter as mandatory gate | The prompt requires ≥2 candidates to be evaluated and rejected before acceptance |
| Confidence based on independent reel count | 1 reel = Low, 2 = Medium, 3+ = High — prevents over-claiming |
| `underlying_signal` distinct from `primary_topic` | The trap the problem describes: don't match keywords, infer intent |

---

## Tech Stack

- **LLM:** Gemini 3.6 Flash (via `@google/generative-ai`)
- **Serverless:** Vercel (Node.js functions)
- **UI:** Vanilla HTML/CSS/JS — no build step, no framework
- **Tests:** Node.js built-in `assert` — no test framework needed

---

*See [ARCHITECTURE.md](./ARCHITECTURE.md) for full system design, stage-by-stage prompt rationale, and data flow diagrams.*