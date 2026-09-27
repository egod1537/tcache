# Tokyo private railway core artifacts

This directory is reserved for immutable, credentialed Challenge 2026 source
artifacts for Tokyu, Keio, and Odakyu. Source bytes are intentionally not
checked into the repository.

Layout after collection:

```text
<operator>/challenge-2026-<content-hash>/
  raw/
  manifest.json
<operator>/latest -> challenge-2026-<content-hash>
```

The artifacts are for local personal education and research only. They must
not be redistributed or used commercially. Credentials are accepted only via
`ODPT_CHALLENGE_KEY` and are never stored in manifests or request logs.
