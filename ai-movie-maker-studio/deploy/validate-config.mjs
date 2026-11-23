#!/usr/bin/env node
// Validates the deployment settings BEFORE any Google Cloud command runs.
// Uses the very same rules as the backend (server/shared/config-rules.mjs).
//   node deploy/validate-config.mjs               -> exit 0 if valid (prints nothing)
//   node deploy/validate-config.mjs --print-emails -> also prints the normalized ALLOWED_EMAILS list
import { validateDeployConfig } from '../server/shared/config-rules.mjs';

const { errors, allowedEmails } = validateDeployConfig(process.env);
if (errors.length > 0) {
  console.error('Deployment configuration is not valid. Nothing was changed in Google Cloud.\n');
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\nFix the values above and run the script again.');
  process.exit(1);
}
if (process.argv.includes('--print-emails')) console.log(allowedEmails.join(','));
