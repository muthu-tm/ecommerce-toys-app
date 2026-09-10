#!/usr/bin/env bash
#
# Configures Workload Identity Federation so GitHub Actions can deploy without a
# service-account key.
#
#   ./setup-wif.sh <project-id> <github-owner/repo> <development|production>
#
# Example:
#   ./setup-wif.sh romp-dev muthu-tm/ecommerce-toys-app development
#
# Why not a service-account JSON key in a GitHub secret: it is a long-lived
# credential that grants project access to anyone who reads it once. It gets
# echoed into logs, copied into local .env files, and never rotated. WIF replaces
# it with a short-lived token the runner exchanges for itself, scoped by an
# attribute condition to this repository.
#
# Idempotent. Re-run after a partial failure.
#
# Prerequisites: gcloud, authenticated, with permission to manage IAM on the
# project. Also needs the GitHub CLI (`gh`) to write the repository variables —
# if it is missing, the script prints the values for you to set by hand.

set -euo pipefail

PROJECT_ID="${1:?usage: setup-wif.sh <project-id> <owner/repo> <environment>}"
GITHUB_REPO="${2:?usage: setup-wif.sh <project-id> <owner/repo> <environment>}"
ENVIRONMENT="${3:?usage: setup-wif.sh <project-id> <owner/repo> <environment>}"

case "$ENVIRONMENT" in
  development|production) ;;
  *) printf 'ERROR: environment must be development or production.\n' >&2; exit 1 ;;
esac

readonly POOL_ID='github-actions'
readonly PROVIDER_ID='github'
readonly SA_NAME='github-deployer'
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Least privilege for what the pipeline actually deploys. Deliberately absent:
# roles/owner, roles/editor, and any role granting data read access — a deploy
# identity that can read customer orders is a deploy identity worth stealing.
readonly SA_ROLES=(
  roles/firebase.developAdmin      # rules, indexes, Firebase config
  roles/firebasehosting.admin      # hosting / App Hosting releases
  roles/cloudfunctions.developer   # deploy functions (Task 10)
  roles/run.developer              # Functions v2 run on Cloud Run
  roles/artifactregistry.writer    # build artefacts for functions
  roles/iam.serviceAccountUser     # act as the runtime service account
  roles/serviceusage.serviceUsageConsumer
)

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m\nERROR: %s\033[0m\n\n' "$*" >&2; exit 1; }

command -v gcloud >/dev/null 2>&1 || die 'gcloud is required.'

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)') \
  || die "Cannot read project $PROJECT_ID."
info "Project $PROJECT_ID (number $PROJECT_NUMBER)"

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com \
  --project="$PROJECT_ID"

# ---------------------------------------------------------------------------
log "Workload identity pool"
if gcloud iam workload-identity-pools describe "$POOL_ID" \
     --project="$PROJECT_ID" --location=global >/dev/null 2>&1; then
  info 'Already exists.'
else
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --project="$PROJECT_ID" --location=global \
    --display-name='GitHub Actions'
fi

# ---------------------------------------------------------------------------
log "OIDC provider"
#
# The attribute condition is the security boundary. Without it, *any* GitHub
# repository anywhere could exchange its OIDC token for access to this project.
# It is not optional hardening; it is the whole control.
#
# Note on `repository`: GitHub is moving to an immutable default `sub` claim that
# encodes owner and repository IDs rather than names, for repositories created or
# renamed after 15 July 2026. Matching on `assertion.repository` keeps working,
# but if you rename or transfer the repository you must update this condition.
if gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
     --project="$PROJECT_ID" --location=global \
     --workload-identity-pool="$POOL_ID" >/dev/null 2>&1; then
  info 'Already exists — updating the attribute condition.'
  action=update-oidc
else
  action=create-oidc
fi

gcloud iam workload-identity-pools providers "$action" "$PROVIDER_ID" \
  --project="$PROJECT_ID" --location=global \
  --workload-identity-pool="$POOL_ID" \
  --display-name='GitHub OIDC' \
  --issuer-uri='https://token.actions.githubusercontent.com' \
  --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref' \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}'"

# ---------------------------------------------------------------------------
log "Deploy service account"
if gcloud iam service-accounts describe "$SA_EMAIL" \
     --project="$PROJECT_ID" >/dev/null 2>&1; then
  info 'Already exists.'
else
  gcloud iam service-accounts create "$SA_NAME" \
    --project="$PROJECT_ID" \
    --display-name='GitHub Actions deployer'
fi

log "Granting roles"
for role in "${SA_ROLES[@]}"; do
  info "$role"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --condition=None \
    --quiet >/dev/null
done

# ---------------------------------------------------------------------------
log "Allowing the repository to impersonate the service account"
POOL_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"

# Scoped to attribute.repository, so only this repository's workflows can
# impersonate. A binding on the whole pool would let any federated identity in it
# assume this account.
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL_RESOURCE}/attribute.repository/${GITHUB_REPO}" \
  --quiet >/dev/null

PROVIDER_RESOURCE="${POOL_RESOURCE}/providers/${PROVIDER_ID}"

# ---------------------------------------------------------------------------
log "GitHub environment variables"
if command -v gh >/dev/null 2>&1; then
  info "Writing variables to the '$ENVIRONMENT' environment via gh."
  gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER \
    --repo "$GITHUB_REPO" --env "$ENVIRONMENT" --body "$PROVIDER_RESOURCE"
  gh variable set GCP_SERVICE_ACCOUNT \
    --repo "$GITHUB_REPO" --env "$ENVIRONMENT" --body "$SA_EMAIL"
  gh variable set FIREBASE_PROJECT_ID \
    --repo "$GITHUB_REPO" --env "$ENVIRONMENT" --body "$PROJECT_ID"
  info 'Done.'
else
  warn 'gh not installed. Set these three variables by hand:'
  warn "  GitHub > Settings > Environments > $ENVIRONMENT > Environment variables"
fi

cat <<EOF

Values for the '$ENVIRONMENT' environment (these are configuration, not secrets —
they identify a trust relationship rather than granting one):

  GCP_WORKLOAD_IDENTITY_PROVIDER
    $PROVIDER_RESOURCE

  GCP_SERVICE_ACCOUNT
    $SA_EMAIL

  FIREBASE_PROJECT_ID
    $PROJECT_ID

EOF

if [[ "$ENVIRONMENT" == 'production' ]]; then
  cat <<'EOF'
PRODUCTION — one more step, and the deploy is unguarded without it:

  GitHub > Settings > Environments > production
    - Required reviewers: add at least one person
    - Deployment branches and tags: restrict to tags matching v*

  `environment: production` in the workflow does not pause for approval on its
  own. It pauses because the environment says to. Until you add a reviewer,
  deploy-prod.yml deploys straight through.

EOF
fi
