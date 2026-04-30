# CLAUDE.md

## Architecture rules

For all architectural and code-review work, follow the rules in **[AGENTS.md](./AGENTS.md)** — those are the upstream-canonical rules (layer boundaries, renderer rules, viewer isolation, etc.). They apply to every change and override anything below them on architecture-sensitive work.

---

## Fork context (operational, not architectural)

This is `CaptPat/pascaleditor`, a fork of `pascalorg/editor`. Two remotes are configured:

```
origin    https://github.com/CaptPat/pascaleditor.git   (your fork)
upstream  https://github.com/pascalorg/editor.git       (read-only, sync source)
```

Sync upstream changes with `git fetch upstream && git merge upstream/main`. Changes here ship to `origin` only.

## Stack quick-reference

- **Bun + Turborepo monorepo**, not npm. Use `bun install` / `bun dev` / `bun build`. Never run `npm install` (would write a conflicting lockfile).
- **Dev port: 3002**, hardcoded in `apps/editor/package.json` (`next dev --port 3002`). The project's root `SETUP.md` is stale and says 3000 — don't trust it. Same script reads `.env.local` (not `.env`).
- **TS watchers run in parallel** for `@pascal-app/{core,viewer,mcp}` via Turborepo. Edits to those packages trigger cross-package incremental rebuild + Next.js HMR with no extra wiring.

## Cluster deployment context (planned, not yet implemented)

Pascal Editor will eventually be deployed alongside the user's "Andromeda" AI cluster. The cluster lives at `~/cluster/` in WSL2 Ubuntu on patsdesk, with two repos:

- `~/cluster/ai-stack/` → `git@github.com:CaptPat/ai-stack.git` (Docker Compose stack — OpenWebUI, Ollama, ComfyUI, SearXNG, Caddy, Grafana/Prometheus). Runs on andromeda27 (head node) with `network_mode: host`.
- `~/cluster/ansible-cluster/` (Ansible playbooks; targets `[head]` andromeda27, `[workers]` andromeda25/26 via `inventory/hosts.ini`).

**GitOps loop is already wired:** edits to ai-stack push to GitHub → `ansible-playbook deploy-ai-stack.yml` pulls onto every node → optional `compose pull/up`.

When integrating Pascal Editor with the cluster:
- AI-stack ports on **andromeda27** that are taken (host networking — no remapping): `3000` OpenWebUI, `3001` Grafana, `8080` SearXNG, `8188` ComfyUI, `9091` Prometheus, `11434` Ollama. These are remote ports, not patsdesk ports — no conflict with local dev on patsdesk:3002.
- Container images on Andromeda nodes pull from upstream registries today (no local mirror). If an image cache becomes worth it, `registry:2` pull-through on patsdesk WSL2 is the natural place.
- Shared writable storage across cluster: `\\PATSDESK\Andromeda_Shared` mounted as `/mnt/andromeda-shared/` on every node (CIFS, UID 1000 writable). Use for build artifacts and outputs, **not for live source trees** — `inotify` is broken over SMB.

## Operational guardrails

- **Never run `npm install`** — it would create `package-lock.json` and break Bun's lockfile discipline. The repo's `.gitignore` does ignore `package-lock.json` defensively, but the conflict is still real.
- **Don't put `node_modules/` or build outputs on the CIFS share.** They go on local disk only.
- **Don't trust `SETUP.md` for port/env file** — read `apps/editor/package.json` instead.
