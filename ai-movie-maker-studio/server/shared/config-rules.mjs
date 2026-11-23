/**
 * Configuration rules shared by the backend (server/config.ts) and the deployment script
 * (deploy/validate-config.mjs). Plain JavaScript with no dependencies so the deploy machine
 * can run it with just Node.js. One source of truth: both sides always agree.
 */

const EMAIL_RE = /^[^\s@,;<>()[\]\\"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * ALLOWED_EMAILS = comma-separated Google accounts.
 * Rejects: empty / only spaces / only commas, any invalid address, addresses separated by
 * spaces instead of commas. Trims, lower-cases and removes duplicates.
 * @param {string | undefined | null} raw
 * @returns {{ emails: string[], errors: string[] }}
 */
export function parseAllowedEmails(raw) {
  const value = raw ?? '';
  if (value.trim() === '') {
    return { emails: [], errors: ['ALLOWED_EMAILS is empty. List the Google accounts that may sign in, separated by commas (e.g. ALLOWED_EMAILS=me@gmail.com,friend@gmail.com).'] };
  }
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0) {
    return { emails: [], errors: ['ALLOWED_EMAILS contains only commas/spaces and no email address.'] };
  }
  const errors = [];
  const emails = [];
  for (const p of parts) {
    if (/\s/.test(p)) {
      errors.push(`ALLOWED_EMAILS: "${p}" contains a space. Separate email addresses with commas.`);
    } else if (p.length > 254 || !EMAIL_RE.test(p)) {
      errors.push(`ALLOWED_EMAILS: "${p}" is not a valid email address.`);
    } else {
      const e = p.toLowerCase();
      if (!emails.includes(e)) emails.push(e);
    }
  }
  return { emails: errors.length ? [] : emails, errors };
}

/** Google OAuth "Web application" client id. @returns {string[]} errors */
export function validateOAuthClientId(value) {
  const v = (value ?? '').trim();
  if (!v) return ['OAUTH_CLIENT_ID is empty (Google Cloud Console → APIs & Services → Credentials → OAuth client ID → Web application).'];
  if (!/^[A-Za-z0-9._-]{3,}\.apps\.googleusercontent\.com$/.test(v)) {
    return [`OAUTH_CLIENT_ID "${v}" does not look like a Google OAuth client id (it must end with .apps.googleusercontent.com).`];
  }
  return [];
}

/**
 * Validates everything the deploy script needs BEFORE any Google Cloud command is run.
 * @param {Record<string, string | undefined>} env
 * @returns {{ errors: string[], values: Record<string, string>, allowedEmails: string[] }}
 */
export function validateDeployConfig(env) {
  const errors = [];
  const get = (k, def = '') => (env[k] ?? def).trim();

  const projectId = get('PROJECT_ID');
  if (!projectId) errors.push('PROJECT_ID is empty (your Google Cloud project id).');
  else if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) errors.push(`PROJECT_ID "${projectId}" is not a valid Google Cloud project id (6-30 characters: lowercase letters, digits, hyphens; starts with a letter).`);

  errors.push(...validateOAuthClientId(env.OAUTH_CLIENT_ID));

  const emails = parseAllowedEmails(env.ALLOWED_EMAILS);
  errors.push(...emails.errors);

  const region = get('REGION', 'asia-south1');
  if (!/^[a-z]+-[a-z]+[0-9]+$/.test(region)) errors.push(`REGION "${region}" is not a valid region name (example: asia-south1).`);

  const service = get('SERVICE', 'ai-movie-studio');
  if (!/^[a-z]([a-z0-9-]{0,48}[a-z0-9])?$/.test(service)) errors.push(`SERVICE "${service}" is not a valid Cloud Run service name (lowercase letters, digits, hyphens).`);

  const bucket = get('BUCKET', projectId ? `${projectId}-movie-studio-media` : '');
  if (projectId && (!/^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('goog'))) {
    errors.push(`BUCKET "${bucket}" is not a valid Cloud Storage bucket name (3-63 characters: lowercase letters, digits, - _ . ; no "goog").`);
  }

  const saName = get('SA_NAME', 'movie-studio-run');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(saName)) errors.push(`SA_NAME "${saName}" is not a valid service account name (6-30 characters).`);

  const maxInstances = get('MAX_INSTANCES', '3');
  if (!/^[0-9]+$/.test(maxInstances) || Number(maxInstances) < 1 || Number(maxInstances) > 20) errors.push(`MAX_INSTANCES must be a whole number from 1 to 20 (got "${maxInstances}").`);

  const signed = get('SIGNED_URLS', 'true');
  if (signed !== 'true' && signed !== 'false') errors.push(`SIGNED_URLS must be true or false (got "${signed}").`);

  return {
    errors,
    allowedEmails: emails.emails,
    values: { projectId, region, service, bucket, saName, signedUrls: signed, maxInstances, oauthClientId: get('OAUTH_CLIENT_ID') },
  };
}
