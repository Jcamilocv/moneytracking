#!/usr/bin/env bash
# Isolated QA only. No deployed endpoint, ADC, browser session or real bot.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${FIRESTORE_EMULATOR_JAR:?Set path to the local Firestore emulator jar}"
QA_JAVA_BIN="${JAVA_BIN:-java}"
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
unset GOOGLE_APPLICATION_CREDENTIALS FIREBASE_SERVICE_ACCOUNT_JSON TELEGRAM_BOT_TOKEN TELEGRAM_PUBLIC_CHANNEL_ID OFFICIAL_PICKS_ADMIN_SECRET MORNING_PUBLISH_SECRET MORNING_PUBLISH_ENABLED
node --input-type=module -e 'try { await fetch("http://127.0.0.1:8080", {signal: AbortSignal.timeout(500)}); process.exit(1); } catch { process.exit(0); }' || { echo 'Local port 8080 is occupied; stop only your previous emulator first.' >&2; exit 1; }
QA_OUTPUT_DIR="${QA_OUTPUT_DIR:-/tmp/morning-qa-local}"
mkdir -p "$QA_OUTPUT_DIR"
"$QA_JAVA_BIN" -jar "$FIRESTORE_EMULATOR_JAR" --host 127.0.0.1 --port 8080 --rules firestore.rules --project_id demo-morning-20261011 > "$QA_OUTPUT_DIR/emulator.log" 2>&1 &
QA_EMULATOR_PID=$!
trap 'kill "$QA_EMULATOR_PID" 2>/dev/null || true' EXIT
QA_READY=false
for attempt in {1..30}; do
    if node --input-type=module -e 'const r=await fetch("http://127.0.0.1:8080/emulator/v1/projects/demo-morning-20261011/databases/(default)/documents", {method:"DELETE", signal:AbortSignal.timeout(500)}); if(r.status!==200) process.exit(1)' >/dev/null 2>&1; then QA_READY=true; break; fi
    sleep 1
done
[ "$QA_READY" = true ] || { echo 'Local emulator unavailable; no tests run.' >&2; exit 1; }
node --test tests/morning-definitivo.test.mjs tests/morning-runtime.test.mjs tests/official-pick-data.test.mjs tests/official-pick-reports.test.mjs tests/operations-alerts.test.mjs tests/futbolbrain-local-ingest.test.mjs tests/premium-access.test.mjs tests/subscription-entitlement.test.mjs tests/premiumpay.test.mjs tests/official-snapshot-data.test.mjs > "$QA_OUTPUT_DIR/local-tests.tap" 2>&1
node --test tests/morning-emulator.test.mjs > "$QA_OUTPUT_DIR/emulator-tests.tap" 2>&1
node --test tests/firestore.rules.test.mjs > "$QA_OUTPUT_DIR/firestore-rules.tap" 2>&1
npm run build > "$QA_OUTPUT_DIR/build.log" 2>&1
node scripts/morning-publish-runtime.mjs > "$QA_OUTPUT_DIR/vps-runtime-files.txt"
node --input-type=module - "$QA_OUTPUT_DIR" <<'JS'
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const suites = ['local-tests.tap', 'emulator-tests.tap', 'firestore-rules.tap'];
let tests = 0;
for (const file of suites) {
    const text = await readFile(join(process.argv[2], file), 'utf8');
    if (!/^# fail 0$/m.test(text) || !/^# skipped 0$/m.test(text)) throw new Error('QA_SUITE_FAILED');
    tests += Number(text.match(/^# tests (\d+)$/m)[1]);
}
console.log(JSON.stringify({ result: 'LOCAL_PASS', tests, productionChanges: 0, realTelegramMessages: 0, independentQA: 'NOT_ASSERTED_BY_THIS_SCRIPT' }));
JS
