#!/usr/bin/env bash
# Go live on mainnet: set the token mint and treasury on Render, deploy main, smoke test.
# Usage: RENDER_API_KEY=... scripts/go-live.sh <MINT> <TREASURY> [--enable-burns] [--enable-payouts]
# --enable-payouts: checks on chain that the mint's pump.fun fee sharing config pays 100% to the distributor
#   (the wallet in ~/neurocracy-mainnet/payout.json) and is locked, then sets NC_PAYOUT_KEY (from that file,
#   never printed), NC_PAYOUT_ENABLED=1, PAYOUT_DRY_RUN=0 and NC_FEESWEEP_ENABLED=1. Refuses otherwise.
# Without it, payouts stay off. Never touches ZK on-chain or X settings. Never prints the API key or wallet key.
set -euo pipefail
MINT="${1:?mint address}"; TREASURY="${2:?treasury address}"; shift 2
BURNS=""; PAYOUTS=""
for a in "$@"; do case "$a" in --enable-burns) BURNS="$a";; --enable-payouts) PAYOUTS="$a";; *) echo "unknown flag $a"; exit 1;; esac; done
PAYOUT_FILE="${PAYOUT_FILE:-$HOME/neurocracy-mainnet/payout.json}"; cd "$(dirname "$0")/"..
SVC="${RENDER_SERVICE:-srv-dbb4rmqfngtc739u47ng}"; API="https://api.render.com/v1/services/$SVC"; SITE="${SITE:-https://neurocracy.fun}"
: "${RENDER_API_KEY:?set RENDER_API_KEY}"
b58='^[1-9A-HJ-NP-Za-km-z]{32,44}$'
[[ "$MINT" =~ $b58 ]] || { echo "bad mint"; exit 1; }; [[ "$TREASURY" =~ $b58 ]] || { echo "bad treasury"; exit 1; }
auth=(-H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json")
put() { curl -sf -X PUT "${auth[@]}" "$API/env-vars/$1" -d "{\"value\":\"$2\"}" >/dev/null && echo "set $1"; }

# 0. the mint must be a real SPL / Token-2022 mint on mainnet with 6 decimals (public RPC, read only)
dec=$(curl -s https://api.mainnet-beta.solana.com -H 'Content-Type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenSupply\",\"params\":[\"$MINT\"]}" | python3 -c "import json,sys;print(json.load(sys.stdin).get('result',{}).get('value',{}).get('decimals','none'))")
[ "$dec" = "6" ] || { echo "mint check failed (decimals: $dec)"; exit 1; }; echo "mint ok, 6 decimals"

# 0b. payouts: the fee sharing config must pay 100% to the distributor and be locked, before anything is set
if [ -n "$PAYOUTS" ]; then
  [ -f "$PAYOUT_FILE" ] || { echo "REFUSED: $PAYOUT_FILE not found"; exit 1; }
  DIST=$(node -e "const w=require('@solana/web3.js');console.log(w.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')))).publicKey.toBase58())" "$PAYOUT_FILE" 2>/dev/null)
  [[ "$DIST" =~ $b58 ]] || { echo "REFUSED: could not read the distributor wallet from $PAYOUT_FILE"; exit 1; }
  echo "distributor $DIST"
  node scripts/check-feeshare.js "$MINT" "$DIST" 2>/dev/null | grep -v bigint || { echo "REFUSED: payouts not enabled. Fix the pump.fun Creator Fee Sharing first (100% to $DIST, confirmed)."; exit 1; }
  curl -sf "${auth[@]}" "$API/env-vars?limit=100" | python3 -c "import json,sys;d=[e['envVar'] for e in json.load(sys.stdin)];sys.exit(0 if any(e['key']=='NC_OPS_ADDRESS' and e.get('value') for e in d) else 1)" \
    || { echo "REFUSED: NC_OPS_ADDRESS is not set on Render (the 20% operations share needs it, payouts stay off without it)"; exit 1; }
fi

# 1. env
put NC_TOKEN_MINT "$MINT"; put NC_TREASURY "$TREASURY"
if [ "$BURNS" = "--enable-burns" ]; then put NC_NOMINATE_ENABLED 1; put NC_REPLY_BURN_ENABLED 1; fi
if [ -n "$PAYOUTS" ]; then
  # the key goes from the file to Render on stdin; it is never echoed or put on a command line
  python3 -c "import json,sys;print(json.dumps({'value':json.dumps(json.load(open(sys.argv[1])),separators=(',',':'))}))" "$PAYOUT_FILE" \
    | curl -sf -X PUT "${auth[@]}" "$API/env-vars/NC_PAYOUT_KEY" -d @- >/dev/null && echo "set NC_PAYOUT_KEY (not shown)"
  put NC_PAYOUT_ENABLED 1; put PAYOUT_DRY_RUN 0; put NC_FEESWEEP_ENABLED 1
fi

# 2. deploy the latest main commit
SHA=$(git ls-remote https://github.com/neurocracyfun/neurocracy.git refs/heads/main | cut -f1)
DEP=$(curl -sf -X POST "${auth[@]}" "$API/deploys" -d "{\"commitId\":\"$SHA\"}" | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
echo "deploy $DEP for ${SHA:0:7}"
for i in $(seq 1 60); do
  st=$(curl -sf "${auth[@]}" "$API/deploys/$DEP" | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])"); echo "  $st"
  case "$st" in live) break;; *failed*|canceled|deactivated) echo "deploy $st"; exit 1;; esac; sleep 15
done
for i in $(seq 1 12); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$SITE")" = 200 ] && break; sleep 10; done

# 3. smoke test
fail=0; chk() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
CFG=$(curl -s "$SITE/api/config")
chk "home 200" '[ "$(curl -s -o /dev/null -w %{http_code} $SITE/)" = 200 ]'
chk "config shows mint" 'echo "$CFG" | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if d[\"mint\"]==\"$MINT\" and not d[\"preview\"] else 1)"'
chk "config shows treasury" 'echo "$CFG" | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if d[\"treasury\"]==\"$TREASURY\" else 1)"'
if [ -n "$PAYOUTS" ]; then
  chk "payouts live" 'echo "$CFG" | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if d[\"payout\"][\"enabled\"] and not d[\"payout\"][\"dryRun\"] and d[\"payout\"][\"distributor\"]==\"$DIST\" else 1)"'
  chk "fee sweeper live" 'curl -s $SITE/api/feesweeps | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if d[\"enabled\"] and not d[\"dryRun\"] else 1)"'
else
  chk "payouts still off" 'echo "$CFG" | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if not d[\"payout\"][\"enabled\"] and d[\"payout\"][\"dryRun\"] else 1)"'
fi
R=$(curl -s "$SITE/api/round" | python3 -c "import json,sys;print(json.load(sys.stdin)['round'])")
V=$(curl -s -o /tmp/golive-vote.json -w '%{http_code}' -X POST "$SITE/api/vote" -H 'Content-Type: application/json' -d "{\"wallet\":\"$TREASURY\",\"candidate\":\"p:owl\",\"signature\":\"1111\",\"round\":$R,\"topic\":\"-\"}")
chk "vote endpoint open (bad signature gives 400, not 409 preview)" '[ "$V" = 400 ] && grep -q "signature" /tmp/golive-vote.json'
[ "$BURNS" = "--enable-burns" ] && chk "burn price available" 'echo "$CFG" | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if d[\"burns\"][\"price\"] else 1)"'
echo "$CFG" | python3 -c "import json,sys;d=json.load(sys.stdin);b=d['burns'];print('price', b['price'], 'nominate', b['nominate']['burn'], 'reply', b['reply']['burn'])"
echo "check the CA on $SITE in a browser"; exit $fail
