# YehThatRocks

A music video discovery and curation platform built as a proof of concept demonstrating what a single experienced developer can ship with a modern AI-assisted workflow.

## What this is

YehThatRocks is a complex, production-grade web application featuring a full authentication system, a YouTube-backed video player with queue and playlist management, Top 100 leaderboard, per-artist catalogs, genre browsing, AI-powered recommendations, favourites, global chat, and more.

The entire codebase was developed with **VSCode + GitHub Copilot** at a total AI spend of **less than $30**, in **less than 5 days of work**.

## How it was built

The workflow mirrors traditional web application development — no magic, no shortcuts:

- Feature requirements discussed and scoped just as they would be with a colleague
- Code written incrementally, one coherent change at a time
- Every change reviewed, tested, and verified before moving on
- Schema migrations, data scripts, and UI work treated as separate, deliberate steps
- Regression invariant scripts maintained and run after every meaningful change

What AI accelerates is the mechanical work: boilerplate, lookup, cross-referencing, and the first draft of code that an experienced developer then shapes and owns. The process is fast because the developer driving it has decades of classic web application experience and knows exactly what to ask for, what to reject, and what to push back on.

This is **not**:
- Agentic AI running overnight generating thousands of tokens from a massive spec document
- Prompt-and-pray development
- A showcase of what AI can do unsupervised

This is a showcase of what **one experienced programmer** can do when AI removes the friction from work they already know how to do.

## Deployment

For VPS deployment with Docker Compose and `systemd`, see [DEPLOY_VPS.md](DEPLOY_VPS.md).

## Licence

**YehThatRocks source code is not licensed for commercial use.**

This repository is provided for intellectual and educational purposes only, as a proof of concept. You are welcome to read the code, learn from it, and reference it. You may not use it, in whole or in part, in any commercial product or service without explicit written permission from the author.

&copy; Simon, 2026. All rights reserved.
