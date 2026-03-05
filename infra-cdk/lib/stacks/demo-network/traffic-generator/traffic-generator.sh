#!/bin/bash
# =============================================================================
# NetAIOps Demo Traffic Generator
# Deployed via SSM to shared-ci-runner instances
# Generates realistic, varied traffic patterns for demo dashboard charts
# =============================================================================

set -euo pipefail

LOG_TAG="traffic-gen"
log() { logger -t "$LOG_TAG" "$1"; }

# ---------------------------------------------------------------------------
# Target definitions
# ---------------------------------------------------------------------------

# Load Balancers
PROD_ALB="netaiops-prod-alb-1195765903.us-west-2.elb.amazonaws.com"
STAGING_ALB="internal-netaiops-staging-alb-524711584.us-west-2.elb.amazonaws.com"
PROD_NLB="netaiops-prod-nlb-71b3e7a39e3ecf8c.elb.us-west-2.amazonaws.com"

# Prod VPC targets (10.1.x.x) — web, app, api, cache tiers
PROD_WEB=(10.1.2.126 10.1.2.237 10.1.3.43 10.1.3.246)
PROD_APP=(10.1.2.177 10.1.2.35 10.1.2.167 10.1.3.8 10.1.3.161 10.1.3.14)
PROD_API=(10.1.2.87 10.1.2.150 10.1.3.88 10.1.3.44)
PROD_CACHE=(10.1.2.99 10.1.3.178)

# Staging VPC targets (10.2.x.x)
STAGING_WEB=(10.2.0.224 10.2.1.236 10.2.0.95)
STAGING_APP=(10.2.0.231 10.2.1.127 10.2.0.113)
STAGING_API=(10.2.0.199 10.2.1.27)
STAGING_WORKER=(10.2.0.109 10.2.1.18)

# Shared VPC targets (10.0.x.x) — monitoring, logging, tools
SHARED_MONITORING=(10.0.2.217 10.0.3.182)
SHARED_LOG=(10.0.2.149 10.0.3.115)
SHARED_TOOLS=(10.0.2.110 10.0.3.15)

# External targets (NAT Gateway traffic)
EXTERNAL_URLS=(
  "https://aws.amazon.com"
  "https://httpbin.org/bytes/1024"
  "https://httpbin.org/bytes/10240"
  "https://httpbin.org/bytes/51200"
  "https://api.github.com"
  "https://www.example.com"
  "https://ifconfig.me"
  "https://checkip.amazonaws.com"
)

# Common HTTP paths for variation
PATHS=("/" "/health" "/status" "/api/v1/info" "/metrics" "/api/v1/data" "/ready" "/livez")
ERROR_PATHS=("/nonexistent" "/api/v1/broken" "/404page" "/err/timeout" "/missing-resource")

# Payload sizes (bytes) for body variation
PAYLOAD_SIZES=(512 1024 2048 4096 8192 16384 32768 65536 102400)

# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------

# Pick random element from array
pick_random() {
  local arr=("$@")
  echo "${arr[$((RANDOM % ${#arr[@]}))]}"
}

# Get current concurrency multiplier based on hour-of-day sine wave
# Peak at :00 and :30, trough at :15 and :45
get_wave_multiplier() {
  local minute
  minute=$(date +%M | sed 's/^0//')
  # Sine wave: peak near 0 and 30, min near 15 and 45
  # Using bash integer math to approximate: multiplier 1-5
  local phase=$(( (minute % 30) ))
  if [ "$phase" -lt 8 ] || [ "$phase" -gt 22 ]; then
    echo 4  # peak
  elif [ "$phase" -lt 12 ] || [ "$phase" -gt 18 ]; then
    echo 3  # rising/falling
  else
    echo 1  # trough
  fi
}

# Generate random payload of given size
gen_payload() {
  local size=$1
  head -c "$size" /dev/urandom | base64 | head -c "$size"
}

# Quiet curl with timeout
qcurl() {
  curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 10 "$@" 2>/dev/null || true
}

# Curl that downloads (for NAT GW bytes metrics)
dcurl() {
  curl -s --connect-timeout 5 --max-time 15 "$@" > /dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# Traffic pattern functions
# ---------------------------------------------------------------------------

# 1. Base traffic — continuous requests to all tiers every ~5 seconds
base_traffic() {
  log "base_traffic: starting cycle"
  local path
  path=$(pick_random "${PATHS[@]}")

  # Should we inject an error? (5% chance)
  if [ $((RANDOM % 20)) -eq 0 ]; then
    path=$(pick_random "${ERROR_PATHS[@]}")
  fi

  # ALB requests (HTTP)
  qcurl "http://${PROD_ALB}${path}" &
  qcurl "http://${STAGING_ALB}${path}" &

  # NLB request (TCP/8080)
  qcurl "http://${PROD_NLB}:8080${path}" &

  # Pick one target from each tier for base load
  local target
  target=$(pick_random "${PROD_WEB[@]}")
  qcurl "http://${target}:80${path}" &

  target=$(pick_random "${PROD_APP[@]}")
  qcurl "http://${target}:8080${path}" &

  target=$(pick_random "${PROD_API[@]}")
  qcurl "http://${target}:8080${path}" &

  target=$(pick_random "${STAGING_WEB[@]}")
  qcurl "http://${target}:80${path}" &

  target=$(pick_random "${STAGING_APP[@]}")
  qcurl "http://${target}:8080${path}" &

  wait
}

# 2. ALB heavy traffic — varied concurrency against both ALBs
alb_traffic() {
  local multiplier
  multiplier=$(get_wave_multiplier)
  local count=$((multiplier * 3))
  log "alb_traffic: ${count} concurrent requests (wave=${multiplier})"

  for _ in $(seq 1 "$count"); do
    local path
    path=$(pick_random "${PATHS[@]}")
    local size
    size=$(pick_random "${PAYLOAD_SIZES[@]}")

    # POST with payload to generate bytes in/out
    if [ $((RANDOM % 3)) -eq 0 ]; then
      qcurl -X POST -d "$(gen_payload "$size")" "http://${PROD_ALB}${path}" &
    else
      qcurl "http://${PROD_ALB}${path}" &
    fi

    # Staging ALB gets ~40% of prod traffic
    if [ $((RANDOM % 5)) -lt 2 ]; then
      qcurl "http://${STAGING_ALB}${path}" &
    fi
  done
  wait
}

# 3. NAT Gateway traffic — external downloads for egress bytes
nat_gw_traffic() {
  log "nat_gw_traffic: external requests"
  local url

  # 2-4 external requests
  local count=$((2 + RANDOM % 3))
  for _ in $(seq 1 "$count"); do
    url=$(pick_random "${EXTERNAL_URLS[@]}")
    dcurl "$url" &
  done

  # Occasionally download larger content (httpbin bytes endpoints)
  if [ $((RANDOM % 4)) -eq 0 ]; then
    dcurl "https://httpbin.org/bytes/102400" &
    dcurl "https://httpbin.org/bytes/204800" &
  fi

  wait
}

# 4. Cross-VPC sweep — hit every internal target for TGW traffic
cross_vpc_sweep() {
  log "cross_vpc_sweep: full instance sweep"

  # Prod VPC
  for ip in "${PROD_WEB[@]}" "${PROD_APP[@]}" "${PROD_API[@]}" "${PROD_CACHE[@]}"; do
    qcurl "http://${ip}:80/" &
    qcurl "http://${ip}:8080/" &
  done

  # Staging VPC
  for ip in "${STAGING_WEB[@]}" "${STAGING_APP[@]}" "${STAGING_API[@]}" "${STAGING_WORKER[@]}"; do
    qcurl "http://${ip}:80/" &
    qcurl "http://${ip}:8080/" &
  done

  # Shared VPC (same VPC but different subnets — still generates network traffic)
  for ip in "${SHARED_MONITORING[@]}" "${SHARED_LOG[@]}" "${SHARED_TOOLS[@]}"; do
    qcurl "http://${ip}:9090/" &
    qcurl "http://${ip}:5044/" &
  done

  wait
}

# 5. Burst spike — 30 seconds of high-concurrency requests
burst_spike() {
  log "burst_spike: starting 30s burst"
  local end_time=$((SECONDS + 30))

  while [ $SECONDS -lt $end_time ]; do
    # 10 concurrent requests per iteration
    for _ in $(seq 1 10); do
      local path
      path=$(pick_random "${PATHS[@]}")
      local size
      size=$(pick_random "${PAYLOAD_SIZES[@]}")

      # Mix of ALB, NLB, and direct targets
      case $((RANDOM % 4)) in
        0) qcurl -X POST -d "$(gen_payload "$size")" "http://${PROD_ALB}${path}" & ;;
        1) qcurl "http://${STAGING_ALB}${path}" & ;;
        2)
          local target
          target=$(pick_random "${PROD_APP[@]}")
          qcurl -X POST -d "$(gen_payload "$size")" "http://${target}:8080${path}" & ;;
        3)
          local target
          target=$(pick_random "${STAGING_API[@]}")
          qcurl "http://${target}:8080${path}" & ;;
      esac
    done
    wait
    sleep 0.5
  done
  log "burst_spike: ended"
}

# 6. Varied payload traffic — generate diverse bytes metrics
payload_traffic() {
  log "payload_traffic: varied payload sizes"
  local size
  for _ in $(seq 1 5); do
    size=$(pick_random "${PAYLOAD_SIZES[@]}")
    local target
    target=$(pick_random "${PROD_APP[@]}")
    qcurl -X POST -d "$(gen_payload "$size")" "http://${target}:8080/api/v1/data" &

    target=$(pick_random "${PROD_API[@]}")
    qcurl -X POST -d "$(gen_payload "$size")" "http://${target}:8080/api/v1/data" &

    # ALB with payload
    qcurl -X POST -d "$(gen_payload "$size")" "http://${PROD_ALB}/api/v1/data" &
  done
  wait
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

log "=== NetAIOps Traffic Generator started (PID $$) ==="

CYCLE=0
SWEEP_INTERVAL=120    # Cross-VPC sweep every 2 minutes
BURST_INTERVAL=900    # Burst spike every 15 minutes
NAT_INTERVAL=30       # NAT traffic every 30 seconds
PAYLOAD_INTERVAL=15   # Payload variation every 15 seconds

LAST_SWEEP=0
LAST_BURST=0
LAST_NAT=0
LAST_PAYLOAD=0

while true; do
  NOW=$SECONDS
  CYCLE=$((CYCLE + 1))

  # Always: base traffic (every cycle = ~5s)
  base_traffic

  # Always: ALB traffic with wave pattern
  alb_traffic

  # Every 30s: NAT gateway traffic
  if [ $((NOW - LAST_NAT)) -ge $NAT_INTERVAL ]; then
    nat_gw_traffic
    LAST_NAT=$NOW
  fi

  # Every 15s: payload variation
  if [ $((NOW - LAST_PAYLOAD)) -ge $PAYLOAD_INTERVAL ]; then
    payload_traffic
    LAST_PAYLOAD=$NOW
  fi

  # Every 2min: cross-VPC sweep
  if [ $((NOW - LAST_SWEEP)) -ge $SWEEP_INTERVAL ]; then
    cross_vpc_sweep
    LAST_SWEEP=$NOW
  fi

  # Every 15min: burst spike (30s duration)
  if [ $((NOW - LAST_BURST)) -ge $BURST_INTERVAL ]; then
    burst_spike
    LAST_BURST=$NOW
  fi

  # Log progress every 100 cycles
  if [ $((CYCLE % 100)) -eq 0 ]; then
    log "cycle=${CYCLE} uptime=${SECONDS}s"
  fi

  # Base interval ~5 seconds with slight jitter (4-6s)
  sleep $((4 + RANDOM % 3))
done
