# Working on HD IT Pulse

- Follow README.md "Every release" for every version: the user guide, the admin guide and both changelogs are part of the release, not an afterthought.
- Security: credentials only via Pulse's Connections page or Key Vault; never logged, stored in SQL or returned to the browser. Entra SSO only. ISO 27001/9001: every change audited and versioned.
- Autotask: one API user; each module only does what `backend/src/lib/autotask.js` POLICY allows. Add to the allow-list deliberately and note it in the admin guide (section 6).
- Writing: HD IT Brand V5 voice, plain Australian English.
- Keep the claude.ai project docs (requirements, architecture, identity and access, admin guide) in step with `docs/` and `frontend/admin-guide.html`.
