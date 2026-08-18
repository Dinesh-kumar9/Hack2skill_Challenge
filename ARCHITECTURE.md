# ARCHITECTURE.md — AI-Powered Reel Recommendation Agent

---

## 1. Problem Statement

Students consume large volumes of short-form Reel content spanning entertainment, coding memes, lifestyle vlogs, and tech reviews. While much of this content is surface-level or trend-driven, a student's underlying tech interest can often be *inferred* from the combination of reels they engage with.

The challenge is: **standard keyword-matching fails here.** A student watching a Java meme, a software-engineer lifestyle reel, an interview preparation joke, and a laptop comparison reel is *not* necessarily "interested in Java" — they are likely interested in **software engineering as a career**. A naive system would recommend more Java content; this agent should recommend DSA practice or system design — something genuinely useful to that deeper interest.

This agent solves this by reasoning across a student's reel history, detecting the *underlying interest cluster*, and recommending high-signal, hype-free tech content that matches that deeper intent.

---

## 2. Core Approach — Multi-Stage Reasoning Pipeline

This is **not** a keyword frequency counter or a tag-matching system. It is a multi-stage reasoning pipeline where each stage builds on the previous one to produce increasingly deeper insight.

### (a) Per-Reel Topic Extraction
Each reel is individually analyzed to extract:
- Its **surface topic** (what it literally appears to be about)
- Its **underlying signal** (what the viewer's interest *really* is by watching this)
- A **content quality flag** (educational vs. entertainment vs. hype-bait)

> Example: A reel titled *"POV: You're a software engineer at 3am"* has a surface topic of "meme/lifestyle" but carries the underlying signal of "software engineering career curiosity."

### (b) Cross-Reel Interest Aggregation
The agent looks across **all extracted underlying signals** from the reel history — not the surface topics, and not a simple frequency count — to identify the dominant **interest cluster**: a coherent theme that explains *why* a student watched this particular mix of reels.

This is the key differentiator. Even if "Java" appears in one reel title, if the surrounding context of other reels points to career/SWE interest, the agent correctly identifies the cluster as `software_engineering_career`, not `java_programming`.

### (c) Recommendation Generation with Hype/Clickbait Filter
A recommendation is generated that:
- **Matches the identified interest cluster** (not just the most recent reel's topic)
- Is **genuinely educational or skill-building** — verified against a hype filter
- Is **rejected** if it matches clickbait patterns such as:
  - Titles with excessive numbers: *"10 AI tools that will..."*
  - Vague promise language: *"...that will get you a job"*, *"...you NEED to know"*
  - Hype buzzwords without substance: *"shocking"*, *"secret"*, *"exposed"*

Only content that passes the hype filter is surfaced to the student.

### (d) Structured Output Formatting
The final output is formatted into a consistent, human-readable schema (see Section 5) that explains not just *what* is recommended, but *why* — making the agent's reasoning transparent and trustworthy.

---

## 3. Key Design Decision — Interest Generalization Logic

### Why underlying_signal beats keyword frequency

A naive approach would:
1. Extract keywords from each reel title/tag
2. Count the most frequent keyword
3. Recommend more content with that keyword

**This fails** because:
- Entertainment content (memes, lifestyle vlogs) shares keywords with educational content but serves a different intent
- A single reel with an explicit keyword (e.g., "Java") can drown out a more meaningful pattern across multiple reels
- Students often explore career/tech interests *obliquely* — through lifestyle content, humor, and comparisons — before engaging with direct educational material

### The underlying_signal approach

Instead, each reel is analyzed for what a student's *choice to watch it* reveals about their mindset and goals — independent of the reel's own surface content. This signal is then aggregated across reels to find the **interest cluster**: a coherent, higher-level theme.

### Illustrative Example

| Reel Watched | Surface Topic | Underlying Signal |
|---|---|---|
| *"Java is pain 😂 meme"* | Java / Programming Humor | Familiarity with programming; curious about SWE culture |
| *"Day in the life of a SWE at Google"* | SWE Lifestyle | Career aspirations in software engineering |
| *"When the interviewer asks about Big O 💀"* | Interview Humor | Awareness of technical interviews; likely preparing or curious |
| *"MacBook vs ThinkPad for developers"* | Laptop Comparison | Actively setting up or planning a developer environment |

**Naive system output:** Recommends more Java content (highest surface keyword frequency).

**This agent's output:** Identifies the cluster as `software_engineering_career` and recommends a DSA fundamentals reel or a system design introduction — content that actually helps the student toward their inferred goal.

---

## 4. Data Flow Diagram

```
INPUT: Student's Reel Watch History
       [List of reel objects: title, tags, category, duration]
              │
              ▼
┌─────────────────────────────────────┐
│  STAGE 1: Per-Reel Topic Extractor  │
│  • surface_topic                    │
│  • underlying_signal                │
│  • content_type (edu/entertainment/ │
│    hype-bait)                       │
└────────────────┬────────────────────┘
                 │ [Enriched reel objects]
                 ▼
┌─────────────────────────────────────┐
│  STAGE 2: Cross-Reel Aggregator     │
│  • Reads all underlying_signals     │
│  • Identifies dominant interest     │
│    cluster (NOT keyword frequency)  │
│  • Outputs: interest_cluster label  │
│    + reasoning                      │
└────────────────┬────────────────────┘
                 │ [Interest cluster + rationale]
                 ▼
┌─────────────────────────────────────┐
│  STAGE 3: Recommendation Generator  │
│  • Maps cluster → candidate reels   │
│  • Applies hype/clickbait filter    │
│  • Selects highest-signal match     │
│  • Adds difficulty + confidence     │
└────────────────┬────────────────────┘
                 │ [Filtered recommendation]
                 ▼
┌─────────────────────────────────────┐
│  STAGE 4: Output Formatter          │
│  • Structures data into output      │
│    schema (see Section 5)           │
│  • Renders in UI                    │
└────────────────┬────────────────────┘
                 │
                 ▼
OUTPUT: Structured Recommendation Card
```

---

## 5. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Frontend** | Single HTML + Vanilla JS file | Lightweight, no build step, easy to demo — hackathon-appropriate |
| **Styling** | Vanilla CSS | Full control, no dependency on Tailwind or external frameworks |
| **LLM Reasoning** | LLM API calls (per stage) | Each pipeline stage uses a focused prompt; reasoning is explicit, not a black box |
| **Data Storage** | In-memory JS objects / localStorage | No backend required; sample data is hardcoded or user-input |
| **Backend** | None | All logic runs client-side; LLM calls are the only external dependency |

> **Design principle:** Every stage of the pipeline must be independently inspectable — the agent shows its reasoning, not just its output.

---

## 6. Output Schema

Every recommendation produced by the agent must include **all** of the following fields:

| Field | Description |
|---|---|
| `CURRENT REEL` | Title/description of the triggering reel (or most representative reel in the history) |
| `INTEREST DETECTED` | The inferred interest cluster label (e.g., `software_engineering_career`, `ml_fundamentals`, `web_development`) |
| `WHY` | Explanation of how the cross-reel pattern led to this interest detection — the agent's reasoning in plain English |
| `RECOMMENDED TECH REEL` | Title of the recommended educational reel |
| `CATEGORY` | Broad category of the recommendation (e.g., `DSA`, `System Design`, `ML Basics`, `Web Dev`, `DevOps`) |
| `WHY THIS RECOMMENDATION` | Explanation of why this specific reel was chosen over alternatives |
| `DIFFICULTY` | Difficulty level of the recommended content: `Beginner` / `Intermediate` / `Advanced` |
| `CONFIDENCE` | Agent's confidence in the interest detection: `High` / `Medium` / `Low`, with a brief note |

### Example Output Card

```
CURRENT REEL         : "When the interviewer asks about Big O 💀"
INTEREST DETECTED    : software_engineering_career
WHY                  : Across 4 reels watched, the student engaged with a Java meme,
                       a SWE lifestyle vlog, an interview humor reel, and a laptop 
                       comparison — all signals pointing toward someone building toward
                       a software engineering career, not just learning Java syntax.
RECOMMENDED TECH REEL: "Big O Notation Explained in 12 Minutes — Real Interview Examples"
CATEGORY             : DSA
WHY THIS RECOMMENDATION: DSA is the foundational skill gap for students aspiring to SWE 
                         roles; this reel directly addresses what the interview humor reel
                         suggests the student is anxious about.
DIFFICULTY           : Intermediate
CONFIDENCE           : High — 4/4 reels align with the SWE career cluster; no conflicting signals.
```

---

*This document is the design contract for the implementation. All code written in subsequent stages must conform to the pipeline described here.*
