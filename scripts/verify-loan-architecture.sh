#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PASS=0
WARN=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf '  [PASS] %s\n' "$1"; }
warn() { WARN=$((WARN + 1)); printf '  [WARN] %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  [FAIL] %s\n' "$1"; }

require_file() {
    if [[ -f "$1" ]]; then
        pass "File exists: $1"
    else
        fail "Missing file: $1"
    fi
}

require_dir() {
    if [[ -d "$1" ]]; then
        pass "Directory exists: $1"
    else
        fail "Missing directory: $1"
    fi
}

echo
echo "========================================================="
echo " DANIJACE PROMOTIONS LOAN ARCHITECTURE VERIFICATION"
echo "========================================================="
echo

echo "== PROJECT =="

[[ -f package.json ]] && pass "package.json found" || fail "package.json missing"
[[ -d .git ]] && pass "Git repository detected" || fail "Git repository missing"

echo
echo "== ARCHITECTURE DIRECTORIES =="

for dir in     src/lib/loans/domain     src/lib/loans/repositories     src/lib/loans/services     src/lib/loans/payments
do
    require_dir "$dir"
done

echo
echo "== DOMAIN =="

for file in     src/lib/loans/domain/dates.ts     src/lib/loans/domain/money.ts     src/lib/loans/domain/loan-calculator.ts     src/lib/loans/domain/installment-schedule.ts     src/lib/loans/domain/repayment-allocation.ts     src/lib/loans/domain/installment-status.ts     src/lib/loans/domain/fine-calculator.ts     src/lib/loans/domain/loan-state.ts
do
    require_file "$file"
done

echo
echo "== REPOSITORIES =="

for file in     src/lib/loans/repositories/loan-repository.ts     src/lib/loans/repositories/repayment-repository.ts     src/lib/loans/repositories/installment-repository.ts     src/lib/loans/repositories/fine-repository.ts     src/lib/loans/repositories/audit-repository.ts     src/lib/loans/repositories/loan-settings-repository.ts     src/lib/loans/repositories/counter-repository.ts     src/lib/loans/repositories/savings-repository.ts     src/lib/loans/repositories/unapplied-payment-repository.ts
do
    require_file "$file"
done

echo
echo "== SERVICES =="

for file in     src/lib/loans/services/loan-service.ts     src/lib/loans/services/repayment-service.ts     src/lib/loans/services/installment-service.ts     src/lib/loans/services/fine-service.ts
do
    require_file "$file"
done

echo
echo "== PAYMENT FLOW =="

for file in     src/lib/loans/payments/payment-router.ts     src/lib/loans/payments/historical-loan-resolver.ts     src/lib/loans/payments/unapplied-payment-service.ts
do
    require_file "$file"
done

echo
echo "== CORE FILES =="

for file in     src/lib/loans/types.ts     src/lib/loans/validation.ts     src/lib/loans/index.ts
do
    require_file "$file"
done

echo
echo "== SMS =="

for file in     src/lib/sms/parser.ts     src/lib/sms/processor.ts     src/app/api/sms/process/route.ts
do
    require_file "$file"
done

echo
echo "== MONGODB BACKUP =="

if [[ -f scripts/backup-mongo.sh ]]; then
    pass "MongoDB backup script exists"
else
    warn "MongoDB backup script not found"
fi

echo
echo "== TYPESCRIPT =="

echo "Running: npx tsc --noEmit"
echo

if npx tsc --noEmit; then
    pass "TypeScript compilation is clean"
else
    fail "TypeScript compilation failed"
fi

echo
echo "== LEGACY SERVICE =="

if [[ -f src/lib/loans/service.ts ]]; then
    pass "Legacy loan service preserved"
else
    warn "Legacy loan service not found"
fi

LEGACY_MATCHES="$(
    grep -R -n         'lib/loans/service'         src/app/api         src/lib/sms         src/lib/loans/payments         src/lib/loans/services         2>/dev/null || true
)"

if [[ -z "$LEGACY_MATCHES" ]]; then
    pass "No active-path dependency on legacy loan service"
else
    fail "Active code references legacy loan service"
    echo "$LEGACY_MATCHES"
fi

echo
echo "== ACTIVE SMS ROUTE =="

if grep -q 'parseBankSms' src/app/api/sms/process/route.ts; then
    pass "Route uses parseBankSms"
else
    fail "Route does not use parseBankSms"
fi

if grep -q 'processIncomingTransaction' src/app/api/sms/process/route.ts; then
    pass "Route uses processIncomingTransaction"
else
    fail "Route does not use processIncomingTransaction"
fi

if grep -q 'processor-old' src/app/api/sms/process/route.ts; then
    fail "Active SMS route references processor-old"
else
    pass "Active SMS route does not reference processor-old"
fi

echo
echo "== HISTORICAL LOAN RESOLUTION =="

RESOLVER="src/lib/loans/payments/historical-loan-resolver.ts"

for term in authorizedAt transactionAt disbursementDate endDate; do
    if grep -q "$term" "$RESOLVER"; then
        pass "Historical resolver checks $term"
    else
        fail "Historical resolver missing $term"
    fi
done

echo
echo "== REPAYMENT ACCOUNTING =="

REPAYMENT="src/lib/loans/services/repayment-service.ts"

for term in     allocateRepayment     amountAppliedToLoan     overpaymentAmount     creditSavings
do
    if grep -q "$term" "$REPAYMENT"; then
        pass "Repayment service contains $term"
    else
        fail "Repayment service missing $term"
    fi
done

echo
echo "== FINANCIAL DATE SAFETY =="

DATE_MATCHES="$(
    grep -R -n         -E 'new Date\(|Date\.parse\('         src/lib/loans/domain         2>/dev/null || true
)"

if [[ -z "$DATE_MATCHES" ]]; then
    pass "No new Date()/Date.parse() in loan domain"
else
    warn "JavaScript Date usage found in loan domain"
    echo "$DATE_MATCHES"
fi

echo
echo "== GIT DIFF CHECK =="

if git diff --check; then
    pass "git diff --check is clean"
else
    fail "git diff --check found errors"
fi

echo
echo "== GIT STATUS =="

echo "Branch:"
git branch --show-current

echo
echo "Working tree:"
git status --short

if [[ -z "$(git status --porcelain)" ]]; then
    pass "Git working tree is clean"
else
    warn "Git working tree contains uncommitted changes"
fi

echo
echo "========================================================="
echo " SUMMARY"
echo "========================================================="
echo
echo "PASS : $PASS"
echo "WARN : $WARN"
echo "FAIL : $FAIL"
echo

if (( FAIL > 0 )); then
    echo "RESULT: FAILED"
    echo
    echo "DO NOT PUSH YET."
    exit 1
fi

if (( WARN > 0 )); then
    echo "RESULT: PASSED WITH WARNINGS"
    echo
    echo "Review the warnings before pushing."
    exit 0
fi

echo "RESULT: CLEAN"
echo
echo "Architecture verification passed."
echo "Safe to proceed to the Git checkpoint."
