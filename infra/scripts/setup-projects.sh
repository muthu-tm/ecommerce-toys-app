#!/usr/bin/env bash
#
# Provisions one ROMP Firebase environment.
#
#   ./setup-projects.sh <project-id> [region]
#
# Example:
#   ./setup-projects.sh romp-dev asia-south1
#
# Idempotent: every step checks for the resource before creating it, so re-running
# after a partial failure is safe and is the intended recovery path.
#
# WHAT THIS SCRIPT CANNOT DO. Three things need a human, and the script stops and
# tells you rather than pretending:
#   1. Linking a billing account (Blaze is required for Cloud Functions, App
#      Hosting and outbound network calls such as WhatsApp).
#   2. Choosing the Firestore location. It is permanent — a wrong choice means a
#      new project, not a migration.
#   3. Setting required reviewers on the GitHub `production` environment. Without
#      that, the prod deploy workflow has no approval gate.
#
# Prerequisites: gcloud, firebase-tools, curl, and an authenticated session for
# both (`gcloud auth login`, `firebase login`).

set -euo pipefail

PROJECT_ID="${1:?usage: setup-projects.sh <project-id> [region]}"
REGION="${2:-asia-south1}"

# asia-south1 (Mumbai) keeps Firestore, Functions and rendering in the same region
# as the customers. A cross-region hop on every server-side read is a permanent
# latency tax on the pages that matter most.
readonly REQUIRED_APIS=(
  firebase.googleapis.com
  firestore.googleapis.com
  firebasestorage.googleapis.com
  identitytoolkit.googleapis.com
  cloudfunctions.googleapis.com
  cloudbuild.googleapis.com
  run.googleapis.com
  eventarc.googleapis.com
  cloudscheduler.googleapis.com
  secretmanager.googleapis.com
  firebasehosting.googleapis.com
  firebaseapphosting.googleapis.com
  artifactregistry.googleapis.com
  logging.googleapis.com
  monitoring.googleapis.com
)

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m\nERROR: %s\033[0m\n\n' "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed."
}

log "Checking prerequisites"
require_command gcloud
require_command firebase
require_command curl
gcloud auth print-access-token >/dev/null 2>&1 \
  || die "Not authenticated with gcloud. Run: gcloud auth login"
info "gcloud and firebase CLIs present and authenticated."

# ---------------------------------------------------------------------------
log "Project $PROJECT_ID"
if gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  info "Already exists."
else
  info "Creating..."
  gcloud projects create "$PROJECT_ID" --name="$PROJECT_ID"
fi

if ! gcloud beta billing projects describe "$PROJECT_ID" \
     --format='value(billingEnabled)' 2>/dev/null | grep -qi true; then
  warn "No billing account linked."
  warn "Cloud Functions, App Hosting and any outbound HTTP call need the Blaze plan."
  warn "Link one here, then re-run this script:"
  warn "  https://console.firebase.google.com/project/$PROJECT_ID/usage/details"
  die "Billing must be enabled before the remaining steps can succeed."
fi
info "Billing is enabled."

# ---------------------------------------------------------------------------
log "Enabling APIs"
# One call: enabling them individually is slow and the failure modes interleave.
gcloud services enable "${REQUIRED_APIS[@]}" --project="$PROJECT_ID"
info "${#REQUIRED_APIS[@]} APIs enabled."

# ---------------------------------------------------------------------------
log "Adding Firebase to the project"
if firebase projects:list --json 2>/dev/null | grep -q "\"$PROJECT_ID\""; then
  info "Firebase already enabled."
else
  firebase projects:addfirebase "$PROJECT_ID"
fi

# ---------------------------------------------------------------------------
log "Firestore database in $REGION"
if gcloud firestore databases describe --project="$PROJECT_ID" \
     --database='(default)' >/dev/null 2>&1; then
  existing_location=$(gcloud firestore databases describe --project="$PROJECT_ID" \
    --database='(default)' --format='value(locationId)')
  info "Already exists in $existing_location."
  if [[ "$existing_location" != "$REGION" ]]; then
    warn "Location is $existing_location, not $REGION. This is permanent."
    warn "If that is wrong, you need a new project — there is no move operation."
  fi
else
  info "Creating in Native mode..."
  # Native mode, not Datastore mode: security rules and the client SDKs — which
  # the realtime notification bell depends on — only exist in Native mode.
  gcloud firestore databases create \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --type=firestore-native
fi

# ---------------------------------------------------------------------------
log "Authentication providers"
# Email/Password on, everything else off. Mobile-number login is built on top of
# Email/Password via a deterministic internal alias, so the phone provider — which
# would require SMS OTP, explicitly out of scope — stays disabled. See ADR-0006.
access_token=$(gcloud auth print-access-token)
identity_config_url="https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config"

http_status=$(curl -sS -o /tmp/romp-identity-config.json -w '%{http_code}' \
  -X PATCH \
  -H "Authorization: Bearer ${access_token}" \
  -H 'Content-Type: application/json' \
  --data '{
    "signIn": {
      "email":       { "enabled": true,  "passwordRequired": true },
      "phoneNumber": { "enabled": false },
      "anonymous":   { "enabled": false },
      "allowDuplicateEmails": false
    }
  }' \
  "${identity_config_url}?updateMask=signIn" || true)

if [[ "$http_status" == "200" ]]; then
  info "Email/Password enabled; phone and anonymous disabled."
else
  warn "Could not set providers automatically (HTTP $http_status)."
  warn "Response: $(cat /tmp/romp-identity-config.json 2>/dev/null | head -c 400)"
  warn "Set them by hand: Firebase console > Authentication > Sign-in method."
  warn "  Email/Password: ENABLED (email link: disabled)"
  warn "  Phone:          DISABLED   Anonymous: DISABLED"
fi
rm -f /tmp/romp-identity-config.json

# Defence in depth only. The real policy — 10 characters with a zxcvbn floor and
# deliberately no composition rules — is enforced in application code, because
# composition rules reduce real entropy. This just stops a trivially short
# password if application validation is ever bypassed.
http_status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X PATCH \
  -H "Authorization: Bearer ${access_token}" \
  -H 'Content-Type: application/json' \
  --data '{
    "passwordPolicyConfig": {
      "passwordPolicyEnforcementState": "ENFORCE",
      "passwordPolicyVersions": [
        { "customStrengthOptions": { "minPasswordLength": 10 } }
      ]
    }
  }' \
  "${identity_config_url}?updateMask=passwordPolicyConfig" || true)

if [[ "$http_status" == "200" ]]; then
  info "Minimum password length set to 10."
else
  warn "Password policy not applied (HTTP $http_status) — needs Identity Platform."
  warn "Not fatal: application-level validation is the enforcing control."
fi

# ---------------------------------------------------------------------------
log "Storage bucket"
if gcloud storage buckets describe "gs://${PROJECT_ID}.firebasestorage.app" \
     --project="$PROJECT_ID" >/dev/null 2>&1; then
  info "Default bucket already exists."
else
  warn "No default bucket yet."
  warn "Create it once from the console (it provisions the Firebase-linked bucket):"
  warn "  https://console.firebase.google.com/project/$PROJECT_ID/storage"
fi

# ---------------------------------------------------------------------------
log "Deploying rules and indexes"
info "Deny-all baseline until Task 6. Deploying it now means an unfinished"
info "environment is closed rather than open."
(
  cd "$(dirname "$0")/../.."
  firebase deploy --project "$PROJECT_ID" --only firestore,storage --non-interactive
)

# ---------------------------------------------------------------------------
log "Done — $PROJECT_ID is provisioned"
cat <<EOF

Remaining manual steps:

  1. Confirm the Storage bucket exists (link above) if it was reported missing.

  2. Verify the sign-in providers in the console. Automation is best-effort here;
     the setting is security-relevant enough to check with your own eyes:
       Authentication > Sign-in method
       Email/Password ENABLED, Phone DISABLED, Anonymous DISABLED

  3. Set up CI authentication:
       ./setup-wif.sh $PROJECT_ID <github-owner/repo> <development|production>

  4. For the production project only, configure the approval gate:
       GitHub > Settings > Environments > production > Required reviewers
     Without this, deploy-prod.yml runs unattended and the "manual approval"
     control does not exist.

  5. App Hosting backends are created in Task 5, when the apps exist.

EOF
