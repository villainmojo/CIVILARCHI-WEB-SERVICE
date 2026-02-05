# RUNBOOK_CIVILARCHI.md

## Project
- Name: CIVILARCHI-WEB-SERVICE
- Purpose: Civil/Architecture engineer web app/site (토목/건축 엔지니어용 웹페이지)
- Public URL (planned): https://www.bimarchi-pg.com/civilarchi/
- Separate from main site/blog: yes (independent project and routing)

## Source Control & Deployment Policy (requirements)
- All deployments MUST be committed to Git (no “dirty deploys”).
- Every deployment point-in-time should be logged separately.
  - Keep a deployment log (append-only).
  - Keep deployed artifact snapshots (tar.gz) per deploy.

## Local workspace location
- Repo clone path (server): /root/clawd-dev/CIVILARCHI-WEB-SERVICE

## Web root (server)
- Target deploy directory: /var/www/sengvis-playground/civilarchi

## Notes / Decisions
- 2026-02-05: Chose GitHub Deploy Key auth and created key on server.
- 2026-02-05: Repo cloned but appears empty (no files yet).

## TODO (next)
1) Initialize repository structure (index.html, assets/, etc.) OR confirm if repo is expected to be empty.
2) Add deployment scripts:
   - scripts/deploy_civilarchi.sh (rsync to /var/www/.../civilarchi)
   - scripts/snapshot.sh (tar.gz backup per deploy)
3) Add Nginx route for /civilarchi/ (if not already covered by try_files).
4) Add standard checks:
   - curl origin + public verification
   - ensure correct caching headers
5) Define build system: static vs node build vs other.
