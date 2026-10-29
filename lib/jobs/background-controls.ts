function enabled(value: string | undefined, fallback: boolean, name: string) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

export const legacyBackgroundJobsEnabled = (env: Record<string, string | undefined> = process.env) =>
  enabled(env.LEGACY_BACKGROUND_JOBS_ENABLED, true, 'LEGACY_BACKGROUND_JOBS_ENABLED');

export const gcpBackgroundJobsEnabled = (env: Record<string, string | undefined> = process.env) =>
  enabled(env.GCP_BACKGROUND_JOBS_ENABLED, false, 'GCP_BACKGROUND_JOBS_ENABLED');
