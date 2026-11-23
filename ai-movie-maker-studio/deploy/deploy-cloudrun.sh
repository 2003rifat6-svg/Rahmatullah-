#!/usr/bin/env bash
# One-time setup + deploy of AI Movie Maker Studio to Google Cloud Run.
#
#   !! This creates billable Google Cloud resources (Cloud Run, Firestore, Cloud Storage,
#   !! Cloud Build, Artifact Registry, Secret Manager). Most have a free tier, but the
#   !! project MUST have a billing account. Gemini / Veo calls are paid separately.
#
# Usage (from the project folder, after `gcloud auth login`):
#   PROJECT_ID=my-project REGION=asia-south1 \
#   OAUTH_CLIENT_ID=xxxx.apps.googleusercontent.com ALLOWED_EMAILS=me@gmail.com \
#   bash deploy/deploy-cloudrun.sh
#
# Re-running is safe: existing resources are kept, the service is redeployed.
set -euo pipefail

# ---- 1. Validate EVERYTHING first. No Google Cloud command runs before this succeeds. ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js 22+ is required to validate the configuration before deploying." >&2
  exit 1
fi
# Same rules as the backend (server/shared/config-rules.mjs); prints the cleaned-up email list.
ALLOWED_EMAILS="$(node "$SCRIPT_DIR/validate-config.mjs" --print-emails)" || exit 1

PROJECT_ID="${PROJECT_ID// /}"
OAUTH_CLIENT_ID="${OAUTH_CLIENT_ID// /}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-ai-movie-studio}"
BUCKET="${BUCKET:-${PROJECT_ID}-movie-studio-media}"
SA_NAME="${SA_NAME:-movie-studio-run}"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
SIGNED_URLS="${SIGNED_URLS:-true}"
MAX_INSTANCES="${MAX_INSTANCES:-3}"

cat <<INFO
Project:  ${PROJECT_ID}      Region: ${REGION}
Service:  ${SERVICE}         Bucket: gs://${BUCKET}
Runs as:  ${SA}
Sign-in:  ${OAUTH_CLIENT_ID}  Allowed: ${ALLOWED_EMAILS}

This will enable APIs and create/update billable resources in ${PROJECT_ID}.
INFO
read -r -p "Type YES to continue: " answer
[ "$answer" = "YES" ] || { echo "Cancelled."; exit 1; }

gcloud config set project "$PROJECT_ID"

echo "== 1. Enable APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com

echo "== 2. Firestore (Native mode) — skipped if it already exists"
gcloud firestore databases describe --database='(default)' >/dev/null 2>&1 || \
  gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native

echo "== 3. Private Cloud Storage bucket (no public access)"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention

echo "== 4. Service account with least-privilege roles"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --display-name="AI Movie Studio (Cloud Run)"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="roles/datastore.user" --condition=None >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role="roles/storage.objectAdmin" >/dev/null
if [ "$SIGNED_URLS" = "true" ]; then
  # Lets the service sign V4 URLs (big uploads/downloads go straight to GCS)
  gcloud iam service-accounts add-iam-policy-binding "$SA" --member="serviceAccount:$SA" --role="roles/iam.serviceAccountTokenCreator" >/dev/null
fi

echo "== 5. Secrets (values are typed by you, never stored in the code)"
if ! gcloud secrets describe SESSION_SECRET >/dev/null 2>&1; then
  head -c 48 /dev/urandom | base64 | tr -d '\n' | gcloud secrets create SESSION_SECRET --data-file=-
fi
if ! gcloud secrets describe GEMINI_API_KEY >/dev/null 2>&1; then
  read -r -s -p "Gemini API key (leave empty to deploy WITHOUT AI generation): " GKEY; echo
  if [ -n "$GKEY" ]; then printf '%s' "$GKEY" | gcloud secrets create GEMINI_API_KEY --data-file=-; fi
fi
SECRETS="SESSION_SECRET=SESSION_SECRET:latest"
for s in SESSION_SECRET GEMINI_API_KEY; do
  if gcloud secrets describe "$s" >/dev/null 2>&1; then
    gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" >/dev/null
  fi
done
gcloud secrets describe GEMINI_API_KEY >/dev/null 2>&1 && SECRETS="$SECRETS,GEMINI_API_KEY=GEMINI_API_KEY:latest"

echo "== 6. Build and deploy (Cloud Build uses the Dockerfile)"
gcloud run deploy "$SERVICE" --source . --region "$REGION" \
  --service-account "$SA" \
  --allow-unauthenticated \
  --memory 1Gi --cpu 1 --timeout 900 --concurrency 20 \
  --min-instances 0 --max-instances "$MAX_INSTANCES" --session-affinity \
  --set-env-vars "^;^GCS_BUCKET=$BUCKET;FIRESTORE_ENABLED=true;GOOGLE_CLOUD_PROJECT=$PROJECT_ID;GOOGLE_OAUTH_CLIENT_ID=$OAUTH_CLIENT_ID;ALLOWED_EMAILS=$ALLOWED_EMAILS;GCS_SIGNED_URLS=$SIGNED_URLS" \
  --set-secrets "$SECRETS"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"

echo "== 6b. Firestore TTL policies (old video jobs / usage counters are removed automatically; optional)"
for group in jobs usage; do
  gcloud firestore fields ttls update expiresAt --collection-group="$group" --enable-ttl --async \
    || echo "WARNING: could not enable the TTL policy for '$group' (you can do it later in the Firestore console)."
done

echo "== 7. Bucket CORS for direct browser uploads/downloads"
sed "s#https://REPLACE-WITH-YOUR-CLOUD-RUN-URL.run.app#$URL#" deploy/cors.json > /tmp/mms-cors.json
gcloud storage buckets update "gs://$BUCKET" --cors-file=/tmp/mms-cors.json

cat <<DONE

Deployed: $URL
Last manual step: Google Cloud Console → APIs & Services → Credentials → your OAuth client →
"Authorized JavaScript origins" → add  $URL
Then open the app → Cloud ☁ → "Use this app's own server" → Test → Sign in with Google.
DONE
