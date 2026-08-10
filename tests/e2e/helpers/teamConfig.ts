// E2E test infrastructure — hardcoded list of backends to test in team mode.
// This is intentionally static (not dynamic from ACP init results) because
// E2E tests need a predictable set of backends to validate.
const ALL_BACKENDS = new Set(['aionrs', 'codex', 'claude', 'gemini']);
const DEFAULT_BACKENDS = new Set(['aionrs', 'codex']);

// Support TEAM_AGENT=aionrs or TEAM_AGENT=aionrs,codex to run only specific leader types.
// Values are validated against the full list; unknown types are silently dropped.
const envLeaderTypes = process.env.TEAM_AGENT;

export const TEAM_SUPPORTED_BACKENDS: ReadonlySet<string> = envLeaderTypes
  ? new Set(
      envLeaderTypes
        .split(',')
        .map((s) => s.trim())
        .filter((t) => ALL_BACKENDS.has(t))
    )
  : DEFAULT_BACKENDS;
